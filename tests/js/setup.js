import { marked } from "marked";

// Provide the marked global that the CDN normally supplies.
global.marked = marked;

// Minimal hljs stub — highlightCodeInContainer guards with typeof hljs check.
global.hljs = { highlightElement: () => {} };

// Complete in-memory localStorage — the jsdom stub provided by this vitest
// version is file-backed with a broken path, leaving removeItem/clear absent.
const _ls = {};
global.localStorage = {
  getItem:    (k)    => Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null,
  setItem:    (k, v) => { _ls[k] = String(v); },
  removeItem: (k)    => { delete _ls[k]; },
  clear:      ()     => { Object.keys(_ls).forEach(k => delete _ls[k]); },
  get length()       { return Object.keys(_ls).length; },
  key:        (i)    => Object.keys(_ls)[i] ?? null,
};
