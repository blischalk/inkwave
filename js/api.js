// pywebview bridge. No imports — zero dependencies.

export function getApi() {
  return window.pywebview && window.pywebview.api;
}
