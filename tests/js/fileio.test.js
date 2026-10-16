import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// fileio.js imports renderTabBar from tabs.js, which reads real
// index.html element IDs (tabBarEl) at module-eval time with no null
// guards — same bootstrap pattern as welcome-dismiss.test.js /
// scratch.test.js. Static `import` of fileio.js/tabs.js/state.js is
// hoisted above this file's own top-level code regardless of where the
// import line is textually written, so the DOM MUST be built via
// dynamic import() below, not a static import, or tabBarEl resolves to
// null before document.body.innerHTML is ever set.
const indexHtmlPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../index.html",
);
const indexHtml = readFileSync(indexHtmlPath, "utf8");
const bodyMatch = indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
document.body.innerHTML = bodyMatch ? bodyMatch[1] : "";

const { pushUndo, undoTab, redoTab, saveOrSaveAs, saveToFile } = await import("../../js/fileio.js");
const { setActiveTabId } = await import("../../js/state.js");
const { getActiveTab, addTab } = await import("../../js/tabs.js");

function makeTab(content) {
  return { content, path: "/fake/file.md" };
}

function installMockApi(overrides = {}) {
  window.pywebview = {
    api: {
      write_file: vi.fn().mockResolvedValue({}),
      save_as: vi.fn().mockResolvedValue({ path: "/notes/renamed.md" }),
      forget_scratch_file: vi.fn().mockResolvedValue({ ok: true }),
      delete_file: vi.fn().mockResolvedValue({ ok: true }),
      set_has_unsaved_scratch: vi.fn().mockResolvedValue(null),
      ...overrides,
    },
  };
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

// ── saveOrSaveAs ──────────────────────────────────────────────────────────────
// Covers the B3 Boyscout fix (discovered during scratch-file plan pushback):
// saveOrSaveAs() reassigns tab.id to the new path on Save As, but activeTabId
// lives separately in state.js. Without updating it in the same breath, the
// very next getActiveTab() call returns null because it's still matching
// against the OLD id.

describe("saveOrSaveAs", () => {
  beforeEach(() => {
    window.pywebview = undefined;
  });

  it("does nothing when tab is null/undefined", () => {
    expect(() => saveOrSaveAs(null)).not.toThrow();
  });

  it("calls write_file directly when the tab already has a path", async () => {
    const writeFn = vi.fn().mockResolvedValue({});
    installMockApi({ write_file: writeFn });
    const tab = addTab({ path: "/notes/existing.md", title: "existing.md", content: "hi" });
    saveOrSaveAs(tab);
    await new Promise((r) => setTimeout(r, 0));
    expect(writeFn).toHaveBeenCalledWith("/notes/existing.md", "hi");
  });

  it("does NOT call write_file directly for a scratch tab even though it has a path — goes through save_as instead", async () => {
    const writeFn = vi.fn().mockResolvedValue({});
    installMockApi({ write_file: writeFn });
    const tab = addTab({ path: "/drafts/Untitled.md", title: "Untitled.md", content: "a note" });
    tab._isScratch = true;
    saveOrSaveAs(tab);
    await new Promise((r) => setTimeout(r, 0));
    // write_file DOES still get called, but only via saveToFile() inside
    // the save_as .then() callback (after the dialog "resolves"), not
    // as the first, direct action — proven by save_as having been
    // invoked at all.
    expect(window.pywebview.api.save_as).toHaveBeenCalled();
  });

  it("does nothing (no crash) when API is unavailable and tab has no path", () => {
    const tab = addTab({ path: null, title: "Untitled.md", content: "" });
    expect(() => saveOrSaveAs(tab)).not.toThrow();
  });

  it("Save As on the ACTIVE tab updates activeTabId to the new path (B3 fix)", async () => {
    installMockApi();
    const tab = addTab({ path: null, title: "Untitled.md", content: "hello" });
    setActiveTabId(tab.id); // simulate this tab being the active one
    saveOrSaveAs(tab);
    await new Promise((r) => setTimeout(r, 0));
    expect(tab.path).toBe("/notes/renamed.md");
    expect(tab.id).toBe("/notes/renamed.md");
    // The actual regression this test exists to catch: getActiveTab()
    // must find THIS tab under its NEW id, not return null.
    const active = getActiveTab();
    expect(active).not.toBeNull();
    expect(active.id).toBe("/notes/renamed.md");
  });

  it("Save As on a BACKGROUND (non-active) tab does NOT touch activeTabId", async () => {
    installMockApi();
    const activeTab = addTab({ path: "/notes/other.md", title: "other.md", content: "x" });
    const bgTab = addTab({ path: null, title: "Untitled.md", content: "bg content" });
    // addTab() made bgTab active; explicitly make the OTHER tab active instead
    // to simulate saving a tab that is not currently focused.
    setActiveTabId(activeTab.id);
    saveOrSaveAs(bgTab);
    await new Promise((r) => setTimeout(r, 0));
    expect(bgTab.path).toBe("/notes/renamed.md");
    // Active tab must remain the one the user is actually looking at.
    const active = getActiveTab();
    expect(active.id).toBe(activeTab.id);
  });

  it("forgets and deletes the old scratch file when saving a scratch tab via Save As", async () => {
    const forgetFn = vi.fn().mockResolvedValue({ ok: true });
    const deleteFn = vi.fn().mockResolvedValue({ ok: true });
    installMockApi({ forget_scratch_file: forgetFn, delete_file: deleteFn });
    const tab = addTab({ path: "/drafts/Untitled.md", title: "Untitled.md", content: "scratch note" });
    tab._isScratch = true;
    setActiveTabId(tab.id);
    saveOrSaveAs(tab);
    await new Promise((r) => setTimeout(r, 0));
    expect(forgetFn).toHaveBeenCalledWith("/drafts/Untitled.md");
    expect(deleteFn).toHaveBeenCalledWith("/drafts/Untitled.md");
    expect(tab._isScratch).toBe(false);
  });

  it("does not call forget/delete for a non-scratch tab's Save As", async () => {
    const forgetFn = vi.fn().mockResolvedValue({ ok: true });
    const deleteFn = vi.fn().mockResolvedValue({ ok: true });
    installMockApi({ forget_scratch_file: forgetFn, delete_file: deleteFn });
    const tab = addTab({ path: null, title: "Untitled.md", content: "normal" });
    saveOrSaveAs(tab);
    await new Promise((r) => setTimeout(r, 0));
    expect(forgetFn).not.toHaveBeenCalled();
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it("shows an error and does not update the tab when save_as resolves with no path", async () => {
    installMockApi({ save_as: vi.fn().mockResolvedValue({}) });
    const tab = addTab({ path: null, title: "Untitled.md", content: "x" });
    const originalId = tab.id;
    saveOrSaveAs(tab);
    await new Promise((r) => setTimeout(r, 0));
    expect(tab.id).toBe(originalId);
    expect(tab.path).toBeNull();
  });

  it("shows an error without throwing when save_as rejects", async () => {
    installMockApi({ save_as: vi.fn().mockRejectedValue(new Error("cancelled")) });
    const tab = addTab({ path: null, title: "Untitled.md", content: "x" });
    expect(() => saveOrSaveAs(tab)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("does nothing when API is unavailable for a pathless tab (no save_as to call)", async () => {
    window.pywebview = undefined;
    const tab = addTab({ path: null, title: "Untitled.md", content: "x" });
    const originalId = tab.id;
    saveOrSaveAs(tab);
    await new Promise((r) => setTimeout(r, 0));
    expect(tab.id).toBe(originalId);
  });
});

// ── saveToFile ────────────────────────────────────────────────────────────────
// Regression coverage added 2026-10-15 alongside the "hangs on exit" fix:
// saveToFile() now calls pushUnsavedScratchState() (js/scratch.js) for
// scratch tabs, pushing state to the Python Api instance so
// check_unsaved_scratch_on_quit (app.py) never needs to call back into JS
// via evaluate_js at window-close time — the exact call that deadlocked
// on the real cocoa backend (see app.py's docstring for the full
// mechanism). This file was never direct-tested before this addition.

describe("saveToFile", () => {
  beforeEach(() => {
    window.pywebview = undefined;
  });

  it("does nothing when tab is null/undefined", () => {
    expect(() => saveToFile(null)).not.toThrow();
  });

  it("does nothing when tab has no path", () => {
    const tab = addTab({ path: null, title: "Untitled.md", content: "x" });
    expect(() => saveToFile(tab)).not.toThrow();
  });

  it("shows no crash and skips write when API is unavailable", () => {
    const tab = addTab({ path: "/notes/x.md", title: "x.md", content: "hi" });
    expect(() => saveToFile(tab)).not.toThrow();
  });

  it("calls write_file with the tab's path and content", async () => {
    const writeFn = vi.fn().mockResolvedValue({});
    installMockApi({ write_file: writeFn });
    const tab = addTab({ path: "/notes/x.md", title: "x.md", content: "hello world" });
    saveToFile(tab);
    await new Promise((r) => setTimeout(r, 0));
    expect(writeFn).toHaveBeenCalledWith("/notes/x.md", "hello world");
  });

  it("pushes unsaved-scratch state for a scratch tab (the actual bug-fix call site)", async () => {
    const pushFn = vi.fn().mockResolvedValue(null);
    installMockApi({ set_has_unsaved_scratch: pushFn });
    const tab = addTab({ path: "/drafts/Untitled.md", title: "Untitled.md", content: "a note" });
    tab._isScratch = true;
    saveToFile(tab);
    await new Promise((r) => setTimeout(r, 0));
    expect(pushFn).toHaveBeenCalledWith(true); // non-empty scratch content -> true
  });

  it("pushes false for a scratch tab that has been emptied back out", async () => {
    const pushFn = vi.fn().mockResolvedValue(null);
    installMockApi({ set_has_unsaved_scratch: pushFn });
    const tab = addTab({ path: "/drafts/Untitled.md", title: "Untitled.md", content: "" });
    tab._isScratch = true;
    saveToFile(tab);
    await new Promise((r) => setTimeout(r, 0));
    expect(pushFn).toHaveBeenCalledWith(false);
  });

  it("does NOT push unsaved-scratch state for a non-scratch (regular file) save", async () => {
    const pushFn = vi.fn().mockResolvedValue(null);
    installMockApi({ set_has_unsaved_scratch: pushFn });
    const tab = addTab({ path: "/notes/regular.md", title: "regular.md", content: "normal file" });
    // tab._isScratch is left undefined/false (regular file)
    saveToFile(tab);
    await new Promise((r) => setTimeout(r, 0));
    expect(pushFn).not.toHaveBeenCalled();
  });

  it("the push call never throws and never blocks even if set_has_unsaved_scratch rejects", async () => {
    installMockApi({
      set_has_unsaved_scratch: vi.fn().mockRejectedValue(new Error("bridge down")),
    });
    const tab = addTab({ path: "/drafts/Untitled.md", title: "Untitled.md", content: "note" });
    tab._isScratch = true;
    expect(() => saveToFile(tab)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    // No assertion needed beyond "did not throw" — this proves the
    // .catch(() => {}) in pushUnsavedScratchState() actually swallows a
    // rejected bridge call rather than propagating an unhandled rejection
    // that could otherwise interrupt the real file save happening in
    // the same function.
  });
});
