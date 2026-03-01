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

/** Update block raw so the first image has the given width/height (px). Handles ![alt](url) and <img>. */
function updateBlockRawWithImageSize(raw, widthPx, heightPx) {
  const w = String(Math.max(1, Math.round(widthPx)));
  const h = String(Math.max(1, Math.round(heightPx)));
  const mdImage = /!\[([^\]]*)\]\(([^)]+)\)/;
  const m = raw.match(mdImage);
  if (m) {
    const alt = (m[1] || "").replace(/"/g, "&quot;");
    const src = (m[2] || "").replace(/"/g, "&quot;");
    return raw.replace(mdImage, `<img src="${src}" alt="${alt}" width="${w}" height="${h}">`);
  }
  const imgTag = /<img\s+([^>]*?)>/i;
  if (imgTag.test(raw)) {
    return raw.replace(imgTag, (_, attrs) => {
      const noSize = attrs
        .replace(/\s*width\s*=\s*["'][^"']*["']/gi, "")
        .replace(/\s*height\s*=\s*["'][^"']*["']/gi, "")
        .trim();
      return `<img ${noSize} width="${w}" height="${h}">`;
    });
  }
  return raw;
}

/** Remove the first image (markdown or HTML) from block raw. Returns trimmed string or "". */
function removeImageFromBlockRaw(raw) {
  const s = String(raw || "").trim();
  const withoutMd = s.replace(/!\[[^\]]*\]\([^)]+\)/, "").trim();
  const withoutHtml = withoutMd.replace(/<img[^>]*>/gi, "").trim();
  return withoutHtml;
}

function wireImageResize(container, tab, blocks) {
  const blockEls = container.querySelectorAll(".md-block:not(.editing)");
  blockEls.forEach((blockEl) => {
    const imgs = blockEl.querySelectorAll("img");
    imgs.forEach((img) => {
      if (img.closest(".md-image-wrap")) return;
      const wrap = document.createElement("span");
      wrap.className = "md-image-wrap";
      img.parentNode.insertBefore(wrap, img);
      wrap.appendChild(img);
      const handle = document.createElement("span");
      handle.className = "md-image-resize-handle";
      handle.setAttribute("aria-label", "Resize image");
      wrap.appendChild(handle);
      const blockIndex = parseInt(blockEl.getAttribute("data-block-index"), 10);
      if (isNaN(blockIndex) || blockIndex < 0 || blockIndex >= blocks.length) return;
      wrap.setAttribute("tabindex", "-1");
      wrap.addEventListener("click", (e) => {
        if (e.target.classList.contains("md-image-resize-handle")) return;
        e.stopPropagation();
        container.querySelectorAll(".md-image-wrap.md-image-selected").forEach((w) => {
          w.classList.remove("md-image-selected");
          w.blur();
        });
        wrap.classList.add("md-image-selected");
        wrap.focus();
      });
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = img.getBoundingClientRect();
        const startLeft = rect.left;
        const startTop = rect.top;
        const startW = img.offsetWidth;
        const startH = img.offsetHeight;
        const aspectRatio = startW / startH;
        const onMove = (e2) => {
          const scaleX = (e2.clientX - startLeft) / startW;
          const scaleY = (e2.clientY - startTop) / startH;
          const scale = Math.max(scaleX, scaleY, 50 / startW, 50 / startH);
          const newW = Math.max(50, Math.round(startW * scale));
          const newH = Math.max(50, Math.round(newW / aspectRatio));
          img.style.width = newW + "px";
          img.style.height = newH + "px";
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          const blocksCopy = blocks.slice();
          const newRaw = updateBlockRawWithImageSize(
            blockRaw(blocksCopy[blockIndex]),
            img.offsetWidth,
            img.offsetHeight,
          );
          blocksCopy[blockIndex] = { ...blocksCopy[blockIndex], raw: newRaw };
          tab.content = blocksToContent(blocksCopy);
          currentTabRef.content = tab.content;
          setCurrentBlocks(blocksCopy);
          saveToFile(tab);
          if (onShowTabContent) onShowTabContent(tab);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    });
  });
}

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

    // Wire double-click to start edit (single-click + drag can select text for copy)
    contentEl.querySelectorAll(".md-block").forEach((blockEl) => {
      blockEl.addEventListener("dblclick", (e) => {
        if (e.target.classList && e.target.classList.contains("inline-edit"))
          return;
        const idx = parseInt(blockEl.getAttribute("data-block-index"), 10);
        if (isNaN(idx) || idx < 0 || idx >= currentBlocks.length) return;
        if (onStartInlineEdit) onStartInlineEdit(blockEl, idx, currentBlocks, tab, e);
      });
    });
    contentEl
      .querySelectorAll(".md-block-code")
      .forEach((codeBlockEl) => {
        const pre = codeBlockEl.querySelector("pre");
        if (!pre) return;
        pre.addEventListener("dblclick", (e) => {
          if (codeBlockEl.classList.contains("editing")) return;
          const idx = parseInt(codeBlockEl.getAttribute("data-block-index"), 10);
          if (isNaN(idx) || idx < 0 || idx >= currentBlocks.length) return;
          if (onStartInlineEdit) onStartInlineEdit(codeBlockEl, idx, currentBlocks, tab, e);
        });
      });
    wireImageResize(contentEl, tab, currentBlocks);
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

// Delete selected image on Delete/Backspace (capture so we run before other handlers)
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    const selected = contentEl.querySelector(".md-image-wrap.md-image-selected");
    if (!selected) return;
    const blockEl = selected.closest(".md-block");
    if (!blockEl) return;
    const tab = currentTabRef;
    if (!tab || !tab.path) return;
    const blockIndex = parseInt(blockEl.getAttribute("data-block-index"), 10);
    if (isNaN(blockIndex) || blockIndex < 0 || blockIndex >= currentBlocks.length) return;
    e.preventDefault();
    e.stopPropagation();
    // Remove the image from the DOM first so it disappears immediately (webview repaints this)
    selected.remove();
    // Then update state and save so the file and in-memory content stay in sync
    const blocksCopy = currentBlocks.slice();
    const newRaw = removeImageFromBlockRaw(blockRaw(blocksCopy[blockIndex]));
    blocksCopy[blockIndex] = { ...blocksCopy[blockIndex], raw: newRaw };
    tab.content = blocksToContent(blocksCopy);
    currentTabRef.content = tab.content;
    setCurrentBlocks(blocksCopy);
    saveToFile(tab);
  },
  true,
);

document.addEventListener("click", (e) => {
  if (!e.target.closest(".md-image-wrap")) {
    contentEl.querySelectorAll(".md-image-wrap.md-image-selected").forEach((w) => w.classList.remove("md-image-selected"));
  }
});
