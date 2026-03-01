// Debug utilities. No imports — zero dependencies.

export let DEBUG_ENTER = false; // set true to show debug log; or press Ctrl+Shift+D to toggle
const DEBUG_MAX_LINES = 100;

if (DEBUG_ENTER) document.body.setAttribute("data-debug", "true");

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "D") {
    e.preventDefault();
    const on = document.body.getAttribute("data-debug") === "true";
    document.body.setAttribute("data-debug", on ? "false" : "true");
  }
});

export function dbg(...args) {
  if (!DEBUG_ENTER) return;
  const msg = args.join(" ");
  console.log("[MD]", msg);
  const el = document.getElementById("debugPanel");
  if (el) {
    const line = document.createElement("div");
    line.className = "debug-line";
    line.textContent = "[MD] " + msg;
    el.appendChild(line);
    while (el.children.length > DEBUG_MAX_LINES + 1)
      el.removeChild(el.children[1]);
    el.scrollTop = el.scrollHeight;
  }
}
