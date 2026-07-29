## Install

### Option 1: Drag & Drop (manual)

1. Download the latest release from [GitHub Releases](https://github.com/chongoid/network-menubar/releases)
2. Open the `.dmg` file and drag `Network Menubar.app` to `/Applications`
3. Right-click the app in Finder and choose **Open** (first launch may show "Network Menubar is damaged" — see below)
4. On first launch, macOS may show a Gatekeeper warning. To fix:
   ```bash
   xattr -dr com.apple.quarantine "/Applications/Network Menubar.app"
   open /Applications/Network Menubar.app
   ```

### Option 2: One-line install (recommended)

Create an executable install script in your home directory:

```bash
cat > ~/install-menubar.sh <<'EOF'
#!/bin/bash
# Network Menubar single‑line installer
# Downloads the latest DMG for the current architecture, installs it to /Applications,
# clears Gatekeeper quarantine, and launches the app.

set -euo pipefail

# Determine architecture
ARCH=$(uname -m)
case "$ARCH" in
  arm64|aarch64) ARCH_TAG="arm64" ;;
  x86_64)        ARCH_TAG="x64"   ;;
  *)           echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

# Get the latest release tag (GitHub API)
LATEST_JSON=$(curl -s https://api.github.com/repos/chongoid/network-menubar/releases/latest)
RELEASE_URL=$(echo "$LATEST_JSON" | grep -o '"browser_download_url":"[^"]*"$ARCH_TAG*\.dmg"' | cut -d'"' -f4)

if [[ -z "$RELEASE_URL" ]]; then
  echo "Could not find a release asset for $ARCH_TAG. Available assets:" >&2
  echo "$LATEST_JSON" | grep '"browser_download_url"' | grep '.dmg' | cut -d'"' -f4
  exit 1
fi

# Download the DMG to a temporary location
DMG_PATH=$(mktemp --suffix=.dmg)
echo "Downloading $ARCH_TAG DMG…"
curl -L -o "$DMG_PATH" "$RELEASE_URL"

# Mount the DMG
MOUNT_POINT=$(hdiutil attach -mountpoint /tmp/nm_install "$DMG_PATH" | tail -1)
# Find the .app inside the mounted volume
APP_PATH=$(find "$MOUNT_POINT" -maxdepth 1 -type d -name "Network Menubar.app" | head -n1)

if [[ -z "$APP_PATH" ]]; then
  echo "Network Menubar.app not found in mounted DMG." >&2
  hdiutil detach "$MOUNT_POINT" > /dev/null
  exit 1
fi

# Copy the app to /Applications (needs admin password)
echo "Installing Network Menubar to /Applications…"
if sudo cp -R "$APP_PATH" /Applications/; then
  echo "Installation successful."
else
  echo "Failed to copy the app to /Applications." >&2
  hdiutil detach "$MOUNT_POINT" > /dev/null
  exit 1
fi

# Clear Gatekeeper quarantine attribute
echo "Clearing quarantine attribute…"
sudo xattr -dr com.apple.quarantine "/Applications/Network Menubar.app"

# Unmount the DMG
hdiutil detach "$MOUNT_POINT"

# Launch the app
echo "Launching Network Menubar…"
open "/Applications/Network Menubar.app"

echo "Done."