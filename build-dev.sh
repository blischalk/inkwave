#!/usr/bin/env bash
# Build Inkwave (Dev).app for macOS, fully isolated from the production build.
#
# Produces an installable .app with a distinct bundle identifier
# (com.inkwave.app.dev), display name (Inkwave (Dev)), and executable name
# (Inkwave-Dev), so it never shares production's settings.json
# (~/Library/Application Support/Inkwave/) or WebKit storage profile
# (~/Library/WebKit/com.inkwave.app/), both of which are keyed by bundle
# identifier on macOS. Output goes to dist-dev/, never dist/.
#
# Uses this project's own venv by absolute path instead of bare pip/
# pyinstaller, which resolve via ambient shell PATH and can silently pick
# up whatever venv happens to be active in the calling shell. See
# docs/vendor-references/bash-build-script-explicit-venv-path.md in the
# kali-pentest-scripts-tools repo for the research behind this.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PY="$SCRIPT_DIR/venv/bin/python3"

# Run everything relative to this script's own directory. rm -rf
# build-dev/dist-dev and the PyInstaller invocation below must never
# operate on whatever directory happened to be the caller's cwd.
cd "$SCRIPT_DIR"

if [ ! -x "$VENV_PY" ]; then
  echo "Error: venv not found at $VENV_PY" >&2
  echo "Create it first: python3 -m venv venv && venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

echo "==> Installing build dependencies..."
"$VENV_PY" -m pip install "pyinstaller==6.19.0" "pyinstaller-hooks-contrib==2026.4"

echo "==> Cleaning previous dev build..."
rm -rf build-dev dist-dev

echo "==> Running PyInstaller (dev build)..."
INKWAVE_DEV_BUILD=1 "$VENV_PY" -m PyInstaller inkwave.spec --distpath dist-dev --workpath build-dev

echo ""
echo "==> Dev build complete: dist-dev/Inkwave-Dev.app"
echo "==> Settings isolated to: ~/Library/Application Support/Inkwave-Dev/"
echo "==> WebKit storage isolated to: ~/Library/WebKit/com.inkwave.app.dev/"
echo ""

# Optional: create a distributable .dmg (requires: brew install create-dmg)
if command -v create-dmg &> /dev/null; then
  echo "==> Creating Inkwave-Dev.dmg..."
  create-dmg \
    --volname "Inkwave (Dev)" \
    --window-pos 200 120 \
    --window-size 600 400 \
    --icon-size 100 \
    --icon "Inkwave-Dev.app" 175 190 \
    --hide-extension "Inkwave-Dev.app" \
    --app-drop-link 425 190 \
    "dist-dev/Inkwave-Dev.dmg" \
    "dist-dev/Inkwave-Dev.app"
  echo "==> Installer ready: dist-dev/Inkwave-Dev.dmg"
else
  echo "(Skipping .dmg, install create-dmg with: brew install create-dmg)"
fi
