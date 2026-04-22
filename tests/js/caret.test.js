import { describe, it, expect } from "vitest";
import {
  renderedOffsetToSourceOffset,
  sourceOffsetToRenderedOffset,
} from "../../js/caret.js";

describe("renderedOffsetToSourceOffset", () => {
  describe("heading", () => {
    it("offset 0 in rendered maps to after the heading prefix in source", () => {
      // "## Hello" — prefix is "## " (3 chars)
      expect(renderedOffsetToSourceOffset("## Hello", "Hello", 0, "heading")).toBe(3);
    });

    it("offset at end of rendered maps to end of source", () => {
      // "## Hello" is 8 chars; prefix 3, rendered "Hello" is 5 chars
      expect(renderedOffsetToSourceOffset("## Hello", "Hello", 5, "heading")).toBe(8);
    });

    it("clamps offset to rendered text length", () => {
      expect(renderedOffsetToSourceOffset("## Hi", "Hi", 99, "heading")).toBe(5);
    });

    it("clamps negative offset to 0 (then adds prefix length)", () => {
      // safeOffset = max(0, -5) = 0; prefix "## " = 3; result = 3 + 0 = 3
      expect(renderedOffsetToSourceOffset("## Hi", "Hi", -5, "heading")).toBe(3);
    });

    it("works with h1 (single #)", () => {
      // "# A" — prefix "# " = 2 chars
      expect(renderedOffsetToSourceOffset("# A", "A", 0, "heading")).toBe(2);
    });
  });

  describe("blockquote", () => {
    it("offset 0 in rendered maps past '>  ' prefix", () => {
      // "> quote" — prefix "> " = 2 chars
      expect(renderedOffsetToSourceOffset("> quote", "quote", 0, "blockquote")).toBe(2);
    });

    it("offset in rendered maps correctly", () => {
      expect(renderedOffsetToSourceOffset("> hello", "hello", 3, "blockquote")).toBe(5);
    });
  });

  describe("paragraph (no prefix stripping)", () => {
    it("offset passes through unchanged", () => {
      expect(renderedOffsetToSourceOffset("hello", "hello", 3, "paragraph")).toBe(3);
    });

    it("offset 0 returns 0", () => {
      expect(renderedOffsetToSourceOffset("hello", "hello", 0, "paragraph")).toBe(0);
    });
  });
});

describe("sourceOffsetToRenderedOffset", () => {
  describe("heading", () => {
    it("source offset inside prefix (< 3) returns 0", () => {
      // "## Hello" prefix = 3; source offset 1 is inside prefix
      expect(sourceOffsetToRenderedOffset("## Hello", 1, "heading")).toBe(0);
    });

    it("source offset at end of prefix returns 0", () => {
      expect(sourceOffsetToRenderedOffset("## Hello", 3, "heading")).toBe(0);
    });

    it("source offset after prefix maps to rendered offset", () => {
      // offset 5 in "## Hello" → 5-3 = 2 in rendered "Hello"
      expect(sourceOffsetToRenderedOffset("## Hello", 5, "heading")).toBe(2);
    });

    it("source offset at end returns full rendered length", () => {
      // "## Hello" = 8 chars; 8-3 = 5
      expect(sourceOffsetToRenderedOffset("## Hello", 8, "heading")).toBe(5);
    });
  });

  describe("blockquote", () => {
    it("source offset inside prefix returns 0", () => {
      expect(sourceOffsetToRenderedOffset("> hello", 1, "blockquote")).toBe(0);
    });

    it("source offset past prefix maps correctly", () => {
      // "> hello": prefix "> " = 2; source offset 4 → rendered offset 2
      expect(sourceOffsetToRenderedOffset("> hello", 4, "blockquote")).toBe(2);
    });
  });

  describe("list", () => {
    it("source offset inside list marker returns 0", () => {
      // "- item": prefix "- " = 2; offset 1 → 0
      expect(sourceOffsetToRenderedOffset("- item", 1, "list")).toBe(0);
    });

    it("source offset past marker maps correctly", () => {
      // "- item": prefix 2; offset 4 → 2
      expect(sourceOffsetToRenderedOffset("- item", 4, "list")).toBe(2);
    });

    it("handles ordered list marker", () => {
      // "1. item": prefix "1. " = 3; offset 5 → 2
      expect(sourceOffsetToRenderedOffset("1. item", 5, "list")).toBe(2);
    });
  });

  describe("paragraph (no prefix)", () => {
    it("passes through unchanged", () => {
      expect(sourceOffsetToRenderedOffset("hello", 3, "paragraph")).toBe(3);
    });
  });

  describe("round-trip with renderedOffsetToSourceOffset", () => {
    it("heading: rendered→source→rendered is identity", () => {
      const source = "## Hello world";
      const rendered = "Hello world";
      for (let r = 0; r <= rendered.length; r++) {
        const s = renderedOffsetToSourceOffset(source, rendered, r, "heading");
        const r2 = sourceOffsetToRenderedOffset(source, s, "heading");
        expect(r2).toBe(r);
      }
    });

    it("blockquote: rendered→source→rendered is identity", () => {
      const source = "> some text";
      const rendered = "some text";
      for (let r = 0; r <= rendered.length; r++) {
        const s = renderedOffsetToSourceOffset(source, rendered, r, "blockquote");
        const r2 = sourceOffsetToRenderedOffset(source, s, "blockquote");
        expect(r2).toBe(r);
      }
    });
  });
});
