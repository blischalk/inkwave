import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ui.js has extensive unconditional top-level DOM wiring (sidebar toggle,
// document-level keydown/copy/contextmenu listeners, etc.) coupled to the
// real app shell, not just the theme picker. Loading the real index.html
// is the maintainable fixture here — a hand-built partial DOM drifts out
// of sync with ui.js's actual requirements (confirmed: a hand-built
// fixture missing `.sidebar-toggle` inside #sidebar threw at import time).
const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(join(__dirname, "../../index.html"), "utf-8");
const bodyMatch = indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/);
document.body.innerHTML = bodyMatch ? bodyMatch[1] : indexHtml;

let _saveSettingMock = () => Promise.resolve({ ok: true });

window.pywebview = {
  api: {
    load_settings: () => Promise.resolve({}),
    save_setting: (...args) => _saveSettingMock(...args),
  },
};

const { applyTheme } = await import("../../js/ui.js");

function clickThemeOption(value) {
  const li = document.querySelector(`#themePickerList li[data-value="${value}"]`);
  expect(li, `theme option "${value}" not found in index.html's themePickerList`).toBeTruthy();
  li.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("ui — applyTheme", () => {
  beforeEach(() => {
    document.body.removeAttribute("data-theme");
    _saveSettingMock = () => Promise.resolve({ ok: true });
  });

  it("sets data-theme on document.body", () => {
    applyTheme("lavender");
    expect(document.body.getAttribute("data-theme")).toBe("lavender");
  });

  it("sets data-theme even for an unknown theme id (no matching option)", () => {
    applyTheme("some-unknown-theme-id");
    expect(document.body.getAttribute("data-theme")).toBe("some-unknown-theme-id");
  });

  it("falls back to the raw theme id as label text when unmatched", () => {
    applyTheme("totally-unknown-theme-xyz");
    expect(document.getElementById("themePickerLabel").textContent).toBe("totally-unknown-theme-xyz");
  });

  it("marks the matching option aria-selected=true and others false", () => {
    applyTheme("lavender");
    const lavenderLi = document.querySelector('li[data-value="lavender"]');
    const obsidianiteLi = document.querySelector('li[data-value="obsidianite"]');
    expect(lavenderLi.getAttribute("aria-selected")).toBe("true");
    expect(obsidianiteLi.getAttribute("aria-selected")).toBe("false");
  });
});

describe("ui — theme picker click (commitOption, private, reached via DOM)", () => {
  beforeEach(() => {
    document.body.removeAttribute("data-theme");
    _saveSettingMock = () => Promise.resolve({ ok: true });
  });

  it("clicking a theme option applies the theme to the DOM", () => {
    clickThemeOption("lavender");
    expect(document.body.getAttribute("data-theme")).toBe("lavender");
  });

  it("clicking a theme option calls save_setting with the theme key/value", async () => {
    const spy = vi.fn(() => Promise.resolve({ ok: true }));
    _saveSettingMock = spy;
    clickThemeOption("obsidianite");
    await Promise.resolve();
    expect(spy).toHaveBeenCalledWith("theme", "obsidianite");
  });

  it("logs an error when save_setting resolves ok:false, but DOM still updates", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    _saveSettingMock = () => Promise.resolve({ ok: false, error: "disk full" });
    try {
      clickThemeOption("lavender");
      await Promise.resolve();
      await Promise.resolve();
      expect(document.body.getAttribute("data-theme")).toBe("lavender");
      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][1]).toBe("disk full");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not crash when save_setting rejects (unhandled promise is caught)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    _saveSettingMock = () => Promise.reject(new Error("network down"));
    try {
      expect(() => clickThemeOption("obsidianite")).not.toThrow();
      await Promise.resolve();
      await Promise.resolve();
      expect(document.body.getAttribute("data-theme")).toBe("obsidianite");
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
