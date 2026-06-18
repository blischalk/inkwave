// PDF export. The on-screen WebKit print path cannot produce per-page margins
// with a full-bleed background, so export is delegated to the Python reportlab
// renderer (Api.export_pdf). This module gathers the active document's Markdown,
// the resolved theme colours, and any rendered mermaid SVGs, then hands them to
// Python and reports the outcome.

import { getApi } from "./api.js";
import { showError } from "./utils.js";
import { getActiveTab } from "./tabs.js";
import { flushActiveEditAndSave } from "./fileio.js";
import { contentEl } from "./state.js";

const THEME_COLOR_VARS = {
  bg: "--bg",
  text: "--text",
  accent: "--accent",
  link: "--link",
  muted: "--muted",
  border: "--border",
  code: "--code",
  code_bg: "--code-bg",
  blockquote_bg: "--blockquote-bg",
  h1: "--h1",
  h2: "--h2",
  h3: "--h3",
  h4: "--h4",
};

export function collectThemeColors() {
  const styles = getComputedStyle(document.body);
  const theme = {};
  for (const [key, cssVar] of Object.entries(THEME_COLOR_VARS)) {
    const value = styles.getPropertyValue(cssVar).trim();
    if (value) theme[key] = value;
  }
  return theme;
}

// Serialise an SVG element to a self-contained data URL plus its rendered size.
export function serializeSvg(svgEl) {
  const rect = svgEl.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  const xml = new XMLSerializer().serializeToString(clone);
  const encoded = btoa(unescape(encodeURIComponent(xml)));
  return { src: "data:image/svg+xml;base64," + encoded, width, height };
}

// Rasterise one SVG to a PNG via canvas so the PDF matches the on-screen diagram
// exactly. Resolves null if the SVG can't be rasterised (e.g. a tainted canvas).
function rasterizeSvg(svgEl, scale) {
  const { src, width, height } = serializeSvg(svgEl);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      try {
        resolve({ data: canvas.toDataURL("image/png").split(",")[1], width, height });
      } catch (_) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function collectMermaidImages(container, scale = 2) {
  if (!container) return [];
  const svgs = Array.from(container.querySelectorAll("pre.mermaid svg"));
  const rasters = await Promise.all(svgs.map((svg) => rasterizeSvg(svg, scale)));
  return rasters.filter((raster) => raster && raster.data);
}

export function suggestedPdfName(path) {
  if (!path) return "Untitled.pdf";
  const base = path.split(/[\\/]/).pop() || "Untitled";
  return base.replace(/\.(md|markdown)$/i, "") + ".pdf";
}

export function exportResultError(result) {
  if (!result) return "PDF export failed: no response.";
  if (result.cancelled) return null;
  if (result.error) return "PDF export failed: " + result.error;
  if (!result.path) return "PDF export failed: no file was written.";
  return null;
}

export async function exportPdf() {
  const api = getApi();
  if (!api || typeof api.export_pdf !== "function") {
    showError("PDF export is unavailable.");
    return;
  }
  flushActiveEditAndSave();
  const tab = getActiveTab();
  if (!tab || tab.content == null) {
    showError("Nothing to export.");
    return;
  }
  let mermaidImages = [];
  try {
    mermaidImages = await collectMermaidImages(contentEl);
  } catch (_) {
    mermaidImages = [];  // diagrams degrade to a placeholder; never block export
  }
  const payload = {
    markdown: tab.content,
    theme: collectThemeColors(),
    mermaidImages,
    suggestedName: suggestedPdfName(tab.path),
    sourcePath: tab.path || null,
  };
  try {
    const result = await api.export_pdf(payload);
    const message = exportResultError(result);
    if (message) {
      showError(message);
    } else if (result && result.path) {
      openExportedPdf(api, result.path);
    }
  } catch (err) {
    showError(err);
  }
}

function openExportedPdf(api, path) {
  if (typeof api.open_path === "function") {
    api.open_path(path).catch(() => {});
  }
}
