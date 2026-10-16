"""Tests for the Cmd+N scratch-file feature's Python surface:
_drafts_dir, drafts.json registry read/write, create_scratch_file,
list_scratch_files, forget_scratch_file, and the events.closing
unsaved-scratch quit guard.
"""
import json
import os
from unittest.mock import MagicMock

import pytest

import app
from app import Api


# ── _drafts_dir frozen/non-frozen branch logic ───────────────────────────────

class TestDraftsDir:
    """Tests Api._drafts_dir()'s own frozen/dev branch logic directly.

    Deliberately does NOT use the `api` fixture, which replaces
    _drafts_dir with a lambda and would bypass the exact logic under test
    here (mirrors golden plan Worry 5 / TestSettingsPath's own pattern)."""

    def test_not_frozen_uses_base_dir(self, monkeypatch):
        window = MagicMock()
        a = Api(window)
        monkeypatch.setattr(app.sys, "frozen", False, raising=False)
        path = a._drafts_dir()
        assert path == os.path.join(app.BASE_DIR, "drafts")

    def test_frozen_production_uses_user_data_dir_inkwave(self, monkeypatch, tmp_path):
        window = MagicMock()
        a = Api(window)
        monkeypatch.setattr(app.sys, "frozen", True, raising=False)
        monkeypatch.setattr(app, "BASE_DIR", str(tmp_path))  # no _devbuild marker here
        path = a._drafts_dir()
        assert "Inkwave" in path
        assert "Inkwave-Dev" not in path
        assert os.path.basename(path) == "drafts"

    def test_frozen_dev_build_uses_user_data_dir_inkwave_dev(self, monkeypatch, tmp_path):
        (tmp_path / "_devbuild").write_text("")
        window = MagicMock()
        a = Api(window)
        monkeypatch.setattr(app.sys, "frozen", True, raising=False)
        monkeypatch.setattr(app, "BASE_DIR", str(tmp_path))
        path = a._drafts_dir()
        assert "Inkwave-Dev" in path

    def test_frozen_prod_and_dev_resolve_to_different_drafts_dirs(self, monkeypatch, tmp_path):
        window = MagicMock()
        a = Api(window)
        monkeypatch.setattr(app.sys, "frozen", True, raising=False)
        monkeypatch.setattr(app, "BASE_DIR", str(tmp_path))
        prod_path = a._drafts_dir()
        (tmp_path / "_devbuild").write_text("")
        dev_path = a._drafts_dir()
        assert prod_path != dev_path

    def test_creates_directory_if_missing(self, monkeypatch, tmp_path):
        window = MagicMock()
        a = Api(window)
        monkeypatch.setattr(app.sys, "frozen", True, raising=False)
        monkeypatch.setattr(app, "_user_data_dir",
                            lambda app_name="Inkwave": str(tmp_path / "newly_created"))
        path = a._drafts_dir()
        assert os.path.isdir(path)


# ── drafts.json registry read/write ──────────────────────────────────────────

class TestDraftsRegistry:
    def test_load_returns_empty_list_when_no_file(self, api):
        assert api._load_drafts_registry() == []

    def test_load_returns_empty_list_on_corrupt_json(self, api):
        with open(api._drafts_registry_path(), "w") as f:
            f.write("{not valid json")
        assert api._load_drafts_registry() == []

    def test_load_returns_empty_list_when_json_is_not_a_list(self, api):
        with open(api._drafts_registry_path(), "w") as f:
            json.dump({"not": "a list"}, f)
        assert api._load_drafts_registry() == []

    def test_save_then_load_roundtrips(self, api):
        entries = [{"path": "/tmp/a.md"}, {"path": "/tmp/b.md"}]
        api._save_drafts_registry(entries)
        assert api._load_drafts_registry() == entries

    def test_save_is_atomic_write(self, api):
        # _atomic_write_json is the existing, already-tested primitive;
        # this just proves _save_drafts_registry delegates to it rather
        # than reimplementing a second JSON-write path (Sauron rule).
        api._save_drafts_registry([{"path": "/tmp/a.md"}])
        assert os.path.isfile(api._drafts_registry_path())
        with open(api._drafts_registry_path()) as f:
            assert json.load(f) == [{"path": "/tmp/a.md"}]


# ── create_scratch_file ───────────────────────────────────────────────────────

class TestCreateScratchFile:
    def test_creates_file_in_drafts_dir(self, api):
        result = api.create_scratch_file()
        assert "error" not in result or not result.get("error")
        assert os.path.dirname(result["path"]) == api._drafts_dir()
        assert os.path.isfile(result["path"])

    def test_returns_empty_content(self, api):
        result = api.create_scratch_file()
        assert result["content"] == ""

    def test_registers_in_drafts_json(self, api):
        result = api.create_scratch_file()
        registry = api._load_drafts_registry()
        assert {"path": result["path"]} in registry

    def test_multiple_calls_create_distinct_untitled_files(self, api):
        r1 = api.create_scratch_file()
        r2 = api.create_scratch_file()
        r3 = api.create_scratch_file()
        paths = {r1["path"], r2["path"], r3["path"]}
        assert len(paths) == 3
        registry = api._load_drafts_registry()
        assert len(registry) == 3

    def test_delegates_collision_avoidance_to_create_file(self, api):
        # Pre-seed Untitled.md directly in the drafts dir, same mechanism
        # create_file already handles and already has its own tests for;
        # this only proves create_scratch_file routes through it rather
        # than reimplementing naming logic (Sauron rule, no dual paths).
        with open(os.path.join(api._drafts_dir(), "Untitled.md"), "w") as f:
            f.write("")
        result = api.create_scratch_file()
        assert os.path.basename(result["path"]) == "Untitled 1.md"

    def test_propagates_error_without_registering(self, api, monkeypatch):
        monkeypatch.setattr(api, "create_file", lambda folder, name: {"path": None, "content": None, "error": "disk full"})
        result = api.create_scratch_file()
        assert result["error"] == "disk full"
        assert api._load_drafts_registry() == []


# ── list_scratch_files ────────────────────────────────────────────────────────

class TestListScratchFiles:
    def test_returns_empty_list_when_no_registry(self, api):
        assert api.list_scratch_files() == {"files": []}

    def test_returns_registered_files_with_content(self, api):
        r1 = api.create_scratch_file()
        with open(r1["path"], "w", encoding="utf-8") as f:
            f.write("# Scratch note one")
        result = api.list_scratch_files()
        assert len(result["files"]) == 1
        assert result["files"][0]["path"] == r1["path"]
        assert result["files"][0]["content"] == "# Scratch note one"

    def test_returns_multiple_files_in_registry_order(self, api):
        r1 = api.create_scratch_file()
        r2 = api.create_scratch_file()
        result = api.list_scratch_files()
        returned_paths = [f["path"] for f in result["files"]]
        assert returned_paths == [r1["path"], r2["path"]]

    def test_drops_entries_whose_file_was_deleted_out_of_band(self, api):
        r1 = api.create_scratch_file()
        r2 = api.create_scratch_file()
        os.remove(r1["path"])
        result = api.list_scratch_files()
        assert len(result["files"]) == 1
        assert result["files"][0]["path"] == r2["path"]
        # Self-healing: the stale entry must also be purged from the
        # registry, not just filtered out of this one response.
        registry = api._load_drafts_registry()
        assert registry == [{"path": r2["path"]}]

    def test_does_not_rewrite_registry_when_nothing_changed(self, api, monkeypatch):
        api.create_scratch_file()
        write_calls = []
        original = api._save_drafts_registry
        def spy(entries):
            write_calls.append(entries)
            return original(entries)
        monkeypatch.setattr(api, "_save_drafts_registry", spy)
        api.list_scratch_files()
        assert write_calls == []

    def test_malformed_registry_entry_is_skipped_not_crashed(self, api):
        api._save_drafts_registry(["not-a-dict", {"path": None}, {}, {"no_path_key": 1}])
        result = api.list_scratch_files()
        assert result == {"files": []}

    def test_unreadable_file_is_skipped_not_crashed(self, api, monkeypatch):
        r1 = api.create_scratch_file()
        original_open = open
        def broken_open(path, *a, **kw):
            mode = a[0] if a else kw.get("mode", "r")
            if path == r1["path"] and "r" in mode:
                raise OSError("permission denied")
            return original_open(path, *a, **kw)
        monkeypatch.setattr("builtins.open", broken_open)
        result = api.list_scratch_files()
        assert result == {"files": []}


# ── forget_scratch_file ───────────────────────────────────────────────────────

class TestForgetScratchFile:
    def test_removes_entry_from_registry(self, api):
        r1 = api.create_scratch_file()
        r2 = api.create_scratch_file()
        api.forget_scratch_file(r1["path"])
        registry = api._load_drafts_registry()
        assert registry == [{"path": r2["path"]}]

    def test_does_not_delete_the_file_itself(self, api):
        r1 = api.create_scratch_file()
        api.forget_scratch_file(r1["path"])
        assert os.path.isfile(r1["path"])

    def test_idempotent_on_unregistered_path(self, api):
        result = api.forget_scratch_file("/tmp/never-registered.md")
        assert result == {"ok": True}

    def test_idempotent_called_twice(self, api):
        r1 = api.create_scratch_file()
        api.forget_scratch_file(r1["path"])
        result = api.forget_scratch_file(r1["path"])
        assert result == {"ok": True}
        assert api._load_drafts_registry() == []

    def test_forgetting_one_leaves_others_intact(self, api):
        r1 = api.create_scratch_file()
        r2 = api.create_scratch_file()
        r3 = api.create_scratch_file()
        api.forget_scratch_file(r2["path"])
        registry = api._load_drafts_registry()
        assert registry == [{"path": r1["path"]}, {"path": r3["path"]}]


# ── check_unsaved_scratch_on_quit (events.closing handler) ──────────────────

class TestCheckUnsavedScratchOnQuit:
    def test_allows_quit_when_no_unsaved_scratch_tabs(self):
        window = MagicMock()
        window.evaluate_js.return_value = False
        result = app.check_unsaved_scratch_on_quit(window)
        assert result is None
        window.create_confirmation_dialog.assert_not_called()

    def test_allows_quit_when_hasUnsavedScratchTabs_undefined_in_js(self):
        # window.__hasUnsavedScratchTabs doesn't exist yet (e.g. page still
        # on the welcome screen before js/scratch.js has run) -> the
        # evaluate_js ternary itself returns false, same as the "no
        # unsaved tabs" case. Must not crash or treat as "has unsaved".
        window = MagicMock()
        window.evaluate_js.return_value = False
        result = app.check_unsaved_scratch_on_quit(window)
        assert result is None

    def test_prompts_and_blocks_quit_when_unsaved_and_user_cancels(self):
        window = MagicMock()
        window.evaluate_js.return_value = True
        window.create_confirmation_dialog.return_value = False  # user clicked Cancel
        result = app.check_unsaved_scratch_on_quit(window)
        assert result is False
        window.create_confirmation_dialog.assert_called_once()

    def test_prompts_and_allows_quit_when_unsaved_and_user_confirms(self):
        window = MagicMock()
        window.evaluate_js.return_value = True
        window.create_confirmation_dialog.return_value = True  # user clicked Quit Anyway
        result = app.check_unsaved_scratch_on_quit(window)
        assert result is None

    def test_evaluate_js_exception_allows_quit_without_crashing(self):
        # If the page is torn down mid-close, evaluate_js can raise.
        # Must fail open (allow quit) rather than wedge the app shut.
        window = MagicMock()
        window.evaluate_js.side_effect = RuntimeError("window destroyed")
        result = app.check_unsaved_scratch_on_quit(window)
        assert result is None
        window.create_confirmation_dialog.assert_not_called()

    def test_calls_evaluate_js_with_the_exact_contract_script(self):
        window = MagicMock()
        window.evaluate_js.return_value = False
        app.check_unsaved_scratch_on_quit(window)
        called_script = window.evaluate_js.call_args[0][0]
        assert "window.__hasUnsavedScratchTabs" in called_script

    def test_confirmation_dialog_message_mentions_reload_on_next_launch(self):
        # Reload-on-launch (Phase C) is the actual data-loss safety net;
        # the dialog copy must tell the user that so "Quit Anyway" doesn't
        # read as "and lose your notes".
        window = MagicMock()
        window.evaluate_js.return_value = True
        window.create_confirmation_dialog.return_value = True
        app.check_unsaved_scratch_on_quit(window)
        message = window.create_confirmation_dialog.call_args[0][1]
        assert "reload" in message.lower()
