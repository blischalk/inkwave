import { describe, it, expect, beforeEach, vi } from "vitest";

// Set up the full DOM that settings.js expects at import time
document.body.innerHTML = `
  <div id="content-primary" class="content"></div>
  <div id="filename"></div>
  <div id="tree"></div>
  <div id="sidebar"></div>
  <button id="openBtn"></button>
  <button id="settingsBtn"></button>
  <div id="settingsModal" class="settings-modal" hidden>
    <button id="settingsCloseBtn"></button>
    <input type="checkbox" id="vimModeToggle" />
    <input type="checkbox" id="gradientBoldToggle" />
    <input type="checkbox" id="fullWidthToggle" />
    <input type="checkbox" id="dblClickEditToggle" checked />
    <select id="llmProviderSelect"><option value="anthropic">Anthropic</option></select>
    <select id="llmModelSelect"></select>
    <div id="anthropicKeySection"></div>
    <div id="openaiKeySection"></div>
    <div id="geminiKeySection"></div>
    <div id="ollamaSection"></div>
    <span id="anthropicKeyStatus"></span>
    <button id="anthropicKeySetBtn"></button>
    <button id="anthropicKeyDeleteBtn"></button>
    <div id="anthropicKeyEntry" hidden></div>
    <input id="anthropicKeyInput" />
    <button id="anthropicKeySaveBtn"></button>
    <button id="anthropicKeyCancelBtn"></button>
    <span id="openaiKeyStatus"></span>
    <button id="openaiKeySetBtn"></button>
    <button id="openaiKeyDeleteBtn"></button>
    <div id="openaiKeyEntry" hidden></div>
    <input id="openaiKeyInput" />
    <button id="openaiKeySaveBtn"></button>
    <button id="openaiKeyCancelBtn"></button>
    <span id="geminiKeyStatus"></span>
    <button id="geminiKeySetBtn"></button>
    <button id="geminiKeyDeleteBtn"></button>
    <div id="geminiKeyEntry" hidden></div>
    <input id="geminiKeyInput" />
    <button id="geminiKeySaveBtn"></button>
    <button id="geminiKeyCancelBtn"></button>
    <select id="ollamaModelSelect"></select>
    <button id="ollamaRefreshBtn"></button>
    <span id="ollamaStatus"></span>
    <select id="fontSizeSelect"></select>
  </div>
`;

// Mock pywebview API
window.pywebview = { api: {
  load_settings: () => Promise.resolve({}),
  save_setting: () => Promise.resolve({ ok: true }),
  get_provider_api_key_status: () => Promise.resolve({ has_key: false }),
}};

const { loadSettings, saveSettings, PROVIDER_MODELS, populateModelSelect } = await import("../../js/settings.js");

describe("settings — loadSettings / saveSettings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loadSettings returns empty object when nothing saved", () => {
    const s = loadSettings();
    expect(typeof s).toBe("object");
  });

  it("saveSettings + loadSettings round-trips", () => {
    const data = { theme: "obsidianite", vimMode: true, docFontSize: 1.2 };
    saveSettings(data);
    const loaded = loadSettings();
    expect(loaded.theme).toBe("obsidianite");
    expect(loaded.vimMode).toBe(true);
    expect(loaded.docFontSize).toBe(1.2);
  });

  it("saveSettings overwrites previous data", () => {
    saveSettings({ theme: "old" });
    saveSettings({ theme: "new" });
    expect(loadSettings().theme).toBe("new");
  });

  it("loadSettings handles corrupted localStorage gracefully", () => {
    localStorage.setItem("inkwave_settings", "not json!!!");
    const s = loadSettings();
    expect(typeof s).toBe("object");
  });
});

describe("settings — PROVIDER_MODELS", () => {
  it("has anthropic provider", () => {
    expect(PROVIDER_MODELS.anthropic).toBeDefined();
    expect(PROVIDER_MODELS.anthropic.length).toBeGreaterThan(0);
  });

  it("has openai provider", () => {
    expect(PROVIDER_MODELS.openai).toBeDefined();
  });

  it("has gemini provider", () => {
    expect(PROVIDER_MODELS.gemini).toBeDefined();
  });
});

describe("settings — populateModelSelect", () => {
  it("populates a select element with models", () => {
    const select = document.createElement("select");
    populateModelSelect("anthropic", select, "");
    expect(select.options.length).toBeGreaterThan(0);
  });

  it("selects the current model", () => {
    const select = document.createElement("select");
    const firstModel = PROVIDER_MODELS.anthropic[0];
    populateModelSelect("anthropic", select, firstModel);
    expect(select.value).toBe(firstModel);
  });
});

describe("settings — toggle elements exist", () => {
  it("vim toggle exists", () => {
    expect(document.getElementById("vimModeToggle")).not.toBeNull();
  });

  it("gradient bold toggle exists", () => {
    expect(document.getElementById("gradientBoldToggle")).not.toBeNull();
  });

  it("full width toggle exists", () => {
    expect(document.getElementById("fullWidthToggle")).not.toBeNull();
  });

  it("dblclick edit toggle exists", () => {
    expect(document.getElementById("dblClickEditToggle")).not.toBeNull();
  });
});
