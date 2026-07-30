#!/bin/bash
# Network Menubar - LOCAL dev installer (run from seebi)
# Pulls source from thinktower via rsync, builds locally, installs, launches.
#
# Usage from seebi:
#   rsync -az --exclude='.git' --exclude='node_modules' --exclude='dist' \
#     thinktower:/home/alsinas/network-menubar/ ~/Projects/network-menubar/
#   bash ~/Projects/network-menubar/local.sh
#
# Or one-liner:
#   ssh thinktower 'cat /home/alsinas/network-menubar/local.sh' > /tmp/nm_local.sh \
#     && bash /tmp/nm_local.sh

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REMOTE_HOST="thinktower"
REMOTE_REPO="/home/alsinas/network-menubar"
LOCAL_REPO="$HOME/Projects/network-menubar"
INSTALL_DIR="$HOME/Applications"
APP_NAME="Network Menubar.app"

echo ""
echo -e "  ${BLUE}🚀 Network Menubar - LOCAL Build${NC}"
echo ""

# Pull source from thinktower
echo -e "  📥 Pulling source from ${REMOTE_HOST}:${REMOTE_REPO}..."
mkdir -p "$HOME/Projects"

if [[ -d "$LOCAL_REPO/.git" ]] || [[ -d "$LOCAL_REPO/package.json" ]]; then
  # Existing repo — incremental update
  rsync -az --exclude='.git' --exclude='node_modules' --exclude='dist' \
    "${REMOTE_HOST}:${REMOTE_REPO}/" "$LOCAL_REPO/"
  echo -e "     ${GREEN}✓${NC} Updated"
else
  # Fresh copy
  rsync -az --exclude='.git' --exclude='node_modules' --exclude='dist' \
    "${REMOTE_HOST}:${REMOTE_REPO}/" "$LOCAL_REPO/"
  echo -e "     ${GREEN}✓${NC} Synced to $LOCAL_REPO"
fi

cd "$LOCAL_REPO"

# Verify we got the right thing
if [[ ! -f "package.json" ]] || ! grep -q '"electron"' package.json 2>/dev/null; then
  echo -e "  ${RED}✗${NC} Rsync failed - no Electron package.json at $LOCAL_REPO"
  exit 1
fi

# Check Node
if ! command -v node &> /dev/null; then
  echo -e "  ${RED}✗${NC} Node.js required. Install: brew install node"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Node.js $(node --version)"

# Install deps if needed
if [[ ! -d "node_modules" ]] || [[ "package.json" -nt "node_modules/.package-lock.json" ]]; then
  echo -e "  📦 Installing dependencies..."
  npm install
fi

# Build for macOS (universal: arm64 + x64)
echo ""
echo -e "  🔨 Building for macOS..."
npm run build:mac-universal 2>&1 | tail -3

# Find the built .app
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
  BUILT_APP="dist/mac-arm64/$APP_NAME"
  [[ ! -d "$BUILT_APP" ]] && BUILT_APP="dist/mac/$APP_NAME"
else
  BUILT_APP="dist/mac/$APP_NAME"
  [[ ! -d "$BUILT_APP" ]] && BUILT_APP="dist/mac-arm64/$APP_NAME"
fi

if [[ ! -d "$BUILT_APP" ]]; then
  echo -e "  ${RED}✗${NC} Build failed - no .app bundle in dist/"
  ls -la dist/ 2>/dev/null
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Built: $BUILT_APP"

# Quit existing
echo ""
echo -e "  🛑 Stopping existing instance..."
osascript -e 'tell application "Network Menubar" to quit' 2>/dev/null || true
pkill -f "Network Menubar" 2>/dev/null || true
sleep 1

# Install
echo -e "  📁 Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALL_DIR/$APP_NAME"
cp -R "$BUILT_APP" "$INSTALL_DIR/$APP_NAME"
xattr -dr com.apple.quarantine "$INSTALL_DIR/$APP_NAME" 2>/dev/null || true

# Launch
echo ""
echo -e "  🚀 Launching..."
open "$INSTALL_DIR/$APP_NAME"

# Verify
sleep 3
if pgrep -fl "Network Menubar" > /dev/null; then
  echo ""
  echo -e "  ${GREEN}🎉 Done! Network Menubar is running in your menu bar.${NC}"
else
  echo ""
  echo -e "  ${YELLOW}⚠ App may not have launched. Try: open '$INSTALL_DIR/$APP_NAME'${NC}"
fi