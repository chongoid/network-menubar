#!/bin/bash
# fix-gatekeeper.sh — Strip macOS Gatekeeper quarantine so the unsigned app can launch.
# Run this once after dragging Network Menubar.app to /Applications.

set -e

APP_PATH="${1:-/Applications/Network Menubar.app}"

if [ ! -d "$APP_PATH" ]; then
  echo "❌ App not found at: $APP_PATH"
  echo "Usage: ./fix-gatekeeper.sh [/path/to/Network Menubar.app]"
  echo ""
  echo "If you dragged it to a different location, pass that path as the first argument."
  exit 1
fi

echo "🔧 Removing Gatekeeper quarantine from: $APP_PATH"
xattr -dr com.apple.quarantine "$APP_PATH" 2>&1 || true
echo "✅ Done."

echo ""
echo "🚀 Launching the app..."
open "$APP_PATH"
echo ""
echo "If a menu-bar icon (network nodes) appears in the top-right within a few seconds,"
echo "the fix worked. To quit: click the icon → ❌ Quit."