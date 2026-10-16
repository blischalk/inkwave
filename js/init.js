import {
  contentEl, filenameEl, tabs,
  setWelcomeContent, setVimMode, setLlmProvider, setLlmModel, setDocFontSize, docFontSize, setGradientBold,
  showWelcomeOnStartup, setShowWelcomeOnStartup, setFullWidth,
} from "./state.js";
import { loadSettings, saveSettings, applyGradientBold, applyFullWidth } from "./settings.js";
import { getApi } from "./api.js";
import { highlightCodeInContainer } from "./utils.js";
import { applyTheme } from "./ui.js";
import { addTab } from "./tabs.js";
import { initTree, selectFile } from "./filetree.js";
import { reloadScratchFiles } from "./scratch.js";

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
    if (settings && settings.showWelcomeOnStartup === "false") {
      setShowWelcomeOnStartup(false);
      const toggle = document.getElementById("showWelcomeToggle");
      if (toggle) {
        toggle.checked = false;
        toggle.setAttribute("aria-checked", "false");
      }
    }
  } catch (e) {
    console.error("__applySettings: failed to apply settings:", e);
  }
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
  if (r) r.style.fontSize = docFontSize + "rem";
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
  // Boyscout fix (discovered during scratch-file plan implementation):
  // this used to unconditionally overwrite contentEl, even when a tab
  // (e.g. a scratch file restored by reloadScratchFiles()) was already
  // open and rendered. renderWelcomeContent() already had this exact
  // guard; showFallbackContent() is the sibling "nothing to show"
  // branch and needs the identical guard for the same reason — don't
  // stomp over real content that's already on screen.
  if (tabs.length > 0) return;
  contentEl.className = "content empty";
  contentEl.innerHTML =
    "Open a file or folder to view markdown files. Only folders and .md files are shown in the tree.";
}

export function loadWelcome() {
  // Reopen any scratch tabs left over from the previous session FIRST
  // and await it before deciding whether to render the welcome screen.
  // renderWelcomeContent() bails early once tabs.length > 0, so without
  // this ordering a dirty, unsaved scratch note could flash behind (or
  // lose visibility under) the welcome screen on launch.
  reloadScratchFiles().then(() => _loadWelcomeAfterScratchReload());
}

function _loadWelcomeAfterScratchReload() {
  const a = getApi();
  if (!a || typeof a.get_welcome !== "function") {
    showFallbackContent();
    return;
  }
  let done = false;
  function finish(data, showWelcome) {
    if (done) return;
    done = true;
    if (data && data.content) {
      if (!showWelcome) {
        showFallbackContent();
        return;
      }
      renderWelcomeContent(data);
    } else {
      showFallbackContent();
    }
  }
  const timeoutId = setTimeout(() => { finish(null, showWelcomeOnStartup); }, 2500);
  // settings.json (via a.load_settings()) is the authoritative,
  // cross-launch source of truth for showWelcomeOnStartup — localStorage
  // (which seeded the showWelcomeOnStartup module variable via
  // initSettings()) is a secondary cache that can be stale or empty on
  // a fresh WebKit storage profile (e.g. a freshly built dev app) even
  // when settings.json already has the real persisted value. Fetch both
  // in parallel and prefer the Python value when the call succeeds.
  const settingsPromise =
    typeof a.load_settings === "function"
      ? a.load_settings().catch(() => null)
      : Promise.resolve(null);
  Promise.all([a.get_welcome().catch(() => null), settingsPromise])
    .then(([data, settings]) => {
      clearTimeout(timeoutId);
      if (settings && settings.showWelcomeOnStartup === "false" && showWelcomeOnStartup) {
        // settings.json disagrees with the localStorage-seeded module
        // state (e.g. fresh WebKit storage profile with no prior
        // localStorage write but an existing Python-persisted value).
        // Sync both the module state and the Settings panel checkbox so
        // the UI doesn't contradict what's about to render.
        setShowWelcomeOnStartup(false);
        const toggle = document.getElementById("showWelcomeToggle");
        if (toggle) {
          toggle.checked = false;
          toggle.setAttribute("aria-checked", "false");
        }
      }
      finish(data, showWelcomeOnStartup);
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

  window.addEventListener("offline", show);
  window.addEventListener("online", hide);
  if (dismissBtn) dismissBtn.addEventListener("click", () => { dismissed = true; hide(); });
})();
