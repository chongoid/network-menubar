const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getMachines: () => ipcRenderer.invoke('get-machines'),
  scan: () => ipcRenderer.invoke('scan'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onMachinesUpdate: (callback) => {
    ipcRenderer.on('machines-update', (event, machines) => callback(machines));
  },
  onCopyIP: (callback) => {
    ipcRenderer.on('copy-ip', (event, ip) => callback(ip));
  },
  onCopyName: (callback) => {
    ipcRenderer.on('copy-name', (event, name) => callback(name));
  },
  onSSH: (callback) => {
    ipcRenderer.on('ssh', (event, machine) => callback(machine));
  }
});
