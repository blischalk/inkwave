import { marked } from "marked";

// Provide the marked global that the CDN normally supplies.
global.marked = marked;

// Minimal hljs stub — highlightCodeInContainer guards with typeof hljs check.
global.hljs = { highlightElement: () => {} };
