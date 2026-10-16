// E2E coverage for Cmd+N scratch-file tabs, covering every user story
// from the golden plan (docs/plans/2026-10-13-inkwave-scratch-file-golden-plan.md):
//   U1 — Cmd+N gives an immediately-editable blank doc, zero dialogs.
//   U2 — content typed into a scratch tab survives relaunch (reload-on-launch).
//   U3 — a scratch tab with content prompts at quit time.
//   U4 — an empty, never-typed-in scratch tab is silently discarded on close.
// Plus: multiple Cmd+N presses get distinct Untitled N.md files, the
// B3 activeTabId fix (Save As on the active tab keeps it addressable),
// and the zero-outbound-network guarantee from offline-only.spec.js
// extends to every scratch-file code path too (gotoApp's request
// listener covers this automatically, no separate assertion needed).
import { test, expect } from "@playwright/test";
import { gotoApp, readDraftsRegistry, simulateRelaunch } from "./helpers.js";

const CMD_N = process.platform === "darwin" ? "Meta+n" : "Control+n";

// Reasonable buffer over Playwright's 5000ms .poll() default. The
// original flakiness here was root-caused to playwright.config.js
// running too many parallel workers against the single-threaded dev
// `http-server`, not application latency — see the `workers: 3` comment
// in playwright.config.js. This buffer is cheap insurance, not a
// workaround for a known-slow code path.
async function expectDraftContains(page, text) {
  await expect
    .poll(
      async () => Object.values(await readDraftsRegistry(page))[0],
      { timeout: 10000 },
    )
    .toContain(text);
}

test.describe("Cmd+N scratch-file tabs", () => {
  test("U1: Cmd+N opens an immediately-editable blank tab with zero dialogs", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });

    let dialogFired = false;
    page.on("dialog", () => { dialogFired = true; });

    await page.keyboard.press(CMD_N);

    // A new tab appears in the tab bar.
    await expect(page.locator(".tab")).toHaveCount(1);
    await expect(page.locator(".tab")).toContainText("Untitled.md");

    // The first block is already in edit mode — no click/dblclick needed.
    const editable = page.locator(".md-block.editing [contenteditable], .md-block.editing textarea, .md-block.editing .inline-edit");
    await expect(editable.first()).toBeVisible({ timeout: 2000 });

    expect(dialogFired).toBe(false);
  });

  test("U1: cursor is focused within the editable block immediately after Cmd+N", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await page.keyboard.press(CMD_N);

    const isFocusedInsideEditingBlock = await page.evaluate(() => {
      const editingBlock = document.querySelector(".md-block.editing");
      if (!editingBlock) return false;
      return editingBlock.contains(document.activeElement);
    });
    expect(isFocusedInsideEditingBlock).toBe(true);
  });

  test("typing immediately after Cmd+N works with no extra interaction", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await page.keyboard.press(CMD_N);
    await page.waitForSelector(".md-block.editing", { timeout: 2000 });

    await page.keyboard.type("Hello scratch note");

    const draftsRegistry = await readDraftsRegistry(page);
    const paths = Object.keys(draftsRegistry);
    expect(paths).toHaveLength(1);
    // Autosave: content should land in the mock drafts registry without
    // any explicit save action, matching editor.js's saveToFile-on-edit.
    await expectDraftContains(page, "Hello scratch note");
  });

  test("multiple Cmd+N presses create distinct Untitled N.md files", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });

    await page.keyboard.press(CMD_N);
    await page.waitForTimeout(50);
    await page.keyboard.press(CMD_N);
    await page.waitForTimeout(50);
    await page.keyboard.press(CMD_N);
    await page.waitForTimeout(50);

    await expect(page.locator(".tab")).toHaveCount(3);
    const draftsRegistry = await readDraftsRegistry(page);
    expect(Object.keys(draftsRegistry)).toHaveLength(3);
    expect(Object.keys(draftsRegistry).sort()).toEqual([
      "/mock/drafts/Untitled 1.md",
      "/mock/drafts/Untitled 2.md",
      "/mock/drafts/Untitled.md",
    ].sort());
  });

  test("U4: closing an empty, never-typed-in scratch tab discards it (no trace left)", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await page.keyboard.press(CMD_N);
    await expect(page.locator(".tab")).toHaveCount(1);

    // Never type anything — close immediately via the tab's close button.
    await page.locator(".tab .tab-close, .tab [class*='close']").first().click();

    await expect(page.locator(".tab")).toHaveCount(0);
    const draftsRegistry = await readDraftsRegistry(page);
    expect(Object.keys(draftsRegistry)).toHaveLength(0);
  });

  test("closing a NON-empty scratch tab keeps the file registered (survives for reload-on-launch)", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await page.keyboard.press(CMD_N);
    await page.waitForSelector(".md-block.editing", { timeout: 2000 });
    await page.keyboard.type("keep this note");
    await expectDraftContains(page, "keep this note");

    await page.locator(".tab .tab-close, .tab [class*='close']").first().click();

    await expect(page.locator(".tab")).toHaveCount(0);
    const draftsRegistry = await readDraftsRegistry(page);
    expect(Object.keys(draftsRegistry)).toHaveLength(1);
    expect(Object.values(draftsRegistry)[0]).toContain("keep this note");
  });

  test("U2: content typed into a scratch tab survives a simulated relaunch", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await page.keyboard.press(CMD_N);
    await page.waitForSelector(".md-block.editing", { timeout: 2000 });
    await page.keyboard.type("Survive the relaunch please");
    await expectDraftContains(page, "Survive the relaunch please");

    await simulateRelaunch(page);
    await page.waitForSelector(".content", { state: "attached" });

    // The scratch tab must reappear automatically — no Cmd+N, no file open dialog.
    await expect(page.locator(".tab")).toHaveCount(1);
    await expect(page.locator("#content-primary")).toContainText("Survive the relaunch please");
  });

  test("U2: an EMPTY scratch tab left open is still restored on relaunch (U4 is close-time only, not quit-time)", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await page.keyboard.press(CMD_N);
    await expect(page.locator(".tab")).toHaveCount(1);
    // Never type anything, never close it — just relaunch.

    await simulateRelaunch(page);
    await page.waitForSelector(".content", { state: "attached" });

    await expect(page.locator(".tab")).toHaveCount(1);
  });

  test("U3: quitting with a non-empty scratch tab reports unsaved via window.__hasUnsavedScratchTabs", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await page.keyboard.press(CMD_N);
    await page.waitForSelector(".md-block.editing", { timeout: 2000 });
    await page.keyboard.type("don't forget me");
    await expectDraftContains(page, "don't forget me");

    // This is the exact contract app.py's check_unsaved_scratch_on_quit
    // calls via evaluate_js at quit time (see app.py docstring).
    const hasUnsaved = await page.evaluate(() => window.__hasUnsavedScratchTabs());
    expect(hasUnsaved).toBe(true);
  });

  test("U4 (quit-time variant): an empty scratch tab reports NOT unsaved via window.__hasUnsavedScratchTabs", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await page.keyboard.press(CMD_N);
    await expect(page.locator(".tab")).toHaveCount(1);

    const hasUnsaved = await page.evaluate(() => window.__hasUnsavedScratchTabs());
    expect(hasUnsaved).toBe(false);
  });

  test("window.__hasUnsavedScratchTabs returns false with no tabs open at all", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    const hasUnsaved = await page.evaluate(() => window.__hasUnsavedScratchTabs());
    expect(hasUnsaved).toBe(false);
  });

  test("regular (non-scratch) open files do not trigger window.__hasUnsavedScratchTabs", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    // Simulate a regular file tab (not via Cmd+N) by calling addTab
    // directly through the module graph — this is a non-scratch tab.
    await page.evaluate(async () => {
      const tabsMod = await import("/js/tabs.js");
      tabsMod.addTab({ path: "/notes/real.md", title: "real.md", content: "normal file content" });
    });
    const hasUnsaved = await page.evaluate(() => window.__hasUnsavedScratchTabs());
    expect(hasUnsaved).toBe(false);
  });

  test("B3 fix: Save As on an active scratch tab keeps it the active/addressable tab", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await page.keyboard.press(CMD_N);
    await page.waitForSelector(".md-block.editing", { timeout: 2000 });
    await page.keyboard.type("promote me to a real file");
    await expectDraftContains(page, "promote me to a real file");

    // Exit inline-edit before Cmd+S (matches how a real user would tab
    // away / click elsewhere before saving).
    await page.keyboard.press("Escape");
    await page.keyboard.press(CMD_N.replace("n", "s"));
    await page.waitForTimeout(100);

    // The regression this guards against: getActiveTab() silently
    // returning null after Save As reassigns tab.id without updating
    // activeTabId. If broken, the active tab's content would appear to
    // vanish from the editor despite the tab still existing.
    const activeTabIsAddressable = await page.evaluate(async () => {
      const tabsMod = await import("/js/tabs.js");
      const active = tabsMod.getActiveTab();
      return active !== null && active.content != null;
    });
    expect(activeTabIsAddressable).toBe(true);
  });

  test("zero outbound network calls during the full Cmd+N -> type -> relaunch flow", async ({ page }) => {
    // gotoApp() already installs the throw-on-outbound-request guard;
    // this test just exercises every scratch-file code path under it.
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await page.keyboard.press(CMD_N);
    await page.waitForSelector(".md-block.editing", { timeout: 2000 });
    await page.keyboard.type("no network please");
    await expectDraftContains(page, "no network please");
    await simulateRelaunch(page);
    await page.waitForSelector(".content", { state: "attached" });
    // If we got here without the page.on("request") listener throwing,
    // zero outbound calls were made across the entire flow.
    await expect(page.locator(".tab")).toHaveCount(1);
  });
});
