// Line-number gutter + current-line highlight for the raw-markdown textarea.
//
// Scope: raw mode only (`js/renderer.js` creates the textarea with
// class="raw-editor" only when `rawMode` is true). This module never touches
// the WYSIWYG block editor.
//
// Node identity: this module wraps the EXISTING textarea in a new
// `.raw-editor-wrap` container; it never replaces or clones the textarea.
// Vim mode (`js/vim.js`) keys its session WeakMap by the textarea node
// itself and `js/settings.js` re-finds it via `contentEl.querySelector(".raw-editor")`
// — both keep working because the textarea keeps its class and keeps being
// the same DOM node, only its parent changes (contentEl -> .raw-editor-wrap -> textarea).
//
// Soft-wrap handling: a <textarea> wraps long logical lines across multiple
// visual rows with no native API exposing per-line pixel height. We measure
// each logical line's rendered height with a hidden mirror element that
// exactly matches the textarea's text-rendering metrics (same technique as
// `scrollRawCursorIntoView` in js/vim.js), then stack line-number markers at
// the accumulated top offset of each logical line's first visual row.
//
// Line-ending format: `fileio.js` has no CRLF handling anywhere (confirmed
// via grep) — content loaded/saved is plain "\n"-delimited text, so
// `value.split("\n")` is correct without additional normalization.

const sessions = new WeakMap();

// Deliberately does NOT include "scroll": onScroll (below) already syncs
// gutter.scrollTop to textarea.scrollTop on every scroll frame, which is
// the only thing that needs to happen on scroll — scrolling never changes
// content or wrap positions. recompute() does a full gutter rebuild with a
// forced synchronous layout reflow per line; running it on every scroll
// frame would cause severe jank on any document with more than a few dozen
// lines. (Code review finding F1, 2026-10-15.)
const RECOMPUTE_EVENTS = ["input"];
// Deliberately does NOT include "selectionchange" as a textarea-level
// listener: `selectionchange` historically fires on `document`, not on
// individual elements — per-element support only landed in Chrome 87
// (2020) / Firefox 92 (2021) / Safari 15.4 (2022), so attaching it directly
// to the textarea would silently never fire in some WebView/WKWebView
// builds. The document-level listener added in attachGutter below (which
// checks document.activeElement) is the compatible way to catch
// programmatic selection changes that aren't covered by keyup/click.
// (Code review finding F2, 2026-10-15.)
const CURRENT_LINE_EVENTS = ["keyup", "click"];

/** Build (or reuse) the hidden mirror element used to measure line heights. */
function getMirror(textarea) {
  let mirror = sessions.get(textarea)?.mirror;
  if (mirror && document.body.contains(mirror)) return mirror;
  mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  const s = mirror.style;
  s.position = "absolute";
  s.left = "-9999px";
  s.top = "0";
  s.visibility = "hidden";
  s.whiteSpace = "pre-wrap";
  s.wordWrap = "break-word";
  s.overflow = "hidden";
  s.boxSizing = "border-box";
  document.body.appendChild(mirror);
  return mirror;
}

function syncMirrorMetrics(mirror, textarea) {
  const style = getComputedStyle(textarea);
  mirror.style.width = textarea.clientWidth + "px";
  mirror.style.font = style.font;
  mirror.style.fontSize = style.fontSize;
  mirror.style.lineHeight = style.lineHeight;
  // Code review finding (2026-10-15): any of these properties can shift
  // where a monospace editor theme soft-wraps text. If the mirror doesn't
  // match the textarea on all of them, wrapped-line height measurements
  // (and therefore gutter marker positions) silently drift. Currently
  // latent — style.css's .raw-editor rule doesn't set any of these
  // explicitly — but a real gap for any future theme/CSS change.
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.wordSpacing = style.wordSpacing;
  mirror.style.tabSize = style.tabSize;
  mirror.style.textIndent = style.textIndent;
  mirror.style.wordBreak = style.wordBreak;
  mirror.style.overflowWrap = style.overflowWrap;
  mirror.style.padding = style.padding;
  // borderWidth intentionally omitted: the mirror never sets borderStyle,
  // so its computed border always resolves to 0 regardless of this value;
  // width is set from clientWidth (which already excludes the textarea's
  // own border box), so no adjustment is needed either way.
}

/** Line index (0-based) containing the caret, computed from selectionStart. */
export function currentLineIndex(textarea) {
  const pos = textarea.selectionStart;
  const value = textarea.value || "";
  const upToCaret = value.slice(0, Math.max(0, Math.min(pos, value.length)));
  return upToCaret.split("\n").length - 1;
}

/** Recompute gutter line-number markers and their vertical offsets. */
function recompute(textarea, gutter) {
  const value = textarea.value || "";
  const lines = value.split("\n");
  const mirror = getMirror(textarea);
  syncMirrorMetrics(mirror, textarea);

  gutter.innerHTML = "";
  const style = getComputedStyle(textarea);
  const paddingTop = parseFloat(style.paddingTop) || 0;

  let accumulatedHeight = 0;
  const markers = [];
  for (let i = 0; i < lines.length; i++) {
    // Measure this single logical line's rendered (possibly wrapped) height
    // BEFORE placing the marker, so the marker's background band (used for
    // the current-line highlight) can span the line's full wrapped height,
    // not just one row.
    mirror.textContent = lines[i] === "" ? "\u00A0" : lines[i];
    const h = mirror.getBoundingClientRect().height;

    const marker = document.createElement("div");
    marker.className = "raw-editor-line-number";
    marker.textContent = String(i + 1);
    marker.style.top = accumulatedHeight + paddingTop + "px";
    marker.style.height = h + "px";
    gutter.appendChild(marker);
    markers.push(marker);

    accumulatedHeight += h;
  }

  gutter.scrollTop = textarea.scrollTop;
  highlightCurrentLine(textarea, gutter, markers);
}

function highlightCurrentLine(textarea, gutter, markers) {
  const list = markers || Array.from(gutter.querySelectorAll(".raw-editor-line-number"));
  const idx = currentLineIndex(textarea);
  for (let i = 0; i < list.length; i++) {
    list[i].classList.toggle("raw-editor-current-line", i === idx);
  }
}

/**
 * Wrap `textarea` with a line-number gutter and wire scroll/edit/caret
 * listeners to keep it in sync. Safe to call at most once per textarea
 * (idempotent no-op on repeat calls, mirroring applyVimMode's guard).
 */
export function attachGutter(textarea) {
  if (sessions.has(textarea)) return;
  if (!textarea || !textarea.parentNode) return;

  const wrap = document.createElement("div");
  wrap.className = "raw-editor-wrap";
  const gutter = document.createElement("div");
  gutter.className = "raw-editor-gutter";
  gutter.setAttribute("aria-hidden", "true");

  const parent = textarea.parentNode;
  parent.insertBefore(wrap, textarea);
  wrap.appendChild(gutter);
  wrap.appendChild(textarea); // moves the existing node; identity preserved

  let rafId = 0;
  const scheduleRecompute = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      recompute(textarea, gutter);
    });
  };
  // Code review finding (2026-10-15): exposed so detachGutter can cancel a
  // pending frame. Without this, calling detachGutter while a scheduled
  // recompute is still queued let that frame fire AFTER teardown — running
  // getBoundingClientRect()/getComputedStyle() against a gutter/mirror
  // already removed from the DOM, which silently returns zero-valued
  // layout data rather than throwing. No visible symptom (nothing is left
  // on screen to mis-render), but wasted work and a latent correctness gap
  // in the teardown contract.
  const cancelPendingRaf = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };
  const scheduleHighlightOnly = () => {
    highlightCurrentLine(textarea, gutter);
  };
  const onScroll = () => {
    gutter.scrollTop = textarea.scrollTop;
  };
  // document-level selectionchange: catches caret moves that keyup/click
  // miss (e.g. held-arrow-key repeats, IME composition, programmatic
  // setSelectionRange calls from Vim mode). Filtered by activeElement so
  // selection changes elsewhere on the page don't trigger this textarea's
  // highlight recompute.
  const onSelectionChange = () => {
    if (document.activeElement === textarea) highlightCurrentLine(textarea, gutter);
  };
  // Soft-wrap positions depend on textarea.clientWidth. No input/scroll
  // event fires when the textarea is resized by a window resize, a split-
  // pane divider drag, or (if ever made resizable) a drag handle — without
  // this, the gutter would silently go stale until the next keystroke.
  // Feature-detected: supported in real pywebview WebKitGTK/WKWebView and
  // Chromium; absent in jsdom (unit tests), where recompute() still runs
  // correctly on every input/attach, just without resize-triggered refresh.
  const resizeObserver =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => scheduleRecompute()) : null;
  if (resizeObserver) resizeObserver.observe(textarea);

  RECOMPUTE_EVENTS.forEach((evt) => textarea.addEventListener(evt, scheduleRecompute));
  CURRENT_LINE_EVENTS.forEach((evt) => textarea.addEventListener(evt, scheduleHighlightOnly));
  textarea.addEventListener("scroll", onScroll);
  document.addEventListener("selectionchange", onSelectionChange);

  sessions.set(textarea, {
    wrap,
    gutter,
    mirror: getMirror(textarea),
    listeners: { scheduleRecompute, scheduleHighlightOnly, onScroll, onSelectionChange },
    resizeObserver,
    cancelPendingRaf,
  });

  recompute(textarea, gutter);
}

/** Reverse attachGutter: unwrap the textarea back to its original parent. */
export function detachGutter(textarea) {
  const session = sessions.get(textarea);
  if (!session) return;
  const { wrap, gutter, mirror, listeners, resizeObserver, cancelPendingRaf } = session;

  if (cancelPendingRaf) cancelPendingRaf();
  RECOMPUTE_EVENTS.forEach((evt) => textarea.removeEventListener(evt, listeners.scheduleRecompute));
  CURRENT_LINE_EVENTS.forEach((evt) => textarea.removeEventListener(evt, listeners.scheduleHighlightOnly));
  textarea.removeEventListener("scroll", listeners.onScroll);
  document.removeEventListener("selectionchange", listeners.onSelectionChange);
  if (resizeObserver) resizeObserver.disconnect();

  if (wrap && wrap.parentNode) {
    wrap.parentNode.insertBefore(textarea, wrap);
    wrap.parentNode.removeChild(wrap);
  }
  if (gutter && gutter.parentNode) gutter.parentNode.removeChild(gutter);
  if (mirror && mirror.parentNode) mirror.parentNode.removeChild(mirror);

  sessions.delete(textarea);
}
