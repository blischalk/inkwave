// Vim-style keybindings.
//
// Block mode: a fake blinking cursor div is positioned over the Selection range.
//   h/j/k/l/w/b/0/$/G/gg move the logical Selection (invisible by itself in a
//   non-contenteditable div), then reposition the fake cursor to match.
//   i/a/A/I enter startInlineEdit at the cursor's pixel coords.
// Raw mode: full VimSession on the textarea.

import { vimMode, getContentEl, onStartInlineEdit, onShowTabContent, currentBlocks, setCurrentBlocks, currentTabRef } from "./state.js";
import { getCaretOffset, renderedOffsetToSourceOffset, sourceOffsetToRenderedOffset, setCaretPosition } from "./caret.js";
import { blockRaw, blockAndOffsetToContentOffset, contentOffsetToBlockAndOffset, blocksToContent, getBlocks, moveListItemInBlocks } from "./blocks.js";
import { saveToFile } from "./fileio.js";

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
  const contentEl = getContentEl();
  // contentEl.innerHTML replacements destroy the cursor — always re-append.
  if (contentEl && fakeCursorEl.parentNode !== contentEl) {
    contentEl.appendChild(fakeCursorEl);
  } else if (!contentEl && fakeCursorEl.parentNode !== document.body) {
    document.body.appendChild(fakeCursorEl);
  }
  return fakeCursorEl;
}

function positionFakeCursor() {
  const contentEl = getContentEl();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { hideFakeCursor(); return; }
  const range = sel.getRangeAt(0);
  let vRect;
  // In visual mode, size the cursor from just the focus point — not the full
  // selection bounding box, which spans the entire selection height.
  if (blockVisualMode && sel.focusNode) {
    try {
      const fr = document.createRange();
      fr.setStart(sel.focusNode, sel.focusOffset);
      fr.collapse(true);
      const r = fr.getBoundingClientRect();
      if (r && r.height > 0) vRect = r;
    } catch (_) {}
  }
  if (!vRect) vRect = range.getBoundingClientRect(); // viewport-relative

  // Empty blocks produce a zero-height caret rect.  Fall back to the block
  // element's own rect so the cursor remains visible on a freshly-opened line.
  if (!vRect || vRect.height === 0) {
    const blockEl = contentEl
      ? contentEl.querySelector('.md-block[data-block-index="' + lastBlockIndex + '"]')
      : null;
    if (blockEl) {
      const br = blockEl.getBoundingClientRect();
      if (br && br.height > 0) {
        const lineH = parseFloat(getComputedStyle(blockEl).lineHeight) || br.height;
        vRect = { left: br.left, top: br.top, height: lineH };
      }
    }
    if (!vRect || !vRect.height) { hideFakeCursor(); return; }
  }

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
  const contentEl = getContentEl();
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
let blockVisualMode = false;
let blockVisualAnchor = null; // { node, offset, blockIndex } when in block visual
let blockVisualRange  = null; // { topIdx, botIdx } — updated by extendBlockVisual
const visualOverlayEls = [];  // absolutely-positioned highlight divs for visual selection
/** Shared yank register: set by block-mode or raw-mode yank, used by raw-mode paste and inline-edit paste. */
let sharedYank = "";
let sharedYankBlock = false;

/** Return the current yank content for pasting (e.g. in inline-edit mode). */
export function getYank() {
  return sharedYank;
}

// ── Block-mode undo stack ──────────────────────────────────────────────────────
const blockUndoStack = [];
const MAX_BLOCK_UNDO = 50;

function pushBlockUndo() {
  if (!currentTabRef) return;
  blockUndoStack.push({
    blocks: currentBlocks.map(b => ({ ...b })),
    content: currentTabRef.content,
    blockIndex: lastBlockIndex,
  });
  if (blockUndoStack.length > MAX_BLOCK_UNDO) blockUndoStack.shift();
}

function yankCurrentBlock() {
  const idx = Math.max(0, Math.min(lastBlockIndex, currentBlocks.length - 1));
  const block = currentBlocks[idx];
  if (!block) return;
  sharedYank = block.raw || "";
  sharedYankBlock = false;
}

function deleteCurrentBlock() {
  if (!currentBlocks.length || !currentTabRef) return;
  clearVisualHighlights();
  blockVisualMode = false; blockVisualAnchor = null;
  yankCurrentBlock();
  pushBlockUndo();
  const idx = Math.max(0, Math.min(lastBlockIndex, currentBlocks.length - 1));
  currentBlocks.splice(idx, 1);
  if (currentBlocks.length === 0) currentBlocks.push({ raw: "", type: "paragraph" });
  currentTabRef.content = blocksToContent(currentBlocks);
  setCurrentBlocks(currentBlocks);
  saveToFile(currentTabRef);
  lastBlockIndex = Math.min(idx, currentBlocks.length - 1);
  requestAnimationFrame(() => {
    if (onShowTabContent) onShowTabContent(currentTabRef, currentBlocks);
    setTimeout(() => {
      placeVimCursorAtBlock(lastBlockIndex);
      positionFakeCursor();
      setStatus("-- NORMAL --");
    }, 0);
  });
}

function allBlocks() {
  const contentEl = getContentEl();
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
  const contentEl = getContentEl();
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
  const contentEl = getContentEl();
  const rendered = contentEl && contentEl.querySelector(".rendered");
  if (!rendered) return;
  const w = document.createTreeWalker(rendered, NodeFilter.SHOW_TEXT);
  const first = w.nextNode();
  if (first) applyRange(first, 0);
  lastBlockIndex = 0; preferredX = null;
}

function placeAtContentEnd() {
  const contentEl = getContentEl();
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

// In visual mode, sel.modify("move",...) can collapse to the range START instead of
// the FOCUS end, causing the selection to jump to the anchor side.  Always collapse
// explicitly to the focus before any movement so vim visual selection stays correct.
function collapseToFocus() {
  const sel = window.getSelection();
  if (!sel) return;
  if (sel.focusNode) {
    sel.collapse(sel.focusNode, sel.focusOffset);
  } else if (sel.rangeCount) {
    const r = sel.getRangeAt(0);
    sel.collapse(r.endContainer, r.endOffset);
  }
}

function moveChar(forward) {
  ensureCursorInitialized();
  if (blockVisualMode) collapseToFocus();
  window.getSelection().modify("move", forward ? "forward" : "backward", "character");
  preferredX = null;
  afterMove();
}

function moveWord(forward) {
  ensureCursorInitialized();
  if (blockVisualMode) collapseToFocus();
  window.getSelection().modify("move", forward ? "forward" : "backward", "word");
  preferredX = null;
  afterMove();
}

function moveBoundary(forward) {
  ensureCursorInitialized();
  if (blockVisualMode) collapseToFocus();
  window.getSelection().modify("move", forward ? "forward" : "backward", "lineboundary");
  preferredX = null;
  afterMove();
}

function moveToFirstNonWhitespace() {
  ensureCursorInitialized();
  if (blockVisualMode) collapseToFocus();
  window.getSelection().modify("move", "backward", "lineboundary");
  // Advance past any leading whitespace on the visual line.
  const sel = window.getSelection();
  for (let i = 0; i < 40; i++) {
    if (!sel || !sel.rangeCount) break;
    const r = sel.getRangeAt(0);
    if (r.startContainer.nodeType !== Node.TEXT_NODE) break;
    const ch = r.startContainer.textContent[r.startOffset];
    if (!ch || !/\s/.test(ch)) break;
    sel.modify("move", "forward", "character");
  }
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
  if (blockVisualMode) collapseToFocus();
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

/** Half or full page scroll in block mode; forward = down. */
function movePageBlock(forward, half) {
  const contentEl = getContentEl();
  if (!contentEl) return;
  ensureCursorInitialized();
  const amount = (half ? 0.5 : 1) * contentEl.clientHeight * (forward ? 1 : -1);
  contentEl.scrollBy({ top: amount });
  const cr = contentEl.getBoundingClientRect();
  const centerX = cr.left + cr.width / 2;
  const centerY = cr.top + cr.height / 2;
  const newRange = caretRangeAt(centerX, centerY);
  if (newRange) {
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
    afterMove();
  }
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
  const contentEl = getContentEl();
  if (contentEl && contentEl.querySelector(".raw-editor")) return;
  if (isInsertMode()) return; // don't stomp on an active inline edit (e.g. after 'o')

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
  clearVisualHighlights();
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
  lastBlockIndex = 0; preferredX = null; blockNavPending = "";
  blockVisualMode = false; blockVisualAnchor = null;
  setStatus("");
}

/** Current content offset (for raw/block cursor sync). Returns null if not in block mode or no blocks. */
export function getBlockModeContentOffset() {
  const contentEl = getContentEl();
  if (!contentEl || contentEl.querySelector(".raw-editor")) return null;
  const blocks = currentBlocks;
  if (!blocks || blocks.length === 0) return null;
  const blockEls = allBlocks();
  if (!blockEls.length) return null;
  const blockIndex = Math.max(0, Math.min(lastBlockIndex, blockEls.length - 1));
  const blockEl = blockEls[blockIndex];
  if (!blockEl) return null;
  const offsetInRendered = getCaretOffset(blockEl);
  const block = blocks[blockIndex];
  const raw = blockRaw(block);
  const blockType = (block && block.type) || "paragraph";
  const renderedText = (blockEl.innerText != null ? blockEl.innerText : blockEl.textContent) || "";
  const sourceOffsetInBlock = renderedOffsetToSourceOffset(raw, renderedText, offsetInRendered, blockType);
  return blockAndOffsetToContentOffset(blocks, blockIndex, sourceOffsetInBlock);
}

/** Place block-mode cursor at content offset (for restoring after raw→block switch). */
export function placeVimCursorAtContentOffset(contentOffset) {
  const contentEl = getContentEl();
  if (!contentEl || contentEl.querySelector(".raw-editor") || contentOffset == null) return;
  const blocks = currentBlocks;
  if (!blocks || blocks.length === 0) return;
  const { blockIndex, offsetInBlock } = contentOffsetToBlockAndOffset(blocks, contentOffset);
  const blockEls = allBlocks();
  if (blockIndex < 0 || blockIndex >= blockEls.length) return;
  const blockEl = blockEls[blockIndex];
  const block = blocks[blockIndex];
  const raw = blockRaw(block);
  const blockType = (block && block.type) || "paragraph";
  const renderedOffset = sourceOffsetToRenderedOffset(raw, offsetInBlock, blockType);
  lastBlockIndex = blockIndex;
  preferredX = null;
  setCaretPosition(blockEl, renderedOffset);
  if (vimMode) {
    positionFakeCursor();
    setStatus("-- NORMAL --");
  }
}

// ── MutationObserver: status only ────────────────────────────────────────────
// Never modify any DOM class here — that would create an infinite loop.
function watchBlockEditMode() {
  const obs = new MutationObserver(() => {
    if (!vimMode) return;
    const contentEl = getContentEl();
    if (contentEl && contentEl.querySelector(".raw-editor")) return;
    if (isInsertMode()) {
      hideFakeCursor();
      setStatus("-- INSERT --");
    } else {
      setStatus("-- NORMAL --");
    }
  });
  obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
}
document.addEventListener("DOMContentLoaded", watchBlockEditMode, { once: true });
if (document.readyState !== "loading") watchBlockEditMode();

// Click anywhere in content to position the vim cursor there.
document.addEventListener("click", (e) => {
  const contentEl = getContentEl();
  if (!contentEl || !contentEl.contains(e.target)) return;
  if (!vimMode || isInsertMode()) return;
  if (contentEl.querySelector(".raw-editor")) return; // raw mode: leave textarea alone
  // The click naturally placed a Selection — just update our state and show cursor.
  const newIdx = getCurrentBlockIndex();
  if (newIdx >= 0) lastBlockIndex = newIdx;
  preferredX = null;
  // Small delay so the browser has committed the click selection.
  requestAnimationFrame(() => { positionFakeCursor(); setStatus("-- NORMAL --"); });
});

// ── Block-mode keydown handler ─────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (!vimMode) return;
  // Raw mode: let the raw-editor textarea's own VimSession handle keys; do not run block nav.
  const contentEl = getContentEl();
  if (contentEl && contentEl.querySelector(".raw-editor")) return;
  if (e.target && e.target.classList && e.target.classList.contains("raw-editor") && e.target.tagName === "TEXTAREA") return;
  if (isInsertMode()) return;

  const active = document.activeElement;
  if (active && (
    active.tagName === "INPUT"  ||
    active.tagName === "SELECT" ||
    active.tagName === "TEXTAREA" ||
    (active.closest && active.closest(".settings-modal"))
  )) return;

  if (!allBlocks().length) return;

  // Ctrl+D / Ctrl+U / Ctrl+F / Ctrl+B: half/full page
  const ctrlKey = e.key.length === 1 && e.ctrlKey;
  if (ctrlKey) {
    const k = e.key.toLowerCase();
    if (k === "d") { e.preventDefault(); movePageBlock(true, true);  positionFakeCursor(); scrollToCursor(); return; }
    if (k === "u") { e.preventDefault(); movePageBlock(false, true); positionFakeCursor(); scrollToCursor(); return; }
    if (k === "f") { e.preventDefault(); movePageBlock(true, false); positionFakeCursor(); scrollToCursor(); return; }
    if (k === "b") { e.preventDefault(); movePageBlock(false, false); positionFakeCursor(); scrollToCursor(); return; }
  }

  // g→g sequence
  if (blockNavPending === "g") {
    blockNavPending = "";
    e.preventDefault();
    if (e.key === "g") {
      placeAtContentStart();
      positionFakeCursor();
      scrollToCursor();
      if (blockVisualMode) extendBlockVisual();
      setStatus(blockVisualMode ? "-- VISUAL --" : "-- NORMAL --");
    }
    return;
  }

  // d→d: delete current block
  if (blockNavPending === "d") {
    blockNavPending = "";
    if (e.key === "d") {
      e.preventDefault();
      deleteCurrentBlock();
    }
    return;
  }

  // y→y: yank current block
  if (blockNavPending === "y") {
    blockNavPending = "";
    if (e.key === "y") {
      e.preventDefault();
      yankCurrentBlock();
      setStatus("-- NORMAL --");
    }
    return;
  }

  // Block visual mode: extend selection on movement, y = yank, Escape = exit
  if (blockVisualMode) {
    if (e.key === "Escape") {
      e.preventDefault();
      clearVisualHighlights();
      blockVisualMode = false;
      blockVisualAnchor = null;
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        r.collapse(false); // to focus (cursor) end
        sel.removeAllRanges();
        sel.addRange(r);
      }
      positionFakeCursor();
      setStatus("-- NORMAL --");
      return;
    }
    if (e.key === "y") {
      e.preventDefault();
      if (blockVisualRange && currentBlocks && contentEl) {
        const { topIdx, botIdx } = blockVisualRange;
        const sel        = window.getSelection();
        const focusNode  = sel?.focusNode  ?? null;
        const focusOff   = sel?.focusOffset ?? 0;
        const anchorIdx  = blockVisualAnchor.blockIndex;
        const isForward  = anchorIdx <= topIdx || topIdx === botIdx;
        const selectedRaw = [];

        // Returns block.raw when the range covers the full rendered text of the
        // block (preserving markdown like ## or **bold**), otherwise the partial
        // rendered text (for selections that end mid-block).
        function yankBlockRange(blockIdx, startNode, startOff, endNode, endOff) {
          const blockEl = contentEl.querySelector(`.md-block[data-block-index="${blockIdx}"]`);
          if (!blockEl || !currentBlocks[blockIdx]) return;
          try {
            const full = document.createRange();
            full.selectNodeContents(blockEl);
            const r = document.createRange();
            r.setStart(startNode, startOff);
            r.setEnd(endNode, endOff);
            const partial = r.toString();
            if (partial.trim() === full.toString().trim()) {
              selectedRaw.push(currentBlocks[blockIdx].raw || "");
            } else if (partial) {
              selectedRaw.push(partial);
            }
          } catch (_) {
            selectedRaw.push(currentBlocks[blockIdx].raw || "");
          }
        }

        if (topIdx === botIdx) {
          // Same block: compare selection against full block to decide raw vs partial.
          const blockEl = contentEl.querySelector(`.md-block[data-block-index="${topIdx}"]`);
          if (blockEl && focusNode) {
            yankBlockRange(topIdx,
              blockVisualAnchor.node, blockVisualAnchor.offset,
              focusNode, focusOff);
          } else if (currentBlocks[topIdx]) {
            selectedRaw.push(currentBlocks[topIdx].raw || "");
          }
        } else {
          // Top boundary block
          const topEl = contentEl.querySelector(`.md-block[data-block-index="${topIdx}"]`);
          if (topEl) {
            try {
              const full = document.createRange();
              full.selectNodeContents(topEl);
              if (isForward) {
                yankBlockRange(topIdx, blockVisualAnchor.node, blockVisualAnchor.offset,
                  full.endContainer, full.endOffset);
              } else {
                yankBlockRange(topIdx, focusNode, focusOff,
                  full.endContainer, full.endOffset);
              }
            } catch (_) {
              if (currentBlocks[topIdx]) selectedRaw.push(currentBlocks[topIdx].raw || "");
            }
          }
          // Middle blocks: always full raw
          for (let i = topIdx + 1; i < botIdx; i++) {
            if (currentBlocks[i]) selectedRaw.push(currentBlocks[i].raw || "");
          }
          // Bottom boundary block
          const botEl = contentEl.querySelector(`.md-block[data-block-index="${botIdx}"]`);
          if (botEl) {
            try {
              const full = document.createRange();
              full.selectNodeContents(botEl);
              if (isForward) {
                yankBlockRange(botIdx, full.startContainer, full.startOffset,
                  focusNode, focusOff);
              } else {
                yankBlockRange(botIdx, full.startContainer, full.startOffset,
                  blockVisualAnchor.node, blockVisualAnchor.offset);
              }
            } catch (_) {
              if (currentBlocks[botIdx]) selectedRaw.push(currentBlocks[botIdx].raw || "");
            }
          }
        }
        sharedYank = selectedRaw.filter(r => r !== "").join("\n\n");
      } else {
        const sel = window.getSelection();
        sharedYank = sel ? sel.toString() : "";
      }
      sharedYankBlock = false;
      clearVisualHighlights();
      blockVisualMode = false;
      blockVisualAnchor = null;
      const sel2 = window.getSelection();
      if (sel2 && sel2.rangeCount) {
        const r = sel2.getRangeAt(0);
        r.collapse(true); // to anchor (start)
        sel2.removeAllRanges();
        sel2.addRange(r);
      }
      positionFakeCursor();
      setStatus("-- NORMAL --");
      return;
    }
  }

  // Cmd+Shift+Up / Cmd+Shift+Down: move list item in normal mode
  if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.metaKey && e.shiftKey) {
    if (currentBlocks[lastBlockIndex] && currentBlocks[lastBlockIndex].type === "list") {
      e.preventDefault();
      pushBlockUndo();
      const direction = e.key === "ArrowUp" ? "up" : "down";
      const newIndex = moveListItemInBlocks(currentBlocks, lastBlockIndex, direction);
      if (newIndex >= 0) {
        currentTabRef.content = blocksToContent(currentBlocks);
        setCurrentBlocks(currentBlocks);
        saveToFile(currentTabRef);
        requestAnimationFrame(() => {
          if (onShowTabContent) onShowTabContent(currentTabRef, currentBlocks);
          setTimeout(() => {
            lastBlockIndex = newIndex;
            placeVimCursorAtBlock(newIndex);
            positionFakeCursor();
            setStatus("-- NORMAL --");
          }, 0);
        });
      }
    }
    return;
  }

  switch (e.key) {
    case "v":
    case "V":
      e.preventDefault();
      if (blockVisualMode) {
        clearVisualHighlights();
        blockVisualMode = false;
        blockVisualAnchor = null;
        const s = window.getSelection();
        if (s && s.rangeCount) {
          const r = s.getRangeAt(0);
          r.collapse(false);
          s.removeAllRanges();
          s.addRange(r);
        }
        positionFakeCursor();
        setStatus("-- NORMAL --");
      } else {
        ensureCursorInitialized();
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const r = sel.getRangeAt(0);
          blockVisualMode = true;
          blockVisualAnchor = { node: r.startContainer, offset: r.startOffset, blockIndex: lastBlockIndex };
          blockVisualRange  = { topIdx: lastBlockIndex, botIdx: lastBlockIndex };
          setStatus("-- VISUAL --");
        }
      }
      break;
    case "h":
      e.preventDefault(); moveChar(false); positionFakeCursor(); scrollToCursor(); if (blockVisualMode) extendBlockVisual(); break;
    case "l":
      e.preventDefault(); moveChar(true);  positionFakeCursor(); scrollToCursor(); if (blockVisualMode) extendBlockVisual(); break;
    case "j":
      e.preventDefault(); moveLine(true);  positionFakeCursor(); scrollToCursor(); if (blockVisualMode) extendBlockVisual(); break;
    case "k":
      e.preventDefault(); moveLine(false); positionFakeCursor(); scrollToCursor(); if (blockVisualMode) extendBlockVisual(); break;
    case "w":
      e.preventDefault(); moveWord(true);  positionFakeCursor(); scrollToCursor(); if (blockVisualMode) extendBlockVisual(); break;
    case "b":
      e.preventDefault(); moveWord(false); positionFakeCursor(); scrollToCursor(); if (blockVisualMode) extendBlockVisual(); break;
    case "0":
      e.preventDefault(); moveBoundary(false); positionFakeCursor(); scrollToCursor(); if (blockVisualMode) extendBlockVisual(); break;
    case "^":
      e.preventDefault(); moveToFirstNonWhitespace(); positionFakeCursor(); scrollToCursor(); if (blockVisualMode) extendBlockVisual(); break;
    case "$":
      e.preventDefault(); moveBoundary(true);  positionFakeCursor(); scrollToCursor(); if (blockVisualMode) extendBlockVisual(); break;
    case "g":
      e.preventDefault(); blockNavPending = "g"; if (!blockVisualMode) break; extendBlockVisual(); break;
    case "G":
      e.preventDefault(); placeAtContentEnd(); positionFakeCursor(); scrollToCursor(); if (blockVisualMode) extendBlockVisual(); setStatus(blockVisualMode ? "-- VISUAL --" : "-- NORMAL --"); break;

    case "i":
      e.preventDefault(); clearVisualHighlights(); blockVisualMode = false; blockVisualAnchor = null; ensureCursorInitialized(); enterInsertAtCursor(); break;
    case "a":
      e.preventDefault(); ensureCursorInitialized();
      moveChar(true); enterInsertAtCursor(); break;
    case "A":
      e.preventDefault(); ensureCursorInitialized();
      moveBoundary(true); enterInsertAtCursor(); break;
    case "I":
      e.preventDefault(); ensureCursorInitialized();
      moveBoundary(false); enterInsertAtCursor(); break;

    case "d":
      e.preventDefault(); blockNavPending = "d"; break;
    case "y":
      e.preventDefault(); blockNavPending = "y"; break;
    case "u": {
      e.preventDefault();
      const uState = blockUndoStack.pop();
      if (!uState || !currentTabRef) break;
      setCurrentBlocks(uState.blocks);
      currentTabRef.content = uState.content;
      saveToFile(currentTabRef);
      lastBlockIndex = Math.min(uState.blockIndex, uState.blocks.length - 1);
      requestAnimationFrame(() => {
        if (onShowTabContent) onShowTabContent(currentTabRef, uState.blocks);
        setTimeout(() => {
          placeVimCursorAtBlock(lastBlockIndex);
          positionFakeCursor();
          setStatus("-- NORMAL --");
        }, 0);
      });
      break;
    }

    case "o": {
      e.preventDefault();
      clearVisualHighlights(); blockVisualMode = false; blockVisualAnchor = null;
      ensureCursorInitialized();
      pushBlockUndo();
      const oIdx = lastBlockIndex;
      currentBlocks.splice(oIdx + 1, 0, { raw: "", type: "paragraph" });
      currentTabRef.content = blocksToContent(currentBlocks);
      setCurrentBlocks(currentBlocks);
      saveToFile(currentTabRef);
      hideFakeCursor();
      const oSel = window.getSelection();
      if (oSel) oSel.removeAllRanges();
      requestAnimationFrame(() => {
        if (onShowTabContent) onShowTabContent(currentTabRef, currentBlocks);
        setTimeout(() => {
          const newBlockEl = contentEl.querySelector('.md-block[data-block-index="' + (oIdx + 1) + '"]');
          if (newBlockEl && onStartInlineEdit) {
            lastBlockIndex = oIdx + 1;
            onStartInlineEdit(newBlockEl, oIdx + 1, currentBlocks, currentTabRef, null, null);
          }
        }, 0);
      });
      break;
    }

    case "O": {
      e.preventDefault();
      clearVisualHighlights(); blockVisualMode = false; blockVisualAnchor = null;
      ensureCursorInitialized();
      pushBlockUndo();
      const OIdx = lastBlockIndex;
      currentBlocks.splice(OIdx, 0, { raw: "", type: "paragraph" });
      currentTabRef.content = blocksToContent(currentBlocks);
      setCurrentBlocks(currentBlocks);
      saveToFile(currentTabRef);
      hideFakeCursor();
      const OSel = window.getSelection();
      if (OSel) OSel.removeAllRanges();
      requestAnimationFrame(() => {
        if (onShowTabContent) onShowTabContent(currentTabRef, currentBlocks);
        setTimeout(() => {
          const newBlockEl = contentEl.querySelector('.md-block[data-block-index="' + OIdx + '"]');
          if (newBlockEl && onStartInlineEdit) {
            lastBlockIndex = OIdx;
            onStartInlineEdit(newBlockEl, OIdx, currentBlocks, currentTabRef, null, null);
          }
        }, 0);
      });
      break;
    }

    case "p": {
      e.preventDefault();
      if (!sharedYank) break;
      pushBlockUndo();
      const pIdx = lastBlockIndex;
      const parsed = getBlocks(sharedYank);
      if (parsed.length === 0) {
        currentBlocks.splice(pIdx + 1, 0, { raw: sharedYank, type: "paragraph" });
      } else {
        for (let ni = parsed.length - 1; ni >= 0; ni--) {
          currentBlocks.splice(pIdx + 1, 0, parsed[ni]);
        }
      }
      currentTabRef.content = blocksToContent(currentBlocks);
      setCurrentBlocks(currentBlocks);
      saveToFile(currentTabRef);
      requestAnimationFrame(() => {
        if (onShowTabContent) onShowTabContent(currentTabRef, currentBlocks);
        setTimeout(() => {
          lastBlockIndex = pIdx + 1;
          placeVimCursorAtBlock(lastBlockIndex);
          positionFakeCursor();
          setStatus("-- NORMAL --");
        }, 0);
      });
      break;
    }

    case "Escape":
      e.preventDefault(); blockNavPending = ""; clearVisualHighlights(); blockVisualMode = false; blockVisualAnchor = null; setStatus("-- NORMAL --"); break;

    default: break;
  }
}, true);

function clearVisualHighlights() {
  const contentEl = getContentEl();
  if (contentEl) {
    contentEl.querySelectorAll(".md-block.vim-visual-hl")
      .forEach(el => el.classList.remove("vim-visual-hl"));
  }
  visualOverlayEls.forEach(el => el.remove());
  visualOverlayEls.length = 0;
  blockVisualRange = null;
}

function addHighlightRects(range) {
  const contentEl = getContentEl();
  if (!contentEl) return;
  const ceRect = contentEl.getBoundingClientRect();
  for (const rect of range.getClientRects()) {
    if (rect.width < 1 || rect.height < 1) continue;
    const div = document.createElement("div");
    div.className = "vim-visual-overlay";
    div.setAttribute("aria-hidden", "true");
    div.style.left   = (rect.left - ceRect.left + contentEl.scrollLeft) + "px";
    div.style.top    = (rect.top  - ceRect.top  + contentEl.scrollTop)  + "px";
    div.style.width  = rect.width  + "px";
    div.style.height = rect.height + "px";
    contentEl.appendChild(div);
    visualOverlayEls.push(div);
  }
}

function extendBlockVisual() {
  const contentEl = getContentEl();
  if (!blockVisualAnchor || !contentEl) { positionFakeCursor(); return; }
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { positionFakeCursor(); return; }

  clearVisualHighlights();

  const anchorBlockIdx = blockVisualAnchor.blockIndex ?? lastBlockIndex;
  const focusBlockIdx  = lastBlockIndex;
  const focusNode      = sel.focusNode;
  const focusOffset    = sel.focusOffset;

  if (anchorBlockIdx === focusBlockIdx) {
    // Same block: native browser selection — precise, no cross-block gap rectangles.
    blockVisualRange = { topIdx: anchorBlockIdx, botIdx: anchorBlockIdx };
    try {
      sel.setBaseAndExtent(
        blockVisualAnchor.node, blockVisualAnchor.offset,
        focusNode, focusOffset,
      );
    } catch (_) {}
    positionFakeCursor();
    return;
  }

  // Multi-block: keep selection collapsed, render highlights manually.
  sel.collapse(focusNode, focusOffset);

  const isForward   = focusBlockIdx > anchorBlockIdx;
  const topBlockIdx = isForward ? anchorBlockIdx : focusBlockIdx;
  const botBlockIdx = isForward ? focusBlockIdx  : anchorBlockIdx;
  blockVisualRange  = { topIdx: topBlockIdx, botIdx: botBlockIdx };

  // Middle blocks: full background highlight.
  contentEl.querySelectorAll(".md-block").forEach(el => {
    const idx = parseInt(el.getAttribute("data-block-index"), 10);
    if (!isNaN(idx) && idx > topBlockIdx && idx < botBlockIdx)
      el.classList.add("vim-visual-hl");
  });

  // Top partial block: from anchor/focus point to end of block.
  const topBlockEl = contentEl.querySelector(`.md-block[data-block-index="${topBlockIdx}"]`);
  if (topBlockEl) {
    try {
      const full = document.createRange();
      full.selectNodeContents(topBlockEl);
      const r = document.createRange();
      if (isForward) {
        r.setStart(blockVisualAnchor.node, blockVisualAnchor.offset);
      } else {
        r.setStart(focusNode, focusOffset);
      }
      r.setEnd(full.endContainer, full.endOffset);
      addHighlightRects(r);
    } catch (_) {}
  }

  // Bottom partial block: from start of block to anchor/focus point.
  const botBlockEl = contentEl.querySelector(`.md-block[data-block-index="${botBlockIdx}"]`);
  if (botBlockEl) {
    try {
      const full = document.createRange();
      full.selectNodeContents(botBlockEl);
      const r = document.createRange();
      r.setStart(full.startContainer, full.startOffset);
      if (isForward) {
        r.setEnd(focusNode, focusOffset);
      } else {
        r.setEnd(blockVisualAnchor.node, blockVisualAnchor.offset);
      }
      addHighlightRects(r);
    } catch (_) {}
  }

  positionFakeCursor();
}

// ── Raw-mode textarea VimSession ───────────────────────────────────────────────

function getLineInfo(ta) {
  const val = ta.value, pos = ta.selectionStart;
  const lineStart = val.lastIndexOf("\n", pos - 1) + 1;
  const rawEnd    = val.indexOf("\n", pos);
  return { lineStart, lineEnd: rawEnd === -1 ? val.length : rawEnd, pos, val };
}
function mvCursor(ta, p) {
  ta.setSelectionRange(p, p);
  scrollRawCursorIntoView(ta);
}
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

/** Scroll the raw-editor textarea so the cursor (selectionStart) stays visible. */
export function scrollRawCursorIntoView(ta) {
  const pos = ta.selectionStart;
  const val = ta.value || "";
  if (pos < 0 || pos > val.length) return;
  const style = getComputedStyle(ta);
  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  const s = mirror.style;
  s.position = "absolute";
  s.left = "-9999px";
  s.top = "0";
  s.width = ta.clientWidth + "px";
  s.font = style.font;
  s.fontSize = style.fontSize;
  s.lineHeight = style.lineHeight;
  s.padding = style.padding;
  s.boxSizing = style.boxSizing;
  s.whiteSpace = "pre-wrap";
  s.wordWrap = "break-word";
  s.overflow = "hidden";
  s.visibility = "hidden";
  mirror.textContent = val;
  document.body.appendChild(mirror);
  let cursorTop = 0;
  let lineHeight = 0;
  try {
    const range = document.createRange();
    const textNode = mirror.firstChild;
    if (textNode) {
      const off = Math.min(pos, textNode.length);
      range.setStart(textNode, off);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      const mirrorRect = mirror.getBoundingClientRect();
      cursorTop = rect.top - mirrorRect.top;
      lineHeight = rect.height || parseFloat(style.lineHeight) || 20;
    }
  } finally {
    mirror.remove();
  }
  const pad = Math.min(40, lineHeight * 1.5);
  if (cursorTop < ta.scrollTop + pad)
    ta.scrollTop = Math.max(0, cursorTop - pad);
  else if (cursorTop + lineHeight > ta.scrollTop + ta.clientHeight - pad)
    ta.scrollTop = Math.max(0, cursorTop + lineHeight - ta.clientHeight + pad);
}

const sessions = new WeakMap();

/** Return line/col for a character offset in val. */
function lineColOf(val, offset) {
  const lineStart = val.lastIndexOf("\n", offset - 1) + 1;
  return { line: val.slice(0, offset).split("\n").length - 1, col: offset - lineStart };
}

/** Get rectangular block between two offsets. Returns { minL, maxL, minC, maxC, lines, startOffset, endOffset }. */
function getBlockRect(val, offset1, offset2) {
  const p1 = lineColOf(val, offset1);
  const p2 = lineColOf(val, offset2);
  const minL = Math.min(p1.line, p2.line);
  const maxL = Math.max(p1.line, p2.line);
  const minC = Math.min(p1.col, p2.col);
  const maxC = Math.max(p1.col, p2.col);
  const lines = val.split("\n");
  const startOffset = posOfLine(val, minL) + minC;
  const endOffset = posOfLine(val, maxL) + Math.min(maxC + 1, lines[maxL]?.length ?? 0);
  return { minL, maxL, minC, maxC, lines, startOffset, endOffset };
}

/** Extract block text (rectangle) as newline-joined lines. */
function getBlockText(val, minL, maxL, minC, maxC) {
  const lines = val.split("\n");
  const width = maxC - minC + 1;
  const out = [];
  for (let i = minL; i <= maxL; i++) {
    const line = lines[i] ?? "";
    const segment = line.length <= minC ? "" : line.slice(minC, Math.min(maxC + 1, line.length));
    out.push(segment.padEnd(width));
  }
  return out.join("\n");
}

const MAX_UNDO = 50;

class VimSession {
  constructor(ta) {
    this.ta = ta; this.mode = "normal";
    this.pending = ""; this.yank = ""; this.yankBlock = false; this.cmdBuffer = "";
    this.anchorOffset = 0; // visual block anchor (fixed corner)
    this.undoHistory = []; // { value, selectionStart }[]
    this.setMode("normal");
  }
  pushUndo() {
    const ta = this.ta;
    this.undoHistory.push({ value: ta.value, selectionStart: ta.selectionStart });
    if (this.undoHistory.length > MAX_UNDO) this.undoHistory.shift();
  }
  popUndo() {
    const state = this.undoHistory.pop();
    if (!state) return;
    this.ta.value = state.value;
    mvCursor(this.ta, Math.min(state.selectionStart, state.value.length));
    this.ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  setMode(mode) {
    const wasInsert = this.mode === "insert";
    this.mode = mode; this.pending = "";
    if (mode === "insert") {
      if (!wasInsert) this.pushUndo(); // save state before typing for undo
      setStatus("-- INSERT --");
    } else if (mode === "command") setStatus(":" + this.cmdBuffer);
    else if (mode === "visualBlock") setStatus("-- VISUAL BLOCK --");
    else if (mode === "visual") setStatus("-- VISUAL --");
    else setStatus("-- NORMAL --");
    this.ta.classList.toggle("vim-normal", mode === "normal");
    if (mode === "visualBlock" || mode === "visual") this.anchorOffset = this.ta.selectionStart;
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
    if (this.mode === "visualBlock") {
      e.preventDefault();
      const ta = this.ta;
      const val = ta.value;
      const cur = ta.selectionStart;
      if (e.key === "Escape") {
        mvCursor(ta, cur);
        this.setMode("normal");
        return;
      }
      if (e.key === "y") {
        const { minL, maxL, minC, maxC } = getBlockRect(val, this.anchorOffset, cur);
        this.yank = getBlockText(val, minL, maxL, minC, maxC);
        this.yankBlock = true;
        sharedYank = this.yank; sharedYankBlock = true;
        mvCursor(ta, posOfLine(val, minL) + minC);
        this.setMode("normal");
        return;
      }
      if (e.key === "d" || e.key === "x") {
        const { minL, maxL, minC, maxC } = getBlockRect(val, this.anchorOffset, cur);
        this.yank = getBlockText(val, minL, maxL, minC, maxC);
        this.yankBlock = true;
        sharedYank = this.yank; sharedYankBlock = true;
        this.pushUndo();
        const lines = val.split("\n");
        for (let i = minL; i <= maxL; i++) {
          const ln = lines[i] ?? "";
          lines[i] = ln.slice(0, minC) + ln.slice(maxC);
        }
        ta.value = lines.join("\n");
        mvCursor(ta, posOfLine(ta.value, minL) + Math.min(minC, (lines[minL] ?? "").length));
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        this.setMode("normal");
        return;
      }
      // Page scroll in visual block: move cursor (other corner)
      if (e.ctrlKey) {
        const k = e.key.toLowerCase();
        const n = this.linesInPage();
        let delta = 0;
        if (k === "d") delta = Math.max(1, Math.floor(n / 2));
        else if (k === "u") delta = -Math.max(1, Math.floor(n / 2));
        else if (k === "f") delta = Math.max(1, n);
        else if (k === "b") delta = -Math.max(1, n);
        if (delta !== 0) {
          const { lineStart, lineEnd, pos } = getLineInfo(ta);
          const col = colOf(val, pos);
          const ln = lineNum(val, pos);
          const lines = val.split("\n");
          const tl = Math.max(0, Math.min(lines.length - 1, ln + delta));
          const newPos = posOfLine(val, tl) + Math.min(col, (lines[tl] ?? "").length);
          mvCursor(ta, newPos);
          scrollRawCursorIntoView(ta);
          return;
        }
      }
      // Movement: move cursor then update selection to show block
      let newPos = cur;
      const { lineStart, lineEnd, pos } = getLineInfo(ta);
      const col = colOf(val, pos);
      const ln = lineNum(val, pos);
      const lines = val.split("\n");
      switch (e.key) {
        case "h": newPos = Math.max(lineStart, pos - 1); break;
        case "l": newPos = Math.min(lineEnd, pos + 1); break;
        case "0": newPos = lineStart; break;
        case "^": { const nw = val.slice(lineStart).search(/\S/); newPos = lineStart + (nw >= 0 ? nw : 0); break; }
        case "$": newPos = lineEnd; break;
        case "j":
          if (ln + 1 < lines.length)
            newPos = posOfLine(val, ln + 1) + Math.min(col, (lines[ln + 1] ?? "").length);
          break;
        case "k":
          if (ln > 0)
            newPos = posOfLine(val, ln - 1) + Math.min(col, (lines[ln - 1] ?? "").length);
          break;
        case "w": { this.moveWord(1); newPos = ta.selectionStart; break; }
        case "b": { this.moveWord(-1); newPos = ta.selectionStart; break; }
        case "G": newPos = posOfLine(val, lines.length - 1) + Math.min(col, (lines[lines.length - 1] ?? "").length); break;
        case "g": if (this.pending === "g") { this.pending = ""; newPos = 0; } else this.pending = "g"; break;
        default: return;
      }
      if (newPos !== cur || e.key === "g") {
        mvCursor(ta, newPos);
        scrollRawCursorIntoView(ta);
      }
      return;
    }
    if (this.mode === "visual") {
      e.preventDefault();
      const ta = this.ta;
      const val = ta.value;
      const cur = ta.selectionEnd; // visual: selection is anchor to cursor, cursor is the end
      if (e.key === "Escape") {
        mvCursor(ta, cur);
        this.setMode("normal");
        return;
      }
      if (e.key === "y") {
        const start = Math.min(this.anchorOffset, cur);
        const end = Math.max(this.anchorOffset, cur);
        this.yank = val.slice(start, end);
        this.yankBlock = false;
        sharedYank = this.yank; sharedYankBlock = false;
        mvCursor(ta, start);
        this.setMode("normal");
        return;
      }
      if (e.key === "d" || e.key === "x") {
        const start = Math.min(this.anchorOffset, cur);
        const end = Math.max(this.anchorOffset, cur);
        this.yank = val.slice(start, end);
        this.yankBlock = false;
        sharedYank = this.yank; sharedYankBlock = false;
        this.pushUndo();
        ta.value = val.slice(0, start) + val.slice(end);
        mvCursor(ta, Math.min(start, ta.value.length));
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        this.setMode("normal");
        return;
      }
      // Page scroll in visual: move selection end
      if (e.ctrlKey) {
        const k = e.key.toLowerCase();
        const n = this.linesInPage();
        let delta = 0;
        if (k === "d") delta = Math.max(1, Math.floor(n / 2));
        else if (k === "u") delta = -Math.max(1, Math.floor(n / 2));
        else if (k === "f") delta = Math.max(1, n);
        else if (k === "b") delta = -Math.max(1, n);
        if (delta !== 0) {
          const ln = lineNum(val, cur);
          const lines = val.split("\n");
          const col = colOf(val, cur);
          const tl = Math.max(0, Math.min(lines.length - 1, ln + delta));
          const newPos = posOfLine(val, tl) + Math.min(col, (lines[tl] ?? "").length);
          ta.setSelectionRange(Math.min(this.anchorOffset, newPos), Math.max(this.anchorOffset, newPos));
          scrollRawCursorIntoView(ta);
          return;
        }
      }
      let newPos = cur;
      const { lineStart, lineEnd } = gLS(val, cur);
      const col = colOf(val, cur);
      const ln = lineNum(val, cur);
      const lines = val.split("\n");
      switch (e.key) {
        case "h": newPos = Math.max(0, cur - 1); break;
        case "l": newPos = Math.min(val.length, cur + 1); break;
        case "0": newPos = lineStart; break;
        case "^": { const nw = val.slice(lineStart).search(/\S/); newPos = lineStart + (nw >= 0 ? nw : 0); break; }
        case "$": newPos = lineEnd; break;
        case "j":
          if (ln + 1 < lines.length)
            newPos = posOfLine(val, ln + 1) + Math.min(col, (lines[ln + 1] ?? "").length);
          break;
        case "k":
          if (ln > 0)
            newPos = posOfLine(val, ln - 1) + Math.min(col, (lines[ln - 1] ?? "").length);
          break;
        case "w": { ta.setSelectionRange(cur, cur); this.moveWord(1); newPos = ta.selectionStart; break; }
        case "b": { ta.setSelectionRange(cur, cur); this.moveWord(-1); newPos = ta.selectionStart; break; }
        case "G": newPos = val.length; break;
        case "g": if (this.pending === "g") { this.pending = ""; newPos = 0; } else this.pending = "g"; break;
        default: return;
      }
      if (newPos !== cur || e.key === "g") {
        const start = Math.min(this.anchorOffset, newPos);
        const end = Math.max(this.anchorOffset, newPos);
        ta.setSelectionRange(start, end);
        scrollRawCursorIntoView(ta);
      }
      return;
    }
    e.preventDefault();
    const ta = this.ta;
    const k = e.key.toLowerCase();
    // Handle Ctrl+key first (Ctrl+V can report as "v" with ctrlKey, but we handle all ctrl explicitly)
    if (e.ctrlKey) {
      if (k === "v") { this.setMode("visualBlock"); return; }
      if (k === "d") { this.pageDownHalf(); return; }
      if (k === "u") { this.pageUpHalf(); return; }
      if (k === "f") { this.pageDownFull(); return; }
      if (k === "b") { this.pageUpFull(); return; }
    }
    const { val, pos } = getLineInfo(ta);
    if (this.pending) {
      const seq = (this.pending + e.key).toLowerCase(); this.pending = "";
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
      case "v":
      case "V":
        this.setMode("visual");
        break;
      case "x": this.deleteChar(); break;
      case "u": this.popUndo(); break;
      case ":": this.cmdBuffer = ""; this.setMode("command"); break;
      default: break;
    }
  }
  pageDownHalf() {
    const n = this.linesInPage();
    this.moveVert(Math.max(1, Math.floor(n / 2)));
  }
  pageUpHalf() {
    const n = this.linesInPage();
    this.moveVert(-Math.max(1, Math.floor(n / 2)));
  }
  pageDownFull() {
    this.moveVert(Math.max(1, this.linesInPage()));
  }
  pageUpFull() {
    this.moveVert(-Math.max(1, this.linesInPage()));
  }
  /** Approximate number of visible lines in the textarea. */
  linesInPage() {
    const ta = this.ta;
    const style = getComputedStyle(ta);
    const lh = parseFloat(style.lineHeight);
    const lineHeight = (lh && !isNaN(lh)) ? lh : 20;
    return Math.max(1, Math.floor(ta.clientHeight / lineHeight));
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
    this.pushUndo();
    const ta = this.ta, val = ta.value, pos = ta.selectionStart;
    const { lineStart, lineEnd } = gLS(val, pos);
    let ds = lineStart, de = lineEnd;
    if (de < val.length) de++; else if (ds > 0) ds--;
    this.yank = val.slice(lineStart, lineEnd);
    this.yankBlock = false;
    sharedYank = this.yank; sharedYankBlock = false;
    ta.value = val.slice(0, ds) + val.slice(de);
    mvCursor(ta, Math.min(ds, ta.value.length));
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  yankLine() { const { val, pos } = getLineInfo(this.ta); const { lineStart, lineEnd } = gLS(val, pos); this.yank = val.slice(lineStart, lineEnd); this.yankBlock = false; sharedYank = this.yank; sharedYankBlock = false; }
  deleteChar() {
    const ta = this.ta, val = ta.value, pos = ta.selectionStart;
    if (pos >= gLS(val, pos).lineEnd) return;
    this.pushUndo();
    ta.value = val.slice(0, pos) + val.slice(pos + 1);
    mvCursor(ta, pos);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  paste(before) {
    const toPaste = this.yank || sharedYank;
    if (!toPaste) return;
    const useBlock = (this.yank ? this.yankBlock : sharedYankBlock);
    const ta = this.ta, val = ta.value, pos = ta.selectionStart;
    if (useBlock) {
      this.pushUndo();
      this.yank = toPaste; this.yankBlock = true;
      this.pasteBlock(pos, before);
      this.yankBlock = false;
      return;
    }
    this.pushUndo();
    const { lineStart, lineEnd } = gLS(val, pos);
    let ins, text;
    if (before) { ins = lineStart; text = toPaste + "\n"; }
    else { ins = lineEnd === val.length ? val.length : lineEnd + 1; text = (lineEnd === val.length ? "\n" : "") + toPaste + "\n"; }
    ta.value = val.slice(0, ins) + text + val.slice(ins);
    mvCursor(ta, ins);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  /** Paste block (rectangular) at position; before = insert before cursor line. */
  pasteBlock(pos, before) {
    const ta = this.ta;
    let val = ta.value;
    const lines = val.split("\n");
    const yankLines = this.yank.split("\n");
    if (!yankLines.length) return;
    const { line: startLine, col: startCol } = lineColOf(val, pos);
    const insertLine = before ? startLine : startLine + 1;
    for (let i = 0; i < yankLines.length; i++) {
      const lineIdx = insertLine + i;
      const line = lines[lineIdx] ?? "";
      const col = startCol;
      const toInsert = yankLines[i];
      if (line.length < col) {
        lines[lineIdx] = line + " ".repeat(col - line.length) + toInsert;
      } else {
        lines[lineIdx] = line.slice(0, col) + toInsert + line.slice(col);
      }
    }
    ta.value = lines.join("\n");
    const newPos = posOfLine(ta.value, insertLine) + startCol;
    mvCursor(ta, newPos);
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
