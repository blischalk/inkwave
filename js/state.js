// Shared mutable state, DOM refs, SVG icons, and callback slots.
// ES live bindings are read-only from outside, so every reassignable
// variable gets an explicit setter function.

// ── Mutable state ────────────────────────────────────────────────────────────
export let tabs = [];
export function setTabs(v) { tabs = v; }

export let activeTabId = null;
export function setActiveTabId(v) { activeTabId = v; }

export let currentBlocks = [];
export function setCurrentBlocks(v) { currentBlocks = v; }

export let currentTabRef = null;
export function setCurrentTabRef(v) { currentTabRef = v; }

export let _replacingContent = false;
export function setReplacingContent(v) { _replacingContent = v; }

export let treeRoot = null;
export function setTreeRootPath(v) { treeRoot = v; }

export let selectedPath = null;
export function setSelectedPath(v) { selectedPath = v; }

export let welcomeContent = null;
export function setWelcomeContent(v) { welcomeContent = v; }

export let rawMode = false;
export function setRawMode(v) { rawMode = v; }

export let vimMode = false;
export function setVimMode(v) { vimMode = v; }

// ── DOM refs ─────────────────────────────────────────────────────────────────
export const contentEl       = document.getElementById("content");
export const filenameEl      = document.getElementById("filename");
export const treeEl          = document.getElementById("tree");
export const sidebar         = document.getElementById("sidebar");
export const openBtn         = document.getElementById("openBtn");
export const openMenu        = document.getElementById("openMenu");
export const newFileBtn      = document.getElementById("newFileBtn");
export const treeContextMenu = document.getElementById("treeContextMenu");
export const newFileHereBtn  = document.getElementById("newFileHereBtn");
export const treeWrap        = document.querySelector(".tree-wrap");
export const deleteFileBtn   = document.getElementById("deleteFileBtn");
export const tabBarEl        = document.getElementById("tabBar");
export const themePicker     = document.getElementById("themePicker");
export const copyBtn         = document.getElementById("copyBtn");
export const rawModeBtn      = document.getElementById("rawModeBtn");
export const focusBtn        = document.getElementById("focusBtn");
export const focusExitBtn    = document.getElementById("focusExitBtn");
export const loadedChildren  = new Map();

// ── SVG icons ─────────────────────────────────────────────────────────────────
export const folderIcon =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';
export const fileIcon =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';

// ── Callback slots (break renderer ↔ editor circular dependency) ──────────────
export let onShowTabContent = null;
export function registerShowTabContent(fn) { onShowTabContent = fn; }

export let onShowWelcomeOrEmpty = null;
export function registerShowWelcomeOrEmpty(fn) { onShowWelcomeOrEmpty = fn; }

export let onStartInlineEdit = null;
export function registerStartInlineEdit(fn) { onStartInlineEdit = fn; }
