import {
  contentEl, filenameEl,
  currentBlocks, currentTabRef, welcomeContent, _replacingContent,
  setCurrentBlocks, setCurrentTabRef, setReplacingContent,
  registerShowTabContent, registerShowWelcomeOrEmpty,
  onStartInlineEdit,
} from "./state.js";
import { escapeHtml, highlightCodeInContainer } from "./utils.js";
import {
  blockRaw, getBlocks, blocksToContent,
  getListPrefix, isOrderedListPrefix, getListItemDisplayHtml,
} from "./blocks.js";
import { getTabTitle } from "./tabs.js";
import { saveToFile } from "./fileio.js";
import { dbg } from "./debug.js";

export function showTabContent(tab, preferredBlocks) {
  if (!tab) return;
  setReplacingContent(true);
  try {
    if (tab.content == null && !tab.path) {
      contentEl.className = "content";
      contentEl.innerHTML =
        '<div class="rendered"><div class="error">Content not loaded.</div></div>';
      filenameEl.textContent = tab.path ? getTabTitle(tab.path) : tab.title;
      return;
    }
    let blocks;
    if (preferredBlocks && preferredBlocks.length >= 0) {
      blocks = preferredBlocks;
      tab.content = blocksToContent(blocks);
      dbg("showTabContent: using preferredBlocks length=", blocks.length);
    } else {
      const contentStr =
        tab.content != null && tab.content !== undefined
          ? String(tab.content)
          : "";
      if (
        currentTabRef === tab &&
        currentBlocks.length > 0 &&
        blocksToContent(currentBlocks) === contentStr
      ) {
        blocks = currentBlocks;
      } else {
        blocks = getBlocks(contentStr);
      }
    }
    setCurrentBlocks(blocks);
    setCurrentTabRef(tab);
    if (blocks.length === 0) {
      contentEl.className = "content read-mode";
      contentEl.innerHTML =
        '<div class="rendered"><div class="md-block md-block-empty md-block-paragraph" data-block-index="0">' +
        marked.parse("\n") +
        "</div></div>";
      highlightCodeInContainer(contentEl);
      setCurrentBlocks([{ raw: "", type: "paragraph" }]);
    } else {
      let html = '<div class="rendered">';
      let i = 0;
      while (i < blocks.length) {
        const b = blocks[i];
        const raw = blockRaw(b);
        const type = typeof b === "string" ? "paragraph" : b.type || "paragraph";
        if (type === "list") {
          const prefix = getListPrefix(raw);
          const listTag = isOrderedListPrefix(prefix) ? "ol" : "ul";
          let listHtml = "<" + listTag + ' class="md-list-container">';
          while (i < blocks.length) {
            const lb = blocks[i];
            const lraw = blockRaw(lb);
            const ltype =
              typeof lb === "string" ? "paragraph" : lb.type || "paragraph";
            if (ltype !== "list") break;
            const lprefix = getListPrefix(lraw);
            if (isOrderedListPrefix(lprefix) !== isOrderedListPrefix(prefix))
              break;
            listHtml +=
              '<li class="md-block md-block-list" data-block-index="' +
              i +
              '">' +
              getListItemDisplayHtml(lraw) +
              "</li>";
            i++;
          }
          listHtml += "</" + listTag + ">";
          html += listHtml;
          continue;
        }
        const depth = typeof b === "object" && b.depth;
        const typeClass =
          "md-block-" +
          escapeHtml(type) +
          (type === "heading" && depth ? " md-block-heading-" + depth : "");
        html +=
          '<div class="md-block ' +
          typeClass +
          '" data-block-index="' +
          i +
          '">' +
          marked.parse(raw) +
          "</div>";
        i++;
      }
      html += "</div>";
      contentEl.className = "content read-mode";
      contentEl.innerHTML = html;
      highlightCodeInContainer(contentEl);
    }
    filenameEl.textContent = tab.path ? getTabTitle(tab.path) : tab.title || "";

    // Wire click handlers — use callback to avoid circular import with editor.js
    contentEl.querySelectorAll(".md-block").forEach((blockEl) => {
      blockEl.addEventListener("click", (e) => {
        if (e.target.classList && e.target.classList.contains("inline-edit"))
          return;
        const idx = parseInt(blockEl.getAttribute("data-block-index"), 10);
        if (isNaN(idx) || idx < 0 || idx >= currentBlocks.length) return;
        if (onStartInlineEdit) onStartInlineEdit(blockEl, idx, currentBlocks, tab, e);
      });
    });
    // Ensure clicks anywhere inside a code block's <pre>/<code> trigger editing,
    // since webkit may not bubble clicks from scrollable <pre> elements reliably.
    contentEl
      .querySelectorAll(".md-block-code")
      .forEach((codeBlockEl) => {
        const pre = codeBlockEl.querySelector("pre");
        if (!pre) return;
        pre.addEventListener("click", (e) => {
          if (codeBlockEl.classList.contains("editing")) return;
          const idx = parseInt(codeBlockEl.getAttribute("data-block-index"), 10);
          if (isNaN(idx) || idx < 0 || idx >= currentBlocks.length) return;
          if (onStartInlineEdit) onStartInlineEdit(codeBlockEl, idx, currentBlocks, tab, e);
        });
      });
    // Click anywhere in content area (including padding/empty space) but not on a block → new paragraph
    contentEl.onclick = (e) => {
      if (e.target.closest(".md-block")) return;
      if (!currentTabRef || !currentBlocks) return;
      if (!contentEl.querySelector(".rendered")) return;
      const blocks = currentBlocks.slice();
      const newIndex = blocks.length;
      blocks.push({ raw: "", type: "paragraph" });
      tab.content = blocksToContent(blocks);
      currentTabRef.content = tab.content;
      setCurrentBlocks(blocks);
      saveToFile(tab);
      requestAnimationFrame(() => {
        showTabContent(tab, currentBlocks);
        setTimeout(() => {
          const newBlockEl = contentEl.querySelector(
            '.md-block[data-block-index="' + newIndex + '"]',
          );
          if (!newBlockEl) return;
          if (onStartInlineEdit) onStartInlineEdit(newBlockEl, newIndex, currentBlocks, tab, null);
        }, 0);
      });
    };
    const isEmptyFile =
      currentBlocks.length === 1 &&
      (currentBlocks[0].raw === "" || !currentBlocks[0].raw);
    if (isEmptyFile) {
      const firstBlock = contentEl.querySelector(
        '.md-block[data-block-index="0"]',
      );
      if (firstBlock) {
        setTimeout(() => {
          if (onStartInlineEdit) onStartInlineEdit(firstBlock, 0, currentBlocks, tab, null);
        }, 0);
      }
    }
  } finally {
    setReplacingContent(false);
  }
}

export function showWelcomeOrEmpty() {
  if (welcomeContent) {
    contentEl.className = "content";
    contentEl.innerHTML =
      '<div class="rendered">' + marked.parse(welcomeContent) + "</div>";
    highlightCodeInContainer(contentEl);
    filenameEl.textContent = "Welcome";
  } else {
    contentEl.className = "content empty";
    contentEl.innerHTML =
      "Open a file or folder to view markdown files. Only folders and .md files are shown in the tree.";
    filenameEl.textContent = "";
  }
}

export function render(data) {
  if (!data) return;
  if (data.error) {
    contentEl.className = "content";
    contentEl.innerHTML =
      '<div class="rendered"><div class="error">Error: ' +
      escapeHtml(data.error) +
      "</div></div>";
    filenameEl.textContent = data.path || "";
    return;
  }
  if (data.content == null) return;
  filenameEl.textContent =
    data.path && data.path.toLowerCase().endsWith("welcome.md")
      ? "Welcome"
      : data.path || "";
  contentEl.className = "content";
  contentEl.innerHTML =
    '<div class="rendered">' + marked.parse(data.content) + "</div>";
  highlightCodeInContainer(contentEl);
}

// Register callbacks so tabs.js and editor.js can reach us without a direct import.
registerShowTabContent(showTabContent);
registerShowWelcomeOrEmpty(showWelcomeOrEmpty);
