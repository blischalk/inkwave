import {
  setTreeRootPath,
  setSelectedPath,
  treeEl, newFileBtn, loadedChildren,
  folderIcon, fileIcon,
  tabs,
} from "./state.js";
import { escapeHtml, showError } from "./utils.js";
import { getApi } from "./api.js";
import { getTabTitle, addTab, selectTab } from "./tabs.js";
import { render } from "./renderer.js";

export function initTree(rootPath, initialFilePath) {
  setTreeRootPath(rootPath);
  if (newFileBtn) newFileBtn.disabled = !rootPath;
  loadedChildren.clear();
  treeEl.innerHTML = "";
  if (!rootPath) return;
  const rootName = rootPath.split(/[/\\]/).filter(Boolean).pop() || rootPath;
  const rootLi = document.createElement("li");
  rootLi.className = "tree-item folder";
  rootLi.dataset.path = rootPath;
  rootLi.dataset.isDir = "1";
  rootLi.innerHTML =
    '<div class="tree-item-row"><span class="expand">▶</span><span class="icon">' +
    folderIcon +
    '</span><span class="name">' +
    escapeHtml(rootName) +
    "</span></div>";
  rootLi.classList.add("expanded");
  treeEl.appendChild(rootLi);
  rootLi.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFolder(rootLi);
  });
  loadChildren(rootPath, rootLi);
  if (initialFilePath) {
    selectFile(initialFilePath);
  }
}

function loadChildren(dirPath, parentLi) {
  if (loadedChildren.has(dirPath)) return;
  loadedChildren.set(dirPath, []);
  const a = getApi();
  if (!a) return;
  a.list_dir(dirPath)
    .then((res) => {
      const entries = res.entries || [];
      loadedChildren.set(dirPath, entries);
      renderTreeChildren(parentLi, entries);
    })
    .catch(() => {});
}

function renderTreeChildren(parentLi, entries) {
  let ul = parentLi.querySelector("ul");
  if (!ul) {
    ul = document.createElement("ul");
    parentLi.appendChild(ul);
  }
  ul.innerHTML = "";
  entries.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "tree-item " + (entry.isDir ? "folder" : "file");
    li.dataset.path = entry.path;
    li.dataset.isDir = entry.isDir ? "1" : "0";
    const expandCls = entry.isDir ? "expand" : "expand empty";
    const icon = entry.isDir ? folderIcon : fileIcon;
    li.innerHTML =
      '<div class="tree-item-row"><span class="' +
      expandCls +
      '">' +
      (entry.isDir ? "▶" : "") +
      '</span><span class="icon">' +
      icon +
      '</span><span class="name">' +
      escapeHtml(entry.name) +
      "</span></div>";
    ul.appendChild(li);
    li.addEventListener("click", (e) => {
      e.stopPropagation();
      if (entry.isDir) toggleFolder(li);
      else openFile(entry.path);
    });
  });
}

function toggleFolder(li) {
  const path = li.dataset.path;
  const isDir = li.dataset.isDir === "1";
  if (!path || !isDir) return;
  const expanded = li.classList.toggle("expanded");
  if (expanded) {
    const entries = loadedChildren.get(path);
    if (entries !== undefined) renderTreeChildren(li, entries);
    else loadChildren(path, li);
  }
}

export function openFile(path) {
  document.querySelectorAll(".tree-item.selected").forEach((el) => {
    el.classList.remove("selected");
  });
  document.querySelectorAll(".tree-item").forEach((el) => {
    if (el.dataset.path === path) el.classList.add("selected");
  });
  setSelectedPath(path);
  const existing = tabs.find((t) => t.path === path);
  if (existing) {
    const a = getApi();
    if (a) {
      a.read_file(path).then((data) => {
        if (data && data.content != null) existing.content = data.content;
        selectTab(existing.id);
      }).catch(() => selectTab(existing.id));
    } else {
      selectTab(existing.id);
    }
    return;
  }
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
        } else if (data && data.error) {
          render({ path: path, content: null, error: data.error });
        }
      })
      .catch(showError);
  }
}

export function selectFile(path) {
  document.querySelectorAll(".tree-item").forEach((el) => {
    if (el.dataset.path === path) el.classList.add("selected");
  });
  setSelectedPath(path);
}

function getTreeItemByPath(path) {
  let found = null;
  treeEl.querySelectorAll(".tree-item").forEach((el) => {
    if (el.dataset.path === path) found = el;
  });
  return found;
}

export function refreshFolder(folderPath) {
  const a = getApi();
  if (!a) return;
  a.list_dir(folderPath)
    .then((res) => {
      const entries = res.entries || [];
      loadedChildren.set(folderPath, entries);
      const parentLi = getTreeItemByPath(folderPath);
      if (parentLi) renderTreeChildren(parentLi, entries);
    })
    .catch(() => {});
}

export function createInFolder(folderPath) {
  const name = prompt("Enter filename (e.g. My Note.md):", "Untitled.md");
  if (name == null || !name.trim()) return;
  const a = getApi();
  if (!a || typeof a.create_file !== "function") {
    showError("Create file not available.");
    return;
  }
  a.create_file(folderPath, name.trim())
    .then((data) => {
      if (data && data.error) {
        showError(data.error);
        return;
      }
      if (data && data.path) {
        refreshFolder(folderPath);
        openFile(data.path);
      }
    })
    .catch((err) => {
      showError((err && (err.message || err)) || "Failed to create file.");
    });
}
