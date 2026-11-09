// Opens the table's port on the home router (UPnP), so players can join over the internet without anyone
// setting up port forwarding by hand. Standard UPnP Internet Gateway Device calls, no extra libraries:
//   find the router (SSDP), read its description, ask it to forward the port to this PC, renew that
//   every half hour, and remove it when Tabletop DM closes. Also asks the router for its internet address.
const dgram = require('dgram');
const http = require('http');
const https = require('https');
const net = require('net');

const SSDP = { host: '239.255.255.250', port: 1900 };
const TARGETS = [
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANIPConnection:2', 'urn:schemas-upnp-org:service:WANPPPConnection:1'
];
const SERVICES = /urn:schemas-upnp-org:service:(WANIPConnection|WANPPPConnection):\d/;
const LEASE = 3600; // seconds; renewed every 30 minutes while the table is open

function get(url, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => { let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); }); res.on('end', () => resolve({ status: res.statusCode, body })); });
    req.on('timeout', () => req.destroy(new Error('The router did not answer')));
    req.on('error', reject);
  });
}
const tag = (xml, name) => { const m = new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i').exec(xml); return m ? m[1].trim() : null; };

// ask who's out there; returns the description addresses (LOCATION) of anything that answers
function search({ timeout = 2500, ssdp = SSDP } = {}) {
  return new Promise((resolve) => {
    const found = new Set(), sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const done = () => { try { sock.close(); } catch { /* closed */ } resolve([...found]); };
    sock.on('message', (msg) => { const m = /^location:\s*(\S+)/im.exec(msg.toString()); if (m) found.add(m[1]); });
    sock.on('error', done);
    sock.bind(0, () => {
      for (const st of TARGETS) {
        const msg = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP.host}:${SSDP.port}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`);
        for (let i = 0; i < 2; i++) sock.send(msg, ssdp.port, ssdp.host, () => {});
      }
    });
    setTimeout(done, timeout);
  });
}

// the router's port-forwarding service: where to send requests, and this PC's address as the router sees it
async function findGateway(opts = {}) {
  const locations = await search(opts);
  if (!locations.length) throw Object.assign(new Error('No router answered. UPnP may be turned off in the router\'s settings.'), { code: 'NO_ROUTER' });
  let lastErr;
  for (const loc of locations) {
    try {
      const { body } = await get(loc);
      const services = body.split(/<service>/i).slice(1);
      for (const sv of services) {
        const type = tag(sv, 'serviceType');
        if (!type || !SERVICES.test(type)) continue;
        const base = tag(body, 'URLBase') || loc;
        const control = new URL(tag(sv, 'controlURL'), base).href;
        return { control, type, location: loc, localAddress: await localAddressFor(new URL(control).hostname, new URL(control).port || 80) };
      }
    } catch (e) { lastErr = e; }
  }
  throw Object.assign(new Error(lastErr ? lastErr.message : 'The router doesn\'t offer UPnP port forwarding.'), { code: 'NO_SERVICE' });
}
// which of this PC's addresses faces the router (a PC can have several: Wi-Fi, cable, VPN)
function localAddressFor(host, port) {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.connect(Number(port) || 80, host, (err) => { const a = err ? null : s.address().address; s.close(); resolve(a); });
    s.on('error', () => { try { s.close(); } catch { /* closed */ } resolve(null); });
  });
}

function soap(gw, action, args = {}) {
  const body = `<?xml version="1.0"?>\r\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${gw.type}">` +
    Object.entries(args).map(([k, v]) => `<${k}>${String(v).replace(/[<&>]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]))}</${k}>`).join('') + `</u:${action}></s:Body></s:Envelope>`;
  const u = new URL(gw.control);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'POST', timeout: 5000,
      headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${gw.type}#${action}"`, 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let out = ''; res.setEncoding('utf8'); res.on('data', (c) => { out += c; });
      res.on('end', () => {
        if (res.statusCode === 200) return resolve(out);
        const code = Number(tag(out, 'errorCode')) || res.statusCode, desc = tag(out, 'errorDescription') || `HTTP ${res.statusCode}`;
        reject(Object.assign(new Error(desc), { upnpCode: code }));
      });
    });
    req.on('timeout', () => req.destroy(new Error('The router did not answer')));
    req.on('error', reject);
    req.end(body);
  });
}

async function addMapping(gw, port, description) {
  const args = (lease) => ({ NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP', NewInternalPort: port, NewInternalClient: gw.localAddress, NewEnabled: 1, NewPortMappingDescription: description, NewLeaseDuration: lease });
  try { await soap(gw, 'AddPortMapping', args(LEASE)); return LEASE; } catch (e) {
    if (e.upnpCode === 725) { await soap(gw, 'AddPortMapping', args(0)); return 0; } // this router only does permanent ones
    throw e;
  }
}
async function externalAddress(gw) { return tag(await soap(gw, 'GetExternalIPAddress'), 'NewExternalIPAddress'); }
const removeMapping = (gw, port) => soap(gw, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP' });

// an internet address that isn't really public: the provider (or a second router) sits in between
function sharedAddress(ip) {
  const p = String(ip || '').split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return false;
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] === 0;
}
// this connection's internet address, from a public "what's my IP" service (when the router doesn't say, and to
// spot a second router in between); tests point TABLETOP_PUBLIC_IP_URL at their own
const IP_SERVICES = process.env.TABLETOP_PUBLIC_IP_URL ? [process.env.TABLETOP_PUBLIC_IP_URL] : ['https://api.ipify.org', 'https://checkip.amazonaws.com'];
function fetchText(url, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const req = (url.startsWith('https:') ? https : http).get(url, { timeout, headers: { 'User-Agent': 'Tabletop' } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; if (b.length > 200) req.destroy(); }); res.on('end', () => (res.statusCode === 200 ? resolve(b.trim()) : reject(new Error('HTTP ' + res.statusCode))));
    });
    req.on('timeout', () => req.destroy(new Error('timed out'))); req.on('error', reject);
  });
}
async function publicAddress() {
  for (const u of IP_SERVICES) { try { const ip = await fetchText(u); if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip; } catch { /* try the next */ } }
  return null;
}
// can the table be reached at that address? Tries it from here, through the router (works when the router
// allows connections back in from inside: many do, some don't, so a "no" proves nothing)
function reachable(ip, port, timeout = 4000) {
  return new Promise((resolve) => {
    const req = http.get({ host: ip, port, path: '/api/ping', timeout }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve(/"app":"tabletop"/.test(b))); });
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve(false));
  });
}

function friendly(e) {
  if (e.upnpCode === 718) return 'Another device on your network already uses this port on the router. Choose a different port.';
  if (e.upnpCode === 606 || e.upnpCode === 401) return 'The router refused: its UPnP settings don\'t allow apps to open ports.';
  return e.message;
}

// Keeps a port open for as long as the table runs. status(): what to tell the DM.
function openPort(port, { description = 'Tabletop DM', onChange = () => {}, ssdp } = {}) {
  let gw = null, timer = null, closed = false;
  let state = { state: 'working', port, message: 'Asking your router to open the port…' };
  const set = (s) => { state = { port, ...s }; onChange(state); };
  async function run() {
    try {
      gw = gw || await findGateway({ ssdp });
      if (closed) return;
      const lease = await addMapping(gw, port, description);
      let ext = null; try { ext = await externalAddress(gw); } catch { /* some routers don't say */ }
      if (ext && !/^\d{1,3}(\.\d{1,3}){3}$/.test(ext)) ext = null;
      const pub = await publicAddress();
      if (closed) { removeMapping(gw, port).catch(() => {}); return; }
      const local = gw.localAddress;
      if (ext && pub && ext !== pub) { // the router's own internet address isn't the one the internet sees: something else sits in between
        set({ state: 'shared', external: `${pub}:${port}`, router: ext, local, lease, message: `Your router opened the port, but there's another router between it and the internet (your router's address is ${ext}, the internet sees ${pub}). Players outside can only reach you if that other router also forwards port ${port} to your router, or is set to bridge mode. If your internet provider shares one address between customers, ask them for a public IP address.` });
      } else if (ext && sharedAddress(ext) && !pub) {
        set({ state: 'shared', external: null, router: ext, local, lease, message: `Your router opened the port, but its internet address (${ext}) isn't a public one: there's another router, or your internet provider, in between. Players outside can't reach you unless that is sorted out.` });
      } else {
        const addr = pub || ext;
        if (!addr) set({ state: 'open', external: null, local, lease, checked: false, message: `Your router opened port ${port}, but Tabletop couldn't find your internet address. Search "what is my IP" on this PC: players outside connect to that address followed by :${port}.` });
        else {
          set({ state: 'open', external: `${addr}:${port}`, local, lease, checked: null, message: 'Port opened on your router. Checking that players outside can reach it…' });
          const ok = await reachable(addr, port);
          if (closed) return;
          set({ state: 'open', external: `${addr}:${port}`, local, lease, checked: ok, message: ok ? 'Port opened on your router, and checked: players outside can reach this address.'
            : `Port opened on your router. Tabletop couldn't check it from inside your network (many routers don't allow that), so test it once: with Tabletop DM running, enter port ${port} at canyouseeme.org, or connect from a phone on mobile data.` });
        }
      }
      clearTimeout(timer); timer = setTimeout(run, 30 * 60 * 1000); // renew well before it runs out
    } catch (e) {
      if (closed) return;
      set({ state: 'failed', message: friendly(e), code: e.code || e.upnpCode });
      clearTimeout(timer); timer = setTimeout(run, 5 * 60 * 1000); // try again later (the router may come back)
    }
  }
  run();
  return {
    status: () => state,
    retry: () => { clearTimeout(timer); set({ state: 'working', message: 'Asking your router to open the port…' }); gw = null; run(); },
    close: async () => { closed = true; clearTimeout(timer); if (gw && (state.state === 'open' || state.state === 'shared')) { try { await removeMapping(gw, port); } catch { /* router gone */ } } }
  };
}

module.exports = { openPort, findGateway, addMapping, removeMapping, externalAddress, sharedAddress, search, publicAddress, reachable };
