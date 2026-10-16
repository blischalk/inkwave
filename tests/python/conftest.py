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
    """Api instance with a mocked window and settings/drafts isolated to
    tmp_path. Without this override, _drafts_dir() falls back to BASE_DIR
    (not frozen in tests) and would create a real drafts/ directory inside
    the repo on every test run — the same isolation hazard _settings_path
    already avoids via settings_file below."""
    window = MagicMock()
    a = Api(window)
    settings_file = str(tmp_path / "settings.json")
    a._settings_path = lambda: settings_file
    drafts_dir = tmp_path / "drafts"
    drafts_dir.mkdir()
    a._drafts_dir = lambda: str(drafts_dir)
    return a
