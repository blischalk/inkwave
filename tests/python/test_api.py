"""Tests for the Api class methods in app.py."""
import base64
import json
import os
import pytest
from unittest.mock import MagicMock, patch

import app
from app import Api


# ── read_file ────────────────────────────────────────────────────────────────

class TestReadFile:
    def test_returns_error_for_empty_path(self, api):
        result = api.read_file("")
        assert result["content"] is None
        assert "error" in result

    def test_returns_error_for_none_path(self, api):
        result = api.read_file(None)
        assert result["content"] is None

    def test_returns_error_for_nonexistent_file(self, api, tmp_path):
        result = api.read_file(str(tmp_path / "missing.md"))
        assert result["content"] is None
        assert "error" in result

    def test_returns_error_for_non_md_extension(self, api, tmp_path):
        f = tmp_path / "file.txt"
        f.write_text("hello")
        result = api.read_file(str(f))
        assert result["content"] is None
        assert "error" in result

    def test_reads_md_file_successfully(self, api, tmp_path):
        f = tmp_path / "note.md"
        f.write_text("# Hello", encoding="utf-8")
        result = api.read_file(str(f))
        assert result["content"] == "# Hello"
        assert result["path"] == str(f)
        assert "error" not in result

    def test_reads_markdown_extension(self, api, tmp_path):
        f = tmp_path / "doc.markdown"
        f.write_text("content", encoding="utf-8")
        result = api.read_file(str(f))
        assert result["content"] == "content"


# ── write_file ───────────────────────────────────────────────────────────────

class TestWriteFile:
    def test_returns_error_for_empty_path(self, api):
        result = api.write_file("", "content")
        assert "error" in result

    def test_returns_error_for_non_md_extension(self, api, tmp_path):
        result = api.write_file(str(tmp_path / "file.txt"), "content")
        assert "error" in result

    def test_writes_content_to_disk(self, api, tmp_path):
        f = tmp_path / "note.md"
        result = api.write_file(str(f), "# Written")
        assert "error" not in result
        assert f.read_text(encoding="utf-8") == "# Written"

    def test_returns_path_on_success(self, api, tmp_path):
        f = tmp_path / "note.md"
        result = api.write_file(str(f), "x")
        assert result["path"] == str(f)


# ── create_file ──────────────────────────────────────────────────────────────

class TestCreateFile:
    def test_returns_error_for_invalid_folder(self, api):
        result = api.create_file("/does/not/exist", "note.md")
        assert result["error"] is not None

    def test_returns_error_for_relative_path(self, api):
        result = api.create_file("relative/path", "note.md")
        assert result["error"] is not None

    def test_empty_filename_defaults_to_untitled(self, api, tmp_path):
        result = api.create_file(str(tmp_path), "")
        assert result["path"] is not None
        assert os.path.basename(result["path"]).startswith("Untitled")

    def test_non_md_filename_gets_md_extension(self, api, tmp_path):
        result = api.create_file(str(tmp_path), "mynote")
        assert result["path"].endswith(".md")

    def test_creates_file_on_disk(self, api, tmp_path):
        result = api.create_file(str(tmp_path), "test.md")
        assert os.path.isfile(result["path"])

    def test_returns_empty_content(self, api, tmp_path):
        result = api.create_file(str(tmp_path), "test.md")
        assert result["content"] == ""

    def test_collision_avoidance(self, api, tmp_path):
        (tmp_path / "Untitled.md").write_text("")
        (tmp_path / "Untitled 1.md").write_text("")
        (tmp_path / "Untitled 2.md").write_text("")
        result = api.create_file(str(tmp_path), "Untitled.md")
        assert "error" not in result
        assert os.path.basename(result["path"]) == "Untitled 3.md"


# ── delete_file ──────────────────────────────────────────────────────────────

class TestDeleteFile:
    def test_returns_error_for_nonexistent_file(self, api, tmp_path):
        result = api.delete_file(str(tmp_path / "missing.md"))
        assert result["success"] is False
        assert "error" in result

    def test_returns_error_for_non_md_file(self, api, tmp_path):
        f = tmp_path / "file.txt"
        f.write_text("x")
        result = api.delete_file(str(f))
        assert result["success"] is False
        assert "error" in result

    def test_deletes_file_from_disk(self, api, tmp_path):
        f = tmp_path / "note.md"
        f.write_text("x")
        result = api.delete_file(str(f))
        assert result["success"] is True
        assert not f.exists()


# ── list_dir ─────────────────────────────────────────────────────────────────

class TestListDir:
    def test_returns_error_for_non_absolute_path(self, api):
        result = api.list_dir("relative/path")
        assert result["entries"] == []
        assert "error" in result

    def test_returns_error_for_empty_path(self, api):
        result = api.list_dir("")
        assert "error" in result

    def test_returns_entries_for_valid_dir(self, api, tmp_path):
        (tmp_path / "note.md").write_text("x")
        result = api.list_dir(str(tmp_path))
        assert any(e["name"] == "note.md" for e in result["entries"])

    def test_excludes_non_md_files(self, api, tmp_path):
        (tmp_path / "ignore.txt").write_text("x")
        result = api.list_dir(str(tmp_path))
        assert not any(e["name"] == "ignore.txt" for e in result["entries"])


# ── read_image_base64 ────────────────────────────────────────────────────────

class TestReadImageBase64:
    def test_returns_none_for_empty_path(self, api):
        assert api.read_image_base64("") is None

    def test_returns_none_for_unsupported_extension(self, api, tmp_path):
        f = tmp_path / "file.txt"
        f.write_bytes(b"data")
        assert api.read_image_base64(str(f)) is None

    def test_returns_none_for_oversized_file(self, api, tmp_path):
        f = tmp_path / "big.png"
        f.write_bytes(b"x")
        with patch("os.path.getsize", return_value=21 * 1024 * 1024):
            assert api.read_image_base64(str(f)) is None

    def test_returns_data_url_for_png(self, api, tmp_path):
        f = tmp_path / "image.png"
        f.write_bytes(b"\x89PNG\r\n\x1a\n")
        result = api.read_image_base64(str(f))
        assert result is not None
        assert result.startswith("data:image/png;base64,")

    def test_returns_none_for_nonexistent_file(self, api, tmp_path):
        assert api.read_image_base64(str(tmp_path / "missing.png")) is None


# ── save_image ───────────────────────────────────────────────────────────────

class TestSaveImage:
    def _b64(self, data=b"fake image bytes"):
        return base64.b64encode(data).decode()

    def test_returns_error_for_nonexistent_md_file(self, api, tmp_path):
        result = api.save_image(str(tmp_path / "missing.md"), "img.png", self._b64())
        assert "error" in result

    def test_returns_error_for_invalid_base64(self, api, tmp_path):
        md = tmp_path / "note.md"
        md.write_text("x")
        result = api.save_image(str(md), "img.png", "!!!not-base64!!!")
        assert "error" in result

    def test_unsupported_extension_becomes_png(self, api, tmp_path):
        md = tmp_path / "note.md"
        md.write_text("x")
        result = api.save_image(str(md), "photo.xyz", self._b64())
        assert result["name"].endswith(".png")

    def test_saves_image_alongside_md_file(self, api, tmp_path):
        md = tmp_path / "note.md"
        md.write_text("x")
        result = api.save_image(str(md), "photo.png", self._b64())
        assert "error" not in result
        assert os.path.isfile(result["path"])

    def test_collision_avoidance(self, api, tmp_path):
        md = tmp_path / "note.md"
        md.write_text("x")
        (tmp_path / "photo.png").write_bytes(b"existing")
        result = api.save_image(str(md), "photo.png", self._b64())
        assert "error" not in result
        assert result["name"] == "photo_1.png"

    def test_sanitises_unsafe_filename_characters(self, api, tmp_path):
        md = tmp_path / "note.md"
        md.write_text("x")
        result = api.save_image(str(md), "my file (2).png", self._b64())
        assert " " not in result["name"]
        assert "(" not in result["name"]


# ── load_settings / save_setting ─────────────────────────────────────────────

class TestSettings:
    def test_load_returns_empty_dict_when_no_file(self, api):
        assert api.load_settings() == {}

    def test_save_and_load_round_trip(self, api):
        api.save_setting("theme", "obsidianite")
        settings = api.load_settings()
        assert settings["theme"] == "obsidianite"

    def test_save_setting_preserves_existing_keys(self, api):
        api.save_setting("keyA", "valA")
        api.save_setting("keyB", "valB")
        settings = api.load_settings()
        assert settings["keyA"] == "valA"
        assert settings["keyB"] == "valB"

    def test_load_returns_empty_for_malformed_json(self, api, tmp_path):
        path = tmp_path / "settings.json"
        path.write_text("not json!!!")
        result = api.load_settings()
        assert result == {}

    def test_save_setting_returns_ok_true(self, api):
        result = api.save_setting("x", 1)
        assert result == {"ok": True}


# ── get_provider_api_key_status ───────────────────────────────────────────────

class TestProviderApiKeyStatus:
    def test_unknown_provider_returns_no_key(self, api):
        assert api.get_provider_api_key_status("unknown") == {"has_key": False}

    def test_known_provider_without_flag_returns_no_key(self, api):
        assert api.get_provider_api_key_status("anthropic") == {"has_key": False}

    def test_known_provider_with_flag_set(self, api):
        api.save_setting("anthropic_key_set", True)
        assert api.get_provider_api_key_status("anthropic") == {"has_key": True}

    def test_all_supported_providers(self, api):
        for provider in ("anthropic", "openai", "gemini"):
            assert api.get_provider_api_key_status(provider) == {"has_key": False}


# ── save_provider_api_key / delete_provider_api_key ─────────────────────────

class TestProviderApiKey:
    def test_save_unknown_provider_returns_error(self, api):
        result = api.save_provider_api_key("unknown", "key")
        assert result["ok"] is False
        assert "Unknown provider" in result["error"]

    def test_save_keyring_unavailable_returns_error(self, api, monkeypatch):
        monkeypatch.setattr(app, "_KEYRING_AVAILABLE", False)
        result = api.save_provider_api_key("anthropic", "key")
        assert result["ok"] is False
        assert "keyring" in result["error"]

    def test_save_happy_path(self, api, monkeypatch):
        mock_kr = MagicMock()
        monkeypatch.setattr(app, "_KEYRING_AVAILABLE", True)
        monkeypatch.setattr(app, "_keyring", mock_kr, raising=False)
        result = api.save_provider_api_key("anthropic", "sk-test")
        assert result == {"ok": True}
        mock_kr.set_password.assert_called_once()

    def test_delete_unknown_provider_returns_error(self, api):
        result = api.delete_provider_api_key("unknown")
        assert result["ok"] is False
        assert "Unknown provider" in result["error"]

    def test_delete_keyring_unavailable_returns_error(self, api, monkeypatch):
        monkeypatch.setattr(app, "_KEYRING_AVAILABLE", False)
        result = api.delete_provider_api_key("anthropic")
        assert result["ok"] is False

    def test_delete_happy_path(self, api, monkeypatch):
        mock_kr = MagicMock()
        monkeypatch.setattr(app, "_KEYRING_AVAILABLE", True)
        monkeypatch.setattr(app, "_keyring", mock_kr, raising=False)
        result = api.delete_provider_api_key("openai")
        assert result == {"ok": True}
        mock_kr.delete_password.assert_called_once()


# ── get_welcome ───────────────────────────────────────────────────────────────

class TestGetWelcome:
    def test_returns_content_when_welcome_md_exists(self, api):
        result = api.get_welcome()
        # Welcome.md ships with the project; BASE_DIR points to the project root
        assert result is not None
        assert "content" in result
        assert result["content"] is not None

    def test_returns_none_when_welcome_md_missing(self, api, tmp_path, monkeypatch):
        monkeypatch.setattr(app, "BASE_DIR", str(tmp_path))
        result = api.get_welcome()
        assert result is None
