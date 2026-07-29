#!/bin/bash
# Network Menubar - One-liner installer/updater
# Downloads, installs, and launches the app. Works as both fresh installer
# and updater (quits existing instance, replaces, relaunches).
# Usage:
#   curl -sL https://raw.githubusercontent.com/chongoid/network-menubar/main/install.sh -o /tmp/nm_install.sh && bash /tmp/nm_install.sh

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Network Menubar Installer 📱${NC}"
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
    echo -e "${RED}✗ Unsupported platform: $OS_TYPE${NC}"
    exit 1
    ;;
esac

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) ARCH_TAG="arm64" ;;
  x86_64|amd64)  ARCH_TAG="x86_64" ;;
  *)
    echo -e "${RED}✗ Unsupported architecture: $ARCH${NC}"
    exit 1
    ;;
esac

echo -e "⚙️  Platform: $PLATFORM"
echo -e "⚙️  Architecture: $ARCH_TAG"

# Fetch latest release info
echo -e "${YELLOW}🔍 Fetching latest release info from GitHub...${NC}"
LATEST_JSON=$(curl -sL "https://api.github.com/repos/chongoid/network-menubar/releases/latest")

# Look for the appropriate asset
if [ "$PLATFORM" = "macos" ]; then
  # Look for DMG asset
  RELEASE_URL=$(echo "$LATEST_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
arch_tag = sys.argv[1]
for a in d.get('assets', []):
    name = a.get('name', '')
    if name.endswith('.dmg') and arch_tag in name:
        print(a['browser_download_url'])
        break
" "$ARCH_TAG")

  if [ -z "$RELEASE_URL" ]; then
    echo -e "${RED}✗ No DMG asset found for $ARCH_TAG${NC}"
    echo "Available assets:"
    echo "$LATEST_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for a in d.get('assets', []):
    print(f'  {a[\"name\"]}')
"
    exit 1
  fi

  echo -e "${GREEN}✅ Latest release: $(echo "$LATEST_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['tag_name'])")${NC}"
  echo -e "📥 Downloading DMG..."

  # Download DMG
  curl -sL "$RELEASE_URL" -o /tmp/nm.dmg

  # Mount the DMG
  echo -e "${YELLOW}🔧 Mounting DMG...${NC}"
  VOL=$(hdiutil attach /tmp/nm.dmg -nobrowse -quiet | awk '/\/Volumes\//{print $NF}')
  if [ -z "$VOL" ]; then
    echo -e "${RED}✗ Failed to mount DMG${NC}"
    exit 1
  fi

  # Copy app to Applications
  APP_SOURCE="$VOL/Network Menubar.app"
  APP_DEST="/Applications/Network Menubar.app"

  echo -e "${YELLOW}📁 Copying to $APP_DEST...${NC}"
  if [ -d "$APP_DEST" ]; then
    rm -rf "$APP_DEST"
  fi
  ditto "$APP_SOURCE" "$APP_DEST"

  # Detach DMG
  echo -e "${YELLOW}🗑️  Detaching DMG...${NC}"
  hdiutil detach "$VOL" -quiet

  # Remove quarantine
  echo -e "${YELLOW}🛡️  Removing quarantine...${NC}"
  xattr -dr com.apple.quarantine "$APP_DEST" 2>/dev/null || true

  # Launch
  echo -e "${GREEN}🚀 Launching app...${NC}"
  open "$APP_DEST"

  echo ""
  echo -e "${GREEN}🌟 Done! Network Menubar is installed and launching.${NC}"
  echo -e "${GREEN}   You can now see it in your menu bar.${NC}"

elif [ "$PLATFORM" = "linux" ]; then
  # Look for AppImage asset
  RELEASE_URL=$(echo "$LATEST_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for a in d.get('assets', []):
    name = a.get('name', '')
    if name.endswith('.AppImage'):
        print(a['browser_download_url'])
        break
")

  if [ -z "$RELEASE_URL" ]; then
    echo -e "${RED}✗ No AppImage asset found${NC}"
    echo "Available assets:"
    echo "$LATEST_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for a in d.get('assets', []):
    print(f'  {a[\"name\"]}')
"
    exit 1
  fi

  echo -e "${GREEN}✅ Latest release: $(echo "$LATEST_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['tag_name'])")${NC}"
  echo -e "📥 Downloading AppImage..."

  # Download AppImage
  curl -sL "$RELEASE_URL" -o /tmp/network-menubar.AppImage
  chmod +x /tmp/network-menubar.AppImage

  # Install to Applications or local bin
  INSTALL_DIR="$HOME/Applications"
  mkdir -p "$INSTALL_DIR"
  cp /tmp/network-menubar.AppImage "$INSTALL_DIR/network-menubar.AppImage"

  # Launch
  echo -e "${GREEN}🚀 Launching app...${NC}"
  "$INSTALL_DIR/network-menubar.AppImage" &

  echo ""
  echo -e "${GREEN}🌟 Done! Network Menubar is installed and launching.${NC}"
  echo -e "${GREEN}   AppImage: $INSTALL_DIR/network-menubar.AppImage${NC}"
fi

exit 0
