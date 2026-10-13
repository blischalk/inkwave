import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// init.js transitively imports ui.js/tabs.js/filetree.js, all of which read
// real index.html element IDs at module-eval time with no null guards.
// Load the actual production body markup rather than hand-roll a partial
// fixture that silently diverges from the real DOM shape.
const indexHtmlPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../index.html",
);
const indexHtml = readFileSync(indexHtmlPath, "utf8");
const bodyMatch = indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
document.body.innerHTML = bodyMatch ? bodyMatch[1] : "";

const { contentEl, showWelcomeOnStartup, setShowWelcomeOnStartup } = await import("../../js/state.js");
const { loadSettings, saveSettings } = await import("../../js/settings.js");
const initMod = await import("../../js/init.js");

describe("welcome screen dismiss toggle", () => {
  beforeEach(() => {
    localStorage.clear();
    setShowWelcomeOnStartup(true);
    contentEl.className = "content empty";
    contentEl.innerHTML = "Loading...";
    window.pywebview = undefined;
  });

  it("defaults showWelcomeOnStartup to true when no saved setting exists", () => {
    const saved = loadSettings();
    const result = saved.showWelcomeOnStartup !== false;
    expect(result).toBe(true);
  });

  it("saved showWelcomeOnStartup=false is read back as false", () => {
    saveSettings({ showWelcomeOnStartup: false });
    const saved = loadSettings();
    expect(saved.showWelcomeOnStartup !== false).toBe(false);
  });

  it("__applyWelcome renders welcome content and injects dismiss checkbox when enabled", () => {
    setShowWelcomeOnStartup(true);
    window.__applyWelcome(JSON.stringify({ content: "# Hello" }));
    expect(contentEl.innerHTML).toContain("Hello");
    const checkbox = contentEl.querySelector("#welcomeDismissCheckbox");
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);
  });

  it("__applyWelcome does not render when showWelcomeOnStartup is false", () => {
    setShowWelcomeOnStartup(false);
    window.__applyWelcome(JSON.stringify({ content: "# Hello" }));
    expect(contentEl.innerHTML).not.toContain("Hello");
  });

  it("checking the inline dismiss checkbox persists showWelcomeOnStartup=false", () => {
    setShowWelcomeOnStartup(true);
    window.__applyWelcome(JSON.stringify({ content: "# Hello" }));
    const checkbox = contentEl.querySelector("#welcomeDismissCheckbox");
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));

    const saved = loadSettings();
    expect(saved.showWelcomeOnStartup).toBe(false);
  });

  it("checking the inline dismiss checkbox does not clobber other persisted settings", () => {
    saveSettings({ fullWidth: true, dblClickEdit: false });
    setShowWelcomeOnStartup(true);
    window.__applyWelcome(JSON.stringify({ content: "# Hello" }));
    const checkbox = contentEl.querySelector("#welcomeDismissCheckbox");
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));

    const saved = loadSettings();
    expect(saved.fullWidth).toBe(true);
    expect(saved.dblClickEdit).toBe(false);
    expect(saved.showWelcomeOnStartup).toBe(false);
  });

  it("in-memory state updates immediately so a second render in the same session respects it", () => {
    setShowWelcomeOnStartup(true);
    window.__applyWelcome(JSON.stringify({ content: "# First" }));
    const checkbox = contentEl.querySelector("#welcomeDismissCheckbox");
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));

    // Simulate a second welcome-render attempt within the same page session
    // (e.g. loadWelcome() racing __applyWelcome, or a second IPC push).
    contentEl.innerHTML = "reset";
    window.__applyWelcome(JSON.stringify({ content: "# Second" }));
    expect(contentEl.innerHTML).not.toContain("Second");
  });

  it("checking the inline dismiss checkbox syncs the Settings modal toggle", () => {
    setShowWelcomeOnStartup(true);
    window.__applyWelcome(JSON.stringify({ content: "# Hello" }));
    const inlineCheckbox = contentEl.querySelector("#welcomeDismissCheckbox");
    const settingsToggle = document.getElementById("showWelcomeToggle");
    settingsToggle.checked = true;

    inlineCheckbox.checked = true;
    inlineCheckbox.dispatchEvent(new Event("change"));

    expect(settingsToggle.checked).toBe(false);
    expect(settingsToggle.getAttribute("aria-checked")).toBe("false");
  });

  it("loadWelcome() falls back to empty-state content when showWelcomeOnStartup is false and API resolves", async () => {
    setShowWelcomeOnStartup(false);
    window.pywebview = {
      api: {
        get_welcome: () => Promise.resolve({ content: "# Hello" }),
      },
    };
    initMod.loadWelcome();
    await new Promise((r) => setTimeout(r, 10));
    expect(contentEl.innerHTML).not.toContain("Hello");
    expect(contentEl.className).toBe("content empty");
  });

  it("loadWelcome() renders welcome content when showWelcomeOnStartup is true and API resolves", async () => {
    setShowWelcomeOnStartup(true);
    window.pywebview = {
      api: {
        get_welcome: () => Promise.resolve({ content: "# Hello" }),
      },
    };
    initMod.loadWelcome();
    await new Promise((r) => setTimeout(r, 10));
    expect(contentEl.innerHTML).toContain("Hello");
  });
});
