// E2E coverage for cross-block ArrowUp/ArrowDown cursor navigation in the
// block/WYSIWYG editor. Each paragraph is its own isolated contenteditable
// element; the browser has no native concept of "the block above/below",
// so plain ArrowUp/ArrowDown at a block's own text boundary previously did
// nothing — reported by the user as "I'm on the second line, can't arrow
// up to the line above, this is unusable trash." Confirmed via git diff
// against the pre-feature-branch commit that this was a PRE-EXISTING gap,
// not a regression introduced by raw-editor-gutter or any other change in
// this session — but real and worth fixing regardless of origin.
import { test, expect } from "@playwright/test";
import { gotoApp, setMockOverride, readWrittenFile } from "./helpers.js";

async function openDoc(page, content) {
  await setMockOverride(page, "open_file", { root: "/mock/notes", path: "/mock/notes/doc.md", content });
  await page.locator("#openBtn").click();
  await page.locator('#openMenu button[data-action="file"]').click();
  await expect(page.locator(".tab")).toHaveCount(1);
}

test("ArrowUp from start of second block moves editing into first block", async ({ page }) => {
  await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
  await page.waitForSelector(".content", { state: "attached" });
  await openDoc(page, "First paragraph.\n\nSecond paragraph.");

  await page.locator('.md-block[data-block-index="1"]').dblclick();
  const editable = page.locator(".md-block.editing .inline-edit");
  await expect(editable).toBeFocused({ timeout: 2000 });
  await page.keyboard.press("Home");

  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(200);

  const editingIndex = await page.evaluate(() => {
    const el = document.querySelector(".md-block.editing");
    return el ? el.getAttribute("data-block-index") : "NONE";
  });
  expect(editingIndex).toBe("0");
});

test("ArrowDown from end of first block moves editing into second block", async ({ page }) => {
  await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
  await page.waitForSelector(".content", { state: "attached" });
  await openDoc(page, "First paragraph.\n\nSecond paragraph.");

  await page.locator('.md-block[data-block-index="0"]').dblclick();
  const editable = page.locator(".md-block.editing .inline-edit");
  await expect(editable).toBeFocused({ timeout: 2000 });
  await page.keyboard.press("Control+End");

  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(200);

  const editingIndex = await page.evaluate(() => {
    const el = document.querySelector(".md-block.editing");
    return el ? el.getAttribute("data-block-index") : "NONE";
  });
  expect(editingIndex).toBe("1");
});

test("ArrowUp stays within a single wrapped-text block, does not jump to the block above (regression guard)", async ({ page }) => {
  await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
  await page.waitForSelector(".content", { state: "attached" });
  await openDoc(page, "First paragraph.\n\nSecond paragraph.");

  await page.locator('.md-block[data-block-index="1"]').dblclick();
  const editable = page.locator(".md-block.editing .inline-edit");
  await expect(editable).toBeFocused({ timeout: 2000 });
  // Narrow the editable so a long single line of text wraps across
  // multiple VISUAL rows while still being ONE block/paragraph — this
  // exercises the "moved vertically within this block, don't jump"
  // branch without the Shift+Enter edge case (which creates a new
  // block in this test harness for unrelated reasons, confirmed via a
  // throwaway diagnostic — not something this ArrowUp fix needs to
  // handle differently from any other within-block caret movement).
  await editable.evaluate((el) => { el.style.width = "100px"; });
  await page.keyboard.press("Control+End");
  await page.keyboard.type(
    " and a lot more additional text that will definitely wrap across several visual rows in a one hundred pixel wide box"
  );
  await page.waitForTimeout(100);
  await page.keyboard.press("Control+End"); // caret on the LAST wrapped visual row

  await page.keyboard.press("ArrowUp"); // should move up one VISUAL row, still inside block 1
  await page.waitForTimeout(200);

  const editingIndex = await page.evaluate(() => {
    const el = document.querySelector(".md-block.editing");
    return el ? el.getAttribute("data-block-index") : "NONE";
  });
  expect(editingIndex).toBe("1"); // still block 1, did NOT jump to block 0
});

test("ArrowUp on the FIRST block does nothing (no block above to navigate into)", async ({ page }) => {
  await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
  await page.waitForSelector(".content", { state: "attached" });
  await openDoc(page, "First paragraph.\n\nSecond paragraph.");

  await page.locator('.md-block[data-block-index="0"]').dblclick();
  const editable = page.locator(".md-block.editing .inline-edit");
  await expect(editable).toBeFocused({ timeout: 2000 });
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(200);

  const editingIndex = await page.evaluate(() => {
    const el = document.querySelector(".md-block.editing");
    return el ? el.getAttribute("data-block-index") : "NONE";
  });
  expect(editingIndex).toBe("0"); // stayed put
});

test("ArrowDown on the LAST block does nothing (no block below to navigate into)", async ({ page }) => {
  await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
  await page.waitForSelector(".content", { state: "attached" });
  await openDoc(page, "First paragraph.\n\nSecond paragraph.");

  await page.locator('.md-block[data-block-index="1"]').dblclick();
  const editable = page.locator(".md-block.editing .inline-edit");
  await expect(editable).toBeFocused({ timeout: 2000 });
  await page.keyboard.press("Control+End");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(200);

  const editingIndex = await page.evaluate(() => {
    const el = document.querySelector(".md-block.editing");
    return el ? el.getAttribute("data-block-index") : "NONE";
  });
  expect(editingIndex).toBe("1"); // stayed put
});

test("ArrowUp lands the cursor at the END of the block above, not the start", async ({ page }) => {
  await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
  await page.waitForSelector(".content", { state: "attached" });
  await openDoc(page, "First paragraph.\n\nSecond paragraph.");

  await page.locator('.md-block[data-block-index="1"]').dblclick();
  const editable1 = page.locator(".md-block.editing .inline-edit");
  await expect(editable1).toBeFocused({ timeout: 2000 });
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowUp");

  const editable0 = page.locator('.md-block[data-block-index="0"].editing .inline-edit');
  await expect(editable0).toBeFocused({ timeout: 2000 });
  const caretAtEnd = await editable0.evaluate((el) => {
    const sel = window.getSelection();
    return sel.anchorOffset === el.textContent.length;
  });
  expect(caretAtEnd).toBe(true);
});

test("ArrowDown lands the cursor at the START of the block below, not the end", async ({ page }) => {
  await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
  await page.waitForSelector(".content", { state: "attached" });
  await openDoc(page, "First paragraph.\n\nSecond paragraph.");

  await page.locator('.md-block[data-block-index="0"]').dblclick();
  const editable0 = page.locator(".md-block.editing .inline-edit");
  await expect(editable0).toBeFocused({ timeout: 2000 });
  await page.keyboard.press("Control+End");
  await page.keyboard.press("ArrowDown");

  const editable1 = page.locator('.md-block[data-block-index="1"].editing .inline-edit');
  await expect(editable1).toBeFocused({ timeout: 2000 });
  const caretAtStart = await editable1.evaluate((el) => {
    const sel = window.getSelection();
    return sel.anchorOffset === 0;
  });
  expect(caretAtStart).toBe(true);
});

test("cross-block ArrowUp autosaves content typed in the second block before navigating away", async ({ page }) => {
  await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
  await page.waitForSelector(".content", { state: "attached" });
  await setMockOverride(page, "open_file", {
    root: "/mock/notes", path: "/mock/notes/doc2.md", content: "First paragraph.\n\nSecond paragraph.",
  });
  await page.locator("#openBtn").click();
  await page.locator('#openMenu button[data-action="file"]').click();
  await expect(page.locator(".tab")).toHaveCount(1);

  await page.locator('.md-block[data-block-index="1"]').dblclick();
  const editable = page.locator(".md-block.editing .inline-edit");
  await expect(editable).toBeFocused({ timeout: 2000 });
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" EDITED");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(200);

  const written = await readWrittenFile(page, "/mock/notes/doc2.md");
  expect(written).toContain("Second paragraph. EDITED");
});
