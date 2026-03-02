import {
  contentEl, filenameEl,
  setWelcomeContent,
} from "./state.js";
import { getApi } from "./api.js";
import { highlightCodeInContainer } from "./utils.js";
import { applyTheme } from "./ui.js";

// ── window.__applySettings ────────────────────────────────────────────────────
// Called by Python before/after loading settings from disk.
window.__applySettings = function (dataStr) {
  try {
    const settings = JSON.parse(dataStr);
    if (settings && settings.theme) {
      applyTheme(settings.theme);
    }
  } catch (e) {}
};

// ── window.__applyWelcome ─────────────────────────────────────────────────────
// Called by Python to inject Welcome.md content directly (fast path).
window.__applyWelcome = function (dataStr) {
  try {
    const data = JSON.parse(dataStr);
    if (data && data.content != null) {
      setWelcomeContent(data.content);
      contentEl.className = "content";
      contentEl.innerHTML =
        '<div class="rendered">' + marked.parse(data.content) + "</div>";
      highlightCodeInContainer(contentEl);
      filenameEl.textContent = "Welcome";
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
      setWelcomeContent(data.content);
      contentEl.className = "content";
      contentEl.innerHTML =
        '<div class="rendered">' + marked.parse(data.content) + "</div>";
      highlightCodeInContainer(contentEl);
      filenameEl.textContent = "Welcome";
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
