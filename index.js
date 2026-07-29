const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell, clipboard, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { exec: execCb } = require('child_process');
const { promisify } = require('util');
const NetworkScanner = require('./network-scanner');

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

// Fallback 16x16 template icon
const FALLBACK_ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAFESURBVFhH7ZY9TsNAEIW/dYBC4gKq4gL+9Qq9Q+/QO/Qu9A69Q69QKD6gKqhQRFHxJtgYx3F82bZr4h8SUx62Y8f2zDCzs7Mz7we5G1VVDcMwm5j1BlgB3IAL4B44AVbAG+AB2KzX6x1wD5wAr4A78Fiv1zvgHjgBXoF34LFer3fAPfAKvAOv9Xq9A+6BU+ANeK/X6x1wD5wBb8B7vV7vgHvgDHgF3uv1egfcA2fAK/Ber9c74B44A16B93q93gH3wBnwCrzX6/UOuAfOgFf7gV6v1zvgHjgDXoH3er3eAffAGfAKvNfr9Q64B86AV+C9Xq93wD1wBrwC7/V6vQPugTPgFXiv1+sdcA+cAa/Ae71e74B74Ax4Bd7r9Xq+A+6AM+AVeK/X6x1wD5wBr8B7vV7vgHvgDHgF3uv1egfcA2fAK/Ber9c74B44A16B93q9/u+YA/wBJgG3xU9k1D0AAAAASUVORK5CYII=';

function createFallbackIcon() {
  try {
    return nativeImage.createFromDataURL(`data:image/png;base64,${FALLBACK_ICON_BASE64}`);
  } catch (e) {
    return nativeImage.createEmpty();
  }
}

function getTrayIcon() {
  try {
    const iconPath = path.join(__dirname, 'icon.png');
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) return createFallbackIcon();
    const size = icon.getSize();
    if (size.width > 64 || size.height > 64) {
      return icon.resize({ width: 22, height: 22 });
    }
    return icon;
  } catch (e) {
    return createFallbackIcon();
  }
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

  return Menu.buildFromTemplate([
    { label: `Network Machines (${onlineCount} online)`, enabled: false },
    { type: 'separator' },
    ...(sorted.length === 0
      ? [{ label: 'No machines found', enabled: false }]
      : sorted.map(m => ({
          label: `${m.online ? 'Online' : 'Offline'}  ${m.name || m.ip}`,
          submenu: [
            { label: `IP: ${m.ip}`, enabled: false },
            ...(m.port ? [{ label: `Port: ${m.port}`, enabled: false }] : []),
            { type: 'separator' },
            { label: 'Copy IP', click: () => copyToClipboard(m.ip, 'IP') },
            { label: 'Copy Hostname', click: () => copyToClipboard(m.name || m.ip, 'Hostname') },
            { type: 'separator' },
            { label: `Open SSH Session (${m.name || m.ip})`,
              click: () => openSSH(m.name || m.ip) }
          ]
        }))
    ),
    { type: 'separator' },
    { label: 'Refresh Now', click: () => { if (scanner && !isScanning) scanner.scan(); }},
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

  mainWindow.loadFile('index.html');
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
    welcomeWindow.loadFile('welcome.html');
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
    scanTimeout = setTimeout(() => {
      if (scanner && !isScanning) scanner.scan();
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
  const arch = process.arch === 'arm64' ? 'arm64' : '';
  const asset = latestRelease.assets.find(a =>
    arch ? a.name.includes('arm64') : !a.name.includes('arm64')
  );
  if (!asset) {
    showToast('No DMG asset found in release');
    return;
  }

  // Show progress in tray
  showToast(`Downloading ${asset.name}...`);

  const tmpDir = path.join(os.tmpdir(), `network-menubar-update-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const dmgPath = path.join(tmpDir, asset.name);

  // Download with redirect support
  try {
    await downloadFile(asset.browser_download_url, dmgPath);
    showToast('Mounting DMG...');
    // Mount the DMG
    const { stdout } = await exec(`hdiutil attach -nobrowse -noautoopen "${dmgPath}"`);
    // Parse mount point from output (last line: /Volumes/<name>)
    const lines = stdout.trim().split('\n');
    const mountLine = lines[lines.length - 1];
    const parts = mountLine.split('\t');
    const mountPoint = parts[parts.length - 1].trim();

    // Find .app inside
    const { stdout: lsOut } = await exec(`ls "${mountPoint}"`);
    const appName = lsOut.trim().split('\n').find(n => n.endsWith('.app'));
    if (!appName) throw new Error('No .app found in DMG');

    const sourceApp = path.join(mountPoint, appName);
    const targetApp = path.join('/Applications', appName);

    showToast('Installing update...');

    // Check if we can write to /Applications without sudo
    let needsSudo = true;
    try {
      const testFile = path.join('/Applications', '.nm-write-test');
      fs.writeFileSync(testFile, 'x');
      fs.unlinkSync(testFile);
      needsSudo = false;
    } catch (e) {}

    if (needsSudo) {
      // Use osascript to prompt for password and run cp with sudo
      const script = `do shell script "rm -rf '${targetApp}' && cp -R '${sourceApp}' '${targetApp}'" with administrator privileges`;
      await exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    } else {
      // Direct copy
      await exec(`rm -rf "${targetApp}" && cp -R "${sourceApp}" "${targetApp}"`);
    }

    // Unmount and cleanup
    await exec(`hdiutil detach "${mountPoint}"`);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}

    showToast('Update installed. Restarting...');

    // Relaunch the new app and quit this one
    setTimeout(() => {
      shell.openPath(targetApp);
      setTimeout(() => app.quit(), 1000);
    }, 500);

  } catch (e) {
    console.error('[Updater] install error:', e.message);
    showToast(`Update failed: ${e.message}`);
    try {
      const { stdout: mounts } = await exec('hdiutil info | grep "/Volumes/" | awk \'{print $3}\'');
      mounts.split('\n').forEach(m => {
        if (m.includes('Network Menubar')) {
          exec(`hdiutil detach "${m.trim()}"`).catch(() => {});
        }
      });
    } catch (e2) {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e2) {}
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('machines-update', scanner.getMachines());
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
ipcMain.handle('scan', () => { if (scanner && !isScanning) scanner.scan(); return true; });
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