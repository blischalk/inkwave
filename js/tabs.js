import {
  tabs, activeTabId, setActiveTabId,
  tabBarEl,
  onShowTabContent, onShowWelcomeOrEmpty,
} from "./state.js";
import { escapeHtml } from "./utils.js";

export function getTabTitle(path) {
  if (!path) return "Welcome";
  if (path.toLowerCase().endsWith("welcome.md")) return "Welcome";
  return path.replace(/^.*[/\\]/, "");
}

export function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

export function addTab(options) {
  const path = options.path || null;
  const title = options.title != null ? options.title : getTabTitle(path);
  const content = options.content;
  const id =
    path || "unsaved-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  const existing = tabs.find((t) => t.id === id);
  if (existing) {
    if (content != null) existing.content = content;
    selectTab(id);
    return;
  }
  tabs.push({ id: id, path: path, title: title, content: content });
  setActiveTabId(id);
  renderTabBar();
  if (onShowTabContent) onShowTabContent(tabs[tabs.length - 1]);
}

export function closeTab(id, e) {
  if (e) e.stopPropagation();
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  tabs.splice(idx, 1);
  if (activeTabId === id) {
    if (tabs.length > 0) {
      const next = tabs[Math.min(idx, tabs.length - 1)];
      setActiveTabId(next.id);
      if (onShowTabContent) onShowTabContent(next);
    } else {
      setActiveTabId(null);
      if (onShowWelcomeOrEmpty) onShowWelcomeOrEmpty();
    }
  }
  renderTabBar();
}

export function selectTab(id) {
  setActiveTabId(id);
  const tab = tabs.find((t) => t.id === id);
  if (tab && onShowTabContent) onShowTabContent(tab);
  renderTabBar();
}

export function moveTab(fromIndex, toIndex) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= tabs.length ||
    toIndex >= tabs.length
  )
    return;
  const t = tabs.splice(fromIndex, 1)[0];
  tabs.splice(toIndex, 0, t);
  renderTabBar();
}

export function renderTabBar() {
  tabBarEl.innerHTML = "";
  if (tabs.length === 0) {
    tabBarEl.classList.add("hidden");
    return;
  }
  tabBarEl.classList.remove("hidden");
  tabs.forEach((tab, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab" + (tab.id === activeTabId ? " active" : "");
    btn.setAttribute("data-tab-id", tab.id);
    btn.setAttribute("data-tab-index", index);
    btn.setAttribute("draggable", "true");
    btn.innerHTML =
      '<span class="tab-title">' +
      escapeHtml(tab.title) +
      '</span><span class="tab-close" title="Close">×</span>';
    btn.addEventListener("click", (e) => {
      if (e.target.classList.contains("tab-close")) return;
      selectTab(tab.id);
    });
    btn.querySelector(".tab-close").addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab.id, e);
    });
    btn.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", tab.id);
      e.dataTransfer.effectAllowed = "move";
      e.target.classList.add("dragging");
    });
    btn.addEventListener("dragend", (e) => {
      e.target.classList.remove("dragging");
      tabBarEl.querySelectorAll(".tab.drop-target").forEach((el) => {
        el.classList.remove("drop-target");
      });
    });
    btn.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const overId = e.currentTarget.getAttribute("data-tab-id");
      if (e.dataTransfer.getData("text/plain") === overId) return;
      e.currentTarget.classList.add("drop-target");
    });
    btn.addEventListener("dragleave", (e) => {
      e.currentTarget.classList.remove("drop-target");
    });
    btn.addEventListener("drop", (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove("drop-target");
      const draggedId = e.dataTransfer.getData("text/plain");
      if (!draggedId || draggedId === tab.id) return;
      const fromIdx = tabs.findIndex((t) => t.id === draggedId);
      const toIdx = tabs.findIndex((t) => t.id === tab.id);
      if (fromIdx !== -1 && toIdx !== -1) moveTab(fromIdx, toIdx);
    });
    tabBarEl.appendChild(btn);
  });
}
