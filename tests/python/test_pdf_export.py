"""Tests for the pure helpers and PDF assembly in pdf_export.py."""
import os

import pytest
from markdown_it import MarkdownIt
from markdown_it.tree import SyntaxTreeNode
from reportlab.lib import colors

import pdf_export
from pdf_export import (
    parse_color,
    is_dark,
    highlight_code_markup,
    inline_to_markup,
    Theme,
    build_pdf,
)


def _first_inline(markdown):
    tokens = MarkdownIt("commonmark").enable(["table", "strikethrough"]).parse(markdown)
    tree = SyntaxTreeNode(tokens)
    paragraph = tree.children[0]
    return paragraph.children[0]


def _is_pdf(path):
    with open(path, "rb") as f:
        return f.read(5) == b"%PDF-"


# ── parse_color ────────────────────────────────────────────────────────────────

class TestParseColor:
    def test_short_hex(self):
        assert parse_color("#fff") == colors.HexColor("#ffffff")

    def test_full_hex(self):
        assert parse_color("#100e17") == colors.HexColor("#100e17")

    def test_rgb(self):
        c = parse_color("rgb(16, 14, 23)")
        assert round(c.red * 255) == 16 and round(c.green * 255) == 14 and round(c.blue * 255) == 23

    def test_rgba_ignores_alpha(self):
        c = parse_color("rgba(255, 0, 0, 0.5)")
        assert round(c.red * 255) == 255 and round(c.blue * 255) == 0

    def test_none_returns_default(self):
        sentinel = colors.black
        assert parse_color(None, sentinel) is sentinel

    def test_non_string_returns_default(self):
        assert parse_color(123, None) is None

    def test_garbage_returns_default(self):
        assert parse_color("not-a-color", None) is None

    def test_bad_hex_length_returns_default(self):
        assert parse_color("#12", None) is None

    def test_bad_rgb_numbers_return_default(self):
        assert parse_color("rgb(a, b, c)", None) is None


class TestIsDark:
    def test_dark_color(self):
        assert is_dark(colors.HexColor("#100e17")) is True

    def test_light_color(self):
        assert is_dark(colors.HexColor("#ffffff")) is False


# ── inline markup ────────────────────────────────────────────────────────────

class TestInlineToMarkup:
    def setup_method(self):
        self.theme = Theme({})

    def test_bold(self):
        assert inline_to_markup(_first_inline("**hi**"), self.theme) == "<b>hi</b>"

    def test_italic(self):
        assert inline_to_markup(_first_inline("_hi_"), self.theme) == "<i>hi</i>"

    def test_strikethrough(self):
        assert inline_to_markup(_first_inline("~~hi~~"), self.theme) == "<strike>hi</strike>"

    def test_inline_code_uses_mono_font(self):
        markup = inline_to_markup(_first_inline("`code`"), self.theme)
        assert "Courier" in markup and "code" in markup

    def test_link_has_href(self):
        markup = inline_to_markup(_first_inline("[text](https://example.com)"), self.theme)
        assert 'href="https://example.com"' in markup and "text" in markup

    def test_escapes_angle_brackets(self):
        markup = inline_to_markup(_first_inline("a < b & c"), self.theme)
        assert "&lt;" in markup and "&amp;" in markup

    def test_softbreak_becomes_space(self):
        assert inline_to_markup(_first_inline("a\nb"), self.theme) == "a b"

    def test_hardbreak_becomes_br(self):
        assert "<br/>" in inline_to_markup(_first_inline("a  \nb"), self.theme)

    def test_inline_image_renders_alt_text(self):
        markup = inline_to_markup(_first_inline("hi ![alt text](y.png)"), self.theme)
        assert "alt text" in markup


class TestParseColorEdgeCases:
    def test_invalid_hex_chars_return_default(self):
        assert parse_color("#gggggg", None) is None

    def test_rgb_with_too_few_values_returns_default(self):
        assert parse_color("rgb(1, 2)", None) is None


class TestHighlightCodeMarkup:
    def test_python_keywords_get_colored(self):
        markup = highlight_code_markup("def f():\n    return 1", "python", Theme({"code_bg": "#0d0b12"}))
        assert "<font color=" in markup
        assert "def" in markup

    def test_unknown_language_does_not_crash(self):
        markup = highlight_code_markup("plain text", "no-such-lang", Theme({}))
        assert "plain text" in markup


# ── build_pdf ────────────────────────────────────────────────────────────────

class TestBuildPdf:
    THEME = {"bg": "#100e17", "text": "#bebebe", "accent": "#0fb6d6"}

    def test_writes_a_valid_pdf(self, tmp_path):
        out = str(tmp_path / "out.pdf")
        build_pdf("# Title\n\nSome text.", self.THEME, out)
        assert os.path.isfile(out) and _is_pdf(out)

    def test_handles_empty_markdown(self, tmp_path):
        out = str(tmp_path / "empty.pdf")
        build_pdf("", self.THEME, out)
        assert _is_pdf(out)

    def test_renders_rich_document(self, tmp_path):
        out = str(tmp_path / "rich.pdf")
        md = (
            "# H1\n\n## H2\n\n- a\n- b\n  - nested\n\n1. one\n2. two\n\n"
            "- [x] done\n- [ ] todo\n\n> quote\n\n"
            "```python\ndef f():\n    return 1\n```\n\n"
            "| A | B |\n|:--|--:|\n| 1 | 2 |\n\n---\n\n**bold** _i_ `c` [l](https://x.com)\n"
        )
        build_pdf(md, self.THEME, out)
        assert _is_pdf(out)

    def test_embeds_local_svg_image(self, tmp_path):
        svg = tmp_path / "pic.svg"
        svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">'
                       '<rect width="40" height="40" fill="#0fb6d6"/></svg>')
        out = str(tmp_path / "img.pdf")
        build_pdf("![pic](pic.svg)", self.THEME, out, base_dir=str(tmp_path))
        assert _is_pdf(out)

    def test_skips_image_outside_base_dir(self, tmp_path):
        out = str(tmp_path / "trav.pdf")
        # Should not raise even though the path escapes the document folder.
        build_pdf("![x](../../etc/hosts)", self.THEME, out, base_dir=str(tmp_path))
        assert _is_pdf(out)

    def _png_b64(self, width=120, height=60):
        pil = pytest.importorskip("PIL.Image")
        import base64 as _b64, io as _io
        buf = _io.BytesIO()
        pil.new("RGB", (width, height), "#1f2335").save(buf, format="PNG")
        return _b64.b64encode(buf.getvalue()).decode("ascii")

    def test_embeds_mermaid_png(self, tmp_path):
        out = str(tmp_path / "mermaid.pdf")
        images = [{"data": self._png_b64(), "width": 120, "height": 60}]
        build_pdf("```mermaid\nflowchart LR\nA-->B\n```", self.THEME, out, mermaid_images=images)
        assert _is_pdf(out)

    def test_mermaid_image_is_actually_embedded_not_fallback(self, tmp_path):
        from reportlab.platypus import Table, Paragraph
        renderer = pdf_export.MarkdownPdfRenderer(
            Theme(self.THEME),
            mermaid_images=[{"data": self._png_b64(), "width": 120, "height": 60}],
        )
        flowables = renderer.render("```mermaid\nflowchart LR\nA-->B\n```")
        # A framed diagram is a Table; the placeholder would be a Paragraph.
        assert any(isinstance(f, Table) for f in flowables)
        assert not any(isinstance(f, Paragraph) for f in flowables)

    def test_raster_diagram_returns_image(self):
        from reportlab.platypus import Image
        renderer = pdf_export.MarkdownPdfRenderer(Theme(self.THEME))
        image = renderer._raster_diagram({"data": self._png_b64(), "width": 120})
        assert isinstance(image, Image)

    def test_tall_diagram_is_height_capped(self):
        renderer = pdf_export.MarkdownPdfRenderer(Theme(self.THEME))
        tall = self._png_b64(width=200, height=2400)
        image = renderer._raster_diagram({"data": tall, "width": 200})
        assert image.drawHeight <= pdf_export.CONTENT_HEIGHT
        # aspect preserved: a 200x2400 source stays ~12:1 tall after scaling
        assert abs(image.drawHeight / image.drawWidth - 12) < 0.1

    def test_mermaid_without_image_falls_back(self, tmp_path):
        out = str(tmp_path / "nomerm.pdf")
        build_pdf("```mermaid\nflowchart LR\nA-->B\n```", self.THEME, out, mermaid_images=[])
        assert _is_pdf(out)

    def test_mermaid_image_missing_data_falls_back(self, tmp_path):
        out = str(tmp_path / "nodata.pdf")
        build_pdf("```mermaid\nA-->B\n```", self.THEME, out, mermaid_images=[{}])
        assert _is_pdf(out)

    def test_invalid_mermaid_image_falls_back(self, tmp_path):
        out = str(tmp_path / "badmerm.pdf")
        build_pdf("```mermaid\nA-->B\n```", self.THEME, out, mermaid_images=[{"data": "!!notbase64"}])
        assert _is_pdf(out)

    def test_mermaid_image_without_width_uses_pixel_size(self, tmp_path):
        out = str(tmp_path / "nowidth.pdf")
        build_pdf("```mermaid\nA-->B\n```", self.THEME, out,
                  mermaid_images=[{"data": self._png_b64()}])
        assert _is_pdf(out)

    def test_svg_image_file_with_zero_dash_builds(self, tmp_path):
        svg = tmp_path / "dash.svg"
        svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40">'
                       '<line x1="0" y1="0" x2="80" y2="40" stroke="#888" stroke-dasharray="0"/></svg>')
        out = str(tmp_path / "dashimg.pdf")
        build_pdf("![d](dash.svg)", self.THEME, out, base_dir=str(tmp_path))
        assert _is_pdf(out)

    def test_skips_remote_and_missing_images(self, tmp_path):
        out = str(tmp_path / "remote.pdf")
        build_pdf("![a](http://x.com/a.png)\n\n![b](missing.png)", self.THEME, out,
                  base_dir=str(tmp_path))
        assert _is_pdf(out)

    def test_scales_down_oversized_raster_image(self, tmp_path):
        pil = pytest.importorskip("PIL.Image")
        png = tmp_path / "wide.png"
        pil.new("RGB", (3000, 200), "#0fb6d6").save(str(png))
        out = str(tmp_path / "raster.pdf")
        build_pdf("![w](wide.png)", self.THEME, out, base_dir=str(tmp_path))
        assert _is_pdf(out)

    def test_scales_down_oversized_svg(self, tmp_path):
        svg = tmp_path / "wide.svg"
        svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="200">'
                       '<rect width="3000" height="200" fill="#0fb6d6"/></svg>')
        out = str(tmp_path / "wsvg.pdf")
        build_pdf("![w](wide.svg)", self.THEME, out, base_dir=str(tmp_path))
        assert _is_pdf(out)

    def test_center_aligned_table_column(self, tmp_path):
        out = str(tmp_path / "center.pdf")
        build_pdf("| A | B | C |\n|:--|:-:|--:|\n| 1 | 2 | 3 |", self.THEME, out)
        assert _is_pdf(out)

    def test_ignores_unsupported_html_block(self, tmp_path):
        out = str(tmp_path / "html.pdf")
        build_pdf("<div>raw html</div>\n\ntext", self.THEME, out)
        assert _is_pdf(out)

    def test_image_without_base_dir_is_skipped(self, tmp_path):
        out = str(tmp_path / "nobase.pdf")
        build_pdf("![x](pic.png)", self.THEME, out, base_dir=None)
        assert _is_pdf(out)

    def test_corrupt_image_is_skipped(self, tmp_path):
        bad = tmp_path / "bad.png"
        bad.write_bytes(b"not really a png")
        out = str(tmp_path / "corrupt.pdf")
        build_pdf("![x](bad.png)", self.THEME, out, base_dir=str(tmp_path))
        assert _is_pdf(out)

    def test_non_image_file_reference_is_skipped(self, tmp_path):
        note = tmp_path / "note.md"
        note.write_text("# hi")
        out = str(tmp_path / "nonimg.pdf")
        build_pdf("![x](note.md)", self.THEME, out, base_dir=str(tmp_path))
        assert _is_pdf(out)

    def test_loose_list_with_code_block(self, tmp_path):
        out = str(tmp_path / "loose.pdf")
        build_pdf("- text\n\n  ```\n  code\n  ```\n", self.THEME, out)
        assert _is_pdf(out)


class TestFootnotes:
    THEME = {"bg": "#100e17", "text": "#bebebe", "link": "#6bcafb"}

    def _inline_with_footnotes(self, md_text):
        from mdit_py_plugins.footnote import footnote_plugin
        tokens = MarkdownIt("commonmark").use(footnote_plugin).parse(md_text)
        tree = SyntaxTreeNode(tokens)
        return tree.children[0].children[0]

    def test_reference_renders_as_superscript_link(self):
        inline = self._inline_with_footnotes("Note.[^1]\n\n[^1]: def\n")
        markup = inline_to_markup(inline, Theme(self.THEME))
        assert "<super>" in markup
        assert 'href="#fn-0"' in markup
        assert 'name="fnref-0"' in markup

    def test_definition_is_anchored_and_links_back(self):
        renderer = pdf_export.MarkdownPdfRenderer(Theme(self.THEME))
        flowables = renderer.render("Note.[^1]\n\n[^1]: the definition text\n")
        texts = [f.text for f in flowables if hasattr(f, "text")]
        joined = " ".join(texts)
        assert 'name="fn-0"' in joined
        assert 'href="#fnref-0"' in joined
        assert "the definition text" in joined

    def test_builds_pdf_with_footnotes(self, tmp_path):
        out = str(tmp_path / "fn.pdf")
        build_pdf("Body[^1] and[^note].\n\n[^1]: one\n[^note]: two\n", self.THEME, out)
        assert _is_pdf(out)


class TestSanitizeDrawing:
    def _line(self, dash):
        from reportlab.graphics.shapes import Line
        line = Line(0, 0, 10, 10)
        line.strokeDashArray = dash
        return line

    def test_clears_zero_dash(self):
        line = self._line([0.0])
        pdf_export.sanitize_drawing(line)
        assert line.strokeDashArray is None

    def test_clears_negative_dash(self):
        line = self._line([-2.0, 3.0])
        pdf_export.sanitize_drawing(line)
        assert line.strokeDashArray is None

    def test_keeps_valid_dash(self):
        line = self._line([3.0, 2.0])
        pdf_export.sanitize_drawing(line)
        assert line.strokeDashArray == [3.0, 2.0]

    def test_recurses_into_groups(self):
        from reportlab.graphics.shapes import Drawing, Group
        line = self._line([0.0])
        group = Group(line)
        drawing = Drawing(10, 10)
        drawing.add(group)
        pdf_export.sanitize_drawing(drawing)
        assert line.strokeDashArray is None


class TestTableFlowable:
    def test_empty_rows_returns_nothing(self):
        renderer = pdf_export.MarkdownPdfRenderer(Theme({}))
        assert renderer._table_flowable([], []) == []
