#!/usr/bin/env bash
# Build Inkwave.app for macOS
set -e

echo "==> Installing build dependencies..."
pip install pyinstaller pyinstaller-hooks-contrib

echo "==> Cleaning previous build..."
rm -rf build dist

echo "==> Running PyInstaller..."
pyinstaller inkwave.spec

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
