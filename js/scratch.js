// Cmd+N scratch-file tabs: create a throwaway Untitled.md under the OS
// drafts directory via Api.create_scratch_file(), open it as a normal
// file-backed tab (autosaves like any other open file via the existing
// saveToFile() path), and auto-focus the first empty block so the user
// can start typing with zero dialogs. On launch, reloadScratchFiles()
// restores any scratch tabs left open from the previous session.
import { getApi } from "./api.js";
import { addTab, getTabTitle } from "./tabs.js";
import {
  onStartInlineEdit, currentBlocks, tabs,
  registerBeforeCloseTab,
} from "./state.js";
import { showError } from "./utils.js";

/**
 * Create a new scratch tab backed by a real Untitled[ N].md file under
 * the drafts directory, open it, and focus the first empty block for
 * immediate typing. No dialogs — matches the "zero dialogs" requirement
 * for Cmd+N (contrast with createInFolder()'s blocking prompt(), which
 * this function deliberately does NOT reuse).
 */
export function createScratchTab() {
  const a = getApi();
  if (!a || typeof a.create_scratch_file !== "function") {
    showError("Create scratch file not available.");
    return;
  }
  return a
    .create_scratch_file()
    .then((result) => {
      if (!result || result.error) {
        showError((result && result.error) || "Failed to create scratch file.");
        return null;
      }
      const tab = addTab({
        path: result.path,
        title: getTabTitle(result.path),
        content: result.content,
      });
      tab._isScratch = true;
      focusFirstEmptyBlock(tab);
      pushUnsavedScratchState();
      return tab;
    })
    .catch((err) => {
      showError((err && (err.message || err)) || "Failed to create scratch file.");
      return null;
    });
}

/**
 * Programmatically starts inline-edit on block index 0, same call
 * signature the dblclick handler in renderer.js uses, so a brand new
 * scratch tab is immediately editable without the user needing to
 * double-click the empty placeholder block themselves.
 */
function focusFirstEmptyBlock(tab) {
  const blockEl = document.querySelector('.md-block[data-block-index="0"]');
  if (!blockEl || !onStartInlineEdit) return;
  onStartInlineEdit(blockEl, 0, currentBlocks, tab, null);
}

/**
 * Removes `path` from the drafts.json registry (does not delete the
 * file). Called once a scratch tab gets a real Save As path, or when
 * the user explicitly closes/deletes a scratch tab, so it stops being
 * offered for reload-on-launch.
 */
export function forgetScratchTab(path) {
  const a = getApi();
  if (!a || typeof a.forget_scratch_file !== "function" || !path) return Promise.resolve();
  return a.forget_scratch_file(path).catch(() => {});
}

/**
 * One-shot, launch-time only: reopen every scratch file still registered
 * in drafts.json as a tab, so content typed into an unsaved scratch note
 * before the last quit isn't silently lost. Never polls; called exactly
 * once from js/init.js's startup sequence.
 */
export function reloadScratchFiles() {
  const a = getApi();
  if (!a || typeof a.list_scratch_files !== "function") return Promise.resolve(0);
  return a
    .list_scratch_files()
    .then((result) => {
      const files = (result && result.files) || [];
      for (const file of files) {
        const tab = addTab({
          path: file.path,
          title: getTabTitle(file.path),
          content: file.content,
        });
        tab._isScratch = true;
      }
      return files.length;
    })
    .catch(() => 0);
}

/** True if a scratch tab has no meaningful content (U4: never typed in). */
function isScratchTabEmpty(tab) {
  return !tab.content || !String(tab.content).trim().length;
}

// U4: closing an empty, never-typed-in scratch tab should leave no
// trace — forget it from drafts.json AND delete the empty file from
// disk, rather than littering the drafts directory with Untitled N.md
// files the user never wrote anything into. Non-empty scratch tabs are
// left alone on close (U2's whole point is that they survive and
// reappear on next launch).
registerBeforeCloseTab((tab) => {
  if (tab && tab._isScratch && isScratchTabEmpty(tab)) {
    forgetScratchTab(tab.path);
    const a = getApi();
    if (a && typeof a.delete_file === "function") {
      a.delete_file(tab.path).catch(() => {});
    }
  }
  // This hook fires BEFORE tabs.splice() removes `tab` (see
  // js/tabs.js::closeTab), so window.__hasUnsavedScratchTabs() would
  // still count the tab about to close. Compute the post-close state
  // explicitly instead of relying on the (still stale) `tabs` array.
  const a2 = getApi();
  if (!a2 || typeof a2.set_has_unsaved_scratch !== "function") return;
  const stillUnsaved = tabs.some(
    (t) => t !== tab && t._isScratch && !isScratchTabEmpty(t)
  );
  a2.set_has_unsaved_scratch(stillUnsaved).catch(() => {});
});

/**
 * Pure boolean computation of "does any scratch tab currently have real,
 * typed content." Exposed on window for existing E2E/unit test contracts
 * (tests/js/scratch.test.js, tests/e2e/scratch-files.spec.js) and reused
 * internally by pushUnsavedScratchState() below.
 */
window.__hasUnsavedScratchTabs = function () {
  return tabs.some((t) => t._isScratch && !isScratchTabEmpty(t));
};

/**
 * Push the current "has unsaved scratch" state to the Python Api instance
 * so app.py's check_unsaved_scratch_on_quit (window.events.closing
 * handler) can read it as a plain attribute instead of calling back into
 * JS via evaluate_js.
 *
 * HISTORY (bug fix, 2026-10-15): the original design had Python call
 * window.evaluate_js("window.__hasUnsavedScratchTabs()") synchronously
 * from the closing handler. On the cocoa (macOS) backend this is a
 * GUARANTEED DEADLOCK: window.events.closing fires on the main thread,
 * and cocoa's evaluate_js schedules the actual JS execution via
 * AppHelper.callAfter (runs on a FUTURE main-thread run-loop iteration)
 * then blocks the calling thread on a semaphore — but the calling thread
 * IS the main thread, so it can never process the callAfter block that
 * would unblock it. Confirmed via a real spindump of the hang (main
 * thread: -[NSWindow __close] -> ... -> PyThread_acquire_lock_timed;
 * every other thread idle). The fix is this push-based design: JS
 * proactively tells Python the current state whenever it changes, so
 * Python never needs to ask JS anything at close time. See
 * app.py::check_unsaved_scratch_on_quit's docstring for the full
 * mechanism and app.py::Api.set_has_unsaved_scratch for the receiving end.
 *
 * Called from every place scratch-tab existence/content state can
 * change: tab creation (createScratchTab), tab close
 * (registerBeforeCloseTab, below), and every autosave of a scratch tab
 * (js/fileio.js's saveToFile, which calls this for scratch tabs only).
 */
export function pushUnsavedScratchState() {
  const a = getApi();
  if (!a || typeof a.set_has_unsaved_scratch !== "function") return;
  a.set_has_unsaved_scratch(window.__hasUnsavedScratchTabs()).catch(() => {});
}
