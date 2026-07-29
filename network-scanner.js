const EventEmitter = require('events');
const { networkInterfaces, platform } = require('os');
const { exec } = require('child_process');
const dns = require('dns');
const { promisify } = require('util');

const dnsReverse = promisify(dns.reverse);

// Service types to browse via Bonjour
const SERVICE_TYPES = [
  'http',
  'ssh',
  'afpovertcp',
  'smb',
  'nfs',
  'ftp',
  'airplay',
  'raop',
  'printer',
  'scanner',
  'homekit',
  'hap'
];

// Stale machine timeout (90 seconds)
const STALE_TIMEOUT_MS = 90000;

// Max concurrent pings at once
const PING_BATCH_SIZE = 32;

// Overall scan timeout
const SCAN_TIMEOUT_MS = 20000;

// Default ping timeout in seconds
const PING_TIMEOUT_SEC = 1;

class NetworkScanner extends EventEmitter {
  constructor() {
    super();
    this.machines = new Map();
    this.localIP = this.getLocalIP();
    this.subnet = this.getSubnet();
    this.os = platform();
    this.scanVersion = 0; // increments on each scan to track freshness
  }

  getLocalIP() {
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

  getSubnet() {
    const parts = this.localIP.split('.');
    parts.pop();
    return parts.join('.');
  }

  getPingCmd(ip) {
    // macOS uses -c count, -W timeout in seconds
    // Linux uses -c count, -w timeout in seconds
    const t = PING_TIMEOUT_SEC;
    if (this.os === 'darwin') {
      return `ping -c 1 -W ${t} ${ip}`;
    }
    // Linux / others
    return `ping -c 1 -w ${t} ${ip}`;
  }

  // Chunk array into batches of size n
  chunk(arr, n) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += n) {
      chunks.push(arr.slice(i, i + n));
    }
    return chunks;
  }

  async scan() {
    const scanVersion = ++this.scanVersion;
    const timedScan = this._scanWithTimeout(scanVersion);
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Scan timeout')), SCAN_TIMEOUT_MS)
    );

    try {
      await Promise.race([timedScan, timeout]);
    } catch (e) {
      console.error('[NetworkScanner] Scan error:', e.message);
    }
  }

  async _scanWithTimeout(scanVersion) {
    const [bonjourResults, pingResults] = await Promise.all([
      this.scanBonjour().catch(e => {
        console.error('[NetworkScanner] Bonjour scan error:', e.message);
        return [];
      }),
      this.scanPing().catch(e => {
        console.error('[NetworkScanner] Ping scan error:', e.message);
        return [];
      })
    ]);

    // Abort if a newer scan started while we were running
    if (scanVersion !== this.scanVersion) return;

    const now = Date.now();
    const merged = new Map();

    // Seed with existing machines (for stale tracking)
    for (const [ip, m] of this.machines) {
      merged.set(ip, { ...m });
    }

    // Add/overwrite with bonjour results (bonjour name/type is authoritative)
    for (const m of bonjourResults) {
      const existing = merged.get(m.ip);
      merged.set(m.ip, {
        ...(existing || {}),
        ...m,
        online: true,
        lastSeen: now,
        // bonjour name wins
        name: m.name || existing?.name || null,
        type: m.type // bonjour type wins
      });
    }

    // Add ping results only if not already known, or update lastSeen
    for (const m of pingResults) {
      const existing = merged.get(m.ip);
      if (!existing) {
        merged.set(m.ip, {
          ...m,
          online: true,
          lastSeen: now
        });
      } else {
        existing.online = true;
        existing.lastSeen = now;
        // Don't overwrite bonjour name/type with ping data
        if (!existing.name && m.name) existing.name = m.name;
      }
    }

    // Mark stale machines offline
    for (const [ip, m] of merged) {
      if (now - (m.lastSeen || 0) > STALE_TIMEOUT_MS) {
        m.online = false;
      }
    }

    this.machines = merged;
    this.emit('update', Array.from(this.machines.values()));
  }

  async scanBonjour() {
    return new Promise((resolve) => {
      let bonjour;
      const machines = [];
      const seenIps = new Set();

      try {
        // Dynamic require to avoid crashing if package missing
        const Bonjour = require('bonjour-service');
        bonjour = new Bonjour();

        // Browse all service types concurrently
        const servicePromises = SERVICE_TYPES.map(type =>
          new Promise((resolveService) => {
            const browser = bonjour.find({ type });

            browser.on('up', (service) => {
              if (service.host && service.host !== this.localIP && !seenIps.has(service.host)) {
                seenIps.add(service.host);
                machines.push({
                  ip: service.host,
                  name: service.name || null,
                  port: service.port || null,
                  type: `bonjour-${type}`,
                  online: true,
                  lastSeen: Date.now()
                });
              }
            });

            browser.on('down', (service) => {
              // Mark offline when service disappears
              if (service.host) {
                const m = this.machines.get(service.host);
                if (m) m.online = false;
              }
            });

            // Auto-destroy after 3s
            setTimeout(() => {
              try { browser.stop(); } catch (e) {}
              resolveService();
            }, 3000);
          }).catch(() => {})
        );

        // Wait for all browsers + timeout
        Promise.all(servicePromises).then(() => {
          if (bonjour) {
            try { bonjour.destroy(); } catch (e) {}
          }
          resolve(machines);
        });

      } catch (e) {
        console.error('[NetworkScanner] Bonjour init error:', e.message);
        if (bonjour) {
          try { bonjour.destroy(); } catch (e2) {}
        }
        resolve(machines);
      }
    });
  }

  async scanPing() {
    const ips = [];
    for (let i = 1; i <= 254; i++) {
      const ip = `${this.subnet}.${i}`;
      if (ip !== this.localIP) {
        ips.push(ip);
      }
    }

    // Process in batches
    const batches = this.chunk(ips, PING_BATCH_SIZE);
    const allResults = [];

    for (const batch of batches) {
      const results = await Promise.all(
        batch.map(ip => this.pingIP(ip).catch(() => ({ ip, online: false })))
      );
      allResults.push(...results);
      // Small inter-batch delay to avoid network storm
      await new Promise(r => setTimeout(r, 50));
    }

    return allResults.filter(r => r.online);
  }

  pingIP(ip) {
    return new Promise((resolve) => {
      const start = Date.now();

      exec(this.getPingCmd(ip), { timeout: (PING_TIMEOUT_SEC + 1) * 1000 }, (error, stdout, stderr) => {
        if (error) {
          resolve({ ip, online: false });
          return;
        }

        // Resolve hostname asynchronously (non-blocking)
        this.resolveHostname(ip).catch(() => {});

        resolve({
          ip,
          name: `Host ${ip}`,
          online: true,
          type: 'ping',
          responseTime: Date.now() - start
        });
      });
    });
  }

  async resolveHostname(ip) {
    const machine = this.machines.get(ip);
    // Only resolve if we don't have a name yet
    if (machine && !machine.name) {
      try {
        const hostname = await dnsReverse(ip);
        if (hostname && hostname[0]) {
          // Strip domain suffix if present
          machine.name = hostname[0].split('.')[0];
        }
      } catch (e) {
        // DNS lookup failed, ignore
      }
    }
  }

  getMachines() {
    return Array.from(this.machines.values());
  }
}

module.exports = NetworkScanner;
