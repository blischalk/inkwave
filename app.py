"""
Markdown Reader - A simple desktop app to view markdown files rendered.
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
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# File dialog types (new API + fallbacks for older pywebview)
_file_dialog = getattr(webview, "FileDialog", None)
_FILE_DIALOG_OPEN = getattr(_file_dialog, "OPEN", None) if _file_dialog else None
if _FILE_DIALOG_OPEN is None:
    _FILE_DIALOG_OPEN = getattr(webview, "OPEN_DIALOG", 0)
_FILE_DIALOG_FOLDER = getattr(_file_dialog, "FOLDER", None) if _file_dialog else None
if _FILE_DIALOG_FOLDER is None:
    _FILE_DIALOG_FOLDER = getattr(webview, "FOLDER_DIALOG", 20)

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


def main():
    if os.name == "nt":
        sys.stderr = StderrFilter(sys.__stderr__)

    api = Api(None)
    window = webview.create_window(
        "Markdown Reader",
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

    try:
        window.events.loaded += inject_welcome
    except Exception:
        pass

    start_kw = {"debug": False}
    if os.name == "nt":
        start_kw["gui"] = "edgechromium"
    webview.start(**start_kw)


if __name__ == "__main__":
    main()
