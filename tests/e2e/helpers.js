// Shared Playwright helpers for Inkwave E2E tests.
import { installMockPywebviewApi } from "./fixtures/mock-pywebview.js";

/**
 * Load index.html with a mocked pywebview.api installed before any page
 * script runs. This exercises the real js/main.js -> initSettings() /
 * whenApiReady(loadWelcome) startup sequence exactly as app.py's actual
 * window.events.loaded handlers do, just over the pull-model API
 * (a.load_settings()/a.get_welcome()) instead of the push-model
 * (__applySettings/__applyWelcome evaluate_js calls).
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} initialSettings - flat string-valued dict, mirrors
 *   settings.json on disk (e.g. {showWelcomeOnStartup: "false"}).
 * @param {string|null} welcomeContent - Welcome.md body, or null to
 *   simulate a missing/unreadable welcome file.
 */
async function gotoApp(page, { initialSettings = {}, welcomeContent = "# Welcome\n\nHello.", initialDrafts = {} } = {}) {
  // Regression guard: index.html/js/utils.js must make ZERO outbound
  // network requests (fonts, marked, highlight.js, mermaid are all
  // vendored in vendor/). If any request escapes to a non-local host,
  // fail loudly instead of silently falling back — a silent CDN
  // fallback is exactly the bug this assertion exists to catch.
  page.on("request", (req) => {
    const url = req.url();
    if (!url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1") && !url.startsWith("file:")) {
      throw new Error(`Outbound network request detected (must be zero): ${url}`);
    }
  });
  await page.addInitScript(installMockPywebviewApi, { initialSettings, welcomeContent, initialDrafts });
  await page.goto("/index.html");
}

/**
 * Simulate Python's actual relaunch push sequence: calls
 * window.__applySettings then window.__applyWelcome directly, in the
 * fixed registration order (settings before welcome). This is the path
 * app.py's window.events.loaded handlers use in the real packaged app,
 * distinct from the loadWelcome() pull-path gotoApp() exercises.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} settings - flat string-valued dict, as Python's
 *   api.load_settings() would return.
 * @param {string|null} welcomeContent
 */
async function simulatePythonPush(page, settings, welcomeContent) {
  await page.evaluate(
    ({ settings, welcomeContent }) => {
      if (window.__applySettings) {
        window.__applySettings(JSON.stringify(settings));
      }
      if (window.__applyWelcome && welcomeContent !== null) {
        window.__applyWelcome(JSON.stringify({ path: "/mock/Welcome.md", content: welcomeContent }));
      }
    },
    { settings, welcomeContent }
  );
}

/**
 * Reads back the in-memory mock settings store a test's save_setting()
 * calls have accumulated, simulating what a real relaunch would read
 * from settings.json on disk.
 */
async function readPersistedSettings(page) {
  return page.evaluate(() => ({ ...window.__inkwaveTestSettingsStore }));
}

/**
 * Reads back the in-memory mock drafts registry (path -> content),
 * simulating what a real relaunch would read from drafts.json + the
 * drafts directory on disk.
 */
async function readDraftsRegistry(page) {
  return page.evaluate(() => ({ ...window.__inkwaveTestDraftsRegistry }));
}

/**
 * Reads back the content most recently written to `path` via
 * write_file() — covers ANY file (a regular file opened via
 * open_file, not just scratch files tracked in the drafts registry).
 * Returns undefined if write_file was never called for that path.
 */
async function readWrittenFile(page, path) {
  return page.evaluate(
    (p) => (window.__inkwaveTestWrittenFiles || {})[p],
    path,
  );
}

/**
 * Simulates quitting and relaunching Inkwave within the SAME Playwright
 * page: snapshots the current in-memory drafts registry, reloads
 * index.html fresh (new module graph, empty `tabs` array, exactly like
 * a real process restart), and re-installs the mock API seeded with
 * that snapshot so reloadScratchFiles() has something real to reopen.
 * Settings are carried forward the same way.
 */
async function simulateRelaunch(page) {
  const drafts = await readDraftsRegistry(page);
  const settings = await readPersistedSettings(page);
  await page.addInitScript(installMockPywebviewApi, {
    initialSettings: settings,
    welcomeContent: "# Welcome\n\nHello.",
    initialDrafts: drafts,
  });
  await page.reload();
}

/**
 * Configure a mock API override for open_file/open_folder/list_dir/
 * read_file/list_ollama_models — simulated native-dialog or
 * backend-call results for a specific test (default behavior for all
 * of these is "user cancelled" / "empty", see mock-pywebview.js).
 * Must be called AFTER gotoApp() (needs window to exist).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} apiMethod - one of open_file, open_folder, list_dir,
 *   read_file, list_ollama_models
 * @param {*} returnValue - JSON-serializable value the mock should resolve with
 */
async function setMockOverride(page, apiMethod, returnValue) {
  await page.evaluate(
    ({ apiMethod, returnValue }) => {
      window.__inkwaveMockApiOverrides = window.__inkwaveMockApiOverrides || {};
      window.__inkwaveMockApiOverrides[apiMethod] = () => returnValue;
    },
    { apiMethod, returnValue },
  );
}

export { gotoApp, simulatePythonPush, readPersistedSettings, readDraftsRegistry, readWrittenFile, simulateRelaunch, setMockOverride };
