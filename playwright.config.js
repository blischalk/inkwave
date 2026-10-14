// Playwright config for Inkwave's PyWebView frontend.
//
// Inkwave is a desktop app: Python (pywebview) hosts index.html and injects
// state via window.evaluate_js() calls to __applySettings/__applyWelcome,
// and the frontend calls back into window.pywebview.api (see js/api.js).
// There is no HTTP server in production. For browser-based E2E testing we
// serve the static frontend directory and inject a mock window.pywebview.api
// before any page script runs (see tests/e2e/fixtures/mock-pywebview.js),
// exercising the exact same __applySettings/__applyWelcome entry points
// app.py calls on a real launch.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx http-server . -p 4173 -c-1 --silent",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
