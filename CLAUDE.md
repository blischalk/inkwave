# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Inkwave is a desktop Markdown reader/editor app. Python (`app.py`) launches a native OS webview window (via pywebview) pointed at `index.html`. There is no server, no build step, and no bundler — just Python and vanilla JS.

## Running Tests

Always run the full test suite before and after making changes. Both suites must pass before a task is considered complete.

```bash
# Python unit + integration tests
pytest tests/python/ --cov=app --cov-report=term-missing -v

# JavaScript unit tests
npx vitest run --coverage
```

### Coverage policy

- **All new code must have 100% branch coverage** in the test tier appropriate to its type:
  - New pure/logic functions (Python helpers, JS pure functions): unit tests in the relevant test file.
  - New Python `Api` methods: integration tests in `tests/python/test_api.py` using `tmp_path`.
  - New DOM-heavy JS functions: cover extractable logic with unit tests; add jsdom integration tests for the DOM interaction paths.
- Existing DOM-heavy modules (renderer, editor, vim, filetree, ui) are not retroactively required to hit 100%; improve coverage incrementally when those files are modified.

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
- `delete_file(path)` — returns `{success}`
- `get_welcome()` — returns bundled `Welcome.md` content
- `toggle_fullscreen()` — toggles native window fullscreen

### Frontend (`js/`)

The UI is vanilla JS modules under `js/`. Entry point is `js/main.js` (loaded by `index.html`). Import order: state → debug/api/utils/blocks/caret → tabs/fileio → renderer/editor → filetree/ui/init. Key concepts:

- **Tabs**: each open file is a tab (`tabs` array, `activeTabId`). Tab state holds `path`, `blocks`, and edit state.
- **Blocks**: content is parsed into an array of block objects (`getBlocks()`). Each block has `{type, raw}`. Types include `heading`, `paragraph`, `code`, `list-item`, `blockquote`, `hr`, `blank`.
- **Inline editing**: clicking a rendered block switches it to a contenteditable `<div>`. On blur/Enter, edits are committed back to the blocks array and saved. List items get special handling for their markers.
- **Autosave**: edits are autosaved to disk via `write_file` after each committed change.
- **File tree**: sidebar renders a lazy-loading tree of dirs and `.md`/`.markdown` files using `list_dir`. Tree state (expanded folders) is tracked in `loadedChildren` Map.
- **Themes**: 12 CSS themes toggled via `<select>`. The active theme is stored as a `data-theme` attribute on `<body>` and persisted in `localStorage`.

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
| `js/main.js` | Entry point; imports state, api, blocks, tabs, fileio, renderer, editor, filetree, ui, init |
| `style.css` | All styles and theme definitions via CSS custom properties |
| `Welcome.md` | Bundled welcome screen content, loaded by `get_welcome()` at startup |
| `requirements.txt` | Single dependency: `pywebview>=4.0` |

## Debugging

- Press `Ctrl+Shift+D` in the running app to toggle the in-UI debug log panel.
- The `dbg()` function in `js/debug.js` logs to both console and the debug panel (only when `DEBUG_ENTER = true` or toggled).
- Remote DevTools: run with `--debug`, then open `edge://inspect` or `chrome://inspect` → Configure → `localhost:9222`.

---

## Code Quality

Follow Uncle Bob's Clean Code principles and Sandi Metz's TRUE heuristics (Transparent, Reasonable, Usable, Exemplary).

## Design Principles

- **Single Responsibility**: every module and function does one thing
- **Composability**: prefer small, focused pieces that combine cleanly
- **Loose coupling**: JS modules depend on exported interfaces, not internal details of other modules
- **High cohesion**: keep related behaviour together in the same module

## Style

- Readability wins over terse code
- Self-documenting names — no abbreviations
- Boolean variables/functions use the `is_` prefix (e.g. `is_editing`, `is_split_active`)
- If a comment is needed to explain what a function does, extract it into a named function instead
- No multi-line comment blocks; one short inline comment max when the WHY is non-obvious

## Functions

- Each function does one thing
- Extract helper functions freely; name them to reveal intent
- Keep parameter lists short; prefer an options object when more than three parameters are needed

## Testing

- Inkwave currently has no test suite; new features with non-trivial logic should be accompanied by tests when feasible
- Test behaviour, not implementation details
- For Python (`app.py` Api methods): use `pytest` with `tmp_path` fixtures for file I/O tests
- For JS: use a browser-compatible test runner (e.g. Vitest) if a suite is introduced; stub the pywebview bridge at the `getApi()` boundary rather than mocking internals

## Abstractions

- No over-engineering
- No speculative abstractions — only abstract when you have two or more concrete cases
- Remove dead code; do not keep backwards-compatibility hacks or unused exports

## Error Handling

- Validate at system boundaries only: the Python `Api` class methods and any external data arriving via the pywebview bridge
- Python: raise specific built-in exceptions (`ValueError`, `FileNotFoundError`, `PermissionError`) at I/O boundaries; let them propagate rather than swallowing silently
- JS: always attach `.catch()` or `try/catch` to every `await getApi().*` call; surface errors to the user via `showError()` (`js/utils.js`) rather than silently failing
- Never use bare `catch (e) {}` — swallowed errors hide bugs

## Security

Write all new code with the mindset of a principal security engineer. The principles below apply to every change, not just security-focused work.

**XSS / HTML injection**
- Never set `innerHTML` from untrusted content without sanitisation. User-controlled strings must be escaped with `escapeHtml()` (`js/utils.js`) before being inserted into the DOM.
- Do not pass raw user-supplied HTML through `marked.js` unless the user has explicitly opted in to HTML rendering.
- Never use `eval()`, `new Function()`, or `setTimeout(string)`.

**Path traversal**
- Python `Api` file operations must resolve paths with `os.path.realpath()` and confirm they fall within the user's chosen root before performing any I/O.
- Never build file paths by concatenating user input without normalisation.

**Prototype pollution**
- Never merge untrusted objects onto shared state or `Object.prototype`. Use `Map` or `Object.create(null)` for dictionary-style data.

**Least privilege**
- The `Api` class must never expose shell execution: no `subprocess`, `os.system`, or `eval` in `app.py`.
- Derive file paths from explicit user picker selections, not from programmatic construction using untrusted input.

**Input validation discipline**
- Treat all data crossing the pywebview bridge (JS → Python and Python → JS) as untrusted. Validate types and ranges at the boundary before use.

**Dependency hygiene**
- Pin `requirements.txt` to exact versions. Verify CDN script integrity via SRI `integrity` attributes on `<script>` tags. Review dependency versions when upgrading.