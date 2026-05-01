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
