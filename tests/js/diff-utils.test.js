import { describe, it, expect } from "vitest";
import {
  parseFileChanges,
  computeLineDiff,
  renderDiff,
} from "../../js/diff-utils.js";

// ── parseFileChanges ─────────────────────────────────────────────────────────

describe("parseFileChanges", () => {
  it("returns [] for empty string", () => {
    expect(parseFileChanges("")).toEqual([]);
  });

  it("returns [] when no file-change tags are present", () => {
    expect(parseFileChanges("Just some plain text")).toEqual([]);
  });

  it("parses a single file-change tag", () => {
    const text = '<file-change path="/foo/bar.md">hello</file-change>';
    expect(parseFileChanges(text)).toEqual([{ path: "/foo/bar.md", newContent: "hello" }]);
  });

  it("parses multiple file-change tags", () => {
    const text = [
      '<file-change path="/a.md">content a</file-change>',
      '<file-change path="/b.md">content b</file-change>',
    ].join("\n");
    const result = parseFileChanges(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ path: "/a.md", newContent: "content a" });
    expect(result[1]).toEqual({ path: "/b.md", newContent: "content b" });
  });

  it("captures multiline content", () => {
    const text = '<file-change path="/foo.md">\n# Title\n\nParagraph\n</file-change>';
    const result = parseFileChanges(text);
    expect(result[0].newContent).toContain("# Title");
    expect(result[0].newContent).toContain("Paragraph");
  });

  it("returns [] for unclosed tag (no closing </file-change>)", () => {
    const text = '<file-change path="/foo.md">no closing tag';
    expect(parseFileChanges(text)).toEqual([]);
  });

  it("handles special characters in path", () => {
    const text = '<file-change path="/foo/my file (1).md">content</file-change>';
    expect(parseFileChanges(text)[0].path).toBe("/foo/my file (1).md");
  });
});

// ── computeLineDiff ──────────────────────────────────────────────────────────

describe("computeLineDiff", () => {
  it("returns all unchanged for identical texts", () => {
    const diff = computeLineDiff("a\nb\nc", "a\nb\nc");
    expect(diff.every((d) => d.type === "unchanged")).toBe(true);
    expect(diff).toHaveLength(3);
  });

  it("returns all removed then all added for completely different texts", () => {
    const diff = computeLineDiff("old", "new");
    const types = diff.map((d) => d.type);
    expect(types).toContain("removed");
    expect(types).toContain("added");
  });

  it("detects a single added line", () => {
    const diff = computeLineDiff("a\nb", "a\nb\nc");
    const added = diff.filter((d) => d.type === "added");
    expect(added).toHaveLength(1);
    expect(added[0].line).toBe("c");
  });

  it("detects a single removed line", () => {
    const diff = computeLineDiff("a\nb\nc", "a\nb");
    const removed = diff.filter((d) => d.type === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].line).toBe("c");
  });

  it("empty old text → produces added entries for each new line", () => {
    // "".split("\n") = [""] so the LCS algorithm also emits a removed empty line
    const diff = computeLineDiff("", "x\ny");
    const added = diff.filter((d) => d.type === "added");
    expect(added.map((d) => d.line)).toEqual(["x", "y"]);
  });

  it("empty new text → produces removed entries for each old line", () => {
    const diff = computeLineDiff("x\ny", "");
    const removed = diff.filter((d) => d.type === "removed");
    expect(removed.map((d) => d.line)).toEqual(["x", "y"]);
  });

  it("includes correct line numbers", () => {
    const diff = computeLineDiff("a\nb", "a\nb");
    expect(diff[0].oldLine).toBe(1);
    expect(diff[0].newLine).toBe(1);
    expect(diff[1].oldLine).toBe(2);
    expect(diff[1].newLine).toBe(2);
  });

  it("added entries have newLine but no oldLine", () => {
    const diff = computeLineDiff("", "line");
    expect(diff[0].type).toBe("added");
    expect(diff[0].newLine).toBeDefined();
    expect(diff[0].oldLine).toBeUndefined();
  });

  it("removed entries have oldLine but no newLine", () => {
    const diff = computeLineDiff("line", "");
    const removed = diff.find((d) => d.type === "removed");
    expect(removed).toBeDefined();
    expect(removed.line).toBe("line");
    expect(removed.oldLine).toBeDefined();
    expect(removed.newLine).toBeUndefined();
  });
});

// ── renderDiff ───────────────────────────────────────────────────────────────

describe("renderDiff", () => {
  it("returns a closed diff-table for empty diff", () => {
    const html = renderDiff([]);
    expect(html).toBe('<table class="diff-table"></table>');
  });

  it("renders an added line with '+' sign", () => {
    const diff = [{ type: "added", line: "new line", newLine: 1 }];
    const html = renderDiff(diff);
    expect(html).toContain("diff-added");
    expect(html).toContain("+");
    expect(html).toContain("new line");
  });

  it("renders a removed line with '−' sign", () => {
    const diff = [{ type: "removed", line: "old line", oldLine: 1 }];
    const html = renderDiff(diff);
    expect(html).toContain("diff-removed");
    expect(html).toContain("−");
    expect(html).toContain("old line");
  });

  it("renders an unchanged line with ' ' sign when adjacent to a change", () => {
    // An unchanged line only renders (not collapsed) when within CONTEXT=3 of a change.
    const diff = [
      { type: "added", line: "new", newLine: 1 },
      { type: "unchanged", line: "same", oldLine: 1, newLine: 2 },
    ];
    const html = renderDiff(diff);
    expect(html).toContain("diff-unchanged");
    expect(html).toContain("same");
  });

  it("collapses many unchanged lines into a hunk placeholder", () => {
    // 10 unchanged lines → should produce an @@ placeholder
    const diff = Array.from({ length: 10 }, (_, i) => ({
      type: "unchanged",
      line: `line ${i}`,
      oldLine: i + 1,
      newLine: i + 1,
    }));
    const html = renderDiff(diff);
    expect(html).toContain("@@");
    expect(html).toContain("unchanged line");
  });

  it("shows lines within CONTEXT (3) of a change", () => {
    // 10 unchanged, then 1 added, then 10 unchanged
    const diff = [
      ...Array.from({ length: 10 }, (_, i) => ({
        type: "unchanged", line: `u${i}`, oldLine: i + 1, newLine: i + 1,
      })),
      { type: "added", line: "inserted", newLine: 11 },
      ...Array.from({ length: 10 }, (_, i) => ({
        type: "unchanged", line: `v${i}`, oldLine: i + 11, newLine: i + 12,
      })),
    ];
    const html = renderDiff(diff);
    // Lines within 3 of the change should appear; distant unchanged lines collapse
    expect(html).toContain("u9"); // 1 line before: shown
    expect(html).toContain("u7"); // 3 lines before: shown
    expect(html).toContain("@@"); // distant unchanged lines: collapsed
  });

  it("escapes HTML special characters in line content", () => {
    const diff = [{ type: "added", line: "<script>alert('xss')</script>", newLine: 1 }];
    const html = renderDiff(diff);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders correct plural for multiple skipped lines", () => {
    const diff = Array.from({ length: 8 }, (_, i) => ({
      type: "unchanged", line: `l${i}`, oldLine: i + 1, newLine: i + 1,
    }));
    const html = renderDiff(diff);
    expect(html).toMatch(/\d+ unchanged lines/);
  });

  it("renders singular for exactly 1 skipped line", () => {
    // Need exactly 1 unchanged line between two changed lines far enough apart
    // Use a single unchanged line with nothing else (all context=3, but only 1 line total)
    // Surrounded by changed lines so context doesn't absorb it
    const diff = [
      { type: "removed", line: "a", oldLine: 1 },
      ...Array.from({ length: 7 }, (_, i) => ({
        type: "unchanged", line: `mid${i}`, oldLine: i + 2, newLine: i + 1,
      })),
      { type: "added", line: "b", newLine: 8 },
    ];
    const html = renderDiff(diff);
    // With CONTEXT=3, 7 unchanged lines: lines 0-2 and 4-6 are in context, only line 3 may be hidden
    expect(html).toContain("unchanged line");
  });
});
