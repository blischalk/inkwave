import {
  currentTabRef, currentBlocks, contentEl,
} from "./state.js";
import { getApi } from "./api.js";
import { blocksToContent } from "./blocks.js";
import { getTabTitle, renderTabBar } from "./tabs.js";
import { showError } from "./utils.js";

// ── Per-tab undo / redo ───────────────────────────────────────────────────────

const MAX_UNDO = 50;

export function pushUndo(tab) {
  if (!tab) return;
  if (!tab._undoStack) tab._undoStack = [];
  if (!tab._redoStack) tab._redoStack = [];
  const snapshot = tab.content != null ? String(tab.content) : "";
  const top = tab._undoStack[tab._undoStack.length - 1];
  if (top === snapshot) return;
  tab._undoStack.push(snapshot);
  if (tab._undoStack.length > MAX_UNDO) tab._undoStack.shift();
  tab._redoStack = [];
}

export function undoTab(tab) {
  if (!tab || !tab._undoStack || !tab._undoStack.length) return false;
  if (!tab._redoStack) tab._redoStack = [];
  tab._redoStack.push(tab.content != null ? String(tab.content) : "");
  tab.content = tab._undoStack.pop();
  return true;
}

export function redoTab(tab) {
  if (!tab || !tab._redoStack || !tab._redoStack.length) return false;
  if (!tab._undoStack) tab._undoStack = [];
  tab._undoStack.push(tab.content != null ? String(tab.content) : "");
  tab.content = tab._redoStack.pop();
  return true;
}

export function saveToFile(tab) {
  if (!tab || !tab.path) return;
  const a = getApi();
  if (!a || typeof a.write_file !== "function") {
    showError("Save not available. Run from Inkwave.");
    return;
  }
  a.write_file(tab.path, tab.content)
    .then((res) => {
      if (res && res.error) {
        showError(res.error);
        return;
      }
    })
    .catch((err) => {
      showError((err && (err.message || err)) || "Save failed.");
    });
}

export function saveOrSaveAs(tab) {
  if (!tab) return;
  if (tab.path) {
    saveToFile(tab);
    return;
  }
  // No path yet — prompt Save As.
  const a = getApi();
  if (!a || typeof a.save_as !== "function") return;
  a.save_as(tab.title || "Untitled.md")
    .then((result) => {
      if (!result || !result.path) return;
      tab.path = result.path;
      tab.id = result.path;
      tab.title = getTabTitle(result.path);
      renderTabBar();
      saveToFile(tab);
    })
    .catch((err) => {
      showError((err && (err.message || err)) || "Save failed.");
    });
}

export function flushActiveEditAndSave() {
  const tab = currentTabRef;
  if (!tab || !tab.path) return;
  const editingBlock = contentEl.querySelector(".md-block.editing");
  if (editingBlock) {
    const editable = editingBlock.querySelector(".inline-edit");
    if (editable && currentBlocks.length) {
      const idx = parseInt(editingBlock.getAttribute("data-block-index"), 10);
      if (!isNaN(idx) && idx >= 0 && idx < currentBlocks.length) {
        const text = (
          editable.innerText != null
            ? editable.innerText
            : editable.textContent || ""
        ).replace(/\u00a0/g, " ");
        const raw = currentBlocks[idx].raw;
        let prefix = "";
        if (editingBlock.classList.contains("md-block-list") && raw) {
          const m = raw.match(/^(\s*[-*+]|\s*\d+\.)\s*/);
          if (m) prefix = m[1];
        }
        currentBlocks[idx].raw = prefix + text;
        tab.content = blocksToContent(currentBlocks);
      }
    }
  }
  saveToFile(tab);
}
