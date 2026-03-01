import { contentEl } from "./state.js";

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
    hljs.highlightElement(block);
  });
}

export function showError(err) {
  contentEl.className = "content";
  contentEl.innerHTML =
    '<div class="rendered"><div class="error">' +
    escapeHtml(String(err && (err.message || err))) +
    "</div></div>";
}
