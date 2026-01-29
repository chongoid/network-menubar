# Network Menubar 🖥️

A macOS menu bar app that displays all machines on your network with their status, IP addresses, and names.

![Network Menubar](screenshot.png)

## Features

- 🔍 **Multi-method discovery**: Uses Bonjour, ping sweep, and DNS resolution to find all machines
- 📊 **Real-time status**: Shows online/offline status with auto-refresh every 30 seconds
- 📋 **Quick actions**: Copy IP, copy name, or SSH directly to any machine
- 🍎 **macOS native**: Runs in your menu bar, lightweight and efficient
- 🔒 **Privacy-focused**: All discovery happens locally on your network

## Installation

### Download
Download the latest release from [GitHub Releases](https://github.com/sebastianalsina/network-menubar/releases)

### Build from Source
```bash
git clone https://github.com/sebastianalsina/network-menubar.git
cd network-menubar
npm install
npm run build:mac
```

The `.dmg` file will be in the `dist/` folder.

## Usage

1. Launch the app - it will appear in your menu bar
2. Click the icon to see discovered machines
3. Click on a machine to:
   - **Copy IP** - Copies the IP address to clipboard
   - **Copy Name** - Copies the hostname to clipboard
   - **SSH** - Opens SSH connection to the machine

The app auto-refreshes every 30 seconds. Click "Refresh" to scan manually.

## Development

```bash
npm start          # Run in development mode
npm run build:mac  # Build for macOS
```

## Tech Stack

- **Electron** - Desktop app framework
- **Bonjour/mDNS** - Service discovery
- **Ping** - Network reachability
- **DNS** - Reverse lookup for hostnames

## License

MIT License - feel free to use and modify!
