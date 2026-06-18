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

const _LIGHT_THEMES = new Set(["paper", "sepia", "solarized-light", "lavender", "ctp-latte"]);

export function resolveMermaidTheme() {
  const theme = document.body.getAttribute("data-theme") || "";
  return _LIGHT_THEMES.has(theme) ? "default" : "dark";
}

let _mermaidLoadPromise = null;

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

function ensureMermaid() {
  if (!_mermaidLoadPromise) {
    _mermaidLoadPromise = loadMermaid().catch((e) => {
      _mermaidLoadPromise = null;
      throw e;
    });
  }
  return _mermaidLoadPromise;
}

async function renderMermaidBlocks(container) {
  const mermaidCodes = container.querySelectorAll('code.language-mermaid');
  log.debug("mermaid blocks found:", mermaidCodes.length);
  if (mermaidCodes.length === 0) return;

  let mm;
  try {
    mm = await ensureMermaid();
    log.debug("mermaid ready");
  } catch (e) {
    log.error("mermaid load failed:", e);
    return;
  }

  mermaidCodes.forEach((code) => {
    const pre = code.parentElement;
    if (!pre || pre.tagName !== "PRE") return;
    if (pre.dataset.mermaidRendered) return;
    pre.dataset.mermaidRendered = "1";
    pre.className = "mermaid";
    pre.textContent = code.textContent;
  });

  try {
    // htmlLabels:false renders labels as SVG <text> (not HTML in <foreignObject>)
    // so the diagrams survive PDF export, where the SVG is rasterised by svglib.
    mm.initialize({
      startOnLoad: false,
      theme: resolveMermaidTheme(),
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    });
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
