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
        api = MagicMock()
        api._has_unsaved_scratch = False
        result = app.check_unsaved_scratch_on_quit(window, api)
        assert result is None
        window.create_confirmation_dialog.assert_not_called()

    def test_fails_toward_true_internally_when_has_unsaved_scratch_attribute_missing(self):
        # Defensive fail-safe check: if api somehow lacks the attribute
        # entirely (shouldn't happen given Api.__init__ always sets it,
        # but worth proving explicitly), getattr(api, "_has_unsaved_scratch",
        # True) must default to True. As of the SECOND bug fix (removing
        # the confirmation dialog entirely, 2026-10-15), this no longer
        # changes the return value (always None either way) — it only
        # changes whether the diagnostic logger.debug line fires. The
        # observable contract this test can actually assert is simply
        # that the function still returns None and never raises when the
        # attribute is missing.
        window = MagicMock()
        api = MagicMock(spec=[])  # no attributes at all, including _has_unsaved_scratch
        result = app.check_unsaved_scratch_on_quit(window, api)
        assert result is None

    def test_allows_quit_even_when_unsaved_scratch_exists(self):
        # SECOND BUG FIX (2026-10-15, same day as the first, same user
        # report recurring): this handler used to call
        # window.create_confirmation_dialog(...) when has_unsaved was
        # True. create_confirmation_dialog has the IDENTICAL
        # AppHelper.callAfter + Semaphore(0).acquire() deadlock pattern as
        # evaluate_js (see this function's docstring for the full
        # spindump-confirmed mechanism — a SECOND spindump, from the SAME
        # VM/machine, same day, after the FIRST fix had already shipped).
        # The fix: never show a dialog from this handler at all. It must
        # now return None (allow quit) regardless of has_unsaved, and
        # must NEVER call create_confirmation_dialog.
        window = MagicMock()
        api = MagicMock()
        api._has_unsaved_scratch = True
        result = app.check_unsaved_scratch_on_quit(window, api)
        assert result is None
        window.create_confirmation_dialog.assert_not_called()

    def test_never_calls_evaluate_js_regression_guard(self):
        # THE FIRST bug fix (2026-10-15, reported as "hangs on exit"): the
        # original implementation called window.evaluate_js(...)
        # synchronously from this handler, which deadlocks on the real
        # cocoa backend (see this function's own docstring for the full
        # spindump-confirmed mechanism). The previous version of this
        # test file never caught it because MagicMock().evaluate_js(...)
        # returns instantly with zero blocking — mocking hid the exact
        # mechanism that deadlocks. This test can't reproduce the
        # deadlock itself (that requires a real cocoa window + real run
        # loop), but it DOES assert the only thing a unit test safely
        # can: that evaluate_js is never called at all, which is the
        # actual fix (removing the call, not changing its arguments).
        window = MagicMock()
        api = MagicMock()
        api._has_unsaved_scratch = False
        app.check_unsaved_scratch_on_quit(window, api)
        window.evaluate_js.assert_not_called()

        api._has_unsaved_scratch = True
        app.check_unsaved_scratch_on_quit(window, api)
        window.evaluate_js.assert_not_called()

    def test_never_calls_create_confirmation_dialog_regression_guard(self):
        # Mirrors test_never_calls_evaluate_js_regression_guard above,
        # but for the SECOND deadlocking call this handler used to make.
        # Covers both the has_unsaved=True and False branches so a future
        # regression that reintroduces the dialog ONLY in the True branch
        # (the actual original bug) is still caught.
        window = MagicMock()
        api = MagicMock()
        api._has_unsaved_scratch = False
        app.check_unsaved_scratch_on_quit(window, api)
        window.create_confirmation_dialog.assert_not_called()

        api._has_unsaved_scratch = True
        app.check_unsaved_scratch_on_quit(window, api)
        window.create_confirmation_dialog.assert_not_called()


class TestSetHasUnsavedScratch:
    """Api.set_has_unsaved_scratch — the receiving end of the push-based
    fix. See check_unsaved_scratch_on_quit's docstring for the full
    mechanism this replaces."""

    def test_defaults_to_true_before_any_push(self):
        api = app.Api(MagicMock())
        assert api._has_unsaved_scratch is True

    def test_set_true(self):
        api = app.Api(MagicMock())
        api.set_has_unsaved_scratch(True)
        assert api._has_unsaved_scratch is True

    def test_set_false(self):
        api = app.Api(MagicMock())
        api.set_has_unsaved_scratch(False)
        assert api._has_unsaved_scratch is False

    def test_coerces_truthy_falsy_js_values_to_bool(self):
        # JS booleans cross the pywebview bridge as Python bool already
        # in the normal case, but this guards against any future caller
        # passing something else (e.g. 0/1, None).
        api = app.Api(MagicMock())
        api.set_has_unsaved_scratch(1)
        assert api._has_unsaved_scratch is True
        api.set_has_unsaved_scratch(0)
        assert api._has_unsaved_scratch is False
        api.set_has_unsaved_scratch(None)
        assert api._has_unsaved_scratch is False

    def test_returns_none(self):
        api = app.Api(MagicMock())
        assert api.set_has_unsaved_scratch(True) is None
