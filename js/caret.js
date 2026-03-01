// Caret / cursor utilities. No imports — zero dependencies.

export function getTextLength(node) {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || "").length;
  let len = 0;
  for (let i = 0; i < node.childNodes.length; i++)
    len += getTextLength(node.childNodes[i]);
  return len;
}

export function getCharacterOffset(container, node, nodeOffset) {
  let offset = 0;
  function walk(n) {
    if (n === node) {
      if (n.nodeType === Node.TEXT_NODE) {
        offset += nodeOffset;
      } else {
        for (let i = 0; i < nodeOffset && i < n.childNodes.length; i++) {
          offset += getTextLength(n.childNodes[i]);
        }
      }
      return true;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      offset += n.textContent.length;
      return false;
    }
    for (let i = 0; i < n.childNodes.length; i++) {
      if (walk(n.childNodes[i])) return true;
    }
    return false;
  }
  walk(container);
  return offset;
}

export function renderedOffsetToSourceOffset(
  source,
  renderedText,
  offsetInRendered,
  blockType,
) {
  const safeOffset = Math.max(0, Math.min(offsetInRendered, renderedText.length));
  if (blockType === "heading") {
    const m = source.match(/^#+\s*/);
    const prefixLen = m ? m[0].length : 0;
    return prefixLen + safeOffset;
  }
  if (blockType === "blockquote") {
    const firstLine = source.split("\n")[0] || "";
    const q = firstLine.match(/^>\s*/);
    const prefixLen = q ? q[0].length : 0;
    return Math.min(prefixLen + safeOffset, source.length);
  }
  return safeOffset;
}

export function getCaretOffset(editable) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (!editable.contains(range.startContainer)) return 0;
  return getCharacterOffset(editable, range.startContainer, range.startOffset);
}

export function setCaretPosition(editable, position) {
  editable.focus();
  if (!editable.firstChild) return;
  const totalLen = getTextLength(editable);
  const offset = Math.max(0, Math.min(position, totalLen));
  const sel = window.getSelection();
  const range = document.createRange();
  let found = false;
  function walk(n, remaining) {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n.textContent || "").length;
      if (remaining <= len) {
        range.setStart(n, remaining);
        range.collapse(true);
        found = true;
        return true;
      }
      return remaining - len;
    }
    for (let i = 0; i < n.childNodes.length; i++) {
      const r = walk(n.childNodes[i], remaining);
      if (r === true) return true;
      remaining = r;
    }
    return remaining;
  }
  walk(editable, offset);
  if (found) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
