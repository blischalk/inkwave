import { vimMode, setVimMode, rawMode, contentEl } from "./state.js";
import { getApi } from "./api.js";
import { initBlockNav, clearBlockNav, applyVimMode, removeVimMode } from "./vim.js";

const settingsBtn   = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const vimToggle     = document.getElementById("vimModeToggle");

const STORAGE_KEY = "inkwave_settings";

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  // Also persist through the native API if available
  const a = getApi();
  if (a && typeof a.save_setting === "function") {
    Object.entries(settings).forEach(([k, v]) => a.save_setting(k, String(v)));
  }
}

export function initSettings() {
  const saved = loadSettings();
  if (saved.vimMode === true) {
    setVimMode(true);
    if (vimToggle) { vimToggle.checked = true; vimToggle.setAttribute("aria-checked", "true"); }
    // initBlockNav is called by renderer.js after content renders; no need to call here.
  }
}

function openSettings() {
  if (!settingsModal) return;
  // Sync toggle to current state before showing
  if (vimToggle) {
    vimToggle.checked = vimMode;
    vimToggle.setAttribute("aria-checked", vimMode ? "true" : "false");
  }
  settingsModal.hidden = false;
  settingsModal.removeAttribute("hidden");
}

function closeSettings() {
  if (!settingsModal) return;
  settingsModal.hidden = true;
}

if (settingsBtn) {
  settingsBtn.addEventListener("click", (e) => { e.stopPropagation(); openSettings(); });
}
if (settingsCloseBtn) {
  settingsCloseBtn.addEventListener("click", closeSettings);
}
if (settingsModal) {
  // Close when clicking the backdrop
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeSettings();
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && settingsModal && !settingsModal.hidden) {
    closeSettings();
    e.stopPropagation();
  }
});

if (vimToggle) {
  vimToggle.addEventListener("change", () => {
    const newVal = vimToggle.checked;
    setVimMode(newVal);
    vimToggle.setAttribute("aria-checked", newVal ? "true" : "false");
    const settings = loadSettings();
    settings.vimMode = newVal;
    saveSettings(settings);
    if (newVal) {
      initBlockNav();
      // If we're in raw mode, the raw textarea is already visible; apply vim to it.
      if (rawMode && contentEl) {
        const rawEditor = contentEl.querySelector(".raw-editor");
        if (rawEditor) applyVimMode(rawEditor);
      }
    } else {
      clearBlockNav();
      if (rawMode && contentEl) {
        const rawEditor = contentEl.querySelector(".raw-editor");
        if (rawEditor) removeVimMode(rawEditor);
      }
    }
  });
}
