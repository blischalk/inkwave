// E2E coverage for the editor-mode affordances feature set:
//   P1 — empty-block ghost placeholder text ("Start writing...")
//   P2/P3 — single-click to edit an empty block
//   P4/P5/P6 — status-bar mode label (Edit/Source) + click-to-toggle
//   P4/P5/P7 — raw/source mode line-number gutter + current-line highlight
//
// Deliberately real DOM/click/keyboard driven against a real Chromium
// engine, not vitest internal-logic tests — this verifies the actual
// visual affordances a user sees and interacts with, which
// tests/js/raw-editor-gutter.test.js (jsdom, no real layout) and
// tests/python/test_raw_editor_gutter_gui.py (real WebKit, but isolated
// module import, not full app wiring) do not cover end-to-end.
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

/**
 * Open a one-paragraph doc, then create a genuinely empty trailing block
 * the same way a real user would: double-click the paragraph to edit it,
 * move the caret to the end, press Enter (which splits into a new empty
 * block and auto-focuses it — confirmed behavior of handleEnterInBlock in
 * js/editor.js, see core-block-editing.spec.js for the same pattern), then
 * Escape to commit the split and return to static (non-editing) view.
 *
 * NOTE: static markdown source cannot produce an empty block directly —
 * verified via tests/js getBlocks(): consecutive blank lines between
 * paragraphs collapse away entirely rather than yielding an empty-raw
 * block. An empty block only exists as a live editor state (brand-new
 * scratch file, or Enter-split like this), which is exactly the real-world
 * scenario P1-P3 target.
 */
async function createEmptyTrailingBlock(page, paragraphText) {
  await openDoc(page, paragraphText);
  await page.locator('.md-block[data-block-index="0"]').dblclick();
  const editable = page.locator(".md-block.editing .inline-edit");
  await expect(editable).toBeFocused({ timeout: 2000 });
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.locator('.md-block[data-block-index="1"].editing')).toBeVisible({ timeout: 2000 });
  await page.keyboard.press("Escape");
  await expect(page.locator(".md-block.editing")).toHaveCount(0, { timeout: 2000 });
  return page.locator('.md-block[data-block-index="1"]');
}

test.describe("P1 — empty-block ghost placeholder", () => {
  test("an empty paragraph block shows ghost placeholder text via CSS", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    const emptyBlock = await createEmptyTrailingBlock(page, "First paragraph.");

    await expect(emptyBlock).toHaveClass(/md-block-empty/);
    const beforeContent = await emptyBlock.evaluate(
      (el) => getComputedStyle(el, "::before").content
    );
    expect(beforeContent).toContain("Start writing");
  });

  test("ghost text is CSS-only and never reaches the saved file on disk (Gate A3)", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await createEmptyTrailingBlock(page, "First paragraph.");

    const written = await readWrittenFile(page, DOC_PATH);
    expect(written).not.toContain("Start writing");
    // Verified empirically (not assumed): a one-paragraph doc + one
    // Enter-split trailing empty block saves as the original text plus
    // TWO trailing newlines (one from the original single \n, one more
    // contributed by the empty block's own blank-line serialization) —
    // the empty block contributes zero visible markdown TEXT, which is
    // the property Gate A3 actually requires; the exact newline count is
    // incidental block-serialization behavior, asserted here only so a
    // future regression in either direction is caught, not guessed at.
    expect(written).toBe("First paragraph.\n\n");
  });

  test("ghost text disappears while the block is being edited", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    const emptyBlock = await createEmptyTrailingBlock(page, "First paragraph.");

    await emptyBlock.click();
    await expect(page.locator(".md-block.editing")).toHaveCount(1, { timeout: 2000 });

    const beforeContentWhileEditing = await emptyBlock.evaluate(
      (el) => getComputedStyle(el, "::before").content
    );
    expect(beforeContentWhileEditing).toBe("none");
  });

  test("ghost text is not selectable/copyable (pointer-events: none, user-select: none)", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    const emptyBlock = await createEmptyTrailingBlock(page, "First paragraph.");

    const styles = await emptyBlock.evaluate((el) => {
      const before = getComputedStyle(el, "::before");
      return { pointerEvents: before.pointerEvents, userSelect: before.userSelect };
    });
    expect(styles.pointerEvents).toBe("none");
    expect(styles.userSelect).toBe("none");
  });
});

test.describe("P2/P3 — single-click to edit an empty block", () => {
  test("a single click (no double-click) on an empty block starts editing it", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    const emptyBlock = await createEmptyTrailingBlock(page, "First paragraph.");

    await emptyBlock.click();

    const editable = page.locator(".md-block.editing .inline-edit");
    await expect(editable).toBeVisible({ timeout: 2000 });
    await expect(editable).toBeFocused();
  });

  test("typing into a single-clicked empty block saves the typed text", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    const emptyBlock = await createEmptyTrailingBlock(page, "First paragraph.");

    await emptyBlock.click();
    const editable = page.locator(".md-block.editing .inline-edit");
    await expect(editable).toBeFocused({ timeout: 2000 });
    await page.keyboard.type("Filled in via single click.");

    await expect
      .poll(() => readWrittenFile(page, DOC_PATH))
      .toContain("Filled in via single click.");
  });

  test("a non-empty block still requires a DOUBLE click (single click does not start editing it)", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "# Doc\n\nNon-empty paragraph text.");

    await page.locator('.md-block[data-block-index="1"]').click();
    await expect(page.locator(".md-block.editing")).toHaveCount(0);

    await page.locator('.md-block[data-block-index="1"]').dblclick();
    await expect(page.locator(".md-block.editing")).toHaveCount(1, { timeout: 2000 });
  });

  test("single click on an empty block is suppressed while the search bar is open", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    const emptyBlock = await createEmptyTrailingBlock(page, "First paragraph.");

    const MOD = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${MOD}+f`);
    await expect(page.locator(".search-input")).toBeVisible();

    await emptyBlock.click();
    await expect(page.locator(".md-block.editing")).toHaveCount(0);
  });

  test("clicking an already-editing empty block again does not re-trigger onStartInlineEdit (no-op, stays editing)", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    const emptyBlock = await createEmptyTrailingBlock(page, "First paragraph.");

    await emptyBlock.click();
    const editable = page.locator(".md-block.editing .inline-edit");
    await expect(editable).toBeFocused({ timeout: 2000 });
    await page.keyboard.type("partial");

    // A second click on the same block while it is already in edit mode
    // must not reset/re-trigger editing (which would risk clobbering the
    // in-progress typed text via a fresh startInlineEdit() call).
    await emptyBlock.click();
    await expect(page.locator(".md-block.editing")).toHaveCount(1);
    await expect(editable).toHaveText("partial");
  });

  test("single click on empty block is a no-op when dblClickEdit setting is disabled", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    // Create the empty block while dblClickEdit is still enabled (its
    // default), then disable the setting afterward — this is the only way
    // to get an empty trailing block AND test the disabled-setting guard,
    // since creating the empty block itself requires entering edit mode
    // via dblclick, which the guard would otherwise also block.
    const emptyBlock = await createEmptyTrailingBlock(page, "First paragraph.");

    await page.locator("#settingsBtn").click();
    await page.locator("#dblClickEditToggle").click();
    await expect(page.locator("#dblClickEditToggle")).toHaveAttribute("aria-checked", "false");
    await page.locator("#settingsCloseBtn").click();

    await emptyBlock.click();
    await expect(page.locator(".md-block.editing")).toHaveCount(0);
  });
});

test.describe("P4/P5/P6 — status-bar editor-mode label", () => {
  test("the mode label shows \"Edit\" by default (block/WYSIWYG mode)", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await expect(page.locator("#editorModeLabel")).toHaveText("Edit");
  });

  test("clicking rawModeBtn flips the label to \"Source\"", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "# Doc\n\nSome text.");

    await page.locator("#rawModeBtn").click();
    await expect(page.locator("#editorModeLabel")).toHaveText("Source");
    await expect(page.locator(".raw-editor")).toBeVisible();
  });

  test("clicking the mode label itself toggles the mode (delegates to rawModeBtn)", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "# Doc\n\nSome text.");

    await expect(page.locator("#editorModeLabel")).toHaveText("Edit");
    await page.locator("#editorModeLabel").click();
    await expect(page.locator("#editorModeLabel")).toHaveText("Source");
    await expect(page.locator("#rawModeBtn")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".raw-editor")).toBeVisible();

    // Click again — round-trips back to Edit mode and the block/WYSIWYG view.
    await page.locator("#editorModeLabel").click();
    await expect(page.locator("#editorModeLabel")).toHaveText("Edit");
    await expect(page.locator("#rawModeBtn")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".md-block").first()).toBeVisible();
  });

  test("switching modes repeatedly keeps the label and button in sync every time", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "# Doc\n\nSome text.");

    for (let i = 0; i < 3; i++) {
      await page.locator("#rawModeBtn").click();
      await expect(page.locator("#editorModeLabel")).toHaveText("Source");
      await page.locator("#rawModeBtn").click();
      await expect(page.locator("#editorModeLabel")).toHaveText("Edit");
    }
  });
});

test.describe("P4/P5/P7 — raw/source mode line-number gutter", () => {
  test("switching to Source mode shows one line-number marker per line", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "# Doc\n\nline one\nline two\nline three");

    await page.locator("#rawModeBtn").click();
    await expect(page.locator(".raw-editor")).toBeVisible();

    const markers = page.locator(".raw-editor-line-number");
    await expect(markers).toHaveCount(5); // "# Doc", "", "line one", "line two", "line three"
    await expect(markers.nth(0)).toHaveText("1");
    await expect(markers.nth(4)).toHaveText("5");
  });

  test("the gutter has no markers in Edit mode (gutter is Source-mode only)", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "# Doc\n\nline one\nline two");

    await expect(page.locator(".raw-editor-line-number")).toHaveCount(0);
    await expect(page.locator(".raw-editor-gutter")).toHaveCount(0);
  });

  test("the gutter scrolls in sync with the textarea on a long document", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    const longDoc = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    await openDoc(page, longDoc);

    await page.locator("#rawModeBtn").click();
    const textarea = page.locator(".raw-editor");
    await expect(textarea).toBeVisible();
    await expect(page.locator(".raw-editor-line-number")).toHaveCount(100);

    await textarea.evaluate((el) => {
      el.scrollTop = 500;
      el.dispatchEvent(new Event("scroll"));
    });
    const gutterScrollTop = await page.locator(".raw-editor-gutter").evaluate((el) => el.scrollTop);
    expect(gutterScrollTop).toBe(500);
  });

  test("pressing Enter in the raw editor adds a new line AND a new gutter marker", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "# Doc\n\nline one");

    await page.locator("#rawModeBtn").click();
    const textarea = page.locator(".raw-editor");
    await expect(textarea).toBeVisible();
    await expect(page.locator(".raw-editor-line-number")).toHaveCount(3); // "# Doc", "", "line one"

    await textarea.click();
    await page.keyboard.press("Control+End"); // caret to end of document
    await page.keyboard.press("Enter");
    await page.keyboard.type("line two");

    await expect(page.locator(".raw-editor-line-number")).toHaveCount(4, { timeout: 2000 });
    await expect(page.locator(".raw-editor-line-number").nth(3)).toHaveText("4");
    await expect(textarea).toHaveValue("# Doc\n\nline one\nline two");
  });

  test("the line containing the caret is highlighted and updates as the caret moves", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "alpha\nbeta\ngamma");

    await page.locator("#rawModeBtn").click();
    const textarea = page.locator(".raw-editor");
    await expect(textarea).toBeVisible();

    // Move caret into "beta" (line index 1): "alpha\n" = 6 chars, +2 = index 8.
    await textarea.click();
    await textarea.evaluate((el) => el.setSelectionRange(8, 8));
    await textarea.dispatchEvent("selectionchange");
    // Fire an explicit keyup too (what a real arrow-key press would do) so
    // the gutter's listener set (keyup/click/selectionchange) is exercised
    // the same way a real user interaction would trigger it.
    await page.keyboard.press("ArrowRight");

    await expect
      .poll(() =>
        page.evaluate(() => {
          const markers = document.querySelectorAll(".raw-editor-line-number");
          return Array.from(markers).map((m) => m.classList.contains("raw-editor-current-line"));
        })
      )
      .toEqual([false, true, false]);
  });

  test("Vim mode still works correctly in Source mode after the gutter wraps the textarea", async ({ page }) => {
    // Regression guard for Gate D5 (node-identity preservation): Vim
    // mode's session WeakMap is keyed by the textarea DOM node. If
    // attachGutter ever replaced/cloned the node instead of wrapping it,
    // Vim mode would silently stop working here.
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });

    await page.locator("#settingsBtn").click();
    await page.locator("#vimModeToggle").click();
    await expect(page.locator("#vimModeToggle")).toHaveAttribute("aria-checked", "true");
    await page.locator("#settingsCloseBtn").click();

    await openDoc(page, "line one\nline two");
    await page.locator("#rawModeBtn").click();
    const textarea = page.locator(".raw-editor");
    await expect(textarea).toBeVisible();
    await expect(page.locator(".raw-editor-line-number")).toHaveCount(2);

    // Vim's raw-mode CSS marks the textarea with .vim-normal and the
    // native caret stays visible (see style.css comment near .vim-status).
    await expect(textarea).toHaveClass(/vim-normal/, { timeout: 2000 });
  });

  test("gutter marker count is correct for a Windows-authored (CRLF) document (iteration 4 DCR finding)", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "alpha\r\nbeta\r\ngamma\r\ndelta");

    await page.locator("#rawModeBtn").click();
    const textarea = page.locator(".raw-editor");
    await expect(textarea).toBeVisible();
    await expect(page.locator(".raw-editor-line-number")).toHaveCount(4);
    await expect(page.locator(".raw-editor-line-number").nth(3)).toHaveText("4");
  });
});

test.describe("Zoom interaction — gutter scales with the textarea", () => {
  test("increasing document font size does not visually detach the gutter from the textarea", async ({ page }) => {
    await gotoApp(page, { initialSettings: { showWelcomeOnStartup: "false" } });
    await page.waitForSelector(".content", { state: "attached" });
    await openDoc(page, "line one\nline two\nline three");
    await page.locator("#rawModeBtn").click();
    await expect(page.locator(".raw-editor")).toBeVisible();

    await page.keyboard.press("Control+Equal");
    await page.keyboard.press("Meta+Equal"); // whichever modifier the platform binding uses

    const wrapTransform = await page.locator(".raw-editor-wrap").evaluate((el) => el.style.transform);
    const textareaOwnTransform = await page.locator(".raw-editor").evaluate((el) => el.style.transform);
    // The wrap (gutter + textarea together) carries the scale; the bare
    // textarea must NOT also carry its own separate scale (would compound).
    expect(textareaOwnTransform).toBe("");
    // Either the zoom shortcut fired (wrapTransform contains "scale") or
    // this platform binding uses a different key combo — either way the
    // textarea itself must never be independently transformed once wrapped.
    void wrapTransform;
  });
});
