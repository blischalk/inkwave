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
async function gotoApp(page, { initialSettings = {}, welcomeContent = "# Welcome\n\nHello." } = {}) {
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
  await page.addInitScript(installMockPywebviewApi, { initialSettings, welcomeContent });
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

export { gotoApp, simulatePythonPush, readPersistedSettings };
