# Inkwave

A small desktop app to open and view Markdown (`.md`) files in rendered form—headings, paragraphs, lists, code blocks, and links styled for easy reading.

## What you need

- **Python 3.8+** (install from [python.org](https://www.python.org/downloads/) if needed).
- **Windows**: WebView2 is usually already present on Windows 10/11. If the app asks for it, install from [Microsoft Edge WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

## Setup (one time)

```bash
pip install -r requirements.txt
```

## Run the app

```bash
python app.py
```

Click **Open file**, choose a `.md` or `.markdown` file, and it will be rendered in the window with proper typography and spacing.

## Tech

- **pywebview** – uses your system’s web view (no separate browser install).
- **marked.js** (loaded from CDN) – turns Markdown into HTML in the app.

No server, no Electron; just Python and one `pip` package.
