// Network Menubar - Renderer
const listContainer = document.getElementById('list-container');
const onlineCountEl = document.getElementById('online-count');
const totalCountEl = document.getElementById('total-count');
const toastEl = document.getElementById('toast');
const refreshBtn = document.getElementById('refresh-btn');
const settingsBtn = document.getElementById('settings-btn');
const updateBtn = document.getElementById('update-btn');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toastEl.classList.remove('show'), 2500);
}

function renderMachines(machines) {
  const online = machines.filter(m => m.online).length;
  onlineCountEl.textContent = online;
  totalCountEl.textContent = machines.length;

  // Sort: online first, then by name
  const sorted = [...machines].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return (a.name || a.ip).localeCompare(b.name || b.ip);
  });

  if (sorted.length === 0) {
    listContainer.innerHTML = `
      <div class="empty">
        <div class="empty-title">Scanning network</div>
        <div class="empty-sub">Looking for machines on your local network</div>
      </div>`;
    return;
  }

  listContainer.innerHTML = sorted.map(m => {
    const displayName = m.name || m.ip;
    return `
      <div class="machine ${m.online ? 'online' : 'offline'}" data-ip="${esc(m.ip)}" data-name="${esc(displayName)}">
        <div class="status-dot"></div>
        <div class="machine-info">
          <div class="machine-name">${esc(displayName)}</div>
          <div class="machine-ip">${esc(m.ip)}</div>
        </div>
        <div class="machine-actions">
          <button class="icon-btn" data-action="copy-ip" title="Copy IP">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
          </button>
          <button class="icon-btn" data-action="copy-name" title="Copy Hostname">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h10"/></svg>
          </button>
          <button class="icon-btn" data-action="ssh" title="Open SSH">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');

  // Wire up event listeners
  listContainer.querySelectorAll('.machine').forEach(el => {
    const ip = el.dataset.ip;
    const name = el.dataset.name;
    el.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'copy-ip') {
          window.api.copyToClipboard(ip);
          showToast(`Copied: ${ip}`);
        } else if (action === 'copy-name') {
          window.api.copyToClipboard(name);
          showToast(`Copied: ${name}`);
        } else if (action === 'ssh') {
          window.api.openSSH(name);
        }
      });
    });
  });
}

// Event listeners
refreshBtn.addEventListener('click', () => {
  window.api.scan();
  showToast('Scanning...');
});

settingsBtn.addEventListener('click', () => {
  // Native macOS settings live in the menu bar icon's context menu (click the
  // tray icon to see them). This button just shows a hint.
  showToast('Settings live in the menu bar icon menu');
});

updateBtn.addEventListener('click', () => {
  window.api.checkUpdates();
});

// IPC events
window.api.onMachinesUpdate(renderMachines);
window.api.onToast(showToast);

// Initial load
window.api.getMachines().then(renderMachines).catch(() => {});