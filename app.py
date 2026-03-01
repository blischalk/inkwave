"""
Inkwave - A simple desktop app to view markdown files rendered.
Uses PyWebView (system web view) and requires only: pip install pywebview
"""

import json
import os
import sys

# Prefer Edge (WebView2) on Windows to avoid WinForms/pythonnet errors.
# Must set before importing webview so the correct GUI backend is chosen.
if os.name == "nt":
    os.environ.setdefault("PYWEBVIEW_GUI", "edgechromium")

import webview

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
