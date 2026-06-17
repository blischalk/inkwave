import { describe, it, expect, beforeEach } from "vitest";
import { pushUndo, undoTab, redoTab } from "../../js/fileio.js";

function makeTab(content) {
  return { content, path: "/fake/file.md" };
}

// ── pushUndo ──────────────────────────────────────────────────────────────────

describe("pushUndo", () => {
  it("adds a snapshot to an empty stack", () => {
    const tab = makeTab("hello");
    pushUndo(tab);
    expect(tab._undoStack).toHaveLength(1);
    expect(tab._undoStack[0]).toBe("hello");
  });

  it("does not push a duplicate of the top entry", () => {
    const tab = makeTab("hello");
    pushUndo(tab);
    pushUndo(tab);
    expect(tab._undoStack).toHaveLength(1);
  });

  it("pushes when content has changed", () => {
    const tab = makeTab("hello");
    pushUndo(tab);
    tab.content = "world";
    pushUndo(tab);
    expect(tab._undoStack).toHaveLength(2);
  });

  it("clears the redo stack on push", () => {
    const tab = makeTab("a");
    tab._redoStack = ["previous"];
    pushUndo(tab);
    expect(tab._redoStack).toHaveLength(0);
  });

  it("caps the stack at MAX_UNDO (50) entries", () => {
    const tab = makeTab("");
    for (let i = 0; i < 60; i++) {
      tab.content = `content ${i}`;
      pushUndo(tab);
    }
    expect(tab._undoStack.length).toBeLessThanOrEqual(50);
  });

  it("handles null content gracefully", () => {
    const tab = makeTab(null);
    expect(() => pushUndo(tab)).not.toThrow();
    expect(tab._undoStack[0]).toBe("");
  });
});

// ── undoTab ───────────────────────────────────────────────────────────────────

describe("undoTab", () => {
  it("returns false when stack is empty", () => {
    const tab = makeTab("current");
    expect(undoTab(tab)).toBe(false);
    expect(tab.content).toBe("current");
  });

  it("restores the previous content", () => {
    const tab = makeTab("v1");
    pushUndo(tab);
    tab.content = "v2";
    expect(undoTab(tab)).toBe(true);
    expect(tab.content).toBe("v1");
  });

  it("pushes the current content onto the redo stack", () => {
    const tab = makeTab("v1");
    pushUndo(tab);
    tab.content = "v2";
    undoTab(tab);
    expect(tab._redoStack).toHaveLength(1);
    expect(tab._redoStack[0]).toBe("v2");
  });

  it("supports multiple sequential undos", () => {
    const tab = makeTab("v1");
    pushUndo(tab);
    tab.content = "v2";
    pushUndo(tab);
    tab.content = "v3";
    undoTab(tab);
    expect(tab.content).toBe("v2");
    undoTab(tab);
    expect(tab.content).toBe("v1");
  });
});

// ── redoTab ───────────────────────────────────────────────────────────────────

describe("redoTab", () => {
  it("returns false when redo stack is empty", () => {
    const tab = makeTab("current");
    expect(redoTab(tab)).toBe(false);
    expect(tab.content).toBe("current");
  });

  it("restores the undone content", () => {
    const tab = makeTab("v1");
    pushUndo(tab);
    tab.content = "v2";
    undoTab(tab);
    expect(redoTab(tab)).toBe(true);
    expect(tab.content).toBe("v2");
  });

  it("pushes the current content back onto the undo stack", () => {
    const tab = makeTab("v1");
    pushUndo(tab);
    tab.content = "v2";
    undoTab(tab);
    redoTab(tab);
    expect(tab._undoStack[tab._undoStack.length - 1]).toBe("v1");
  });

  it("redo stack is cleared by pushUndo after a new edit", () => {
    const tab = makeTab("v1");
    pushUndo(tab);
    tab.content = "v2";
    undoTab(tab);
    // new edit after undo wipes redo
    tab.content = "v3";
    pushUndo(tab);
    expect(tab._redoStack).toHaveLength(0);
    expect(redoTab(tab)).toBe(false);
  });

  it("round-trips undo then redo back to original content", () => {
    const tab = makeTab("original");
    pushUndo(tab);
    tab.content = "edited";
    undoTab(tab);
    redoTab(tab);
    expect(tab.content).toBe("edited");
  });
});
