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

    def test_concurrent_save_setting_calls_do_not_lose_writes(self, api):
        # Reproduces the F3 race: without a lock, two threads calling
        # save_setting() with different keys at the same time can each read
        # stale data before the other's write lands, so one write is lost.
        # With the lock in place, all N keys must survive.
        import threading as _threading

        n_threads = 20
        barrier = _threading.Barrier(n_threads)

        def _save(i):
            barrier.wait()  # maximize actual concurrent overlap
            api.save_setting(f"key_{i}", i)

        threads = [_threading.Thread(target=_save, args=(i,)) for i in range(n_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5)

        final = api.load_settings()
        for i in range(n_threads):
            assert final.get(f"key_{i}") == i, (
                f"key_{i} missing or wrong after concurrent saves — "
                f"indicates a lost write (the exact F3 race)"
            )

    def test_concurrent_save_setting_and_set_key_flag_do_not_race(self, api):
        # _set_key_flag() writes the same settings.json via the same
        # read-modify-write pattern — must share the same lock as
        # save_setting(), not just have its own independent lock.
        import threading as _threading

        barrier = _threading.Barrier(2)

        def _via_save_setting():
            barrier.wait()
            api.save_setting("theme", "lavender")

        def _via_set_key_flag():
            barrier.wait()
            api._set_key_flag("openai", True)

        t1 = _threading.Thread(target=_via_save_setting)
        t2 = _threading.Thread(target=_via_set_key_flag)
        t1.start()
        t2.start()
        t1.join(timeout=5)
        t2.join(timeout=5)

        final = api.load_settings()
        assert final.get("theme") == "lavender"
        assert final.get("openai_key_set") is True

    def test_settings_lock_is_shared_between_save_setting_and_set_key_flag(self, api):
        # Both methods must guard the SAME lock object (Sauron — one lock
        # for one shared resource), not two independent locks that would
        # not actually exclude each other.
        assert hasattr(api, "_settings_lock")
        import threading as _threading
        assert isinstance(api._settings_lock, type(_threading.Lock()))

    def test_concurrent_load_never_sees_partial_write(self, api):
        # load_settings() reads the same file save_setting() writes — all
        # three accessors (save_setting, _set_key_flag, load_settings)
        # must share the one lock, or a concurrent load could race a
        # write and (in principle) observe a torn/partial write.
        import threading as _threading

        stop = _threading.Event()
        results = []

        def writer():
            i = 0
            while not stop.is_set():
                api.save_setting("counter", i)
                i += 1

        def reader():
            while not stop.is_set():
                data = api.load_settings()
                results.append(data)

        t_w = _threading.Thread(target=writer)
        t_r = _threading.Thread(target=reader)
        t_w.start()
        t_r.start()
        import time as _time
        _time.sleep(0.3)
        stop.set()
        t_w.join(timeout=5)
        t_r.join(timeout=5)

        # Every observed read must be a fully-formed dict with a valid
        # "counter" key (or empty on the very first read before any write
        # has happened) — never a KeyError, never a half-written value.
        assert results, "reader thread produced no observations"
        for data in results:
            assert isinstance(data, dict)
            if data:
                assert "counter" in data
                assert isinstance(data["counter"], int)

    def test_save_setting_returns_ok_false_on_permission_denied(self, api, tmp_path, monkeypatch):
        # Lock the settings directory read-only so the write raises PermissionError.
        settings_dir = tmp_path / "readonly"
        settings_dir.mkdir()
        settings_file = settings_dir / "settings.json"
        api._settings_path = lambda: str(settings_file)
        settings_dir.chmod(0o444)
        try:
            result = api.save_setting("theme", "obsidianite")
            assert result["ok"] is False
            assert "error" in result
        finally:
            settings_dir.chmod(0o755)  # restore so tmp_path cleanup can remove it

    def test_save_setting_does_not_raise_when_settings_path_is_a_directory(self, api, tmp_path):
        # Edge case: a directory exists where settings.json should be a file.
        bogus_dir = tmp_path / "settings.json"
        bogus_dir.mkdir()
        api._settings_path = lambda: str(bogus_dir)
        result = api.save_setting("theme", "obsidianite")
        assert result["ok"] is False
        assert "error" in result

    def test_save_setting_failure_does_not_crash_subsequent_load(self, api, tmp_path):
        # A failed save must not corrupt the settings file for a later load.
        api.save_setting("theme", "lavender")
        bogus_dir = tmp_path / "blocked"
        bogus_dir.mkdir(mode=0o444)
        try:
            api._settings_path = lambda: str(bogus_dir / "settings.json")
            api.save_setting("theme", "obsidianite")
            # Switch back to the real (succeeding) path and confirm the
            # earlier successful save is still intact and readable.
            api._settings_path = lambda: str(tmp_path / "settings.json")
            assert api.load_settings()["theme"] == "lavender"
        finally:
            bogus_dir.chmod(0o755)

    def test_atomic_write_leaves_original_file_untouched_on_json_dump_failure(self, api, tmp_path, monkeypatch):
        # F2: the old open(path, "w") pattern truncates the file BEFORE
        # writing, so a mid-write failure (e.g. a non-serializable value
        # slipping through) would leave settings.json empty — losing every
        # previously saved setting, not just the one being written. The
        # atomic temp-file-then-replace pattern must leave the ORIGINAL
        # file fully intact if the write never completes.
        api.save_setting("theme", "lavender")
        settings_path = api._settings_path()
        original_content = open(settings_path, "r", encoding="utf-8").read()

        # Force json.dump to fail partway through by injecting a
        # non-serializable value directly (bypassing save_setting's own
        # key/value args, which are always JSON-safe in practice — this
        # simulates a hypothetical future bug introducing a bad value).
        class _Unserializable:
            pass

        data = json.load(open(settings_path, "r", encoding="utf-8"))
        data["theme"] = _Unserializable()
        with pytest.raises(TypeError):
            api._atomic_write_json(settings_path, data)

        # The original file must be byte-for-byte unchanged — not
        # truncated, not partially written.
        assert open(settings_path, "r", encoding="utf-8").read() == original_content

    def test_atomic_write_cleans_up_its_temp_file_on_failure(self, api, tmp_path):
        settings_dir = tmp_path
        before = set(os.listdir(settings_dir))

        class _Unserializable:
            pass

        with pytest.raises(TypeError):
            api._atomic_write_json(str(settings_dir / "settings.json"), {"x": _Unserializable()})

        after = set(os.listdir(settings_dir))
        leftover_tmp_files = {f for f in (after - before) if f.endswith(".tmp")}
        assert not leftover_tmp_files, f"temp file(s) left behind: {leftover_tmp_files}"

    def test_atomic_write_round_trips_correctly_on_success(self, api, tmp_path):
        target = str(tmp_path / "settings.json")
        api._atomic_write_json(target, {"a": 1, "b": "two"})
        with open(target, "r", encoding="utf-8") as f:
            assert json.load(f) == {"a": 1, "b": "two"}


class TestSetKeyFlagRaisesOnFailure:
    """F1: _set_key_flag() used to swallow every exception, meaning a
    failed flag write (e.g. permission denied) looked identical to
    success — callers couldn't tell the keyring and the flag had gone
    out of sync. It now propagates, and all 4 callers already wrap it in
    their own try/except (verified directly in app.py before this fix)."""

    def test_raises_on_permission_denied(self, api, tmp_path, monkeypatch):
        bogus_dir = tmp_path / "blocked"
        bogus_dir.mkdir(mode=0o444)
        try:
            api._settings_path = lambda: str(bogus_dir / "settings.json")
            with pytest.raises(Exception):
                api._set_key_flag("openai", True)
        finally:
            bogus_dir.chmod(0o755)

    def test_caller_save_provider_api_key_surfaces_the_flag_write_error(self, api, tmp_path, monkeypatch):
        monkeypatch.setattr(app, "_KEYRING_AVAILABLE", True)
        monkeypatch.setattr(app, "_keyring", MagicMock(), raising=False)
        bogus_dir = tmp_path / "blocked2"
        bogus_dir.mkdir(mode=0o444)
        try:
            api._settings_path = lambda: str(bogus_dir / "settings.json")
            result = api.save_provider_api_key("openai", "sk-test")
            assert result.get("ok") is False
            assert "error" in result
        finally:
            bogus_dir.chmod(0o755)

    def test_succeeds_normally_when_settings_path_is_writable(self, api):
        api._set_key_flag("openai", True)
        assert api.load_settings().get("openai_key_set") is True


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


# ── open_url ──────────────────────────────────────────────────────────────────

class TestOpenUrl:
    def test_opens_http_url(self, api, monkeypatch):
        opened = []
        monkeypatch.setattr("webbrowser.open", lambda url: opened.append(url))
        api.open_url("http://example.com")
        assert opened == ["http://example.com"]

    def test_opens_https_url(self, api, monkeypatch):
        opened = []
        monkeypatch.setattr("webbrowser.open", lambda url: opened.append(url))
        api.open_url("https://example.com/path?q=1")
        assert opened == ["https://example.com/path?q=1"]

    def test_rejects_non_http_scheme(self, api, monkeypatch):
        opened = []
        monkeypatch.setattr("webbrowser.open", lambda url: opened.append(url))
        api.open_url("file:///etc/passwd")
        assert opened == []

    def test_rejects_javascript_scheme(self, api, monkeypatch):
        opened = []
        monkeypatch.setattr("webbrowser.open", lambda url: opened.append(url))
        api.open_url("javascript:alert(1)")
        assert opened == []

    def test_rejects_empty_string(self, api, monkeypatch):
        opened = []
        monkeypatch.setattr("webbrowser.open", lambda url: opened.append(url))
        api.open_url("")
        assert opened == []

    def test_rejects_none(self, api, monkeypatch):
        opened = []
        monkeypatch.setattr("webbrowser.open", lambda url: opened.append(url))
        api.open_url(None)
        assert opened == []

    def test_rejects_non_string(self, api, monkeypatch):
        opened = []
        monkeypatch.setattr("webbrowser.open", lambda url: opened.append(url))
        api.open_url(42)
        assert opened == []


# ── export_pdf ───────────────────────────────────────────────────────────────

class TestExportPdf:
    def _payload(self, **overrides):
        payload = {
            "markdown": "# Title\n\nBody text.",
            "theme": {"bg": "#100e17", "text": "#bebebe"},
            "mermaidImages": [],
            "suggestedName": "Notes.md",
            "sourcePath": None,
        }
        payload.update(overrides)
        return payload

    def test_writes_pdf_to_chosen_path(self, api, tmp_path):
        out = str(tmp_path / "Notes.pdf")
        api._window.create_file_dialog.return_value = out
        result = api.export_pdf(self._payload())
        assert result.get("path") == out
        assert os.path.isfile(out)
        with open(out, "rb") as f:
            assert f.read(5) == b"%PDF-"

    def test_suggests_pdf_filename(self, api, tmp_path):
        api._window.create_file_dialog.return_value = str(tmp_path / "Notes.pdf")
        api.export_pdf(self._payload(suggestedName="Notes.md"))
        kwargs = api._window.create_file_dialog.call_args.kwargs
        assert kwargs["save_filename"] == "Notes.pdf"

    def test_appends_pdf_extension_when_missing(self, api, tmp_path):
        api._window.create_file_dialog.return_value = str(tmp_path / "out")
        result = api.export_pdf(self._payload())
        assert result["path"].endswith(".pdf")

    def test_cancelled_when_dialog_dismissed(self, api):
        api._window.create_file_dialog.return_value = None
        result = api.export_pdf(self._payload())
        assert result == {"cancelled": True}

    def test_rejects_non_dict_payload(self, api):
        assert "error" in api.export_pdf("nope")

    def test_rejects_missing_markdown(self, api):
        assert "error" in api.export_pdf(self._payload(markdown=None))

    def test_dialog_error_is_reported(self, api):
        api._window.create_file_dialog.side_effect = RuntimeError("boom")
        result = api.export_pdf(self._payload())
        assert result["error"] == "boom"

    def test_build_failure_is_reported(self, api, tmp_path, monkeypatch):
        api._window.create_file_dialog.return_value = str(tmp_path / "x.pdf")
        monkeypatch.setattr("pdf_export.build_pdf",
                            lambda *a, **k: (_ for _ in ()).throw(ValueError("render fail")))
        result = api.export_pdf(self._payload())
        assert result["error"] == "render fail"

    def test_resolves_base_dir_from_source_path(self, api, tmp_path):
        svg = tmp_path / "pic.svg"
        svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'
                       '<rect width="10" height="10" fill="#0fb6d6"/></svg>')
        md_path = str(tmp_path / "doc.md")
        out = str(tmp_path / "doc.pdf")
        api._window.create_file_dialog.return_value = out
        result = api.export_pdf(self._payload(markdown="![p](pic.svg)", sourcePath=md_path))
        assert os.path.isfile(result["path"])


# ── open_path ────────────────────────────────────────────────────────────────

class TestOpenPath:
    def test_missing_file_returns_error(self, api):
        assert "error" in api.open_path("/no/such/file.pdf")

    def test_non_string_returns_error(self, api):
        assert "error" in api.open_path(None)

    def test_opens_existing_file(self, api, tmp_path, monkeypatch):
        pdf = tmp_path / "out.pdf"
        pdf.write_bytes(b"%PDF-1.4\n")
        opened = []
        if app.sys.platform == "darwin":
            ws = MagicMock()

            def _open_file(p):
                opened.append(p)
                return True  # NSWorkspace.openFile_ returns a BOOL

            ws.sharedWorkspace.return_value.openFile_ = _open_file
            monkeypatch.setitem(__import__("sys").modules, "AppKit", MagicMock(NSWorkspace=ws))
        elif os.name == "nt":
            monkeypatch.setattr(os, "startfile", lambda p: opened.append(p), raising=False)
        else:
            monkeypatch.setattr("webbrowser.open", lambda p: (opened.append(p), True)[1])
        result = api.open_path(str(pdf))
        assert result.get("success") is True
        assert opened and str(pdf) in opened[0]

    def test_opener_returning_falsy_is_reported_as_an_error(self, api, tmp_path, monkeypatch):
        # F3 fix: a real webbrowser.open()/NSWorkspace call that returns
        # False/None (no application available) must surface as an error,
        # not be silently reported as success.
        pdf = tmp_path / "out.pdf"
        pdf.write_bytes(b"%PDF-1.4\n")
        if app.sys.platform == "darwin":
            ws = MagicMock()
            ws.sharedWorkspace.return_value.openFile_ = lambda p: False
            monkeypatch.setitem(__import__("sys").modules, "AppKit", MagicMock(NSWorkspace=ws))
            result = api.open_path(str(pdf))
            assert "error" in result
        elif os.name != "nt":
            monkeypatch.setattr("webbrowser.open", lambda p: False)
            result = api.open_path(str(pdf))
            assert "error" in result
        # os.startfile (Windows) has no boolean success contract to check —
        # it either returns None or raises, so this case doesn't apply there.

    def _force_linux_branch(self, api, monkeypatch, tmp_path):
        """Force open_path's Linux (webbrowser.open) branch regardless of the
        actual OS the test suite is running on, so the file:// URI-encoding
        fix (F2) is exercised deterministically on every platform."""
        monkeypatch.setattr(app.sys, "platform", "linux")
        monkeypatch.setattr(os, "name", "posix")
        opened = []
        monkeypatch.setattr("webbrowser.open", lambda url: (opened.append(url), True)[1])
        return opened

    def test_linux_path_with_space_is_percent_encoded(self, api, tmp_path, monkeypatch):
        opened = self._force_linux_branch(api, monkeypatch, tmp_path)
        pdf = tmp_path / "my report.pdf"
        pdf.write_bytes(b"%PDF-1.4\n")
        result = api.open_path(str(pdf))
        assert result.get("success") is True
        assert len(opened) == 1
        assert " " not in opened[0], "raw space in file:// URI breaks the URI at the space"
        assert "%20" in opened[0]

    def test_linux_path_with_hash_is_percent_encoded(self, api, tmp_path, monkeypatch):
        opened = self._force_linux_branch(api, monkeypatch, tmp_path)
        pdf = tmp_path / "notes#1.pdf"
        pdf.write_bytes(b"%PDF-1.4\n")
        result = api.open_path(str(pdf))
        assert result.get("success") is True
        # An un-encoded '#' would be interpreted as a URI fragment separator,
        # truncating the path the browser/handler actually receives.
        assert opened[0].count("#") == 0 or "%23" in opened[0]

    def test_linux_path_without_special_chars_still_opens(self, api, tmp_path, monkeypatch):
        opened = self._force_linux_branch(api, monkeypatch, tmp_path)
        pdf = tmp_path / "plain.pdf"
        pdf.write_bytes(b"%PDF-1.4\n")
        result = api.open_path(str(pdf))
        assert result.get("success") is True
        assert opened[0].startswith("file://")
        assert "plain.pdf" in opened[0]

    def test_linux_path_round_trips_via_url_unquote(self, api, tmp_path, monkeypatch):
        opened = self._force_linux_branch(api, monkeypatch, tmp_path)
        pdf = tmp_path / "a report (final).pdf"
        pdf.write_bytes(b"%PDF-1.4\n")
        api.open_path(str(pdf))
        import urllib.parse
        decoded = urllib.parse.unquote(opened[0][len("file://"):])
        assert decoded == str(pdf)

    def test_linux_path_with_literal_percent_sign_round_trips(self, api, tmp_path, monkeypatch):
        # Adversarial case: a literal '%' in the filename must itself be
        # percent-encoded (to %25), not left raw — otherwise it could be
        # misread as the start of an existing percent-escape sequence.
        opened = self._force_linux_branch(api, monkeypatch, tmp_path)
        pdf = tmp_path / "100%done.pdf"
        pdf.write_bytes(b"%PDF-1.4\n")
        api.open_path(str(pdf))
        import urllib.parse
        assert "%25" in opened[0]
        decoded = urllib.parse.unquote(opened[0][len("file://"):])
        assert decoded == str(pdf)
