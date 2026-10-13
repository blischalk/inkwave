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

  // Remaining dark themes, verified against each theme's real --bg value in
  // style.css (all are dark backgrounds): ctp-frappe #303446, ctp-macchiato
  // #24273a, forest #1a2421, gruvbox #282828, high-contrast #0c0c0c,
  // midnight #0d0d18, mocha #1e1e2e, molokai #1b1d1e, rose-pine #191724,
  // slime #181c18. Previously only 3 of 18 total themes were covered
  // (obsidianite, dracula, nord); this closes the gap to all 18.
  it("returns 'dark' for ctp-frappe", () => {
    document.body.setAttribute("data-theme", "ctp-frappe");
    expect(resolveMermaidTheme()).toBe("dark");
  });

  it("returns 'dark' for ctp-macchiato", () => {
    document.body.setAttribute("data-theme", "ctp-macchiato");
    expect(resolveMermaidTheme()).toBe("dark");
  });

  it("returns 'dark' for forest", () => {
    document.body.setAttribute("data-theme", "forest");
    expect(resolveMermaidTheme()).toBe("dark");
  });

  it("returns 'dark' for gruvbox", () => {
    document.body.setAttribute("data-theme", "gruvbox");
    expect(resolveMermaidTheme()).toBe("dark");
  });

  it("returns 'dark' for high-contrast", () => {
    document.body.setAttribute("data-theme", "high-contrast");
    expect(resolveMermaidTheme()).toBe("dark");
  });

  it("returns 'dark' for midnight", () => {
    document.body.setAttribute("data-theme", "midnight");
    expect(resolveMermaidTheme()).toBe("dark");
  });

  it("returns 'dark' for mocha", () => {
    document.body.setAttribute("data-theme", "mocha");
    expect(resolveMermaidTheme()).toBe("dark");
  });

  it("returns 'dark' for molokai", () => {
    document.body.setAttribute("data-theme", "molokai");
    expect(resolveMermaidTheme()).toBe("dark");
  });

  it("returns 'dark' for rose-pine", () => {
    document.body.setAttribute("data-theme", "rose-pine");
    expect(resolveMermaidTheme()).toBe("dark");
  });

  it("returns 'dark' for slime", () => {
    document.body.setAttribute("data-theme", "slime");
    expect(resolveMermaidTheme()).toBe("dark");
  });

  it("returns 'dark' for an unknown theme", () => {
    document.body.setAttribute("data-theme", "some-future-theme");
    expect(resolveMermaidTheme()).toBe("dark");
  });
});
