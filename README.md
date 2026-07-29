## Install

### One-line install (recommended)

```bash
curl -sL https://raw.githubusercontent.com/chongoid/network-menubar/main/install.sh | bash
```

This downloads and runs the installer script. It will:
- Detect your Mac's architecture (Intel or Apple Silicon)
- Download the latest release DMG from GitHub
- Install the app to `/Applications` (prompts for your password)
- Clear the quarantine attribute so you can open it normally
- Launch the app immediately

**Note:** Run without `sudo` in the pipe — the script handles privilege escalation internally for the copy step.

### Manual install

1. Download the latest release from [GitHub Releases](https://github.com/chongoid/network-menubar/releases)
2. Open the `.dmg` file and drag the app to `/Applications`
3. Right-click the app in Finder and choose **Open**
4. If you see "Network Menubar is damaged", run:
   ```bash
   xattr -dr com.apple.quarantine "/Applications/Network Menubar.app"
   open "/Applications/Network Menubar.app"
   ```