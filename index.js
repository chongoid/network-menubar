const { app, BrowserWindow, Menu, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const NetworkScanner = require('./network-scanner');

let mainWindow;
let tray = null;
let scanner = null;
let scanInterval = null;
let isScanning = false;

// Fallback 16x16 template icon (network icon)
const FALLBACK_ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEZSURBVDiNpZMxTsNAEEX/bIcgHUNVXIWewEnoGTyBB3C0sbFQuwgVYmNjHJA4ICQuKBSyFjvJ4r97bMnGtpPYM/v2zc7OBv5zSukB8A58A0ege04L4B14A26AW+AZOAdegVfgBbgGnoFz4M0b/x14B26BZ+AcuAbGmPt9Y4wB8A5cAo/AE/AMPABPmbkYY25wYYw5A+6BO+ABuAeusvLv9X6v9/sX1/7+/wKcAG/AFXBtTNl3y/IMnGTlK+AZuAFugWvgKXBWZO4KuAUegEfgiTH5W8A7cAW8A2Ngm5lXwDVwDTwBl8aYc2BijLkFboE74B64B+6y8u/1fq/3+xfX/v7/Apxk7gtg/w+YAGfGmFvgDrgH7oFH4Ckrb4Ffv3X9l+8L2XgGxsq+AO6BB+AJmGTl38b8BfgF/AQ0eC7K/4sZMgAAAABJRU5ErkJggg==';

// Get local IP
function getLocalIP() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

// Create a fallback tray icon
function createFallbackIcon() {
  try {
    return nativeImage.createFromDataURL(`data:image/png;base64,${FALLBACK_ICON_BASE64}`);
  } catch (e) {
    return nativeImage.createEmpty();
  }
}

// Get tray icon with fallback
function getTrayIcon() {
  try {
    const iconPath = path.join(__dirname, 'icon.png');
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      return createFallbackIcon();
    }
    return icon;
  } catch (e) {
    return createFallbackIcon();
  }
}

function createTray(machines) {
  try {
    const icon = getTrayIcon();
    
    if (tray) {
      tray.destroy();
    }

    const contextMenu = Menu.buildFromTemplate([
      { label: `🖥️ Network Machines (${machines.length})`, enabled: false },
      { type: 'separator' },
      ...machines.map(m => ({
        label: `${m.online ? '🟢' : '🔴'} ${m.name || m.ip}`,
        submenu: [
          { label: 'Copy IP', click: () => { mainWindow?.webContents.send('copy-ip', m.ip); }},
          { label: 'Copy Name', click: () => { mainWindow?.webContents.send('copy-name', m.name || m.ip); }},
          { type: 'separator' },
          { label: `SSH: ssh ${m.name || m.ip}`, click: () => { mainWindow?.webContents.send('ssh', m); }}
        ]
      })),
      { type: 'separator' },
      { label: '🔄 Refresh', click: () => { if (scanner) scanner.scan(); }},
      { label: '⚙️ Settings', click: () => { mainWindow?.show(); mainWindow?.center(); }},
      { type: 'separator' },
      { label: '❌ Quit', click: () => app.quit() }
    ]);

    tray = new nativeImage(icon.toPNG());
    tray.setContextMenu(contextMenu);
    tray.setToolTip(`Network Menubar - ${machines.length} machines`);
  } catch (e) {
    console.error('[NetworkMenubar] createTray error:', e);
  }
}

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('[NetworkMenubar] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[NetworkMenubar] Unhandled Rejection at:', promise, 'reason:', reason);
});

app.whenReady().then(() => {
  // Create invisible main window for IPC
  mainWindow = new BrowserWindow({
    width: 480,
    height: 600,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');

  // Initialize scanner
  scanner = new NetworkScanner();
  
  scanner.on('update', (machines) => {
    createTray(machines);
    mainWindow.webContents.send('machines-update', machines);
  });

  // Initial scan
  scanner.scan();

  // Auto-refresh every 30 seconds, with scan lock
  scanInterval = setInterval(() => {
    if (scanner && !isScanning) {
      scanner.scan();
    }
  }, 30000);
});

app.on('window-all-closed', () => {
  // Menu bar app - do NOT quit when windows close
  // Only quit on explicit quit() call or Cmd+Q
});

app.on('before-quit', () => {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow.show();
    mainWindow.center();
  }
});

// IPC handlers
ipcMain.handle('get-machines', () => {
  return scanner ? scanner.getMachines() : [];
});

ipcMain.handle('scan', () => {
  if (scanner && !isScanning) {
    scanner.scan();
  }
  return true;
});

ipcMain.handle('open-external', (event, url) => {
  try {
    // Validate URL before opening
    const parsed = new URL(url);
    if (parsed.protocol === 'ssh:' || parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(url);
      return true;
    }
  } catch (e) {
    console.error('[NetworkMenubar] Invalid URL:', url, e);
  }
  return false;
});
