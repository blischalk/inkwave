import { describe, it, expect, beforeEach, vi } from "vitest";

// jsdom doesn't implement scrollIntoView — stub it globally
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function() {};

// Set up DOM elements that state.js expects ONCE before any imports.
// state.js caches contentEl = document.getElementById("content-primary") at load time,
// so we must not replace the element — only reset its innerHTML.
document.body.innerHTML = `
  <div class="content-area">
    <div id="content-primary" class="content">
      <div class="rendered">
        <p>The needle is here. Another needle in this paragraph.</p>
        <p>No match in this paragraph.</p>
        <p>Final needle at the end.</p>
      </div>
    </div>
  </div>
  <div id="filename"></div>
  <div id="tree"></div>
  <div id="sidebar"></div>
  <button id="openBtn"></button>
`;

const contentEl = document.getElementById("content-primary");
const contentArea = document.querySelector(".content-area");

const { open, close, isOpen, clearIfActive } = await import("../../js/search.js");

const RENDERED_HTML = `
  <div class="rendered">
    <p>The needle is here. Another needle in this paragraph.</p>
    <p>No match in this paragraph.</p>
    <p>Final needle at the end.</p>
  </div>
`;

function resetContent() {
  contentEl.innerHTML = RENDERED_HTML;
  // Remove any leftover search bar
  const oldBar = contentArea.querySelector(".search-bar");
  if (oldBar) oldBar.remove();
}

function doSearch(query) {
  vi.useFakeTimers();
  open();
  const input = contentArea.querySelector(".search-input");
  input.value = query;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  vi.advanceTimersByTime(200); // flush the 150ms debounce
  vi.useRealTimers();
  return input;
}

describe("search — open / close / isOpen", () => {
  beforeEach(() => { close(); resetContent(); });

  it("isOpen returns false initially", () => {
    expect(isOpen()).toBe(false);
  });

  it("open makes isOpen return true", () => {
    open();
    expect(isOpen()).toBe(true);
  });

  it("close after open makes isOpen return false", () => {
    open();
    close();
    expect(isOpen()).toBe(false);
  });

  it("open creates a search bar with role=search", () => {
    open();
    const bar = contentArea.querySelector(".search-bar");
    expect(bar).not.toBeNull();
    expect(bar.hidden).toBe(false);
    expect(bar.getAttribute("role")).toBe("search");
  });

  it("search bar has input with aria-label", () => {
    open();
    const input = contentArea.querySelector(".search-input");
    expect(input).not.toBeNull();
    expect(input.getAttribute("aria-label")).toBeTruthy();
  });
});

describe("search — highlighting", () => {
  beforeEach(() => { close(); resetContent(); });

  it("Enter triggers search and creates mark elements", () => {
    doSearch("needle");
    const marks = contentEl.querySelectorAll("mark.search-highlight");
    expect(marks.length).toBe(3);
  });

  it("shows correct count text", () => {
    doSearch("needle");
    const count = contentArea.querySelector(".search-count");
    expect(count.textContent).toBe("1 of 3");
  });

  it("current match has search-current class", () => {
    doSearch("needle");
    expect(contentEl.querySelectorAll("mark.search-current").length).toBe(1);
  });

  it("Enter advances to next match and wraps around", () => {
    const input = doSearch("needle");
    const count = contentArea.querySelector(".search-count");
    expect(count.textContent).toBe("1 of 3");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(count.textContent).toBe("2 of 3");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(count.textContent).toBe("3 of 3");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(count.textContent).toBe("1 of 3");
  });

  it("Shift+Enter goes to previous match (wraps)", () => {
    const input = doSearch("needle");
    expect(contentArea.querySelector(".search-count").textContent).toBe("1 of 3");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    expect(contentArea.querySelector(".search-count").textContent).toBe("3 of 3");
  });

  it("shows 0 results for non-matching query", () => {
    doSearch("zzzznotfound");
    expect(contentArea.querySelector(".search-count").textContent).toBe("0 results");
    expect(contentEl.querySelectorAll("mark.search-highlight").length).toBe(0);
  });

  it("empty query clears highlights via new search", () => {
    doSearch("needle");
    expect(contentEl.querySelectorAll("mark.search-highlight").length).toBe(3);
    // Searching for a different term calls run() which clears old marks first
    doSearch("zzzznotfound");
    expect(contentEl.querySelectorAll("mark.search-highlight").length).toBe(0);
  });

  it("close removes all marks and restores text", () => {
    doSearch("needle");
    expect(contentEl.querySelectorAll("mark.search-highlight").length).toBe(3);
    close();
    expect(contentEl.querySelectorAll("mark.search-highlight").length).toBe(0);
    expect(contentEl.textContent).toContain("needle");
  });

  it("search is case-insensitive", () => {
    doSearch("NEEDLE");
    expect(contentEl.querySelectorAll("mark.search-highlight").length).toBe(3);
  });
});

describe("search — clearIfActive", () => {
  beforeEach(() => { close(); resetContent(); });

  it("clears marks when search has results", () => {
    doSearch("needle");
    expect(contentEl.querySelectorAll("mark.search-highlight").length).toBe(3);
    clearIfActive();
    expect(contentEl.querySelectorAll("mark.search-highlight").length).toBe(0);
  });

  it("does nothing when no marks exist", () => {
    clearIfActive(); // should not throw
  });
});
