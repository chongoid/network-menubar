const { app, BrowserWindow, Menu, ipcMain, nativeImage, Tray } = require('electron');
const path = require('path');
const NetworkScanner = require('./network-scanner');

let mainWindow;
let tray = null;
let scanner = null;

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

function createTray(machines) {
  console.log('Creating tray with', machines.length, 'machines');
  
  if (tray) {
    console.log('Destroying existing tray');
    tray.destroy();
  }

  // Create a simple network icon as template (16x16 PNG)
  const iconData = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAACmSURBVFiF7ZY9TsNAEIW/dYBC4gKq4gL+9Qq9Q+/QO/Qu9A69Q69QKD6gKqhQRFHxJtgYx3F82bZr4h8SUx62Y8f2zDCzs7Mz7we5G1VVDcMwm5j1BlgB3IAL4B44AVbAG+AB2KzX6x1wD5wAr4A78Fiv1zvgHjgBXoF34LFer3fAPfAKvAOv9Xq9A+6BU+ANeK/X6x1wD5wBb8B7vV7vgHvgDHgF3uv1egfcA2fAK/Ber9c74B44A16B93q93gH3wBnwCrzX6/UOuAfOgFf7gV6v1zvgHjgDXoH3er3eAffAGfAKvNfr9Q64B86AV+C9Xq93wD1wBrwC7/V6vQPugTPgFXiv1+sdcA+cAa/Ae71e74B74Ax4Bd7r9XoH3ANnwCvwXq/XO+AeOANegfd6vd4B98AZ8Aq81+v1DrgHzoBX4L1er3fAPXAGvALv9Xq9A+6BM+AVeK/X6x1wD5wBr8B7vV7vgHvgDHgF3uv1egfcA2fAK/Ber9c74B44A16B93q9/u+YA/wBJgG3xU9k1D0AAAAASUVORK5CYII=';
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${iconData}`);
  
  console.log('Icon created, isEmpty:', icon.isEmpty());

  tray = new Tray(icon);
  console.log('Tray created');

  const contextMenu = Menu.buildFromTemplate([
    { label: `🖥️ Network Machines (${machines.length})`, enabled: false },
    { type: 'separator' },
    ...machines.map(m => ({
      label: `${m.online ? '🟢' : '🔴'} ${m.name || m.ip}`,
      submenu: [
        { label: 'Copy IP', click: () => { app.mainWindow?.webContents.send('copy-ip', m.ip); }},
        { label: 'Copy Name', click: () => { app.mainWindow?.webContents.send('copy-name', m.name || m.ip); }},
        { type: 'separator' },
        { label: `SSH: ssh ${m.name || m.ip}`, click: () => { app.mainWindow?.webContents.send('ssh', m); }}
      ]
    })),
    { type: 'separator' },
    { label: '🔄 Refresh', click: () => scanner.scan() },
    { label: '⚙️ Settings', click: () => app.mainWindow?.show() },
    { type: 'separator' },
    { label: '❌ Quit', click: () => app.quit() }
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(`Network Menubar - ${machines.length} machines`);
}

app.whenReady().then(() => {
  // Hide dock icon - this is a menu bar app only
  app.dock?.hide();
  
  console.log('App ready, creating tray...');
  
  // Create invisible main window for IPC
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
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
    console.log('Scanner update, machines:', machines.length);
    createTray(machines);
    mainWindow.webContents.send('machines-update', machines);
  });

  // Initial scan
  scanner.scan();

  // Auto-refresh every 30 seconds
  setInterval(() => scanner.scan(), 30000);
  
  console.log('App initialization complete');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow.show();
  }
});

// IPC handlers
ipcMain.handle('get-machines', () => {
  return scanner ? scanner.getMachines() : [];
});

ipcMain.handle('scan', () => {
  scanner?.scan();
  return true;
});
