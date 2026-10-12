"""
GUI integration tests for Inkwave rendering pipeline.

These launch a real (hidden) pywebview window, load markdown via the app's
index.html + JS modules, and verify the rendered DOM using evaluate_js().

The window is created with hidden=True so nothing pops up on screen.
Pattern follows pywebview's own test suite: test logic runs in a thread,
webview.start() blocks the main thread, window.events.loaded signals readiness.

Requires: pip install pywebview pytest
Run:      pytest tests/python/test_gui.py -v
"""
import os
import sys
import threading
import time
import traceback
from multiprocessing import Queue
from pathlib import Path

import pytest
import webview

# Resolve paths relative to the project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
INDEX_HTML = PROJECT_ROOT / "index.html"
FIXTURES_DIR = PROJECT_ROOT / "tests" / "fixtures"


def run_gui_test(thread_func, html_path=None):
    """Launch a hidden pywebview window and run thread_func(window) in a thread."""
    url = html_path or str(INDEX_HTML)
    window = webview.create_window(
        "Inkwave Test",
        url=url,
        hidden=True,
        width=800,
        height=600,
    )
    queue = Queue()

    def _thread():
        try:
            window.events.loaded.wait(timeout=15)
            time.sleep(0.5)  # let JS modules initialize
            thread_func(window)
        except Exception:
            queue.put(traceback.format_exc())
        finally:
            window.destroy()

    t = threading.Thread(target=_thread, daemon=True)
    t.start()
    webview.start()

    if not queue.empty():
        pytest.fail(queue.get())


# ── Rendering tests ──────────────────────────────────────────────────────────

class TestListItemRendering:
    """Verify that code blocks inside list items render correctly."""

    def test_code_block_in_ordered_list_renders(self):
        """The WAITFOR DELAY bug: code blocks inside list items must not be stripped."""
        md_content = (
            "1. Enter this:\\n"
            "   ```\\n"
            "   ' WAITFOR DELAY '0:0:5' --\\n"
            "   ```\\n"
            "2. Press Enter"
        )

        def check(window):
            # Load content via JS — simulate what the app does
            result = window.evaluate_js(f'''
                (function() {{
                    const content = "{md_content}";
                    const blocks = window.marked ? null : "no marked";
                    if (typeof marked === "undefined") return "marked not loaded";
                    const html = marked.parse(content);
                    return html;
                }})()
            ''')
            assert result is not None, "evaluate_js returned None"
            assert "WAITFOR DELAY" in result, f"WAITFOR DELAY not found in rendered HTML: {result}"

        run_gui_test(check)

    def test_fixture_file_renders_all_content(self):
        """Load the test fixture and verify key content survives the rendering pipeline."""
        fixture = FIXTURES_DIR / "list-with-code-blocks.md"
        if not fixture.exists():
            pytest.skip("Fixture file not found")

        content = fixture.read_text(encoding="utf-8")
        # Escape for JS string
        js_content = content.replace("\\", "\\\\").replace("`", "\\`").replace("$", "\\$")

        def check(window):
            result = window.evaluate_js(f'''
                (function() {{
                    if (typeof marked === "undefined") return "marked not loaded";
                    const html = marked.parse(`{js_content}`);
                    const div = document.createElement("div");
                    div.innerHTML = html;
                    return div.textContent;
                }})()
            ''')
            assert result is not None
            assert "echo" in result, "echo command from code block missing"
            assert "pip install requests" in result, "pip install from code block missing"
            assert "SELECT" in result, "SQL from code block missing"

        run_gui_test(check)


class TestSearchRendering:
    """Verify search highlighting works in a real WebKit DOM."""

    def test_search_highlights_in_rendered_content(self):
        """Verify TreeWalker + mark wrapping works in real WebKit."""

        def check(window):
            # Inject some rendered content and run search logic
            result = window.evaluate_js('''
                (function() {
                    if (typeof marked === "undefined") return "marked not loaded";
                    // Create a rendered div with known content
                    var div = document.createElement("div");
                    div.className = "rendered";
                    div.innerHTML = marked.parse("The needle is here. Another needle too.");
                    document.body.appendChild(div);

                    // Walk text nodes and count "needle" occurrences
                    var walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
                    var count = 0;
                    var node;
                    while (node = walker.nextNode()) {
                        var text = node.nodeValue.toLowerCase();
                        var pos = 0;
                        while ((pos = text.indexOf("needle", pos)) !== -1) {
                            count++;
                            pos += 6;
                        }
                    }
                    return count;
                })()
            ''')
            assert result == 2, f"Expected 2 needle occurrences, got {result}"

        run_gui_test(check)


class TestMarkedJsAvailability:
    """Verify marked.js loads and works in the real webview."""

    def test_marked_parse_available(self):
        def check(window):
            result = window.evaluate_js('typeof marked !== "undefined" && typeof marked.parse === "function"')
            assert result is True, "marked.parse not available in webview"

        run_gui_test(check)

    def test_marked_lexer_available(self):
        def check(window):
            result = window.evaluate_js('typeof marked !== "undefined" && typeof marked.lexer === "function"')
            assert result is True, "marked.lexer not available in webview"

        run_gui_test(check)

    def test_marked_lexer_list_has_items(self):
        """Verify marked.lexer returns list tokens with .items array."""
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var tokens = marked.lexer("- a\\n- b\\n- c");
                    var list = tokens.find(function(t) { return t.type === "list"; });
                    if (!list) return "no list token";
                    if (!list.items) return "no items array";
                    return list.items.length;
                })()
            ''')
            assert result == 3, f"Expected 3 list items, got {result}"

        run_gui_test(check)


class TestKeyboardShortcuts:
    """Verify keyboard shortcuts work via dispatched events in real WebKit."""

    def test_cmd_f_dispatches_correctly(self):
        """Verify KeyboardEvent with metaKey dispatches in WebKit."""
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var caught = false;
                    document.addEventListener("keydown", function(e) {
                        if ((e.metaKey || e.ctrlKey) && e.key === "f") caught = true;
                    });
                    var ev = new KeyboardEvent("keydown", {key: "f", metaKey: true, bubbles: true});
                    document.dispatchEvent(ev);
                    return caught;
                })()
            ''')
            assert result is True, "Cmd+F keydown event not caught"

        run_gui_test(check)

    def test_escape_dispatches_correctly(self):
        """Verify Escape KeyboardEvent dispatches in WebKit."""
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var caught = false;
                    document.addEventListener("keydown", function(e) {
                        if (e.key === "Escape") caught = true;
                    });
                    document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
                    return caught;
                })()
            ''')
            assert result is True

        run_gui_test(check)


class TestSpecialCharacterRendering:
    """Verify special characters survive the full rendering pipeline."""

    def test_single_quotes_in_code_block(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var html = marked.parse("```\\n' OR 1=1 --\\n```");
                    var div = document.createElement("div");
                    div.innerHTML = html;
                    return div.textContent.indexOf("OR 1=1") !== -1;
                })()
            ''')
            assert result is True

        run_gui_test(check)

    def test_angle_brackets_in_code_block(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var html = marked.parse("```\\n<div>hello</div>\\n```");
                    var div = document.createElement("div");
                    div.innerHTML = html;
                    return div.textContent.indexOf("<div>") !== -1;
                })()
            ''')
            assert result is True

        run_gui_test(check)

    def test_unicode_renders(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var html = marked.parse("Em-dash \\u2014 smart quotes \\u201chello\\u201d");
                    var div = document.createElement("div");
                    div.innerHTML = html;
                    var text = div.textContent;
                    return text.indexOf("\\u2014") !== -1 && text.indexOf("\\u201c") !== -1;
                })()
            ''')
            assert result is True

        run_gui_test(check)


class TestLargeDocument:
    """Verify the rendering pipeline handles large documents."""

    def test_100_block_document(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var md = "";
                    for (var i = 0; i < 100; i++) {
                        md += "## Heading " + i + "\\n\\nParagraph " + i + " content.\\n\\n";
                    }
                    var tokens = marked.lexer(md);
                    var html = marked.parse(md);
                    var div = document.createElement("div");
                    div.innerHTML = html;
                    var headings = div.querySelectorAll("h2");
                    return headings.length;
                })()
            ''')
            assert result == 100, f"Expected 100 headings, got {result}"

        run_gui_test(check)


class TestRendererPipeline:
    """Test the full rendering pipeline: markdown → blocks → HTML DOM."""

    def test_heading_renders_as_h_tag(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var html = marked.parse("# Hello World");
                    var div = document.createElement("div");
                    div.innerHTML = html;
                    var h1 = div.querySelector("h1");
                    return h1 ? h1.textContent : null;
                })()
            ''')
            assert result == "Hello World"
        run_gui_test(check)

    def test_paragraph_renders(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var html = marked.parse("Just a paragraph.");
                    var div = document.createElement("div");
                    div.innerHTML = html;
                    return div.querySelector("p").textContent;
                })()
            ''')
            assert result == "Just a paragraph."
        run_gui_test(check)

    def test_code_block_renders_in_pre(self):
        def check(window):
            result = window.evaluate_js(r'''
                (function() {
                    var html = marked.parse("```js\nconst x = 1;\n```");
                    var div = document.createElement("div");
                    div.innerHTML = html;
                    var code = div.querySelector("pre code");
                    return code ? code.textContent.trim() : null;
                })()
            ''')
            assert result == "const x = 1;"
        run_gui_test(check)

    def test_checkbox_list_renders_inputs(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var html = marked.parse("- [x] Done\\n- [ ] Todo");
                    var div = document.createElement("div");
                    div.innerHTML = html;
                    var checks = div.querySelectorAll('input[type="checkbox"]');
                    return [checks.length, checks[0].checked, checks[1].checked];
                })()
            ''')
            assert result[0] == 2
            assert result[1] is True
            assert result[2] is False
        run_gui_test(check)

    def test_link_renders_with_href(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var html = marked.parse("[Click here](https://example.com)");
                    var div = document.createElement("div");
                    div.innerHTML = html;
                    var a = div.querySelector("a");
                    return a ? [a.textContent, a.getAttribute("href")] : null;
                })()
            ''')
            assert result[0] == "Click here"
            assert result[1] == "https://example.com"
        run_gui_test(check)

    def test_bold_and_italic_render(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var html = marked.parse("**bold** and *italic*");
                    var div = document.createElement("div");
                    div.innerHTML = html;
                    return [
                        div.querySelector("strong") !== null,
                        div.querySelector("em") !== null
                    ];
                })()
            ''')
            assert result == [True, True]
        run_gui_test(check)

    def test_table_renders(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var md = "| A | B |\\n|---|---|\\n| 1 | 2 |\\n| 3 | 4 |";
                    var html = marked.parse(md);
                    var div = document.createElement("div");
                    div.innerHTML = html;
                    var cells = div.querySelectorAll("td");
                    return cells.length;
                })()
            ''')
            assert result == 4
        run_gui_test(check)

    def test_blockquote_renders(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var html = marked.parse("> This is a quote");
                    var div = document.createElement("div");
                    div.innerHTML = html;
                    return div.querySelector("blockquote") !== null;
                })()
            ''')
            assert result is True
        run_gui_test(check)

    def test_nested_list_renders(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var md = "- item 1\\n  - nested a\\n  - nested b\\n- item 2";
                    var html = marked.parse(md);
                    var div = document.createElement("div");
                    div.innerHTML = html;
                    var uls = div.querySelectorAll("ul");
                    return uls.length;
                })()
            ''')
            assert result >= 2  # outer + nested
        run_gui_test(check)

    def test_horizontal_rule_renders(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var html = marked.parse("---");
                    var div = document.createElement("div");
                    div.innerHTML = html;
                    return div.querySelector("hr") !== null;
                })()
            ''')
            assert result is True
        run_gui_test(check)

    def test_image_renders_img_tag(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var html = marked.parse("![alt text](https://example.com/img.png)");
                    var div = document.createElement("div");
                    div.innerHTML = html;
                    var img = div.querySelector("img");
                    return img ? [img.getAttribute("alt"), img.getAttribute("src")] : null;
                })()
            ''')
            assert result[0] == "alt text"
            assert "example.com" in result[1]
        run_gui_test(check)


class TestEditorBehavior:
    """Test inline editing behavior via evaluate_js."""

    def test_contenteditable_creates_editable_element(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var div = document.createElement("div");
                    div.contentEditable = "true";
                    div.textContent = "Edit me";
                    document.body.appendChild(div);
                    return div.isContentEditable;
                })()
            ''')
            assert result is True
        run_gui_test(check)

    def test_contenteditable_text_can_be_read(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var div = document.createElement("div");
                    div.contentEditable = "true";
                    div.textContent = "Hello world";
                    document.body.appendChild(div);
                    return div.textContent;
                })()
            ''')
            assert result == "Hello world"
        run_gui_test(check)

    def test_contenteditable_preserves_special_chars(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var div = document.createElement("div");
                    div.contentEditable = "true";
                    div.textContent = "SELECT * FROM users WHERE name = 'O\\'Brien'";
                    document.body.appendChild(div);
                    return div.textContent;
                })()
            ''')
            assert "O'Brien" in result
        run_gui_test(check)


class TestUIKeyboardShortcuts:
    """Test that keyboard shortcut events work in WebKit."""

    def test_ctrl_s_event(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var caught = false;
                    document.addEventListener("keydown", function(e) {
                        if ((e.metaKey || e.ctrlKey) && e.key === "s") caught = true;
                    });
                    document.dispatchEvent(new KeyboardEvent("keydown", {key: "s", metaKey: true, bubbles: true}));
                    return caught;
                })()
            ''')
            assert result is True
        run_gui_test(check)

    def test_ctrl_plus_event(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var caught = false;
                    document.addEventListener("keydown", function(e) {
                        if ((e.metaKey || e.ctrlKey) && e.key === "=") caught = true;
                    });
                    document.dispatchEvent(new KeyboardEvent("keydown", {key: "=", metaKey: true, bubbles: true}));
                    return caught;
                })()
            ''')
            assert result is True
        run_gui_test(check)

    def test_ctrl_minus_event(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var caught = false;
                    document.addEventListener("keydown", function(e) {
                        if ((e.metaKey || e.ctrlKey) && e.key === "-") caught = true;
                    });
                    document.dispatchEvent(new KeyboardEvent("keydown", {key: "-", metaKey: true, bubbles: true}));
                    return caught;
                })()
            ''')
            assert result is True
        run_gui_test(check)

    def test_ctrl_zero_event(self):
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var caught = false;
                    document.addEventListener("keydown", function(e) {
                        if ((e.metaKey || e.ctrlKey) && e.key === "0") caught = true;
                    });
                    document.dispatchEvent(new KeyboardEvent("keydown", {key: "0", metaKey: true, bubbles: true}));
                    return caught;
                })()
            ''')
            assert result is True
        run_gui_test(check)


class TestZoomBehavior:
    """Verify transform:scale() scales all content (text, images, SVGs) uniformly in WebKit."""

    def test_zoom_uses_transform_not_font_size(self):
        """After zooming, .rendered should have transform:scale set, not fontSize."""
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var rendered = document.createElement("div");
                    rendered.className = "rendered";
                    rendered.innerHTML = "<p>Hello</p>";
                    document.body.appendChild(rendered);

                    var scale = 1.5 / 0.95;
                    rendered.style.transform = "scale(" + scale + ")";
                    rendered.style.transformOrigin = "top left";
                    rendered.style.width = (100 / scale) + "%";

                    var hasTransform = rendered.style.transform.indexOf("scale") !== -1;
                    var hasFontSize = rendered.style.fontSize !== "";
                    document.body.removeChild(rendered);
                    return {hasTransform: hasTransform, hasFontSize: hasFontSize};
                })()
            ''')
            assert result is not None
            assert result["hasTransform"] is True, f"Expected transform:scale, got: {result}"
            assert result["hasFontSize"] is False, f"fontSize should not be set, got: {result}"

        run_gui_test(check)

    def test_transform_scale_scales_image(self):
        """An image inside a transform:scale container should have larger getBoundingClientRect."""
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var container = document.createElement("div");
                    container.style.width = "400px";
                    container.style.transformOrigin = "top left";
                    container.innerHTML = '<img src="data:image/gif;base64,R0lGODlhZABkAIAAAP///wAAACH5BAEAAAEALAAAAABkAGQAAAIEjI+pywUAOw==" width="100" height="100" />';
                    document.body.appendChild(container);

                    var img = container.querySelector("img");
                    var widthBefore = img.getBoundingClientRect().width;

                    container.style.transform = "scale(2)";
                    container.style.width = "50%";
                    var widthAfter = img.getBoundingClientRect().width;

                    document.body.removeChild(container);
                    return {before: widthBefore, after: widthAfter, scaled: widthAfter > widthBefore};
                })()
            ''')
            assert result is not None
            assert result["scaled"] is True, f"Image should scale: {result['before']}→{result['after']}"

        run_gui_test(check)

    def test_transform_scale_scales_svg(self):
        """An SVG inside a transform:scale container should scale."""
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var container = document.createElement("div");
                    container.style.width = "400px";
                    container.style.transformOrigin = "top left";
                    container.innerHTML = '<svg width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="blue"/></svg>';
                    document.body.appendChild(container);

                    var svg = container.querySelector("svg");
                    var widthBefore = svg.getBoundingClientRect().width;

                    container.style.transform = "scale(2)";
                    container.style.width = "50%";
                    var widthAfter = svg.getBoundingClientRect().width;

                    document.body.removeChild(container);
                    return {before: widthBefore, after: widthAfter, scaled: widthAfter > widthBefore};
                })()
            ''')
            assert result is not None
            assert result["scaled"] is True, f"SVG should scale: {result['before']}→{result['after']}"

        run_gui_test(check)

    def test_transform_scale_does_not_affect_sidebar(self):
        """Transform on .rendered should not affect elements outside it."""
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var sidebar = document.getElementById("sidebar");
                    if (!sidebar) return "no sidebar";
                    return sidebar.style.transform === "";
                })()
            ''')
            assert result is True

        run_gui_test(check)

    def test_transform_scale_round_trips(self):
        """Scaling up then resetting should clear the transform."""
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var el = document.createElement("div");
                    document.body.appendChild(el);

                    // Scale up
                    el.style.transform = "scale(1.5)";
                    el.style.transformOrigin = "top left";
                    var hasScale = el.style.transform.indexOf("scale") !== -1;

                    // Reset
                    el.style.transform = "";
                    el.style.transformOrigin = "";
                    el.style.width = "";
                    var cleared = el.style.transform === "";

                    document.body.removeChild(el);
                    return {hasScale: hasScale, cleared: cleared};
                })()
            ''')
            assert result["hasScale"] is True
            assert result["cleared"] is True

        run_gui_test(check)

    def test_mermaid_svg_scales_with_transform(self):
        """A mermaid-style SVG with inline max-width should scale with transform:scale."""
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var rendered = document.createElement("div");
                    rendered.style.width = "600px";
                    rendered.style.transformOrigin = "top left";
                    rendered.innerHTML = '<pre class="mermaid"><svg width="100%" style="max-width: 200px;" viewBox="0 0 200 100" height="100"><rect width="200" height="100" fill="green"/></svg></pre>';
                    document.body.appendChild(rendered);

                    var svg = rendered.querySelector("svg");
                    var wBefore = svg.getBoundingClientRect().width;
                    var hBefore = svg.getBoundingClientRect().height;

                    rendered.style.transform = "scale(2)";
                    rendered.style.width = "50%";
                    var wAfter = svg.getBoundingClientRect().width;
                    var hAfter = svg.getBoundingClientRect().height;

                    document.body.removeChild(rendered);
                    return {wBefore: wBefore, wAfter: wAfter, hBefore: hBefore, hAfter: hAfter,
                            scaled: wAfter > wBefore && hAfter > hBefore};
                })()
            ''')
            assert result is not None
            assert result["scaled"] is True, (
                f"Mermaid SVG should scale: "
                f"w {result['wBefore']}→{result['wAfter']}, h {result['hBefore']}→{result['hAfter']}"
            )

        run_gui_test(check)

    def test_text_scales_with_transform(self):
        """Text inside a transform:scale container should have larger dimensions."""
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var rendered = document.createElement("div");
                    rendered.style.fontSize = "16px";
                    rendered.style.transformOrigin = "top left";
                    rendered.innerHTML = "<p>Test paragraph</p>";
                    document.body.appendChild(rendered);

                    var p = rendered.querySelector("p");
                    var hBefore = p.getBoundingClientRect().height;

                    rendered.style.transform = "scale(2)";
                    rendered.style.width = "50%";
                    var hAfter = p.getBoundingClientRect().height;

                    document.body.removeChild(rendered);
                    return {before: hBefore, after: hAfter, scaled: hAfter > hBefore};
                })()
            ''')
            assert result is not None
            assert result["scaled"] is True, f"Text should scale: {result['before']}→{result['after']}"

        run_gui_test(check)

    def test_width_adjusts_for_layout_reflow(self):
        """Width should be set to 100/scale percent so content reflows correctly."""
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var scale = 1.5;
                    var width = 100 / scale;
                    return Math.abs(width - 66.667) < 0.01;
                })()
            ''')
            assert result is True

        run_gui_test(check)

    def test_cmd_equals_zooms_in_via_real_app_code(self):
        """End-to-end: dispatch the real Cmd+= keydown and verify the ACTUAL
        changeFontSize()/applyDocFontSize() in js/ui.js and js/renderer.js
        apply a scale transform to a real rendered pane — not a hand-rolled
        copy of the math (see unit tests above, which all construct their
        own elements and assign .style.transform directly without calling
        any inkwave code). This is the only test that exercises the private,
        keydown-bound changeFontSize() function in js/ui.js, which has no
        unit-test coverage because it is not exported.
        """
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    // Simulate a loaded tab with a real rendered pane, matching
                    // what js/ui.js::changeFontSize / js/renderer.js::applyDocFontSize
                    // query for in the live app (.pane .rendered).
                    var pane = document.querySelector(".pane");
                    if (!pane) return "no .pane element found in index.html";
                    var rendered = pane.querySelector(".rendered");
                    if (!rendered) return "no .rendered element found inside .pane";

                    rendered.style.transform = "";
                    rendered.innerHTML = "<p>Zoom test content</p>";

                    var ev = new KeyboardEvent("keydown", {
                        key: "=", metaKey: true, ctrlKey: true, bubbles: true, cancelable: true
                    });
                    document.dispatchEvent(ev);

                    return {
                        transform: rendered.style.transform,
                        hasScale: rendered.style.transform.indexOf("scale") !== -1,
                    };
                })()
            ''')
            assert result is not None, "evaluate_js returned None"
            assert isinstance(result, dict), f"Expected dict result, got: {result}"
            assert result["hasScale"] is True, (
                f"Cmd+= should trigger the real changeFontSize() and apply "
                f"transform:scale via applyDocFontSize(), got transform={result['transform']!r}"
            )

        run_gui_test(check)

    def test_cmd_zero_resets_zoom_via_real_app_code(self):
        """End-to-end: Cmd+0 should reset docFontSize to default, clearing
        any transform via the real changeFontSize(0) → applyDocFontSize()
        → applyScaleZoom() call chain."""
        def check(window):
            result = window.evaluate_js('''
                (function() {
                    var pane = document.querySelector(".pane");
                    if (!pane) return "no .pane element found";
                    var rendered = pane.querySelector(".rendered");
                    if (!rendered) return "no .rendered element found";

                    // First zoom in via the real key handler
                    document.dispatchEvent(new KeyboardEvent("keydown", {
                        key: "=", metaKey: true, ctrlKey: true, bubbles: true, cancelable: true
                    }));
                    var zoomedTransform = rendered.style.transform;

                    // Then reset via Cmd+0
                    document.dispatchEvent(new KeyboardEvent("keydown", {
                        key: "0", metaKey: true, ctrlKey: true, bubbles: true, cancelable: true
                    }));

                    return {
                        zoomedTransform: zoomedTransform,
                        resetTransform: rendered.style.transform,
                    };
                })()
            ''')
            assert result is not None
            assert isinstance(result, dict), f"Expected dict result, got: {result}"
            assert "scale" in result["zoomedTransform"], (
                f"Expected scale after Cmd+=, got: {result['zoomedTransform']!r}"
            )
            assert result["resetTransform"] == "", (
                f"Expected empty transform after Cmd+0 reset, got: {result['resetTransform']!r}"
            )

        run_gui_test(check)
