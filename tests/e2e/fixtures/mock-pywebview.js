// Mock window.pywebview.api for Playwright E2E tests.
//
// Mirrors the exact return shapes of the real Python API in app.py:
//   - load_settings() -> flat dict, ALL VALUES ARE STRINGS (settings.js
//     line ~107 does `String(v)` before calling save_setting). This is
//     significant: "false" is a truthy JS string, so any JS code reading
//     this dict must compare `=== "false"` / `=== "true"` explicitly,
//     the same way the existing fullWidth handling in init.js does.
//   - get_welcome() -> {path, content} or null (Welcome.md read)
//   - save_setting(key, value) -> persists into the in-memory settingsStore
//     so subsequent load_settings() calls in the SAME test reflect writes,
//     matching real settings.json round-trip behavior across a relaunch
//     simulation (see reloadWithPersistedSettings in e2e-helpers.js).
//
// Must be installed via page.addInitScript() BEFORE index.html's module
// scripts run, since js/api.js reads window.pywebview synchronously and
// js/main.js calls initSettings()/whenApiReady() at module-eval time.
export function installMockPywebviewApi({ initialSettings, welcomeContent }) {
  window.__inkwaveTestSettingsStore = { ...initialSettings };

  window.pywebview = {
    api: {
      load_settings() {
        // Real Python returns a fresh dict read from disk each call.
        return Promise.resolve({ ...window.__inkwaveTestSettingsStore });
      },
      save_setting(key, value) {
        window.__inkwaveTestSettingsStore[key] = String(value);
        return Promise.resolve({ success: true });
      },
      get_welcome() {
        if (welcomeContent === null) return Promise.resolve(null);
        return Promise.resolve({
          path: "/mock/Welcome.md",
          content: welcomeContent,
        });
      },
      // Minimal stubs for API surface area main.js/init.js touch at
      // startup so unrelated code paths don't throw.
      toggle_fullscreen() { return Promise.resolve(null); },
    },
  };

  // window.pywebview.state.loaded fires in real pywebview once the JS
  // bridge is ready; main.js's whenApiReady() polls for window.pywebview.
}
