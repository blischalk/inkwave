import { vimMode, setVimMode, rawMode, contentEl } from "./state.js";
import { getApi } from "./api.js";
import { initBlockNav, clearBlockNav, applyVimMode, removeVimMode } from "./vim.js";

const settingsBtn      = document.getElementById("settingsBtn");
const settingsModal    = document.getElementById("settingsModal");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const vimToggle        = document.getElementById("vimModeToggle");

// API key elements
const apiKeySetBtn    = document.getElementById("apiKeySetBtn");
const apiKeyDeleteBtn = document.getElementById("apiKeyDeleteBtn");
const apiKeyEntry     = document.getElementById("apiKeyEntry");
const apiKeyInput     = document.getElementById("apiKeyInput");
const apiKeySaveBtn   = document.getElementById("apiKeySaveBtn");
const apiKeyCancelBtn = document.getElementById("apiKeyCancelBtn");
const apiKeyStatus    = document.getElementById("apiKeyStatus");

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
  loadApiKeyStatus();
}

async function loadApiKeyStatus() {
  const api = getApi();
  if (!api || typeof api.get_api_key_status !== "function") return;
  try {
    const result = await api.get_api_key_status();
    updateApiKeyUI(result && result.has_key);
  } catch {
    updateApiKeyUI(false);
  }
}

function updateApiKeyUI(hasKey) {
  if (apiKeyStatus) {
    apiKeyStatus.textContent = hasKey ? "Key saved" : "Not set";
    apiKeyStatus.style.color = hasKey ? "var(--accent)" : "";
  }
  if (apiKeySetBtn) apiKeySetBtn.textContent = hasKey ? "Replace" : "Set key";
  if (apiKeyDeleteBtn) {
    if (hasKey) {
      apiKeyDeleteBtn.removeAttribute("hidden");
    } else {
      apiKeyDeleteBtn.setAttribute("hidden", "");
    }
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
  // Refresh API key status each time settings opens (in case it changed)
  loadApiKeyStatus();
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

// API key button wiring
if (apiKeySetBtn) {
  apiKeySetBtn.addEventListener("click", () => {
    if (apiKeyEntry) {
      apiKeyEntry.removeAttribute("hidden");
      if (apiKeyInput) { apiKeyInput.value = ""; apiKeyInput.focus(); }
    }
  });
}
if (apiKeyCancelBtn) {
  apiKeyCancelBtn.addEventListener("click", () => {
    if (apiKeyEntry) apiKeyEntry.setAttribute("hidden", "");
    if (apiKeyInput) apiKeyInput.value = "";
  });
}
if (apiKeySaveBtn) {
  apiKeySaveBtn.addEventListener("click", async () => {
    const key = apiKeyInput ? apiKeyInput.value.trim() : "";
    if (!key) return;
    const api = getApi();
    if (!api) return;
    try {
      const result = await api.save_api_key(key);
      if (result && result.ok) {
        if (apiKeyEntry) apiKeyEntry.setAttribute("hidden", "");
        if (apiKeyInput) apiKeyInput.value = "";
        updateApiKeyUI(true);
      } else {
        if (apiKeyStatus) {
          apiKeyStatus.textContent = result && result.error ? result.error : "Save failed";
          apiKeyStatus.style.color = "var(--error, #f95959)";
        }
      }
    } catch {
      if (apiKeyStatus) {
        apiKeyStatus.textContent = "Save failed";
        apiKeyStatus.style.color = "var(--error, #f95959)";
      }
    }
  });
}
if (apiKeyDeleteBtn) {
  apiKeyDeleteBtn.addEventListener("click", async () => {
    const api = getApi();
    if (!api) return;
    try {
      await api.delete_api_key();
    } catch { /* ignore */ }
    updateApiKeyUI(false);
  });
}

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
