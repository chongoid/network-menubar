# Network Menubar

Shows machines on your local network in your menu bar. Built with Tauri (Rust backend + webview frontend).

## Install

```bash
curl -sL https://raw.githubusercontent.com/chongoid/network-menubar/main/install.sh -o /tmp/nm_install.sh && bash /tmp/nm_install.sh
```

Works as both installer and updater — it quits any running instance, replaces the app, and relaunches.

Supports macOS (DMG) and Linux (AppImage).

## Develop

```bash
npm install
npm start
```

## Build

```bash
npm run build
```

Produces platform-specific bundles:
- macOS: DMG
- Linux: AppImage, DEB, RPM

## Structure

```
src/
  index.html       - Dashboard UI
  index.js         - Dashboard frontend logic
  renderer.js      - Dashboard renderer
  preload.js       - Tauri IPC bridge
  network-scanner.js - Bonjour + ping discovery
  welcome.html     - First-run welcome screen
  tray-icon.js     - Tray icon
src-tauri/
  Cargo.toml       - Rust dependencies
  src/main.rs      - Rust backend (scanner, tray, IPC)
  tauri.conf.json  - Tauri configuration
icon.icns          - App icon
entitlements.plist - macOS code signing entitlements
install.sh         - One-line installer/updater
```

## License

MIT
