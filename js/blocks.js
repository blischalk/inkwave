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
          const lines = raw.split(/\r?\n/);
          for (let j = 0; j < lines.length; j++) {
            const line = lines[j];
            if (/^\s*([-*]\s|\d+\.\s)/.test(line) && line.trim() !== "") {
              out.push({ raw: line.replace(/^\s+/, ""), type: "list" });
            }
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
