#!/bin/bash
# Network Menubar - LOCAL dev installer
# Builds directly from this repo, installs to ~/Applications, launches.
# Use this for fast iteration without waiting for GitHub Actions.
#
# Usage (from your dev machine):
#   curl -sL https://raw.githubusercontent.com/chongoid/network-menubar/main/local.sh -o /tmp/nm_local.sh && bash /tmp/nm_local.sh
#
# Or run directly from the repo:
#   bash local.sh
#
# If running from the repo, it uses the local source. If running via curl,
# it clones the repo first.

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REPO_URL="https://github.com/chongoid/network-menubar.git"
LOCAL_REPO="/home/alsinas/network-menubar"
INSTALL_DIR="$HOME/Applications"
APP_NAME="Network Menubar.app"

echo ""
echo -e "  ${BLUE}🚀 Network Menubar - LOCAL Build${NC}"
echo ""

# Check if we're already in the repo
if [[ -f "$LOCAL_REPO/package.json" ]] && grep -q '"electron"' "$LOCAL_REPO/package.json" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Using local repo at $LOCAL_REPO"
  cd "$LOCAL_REPO"
else
  echo -e "  ${YELLOW}⚠${NC} Local repo not found, cloning..."
  git clone "$REPO_URL" "$LOCAL_REPO"
  cd "$LOCAL_REPO"
fi

# Pull latest
git pull --rebase origin main 2>/dev/null || true

# Check Node/npm
if ! command -v node &> /dev/null; then
  echo -e "  ${RED}✗${NC} Node.js is required. Install with: brew install node"
  exit 1
fi

NODE_VERSION=$(node --version)
echo -e "  ${GREEN}✓${NC} Node.js $NODE_VERSION"

# Install deps if needed
if [[ ! -d "node_modules" ]]; then
  echo -e "  📦 Installing dependencies..."
  npm install
fi

# Build for macOS (universal: arm64 + x64)
echo ""
echo -e "  🔨 Building for macOS..."
npm run build:mac-universal 2>&1 | tail -5

# Check build output
if [[ ! -d "dist/mac-arm64/$APP_NAME" ]] && [[ ! -d "dist/mac/$APP_NAME" ]]; then
  echo -e "  ${RED}✗${NC} Build failed - no .app bundle found in dist/"
  ls -la dist/ 2>/dev/null
  exit 1
fi

# Pick the right .app for this machine
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
  BUILT_APP="dist/mac-arm64/$APP_NAME"
else
  BUILT_APP="dist/mac/$APP_NAME"
fi

if [[ ! -d "$BUILT_APP" ]]; then
  # Try the other arch
  if [[ "$ARCH" == "arm64" ]]; then
    BUILT_APP="dist/mac/$APP_NAME"
  else
    BUILT_APP="dist/mac-arm64/$APP_NAME"
  fi
fi

echo -e "  ${GREEN}✓${NC} Built: $BUILT_APP"

# Quit existing instance
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

# Remove quarantine (local builds don't have it, but just in case)
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