import { describe, it, expect, beforeEach } from "vitest";
import {
  collectThemeColors,
  collectMermaidImages,
  serializeSvg,
  suggestedPdfName,
  exportResultError,
} from "../../js/pdfexport.js";

describe("suggestedPdfName", () => {
  it("replaces a .md extension with .pdf", () => {
    expect(suggestedPdfName("/Users/me/notes/Bestiary.md")).toBe("Bestiary.pdf");
  });

  it("replaces a .markdown extension with .pdf", () => {
    expect(suggestedPdfName("/docs/Readme.markdown")).toBe("Readme.pdf");
  });

  it("handles Windows-style separators", () => {
    expect(suggestedPdfName("C:\\docs\\Plan.md")).toBe("Plan.pdf");
  });

  it("falls back to Untitled.pdf when there is no path", () => {
    expect(suggestedPdfName(null)).toBe("Untitled.pdf");
    expect(suggestedPdfName("")).toBe("Untitled.pdf");
  });

  it("appends .pdf when there is no markdown extension", () => {
    expect(suggestedPdfName("/docs/file")).toBe("file.pdf");
  });
});

describe("exportResultError", () => {
  it("returns a message when the response is missing", () => {
    expect(exportResultError(null)).toMatch(/no response/i);
  });

  it("returns null when the user cancelled", () => {
    expect(exportResultError({ cancelled: true })).toBeNull();
  });

  it("surfaces a backend error", () => {
    expect(exportResultError({ error: "disk full" })).toBe("PDF export failed: disk full");
  });

  it("flags a missing output path", () => {
    expect(exportResultError({})).toMatch(/no file/i);
  });

  it("returns null on success", () => {
    expect(exportResultError({ path: "/tmp/out.pdf" })).toBeNull();
  });
});

describe("serializeSvg", () => {
  it("returns an SVG data URL with at-least-1 dimensions", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const result = serializeSvg(svg);
    expect(result.src.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it("stamps explicit width/height onto the serialized markup", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const { src } = serializeSvg(svg);
    const decoded = atob(src.split(",")[1]);
    expect(decoded).toMatch(/width="\d+"/);
    expect(decoded).toMatch(/height="\d+"/);
  });
});

describe("collectMermaidImages", () => {
  it("returns an empty array for a missing container", async () => {
    await expect(collectMermaidImages(null)).resolves.toEqual([]);
  });
});

describe("collectThemeColors", () => {
  beforeEach(() => {
    document.body.removeAttribute("style");
  });

  it("reads defined theme custom properties into named keys", () => {
    document.body.style.setProperty("--bg", "#100e17");
    document.body.style.setProperty("--text", "#bebebe");
    document.body.style.setProperty("--code-bg", "#0d0b12");
    const theme = collectThemeColors();
    expect(theme.bg).toBe("#100e17");
    expect(theme.text).toBe("#bebebe");
    expect(theme.code_bg).toBe("#0d0b12");
  });

  it("omits properties that are not set", () => {
    document.body.style.setProperty("--bg", "#fff");
    const theme = collectThemeColors();
    expect(theme.bg).toBe("#fff");
    expect("accent" in theme).toBe(false);
  });
});
