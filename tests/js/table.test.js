import { describe, it, expect, beforeEach, vi } from "vitest";

// state.js reads these DOM nodes at import time.
document.body.innerHTML = `
  <div id="content-primary" class="content"></div>
  <div id="filename"></div>
  <ul id="tree"></ul>
`;

window.pywebview = { api: { write_file: vi.fn(() => Promise.resolve({})) } };

const {
  splitTableRow,
  parseTable,
  serializeTable,
  getTableCellRaw,
  updateTableCell,
  addRow,
  addColumn,
  deleteRow,
  deleteColumn,
  moveRow,
  rowDropGap,
  buildEmptyTable,
  wireTableEditing,
} = await import("../../js/table.js");
const { setCurrentBlocks, setCurrentTabRef } = await import("../../js/state.js");

const SAMPLE = "| Name | Age |\n| :--- | ---: |\n| Ann | 30 |\n| Bob | 25 |";

// ── splitTableRow ─────────────────────────────────────────────────────────────

describe("splitTableRow", () => {
  it("splits cells and trims whitespace", () => {
    expect(splitTableRow("| Name | Age |")).toEqual(["Name", "Age"]);
  });

  it("handles rows without leading/trailing pipes", () => {
    expect(splitTableRow("a | b | c")).toEqual(["a", "b", "c"]);
  });

  it("decodes escaped pipes into literal pipes", () => {
    expect(splitTableRow("| a \\| b | c |")).toEqual(["a | b", "c"]);
  });

  it("returns a single empty cell for an empty row", () => {
    expect(splitTableRow("")).toEqual([""]);
  });
});

// ── parseTable ────────────────────────────────────────────────────────────────

describe("parseTable", () => {
  it("returns null when there are fewer than two lines", () => {
    expect(parseTable("| only header |")).toBeNull();
  });

  it("parses header, alignment, and body rows", () => {
    const model = parseTable(SAMPLE);
    expect(model.header).toEqual(["Name", "Age"]);
    expect(model.align).toEqual(["left", "right"]);
    expect(model.rows).toEqual([["Ann", "30"], ["Bob", "25"]]);
  });

  it("parses centre alignment", () => {
    const model = parseTable("| H |\n| :---: |\n| x |");
    expect(model.align).toEqual(["center"]);
  });

  it("parses default (no) alignment", () => {
    const model = parseTable("| H |\n| --- |\n| x |");
    expect(model.align).toEqual([""]);
  });

  it("ignores blank lines between rows", () => {
    const model = parseTable("| H |\n| --- |\n\n| x |\n");
    expect(model.rows).toEqual([["x"]]);
  });
});

// ── serializeTable ────────────────────────────────────────────────────────────

describe("serializeTable", () => {
  it("round-trips a parsed table", () => {
    expect(serializeTable(parseTable(SAMPLE))).toBe(SAMPLE);
  });

  it("escapes pipes inside cells", () => {
    const md = serializeTable({ header: ["a | b"], align: [""], rows: [] });
    expect(md).toBe("| a \\| b |\n| --- |");
  });

  it("renders every alignment marker", () => {
    const md = serializeTable({
      header: ["a", "b", "c", "d"],
      align: ["left", "center", "right", ""],
      rows: [],
    });
    expect(md.split("\n")[1]).toBe("| :--- | :---: | ---: | --- |");
  });

  it("pads short body rows to the header width", () => {
    const md = serializeTable({ header: ["a", "b"], align: ["", ""], rows: [["x"]] });
    expect(md.split("\n")[2]).toBe("| x |  |");
  });

  it("truncates over-long body rows to the header width", () => {
    const md = serializeTable({ header: ["a"], align: [""], rows: [["x", "y"]] });
    expect(md.split("\n")[2]).toBe("| x |");
  });

  it("collapses newlines inside a cell to a space", () => {
    const md = serializeTable({ header: ["a\nb"], align: [""], rows: [] });
    expect(md.split("\n")[0]).toBe("| a b |");
  });
});

// ── getTableCellRaw ───────────────────────────────────────────────────────────

describe("getTableCellRaw", () => {
  it("reads a header cell", () => {
    expect(getTableCellRaw(SAMPLE, "header", -1, 1)).toBe("Age");
  });

  it("reads a body cell", () => {
    expect(getTableCellRaw(SAMPLE, "body", 1, 0)).toBe("Bob");
  });

  it("returns empty string for a non-table", () => {
    expect(getTableCellRaw("not a table", "header", -1, 0)).toBe("");
  });

  it("returns empty string for a missing body cell", () => {
    expect(getTableCellRaw(SAMPLE, "body", 9, 0)).toBe("");
  });
});

// ── updateTableCell ───────────────────────────────────────────────────────────

describe("updateTableCell", () => {
  it("replaces a header cell", () => {
    const md = updateTableCell(SAMPLE, "header", -1, 0, "Full Name");
    expect(parseTable(md).header).toEqual(["Full Name", "Age"]);
  });

  it("replaces a body cell", () => {
    const md = updateTableCell(SAMPLE, "body", 0, 1, "31");
    expect(parseTable(md).rows[0]).toEqual(["Ann", "31"]);
  });

  it("leaves raw unchanged for a non-table", () => {
    expect(updateTableCell("nope", "header", -1, 0, "x")).toBe("nope");
  });

  it("leaves raw unchanged for an out-of-range column", () => {
    expect(updateTableCell(SAMPLE, "header", -1, 9, "x")).toBe(SAMPLE);
  });

  it("leaves raw unchanged for a missing body row", () => {
    expect(updateTableCell(SAMPLE, "body", 9, 0, "x")).toBe(SAMPLE);
  });

  it("extends a short body row to reach the target column", () => {
    const md = updateTableCell("| a | b |\n| - | - |\n| x |", "body", 0, 1, "y");
    expect(parseTable(md).rows[0]).toEqual(["x", "y"]);
  });
});

// ── addRow ────────────────────────────────────────────────────────────────────

describe("addRow", () => {
  it("inserts a blank row below the given body row", () => {
    const model = parseTable(addRow(SAMPLE, 0, "below"));
    expect(model.rows).toEqual([["Ann", "30"], ["", ""], ["Bob", "25"]]);
  });

  it("inserts a blank row above the given body row", () => {
    const model = parseTable(addRow(SAMPLE, 1, "above"));
    expect(model.rows).toEqual([["Ann", "30"], ["", ""], ["Bob", "25"]]);
  });

  it("inserts at body start when adding below the header (rowIndex -1)", () => {
    const model = parseTable(addRow(SAMPLE, -1, "below"));
    expect(model.rows[0]).toEqual(["", ""]);
  });

  it("leaves raw unchanged for a non-table", () => {
    expect(addRow("nope", 0, "below")).toBe("nope");
  });
});

// ── addColumn ─────────────────────────────────────────────────────────────────

describe("addColumn", () => {
  it("inserts a blank column to the right", () => {
    const model = parseTable(addColumn(SAMPLE, 0, "right"));
    expect(model.header).toEqual(["Name", "", "Age"]);
    expect(model.align).toEqual(["left", "", "right"]);
    expect(model.rows[0]).toEqual(["Ann", "", "30"]);
  });

  it("inserts a blank column to the left", () => {
    const model = parseTable(addColumn(SAMPLE, 0, "left"));
    expect(model.header).toEqual(["", "Name", "Age"]);
    expect(model.rows[1]).toEqual(["", "Bob", "25"]);
  });

  it("pads short rows before inserting the column", () => {
    const model = parseTable(addColumn("| a | b |\n| - | - |\n| x |", 1, "right"));
    expect(model.rows[0]).toEqual(["x", "", ""]);
  });

  it("leaves raw unchanged for a non-table", () => {
    expect(addColumn("nope", 0, "right")).toBe("nope");
  });
});

// ── moveRow ───────────────────────────────────────────────────────────────────

describe("moveRow", () => {
  const THREE = "| H |\n| --- |\n| a |\n| b |\n| c |";

  it("moves a row down", () => {
    expect(parseTable(moveRow(THREE, 0, 2)).rows).toEqual([["b"], ["c"], ["a"]]);
  });

  it("moves a row up", () => {
    expect(parseTable(moveRow(THREE, 2, 0)).rows).toEqual([["c"], ["a"], ["b"]]);
  });

  it("is a no-op when source equals target", () => {
    expect(moveRow(THREE, 1, 1)).toBe(THREE);
  });

  it("leaves raw unchanged for an out-of-range source", () => {
    expect(moveRow(THREE, 9, 0)).toBe(THREE);
  });

  it("leaves raw unchanged for an out-of-range target", () => {
    expect(moveRow(THREE, 0, 9)).toBe(THREE);
  });

  it("leaves raw unchanged for a non-table", () => {
    expect(moveRow("nope", 0, 1)).toBe("nope");
  });
});

// ── buildEmptyTable ───────────────────────────────────────────────────────────

describe("buildEmptyTable", () => {
  it("builds a parseable table with the given dimensions", () => {
    const model = parseTable(buildEmptyTable(3, 2));
    expect(model.header).toEqual(["", "", ""]);
    expect(model.align).toEqual(["", "", ""]);
    expect(model.rows).toEqual([["", "", ""], ["", "", ""]]);
  });

  it("can build a header-only table", () => {
    expect(parseTable(buildEmptyTable(2, 0)).rows).toEqual([]);
  });
});

// ── deleteRow ─────────────────────────────────────────────────────────────────

describe("deleteRow", () => {
  it("removes the body row at the given index", () => {
    expect(parseTable(deleteRow(SAMPLE, 0)).rows).toEqual([["Bob", "25"]]);
  });

  it("can remove the last remaining body row", () => {
    expect(parseTable(deleteRow("| H |\n| --- |\n| a |", 0)).rows).toEqual([]);
  });

  it("leaves raw unchanged for an out-of-range row", () => {
    expect(deleteRow(SAMPLE, 9)).toBe(SAMPLE);
  });

  it("leaves raw unchanged for a header (rowIndex -1)", () => {
    expect(deleteRow(SAMPLE, -1)).toBe(SAMPLE);
  });

  it("leaves raw unchanged for a non-table", () => {
    expect(deleteRow("nope", 0)).toBe("nope");
  });
});

// ── deleteColumn ──────────────────────────────────────────────────────────────

describe("deleteColumn", () => {
  it("removes the column from header, alignment, and every row", () => {
    const model = parseTable(deleteColumn(SAMPLE, 0));
    expect(model.header).toEqual(["Age"]);
    expect(model.align).toEqual(["right"]);
    expect(model.rows).toEqual([["30"], ["25"]]);
  });

  it("removes a middle column", () => {
    const three = "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |";
    expect(parseTable(deleteColumn(three, 1)).rows).toEqual([["1", "3"]]);
  });

  it("refuses to remove the only column", () => {
    const oneCol = "| a |\n| - |\n| 1 |";
    expect(deleteColumn(oneCol, 0)).toBe(oneCol);
  });

  it("leaves raw unchanged for an out-of-range column", () => {
    expect(deleteColumn(SAMPLE, 9)).toBe(SAMPLE);
  });

  it("leaves raw unchanged for a non-table", () => {
    expect(deleteColumn("nope", 0)).toBe("nope");
  });
});

// ── wireTableEditing (DOM integration) ────────────────────────────────────────

function renderTableBlock(raw) {
  const contentEl = document.getElementById("content-primary");
  contentEl.innerHTML =
    '<div class="rendered"><div class="md-block md-block-table" data-block-index="0">' +
    marked.parse(raw) +
    "</div></div>";
  return contentEl.querySelector(".md-block-table");
}

function dblclick(el) {
  el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
}

describe("wireTableEditing", () => {
  let tab;
  let tableEl;

  beforeEach(() => {
    tab = { content: SAMPLE, _undoStack: [], _redoStack: [] };
    setCurrentBlocks([{ type: "table", raw: SAMPLE }]);
    setCurrentTabRef(tab);
    tableEl = renderTableBlock(SAMPLE);
    wireTableEditing(tableEl, 0, tab);
  });

  it("makes a body cell editable showing its Markdown source on double-click", () => {
    const cell = tableEl.querySelectorAll("tbody td")[0];
    dblclick(cell);
    expect(cell.contentEditable).toBe("true");
    expect(cell.classList.contains("editing")).toBe(true);
    expect(cell.textContent).toBe("Ann");
  });

  it("commits an edited body cell back into the block on blur", async () => {
    const cell = tableEl.querySelectorAll("tbody td")[0];
    dblclick(cell);
    cell.textContent = "Annette";
    cell.dispatchEvent(new FocusEvent("blur"));
    const { currentBlocks } = await import("../../js/state.js");
    expect(parseTable(currentBlocks[0].raw).rows[0]).toEqual(["Annette", "30"]);
    expect(cell.contentEditable).toBe("false");
  });

  it("commits an edited header cell back into the block", async () => {
    const cell = tableEl.querySelector("thead th");
    dblclick(cell);
    cell.textContent = "Person";
    cell.dispatchEvent(new FocusEvent("blur"));
    const { currentBlocks } = await import("../../js/state.js");
    expect(parseTable(currentBlocks[0].raw).header[0]).toBe("Person");
  });

  it("renders inline Markdown after commit", () => {
    const cell = tableEl.querySelectorAll("tbody td")[0];
    dblclick(cell);
    cell.textContent = "**bold**";
    cell.dispatchEvent(new FocusEvent("blur"));
    expect(cell.querySelector("strong")).not.toBeNull();
  });

  it("leaves an emptied cell with no rendered content", () => {
    const cell = tableEl.querySelectorAll("tbody td")[0];
    dblclick(cell);
    cell.textContent = "";
    cell.dispatchEvent(new FocusEvent("blur"));
    expect(cell.innerHTML).toBe("");
  });

  it("commits on Enter without inserting a newline", () => {
    const cell = tableEl.querySelectorAll("tbody td")[0];
    dblclick(cell);
    const prevented = !cell.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(prevented).toBe(true);
    expect(cell.contentEditable).toBe("false");
  });

  it("Tab commits and advances to the next cell", () => {
    const firstHeader = tableEl.querySelector("thead th");
    dblclick(firstHeader);
    firstHeader.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
    const secondHeader = tableEl.querySelectorAll("thead th")[1];
    expect(firstHeader.contentEditable).toBe("false");
    expect(secondHeader.contentEditable).toBe("true");
  });

  it("Shift+Tab moves to the previous cell", () => {
    const secondHeader = tableEl.querySelectorAll("thead th")[1];
    dblclick(secondHeader);
    secondHeader.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
    );
    const firstHeader = tableEl.querySelector("thead th");
    expect(firstHeader.contentEditable).toBe("true");
  });

  it("does not start editing when double-click editing is disabled", async () => {
    const { setDblClickEdit } = await import("../../js/state.js");
    setDblClickEdit(false);
    const cell = tableEl.querySelectorAll("tbody td")[0];
    dblclick(cell);
    expect(cell.contentEditable).not.toBe("true");
    setDblClickEdit(true);
  });

  it("ignores a second double-click on a cell already being edited", () => {
    const cell = tableEl.querySelectorAll("tbody td")[0];
    dblclick(cell);
    cell.textContent = "edited";
    dblclick(cell);
    expect(cell.textContent).toBe("edited");
  });

  it("does not start editing when the block no longer exists", () => {
    setCurrentBlocks([]);
    const cell = tableEl.querySelectorAll("tbody td")[0];
    dblclick(cell);
    expect(cell.contentEditable).not.toBe("true");
  });

  it("commits only once even if Enter is pressed again", async () => {
    const cell = tableEl.querySelectorAll("tbody td")[0];
    dblclick(cell);
    const enter = () => cell.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    enter();
    cell.textContent = "ignored after commit";
    enter();
    const { currentBlocks } = await import("../../js/state.js");
    expect(parseTable(currentBlocks[0].raw).rows[0]).toEqual(["Ann", "30"]);
  });

  it("does not write back when the block is gone on commit", () => {
    const cell = tableEl.querySelectorAll("tbody td")[0];
    dblclick(cell);
    cell.textContent = "orphaned";
    setCurrentBlocks([]);
    cell.dispatchEvent(new FocusEvent("blur"));
    expect(cell.contentEditable).toBe("false");
  });
});

describe("getTableCellRaw — header out of range", () => {
  it("returns empty string for a missing header cell", () => {
    expect(getTableCellRaw(SAMPLE, "header", -1, 9)).toBe("");
  });
});

// ── context menu: insert rows and columns ─────────────────────────────────────

function contextMenuOn(el) {
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 }));
}

function menuButton(label) {
  const menu = document.querySelector(".table-context-menu");
  return Array.from(menu.querySelectorAll("button")).find((b) => b.textContent === label);
}

describe("table context menu", () => {
  let tab;
  let tableEl;

  beforeEach(() => {
    tab = { content: SAMPLE, _undoStack: [], _redoStack: [] };
    setCurrentBlocks([{ type: "table", raw: SAMPLE }]);
    setCurrentTabRef(tab);
    tableEl = renderTableBlock(SAMPLE);
    wireTableEditing(tableEl, 0, tab);
  });

  it("opens on right-click of a cell", () => {
    contextMenuOn(tableEl.querySelector("tbody td"));
    expect(document.querySelector(".table-context-menu").style.display).toBe("block");
  });

  it("hides the 'insert row above' item for a header cell", () => {
    contextMenuOn(tableEl.querySelector("thead th"));
    expect(menuButton("Insert row above").style.display).toBe("none");
  });

  it("shows the 'insert row above' item for a body cell", () => {
    contextMenuOn(tableEl.querySelectorAll("tbody td")[0]);
    expect(menuButton("Insert row above").style.display).toBe("block");
  });

  it("inserts a row below the clicked body row", async () => {
    contextMenuOn(tableEl.querySelectorAll("tbody tr")[0].querySelector("td"));
    menuButton("Insert row below").click();
    const { currentBlocks } = await import("../../js/state.js");
    expect(parseTable(currentBlocks[0].raw).rows).toEqual([["Ann", "30"], ["", ""], ["Bob", "25"]]);
  });

  it("inserts a column to the right of the clicked cell", async () => {
    contextMenuOn(tableEl.querySelectorAll("tbody td")[0]);
    menuButton("Insert column right").click();
    const { currentBlocks } = await import("../../js/state.js");
    expect(parseTable(currentBlocks[0].raw).header).toEqual(["Name", "", "Age"]);
  });

  it("deletes the clicked body row", async () => {
    contextMenuOn(tableEl.querySelectorAll("tbody tr")[0].querySelector("td"));
    menuButton("Delete row").click();
    const { currentBlocks } = await import("../../js/state.js");
    expect(parseTable(currentBlocks[0].raw).rows).toEqual([["Bob", "25"]]);
  });

  it("deletes the clicked column", async () => {
    contextMenuOn(tableEl.querySelectorAll("tbody td")[0]);
    menuButton("Delete column").click();
    const { currentBlocks } = await import("../../js/state.js");
    expect(parseTable(currentBlocks[0].raw).header).toEqual(["Age"]);
  });

  it("deletes the whole table", async () => {
    contextMenuOn(tableEl.querySelector("tbody td"));
    menuButton("Delete table").click();
    const { currentBlocks } = await import("../../js/state.js");
    expect(currentBlocks).toHaveLength(0);
  });

  it("does not delete the table when the document is closed", async () => {
    contextMenuOn(tableEl.querySelector("tbody td"));
    setCurrentTabRef(null);
    menuButton("Delete table").click();
    const { currentBlocks } = await import("../../js/state.js");
    expect(currentBlocks).toHaveLength(1);
  });

  it("re-renders the document after deleting the table", async () => {
    const { registerShowTabContent } = await import("../../js/state.js");
    const reRender = vi.fn();
    registerShowTabContent(reRender);
    contextMenuOn(tableEl.querySelector("tbody td"));
    menuButton("Delete table").click();
    expect(reRender).toHaveBeenCalledWith(tab);
    registerShowTabContent(null);
  });

  it("hides the 'delete row' item for a header cell", () => {
    contextMenuOn(tableEl.querySelector("thead th"));
    expect(menuButton("Delete row").style.display).toBe("none");
  });

  it("closes and does nothing for a right-click outside a table", () => {
    contextMenuOn(tableEl.querySelector("tbody td"));
    document.getElementById("filename").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 }),
    );
    expect(document.querySelector(".table-context-menu").style.display).toBe("none");
  });

  it("closes on a click outside the menu", () => {
    contextMenuOn(tableEl.querySelector("tbody td"));
    document.body.click();
    expect(document.querySelector(".table-context-menu").style.display).toBe("none");
  });

  it("closes on Escape", () => {
    contextMenuOn(tableEl.querySelector("tbody td"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".table-context-menu").style.display).toBe("none");
  });

  it("does not open when the block index is out of range", () => {
    document.querySelector(".table-context-menu").style.display = "none";
    setCurrentBlocks([]);
    contextMenuOn(tableEl.querySelector("tbody td"));
    expect(document.querySelector(".table-context-menu").style.display).toBe("none");
  });

  it("does nothing when the block is removed while the menu is open", async () => {
    contextMenuOn(tableEl.querySelectorAll("tbody td")[0]);
    setCurrentBlocks([]);
    menuButton("Insert row below").click();
    const { currentBlocks } = await import("../../js/state.js");
    expect(currentBlocks).toHaveLength(0);
  });

  it("re-renders the document after a structural change", async () => {
    const { registerShowTabContent } = await import("../../js/state.js");
    const reRender = vi.fn();
    registerShowTabContent(reRender);
    contextMenuOn(tableEl.querySelectorAll("tbody td")[0]);
    menuButton("Insert row below").click();
    expect(reRender).toHaveBeenCalledWith(tab);
    registerShowTabContent(null);
  });
});

// ── insert a table via the context menu ───────────────────────────────────────

function renderParagraphDoc(blockIndexAttr = '0') {
  const contentEl = document.getElementById("content-primary");
  const attr = blockIndexAttr == null ? "" : ` data-block-index="${blockIndexAttr}"`;
  contentEl.innerHTML =
    `<div class="rendered"><div class="md-block md-block-paragraph"${attr}>Hello</div></div>`;
  return contentEl.querySelector(".md-block");
}

describe("insert table via context menu", () => {
  let tab;

  beforeEach(() => {
    tab = { content: "Hello", _undoStack: [], _redoStack: [] };
    setCurrentBlocks([{ type: "paragraph", raw: "Hello" }]);
    setCurrentTabRef(tab);
  });

  it("offers 'Insert table' when right-clicking a non-table block", () => {
    const block = renderParagraphDoc();
    contextMenuOn(block);
    expect(document.querySelector(".table-context-menu").style.display).toBe("block");
    expect(menuButton("Insert table").parentElement.style.display).toBe("block");
    expect(menuButton("Insert row above").parentElement.style.display).toBe("none");
  });

  it("inserts a table after the clicked block", async () => {
    const block = renderParagraphDoc();
    contextMenuOn(block);
    menuButton("Insert table").click();
    const { currentBlocks } = await import("../../js/state.js");
    expect(currentBlocks).toHaveLength(2);
    expect(currentBlocks[1].type).toBe("table");
    expect(parseTable(currentBlocks[1].raw).header).toEqual(["", ""]);
  });

  it("appends a table when right-clicking empty document space", async () => {
    renderParagraphDoc();
    contextMenuOn(document.querySelector(".rendered"));
    menuButton("Insert table").click();
    const { currentBlocks } = await import("../../js/state.js");
    expect(currentBlocks[currentBlocks.length - 1].type).toBe("table");
  });

  it("appends a table when the block has no index attribute", async () => {
    const block = renderParagraphDoc(null);
    contextMenuOn(block);
    menuButton("Insert table").click();
    const { currentBlocks } = await import("../../js/state.js");
    expect(currentBlocks[currentBlocks.length - 1].type).toBe("table");
  });

  it("does not open over a text selection (left to the copy menu)", () => {
    const block = renderParagraphDoc();
    const original = window.getSelection;
    window.getSelection = () => ({ toString: () => "picked", removeAllRanges() {}, addRange() {} });
    contextMenuOn(block);
    window.getSelection = original;
    expect(document.querySelector(".table-context-menu").style.display).toBe("none");
  });

  it("does not open when no document is active", () => {
    const block = renderParagraphDoc();
    setCurrentTabRef(null);
    contextMenuOn(block);
    expect(document.querySelector(".table-context-menu").style.display).toBe("none");
  });

  it("does nothing if the document is closed before clicking Insert table", async () => {
    const block = renderParagraphDoc();
    contextMenuOn(block);
    setCurrentTabRef(null);
    menuButton("Insert table").click();
    const { currentBlocks } = await import("../../js/state.js");
    expect(currentBlocks).toHaveLength(1);
  });

  it("re-renders the document after inserting a table", async () => {
    const { registerShowTabContent } = await import("../../js/state.js");
    const reRender = vi.fn();
    registerShowTabContent(reRender);
    const block = renderParagraphDoc();
    contextMenuOn(block);
    menuButton("Insert table").click();
    expect(reRender).toHaveBeenCalledWith(tab);
    registerShowTabContent(null);
  });

  it("ignores a contextmenu event with no element target", () => {
    document.body.click(); // close any open menu first
    document.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    expect(document.querySelector(".table-context-menu").style.display).toBe("none");
  });
});

// ── rowDropGap ────────────────────────────────────────────────────────────────

describe("rowDropGap", () => {
  const MIDS = [50, 150, 250];

  it("returns 0 above the first row's midpoint", () => {
    expect(rowDropGap(MIDS, 25)).toBe(0);
  });

  it("returns the gap between two rows", () => {
    expect(rowDropGap(MIDS, 100)).toBe(1);
    expect(rowDropGap(MIDS, 200)).toBe(2);
  });

  it("returns rows.length below the last row's midpoint (bottom)", () => {
    expect(rowDropGap(MIDS, 300)).toBe(3);
  });
});

// ── row reordering by drag (pointer-based) ────────────────────────────────────

function mouseEvent(type, el, clientY = 0) {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY }));
}

// Give each body row a deterministic vertical span (jsdom otherwise returns zeros).
function stubRowRects(tableEl, height = 20, firstTop = 100) {
  const rows = Array.from(tableEl.querySelectorAll("tbody tr"));
  let top = firstTop;
  rows.forEach((rowEl) => {
    const rect = { top, bottom: top + height, height };
    rowEl.getBoundingClientRect = () => rect;
    top += height;
  });
  return rows; // row i spans [firstTop + i*h, firstTop + (i+1)*h], midpoint firstTop + i*h + h/2
}

describe("row reordering by drag", () => {
  let tab;
  let tableEl;

  beforeEach(() => {
    tab = { content: SAMPLE, _undoStack: [], _redoStack: [] };
    setCurrentBlocks([{ type: "table", raw: SAMPLE }]);
    setCurrentTabRef(tab);
    tableEl = renderTableBlock(SAMPLE);
    wireTableEditing(tableEl, 0, tab);
  });

  it("adds a drag handle to each body row", () => {
    expect(tableEl.querySelectorAll(".table-row-handle")).toHaveLength(2);
  });

  it("marks the dragged row on mousedown", () => {
    const handles = tableEl.querySelectorAll(".table-row-handle");
    const rows = tableEl.querySelectorAll("tbody tr");
    mouseEvent("mousedown", handles[0]);
    expect(rows[0].classList.contains("table-row-dragging")).toBe(true);
    mouseEvent("mouseup", document);
  });

  it("shows a bottom indicator when dragging past the last row", () => {
    const handles = tableEl.querySelectorAll(".table-row-handle");
    const rows = stubRowRects(tableEl); // rows at [100,120] and [120,140]
    mouseEvent("mousedown", handles[0]);
    mouseEvent("mousemove", document, 200); // below both midpoints → bottom gap
    expect(rows[1].classList.contains("table-row-drop-target-bottom")).toBe(true);
    expect(rows[1].classList.contains("table-row-drop-target")).toBe(false);
    mouseEvent("mouseup", document);
  });

  it("shows a top-border indicator on the target row mid-table", () => {
    const handles = tableEl.querySelectorAll(".table-row-handle");
    const rows = stubRowRects(tableEl);
    mouseEvent("mousedown", handles[1]); // dragging the last row
    mouseEvent("mousemove", document, 105); // above row 0 midpoint (110) → gap 0
    expect(rows[0].classList.contains("table-row-drop-target")).toBe(true);
    mouseEvent("mouseup", document);
  });

  it("moves a row to the bottom", async () => {
    const handles = tableEl.querySelectorAll(".table-row-handle");
    stubRowRects(tableEl);
    mouseEvent("mousedown", handles[0]); // drag first row
    mouseEvent("mousemove", document, 200); // bottom gap
    mouseEvent("mouseup", document);
    const { currentBlocks } = await import("../../js/state.js");
    expect(parseTable(currentBlocks[0].raw).rows).toEqual([["Bob", "25"], ["Ann", "30"]]);
  });

  it("moves a row to the top", async () => {
    const handles = tableEl.querySelectorAll(".table-row-handle");
    stubRowRects(tableEl);
    mouseEvent("mousedown", handles[1]); // drag last row
    mouseEvent("mousemove", document, 105); // gap 0 (top)
    mouseEvent("mouseup", document);
    const { currentBlocks } = await import("../../js/state.js");
    expect(parseTable(currentBlocks[0].raw).rows).toEqual([["Bob", "25"], ["Ann", "30"]]);
  });

  it("clears drag markers after dropping", () => {
    const handles = tableEl.querySelectorAll(".table-row-handle");
    stubRowRects(tableEl);
    mouseEvent("mousedown", handles[0]);
    mouseEvent("mousemove", document, 200);
    mouseEvent("mouseup", document);
    expect(tableEl.querySelector(".table-row-dragging, .table-row-drop-target, .table-row-drop-target-bottom")).toBeNull();
  });

  it("does nothing when released without moving (same slot)", async () => {
    const handles = tableEl.querySelectorAll(".table-row-handle");
    const rows = stubRowRects(tableEl);
    mouseEvent("mousedown", handles[0]);
    mouseEvent("mousemove", document, 105); // gap 0 == fromIndex 0 → no-op
    mouseEvent("mouseup", document);
    const { currentBlocks } = await import("../../js/state.js");
    expect(currentBlocks[0].raw).toBe(SAMPLE);
  });

  it("does nothing when dropped just below its own row", async () => {
    const handles = tableEl.querySelectorAll(".table-row-handle");
    stubRowRects(tableEl);
    mouseEvent("mousedown", handles[0]);
    mouseEvent("mousemove", document, 125); // gap 1 == fromIndex+1 → no-op
    mouseEvent("mouseup", document);
    const { currentBlocks } = await import("../../js/state.js");
    expect(currentBlocks[0].raw).toBe(SAMPLE);
  });

  it("ignores mousemove when no drag is in progress", () => {
    const rows = tableEl.querySelectorAll("tbody tr");
    mouseEvent("mousemove", document, 5);
    expect(rows[1].classList.contains("table-row-drop-target")).toBe(false);
  });

  it("ignores mouseup when no drag is in progress", async () => {
    mouseEvent("mouseup", document);
    const { currentBlocks } = await import("../../js/state.js");
    expect(currentBlocks[0].raw).toBe(SAMPLE);
  });

  it("does not write back when the block is gone on drop", async () => {
    const handles = tableEl.querySelectorAll(".table-row-handle");
    stubRowRects(tableEl);
    mouseEvent("mousedown", handles[0]);
    mouseEvent("mousemove", document, 200);
    setCurrentBlocks([]);
    mouseEvent("mouseup", document);
    const { currentBlocks } = await import("../../js/state.js");
    expect(currentBlocks).toHaveLength(0);
  });
});
