// Network Menubar - Renderer
// Uses in-place DOM updates for smooth rendering on large machine lists.
const listContainer = document.getElementById('list-container');
const onlineCountEl = document.getElementById('online-count');
const totalCountEl = document.getElementById('total-count');
const toastEl = document.getElementById('toast');
const refreshBtn = document.getElementById('refresh-btn');
const settingsBtn = document.getElementById('settings-btn');
const updateBtn = document.getElementById('update-btn');

// Stable map: ip -> DOM element
const elementByIp = new Map();

let currentMachines = [];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

let toastTimer;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
}

function buildMachineEl(m) {
  const el = document.createElement('div');
  el.className = `machine ${m.online ? 'online' : 'offline'}`;
  el.dataset.ip = m.ip;
  el.dataset.name = m.name || m.ip;
  el.innerHTML = `
    <div class="status-dot"></div>
    <div class="machine-info">
      <div class="machine-name"></div>
      <div class="machine-ip"></div>
    </div>
    <div class="machine-actions">
      <button class="icon-btn" data-action="copy-hostname" title="Copy Hostname">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h10"/></svg>
      </button>
      <button class="icon-btn" data-action="ssh" title="Open SSH">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
      </button>
    </div>`;
  el.querySelector('.machine-name').textContent = m.name || m.ip;
  el.querySelector('.machine-ip').textContent = m.ip;

  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const ip = el.dataset.ip;
      const name = el.dataset.name;
      if (action === 'copy-hostname') {
        window.api.copyToClipboard(name);
        showToast(`Copied: ${name}`);
      } else if (action === 'ssh') {
        window.api.openSSH(name);
      }
    });
  });
  return el;
}

function showEmpty(machines) {
  if (machines.length === 0) {
    if (!listContainer.querySelector('.empty')) {
      listContainer.innerHTML = `
        <div class="empty">
          <div class="empty-title">Scanning network</div>
          <div class="empty-sub">Looking for machines on your local network</div>
        </div>`;
    }
  } else {
    const empty = listContainer.querySelector('.empty');
    if (empty) empty.remove();
  }
}

function renderMachines(machines) {
  currentMachines = machines;

  // Update counters
  const online = machines.filter(m => m.online).length;
  onlineCountEl.textContent = online;
  totalCountEl.textContent = machines.length;

  if (machines.length === 0) {
    listContainer.innerHTML = '';
    elementByIp.clear();
    showEmpty(machines);
    return;
  }
  showEmpty(machines);

  // Sort: online first, then by name
  const sorted = [...machines].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return (a.name || a.ip).localeCompare(b.name || b.ip);
  });

  // Build set of current IPs
  const currentIps = new Set(sorted.map(m => m.ip));

  // Remove elements for IPs no longer present
  for (const [ip, el] of elementByIp) {
    if (!currentIps.has(ip)) {
      el.remove();
      elementByIp.delete(ip);
    }
  }

  // Update or create elements in sorted order
  let prevNode = null;
  for (const m of sorted) {
    let el = elementByIp.get(m.ip);
    if (!el) {
      el = buildMachineEl(m);
      elementByIp.set(m.ip, el);
    } else {
      // In-place update: status class, name, ip
      const newClass = `machine ${m.online ? 'online' : 'offline'}`;
      if (el.className !== newClass) el.className = newClass;
      const nameEl = el.querySelector('.machine-name');
      const ipEl = el.querySelector('.machine-ip');
      const desiredName = m.name || m.ip;
      if (nameEl.textContent !== desiredName) nameEl.textContent = desiredName;
      if (ipEl.textContent !== m.ip) ipEl.textContent = m.ip;
      if (el.dataset.name !== desiredName) el.dataset.name = desiredName;
    }

    // Insert in correct sorted position
    const expectedNext = prevNode ? prevNode.nextSibling : listContainer.firstChild;
    // Skip the .empty element if present
    if (expectedNext && expectedNext.classList && expectedNext.classList.contains('empty')) {
      // Skip past empty
    }
    if (el !== expectedNext && el.previousSibling !== prevNode) {
      if (prevNode) {
        listContainer.insertBefore(el, prevNode.nextSibling);
      } else {
        // Insert at top, but after .empty if present
        const empty = listContainer.querySelector('.empty');
        if (empty) {
          listContainer.insertBefore(el, empty.nextSibling);
        } else {
          listContainer.insertBefore(el, listContainer.firstChild);
        }
      }
    }
    prevNode = el;
  }
}

// Event listeners
refreshBtn.addEventListener('click', () => {
  window.api.scan();
  showToast('Scanning...');
});

settingsBtn.addEventListener('click', () => {
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

// Also poll for updates since Tauri doesn't have the same event system
let lastMachineCount = 0;
setInterval(async () => {
  try {
    const machines = await window.api.getMachines();
    if (machines.length !== lastMachineCount) {
      lastMachineCount = machines.length;
      renderMachines(machines);
    }
  } catch (e) {}
}, 1000);