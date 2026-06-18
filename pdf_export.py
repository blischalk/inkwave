"""Render Markdown to a paginated, themed PDF with reportlab.

This is a deliberate re-rendering of the Markdown source rather than a capture of
the on-screen webview: WebKit's print engine cannot paint the @page margin band,
so a full-bleed background plus per-page margins is impossible there. reportlab
draws the page background on every page and flows content within native margins,
giving both for free — and being pure Python, it bundles cleanly with PyInstaller
for the packaged release (no native system dependencies).
"""

import base64
import io
import os
import re

from markdown_it import MarkdownIt
from markdown_it.tree import SyntaxTreeNode
from mdit_py_plugins.footnote import footnote_plugin

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    XPreformatted,
    Spacer,
    Table,
    TableStyle,
    Image,
    HRFlowable,
    KeepInFrame,
)

from pygments import lex
from pygments.lexers import get_lexer_by_name, TextLexer
from pygments.styles import get_style_by_name
from pygments.util import ClassNotFound


PAGE_SIZE = letter
MARGIN_VERTICAL = 0.75 * inch
MARGIN_HORIZONTAL = 0.85 * inch
CONTENT_WIDTH = PAGE_SIZE[0] - 2 * MARGIN_HORIZONTAL
CONTENT_HEIGHT = PAGE_SIZE[1] - 2 * MARGIN_VERTICAL

MONO_FONT = "Courier"
BODY_FONT = "Helvetica"
BOLD_FONT = "Helvetica-Bold"

HEADING_SIZES = {1: 22, 2: 18, 3: 15, 4: 13, 5: 12, 6: 11}
RASTER_IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".bmp")
CSS_PX_TO_POINTS = 72.0 / 96.0  # CSS px → PDF points, so diagrams print near screen size


# ── Colour parsing ────────────────────────────────────────────────────────────

def parse_color(value, default=None):
    """Parse a CSS colour string (hex or rgb/rgba) into a reportlab Color.

    getComputedStyle hands us colours as 'rgb(r, g, b)' or 'rgba(...)', while
    theme sources use hex; both are accepted. Returns default on anything else.
    """
    if not value or not isinstance(value, str):
        return default
    text = value.strip()
    rgb_match = re.match(r"rgba?\(([^)]+)\)", text, re.IGNORECASE)
    if rgb_match:
        parts = [p.strip() for p in rgb_match.group(1).split(",")]
        try:
            r, g, b = (int(float(parts[i])) for i in range(3))
            return colors.Color(r / 255.0, g / 255.0, b / 255.0)
        except (ValueError, IndexError):
            return default
    if text.startswith("#"):
        hexd = text[1:]
        if len(hexd) == 3:
            hexd = "".join(ch * 2 for ch in hexd)
        if len(hexd) == 6:
            try:
                return colors.HexColor("#" + hexd)
            except ValueError:
                return default
    return default


def is_dark(color):
    """Perceived-luminance test, used to pick a code highlighting palette."""
    luminance = 0.299 * color.red + 0.587 * color.green + 0.114 * color.blue
    return luminance < 0.5


# ── Theme ───────────────────────────────────────────────────────────────────

class Theme:
    """Resolved reportlab colours for one Inkwave theme."""

    def __init__(self, raw):
        raw = raw or {}
        self.bg = parse_color(raw.get("bg"), colors.HexColor("#ffffff"))
        self.text = parse_color(raw.get("text"), colors.HexColor("#1a1a1a"))
        self.accent = parse_color(raw.get("accent"), colors.HexColor("#0a84ff"))
        self.link = parse_color(raw.get("link"), self.accent)
        self.muted = parse_color(raw.get("muted"), colors.HexColor("#888888"))
        self.border = parse_color(raw.get("border"), colors.HexColor("#cccccc"))
        self.code = parse_color(raw.get("code"), self.accent)
        self.code_bg = parse_color(raw.get("code_bg"), colors.HexColor("#f0f0f0"))
        self.blockquote_bg = parse_color(raw.get("blockquote_bg"), self.code_bg)
        self.headings = {
            level: parse_color(raw.get(f"h{min(level, 4)}"), self.text)
            for level in range(1, 7)
        }


# ── Inline rendering (Markdown inline → reportlab mini-HTML markup) ─────────────

def _escape(text):
    return (
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )


def inline_to_markup(node, theme):
    """Convert an inline Markdown node tree into reportlab Paragraph markup."""
    parts = []
    for child in node.children:
        parts.append(_inline_node_markup(child, theme))
    return "".join(parts)


def _inline_node_markup(node, theme):
    kind = node.type
    if kind == "text":
        return _escape(node.content)
    if kind == "softbreak":
        return " "
    if kind == "hardbreak":
        return "<br/>"
    if kind == "code_inline":
        return (
            f'<font face="{MONO_FONT}" color="{theme.code.hexval()}">'
            f"{_escape(node.content)}</font>"
        )
    if kind == "footnote_ref":
        fid = node.meta.get("id", 0)
        return (
            f'<super><a name="fnref-{fid}"/>'
            f'<a href="#fn-{fid}" color="{theme.link.hexval()}">{fid + 1}</a></super>'
        )
    if kind == "footnote_anchor":
        return ""  # the back-link is rendered on the definition instead
    inner = "".join(_inline_node_markup(c, theme) for c in node.children)
    if kind == "strong":
        return f"<b>{inner}</b>"
    if kind == "em":
        return f"<i>{inner}</i>"
    if kind == "s":
        return f"<strike>{inner}</strike>"
    if kind == "link":
        href = node.attrs.get("href", "")
        return f'<a href="{_escape(str(href))}" color="{theme.link.hexval()}">{inner}</a>'
    if kind == "image":
        alt = node.attrs.get("alt") or "".join(c.content for c in node.children)
        return _escape(alt or "[image]")
    return inner


# ── Code highlighting (Pygments → markup for XPreformatted) ─────────────────────

def highlight_code_markup(code, language, theme):
    """Tokenise code with Pygments and return reportlab markup with per-token
    colours, preserving newlines for XPreformatted."""
    style = get_style_by_name("monokai" if is_dark(theme.code_bg) else "default")
    token_colors = {}
    for token_type, definition in style:
        token_colors[token_type] = definition.get("color")

    try:
        lexer = get_lexer_by_name(language) if language else TextLexer()
    except ClassNotFound:
        lexer = TextLexer()

    out = []
    for token_type, value in lex(code, lexer):
        color = _token_color(token_type, token_colors)
        escaped = _escape(value)
        if color:
            out.append(f'<font color="#{color}">{escaped}</font>')
        else:
            out.append(escaped)
    return "".join(out)


def _token_color(token_type, token_colors):
    """Walk up the token type hierarchy until a colour is defined."""
    current = token_type
    while current is not None:
        if current in token_colors and token_colors[current]:
            return token_colors[current]
        current = current.parent
    return None


def sanitize_drawing(node):
    """Clear invalid stroke-dash arrays from a converted SVG drawing.

    svglib can emit dash arrays reportlab rejects at draw time (e.g. [0.0],
    which fails the 'dash cycle should be larger than zero' check). Mermaid
    diagrams trigger this. Recurse the drawing tree and drop any dash array that
    is empty, sums to zero, or contains a negative value.
    """
    dash = getattr(node, "strokeDashArray", None)
    if dash is not None:
        try:
            values = [float(v) for v in dash]
            if not values or sum(values) <= 0 or any(v < 0 for v in values):
                node.strokeDashArray = None
        except (TypeError, ValueError):
            node.strokeDashArray = None
    for child in getattr(node, "contents", None) or []:
        sanitize_drawing(child)
    return node


# ── Block rendering ────────────────────────────────────────────────────────────

class MarkdownPdfRenderer:
    """Walks a Markdown syntax tree and produces reportlab flowables."""

    def __init__(self, theme, base_dir=None, mermaid_images=None):
        self.theme = theme
        self.base_dir = base_dir
        # Each entry is {data: base64 PNG, width, height} — diagrams are rasterised
        # in the browser so the PDF matches the app exactly (svglib mis-positions
        # mermaid's anchored text).
        self.mermaid_images = list(mermaid_images or [])
        self._mermaid_index = 0
        self.styles = self._build_styles()

    def _build_styles(self):
        t = self.theme
        styles = {
            "body": ParagraphStyle(
                "body", fontName=BODY_FONT, fontSize=11, leading=16,
                textColor=t.text, spaceAfter=8,
            ),
            "blockquote": ParagraphStyle(
                "blockquote", fontName=BODY_FONT, fontSize=11, leading=16,
                textColor=t.muted, spaceAfter=6,
            ),
            "code": ParagraphStyle(
                "code", fontName=MONO_FONT, fontSize=9, leading=13,
                textColor=t.code,
            ),
            "list": ParagraphStyle(
                "list", fontName=BODY_FONT, fontSize=11, leading=16,
                textColor=t.text, spaceAfter=3,
            ),
        }
        for level in range(1, 7):
            styles[f"h{level}"] = ParagraphStyle(
                f"h{level}", fontName=BOLD_FONT, fontSize=HEADING_SIZES[level],
                leading=HEADING_SIZES[level] + 4, textColor=t.headings[level],
                spaceBefore=14 if level <= 2 else 10, spaceAfter=6,
                keepWithNext=1,  # don't strand a heading at the bottom of a page
            )
        return styles

    def render(self, markdown_text):
        md = (
            MarkdownIt("commonmark")
            .enable(["table", "strikethrough"])
            .use(footnote_plugin)
        )
        tokens = md.parse(markdown_text or "")
        tree = SyntaxTreeNode(tokens)
        flowables = []
        for node in tree.children:
            flowables.extend(self._block(node))
        return flowables

    def _block(self, node):
        handler = getattr(self, f"_block_{node.type}", None)
        if handler:
            return handler(node)
        return []

    def _block_heading(self, node):
        level = int(node.tag[1])
        markup = inline_to_markup(node.children[0], self.theme) if node.children else ""
        return [Paragraph(markup, self.styles[f"h{level}"])]

    def _block_paragraph(self, node):
        inline = node.children[0] if node.children else None
        image = self._lone_image(inline)
        if image is not None:
            return [image]
        markup = inline_to_markup(inline, self.theme) if inline else ""
        return [Paragraph(markup, self.styles["body"])]

    def _lone_image(self, inline):
        if not inline or len(inline.children) != 1:
            return None
        if inline.children[0].type != "image":
            return None
        return self._image_flowable(inline.children[0].attrs.get("src", ""))

    def _image_flowable(self, src):
        if not src or not self.base_dir:
            return None
        if src.startswith(("http://", "https://", "data:")):
            return None
        path = os.path.realpath(os.path.join(self.base_dir, src))
        root = os.path.realpath(self.base_dir)
        if os.path.commonpath([root, path]) != root:
            return None  # refuse to read images outside the document's folder
        if not os.path.isfile(path):
            return None
        try:
            if path.lower().endswith(".svg"):
                return self._svg_file_flowable(path)
            if path.lower().endswith(RASTER_IMAGE_EXTENSIONS):
                return self._fit_image(Image(path))
        except Exception:
            return None
        return None

    def _fit_image(self, image):
        if image.drawWidth > CONTENT_WIDTH:
            scale = CONTENT_WIDTH / image.drawWidth
            image.drawWidth *= scale
            image.drawHeight *= scale
        return image

    def _svg_file_flowable(self, path):
        from svglib.svglib import svg2rlg
        drawing = svg2rlg(path)
        return self._fit_drawing(drawing) if drawing else None

    def _fit_drawing(self, drawing, max_width=CONTENT_WIDTH):
        sanitize_drawing(drawing)
        if drawing.width and drawing.width > max_width:
            scale = max_width / drawing.width
            drawing.width *= scale
            drawing.height *= scale
            drawing.scale(scale, scale)
        return drawing

    def _block_fence(self, node):
        if (node.info or "").strip().lower() == "mermaid":
            return self._mermaid_flowables()
        return self._code_flowables(node.content, (node.info or "").strip())

    _block_code_block = lambda self, node: self._code_flowables(node.content, "")

    def _code_flowables(self, code, language):
        markup = highlight_code_markup(code.rstrip("\n"), language, self.theme)
        style = ParagraphStyle(
            "code_block", fontName=MONO_FONT, fontSize=9, leading=13,
            textColor=self.theme.code,
        )
        body = XPreformatted(markup, style)
        table = Table([[body]], colWidths=[CONTENT_WIDTH])
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), self.theme.code_bg),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        return [table, Spacer(1, 8)]

    DIAGRAM_PADDING = 12

    def _mermaid_flowables(self):
        if self._mermaid_index >= len(self.mermaid_images):
            return []
        item = self.mermaid_images[self._mermaid_index]
        self._mermaid_index += 1
        try:
            image = self._raster_diagram(item)
            if image is not None:
                return [self._framed_diagram(image), Spacer(1, 8)]
        except Exception:
            pass
        return [Paragraph("[mermaid diagram]", self.styles["blockquote"]), Spacer(1, 8)]

    def _raster_diagram(self, item):
        """Build a reportlab Image from a browser-rasterised mermaid PNG."""
        data = item.get("data") if isinstance(item, dict) else None
        if not data:
            return None
        raw = base64.b64decode(data)
        pixel_width, pixel_height = ImageReader(io.BytesIO(raw)).getSize()
        aspect = pixel_height / pixel_width if pixel_width else 1
        css_width = item.get("width") or pixel_width
        max_width = CONTENT_WIDTH - 2 * self.DIAGRAM_PADDING
        # Cap height too (leaving room for a heading) so a tall diagram fits with
        # its heading on one page instead of being bumped, stranding the heading.
        max_height = CONTENT_HEIGHT - 2 * self.DIAGRAM_PADDING - 72
        draw_width = min(float(css_width) * CSS_PX_TO_POINTS, max_width)
        draw_height = draw_width * aspect
        if draw_height > max_height:
            draw_width *= max_height / draw_height
            draw_height = max_height
        # platypus Image needs a path or file-like (not an ImageReader) in this version.
        return Image(io.BytesIO(raw), width=draw_width, height=draw_height)

    def _framed_diagram(self, flowable):
        """Centre a diagram on a lighter background panel, matching the
        pre.mermaid card shown in the app."""
        flowable.hAlign = "CENTER"
        table = Table([[flowable]], colWidths=[CONTENT_WIDTH])
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), self.theme.code_bg),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("LEFTPADDING", (0, 0), (-1, -1), self.DIAGRAM_PADDING),
            ("RIGHTPADDING", (0, 0), (-1, -1), self.DIAGRAM_PADDING),
            ("TOPPADDING", (0, 0), (-1, -1), self.DIAGRAM_PADDING),
            ("BOTTOMPADDING", (0, 0), (-1, -1), self.DIAGRAM_PADDING),
        ]))
        return table

    def _block_hr(self, node):
        return [Spacer(1, 4), HRFlowable(width="100%", thickness=1, color=self.theme.muted), Spacer(1, 8)]

    def _block_footnote_block(self, node):
        flowables = [
            Spacer(1, 10),
            HRFlowable(width="35%", thickness=0.5, color=self.theme.muted, hAlign="LEFT"),
            Spacer(1, 4),
        ]
        for child in node.children:
            if child.type == "footnote":
                flowables.append(self._footnote_definition(child))
        return flowables

    def _footnote_definition(self, node):
        fid = node.meta.get("id", 0)
        parts = [
            inline_to_markup(child.children[0], self.theme)
            for child in node.children
            if child.type == "paragraph" and child.children
        ]
        text = " ".join(part for part in parts if part)
        link = self.theme.link.hexval()
        # The definition number links back to its reference; the reference links here.
        markup = (
            f'<a name="fn-{fid}"/>'
            f'<a href="#fnref-{fid}" color="{link}"><b>{fid + 1}.</b></a> {text}'
        )
        style = ParagraphStyle(
            f"footnote-{fid}", parent=self.styles["body"],
            fontSize=9, leading=13, textColor=self.theme.muted, spaceAfter=3,
        )
        return Paragraph(markup, style)

    def _block_blockquote(self, node):
        inner = []
        for child in node.children:
            inner.extend(self._block(child))
        bar = Table([[inner]], colWidths=[CONTENT_WIDTH - 12])
        bar.setStyle(TableStyle([
            ("LINEBEFORE", (0, 0), (0, -1), 3, self.theme.accent),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("BACKGROUND", (0, 0), (-1, -1), self.theme.blockquote_bg),
        ]))
        return [bar, Spacer(1, 8)]

    def _block_bullet_list(self, node):
        return self._list_items(node, ordered=False)

    def _block_ordered_list(self, node):
        return self._list_items(node, ordered=True)

    def _list_items(self, node, ordered, depth=0):
        flowables = []
        counter = int(node.attrs.get("start", 1)) if ordered else 1
        for item in node.children:
            if item.type != "list_item":
                continue
            marker = f"{counter}." if ordered else "•"
            flowables.extend(self._list_item(item, marker, depth))
            counter += 1
        return flowables

    def _list_item(self, item, marker, depth):
        indent = 18 * (depth + 1)
        flowables = []
        for child in item.children:
            if child.type in ("bullet_list", "ordered_list"):
                flowables.extend(self._list_items(
                    child, ordered=child.type == "ordered_list", depth=depth + 1))
            elif child.type == "paragraph":
                text, marker = self._task_marker(child, marker)
                style = ParagraphStyle(
                    f"li{depth}", parent=self.styles["list"],
                    leftIndent=indent, bulletIndent=indent - 12,
                )
                para = Paragraph(text, style, bulletText=marker)
                flowables.append(para)
            else:
                flowables.extend(self._block(child))
        return flowables

    def _task_marker(self, paragraph_node, marker):
        inline = paragraph_node.children[0] if paragraph_node.children else None
        markup = inline_to_markup(inline, self.theme) if inline else ""
        checkbox = re.match(r"\[( |x|X)\]\s+", markup)
        if checkbox:
            checked = checkbox.group(1).lower() == "x"
            return markup[checkbox.end():], ("[x]" if checked else "[ ]")
        return markup, marker

    def _block_table(self, node):
        rows = []
        alignments = []
        for section in node.children:
            for row in section.children:
                cell_markups = []
                for cell in row.children:
                    inline = cell.children[0] if cell.children else None
                    cell_markups.append(inline_to_markup(inline, self.theme) if inline else "")
                    if section.type == "thead":
                        alignments.append(self._cell_alignment(cell))
                rows.append((section.type, cell_markups))
        return self._table_flowable(rows, alignments)

    def _cell_alignment(self, cell):
        style = cell.attrs.get("style", "") or ""
        if "center" in style:
            return TA_CENTER
        if "right" in style:
            return TA_RIGHT
        return TA_LEFT

    def _cell_style(self, column, alignments, is_header):
        alignment = alignments[column] if column < len(alignments) else TA_LEFT
        return ParagraphStyle(
            f"cell_{column}_{is_header}", parent=self.styles["body"],
            alignment=alignment, spaceAfter=0,
            fontName=BOLD_FONT if is_header else BODY_FONT,
            textColor=self.theme.accent if is_header else self.theme.text,
        )

    def _table_flowable(self, rows, alignments):
        if not rows:
            return []
        data = []
        for section_type, cell_markups in rows:
            is_header = section_type == "thead"
            data.append([
                Paragraph(markup, self._cell_style(column, alignments, is_header))
                for column, markup in enumerate(cell_markups)
            ])
        table = Table(data, hAlign="LEFT")
        commands = [
            ("GRID", (0, 0), (-1, -1), 0.5, self.theme.border),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]
        if rows and rows[0][0] == "thead":
            commands.append(("BACKGROUND", (0, 0), (-1, 0), self.theme.code_bg))
        table.setStyle(TableStyle(commands))
        wrapped = KeepInFrame(CONTENT_WIDTH, PAGE_SIZE[1], [table], mode="shrink")
        return [wrapped, Spacer(1, 8)]


# ── Document assembly ──────────────────────────────────────────────────────────

def _page_background(bg_color):
    def paint(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(bg_color)
        canvas.rect(0, 0, doc.pagesize[0], doc.pagesize[1], fill=1, stroke=0)
        canvas.restoreState()
    return paint


def build_pdf(markdown_text, theme_colors, out_path, base_dir=None, mermaid_images=None):
    """Render Markdown to a themed, paginated PDF at out_path."""
    theme = Theme(theme_colors)
    renderer = MarkdownPdfRenderer(theme, base_dir=base_dir, mermaid_images=mermaid_images)
    flowables = renderer.render(markdown_text)
    if not flowables:
        flowables = [Spacer(1, 1)]  # reportlab refuses to build an empty story
    doc = SimpleDocTemplate(
        out_path, pagesize=PAGE_SIZE,
        topMargin=MARGIN_VERTICAL, bottomMargin=MARGIN_VERTICAL,
        leftMargin=MARGIN_HORIZONTAL, rightMargin=MARGIN_HORIZONTAL,
        title=os.path.splitext(os.path.basename(out_path))[0],
    )
    paint = _page_background(theme.bg)
    doc.build(flowables, onFirstPage=paint, onLaterPages=paint)
    return out_path
