import { escapeHtml } from "./utils.js";

export function parseFileChanges(text) {
  const results = [];
  const re = /<file-change\s+path="([^"]+)">([\s\S]*?)<\/file-change>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    results.push({ path: m[1], newContent: m[2] });
  }
  return results;
}

export function computeLineDiff(oldText, newText) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const MAX = 2000;
  const a = oldLines.slice(0, MAX);
  const b = newLines.slice(0, MAX);
  const m = a.length, n = b.length;

  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const diff = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      diff.push({ type: "unchanged", line: a[i], oldLine: i + 1, newLine: j + 1 });
      i++; j++;
    } else if (j < n && (i >= m || dp[i + 1][j] >= dp[i][j + 1])) {
      diff.push({ type: "added", line: b[j], newLine: j + 1 });
      j++;
    } else {
      diff.push({ type: "removed", line: a[i], oldLine: i + 1 });
      i++;
    }
  }
  return diff;
}

export function renderDiff(diff) {
  const CONTEXT = 3;
  const show = new Uint8Array(diff.length);
  for (let i = 0; i < diff.length; i++) {
    if (diff[i].type !== "unchanged") {
      for (let k = Math.max(0, i - CONTEXT); k <= Math.min(diff.length - 1, i + CONTEXT); k++) {
        show[k] = 1;
      }
    }
  }

  let html = '<table class="diff-table">';
  let i = 0;
  while (i < diff.length) {
    if (!show[i]) {
      let skip = 0;
      while (i < diff.length && !show[i]) { skip++; i++; }
      html += `<tr class="diff-hunk-placeholder"><td colspan="4">@@ ${skip} unchanged line${skip !== 1 ? "s" : ""} @@</td></tr>`;
    } else {
      const d = diff[i];
      const cls = d.type === "added" ? "diff-added" : d.type === "removed" ? "diff-removed" : "diff-unchanged";
      const sign = d.type === "added" ? "+" : d.type === "removed" ? "−" : " ";
      const oldNum = d.oldLine != null ? d.oldLine : "";
      const newNum = d.newLine != null ? d.newLine : "";
      html += `<tr class="diff-line ${cls}">` +
        `<td class="diff-gutter diff-gutter-old">${oldNum}</td>` +
        `<td class="diff-gutter diff-gutter-new">${newNum}</td>` +
        `<td class="diff-sign">${sign}</td>` +
        `<td class="diff-text"><code>${escapeHtml(d.line)}</code></td>` +
        `</tr>`;
      i++;
    }
  }
  html += "</table>";
  return html;
}
