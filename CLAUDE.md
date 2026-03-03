# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Inkwave is a desktop Markdown reader/editor app. Python (`app.py`) launches a native OS webview window (via pywebview) pointed at `index.html`. There is no server, no build step, and no bundler — just Python and vanilla JS.

## Running the App

```bash
# One-time setup
pip install -r requirements.txt

# Run normally
python app.py

# Run with DevTools (connects via edge://inspect or chrome://inspect → localhost:9222)
python app.py --debug
# or: PYWEBVIEW_DEBUG=1 python app.py
```

There are no tests and no linting configuration.

## Architecture

### Python ↔ JavaScript Bridge

`app.py` defines an `Api` class whose public methods are exposed to the browser as `window.pywebview.api.*`. JS calls these async methods via `getApi()` (a guard that returns `window.pywebview.api` once pywebview is ready). The bridge fires a `pywebviewready` DOM event when ready.

**Python API methods** (all file I/O goes through these, never directly in JS):
- `open_file()` — file picker, returns `{root, path, content}`
- `open_folder()` — folder picker, returns `{root}`
- `list_dir(dir_path)` — returns `{entries: [{name, path, isDir}]}`
- `read_file(path)` — returns `{path, content}`
- `write_file(path, content)` — returns `{path}`
- `create_file(folder_path, filename)` — returns `{path, content}`
- `save_image(md_file_path, filename, base64_content)` — saves a dropped image alongside the markdown file, returns `{name}`
- `save_as(suggested_name)` — save-as dialog, returns `{path}`
- `delete_file(path)` — returns `{success}`
- `get_welcome()` — returns bundled `Welcome.md` content
- `load_settings()` — returns persisted settings as a JSON string
- `save_setting(key, value)` — persists a single setting key/value
- `toggle_fullscreen()` — toggles native window fullscreen

### Frontend (`js/`)

The UI is vanilla JS modules under `js/`. Entry point is `js/main.js` (loaded by `index.html`). Import order: state → debug/api/utils/blocks/caret → tabs/fileio → editor (before renderer, so inline-edit keydown runs first) → renderer → filetree/ui/toc/vim/settings/init. Key concepts:

- **Tabs**: each open file is a tab (`tabs` array, `activeTabId`). Tab state holds `path`, `blocks`, and edit state.
- **Blocks**: content is parsed into an array of block objects (`getBlocks()`). Each block has `{type, raw}`. Types include `heading`, `paragraph`, `code`, `list-item`, `blockquote`, `hr`, `blank`.
- **Inline editing**: double-clicking a rendered block switches it to a contenteditable `<div>`. On blur/Enter, edits are committed back to the blocks array and saved. List items get special handling for their markers.
- **Autosave**: edits are autosaved to disk via `write_file` after each committed change.
- **File tree**: sidebar renders a lazy-loading tree of dirs and `.md`/`.markdown` files using `list_dir`. Tree state (expanded folders) is tracked in `loadedChildren` Map.
- **Themes**: 13 CSS themes selected via a custom dropdown (button + `<ul>` list). The active theme is stored as a `data-theme` attribute on `<body>` and persisted via `save_setting`.
- **Vim mode**: optional vim keybindings toggled in Settings. Block mode uses a fake blinking cursor div over browser Selection; raw mode uses a full `VimSession` class on the textarea. Shared yank register between both modes.
- **Raw mode**: toggle renders the full file as a `<textarea>` instead of parsed blocks.
- **Table of contents**: TOC panel slides in from the right, populated from heading blocks in the current content.

### CSS (`style.css`)

All theming uses CSS custom properties (`--bg`, `--text`, `--accent`, `--toolbar-bg`, `--border`, `--code-bg`, `--btn-text`, etc.) set per theme via `body[data-theme="..."]` selectors.

### Python Platform Notes

- On Windows, pywebview uses Edge (WebView2): `PYWEBVIEW_GUI=edgechromium` is set before importing webview.
- `StderrFilter` in `app.py` suppresses known noisy pywebview/WinForms log spam on Windows.

## Key Files

| File | Purpose |
|------|---------|
| `app.py` | Python entry point; pywebview window creation; `Api` class for all file I/O |
| `index.html` | App shell; loads CDN scripts (marked.js, highlight.js) and `js/main.js` |
| `js/main.js` | Entry point; imports all modules in dependency order |
| `js/state.js` | Mutable shared state, DOM element refs, SVG icons, callback slots for circular-dep breaking |
| `js/editor.js` | Inline block editing: `startInlineEdit`, Enter/blur commit, keydown handlers |
| `js/renderer.js` | `showTabContent` (block render), `showWelcomeOrEmpty`, image resize wiring |
| `js/vim.js` | Vim keybindings: block-mode nav/commands + `VimSession` class for raw textarea |
| `js/ui.js` | Theme picker, focus mode, toolbar buttons, drag-and-drop, global keyboard shortcuts |
| `js/toc.js` | Table of contents panel: heading extraction, render, toggle |
| `js/settings.js` | Settings modal: vim mode toggle, persisted settings load/save |
| `js/blocks.js` | `getBlocks`, `blocksToContent`, block type helpers |
| `js/tabs.js` | Tab CRUD, `renderTabBar`, `getActiveTab` |
| `js/filetree.js` | File tree: lazy-loading dir expansion, file open/select/create/delete |
| `js/fileio.js` | `saveToFile`, `saveOrSaveAs`, `flushActiveEditAndSave` |
| `js/init.js` | `loadWelcome`, `whenApiReady`, `window.__applySettings`/`__applyWelcome` hooks |
| `style.css` | All styles and theme definitions via CSS custom properties |
| `Welcome.md` | Bundled welcome screen content, loaded by `get_welcome()` at startup |
| `requirements.txt` | Single dependency: `pywebview>=4.0` |

## Debugging

- Press `Ctrl+Shift+D` in the running app to toggle the in-UI debug log panel.
- The `dbg()` function in `js/debug.js` logs to both console and the debug panel (only when `DEBUG_ENTER = true` or toggled).
- Remote DevTools: run with `--debug`, then open `edge://inspect` or `chrome://inspect` → Configure → `localhost:9222`.
