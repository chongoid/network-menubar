const EventEmitter = require('events');
const { networkInterfaces } = require('os');
const { exec } = require('child_process');
const dns = require('dns');

class NetworkScanner extends EventEmitter {
  constructor() {
    super();
    this.machines = new Map();
    this.localIP = this.getLocalIP();
    this.subnet = this.getSubnet();
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

  async scan() {
    const [bonjourResults, pingResults] = await Promise.all([
      this.scanBonjour(),
      this.scanPing()
    ]);

    const merged = new Map();

    // Add bonjour results
    for (const m of bonjourResults) {
      merged.set(m.ip, m);
    }

    // Add ping results
    for (const m of pingResults) {
      if (!merged.has(m.ip)) {
        merged.set(m.ip, m);
      } else {
        // Merge info
        const existing = merged.get(m.ip);
        if (!existing.name && m.name) existing.name = m.name;
        existing.online = true;
      }
    }

    // Update online status and timestamps
    const now = Date.now();
    for (const [ip, machine] of merged) {
      machine.lastSeen = now;
      machine.online = true;
      await this.resolveHostname(ip);
    }

    this.machines = merged;
    this.emit('update', Array.from(this.machines.values()));
  }

  async scanBonjour() {
    return new Promise((resolve) => {
      const machines = [];
      
      try {
        const bonjour = require('bonjour')();
        
        bonjour.find({ type: 'http' }, (service) => {
          if (service.host && service.host !== this.localIP) {
            machines.push({
              ip: service.host,
              name: service.name,
              port: service.port,
              type: 'bonjour',
              online: true
            });
          }
        });

        // Also look for SSH services
        bonjour.find({ type: 'ssh' }, (service) => {
          if (service.host && service.host !== this.localIP) {
            machines.push({
              ip: service.host,
              name: service.name || service.host,
              type: 'bonjour-ssh',
              online: true
            });
          }
        });

        // Stop after 3 seconds
        setTimeout(() => {
          bonjour.destroy();
          resolve(machines);
        }, 3000);
      } catch (e) {
        resolve(machines);
      }
    });
  }

  async scanPing() {
    const machines = [];
    const promises = [];

    // Scan common local network IPs
    for (let i = 1; i <= 254; i++) {
      const ip = `${this.subnet}.${i}`;
      if (ip === this.localIP) continue;
      
      promises.push(this.pingIP(ip));
    }

    const results = await Promise.all(promises);
    
    for (const result of results) {
      if (result.online) {
        machines.push(result);
      }
    }

    return machines;
  }

  async pingIP(ip) {
    return new Promise((resolve) => {
      const start = Date.now();
      
      exec(`ping -c 1 -W 1 ${ip}`, (error) => {
        if (error) {
          resolve({ ip, online: false });
        } else {
          const name = `Host ${ip}`;
          resolve({
            ip,
            name,
            online: true,
            type: 'ping',
            responseTime: Date.now() - start
          });
        }
      });
    });
  }

  async resolveHostname(ip) {
    // Only resolve if we don't have a name yet
    const machine = this.machines.get(ip);
    if (machine && !machine.name) {
      try {
        const reverseDns = await new Promise((resolve, reject) => {
          dns.reverse(ip, (err, hostnames) => {
            if (err) resolve(null);
            else resolve(hostnames[0] || null);
          });
        });

        if (reverseDns) {
          machine.name = reverseDns;
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
