# Network Menubar 🖥️

A macOS menu bar app that displays all machines on your local network with their status, IP addresses, and hostnames.

![Network Menubar](icon.png)

## Features

- 🔍 **Multi-method discovery**: Uses Bonjour/mDNS (http, ssh, afp, smb, nfs, ftp, airplay, raop, printer, scanner, homekit) + ping sweep + reverse DNS
- 📊 **Real-time status**: Online/offline detection with 90-second stale timeout, auto-refresh every 30 seconds
- 📋 **Quick actions**: Copy IP, copy hostname, or open SSH directly from the menu bar
- ⚡ **Batched ping sweep**: Scans 254 IPs in batches of 32 to avoid fork bombs
- 🛡️ **Crash-resistant**: All network ops wrapped in try/catch; global error handlers prevent tray crashes
- 🍎 **macOS native**: Menu bar app with proper entitlements (network.client)
- 🔒 **Privacy-focused**: All discovery happens locally on your network

## Installation

### Download
Download the latest release from [GitHub Releases](https://github.com/chongoid/network-menubar/releases) — open the .dmg and drag the app to Applications.

> **⚠️ First launch ("Network Menubar.app is damaged" error):**
> The app is not signed with an Apple Developer ID, so macOS Gatekeeper will block it.
> Pick whichever fix you prefer:
>
> **Option A — Right-click (one-time per app):**
> In Finder, right-click `Network Menubar.app` → **Open** → **Open** in the dialog.
>
> **Option B — Strip the quarantine flag (Terminal):**
> ```bash
> xattr -dr com.apple.quarantine "/Applications/Network Menubar.app"
> open "/Applications/Network Menubar.app"
> ```
>
> **Option C — Run the included installer helper:**
> A `fix-gatekeeper.sh` script is included with each release. After dragging the app to Applications, run:
> ```bash
> ./fix-gatekeeper.sh
> ```

### Build from Source

Requires Node.js 18+ and a macOS host (or use the GitHub Actions workflow).

```bash
git clone https://github.com/chongoid/network-menubar.git
cd network-menubar
npm install
npm run build:mac
```

The `.dmg` file will be in the `dist/` folder.

## Usage

1. Launch the app — a network icon appears in your menu bar
2. Click the icon to see discovered machines (online first, then offline)
3. For each machine you can:
   - **Copy IP** — copies the IP to clipboard
   - **Copy Name** — copies the hostname to clipboard
   - **SSH** — opens `ssh://hostname` via Terminal
4. The app auto-refreshes every 30 seconds. Use **Refresh** in the menu to force a rescan.

The app runs as a pure menu bar app — no Dock icon, no window on launch. Open the **Settings** menu item to view the hidden dashboard window.

## How it Works

- **Bonjour browse** (3s timeout): Discovers services advertising `_http._tcp`, `_ssh._tcp`, `_afpovertcp._tcp`, `_smb._tcp`, `_nfs._tcp`, `_ftp._tcp`, `_airplay._tcp`, `_raop._tcp`, `_printer._tcp`, `_scanner._tcp`, `_homekit._tcp`, `_hap._tcp`
- **Ping sweep** (batched 32 at a time): Sends 1 ping to each subnet IP with 1-second timeout
- **Reverse DNS**: Looks up PTR records for hosts that don't advertise a Bonjour name
- **Merge**: Bonjour results take precedence (richer metadata). Ping fallback for everything else
- **Stale detection**: Machines not seen for 90 seconds are marked offline (but not removed)

## Tech Stack

- **Electron 28** — Desktop app framework
- **bonjour-service 1.4** — Modern maintained fork of the abandoned `bonjour` package
- **DNS** — Reverse hostname lookup
- **child_process.exec** — ICMP ping via system `ping` (works reliably on macOS, unlike the JS `ping` package)

## License

MIT