import {
  contentEl, filenameEl,
  sidebar, openBtn, openMenu, newFileBtn, copyBtn,
  treeContextMenu, newFileHereBtn, treeWrap, deleteFileBtn,
  focusBtn, focusExitBtn,
  treeRoot,
  setActiveTabId,
  currentTabRef, currentBlocks, setCurrentBlocks, onShowTabContent,
  rawMode, setRawMode, rawModeBtn,
  docFontSize, setDocFontSize,
} from "./state.js";
import { loadSettings, saveSettings } from "./settings.js";
import { getApi } from "./api.js";
import { escapeHtml, showError } from "./utils.js";
import { getTabTitle, addTab, renderTabBar, getActiveTab, closeTab } from "./tabs.js";
import { initTree, openFile, selectFile, createInFolder, refreshFolder } from "./filetree.js";
import { saveToFile, saveOrSaveAs, flushActiveEditAndSave } from "./fileio.js";
import { getBlocks, blocksToContent } from "./blocks.js";
import { getBlockModeContentOffset } from "./vim.js";
import { render } from "./renderer.js";
import { launchDoom } from "./doom.js";
import { applySplit, closeSplit } from "./panes.js";
import { splitMode } from "./state.js";
import { open as openSearch, close as closeSearch, isOpen as isSearchOpen } from "./search.js";

// ── Easter egg ────────────────────────────────────────────────────────────────
const _logo = document.querySelector(".app-logo");
if (_logo) {
  let _clicks = [];
  _logo.addEventListener("click", () => {
    const now = Date.now();
    _clicks.push(now);
    _clicks = _clicks.filter(t => now - t < 2000);
    if (_clicks.length >= 5) {
      _clicks = [];
      launchDoom();
    }
  });
}

// ── Theme ─────────────────────────────────────────────────────────────────────
const themePickerWrap  = document.getElementById("themePickerWrap");
const themePickerBtn   = document.getElementById("themePickerBtn");
const themePickerLabel = document.getElementById("themePickerLabel");
const themePickerList  = document.getElementById("themePickerList");
const themeOptions     = themePickerList
  ? [...themePickerList.querySelectorAll("li[data-value]")]
  : [];

let _committedTheme = null;
let _focusedIndex   = -1;

export function applyTheme(themeId) {
  document.body.setAttribute("data-theme", themeId);
  const opt = themeOptions.find((li) => li.dataset.value === themeId);
  if (themePickerLabel) themePickerLabel.textContent = opt ? opt.textContent : themeId;
  themeOptions.forEach((li) =>
    li.setAttribute("aria-selected", li.dataset.value === themeId ? "true" : "false"),
  );
}

function isPickerOpen() {
  return themePickerList && !themePickerList.hidden;
}

function highlightOption(index, preview = true) {
  themeOptions.forEach((li, i) => li.classList.toggle("focused", i === index));
  if (index >= 0 && index < themeOptions.length) {
    themeOptions[index].scrollIntoView({ block: "nearest" });
    if (preview) applyTheme(themeOptions[index].dataset.value);
  }
}

function openPicker() {
  if (!themePickerList || !themePickerBtn) return;
  _committedTheme = document.body.getAttribute("data-theme") || "obsidianite";
  themePickerList.hidden = false;
  themePickerBtn.setAttribute("aria-expanded", "true");
  _focusedIndex = themeOptions.findIndex((li) => li.dataset.value === _committedTheme);
  if (_focusedIndex < 0) _focusedIndex = 0;
  highlightOption(_focusedIndex, false);
}

function closePicker(revert) {
  if (!themePickerList || !themePickerBtn) return;
  themePickerList.hidden = true;
  themePickerBtn.setAttribute("aria-expanded", "false");
  themeOptions.forEach((li) => li.classList.remove("focused"));
  if (revert && _committedTheme) applyTheme(_committedTheme);
}

function commitOption(themeId) {
  closePicker(false);
  applyTheme(themeId);
  if (themePickerBtn) themePickerBtn.focus();
  const a = getApi();
  if (a && typeof a.save_setting === "function") a.save_setting("theme", themeId);
}

if (themePickerBtn) {
  themePickerBtn.addEventListener("click", () => {
    isPickerOpen() ? closePicker(true) : openPicker();
  });
}

if (themePickerList) {
  themePickerList.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-value]");
    if (li) commitOption(li.dataset.value);
  });
}

// ── Focus mode ────────────────────────────────────────────────────────────────
export function setFocusMode(on) {
  document.body.setAttribute("data-focus-mode", on ? "true" : "false");
  const a = getApi();
  if (a && typeof a.toggle_fullscreen === "function") {
    a.toggle_fullscreen();
  }
}

function isFocusMode() {
  return document.body.getAttribute("data-focus-mode") === "true";
}

if (focusBtn) {
  focusBtn.addEventListener("click", () => { setFocusMode(true); });
}
if (focusExitBtn) {
  focusExitBtn.addEventListener("click", () => { setFocusMode(false); });
}

// ── Copy selection ────────────────────────────────────────────────────────────
function copySelectionToClipboard() {
  const sel = document.getSelection();
  const text = sel ? sel.toString().trim() : "";
  if (!text) return false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
    return true;
  }
  return false;
}

if (copyBtn) {
  copyBtn.addEventListener("click", () => {
    if (copySelectionToClipboard()) {
      const origTitle = copyBtn.getAttribute("title");
      copyBtn.setAttribute("title", "Copied!");
      copyBtn.setAttribute("aria-label", "Copied!");
      setTimeout(() => {
        copyBtn.setAttribute("title", origTitle || "Copy selection");
        copyBtn.setAttribute("aria-label", origTitle || "Copy selection");
      }, 1500);
    }
  });
}

document.addEventListener("copy", (e) => {
  const sel = document.getSelection();
  const text = sel ? sel.toString() : "";
  if (text && e.clipboardData) {
    e.clipboardData.setData("text/plain", text);
    e.preventDefault();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "a" || (!e.metaKey && !e.ctrlKey)) return;
  const activeInContent = contentEl && contentEl.contains(document.activeElement);
  const sel = document.getSelection();
  const selectionInContent = sel?.anchorNode && contentEl?.contains(sel.anchorNode);
  if (!activeInContent && !selectionInContent) return;
  const rendered = contentEl?.querySelector(".rendered");
  if (!rendered) return;
  e.preventDefault();
  const range = document.createRange();
  range.selectNodeContents(rendered);
  sel.removeAllRanges();
  sel.addRange(range);
});

// ── Open file / folder ────────────────────────────────────────────────────────
function onOpenFile() {
  openMenu.classList.remove("visible");
  const a = getApi();
  if (!a) {
    contentEl.className = "content";
    contentEl.innerHTML =
      '<div class="rendered"><div class="error">API not available. Run this app from Inkwave.</div></div>';
    return;
  }
  a.open_file()
    .then((data) => {
      if (!data) return;
      if (data.error) {
        render({ path: data.path, content: null, error: data.error });
        return;
      }
      addTab({
        path: data.path,
        title: getTabTitle(data.path),
        content: data.content,
      });
      initTree(data.root, null);
      selectFile(data.path);
    })
    .catch(showError);
}

function onOpenFolder() {
  openMenu.classList.remove("visible");
  const a = getApi();
  if (!a) {
    contentEl.className = "content";
    contentEl.innerHTML =
      '<div class="rendered"><div class="error">API not available. Run this app from Inkwave.</div></div>';
    return;
  }
  a.open_folder()
    .then((data) => {
      if (!data) return;
      if (data.error) {
        contentEl.className = "content";
        contentEl.innerHTML =
          '<div class="rendered"><div class="error">' +
          escapeHtml(data.error) +
          "</div></div>";
        return;
      }
      initTree(data.root, null);
      setActiveTabId(null);
      renderTabBar();
      contentEl.className = "content empty";
      contentEl.innerHTML = "Select a file from the tree to view it.";
      filenameEl.textContent = "";
    })
    .catch(showError);
}

openBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  openMenu.classList.toggle("visible");
});
openMenu.querySelectorAll("button").forEach((btn) => {
  btn.addEventListener("click", function () {
    if (this.dataset.action === "file") onOpenFile();
    else onOpenFolder();
  });
});

// ── Sidebar toggle ────────────────────────────────────────────────────────────
sidebar.querySelector(".sidebar-toggle").addEventListener("click", function () {
  sidebar.classList.toggle("collapsed");
  this.textContent = sidebar.classList.contains("collapsed") ? "▶" : "◀";
  this.title = sidebar.classList.contains("collapsed")
    ? "Show file tree"
    : "Collapse file tree";
});
document
  .getElementById("showSidebarBtn")
  .addEventListener("click", () => {
    sidebar.classList.remove("collapsed");
    sidebar.querySelector(".sidebar-toggle").textContent = "◀";
    sidebar.querySelector(".sidebar-toggle").title = "Collapse file tree";
  });

// ── Sidebar resize ────────────────────────────────────────────────────────────
const SIDEBAR_MIN_W = 150;
const SIDEBAR_MAX_W = 600;
const SIDEBAR_WIDTH_KEY = "inkwave_sidebar_width";

const sidebarResizeHandle = document.getElementById("sidebarResizeHandle");
let _sidebarResizing = false;
let _sidebarResizeStartX = 0;
let _sidebarResizeStartW = 0;

const _savedSidebarWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY);
if (_savedSidebarWidth) sidebar.style.setProperty("--sidebar-w", _savedSidebarWidth);

sidebarResizeHandle.addEventListener("mousedown", (e) => {
  if (sidebar.classList.contains("collapsed")) return;
  _sidebarResizing = true;
  _sidebarResizeStartX = e.clientX;
  _sidebarResizeStartW = sidebar.getBoundingClientRect().width;
  sidebar.classList.add("resizing");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (!_sidebarResizing) return;
  const w = Math.max(
    SIDEBAR_MIN_W,
    Math.min(SIDEBAR_MAX_W, _sidebarResizeStartW + (e.clientX - _sidebarResizeStartX))
  );
  sidebar.style.setProperty("--sidebar-w", w + "px");
});

document.addEventListener("mouseup", () => {
  if (!_sidebarResizing) return;
  _sidebarResizing = false;
  sidebar.classList.remove("resizing");
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebar.style.getPropertyValue("--sidebar-w"));
});

// ── New file button ───────────────────────────────────────────────────────────
if (newFileBtn) newFileBtn.disabled = true;
newFileBtn.addEventListener("click", () => {
  if (!treeRoot || newFileBtn.disabled) return;
  createInFolder(treeRoot);
});

// ── Context menu ──────────────────────────────────────────────────────────────
let contextMenuFolderPath = null;
let contextMenuFilePath = null;

if (treeWrap) {
  treeWrap.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const item = e.target.closest(".tree-item");
    if (item) {
      const isDir = item.dataset.isDir === "1";
      const path = item.dataset.path || "";
      if (isDir) {
        contextMenuFolderPath = path;
        contextMenuFilePath = null;
      } else {
        contextMenuFolderPath = path.replace(/[/\\][^/\\]+$/, "") || path;
        contextMenuFilePath = path;
      }
      newFileHereBtn.style.display = "block";
      deleteFileBtn.style.display = isDir ? "none" : "block";
    } else {
      contextMenuFolderPath = treeRoot;
      contextMenuFilePath = null;
      newFileHereBtn.style.display = treeRoot ? "block" : "none";
      deleteFileBtn.style.display = "none";
    }
    treeContextMenu.classList.add("visible");
    treeContextMenu.style.left = e.clientX + "px";
    treeContextMenu.style.top = e.clientY + "px";
  });
}

newFileHereBtn.addEventListener("click", () => {
  treeContextMenu.classList.remove("visible");
  if (contextMenuFolderPath) {
    createInFolder(contextMenuFolderPath);
    contextMenuFolderPath = null;
  }
});

deleteFileBtn.addEventListener("click", () => {
  treeContextMenu.classList.remove("visible");
  if (!contextMenuFilePath) return;
  const path = contextMenuFilePath;
  contextMenuFilePath = null;
  if (!confirm("Delete this file? This cannot be undone.")) return;
  const a = getApi();
  if (!a || typeof a.delete_file !== "function") {
    showError("Delete not available.");
    return;
  }
  a.delete_file(path)
    .then((res) => {
      if (res && res.error) {
        showError(res.error);
        return;
      }
      const parentPath = path.replace(/[/\\][^/\\]+$/, "").replace(/^$/, path);
      if (parentPath !== path) refreshFolder(parentPath);
      closeTab(path);
    })
    .catch((err) => {
      showError((err && (err.message || err)) || "Failed to delete file.");
    });
});

document.addEventListener("click", (e) => {
  openMenu.classList.remove("visible");
  treeContextMenu.classList.remove("visible");
  if (isPickerOpen() && themePickerWrap && !themePickerWrap.contains(e.target)) {
    closePicker(true);
  }
});

// ── Mode buttons (buttons not present in current HTML — kept for compatibility) ─
const modeReadBtn = document.getElementById("modeReadBtn");
const modeEditBtn = document.getElementById("modeEditBtn");
if (modeReadBtn)
  modeReadBtn.addEventListener("click", () => {
    const tab = getActiveTab();
    if (tab) switchToReadMode(tab);
  });
if (modeEditBtn)
  modeEditBtn.addEventListener("click", () => {
    const tab = getActiveTab();
    if (tab && tab.path) switchToEditMode(tab);
  });

// ── Raw mode toggle ───────────────────────────────────────────────────────────
if (rawModeBtn) {
  rawModeBtn.addEventListener("click", () => {
    const newMode = !rawMode;
    const tab = getActiveTab();
    if (tab) {
      if (newMode) {
        // Switching to raw: save block-mode cursor so raw editor can restore it.
        const offset = getBlockModeContentOffset();
        if (offset != null) tab.savedCursorContentOffset = offset;
      } else {
        // Switching to block: save raw editor cursor so block view can restore it.
        const rawEditor = contentEl && contentEl.querySelector(".raw-editor");
        if (rawEditor && typeof rawEditor.selectionStart === "number")
          tab.savedCursorContentOffset = rawEditor.selectionStart;
      }
    }
    setRawMode(newMode);
    rawModeBtn.setAttribute("aria-pressed", newMode ? "true" : "false");
    if (tab && onShowTabContent) onShowTabContent(tab);
  });
}

// ── Font size ────────────────────────────────────────────────────────────────
const FONT_SIZE_DEFAULT = 0.95;
const FONT_SIZE_MIN = 0.6;
const FONT_SIZE_MAX = 2.0;
const FONT_SIZE_STEP = 0.05;

function changeFontSize(delta) {
  const next = delta === 0
    ? FONT_SIZE_DEFAULT
    : Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round((docFontSize + delta) * 100) / 100));
  setDocFontSize(next);
  const rendered = contentEl.querySelector(".rendered");
  if (rendered) rendered.style.fontSize = next + "rem";
  const raw = contentEl.querySelector(".raw-editor");
  if (raw) raw.style.fontSize = next + "rem";
  const s = loadSettings();
  s.docFontSize = next;
  saveSettings(s);
}

// ── Global keyboard shortcuts ─────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "p") { e.preventDefault(); window.print(); return; }
  if (isPickerOpen()) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      _focusedIndex = Math.min(_focusedIndex + 1, themeOptions.length - 1);
      highlightOption(_focusedIndex);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      _focusedIndex = Math.max(_focusedIndex - 1, 0);
      highlightOption(_focusedIndex);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (_focusedIndex >= 0) commitOption(themeOptions[_focusedIndex].dataset.value);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closePicker(true);
      if (themePickerBtn) themePickerBtn.focus();
      return;
    }
  }
  if (e.key === "Escape" && isSearchOpen()) {
    e.preventDefault();
    closeSearch();
    return;
  }
  if (e.key === "Escape" && isFocusMode()) {
    setFocusMode(false);
    e.preventDefault();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "f") {
    e.preventDefault();
    openSearch();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    const tab = getActiveTab();
    if (tab) {
      e.preventDefault();
      saveOrSaveAs(tab);
    }
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
    e.preventDefault();
    changeFontSize(+FONT_SIZE_STEP);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "-") {
    e.preventDefault();
    changeFontSize(-FONT_SIZE_STEP);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "0") {
    e.preventDefault();
    changeFontSize(0);
    return;
  }
});

// ── beforeunload ──────────────────────────────────────────────────────────────
window.addEventListener("beforeunload", () => {
  flushActiveEditAndSave();
});

// ── Drag-and-drop: open markdown files / insert images ────────────────────────
const dropOverlay = document.getElementById("dropOverlay");

function isMarkdown(name) {
  return /\.(md|markdown)$/i.test(name);
}

function isImageFile(file) {
  return file.type && file.type.startsWith("image/");
}

function insertImageBlock(tab, imageMarkdown, insertAfterIndex) {
  const blocks = getBlocks(tab.content || "");
  const newBlock = { type: "paragraph", raw: imageMarkdown };
  const idx = typeof insertAfterIndex === "number" && insertAfterIndex >= 0
    ? Math.min(insertAfterIndex + 1, blocks.length)
    : blocks.length;
  blocks.splice(idx, 0, newBlock);
  tab.content = blocksToContent(blocks);
  if (currentTabRef === tab) {
    setCurrentBlocks(blocks);
  }
  saveToFile(tab);
  if (onShowTabContent) onShowTabContent(tab);
}

function getBlockIndexUnderPoint(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return -1;
  const block = el.closest && el.closest(".md-block");
  if (!block) return -1;
  const idx = parseInt(block.getAttribute("data-block-index"), 10);
  return isNaN(idx) ? -1 : idx;
}

function openDroppedFile(file) {
  // Prefer the native path (available in pywebview's WKWebView) so saving
  // works normally.  Fall back to FileReader for content-only viewing.
  const path = file.path || null;
  if (path && isMarkdown(path)) {
    const a = getApi();
    if (a) {
      a.read_file(path)
        .then((data) => {
          if (data && data.content != null) {
            addTab({
              path: data.path,
              title: getTabTitle(data.path),
              content: data.content,
            });
            // Set the file's parent directory as the tree root if no folder is open yet.
            if (!treeRoot) {
              const dir = path.replace(/[/\\][^/\\]+$/, "");
              initTree(dir, null);
            }
            selectFile(data.path);
          } else {
            showError((data && data.error) || "Could not read file.");
          }
        })
        .catch(showError);
      return;
    }
  }
  // Fallback: read content via FileReader (path not exposed by the webview).
  // Immediately prompt Save As so the tab gets a real path and auto-saves normally.
  const reader = new FileReader();
  reader.onload = (e) => {
    addTab({ path: null, title: file.name, content: e.target.result });
    const newTab = getActiveTab();
    if (newTab && !newTab.path) saveOrSaveAs(newTab);
  };
  reader.onerror = () => {
    showError("Could not read dropped file.");
  };
  reader.readAsText(file);
}

document.addEventListener("dragenter", (e) => {
  const types = e.dataTransfer && e.dataTransfer.types;
  if (
    types &&
    ([...types].includes("Files") ||
      [...types].includes("application/x-moz-file"))
  ) {
    dropOverlay.classList.add("active");
  }
});

document.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});

document.addEventListener("dragleave", (e) => {
  // Only hide when leaving the window entirely.
  if (!e.relatedTarget) dropOverlay.classList.remove("active");
});

document.addEventListener("drop", (e) => {
  e.preventDefault();
  dropOverlay.classList.remove("active");
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || files.length === 0) return;

  const imageFiles = [...files].filter(isImageFile);
  const tab = currentTabRef;
  if (imageFiles.length > 0 && tab && tab.path) {
    const file = imageFiles[0];
    const dropX = e.clientX;
    const dropY = e.clientY;
    const dropTarget = e.target;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const base64 = dataUrl.indexOf(",") >= 0 ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
      const api = getApi();
      if (!api || typeof api.save_image !== "function") {
        showError("Cannot save image.");
        return;
      }
      api
        .save_image(tab.path, file.name, base64)
        .then((res) => {
          if (res && res.error) {
            showError(res.error);
            return;
          }
          const alt = (file.name || "image").replace(/\.[^.]+$/, "") || "image";
          const imageMd = `![${alt}](${res.name})`;
          const insertIndex = contentEl.contains(dropTarget)
            ? getBlockIndexUnderPoint(dropX, dropY)
            : -1;
          insertImageBlock(tab, imageMd, insertIndex);
        })
        .catch(showError);
    };
    reader.onerror = () => showError("Could not read image.");
    reader.readAsDataURL(file);
    return;
  }

  for (let i = 0; i < files.length; i++) {
    if (isMarkdown(files[i].name)) {
      openDroppedFile(files[i]);
    }
  }
});

// ── Print / Save as PDF ───────────────────────────────────────────────────────
const printBtn = document.getElementById('printBtn');
if (printBtn) {
  printBtn.addEventListener('click', () => window.print());
}


// ── Split screen ──────────────────────────────────────────────────────────────
const splitVBtn = document.getElementById('splitVBtn');
const splitHBtn = document.getElementById('splitHBtn');

if (splitVBtn) {
  splitVBtn.addEventListener('click', () => {
    splitMode === 'vertical' ? closeSplit() : applySplit('vertical');
  });
}
if (splitHBtn) {
  splitHBtn.addEventListener('click', () => {
    splitMode === 'horizontal' ? closeSplit() : applySplit('horizontal');
  });
}
