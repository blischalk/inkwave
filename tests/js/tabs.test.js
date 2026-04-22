import { describe, it, expect } from "vitest";
import { getTabTitle } from "../../js/tabs.js";

describe("getTabTitle", () => {
  it("returns 'Welcome' for null", () => {
    expect(getTabTitle(null)).toBe("Welcome");
  });

  it("returns 'Welcome' for undefined", () => {
    expect(getTabTitle(undefined)).toBe("Welcome");
  });

  it("returns 'Welcome' for empty string", () => {
    expect(getTabTitle("")).toBe("Welcome");
  });

  it("returns 'Welcome' for a path ending in welcome.md", () => {
    expect(getTabTitle("Welcome.md")).toBe("Welcome");
  });

  it("returns 'Welcome' for absolute path to Welcome.md (case-insensitive)", () => {
    expect(getTabTitle("/Users/foo/WELCOME.MD")).toBe("Welcome");
    expect(getTabTitle("/Users/foo/welcome.md")).toBe("Welcome");
  });

  it("returns the filename from a Unix absolute path", () => {
    expect(getTabTitle("/Users/foo/notes.md")).toBe("notes.md");
  });

  it("returns the filename from a Windows absolute path", () => {
    expect(getTabTitle("C:\\Users\\foo\\doc.md")).toBe("doc.md");
  });

  it("returns the bare filename when there is no directory separator", () => {
    expect(getTabTitle("README.md")).toBe("README.md");
  });

  it("returns the deepest component of a nested path", () => {
    expect(getTabTitle("/a/b/c/file.md")).toBe("file.md");
  });
});
