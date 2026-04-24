import { contentEl } from "./state.js";
import { createLogger } from "./log.js";

const log = createLogger("utils");

export function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

export function blockRaw(b) {
  const r = typeof b === "string" ? b : b && b.raw;
  return typeof r === "string" ? r : r != null ? String(r) : "";
}

export function highlightCodeInContainer(container) {
  if (!container || typeof hljs === "undefined") return;
  container.querySelectorAll("pre code").forEach((block) => {
    if (block.classList.contains("language-mermaid")) return;
    hljs.highlightElement(block);
  });
  renderMermaidBlocks(container);
}

let _mermaidLoaded = false;
let _mermaidLoading = false;

async function loadMermaid() {
  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
    return mod.default;
  } catch (_) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/mermaid.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return window.mermaid;
  }
}

async function renderMermaidBlocks(container) {
  const mermaidCodes = container.querySelectorAll('code.language-mermaid');
  log.debug("mermaid blocks found:", mermaidCodes.length);
  if (mermaidCodes.length === 0) return;

  if (!_mermaidLoaded) {
    if (_mermaidLoading) return;
    _mermaidLoading = true;
    log.debug("loading mermaid library…");
    try {
      const mm = await loadMermaid();
      mm.initialize({ startOnLoad: false, theme: "dark" });
      window.__mermaid = mm;
      _mermaidLoaded = true;
      log.debug("mermaid loaded");
    } catch (e) {
      log.error("mermaid load failed:", e);
      _mermaidLoading = false;
      return;
    }
  }

  const mm = window.__mermaid;
  mermaidCodes.forEach((code) => {
    const pre = code.parentElement;
    if (!pre || pre.tagName !== "PRE") return;
    if (pre.dataset.mermaidRendered) return;
    const text = code.textContent;
    pre.dataset.mermaidRendered = "1";
    pre.className = "mermaid";
    pre.textContent = text;
  });

  try {
    await mm.run({ nodes: container.querySelectorAll("pre.mermaid:not([data-processed])") });
    log.debug("mermaid.run complete");
  } catch (e) {
    log.warn("mermaid render error:", e);
  }
}

export function showError(err) {
  contentEl.className = "content";
  contentEl.innerHTML =
    '<div class="rendered"><div class="error">' +
    escapeHtml(String(err && (err.message || err))) +
    "</div></div>";
}
