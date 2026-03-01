// Vim-style keybindings.
//
// Block mode: a fake blinking cursor div is positioned over the Selection range.
//   h/j/k/l/w/b/0/$/G/gg move the logical Selection (invisible by itself in a
//   non-contenteditable div), then reposition the fake cursor to match.
//   i/a/A/I enter startInlineEdit at the cursor's pixel coords.
// Raw mode: full VimSession on the textarea.

import { vimMode, contentEl, onStartInlineEdit, currentBlocks, currentTabRef } from "./state.js";

// ── Status bar ─────────────────────────────────────────────────────────────────
function setStatus(text) {
  const el = document.getElementById("vimStatus");
  if (el) el.textContent = text;
}

// ── Fake visible cursor ────────────────────────────────────────────────────────
// The browser caret only blinks in editable elements.  We render our own.
// The cursor is position:absolute inside contentEl so its coordinates are in
// the same space as getBoundingClientRect() converted to content-relative.
// This avoids any fixed/viewport coordinate-system mismatch in WKWebView.
let fakeCursorEl = null;

function ensureFakeCursor() {
  if (!fakeCursorEl) {
    fakeCursorEl = document.createElement("div");
    fakeCursorEl.className = "vim-fake-cursor";
    fakeCursorEl.setAttribute("aria-hidden", "true");
  }
  // contentEl.innerHTML replacements destroy the cursor — always re-append.
  if (contentEl && fakeCursorEl.parentNode !== contentEl) {
    contentEl.appendChild(fakeCursorEl);
  } else if (!contentEl && fakeCursorEl.parentNode !== document.body) {
    document.body.appendChild(fakeCursorEl);
  }
  return fakeCursorEl;
}

function positionFakeCursor() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { hideFakeCursor(); return; }
  const range = sel.getRangeAt(0);
  const vRect = range.getBoundingClientRect(); // viewport-relative
  if (!vRect || vRect.height === 0) { hideFakeCursor(); return; }

  const el = ensureFakeCursor();

  if (contentEl) {
    // Convert viewport coords → content-element coords.
    // contentEl.scrollTop accounts for any scrolling within the content pane.
    const ceRect = contentEl.getBoundingClientRect();
    el.style.left   = (vRect.left - ceRect.left + contentEl.scrollLeft) + "px";
    el.style.top    = (vRect.top  - ceRect.top  + contentEl.scrollTop)  + "px";
  } else {
    el.style.left = vRect.left + "px";
    el.style.top  = vRect.top  + "px";
  }
  el.style.height  = vRect.height + "px";
  el.style.display = "block";
}

function hideFakeCursor() {
  if (fakeCursorEl) fakeCursorEl.style.display = "none";
}

function scrollToCursor() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !contentEl) return;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect || rect.height === 0) return;
  const cr  = contentEl.getBoundingClientRect();
  const pad = 60;
  if (rect.top < cr.top + pad) {
    contentEl.scrollBy({ top: rect.top - cr.top - pad });
  } else if (rect.bottom > cr.bottom - pad) {
    contentEl.scrollBy({ top: rect.bottom - cr.bottom + pad });
  }
}

// ── Block-mode helpers ─────────────────────────────────────────────────────────
let lastBlockIndex = 0;
let preferredX     = null; // column preserved across j/k runs
let blockNavPending = "";

function allBlocks() {
  return contentEl ? [...contentEl.querySelectorAll(".md-block")] : [];
}

function isInsertMode() {
  const active = document.activeElement;
  if (!active) return false;
  return active.classList.contains("inline-edit") ||
         !!(active.closest && active.closest(".md-block.editing"));
}

function getCurrentBlockIndex() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return -1;
  const node = sel.getRangeAt(0).startContainer;
  const el   = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const blk  = el && el.closest ? el.closest(".md-block") : null;
  if (!blk) return -1;
  const idx = parseInt(blk.getAttribute("data-block-index"), 10);
  return isNaN(idx) ? -1 : idx;
}

// ── Cursor placement helpers ───────────────────────────────────────────────────
function firstTextIn(el) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.textContent.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
  });
  return w.nextNode();
}

function applyRange(node, offset) {
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  const r = document.createRange();
  try { r.setStart(node, offset); r.collapse(true); sel.addRange(r); } catch (_) {}
}

function placeVimCursorAtBlock(blockIndex) {
  if (!contentEl) return;
  const blocks = allBlocks();
  if (!blocks.length) return;
  blockIndex = Math.max(0, Math.min(blockIndex, blocks.length - 1));
  const blockEl = blocks[blockIndex];
  const textNode = firstTextIn(blockEl);
  if (textNode) applyRange(textNode, 0);
  else applyRange(blockEl, 0);
  lastBlockIndex = blockIndex;
  preferredX = null;
}

function placeAtContentStart() {
  const rendered = contentEl && contentEl.querySelector(".rendered");
  if (!rendered) return;
  const w = document.createTreeWalker(rendered, NodeFilter.SHOW_TEXT);
  const first = w.nextNode();
  if (first) applyRange(first, 0);
  lastBlockIndex = 0; preferredX = null;
}

function placeAtContentEnd() {
  const rendered = contentEl && contentEl.querySelector(".rendered");
  if (!rendered) return;
  const w = document.createTreeWalker(rendered, NodeFilter.SHOW_TEXT);
  let last = null, n;
  while ((n = w.nextNode())) last = n;
  if (last) applyRange(last, last.length);
  lastBlockIndex = Math.max(0, allBlocks().length - 1); preferredX = null;
}

// ── Cursor movement ────────────────────────────────────────────────────────────
function ensureCursorInitialized() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount) return;
  placeVimCursorAtBlock(Math.max(0, lastBlockIndex));
}

function afterMove() {
  const idx = getCurrentBlockIndex();
  if (idx >= 0) lastBlockIndex = idx;
}

function moveChar(forward) {
  ensureCursorInitialized();
  window.getSelection().modify("move", forward ? "forward" : "backward", "character");
  preferredX = null;
  afterMove();
}

function moveWord(forward) {
  ensureCursorInitialized();
  window.getSelection().modify("move", forward ? "forward" : "backward", "word");
  preferredX = null;
  afterMove();
}

function moveBoundary(forward) {
  ensureCursorInitialized();
  window.getSelection().modify("move", forward ? "forward" : "backward", "lineboundary");
  preferredX = null;
  afterMove();
}

/** Place a caret range using caretRangeFromPoint / caretPositionFromPoint. */
function caretRangeAt(x, y) {
  if (typeof document.caretRangeFromPoint === "function") {
    return document.caretRangeFromPoint(x, y) || null;
  }
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) {
      const r = document.createRange();
      r.setStart(pos.offsetNode, pos.offset);
      r.collapse(true);
      return r;
    }
  }
  return null;
}

/**
 * Jump the cursor to the adjacent block when line movement is blocked.
 * For j: land near the top of the next block at preferredX.
 * For k: land near the bottom of the previous block at preferredX.
 */
function moveToAdjacentBlock(forward) {
  const blocks = allBlocks();
  if (!blocks.length) return;
  const curIdx  = Math.max(0, Math.min(lastBlockIndex, blocks.length - 1));
  const nextIdx = forward ? curIdx + 1 : curIdx - 1;
  if (nextIdx < 0 || nextIdx >= blocks.length) return;

  const blockEl   = blocks[nextIdx];
  const blockRect = blockEl.getBoundingClientRect();
  const targetX   = preferredX !== null ? preferredX : blockRect.left + 4;
  // Land 2px inside the top (j) or bottom (k) of the target block.
  const targetY   = forward ? blockRect.top + 2 : blockRect.bottom - 2;

  const newRange = caretRangeAt(targetX, targetY);
  if (newRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(newRange);
  } else {
    // Last resort: first/last text node in the block.
    const textNode = firstTextIn(blockEl);
    if (textNode) applyRange(textNode, forward ? 0 : textNode.length);
    else applyRange(blockEl, 0);
  }
  lastBlockIndex = nextIdx;
}

/** Line movement using caretRangeFromPoint so it works in non-editable divs. */
function moveLine(forward) {
  ensureCursorInitialized();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  const range = sel.getRangeAt(0);
  const rect  = range.getBoundingClientRect();
  if (!rect || rect.height === 0) {
    // No visible rect — jump to adjacent block directly.
    moveToAdjacentBlock(forward);
    afterMove(); return;
  }

  // Preserve the horizontal position across multiple j/k presses.
  if (preferredX === null) preferredX = rect.left;

  // Target a point squarely on the next/previous visual line.
  const targetX = preferredX;
  const targetY = forward
    ? rect.bottom + rect.height * 0.6   // below current line
    : rect.top   - rect.height * 0.6;   // above current line

  const newRange = caretRangeAt(targetX, targetY);

  if (newRange) {
    const cur = range.startContainer, curOff = range.startOffset;
    const nxt = newRange.startContainer, nxtOff = newRange.startOffset;
    if (cur !== nxt || curOff !== nxtOff) {
      // Moved within the same document — use it.
      sel.removeAllRanges();
      sel.addRange(newRange);
      afterMove();
      return;
    }
  }

  // caretRangeFromPoint returned null or the same position: we're stuck at a
  // block boundary (the gap between .md-block elements has no text).
  // Fall back to jumping to the adjacent block.
  moveToAdjacentBlock(forward);
  afterMove();
}

// ── Enter insert mode at cursor ────────────────────────────────────────────────
function enterInsertAtCursor() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  const range    = sel.getRangeAt(0);
  const rect     = range.getBoundingClientRect();
  const node     = range.startContainer;
  const el       = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!el) return;
  const blockEl  = el.closest ? el.closest(".md-block") : null;
  if (!blockEl) return;
  const blockIdx = parseInt(blockEl.getAttribute("data-block-index"), 10);
  if (isNaN(blockIdx)) return;

  lastBlockIndex = blockIdx;

  // Pass the cursor's pixel coords as a synthetic click so startInlineEdit
  // places the edit cursor at exactly the same character position.
  const fakeClick = rect.height > 0
    ? { clientX: rect.left, clientY: rect.top + rect.height / 2 }
    : null;

  hideFakeCursor();
  sel.removeAllRanges();

  if (onStartInlineEdit && currentBlocks && currentTabRef) {
    onStartInlineEdit(blockEl, blockIdx, currentBlocks, currentTabRef, fakeClick, null);
  }
}

// ── Public API (called by renderer.js and settings.js) ────────────────────────

export function initBlockNav(preferBlockIndex) {
  if (!vimMode) return;
  if (contentEl && contentEl.querySelector(".raw-editor")) return;

  const blocks = allBlocks();
  if (!blocks.length) { lastBlockIndex = 0; return; }

  const target = (typeof preferBlockIndex === "number" &&
                  preferBlockIndex >= 0 &&
                  preferBlockIndex < blocks.length)
    ? preferBlockIndex
    : Math.min(Math.max(lastBlockIndex, 0), blocks.length - 1);

  placeVimCursorAtBlock(target);
  positionFakeCursor();
  setStatus("-- NORMAL --");
}

export function clearBlockNav() {
  hideFakeCursor();
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
  lastBlockIndex = 0; preferredX = null; blockNavPending = "";
  setStatus("");
}

// ── MutationObserver: status only ────────────────────────────────────────────
// Never modify any DOM class here — that would create an infinite loop.
function watchBlockEditMode() {
  if (!contentEl) return;
  const obs = new MutationObserver(() => {
    if (!vimMode) return;
    if (contentEl.querySelector(".raw-editor")) return;
    if (isInsertMode()) {
      hideFakeCursor();
      setStatus("-- INSERT --");
    } else {
      setStatus("-- NORMAL --");
    }
  });
  obs.observe(contentEl, { subtree: true, attributes: true, attributeFilter: ["class"] });
}
if (contentEl) { watchBlockEditMode(); }
else { document.addEventListener("DOMContentLoaded", watchBlockEditMode, { once: true }); }

// Click anywhere in content to position the vim cursor there.
if (contentEl) {
  contentEl.addEventListener("click", () => {
    if (!vimMode || isInsertMode()) return;
    if (contentEl.querySelector(".raw-editor")) return; // raw mode: leave textarea alone
    // The click naturally placed a Selection — just update our state and show cursor.
    const newIdx = getCurrentBlockIndex();
    if (newIdx >= 0) lastBlockIndex = newIdx;
    preferredX = null;
    // Small delay so the browser has committed the click selection.
    requestAnimationFrame(() => { positionFakeCursor(); setStatus("-- NORMAL --"); });
  });
}

// ── Block-mode keydown handler ─────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (!vimMode) return;
  if (contentEl && contentEl.querySelector(".raw-editor")) return;
  if (isInsertMode()) return;

  const active = document.activeElement;
  if (active && (
    active.tagName === "INPUT"  ||
    active.tagName === "SELECT" ||
    active.tagName === "TEXTAREA" ||
    (active.closest && active.closest(".settings-modal"))
  )) return;

  if (!allBlocks().length) return;

  // g→g sequence
  if (blockNavPending === "g") {
    blockNavPending = "";
    e.preventDefault();
    if (e.key === "g") {
      placeAtContentStart();
      positionFakeCursor();
      scrollToCursor();
      setStatus("-- NORMAL --");
    }
    return;
  }

  switch (e.key) {
    case "h":
      e.preventDefault(); moveChar(false); positionFakeCursor(); scrollToCursor(); break;
    case "l":
      e.preventDefault(); moveChar(true);  positionFakeCursor(); scrollToCursor(); break;
    case "j":
      e.preventDefault(); moveLine(true);  positionFakeCursor(); scrollToCursor(); break;
    case "k":
      e.preventDefault(); moveLine(false); positionFakeCursor(); scrollToCursor(); break;
    case "w":
      e.preventDefault(); moveWord(true);  positionFakeCursor(); scrollToCursor(); break;
    case "b":
      e.preventDefault(); moveWord(false); positionFakeCursor(); scrollToCursor(); break;
    case "0":
      e.preventDefault(); moveBoundary(false); positionFakeCursor(); scrollToCursor(); break;
    case "$":
      e.preventDefault(); moveBoundary(true);  positionFakeCursor(); scrollToCursor(); break;
    case "g":
      e.preventDefault(); blockNavPending = "g"; break;
    case "G":
      e.preventDefault(); placeAtContentEnd(); positionFakeCursor(); scrollToCursor();
      setStatus("-- NORMAL --"); break;

    case "i":
      e.preventDefault(); ensureCursorInitialized(); enterInsertAtCursor(); break;
    case "a":
      e.preventDefault(); ensureCursorInitialized();
      moveChar(true); enterInsertAtCursor(); break;
    case "A":
      e.preventDefault(); ensureCursorInitialized();
      moveBoundary(true); enterInsertAtCursor(); break;
    case "I":
      e.preventDefault(); ensureCursorInitialized();
      moveBoundary(false); enterInsertAtCursor(); break;

    case "Escape":
      e.preventDefault(); blockNavPending = ""; setStatus("-- NORMAL --"); break;

    default: break;
  }
}, true);

// ── Raw-mode textarea VimSession ───────────────────────────────────────────────

function getLineInfo(ta) {
  const val = ta.value, pos = ta.selectionStart;
  const lineStart = val.lastIndexOf("\n", pos - 1) + 1;
  const rawEnd    = val.indexOf("\n", pos);
  return { lineStart, lineEnd: rawEnd === -1 ? val.length : rawEnd, pos, val };
}
function mvCursor(ta, p) { ta.setSelectionRange(p, p); }
function gLS(val, pos) {
  return { lineStart: val.lastIndexOf("\n", pos - 1) + 1,
           lineEnd: (() => { const r = val.indexOf("\n", pos); return r === -1 ? val.length : r; })() };
}
function lineNum(val, pos) { return val.slice(0, pos).split("\n").length - 1; }
function posOfLine(val, n) {
  const lines = val.split("\n"); let off = 0;
  for (let i = 0; i < n && i < lines.length; i++) off += lines[i].length + 1;
  return Math.min(off, val.length);
}
function colOf(val, pos) { return pos - (val.lastIndexOf("\n", pos - 1) + 1); }

const sessions = new WeakMap();

class VimSession {
  constructor(ta) {
    this.ta = ta; this.mode = "normal";
    this.pending = ""; this.yank = ""; this.cmdBuffer = "";
    this.setMode("normal");
  }
  setMode(mode) {
    this.mode = mode; this.pending = "";
    if (mode === "insert")  setStatus("-- INSERT --");
    else if (mode === "command") setStatus(":" + this.cmdBuffer);
    else setStatus("-- NORMAL --");
    this.ta.classList.toggle("vim-normal", mode === "normal");
  }
  handle(e) {
    if (this.mode === "insert") {
      if (e.key === "Escape") {
        e.preventDefault();
        mvCursor(this.ta, Math.max(0, this.ta.selectionStart - 1));
        this.setMode("normal");
      }
      return;
    }
    if (this.mode === "command") {
      e.preventDefault();
      if (e.key === "Escape")    { this.cmdBuffer = ""; this.setMode("normal"); return; }
      if (e.key === "Backspace") { this.cmdBuffer = this.cmdBuffer.slice(0, -1); setStatus(":" + this.cmdBuffer); return; }
      if (e.key === "Enter")     { this.execCommand(this.cmdBuffer); this.cmdBuffer = ""; this.setMode("normal"); return; }
      if (e.key.length === 1)    { this.cmdBuffer += e.key; setStatus(":" + this.cmdBuffer); }
      return;
    }
    e.preventDefault();
    const ta = this.ta;
    const { val, pos } = getLineInfo(ta);
    if (this.pending) {
      const seq = this.pending + e.key; this.pending = "";
      if (seq === "dd") { this.deleteLine(); return; }
      if (seq === "yy") { this.yankLine();   return; }
      if (seq === "gg") { mvCursor(ta, 0);   return; }
    }
    switch (e.key) {
      case "i": this.setMode("insert"); break;
      case "a": mvCursor(ta, Math.min(pos + 1, val.length)); this.setMode("insert"); break;
      case "I": mvCursor(ta, gLS(val, pos).lineStart); this.setMode("insert"); break;
      case "A": mvCursor(ta, gLS(val, pos).lineEnd);   this.setMode("insert"); break;
      case "o": this.openLineBelow(); break;
      case "O": this.openLineAbove(); break;
      case "h": mvCursor(ta, Math.max(gLS(val, pos).lineStart, pos - 1)); break;
      case "l": mvCursor(ta, Math.min(gLS(val, pos).lineEnd,   pos + 1)); break;
      case "j": this.moveVert(1);  break;
      case "k": this.moveVert(-1); break;
      case "0": mvCursor(ta, gLS(val, pos).lineStart); break;
      case "$": mvCursor(ta, gLS(val, pos).lineEnd);   break;
      case "^": { const { lineStart } = gLS(val, pos); const nw = val.slice(lineStart).search(/\S/); mvCursor(ta, lineStart + (nw >= 0 ? nw : 0)); break; }
      case "w": this.moveWord(1);  break;
      case "b": this.moveWord(-1); break;
      case "G": mvCursor(ta, val.length); break;
      case "g": this.pending = "g"; break;
      case "d": this.pending = "d"; break;
      case "y": this.pending = "y"; break;
      case "p": this.paste(false); break;
      case "P": this.paste(true);  break;
      case "x": this.deleteChar(); break;
      case "u": document.execCommand("undo"); break;
      case ":": this.cmdBuffer = ""; this.setMode("command"); break;
      default: break;
    }
  }
  moveVert(delta) {
    const ta = this.ta, val = ta.value, pos = ta.selectionStart;
    const col = colOf(val, pos), ln = lineNum(val, pos), lines = val.split("\n");
    const tl = Math.max(0, Math.min(lines.length - 1, ln + delta));
    mvCursor(ta, posOfLine(val, tl) + Math.min(col, lines[tl].length));
  }
  moveWord(dir) {
    const ta = this.ta, val = ta.value; let pos = ta.selectionStart;
    if (dir > 0) { const m = val.slice(pos).match(/^(\S*)(\s+)/); pos += m ? m[0].length : val.length - pos; }
    else { const rev = val.slice(0, pos).split("").reverse().join(""); const m = rev.match(/^(\s*)(\S+)/); pos -= m ? m[0].length : pos; }
    mvCursor(ta, Math.max(0, Math.min(pos, val.length)));
  }
  deleteLine() {
    const ta = this.ta, val = ta.value, pos = ta.selectionStart;
    const { lineStart, lineEnd } = gLS(val, pos);
    let ds = lineStart, de = lineEnd;
    if (de < val.length) de++; else if (ds > 0) ds--;
    this.yank = val.slice(lineStart, lineEnd);
    ta.value = val.slice(0, ds) + val.slice(de);
    mvCursor(ta, Math.min(ds, ta.value.length));
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  yankLine() { const { val, pos } = getLineInfo(this.ta); const { lineStart, lineEnd } = gLS(val, pos); this.yank = val.slice(lineStart, lineEnd); }
  deleteChar() {
    const ta = this.ta, val = ta.value, pos = ta.selectionStart;
    if (pos >= gLS(val, pos).lineEnd) return;
    ta.value = val.slice(0, pos) + val.slice(pos + 1);
    mvCursor(ta, pos);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  paste(before) {
    if (!this.yank) return;
    const ta = this.ta, val = ta.value, pos = ta.selectionStart;
    const { lineStart, lineEnd } = gLS(val, pos);
    let ins, text;
    if (before) { ins = lineStart; text = this.yank + "\n"; }
    else { ins = lineEnd === val.length ? val.length : lineEnd + 1; text = (lineEnd === val.length ? "\n" : "") + this.yank + "\n"; }
    ta.value = val.slice(0, ins) + text + val.slice(ins);
    mvCursor(ta, ins);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  openLineBelow() {
    const ta = this.ta, val = ta.value, pos = ta.selectionStart;
    const { lineEnd } = gLS(val, pos);
    ta.value = val.slice(0, lineEnd) + "\n" + val.slice(lineEnd);
    mvCursor(ta, lineEnd + 1);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    this.setMode("insert");
  }
  openLineAbove() {
    const ta = this.ta, val = ta.value, pos = ta.selectionStart;
    const { lineStart } = gLS(val, pos);
    ta.value = val.slice(0, lineStart) + "\n" + val.slice(lineStart);
    mvCursor(ta, lineStart);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    this.setMode("insert");
  }
  execCommand(cmd) {
    if (cmd.trim() === "w") this.ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

export function applyVimMode(textarea) {
  if (sessions.has(textarea)) return;
  const session = new VimSession(textarea);
  sessions.set(textarea, session);
  const onKeydown = (e) => { if (vimMode) session.handle(e); };
  textarea.addEventListener("keydown", onKeydown, true);
  textarea._vimKeydown = onKeydown;
}

export function removeVimMode(textarea) {
  if (!sessions.has(textarea)) return;
  sessions.delete(textarea);
  if (textarea._vimKeydown) {
    textarea.removeEventListener("keydown", textarea._vimKeydown, true);
    delete textarea._vimKeydown;
  }
  textarea.classList.remove("vim-normal");
  setStatus("");
}
