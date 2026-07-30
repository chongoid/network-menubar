const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Data
  getMachines: () => ipcRenderer.invoke('get-machines'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getVersion: () => ipcRenderer.invoke('get-version'),

  // Actions
  scan: () => ipcRenderer.invoke('scan'),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openSSH: (host) => ipcRenderer.invoke('open-ssh', host),
  showDashboard: () => ipcRenderer.invoke('show-dashboard'),
  hideDashboard: () => ipcRenderer.invoke('hide-dashboard'),
  updateSetting: (key, value) => ipcRenderer.invoke('update-setting', key, value),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  closeWelcome: (dontShowAgain) => ipcRenderer.invoke('close-welcome', dontShowAgain),

  // Events
  onMachinesUpdate: (callback) => {
    ipcRenderer.on('machines-update', (e, machines) => callback(machines));
  },
  onToast: (callback) => {
    ipcRenderer.on('toast', (e, message) => callback(message));
  }
});