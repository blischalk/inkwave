import { escapeHtml, blockRaw } from "./utils.js";

export { blockRaw };

export function getBlocks(content) {
  if (!content || String(content).trim() === "") return [];
  try {
    if (typeof marked !== "undefined" && typeof marked.lexer === "function") {
      const tokens = marked.lexer(content);
      const out = [];
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (!t || t.type === "space") continue;
        const raw =
          t.raw != null
            ? typeof t.raw === "string"
              ? t.raw
              : String(t.raw)
            : "";
        if (t.type === "list") {
          for (const item of t.items || []) {
            const r = (item.raw || "").replace(/[\s]+$/, "");
            if (r) out.push({ raw: r, type: "list" });
          }
          continue;
        }
        out.push({ raw: raw, type: t.type || "paragraph", depth: t.depth });
      }
      return out;
    }
  } catch (e) {}
  const parts = String(content).split(/\n\n+/);
  return parts.map((raw) => ({ raw: raw, type: "paragraph" }));
}

export function blocksToContent(blocks) {
  if (blocks.length === 0) return "";
  function cleanRaw(b) { return blockRaw(b).replace(/[\s]+$/, ""); }
  let result = cleanRaw(blocks[0]);
  for (let i = 1; i < blocks.length; i++) {
    const prevType = typeof blocks[i - 1] === "object" ? blocks[i - 1].type : "paragraph";
    const curType  = typeof blocks[i]     === "object" ? blocks[i].type     : "paragraph";
    // Consecutive list items use a single newline (tight list, no blank lines between items).
    const sep = (prevType === "list" && curType === "list") ? "\n" : "\n\n";
    result += sep + cleanRaw(blocks[i]);
  }
  return result;
}

/** Offsets of each block in the content string (from blocksToContent). [{ start, end }, ...] */
export function getBlockOffsets(blocks) {
  if (blocks.length === 0) return [];
  function cleanRaw(b) { return blockRaw(b).replace(/[\s]+$/, ""); }
  const out = [];
  let pos = 0;
  for (let i = 0; i < blocks.length; i++) {
    const raw = cleanRaw(blocks[i]);
    out.push({ start: pos, end: pos + raw.length });
    pos += raw.length;
    if (i < blocks.length - 1) {
      const prevType = typeof blocks[i] === "object" ? blocks[i].type : "paragraph";
      const curType  = typeof blocks[i + 1] === "object" ? blocks[i + 1].type : "paragraph";
      const sep = (prevType === "list" && curType === "list") ? "\n" : "\n\n";
      pos += sep.length;
    }
  }
  return out;
}

/** Map a content character offset to block index and offset within that block. */
export function contentOffsetToBlockAndOffset(blocks, contentOffset) {
  const offsets = getBlockOffsets(blocks);
  if (offsets.length === 0) return { blockIndex: 0, offsetInBlock: 0 };
  const off = Math.max(0, Math.min(contentOffset, offsets[offsets.length - 1].end));
  for (let i = 0; i < offsets.length; i++) {
    if (off < offsets[i].end) return { blockIndex: i, offsetInBlock: off - offsets[i].start };
  }
  const last = offsets[offsets.length - 1];
  return { blockIndex: offsets.length - 1, offsetInBlock: last.end - last.start };
}

/** Map block index + offset within block to content character offset. */
export function blockAndOffsetToContentOffset(blocks, blockIndex, offsetInBlock) {
  const offsets = getBlockOffsets(blocks);
  if (offsets.length === 0) return 0;
  const i = Math.max(0, Math.min(blockIndex, offsets.length - 1));
  const seg = offsets[i];
  const off = Math.max(0, Math.min(offsetInBlock, seg.end - seg.start));
  return seg.start + off;
}

export function getInlineBlockType(text) {
  const line = (typeof text === "string" ? text : "").split("\n")[0] || "";
  const t = line.trimStart();
  if (/^```/.test(t)) {
    return { type: "code" };
  }
  if (/^#+\s/.test(t)) {
    const n = (t.match(/^#+/) || [""])[0].length;
    return { type: "heading", depth: Math.min(n, 6) || 1 };
  }
  if (/^>\s/.test(t)) return { type: "blockquote" };
  if (/^[-*]\s/.test(t) || /^\d+\.\s/.test(t)) return { type: "list" };
  return { type: "paragraph" };
}

export function getListPrefix(raw) {
  if (!raw || typeof raw !== "string") return "- ";
  const m = raw.match(/^([-*]\s|\d+\.\s)/);
  return m ? m[1] : "- ";
}

export function stripListMarker(raw) {
  if (!raw || typeof raw !== "string") return "";
  return raw.replace(/^([-*]\s|\d+\.\s)/, "");
}

export function isOrderedListPrefix(prefix) {
  return prefix && /^\d+\.\s$/.test(prefix);
}

export function getListItemDisplayHtml(raw) {
  if (!raw || typeof raw !== "string") return "";
  const parsed = marked.parse(raw);
  const div = document.createElement("div");
  div.innerHTML = parsed;
  const li = div.querySelector("ul li, ol li");
  return li ? li.innerHTML : escapeHtml(stripListMarker(raw));
}

export function applyBlockTypeFromText(blockEl, text) {
  if (!blockEl || !blockEl.classList) return;
  const info = getInlineBlockType(text);
  blockEl.classList.remove(
    "md-block-paragraph",
    "md-block-heading-1",
    "md-block-heading-2",
    "md-block-heading-3",
    "md-block-heading-4",
    "md-block-heading-5",
    "md-block-heading-6",
    "md-block-blockquote",
    "md-block-list",
    "md-block-code",
  );
  blockEl.classList.add("md-block-" + info.type);
  if (info.type === "heading" && info.depth) {
    blockEl.classList.add("md-block-heading-" + info.depth);
  }
}
