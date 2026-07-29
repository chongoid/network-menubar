#!/bin/bash
# Network Menubar - One-liner installer
# This script is designed to be downloaded and run directly
# Usage: curl -sL https://raw.githubusercontent.com/chongoid/network-menubar/main/install.sh -o /tmp/nm_install.sh && bash /tmp/nm_install.sh

set -uo pipefail

echo "=== Network Menubar Installer ==="
echo ""

# Step 1: Determine architecture
echo "[1/6] Detecting architecture..."
ARCH=$(uname -m)
echo "  Architecture: $ARCH"
case "$ARCH" in
  arm64|aarch64) ARCH_TAG="arm64" ;;
  x86_64)        ARCH_TAG="x64"   ;;
  *)           echo "  ERROR: Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac
echo "  Using DMG for: $ARCH_TAG"

# Step 2: Get latest release info from GitHub API
echo "[2/6] Fetching latest release info from GitHub..."
LATEST_JSON=$(curl -s https://api.github.com/repos/chongoid/network-menubar/releases/latest)
if [[ -z "$LATEST_JSON" ]]; then
  echo "  ERROR: No response from GitHub API" >&2
  exit 1
fi

# Parse JSON with python3
RELEASE_TAG=$(echo "$LATEST_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tag_name',''))" 2>/dev/null)
echo "  Latest release: $RELEASE_TAG"

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
  echo "  ERROR: Could not find a release asset for $ARCH_TAG" >&2
  echo "  Available assets:" >&2
  echo "$LATEST_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for a in d.get('assets', []):
    print('  ', a.get('name', ''))
" >&2
  exit 1
fi
echo "  Download URL: $RELEASE_URL"

# Step 3: Download the DMG
echo "[3/6] Downloading DMG..."
DMG_PATH=$(mktemp /tmp/nm_install_XXXXXX.dmg)
echo "  Temp file: $DMG_PATH"
curl -L --progress-bar -o "$DMG_PATH" "$RELEASE_URL"
echo "  Download complete ($(du -h "$DMG_PATH" | cut -f1))"

# Step 4: Mount the DMG
echo "[4/6] Mounting DMG..."
# Use hdiutil attach and extract the mount point from the output
# Output format: /dev/disk5s1\tGUID_volume_name\t/tmp/nm_install
# We want the last field which is the mount point
HDI_OUTPUT=$(hdiutil attach "$DMG_PATH" 2>&1)
MOUNT_POINT=$(echo "$HDI_OUTPUT" | grep '/Volumes\|/tmp' | awk '{print $NF}' | head -1)
if [[ -z "$MOUNT_POINT" ]]; then
  # Fallback: try the -mountpoint flag
  MOUNT_POINT=$(hdiutil attach -mountpoint /tmp/nm_install "$DMG_PATH" 2>&1 | tail -1 | awk '{print $NF}')
fi
echo "  Mounted at: $MOUNT_POINT"

# Find the .app inside the mounted volume
APP_PATH=$(find "$MOUNT_POINT" -maxdepth 1 -type d -name "Network Menubar.app" | head -n1)
echo "  App path: $APP_PATH"

if [[ -z "$APP_PATH" ]]; then
  echo "  ERROR: Network Menubar.app not found in mounted DMG." >&2
  echo "  Contents of mount point:" >&2
  ls -la "$MOUNT_POINT" >&2
  hdiutil detach "$MOUNT_POINT" > /dev/null 2>&1
  exit 1
fi

# Step 5: Install to /Applications
echo "[5/6] Installing to /Applications..."
if sudo cp -R "$APP_PATH" /Applications/; then
  echo "  Installation successful."
else
  echo "  ERROR: Failed to copy the app to /Applications." >&2
  hdiutil detach "$MOUNT_POINT" > /dev/null 2>&1
  exit 1
fi

# Clear Gatekeeper quarantine attribute
echo "  Clearing quarantine attribute..."
sudo xattr -dr com.apple.quarantine "/Applications/Network Menubar.app" 2>&1 || echo "  (xattr: no quarantine attribute found, or already cleared)"

# Unmount the DMG
hdiutil detach "$MOUNT_POINT" > /dev/null 2>&1
echo "  DMG unmounted."

# Clean up temp file
rm -f "$DMG_PATH"

# Step 6: Launch the app
echo "[6/6] Launching Network Menubar..."
open "/Applications/Network Menubar.app"
echo ""
echo "=== Installation complete! ==="
echo "Network Menubar should now be running in your menu bar."
echo "If you don't see it, try right-clicking the app in /Applications and choosing Open."