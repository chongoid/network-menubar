#!/bin/bash
# Network Menubar - One-liner installer/updater
# Downloads, installs, and launches the app. Works as both fresh installer
# and updater (quits existing instance, replaces, relaunches).
# Usage: curl -sL https://raw.githubusercontent.com/chongoid/network-menubar/main/install.sh -o /tmp/nm_install.sh && bash /tmp/nm_install.sh

set -uo pipefail

# Colors and emojis
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Simple spinner for long operations
spin() {
  local pid=$1
  local message=$2
  local spinchars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0
  while kill -0 $pid 2>/dev/null; do
    local char="${spinchars:$((i % 10)):1}"
    printf "\r  ${BLUE}${char}${NC} ${message}"
    sleep 0.1
    ((i++))
  done
  wait $pid
  local exit_code=$?
  printf "\r  ${GREEN}✓${NC} ${message}               \n"
  return $exit_code
}

echo ""
echo "  🚀 Network Menubar Installer"
echo ""

# Step 1: Determine architecture
echo "  📱 [1/5] Detecting architecture..."
ARCH=$(uname -m)
echo "     Architecture: $ARCH"
case "$ARCH" in
  arm64|aarch64) ARCH_TAG="arm64" ;;
  x86_64)        ARCH_TAG="x86_64"   ;;
  *)           echo "     ${RED}✗${NC} Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac
echo "     Using build for: $ARCH_TAG"

# Step 2: Get latest release info from GitHub API
echo ""
echo "  🔍 [2/5] Fetching latest release info from GitHub..."
LATEST_JSON=$(curl -s https://api.github.com/repos/chongoid/network-menubar/releases/latest)
if [[ -z "$LATEST_JSON" ]]; then
  echo "     ${RED}✗${NC} No response from GitHub API" >&2
  exit 1
fi

# Parse JSON with python3
RELEASE_TAG=$(echo "$LATEST_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tag_name',''))" 2>/dev/null)
echo "     Latest release: ${GREEN}$RELEASE_TAG${NC}"

# Look for the DMG asset (Tauri builds DMG for macOS)
RELEASE_URL=$(echo "$LATEST_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
arch_tag = sys.argv[1]
for a in d.get('assets', []):
    name = a.get('name', '')
    if arch_tag in name and name.endswith('.dmg'):
        print(a.get('browser_download_url', ''))
        break
" "$ARCH_TAG" 2>/dev/null)

if [[ -z "$RELEASE_URL" ]]; then
  echo "     ${RED}✗${NC} No DMG asset found" >&2
  echo "     Available assets:" >&2
  echo "$LATEST_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for a in d.get('assets', []):
    print('     ', a.get('name', ''))
" >&2
  exit 1
fi
echo "     Download URL: $RELEASE_URL"

# Step 3: Download
echo ""
echo "  📦 [3/5] Downloading DMG..."
DMG_PATH=$(mktemp /tmp/nm_download_XXXXXX.dmg)
(curl -L --progress-bar -o "$DMG_PATH" "$RELEASE_URL" 2>&1) &
CURL_PID=$!
spin $CURL_PID "Downloading..."
CURL_EXIT=$?

if [[ $CURL_EXIT -ne 0 ]] || [[ ! -s "$DMG_PATH" ]]; then
  echo "     ${RED}✗${NC} Download failed" >&2
  rm -f "$DMG_PATH"
  exit 1
fi

FILE_SIZE=$(du -h "$DMG_PATH" | cut -f1)
echo "     Download complete: ${GREEN}$FILE_SIZE${NC}"

# Step 4: Quit existing instance if running
echo ""
echo "  🛑 [4/5] Stopping existing instance (if running)..."
osascript -e 'tell application "Network Menubar" to quit' 2>/dev/null || true
sleep 1
pkill -f "Network Menubar" 2>/dev/null || true
sleep 0.5
echo "     ${GREEN}✓${NC} Existing instance stopped"

# Step 5: Install
echo ""
echo "  ⚙️  [5/5] Installing to /Applications..."

# Mount the DMG
MOUNT_POINT="/tmp/nm_mount_$(date +%s)"
HDI_OUTPUT=$(hdiutil attach -mountpoint "$MOUNT_POINT" "$DMG_PATH" 2>&1)
if [[ $? -ne 0 ]]; then
  echo "     ${RED}✗${NC} Failed to mount DMG" >&2
  echo "$HDI_OUTPUT" >&2
  rm -f "$DMG_PATH"
  exit 1
fi

APP_PATH=$(find "$MOUNT_POINT" -maxdepth 1 -type d -name "Network Menubar.app" | head -n1)
echo "     Found app: $APP_PATH"

if [[ -z "$APP_PATH" ]]; then
  echo "     ${RED}✗${NC} Network Menubar.app not found in DMG" >&2
  hdiutil detach "$MOUNT_POINT" > /dev/null 2>&1
  rm -f "$DMG_PATH"
  exit 1
fi

# Remove existing app
(sudo rm -rf "/Applications/Network Menubar.app") &
RM_PID=$!
spin $RM_PID "Removing existing app..."

# Copy new app
(sudo cp -R "$APP_PATH" /Applications/) &
CP_PID=$!
spin $CP_PID "Copying to /Applications..."
CP_EXIT=$?

if [[ $CP_EXIT -ne 0 ]]; then
  echo "     ${RED}✗${NC} Failed to copy app to /Applications" >&2
  hdiutil detach "$MOUNT_POINT" > /dev/null 2>&1
  rm -f "$DMG_PATH"
  exit 1
fi

# Clear quarantine
(sudo xattr -dr com.apple.quarantine "/Applications/Network Menubar.app" 2>&1) &
XATTR_PID=$!
spin $XATTR_PID "Clearing quarantine..."
echo "     ${GREEN}✓${NC} Quarantine cleared"

# Unmount and cleanup
hdiutil detach "$MOUNT_POINT" > /dev/null 2>&1
rm -f "$DMG_PATH"

# Launch
echo ""
echo "  🎉 ${GREEN}Installation complete!${NC}"
echo "     Network Menubar should now be running in your menu bar."
echo "     If you don't see it, try right-clicking the app in /Applications and choosing Open."
echo ""
