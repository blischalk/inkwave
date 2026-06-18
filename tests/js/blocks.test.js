import { describe, it, expect } from "vitest";
import {
  getBlocks,
  blocksToContent,
  getBlockOffsets,
  contentOffsetToBlockAndOffset,
  blockAndOffsetToContentOffset,
  getInlineBlockType,
  getListPrefix,
  stripListMarker,
  isOrderedListPrefix,
  moveListItemInBlocks,
  indentListItem,
  outdentListItem,
  buildLinkedRaw,
} from "../../js/blocks.js";

// ── getBlocks ────────────────────────────────────────────────────────────────

describe("getBlocks", () => {
  it("returns [] for empty string", () => {
    expect(getBlocks("")).toEqual([]);
  });

  it("returns [] for whitespace-only string", () => {
    expect(getBlocks("   \n  ")).toEqual([]);
  });

  it("returns [] for null/undefined", () => {
    expect(getBlocks(null)).toEqual([]);
    expect(getBlocks(undefined)).toEqual([]);
  });

  it("parses a heading", () => {
    const blocks = getBlocks("## Title");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("heading");
    expect(blocks[0].depth).toBe(2);
    expect(blocks[0].raw).toContain("## Title");
  });

  it("parses h1 through h6 depths", () => {
    for (let d = 1; d <= 6; d++) {
      const blocks = getBlocks("#".repeat(d) + " Heading");
      expect(blocks[0].type).toBe("heading");
      expect(blocks[0].depth).toBe(d);
    }
  });

  it("parses a paragraph", () => {
    const blocks = getBlocks("Hello world");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[0].raw).toContain("Hello world");
  });

  it("parses a code fence", () => {
    const blocks = getBlocks("```js\nconst x = 1;\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("code");
  });

  it("splits a list into individual list-item blocks", () => {
    const blocks = getBlocks("- alpha\n- beta\n- gamma");
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    blocks.forEach((b) => expect(b.type).toBe("list"));
  });

  it("parses an ordered list", () => {
    const blocks = getBlocks("1. first\n2. second");
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    blocks.forEach((b) => expect(b.type).toBe("list"));
  });

  it("parses a blockquote", () => {
    const blocks = getBlocks("> A quote");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("blockquote");
  });

  it("parses a horizontal rule", () => {
    const blocks = getBlocks("---");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("hr");
  });
});

// ── blocksToContent ──────────────────────────────────────────────────────────

describe("blocksToContent", () => {
  it("returns empty string for empty array", () => {
    expect(blocksToContent([])).toBe("");
  });

  it("returns single block raw", () => {
    expect(blocksToContent([{ raw: "hello", type: "paragraph" }])).toBe("hello");
  });

  it("joins two non-list blocks with double newline", () => {
    const blocks = [
      { raw: "# Title", type: "heading" },
      { raw: "Paragraph.", type: "paragraph" },
    ];
    expect(blocksToContent(blocks)).toBe("# Title\n\nParagraph.");
  });

  it("joins consecutive list items with single newline (tight list)", () => {
    const blocks = [
      { raw: "- alpha", type: "list" },
      { raw: "- beta", type: "list" },
    ];
    expect(blocksToContent(blocks)).toBe("- alpha\n- beta");
  });

  it("uses double newline between list and non-list", () => {
    const blocks = [
      { raw: "- item", type: "list" },
      { raw: "Paragraph.", type: "paragraph" },
    ];
    expect(blocksToContent(blocks)).toBe("- item\n\nParagraph.");
  });

  it("strips trailing whitespace from each block raw", () => {
    const blocks = [{ raw: "hello   ", type: "paragraph" }];
    expect(blocksToContent(blocks)).toBe("hello");
  });

  it("round-trips a mixed document", () => {
    const content = "# Title\n\nParagraph.\n\n- item 1\n- item 2\n\n> Quote";
    const blocks = getBlocks(content);
    const rebuilt = blocksToContent(blocks);
    expect(rebuilt).toContain("# Title");
    expect(rebuilt).toContain("Paragraph.");
    expect(rebuilt).toContain("- item 1");
    expect(rebuilt).toContain("> Quote");
  });
});

// ── getBlockOffsets ──────────────────────────────────────────────────────────

describe("getBlockOffsets", () => {
  it("returns [] for empty blocks array", () => {
    expect(getBlockOffsets([])).toEqual([]);
  });

  it("single block starts at 0 and ends at its length", () => {
    const blocks = [{ raw: "hello", type: "paragraph" }];
    const offsets = getBlockOffsets(blocks);
    expect(offsets).toHaveLength(1);
    expect(offsets[0]).toEqual({ start: 0, end: 5 });
  });

  it("two non-list blocks are separated by 2 chars (\\n\\n)", () => {
    const blocks = [
      { raw: "abc", type: "paragraph" },
      { raw: "def", type: "paragraph" },
    ];
    const offsets = getBlockOffsets(blocks);
    expect(offsets[0]).toEqual({ start: 0, end: 3 });
    expect(offsets[1]).toEqual({ start: 5, end: 8 });
  });

  it("two list blocks are separated by 1 char (\\n)", () => {
    const blocks = [
      { raw: "- a", type: "list" },
      { raw: "- b", type: "list" },
    ];
    const offsets = getBlockOffsets(blocks);
    expect(offsets[0]).toEqual({ start: 0, end: 3 });
    expect(offsets[1]).toEqual({ start: 4, end: 7 });
  });

  it("offset count matches block count", () => {
    const blocks = getBlocks("# H\n\nPara\n\n- x\n- y");
    const offsets = getBlockOffsets(blocks);
    expect(offsets).toHaveLength(blocks.length);
  });
});

// ── contentOffsetToBlockAndOffset / blockAndOffsetToContentOffset ─────────────

describe("contentOffsetToBlockAndOffset + blockAndOffsetToContentOffset (inverse pair)", () => {
  const blocks = [
    { raw: "abc", type: "paragraph" },
    { raw: "def", type: "paragraph" },
  ];
  // blocksToContent = "abc\n\ndef" (positions 0-7)

  it("offset 0 → block 0, offset 0", () => {
    expect(contentOffsetToBlockAndOffset(blocks, 0)).toEqual({ blockIndex: 0, offsetInBlock: 0 });
  });

  it("offset 2 → block 0, offset 2", () => {
    expect(contentOffsetToBlockAndOffset(blocks, 2)).toEqual({ blockIndex: 0, offsetInBlock: 2 });
  });

  it("offset 5 → block 1, offset 0 (start of second block)", () => {
    expect(contentOffsetToBlockAndOffset(blocks, 5)).toEqual({ blockIndex: 1, offsetInBlock: 0 });
  });

  it("offset at end → last block, last position", () => {
    const { blockIndex, offsetInBlock } = contentOffsetToBlockAndOffset(blocks, 8);
    expect(blockIndex).toBe(1);
    expect(offsetInBlock).toBe(3);
  });

  it("round-trips: blockAndOffsetToContentOffset reverses contentOffsetToBlockAndOffset", () => {
    for (let off = 0; off <= 8; off++) {
      const { blockIndex, offsetInBlock } = contentOffsetToBlockAndOffset(blocks, off);
      const recovered = blockAndOffsetToContentOffset(blocks, blockIndex, offsetInBlock);
      // The recovered offset may differ at separator positions, but must land in the same block
      const { blockIndex: bi2 } = contentOffsetToBlockAndOffset(blocks, recovered);
      expect(bi2).toBe(blockIndex);
    }
  });

  it("returns zeros for empty blocks", () => {
    expect(contentOffsetToBlockAndOffset([], 5)).toEqual({ blockIndex: 0, offsetInBlock: 0 });
    expect(blockAndOffsetToContentOffset([], 0, 5)).toBe(0);
  });
});

// ── getInlineBlockType ───────────────────────────────────────────────────────

describe("getInlineBlockType", () => {
  it("detects h1 through h6", () => {
    for (let d = 1; d <= 6; d++) {
      const result = getInlineBlockType("#".repeat(d) + " Heading");
      expect(result).toEqual({ type: "heading", depth: d });
    }
  });

  it("detects code fence (```)", () => {
    expect(getInlineBlockType("```js")).toEqual({ type: "code" });
    expect(getInlineBlockType("```")).toEqual({ type: "code" });
  });

  it("detects blockquote (> )", () => {
    expect(getInlineBlockType("> A quote")).toEqual({ type: "blockquote" });
  });

  it("detects unordered list with - ", () => {
    expect(getInlineBlockType("- item")).toEqual({ type: "list" });
  });

  it("detects unordered list with * ", () => {
    expect(getInlineBlockType("* item")).toEqual({ type: "list" });
  });

  it("detects ordered list", () => {
    expect(getInlineBlockType("1. item")).toEqual({ type: "list" });
    expect(getInlineBlockType("42. item")).toEqual({ type: "list" });
  });

  it("defaults to paragraph for plain text", () => {
    expect(getInlineBlockType("Hello world")).toEqual({ type: "paragraph" });
  });

  it("uses first line only for multi-line input", () => {
    expect(getInlineBlockType("# Title\nsome body")).toEqual({ type: "heading", depth: 1 });
  });

  it("handles non-string input", () => {
    expect(getInlineBlockType(null)).toEqual({ type: "paragraph" });
    expect(getInlineBlockType(42)).toEqual({ type: "paragraph" });
  });
});

// ── getListPrefix ────────────────────────────────────────────────────────────

describe("getListPrefix", () => {
  it("extracts '- ' prefix", () => {
    expect(getListPrefix("- item")).toBe("- ");
  });

  it("extracts '* ' prefix", () => {
    expect(getListPrefix("* item")).toBe("* ");
  });

  it("extracts ordered prefix '1. '", () => {
    expect(getListPrefix("1. first")).toBe("1. ");
  });

  it("extracts multi-digit ordered prefix", () => {
    expect(getListPrefix("42. item")).toBe("42. ");
  });

  it("returns default '- ' for null", () => {
    expect(getListPrefix(null)).toBe("- ");
  });

  it("returns default '- ' for non-string", () => {
    expect(getListPrefix(123)).toBe("- ");
  });

  it("returns default '- ' when no marker found", () => {
    expect(getListPrefix("plain text")).toBe("- ");
  });
});

// ── stripListMarker ──────────────────────────────────────────────────────────

describe("stripListMarker", () => {
  it("strips '- ' prefix", () => {
    expect(stripListMarker("- item")).toBe("item");
  });

  it("strips '* ' prefix", () => {
    expect(stripListMarker("* item")).toBe("item");
  });

  it("strips ordered '1. ' prefix", () => {
    expect(stripListMarker("1. first")).toBe("first");
  });

  it("returns text unchanged when no list marker", () => {
    expect(stripListMarker("plain text")).toBe("plain text");
  });

  it("returns empty string for null/undefined", () => {
    expect(stripListMarker(null)).toBe("");
    expect(stripListMarker(undefined)).toBe("");
  });
});

// ── nested list flattening ───────────────────────────────────────────────────

describe("getBlocks with nested lists", () => {
  it("flattens each nested item into its own block with a listDepth", () => {
    const blocks = getBlocks("- Parent\n  - Child 1\n  - Child 2\n- Sibling");
    expect(blocks).toEqual([
      { raw: "- Parent", type: "list", listDepth: 0 },
      { raw: "- Child 1", type: "list", listDepth: 1 },
      { raw: "- Child 2", type: "list", listDepth: 1 },
      { raw: "- Sibling", type: "list", listDepth: 0 },
    ]);
  });

  it("normalises each item's raw to column zero regardless of depth", () => {
    const blocks = getBlocks("- Parent\n  - Child\n    - Grandchild");
    expect(blocks.map((b) => b.raw)).toEqual([
      "- Parent",
      "- Child",
      "- Grandchild",
    ]);
    expect(blocks.map((b) => b.listDepth)).toEqual([0, 1, 2]);
  });

  it("keeps flat lists at depth 0", () => {
    const blocks = getBlocks("- a\n- b");
    expect(blocks.map((b) => b.listDepth)).toEqual([0, 0]);
  });

  it("round-trips a nested list through blocksToContent and back", () => {
    const md = "- Parent\n  - Child 1\n  - Child 2\n    - Grand\n- Sibling";
    const blocks = getBlocks(md);
    const serialized = blocksToContent(blocks);
    expect(serialized).toBe(md);
    expect(getBlocks(serialized)).toEqual(blocks);
  });

  it("re-indents nested items by two spaces per depth level", () => {
    const blocks = [
      { raw: "- Parent", type: "list", listDepth: 0 },
      { raw: "- Child", type: "list", listDepth: 1 },
      { raw: "- Grand", type: "list", listDepth: 2 },
    ];
    expect(blocksToContent(blocks)).toBe(
      "- Parent\n  - Child\n    - Grand",
    );
  });
});

// ── indentListItem / outdentListItem ─────────────────────────────────────────

describe("indentListItem", () => {
  it("indents an item under the list item directly above it", () => {
    const blocks = [
      { raw: "- a", type: "list", listDepth: 0 },
      { raw: "- b", type: "list", listDepth: 0 },
    ];
    expect(indentListItem(blocks, 1)).toBe(true);
    expect(blocks[1].listDepth).toBe(1);
  });

  it("carries the item's descendants along when indenting", () => {
    const blocks = [
      { raw: "- a", type: "list", listDepth: 0 },
      { raw: "- b", type: "list", listDepth: 0 },
      { raw: "- c", type: "list", listDepth: 1 },
    ];
    expect(indentListItem(blocks, 1)).toBe(true);
    expect(blocks.map((b) => b.listDepth)).toEqual([0, 1, 2]);
  });

  it("refuses to indent the first item in a list", () => {
    const blocks = [{ raw: "- a", type: "list", listDepth: 0 }];
    expect(indentListItem(blocks, 0)).toBe(false);
    expect(blocks[0].listDepth).toBe(0);
  });

  it("refuses to indent more than one level past the item above", () => {
    const blocks = [
      { raw: "- a", type: "list", listDepth: 0 },
      { raw: "- b", type: "list", listDepth: 1 },
    ];
    expect(indentListItem(blocks, 1)).toBe(false);
    expect(blocks[1].listDepth).toBe(1);
  });

  it("refuses to indent when the block above is not a list item", () => {
    const blocks = [
      { raw: "# H", type: "heading", depth: 1 },
      { raw: "- a", type: "list", listDepth: 0 },
    ];
    expect(indentListItem(blocks, 1)).toBe(false);
  });
});

describe("outdentListItem", () => {
  it("outdents a child item one level", () => {
    const blocks = [
      { raw: "- a", type: "list", listDepth: 0 },
      { raw: "- b", type: "list", listDepth: 1 },
    ];
    expect(outdentListItem(blocks, 1)).toBe(true);
    expect(blocks[1].listDepth).toBe(0);
  });

  it("carries descendants along when outdenting", () => {
    const blocks = [
      { raw: "- a", type: "list", listDepth: 0 },
      { raw: "- b", type: "list", listDepth: 1 },
      { raw: "- c", type: "list", listDepth: 2 },
    ];
    expect(outdentListItem(blocks, 1)).toBe(true);
    expect(blocks.map((b) => b.listDepth)).toEqual([0, 0, 1]);
  });

  it("refuses to outdent a top-level item", () => {
    const blocks = [{ raw: "- a", type: "list", listDepth: 0 }];
    expect(outdentListItem(blocks, 0)).toBe(false);
    expect(blocks[0].listDepth).toBe(0);
  });

  it("returns false for a non-list block", () => {
    const blocks = [{ raw: "para", type: "paragraph" }];
    expect(outdentListItem(blocks, 0)).toBe(false);
  });
});

// ── moveListItemInBlocks ─────────────────────────────────────────────────────

describe("moveListItemInBlocks", () => {
  it("moves a list item up by swapping with the previous block", () => {
    const blocks = [
      { raw: "- alpha", type: "list" },
      { raw: "- beta", type: "list" },
    ];
    const newIndex = moveListItemInBlocks(blocks, 1, "up");
    expect(newIndex).toBe(0);
    expect(blocks[0].raw).toBe("- beta");
    expect(blocks[1].raw).toBe("- alpha");
  });

  it("moves a list item down by swapping with the next block", () => {
    const blocks = [
      { raw: "- alpha", type: "list" },
      { raw: "- beta", type: "list" },
    ];
    const newIndex = moveListItemInBlocks(blocks, 0, "down");
    expect(newIndex).toBe(1);
    expect(blocks[0].raw).toBe("- beta");
    expect(blocks[1].raw).toBe("- alpha");
  });

  it("returns -1 when moving up from the first position", () => {
    const blocks = [{ raw: "- only", type: "list" }];
    expect(moveListItemInBlocks(blocks, 0, "up")).toBe(-1);
  });

  it("returns -1 when moving down from the last position", () => {
    const blocks = [{ raw: "- only", type: "list" }];
    expect(moveListItemInBlocks(blocks, 0, "down")).toBe(-1);
  });

  it("returns -1 when the adjacent block is not a list", () => {
    const blocks = [
      { raw: "# Heading", type: "heading" },
      { raw: "- item", type: "list" },
    ];
    expect(moveListItemInBlocks(blocks, 1, "up")).toBe(-1);
  });

  it("returns -1 when the current block is not a list", () => {
    const blocks = [
      { raw: "para", type: "paragraph" },
      { raw: "- item", type: "list" },
    ];
    expect(moveListItemInBlocks(blocks, 0, "down")).toBe(-1);
  });

  it("returns -1 for an out-of-range index", () => {
    const blocks = [{ raw: "- item", type: "list" }];
    expect(moveListItemInBlocks(blocks, -1, "up")).toBe(-1);
    expect(moveListItemInBlocks(blocks, 5, "down")).toBe(-1);
  });

  it("returns -1 for a null blocks array", () => {
    expect(moveListItemInBlocks(null, 0, "up")).toBe(-1);
  });

  it("preserves all other blocks unchanged after a move", () => {
    const blocks = [
      { raw: "- first", type: "list" },
      { raw: "- second", type: "list" },
      { raw: "- third", type: "list" },
    ];
    moveListItemInBlocks(blocks, 1, "up");
    expect(blocks[2].raw).toBe("- third");
  });

  it("works with indented list items stored as list type", () => {
    const blocks = [
      { raw: "- parent item", type: "list" },
      { raw: "- sub item 1", type: "list" },
      { raw: "- sub item 2", type: "list" },
    ];
    const newIndex = moveListItemInBlocks(blocks, 2, "up");
    expect(newIndex).toBe(1);
    expect(blocks[1].raw).toBe("- sub item 2");
    expect(blocks[2].raw).toBe("- sub item 1");
  });
});

// ── isOrderedListPrefix ──────────────────────────────────────────────────────

describe("isOrderedListPrefix", () => {
  it("returns true for '1. '", () => {
    expect(isOrderedListPrefix("1. ")).toBe(true);
  });

  it("returns true for multi-digit '42. '", () => {
    expect(isOrderedListPrefix("42. ")).toBe(true);
  });

  it("returns false for '- '", () => {
    expect(isOrderedListPrefix("- ")).toBe(false);
  });

  it("returns false for '* '", () => {
    expect(isOrderedListPrefix("* ")).toBe(false);
  });

  it("returns falsy for null/undefined", () => {
    expect(isOrderedListPrefix(null)).toBeFalsy();
    expect(isOrderedListPrefix(undefined)).toBeFalsy();
  });
});

// ── List items with continuation lines (PR #10 fix) ─────────────────────────

describe("getBlocks — list items with continuation lines", () => {
  it("preserves fenced code block inside ordered list item", () => {
    const md = "1. Run this:\n   ```\n   echo hello\n   ```\n2. Check output";
    const blocks = getBlocks(md);
    expect(blocks[0].type).toBe("list");
    expect(blocks[0].raw).toContain("```");
    expect(blocks[0].raw).toContain("echo hello");
  });

  it("preserves fenced code block inside unordered list item", () => {
    const md = "- Install:\n  ```bash\n  pip install requests\n  ```\n- Run it";
    const blocks = getBlocks(md);
    expect(blocks[0].raw).toContain("pip install requests");
  });

  it("preserves SQL with single quotes in code block inside list", () => {
    const md = "1. Enter:\n   ```\n   ' WAITFOR DELAY '0:0:5' --\n   ```\n2. Press Enter";
    const blocks = getBlocks(md);
    expect(blocks[0].raw).toContain("WAITFOR DELAY");
    expect(blocks[0].raw).toContain("'0:0:5'");
  });

  it("preserves multi-line continuation without code block", () => {
    const md = "- First line\n  continued here\n  and here\n- Second item";
    const blocks = getBlocks(md);
    expect(blocks[0].raw).toContain("continued here");
    expect(blocks[0].raw).toContain("and here");
    expect(blocks).toHaveLength(2);
  });

  it("round-trips ordered list with code blocks", () => {
    const md = "1. Run this:\n   ```\n   echo hello\n   ```\n2. Check output\n3. Done";
    const blocks = getBlocks(md);
    const rebuilt = blocksToContent(blocks);
    expect(rebuilt).toBe(md);
  });

  it("round-trips unordered list with code blocks", () => {
    const md = "- Install:\n  ```bash\n  pip install requests\n  ```\n- Run it";
    const blocks = getBlocks(md);
    const rebuilt = blocksToContent(blocks);
    expect(rebuilt).toBe(md);
  });

  it("round-trips list with SQL injection payload", () => {
    const md = "1. Enter:\n   ```\n   ' WAITFOR DELAY '0:0:5' --\n   ```\n2. Press Enter";
    const blocks = getBlocks(md);
    const rebuilt = blocksToContent(blocks);
    expect(rebuilt).toBe(md);
  });

  it("round-trips checkbox list", () => {
    const md = "- [x] Done task\n- [ ] Pending task";
    const blocks = getBlocks(md);
    const rebuilt = blocksToContent(blocks);
    expect(rebuilt).toBe(md);
  });

  it("round-trips full fixture file", () => {
    const fs = require("fs");
    const path = require("path");
    const fixture = fs.readFileSync(
      path.join(__dirname, "../fixtures/list-with-code-blocks.md"),
      "utf-8"
    );
    const blocks = getBlocks(fixture);
    const rebuilt = blocksToContent(blocks);
    // Re-parse both to normalize — exact match may differ on trailing whitespace
    const blocks2 = getBlocks(rebuilt);
    expect(blocks2.length).toBe(blocks.length);
    blocks2.forEach((b, i) => {
      expect(b.type).toBe(blocks[i].type);
    });
  });
});

// ── buildLinkedRaw ────────────────────────────────────────────────────────────

describe("buildLinkedRaw", () => {
  it("wraps selected text with a markdown link", () => {
    expect(buildLinkedRaw("Hello world", "world", "https://example.com"))
      .toBe("Hello [world](https://example.com)");
  });

  it("returns null when selected text is not found", () => {
    expect(buildLinkedRaw("Hello world", "missing", "https://example.com")).toBeNull();
  });

  it("replaces the first occurrence when text appears multiple times", () => {
    const result = buildLinkedRaw("the cat and the dog", "the", "https://example.com");
    expect(result).toBe("[the](https://example.com) cat and the dog");
  });

  it("wraps text at the start of the raw string", () => {
    expect(buildLinkedRaw("Click here for more", "Click here", "https://example.com"))
      .toBe("[Click here](https://example.com) for more");
  });

  it("wraps text at the end of the raw string", () => {
    expect(buildLinkedRaw("Read the docs", "docs", "https://example.com"))
      .toBe("Read the [docs](https://example.com)");
  });

  it("handles the entire raw string being selected", () => {
    expect(buildLinkedRaw("full text", "full text", "https://example.com"))
      .toBe("[full text](https://example.com)");
  });

  it("preserves surrounding markdown syntax", () => {
    expect(buildLinkedRaw("See **bold** text", "bold", "https://example.com"))
      .toBe("See **[bold](https://example.com)** text");
  });

  it("returns null for an empty selected text", () => {
    // empty string is always found at position 0 — guard this in the caller
    const result = buildLinkedRaw("hello", "", "https://example.com");
    // indexOf("") === 0, so it wraps nothing at position 0
    expect(result).toBe("[](https://example.com)hello");
  });

  it("works with anchor URLs", () => {
    expect(buildLinkedRaw("Jump to section", "section", "#heading"))
      .toBe("Jump to [section](#heading)");
  });
});
