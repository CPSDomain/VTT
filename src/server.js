// Tabletop server: serves the client, holds the game state, relays changes over WebSocket.
// The server owns the state; clients send intents and get broadcasts back.
// Used by the DM desktop app (embedded) and by `node server.js` (headless).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { WebSocketServer } = require('ws');
const { rollDice } = require('./dice');

const VERSION = '0.6.0';
const PUBLIC = path.join(__dirname, '..', 'public');
const CATALOG = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'catalog.json'), 'utf8'));
const TERRAINS = CATALOG.terrains.map((t) => t.id);
const PROPS = CATALOG.props.map((p) => p.id);
const DM_ONLY = new Set(CATALOG.props.filter((p) => p.dmOnly).map((p) => p.id)); // secret doors, traps
const ICONS = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(PUBLIC, 'tokens.json'), 'utf8')).icons));
const UPLOAD_URL = /^\/uploads\/[a-f0-9]{16}\.(png|jpg|webp|gif)$/;
const MAX_SIDE = 120;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };

const uid = () => crypto.randomBytes(5).toString('hex');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const int = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const color = (c, d) => (/^#[0-9a-f]{6}$/i.test(c) ? c : d);

function newScene(name, cols = 30, rows = 20) {
  return {
    id: uid(), name: str(name || 'New map', 40),
    cols: clamp(int(cols, 30), 5, MAX_SIDE), rows: clamp(int(rows, 20), 5, MAX_SIDE),
    cell: 50, showGrid: true, bg: null, tiles: {}, props: {}, tokens: {},
    fog: { on: false, data: '' } // data: base64, one byte per cell (1 = revealed), row by row
  };
}

function loadState(file) {
  let s = null;
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* fresh table */ }
  if (s && s.version === 2) {
    s.library = s.library || [];
    for (const sc of Object.values(s.scenes)) sc.fog = sc.fog || { on: false, data: '' };
    return s;
  }
  const state = { version: 2, scenes: {}, order: [], activeScene: null, log: [], macros: {}, library: [] };
  if (s && s.map) { // migrate the single-map format from v0.1/v0.2
    const sc = newScene('Imported map', s.map.cols, s.map.rows);
    if (s.map.url) sc.bg = { url: s.map.url };
    sc.tokens = s.tokens || {};
    state.scenes[sc.id] = sc; state.order.push(sc.id); state.activeScene = sc.id;
    state.log = s.log || []; state.macros = s.macros || {};
  } else {
    const sc = newScene('First map');
    state.scenes[sc.id] = sc; state.order.push(sc.id); state.activeScene = sc.id;
  }
  return state;
}

function startServer({ port = 3000, host = '0.0.0.0', dataDir, dmKey } = {}) {
  dataDir = dataDir || path.join(process.cwd(), 'data');
  dmKey = dmKey || crypto.randomBytes(6).toString('hex');
  const uploads = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  const stateFile = path.join(dataDir, 'state.json');
  const state = loadState(stateFile);

  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  };
  // ---------- fog of war ----------
  // Kept in memory as one byte per cell; written back to sc.fog.data before saving or sending.
  const fogArrays = new Map();
  function fogArr(sc) {
    let a = fogArrays.get(sc.id);
    if (!a || a.length !== sc.cols * sc.rows) {
      a = new Uint8Array(sc.cols * sc.rows);
      if (sc.fog && sc.fog.data) { const b = Buffer.from(sc.fog.data, 'base64'); if (b.length === a.length) a.set(b); }
      fogArrays.set(sc.id, a);
    }
    return a;
  }
  const syncFog = (sc) => { if (sc && sc.fog) sc.fog.data = Buffer.from(fogArr(sc)).toString('base64'); };
  const fogOn = (sc) => !!(sc.fog && sc.fog.on);
  const revealed = (sc, x, y) => !fogOn(sc) || fogArr(sc)[y * sc.cols + x] === 1;
  function tokenRevealed(sc, t) {
    for (let y = t.y; y < t.y + t.size; y++) for (let x = t.x; x < t.x + t.size; x++) if (revealed(sc, x, y)) return true;
    return false;
  }
  // Can this player see this token? Never if hidden; under fog only in revealed cells, or if it's theirs.
  function tokVisible(sc, t, u) {
    if (t.hidden) return false;
    if (!fogOn(sc) || (t.owner && (t.owner === u.name || t.owner === '*'))) return true;
    return tokenRevealed(sc, t);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    Object.values(state.scenes).forEach(syncFog);
    try {
      fs.writeFileSync(stateFile + '.tmp', JSON.stringify(state));
      fs.renameSync(stateFile + '.tmp', stateFile);
    } catch (e) { console.error('Save failed:', e.message); }
  }

  // ---------- HTTP ----------
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p; try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }

    if (p === '/api/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ app: 'tabletop', version: VERSION }));
    }

    if (p === '/api/info') { // DM only: the addresses players can use to connect
      if (url.searchParams.get('key') !== dmKey) { res.writeHead(403); return res.end('DM only'); }
      const ips = Object.values(os.networkInterfaces()).flat()
        .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ips, port: server.address().port, version: VERSION }));
    }

    if (p === '/api/upload' && req.method === 'POST') {
      if (req.headers['x-dm-key'] !== dmKey) { res.writeHead(403); return res.end('DM only'); }
      const ext = IMAGE_EXT[(req.headers['content-type'] || '').split(';')[0]];
      if (!ext) { res.writeHead(415); return res.end('PNG, JPG, WebP or GIF only'); }
      const chunks = []; let size = 0, tooBig = false;
      req.on('data', (c) => { size += c.length; if (size > 40 * 1024 * 1024) { tooBig = true; req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        if (tooBig) return;
        const buf = Buffer.concat(chunks);
        const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + ext;
        fs.writeFile(path.join(uploads, name), buf, (err) => {
          if (err) { res.writeHead(500); return res.end('Could not save'); }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ url: '/uploads/' + name }));
        });
      });
      req.on('close', () => { if (tooBig && !res.headersSent) { res.writeHead(413); res.end('Image too large (40 MB max)'); } });
      return;
    }

    const root = p.startsWith('/uploads/') ? uploads : PUBLIC;
    const rel = p.startsWith('/uploads/') ? p.slice('/uploads/'.length) : (p === '/' ? 'index.html' : p);
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': root === uploads ? 'public, max-age=31536000, immutable' : 'no-cache'
      });
      res.end(data);
    });
  });

  // ---------- WebSocket ----------
  const wss = new WebSocketServer({ server, maxPayload: 4 * 1024 * 1024 });
  const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
  const clients = () => [...wss.clients].filter((c) => c.user && c.user.joined);
  const toDMs = (msg) => clients().forEach((c) => c.user.isDM && send(c, msg));
  // Send a scene change to every DM, and to players only if that scene is the one on the table.
  const toScene = (sceneId, msg) => clients().forEach((c) => (c.user.isDM || sceneId === state.activeScene) && send(c, msg));
  const toPlayersOnScene = (sceneId, msg) => clients().forEach((c) => !c.user.isDM && sceneId === state.activeScene && send(c, msg));
  const canSee = (u, e) => !e.private || u.isDM || u.name === e.who;

  const playersOnScene = (sceneId) => clients().filter((c) => !c.user.isDM && sceneId === state.activeScene);

  // What a player is allowed to see of a scene: no secret doors, traps or hidden tokens,
  // and under fog of war only the revealed cells (plus their own tokens).
  function playerScene(sc, u) {
    if (!sc) return null;
    syncFog(sc);
    const fog = fogOn(sc), tiles = {}, props = {}, tokens = {};
    for (const [k, t] of Object.entries(sc.tiles)) { if (!fog) { tiles[k] = t; continue; } const [x, y] = k.split(',').map(Number); if (revealed(sc, x, y)) tiles[k] = t; }
    for (const [k, p] of Object.entries(sc.props)) if (!DM_ONLY.has(p.kind) && revealed(sc, p.x, p.y)) props[k] = p;
    for (const [k, t] of Object.entries(sc.tokens)) if (tokVisible(sc, t, u)) tokens[k] = t;
    return { ...sc, tiles, props, tokens };
  }
  function sendSceneFull(sc) {
    syncFog(sc);
    clients().forEach((c) => {
      if (c.user.isDM) send(c, { type: 'sceneFull', scene: sc });
      else if (sc.id === state.activeScene) send(c, { type: 'sceneFull', scene: playerScene(sc, c.user), active: true });
    });
  }
  // Token changes: DMs always hear. Each player gets it if they can see it now, or loses it if they could before.
  function tokenChanged(sc, tok, before) {
    toDMs({ type: 'token', sceneId: sc.id, token: tok });
    for (const c of playersOnScene(sc.id)) {
      const now = tokVisible(sc, tok, c.user), was = before ? tokVisible(sc, before, c.user) : false;
      if (now) send(c, { type: 'token', sceneId: sc.id, token: tok });
      else if (was) send(c, { type: 'removeToken', sceneId: sc.id, id: tok.id });
    }
  }
  function viewFor(u) {
    const base = { activeScene: state.activeScene, log: state.log.filter((e) => canSee(u, e)), myMacros: state.macros[u.name] || [] };
    if (u.isDM) { Object.values(state.scenes).forEach(syncFog); return { ...base, scenes: state.scenes, order: state.order, library: state.library }; }
    return { ...base, scene: playerScene(state.scenes[state.activeScene], u) };
  }

  // Validated token fields shared by add, update and generated maps.
  function tokenFields(m, sc, base = {}) {
    const t = { ...base };
    if (m.label != null) t.label = str(m.label, 24).trim() || '?';
    if (m.color != null) t.color = color(m.color, t.color || '#e8390e');
    if (m.owner != null) t.owner = str(m.owner, 24).trim();
    if (m.size != null) t.size = clamp(int(m.size, 1), 1, 4);
    if (m.hidden != null) t.hidden = !!m.hidden;
    if (m.icon !== undefined) t.icon = typeof m.icon === 'string' && ICONS.has(m.icon) ? m.icon : null;
    if (m.img !== undefined) t.img = typeof m.img === 'string' && UPLOAD_URL.test(m.img) ? m.img : null;
    if (m.x != null) t.x = clamp(int(m.x, 0), 0, sc.cols - (t.size || 1));
    if (m.y != null) t.y = clamp(int(m.y, 0), 0, sc.rows - (t.size || 1));
    return t;
  }
  // Load a whole map's contents at once (used by the map generators).
  function fillScene(sc, m) {
    sc.tiles = {}; sc.props = {}; sc.tokens = {};
    if (m.tiles && typeof m.tiles === 'object') {
      let n = 0;
      for (const [k, t] of Object.entries(m.tiles)) {
        if (++n > 20000) break;
        const [x, y] = k.split(',').map(Number);
        if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < sc.cols && y < sc.rows && TERRAINS.includes(t)) sc.tiles[x + ',' + y] = t;
      }
    }
    if (Array.isArray(m.props)) for (const p of m.props.slice(0, 3000)) {
      const x = int(p.x, -1), y = int(p.y, -1);
      if (!PROPS.includes(p.kind) || x < 0 || y < 0 || x >= sc.cols || y >= sc.rows) continue;
      const id = uid(); sc.props[id] = { id, kind: p.kind, x, y, rot: ((int(p.rot, 0) % 4) + 4) % 4 };
    }
    if (Array.isArray(m.tokens)) for (const t of m.tokens.slice(0, 200)) {
      const id = uid();
      sc.tokens[id] = { id, ...tokenFields({ label: '?', color: '#e8390e', owner: '', size: 1, ...t }, sc) };
    }
    // fog: { on, reveal: [[x0, y0, x1, y1], ...] } — e.g. a generated dungeon with only the entrance showing
    sc.fog = { on: !!(m.fog && m.fog.on), data: '' };
    fogArrays.delete(sc.id);
    const a = fogArr(sc);
    if (m.fog && Array.isArray(m.fog.reveal)) for (const r of m.fog.reveal.slice(0, 500)) {
      if (!Array.isArray(r)) continue;
      const [x0, y0, x1, y1] = r.map((v) => int(v, -1));
      for (let y = Math.max(0, y0); y <= Math.min(sc.rows - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(sc.cols - 1, x1); x++) a[y * sc.cols + x] = 1;
    }
    syncFog(sc);
  }

  wss.on('connection', (ws) => {
    ws.user = { name: 'Guest', isDM: false, joined: false };
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      try { handle(ws, msg); } catch (e) { console.error('Message error:', e); }
    });
    ws.on('close', () => { if (ws.user.joined) presence(); });
  });
  const presence = () => toDMs({ type: 'presence', players: [...new Set(clients().filter((c) => !c.user.isDM).map((c) => c.user.name))] });

  function handle(ws, msg) {
    const u = ws.user;
    if (msg.type === 'join') {
      u.name = str(msg.name || 'Guest', 24).trim() || 'Guest';
      u.isDM = msg.key === dmKey; u.joined = true;
      send(ws, { type: 'welcome', isDM: u.isDM, name: u.name, version: VERSION, state: viewFor(u) });
      return presence();
    }
    if (!u.joined) return;

    // Scene targeted by the message: DMs may name any scene, players always act on the active one.
    const sc = state.scenes[u.isDM && msg.sceneId ? msg.sceneId : state.activeScene];
    const tok = sc && msg.id ? sc.tokens[msg.id] : null;
    const inside = (x, y) => sc && x >= 0 && y >= 0 && x < sc.cols && y < sc.rows;

    switch (msg.type) {
      // ----- tokens -----
      case 'move':
        if (!tok || (!u.isDM && (tok.hidden || (tok.owner !== u.name && tok.owner !== '*')))) return;
        { const before = { ...tok };
          tok.x = clamp(int(msg.x, tok.x), 0, sc.cols - tok.size);
          tok.y = clamp(int(msg.y, tok.y), 0, sc.rows - tok.size);
          tokenChanged(sc, tok, before); }
        save();
        break;
      case 'addToken': {
        if (!u.isDM || !sc || Object.keys(sc.tokens).length >= 500) return;
        const id = uid();
        sc.tokens[id] = { id, ...tokenFields({ label: '?', color: '#e8390e', owner: '', size: 1, x: 1, y: 1, ...msg }, sc) };
        tokenChanged(sc, sc.tokens[id], null); save();
        break;
      }
      case 'tokenUpdate': {
        if (!u.isDM || !tok) return;
        const before = { ...tok };
        Object.assign(tok, tokenFields({ ...msg, x: msg.x ?? tok.x, y: msg.y ?? tok.y, size: msg.size ?? tok.size }, sc, tok));
        tokenChanged(sc, tok, before); save();
        break;
      }
      case 'removeToken':
        if (!u.isDM || !tok) return;
        delete sc.tokens[msg.id];
        toScene(sc.id, { type: 'removeToken', sceneId: sc.id, id: msg.id }); save();
        break;

      // ----- token library (DM only): uploaded images reusable as token art -----
      case 'libraryAdd': {
        if (!u.isDM || !Array.isArray(msg.items)) return;
        for (const it of msg.items.slice(0, 200)) {
          if (typeof it.url !== 'string' || !UPLOAD_URL.test(it.url) || state.library.some((l) => l.url === it.url)) continue;
          if (state.library.length >= 2000) break;
          state.library.push({ id: uid(), name: str(it.name || 'Token', 24).trim() || 'Token', url: it.url, size: clamp(int(it.size, 1), 1, 4) });
        }
        toDMs({ type: 'library', library: state.library }); save();
        break;
      }
      case 'libraryRemove':
        if (!u.isDM) return;
        state.library = state.library.filter((l) => l.id !== msg.libId);
        toDMs({ type: 'library', library: state.library }); save();
        break;

      // ----- map building (DM only) -----
      case 'tiles': {
        if (!u.isDM || !sc || !Array.isArray(msg.cells) || msg.cells.length > 20000) return;
        const applied = [];
        for (const c of msg.cells) {
          if (!Array.isArray(c)) continue;
          const [x, y, t] = [int(c[0], -1), int(c[1], -1), c[2]];
          if (!inside(x, y)) continue;
          if (t === null) delete sc.tiles[x + ',' + y];
          else if (TERRAINS.includes(t)) sc.tiles[x + ',' + y] = t;
          else continue;
          applied.push([x, y, t]);
        }
        if (applied.length) {
          toDMs({ type: 'tiles', sceneId: sc.id, cells: applied });
          const seen = fogOn(sc) ? applied.filter(([x, y]) => revealed(sc, x, y)) : applied; // nothing leaks from under the fog
          if (seen.length) toPlayersOnScene(sc.id, { type: 'tiles', sceneId: sc.id, cells: seen });
          save();
        }
        break;
      }
      case 'propSet': { // add or update a prop; ids come from the DM client so undo can refer to them
        if (!u.isDM || !sc || !PROPS.includes(msg.kind)) return;
        const id = /^[a-z0-9]{4,16}$/.test(msg.propId) ? msg.propId : uid();
        const x = int(msg.x, -1), y = int(msg.y, -1);
        if (!inside(x, y)) return;
        if (!sc.props[id] && Object.keys(sc.props).length >= 3000) return;
        sc.props[id] = { id, kind: msg.kind, x, y, rot: ((int(msg.rot, 0) % 4) + 4) % 4 };
        toDMs({ type: 'prop', sceneId: sc.id, prop: sc.props[id] });
        // players see it only if it's not secret and not under fog; if it moved into fog, they lose it
        toPlayersOnScene(sc.id, !DM_ONLY.has(msg.kind) && revealed(sc, x, y)
          ? { type: 'prop', sceneId: sc.id, prop: sc.props[id] } : { type: 'propRemove', sceneId: sc.id, propId: id });
        save();
        break;
      }

      // ----- fog of war (DM only) -----
      case 'fogSet': // turn fog on or off for a map
        if (!u.isDM || !sc) return;
        sc.fog.on = !!msg.on;
        sendSceneFull(sc); save();
        break;
      case 'fogAll': // reveal or cover the whole map
        if (!u.isDM || !sc) return;
        fogArr(sc).fill(msg.reveal ? 1 : 0);
        sendSceneFull(sc); save();
        break;
      case 'fog': { // reveal or cover a list of cells
        if (!u.isDM || !sc || !Array.isArray(msg.cells) || msg.cells.length > 30000) return;
        const a = fogArr(sc), v = msg.reveal ? 1 : 0, changed = [];
        for (const c of msg.cells) {
          const x = int(c && c[0], -1), y = int(c && c[1], -1);
          if (!inside(x, y) || a[y * sc.cols + x] === v) continue;
          a[y * sc.cols + x] = v; changed.push([x, y]);
        }
        if (!changed.length) return;
        toDMs({ type: 'fog', sceneId: sc.id, reveal: !!v, cells: changed });
        if (fogOn(sc)) {
          const set = new Set(changed.map(([x, y]) => x + ',' + y));
          const touches = (t) => { for (let y = t.y; y < t.y + t.size; y++) for (let x = t.x; x < t.x + t.size; x++) if (set.has(x + ',' + y)) return true; return false; };
          for (const c of playersOnScene(sc.id)) {
            if (v) { // send what's now in view
              const tiles = {}; for (const k of set) if (sc.tiles[k]) tiles[k] = sc.tiles[k];
              const props = Object.values(sc.props).filter((p) => set.has(p.x + ',' + p.y) && !DM_ONLY.has(p.kind));
              const tokens = Object.values(sc.tokens).filter((t) => touches(t) && tokVisible(sc, t, c.user));
              send(c, { type: 'fogReveal', sceneId: sc.id, cells: changed, tiles, props, tokens });
            } else { // cover it again: tokens that dropped out of sight go too
              const gone = Object.values(sc.tokens).filter((t) => touches(t) && !tokVisible(sc, t, c.user)).map((t) => t.id);
              send(c, { type: 'fogHide', sceneId: sc.id, cells: changed, tokens: gone });
            }
          }
        }
        save();
        break;
      }
      case 'propRemove':
        if (!u.isDM || !sc || !sc.props[msg.propId]) return;
        delete sc.props[msg.propId];
        toScene(sc.id, { type: 'propRemove', sceneId: sc.id, propId: msg.propId }); save();
        break;

      // ----- scenes (DM only) -----
      case 'sceneCreate': {
        if (!u.isDM || state.order.length >= 200) return;
        const s = newScene(msg.name, msg.cols, msg.rows);
        if (msg.content) fillScene(s, msg.content);
        syncFog(s);
        state.scenes[s.id] = s; state.order.push(s.id);
        toDMs({ type: 'sceneAdded', scene: s, order: state.order }); save();
        break;
      }
      case 'sceneReplace': { // regenerate a map in place (resizes it, replaces everything on it)
        if (!u.isDM || !sc || !msg.content) return;
        sc.cols = clamp(int(msg.cols, sc.cols), 5, MAX_SIDE); sc.rows = clamp(int(msg.rows, sc.rows), 5, MAX_SIDE);
        if (msg.name) sc.name = str(msg.name, 40).trim() || sc.name;
        sc.bg = null;
        fillScene(sc, msg.content);
        sendSceneFull(sc); save();
        break;
      }
      case 'sceneDuplicate': {
        if (!u.isDM || !sc || state.order.length >= 200) return;
        syncFog(sc);
        const s = JSON.parse(JSON.stringify(sc));
        s.id = uid(); s.name = str(sc.name + ' (copy)', 40);
        state.scenes[s.id] = s; state.order.splice(state.order.indexOf(sc.id) + 1, 0, s.id);
        toDMs({ type: 'sceneAdded', scene: s, order: state.order }); save();
        break;
      }
      case 'sceneUpdate': {
        if (!u.isDM || !sc) return;
        const patch = {};
        if (msg.name != null) patch.name = str(msg.name, 40).trim() || sc.name;
        if (msg.cols != null) patch.cols = clamp(int(msg.cols, sc.cols), 5, MAX_SIDE);
        if (msg.rows != null) patch.rows = clamp(int(msg.rows, sc.rows), 5, MAX_SIDE);
        if (msg.showGrid != null) patch.showGrid = !!msg.showGrid;
        if (msg.bg !== undefined) {
          patch.bg = msg.bg && typeof msg.bg.url === 'string' && /^(\/uploads\/[a-f0-9]{16}\.(png|jpg|webp|gif)|https?:\/\/.{3,500})$/.test(msg.bg.url)
            ? { url: msg.bg.url } : null;
        }
        const oldFog = fogArr(sc), oldCols = sc.cols, oldRows = sc.rows;
        Object.assign(sc, patch);
        if (sc.cols !== oldCols || sc.rows !== oldRows) { // keep revealed areas where they were
          const nf = new Uint8Array(sc.cols * sc.rows);
          for (let y = 0; y < Math.min(oldRows, sc.rows); y++) for (let x = 0; x < Math.min(oldCols, sc.cols); x++) nf[y * sc.cols + x] = oldFog[y * oldCols + x];
          fogArrays.set(sc.id, nf);
        }
        if (patch.cols || patch.rows) { // trim anything that fell off a shrunk map
          for (const k of Object.keys(sc.tiles)) { const [x, y] = k.split(',').map(Number); if (x >= sc.cols || y >= sc.rows) delete sc.tiles[k]; }
          for (const [k, p] of Object.entries(sc.props)) if (p.x >= sc.cols || p.y >= sc.rows) delete sc.props[k];
          for (const t of Object.values(sc.tokens)) { t.x = clamp(t.x, 0, sc.cols - t.size); t.y = clamp(t.y, 0, sc.rows - t.size); }
          sendSceneFull(sc);
        } else toScene(sc.id, { type: 'sceneMeta', sceneId: sc.id, patch });
        save();
        break;
      }
      case 'sceneDelete':
        if (!u.isDM || !sc || state.order.length <= 1) return;
        delete state.scenes[sc.id];
        state.order = state.order.filter((id) => id !== sc.id);
        toDMs({ type: 'sceneRemoved', sceneId: sc.id, order: state.order });
        if (state.activeScene === sc.id) activate(state.order[0]);
        save();
        break;
      case 'sceneOrder':
        if (!u.isDM || !Array.isArray(msg.order)) return;
        if (msg.order.length === state.order.length && msg.order.every((id) => state.scenes[id])) {
          state.order = [...new Set(msg.order)];
          toDMs({ type: 'order', order: state.order }); save();
        }
        break;
      case 'sceneActivate':
        if (!u.isDM || !sc) return;
        activate(sc.id); save();
        break;

      // ----- dice -----
      case 'roll':
        try {
          const r = rollDice(msg.expr);
          const entry = { who: u.name, label: str(msg.label, 30), expr: str(msg.expr, 60), ...r, private: !!msg.private, time: Date.now() };
          state.log.push(entry); state.log = state.log.slice(-200);
          clients().forEach((c) => canSee(c.user, entry) && send(c, { type: 'roll', entry }));
          save();
        } catch (e) { send(ws, { type: 'error', message: e.message }); }
        break;
      case 'setMacros': {
        if (!Array.isArray(msg.macros) || msg.macros.length > 30) return;
        const clean = [];
        for (const m of msg.macros) {
          const label = str(m.label, 30).trim(), expr = str(m.expr, 60).trim();
          if (!label || !expr) continue;
          try { rollDice(expr); } catch { return send(ws, { type: 'error', message: `"${label}": ${expr} isn't a valid roll` }); }
          clean.push({ label, expr });
        }
        state.macros[u.name] = clean;
        send(ws, { type: 'macros', macros: clean }); save();
        break;
      }
    }
  }

  function activate(id) {
    state.activeScene = id;
    clients().forEach((c) => send(c, c.user.isDM ? { type: 'active', sceneId: id } : { type: 'sceneFull', scene: playerScene(state.scenes[id], c.user), active: true }));
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve({
        port: server.address().port, dmKey, dataDir, version: VERSION,
        players: () => clients().filter((c) => !c.user.isDM).map((c) => c.user.name),
        close: () => new Promise((r) => { saveNow(); wss.clients.forEach((c) => c.terminate()); server.close(() => r()); })
      });
    });
  });
}

module.exports = { startServer, TERRAINS, PROPS, VERSION };
