## Install

### One-line install (recommended)

```bash
curl -sL https://raw.githubusercontent.com/chongoid/network-menubar/main/install.sh -o /tmp/nm_install.sh && bash /tmp/nm_install.sh
```

This downloads the latest release and installs it to `/Applications`. It will:
- Detect your Mac's architecture (Intel or Apple Silicon)
- Download the app archive from GitHub
- Install the app to `/Applications` (prompts for your password)
- Clear the quarantine attribute so you can open it normally
- Launch the app immediately

### Manual install

1. Download the latest release from [GitHub Releases](https://github.com/chongoid/network-menubar/releases)
2. Open the `.dmg` file and drag the app to `/Applications`
3. Right-click the app in Finder and choose **Open**
4. If you see "Network Menubar is damaged", run:
   ```bash
   xattr -dr com.apple.quarantine "/Applications/Network Menubar.app"
   open "/Applications/Network Menubar.app"
   ```