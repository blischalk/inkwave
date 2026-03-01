// Entry point — import order triggers module-level side effects in the right sequence.
// state → debug/api/utils/blocks/caret → tabs/fileio → renderer/editor → filetree/ui/init

import "./state.js";
import "./debug.js";
import "./api.js";
import "./utils.js";
import "./blocks.js";
import "./caret.js";
import "./tabs.js";
import "./fileio.js";
import "./renderer.js";   // registers onShowTabContent + onShowWelcomeOrEmpty
import "./editor.js";     // registers onStartInlineEdit
import "./filetree.js";
import "./ui.js";

import { applyTheme } from "./ui.js";
import { loadWelcome, whenApiReady } from "./init.js";

// Apply default theme before anything is shown.
applyTheme("obsidianite");

// Start the welcome / API-ready sequence.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    whenApiReady(loadWelcome);
  });
} else {
  whenApiReady(loadWelcome);
}
