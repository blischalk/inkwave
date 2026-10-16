// E2E coverage for the single most fundamental user interaction in a
// markdown editor: double-click a rendered block to edit it, type,
// and have the change land in the document — plus the Enter-to-split
// and Escape-to-commit flows. Deliberately real DOM/keyboard driven,
// not a vitest internal-logic test (editor.test.js already covers
// handleEnterInBlock's string-splitting math in isolation; this
// verifies the full click -> contenteditable -> commit -> autosave
// pipeline end to end against the real app).
import { test, expect } from "@playwright/test";
import { gotoApp, setMockOverride, readWrittenFile } from "./helpers.js";

const DOC_PATH = "/mock/notes/doc.md";

async function openDoc(page, content) {
  await setMockOverride(page, "open_file", {
    root: "/mock/notes", path: DOC_PATH, content,
  });
  await page.locator("#openBtn").click();
  await page.locator('#openMenu button[data-action="file"]').click();
  await expect(page.locator(".tab")).toHaveCount(1);
}

test.describe("Core block editing", () => {
  test("double-clicking a paragraph enters edit mode with the correct existing text", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "# Doc\n\nOriginal paragraph text.");
    await page.locator('.md-block[data-block-index="1"]').dblclick();
    const editable = page.locator(".md-block.editing .inline-edit");
    await expect(editable).toBeVisible({ timeout: 2000 });
    await expect(editable).toHaveText("Original paragraph text.");
  });

  test("typing while editing updates the block and autosaves on every keystroke", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "# Doc\n\nOld text.");
    await page.locator('.md-block[data-block-index="1"]').dblclick();
    const editable = page.locator(".md-block.editing .inline-edit");
    await expect(editable).toBeFocused({ timeout: 2000 });
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Brand new text.");

    await expect
      .poll(() => readWrittenFile(page, DOC_PATH))
      .toContain("Brand new text.");
  });

  test("pressing Escape commits the edit and exits edit mode", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "# Doc\n\nOld text.");
    await page.locator('.md-block[data-block-index="1"]').dblclick();
    const editable = page.locator(".md-block.editing .inline-edit");
    await expect(editable).toBeFocused({ timeout: 2000 });
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Escaped text.");
    await page.keyboard.press("Escape");

    await expect(page.locator(".md-block.editing")).toHaveCount(0);
    await expect(page.locator("#content-primary")).toContainText("Escaped text.");
  });

  test("pressing Enter mid-paragraph splits it into two separate blocks", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "# Doc\n\nFirstpart");
    await page.locator('.md-block[data-block-index="1"]').dblclick();
    const editable = page.locator(".md-block.editing .inline-edit");
    await expect(editable).toBeFocused({ timeout: 2000 });
    // "Firstpart" is 9 chars; move caret to right after "First" (index
    // 5) by going Home then ArrowRight x5, rather than retyping text
    // (which would PREPEND, not position-and-split — confirmed via a
    // throwaway diagnostic run that Home + type("First") produces
    // "FirstFirstpart", not the intended split point).
    await page.keyboard.press("Home");
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");

    // UPDATE (2026-10-15, code review Boyscout fix): handleEnterInBlock()
    // now DOES call saveToFile() immediately after the split (previously
    // it only updated tab.content/DOM in memory, relying on the
    // newly-focused second block's own commit() on blur/Escape to
    // persist it — a real data-loss window if the app closed between
    // Enter and Escape). The split is now durable on disk the instant
    // Enter is pressed, in addition to the pre-existing blur/Escape path
    // below. Escape is still exercised here because that's the realistic
    // next user action, not because it's the only thing that saves.
    await expect(page.locator('.md-block[data-block-index="2"].editing')).toBeVisible({ timeout: 2000 });
    await page.keyboard.press("Escape");

    await expect
      .poll(() => readWrittenFile(page, DOC_PATH))
      .toBe("# Doc\n\nFirst\n\npart");
  });

  test("pressing Enter mid-paragraph saves the split to disk immediately, BEFORE Escape (regression guard)", async ({ page }) => {
    // Regression test for the Boyscout fix above: handleEnterInBlock()
    // must call saveToFile() synchronously as part of handling Enter,
    // not rely solely on the newly-focused second block's own
    // blur/Escape commit(). Verified by checking the written file
    // immediately after Enter, with NO Escape press at all.
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "# Doc\n\nFirstpart");
    await page.locator('.md-block[data-block-index="1"]').dblclick();
    const editable = page.locator(".md-block.editing .inline-edit");
    await expect(editable).toBeFocused({ timeout: 2000 });
    await page.keyboard.press("Home");
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");

    await expect(page.locator('.md-block[data-block-index="2"].editing')).toBeVisible({ timeout: 2000 });
    // Deliberately NO Escape press here — if the split only became
    // durable via the second block's own blur/Escape commit(), this
    // assertion would fail (the file would still read the pre-split
    // content at this point).
    await expect
      .poll(() => readWrittenFile(page, DOC_PATH))
      .toBe("# Doc\n\nFirst\n\npart");
  });

  test("clicking a different block while editing commits the first block's change", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "# Doc\n\nFirst block.\n\nSecond block.");
    await page.locator('.md-block[data-block-index="1"]').dblclick();
    const editable1 = page.locator(".md-block.editing .inline-edit");
    await expect(editable1).toBeFocused({ timeout: 2000 });
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Edited first block.");

    await page.locator('.md-block[data-block-index="2"]').dblclick();
    await expect(page.locator('.md-block[data-block-index="2"].editing')).toBeVisible({ timeout: 2000 });

    await expect
      .poll(() => readWrittenFile(page, DOC_PATH))
      .toContain("Edited first block.");
  });

  test("editing a heading block preserves its heading markdown prefix on commit", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "# Original Heading\n\nBody text.");
    await page.locator('.md-block[data-block-index="0"]').dblclick();
    const editable = page.locator(".md-block.editing .inline-edit");
    await expect(editable).toBeFocused({ timeout: 2000 });
    // For a heading block, editable.textContent holds the RAW markdown
    // INCLUDING the "# " prefix (confirmed via source: editor.js sets
    // editable.textContent = raw for any non-list block type — only
    // list items get the marker stripped). So replacing the full text
    // means typing the literal "# ..." prefix too, not just the
    // heading's display text.
    await expect(editable).toHaveText("# Original Heading");
    await page.keyboard.press("Control+a");
    await page.keyboard.type("# New Heading Text");
    await page.keyboard.press("Escape");

    await expect
      .poll(() => readWrittenFile(page, DOC_PATH))
      .toContain("# New Heading Text");
  });
});
