#!/bin/bash
# Network Menubar - One-liner installer/updater
# Downloads, installs, and launches the app. Works as both fresh installer
# and updater (quits existing instance, replaces, relaunches).
# Installs to ~/Applications (no sudo required).
# Usage:
#   curl -sL https://raw.githubusercontent.com/chongoid/network-menubar/main/install.sh -o /tmp/nm_install.sh && bash /tmp/nm_install.sh

set -uo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "  🚀 Network Menubar Installer"
echo ""

# Detect platform
OS_TYPE="$(uname -s)"
case "$OS_TYPE" in
  Darwin)
    PLATFORM="macos"
    ;;
  Linux)
    PLATFORM="linux"
    ;;
  *)
    echo "  ${RED}✗ Unsupported platform: $OS_TYPE${NC}"
    exit 1
    ;;
esac

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) ARCH_TAG="arm64" ;;
  x86_64)        ARCH_TAG="x64"   ;;
  *)
    echo "  ${RED}✗ Unsupported architecture: $ARCH${NC}"
    exit 1
    ;;
esac

echo "  📱 Platform: $PLATFORM | Architecture: $ARCH_TAG"

# Get latest release info
echo ""
echo "  🔍 Fetching latest release info..."
LATEST_JSON=$(curl -s "https://api.github.com/repos/chongoid/network-menubar/releases/latest")
if [[ -z "$LATEST_JSON" ]]; then
  echo "  ${RED}✗ No response from GitHub API${NC}"
  exit 1
fi

RELEASE_TAG=$(echo "$LATEST_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tag_name',''))" 2>/dev/null)
echo "     Latest release: ${GREEN}$RELEASE_TAG${NC}"

# Find the .zip asset for our arch
RELEASE_URL=$(echo "$LATEST_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for a in d.get('assets', []):
    name = a.get('name', '')
    if sys.argv[1] in name and name.endswith('.zip'):
        print(a.get('browser_download_url', ''))
        break
" "$ARCH_TAG" 2>/dev/null)

if [[ -z "$RELEASE_URL" ]]; then
  echo "  ${RED}✗ No .zip asset found for $ARCH_TAG${NC}"
  echo "     Available assets:"
  echo "$LATEST_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for a in d.get('assets', []):
    print('       ', a.get('name', ''))
"
  exit 1
fi

# Download
echo ""
echo "  📥 Downloading..."
DOWNLOAD_PATH=$(mktemp /tmp/nm_XXXXXX.zip)
curl -sL -o "$DOWNLOAD_PATH" "$RELEASE_URL"
if [[ ! -s "$DOWNLOAD_PATH" ]]; then
  echo "  ${RED}✗ Download failed${NC}"
  rm -f "$DOWNLOAD_PATH"
  exit 1
fi
FILE_SIZE=$(du -h "$DOWNLOAD_PATH" | cut -f1)
echo "     Downloaded: ${GREEN}${FILE_SIZE}${NC}"

# Determine install location
if [[ "$PLATFORM" == "macos" ]]; then
  # Use ~/Applications (user-writable, no sudo)
  INSTALL_DIR="$HOME/Applications"
  APP_NAME="Network Menubar.app"
  APP_DEST="$INSTALL_DIR/$APP_NAME"
else
  INSTALL_DIR="$HOME/Applications"
  APP_NAME="network-menubar.AppImage"
  APP_DEST="$INSTALL_DIR/$APP_NAME"
fi

mkdir -p "$INSTALL_DIR"

# Extract
echo ""
echo "  📦 Extracting..."
TMP_EXTRACT=$(mktemp -d /tmp/nm_extract_XXXXXX)
unzip -q "$DOWNLOAD_PATH" -d "$TMP_EXTRACT"

if [[ "$PLATFORM" == "macos" ]]; then
  EXTRACTED_APP=$(find "$TMP_EXTRACT" -maxdepth 2 -type d -name "*.app" | head -n1)
  if [[ -z "$EXTRACTED_APP" ]]; then
    echo "  ${RED}✗ .app bundle not found in archive${NC}"
    ls -la "$TMP_EXTRACT"
    rm -rf "$TMP_EXTRACT" "$DOWNLOAD_PATH"
    exit 1
  fi

  # Quit existing instance
  echo "  🛑 Stopping existing instance..."
  osascript -e 'tell application "Network Menubar" to quit' 2>/dev/null || true
  pkill -f "Network Menubar" 2>/dev/null || true
  sleep 1

  # Replace
  echo "  📁 Installing to $INSTALL_DIR..."
  rm -rf "$APP_DEST"
  cp -R "$EXTRACTED_APP" "$APP_DEST"

  # Remove quarantine (zip files don't have it, but just in case)
  xattr -dr com.apple.quarantine "$APP_DEST" 2>/dev/null || true

  # Register with Launch Services so Spotlight finds it
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_DEST" 2>/dev/null || true

  rm -rf "$TMP_EXTRACT" "$DOWNLOAD_PATH"

  # Launch
  echo ""
  echo "  🚀 Launching $APP_NAME..."
  open "$APP_DEST"

  # Wait and verify it launched
  sleep 3
  if pgrep -fl "Network Menubar" > /dev/null; then
    echo ""
    echo "  ${GREEN}🎉 Done! Network Menubar is running in your menu bar.${NC}"
    echo "     Look for the network icon in the top-right of your screen."
  else
    echo ""
    echo "  ${YELLOW}⚠ App may not have launched. Check Console.app for errors.${NC}"
    echo "     You can also try: open '$APP_DEST'"
  fi
else
  # Linux AppImage
  EXTRACTED_APP=$(find "$TMP_EXTRACT" -maxdepth 2 -name "*.AppImage" | head -n1)
  if [[ -z "$EXTRACTED_APP" ]]; then
    echo "  ${RED}✗ AppImage not found in archive${NC}"
    rm -rf "$TMP_EXTRACT" "$DOWNLOAD_PATH"
    exit 1
  fi

  pkill -f "network-menubar" 2>/dev/null || true
  sleep 1

  echo "  📁 Installing to $INSTALL_DIR..."
  rm -f "$APP_DEST"
  cp "$EXTRACTED_APP" "$APP_DEST"
  chmod +x "$APP_DEST"

  rm -rf "$TMP_EXTRACT" "$DOWNLOAD_PATH"

  echo ""
  echo "  🚀 Launching $APP_NAME..."
  nohup "$APP_DEST" >/dev/null 2>&1 &

  sleep 2
  if pgrep -fl "network-menubar" > /dev/null; then
    echo ""
    echo "  ${GREEN}🎉 Done! Network Menubar is running.${NC}"
  else
    echo ""
    echo "  ${YELLOW}⚠ App may not have launched. Try: $APP_DEST${NC}"
  fi
fi