// Unit tests for js/scratch.js: createScratchTab, forgetScratchTab,
// reloadScratchFiles, the window.__hasUnsavedScratchTabs global contract
// consumed by app.py::check_unsaved_scratch_on_quit, and the U4
// empty-scratch-discard-on-close hook.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";

// scratch.js transitively imports tabs.js/state.js, which read real
// index.html element IDs at module-eval time with no null guards —
// same bootstrap pattern as welcome-dismiss.test.js.
const indexHtmlPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../index.html",
);
const indexHtml = readFileSync(indexHtmlPath, "utf8");
const bodyMatch = indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
document.body.innerHTML = bodyMatch ? bodyMatch[1] : "";

const stateMod = await import("../../js/state.js");
const { tabs: tabsRef } = stateMod;
const { createScratchTab, forgetScratchTab, reloadScratchFiles } = await import("../../js/scratch.js");
const { closeTab } = await import("../../js/tabs.js");

function installMockApi(overrides = {}) {
  window.pywebview = {
    api: {
      create_scratch_file: vi.fn().mockResolvedValue({ path: "/drafts/Untitled.md", content: "" }),
      list_scratch_files: vi.fn().mockResolvedValue({ files: [] }),
      forget_scratch_file: vi.fn().mockResolvedValue({ ok: true }),
      delete_file: vi.fn().mockResolvedValue({ ok: true }),
      ...overrides,
    },
  };
}

beforeEach(() => {
  tabsRef.length = 0;
  window.pywebview = undefined;
});

describe("createScratchTab", () => {
  it("shows an error and returns without creating a tab when API is unavailable", async () => {
    window.pywebview = undefined;
    const result = await createScratchTab();
    expect(result).toBeUndefined();
    expect(tabsRef.length).toBe(0);
  });

  it("creates a tab backed by the real path returned from create_scratch_file", async () => {
    installMockApi();
    const tab = await createScratchTab();
    expect(tab).not.toBeNull();
    expect(tab.path).toBe("/drafts/Untitled.md");
    expect(tab.id).toBe("/drafts/Untitled.md");
    expect(tabsRef).toHaveLength(1);
  });

  it("marks the created tab with _isScratch = true", async () => {
    installMockApi();
    const tab = await createScratchTab();
    expect(tab._isScratch).toBe(true);
  });

  it("shows an error and creates no tab when create_scratch_file returns an error", async () => {
    installMockApi({
      create_scratch_file: vi.fn().mockResolvedValue({ path: null, content: null, error: "disk full" }),
    });
    const result = await createScratchTab();
    expect(result).toBeNull();
    expect(tabsRef).toHaveLength(0);
  });

  it("shows an error and creates no tab when the API call rejects", async () => {
    installMockApi({
      create_scratch_file: vi.fn().mockRejectedValue(new Error("IPC broke")),
    });
    const result = await createScratchTab();
    expect(result).toBeNull();
    expect(tabsRef).toHaveLength(0);
  });

  it("multiple Cmd+N presses create multiple distinct tabs", async () => {
    installMockApi({
      create_scratch_file: vi.fn()
        .mockResolvedValueOnce({ path: "/drafts/Untitled.md", content: "" })
        .mockResolvedValueOnce({ path: "/drafts/Untitled 1.md", content: "" }),
    });
    await createScratchTab();
    await createScratchTab();
    expect(tabsRef).toHaveLength(2);
    expect(tabsRef.map((t) => t.path)).toEqual(["/drafts/Untitled.md", "/drafts/Untitled 1.md"]);
  });
});

describe("forgetScratchTab", () => {
  it("resolves without throwing when API is unavailable", async () => {
    window.pywebview = undefined;
    await expect(forgetScratchTab("/drafts/Untitled.md")).resolves.not.toThrow();
  });

  it("resolves without throwing when path is falsy", async () => {
    installMockApi();
    await expect(forgetScratchTab(null)).resolves.not.toThrow();
  });

  it("calls forget_scratch_file with the given path", async () => {
    const forgetFn = vi.fn().mockResolvedValue({ ok: true });
    installMockApi({ forget_scratch_file: forgetFn });
    await forgetScratchTab("/drafts/Untitled.md");
    expect(forgetFn).toHaveBeenCalledWith("/drafts/Untitled.md");
  });

  it("swallows a rejected forget_scratch_file call", async () => {
    installMockApi({ forget_scratch_file: vi.fn().mockRejectedValue(new Error("fail")) });
    await expect(forgetScratchTab("/drafts/Untitled.md")).resolves.not.toThrow();
  });
});

describe("reloadScratchFiles", () => {
  it("resolves to 0 and creates no tabs when API is unavailable", async () => {
    window.pywebview = undefined;
    const count = await reloadScratchFiles();
    expect(count).toBe(0);
    expect(tabsRef).toHaveLength(0);
  });

  it("resolves to 0 when the registry is empty", async () => {
    installMockApi();
    const count = await reloadScratchFiles();
    expect(count).toBe(0);
    expect(tabsRef).toHaveLength(0);
  });

  it("reopens every file from list_scratch_files as a tab", async () => {
    installMockApi({
      list_scratch_files: vi.fn().mockResolvedValue({
        files: [
          { path: "/drafts/Untitled.md", content: "# first" },
          { path: "/drafts/Untitled 1.md", content: "# second" },
        ],
      }),
    });
    const count = await reloadScratchFiles();
    expect(count).toBe(2);
    expect(tabsRef).toHaveLength(2);
    expect(tabsRef[0].content).toBe("# first");
    expect(tabsRef[1].content).toBe("# second");
  });

  it("marks every reopened tab with _isScratch = true", async () => {
    installMockApi({
      list_scratch_files: vi.fn().mockResolvedValue({ files: [{ path: "/drafts/Untitled.md", content: "x" }] }),
    });
    await reloadScratchFiles();
    expect(tabsRef[0]._isScratch).toBe(true);
  });

  it("resolves to 0 without throwing when list_scratch_files rejects", async () => {
    installMockApi({ list_scratch_files: vi.fn().mockRejectedValue(new Error("broke")) });
    const count = await reloadScratchFiles();
    expect(count).toBe(0);
  });

  it("resolves to 0 when files array is malformed/missing", async () => {
    installMockApi({ list_scratch_files: vi.fn().mockResolvedValue({}) });
    const count = await reloadScratchFiles();
    expect(count).toBe(0);
  });
});

describe("window.__hasUnsavedScratchTabs (quit-time contract consumed by app.py)", () => {
  it("is defined as a function on window after module load", () => {
    expect(typeof window.__hasUnsavedScratchTabs).toBe("function");
  });

  it("returns false when there are no tabs at all", () => {
    expect(window.__hasUnsavedScratchTabs()).toBe(false);
  });

  it("returns false when the only tabs are non-scratch (regular files)", () => {
    tabsRef.push({ id: "/notes/real.md", path: "/notes/real.md", content: "hello", _isScratch: false });
    expect(window.__hasUnsavedScratchTabs()).toBe(false);
  });

  it("returns false for a scratch tab with empty content (U4)", () => {
    tabsRef.push({ id: "/drafts/Untitled.md", path: "/drafts/Untitled.md", content: "", _isScratch: true });
    expect(window.__hasUnsavedScratchTabs()).toBe(false);
  });

  it("returns false for a scratch tab with only whitespace content", () => {
    tabsRef.push({ id: "/drafts/Untitled.md", path: "/drafts/Untitled.md", content: "   \n\t  ", _isScratch: true });
    expect(window.__hasUnsavedScratchTabs()).toBe(false);
  });

  it("returns false for a scratch tab with null content", () => {
    tabsRef.push({ id: "/drafts/Untitled.md", path: "/drafts/Untitled.md", content: null, _isScratch: true });
    expect(window.__hasUnsavedScratchTabs()).toBe(false);
  });

  it("returns true when a scratch tab has real content", () => {
    tabsRef.push({ id: "/drafts/Untitled.md", path: "/drafts/Untitled.md", content: "# my note", _isScratch: true });
    expect(window.__hasUnsavedScratchTabs()).toBe(true);
  });

  it("returns true if ANY of multiple scratch tabs has content, even if others are empty", () => {
    tabsRef.push({ id: "/drafts/Untitled.md", path: "/drafts/Untitled.md", content: "", _isScratch: true });
    tabsRef.push({ id: "/drafts/Untitled 1.md", path: "/drafts/Untitled 1.md", content: "has stuff", _isScratch: true });
    expect(window.__hasUnsavedScratchTabs()).toBe(true);
  });

  it("returns the exact boolean type, not a truthy/falsy non-boolean (Python side does `if not has_unsaved`)", () => {
    expect(typeof window.__hasUnsavedScratchTabs()).toBe("boolean");
    tabsRef.push({ id: "/drafts/x.md", path: "/drafts/x.md", content: "y", _isScratch: true });
    expect(typeof window.__hasUnsavedScratchTabs()).toBe("boolean");
  });
});

describe("U4: closing an empty scratch tab discards it (onBeforeCloseTab hook)", () => {
  it("calls forget_scratch_file and delete_file when closing an empty scratch tab", () => {
    const forgetFn = vi.fn().mockResolvedValue({ ok: true });
    const deleteFn = vi.fn().mockResolvedValue({ ok: true });
    installMockApi({ forget_scratch_file: forgetFn, delete_file: deleteFn });
    tabsRef.push({ id: "/drafts/Untitled.md", path: "/drafts/Untitled.md", content: "", _isScratch: true });
    closeTab("/drafts/Untitled.md");
    expect(forgetFn).toHaveBeenCalledWith("/drafts/Untitled.md");
    expect(deleteFn).toHaveBeenCalledWith("/drafts/Untitled.md");
  });

  it("does NOT delete a scratch tab that has real content", () => {
    const forgetFn = vi.fn().mockResolvedValue({ ok: true });
    const deleteFn = vi.fn().mockResolvedValue({ ok: true });
    installMockApi({ forget_scratch_file: forgetFn, delete_file: deleteFn });
    tabsRef.push({ id: "/drafts/Untitled.md", path: "/drafts/Untitled.md", content: "keep me", _isScratch: true });
    closeTab("/drafts/Untitled.md");
    expect(forgetFn).not.toHaveBeenCalled();
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it("does nothing for a non-scratch tab close (regular file)", () => {
    const forgetFn = vi.fn().mockResolvedValue({ ok: true });
    const deleteFn = vi.fn().mockResolvedValue({ ok: true });
    installMockApi({ forget_scratch_file: forgetFn, delete_file: deleteFn });
    tabsRef.push({ id: "/notes/real.md", path: "/notes/real.md", content: "", _isScratch: false });
    closeTab("/notes/real.md");
    expect(forgetFn).not.toHaveBeenCalled();
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it("still removes the tab from the tabs array even when closing an empty scratch tab", () => {
    installMockApi();
    tabsRef.push({ id: "/drafts/Untitled.md", path: "/drafts/Untitled.md", content: "", _isScratch: true });
    closeTab("/drafts/Untitled.md");
    expect(tabsRef).toHaveLength(0);
  });

  it("does not crash when the API is unavailable while closing an empty scratch tab", () => {
    window.pywebview = undefined;
    tabsRef.push({ id: "/drafts/Untitled.md", path: "/drafts/Untitled.md", content: "", _isScratch: true });
    expect(() => closeTab("/drafts/Untitled.md")).not.toThrow();
  });
});
