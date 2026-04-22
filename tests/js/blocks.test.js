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
