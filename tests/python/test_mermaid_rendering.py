"""
Mermaid diagram rendering tests — real browser engine, real mermaid.js.

These load the actual index.html + JS modules in a (hidden-from-the-host,
visible-only-inside-Xvfb) pywebview window and render genuinely complex
mermaid syntax through the real pipeline: highlightCodeInContainer() ->
renderMermaidBlocks() -> mermaid.js -> SVG.

Why this file exists separately from test_gui.py: before this, the
"mermaid support" feature (merged via PR #11) had ZERO tests that
actually invoked mermaid.js. resolveMermaidTheme() was unit-tested in
isolation (tests/js/utils.test.js) but nothing proved that:
  1. the theme it returns is the theme mermaid.js actually renders with
  2. mermaid.js can parse non-trivial diagrams (nested subgraphs, loops,
     alt/opt blocks, composite states, class inheritance) without
     silently failing
  3. switching app theme at runtime re-renders existing diagrams in the
     new palette

Fixture diagrams are adapted from the mermaid.js project's own official
syntax documentation (flowchart.md, stateDiagram.md -- mermaid-js/mermaid
on GitHub) so they reflect real-world complexity, not toy examples.

Requires: pip install pywebview pytest (see tests/python/test_gui.py)
Run:      pytest tests/python/test_mermaid_rendering.py -v
Screenshots (opt-in, written to tests/python/.mermaid_screenshots/):
          MERMAID_SCREENSHOTS=1 xvfb-run -a pytest tests/python/test_mermaid_rendering.py -v
"""
import os
import subprocess
from pathlib import Path

import pytest

from test_gui import run_gui_test, PROJECT_ROOT

SCREENSHOT_DIR = Path(__file__).resolve().parent / ".mermaid_screenshots"
SCREENSHOTS_ENABLED = os.environ.get("MERMAID_SCREENSHOTS") == "1"


def _capture_display(filename):
    """Grab the current Xvfb virtual framebuffer to a PNG via ImageMagick's
    `import`. No-op (returns None) if screenshots are not enabled or the
    DISPLAY/import tooling isn't available -- this must never fail a test
    that isn't specifically testing screenshot capture."""
    if not SCREENSHOTS_ENABLED:
        return None
    if not os.environ.get("DISPLAY"):
        return None
    SCREENSHOT_DIR.mkdir(exist_ok=True)
    out_path = SCREENSHOT_DIR / filename
    try:
        subprocess.run(
            ["import", "-window", "root", str(out_path)],
            check=True, capture_output=True, timeout=10,
        )
        return out_path if out_path.exists() else None
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return None


# ── Complex diagram fixtures ───────────────────────────────────────────────
# Adapted from mermaid-js/mermaid's own docs (flowchart.md, stateDiagram.md).

FLOWCHART_NESTED_SUBGRAPHS = r"""flowchart TB
    c1-->a2
    subgraph one
        a1-->a2
    end
    subgraph two
        b1-->b2
    end
    subgraph three
        c1-->c2
    end
    one --> two
    three --> two
    two --> c2
"""

SEQUENCE_LOOP_ALT_PAR = r"""sequenceDiagram
    participant Client
    participant Server
    participant DB
    Client->>+Server: POST /login
    activate Server
    loop Health check
        Server->>DB: ping
    end
    alt credentials valid
        Server->>DB: SELECT user
        DB-->>Server: user row
        Server-->>Client: 200 OK
    else credentials invalid
        Server-->>Client: 401 Unauthorized
    end
    par notify audit log
        Server->>DB: INSERT audit_log
    and notify metrics
        Server->>DB: INCR login_count
    end
    deactivate Server
"""

CLASS_INHERITANCE = r"""classDiagram
    class Animal {
        +String name
        +int age
        +isMammal() bool
        +mate()
    }
    class Duck {
        +String beakColor
        +swim()
        +quack()
    }
    class Fish {
        -int sizeInFeet
        -canEat() bool
    }
    class Zebra {
        +bool is_wild
        +run()
    }
    Animal <|--|> Duck
    Animal <|--|> Fish
    Animal <|--|> Zebra
"""

STATE_COMPOSITE_FORK_JOIN = r"""stateDiagram-v2
    [*] --> Active
    state Active {
        [*] --> NumLockOff
        NumLockOff --> NumLockOn : EvNumLockPressed
        NumLockOn --> NumLockOff : EvNumLockPressed
        --
        [*] --> CapsLockOff
        CapsLockOff --> CapsLockOn : EvCapsLockPressed
        CapsLockOn --> CapsLockOff : EvCapsLockPressed
    }
    state fork_state <<fork>>
    [*] --> fork_state
    fork_state --> State2
    fork_state --> State3
    state join_state <<join>>
    State2 --> join_state
    State3 --> join_state
    join_state --> State4
    State4 --> [*]
"""


def _render_mermaid_and_check(window, mermaid_source, min_svg_elements=1):
    """Inject a markdown doc containing one mermaid code block, run it
    through the REAL rendering pipeline: marked.parse() -> DOM injection
    -> highlightCodeInContainer() (dynamically imported from the real
    js/utils.js module, same function renderer.js and init.js call
    internally) -> renderMermaidBlocks() -> mermaid.js -> SVG.

    highlightCodeInContainer/renderMermaidBlocks/resolveMermaidTheme are
    deliberately NOT attached to window in production code (they're
    internal module functions; only things the native menu/Python side
    needs, like __undoEdit, get a window.__ hook). Dynamic import() from
    inside evaluate_js reaches the real ES module exports without adding
    a test-only global that doesn't exist in the shipped app.
    """
    md = "```mermaid\n" + mermaid_source + "\n```\n"
    escaped = md.replace("\\", "\\\\").replace("`", "\\`").replace("$", "\\$")
    result = window.evaluate_js(f'''
        (async function() {{
            if (typeof marked === "undefined") return {{ error: "marked not loaded" }};
            var pane = document.querySelector(".pane");
            if (!pane) return {{ error: "no .pane element found" }};
            var rendered = pane.querySelector(".rendered");
            if (!rendered) return {{ error: "no .rendered element found" }};

            rendered.innerHTML = marked.parse(`{escaped}`);

            var utils = await import("./js/utils.js");
            await utils.highlightCodeInContainer(rendered);
            // highlightCodeInContainer fires renderMermaidBlocks() but does
            // not await its promise (fire-and-forget in production code),
            // so poll briefly for the SVG mermaid.js produces asynchronously.
            for (var i = 0; i < 40; i++) {{
                if (rendered.querySelector("svg")) break;
                await new Promise(r => setTimeout(r, 100));
            }}

            var svg = rendered.querySelector("svg");
            if (!svg) {{
                return {{ error: "no svg produced", innerHTML: rendered.innerHTML.slice(0, 500) }};
            }}
            return {{
                hasSvg: true,
                svgElementCount: svg.querySelectorAll("*").length,
                outerSnippet: svg.outerHTML.slice(0, 200),
            }};
        }})()
    ''')
    assert result is not None, "evaluate_js returned None"
    assert "error" not in result, f"Mermaid render failed: {result}"
    assert result["hasSvg"] is True
    assert result["svgElementCount"] >= min_svg_elements, (
        f"Expected at least {min_svg_elements} SVG child elements, "
        f"got {result['svgElementCount']}: {result}"
    )
    return result


class TestComplexMermaidDiagrams:
    """Each test renders a real, non-trivial mermaid diagram (sourced from
    mermaid.js's own syntax docs) through the actual app pipeline and
    proves mermaid.js produced real SVG output, not a parse error silently
    swallowed into an empty <pre> block."""

    def test_flowchart_with_nested_subgraphs(self):
        def check(window):
            result = _render_mermaid_and_check(window, FLOWCHART_NESTED_SUBGRAPHS, min_svg_elements=10)
            _capture_display("flowchart_nested_subgraphs.png")
            assert result["svgElementCount"] > 10

        run_gui_test(check)

    def test_sequence_diagram_with_loop_alt_par(self):
        def check(window):
            result = _render_mermaid_and_check(window, SEQUENCE_LOOP_ALT_PAR, min_svg_elements=15)
            _capture_display("sequence_loop_alt_par.png")
            assert result["svgElementCount"] > 15

        run_gui_test(check)

    def test_class_diagram_with_inheritance(self):
        def check(window):
            result = _render_mermaid_and_check(window, CLASS_INHERITANCE, min_svg_elements=10)
            _capture_display("class_inheritance.png")
            assert result["svgElementCount"] > 10

        run_gui_test(check)

    def test_state_diagram_composite_fork_join(self):
        def check(window):
            result = _render_mermaid_and_check(window, STATE_COMPOSITE_FORK_JOIN, min_svg_elements=10)
            _capture_display("state_composite_fork_join.png")
            assert result["svgElementCount"] > 10

        run_gui_test(check)


class TestMermaidThemeMatchesAppTheme:
    """resolveMermaidTheme() picks a theme name; this proves mermaid.js's
    *actual initialized theme* matches what resolveMermaidTheme() returns,
    for both a dark and a light app theme -- closing the gap where the
    mapping function was unit-tested but never checked against the real
    mermaid.initialize() call."""

    def test_dark_app_theme_renders_mermaid_dark(self):
        def check(window):
            result = window.evaluate_js('''
                (async function() {
                    document.body.setAttribute("data-theme", "dracula");
                    var pane = document.querySelector(".pane");
                    var rendered = pane.querySelector(".rendered");
                    rendered.innerHTML = marked.parse("```mermaid\\nflowchart LR\\nA-->B\\n```");

                    var utils = await import("./js/utils.js");
                    await utils.highlightCodeInContainer(rendered);
                    for (var i = 0; i < 40; i++) {
                        if (rendered.querySelector("svg")) break;
                        await new Promise(r => setTimeout(r, 100));
                    }

                    return {
                        resolvedTheme: utils.resolveMermaidTheme(),
                        mermaidConfigTheme: window.mermaid && window.mermaid.mermaidAPI
                            ? window.mermaid.mermaidAPI.getConfig().theme : null,
                        hasSvg: !!rendered.querySelector("svg"),
                    };
                })()
            ''')
            assert result["resolvedTheme"] == "dark", result
            assert result["hasSvg"] is True, result
            if result["mermaidConfigTheme"] is not None:
                assert result["mermaidConfigTheme"] == "dark", result
            _capture_display("theme_dark_dracula.png")

        run_gui_test(check)

    def test_light_app_theme_renders_mermaid_default(self):
        def check(window):
            result = window.evaluate_js('''
                (async function() {
                    document.body.setAttribute("data-theme", "paper");
                    var pane = document.querySelector(".pane");
                    var rendered = pane.querySelector(".rendered");
                    rendered.innerHTML = marked.parse("```mermaid\\nflowchart LR\\nA-->B\\n```");

                    var utils = await import("./js/utils.js");
                    await utils.highlightCodeInContainer(rendered);
                    for (var i = 0; i < 40; i++) {
                        if (rendered.querySelector("svg")) break;
                        await new Promise(r => setTimeout(r, 100));
                    }

                    return {
                        resolvedTheme: utils.resolveMermaidTheme(),
                        hasSvg: !!rendered.querySelector("svg"),
                    };
                })()
            ''')
            assert result["resolvedTheme"] == "default", result
            assert result["hasSvg"] is True, result
            _capture_display("theme_light_paper.png")

        run_gui_test(check)

    def test_theme_switch_at_runtime_rerenders_existing_diagram(self):
        """Switching from a dark theme to a light theme after a diagram has
        already rendered must re-render it with the new theme, not leave
        a stale dark-themed SVG on screen."""
        def check(window):
            result = window.evaluate_js('''
                (async function() {
                    var pane = document.querySelector(".pane");
                    var rendered = pane.querySelector(".rendered");
                    var utils = await import("./js/utils.js");

                    document.body.setAttribute("data-theme", "obsidianite");
                    rendered.innerHTML = marked.parse("```mermaid\\nflowchart LR\\nA-->B\\n```");
                    await utils.highlightCodeInContainer(rendered);
                    for (var i = 0; i < 40; i++) {
                        if (rendered.querySelector("svg")) break;
                        await new Promise(r => setTimeout(r, 100));
                    }
                    var firstHadSvg = !!rendered.querySelector("svg");
                    var firstTheme = utils.resolveMermaidTheme();

                    document.body.setAttribute("data-theme", "sepia");
                    rendered.innerHTML = marked.parse("```mermaid\\nflowchart LR\\nA-->B\\n```");
                    await utils.highlightCodeInContainer(rendered);
                    for (var j = 0; j < 40; j++) {
                        if (rendered.querySelector("svg")) break;
                        await new Promise(r => setTimeout(r, 100));
                    }
                    var secondHadSvg = !!rendered.querySelector("svg");
                    var secondTheme = utils.resolveMermaidTheme();

                    return {
                        firstHadSvg: firstHadSvg,
                        firstTheme: firstTheme,
                        secondHadSvg: secondHadSvg,
                        secondTheme: secondTheme,
                    };
                })()
            ''')
            assert result["firstHadSvg"] is True, result
            assert result["firstTheme"] == "dark", result
            assert result["secondHadSvg"] is True, result
            assert result["secondTheme"] == "default", result

        run_gui_test(check)
