// In-document find (Ctrl/Cmd+F). TreeWalker + <mark> wrapping, no dependencies.

import { contentEl, rawMode } from "./state.js";

let bar = null;
let input = null;
let countEl = null;
let marks = [];
let idx = -1;
let timer = 0;
let observer = null;

const CURRENT_CLS = "search-current";

function ensure() {
  if (bar) return;
  bar = document.createElement("div");
  bar.className = "search-bar";
  bar.setAttribute("role", "search");
  bar.innerHTML = [
    `<input type="text" class="search-input" placeholder="Find…"`,
    ` aria-label="Find in document" spellcheck="false"`,
    ` autocomplete="off"/>`,
    `<span class="search-count" role="status" aria-live="polite">`,
    `</span>`,
    `<button type="button" class="search-nav"`,
    ` aria-label="Previous match" title="Previous (Shift+Enter)">`,
    `&#x25B2;</button>`,
    `<button type="button" class="search-nav"`,
    ` aria-label="Next match" title="Next (Enter)">`,
    `&#x25BC;</button>`,
    `<button type="button" class="search-close"`,
    ` aria-label="Close search" title="Escape">&times;</button>`,
  ].join("");
  input = bar.querySelector(".search-input");
  countEl = bar.querySelector(".search-count");
  const [prevBtn, nextBtn] = bar.querySelectorAll(".search-nav");
  const closeBtn = bar.querySelector(".search-close");

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 150);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(timer);
      if (!marks.length) run();
      e.shiftKey ? prev() : next();
    }
    if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);
  closeBtn.addEventListener("click", close);

  bar.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const passthrough = mod && "acvxzf".includes(e.key.toLowerCase());
    if (!passthrough) e.stopPropagation();
  });

  observer = new MutationObserver(() => {
    if (bar && !bar.hidden && !contentEl.querySelector(".rendered")) {
      close();
      return;
    }
    if (!marks.length) return;
    if (marks[0] && !contentEl.contains(marks[0])) {
      marks = [];
      idx = -1;
      if (countEl && input.value) countEl.textContent = "0 results";
    }
  });
  observer.observe(contentEl, { childList: true });
}

export function open() {
  if (rawMode) return;
  ensure();
  if (!bar.parentElement) {
    const area = contentEl.closest(".content-area");
    if (area) area.appendChild(bar);
  }
  bar.hidden = false;
  input.focus();
  input.select();
}

export function close() {
  if (!bar) return;
  bar.hidden = true;
  clearTimeout(timer);
  clearMarks();
  if (!contentEl.hasAttribute("tabindex")) {
    contentEl.setAttribute("tabindex", "-1");
  }
  contentEl.focus({ preventScroll: true });
}

export function isOpen() {
  return bar != null && !bar.hidden;
}

export function clearIfActive() {
  if (marks.length) clearMarks();
}

function run() {
  clearMarks();
  const q = input.value.toLowerCase();
  if (!q) { countEl.textContent = ""; return; }

  const rendered = contentEl.querySelector(".rendered");
  if (!rendered) { countEl.textContent = "0 results"; return; }

  const walker = document.createTreeWalker(
    rendered, NodeFilter.SHOW_TEXT
  );
  const hits = [];
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue.toLowerCase();
    let pos = 0;
    while ((pos = text.indexOf(q, pos)) !== -1) {
      hits.push({ node, start: pos });
      pos += q.length;
    }
  }

  for (let i = hits.length - 1; i >= 0; i--) {
    const { node: n, start } = hits[i];
    try {
      const range = document.createRange();
      range.setStart(n, start);
      range.setEnd(n, start + q.length);
      const mark = document.createElement("mark");
      mark.className = "search-highlight";
      range.surroundContents(mark);
    } catch (err) {
      if (!(err instanceof DOMException)) throw err;
    }
  }

  marks = [
    ...rendered.querySelectorAll("mark.search-highlight"),
  ];
  if (marks.length === 0) {
    countEl.textContent = "0 results";
    idx = -1;
    return;
  }
  idx = 0;
  goTo(idx);
}

function goTo(i) {
  if (!marks.length) return;
  marks.forEach((m) => m.classList.remove(CURRENT_CLS));
  idx = ((i % marks.length) + marks.length) % marks.length;
  marks[idx].classList.add(CURRENT_CLS);
  marks[idx].scrollIntoView({ block: "center", behavior: "smooth" });
  countEl.textContent = `${idx + 1} of ${marks.length}`;
}

function next() { if (marks.length) goTo(idx + 1); }
function prev() { if (marks.length) goTo(idx - 1); }

function clearMarks() {
  marks.forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(m.textContent), m);
    parent.normalize();
  });
  marks = [];
  idx = -1;
  if (countEl) countEl.textContent = "";
}
