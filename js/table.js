import {
  currentBlocks, currentTabRef, _replacingContent,
  setCurrentBlocks, onShowTabContent, markEditDismissed, dblClickEdit,
} from "./state.js";
import { blockRaw, blocksToContent } from "./blocks.js";
import { saveToFile, pushUndo } from "./fileio.js";
import { isOpen as isSearchOpen } from "./search.js";

// ── Pure table model: parse / serialise GFM tables ────────────────────────────
// A table model is { header: [string], align: [""|"left"|"center"|"right"], rows: [[string]] }.
// Cell strings are the *logical* Markdown source with escaped pipes (`\|`) decoded
// to plain `|`; serialisation re-escapes them so the round-trip is lossless.

/** Split one Markdown table row into trimmed cell strings, decoding escaped pipes. */
export function splitTableRow(line) {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "\\" && inner[i + 1] === "|") {
      current += "|";
      i++;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseAlignment(cell) {
  const c = cell.trim();
  const hasLeft = c.startsWith(":");
  const hasRight = c.endsWith(":");
  if (hasLeft && hasRight) return "center";
  if (hasRight) return "right";
  if (hasLeft) return "left";
  return "";
}

/** Parse raw GFM table Markdown into a model, or null if it is not a table. */
export function parseTable(raw) {
  const lines = String(raw).split("\n").filter((line) => line.trim() !== "");
  if (lines.length < 2) return null;
  const header = splitTableRow(lines[0]);
  const align = splitTableRow(lines[1]).map(parseAlignment);
  const rows = lines.slice(2).map(splitTableRow);
  return { header, align, rows };
}

function escapeCell(value) {
  return String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function alignMarker(align) {
  if (align === "center") return ":---:";
  if (align === "right") return "---:";
  if (align === "left") return ":---";
  return "---";
}

function padRow(cells, columnCount) {
  const out = cells.slice(0, columnCount);
  while (out.length < columnCount) out.push("");
  return out;
}

/** Serialise a table model back into GFM Markdown. */
export function serializeTable(model) {
  const columnCount = model.header.length;
  const toLine = (cells) => "| " + padRow(cells, columnCount).map(escapeCell).join(" | ") + " |";
  const headerLine = toLine(model.header);
  const alignLine = "| " + padRow(model.align, columnCount).map(alignMarker).join(" | ") + " |";
  const bodyLines = model.rows.map(toLine);
  return [headerLine, alignLine, ...bodyLines].join("\n");
}

/** Logical Markdown source of a single cell (section: "header" | "body"). */
export function getTableCellRaw(raw, section, rowIndex, columnIndex) {
  const model = parseTable(raw);
  if (!model) return "";
  if (section === "header") return model.header[columnIndex] || "";
  const row = model.rows[rowIndex];
  return (row && row[columnIndex]) || "";
}

/** Return new table Markdown with one cell replaced; unchanged raw if out of range. */
export function updateTableCell(raw, section, rowIndex, columnIndex, value) {
  const model = parseTable(raw);
  if (!model) return raw;
  if (columnIndex < 0 || columnIndex >= model.header.length) return raw;
  if (section === "header") {
    model.header[columnIndex] = value;
  } else {
    const row = model.rows[rowIndex];
    if (!row) return raw;
    while (row.length <= columnIndex) row.push("");
    row[columnIndex] = value;
  }
  return serializeTable(model);
}

/** Return new table Markdown with a blank body row inserted above/below rowIndex. */
export function addRow(raw, rowIndex, position) {
  const model = parseTable(raw);
  if (!model) return raw;
  const at = position === "above" ? rowIndex : rowIndex + 1;
  const clamped = Math.max(0, Math.min(at, model.rows.length));
  model.rows.splice(clamped, 0, model.header.map(() => ""));
  return serializeTable(model);
}

/** Return new table Markdown with a blank column inserted left/right of columnIndex. */
export function addColumn(raw, columnIndex, position) {
  const model = parseTable(raw);
  if (!model) return raw;
  const columnCount = model.header.length;
  const at = Math.max(0, Math.min(position === "left" ? columnIndex : columnIndex + 1, columnCount));
  model.header.splice(at, 0, "");
  model.align.splice(at, 0, "");
  model.rows.forEach((row) => {
    while (row.length < columnCount) row.push("");
    row.splice(at, 0, "");
  });
  return serializeTable(model);
}

/** Markdown for a blank table with the given number of columns and body rows. */
export function buildEmptyTable(columns, bodyRows) {
  const blankCells = () => Array(columns).fill("");
  return serializeTable({
    header: blankCells(),
    align: blankCells(),
    rows: Array.from({ length: bodyRows }, blankCells),
  });
}

/** Return new table Markdown with the body row at rowIndex removed. */
export function deleteRow(raw, rowIndex) {
  const model = parseTable(raw);
  if (!model) return raw;
  if (rowIndex < 0 || rowIndex >= model.rows.length) return raw;
  model.rows.splice(rowIndex, 1);
  return serializeTable(model);
}

/** Return new table Markdown with the column at columnIndex removed (keeps at least one column). */
export function deleteColumn(raw, columnIndex) {
  const model = parseTable(raw);
  if (!model) return raw;
  if (columnIndex < 0 || columnIndex >= model.header.length) return raw;
  if (model.header.length <= 1) return raw;
  model.header.splice(columnIndex, 1);
  model.align.splice(columnIndex, 1);
  model.rows.forEach((row) => row.splice(columnIndex, 1));
  return serializeTable(model);
}

/** Return new table Markdown with a body row moved from one index to another. */
export function moveRow(raw, fromIndex, toIndex) {
  const model = parseTable(raw);
  if (!model) return raw;
  const lastIndex = model.rows.length - 1;
  if (fromIndex < 0 || fromIndex > lastIndex) return raw;
  if (toIndex < 0 || toIndex > lastIndex) return raw;
  if (fromIndex === toIndex) return raw;
  const [moved] = model.rows.splice(fromIndex, 1);
  model.rows.splice(toIndex, 0, moved);
  return serializeTable(model);
}

// ── DOM wiring: edit a rendered table cell in place ───────────────────────────

function cellCoordinates(cellEl) {
  const rowEl = cellEl.parentElement;
  const columnIndex = Array.prototype.indexOf.call(rowEl.children, cellEl);
  if (cellEl.tagName === "TH") return { section: "header", rowIndex: -1, columnIndex };
  const bodyEl = rowEl.parentElement;
  const rowIndex = Array.prototype.indexOf.call(bodyEl.children, rowEl);
  return { section: "body", rowIndex, columnIndex };
}

function renderCellHtml(value) {
  return value.trim() === "" ? "" : marked.parseInline(value);
}

function placeCaretAtEnd(el) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function editableCells(tableBlockEl) {
  return Array.from(tableBlockEl.querySelectorAll("th, td"));
}

function bodyRows(tableBlockEl) {
  return Array.from(tableBlockEl.querySelectorAll("tbody tr"));
}

/** Persist a new blocks array to the tab and autosave. */
function writeBlocks(tab, blocks) {
  tab.content = blocksToContent(blocks);
  currentTabRef.content = tab.content;
  setCurrentBlocks(blocks);
  saveToFile(tab);
}

/** Write a block's new raw Markdown, autosave, and optionally re-render the document. */
function applyTableRaw(index, tab, newRaw, reRender) {
  const blocks = currentBlocks.slice();
  blocks[index] = { ...blocks[index], raw: newRaw };
  writeBlocks(tab, blocks);
  if (reRender && onShowTabContent) onShowTabContent(tab);
}

const DEFAULT_TABLE_COLUMNS = 2;
const DEFAULT_TABLE_BODY_ROWS = 2;

/** Insert a blank table after the given block index (or at the end when null). */
function insertTable(afterIndex) {
  const tab = currentTabRef;
  if (!tab) return;
  pushUndo(tab);
  const blocks = currentBlocks.slice();
  const at = afterIndex == null ? blocks.length : Math.min(afterIndex + 1, blocks.length);
  blocks.splice(at, 0, {
    type: "table",
    raw: buildEmptyTable(DEFAULT_TABLE_COLUMNS, DEFAULT_TABLE_BODY_ROWS),
  });
  writeBlocks(tab, blocks);
  if (onShowTabContent) onShowTabContent(tab);
}

/** Remove the table block at the given index from the document. */
function deleteTable(index) {
  const tab = currentTabRef;
  if (!tab || index == null || index >= currentBlocks.length) return;
  pushUndo(tab);
  const blocks = currentBlocks.slice();
  blocks.splice(index, 1);
  writeBlocks(tab, blocks);
  if (onShowTabContent) onShowTabContent(tab);
}

function startCellEdit(cellEl, tableBlockEl, index, tab) {
  if (cellEl.classList.contains("editing")) return;
  if (index >= currentBlocks.length) return;
  pushUndo(tab);
  const { section, rowIndex, columnIndex } = cellCoordinates(cellEl);
  cellEl.classList.add("editing");
  cellEl.contentEditable = "true";
  cellEl.textContent = getTableCellRaw(blockRaw(currentBlocks[index]), section, rowIndex, columnIndex);
  placeCaretAtEnd(cellEl);

  let committed = false;
  function commit() {
    if (committed) return;
    committed = true;
    cellEl.removeEventListener("blur", commit);
    cellEl.contentEditable = "false";
    cellEl.classList.remove("editing");
    const value = (cellEl.textContent || "").replace(/\u00a0/g, " ");
    cellEl.innerHTML = renderCellHtml(value);
    markEditDismissed();
    if (_replacingContent || index >= currentBlocks.length) return;
    const newRaw = updateTableCell(blockRaw(currentBlocks[index]), section, rowIndex, columnIndex, value);
    applyTableRaw(index, tab, newRaw, false);
  }

  cellEl.addEventListener("blur", commit);
  cellEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      commit();
      cellEl.blur();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const cells = editableCells(tableBlockEl);
      const nextIndex = cells.indexOf(cellEl) + (e.shiftKey ? -1 : 1);
      commit();
      if (nextIndex >= 0 && nextIndex < cells.length) {
        startCellEdit(cells[nextIndex], tableBlockEl, index, tab);
      }
    }
  }, true);
}

// ── Drag a body row by its handle to reorder (pointer-based) ──────────────────
// HTML5 drag-and-drop is unreliable inside the webview and the absolutely
// positioned handles overlap rows, so reordering uses mouse events directly.

/**
 * Insertion gap for a drop at vertical position y: 0 = before the first row,
 * rows.length = after the last row. Uses each row's midpoint as the boundary.
 */
export function rowDropGap(rowMidpoints, y) {
  for (let i = 0; i < rowMidpoints.length; i++) {
    if (y < rowMidpoints[i]) return i;
  }
  return rowMidpoints.length;
}

let activeRowDrag = null;

/** Align each handle vertically with its row (handles live in the block's left gutter). */
function positionRowHandles(tableBlockEl) {
  const blockTop = tableBlockEl.getBoundingClientRect().top;
  const rows = bodyRows(tableBlockEl);
  const handles = tableBlockEl.querySelectorAll(".table-row-handle");
  rows.forEach((rowEl, i) => {
    const handle = handles[i];
    const rect = rowEl.getBoundingClientRect();
    handle.style.top = rect.top - blockTop + "px";
    handle.style.height = rect.height + "px";
  });
}

/** Mark the insertion gap: a top border before rows[gap], or a bottom border after the last row. */
function highlightDropGap(rows, gap) {
  rows.forEach((rowEl) =>
    rowEl.classList.remove("table-row-drop-target", "table-row-drop-target-bottom"));
  if (gap < rows.length) rows[gap].classList.add("table-row-drop-target");
  else rows[rows.length - 1].classList.add("table-row-drop-target-bottom");
}

function rowMidpoints(rows) {
  return rows.map((rowEl) => {
    const rect = rowEl.getBoundingClientRect();
    return (rect.top + rect.bottom) / 2;
  });
}

function onRowDragMove(e) {
  if (!activeRowDrag) return;
  const { rows } = activeRowDrag;
  activeRowDrag.gap = rowDropGap(rowMidpoints(rows), e.clientY);
  highlightDropGap(rows, activeRowDrag.gap);
}

function onRowDragEnd() {
  const drag = activeRowDrag;
  if (!drag) return;
  activeRowDrag = null;
  drag.rows.forEach((rowEl) =>
    rowEl.classList.remove("table-row-dragging", "table-row-drop-target", "table-row-drop-target-bottom"));
  const { index, tab, fromIndex, gap } = drag;
  // Dropping into its own slot (the gap just above or below the row) is a no-op.
  if (gap === fromIndex || gap === fromIndex + 1 || index >= currentBlocks.length) return;
  const toIndex = gap > fromIndex ? gap - 1 : gap;
  pushUndo(tab);
  applyTableRaw(index, tab, moveRow(blockRaw(currentBlocks[index]), fromIndex, toIndex), true);
}

document.addEventListener("mousemove", onRowDragMove);
document.addEventListener("mouseup", onRowDragEnd);

function startRowDrag(e, tableBlockEl, index, tab, fromIndex) {
  e.preventDefault();
  const rows = bodyRows(tableBlockEl);
  activeRowDrag = { tableBlockEl, index, tab, fromIndex, gap: fromIndex, rows };
  rows[fromIndex].classList.add("table-row-dragging");
}

function wireRowDragging(tableBlockEl, index, tab) {
  bodyRows(tableBlockEl).forEach((rowEl, rowIndex) => {
    const handle = document.createElement("span");
    handle.className = "table-row-handle";
    handle.setAttribute("aria-label", "Drag to reorder row");
    handle.textContent = "⠿";
    tableBlockEl.appendChild(handle);
    handle.addEventListener("mousedown", (e) =>
      startRowDrag(e, tableBlockEl, index, tab, rowIndex));
  });
  positionRowHandles(tableBlockEl);
  tableBlockEl.addEventListener("mouseenter", () => positionRowHandles(tableBlockEl));
}

/** Wire double-click-to-edit, per-cell context menu, and row reordering on a table block. */
export function wireTableEditing(tableBlockEl, index, tab) {
  editableCells(tableBlockEl).forEach((cellEl) => {
    cellEl.addEventListener("dblclick", (e) => {
      if (!dblClickEdit || isSearchOpen()) return;
      e.stopPropagation();
      startCellEdit(cellEl, tableBlockEl, index, tab);
    });
  });
  wireRowDragging(tableBlockEl, index, tab);
}

// ── Right-click context menu ──────────────────────────────────────────────────
// On a table cell: insert/delete rows and columns. Elsewhere in a rendered
// document: insert a new table.

let menuTarget = null;

function applyMenuChange(buildRaw) {
  const target = menuTarget;
  const tab = currentTabRef;
  if (!target || !tab || target.blockIndex >= currentBlocks.length) return;
  pushUndo(tab);
  const newRaw = buildRaw(blockRaw(currentBlocks[target.blockIndex]), target);
  applyTableRaw(target.blockIndex, tab, newRaw, true);
}

const tableMenu = (() => {
  const el = document.createElement("div");
  el.className = "context-menu table-context-menu";
  el.setAttribute("role", "menu");

  const cellGroup = document.createElement("div");
  const insertGroup = document.createElement("div");

  const addItem = (parent, label, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
      hideTableMenu();
    });
    parent.appendChild(button);
    return button;
  };

  const rowAboveButton = addItem(cellGroup, "Insert row above", () =>
    applyMenuChange((raw, t) => addRow(raw, t.rowIndex, "above")));
  addItem(cellGroup, "Insert row below", () =>
    applyMenuChange((raw, t) => addRow(raw, t.rowIndex, "below")));
  addItem(cellGroup, "Insert column left", () =>
    applyMenuChange((raw, t) => addColumn(raw, t.columnIndex, "left")));
  addItem(cellGroup, "Insert column right", () =>
    applyMenuChange((raw, t) => addColumn(raw, t.columnIndex, "right")));
  const deleteRowButton = addItem(cellGroup, "Delete row", () =>
    applyMenuChange((raw, t) => deleteRow(raw, t.rowIndex)));
  addItem(cellGroup, "Delete column", () =>
    applyMenuChange((raw, t) => deleteColumn(raw, t.columnIndex)));
  addItem(cellGroup, "Delete table", () =>
    deleteTable(menuTarget && menuTarget.blockIndex));

  addItem(insertGroup, "Insert table", () => insertTable(menuTarget && menuTarget.afterIndex));

  el.appendChild(cellGroup);
  el.appendChild(insertGroup);
  el._cellGroup = cellGroup;
  el._insertGroup = insertGroup;
  el._rowAboveButton = rowAboveButton;
  el._deleteRowButton = deleteRowButton;
  document.body.appendChild(el);
  return el;
})();

function hideTableMenu() {
  tableMenu.style.display = "none";
  menuTarget = null;
}

function showTableMenuAt(x, y) {
  tableMenu.style.display = "block";
  const width = tableMenu.offsetWidth || 180;
  const height = tableMenu.offsetHeight || 170;
  tableMenu.style.left = Math.min(x, window.innerWidth - width - 8) + "px";
  tableMenu.style.top = Math.min(y, window.innerHeight - height - 8) + "px";
}

function showCellMenu(e, tableBlockEl, blockIndex) {
  e.preventDefault();
  e.stopImmediatePropagation();
  const cell = e.target.closest("th, td");
  const { section, rowIndex, columnIndex } = cellCoordinates(cell);
  menuTarget = { blockIndex, section, rowIndex, columnIndex };
  tableMenu._cellGroup.style.display = "block";
  tableMenu._insertGroup.style.display = "none";
  const rowItemDisplay = section === "header" ? "none" : "block";
  tableMenu._rowAboveButton.style.display = rowItemDisplay;
  tableMenu._deleteRowButton.style.display = rowItemDisplay;
  showTableMenuAt(e.clientX, e.clientY);
}

function showInsertMenu(e) {
  e.preventDefault();
  e.stopImmediatePropagation();
  const blockEl = e.target.closest(".md-block");
  const afterIndex = blockEl ? parseInt(blockEl.getAttribute("data-block-index"), 10) : null;
  menuTarget = { afterIndex: Number.isNaN(afterIndex) ? null : afterIndex };
  tableMenu._cellGroup.style.display = "none";
  tableMenu._insertGroup.style.display = "block";
  showTableMenuAt(e.clientX, e.clientY);
}

document.addEventListener("contextmenu", (e) => {
  if (!e.target.closest) return;
  const cell = e.target.closest("th, td");
  const tableBlockEl = cell && cell.closest(".md-block-table");
  if (tableBlockEl && tableBlockEl.closest(".content")) {
    const blockIndex = parseInt(tableBlockEl.getAttribute("data-block-index"), 10);
    if (isNaN(blockIndex) || blockIndex < 0 || blockIndex >= currentBlocks.length) {
      hideTableMenu();
      return;
    }
    showCellMenu(e, tableBlockEl, blockIndex);
    return;
  }
  // Off-table right-click inside a rendered document → offer to insert a table,
  // unless there is a text selection (that case belongs to the copy/link menu).
  const hasSelection = window.getSelection() && window.getSelection().toString().length > 0;
  if (e.target.closest(".rendered") && currentTabRef && !hasSelection) {
    showInsertMenu(e);
    return;
  }
  hideTableMenu();
}, true);

document.addEventListener("click", (e) => {
  if (!tableMenu.contains(e.target)) hideTableMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideTableMenu();
});
