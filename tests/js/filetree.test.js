import { describe, it, expect, beforeEach, vi } from "vitest";

// Set up DOM that state.js and filetree.js expect
document.body.innerHTML = `
  <div id="content-primary" class="content"></div>
  <div id="filename"></div>
  <ul id="tree"></ul>
  <div id="sidebar"></div>
  <button id="openBtn"></button>
  <button id="newFileBtn"></button>
`;

// Mock pywebview API
window.pywebview = { api: {
  list_dir: vi.fn(() => Promise.resolve({ entries: [
    { name: "notes", path: "/test/notes", isDir: true },
    { name: "readme.md", path: "/test/readme.md", isDir: false },
    { name: "todo.md", path: "/test/todo.md", isDir: false },
  ]})),
  read_file: vi.fn(() => Promise.resolve({ path: "/test/readme.md", content: "# Hello" })),
}};

const { initTree } = await import("../../js/filetree.js");

describe("filetree — initTree", () => {
  beforeEach(() => {
    document.getElementById("tree").innerHTML = "";
  });

  it("creates root folder element", () => {
    initTree("/test", null);
    const tree = document.getElementById("tree");
    const rootItem = tree.querySelector(".tree-item.folder");
    expect(rootItem).not.toBeNull();
    expect(rootItem.dataset.path).toBe("/test");
  });

  it("root folder shows directory name", () => {
    initTree("/Users/braker/Documents", null);
    const name = document.querySelector(".tree-item .name");
    expect(name.textContent).toBe("Documents");
  });

  it("root folder is expanded by default", () => {
    initTree("/test", null);
    const rootItem = document.querySelector(".tree-item.folder");
    expect(rootItem.classList.contains("expanded")).toBe(true);
  });

  it("clears tree when called with null", () => {
    initTree("/test", null);
    expect(document.querySelector(".tree-item")).not.toBeNull();
    initTree(null, null);
    expect(document.getElementById("tree").innerHTML).toBe("");
  });

  it("enables new file button when root is set", () => {
    const btn = document.getElementById("newFileBtn");
    btn.disabled = true;
    initTree("/test", null);
    expect(btn.disabled).toBe(false);
  });

  it("disables new file button when root is null", () => {
    const btn = document.getElementById("newFileBtn");
    btn.disabled = false;
    initTree(null, null);
    expect(btn.disabled).toBe(true);
  });
});
