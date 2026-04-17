"""
Inkwave - A simple desktop app to view markdown files rendered.
Uses PyWebView (system web view) and requires only: pip install pywebview
"""

import base64
import json
import os
import re
import sys
import threading
import urllib.error
import urllib.request

# Prefer Edge (WebView2) on Windows to avoid WinForms/pythonnet errors.
# Must set before importing webview so the correct GUI backend is chosen.
if os.name == "nt":
    os.environ.setdefault("PYWEBVIEW_GUI", "edgechromium")

import webview

try:
    import anthropic as _anthropic
    _ANTHROPIC_AVAILABLE = True
except ImportError:
    _ANTHROPIC_AVAILABLE = False

try:
    import keyring as _keyring
    _KEYRING_AVAILABLE = True
except ImportError:
    _KEYRING_AVAILABLE = False

try:
    import openai as _openai
    _OPENAI_AVAILABLE = True
except ImportError:
    _OPENAI_AVAILABLE = False

try:
    import google.genai as _genai
    from google.genai.types import GenerateContentConfig
    _GENAI_AVAILABLE = True
except ImportError:
    _GENAI_AVAILABLE = False

_KEYRING_SERVICE = "Inkwave"
_KEYRING_USERNAMES = {
    "anthropic": "anthropic_api_key",
    "openai":    "openai_api_key",
    "gemini":    "gemini_api_key",
}
# Backward-compat alias used by the old save_api_key / get_api_key_status / delete_api_key methods
_KEYRING_USERNAME = _KEYRING_USERNAMES["anthropic"]


def _build_system_prompt(file_contexts):
    open_dir = None
    files = []
    if isinstance(file_contexts, dict):
        open_dir = file_contexts.get("openDirectory")
        files = file_contexts.get("files") or []
    elif isinstance(file_contexts, list):
        files = file_contexts

    base = """You are an AI assistant embedded in Inkwave, a Markdown editor.

## File Change Protocol
When asked to modify or create a file, wrap the COMPLETE file content in:
<file-change path="/absolute/path/to/file.md">
full file content here
</file-change>
Rules: always full content (no diffs), use absolute paths, explain changes after the XML.

"""
    if open_dir:
        base += f"## Open Directory\n{open_dir}\n\nWhen creating new files, save them in this directory unless the user specifies otherwise.\n\n"

    base += "## Open Files\n"
    if not files:
        base += "No files open.\n"
    else:
        for fc in files:
            base += f'### {fc.get("path") or "(unsaved)"}\n\n```markdown\n{fc.get("content","")}\n```\n\n'
    return base.strip()


# Directory where this script lives (for loading index.html)
# When frozen by PyInstaller, data files are in sys._MEIPASS (temp extraction dir).
# When running from source, they're alongside this script.
BASE_DIR = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))

# User data dir for settings — must be writable and persistent across runs.
# _MEIPASS is a temp dir that's wiped on exit, so we can't write settings there.
def _user_data_dir():
    if sys.platform == 'darwin':
        return os.path.join(os.path.expanduser('~'), 'Library', 'Application Support', 'Inkwave')
    elif os.name == 'nt':
        return os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'Inkwave')
    else:
        return os.path.join(os.path.expanduser('~'), '.inkwave')

# File dialog types (new API + fallbacks for older pywebview)
_file_dialog = getattr(webview, "FileDialog", None)
_FILE_DIALOG_OPEN = getattr(_file_dialog, "OPEN", None) if _file_dialog else None
if _FILE_DIALOG_OPEN is None:
    _FILE_DIALOG_OPEN = getattr(webview, "OPEN_DIALOG", 0)
_FILE_DIALOG_FOLDER = getattr(_file_dialog, "FOLDER", None) if _file_dialog else None
if _FILE_DIALOG_FOLDER is None:
    _FILE_DIALOG_FOLDER = getattr(webview, "FOLDER_DIALOG", 20)
_FILE_DIALOG_SAVE = getattr(_file_dialog, "SAVE", None) if _file_dialog else None
if _FILE_DIALOG_SAVE is None:
    _FILE_DIALOG_SAVE = getattr(webview, "SAVE_DIALOG", 10)

MD_EXTENSIONS = (".md", ".markdown")


def _filter_pywebview_errors(line):
    """Filter out known noisy pywebview/WinForms errors (window.native recursion, __abstractmethods__)."""
    if "[pywebview] Error while processing" in line:
        return True
    if "__abstractmethods__" in line and "[pywebview]" in line:
        return True
    if "maximum recursion depth exceeded" in line and "[pywebview]" in line:
        return True
    if "OPEN_DIALOG is deprecated" in line:
        return True
    return False


class StderrFilter:
    """Filter stderr to suppress pywebview WinForms introspection error spam."""

    def __init__(self, stream):
        self._stream = stream
        self._buf = ""

    def write(self, s):
        self._buf += s
        while "\n" in self._buf or "\r" in self._buf:
            sep = "\n" if "\n" in self._buf else "\r"
            line, self._buf = self._buf.split(sep, 1)
            line = line.rstrip("\r\n")
            if not _filter_pywebview_errors(line):
                self._stream.write(line + "\n")

    def flush(self):
        if self._buf and not _filter_pywebview_errors(self._buf):
            self._stream.write(self._buf)
        self._buf = ""
        self._stream.flush()


def _list_dir_md_only(dir_path):
    """List directory; only subdirs and files with .md/.markdown. Sorted: dirs first, then by name."""
    if not os.path.isdir(dir_path):
        return []
    entries = []
    try:
        for name in os.listdir(dir_path):
            full = os.path.join(dir_path, name)
            if os.path.isdir(full):
                entries.append({"name": name, "path": full, "isDir": True})
            elif os.path.isfile(full) and name.lower().endswith(MD_EXTENSIONS):
                entries.append({"name": name, "path": full, "isDir": False})
    except OSError:
        return []
    entries.sort(key=lambda x: (not x["isDir"], x["name"].lower()))
    return entries


def _stream_anthropic(api_key, model, system_prompt, messages, push_fn):
    try:
        client = _anthropic.Anthropic(api_key=api_key)
        with client.messages.stream(
            model=model,
            max_tokens=4096,
            system=system_prompt,
            messages=messages,
        ) as stream:
            for chunk in stream.text_stream:
                push_fn(f"window.__chatChunk({json.dumps(chunk)})")
        push_fn("window.__chatDone()")
    except Exception as e:
        err_type = type(e).__name__
        if "AuthenticationError" in err_type:
            msg = "Authentication failed. Check your API key in Settings."
        elif "RateLimitError" in err_type:
            msg = "Rate limit reached. Please wait a moment and try again."
        elif "APIConnectionError" in err_type:
            msg = "Connection error. Check your internet connection."
        else:
            msg = str(e)
        push_fn(f"window.__chatError({json.dumps(msg)})")


def _stream_openai(api_key, model, system_prompt, messages, push_fn):
    try:
        client = _openai.OpenAI(api_key=api_key)
        stream = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system_prompt}] + messages,
            stream=True,
        )
        for chunk in stream:
            content = chunk.choices[0].delta.content if chunk.choices else None
            if content is not None:
                push_fn(f"window.__chatChunk({json.dumps(content)})")
        push_fn("window.__chatDone()")
    except Exception as e:
        err_type = type(e).__name__
        if "AuthenticationError" in err_type:
            msg = "Authentication failed. Check your API key in Settings."
        elif "RateLimitError" in err_type:
            msg = "Rate limit reached. Please wait a moment and try again."
        elif "APIConnectionError" in err_type or "connect" in str(e).lower():
            msg = "Connection error. Check your internet connection."
        else:
            msg = str(e)
        push_fn(f"window.__chatError({json.dumps(msg)})")


def _stream_gemini(api_key, model, system_prompt, messages, push_fn):
    try:
        client = _genai.Client(api_key=api_key)
        gemini_messages = []
        for m in messages:
            role = "model" if m["role"] == "assistant" else m["role"]
            gemini_messages.append({"role": role, "parts": [{"text": m["content"]}]})
        config = GenerateContentConfig(
            system_instruction=system_prompt,
            max_output_tokens=4096,
        )
        for chunk in client.models.generate_content_stream(
            model=model,
            contents=gemini_messages,
            config=config,
        ):
            if chunk.text:
                push_fn(f"window.__chatChunk({json.dumps(chunk.text)})")
        push_fn("window.__chatDone()")
    except Exception as e:
        push_fn(f"window.__chatError({json.dumps(str(e))})")


def _stream_ollama(model, system_prompt, messages, base_url, push_fn):
    try:
        client = _openai.OpenAI(api_key="ollama", base_url=f"{base_url}/v1")
        stream = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system_prompt}] + messages,
            stream=True,
        )
        for chunk in stream:
            content = chunk.choices[0].delta.content if chunk.choices else None
            if content is not None:
                push_fn(f"window.__chatChunk({json.dumps(content)})")
        push_fn("window.__chatDone()")
    except Exception as e:
        err_str = str(e)
        if "connect" in err_str.lower() or "connection" in err_str.lower():
            msg = f"Ollama not running at {base_url}. Start it with `ollama serve`."
        else:
            msg = err_str
        push_fn(f"window.__chatError({json.dumps(msg)})")


class Api:
    def __init__(self, window):
        self._window = window  # use private name so it's less likely to be introspected

    def open_file(self):
        """Pick a markdown file; returns root (parent dir), path, content (or error)."""
        result = self._window.create_file_dialog(
            _FILE_DIALOG_OPEN,
            allow_multiple=False,
            file_types=("Markdown files (*.md;*.markdown)", "All files (*.*)"),
        )
        if not result or not result[0]:
            return None
        path = result[0]
        root = os.path.dirname(path)
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except Exception as e:
            return {"root": root, "path": path, "content": None, "error": str(e)}
        return {"root": root, "path": path, "content": content}

    def open_folder(self):
        """Pick a folder; returns root path. Tree will list only dirs and .md/.markdown under it."""
        if _FILE_DIALOG_FOLDER is None:
            return {"root": None, "error": "Folder dialog not supported in this version."}
        try:
            result = self._window.create_file_dialog(_FILE_DIALOG_FOLDER, allow_multiple=False)
        except Exception as e:
            return {"root": None, "error": str(e)}
        if not result or not result[0]:
            return None
        root = result[0]
        if not os.path.isdir(root):
            return {"root": None, "error": "Not a directory."}
        return {"root": root}

    def list_dir(self, dir_path):
        """List dir_path: only subdirs and .md/.markdown files. Returns list of {name, path, isDir}."""
        if not dir_path or not os.path.isabs(dir_path):
            return {"entries": [], "error": "Invalid path."}
        return {"entries": _list_dir_md_only(dir_path)}

    def read_file(self, path):
        """Read a markdown file and return content."""
        if not path or not os.path.isfile(path):
            return {"path": path, "content": None, "error": "File not found."}
        if not path.lower().endswith(MD_EXTENSIONS):
            return {"path": path, "content": None, "error": "Not a markdown file."}
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                return {"path": path, "content": f.read()}
        except Exception as e:
            return {"path": path, "content": None, "error": str(e)}

    def write_file(self, path, content):
        """Write content to a markdown file. Returns { path, error? }."""
        if not path:
            return {"path": path, "error": "No path."}
        if not path.lower().endswith(MD_EXTENSIONS):
            return {"path": path, "error": "Not a markdown file."}
        try:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(content)
            return {"path": path}
        except Exception as e:
            return {"path": path, "error": str(e)}

    def create_file(self, folder_path, filename):
        """Create a new markdown file in folder_path. Returns { path, content, error? }."""
        if not folder_path or not os.path.isdir(folder_path) or not os.path.isabs(folder_path):
            return {"path": None, "content": None, "error": "Invalid or missing folder."}
        filename = (filename or "").strip() or "Untitled.md"
        if not filename.lower().endswith(MD_EXTENSIONS):
            filename = filename.rstrip(".") + ".md"
        filename = os.path.basename(filename)
        if not filename:
            return {"path": None, "content": None, "error": "Invalid filename."}
        path = os.path.join(folder_path, filename)
        if os.path.isfile(path):
            base, ext = os.path.splitext(filename)
            for n in range(1, 1000):
                path = os.path.join(folder_path, f"{base} {n}{ext}")
                if not os.path.isfile(path):
                    filename = os.path.basename(path)
                    break
            else:
                return {"path": None, "content": None, "error": "Could not generate unique filename."}
        content = ""
        try:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(content)
            return {"path": path, "content": content}
        except Exception as e:
            return {"path": path, "content": None, "error": str(e)}

    def save_image(self, md_file_path, filename, base64_content):
        """Save an image file next to the given markdown file. Returns { path, name } or { error }."""
        if not md_file_path or not os.path.isfile(md_file_path):
            return {"error": "No open file or file not found."}
        folder = os.path.dirname(md_file_path)
        if not os.path.isdir(folder):
            return {"error": "Invalid folder."}
        # Keep only safe filename: alphanumeric, dash, underscore, dot; preserve extension
        base_name = (filename or "image").strip() or "image"
        base_name = re.sub(r"[^\w\-.]", "_", base_name)
        if not base_name:
            base_name = "image"
        name, ext = os.path.splitext(base_name)
        if not ext or ext.lower() not in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"):
            ext = ".png"
        filename = name + ext
        path = os.path.join(folder, filename)
        if os.path.isfile(path):
            for n in range(1, 1000):
                path = os.path.join(folder, f"{name}_{n}{ext}")
                if not os.path.isfile(path):
                    filename = os.path.basename(path)
                    break
            else:
                return {"error": "Could not generate unique filename."}
        try:
            raw = base64.b64decode(base64_content, validate=True)
        except Exception as e:
            return {"error": f"Invalid image data: {e}"}
        try:
            with open(path, "wb") as f:
                f.write(raw)
            return {"path": path, "name": os.path.basename(path)}
        except Exception as e:
            return {"path": path, "error": str(e)}

    def delete_file(self, path):
        """Delete a markdown file. Returns { success, error? }."""
        if not path or not os.path.isfile(path):
            return {"success": False, "error": "File not found."}
        if not path.lower().endswith(MD_EXTENSIONS):
            return {"success": False, "error": "Not a markdown file."}
        try:
            os.remove(path)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_welcome(self):
        """Return the bundled Welcome.md content for the default startup view. Returns None if not found."""
        path = os.path.join(BASE_DIR, "Welcome.md")
        if not os.path.isfile(path):
            return None
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                return {"path": path, "content": f.read()}
        except Exception:
            return None

    def save_as(self, suggested_name):
        """Open a Save As dialog and return the chosen path, or None if cancelled."""
        try:
            result = self._window.create_file_dialog(
                _FILE_DIALOG_SAVE,
                save_filename=suggested_name or "Untitled.md",
                file_types=("Markdown files (*.md;*.markdown)", "All files (*.*)"),
            )
            if not result:
                return None
            path = result if isinstance(result, str) else (result[0] if result else None)
            if not path:
                return None
            if not path.lower().endswith(MD_EXTENSIONS):
                path = path.rstrip(".") + ".md"
            return {"path": path}
        except Exception as e:
            return {"error": str(e)}

    def toggle_fullscreen(self):
        """Toggle native window fullscreen (hides title bar and OS menu). Used by focus mode."""
        try:
            self._window.toggle_fullscreen()
        except Exception:
            pass

    def _settings_path(self):
        if getattr(sys, 'frozen', False):
            base = _user_data_dir()
            os.makedirs(base, exist_ok=True)
        else:
            base = BASE_DIR
        return os.path.join(base, "settings.json")

    def load_settings(self):
        """Load all persisted settings. Returns a dict (empty if none saved)."""
        try:
            with open(self._settings_path(), "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def save_setting(self, key, value):
        """Persist a single setting by key."""
        try:
            path = self._settings_path()
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = {}
            data[key] = value
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── Multi-provider API key management ────────────────────────────────────

    def save_provider_api_key(self, provider, key):
        """Store an API key for a given provider in OS keychain. Returns {ok: bool, error?}."""
        if provider not in _KEYRING_USERNAMES:
            return {"ok": False, "error": f"Unknown provider: {provider}"}
        if not _KEYRING_AVAILABLE:
            return {"ok": False, "error": "keyring package not available"}
        try:
            _keyring.set_password(_KEYRING_SERVICE, _KEYRING_USERNAMES[provider], key)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_provider_api_key_status(self, provider):
        """Returns {has_key: bool} for the given provider — never exposes the key value."""
        if provider not in _KEYRING_USERNAMES:
            return {"has_key": False}
        if not _KEYRING_AVAILABLE:
            return {"has_key": False}
        try:
            val = _keyring.get_password(_KEYRING_SERVICE, _KEYRING_USERNAMES[provider])
            return {"has_key": bool(val)}
        except Exception:
            return {"has_key": False}

    def delete_provider_api_key(self, provider):
        """Remove API key for a given provider from OS keychain. Returns {ok: bool}."""
        if provider not in _KEYRING_USERNAMES:
            return {"ok": False, "error": f"Unknown provider: {provider}"}
        if not _KEYRING_AVAILABLE:
            return {"ok": False, "error": "keyring package not available"}
        try:
            _keyring.delete_password(_KEYRING_SERVICE, _KEYRING_USERNAMES[provider])
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def list_ollama_models(self):
        """Fetch available models from a running Ollama instance. Returns {models: [...], error?}."""
        settings = self.load_settings()
        base_url = settings.get("ollamaBaseUrl", "http://localhost:11434")
        try:
            req = urllib.request.Request(f"{base_url}/api/tags")
            with urllib.request.urlopen(req, timeout=2) as resp:
                data = json.loads(resp.read())
            models = [m["name"] for m in data.get("models", [])]
            return {"models": models}
        except urllib.error.URLError as e:
            return {"models": [], "error": str(e)}
        except Exception as e:
            return {"models": [], "error": str(e)}

    # ── Legacy Anthropic-only API key management (backward compat) ────────────

    def save_api_key(self, key):
        """Store Anthropic API key in OS keychain. Returns {ok: bool, error?}."""
        if not _KEYRING_AVAILABLE:
            return {"ok": False, "error": "keyring package not available"}
        try:
            _keyring.set_password(_KEYRING_SERVICE, _KEYRING_USERNAME, key)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_api_key_status(self):
        """Returns {has_key: bool} — never exposes the key value."""
        if not _KEYRING_AVAILABLE:
            return {"has_key": False}
        try:
            val = _keyring.get_password(_KEYRING_SERVICE, _KEYRING_USERNAME)
            return {"has_key": bool(val)}
        except Exception:
            return {"has_key": False}

    def delete_api_key(self):
        """Remove API key from OS keychain. Returns {ok: bool}."""
        if not _KEYRING_AVAILABLE:
            return {"ok": False, "error": "keyring package not available"}
        try:
            _keyring.delete_password(_KEYRING_SERVICE, _KEYRING_USERNAME)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def chat(self, messages, file_contexts):
        """Start a streaming AI chat in a background thread. Returns {ok: True} immediately."""
        settings = self.load_settings()
        provider = settings.get("llmProvider", "anthropic")
        model    = settings.get("llmModel", "claude-sonnet-4-6")
        system_prompt = _build_system_prompt(file_contexts or [])
        push_fn = self._push_js

        def _get_key(p):
            if not _KEYRING_AVAILABLE:
                return None
            try:
                return _keyring.get_password(_KEYRING_SERVICE, _KEYRING_USERNAMES[p])
            except Exception:
                return None

        if provider == "anthropic":
            if not _ANTHROPIC_AVAILABLE:
                return {"ok": False, "error": "anthropic package not available"}
            api_key = _get_key("anthropic")
            if not api_key:
                return {"ok": False, "error": "no_api_key"}
            t = threading.Thread(
                target=lambda: _stream_anthropic(api_key, model, system_prompt, messages, push_fn),
                daemon=True)
        elif provider == "openai":
            if not _OPENAI_AVAILABLE:
                return {"ok": False, "error": "openai package not available"}
            api_key = _get_key("openai")
            if not api_key:
                return {"ok": False, "error": "no_api_key"}
            t = threading.Thread(
                target=lambda: _stream_openai(api_key, model, system_prompt, messages, push_fn),
                daemon=True)
        elif provider == "gemini":
            if not _GENAI_AVAILABLE:
                return {"ok": False, "error": "google-genai package not available"}
            api_key = _get_key("gemini")
            if not api_key:
                return {"ok": False, "error": "no_api_key"}
            t = threading.Thread(
                target=lambda: _stream_gemini(api_key, model, system_prompt, messages, push_fn),
                daemon=True)
        elif provider == "ollama":
            if not _OPENAI_AVAILABLE:
                return {"ok": False, "error": "openai package not available (required for Ollama)"}
            base_url = settings.get("ollamaBaseUrl", "http://localhost:11434")
            t = threading.Thread(
                target=lambda: _stream_ollama(model, system_prompt, messages, base_url, push_fn),
                daemon=True)
        else:
            return {"ok": False, "error": f"Unknown provider: {provider}"}

        t.start()
        return {"ok": True}

    def _push_js(self, js_string):
        """Evaluate JS in the window; silently ignore if window is gone."""
        try:
            self._window.evaluate_js(js_string)
        except Exception:
            pass


def main():
    if os.name == "nt":
        sys.stderr = StderrFilter(sys.__stderr__)

    # DevTools: set PYWEBVIEW_DEBUG=1 or run with --debug. Port must be set before create_window.
    debug = os.environ.get("PYWEBVIEW_DEBUG", "").strip().lower() in ("1", "true", "yes") or "--debug" in sys.argv
    if debug:
        webview.settings["REMOTE_DEBUGGING_PORT"] = 9222
        webview.settings["OPEN_DEVTOOLS_IN_DEBUG"] = False

    api = Api(None)
    window = webview.create_window(
        "Inkwave",
        os.path.join(BASE_DIR, "index.html"),
        width=1200,
        height=800,
        min_size=(500, 400),
        js_api=api,
    )
    object.__setattr__(api, "_window", window)

    def inject_welcome():
        try:
            data = api.get_welcome()
            if data and data.get("content") is not None:
                arg = json.dumps(data)
                window.evaluate_js(
                    "if (window.__applyWelcome) window.__applyWelcome(" + json.dumps(arg) + ");"
                )
        except Exception:
            pass

    def inject_settings():
        try:
            settings = api.load_settings()
            arg = json.dumps(settings)
            window.evaluate_js(
                "if (window.__applySettings) window.__applySettings(" + json.dumps(arg) + ");"
            )
        except Exception:
            pass

    try:
        window.events.loaded += inject_welcome
        window.events.loaded += inject_settings
    except Exception:
        pass

    start_kw = {"debug": debug}
    if debug:
        print("DevTools: In Edge or Chrome open edge://inspect or chrome://inspect")
        print("          Click 'Configure' under 'Discover network targets' and add: localhost:9222")
        print("          Then the app should appear there; click 'Inspect' to open DevTools.")
    if os.name == "nt":
        start_kw["gui"] = "edgechromium"
    webview.start(**start_kw)


if __name__ == "__main__":
    main()
