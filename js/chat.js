import { tabs, treeRoot, onShowTabContent, llmProvider, llmModel, setLlmProvider, setLlmModel } from "./state.js";
import { getApi } from "./api.js";
import { escapeHtml } from "./utils.js";
import { refreshFolder } from "./filetree.js";
import { PROVIDER_MODELS, loadSettings, saveSettings, populateModelSelect, fetchOllamaModels } from "./settings.js";

// ── DOM refs ──────────────────────────────────────────────────────────────────
const chatPanel          = document.getElementById("chatPanel");
const chatCloseBtn       = document.getElementById("chatCloseBtn");
const chatBtn            = document.getElementById("chatBtn");
const chatMessages       = document.getElementById("chatMessages");
const chatInput          = document.getElementById("chatInput");
const chatSendBtn        = document.getElementById("chatSendBtn");
const chatChips          = document.getElementById("chatChips");
const chatDiffViewer     = document.getElementById("chatDiffViewer");
const chatDiffPath       = document.getElementById("chatDiffPath");
const chatDiffBody       = document.getElementById("chatDiffBody");
const chatDiffNav        = document.getElementById("chatDiffNav");
const chatDiffAccept     = document.getElementById("chatDiffAccept");
const chatDiffReject     = document.getElementById("chatDiffReject");
const tocPanel           = document.getElementById("tocPanel");
const chatProviderSelect = document.getElementById("chatProviderSelect");
const chatModelSelect    = document.getElementById("chatModelSelect");

// ── Provider display names ────────────────────────────────────────────────────
const PROVIDER_NAMES = {
  anthropic: "Claude",
  openai:    "ChatGPT",
  gemini:    "Gemini",
  ollama:    "the AI",
};

function updateChatPlaceholder(provider) {
  if (!chatInput) return;
  const name = PROVIDER_NAMES[provider] || "the AI";
  chatInput.placeholder = `Ask ${name} about your document… (Enter to send, Shift+Enter for newline)`;
}

function syncChatProviderUI(provider, model) {
  if (chatProviderSelect) chatProviderSelect.value = provider;
  populateModelSelect(provider, chatModelSelect, model);
  updateChatPlaceholder(provider);
}

// ── Module state ──────────────────────────────────────────────────────────────
let chatVisible = false;
let isStreaming = false;
let conversationHistory = [];
let pendingFileChanges = [];
let pendingChangeIndex = 0;
let _streamingBubble = null;
let _streamingRawText = "";

// ── Panel show/hide ───────────────────────────────────────────────────────────
export function showChat() {
  // Hide TOC panel if open
  if (tocPanel && tocPanel.classList.contains("visible")) {
    tocPanel.classList.remove("visible");
    const tocBtn = document.getElementById("tocBtn");
    const focusTocBtn = document.getElementById("focusTocBtn");
    if (tocBtn) tocBtn.setAttribute("aria-pressed", "false");
    if (focusTocBtn) focusTocBtn.setAttribute("aria-pressed", "false");
  }
  chatVisible = true;
  if (chatPanel) chatPanel.classList.add("visible");
  if (chatBtn) chatBtn.setAttribute("aria-pressed", "true");
  syncChatProviderUI(llmProvider, llmModel);
  if (llmProvider === "ollama" && PROVIDER_MODELS.ollama.length === 0) {
    fetchOllamaModels().then(() => populateModelSelect("ollama", chatModelSelect, llmModel));
  }
  renderContextChips();
}

export function hideChat() {
  chatVisible = false;
  if (chatPanel) chatPanel.classList.remove("visible");
  if (chatBtn) chatBtn.setAttribute("aria-pressed", "false");
}

export function toggleChat() {
  chatVisible ? hideChat() : showChat();
}

// ── Context chips ─────────────────────────────────────────────────────────────
function renderContextChips() {
  if (!chatChips) return;
  const chips = [];
  if (treeRoot) {
    const dirName = treeRoot.split(/[\\/]/).pop();
    chips.push(`<span class="chat-chip chat-chip-dir" title="${escapeHtml(treeRoot)}">📁 ${escapeHtml(dirName)}</span>`);
  }
  if (tabs && tabs.length > 0) {
    tabs.forEach(tab => {
      const name = tab.path ? tab.path.split(/[\\/]/).pop() : "(unsaved)";
      chips.push(`<span class="chat-chip" title="${escapeHtml(tab.path || "")}">${escapeHtml(name)}</span>`);
    });
  }
  if (chips.length === 0) {
    chatChips.innerHTML = '<span class="chat-chip chat-chip-empty">No files open</span>';
  } else {
    chatChips.innerHTML = chips.join("");
  }
}

// ── File contexts for API ─────────────────────────────────────────────────────
function buildFileContexts() {
  return {
    openDirectory: treeRoot || null,
    files: tabs.map(tab => ({
      path: tab.path || null,
      content: tab.content || "",
    })),
  };
}

// ── Message rendering ─────────────────────────────────────────────────────────
function appendMessage(role, html, extraClass) {
  if (!chatMessages) return null;
  const wrapper = document.createElement("div");
  wrapper.className = `chat-message chat-message-${role}`;
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble-${role}${extraClass ? " " + extraClass : ""}`;
  bubble.innerHTML = html;
  wrapper.appendChild(bubble);
  chatMessages.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bubble;
}

function setSendingState(sending) {
  isStreaming = sending;
  if (chatSendBtn) chatSendBtn.disabled = sending || !(chatInput && chatInput.value.trim());
  if (chatInput) chatInput.disabled = sending;
}

// ── Send message ──────────────────────────────────────────────────────────────
async function sendMessage() {
  if (!chatInput || !chatInput.value.trim() || isStreaming) return;
  const text = chatInput.value.trim();
  chatInput.value = "";
  if (chatSendBtn) chatSendBtn.disabled = true;

  // Show user message
  appendMessage("user", escapeHtml(text).replace(/\n/g, "<br>"));

  // Add to history
  conversationHistory.push({ role: "user", content: text });

  // Create streaming bubble
  _streamingRawText = "";
  _streamingBubble = appendMessage("assistant", '<span class="chat-typing">…</span>');

  setSendingState(true);

  const api = getApi();
  if (!api) {
    finishStreamWithError("API not ready. Please wait for the app to finish loading.");
    return;
  }

  const result = await api.chat(conversationHistory, buildFileContexts());
  if (!result || !result.ok) {
    const errMsg = result && result.error;
    if (errMsg === "no_api_key") {
      finishStreamWithError('No API key set. Open <strong>Settings</strong> to add your API key for the selected provider.');
    } else {
      finishStreamWithError(escapeHtml(errMsg || "Unknown error starting chat."));
    }
  }
  // Streaming continues via window.__chatChunk / __chatDone / __chatError callbacks
}

function finishStreamWithError(htmlMsg) {
  if (_streamingBubble) {
    _streamingBubble.className = "chat-bubble chat-bubble-assistant chat-error";
    _streamingBubble.innerHTML = htmlMsg;
    _streamingBubble = null;
  }
  setSendingState(false);
}

// ── Global streaming callbacks ────────────────────────────────────────────────
window.__chatChunk = function(chunk) {
  if (!_streamingBubble) return;
  _streamingRawText += chunk;
  try {
    _streamingBubble.innerHTML = window.marked ? window.marked.parse(_streamingRawText) : escapeHtml(_streamingRawText);
  } catch {
    _streamingBubble.textContent = _streamingRawText;
  }
  if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
};

window.__chatDone = function() {
  if (!_streamingBubble) return;
  const rawText = _streamingRawText;

  // Final render
  try {
    _streamingBubble.innerHTML = window.marked ? window.marked.parse(rawText) : escapeHtml(rawText);
  } catch {
    _streamingBubble.textContent = rawText;
  }

  // Syntax highlight code blocks
  if (window.hljs) {
    _streamingBubble.querySelectorAll("pre code").forEach(el => {
      try { window.hljs.highlightElement(el); } catch { /* ignore */ }
    });
  }

  // Push to conversation history (strip XML tags for history)
  const historyText = rawText.replace(/<file-change[\s\S]*?<\/file-change>/g, "[file change proposal]");
  conversationHistory.push({ role: "assistant", content: historyText });

  _streamingBubble = null;
  _streamingRawText = "";
  setSendingState(false);

  // Check for file change proposals
  pendingFileChanges = parseFileChanges(rawText);
  pendingChangeIndex = 0;
  if (pendingFileChanges.length > 0) {
    showDiffForChange(0);
  }
};

window.__chatError = function(msg) {
  finishStreamWithError(escapeHtml(msg));
};

// ── Diff logic ────────────────────────────────────────────────────────────────
function parseFileChanges(text) {
  const results = [];
  const re = /<file-change\s+path="([^"]+)">([\s\S]*?)<\/file-change>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    results.push({ path: m[1], newContent: m[2] });
  }
  return results;
}

function computeLineDiff(oldText, newText) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const MAX = 2000;
  const a = oldLines.slice(0, MAX);
  const b = newLines.slice(0, MAX);
  const m = a.length, n = b.length;

  // LCS DP
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

  // Backtrack
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

function renderDiff(diff) {
  const CONTEXT = 3;
  // Mark which lines to show
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
      // Count skipped lines
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

function showDiffForChange(index) {
  if (!chatDiffViewer || index >= pendingFileChanges.length) {
    hideDiffViewer();
    return;
  }
  const change = pendingFileChanges[index];
  chatDiffViewer.removeAttribute("hidden");
  if (chatDiffPath) chatDiffPath.textContent = change.path.split(/[\\/]/).pop();
  chatDiffPath.title = change.path;

  // Find existing tab content
  const tab = tabs.find(t => t.path === change.path);
  const oldContent = tab ? (tab.content || "") : "";
  const diff = computeLineDiff(oldContent, change.newContent);
  if (chatDiffBody) chatDiffBody.innerHTML = renderDiff(diff);

  // Nav indicator
  if (chatDiffNav) {
    if (pendingFileChanges.length > 1) {
      chatDiffNav.textContent = `Change ${index + 1} of ${pendingFileChanges.length}`;
    } else {
      chatDiffNav.textContent = "";
    }
  }
}

function hideDiffViewer() {
  if (chatDiffViewer) chatDiffViewer.setAttribute("hidden", "");
  if (chatDiffBody) chatDiffBody.innerHTML = "";
  if (chatDiffNav) chatDiffNav.textContent = "";
}

// ── Accept / Reject handlers ──────────────────────────────────────────────────
if (chatDiffAccept) {
  chatDiffAccept.addEventListener("click", async () => {
    const change = pendingFileChanges[pendingChangeIndex];
    if (!change) return;

    const api = getApi();
    if (api) {
      await api.write_file(change.path, change.newContent);
    }

    // Refresh the file tree so newly created files appear
    const parentDir = change.path.replace(/[\\/][^\\/]+$/, "");
    if (parentDir) refreshFolder(parentDir);

    // Update tab in memory and re-render (only if already open)
    const tab = tabs.find(t => t.path === change.path);
    if (tab) {
      tab.content = change.newContent;
      if (onShowTabContent) onShowTabContent(tab);
    }

    appendMessage("system", `<em>Accepted changes to <code>${escapeHtml(change.path.split(/[\\/]/).pop())}</code>.</em>`, "chat-system");

    pendingChangeIndex++;
    if (pendingChangeIndex < pendingFileChanges.length) {
      showDiffForChange(pendingChangeIndex);
    } else {
      hideDiffViewer();
    }
  });
}

if (chatDiffReject) {
  chatDiffReject.addEventListener("click", () => {
    const change = pendingFileChanges[pendingChangeIndex];
    if (change) {
      appendMessage("system", `<em>Rejected changes to <code>${escapeHtml(change.path.split(/[\\/]/).pop())}</code>.</em>`, "chat-system");
    }
    pendingChangeIndex++;
    if (pendingChangeIndex < pendingFileChanges.length) {
      showDiffForChange(pendingChangeIndex);
    } else {
      hideDiffViewer();
    }
  });
}

// ── Input event wiring ────────────────────────────────────────────────────────
if (chatInput) {
  chatInput.addEventListener("input", () => {
    if (chatSendBtn) chatSendBtn.disabled = isStreaming || !chatInput.value.trim();
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

if (chatSendBtn) {
  chatSendBtn.addEventListener("click", sendMessage);
}

if (chatBtn) {
  chatBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleChat(); });
}

if (chatCloseBtn) {
  chatCloseBtn.addEventListener("click", hideChat);
}

// ── Chat-panel provider/model switcher ────────────────────────────────────────
if (chatProviderSelect) {
  chatProviderSelect.addEventListener("change", async () => {
    const p = chatProviderSelect.value;
    setLlmProvider(p);
    if (p === "ollama") await fetchOllamaModels();
    populateModelSelect(p, chatModelSelect, "");
    const m = chatModelSelect ? chatModelSelect.value : "";
    setLlmModel(m);
    updateChatPlaceholder(p);
    const s = loadSettings(); s.llmProvider = p; s.llmModel = m; saveSettings(s);
    document.dispatchEvent(new CustomEvent("llm-changed", { detail: { provider: p, model: m } }));
  });
}

if (chatModelSelect) {
  chatModelSelect.addEventListener("change", () => {
    const m = chatModelSelect.value;
    setLlmModel(m);
    const s = loadSettings(); s.llmModel = m; saveSettings(s);
    document.dispatchEvent(new CustomEvent("llm-changed", { detail: { provider: llmProvider, model: m } }));
  });
}

// Keep chat panel in sync when provider/model changes from settings panel
document.addEventListener("llm-changed", ({ detail }) => {
  if (!chatVisible) return;
  if (chatProviderSelect && chatProviderSelect.value !== detail.provider) {
    chatProviderSelect.value = detail.provider;
    populateModelSelect(detail.provider, chatModelSelect, detail.model);
    updateChatPlaceholder(detail.provider);
  } else if (chatModelSelect && chatModelSelect.value !== detail.model) {
    chatModelSelect.value = detail.model;
  }
});
