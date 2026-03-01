import {
  currentTabRef, currentBlocks, contentEl,
} from "./state.js";
import { getApi } from "./api.js";
import { blocksToContent } from "./blocks.js";
import { getTabTitle, renderTabBar } from "./tabs.js";
import { showError } from "./utils.js";

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
