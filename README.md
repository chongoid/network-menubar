# Network Menubar

Shows machines on your local network in your macOS menu bar.

## Install

```bash
curl -sL https://raw.githubusercontent.com/chongoid/network-menubar/main/install.sh -o /tmp/nm_install.sh && bash /tmp/nm_install.sh
```

Works as both installer and updater — it quits any running instance, replaces the app, and relaunches.

## Develop

```bash
npm install
npm start
```

## Build

```bash
npm run build:mac-universal
```

Produces `dist/` with both Intel and Apple Silicon DMGs.

## Structure

```
src/
  index.js         - Electron main process (tray, windows, updates)
  index.html       - Dashboard UI
  renderer.js      - Dashboard frontend logic
  preload.js       - IPC bridge
  network-scanner.js - Bonjour + ping discovery
  welcome.html     - First-run welcome screen
  tray-icon.js     - Native macOS tray icon
icon.icns          - App icon
entitlements.plist - macOS code signing entitlements
install.sh         - One-line installer/updater
```

## License

MIT