import { vimMode, setVimMode, rawMode, contentEl, setLlmProvider, setLlmModel, llmProvider, llmModel } from "./state.js";
import { getApi } from "./api.js";
import { initBlockNav, clearBlockNav, applyVimMode, removeVimMode } from "./vim.js";

const settingsBtn      = document.getElementById("settingsBtn");
const settingsModal    = document.getElementById("settingsModal");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const vimToggle           = document.getElementById("vimModeToggle");
const gradientBoldToggle  = document.getElementById("gradientBoldToggle");

// Provider / model selects (settings panel)
const llmProviderSelect = document.getElementById("llmProviderSelect");
const llmModelSelect    = document.getElementById("llmModelSelect");

// Provider key sections
const anthropicKeySection  = document.getElementById("anthropicKeySection");
const openaiKeySection     = document.getElementById("openaiKeySection");
const geminiKeySection     = document.getElementById("geminiKeySection");
const ollamaSection        = document.getElementById("ollamaSection");

// Anthropic key elements
const anthropicKeyStatus    = document.getElementById("anthropicKeyStatus");
const anthropicKeySetBtn    = document.getElementById("anthropicKeySetBtn");
const anthropicKeyDeleteBtn = document.getElementById("anthropicKeyDeleteBtn");
const anthropicKeyEntry     = document.getElementById("anthropicKeyEntry");
const anthropicKeyInput     = document.getElementById("anthropicKeyInput");
const anthropicKeySaveBtn   = document.getElementById("anthropicKeySaveBtn");
const anthropicKeyCancelBtn = document.getElementById("anthropicKeyCancelBtn");

// OpenAI key elements
const openaiKeyStatus    = document.getElementById("openaiKeyStatus");
const openaiKeySetBtn    = document.getElementById("openaiKeySetBtn");
const openaiKeyDeleteBtn = document.getElementById("openaiKeyDeleteBtn");
const openaiKeyEntry     = document.getElementById("openaiKeyEntry");
const openaiKeyInput     = document.getElementById("openaiKeyInput");
const openaiKeySaveBtn   = document.getElementById("openaiKeySaveBtn");
const openaiKeyCancelBtn = document.getElementById("openaiKeyCancelBtn");

// Gemini key elements
const geminiKeyStatus    = document.getElementById("geminiKeyStatus");
const geminiKeySetBtn    = document.getElementById("geminiKeySetBtn");
const geminiKeyDeleteBtn = document.getElementById("geminiKeyDeleteBtn");
const geminiKeyEntry     = document.getElementById("geminiKeyEntry");
const geminiKeyInput     = document.getElementById("geminiKeyInput");
const geminiKeySaveBtn   = document.getElementById("geminiKeySaveBtn");
const geminiKeyCancelBtn = document.getElementById("geminiKeyCancelBtn");

// Ollama elements
const ollamaUrlInput   = document.getElementById("ollamaUrlInput");
const ollamaRefreshBtn = document.getElementById("ollamaRefreshBtn");

const STORAGE_KEY = "inkwave_settings";

export const PROVIDER_MODELS = {
  anthropic: [
    "claude-sonnet-4-6",
    "claude-opus-4-6",
    "claude-haiku-4-5-20251001",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
  ],
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4",
    "gpt-3.5-turbo",
    "o1",
    "o1-mini",
    "o3-mini",
  ],
  gemini: [
    "gemini-2.5-pro-preview-05-06",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
  ],
  ollama: [],
};

export function applyGradientBold(enabled) {
  document.body.setAttribute("data-bold-gradient", enabled ? "on" : "off");
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  const a = getApi();
  if (a && typeof a.save_setting === "function") {
    Object.entries(settings).forEach(([k, v]) => a.save_setting(k, String(v)));
  }
}

// ── Model select (generic — works with any <select> element) ──────────────────

export function populateModelSelect(provider, selectEl, currentModel) {
  if (!selectEl) return;
  const models = PROVIDER_MODELS[provider] || [];
  selectEl.innerHTML = "";
  if (models.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = provider === "ollama" ? "No models (start Ollama)" : "No models available";
    selectEl.appendChild(opt);
    return;
  }
  let matched = false;
  models.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    if (m === currentModel) { opt.selected = true; matched = true; }
    selectEl.appendChild(opt);
  });
  if (!matched) selectEl.options[0].selected = true;
}

// ── Provider section visibility ───────────────────────────────────────────────

function updateProviderSections(provider) {
  [anthropicKeySection, openaiKeySection, geminiKeySection, ollamaSection].forEach(el => {
    if (el) el.setAttribute("hidden", "");
  });
  const show = { anthropic: anthropicKeySection, openai: openaiKeySection,
                 gemini: geminiKeySection, ollama: ollamaSection }[provider];
  if (show) show.removeAttribute("hidden");
}

// ── Ollama model fetch ────────────────────────────────────────────────────────

export async function fetchOllamaModels() {
  const api = getApi();
  if (!api || typeof api.list_ollama_models !== "function") return [];
  try {
    const result = await api.list_ollama_models();
    PROVIDER_MODELS.ollama = (result && result.models) ? result.models : [];
    return PROVIDER_MODELS.ollama;
  } catch {
    PROVIDER_MODELS.ollama = [];
    return [];
  }
}

// ── Key status helpers ────────────────────────────────────────────────────────

function updateKeyUI(statusEl, setBtn, deleteBtn, hasKey) {
  if (statusEl) {
    statusEl.textContent = hasKey ? "Key saved" : "Not set";
    statusEl.style.color = hasKey ? "var(--accent)" : "";
  }
  if (setBtn) setBtn.textContent = hasKey ? "Replace" : "Set key";
  if (deleteBtn) {
    if (hasKey) deleteBtn.removeAttribute("hidden");
    else        deleteBtn.setAttribute("hidden", "");
  }
}

async function loadKeyStatus(provider, statusEl, setBtn, deleteBtn) {
  const api = getApi();
  if (!api || typeof api.get_provider_api_key_status !== "function") return;
  try {
    const result = await api.get_provider_api_key_status(provider);
    updateKeyUI(statusEl, setBtn, deleteBtn, result && result.has_key);
  } catch {
    updateKeyUI(statusEl, setBtn, deleteBtn, false);
  }
}

async function loadAllKeyStatuses() {
  await Promise.all([
    loadKeyStatus("anthropic", anthropicKeyStatus, anthropicKeySetBtn, anthropicKeyDeleteBtn),
    loadKeyStatus("openai",    openaiKeyStatus,    openaiKeySetBtn,    openaiKeyDeleteBtn),
    loadKeyStatus("gemini",    geminiKeyStatus,    geminiKeySetBtn,    geminiKeyDeleteBtn),
  ]);
}

// ── Reusable key wiring ───────────────────────────────────────────────────────

function wireProviderKey(provider, { setBtn, deleteBtn, entry, input, saveBtn, cancelBtn, statusEl }) {
  if (setBtn) {
    setBtn.addEventListener("click", () => {
      if (entry) { entry.removeAttribute("hidden"); if (input) { input.value = ""; input.focus(); } }
    });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      if (entry) entry.setAttribute("hidden", "");
      if (input) input.value = "";
    });
  }
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const key = input ? input.value.trim() : "";
      if (!key) return;
      const api = getApi();
      if (!api) return;
      try {
        const result = await api.save_provider_api_key(provider, key);
        if (result && result.ok) {
          if (entry) entry.setAttribute("hidden", "");
          if (input) input.value = "";
          updateKeyUI(statusEl, setBtn, deleteBtn, true);
        } else {
          if (statusEl) {
            statusEl.textContent = result && result.error ? result.error : "Save failed";
            statusEl.style.color = "var(--error, #f95959)";
          }
        }
      } catch {
        if (statusEl) { statusEl.textContent = "Save failed"; statusEl.style.color = "var(--error, #f95959)"; }
      }
    });
  }
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      const api = getApi();
      if (!api) return;
      try { await api.delete_provider_api_key(provider); } catch { /* ignore */ }
      updateKeyUI(statusEl, setBtn, deleteBtn, false);
    });
  }
}

// ── initSettings ─────────────────────────────────────────────────────────────

export function initSettings() {
  const saved = loadSettings();

  // Gradient bold text (default on)
  const gradientBoldOn = saved.gradientBold !== false;
  applyGradientBold(gradientBoldOn);
  if (gradientBoldToggle) {
    gradientBoldToggle.checked = gradientBoldOn;
    gradientBoldToggle.setAttribute("aria-checked", gradientBoldOn ? "true" : "false");
  }

  // Vim mode
  if (saved.vimMode === true) {
    setVimMode(true);
    if (vimToggle) { vimToggle.checked = true; vimToggle.setAttribute("aria-checked", "true"); }
  }

  // Provider / model
  const savedProvider = saved.llmProvider || "anthropic";
  const savedModel    = saved.llmModel    || "claude-sonnet-4-6";
  setLlmProvider(savedProvider);
  setLlmModel(savedModel);
  if (llmProviderSelect) llmProviderSelect.value = savedProvider;
  populateModelSelect(savedProvider, llmModelSelect, savedModel);
  updateProviderSections(savedProvider);
  if (savedProvider === "ollama") {
    fetchOllamaModels().then(() => populateModelSelect("ollama", llmModelSelect, savedModel));
  }

  // Ollama URL
  if (ollamaUrlInput && saved.ollamaBaseUrl) ollamaUrlInput.value = saved.ollamaBaseUrl;

  loadAllKeyStatuses();
}

// ── Open / close settings ─────────────────────────────────────────────────────

function openSettings() {
  if (!settingsModal) return;
  if (vimToggle) {
    vimToggle.checked = vimMode;
    vimToggle.setAttribute("aria-checked", vimMode ? "true" : "false");
  }
  // Sync selects to current state (may have been changed via chat panel)
  if (llmProviderSelect) llmProviderSelect.value = llmProvider;
  populateModelSelect(llmProvider, llmModelSelect, llmModel);
  updateProviderSections(llmProvider);
  settingsModal.hidden = false;
  settingsModal.removeAttribute("hidden");
  loadAllKeyStatuses();
}

function closeSettings() {
  if (!settingsModal) return;
  settingsModal.hidden = true;
}

// ── Event listeners ───────────────────────────────────────────────────────────

if (settingsBtn)      settingsBtn.addEventListener("click", (e) => { e.stopPropagation(); openSettings(); });
if (settingsCloseBtn) settingsCloseBtn.addEventListener("click", closeSettings);
if (settingsModal)    settingsModal.addEventListener("click", (e) => { if (e.target === settingsModal) closeSettings(); });

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && settingsModal && !settingsModal.hidden) {
    closeSettings();
    e.stopPropagation();
  }
});

if (llmProviderSelect) {
  llmProviderSelect.addEventListener("change", async () => {
    const p = llmProviderSelect.value;
    setLlmProvider(p);
    if (p === "ollama") await fetchOllamaModels();
    populateModelSelect(p, llmModelSelect, "");
    const m = llmModelSelect ? llmModelSelect.value : "";
    setLlmModel(m);
    updateProviderSections(p);
    const s = loadSettings(); s.llmProvider = p; s.llmModel = m; saveSettings(s);
    document.dispatchEvent(new CustomEvent("llm-changed", { detail: { provider: p, model: m } }));
  });
}

if (llmModelSelect) {
  llmModelSelect.addEventListener("change", () => {
    const m = llmModelSelect.value;
    setLlmModel(m);
    const s = loadSettings(); s.llmModel = m; saveSettings(s);
    document.dispatchEvent(new CustomEvent("llm-changed", { detail: { provider: llmProvider, model: m } }));
  });
}

if (ollamaUrlInput) {
  ollamaUrlInput.addEventListener("change", () => {
    const s = loadSettings();
    s.ollamaBaseUrl = ollamaUrlInput.value.trim() || "http://localhost:11434";
    saveSettings(s);
  });
}

if (ollamaRefreshBtn) {
  ollamaRefreshBtn.addEventListener("click", async () => {
    await fetchOllamaModels();
    populateModelSelect("ollama", llmModelSelect, llmModel);
  });
}

// Wire all provider key sections
wireProviderKey("anthropic", {
  setBtn: anthropicKeySetBtn, deleteBtn: anthropicKeyDeleteBtn,
  entry: anthropicKeyEntry,   input: anthropicKeyInput,
  saveBtn: anthropicKeySaveBtn, cancelBtn: anthropicKeyCancelBtn,
  statusEl: anthropicKeyStatus,
});
wireProviderKey("openai", {
  setBtn: openaiKeySetBtn, deleteBtn: openaiKeyDeleteBtn,
  entry: openaiKeyEntry,   input: openaiKeyInput,
  saveBtn: openaiKeySaveBtn, cancelBtn: openaiKeyCancelBtn,
  statusEl: openaiKeyStatus,
});
wireProviderKey("gemini", {
  setBtn: geminiKeySetBtn, deleteBtn: geminiKeyDeleteBtn,
  entry: geminiKeyEntry,   input: geminiKeyInput,
  saveBtn: geminiKeySaveBtn, cancelBtn: geminiKeyCancelBtn,
  statusEl: geminiKeyStatus,
});

if (gradientBoldToggle) {
  gradientBoldToggle.addEventListener("change", () => {
    const newVal = gradientBoldToggle.checked;
    applyGradientBold(newVal);
    gradientBoldToggle.setAttribute("aria-checked", newVal ? "true" : "false");
    const s = loadSettings(); s.gradientBold = newVal; saveSettings(s);
  });
}

if (vimToggle) {
  vimToggle.addEventListener("change", () => {
    const newVal = vimToggle.checked;
    setVimMode(newVal);
    vimToggle.setAttribute("aria-checked", newVal ? "true" : "false");
    const s = loadSettings(); s.vimMode = newVal; saveSettings(s);
    if (newVal) {
      initBlockNav();
      if (rawMode && contentEl) { const raw = contentEl.querySelector(".raw-editor"); if (raw) applyVimMode(raw); }
    } else {
      clearBlockNav();
      if (rawMode && contentEl) { const raw = contentEl.querySelector(".raw-editor"); if (raw) removeVimMode(raw); }
    }
  });
}

// ── Sync from chat panel (or any other source) ───────────────────────────────
document.addEventListener("llm-changed", ({ detail }) => {
  if (settingsModal && settingsModal.hidden) return; // only sync if open
  if (llmProviderSelect && llmProviderSelect.value !== detail.provider) {
    llmProviderSelect.value = detail.provider;
    populateModelSelect(detail.provider, llmModelSelect, detail.model);
    updateProviderSections(detail.provider);
  } else if (llmModelSelect && llmModelSelect.value !== detail.model) {
    llmModelSelect.value = detail.model;
  }
});
