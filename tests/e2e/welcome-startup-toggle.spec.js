// E2E coverage for the "show welcome screen on startup" toggle.
//
// Bug this suite exists to catch: unchecking the toggle, then relaunching,
// still showed the welcome screen instead of the empty-state fallback.
// Root causes (see commit history):
//   1. window.__applySettings (fed Python's settings.json, string-valued)
//      never read/applied showWelcomeOnStartup at all.
//   2. app.py registered inject_welcome (push __applyWelcome) BEFORE
//      inject_settings (push __applySettings), so even after fixing (1),
//      the welcome-gating check ran before the setting was applied.
import { test, expect } from "@playwright/test";
import { gotoApp, simulatePythonPush, readPersistedSettings } from "./helpers.js";

const CONTENT_SELECTOR = "#content-primary";
const WELCOME_TEXT = "# Welcome\n\nHello from the welcome screen.";
const FALLBACK_TEXT = "Open a file or folder to view markdown files. Only folders and .md files are shown in the tree.";

test.describe("welcome-on-startup toggle — pull path (loadWelcome via a.get_welcome())", () => {
  test("default (no saved setting) shows welcome content", async ({ page }) => {
    await gotoApp(page, { initialSettings: {}, welcomeContent: WELCOME_TEXT });
    await expect(page.locator(CONTENT_SELECTOR)).toContainText("Hello from the welcome screen");
  });

  test("showWelcomeOnStartup=false (string, as persisted by Python) shows fallback, not welcome", async ({ page }) => {
    await gotoApp(page, {
      initialSettings: { showWelcomeOnStartup: "false" },
      welcomeContent: WELCOME_TEXT,
    });
    await expect(page.locator(CONTENT_SELECTOR)).toHaveText(FALLBACK_TEXT);
    await expect(page.locator(CONTENT_SELECTOR)).not.toContainText("Hello from the welcome screen");
  });

  test("showWelcomeOnStartup=true (string) shows welcome content", async ({ page }) => {
    await gotoApp(page, {
      initialSettings: { showWelcomeOnStartup: "true" },
      welcomeContent: WELCOME_TEXT,
    });
    await expect(page.locator(CONTENT_SELECTOR)).toContainText("Hello from the welcome screen");
  });
});

test.describe("welcome-on-startup toggle — Python push path (__applySettings / __applyWelcome)", () => {
  // This is the path that actually matters: app.py's window.events.loaded
  // handlers call __applySettings/__applyWelcome via evaluate_js on every
  // real launch. The pull path above (loadWelcome) is a secondary/fallback
  // route exercised by main.js's whenApiReady(loadWelcome).
  test("relaunch with showWelcomeOnStartup=false pushed via Python renders fallback", async ({ page }) => {
    await gotoApp(page, { initialSettings: {}, welcomeContent: null });
    await simulatePythonPush(page, { showWelcomeOnStartup: "false" }, WELCOME_TEXT);
    await expect(page.locator(CONTENT_SELECTOR)).not.toContainText("Hello from the welcome screen");
  });

  test("relaunch with showWelcomeOnStartup=true pushed via Python renders welcome", async ({ page }) => {
    await gotoApp(page, { initialSettings: {}, welcomeContent: null });
    await simulatePythonPush(page, { showWelcomeOnStartup: "true" }, WELCOME_TEXT);
    await expect(page.locator(CONTENT_SELECTOR)).toContainText("Hello from the welcome screen");
  });

  test("settings checkbox reflects false pushed via __applySettings", async ({ page }) => {
    await gotoApp(page, { initialSettings: {}, welcomeContent: null });
    await simulatePythonPush(page, { showWelcomeOnStartup: "false" }, WELCOME_TEXT);
    await page.locator("#settingsBtn").click();
    await expect(page.locator("#showWelcomeToggle")).not.toBeChecked();
    await expect(page.locator("#showWelcomeToggle")).toHaveAttribute("aria-checked", "false");
  });
});

test.describe("full user flow — uncheck in Settings, relaunch, verify fallback", () => {
  test("uncheck toggle, persist, simulate relaunch via push path, see fallback not welcome", async ({ page }) => {
    // Session 1: app launches with welcome showing (default), user opens
    // Settings and unchecks "show welcome on startup".
    await gotoApp(page, { initialSettings: {}, welcomeContent: WELCOME_TEXT });
    await expect(page.locator(CONTENT_SELECTOR)).toContainText("Hello from the welcome screen");

    await page.locator("#settingsBtn").click();
    await expect(page.locator("#showWelcomeToggle")).toBeChecked();
    await page.locator("#showWelcomeToggle").click();
    await expect(page.locator("#showWelcomeToggle")).not.toBeChecked();

    const persisted = await readPersistedSettings(page);
    expect(persisted.showWelcomeOnStartup).toBe("false");

    // Session 2: simulate quit + relaunch by reloading with the exact
    // settings dict the previous session persisted, driven through the
    // real Python push path (the one that was broken).
    await gotoApp(page, { initialSettings: persisted, welcomeContent: null });
    await simulatePythonPush(page, persisted, WELCOME_TEXT);
    await expect(page.locator(CONTENT_SELECTOR)).not.toContainText("Hello from the welcome screen");
    await expect(page.locator(CONTENT_SELECTOR)).toHaveText(FALLBACK_TEXT);
  });

  test("re-check toggle after it was off, relaunch, welcome returns", async ({ page }) => {
    await gotoApp(page, {
      initialSettings: { showWelcomeOnStartup: "false" },
      welcomeContent: WELCOME_TEXT,
    });
    await expect(page.locator(CONTENT_SELECTOR)).toHaveText(FALLBACK_TEXT);

    await page.locator("#settingsBtn").click();
    await expect(page.locator("#showWelcomeToggle")).not.toBeChecked();
    await page.locator("#showWelcomeToggle").click();
    await expect(page.locator("#showWelcomeToggle")).toBeChecked();

    const persisted = await readPersistedSettings(page);
    expect(persisted.showWelcomeOnStartup).toBe("true");

    await gotoApp(page, { initialSettings: persisted, welcomeContent: null });
    await simulatePythonPush(page, persisted, WELCOME_TEXT);
    await expect(page.locator(CONTENT_SELECTOR)).toContainText("Hello from the welcome screen");
  });
});

test.describe("negative and edge cases", () => {
  test("get_welcome resolves null (missing Welcome.md) shows fallback regardless of toggle", async ({ page }) => {
    await gotoApp(page, {
      initialSettings: { showWelcomeOnStartup: "true" },
      welcomeContent: null,
    });
    await expect(page.locator(CONTENT_SELECTOR)).toHaveText(FALLBACK_TEXT);
  });

  test("malformed settings dict (missing key entirely) defaults to showing welcome", async ({ page }) => {
    await gotoApp(page, {
      initialSettings: { windowWidth: "1200.0" }, // no showWelcomeOnStartup key at all
      welcomeContent: WELCOME_TEXT,
    });
    await expect(page.locator(CONTENT_SELECTOR)).toContainText("Hello from the welcome screen");
  });

  test("garbage non-boolean-ish string value does not falsely disable welcome", async ({ page }) => {
    // Only the exact string "false" should disable; anything else (typos,
    // corrupted settings.json, future schema changes) must fail safe to
    // showing welcome rather than silently hiding it forever.
    await gotoApp(page, {
      initialSettings: { showWelcomeOnStartup: "0" },
      welcomeContent: WELCOME_TEXT,
    });
    await expect(page.locator(CONTENT_SELECTOR)).toContainText("Hello from the welcome screen");
  });

  test("rapid double-toggle (off then on) before any relaunch leaves welcome enabled", async ({ page }) => {
    await gotoApp(page, { initialSettings: {}, welcomeContent: WELCOME_TEXT });
    await page.locator("#settingsBtn").click();
    const toggle = page.locator("#showWelcomeToggle");
    await toggle.click(); // off
    await toggle.click(); // on
    const persisted = await readPersistedSettings(page);
    expect(persisted.showWelcomeOnStartup).toBe("true");
  });

  test("__applySettings called with no showWelcomeOnStartup field does not throw and leaves state untouched", async ({ page }) => {
    await gotoApp(page, { initialSettings: {}, welcomeContent: WELCOME_TEXT });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e));
    await page.evaluate(() => {
      window.__applySettings(JSON.stringify({ theme: "nord" }));
    });
    expect(errors).toEqual([]);
    await expect(page.locator(CONTENT_SELECTOR)).toContainText("Hello from the welcome screen");
  });

  test("__applySettings called with malformed JSON does not throw", async ({ page }) => {
    await gotoApp(page, { initialSettings: {}, welcomeContent: WELCOME_TEXT });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e));
    await page.evaluate(() => {
      window.__applySettings("{not valid json");
    });
    expect(errors).toEqual([]);
  });

  test("if a file is already open (tabs non-empty), welcome never renders regardless of toggle", async ({ page }) => {
    await gotoApp(page, {
      initialSettings: { showWelcomeOnStartup: "true" },
      welcomeContent: WELCOME_TEXT,
    });
    // Simulate a file already being open when __applyWelcome fires, the
    // same guard renderWelcomeContent() already applies (tabs.length > 0).
    await page.evaluate(() => {
      // tabs is a module-level array imported into init.js; push a fake
      // tab object so renderWelcomeContent's early-return guard triggers.
      import("/js/state.js").then((state) => { state.tabs.push({ id: "fake" }); });
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      window.__applyWelcome(JSON.stringify({ path: "/mock/Welcome.md", content: "# Should not render" }));
    });
    await expect(page.locator(CONTENT_SELECTOR)).not.toContainText("Should not render");
  });
});
