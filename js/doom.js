// DOOM easter egg — launches native DOOM via Python backend.

export function launchDoom() {
  const api = window.pywebview && window.pywebview.api;
  if (api && typeof api.launch_doom === "function") {
    api.launch_doom();
  }
}
