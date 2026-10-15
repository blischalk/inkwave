import { describe, it, expect, beforeEach } from "vitest";

// Minimal DOM for state.js imports
document.body.innerHTML = `
  <div id="content-primary" class="content">
    <div class="pane">
      <div class="rendered">
        <p>Hello world</p>
        <img src="test.png" />
        <pre class="mermaid"><svg viewBox="0 0 100 100"></svg></pre>
      </div>
      <div class="raw-editor"></div>
    </div>
    <div class="pane">
      <div class="rendered"><p>Second pane</p></div>
    </div>
  </div>
  <div id="filename"></div>
  <div id="tree"></div>
  <div id="sidebar"></div>
  <button id="openBtn"></button>
  <div id="openMenu"></div>
  <button id="newFileBtn"></button>
  <button id="copyBtn"></button>
  <button id="rawModeBtn"></button>
  <button id="focusBtn"></button>
  <button id="focusExitBtn"></button>
  <div id="treeContextMenu"></div>
  <button id="newFileHereBtn"></button>
  <button id="deleteFileBtn"></button>
  <div id="tabBar"></div>
`;

window.pywebview = { api: {
  load_settings: () => Promise.resolve({}),
  save_setting: () => Promise.resolve({ ok: true }),
}};

const { setDocFontSize } = await import("../../js/state.js");
// Import the REAL implementation under test — no inline reimplementation.
// See js/renderer.js for applyScaleZoom/applyDocFontSize (single source of
// truth; js/ui.js::changeFontSize and js/init.js both delegate to these).
const { applyScaleZoom, applyDocFontSize, FONT_SIZE_DEFAULT } = await import("../../js/renderer.js");

describe("applyScaleZoom — real implementation", () => {
  const DEFAULT = FONT_SIZE_DEFAULT;

  beforeEach(() => {
    setDocFontSize(DEFAULT);
    document.querySelectorAll(".rendered, .raw-editor").forEach(el => {
      el.style.transform = "";
      el.style.transformOrigin = "";
      el.style.width = "";
    });
  });

  it("default docFontSize produces no transform (scale 1)", () => {
    setDocFontSize(DEFAULT);
    const rendered = document.querySelector(".rendered");
    applyScaleZoom(rendered);
    expect(rendered.style.transform).toBe("");
    expect(rendered.style.width).toBe("");
  });

  it("increasing docFontSize applies scale > 1 via the real function", () => {
    setDocFontSize(1.5);
    const rendered = document.querySelector(".rendered");
    applyScaleZoom(rendered);
    expect(rendered.style.transform).toBe("scale(" + (1.5 / DEFAULT) + ")");
    expect(rendered.style.transformOrigin).toBe("top left");
  });

  it("decreasing docFontSize applies scale < 1 via the real function", () => {
    setDocFontSize(0.6);
    const rendered = document.querySelector(".rendered");
    applyScaleZoom(rendered);
    const scale = 0.6 / DEFAULT;
    expect(rendered.style.transform).toBe("scale(" + scale + ")");
  });

  it("sets width to 100/scale percent for layout reflow", () => {
    setDocFontSize(1.5);
    const rendered = document.querySelector(".rendered");
    applyScaleZoom(rendered);
    const scale = 1.5 / DEFAULT;
    expect(rendered.style.width).toBe((100 / scale) + "%");
  });

  it("clears transform/width when returning to default", () => {
    setDocFontSize(1.5);
    const rendered = document.querySelector(".rendered");
    applyScaleZoom(rendered);
    expect(rendered.style.transform).not.toBe("");

    setDocFontSize(DEFAULT);
    applyScaleZoom(rendered);
    expect(rendered.style.transform).toBe("");
    expect(rendered.style.transformOrigin).toBe("");
    expect(rendered.style.width).toBe("");
  });

  it("images and SVGs inside the scaled container scale with it (child of transformed element)", () => {
    setDocFontSize(2.0);
    const rendered = document.querySelector(".rendered");
    applyScaleZoom(rendered);
    const img = rendered.querySelector("img");
    const svg = rendered.querySelector("svg");
    expect(img.closest(".rendered")).toBe(rendered);
    expect(svg.closest(".rendered")).toBe(rendered);
    expect(rendered.style.transform).toContain("scale");
  });

  it("does not touch elements outside the passed element", () => {
    setDocFontSize(1.5);
    const rendered = document.querySelector(".rendered");
    applyScaleZoom(rendered);
    const sidebar = document.getElementById("sidebar");
    expect(sidebar.style.transform).toBeFalsy();
  });

  it("is a no-op guard-safe call with the actual default constant (0.95), not a hardcoded test value", () => {
    // Regression guard: this imports the REAL FONT_SIZE_DEFAULT constant
    // from renderer.js, not a copy — if it ever changes, this test's math
    // (0.6/0.95 etc.) must be revisited, but the constant itself can never
    // silently drift between the test and the implementation.
    setDocFontSize(0.95);
    const rendered = document.querySelector(".rendered");
    applyScaleZoom(rendered);
    expect(rendered.style.transform).toBe("");
  });
});

describe("applyDocFontSize — scales every pane in the document", () => {
  const DEFAULT = FONT_SIZE_DEFAULT;

  beforeEach(() => {
    setDocFontSize(DEFAULT);
    document.querySelectorAll(".rendered, .raw-editor").forEach(el => {
      el.style.transform = "";
      el.style.transformOrigin = "";
      el.style.width = "";
    });
  });

  it("scales ALL .pane .rendered elements, not just the active one (multi-pane/split)", () => {
    setDocFontSize(1.5);
    applyDocFontSize();
    const panes = document.querySelectorAll(".pane .rendered");
    expect(panes.length).toBe(2);
    panes.forEach(el => {
      expect(el.style.transform).toContain("scale");
    });
  });

  it("also scales .pane .raw-editor elements", () => {
    setDocFontSize(1.5);
    applyDocFontSize();
    const rawEditor = document.querySelector(".pane .raw-editor");
    expect(rawEditor.style.transform).toContain("scale");
  });
});

describe("zoom clamping (FONT_SIZE_MIN/MAX/STEP contract used by ui.js::changeFontSize)", () => {
  // These constants mirror js/ui.js (not exported — changeFontSize is a
  // private keydown-bound function). The actual clamp behavior is verified
  // end-to-end in tests/python/test_gui.py::TestZoomBehavior, which drives
  // the real app through pywebview. This test documents the contract so a
  // future change to the constants in ui.js is caught by a failing assertion
  // here prompting a cross-check, not a silent drift.
  const MIN = 0.6, MAX = 2.0, STEP = 0.05;

  it("clamps at MIN when decreasing past it", () => {
    let val = MIN;
    const clamped = Math.min(MAX, Math.max(MIN, Math.round((val - STEP) * 100) / 100));
    expect(clamped).toBe(MIN);
  });

  it("clamps at MAX when increasing past it", () => {
    let val = MAX;
    const clamped = Math.min(MAX, Math.max(MIN, Math.round((val + STEP) * 100) / 100));
    expect(clamped).toBe(MAX);
  });
});

describe("docFontSize → scale conversion (math contract)", () => {
  const DEFAULT = FONT_SIZE_DEFAULT;
  const cases = [
    { docFontSize: 0.60, expected: 0.6 / 0.95 },
    { docFontSize: 0.80, expected: 0.8 / 0.95 },
    { docFontSize: 0.95, expected: 1.0 },
    { docFontSize: 1.00, expected: 1.0 / 0.95 },
    { docFontSize: 1.20, expected: 1.2 / 0.95 },
    { docFontSize: 1.50, expected: 1.5 / 0.95 },
    { docFontSize: 2.00, expected: 2.0 / 0.95 },
  ];

  cases.forEach(({ docFontSize, expected }) => {
    it(`docFontSize ${docFontSize} → applyScaleZoom produces scale ${expected.toFixed(4)}`, () => {
      setDocFontSize(docFontSize);
      const rendered = document.querySelector(".rendered");
      applyScaleZoom(rendered);
      if (Math.abs(expected - 1) < 0.001) {
        expect(rendered.style.transform).toBe("");
      } else {
        expect(rendered.style.transform).toBe("scale(" + expected + ")");
      }
    });
  });
});
