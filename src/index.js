const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell, clipboard, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { exec: execCb } = require('child_process');
const { promisify } = require('util');
const NetworkScanner = require('./network-scanner');
const { createTrayIcon } = require('./tray-icon');

const exec = promisify(execCb);

let mainWindow = null;
let tray = null;
let scanner = null;
let scanInterval = null;
let scanTimeout = null;
let isScanning = false;
let settingsWindow = null;
let welcomeWindow = null;

// App settings (persisted to userData)
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const welcomedPath = path.join(app.getPath('userData'), '.welcomed');
let settings = {
  scanInterval: 30000,
  showOffline: true,
  openAtLogin: false,
  autoUpdateCheck: true
};

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      settings = { ...settings, ...data };
    }
  } catch (e) {
    console.error('[Settings] Load error:', e.message);
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('[Settings] Save error:', e.message);
  }
}

// Simple triangle icon for the menu bar - native macOS template style
function getTrayIcon() {
  try {
    return createTrayIcon();
  } catch (e) {
    console.error('[NetworkMenubar] getTrayIcon error:', e.message);
    return nativeImage.createEmpty();
  }
}

// ============================================================
// WIFI INFO (for menu bar label)
// ============================================================
let wifiCache = { ssid: null, rssi: null, ts: 0 };

async function refreshWifi() {
  // Cache for 10 seconds
  if (Date.now() - wifiCache.ts < 10000) return wifiCache;
  try {
    const airport = '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport';
    const { stdout } = await exec(`${airport} -I 2>/dev/null`);
    const ssidMatch = stdout.match(/^\s*SSID:\s*(.+)$/m);
    const rssiMatch = stdout.match(/^\s*agrCtlRSSI:\s*(-?\d+)/m);
    if (ssidMatch) {
      wifiCache = {
        ssid: ssidMatch[1].trim(),
        rssi: rssiMatch ? parseInt(rssiMatch[1], 10) : null,
        ts: Date.now()
      };
      return wifiCache;
    }

    // airport returned nothing — either on Ethernet, or location permission denied.
    // Check active network interface to distinguish.
    const { stdout: routeOut } = await exec("route -n get default 2>/dev/null | grep -i interface | awk '{print $2}'");
    const iface = routeOut.trim();

    // en0 = WiFi on Mac. en1+ = Ethernet/Thunderbolt.
    if (iface && iface !== 'en0') {
      // On Ethernet — show "Wired"
      wifiCache = { ssid: 'Wired', rssi: null, ts: Date.now(), iface };
    } else if (iface === 'en0') {
      // On en0 (WiFi) but no SSID — could be connecting, or location perms denied
      // Don't say OFFLINE — say "WiFi"
      wifiCache = { ssid: 'WiFi', rssi: null, ts: Date.now(), iface };
    } else {
      wifiCache = { ssid: null, rssi: null, ts: Date.now() };
    }
  } catch (e) {
    wifiCache = { ssid: null, rssi: null, ts: Date.now() };
  }
  return wifiCache;
}

function wifiBars(rssi) {
  if (rssi === null || rssi === undefined) return '●';
  if (rssi >= -50) return '▁▂▃▄';
  if (rssi >= -60) return '▁▂▃▁';
  if (rssi >= -70) return '▁▂▁▁';
  if (rssi >= -80) return '▁▁▁▁';
  return '●';
}

// ============================================================
// TRAY
// ============================================================
function buildTrayMenu(machines) {
  const onlineCount = machines.filter(m => m.online).length;
  const visibleMachines = settings.showOffline
    ? machines
    : machines.filter(m => m.online);

  // Group: online first, then offline
  const sorted = [...visibleMachines].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return (a.name || a.ip).localeCompare(b.name || b.ip);
  });

  // WiFi label at top
  const ssid = wifiCache.ssid;
  const rssi = wifiCache.rssi;
  const bars = wifiBars(rssi);
  const wifiLabel = ssid
    ? `${bars}  ${ssid}${rssi !== null ? ` (${rssi} dBm)` : ''}`
    : `${bars}  Connecting…`;

  return Menu.buildFromTemplate([
    { label: wifiLabel, enabled: false },
    { type: 'separator' },
    ...(sorted.length === 0
      ? [{ label: 'No machines found', enabled: false }]
      : sorted.map(m => {
          const serviceItems = (m.services && m.services.length > 0)
            ? [
                { type: 'separator' },
                { label: 'Services', enabled: false },
                ...m.services.map(s => ({
                  label: `▸  ${s.label}${s.port ? ' :' + s.port : ''}`,
                  click: () => openService(s, m)
                }))
              ]
            : [];

          return {
            label: `${m.online ? '●' : '○'}  ${m.name || m.ip}${m.services && m.services.length > 0 ? `  (${m.services.length})` : ''}`,
            submenu: [
              { label: m.name ? `${m.name}` : '(no hostname)',
                click: () => copyToClipboard(m.name || m.ip, 'Hostname') },
              { label: m.ip,
                click: () => copyToClipboard(m.ip, 'IP') },
              { type: 'separator' },
              { label: `Open SSH Session (${m.name || m.ip})`,
                click: () => openSSH(m.name || m.ip) },
              ...serviceItems
            ]
          };
        })
    ),
    { type: 'separator' },
    { label: 'Refresh Now', click: () => { triggerScan(); }},
    buildSettingsMenu(),
    { type: 'separator' },
    { label: 'Quit Network Menubar', click: () => app.quit() }
  ]);
}

function buildSettingsMenu() {
  return {
    label: 'Settings',
    submenu: Menu.buildFromTemplate([
      {
        label: 'Scan Interval',
        submenu: [15000, 30000, 60000, 300000].map(ms => ({
          label: ms < 60000 ? `${ms / 1000} seconds` : `${ms / 60000} ${ms === 60000 ? 'minute' : 'minutes'}`,
          type: 'radio',
          checked: settings.scanInterval === ms,
          click: () => { settings.scanInterval = ms; saveSettings(); restartScanInterval(); rebuildTray(); }
        }))
      },
      {
        label: 'Show Offline Machines',
        type: 'checkbox',
        checked: settings.showOffline,
        click: (item) => { settings.showOffline = item.checked; saveSettings(); rebuildTray(); }
      },
      {
        label: 'Open at Login',
        type: 'checkbox',
        checked: settings.openAtLogin,
        click: (item) => {
          settings.openAtLogin = item.checked;
          saveSettings();
          try {
            app.setLoginItemSettings({ openAtLogin: item.checked });
          } catch (e) { console.error('[Settings] setLoginItemSettings error:', e.message); }
        }
      },
      {
        label: 'Check for Updates on Startup',
        type: 'checkbox',
        checked: settings.autoUpdateCheck,
        click: (item) => { settings.autoUpdateCheck = item.checked; saveSettings(); }
      },
      { type: 'separator' },
      {
        label: updateAvailable ? `Update Available: v${latestRelease.tag_name.replace(/^v/, '')}` : 'Check for Updates...',
        click: () => { if (updateAvailable) runUpdate(); else checkForUpdates(true); }
      },
      { label: 'About Network Menubar', click: showAbout }
    ])
  };
}

function rebuildTray() {
  if (!tray) return;
  try {
    const machines = scanner ? scanner.getMachines() : [];
    // Refresh WiFi info async (won't block menu build on first run)
    refreshWifi().then(() => {
      if (tray) tray.setContextMenu(buildTrayMenu(machines));
    }).catch(() => {});
    tray.setContextMenu(buildTrayMenu(machines));
    tray.setToolTip(`Network Menubar - ${machines.filter(m => m.online).length} online`);
  } catch (e) {
    console.error('[NetworkMenubar] rebuildTray error:', e.message);
  }
}

function createTray() {
  try {
    const icon = getTrayIcon();
    try { icon.setTemplateImage(true); } catch (e) {}
    tray = new Tray(icon);
    rebuildTray();
  } catch (e) {
    console.error('[NetworkMenubar] createTray error:', e.message);
  }
}

// ============================================================
// ACTIONS
// ============================================================
async function triggerScan() {
  if (scanner && !isScanning) {
    isScanning = true;
    try {
      await scanner.scan();
    } finally {
      isScanning = false;
    }
  }
}

function copyToClipboard(text, label) {
  try {
    clipboard.writeText(String(text));
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('toast', `${label} copied: ${text}`);
    }
  } catch (e) {
    console.error('[NetworkMenubar] clipboard error:', e.message);
  }
}

function openSSH(host) {
  try {
    shell.openExternal(`ssh://${encodeURIComponent(host)}`);
  } catch (e) {
    console.error('[NetworkMenubar] openSSH error:', e.message);
  }
}

function openService(service, host) {
  // service: { type, label, port, scheme }
  try {
    const ip = host.ip || host.name;
    if (!ip) return;

    // Informational-only types — show notification instead
    const infoOnly = ['airplay', 'raop', 'googlecast', 'homekit'];
    if (infoOnly.includes(service.type)) {
      const { Notification } = require('electron');
      new Notification({
        title: `${service.label} on ${ip}`,
        body: service.type === 'googlecast'
          ? 'Open the Google Home app or use Chrome\'s Cast menu to connect.'
          : service.type === 'airplay' || service.type === 'raop'
          ? 'Use System Settings → Display (or right-click the volume icon) to connect via AirPlay.'
          : 'HomeKit accessory detected. Open the Home app on this Mac to manage it.',
        silent: true
      }).show();
      return;
    }

    // Build the URL based on scheme
    let url;
    if (service.type === 'ssh') {
      url = `ssh://${ip}`;
    } else if (service.scheme) {
      url = `${service.scheme}://${ip}${service.port ? ':' + service.port : ''}`;
    } else {
      return;
    }

    shell.openExternal(url);
  } catch (e) {
    console.error('[NetworkMenubar] openService error:', e.message);
  }
}

// ============================================================
// MAIN WINDOW (dashboard)
// ============================================================
function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 520,
    height: 640,
    show: false,
    title: 'Network Menubar',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  return mainWindow;
}

function showDashboard() {
  createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  // Re-center on the display that contains the cursor
  try {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    mainWindow.setBounds({
      x: Math.floor(display.bounds.x + (display.bounds.width - 520) / 2),
      y: Math.floor(display.bounds.y + 80),
      width: 520,
      height: 640
    });
  } catch (e) {}
}

// ============================================================
// WELCOME WINDOW
// ============================================================
function maybeShowWelcome() {
  if (fs.existsSync(welcomedPath)) return;
  try {
    welcomeWindow = new BrowserWindow({
      width: 460,
      height: 340,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'Welcome to Network Menubar',
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#00000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });
    welcomeWindow.loadFile(path.join(__dirname, 'welcome.html'));
    welcomeWindow.once('ready-to-show', () => welcomeWindow.show());
    welcomeWindow.on('closed', () => { welcomeWindow = null; });
  } catch (e) {
    console.error('[NetworkMenubar] welcome window error:', e.message);
  }
}

// ============================================================
// SCAN SCHEDULING
// ============================================================
function restartScanInterval() {
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
  if (scanTimeout) { clearTimeout(scanTimeout); scanTimeout = null; }

  const scheduleNext = () => {
    scanTimeout = setTimeout(async () => {
      if (scanner && !isScanning) {
        isScanning = true;
        try {
          await scanner.scan();
        } finally {
          isScanning = false;
        }
      }
      scheduleNext();
    }, settings.scanInterval);
  };
  scheduleNext();
}

// ============================================================
// AUTO-UPDATER
// ============================================================
let updateAvailable = false;
let latestRelease = null;

function checkForUpdates(manual = false) {
  const opts = {
    hostname: 'api.github.com',
    path: '/repos/chongoid/network-menubar/releases/latest',
    method: 'GET',
    headers: { 'User-Agent': 'NetworkMenubar', 'Accept': 'application/vnd.github+json' }
  };
  const req = https.request(opts, (res) => {
    let body = '';
    res.on('data', (c) => body += c);
    res.on('end', () => {
      try {
        if (res.statusCode !== 200) {
          if (manual) showToast('Could not check for updates');
          return;
        }
        const data = JSON.parse(body);
        latestRelease = data;
        const latestVer = data.tag_name.replace(/^v/, '');
        const currentVer = app.getVersion();
        if (compareVersions(latestVer, currentVer) > 0) {
          updateAvailable = true;
          rebuildTray();
          if (manual) showToast(`Update available: v${latestVer}`);
        } else {
          updateAvailable = false;
          if (manual) showToast(`You are on the latest version (v${currentVer})`);
        }
      } catch (e) {
        console.error('[Updater] parse error:', e.message);
        if (manual) showToast('Update check failed');
      }
    });
  });
  req.on('error', (e) => {
    console.error('[Updater] request error:', e.message);
    if (manual) showToast('Update check failed: network error');
  });
  req.end();
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function showToast(msg) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('toast', msg);
  }
}

async function runUpdate() {
  if (!latestRelease) {
    checkForUpdates(false);
    return;
  }
  
  showToast('Downloading and installing update...');
  
  // Use the install script to handle the full update process:
  // quit existing instance, download, install, relaunch
  const installScriptUrl = 'https://raw.githubusercontent.com/chongoid/network-menubar/main/install.sh';
  const tmpScript = path.join(os.tmpdir(), `nm_install_${Date.now()}.sh`);
  
  try {
    // Download the install script
    await downloadFile(installScriptUrl, tmpScript);
    
    // Make it executable
    fs.chmodSync(tmpScript, '755');
    
    // Quit the current app instance first
    setTimeout(() => {
      app.quit();
    }, 500);
    
    // Run the install script in a child process
    // It will quit any running instance, download, install, and relaunch
    const { exec } = require('child_process');
    exec(`bash "${tmpScript}"`, (error, stdout, stderr) => {
      try { fs.unlinkSync(tmpScript); } catch (e) {}
      if (error) {
        console.error('[Updater] install script error:', error.message);
      }
    });
    
  } catch (e) {
    console.error('[Updater] install error:', e.message);
    showToast(`Update failed: ${e.message}`);
    try { fs.unlinkSync(tmpScript); } catch (e2) {}
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const request = (u) => {
      https.get(u, { headers: { 'User-Agent': 'NetworkMenubar' } }, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          request(response.headers.location);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    };
    request(url);
  });
}

// ============================================================
// ABOUT
// ============================================================
function showAbout() {
  dialog.showMessageBox({
    type: 'info',
    title: 'About Network Menubar',
    message: 'Network Menubar',
    detail: `Version ${app.getVersion()}\n\nShows machines on your local network in the macOS menu bar.\n\nhttps://github.com/chongoid/network-menubar`,
    buttons: ['OK']
  });
}

// ============================================================
// LIFECYCLE
// ============================================================
app.on('window-all-closed', () => {
  // Stay alive in menu bar
});

app.on('before-quit', () => {
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
  if (scanTimeout) { clearTimeout(scanTimeout); scanTimeout = null; }
  if (scanner) scanner.destroy();
});

app.whenReady().then(() => {
  const t0 = Date.now();
  loadSettings();

  // Apply login item setting on launch
  try {
    app.setLoginItemSettings({ openAtLogin: settings.openAtLogin });
  } catch (e) {}

  // Show tray IMMEDIATELY with a "Scanning..." menu
  createTray();

  // Initialize scanner and start scanning
  scanner = new NetworkScanner();
  scanner.on('update', () => {
    // Only rebuild tray menu; mainWindow UI gets update via IPC
    rebuildTray();
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isLoading()) {
      try {
        mainWindow.webContents.send('machines-update', scanner.getMachines());
      } catch (e) {}
    }
  });
  scanner.scan(); // non-blocking; emits incrementally
  restartScanInterval();

  // Create the dashboard window (hidden)
  createMainWindow();

  // First-run welcome
  maybeShowWelcome();

  // Check for updates on startup
  if (settings.autoUpdateCheck) {
    setTimeout(() => checkForUpdates(false), 3000);
  }

  console.log(`[NetworkMenubar] Ready in ${Date.now() - t0}ms`);
});

// ============================================================
// IPC
// ============================================================
ipcMain.handle('get-machines', () => scanner ? scanner.getMachines() : []);
ipcMain.handle('scan', () => { triggerScan(); return true; });
ipcMain.handle('copy-to-clipboard', (e, text) => { copyToClipboard(text, 'Text'); return true; });
ipcMain.handle('open-external', (e, url) => {
  try {
    const parsed = new URL(url);
    if (['ssh:', 'http:', 'https:'].includes(parsed.protocol)) {
      shell.openExternal(url);
      return true;
    }
  } catch (err) {}
  return false;
});
ipcMain.handle('open-ssh', (e, host) => { openSSH(host); return true; });
ipcMain.handle('show-dashboard', () => { showDashboard(); return true; });
ipcMain.handle('hide-dashboard', () => { if (mainWindow) mainWindow.hide(); return true; });
ipcMain.handle('close-welcome', (e, dontShowAgain) => {
  if (dontShowAgain) {
    try { fs.writeFileSync(welcomedPath, new Date().toISOString()); } catch (err) {}
  }
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    welcomeWindow.close();
  }
  return true;
});
ipcMain.handle('get-settings', () => settings);
ipcMain.handle('update-setting', (e, key, value) => {
  if (key in settings) {
    settings[key] = value;
    saveSettings();
    if (key === 'scanInterval') restartScanInterval();
    if (key === 'showOffline') rebuildTray();
    if (key === 'openAtLogin') {
      try { app.setLoginItemSettings({ openAtLogin: value }); } catch (err) {}
    }
    return true;
  }
  return false;
});
ipcMain.handle('check-updates', () => { checkForUpdates(true); return true; });
ipcMain.handle('get-version', () => app.getVersion());