import {
  contentEl, filenameEl, tabs,
  setWelcomeContent, setVimMode, setLlmProvider, setLlmModel, setDocFontSize, setGradientBold,
  showWelcomeOnStartup, setShowWelcomeOnStartup, setFullWidth,
} from "./state.js";
import { loadSettings, saveSettings, applyGradientBold, applyFullWidth } from "./settings.js";
import { getApi } from "./api.js";
import { highlightCodeInContainer } from "./utils.js";
import { applyTheme } from "./ui.js";
import { addTab } from "./tabs.js";
import { initTree, selectFile } from "./filetree.js";

// ── window.__applySettings ────────────────────────────────────────────────────
// Called by Python before/after loading settings from disk.
window.__applySettings = function (dataStr) {
  try {
    const settings = JSON.parse(dataStr);
    if (settings && settings.theme) {
      applyTheme(settings.theme);
    }
    if (settings && settings.vimMode === "true") {
      setVimMode(true);
      const toggle = document.getElementById("vimModeToggle");
      if (toggle) { toggle.checked = true; toggle.setAttribute("aria-checked", "true"); }
    }
    if (settings && settings.llmProvider) {
      setLlmProvider(settings.llmProvider);
      const sel = document.getElementById("llmProviderSelect");
      if (sel) sel.value = settings.llmProvider;
    }
    if (settings && settings.llmModel) {
      setLlmModel(settings.llmModel);
    }
    if (settings && settings.ollamaBaseUrl) {
      const input = document.getElementById("ollamaUrlInput");
      if (input) input.value = settings.ollamaBaseUrl;
    }
    if (settings && settings.docFontSize) {
      setDocFontSize(Number(settings.docFontSize));
    }
    if (settings && settings.gradientBold === "false") {
      setGradientBold(false);
      applyGradientBold(false);
    }
    if (settings && settings.fullWidth === "true") {
      setFullWidth(true);
      applyFullWidth(true);
    }
  } catch (e) {}
};

// Restore appearance settings from localStorage (for non-Python-injected settings path)
(function () {
  try {
    const s = loadSettings();
    if (s.docFontSize) setDocFontSize(Number(s.docFontSize));
    if (s.gradientBold === false) applyGradientBold(false);
    if (s.fullWidth === true) { setFullWidth(true); applyFullWidth(true); }
  } catch (e) {}
})();

// ── renderWelcomeContent ───────────────────────────────────────────────────────
// Shared render body for both __applyWelcome and loadWelcome()'s finish().
// Renders the parsed Welcome.md content and appends the inline dismiss checkbox.
function renderWelcomeContent(data) {
  setWelcomeContent(data.content);
  if (tabs.length > 0) return;
  if (typeof marked === "undefined" || typeof marked.parse !== "function") {
    showFallbackContent();
    return;
  }
  contentEl.className = "content";
  contentEl.innerHTML =
    '<div class="rendered">' + marked.parse(data.content) + "</div>";
  highlightCodeInContainer(contentEl);
  const r = contentEl.querySelector(".rendered");
  if (r) applyScaleZoom(r);
  filenameEl.textContent = "Welcome";

  const dismissRow = document.createElement("label");
  dismissRow.className = "welcome-dismiss-row";
  dismissRow.innerHTML =
    '<input type="checkbox" id="welcomeDismissCheckbox"> ' +
    "Don't show this on startup";
  contentEl.appendChild(dismissRow);
  const dismissCheckbox = dismissRow.querySelector("#welcomeDismissCheckbox");
  dismissCheckbox.addEventListener("change", () => {
    const checked = dismissCheckbox.checked;
    const newVal = !checked;
    setShowWelcomeOnStartup(newVal);
    const s = loadSettings();
    s.showWelcomeOnStartup = newVal;
    saveSettings(s);
    const settingsToggle = document.getElementById("showWelcomeToggle");
    if (settingsToggle) {
      settingsToggle.checked = newVal;
      settingsToggle.setAttribute("aria-checked", newVal ? "true" : "false");
    }
  });
}

// ── window.__applyWelcome ─────────────────────────────────────────────────────
// Called by Python to inject Welcome.md content directly (fast path).
window.__applyWelcome = function (dataStr) {
  try {
    const data = JSON.parse(dataStr);
    if (data && data.content != null) {
      if (!showWelcomeOnStartup) return;
      renderWelcomeContent(data);
    }
  } catch (e) {}
};

// ── window.__openFileFromArg ──────────────────────────────────────────────────
// Called by Python when a .md file is passed via sys.argv (e.g. Finder open).
window.__openFileFromArg = function (dataStr) {
  try {
    const data = JSON.parse(dataStr);
    if (data && data.path && data.content != null) {
      addTab({ path: data.path, content: data.content });
      if (data.root) {
        initTree(data.root, null);
        selectFile(data.path);
      }
    }
  } catch (e) {}
};

// ── Fallback timeout (4 s) ────────────────────────────────────────────────────
setTimeout(() => {
  if (
    contentEl.classList.contains("empty") &&
    contentEl.textContent.indexOf("Loading") !== -1
  ) {
    contentEl.className = "content empty";
    contentEl.innerHTML =
      "Open a file or folder to view markdown files. Only folders and .md files are shown in the tree.";
  }
}, 4000);

// ── Welcome screen loading ────────────────────────────────────────────────────
function showFallbackContent() {
  contentEl.className = "content empty";
  contentEl.innerHTML =
    "Open a file or folder to view markdown files. Only folders and .md files are shown in the tree.";
}

export function loadWelcome() {
  const a = getApi();
  if (!a || typeof a.get_welcome !== "function") {
    showFallbackContent();
    return;
  }
  let done = false;
  function finish(data) {
    if (done) return;
    done = true;
    if (data && data.content) {
      if (!showWelcomeOnStartup) {
        showFallbackContent();
        return;
      }
      renderWelcomeContent(data);
    } else {
      showFallbackContent();
    }
  }
  const timeoutId = setTimeout(() => { finish(null); }, 2500);
  a.get_welcome()
    .then((data) => {
      clearTimeout(timeoutId);
      finish(data);
    })
    .catch(() => {
      clearTimeout(timeoutId);
      finish(null);
    });
}

export function whenApiReady(fn) {
  let welcomeLoaded = false;
  const maxRetries = 25;
  let retries = 0;
  function run() {
    if (welcomeLoaded) return;
    if (getApi()) {
      welcomeLoaded = true;
      fn();
      return;
    }
    retries++;
    if (retries < maxRetries) {
      setTimeout(run, 200);
    } else {
      welcomeLoaded = true;
      fn();
    }
  }
  window.addEventListener("pywebviewready", function onReady() {
    window.removeEventListener("pywebviewready", onReady);
    run();
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(run, 100);
    });
  } else {
    setTimeout(run, 100);
  }
}

// ── Offline detection ─────────────────────────────────────────────────────────
(function () {
  const banner = document.getElementById("offlineBanner");
  if (!banner) return;
  const dismissBtn = banner.querySelector(".offline-banner-dismiss");
  let dismissed = false;

  function show() { if (!dismissed) banner.hidden = false; }
  function hide() { banner.hidden = true; }

  // Check after a short delay so onerror handlers on CDN tags have time to fire
  setTimeout(() => { if (window.__offlineFallback) show(); }, 3000);
  window.addEventListener("offline", show);
  window.addEventListener("online", hide);
  if (dismissBtn) dismissBtn.addEventListener("click", () => { dismissed = true; hide(); });
})();
