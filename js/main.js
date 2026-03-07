// Entry point — import order triggers module-level side effects in the right sequence.
// state → debug/api/utils/blocks/caret → tabs/fileio → editor (before renderer so o/p keydown runs first) → renderer → filetree/ui/init

import "./state.js";
import "./debug.js";
import "./api.js";
import "./utils.js";
import "./blocks.js";
import "./caret.js";
import "./tabs.js";
import "./fileio.js";
import "./editor.js";     // registers onStartInlineEdit + inline-edit o/p keydown (must run before renderer)
import "./renderer.js";   // registers onShowTabContent + onShowWelcomeOrEmpty
import "./filetree.js";
import "./ui.js";
import "./toc.js";
import "./chat.js";
import "./vim.js";
import "./settings.js";

import { applyTheme } from "./ui.js";
import { initSettings } from "./settings.js";
import { loadWelcome, whenApiReady } from "./init.js";

// Apply default theme before anything is shown.
applyTheme("obsidianite");

// Load persisted settings (vim mode, etc.)
initSettings();

// Start the welcome / API-ready sequence.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    whenApiReady(loadWelcome);
  });
} else {
  whenApiReady(loadWelcome);
}
