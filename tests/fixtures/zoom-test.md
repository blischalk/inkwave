# Zoom Test Document

This file tests that **Cmd+/Cmd-** zoom scales everything uniformly — text, images, mermaid diagrams, code blocks, and tables.

## Mermaid Flowchart

```mermaid
flowchart TD
    A[Open Markdown File] --> B{Has Images?}
    B -->|Yes| C[Resolve Image Paths]
    B -->|No| D[Render Content]
    C --> D
    D --> E[Apply Zoom Level]
    E --> F[Display in WebView]
```

## Mermaid Sequence Diagram

```mermaid
sequenceDiagram
    participant User
    participant App
    participant WebView
    User->>App: Cmd+ (zoom in)
    App->>WebView: style.zoom = level
    WebView-->>User: All content scales uniformly
    User->>App: Cmd+0 (reset)
    App->>WebView: style.zoom = 1
```

## Image

Here's an image that should scale with zoom:

![Zoom Test Image](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzRhOTBkOSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiPlpvb20gVGVzdCBJbWFnZTwvdGV4dD48L3N2Zz4=)

## Code Block

```python
def apply_zoom(level):
    """Zoom scales text, images, SVGs, and all content uniformly."""
    element.style.zoom = level / DEFAULT_FONT_SIZE
    # Unlike font-size, CSS zoom affects everything:
    # - Text paragraphs
    # - Images (png, jpg, gif)
    # - SVG diagrams (mermaid)
    # - Code blocks (this one!)
    # - Tables, borders, padding
```

## Table

| Feature | font-size | CSS zoom | transform:scale |
|---------|-----------|----------|-----------------|
| Scales text | ✅ | ✅ | ✅ |
| Scales images | ❌ | ✅ | ✅ |
| Scales SVGs | ❌ | ✅ | ✅ |
| Reflows layout | ✅ | ✅ | ❌ |
| Best for apps | ❌ | ✅ | ❌ |

## Nested List

1. Try zooming in with **Cmd+** (or Ctrl+)
   - Text should get bigger
   - The mermaid diagrams above should scale
   - The image should grow
   - This nested list should scale too
2. Try zooming out with **Cmd-**
3. Reset with **Cmd+0**

> **Tip:** If only the text scales but images and diagrams stay the same size, the zoom is using `font-size` instead of CSS `zoom`.

