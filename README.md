## Install

### Option 1: Drag & Drop (manual)

1. Download the latest release from [GitHub Releases](https://github.com/chongoid/network-menubar/releases)
2. Open the `.dmg` file and drag the app to `/Applications`
3. Right-click the app in Finder and choose **Open** (first launch may show "Network Menubar is damaged" — see below)
4. On first launch, macOS may show a Gatekeeper warning. To fix:
   ```bash
   xattr -dr com.apple.quarantine "/Applications/Network Menubar.app"
   open /Applications/Network Menubar.app
   ```

### Option 2: One-line install (recommended)

Paste this single command into Terminal and press Enter:
```bash
curl -sL https://raw.githubusercontent.com/chongoid/network-menubar/main/install.sh | sudo bash
```

This downloads the script, runs it with `sudo` (prompts for your password), and it will:
- Download the latest release DMG for your architecture
- Install the app to `/Applications`
- Remove the quarantine attribute so you can open it normally
- Launch the app immediately