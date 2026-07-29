const EventEmitter = require('events');
const { networkInterfaces, platform } = require('os');
const { exec } = require('child_process');
const dns = require('dns');
const { promisify } = require('util');

const dnsReverse = promisify(dns.reverse);

// Service types to browse via Bonjour
const SERVICE_TYPES = [
  'http', 'ssh', 'afpovertcp', 'smb', 'nfs', 'ftp',
  'airplay', 'raop', 'printer', 'scanner', 'homekit', 'hap'
];

// Stale machine timeout (90 seconds)
const STALE_TIMEOUT_MS = 90000;

// Max concurrent pings at once
const PING_BATCH_SIZE = 48;

// Overall scan timeout (hard cap)
const SCAN_TIMEOUT_MS = 15000;

// Ping timeout - tightened for faster boot
const PING_TIMEOUT_MS = 500;

// Bonjour browse window - shorter on first scan for fast boot
const BONJOUR_FIRST_MS = 1500;
const BONJOUR_FULL_MS = 2500;

// Inter-batch delay during ping sweep
const PING_BATCH_DELAY_MS = 5;

class NetworkScanner extends EventEmitter {
  constructor() {
    super();
    this.machines = new Map();
    this.localIP = this.getLocalIP();
    this.subnet = this.getSubnet();
    this.os = platform();
    this.scanVersion = 0;
    this.dnsPending = new Set(); // track in-flight dns.reverse lookups
    this.firstScan = true;
    this.lastBonjourMachines = []; // cache last bonjour results
    this.lastPingResults = [];     // cache last ping results
  }

  getLocalIP() {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        // Skip loopback, link-local (169.254), and anything not in standard RFC1918 ranges
        if (net.family !== 'IPv4') continue;
        if (net.internal) continue;
        const ip = net.address;
        if (ip.startsWith('169.254.')) continue; // link-local
        if (!/^(10|172|192)\./.test(ip) && !ip.startsWith('192.168.')) {
          // Not RFC1918 private - could be public WiFi or weird interface
          // Still prefer it over loopback
          return ip;
        }
        return ip;
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
    const t = Math.ceil(PING_TIMEOUT_MS / 1000);
    if (this.os === 'darwin') return `ping -c 1 -W ${t} ${ip}`;
    return `ping -c 1 -w ${t} ${ip}`;
  }

  chunk(arr, n) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += n) chunks.push(arr.slice(i, i + n));
    return chunks;
  }

  async scan(options = {}) {
    const scanVersion = ++this.scanVersion;
    const emitIncremental = options.partial !== false;
    const timedScan = this._scanWithTimeout(scanVersion, emitIncremental);
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Scan timeout')), SCAN_TIMEOUT_MS)
    );

    try {
      await Promise.race([timedScan, timeout]);
    } catch (e) {
      console.error('[NetworkScanner] Scan error:', e.message);
      // Make sure we emit *something* so tray has data
      if (this.machines.size > 0) {
        this.emit('update', Array.from(this.machines.values()));
      }
    }
    this.firstScan = false;
  }

  async _scanWithTimeout(scanVersion, emitIncremental) {
    const bonjourMs = this.firstScan ? BONJOUR_FIRST_MS : BONJOUR_FULL_MS;

    // Kick off ping sweep but don't await it before emitting bonjour results
    const pingPromise = this.scanPing().catch(e => {
      console.error('[NetworkScanner] Ping error:', e.message);
      return this.lastPingResults;
    });

    // Run bonjour browse and emit results as soon as it completes (or times out)
    const bonjourPromise = this.scanBonjour(bonjourMs).catch(e => {
      console.error('[NetworkScanner] Bonjour error:', e.message);
      return this.lastBonjourMachines;
    });

    // Wait for bonjour then emit partial update (fast feedback)
    const bonjourResults = await bonjourPromise;
    this.lastBonjourMachines = bonjourResults;
    if (scanVersion !== this.scanVersion) return;
    if (emitIncremental && bonjourResults.length > 0) {
      this._mergeAndEmitPartial(bonjourResults, []);
    }

    // Wait for ping to complete
    const pingResults = await pingPromise;
    this.lastPingResults = pingResults;
    if (scanVersion !== this.scanVersion) return;

    // Final merge with all data
    this._mergeAndEmit(bonjourResults, pingResults, scanVersion);

    // Fire-and-forget hostname resolution for ping-only hosts
    this._resolveHostnamesInBackground();
  }

  _mergeAndEmitPartial(bonjourResults, pingResults) {
    // Quick merge that doesn't overwrite existing machines
    const now = Date.now();
    let added = false;
    for (const m of bonjourResults) {
      const existing = this.machines.get(m.ip);
      if (!existing) {
        this.machines.set(m.ip, {
          ...m,
          online: true,
          lastSeen: now
        });
        added = true;
      } else {
        existing.online = true;
        existing.lastSeen = now;
        if (m.name && !existing.name) existing.name = m.name;
      }
    }
    if (added) {
      this.emit('update', Array.from(this.machines.values()));
    }
  }

  _mergeAndEmit(bonjourResults, pingResults, scanVersion) {
    if (scanVersion !== this.scanVersion) return;

    const now = Date.now();
    const merged = new Map();

    // Seed with existing machines
    for (const [ip, m] of this.machines) {
      merged.set(ip, { ...m });
    }

    // Bonjour wins for name/type
    for (const m of bonjourResults) {
      const existing = merged.get(m.ip);
      merged.set(m.ip, {
        ...(existing || {}),
        ...m,
        online: true,
        lastSeen: now,
        name: m.name || existing?.name || null,
        type: m.type
      });
    }

    // Ping adds new hosts or refreshes lastSeen
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
        if (!existing.name && m.name) existing.name = m.name;
      }
    }

    // Mark stale
    for (const m of merged.values()) {
      if (now - (m.lastSeen || 0) > STALE_TIMEOUT_MS) {
        m.online = false;
      }
    }

    this.machines = merged;
    this.emit('update', Array.from(this.machines.values()));
  }

  _resolveHostnamesInBackground() {
    // Only resolve for hosts with no name yet
    for (const [ip, machine] of this.machines) {
      if (!machine.name && !this.dnsPending.has(ip)) {
        this.dnsPending.add(ip);
        dnsReverse(ip).then(hostnames => {
          this.dnsPending.delete(ip);
          if (hostnames && hostnames[0]) {
            const m = this.machines.get(ip);
            if (m && !m.name) {
              m.name = hostnames[0].split('.')[0];
              // Emit incremental update so UI sees the name appear
              this.emit('update', Array.from(this.machines.values()));
            }
          }
        }).catch(() => {
          this.dnsPending.delete(ip);
        });
      }
    }
  }

  async scanBonjour(timeoutMs = BONJOUR_FULL_MS) {
    return new Promise((resolve) => {
      const machines = [];
      const seenIps = new Set();
      let bonjour;

      try {
        const Bonjour = require('bonjour-service');
        bonjour = new Bonjour();

        const browsers = SERVICE_TYPES.map(type => {
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
            if (service.host) {
              const m = this.machines.get(service.host);
              if (m) m.online = false;
            }
          });
          return browser;
        });

        setTimeout(() => {
          browsers.forEach(b => { try { b.stop(); } catch (e) {} });
          if (bonjour) {
            try { bonjour.destroy(); } catch (e) {}
          }
          resolve(machines);
        }, timeoutMs);

      } catch (e) {
        console.error('[NetworkScanner] Bonjour init error:', e.message);
        if (bonjour) { try { bonjour.destroy(); } catch (e2) {} }
        resolve(machines);
      }
    });
  }

  async scanPing() {
    // Bail out if no real network (loopback only)
    if (this.localIP === '127.0.0.1') {
      return [];
    }
    const ips = [];
    for (let i = 1; i <= 254; i++) {
      const ip = `${this.subnet}.${i}`;
      if (ip !== this.localIP) ips.push(ip);
    }

    const batches = this.chunk(ips, PING_BATCH_SIZE);
    const allResults = [];

    for (const batch of batches) {
      const results = await Promise.all(
        batch.map(ip => this.pingIP(ip).catch(() => ({ ip, online: false })))
      );
      allResults.push(...results);
      await new Promise(r => setTimeout(r, PING_BATCH_DELAY_MS));
    }

    return allResults.filter(r => r.online);
  }

  pingIP(ip) {
    return new Promise((resolve) => {
      const start = Date.now();
      exec(this.getPingCmd(ip), { timeout: PING_TIMEOUT_MS + 500 }, (error) => {
        if (error) {
          resolve({ ip, online: false });
          return;
        }
        resolve({
          ip,
          name: null, // will be resolved async
          online: true,
          type: 'ping',
          responseTime: Date.now() - start
        });
      });
    });
  }

  getMachines() {
    return Array.from(this.machines.values());
  }

  destroy() {
    // Cleanup if needed
    this.dnsPending.clear();
  }
}

module.exports = NetworkScanner;