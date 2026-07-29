const { invoke } = require('@tauri-apps/api/tauri');
const { appWindow } = require('@tauri-apps/api/window');
const { clipboard } = require('@tauri-apps/api/clipboard');
const { shell } = require('@tauri-apps/api/shell');

// Expose Tauri API to the renderer
window.api = {
  getMachines: () => invoke('get_machines'),
  scan: () => invoke('scan'),
  copyToClipboard: (text) => invoke('copy_to_clipboard', { text, label: 'Text' }),
  openSSH: (host) => invoke('open_ssh', { host }),
  showDashboard: () => invoke('show_dashboard'),
  hideDashboard: () => invoke('hide_dashboard'),
  closeWelcome: (dontShowAgain) => invoke('close_welcome', { dontShowAgain }),
  getSettings: () => invoke('get_settings'),
  updateSetting: (key, value) => invoke('update_setting', { key, value }),
  checkUpdates: () => invoke('check_updates'),
  getVersion: () => invoke('get_version'),
  runUpdate: () => invoke('run_update'),
  
  // Event listeners
  onMachinesUpdate: (callback) => {
    // In Tauri, we'll use a different approach - polling or events
    // For now, set up a polling mechanism
    setInterval(async () => {
      try {
        const machines = await invoke('get_machines');
        callback(machines);
      } catch (e) {}
    }, 1000);
  },
  onToast: (callback) => {
    // Tauri doesn't have a direct equivalent, but we can use events
    // For now, this is a no-op since we handle toasts in the renderer
  }
};

// Listen for scan events from the tray
const { listen } = require('@tauri-apps/api/event');
listen('scan', () => {
  window.api.scan();
});
