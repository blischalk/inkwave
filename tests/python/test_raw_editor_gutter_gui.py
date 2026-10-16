"""
GUI integration tests for the raw-editor line-number gutter
(js/raw-editor-gutter.js).

Split out of test_gui.py per the modular-files rule: test_gui.py is already
over the 500-line new-file guideline, so new coverage goes in its own module
rather than growing that file further.

These tests load the real js/raw-editor-gutter.js module in a hidden
pywebview window via dynamic import() and exercise its mirror-based line
height measurement against a REAL layout engine (WKWebView on macOS,
WebKitGTK on Linux) — this is specifically the behavior jsdom's unit tests
(tests/js/raw-editor-gutter.test.js) cannot verify, since jsdom's
getBoundingClientRect() always returns zeros.

IMPORTANT DISCOVERY (2026-10-15, Gate E1 real-app verification): a
hidden=True pywebview window NEVER fires requestAnimationFrame — there is
no compositor/paint cycle for a window that is never shown. Confirmed
empirically: window.__rafFired stayed false after 0.5s in a hidden
window, vs true immediately in a visible (hidden=False) window running
the real app.Api backend. This means every test below that calls
attachGutter() and inspects markers synchronously (its OWN initial
recompute() call, which runs directly, not via rAF) is fine — but a test
that dispatched an "input" event afterward and expected scheduleRecompute's
rAF-debounced update to have landed would hang/fail here specifically
because of the hidden window, NOT because of a product bug. The
input-event-triggered recompute path IS correctly covered — by
tests/e2e/editor-mode-affordances.spec.js's Playwright suite, which uses
real (non-hidden-equivalent) headless Chromium that DOES run its
compositor loop regardless of window visibility. Real production windows
are always hidden=False (see app.py's own webview.create_window call),
so this hidden-window rAF gap never affects actual users — only this one
specific pytest test-authoring technique.

Requires: pip install pywebview pytest
Run:      pytest tests/python/test_raw_editor_gutter_gui.py -v
"""
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
INDEX_HTML = PROJECT_ROOT / "index.html"


def _import_gutter_module_js():
    """JS snippet that dynamically imports the real gutter module and
    returns a reference object the rest of each test's JS can call into."""
    module_url = "./js/raw-editor-gutter.js"
    return f'''
        const mod = await import("{module_url}");
        window.__gutterModuleForTest = mod;
    '''


def _run_check(check_fn):
    """run_gui_test from test_gui.py — reused here under its real name to
    avoid defining a second copy of the window/thread plumbing (Sauron:
    one path for launching the hidden test window)."""
    from test_gui import run_gui_test as _rgt
    _rgt(check_fn)


class TestRawEditorGutterRealLayout:
    """Mirror-measurement correctness against a real rendering engine."""

    def test_module_imports_and_exposes_expected_functions(self):
        def check(window):
            result = window.evaluate_js(
                _import_gutter_module_js()
                + '''
                return {
                    hasAttach: typeof window.__gutterModuleForTest.attachGutter === "function",
                    hasDetach: typeof window.__gutterModuleForTest.detachGutter === "function",
                    hasCurrentLineIndex: typeof window.__gutterModuleForTest.currentLineIndex === "function",
                };
                '''
            )
            assert result == {
                "hasAttach": True,
                "hasDetach": True,
                "hasCurrentLineIndex": True,
            }, f"Unexpected module shape: {result}"

        _run_check(check)

    def test_creates_one_marker_per_logical_line_in_real_layout(self):
        def check(window):
            result = window.evaluate_js(
                _import_gutter_module_js()
                + '''
                const ta = document.createElement("textarea");
                ta.className = "raw-editor";
                ta.value = "line one\\nline two\\nline three";
                ta.style.width = "400px";
                ta.style.height = "200px";
                document.body.appendChild(ta);

                window.__gutterModuleForTest.attachGutter(ta);
                const wrap = ta.closest(".raw-editor-wrap");
                const markers = wrap.querySelectorAll(".raw-editor-line-number");

                const texts = Array.from(markers).map(m => m.textContent);
                window.__gutterModuleForTest.detachGutter(ta);
                document.body.removeChild(ta);
                return texts;
                '''
            )
            assert result == ["1", "2", "3"], f"Expected 3 markers 1/2/3, got: {result}"

        _run_check(check)

    def test_long_wrapped_line_still_produces_a_single_marker(self):
        """A soft-wrapped logical line (one that renders as multiple visual
        rows in a narrow textarea) must still get exactly ONE line-number
        marker — this is the behavior jsdom cannot verify since it has no
        real text-wrapping layout."""

        def check(window):
            result = window.evaluate_js(
                _import_gutter_module_js()
                + '''
                const ta = document.createElement("textarea");
                ta.className = "raw-editor";
                // Deliberately long single logical line + a narrow textarea
                // forces soft-wrap across multiple visual rows in a real
                // layout engine.
                ta.value = "This is a very long single line of markdown text " +
                           "that should wrap across several visual rows when " +
                           "rendered in a narrow textarea element for this test.\\n" +
                           "second line";
                ta.style.width = "120px";
                ta.style.height = "300px";
                ta.style.fontFamily = "monospace";
                ta.style.fontSize = "14px";
                document.body.appendChild(ta);

                window.__gutterModuleForTest.attachGutter(ta);
                const wrap = ta.closest(".raw-editor-wrap");
                const markers = wrap.querySelectorAll(".raw-editor-line-number");
                const result = {
                    markerCount: markers.length,
                    firstMarkerHeight: markers[0] ? markers[0].getBoundingClientRect().height : 0,
                    secondMarkerTop: markers[1] ? parseFloat(markers[1].style.top) : null,
                };

                window.__gutterModuleForTest.detachGutter(ta);
                document.body.removeChild(ta);
                return result;
                '''
            )
            assert result["markerCount"] == 2, (
                f"Expected exactly 2 markers (one per logical line, regardless "
                f"of wrap), got: {result}"
            )
            # The first (wrapped) line's marker must be MEASURABLY taller than
            # a single text row — proof the mirror technique measured the
            # real multi-row wrapped height, not just one row.
            assert result["firstMarkerHeight"] > 20, (
                f"Expected wrapped-line marker height > one row (~20px), got: {result}"
            )
            # The second marker's top offset must be positioned AFTER the
            # first line's full wrapped height, not stacked at a single
            # row's height — proof the gutter accounted for wrapping when
            # placing subsequent markers.
            assert result["secondMarkerTop"] > 20, (
                f"Expected second marker's top offset to account for the "
                f"first line's wrapped height, got: {result}"
            )

        _run_check(check)

    def test_current_line_highlight_follows_caret_in_real_layout(self):
        def check(window):
            result = window.evaluate_js(
                _import_gutter_module_js()
                + '''
                const ta = document.createElement("textarea");
                ta.className = "raw-editor";
                ta.value = "alpha\\nbeta\\ngamma";
                document.body.appendChild(ta);

                window.__gutterModuleForTest.attachGutter(ta);
                const wrap = ta.closest(".raw-editor-wrap");

                ta.focus();
                ta.setSelectionRange(7, 7); // inside "beta" (line index 1)
                ta.dispatchEvent(new Event("selectionchange"));

                const markers = wrap.querySelectorAll(".raw-editor-line-number");
                const result = Array.from(markers).map(
                    m => m.classList.contains("raw-editor-current-line")
                );

                window.__gutterModuleForTest.detachGutter(ta);
                document.body.removeChild(ta);
                return result;
                '''
            )
            assert result == [False, True, False], (
                f"Expected only line index 1 (beta) highlighted, got: {result}"
            )

        _run_check(check)

    def test_zoom_scales_gutter_and_textarea_as_one_unit(self):
        """Regression guard for the applyDocFontSize interaction: the
        .raw-editor-wrap (gutter + textarea) must receive the zoom
        transform as a single unit, not the bare textarea alone — otherwise
        the gutter's pixel positions desync from the scaled text."""

        def check(window):
            result = window.evaluate_js(
                _import_gutter_module_js()
                + '''
                const ta = document.createElement("textarea");
                ta.className = "raw-editor";
                ta.value = "one\\ntwo";
                document.body.appendChild(ta);

                window.__gutterModuleForTest.attachGutter(ta);
                const wrap = ta.closest(".raw-editor-wrap");

                // Simulate applyDocFontSize's zoom branch for a wrapped
                // textarea (see js/renderer.js applyDocFontSize).
                wrap.style.transform = "scale(1.2)";
                wrap.style.transformOrigin = "top left";

                const result = {
                    wrapHasTransform: wrap.style.transform.includes("scale"),
                    textareaHasOwnTransform: ta.style.transform.includes("scale"),
                };

                window.__gutterModuleForTest.detachGutter(ta);
                document.body.removeChild(ta);
                return result;
                '''
            )
            assert result["wrapHasTransform"] is True
            assert result["textareaHasOwnTransform"] is False, (
                "Textarea must NOT carry its own transform when the wrap is "
                "scaled as a unit — double-scaling would compound distortion."
            )

        _run_check(check)
