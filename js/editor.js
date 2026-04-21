import {
  currentBlocks, currentTabRef, _replacingContent,
  setCurrentBlocks,
  onShowTabContent,
  registerStartInlineEdit,
  vimMode,
  getContentEl,
} from "./state.js";
import { blockRaw, blocksToContent, getInlineBlockType, getListPrefix, stripListMarker, applyBlockTypeFromText } from "./blocks.js";
import { getCharacterOffset, renderedOffsetToSourceOffset, getCaretOffset, setCaretPosition } from "./caret.js";
import { saveToFile } from "./fileio.js";
import { getActiveTab } from "./tabs.js";
import { dbg, DEBUG_ENTER } from "./debug.js";
import { getYank } from "./vim.js";

// startInlineEdit: sixth argument (cursorHint) can be:
//   - a number → explicit character offset
//   - true     → cursor at end
//   - null/absent → cursor from click position
export function startInlineEdit(blockEl, index, blocks, tab, clickEvent, cursorHint = null) {
  if (blockEl.classList.contains("editing")) return;
  const contentEl = blockEl.closest('.content') || document.querySelector('.content');
  const raw = blockRaw(blocks[index]);
  const blockType = blocks[index].type || "paragraph";
  dbg(
    "startInlineEdit: index=",
    index,
    "raw=" + JSON.stringify(raw),
    "blockType=",
    blockType,
  );
  const explicitOffset = typeof cursorHint === "number" ? cursorHint : null;

  const isListItemInPlace =
    blockEl.tagName === "LI" &&
    blockEl.parentNode &&
    blockEl.parentNode.classList &&
    blockEl.parentNode.classList.contains("md-list-container");

  if (isListItemInPlace) {
    const listPrefix = getListPrefix(raw);
    const stripped = stripListMarker(raw);
    let offsetInRenderedLi = 0;
    if (clickEvent) {
      let range = null;
      if (typeof document.caretRangeFromPoint === "function") {
        range = document.caretRangeFromPoint(
          clickEvent.clientX,
          clickEvent.clientY,
        );
      } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(
          clickEvent.clientX,
          clickEvent.clientY,
        );
        if (pos)
          range = { startContainer: pos.offsetNode, startOffset: pos.offset };
      }
      if (range && blockEl.contains(range.startContainer)) {
        offsetInRenderedLi = getCharacterOffset(
          blockEl,
          range.startContainer,
          range.startOffset,
        );
      }
    }
    const cursorAtEndLi = cursorHint === true;
    blockEl.classList.add("editing");
    blockEl.contentEditable = "true";
    blockEl.textContent = stripped;
    if (!blockEl.firstChild) blockEl.appendChild(document.createTextNode(""));
    const offsetInLi = cursorAtEndLi
      ? stripped.length
      : Math.min(offsetInRenderedLi, stripped.length);

    function getEditableText() {
      return (
        blockEl.innerText != null
          ? blockEl.innerText
          : blockEl.textContent || ""
      ).replace(/\u00a0/g, " ");
    }
    function getFullRaw() {
      return listPrefix + getEditableText();
    }
    function syncContentAndAutosave() {
      blocks[index].raw = getFullRaw();
      tab.content = blocksToContent(blocks);
      currentTabRef.content = tab.content;
      saveToFile(tab);
    }
    function commit() {
      if (_replacingContent || !blocks[index]) return;
      blocks[index].raw = getFullRaw();
      tab.content = blocksToContent(blocks);
      currentTabRef.content = tab.content;
      setCurrentBlocks(blocks);
      saveToFile(tab);
      if (!_replacingContent && onShowTabContent) onShowTabContent(tab);
    }

    blockEl.addEventListener("input", syncContentAndAutosave);
    blockEl.addEventListener("blur", function onBlur() {
      blockEl.removeEventListener("blur", onBlur);
      blockEl.removeEventListener("input", syncContentAndAutosave);
      blockEl.contentEditable = "false";
      blockEl.classList.remove("editing");
      delete blockEl._vimSync;
      commit();
    });
    blockEl._vimSync = syncContentAndAutosave;
    const onListKeydown = (e) => {
      const k = (e.key || "").toLowerCase();
      if (vimMode && !e.ctrlKey && !e.metaKey && !e.altKey && k === "p") {
        if (k === "p") {
          const yank = getYank();
          if (yank) {
            e.preventDefault();
            e.stopPropagation();
            document.execCommand("insertText", false, yank);
            syncContentAndAutosave();
          }
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        blockEl.blur();
        return;
      }
      if (
        e.key === "Backspace" &&
        index > 0 &&
        getEditableText().trim() === ""
      ) {
        e.preventDefault();
        blocks.splice(index, 1);
        tab.content = blocksToContent(blocks);
        currentTabRef.content = tab.content;
        setCurrentBlocks(blocks);
        saveToFile(tab);
        if (onShowTabContent) onShowTabContent(tab);
        setTimeout(() => {
          const prev = contentEl.querySelector(
            '.md-block[data-block-index="' + (index - 1) + '"]',
          );
          if (prev)
            startInlineEdit(prev, index - 1, currentBlocks, tab, null, true);
        }, 0);
        return;
      }
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        document.execCommand("insertLineBreak", false, null);
        syncContentAndAutosave();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const text = getEditableText();
        const offset = Math.max(
          0,
          Math.min(getCaretOffset(blockEl), text.length),
        );
        const beforeCursor = text.slice(0, offset);
        const afterCursor = text.slice(offset);
        const isLastBlock = index === blocks.length - 1;
        const isEmptyItem =
          text.trim() === "" ||
          stripListMarker(blocks[index].raw || "").trim() === "";
        if (isLastBlock && isEmptyItem) {
          blocks.splice(index, 1);
          blocks.push({ raw: "", type: "paragraph" });
          tab.content = blocksToContent(blocks);
          currentTabRef.content = tab.content;
          setCurrentBlocks(blocks);
          saveToFile(tab);
          const focusIndex = blocks.length - 1;
          if (onShowTabContent) onShowTabContent(tab, blocks);
          requestAnimationFrame(() => {
            setTimeout(() => {
              const nextEl = contentEl.querySelector(
                '.md-block[data-block-index="' + focusIndex + '"]',
              );
              if (nextEl) {
                startInlineEdit(
                  nextEl,
                  focusIndex,
                  currentBlocks,
                  tab,
                  null,
                  true,
                );
                const edit =
                  nextEl.tagName === "LI"
                    ? nextEl
                    : nextEl.querySelector(".inline-edit");
                if (edit) {
                  edit.focus();
                  setCaretPosition(edit, 0);
                }
              }
            }, 0);
          });
          return;
        }
        if (isEmptyItem) {
          blocks.splice(index, 1);
          tab.content = blocksToContent(blocks);
          currentTabRef.content = tab.content;
          setCurrentBlocks(blocks);
          saveToFile(tab);
          if (onShowTabContent) onShowTabContent(tab, blocks);
          setTimeout(() => {
            const nextEl = contentEl.querySelector(
              '.md-block[data-block-index="' + index + '"]',
            );
            if (nextEl) {
              startInlineEdit(nextEl, index, currentBlocks, tab, null, false);
              const edit =
                nextEl.tagName === "LI"
                  ? nextEl
                  : nextEl.querySelector(".inline-edit");
              if (edit) {
                edit.focus();
                setCaretPosition(edit, 0);
              }
            }
          }, 10);
          return;
        }
        blocks[index].raw = listPrefix + beforeCursor;
        blocks.splice(index + 1, 0, {
          raw: listPrefix + afterCursor,
          type: "list",
        });
        tab.content = blocksToContent(blocks);
        currentTabRef.content = tab.content;
        setCurrentBlocks(blocks);
        saveToFile(tab);
        requestAnimationFrame(() => {
          if (onShowTabContent) onShowTabContent(tab, blocks);
          setTimeout(() => {
            const newLi = contentEl.querySelector(
              '.md-block[data-block-index="' + (index + 1) + '"]',
            );
            if (newLi) {
              startInlineEdit(newLi, index + 1, currentBlocks, tab, null);
              newLi.focus();
              setCaretPosition(newLi, 0);
              setTimeout(() => {
                if (document.activeElement !== newLi) {
                  newLi.focus();
                  setCaretPosition(newLi, 0);
                }
              }, 0);
            }
          }, 0);
        });
        return;
      }
    };
    blockEl.addEventListener("keydown", onListKeydown, true);

    blockEl.focus();
    setTimeout(() => {
      setCaretPosition(blockEl, offsetInLi);
    }, 0);
    return;
  }

  // ── Non-list-item path ───────────────────────────────────────────────────
  const renderedText = blockEl.textContent || "";
  let offsetInRendered = 0;
  if (clickEvent) {
    let range = null;
    if (typeof document.caretRangeFromPoint === "function") {
      range = document.caretRangeFromPoint(
        clickEvent.clientX,
        clickEvent.clientY,
      );
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(
        clickEvent.clientX,
        clickEvent.clientY,
      );
      if (pos) {
        range = { startContainer: pos.offsetNode, startOffset: pos.offset };
      }
    }
    if (range && blockEl.contains(range.startContainer)) {
      offsetInRendered = getCharacterOffset(
        blockEl,
        range.startContainer,
        range.startOffset,
      );
    }
  }
  let sourceOffset = renderedOffsetToSourceOffset(
    raw,
    renderedText,
    offsetInRendered,
    blockType,
  );
  const cursorAtEnd = cursorHint === true;
  if (cursorAtEnd) {
    sourceOffset =
      blockType === "list" ? stripListMarker(raw).length : raw ? raw.length : 0;
  }

  blockEl.classList.add("editing");
  const isCodeBlock = blockType === "code";
  if (!isCodeBlock) {
    const placeholder = document.createElement("div");
    placeholder.className = "md-block-placeholder";
    while (blockEl.firstChild) placeholder.appendChild(blockEl.firstChild);
    blockEl.appendChild(placeholder);
  } else {
    blockEl.innerHTML = "";
  }
  let listPrefix = blockType === "list" ? getListPrefix(raw) : null;
  const editable = document.createElement("div");
  editable.className = "inline-edit";
  editable.contentEditable = "true";
  if (isCodeBlock) {
    editable.setAttribute("autocapitalize", "none");
    editable.setAttribute("autocorrect", "off");
    editable.setAttribute("autocomplete", "off");
    editable.setAttribute("spellcheck", "false");
  }
  editable.textContent = blockType === "list" ? stripListMarker(raw) : raw;
  if (!editable.firstChild) editable.appendChild(document.createTextNode(""));
  blockEl.appendChild(editable);

  function getEditableText() {
    return (
      editable.innerText != null
        ? editable.innerText
        : editable.textContent || ""
    ).replace(/\u00a0/g, " ");
  }
  function getFullRaw() {
    return listPrefix != null
      ? listPrefix + getEditableText()
      : getEditableText();
  }
  function syncBlockType() {
    const full = getFullRaw();
    const info = getInlineBlockType(full);
    if (info.type === "list" && listPrefix == null) {
      listPrefix = getListPrefix(full);
      const stripped = stripListMarker(full);
      if ((editable.textContent || "") !== stripped) {
        editable.textContent = stripped || "";
        if (!editable.firstChild)
          editable.appendChild(document.createTextNode(""));
      }
    }
    applyBlockTypeFromText(blockEl, full);
    blocks[index].type = info.type;
    if (info.depth) blocks[index].depth = info.depth;
  }
  function syncContentAndAutosave() {
    blocks[index].raw = getFullRaw();
    tab.content = blocksToContent(blocks);
    currentTabRef.content = tab.content;
    saveToFile(tab);
  }
  syncBlockType();
  editable.addEventListener("input", () => {
    syncBlockType();
    syncContentAndAutosave();
  });

  const isEmptyBlock = !raw || String(raw).trim() === "";
  const initialOffset = explicitOffset != null ? explicitOffset : sourceOffset;
  if (isEmptyBlock) {
    dbg("startInlineEdit: empty block, focus now");
    setCaretPosition(editable, initialOffset);
  } else {
    setTimeout(() => {
      setCaretPosition(editable, initialOffset);
    }, 0);
  }

  function commit() {
    if (_replacingContent || !blocks[index]) return;
    const newRaw = getFullRaw();
    const info = getInlineBlockType(newRaw);
    blocks[index].raw = newRaw;
    blocks[index].type = info.type;
    if (info.depth) blocks[index].depth = info.depth;
    tab.content = blocksToContent(blocks);
    currentTabRef.content = tab.content;
    setCurrentBlocks(blocks);
    saveToFile(tab);
    if (!_replacingContent && onShowTabContent) onShowTabContent(tab);
  }

  editable.addEventListener("blur", function onBlur() {
    editable.removeEventListener("blur", onBlur);
    delete editable._vimSync;
    delete blockEl._vimSync;
    commit();
  });
  editable._vimSync = syncContentAndAutosave;
  blockEl._vimSync = syncContentAndAutosave;
  editable.addEventListener("keydown", (e) => {
    const k = (e.key || "").toLowerCase();
    if (vimMode && !e.ctrlKey && !e.metaKey && !e.altKey && k === "p") {
      if (k === "p") {
        const yank = getYank();
        if (yank) {
          e.preventDefault();
          e.stopPropagation();
          document.execCommand("insertText", false, yank);
          syncContentAndAutosave();
        }
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      editable.blur();
    }
    if (e.key === "Tab" && blockEl.classList.contains("md-block-code")) {
      e.preventDefault();
      document.execCommand("insertText", false, "    ");
      syncContentAndAutosave();
      return;
    }
    if (e.key === "Backspace" && index > 0 && getEditableText().trim() === "") {
      e.preventDefault();
      blocks.splice(index, 1);
      tab.content = blocksToContent(blocks);
      currentTabRef.content = tab.content;
      setCurrentBlocks(blocks);
      saveToFile(tab);
      if (onShowTabContent) onShowTabContent(tab);
      setTimeout(() => {
        const prevBlockEl = contentEl.querySelector(
          '.md-block[data-block-index="' + (index - 1) + '"]',
        );
        if (prevBlockEl)
          startInlineEdit(
            prevBlockEl,
            index - 1,
            currentBlocks,
            tab,
            null,
            true,
          );
      }, 0);
      return;
    }
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      document.execCommand("insertLineBreak", false, null);
      syncContentAndAutosave();
      return;
    }
    if (e.key === "Enter") {
      const text = getEditableText();
      const offset = Math.max(0, Math.min(getCaretOffset(editable), text.length));

      if (blockEl.classList.contains("md-block-code")) {
        const firstLine = text.split("\n")[0] || "";
        const openFenceMatch = firstLine.match(/^```(\w+)?$/);
        const onlyFenceLine =
          text.trim() === firstLine.trim() && offset === text.length;
        // Content is just opening fence (e.g. ``` or ```python) and cursor at end → complete block and focus inside.
        if (openFenceMatch && onlyFenceLine) {
          e.preventDefault();
          e.stopPropagation();
          const lang = openFenceMatch[1] || "";
          const fence = "```" + lang;
          const rawCodeBlock = fence + "\n\n```";
          blocks[index].raw = rawCodeBlock;
          blocks[index].type = "code";
          delete blocks[index].depth;
          tab.content = blocksToContent(blocks);
          currentTabRef.content = tab.content;
          setCurrentBlocks(blocks);
          saveToFile(tab);
          requestAnimationFrame(() => {
            if (onShowTabContent) onShowTabContent(tab, currentBlocks);
            setTimeout(() => {
              const codeBlockEl = contentEl.querySelector(
                '.md-block[data-block-index="' + index + '"]',
              );
              if (!codeBlockEl) return;
              startInlineEdit(
                codeBlockEl,
                index,
                currentBlocks,
                tab,
                null,
                fence.length + 1,
              );
            }, 0);
          });
          return;
        }
        // If caret is at or after the end of the closing fence line, exit block and start new paragraph below.
        const lastLineStart = text.lastIndexOf("\n") + 1;
        const lastLine = text.slice(lastLineStart);
        const atEndOfLastLine = offset >= lastLineStart + lastLine.length;
        if (/```[ \t]*$/.test(lastLine) && atEndOfLastLine) {
          e.preventDefault();
          e.stopPropagation();
          blocks[index].raw = text;
          tab.content = blocksToContent(blocks);
          currentTabRef.content = tab.content;
          setCurrentBlocks(blocks);
          saveToFile(tab);
          const newBlock = { raw: "", type: "paragraph" };
          blocks.splice(index + 1, 0, newBlock);
          tab.content = blocksToContent(blocks);
          currentTabRef.content = tab.content;
          setCurrentBlocks(blocks);
          saveToFile(tab);
          requestAnimationFrame(() => {
            if (onShowTabContent) onShowTabContent(tab, currentBlocks);
            setTimeout(() => {
              const newBlockEl = contentEl.querySelector(
                '.md-block[data-block-index="' + (index + 1) + '"]',
              );
              if (!newBlockEl) return;
              startInlineEdit(newBlockEl, index + 1, currentBlocks, tab, null);
            }, 0);
          });
          return;
        }
        // Otherwise let Enter behave as a normal newline inside the code block.
        return;
      }

      // Detect ``` or ```lang on an otherwise empty block (still a paragraph) and turn it into a fenced code block.
      const beforeCursor = text.slice(0, offset);
      const afterCursor = text.slice(offset);
      const lineStart = beforeCursor.lastIndexOf("\n") + 1;
      const currentLine = beforeCursor.slice(lineStart);
      const fenceMatch = currentLine.match(/^```(\w+)?$/);
      const hasOnlyFenceBefore =
        text.slice(0, lineStart).trim() === "" && afterCursor.trim() === "";
      if (fenceMatch && hasOnlyFenceBefore) {
        e.preventDefault();
        e.stopPropagation();
        const lang = fenceMatch[1] || "";
        const fence = "```" + lang;
        const rawCodeBlock = fence + "\n\n```";
        blocks[index].raw = rawCodeBlock;
        blocks[index].type = "code";
        delete blocks[index].depth;
        tab.content = blocksToContent(blocks);
        currentTabRef.content = tab.content;
        setCurrentBlocks(blocks);
        saveToFile(tab);
        requestAnimationFrame(() => {
          if (onShowTabContent) onShowTabContent(tab, currentBlocks);
          setTimeout(() => {
            const codeBlockEl = contentEl.querySelector(
              '.md-block[data-block-index="' + index + '"]',
            );
            if (!codeBlockEl) return;
            // Place caret on the empty line between opening and closing fences.
            startInlineEdit(
              codeBlockEl,
              index,
              currentBlocks,
              tab,
              null,
              fence.length + 1,
            );
          }, 0);
        });
        return;
      }
    }
    if (e.key === "Enter" && !blockEl.classList.contains("md-block-code")) {
      dbg("editable keydown Enter: index=", index);
      e.preventDefault();
      syncBlockType();
      const text2 = getEditableText();
      const offset2 = Math.max(
        0,
        Math.min(getCaretOffset(editable), text2.length),
      );
      const beforeCursor2 = text2.slice(0, offset2);
      const afterCursor2 = text2.slice(offset2);
      const isList = blockEl.classList.contains("md-block-list");
      const prefix = isList
        ? listPrefix != null
          ? listPrefix
          : getListPrefix(blocks[index].raw)
        : null;
      if (isList && prefix && text2.trim() === "") {
        blocks.splice(index, 1);
        tab.content = blocksToContent(blocks);
        currentTabRef.content = tab.content;
        setCurrentBlocks(blocks);
        saveToFile(tab);
        if (onShowTabContent) onShowTabContent(tab);
        setTimeout(() => {
          const nextEl = contentEl.querySelector(
            '.md-block[data-block-index="' + index + '"]',
          );
          if (nextEl) startInlineEdit(nextEl, index, currentBlocks, tab, null);
        }, 10);
        return;
      }
      if (prefix) {
        blocks[index].raw = prefix + beforeCursor2;
        const newBlock = { raw: prefix + afterCursor2, type: "list" };
        blocks.splice(index + 1, 0, newBlock);
      } else {
        blocks[index].raw =
          typeof beforeCursor2 === "string"
            ? beforeCursor2
            : String(beforeCursor2 || "");
        const newBlock = {
          raw:
            typeof afterCursor2 === "string"
              ? afterCursor2
              : String(afterCursor2 || ""),
          type: "paragraph",
        };
        blocks.splice(index + 1, 0, newBlock);
      }
      tab.content = blocksToContent(blocks);
      currentTabRef.content = tab.content;
      setCurrentBlocks(blocks);
      saveToFile(tab);
      requestAnimationFrame(() => {
        if (onShowTabContent) onShowTabContent(tab, blocks);
        setTimeout(() => {
          const newBlockEl = contentEl.querySelector(
            '.md-block[data-block-index="' + (index + 1) + '"]',
          );
          if (newBlockEl) {
            startInlineEdit(newBlockEl, index + 1, currentBlocks, tab, null);
            const edit2 = newBlockEl.querySelector(".inline-edit");
            if (edit2) {
              edit2.focus();
              setCaretPosition(edit2, 0);
              setTimeout(() => {
                if (document.activeElement !== edit2) {
                  edit2.focus();
                  setCaretPosition(edit2, 0);
                }
              }, 0);
            }
          }
        }, 0);
      });
    }
  }, true);
}

export function handleEnterInBlock(editable, blockEl, index) {
  const contentEl = blockEl.closest('.content') || document.querySelector('.content');
  const tab = getActiveTab() || currentTabRef;
  if (
    !tab ||
    !currentBlocks.length ||
    index < 0 ||
    index >= currentBlocks.length
  ) {
    dbg("handleEnterInBlock: bail early", !!tab, currentBlocks.length, index);
    return;
  }
  if (blockEl.classList.contains("md-block-code")) return;
  const blocks = currentBlocks;
  const text = (
    editable.innerText != null ? editable.innerText : editable.textContent || ""
  ).replace(/\u00a0/g, " ");
  const offset = Math.max(0, Math.min(getCaretOffset(editable), text.length));
  const beforeCursor = text.slice(0, offset);
  const afterCursor = text.slice(offset);
  dbg(
    "handleEnterInBlock: text=" +
      JSON.stringify(text) +
      " offset=" +
      offset +
      " before=" +
      JSON.stringify(beforeCursor) +
      " after=" +
      JSON.stringify(afterCursor),
  );
  const isList = blockEl.classList.contains("md-block-list");
  const prefix = isList ? getListPrefix(blocks[index].raw) : null;
  if (isList && prefix && text.trim() === "") {
    blocks.splice(index, 1);
    tab.content = blocksToContent(blocks);
    currentTabRef.content = tab.content;
    setCurrentBlocks(blocks);
    if (onShowTabContent) onShowTabContent(tab);
    setTimeout(() => {
      const nextEl = contentEl.querySelector(
        '.md-block[data-block-index="' + index + '"]',
      );
      if (nextEl) startInlineEdit(nextEl, index, currentBlocks, tab, null);
    }, 10);
    return;
  }
  if (prefix) {
    blocks[index].raw = prefix + beforeCursor;
    const newBlock = { raw: prefix + afterCursor, type: "list" };
    blocks.splice(index + 1, 0, newBlock);
  } else {
    blocks[index].raw =
      typeof beforeCursor === "string"
        ? beforeCursor
        : String(beforeCursor || "");
    const newBlock = {
      raw:
        typeof afterCursor === "string"
          ? afterCursor
          : String(afterCursor || ""),
      type: "paragraph",
    };
    blocks.splice(index + 1, 0, newBlock);
  }
  tab.content = blocksToContent(blocks);
  currentTabRef.content = tab.content;
  setCurrentBlocks(blocks);
  dbg(
    "handleEnterInBlock: blocks.length=",
    blocks.length,
    "tab.content=" + JSON.stringify(tab.content),
  );
  requestAnimationFrame(() => {
    try {
      dbg("rAF1: calling showTabContent with", blocks.length, "blocks");
      if (onShowTabContent) onShowTabContent(tab, blocks);
      dbg("rAF1: showTabContent returned");
    } catch (err1) {
      dbg("rAF1 ERROR:", String(err1 && (err1.message || err1)));
      return;
    }
    setTimeout(() => {
      try {
        const allBlocks = contentEl.querySelectorAll(".md-block");
        const indices = [];
        for (let i = 0; i < allBlocks.length; i++)
          indices.push(allBlocks[i].getAttribute("data-block-index"));
        dbg(
          "rAF1: after showTabContent, .md-block count=",
          allBlocks.length,
          "indices=",
          indices.join(","),
        );
      } catch (e) {
        dbg("rAF1 count ERROR:", String(e && (e.message || e)));
      }
      setTimeout(() => {
        try {
          dbg("rAF2/setTimeout: start");
          const newBlockEl = contentEl.querySelector(
            '.md-block[data-block-index="' + (index + 1) + '"]',
          );
          dbg(
            "rAF2/setTimeout: newBlockEl found=",
            !!newBlockEl,
            "query index=",
            index + 1,
          );
          if (newBlockEl) {
            startInlineEdit(newBlockEl, index + 1, currentBlocks, tab, null);
            const edit = newBlockEl.querySelector(".inline-edit");
            dbg("rAF2/setTimeout: .inline-edit found=", !!edit);
            if (edit) {
              edit.focus();
              setCaretPosition(edit, 0);
              dbg(
                "rAF2/setTimeout: after focus activeElement=",
                document.activeElement
                  ? document.activeElement.tagName +
                      (document.activeElement === edit ? " (edit)" : "")
                  : "null",
              );
              setTimeout(() => {
                if (document.activeElement !== edit) {
                  dbg(
                    "setTimeout(0): focus was lost, re-focusing. activeElement=",
                    document.activeElement
                      ? document.activeElement.tagName
                      : "null",
                  );
                  edit.focus();
                  setCaretPosition(edit, 0);
                } else {
                  dbg("setTimeout(0): focus still on edit OK");
                }
              }, 0);
            }
          } else {
            dbg("rAF2/setTimeout: no newBlockEl - cannot open new block");
          }
        } catch (err2) {
          dbg("rAF2/setTimeout ERROR:", String(err2 && (err2.message || err2)));
        }
      }, 0);
    }, 0);
  });
}

// ── Enter key capture listener ────────────────────────────────────────────────
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Enter" && e.keyCode !== 13) return;
    const active = document.activeElement;
    dbg(
      "Enter keydown capture | activeElement:",
      active
        ? active.tagName +
            (active.className
              ? "." + String(active.className).replace(/\s+/g, ".")
              : "")
        : "null",
      "inContent:",
      active ? !!(active.closest && active.closest('.content')) : false,
    );
    if (!active || !(active.closest && active.closest('.content'))) return;
    const editable =
      active.classList && active.classList.contains("inline-edit")
        ? active
        : active.closest(".inline-edit");
    if (!editable) {
      dbg("Enter: no .inline-edit found");
      return;
    }
    const blockEl = editable.closest(".md-block");
    if (!blockEl) {
      dbg("Enter: no .md-block found");
      return;
    }
    if (blockEl.classList.contains("md-block-code")) return;
    const index = parseInt(blockEl.getAttribute("data-block-index"), 10);
    if (isNaN(index) || index < 0) {
      dbg("Enter: bad index", index);
      return;
    }
    dbg("Enter: handling in block index", index);
    e.preventDefault();
    e.stopPropagation();
    handleEnterInBlock(editable, blockEl, index);
  },
  true,
);

// ── Debug keydown logging listener (only active when DEBUG_ENTER = true) ──────
document.addEventListener(
  "keydown",
  (e) => {
    if (!DEBUG_ENTER) return;
    const t = e.target;
    if (t && t.closest && t.closest('.content')) {
      const isEdit =
        t.classList && t.classList.contains("inline-edit")
          ? "YES"
          : t.closest && t.closest(".inline-edit")
            ? "child"
            : "NO";
      const msg =
        "key=" +
        (e.key || e.code) +
        " target=" +
        (t.tagName +
          (t.className ? "." + String(t.className).slice(0, 30) : "")) +
        " inline-edit=" +
        isEdit +
        " active=" +
        (document.activeElement === t
          ? "target"
          : document.activeElement
            ? document.activeElement.tagName
            : "null");
      console.log("[MD key]", msg);
      const el = document.getElementById("debugPanel");
      if (el) {
        const line = document.createElement("div");
        line.className = "debug-line debug-key";
        line.textContent = "[MD key] " + msg;
        el.appendChild(line);
        while (el.children.length > 101)
          el.removeChild(el.children[1]);
        el.scrollTop = el.scrollHeight;
      }
    }
  },
  true,
);

// Register callback so renderer.js can call startInlineEdit without a direct import.
registerStartInlineEdit(startInlineEdit);

// Inline-edit vim o/p: use beforeinput (reliable when keydown isn't) and keydown.
function handleInlineEditVimOP(e) {
  if (!vimMode) return false;
  const editingBlock =
    (e.target && e.target.closest && e.target.closest(".md-block.editing")) ||
    document.querySelector(".md-block.editing");
  if (!editingBlock || typeof editingBlock._vimSync !== "function") return false;
  if (e.type === "beforeinput") {
    if (e.inputType !== "insertText" || e.data == null) return false;
    const key = (e.data.length === 1 ? e.data : "").toLowerCase();
    if (key === "p") {
      const yank = getYank();
      if (yank) {
        e.preventDefault();
        document.execCommand("insertText", false, yank);
        editingBlock._vimSync();
        return true;
      }
    }
    return false;
  }
  // keydown
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const k = (e.key || "").toLowerCase();
  if (k !== "p") return false;
  if (k === "p") {
    const yank = getYank();
    if (yank) {
      e.preventDefault();
      e.stopPropagation();
      document.execCommand("insertText", false, yank);
      editingBlock._vimSync();
      return true;
    }
  }
  return false;
}
document.addEventListener("beforeinput", handleInlineEditVimOP, true);
document.addEventListener("keydown", handleInlineEditVimOP, true);
