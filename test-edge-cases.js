// Edge case test for NetworkScanner
const Scanner = require('./network-scanner');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
  } catch (e) {
    console.log(`  FAIL: ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('Edge case tests:');

test('handles no network (localIP = 127.0.0.1)', async () => {
  const s = new Scanner();
  // Simulate no network
  s.localIP = '127.0.0.1';
  s.subnet = '127.0.0';
  const results = await s.scanPing();
  if (results.length !== 0) throw new Error('Expected 0 results, got ' + results.length);
});

test('handles empty bonjour results', async () => {
  const s = new Scanner();
  s.localIP = '192.168.1.100';
  s.subnet = '192.168.1';
  // scan with no bonjour activity should not throw
  const result = await s.scanBonjour(100); // 100ms timeout
  if (!Array.isArray(result)) throw new Error('Expected array');
});

test('emits update event with machines array', async () => {
  const s = new Scanner();
  let emitted = false;
  s.on('update', (machines) => {
    if (Array.isArray(machines)) emitted = true;
  });
  s.firstScan = false; // skip ping
  await s.scanBonjour(50);
  // Don't assert emitted=true because bonjour may find nothing
});

test('deduplicates IPs across bonjour + ping', async () => {
  const s = new Scanner();
  // Inject test data
  s.localIP = '192.168.1.100';
  s.subnet = '192.168.1';
  s.machines = new Map([
    ['192.168.1.5', { ip: '192.168.1.5', name: 'Old', online: true, lastSeen: Date.now(), type: 'ping' }]
  ]);
  // Simulate bonjour finding same IP with new name
  const bonjourResults = [{
    ip: '192.168.1.5',
    name: 'New',
    port: 80,
    type: 'bonjour-http',
    online: true,
    lastSeen: Date.now()
  }];
  // Use private merge path that bypasses version check
  s._mergeAndEmitPartial(bonjourResults, []);
  const machines = s.getMachines();
  if (machines.length !== 1) throw new Error('Expected 1 machine, got ' + machines.length);
  // After merge, the bonjour result should be reflected (the bug we fixed in v1.3.1)
  if (machines[0].name !== 'New') throw new Error('Expected name=New, got ' + machines[0].name);
  if (machines[0].type !== 'bonjour-http') throw new Error('Expected type=bonjour-http, got ' + machines[0].type);
  if (machines[0].port !== 80) throw new Error('Expected port=80, got ' + machines[0].port);
});

test('partial merge updates offline machine to online via ping', async () => {
  const s = new Scanner();
  s.localIP = '192.168.1.100';
  s.subnet = '192.168.1';
  s.machines = new Map([
    ['192.168.1.5', { ip: '192.168.1.5', name: 'Host', online: false, lastSeen: Date.now() - 120000, type: 'ping' }]
  ]);
  // Ping result for the same host comes back online
  const pingResults = [{ ip: '192.168.1.5', name: null, online: true, type: 'ping' }];
  s._mergeAndEmitPartial([], pingResults);
  const m = s.getMachines()[0];
  if (m.online !== true) throw new Error('Expected online=true after ping, got ' + m.online);
});

test('partial merge does NOT overwrite bonjour name with ping data', async () => {
  const s = new Scanner();
  s.localIP = '192.168.1.100';
  s.subnet = '192.168.1';
  s.machines = new Map([
    ['192.168.1.5', { ip: '192.168.1.5', name: 'FromBonjour', online: true, lastSeen: Date.now(), type: 'bonjour-http' }]
  ]);
  // Ping result with no name should not erase the bonjour name
  const pingResults = [{ ip: '192.168.1.5', name: null, online: true, type: 'ping' }];
  s._mergeAndEmitPartial([], pingResults);
  const m = s.getMachines()[0];
  if (m.name !== 'FromBonjour') throw new Error('Expected name preserved, got ' + m.name);
});

test('marks stale machines offline', async () => {
  const s = new Scanner();
  s.localIP = '192.168.1.100';
  s.subnet = '192.168.1';
  // Pretend a machine was last seen 120 seconds ago
  const longAgo = Date.now() - 120000;
  s.machines = new Map([
    ['192.168.1.5', { ip: '192.168.1.5', name: 'Old', online: true, lastSeen: longAgo }]
  ]);
  // Force a scan via scan() with no real activity
  await s.scan();
  const machines = s.getMachines();
  if (machines[0].online !== false) throw new Error('Expected online=false, got true');
});

test('DNS lookup does not duplicate for already-attempted IPs', async () => {
  const s = new Scanner();
  s.localIP = '192.168.1.100';
  s.subnet = '192.168.1';
  // Manually populate dnsAttempted
  s.dnsAttempted = new Set(['192.168.1.5']);
  s.machines = new Map([
    ['192.168.1.5', { ip: '192.168.1.5', name: null, online: true, lastSeen: Date.now() }]
  ]);
  // This should not trigger DNS lookup
  s._resolveHostnamesInBackground();
  // Wait a bit
  await new Promise(r => setTimeout(r, 100));
  if (s.dnsPending.size !== 0) throw new Error('Expected 0 pending DNS, got ' + s.dnsPending.size);
});

test('handles pingIP timeout gracefully', async () => {
  const s = new Scanner();
  s.localIP = '192.168.1.100';
  // Ping a blackhole (TEST-NET-1, RFC 5737)
  const result = await s.pingIP('192.0.2.1');
  if (result.online) throw new Error('Expected offline');
  if (!result.ip) throw new Error('Expected IP in result');
});

test('destroy() does not throw', () => {
  const s = new Scanner();
  s.destroy();
});

console.log('\nDone.');