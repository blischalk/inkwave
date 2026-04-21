import { contentEl } from "./state.js";
import { escapeHtml } from "./utils.js";

const tocPanel    = document.getElementById("tocPanel");
const tocBody     = document.getElementById("tocBody");
const tocBtn      = document.getElementById("tocBtn");
const focusTocBtn = document.getElementById("focusTocBtn");
const tocCloseBtn = document.getElementById("tocCloseBtn");

let tocVisible = false;

function getHeadingsFromContent() {
  if (!contentEl) return [];
  return [...contentEl.querySelectorAll(".md-block")].filter((el) => {
    return /md-block-heading/.test(el.className);
  });
}

function renderToc() {
  const headingEls = getHeadingsFromContent();
  if (headingEls.length === 0) {
    tocBody.innerHTML = '<p class="toc-empty">No headings found in this document.</p>';
    return;
  }
  let html = '<ul class="toc-list">';
  headingEls.forEach((el) => {
    const depthMatch = el.className.match(/md-block-heading-(\d)/);
    const depth = depthMatch ? parseInt(depthMatch[1], 10) : 1;
    const blockIndex = el.getAttribute("data-block-index");
    const text = el.textContent.trim();
    html += `<li class="toc-item toc-depth-${depth}" data-block-index="${blockIndex}" tabindex="0" role="button">${escapeHtml(text)}</li>`;
  });
  html += "</ul>";
  tocBody.innerHTML = html;

  tocBody.querySelectorAll(".toc-item").forEach((item) => {
    const activate = () => {
      const idx = item.getAttribute("data-block-index");
      const target = contentEl.querySelector(`.md-block[data-block-index="${idx}"]`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    item.addEventListener("click", activate);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
    });
  });
}

function showToc() {
  tocVisible = true;
  if (tocPanel) { tocPanel.removeAttribute("inert"); tocPanel.classList.add("visible"); }
  if (tocBtn) tocBtn.setAttribute("aria-pressed", "true");
  if (focusTocBtn) focusTocBtn.setAttribute("aria-pressed", "true");
  renderToc();
}

function hideToc() {
  tocVisible = false;
  if (tocPanel) { tocPanel.classList.remove("visible"); tocPanel.setAttribute("inert", ""); }
  if (tocBtn) tocBtn.setAttribute("aria-pressed", "false");
  if (focusTocBtn) focusTocBtn.setAttribute("aria-pressed", "false");
}

export function toggleToc() {
  tocVisible ? hideToc() : showToc();
}

// Re-render TOC content when the content area changes (e.g. switching tabs).
if (contentEl) {
  const observer = new MutationObserver(() => {
    if (tocVisible) renderToc();
  });
  observer.observe(contentEl, { childList: true, subtree: false });
}

if (tocBtn) {
  tocBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleToc(); });
}
if (focusTocBtn) {
  focusTocBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleToc(); });
}
if (tocCloseBtn) {
  tocCloseBtn.addEventListener("click", hideToc);
}
