import { describe, it, expect, afterEach } from "vitest";
import { blockRaw, escapeHtml, resolveMermaidTheme } from "../../js/utils.js";

// ── blockRaw ─────────────────────────────────────────────────────────────────

describe("blockRaw", () => {
  it("returns a string argument unchanged", () => {
    expect(blockRaw("hello")).toBe("hello");
  });

  it("returns the raw property of a block object", () => {
    expect(blockRaw({ raw: "# Heading", type: "heading" })).toBe("# Heading");
  });

  it("returns empty string when raw is absent", () => {
    expect(blockRaw({ type: "paragraph" })).toBe("");
  });

  it("converts a non-string raw property to string", () => {
    expect(blockRaw({ raw: 42 })).toBe("42");
  });

  it("returns empty string for null", () => {
    expect(blockRaw(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(blockRaw(undefined)).toBe("");
  });

  it("returns empty string for raw: null", () => {
    expect(blockRaw({ raw: null })).toBe("");
  });
});

// ── escapeHtml ────────────────────────────────────────────────────────────────

describe("escapeHtml", () => {
  it("escapes '<'", () => {
    expect(escapeHtml("<")).toBe("&lt;");
  });

  it("escapes '>'", () => {
    expect(escapeHtml(">")).toBe("&gt;");
  });

  it("escapes '&'", () => {
    expect(escapeHtml("&")).toBe("&amp;");
  });

  it("escapes a combined HTML injection string", () => {
    const result = escapeHtml("<script>alert('xss')</script>");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("returns empty string for empty input", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("leaves safe characters untouched", () => {
    expect(escapeHtml("Hello, world!")).toBe("Hello, world!");
  });

  it("escapes '&' in a longer string", () => {
    expect(escapeHtml("cats & dogs")).toBe("cats &amp; dogs");
  });
});

// ── resolveMermaidTheme ───────────────────────────────────────────────────────

describe("resolveMermaidTheme", () => {
  afterEach(() => {
    document.body.removeAttribute("data-theme");
  });

  it("returns 'dark' when no theme attribute is set", () => {
    expect(resolveMermaidTheme()).toBe("dark");
  });

  it("returns 'dark' for a dark theme", () => {
    document.body.setAttribute("data-theme", "obsidianite");
    expect(resolveMermaidTheme()).toBe("dark");
  });

  it("returns 'dark' for dracula", () => {
    document.body.setAttribute("data-theme", "dracula");
    expect(resolveMermaidTheme()).toBe("dark");
  });

  it("returns 'dark' for nord", () => {
    document.body.setAttribute("data-theme", "nord");
    expect(resolveMermaidTheme()).toBe("dark");
  });

  it("returns 'default' for paper (light)", () => {
    document.body.setAttribute("data-theme", "paper");
    expect(resolveMermaidTheme()).toBe("default");
  });

  it("returns 'default' for sepia (light)", () => {
    document.body.setAttribute("data-theme", "sepia");
    expect(resolveMermaidTheme()).toBe("default");
  });

  it("returns 'default' for solarized-light", () => {
    document.body.setAttribute("data-theme", "solarized-light");
    expect(resolveMermaidTheme()).toBe("default");
  });

  it("returns 'default' for lavender (light)", () => {
    document.body.setAttribute("data-theme", "lavender");
    expect(resolveMermaidTheme()).toBe("default");
  });

  it("returns 'default' for ctp-latte (light)", () => {
    document.body.setAttribute("data-theme", "ctp-latte");
    expect(resolveMermaidTheme()).toBe("default");
  });

  it("returns 'dark' for an unknown theme", () => {
    document.body.setAttribute("data-theme", "some-future-theme");
    expect(resolveMermaidTheme()).toBe("dark");
  });
});
