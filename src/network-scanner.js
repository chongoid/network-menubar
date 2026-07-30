const EventEmitter = require('events');
const { networkInterfaces, platform } = require('os');
const { exec } = require('child_process');
const dns = require('dns');
const { promisify } = require('util');

const dnsReverse = promisify(dns.reverse);

// Cache to dedupe machines across scans by hostname (case-insensitive).
// Key: lowercase hostname. Value: primary IP for that hostname.
const hostToIpCache = new Map();

// Service types to browse via Bonjour for hostnames
const SERVICE_TYPES = [
  'http', 'ssh', 'afpovertcp', 'smb', 'nfs', 'ftp',
  'airplay', 'raop', 'printer', 'scanner', 'homekit', 'hap'
];

// Service types to track as actionable services (with port + click handlers)
// Format: [bonjour_type, display_label, scheme_for_open]
const SERVICE_BROWSER_TYPES = [
  ['ssh',          'SSH',          null],           // opens Terminal with ssh
  ['http',         'HTTP',         'http'],
  ['https',        'HTTPS',        'https'],
  ['smb',          'SMB',          'smb'],
  ['ipp',          'IPP',          'ipp'],
  ['ipps',         'IPPS',         'ipps'],
  ['airplay',      'AirPlay',      null],           // informational only
  ['raop',         'AirPlay Audio',null],
  ['googlecast',   'Chromecast',   null],
  ['homekit',      'HomeKit',      null],
  ['afpovertcp',   'AFP',          'afp'],
];

// Stale machine timeout (5 minutes) — only used as last resort
const STALE_TIMEOUT_MS = 5 * 60 * 1000;
// Grace period for bonjour-only machines (no ping confirmation needed)
const BONJOUR_GRACE_MS = 90 * 1000;

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

    // Browse service types (SSH/HTTP/SMB/AirPlay etc.) and attach to machines
    const servicesPromise = this.scanServices(BONJOUR_FULL_MS).catch(e => {
      console.error('[NetworkScanner] Services error:', e.message);
      return [];
    });
    const services = await servicesPromise;
    if (scanVersion !== this.scanVersion) return;

    // Read local ARP cache to catch sleepers/IoT that don't respond to ping
    const arpPromise = this.scanARP().catch(e => {
      console.error('[NetworkScanner] ARP error:', e.message);
      return [];
    });
    const arpIps = await arpPromise;
    if (scanVersion !== this.scanVersion) return;

    // TCP port scan + HTTP title probe to discover services (Jellyfin, Sonarr, etc.)
    const tcpPromise = this.scanTCP().catch(e => {
      console.error('[NetworkScanner] TCP scan error:', e.message);
      return [];
    });
    const tcpServices = await tcpPromise;
    if (scanVersion !== this.scanVersion) return;

    // Final merge with all data
    this._mergeAndEmit(bonjourResults, pingResults, scanVersion, services, arpIps, tcpServices);

    // Fire-and-forget hostname resolution for ping-only hosts
    this._resolveHostnamesInBackground();
  }

  _mergeAndEmitPartial(bonjourResults, pingResults) {
    // Incremental merge from a partial scan (Bonjour results before ping completes).
    // We update existing entries' name/type/port (Bonjour is authoritative) but we
    // also re-emit when anything changes so the UI stays fresh.
    const now = Date.now();
    let changed = false;
    for (const m of bonjourResults) {
      const existing = this.machines.get(m.ip);
      if (!existing) {
        this.machines.set(m.ip, {
          ...m,
          online: true,
          lastSeen: now
        });
        changed = true;
      } else {
        existing.online = true;
        existing.lastSeen = now;
        // Bonjour is authoritative for name/type/port - update if changed
        if (m.name && (!existing.name || existing.name !== m.name)) {
          existing.name = m.name;
          changed = true;
        }
        if (m.type && existing.type !== m.type) {
          existing.type = m.type;
          changed = true;
        }
        if (m.port && existing.port !== m.port) {
          existing.port = m.port;
          changed = true;
        }
      }
    }
    for (const m of pingResults) {
      const existing = this.machines.get(m.ip);
      if (!existing) {
        this.machines.set(m.ip, {
          ...m,
          online: true,
          lastSeen: now
        });
        changed = true;
      } else if (!existing.online) {
        existing.online = true;
        existing.lastSeen = now;
        changed = true;
      }
    }
    if (changed) {
      this.emit('update', Array.from(this.machines.values()));
    }
  }

  _mergeAndEmit(bonjourResults, pingResults, scanVersion, services = [], arpIps = [], tcpServices = []) {
    if (scanVersion !== this.scanVersion) return;

    const now = Date.now();
    const merged = new Map();

    // Seed with existing machines (preserve services array across scans)
    for (const [ip, m] of this.machines) {
      merged.set(ip, { ...m, services: m.services ? [...m.services] : [] });
    }

    // TCP services: register machines if unknown, attach services to machines
    for (const s of tcpServices) {
      let m = merged.get(s.ip);
      if (!m) {
        m = {
          ip: s.ip,
          name: null,
          online: true,
          lastSeen: now,
          services: []
        };
        merged.set(s.ip, m);
      }
      if (!m.services) m.services = [];
      // Skip if same port already exists (replace title if better)
      const existing = m.services.find(x => x.port === s.port);
      if (existing) {
        // Prefer named services over generic ones
        if (s.name && !existing.name) {
          existing.label = s.label;
          existing.name = s.name;
          existing.type = s.type;
          existing.scheme = s.scheme;
        }
      } else {
        m.services.push({
          type: s.type,
          label: s.label,
          port: s.port,
          name: s.name,
          scheme: s.scheme
        });
      }
    }

    // Mark ARP-only IPs (devices that have communicated but don't respond to ping)
    // These are likely sleepers, IoT, smart TVs. State = 'asleep' (not 'online', not fully 'offline')
    const arpSet = new Set(arpIps);
    for (const ip of arpIps) {
      if (!merged.has(ip)) {
        merged.set(ip, {
          ip,
          name: null,
          online: false,
          asleep: true,  // in ARP cache but not responding to ping
          lastSeen: now,
          services: []
        });
      } else {
        // Known machine — if ping failed previously but ARP shows it, mark as asleep
        const m = merged.get(ip);
        if (!m.online && !m.pingFailed) {
          m.asleep = true;
        }
      }
    }
    // Clear asleep flag if device started responding to ping
    for (const m of merged.values()) {
      if (m.online) m.asleep = false;
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

    // DEDUPE: if multiple IPs share the same hostname (case-insensitive),
    // collapse them to the IP with the most services (most complete record).
    // Merge services from dropped IPs into the kept one.
    const nameGroups = new Map(); // lower(name) -> [{ip, m}, ...]
    for (const [ip, m] of merged) {
      if (m.name) {
        const key = m.name.toLowerCase();
        if (!nameGroups.has(key)) nameGroups.set(key, []);
        nameGroups.get(key).push({ ip, m });
      }
    }
    for (const [, group] of nameGroups) {
      if (group.length <= 1) continue;
      // Sort by services count desc; keep the one with most services (or first if tied)
      group.sort((a, b) => (b.m.services?.length || 0) - (a.m.services?.length || 0));
      const keep = group[0];
      const drop = group.slice(1);
      // Merge services from dropped into kept
      if (!keep.m.services) keep.m.services = [];
      for (const { m: dropped } of drop) {
        if (dropped.services) {
          for (const svc of dropped.services) {
            if (!keep.m.services.some(s => s.type === svc.type)) {
              keep.m.services.push(svc);
            }
          }
        }
      }
      // Remove dropped IPs from merged
      for (const { ip } of drop) {
        merged.delete(ip);
      }
    }

    // Ping adds new hosts or refreshes lastSeen
    for (const m of pingResults) {
      const existing = merged.get(m.ip);
      if (m.online) {
        if (!existing) {
          merged.set(m.ip, {
            ...m,
            online: true,
            lastSeen: now
          });
        } else {
          existing.online = true;
          existing.lastSeen = now;
          existing.pingFailed = false;
          if (!existing.name && m.name) existing.name = m.name;
        }
      } else {
        // Ping failed — flag for offline after grace period
        if (existing) {
          existing.pingFailed = true;
        }
      }
    }

    // Mark stale — only if not seen in a very long time, OR if explicitly
    // flagged by a ping failure (m.pingFailed === true). Bonjour-only
    // machines stay "online" within the grace window since bonjour events
    // are themselves authoritative.
    for (const m of merged.values()) {
      if (m.pingFailed === true && (now - (m.lastSeen || 0)) > BONJOUR_GRACE_MS) {
        m.online = false;
        m.pingFailed = false;  // consume the flag
      } else if (now - (m.lastSeen || 0) > STALE_TIMEOUT_MS) {
        m.online = false;
      }
      // else: keep existing online state
    }

    // Merge service records (replace stale ones, keep fresh)
    const servicesByIp = new Map();
    for (const s of services) {
      if (!servicesByIp.has(s.ip)) servicesByIp.set(s.ip, []);
      servicesByIp.get(s.ip).push(s);
    }
    for (const [ip, svcs] of servicesByIp) {
      const m = merged.get(ip);
      if (!m) continue;
      if (!m.services) m.services = [];
      for (const s of svcs) {
        m.services = m.services.filter(x => x.type !== s.type);
        m.services.push({
          type: s.type,
          label: s.label,
          port: s.port,
          name: s.name,
          scheme: s.scheme
        });
      }
    }

    this.machines = merged;
    this.emit('update', Array.from(this.machines.values()));
  }

  _resolveHostnamesInBackground() {
    // Only resolve for hosts we've never tried to resolve before (not just "no name yet").
    // Otherwise every scan would re-issue DNS queries for known-no-name hosts.
    if (!this.dnsAttempted) this.dnsAttempted = new Set();
    for (const [ip, machine] of this.machines) {
      if (!machine.name && !this.dnsPending.has(ip) && !this.dnsAttempted.has(ip)) {
        this.dnsPending.add(ip);
        this.dnsAttempted.add(ip);
        dnsReverse(ip).then(hostnames => {
          this.dnsPending.delete(ip);
          if (hostnames && hostnames[0]) {
            const m = this.machines.get(ip);
            if (m && !m.name) {
              m.name = hostnames[0].split('.')[0];
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

  async scanServices(timeoutMs = BONJOUR_FULL_MS) {
    // Browse additional service types and attach them to parent machines.
    // Returns array of { ip, type, port, name, txt, scheme } records.
    return new Promise((resolve) => {
      const services = [];
      let bonjour;

      try {
        const Bonjour = require('bonjour-service');
        bonjour = new Bonjour();

        const browsers = SERVICE_BROWSER_TYPES.map(([type, label, scheme]) => {
          const browser = bonjour.find({ type, protocol: 'tcp' });
          browser.on('up', (service) => {
            // Get first IPv4 address from addresses array
            const ip = service.addresses && service.addresses.find(a => a.includes('.')) || service.host;
            if (!ip || ip === this.localIP) return;

            services.push({
              ip,
              type,
              label,
              port: service.port || null,
              name: service.name || null,
              txt: service.txt || {},
              scheme
            });

            // Attach to parent machine if it exists, creating a placeholder if not
            let m = this.machines.get(ip);
            if (!m) {
              m = {
                ip,
                name: service.name || null,
                online: true,
                lastSeen: Date.now(),
                services: []
              };
              this.machines.set(ip, m);
            }
            if (!m.services) m.services = [];
            // Replace any existing entry for this type
            m.services = m.services.filter(s => s.type !== type);
            m.services.push({ type, label, port: service.port, name: service.name, scheme });
          });
          return browser;
        });

        setTimeout(() => {
          browsers.forEach(b => { try { b.stop(); } catch (e) {} });
          if (bonjour) { try { bonjour.destroy(); } catch (e) {} }
          resolve(services);
        }, timeoutMs);

      } catch (e) {
        console.error('[NetworkScanner] scanServices error:', e.message);
        if (bonjour) { try { bonjour.destroy(); } catch (e) {} }
        resolve([]);
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

    // Return BOTH success and failure so the merger can flag offline machines
    return allResults;
  }

  // Read local ARP cache to find devices that communicated with us recently
  // even if they don't respond to ICMP (sleepers, IoT, smart TVs).
  async scanARP() {
    try {
      const { stdout } = await exec('arp -an 2>/dev/null');
      const ips = new Set();
      // Parse "?(10.0.0.1) at d8:9c:8e:7b:57:e8 [ether] on en0"
      const re = /\((\d+\.\d+\.\d+\.\d+)\)/g;
      let m;
      while ((m = re.exec(stdout)) !== null) {
        const ip = m[1];
        // Skip loopback and self
        if (ip !== this.localIP && !ip.startsWith('127.') && !ip.startsWith('224.') && !ip.startsWith('255.')) {
          ips.add(ip);
        }
      }
      return Array.from(ips);
    } catch (e) {
      console.error('[NetworkScanner] scanARP error:', e.message);
      return [];
    }
  }

  // Scan common service ports on all known IPs and probe HTTP for app titles.
  // Returns array of { ip, port, type, name?, scheme, title? } records.
  // "type" is a best-guess label; "name" is HTTP title if available.
  async scanTCP() {
    if (this.localIP === '127.0.0.1' || !this.machines.size) return [];

    // Known port -> service label mapping (from IANA + common conventions)
    const PORT_LABELS = {
      21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS',
      80: 'HTTP', 110: 'POP3', 111: 'RPC', 135: 'MS-RPC', 139: 'NetBIOS',
      143: 'IMAP', 161: 'SNMP', 389: 'LDAP', 443: 'HTTPS', 445: 'SMB',
      465: 'SMTPS', 514: 'Syslog', 515: 'LPD', 548: 'AFP', 554: 'RTSP',
      587: 'SMTP-Sub', 631: 'IPP', 873: 'rsync', 902: 'VMware', 993: 'IMAPS',
      995: 'POP3S', 1080: 'SOCKS', 1194: 'OpenVPN', 1433: 'MSSQL', 1521: 'Oracle',
      1701: 'L2TP', 1723: 'PPTP', 1812: 'RADIUS', 1883: 'MQTT', 1900: 'UPnP',
      1984: 'Synology', 2049: 'NFS', 2181: 'ZooKeeper', 2222: 'SSH-Alt',
      2375: 'Docker', 2376: 'Docker-TLS', 2379: 'etcd', 2483: 'Oracle-DB',
      3000: 'Web', 3001: 'Web', 3268: 'LDAP-GC', 3269: 'LDAP-GC-S',
      3306: 'MySQL', 3389: 'RDP', 3478: 'STUN', 3493: 'NUT', 3527: 'Web',
      3690: 'SVN', 3693: 'Web', 4000: 'Web', 4045: 'lockd',
      4500: 'Web', 5000: 'Web', 5001: 'Web', 5060: 'SIP', 5061: 'SIP-TLS',
      5222: 'XMPP', 5353: 'mDNS', 5432: 'PostgreSQL', 5500: 'VNC',
      5601: 'Kibana', 5672: 'AMQP', 5900: 'VNC', 5984: 'CouchDB',
      6000: 'X11', 6379: 'Redis', 6443: 'K8s-API', 6767: 'Bazarr',
      6881: 'BitTorrent', 7474: 'Neo4j', 7878: 'Sonarr', 8000: 'Web',
      8008: 'Web', 8009: 'Web', 8080: 'Web', 8081: 'Web', 8083: 'AdGuard',
      8086: 'InfluxDB', 8123: 'HomeAssistant', 8443: 'Web', 8784: 'Readarr',
      8989: 'Sonarr-API', 9000: 'Portainer', 9001: 'Portainer-Agent',
      9090: 'Prometheus/Cockpit', 9091: 'Transmission', 9200: 'Elasticsearch',
      9443: 'Portainer-TLS', 9696: 'Prowlarr', 27017: 'MongoDB',
      32400: 'Plex', 8096: 'Jellyfin', 32443: 'Web', 51413: 'Transmission-Peer',
    };

    // Ports worth HTTP probing for app title
    const HTTP_PORTS = new Set([80, 443, 8080, 8443, 5000, 5001, 8000, 8008, 3000,
                                 3001, 8096, 32400, 8989, 9000, 9090, 9091, 9443,
                                 8123, 7878, 6767, 8784, 9696, 5601, 8083, 8086, 1984]);

    const services = [];
    const ips = Array.from(this.machines.keys()).filter(ip => ip !== this.localIP);
    if (ips.length === 0) return [];

    // Phase 1: parallel TCP connect scan
    const check = (ip, port) => new Promise(resolve => {
      const sock = new (require('net').Socket)();
      sock.setTimeout(400);
      sock.once('connect', () => { sock.destroy(); resolve({ ip, port }); });
      sock.once('timeout', () => { sock.destroy(); resolve(null); });
      sock.once('error', () => { resolve(null); });
      sock.connect(port, ip);
    });

    const tasks = [];
    for (const ip of ips) {
      for (const port of Object.keys(PORT_LABELS)) {
        tasks.push(check(ip, parseInt(port, 10)));
      }
    }
    const openResults = await Promise.all(tasks);
    const openMap = new Map();
    for (const r of openResults) {
      if (r) {
        if (!openMap.has(r.ip)) openMap.set(r.ip, []);
        openMap.get(r.ip).push(r.port);
      }
    }

    // Phase 2: HTTP title probes on web ports
    const probeTitle = async (ip, port) => {
      const schemes = (port === 443 || port === 8443 || port === 5001 || port === 9443) ? ['https'] : ['http'];
      for (const scheme of schemes) {
        try {
          const url = `${scheme}://${ip}:${port}/`;
          const res = await fetch(url, {
            method: 'GET',
            signal: AbortSignal.timeout(1500),
            headers: { 'User-Agent': 'Mozilla/5.0 NetworkMenubar/1.0' }
          });
          const text = await res.text();
          const titleMatch = text.match(/<title[^>]*>([^<]{1,80})<\/title>/i);
          if (titleMatch) {
            return titleMatch[1].trim();
          }
          // Fallback to server header
          const server = res.headers.get('server');
          if (server) return server;
          // Fallback to first h1
          const h1Match = text.match(/<h1[^>]*>([^<]{1,60})<\/h1>/i);
          if (h1Match) return h1Match[1].trim();
        } catch (e) {}
      }
      return null;
    };

    const titleTasks = [];
    for (const [ip, ports] of openMap) {
      for (const port of ports) {
        if (HTTP_PORTS.has(port)) {
          titleTasks.push(probeTitle(ip, port).then(title => ({ ip, port, title })));
        }
      }
    }
    const titles = await Promise.all(titleTasks);
    const titleMap = new Map();
    for (const t of titles) {
      if (t.title) {
        const key = `${t.ip}:${t.port}`;
        titleMap.set(key, t.title);
      }
    }

    // Build service records
    for (const [ip, ports] of openMap) {
      for (const port of ports) {
        const title = titleMap.get(`${ip}:${port}`);
        const fallbackLabel = PORT_LABELS[port] || `Port ${port}`;
        services.push({
          ip,
          port,
          label: title || fallbackLabel,
          type: `tcp-${port}`,
          name: title,
          scheme: fallbackLabel.toLowerCase().includes('https') || port === 443 || port === 8443 ? 'https' : 'http'
        });
      }
    }

    return services;
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