// Unit coverage for js/raw-editor-gutter.js.
//
// SCOPE NOTE: jsdom has no real layout engine — getBoundingClientRect()
// always returns zeros, so per-line pixel height measurement (the mirror
// technique in recompute()) cannot be meaningfully unit-tested here. That
// behavior is covered in:
//   - tests/python/test_gui.py (real hidden WebKit window, real layout)
//   - tests/e2e/raw-editor-gutter.spec.js (real Chromium via Playwright)
// This file covers everything jsdom CAN verify correctly: pure logic
// (currentLineIndex), DOM structure/lifecycle (wrap creation, node identity
// preservation for Vim mode, idempotent attach, clean detach), and listener
// wiring (that recompute/highlight actually fire on the right events).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { attachGutter, detachGutter, currentLineIndex } from "../../js/raw-editor-gutter.js";

function makeTextarea(value) {
  const el = document.createElement("textarea");
  el.className = "raw-editor";
  el.value = value;
  document.body.appendChild(el);
  return el;
}

describe("currentLineIndex", () => {
  it("returns 0 for caret on the first line", () => {
    const ta = makeTextarea("hello world");
    ta.setSelectionRange(3, 3);
    expect(currentLineIndex(ta)).toBe(0);
    document.body.removeChild(ta);
  });

  it("returns 1 for caret just after the first newline", () => {
    const ta = makeTextarea("line one\nline two");
    ta.setSelectionRange(9, 9); // right after "line one\n"
    expect(currentLineIndex(ta)).toBe(1);
    document.body.removeChild(ta);
  });

  it("returns correct index for caret on a later line", () => {
    const ta = makeTextarea("a\nb\nc\nd");
    ta.setSelectionRange(6, 6); // on "d" (index 6)
    expect(currentLineIndex(ta)).toBe(3);
    document.body.removeChild(ta);
  });

  it("counts a trailing newline as starting a new (empty) line", () => {
    const ta = makeTextarea("abc\n");
    ta.setSelectionRange(4, 4); // caret after the trailing newline
    expect(currentLineIndex(ta)).toBe(1);
    document.body.removeChild(ta);
  });

  it("returns 0 for an empty document", () => {
    const ta = makeTextarea("");
    ta.setSelectionRange(0, 0);
    expect(currentLineIndex(ta)).toBe(0);
    document.body.removeChild(ta);
  });

  it("caret exactly ON a newline character counts as the line before it", () => {
    // selectionStart == 8 means caret sits right before "\n" at index 8
    // in "line one\nline two" — still on line 0 (hasn't crossed the \n yet).
    const ta = makeTextarea("line one\nline two");
    ta.setSelectionRange(8, 8);
    expect(currentLineIndex(ta)).toBe(0);
    document.body.removeChild(ta);
  });

  it("CRLF line endings do not break line-index counting (iteration 4 DCR finding)", () => {
    // fileio.js has zero CRLF handling anywhere (verified via grep) — a
    // Windows-authored .md file opened in raw mode would reach this module
    // with literal \r\n. value.split("\n") still correctly separates on
    // \n alone, leaving a harmless trailing \r on each line's own content;
    // this test proves currentLineIndex's counting logic isn't thrown off
    // by that trailing \r.
    const ta = makeTextarea("line one\r\nline two\r\nline three");
    ta.setSelectionRange(12, 12); // inside "line two"
    expect(currentLineIndex(ta)).toBe(1);
    document.body.removeChild(ta);
  });
});

describe("attachGutter / detachGutter — DOM lifecycle", () => {
  let ta;

  beforeEach(() => {
    ta = makeTextarea("one\ntwo\nthree");
  });

  afterEach(() => {
    // detachGutter is a safe no-op if ta was never attached (verified by its
    // own test below). This single call correctly unwinds whatever state
    // the test left behind — wrap, gutter, and mirror — regardless of
    // whether the test attached, detached-and-reattached, or did neither.
    detachGutter(ta);
    if (ta.parentNode) ta.parentNode.removeChild(ta);
  });

  it("wraps the textarea in a .raw-editor-wrap without replacing the node", () => {
    const originalRef = ta;
    attachGutter(ta);
    expect(ta).toBe(originalRef); // same JS object/node reference — identity preserved
    expect(ta.closest(".raw-editor-wrap")).not.toBeNull();
  });

  it("creates exactly one line-number marker per logical line", () => {
    attachGutter(ta);
    const gutter = ta.closest(".raw-editor-wrap").querySelector(".raw-editor-gutter");
    const markers = gutter.querySelectorAll(".raw-editor-line-number");
    expect(markers.length).toBe(3); // "one", "two", "three"
    expect(markers[0].textContent).toBe("1");
    expect(markers[1].textContent).toBe("2");
    expect(markers[2].textContent).toBe("3");
  });

  it("creates the correct marker count for CRLF content (iteration 4 DCR finding)", () => {
    const crlfTa = document.createElement("textarea");
    crlfTa.className = "raw-editor";
    crlfTa.value = "alpha\r\nbeta\r\ngamma";
    document.body.appendChild(crlfTa);

    attachGutter(crlfTa);
    const gutter = crlfTa.closest(".raw-editor-wrap").querySelector(".raw-editor-gutter");
    const markers = gutter.querySelectorAll(".raw-editor-line-number");
    expect(markers.length).toBe(3);
    expect(markers[2].textContent).toBe("3");

    detachGutter(crlfTa);
    document.body.removeChild(crlfTa);
  });

  it("adds a new marker when a newline is typed (recompute on input)", async () => {
    attachGutter(ta);
    ta.value = "one\ntwo\nthree\nfour";
    ta.dispatchEvent(new Event("input"));
    // recompute() is debounced via requestAnimationFrame to avoid redundant
    // work on rapid keystrokes/scroll — flush one frame before asserting.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const gutter = ta.closest(".raw-editor-wrap").querySelector(".raw-editor-gutter");
    const markers = gutter.querySelectorAll(".raw-editor-line-number");
    expect(markers.length).toBe(4);
    expect(markers[3].textContent).toBe("4");
  });

  it("marks the line containing the caret with raw-editor-current-line", () => {
    attachGutter(ta);
    ta.focus();
    ta.setSelectionRange(5, 5); // on "two" (line index 1)
    document.dispatchEvent(new Event("selectionchange"));
    const gutter = ta.closest(".raw-editor-wrap").querySelector(".raw-editor-gutter");
    const markers = gutter.querySelectorAll(".raw-editor-line-number");
    expect(markers[1].classList.contains("raw-editor-current-line")).toBe(true);
    expect(markers[0].classList.contains("raw-editor-current-line")).toBe(false);
    expect(markers[2].classList.contains("raw-editor-current-line")).toBe(false);
  });

  it("moves the current-line highlight when the caret moves", () => {
    attachGutter(ta);
    ta.focus();
    const gutter = ta.closest(".raw-editor-wrap").querySelector(".raw-editor-gutter");

    ta.setSelectionRange(0, 0);
    document.dispatchEvent(new Event("selectionchange"));
    let markers = gutter.querySelectorAll(".raw-editor-line-number");
    expect(markers[0].classList.contains("raw-editor-current-line")).toBe(true);

    ta.setSelectionRange(10, 10); // on "three" (line index 2)
    document.dispatchEvent(new Event("selectionchange"));
    markers = gutter.querySelectorAll(".raw-editor-line-number");
    expect(markers[2].classList.contains("raw-editor-current-line")).toBe(true);
    expect(markers[0].classList.contains("raw-editor-current-line")).toBe(false);
  });

  it("selectionchange is ignored when a different element has focus (activeElement filter)", () => {
    attachGutter(ta);
    const gutter = ta.closest(".raw-editor-wrap").querySelector(".raw-editor-gutter");
    const markersBefore = gutter.querySelectorAll(".raw-editor-line-number");
    const highlightedBefore = Array.from(markersBefore).map((m) =>
      m.classList.contains("raw-editor-current-line")
    );

    const other = document.createElement("input");
    document.body.appendChild(other);
    other.focus();
    // Move the caret while a DIFFERENT element has focus, then fire the
    // document-level selectionchange event the real browser would fire.
    // Line index 0 differs from whatever attachGutter's own initial
    // recompute() highlighted (jsdom defaults a fresh textarea's caret to
    // the end of its value, not position 0 — verified empirically), so
    // this is a genuine state change being attempted, not a no-op probe.
    ta.setSelectionRange(0, 0);
    document.dispatchEvent(new Event("selectionchange"));

    const markersAfter = gutter.querySelectorAll(".raw-editor-line-number");
    const highlightedAfter = Array.from(markersAfter).map((m) =>
      m.classList.contains("raw-editor-current-line")
    );
    // The filtered-out event must not have changed which marker is
    // highlighted — it should be byte-for-byte identical to before.
    expect(highlightedAfter).toEqual(highlightedBefore);
    document.body.removeChild(other);
  });

  it("is idempotent — calling attachGutter twice does not double-wrap", () => {
    attachGutter(ta);
    const wrapAfterFirst = ta.closest(".raw-editor-wrap");
    attachGutter(ta); // second call must be a no-op
    const wrapAfterSecond = ta.closest(".raw-editor-wrap");
    expect(wrapAfterSecond).toBe(wrapAfterFirst);
    expect(document.querySelectorAll(".raw-editor-wrap").length).toBe(1);
  });

  it("detachGutter restores the textarea to its original parent", () => {
    const container = document.createElement("div");
    container.id = "test-container";
    document.body.appendChild(container);
    container.appendChild(ta);

    attachGutter(ta);
    expect(ta.parentNode.className).toContain("raw-editor-wrap");

    detachGutter(ta);
    expect(ta.parentNode).toBe(container);
    expect(document.querySelectorAll(".raw-editor-wrap").length).toBe(0);
    expect(document.querySelectorAll(".raw-editor-gutter").length).toBe(0);

    container.remove();
  });

  it("cancels a pending requestAnimationFrame recompute on detach (code review fix, 2026-10-15)", async () => {
    // Regression test: before the fix, calling detachGutter while an
    // input-triggered recompute() was still queued on a RAF let that
    // callback fire AFTER teardown, running getBoundingClientRect() /
    // getComputedStyle() against an already-removed gutter and mirror,
    // and re-populating the (now detached, invisible) gutter div with
    // fresh marker children — wasted work with no visible symptom, but a
    // real teardown-contract violation. Detect it by keeping a direct
    // reference to the gutter div (captured before detach) and asserting
    // it stays EMPTY after the next frame — if the stale frame still ran,
    // recompute() would call gutter.innerHTML = "" then repopulate it.
    attachGutter(ta);
    const gutterRef = ta.closest(".raw-editor-wrap").querySelector(".raw-editor-gutter");
    const markerCountBeforeDetach = gutterRef.querySelectorAll(".raw-editor-line-number").length;
    expect(markerCountBeforeDetach).toBeGreaterThan(0); // sanity: attach's own recompute populated it

    ta.value = "one\ntwo\nthree\nfour"; // changes line count from 3 to 4
    ta.dispatchEvent(new Event("input")); // schedules a recompute via RAF, not yet flushed
    detachGutter(ta); // must cancel the pending frame before it can touch gutterRef again

    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve)); // one extra frame margin

    // If the pending frame were NOT cancelled, recompute() would have run
    // against the detached gutterRef and left it with 4 fresh markers
    // (matching the post-input 4-line value) instead of being untouched
    // since detach. The old buggy code would fail this assertion.
    expect(gutterRef.querySelectorAll(".raw-editor-line-number").length).toBe(markerCountBeforeDetach);
  });

  it("detachGutter removes the hidden mirror element from document.body", () => {
    attachGutter(ta);
    const mirrorCountAfterAttach = document.querySelectorAll(
      'div[aria-hidden="true"]:not(.raw-editor-gutter)'
    ).length;
    expect(mirrorCountAfterAttach).toBeGreaterThan(0);

    detachGutter(ta);
    const mirrorCountAfterDetach = document.querySelectorAll(
      'div[aria-hidden="true"]:not(.raw-editor-gutter)'
    ).length;
    expect(mirrorCountAfterDetach).toBe(0);
  });

  it("detachGutter on a never-attached textarea is a safe no-op", () => {
    expect(() => detachGutter(ta)).not.toThrow();
  });

  it("gutter is marked aria-hidden so it is not a duplicate screen-reader target", () => {
    attachGutter(ta);
    const gutter = ta.closest(".raw-editor-wrap").querySelector(".raw-editor-gutter");
    expect(gutter.getAttribute("aria-hidden")).toBe("true");
  });

  it("re-finding the textarea via .raw-editor still works after wrapping (settings.js / vim.js pattern)", () => {
    const container = document.createElement("div");
    container.id = "content";
    document.body.appendChild(container);
    container.appendChild(ta);
    attachGutter(ta);

    const found = container.querySelector(".raw-editor");
    expect(found).toBe(ta);
    container.remove();
  });
});
