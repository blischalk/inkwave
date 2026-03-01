import {
  contentEl, filenameEl,
  sidebar, openBtn, openMenu, newFileBtn, copyBtn,
  treeContextMenu, newFileHereBtn, treeWrap, deleteFileBtn,
  themePicker, focusBtn, focusExitBtn,
  treeRoot,
  setActiveTabId,
} from "./state.js";
import { getApi } from "./api.js";
import { escapeHtml, showError } from "./utils.js";
import { getTabTitle, addTab, renderTabBar, getActiveTab, closeTab } from "./tabs.js";
import { initTree, openFile, selectFile, createInFolder, refreshFolder } from "./filetree.js";
import { saveOrSaveAs, flushActiveEditAndSave } from "./fileio.js";
import { render } from "./renderer.js";

// ── Theme ─────────────────────────────────────────────────────────────────────
export function applyTheme(themeId) {
  document.body.setAttribute("data-theme", themeId);
  themePicker.value = themeId;
}

themePicker.addEventListener("change", function () {
  applyTheme(this.value);
  const a = getApi();
  if (a && typeof a.save_setting === "function") {
    a.save_setting("theme", this.value);
  }
});

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

document.addEventListener("click", () => {
  openMenu.classList.remove("visible");
  treeContextMenu.classList.remove("visible");
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

// ── Global keyboard shortcuts ─────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isFocusMode()) {
    setFocusMode(false);
    e.preventDefault();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    const tab = getActiveTab();
    if (tab) {
      e.preventDefault();
      saveOrSaveAs(tab);
    }
  }
});

// ── beforeunload ──────────────────────────────────────────────────────────────
window.addEventListener("beforeunload", () => {
  flushActiveEditAndSave();
});

// ── Drag-and-drop to open markdown files ──────────────────────────────────────
const dropOverlay = document.getElementById("dropOverlay");

function isMarkdown(name) {
  return /\.(md|markdown)$/i.test(name);
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
  for (let i = 0; i < files.length; i++) {
    if (isMarkdown(files[i].name)) {
      openDroppedFile(files[i]);
    }
  }
});
