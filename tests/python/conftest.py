import sys
from unittest.mock import MagicMock
import pytest

# Mock webview before app.py is imported to avoid any GUI initialization.
_webview = MagicMock()
_webview.OPEN_DIALOG = 0
_webview.FOLDER_DIALOG = 20
_webview.SAVE_DIALOG = 10
sys.modules.setdefault("webview", _webview)

import app  # noqa: E402 — must come after the mock
from app import Api  # noqa: E402


@pytest.fixture
def api(tmp_path):
    """Api instance with a mocked window and settings isolated to tmp_path."""
    window = MagicMock()
    a = Api(window)
    settings_file = str(tmp_path / "settings.json")
    a._settings_path = lambda: settings_file
    return a
