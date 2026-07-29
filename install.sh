#!/bin/bash
# Network Menubar - One-liner installer
# Downloads the .app directly (no DMG mounting needed)
# Usage: curl -sL https://raw.githubusercontent.com/chongoid/network-menubar/main/install.sh -o /tmp/nm_install.sh && bash /tmp/nm_install.sh

set -uo pipefail

echo "=== Network Menubar Installer ==="
echo ""

# Step 1: Determine architecture
echo "[1/4] Detecting architecture..."
ARCH=$(uname -m)
echo "  Architecture: $ARCH"
case "$ARCH" in
  arm64|aarch64) ARCH_TAG="arm64" ;;
  x86_64)        ARCH_TAG="x64"   ;;
  *)           echo "  ERROR: Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac
echo "  Using build for: $ARCH_TAG"

# Step 2: Get latest release info from GitHub API
echo "[2/4] Fetching latest release info from GitHub..."
LATEST_JSON=$(curl -s https://api.github.com/repos/chongoid/network-menubar/releases/latest)
if [[ -z "$LATEST_JSON" ]]; then
  echo "  ERROR: No response from GitHub API" >&2
  exit 1
fi

# Parse JSON with python3
RELEASE_TAG=$(echo "$LATEST_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tag_name',''))" 2>/dev/null)
echo "  Latest release: $RELEASE_TAG"

# Look for the .zip asset (e.g., "Network Menubar-1.3.1-arm64.zip")
RELEASE_URL=$(echo "$LATEST_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for a in d.get('assets', []):
    name = a.get('name', '')
    if '$ARCH_TAG' in name and name.endswith('.zip'):
        print(a.get('browser_download_url', ''))
        break
" 2>/dev/null)

if [[ -z "$RELEASE_URL" ]]; then
  echo "  ERROR: Could not find a .zip release asset for $ARCH_TAG" >&2
  echo "  Available assets:" >&2
  echo "$LATEST_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for a in d.get('assets', []):
    print('  ', a.get('name', ''))
" >&2
  echo "" >&2
  echo "  Falling back to DMG installer..." >&2
  # Try to get the DMG URL instead
  RELEASE_URL=$(echo "$LATEST_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for a in d.get('assets', []):
    name = a.get('name', '')
    if '$ARCH_TAG' in name and name.endswith('.dmg'):
        print(a.get('browser_download_url', ''))
        break
" 2>/dev/null)
  if [[ -z "$RELEASE_URL" ]]; then
    echo "  ERROR: No DMG or ZIP asset found either." >&2
    exit 1
  fi
  # Use DMG fallback
  echo "  Using DMG: $RELEASE_URL" >&2
  USE_DMG=true
fi

# Step 3: Download and install
if [[ "${USE_DMG:-false}" == "true" ]]; then
  # DMG fallback path
  echo "[3/4] Downloading DMG..."
  DMG_PATH=$(mktemp /tmp/nm_install_XXXXXX.dmg)
  curl -L --progress-bar -o "$DMG_PATH" "$RELEASE_URL"
  echo "  Download complete ($(du -h "$DMG_PATH" | cut -f1))"

  echo "[4/4] Mounting DMG and installing..."
  MOUNT_POINT="/tmp/nm_mount_$(date +%s)"
  HDI_OUTPUT=$(hdiutil attach -mountpoint "$MOUNT_POINT" "$DMG_PATH" 2>&1)
  if [[ $? -ne 0 ]]; then
    echo "  ERROR: Failed to mount DMG" >&2
    echo "$HDI_OUTPUT" >&2
    rm -f "$DMG_PATH"
    exit 1
  fi

  APP_PATH=$(find "$MOUNT_POINT" -maxdepth 1 -type d -name "Network Menubar.app" | head -n1)
  if [[ -z "$APP_PATH" ]]; then
    echo "  ERROR: Network Menubar.app not found in DMG" >&2
    hdiutil detach "$MOUNT_POINT" > /dev/null 2>&1
    rm -f "$DMG_PATH"
    exit 1
  fi

  if sudo cp -R "$APP_PATH" /Applications/; then
    echo "  Installation successful."
  else
    echo "  ERROR: Failed to copy app to /Applications" >&2
    hdiutil detach "$MOUNT_POINT" > /dev/null 2>&1
    rm -f "$DMG_PATH"
    exit 1
  fi

  sudo xattr -dr com.apple.quarantine "/Applications/Network Menubar.app" 2>&1 || true
  hdiutil detach "$MOUNT_POINT" > /dev/null 2>&1
  rm -f "$DMG_PATH"
else
  # ZIP path (preferred - no DMG mounting needed)
  echo "[3/4] Downloading app archive..."
  ZIP_PATH=$(mktemp /tmp/nm_install_XXXXXX.zip)
  curl -L --progress-bar -o "$ZIP_PATH" "$RELEASE_URL"
  echo "  Download complete ($(du -h "$ZIP_PATH" | cut -f1))"

  echo "[4/4] Installing to /Applications..."
  # Extract the .app from the zip
  TMP_EXTRACT=$(mktemp -d /tmp/nm_extract_XXXXXX)
  unzip -q "$ZIP_PATH" -d "$TMP_EXTRACT"
  
  APP_PATH=$(find "$TMP_EXTRACT" -maxdepth 1 -type d -name "Network Menubar.app" | head -n1)
  if [[ -z "$APP_PATH" ]]; then
    echo "  ERROR: Network Menubar.app not found in archive" >&2
    ls -la "$TMP_EXTRACT" >&2
    rm -rf "$TMP_EXTRACT" "$ZIP_PATH"
    exit 1
  fi

  if sudo cp -R "$APP_PATH" /Applications/; then
    echo "  Installation successful."
  else
    echo "  ERROR: Failed to copy app to /Applications" >&2
    rm -rf "$TMP_EXTRACT" "$ZIP_PATH"
    exit 1
  fi

  sudo xattr -dr com.apple.quarantine "/Applications/Network Menubar.app" 2>&1 || true
  rm -rf "$TMP_EXTRACT" "$ZIP_PATH"
fi

# Launch the app
echo ""
echo "=== Installation complete! ==="
echo "Network Menubar should now be running in your menu bar."
echo "If you don't see it, try right-clicking the app in /Applications and choosing Open."
open "/Applications/Network Menubar.app"