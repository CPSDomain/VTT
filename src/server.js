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

const VERSION = '0.10.0';
const PUBLIC = path.join(__dirname, '..', 'public');
const CATALOG = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'catalog.json'), 'utf8'));
const TERRAINS = CATALOG.terrains.map((t) => t.id);
const PROPS = CATALOG.props.map((p) => p.id);
const DM_ONLY = new Set(CATALOG.props.filter((p) => p.dmOnly).map((p) => p.id)); // secret doors, traps
const TOKENS_JSON = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'tokens.json'), 'utf8'));
const ICONS = new Set(Object.keys(TOKENS_JSON.icons));
const CONDITIONS = new Set((TOKENS_JSON.conditions || []).map((c) => c.id));
const HP_SHOW = ['numbers', 'bar', 'none'];
const UPLOAD_URL = /^\/uploads\/[a-f0-9]{16}\.(png|jpg|webp|gif)$/;
const MAX_SIDE = 200;
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
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const SHAPES = ['cone', 'sphere', 'cube', 'line', 'cylinder'];
const DIAGONALS = ['5', '5105'];
const LABEL_SIZES = ['s', 'm', 'l'];
const color = (c, d) => (/^#[0-9a-f]{6}$/i.test(c) ? c : d);

function newScene(name, cols = 30, rows = 20) {
  return {
    id: uid(), name: str(name || 'New map', 40),
    cols: clamp(int(cols, 30), 5, MAX_SIDE), rows: clamp(int(rows, 20), 5, MAX_SIDE),
    cell: 50, showGrid: true, bg: null, tiles: {}, props: {}, tokens: {}, templates: {}, labels: {},
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
  // Map labels: DM notes never reach players; under fog, a label shows once its square is revealed.
  const labelVisible = (sc, l) => !l.dmOnly && revealed(sc, clamp(Math.floor(l.x), 0, sc.cols - 1), clamp(Math.floor(l.y), 0, sc.rows - 1));
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

    if (p === '/api/export') { // DM only: one map, with its images, as a single file to share or keep
      if (url.searchParams.get('key') !== dmKey) { res.writeHead(403); return res.end('DM only'); }
      const sc = state.scenes[url.searchParams.get('scene')];
      if (!sc) { res.writeHead(404); return res.end('No such map'); }
      syncFog(sc);
      const images = {};
      const keep = (u) => { if (u && UPLOAD_URL.test(u) && !images[u]) { try { images[u] = fs.readFileSync(path.join(uploads, path.basename(u))).toString('base64'); } catch { /* missing image */ } } };
      if (sc.bg) keep(sc.bg.url);
      Object.values(sc.tokens).forEach((t) => keep(t.img));
      const strip = (o) => { const { id, ...rest } = o; return rest; };
      const map = {
        name: sc.name, cols: sc.cols, rows: sc.rows, showGrid: sc.showGrid !== false, diag: sc.diag || '5', bg: sc.bg,
        tiles: sc.tiles, props: Object.values(sc.props).map(strip), tokens: Object.values(sc.tokens).map(strip),
        labels: Object.values(sc.labels || {}).map(strip), walls: sc.walls || [], doors: sc.doors || [], lights: sc.lights || [],
        fog: { on: fogOn(sc), data: sc.fog ? sc.fog.data : '' }
      };
      const body = JSON.stringify({ app: 'tabletop', kind: 'map', version: VERSION, map, images });
      const file = (sc.name.replace(/[^\w\- ]+/g, '').trim() || 'map') + '.ttmap';
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${file}"` });
      return res.end(body);
    }

    if (p === '/api/import' && req.method === 'POST') { // DM only: a map exported from Tabletop (.ttmap)
      if (req.headers['x-dm-key'] !== dmKey) { res.writeHead(403); return res.end('DM only'); }
      const chunks = []; let size = 0, tooBig = false;
      req.on('data', (c) => { size += c.length; if (size > 300 * 1024 * 1024) { tooBig = true; req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        if (tooBig) return;
        const fail = (code, msg) => { res.writeHead(code, { 'Content-Type': 'text/plain' }); res.end(msg); };
        let d; try { d = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return fail(400, 'That file isn\'t a Tabletop map'); }
        if (!d || d.app !== 'tabletop' || d.kind !== 'map' || !d.map) return fail(400, 'That file isn\'t a Tabletop map');
        if (state.order.length >= 200) return fail(400, 'You have 200 maps already. Delete some first.');
        // save its images under their own content names, and point the map at them
        const remap = {};
        for (const [oldUrl, b64] of Object.entries(d.images || {})) {
          const buf = Buffer.from(String(b64), 'base64');
          const ext = buf[0] === 0x89 && buf[1] === 0x50 ? '.png' : buf[0] === 0xff && buf[1] === 0xd8 ? '.jpg' : buf.slice(0, 4).toString() === 'RIFF' ? '.webp' : buf.slice(0, 3).toString() === 'GIF' ? '.gif' : null;
          if (!ext) continue;
          const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + ext;
          try { fs.writeFileSync(path.join(uploads, name), buf); remap[oldUrl] = '/uploads/' + name; } catch { /* skip */ }
        }
        const m = d.map, to = (u) => remap[u] || null;
        const sc = newScene(m.name, m.cols, m.rows);
        fillScene(sc, {
          tiles: m.tiles, props: m.props, labels: m.labels, walls: m.walls, doors: m.doors, lights: m.lights, fog: m.fog,
          bg: m.bg && to(m.bg.url) ? { url: to(m.bg.url) } : null,
          tokens: Array.isArray(m.tokens) ? m.tokens.map((t) => ({ ...t, img: t.img ? to(t.img) : null })) : []
        });
        sc.showGrid = m.showGrid !== false;
        if (DIAGONALS.includes(m.diag)) sc.diag = m.diag;
        syncFog(sc);
        state.scenes[sc.id] = sc; state.order.push(sc.id);
        toDMs({ type: 'sceneAdded', scene: sc, order: state.order }); save();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: sc.id, name: sc.name }));
      });
      req.on('close', () => { if (tooBig && !res.headersSent) { res.writeHead(413); res.end('File too large (300 MB max)'); } });
      return;
    }

    if (p === '/api/upload' && req.method === 'POST') {
      if (req.headers['x-dm-key'] !== dmKey) { res.writeHead(403); return res.end('DM only'); }
      const ext = IMAGE_EXT[(req.headers['content-type'] || '').split(';')[0]];
      if (!ext) { res.writeHead(415); return res.end('PNG, JPG, WebP or GIF only'); }
      const chunks = []; let size = 0, tooBig = false;
      req.on('data', (c) => { size += c.length; if (size > 100 * 1024 * 1024) { tooBig = true; req.destroy(); } else chunks.push(c); });
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
      req.on('close', () => { if (tooBig && !res.headersSent) { res.writeHead(413); res.end('Image too large (100 MB max)'); } });
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

  // How much of a token's health a player may see. Their own tokens: everything. Others: by the token's
  // "players see HP" setting (default: numbers for player characters, just a bar for everything else).
  function tokenFor(t, u) {
    if (u.isDM || (t.owner && t.owner === u.name)) return t;
    const show = t.hpShow || (t.owner ? 'numbers' : 'bar');
    if (show === 'numbers') return t;
    const { hp, maxHp, tempHp, initBonus, ...rest } = t;
    if (show === 'bar' && maxHp > 0 && hp != null) rest.hpPct = Math.round(clamp(hp / maxHp, 0, 1) * 100);
    return rest;
  }

  // ---------- initiative ----------
  const combatOf = (sc) => (sc.combat = sc.combat || { active: false, round: 1, turnId: null, entries: [] });
  function sortCombat(sc) {
    const c = combatOf(sc);
    c.entries = c.entries.filter((e) => sc.tokens[e.id]);
    c.entries.sort((a, b) => (b.init ?? -999) - (a.init ?? -999) || ((sc.tokens[b.id].initBonus || 0) - (sc.tokens[a.id].initBonus || 0)) || sc.tokens[a.id].label.localeCompare(sc.tokens[b.id].label));
    // until the first Next, the turn stays with whoever is top of the order as initiatives come in
    if (!c.started || (c.turnId && !c.entries.some((e) => e.id === c.turnId))) c.turnId = c.entries[0] ? c.entries[0].id : null;
    if (!c.turnId && c.entries.length) c.turnId = c.entries[0].id;
  }
  // Players see only combatants they can see; if it's an unseen creature's turn they just see that.
  function combatFor(sc, u) {
    const c = combatOf(sc);
    if (u.isDM || !c.active) return c;
    const entries = c.entries.filter((e) => sc.tokens[e.id] && tokVisible(sc, sc.tokens[e.id], u));
    const turnSeen = entries.some((e) => e.id === c.turnId);
    return { active: true, round: c.round, turnId: turnSeen ? c.turnId : null, hiddenTurn: !turnSeen && !!c.turnId, entries };
  }
  function sendCombat(sc) {
    clients().forEach((c) => {
      if (c.user.isDM) send(c, { type: 'combat', sceneId: sc.id, combat: combatOf(sc) });
      else if (sc.id === state.activeScene) send(c, { type: 'combat', sceneId: sc.id, combat: combatFor(sc, c.user) });
    });
  }

  // What a player is allowed to see of a scene: no secret doors, traps or hidden tokens,
  // and under fog of war only the revealed cells (plus their own tokens).
  function playerScene(sc, u) {
    if (!sc) return null;
    syncFog(sc);
    const fog = fogOn(sc), tiles = {}, props = {}, tokens = {};
    for (const [k, t] of Object.entries(sc.tiles)) { if (!fog) { tiles[k] = t; continue; } const [x, y] = k.split(',').map(Number); if (revealed(sc, x, y)) tiles[k] = t; }
    for (const [k, p] of Object.entries(sc.props)) if (!DM_ONLY.has(p.kind) && revealed(sc, p.x, p.y)) props[k] = p;
    for (const [k, t] of Object.entries(sc.tokens)) if (tokVisible(sc, t, u)) tokens[k] = tokenFor(t, u);
    const labels = {};
    for (const [k, l] of Object.entries(sc.labels || {})) if (labelVisible(sc, l)) labels[k] = l;
    // walls, doors and lights from imported maps are only for the DM's tools (they'd give away the layout)
    const { walls, doors, lights, ...rest } = sc;
    return { ...rest, tiles, props, tokens, labels, templates: sc.templates || {}, combat: combatFor(sc, u) };
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
      if (now) send(c, { type: 'token', sceneId: sc.id, token: tokenFor(tok, c.user) });
      else if (was) send(c, { type: 'removeToken', sceneId: sc.id, id: tok.id });
    }
    // a combatant stepping in or out of sight changes the players' initiative list
    if (sc.combat && sc.combat.active && sc.combat.entries.some((e) => e.id === tok.id) && (!before || tokVisible(sc, before, {}) !== tokVisible(sc, tok, {}) || before.x !== tok.x || before.y !== tok.y || before.hidden !== tok.hidden)) sendCombat(sc);
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
    const hpVal = (v, lo) => (v === null || v === '' ? null : clamp(int(v, 0), lo, 99999));
    if (m.hp !== undefined) t.hp = hpVal(m.hp, -999);
    if (m.maxHp !== undefined) t.maxHp = hpVal(m.maxHp, 0);
    if (m.tempHp !== undefined) t.tempHp = clamp(int(m.tempHp, 0), 0, 9999);
    if (m.hpShow !== undefined) t.hpShow = HP_SHOW.includes(m.hpShow) ? m.hpShow : undefined;
    if (m.initBonus !== undefined) t.initBonus = clamp(int(m.initBonus, 0), -10, 30);
    if (m.conditions !== undefined) t.conditions = Array.isArray(m.conditions) ? [...new Set(m.conditions.filter((c) => CONDITIONS.has(c)))].slice(0, 24) : [];
    if (m.x != null) t.x = clamp(int(m.x, 0), 0, sc.cols - (t.size || 1));
    if (m.y != null) t.y = clamp(int(m.y, 0), 0, sc.rows - (t.size || 1));
    return t;
  }
  // Spell templates: anyone can place them; only whoever placed one (or the DM) can change it.
  function templateFields(m, sc, base = {}) {
    const t = { ...base };
    if (m.shape !== undefined) { if (!SHAPES.includes(m.shape)) return null; t.shape = m.shape; }
    if (!t.shape) return null;
    t.x = clamp(num(m.x, t.x ?? 0), 0, sc.cols); t.y = clamp(num(m.y, t.y ?? 0), 0, sc.rows);
    t.angle = ((num(m.angle, t.angle ?? 0) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    t.size = clamp(Math.round(num(m.size, t.size ?? 20) / 5) * 5, 5, 500);
    if (t.shape === 'line') t.width = clamp(Math.round(num(m.width, t.width ?? 5) / 5) * 5, 5, 60);
    t.color = color(m.color, t.color || '#e8390e');
    return t;
  }
  // Map labels (everyone sees them) and notes (only the DM sees them).
  function labelFields(m, sc, base = {}) {
    const l = { ...base };
    if (m.text !== undefined) l.text = str(m.text, 120).replace(/\s+/g, ' ').trim();
    if (!l.text) return null;
    l.x = clamp(num(m.x, l.x ?? 0), 0, sc.cols); l.y = clamp(num(m.y, l.y ?? 0), 0, sc.rows);
    if (m.dmOnly !== undefined) l.dmOnly = !!m.dmOnly;
    l.size = LABEL_SIZES.includes(m.size) ? m.size : l.size || 'm';
    return l;
  }
  // Load a whole map's contents at once (used by the map generators).
  function fillScene(sc, m) {
    sc.tiles = {}; sc.props = {}; sc.tokens = {}; sc.templates = {}; sc.labels = {};
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
    // imported maps (Universal VTT): background image, and walls and doors used by Reveal room
    if (m.bg && typeof m.bg.url === 'string' && /^\/uploads\/[a-f0-9]{16}\.(png|jpg|webp|gif)$/.test(m.bg.url)) sc.bg = { url: m.bg.url };
    const seg = (w) => Array.isArray(w) && w.length >= 4 && w.slice(0, 4).every((v) => Number.isFinite(Number(v)))
      ? w.slice(0, 4).map((v, i) => Math.round(clamp(Number(v), -1, (i % 2 ? sc.rows : sc.cols) + 1) * 1000) / 1000) : null;
    sc.walls = Array.isArray(m.walls) ? m.walls.slice(0, 20000).map(seg).filter(Boolean) : [];
    sc.doors = Array.isArray(m.doors) ? m.doors.slice(0, 1000).map(seg).filter(Boolean) : [];
    sc.lights = Array.isArray(m.lights) ? m.lights.slice(0, 500).filter((l) => Array.isArray(l) && l.length >= 3).map((l) => [clamp(num(l[0], 0), 0, sc.cols), clamp(num(l[1], 0), 0, sc.rows), clamp(num(l[2], 0), 0, 100), color(l[3], '#ffd27f')]) : [];
    if (Array.isArray(m.labels)) for (const l of m.labels.slice(0, 300)) { const lb = labelFields(l, sc); if (lb) { lb.id = uid(); sc.labels[lb.id] = lb; } }
    // fog: { on, reveal: [[x0, y0, x1, y1], ...] } — e.g. a generated dungeon with only the entrance showing
    sc.fog = { on: !!(m.fog && m.fog.on), data: '' };
    fogArrays.delete(sc.id);
    const a = fogArr(sc);
    if (m.fog && typeof m.fog.data === 'string' && m.fog.data) { const b = Buffer.from(m.fog.data, 'base64'); if (b.length === a.length) a.set(b); }
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
    ws.on('close', () => {
      if (!ws.user.joined) return;
      if (ws.user.measuring) clients().forEach((c) => send(c, { type: 'measure', sceneId: ws.user.measuring, who: ws.user.name, dm: ws.user.isDM, points: null }));
      presence();
    });
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
        if (!tok) return;
        const mine = tok.owner && tok.owner === u.name;
        if (!u.isDM && !mine) return;
        const before = { ...tok };
        // players can only change their own character's health, conditions and initiative bonus
        const m = u.isDM ? msg : Object.fromEntries(['hp', 'maxHp', 'tempHp', 'conditions', 'initBonus'].filter((k) => k in msg).map((k) => [k, msg[k]]));
        Object.assign(tok, tokenFields({ ...m, x: m.x ?? tok.x, y: m.y ?? tok.y, size: m.size ?? tok.size }, sc, tok));
        tokenChanged(sc, tok, before);
        if (sc.combat && sc.combat.active && 'initBonus' in m) { sortCombat(sc); sendCombat(sc); }
        save();
        break;
      }
      case 'hpChange': { // damage (negative) or healing (positive); temporary HP soaks damage first
        if (!tok || (!u.isDM && !(tok.owner && tok.owner === u.name))) return;
        const amt = clamp(int(msg.amount, 0), -99999, 99999);
        if (!amt || (tok.hp == null && tok.maxHp == null)) return;
        const before = { ...tok };
        let hp = tok.hp ?? tok.maxHp ?? 0, temp = tok.tempHp || 0;
        if (amt < 0) { const soak = Math.min(temp, -amt); temp -= soak; hp = Math.max(0, hp - (-amt - soak)); }
        else hp = tok.maxHp ? Math.min(tok.maxHp, hp + amt) : hp + amt;
        tok.hp = hp; tok.tempHp = temp;
        tokenChanged(sc, tok, before); save();
        break;
      }
      case 'removeToken':
        if (!u.isDM || !tok) return;
        delete sc.tokens[msg.id];
        toScene(sc.id, { type: 'removeToken', sceneId: sc.id, id: msg.id });
        if (sc.combat && sc.combat.entries.some((e) => e.id === msg.id)) { sortCombat(sc); sendCombat(sc); }
        save();
        break;

      // ----- initiative -----
      case 'combatStart': case 'combatAdd': {
        if (!u.isDM || !sc) return;
        const c = combatOf(sc);
        if (msg.type === 'combatStart' && !c.active) Object.assign(c, { active: true, round: 1, turnId: null, started: false, entries: [] });
        c.active = true;
        const ids = Array.isArray(msg.ids) ? msg.ids : [];
        for (const id of ids.slice(0, 200)) if (sc.tokens[id] && !c.entries.some((e) => e.id === id)) c.entries.push({ id, init: null });
        sortCombat(sc); sendCombat(sc); save();
        break;
      }
      case 'combatRemove':
        if (!u.isDM || !sc || !sc.combat) return;
        if (sc.combat.turnId === msg.tokenId) { const i = sc.combat.entries.findIndex((e) => e.id === msg.tokenId); const nx = sc.combat.entries[i + 1] || sc.combat.entries[0]; sc.combat.turnId = nx && nx.id !== msg.tokenId ? nx.id : null; }
        sc.combat.entries = sc.combat.entries.filter((e) => e.id !== msg.tokenId);
        sortCombat(sc); sendCombat(sc); save();
        break;
      case 'combatInit': { // set an initiative score by hand: the DM for anyone, a player for their own token
        const c = sc && sc.combat, e = c && c.entries.find((x) => x.id === msg.tokenId), t = e && sc.tokens[e.id];
        if (!t || (!u.isDM && !(t.owner && t.owner === u.name))) return;
        e.init = msg.init === null || msg.init === '' ? null : clamp(int(msg.init, 0), -10, 60);
        sortCombat(sc); sendCombat(sc); save();
        break;
      }
      case 'combatRoll': { // roll 1d20 + initiative bonus. DM: any listed tokens, or "monsters"; player: their own
        const c = sc && sc.combat; if (!c || !c.active) return;
        let list = c.entries;
        if (msg.who === 'monsters') list = list.filter((e) => !sc.tokens[e.id].owner);
        else if (Array.isArray(msg.tokenIds)) list = list.filter((e) => msg.tokenIds.includes(e.id));
        if (!u.isDM) list = list.filter((e) => sc.tokens[e.id].owner === u.name);
        if (msg.onlyUnrolled) list = list.filter((e) => e.init == null);
        for (const e of list.slice(0, 100)) {
          const t = sc.tokens[e.id], b = t.initBonus || 0;
          const r = rollDice('1d20' + (b ? (b > 0 ? '+' : '') + b : ''));
          e.init = r.total;
          // monsters' rolls stay between the DM and the dice
          const who = u.isDM && !t.owner ? 'DM' : u.name;
          const entry = { who, label: t.label === who ? 'Initiative' : `${t.label} · Initiative`, expr: '1d20' + (b ? (b > 0 ? '+' : '') + b : ''), ...r, private: u.isDM && !t.owner, time: Date.now() };
          state.log.push(entry);
          clients().forEach((cl) => canSee(cl.user, entry) && send(cl, { type: 'roll', entry }));
        }
        state.log = state.log.slice(-200);
        sortCombat(sc); sendCombat(sc); save();
        break;
      }
      case 'combatNext': case 'combatPrev': {
        const c = sc && sc.combat;
        if (!u.isDM || !c || !c.active || !c.entries.length) return;
        sortCombat(sc); c.started = true;
        const i = Math.max(0, c.entries.findIndex((e) => e.id === c.turnId));
        if (msg.type === 'combatNext') { if (i + 1 >= c.entries.length) { c.round++; c.turnId = c.entries[0].id; } else c.turnId = c.entries[i + 1].id; }
        else if (i === 0) { if (c.round > 1) { c.round--; c.turnId = c.entries[c.entries.length - 1].id; } } else c.turnId = c.entries[i - 1].id;
        sendCombat(sc); save();
        break;
      }
      case 'combatEnd':
        if (!u.isDM || !sc) return;
        sc.combat = { active: false, round: 1, turnId: null, entries: [] };
        sendCombat(sc); save();
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

      // ----- spell templates (anyone) -----
      case 'templateSet': {
        if (!sc || !msg.tpl) return;
        sc.templates = sc.templates || {};
        const id = typeof msg.tpl.id === 'string' && /^[a-z0-9]{4,16}$/.test(msg.tpl.id) ? msg.tpl.id : uid();
        const old = sc.templates[id];
        if (old && !u.isDM && old.owner !== u.name) return;
        if (!old && Object.keys(sc.templates).length >= 100) return send(ws, { type: 'error', message: 'This map has 100 templates already. Clear some first.' });
        const t = templateFields(msg.tpl, sc, old || {});
        if (!t) return;
        t.id = id; t.owner = old ? old.owner : (u.isDM ? '' : u.name); t.by = old ? old.by : u.name;
        sc.templates[id] = t;
        toScene(sc.id, { type: 'template', sceneId: sc.id, tpl: t }); save();
        break;
      }
      case 'templateRemove': { // one by id; or all of the sender's ("mine"); or the DM clears the lot ("all")
        if (!sc || !sc.templates) return;
        const ids = Object.values(sc.templates).filter((t) =>
          (msg.id ? t.id === msg.id : msg.all ? u.isDM : msg.mine ? (u.isDM ? !t.owner : t.owner === u.name) : false)
          && (u.isDM || t.owner === u.name)).map((t) => t.id);
        if (!ids.length) return;
        ids.forEach((id) => delete sc.templates[id]);
        toScene(sc.id, { type: 'templateRemove', sceneId: sc.id, ids }); save();
        break;
      }

      // ----- map labels and DM notes (DM only) -----
      case 'labelSet': {
        if (!u.isDM || !sc || !msg.label) return;
        sc.labels = sc.labels || {};
        const id = typeof msg.label.id === 'string' && /^[a-z0-9]{4,16}$/.test(msg.label.id) ? msg.label.id : uid();
        const old = sc.labels[id];
        if (!old && Object.keys(sc.labels).length >= 300) return;
        const l = labelFields(msg.label, sc, old || {});
        if (!l) return;
        l.id = id; sc.labels[id] = l;
        toDMs({ type: 'label', sceneId: sc.id, label: l });
        toPlayersOnScene(sc.id, labelVisible(sc, l) ? { type: 'label', sceneId: sc.id, label: l } : { type: 'labelRemove', sceneId: sc.id, id });
        save();
        break;
      }
      case 'labelRemove':
        if (!u.isDM || !sc || !sc.labels || !sc.labels[msg.id]) return;
        delete sc.labels[msg.id];
        toScene(sc.id, { type: 'labelRemove', sceneId: sc.id, id: msg.id }); save();
        break;

      // ----- ping and live ruler: passed straight on, never saved -----
      case 'ping': {
        if (!sc) return;
        const now = Date.now(); if (now - (u.lastPing || 0) < 300) return; u.lastPing = now;
        const x = clamp(num(msg.x, 0), 0, sc.cols), y = clamp(num(msg.y, 0), 0, sc.rows);
        toScene(sc.id, { type: 'ping', sceneId: sc.id, x, y, who: u.name, dm: u.isDM, focus: u.isDM && !!msg.focus });
        break;
      }
      case 'measure': {
        if (!sc) return;
        let pts = null;
        if (Array.isArray(msg.points)) pts = msg.points.slice(0, 20).map((p) => [clamp(num(p && p[0], 0), 0, sc.cols), clamp(num(p && p[1], 0), 0, sc.rows)]);
        u.measuring = pts ? sc.id : null;
        const out = { type: 'measure', sceneId: sc.id, who: u.name, dm: u.isDM, points: pts, ft: pts ? clamp(int(msg.ft, 0), 0, 99999) : 0 };
        clients().forEach((c) => c !== ws && (c.user.isDM || sc.id === state.activeScene) && send(c, out));
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
              const tokens = Object.values(sc.tokens).filter((t) => touches(t) && tokVisible(sc, t, c.user)).map((t) => tokenFor(t, c.user));
              const labels = Object.values(sc.labels || {}).filter((l) => set.has(Math.floor(l.x) + ',' + Math.floor(l.y)) && labelVisible(sc, l));
              send(c, { type: 'fogReveal', sceneId: sc.id, cells: changed, tiles, props, tokens, labels });
            } else { // cover it again: tokens that dropped out of sight go too
              const gone = Object.values(sc.tokens).filter((t) => touches(t) && !tokVisible(sc, t, c.user)).map((t) => t.id);
              send(c, { type: 'fogHide', sceneId: sc.id, cells: changed, tokens: gone });
            }
          }
          if (sc.combat && sc.combat.active) sendCombat(sc);
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
        if (msg.diag != null && DIAGONALS.includes(msg.diag)) patch.diag = msg.diag;
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
          for (const l of Object.values(sc.labels || {})) { l.x = clamp(l.x, 0, sc.cols); l.y = clamp(l.y, 0, sc.rows); }
          for (const [k, t] of Object.entries(sc.templates || {})) if (t.x > sc.cols || t.y > sc.rows) delete sc.templates[k];
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
