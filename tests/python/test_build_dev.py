"""Tests for inkwave.spec's dev-build branch logic (bundle identifier,
display name, executable name derivation), without running a full
PyInstaller build.

PyInstaller .spec files are executed via exec(), not imported as a module
(they reference build-time-only names like Analysis/EXE/BUNDLE that only
exist inside PyInstaller's build context). This harness extracts and
evaluates ONLY the four top-level dev-build-branch assignment statements
from the .spec source via AST, with os.environ patched, so the branch
logic itself is unit-testable in isolation.
"""
import ast
import os

import pytest

SPEC_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), "inkwave.spec")

_EXPECTED_NAMES = {"_is_dev_build", "_bundle_id", "_display_name", "_exe_name"}


def _extract_spec_branch_values():
    """Parse inkwave.spec's source and evaluate ONLY the dev-build
    conditional assignment lines, returning the derived values as a dict.

    Raises AssertionError (not KeyError) if inkwave.spec's structure no
    longer matches this harness's assumption of 4 bare top-level
    `Name = ...` assignments — see golden plan Appendix C's hardening note.
    """
    with open(SPEC_PATH, "r", encoding="utf-8") as f:
        source = f.read()
    tree = ast.parse(source, filename=SPEC_PATH)
    namespace = {"os": os}
    found_names = set()
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in _EXPECTED_NAMES:
                module = ast.Module(body=[node], type_ignores=[])
                exec(compile(module, "<spec-branch>", "exec"), namespace)  # noqa: S102 — trusted local file, test-only
                found_names.add(name)
    missing = _EXPECTED_NAMES - found_names
    assert not missing, (
        f"spec harness found {len(found_names)}/{len(_EXPECTED_NAMES)} expected "
        f"assignments (missing: {sorted(missing)}) — inkwave.spec's dev-build "
        f"branch structure no longer matches this test harness's assumption of "
        f"4 bare top-level Name = ... assignments. Update the harness to match."
    )
    return namespace


class TestInkwaveSpecExists:
    def test_spec_file_is_present(self):
        assert os.path.isfile(SPEC_PATH), f"inkwave.spec not found at {SPEC_PATH}"


class TestInkwaveSpecDevBuildBranch:
    def test_production_values_when_env_unset(self, monkeypatch):
        monkeypatch.delenv("INKWAVE_DEV_BUILD", raising=False)
        ns = _extract_spec_branch_values()
        assert ns["_is_dev_build"] is False
        assert ns["_bundle_id"] == "com.inkwave.app"
        assert ns["_display_name"] == "Inkwave"
        assert ns["_exe_name"] == "Inkwave"

    def test_dev_values_when_env_set_to_1(self, monkeypatch):
        monkeypatch.setenv("INKWAVE_DEV_BUILD", "1")
        ns = _extract_spec_branch_values()
        assert ns["_is_dev_build"] is True
        assert ns["_bundle_id"] == "com.inkwave.app.dev"
        assert ns["_display_name"] == "Inkwave (Dev)"
        assert ns["_exe_name"] == "Inkwave-Dev"

    @pytest.mark.parametrize("value", ["0", "true", "yes", "", "2", "TRUE"])
    def test_production_values_for_any_non_exact_1_value(self, monkeypatch, value):
        # Only the exact string "1" triggers dev mode — matches build-dev.sh's
        # own `INKWAVE_DEV_BUILD=1` invocation. Guards against accidental
        # dev-mode activation from a truthy-looking but non-matching value.
        monkeypatch.setenv("INKWAVE_DEV_BUILD", value)
        ns = _extract_spec_branch_values()
        assert ns["_is_dev_build"] is False
        assert ns["_bundle_id"] == "com.inkwave.app"

    def test_dev_app_name_matches_app_py_constant(self, monkeypatch):
        # Locks inkwave.spec's _exe_name (dev) to the same literal string
        # app.py's _DEV_APP_NAME constant uses — the two files cannot share
        # code (PyInstaller .spec files can't import app.py at analysis
        # time), so this exact-string-match assertion is the sync mechanism.
        # `app` is already imported (with webview mocked) by conftest.py.
        import app as _app
        expected = _app._DEV_APP_NAME
        monkeypatch.setenv("INKWAVE_DEV_BUILD", "1")
        ns = _extract_spec_branch_values()
        assert ns["_exe_name"] == expected

    def test_bundle_identifier_prod_and_dev_are_distinct(self, monkeypatch):
        monkeypatch.delenv("INKWAVE_DEV_BUILD", raising=False)
        prod_ns = _extract_spec_branch_values()
        monkeypatch.setenv("INKWAVE_DEV_BUILD", "1")
        dev_ns = _extract_spec_branch_values()
        assert prod_ns["_bundle_id"] != dev_ns["_bundle_id"]
        assert prod_ns["_display_name"] != dev_ns["_display_name"]
        assert prod_ns["_exe_name"] != dev_ns["_exe_name"]
