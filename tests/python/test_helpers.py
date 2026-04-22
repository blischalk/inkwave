"""Tests for pure module-level helper functions in app.py."""
import os
import sys
import pytest

import app
from app import (
    _build_system_prompt,
    _user_data_dir,
    _filter_pywebview_errors,
    _list_dir_md_only,
)


# ── _build_system_prompt ──────────────────────────────────────────────────────

class TestBuildSystemPrompt:
    def test_empty_list_says_no_files_open(self):
        result = _build_system_prompt([])
        assert "No files open." in result

    def test_single_file_in_list(self):
        files = [{"path": "/foo/bar.md", "content": "# Hello"}]
        result = _build_system_prompt(files)
        assert "/foo/bar.md" in result
        assert "# Hello" in result

    def test_multiple_files_in_list(self):
        files = [
            {"path": "/a.md", "content": "alpha"},
            {"path": "/b.md", "content": "beta"},
        ]
        result = _build_system_prompt(files)
        assert "/a.md" in result
        assert "/b.md" in result
        assert "alpha" in result
        assert "beta" in result

    def test_dict_form_with_open_directory(self):
        ctx = {"openDirectory": "/my/project", "files": []}
        result = _build_system_prompt(ctx)
        assert "/my/project" in result
        assert "Open Directory" in result

    def test_dict_form_with_files(self):
        ctx = {
            "openDirectory": None,
            "files": [{"path": "/x.md", "content": "content"}],
        }
        result = _build_system_prompt(ctx)
        assert "/x.md" in result

    def test_file_without_path_shows_unsaved(self):
        files = [{"path": None, "content": "draft"}]
        result = _build_system_prompt(files)
        assert "(unsaved)" in result

    def test_file_without_content_key_uses_empty_string(self):
        files = [{"path": "/a.md"}]
        result = _build_system_prompt(files)
        assert "/a.md" in result

    def test_returns_stripped_string(self):
        result = _build_system_prompt([])
        assert not result.endswith("\n")
        assert not result.startswith("\n")


# ── _user_data_dir ────────────────────────────────────────────────────────────

class TestUserDataDir:
    def test_darwin_uses_library_application_support(self, monkeypatch):
        monkeypatch.setattr(sys, "platform", "darwin")
        path = _user_data_dir()
        assert "Library" in path
        assert "Application Support" in path
        assert "Inkwave" in path

    def test_windows_uses_appdata(self, monkeypatch):
        monkeypatch.setattr(os, "name", "nt")
        monkeypatch.setattr(sys, "platform", "win32")
        monkeypatch.setenv("APPDATA", "C:\\Users\\test\\AppData\\Roaming")
        path = _user_data_dir()
        assert "Inkwave" in path

    def test_linux_uses_dot_inkwave(self, monkeypatch):
        monkeypatch.setattr(sys, "platform", "linux")
        monkeypatch.setattr(os, "name", "posix")
        path = _user_data_dir()
        assert ".inkwave" in path


# ── _filter_pywebview_errors ──────────────────────────────────────────────────

class TestFilterPywebviewErrors:
    def test_filters_error_while_processing(self):
        assert _filter_pywebview_errors("[pywebview] Error while processing something") is True

    def test_filters_abstractmethods_with_pywebview(self):
        assert _filter_pywebview_errors("__abstractmethods__ [pywebview] foo") is True

    def test_filters_max_recursion_with_pywebview(self):
        assert _filter_pywebview_errors("maximum recursion depth exceeded [pywebview]") is True

    def test_filters_open_dialog_deprecated(self):
        assert _filter_pywebview_errors("OPEN_DIALOG is deprecated") is True

    def test_passes_through_normal_line(self):
        assert _filter_pywebview_errors("Normal log output") is False

    def test_abstractmethods_without_pywebview_passes_through(self):
        assert _filter_pywebview_errors("__abstractmethods__ without the tag") is False

    def test_max_recursion_without_pywebview_passes_through(self):
        assert _filter_pywebview_errors("maximum recursion depth exceeded elsewhere") is False


# ── _list_dir_md_only ─────────────────────────────────────────────────────────

class TestListDirMdOnly:
    def test_returns_empty_for_nonexistent_dir(self):
        assert _list_dir_md_only("/definitely/does/not/exist") == []

    def test_returns_empty_for_empty_dir(self, tmp_path):
        assert _list_dir_md_only(str(tmp_path)) == []

    def test_includes_md_files(self, tmp_path):
        (tmp_path / "notes.md").write_text("hello")
        entries = _list_dir_md_only(str(tmp_path))
        names = [e["name"] for e in entries]
        assert "notes.md" in names

    def test_includes_markdown_extension(self, tmp_path):
        (tmp_path / "doc.markdown").write_text("content")
        entries = _list_dir_md_only(str(tmp_path))
        assert any(e["name"] == "doc.markdown" for e in entries)

    def test_excludes_non_md_files(self, tmp_path):
        (tmp_path / "readme.txt").write_text("ignore")
        (tmp_path / "image.png").write_bytes(b"\x89PNG")
        entries = _list_dir_md_only(str(tmp_path))
        names = [e["name"] for e in entries]
        assert "readme.txt" not in names
        assert "image.png" not in names

    def test_includes_subdirectories(self, tmp_path):
        (tmp_path / "subdir").mkdir()
        entries = _list_dir_md_only(str(tmp_path))
        names = [e["name"] for e in entries]
        assert "subdir" in names

    def test_directories_come_before_files(self, tmp_path):
        (tmp_path / "notes.md").write_text("hi")
        (tmp_path / "subdir").mkdir()
        entries = _list_dir_md_only(str(tmp_path))
        assert entries[0]["isDir"] is True
        assert entries[1]["isDir"] is False

    def test_entries_are_sorted_alphabetically_within_type(self, tmp_path):
        (tmp_path / "b.md").write_text("")
        (tmp_path / "a.md").write_text("")
        entries = _list_dir_md_only(str(tmp_path))
        file_entries = [e for e in entries if not e["isDir"]]
        assert file_entries[0]["name"] == "a.md"
        assert file_entries[1]["name"] == "b.md"

    def test_entry_has_correct_structure(self, tmp_path):
        (tmp_path / "note.md").write_text("x")
        entries = _list_dir_md_only(str(tmp_path))
        assert "name" in entries[0]
        assert "path" in entries[0]
        assert "isDir" in entries[0]

    def test_path_in_entry_is_absolute(self, tmp_path):
        (tmp_path / "note.md").write_text("x")
        entries = _list_dir_md_only(str(tmp_path))
        assert os.path.isabs(entries[0]["path"])
