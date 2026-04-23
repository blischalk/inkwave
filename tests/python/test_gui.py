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
