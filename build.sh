#!/usr/bin/env bash
# Build Inkwave.app for macOS
#
# Uses this project's own venv by absolute path instead of bare pip/
# pyinstaller, which resolve via ambient shell PATH and can silently
# pick up whatever venv happens to be active in the calling shell. See
# docs/vendor-references/bash-build-script-explicit-venv-path.md in the
# kali-pentest-scripts-tools repo for the research behind this.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PY="$SCRIPT_DIR/venv/bin/python3"

# Run everything relative to this script's own directory. rm -rf
# build/dist and the PyInstaller invocation below must never operate on
# whatever directory happened to be the caller's cwd.
cd "$SCRIPT_DIR"

if [ ! -x "$VENV_PY" ]; then
  echo "Error: venv not found at $VENV_PY" >&2
  echo "Create it first: python3 -m venv venv && venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

echo "==> Installing build dependencies..."
"$VENV_PY" -m pip install "pyinstaller==6.19.0" "pyinstaller-hooks-contrib==2026.4"

echo "==> Cleaning previous build..."
rm -rf build dist

echo "==> Running PyInstaller..."
"$VENV_PY" -m PyInstaller inkwave.spec

echo ""
echo "==> Build complete: dist/Inkwave.app"
echo ""

# Optional: create a distributable .dmg (requires: brew install create-dmg)
if command -v create-dmg &> /dev/null; then
  echo "==> Creating Inkwave.dmg..."
  create-dmg \
    --volname "Inkwave" \
    --window-pos 200 120 \
    --window-size 600 400 \
    --icon-size 100 \
    --icon "Inkwave.app" 175 190 \
    --hide-extension "Inkwave.app" \
    --app-drop-link 425 190 \
    "dist/Inkwave.dmg" \
    "dist/Inkwave.app"
  echo "==> Installer ready: dist/Inkwave.dmg"
else
  echo "(Skipping .dmg — install create-dmg with: brew install create-dmg)"
fi
