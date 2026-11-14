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
const RULES = require('./spellrules');
const FEATS = require('./features');
const FX = require('../public/js/monsterfx.js');
const SUMS = require('./summons');
const ddb = require('./ddb');

const VERSION = '1.19.1';
const PUBLIC = path.join(__dirname, '..', 'public');
const VISION = require(path.join(PUBLIC, 'js', 'vision.js'));
const CATALOG = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'catalog.json'), 'utf8'));
const TERRAINS = CATALOG.terrains.map((t) => t.id);
const PROPS = CATALOG.props.map((p) => p.id);
const DM_ONLY = new Set(CATALOG.props.filter((p) => p.dmOnly).map((p) => p.id)); // secret doors, traps
const TOKENS_JSON = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'tokens.json'), 'utf8'));
const ICONS = new Set(Object.keys(TOKENS_JSON.icons));
const SPELL_FX = ['fire', 'lightning', 'cold', 'acid', 'thunder', 'necrotic', 'radiant', 'poison', 'force', 'psychic', 'healing'];
const CONDITIONS = new Set((TOKENS_JSON.conditions || []).map((c) => c.id));
const HP_SHOW = ['numbers', 'bar', 'none'];
const UPLOAD_URL = /^\/uploads\/[a-f0-9]{16}\.(png|jpg|webp|gif)$/;
const AUDIO_URL = /^\/uploads\/[a-f0-9]{16}\.(mp3|ogg|wav|m4a|webm|flac)$/;
const AUDIO_EXT = { 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav', 'audio/vnd.wave': '.wav',
  'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/m4a': '.m4a', 'audio/aac': '.m4a', 'audio/webm': '.webm', 'audio/flac': '.flac', 'audio/x-flac': '.flac' };
// built-in music and ambiences (public/audio); the DM can add their own
const SOUNDS = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'audio', 'catalog.json'), 'utf8')).sounds;
const WEATHER = ['none', 'rain', 'storm', 'snow', 'fog', 'embers'];
const TIMES = ['day', 'dawn', 'dusk', 'night'];
const MOODS = ['none', 'darkness', 'bloodmoon']; // 1.10: a mood over the whole map
const MOMENTS = ['lightning', 'quake']; // 1.10: one-off moments the DM sets off
const WALL_STYLES = ['built', 'rock'];
const MAX_AMB = 5;
const MAX_SIDE = 200;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.webm': 'audio/webm', '.flac': 'audio/flac'
};
const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };

const uid = () => crypto.randomBytes(5).toString('hex');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const int = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
// player PINs are kept as salted hashes, never as the PIN itself
const pinHash = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const DDB = /^https:\/\/(www\.)?(dndbeyond\.com\/(profile\/[^/]+\/)?characters\/\d+[\w\-/]*|ddb\.ac\/characters\/\d+[\w\-/]*)$/i;
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const SHAPES = ['cone', 'sphere', 'cube', 'line', 'cylinder'];
const DIAGONALS = ['5', '5105'];
const LABEL_SIZES = ['s', 'm', 'l'];
const AMBIENT = ['bright', 'dim', 'dark'];
const DOOR_KINDS = new Set(['door', 'doubledoor']);
const color = (c, d) => (/^#[0-9a-f]{6}$/i.test(c) ? c : d);

function newScene(name, cols = 30, rows = 20) {
  return {
    id: uid(), name: str(name || 'New map', 40),
    cols: clamp(int(cols, 30), 5, MAX_SIDE), rows: clamp(int(rows, 20), 5, MAX_SIDE),
    cell: 50, showGrid: true, bg: null, tiles: {}, props: {}, tokens: {}, templates: {}, labels: {},
    fog: { on: false, data: '' }, // data: base64, one byte per cell (1 = revealed), row by row
    vision: { on: false, ambient: 'bright', shared: true, explore: true }
  };
}

function loadState(file) {
  let s = null;
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* fresh table */ }
  if (s && s.version === 2) {
    s.library = s.library || [];
    s.passcode = typeof s.passcode === 'string' ? s.passcode : ''; s.blocked = Array.isArray(s.blocked) ? s.blocked : [];
    s.pins = s.pins && typeof s.pins === 'object' ? s.pins : {};
    s.encounters = Array.isArray(s.encounters) ? s.encounters : [];
    s.audio = Array.isArray(s.audio) ? s.audio : [];
    s.sound = s.sound && typeof s.sound === 'object' ? s.sound : { music: null, amb: [] };
    s.diceSkins = s.diceSkins && typeof s.diceSkins === 'object' ? s.diceSkins : {};
    s.characters = s.characters && typeof s.characters === 'object' ? s.characters : {};
    s.items = s.items && typeof s.items === 'object' ? s.items : {}; s.inventory = s.inventory && typeof s.inventory === 'object' ? s.inventory : {};
    for (const ch of Object.values(s.characters)) RULES.enrichCharacter(ch); // spells brought in before 1.14 learn their conditions and darts
    for (const sc of Object.values(s.scenes)) sc.fog = sc.fog || { on: false, data: '' };
    // spells holding tokens, saved by 1.15: say how they end the 1.16 way
    for (const sc of Object.values(s.scenes)) for (const t of Object.values(sc.tokens || {})) for (const m of t.marks || []) if (m.ends !== undefined) {
      const e = m.ends; delete m.ends;
      if (e === 'end' || e === 'end+hurtAdv') m.end = true;
      if (e === 'end+hurtAdv') m.hurt = 'adv'; else if (e === 'hurt') m.hurt = 'save'; else if (e === 'damage') m.hurt = 'end';
      if (e === 'sleep') { m.hurt = 'end'; if (m.stage === 1) m.then = { add: ['unconscious'], hurt: 'end' }; }
      if (e === 'escape') { m.escape = 'athletics'; m.escapeDc = m.dc; }
      if (e === 'fear') m.manual = 'If it ended its turn out of sight of the caster, it repeats the save';
    }
    return s;
  }
  const state = { version: 2, scenes: {}, order: [], activeScene: null, log: [], macros: {}, library: [], passcode: '', blocked: [], pins: {}, encounters: [], audio: [], sound: { music: null, amb: [] }, diceSkins: {}, characters: {}, items: {}, inventory: {} };
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

// network (from the DM app, optional): { info() → port, router status…, configure(changes) → result }
function startServer({ port = 3000, host = '0.0.0.0', dataDir, dmKey, network = null } = {}) {
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
    if (t.owner && (t.owner === u.name || t.owner === '*')) return true;
    if (fogOn(sc) && !tokenRevealed(sc, t)) return false;
    if (visionOn(sc)) return inSight(sc, t, sightFor(sc, u.name));
    return true;
  }

  // ---------- lighting and vision ----------
  // With vision on, players see only what their characters can see: line of sight from their tokens,
  // and in the dark only lit squares (or within darkvision). Kept per player name, worked out again when things move.
  const visionOn = (sc) => !!(sc && sc.vision && sc.vision.on);
  const sights = new Map(); // sceneId → Map(name → Uint8Array)
  const visionKey = (sc, name) => (sc.vision && sc.vision.shared === false ? name || '' : '*');
  function sightFor(sc, name) {
    let m = sights.get(sc.id); if (!m) sights.set(sc.id, m = new Map());
    const key = visionKey(sc, name);
    if (!m.has(key)) m.set(key, VISION.sight(sc, VISION.viewersFor(sc, name)));
    return m.get(key);
  }
  function inSight(sc, t, S) {
    if (!S) return false;
    for (let y = t.y; y < t.y + t.size; y++) for (let x = t.x; x < t.x + t.size; x++) if (x < sc.cols && y < sc.rows && S[y * sc.cols + x]) return true;
    return false;
  }
  const sightData = (sc, u) => (visionOn(sc) ? Buffer.from(sightFor(sc, u.name)).toString('base64') : null);
  const visionTimers = new Map();
  const scheduleVision = (sc) => { if (!sc || visionTimers.has(sc.id)) return; visionTimers.set(sc.id, setTimeout(() => { visionTimers.delete(sc.id); refreshVision(sc); }, 25)); };
  // Work sight out again and tell each player what changed: their view, and tokens coming into or out of sight.
  function refreshVision(sc) {
    if (!state.scenes[sc.id]) return;
    const old = sights.get(sc.id) || new Map();
    sights.delete(sc.id);
    const players = playersOnScene(sc.id), explore = new Set();
    for (const c of players) {
      const key = visionKey(sc, c.user.name), before = old.get(key) || null;
      const now = visionOn(sc) ? sightFor(sc, c.user.name) : null;
      if (now && fogOn(sc) && sc.vision.explore !== false) { const a = fogArr(sc); for (let i = 0; i < now.length; i++) if (now[i] && !a[i]) explore.add(i); }
      if (now && before && now.length === before.length && Buffer.compare(Buffer.from(now), Buffer.from(before)) === 0) continue;
      send(c, { type: 'sight', sceneId: sc.id, data: now ? Buffer.from(now).toString('base64') : null });
      for (const t of Object.values(sc.tokens)) {
        if (t.hidden || (t.owner && (t.owner === c.user.name || t.owner === '*'))) continue;
        if (fogOn(sc) && !tokenRevealed(sc, t)) continue;
        const was = !before && !visionOn(sc) ? true : before ? inSight(sc, t, before) : true;
        const is = now ? inSight(sc, t, now) : true;
        if (is && !was) send(c, { type: 'token', sceneId: sc.id, token: tokenFor(t, c.user) });
        else if (!is && was) send(c, { type: 'removeToken', sceneId: sc.id, id: t.id });
      }
    }
    // the party's view counts as explored even when nobody's connected yet
    if (visionOn(sc) && fogOn(sc) && sc.vision.explore !== false && sc.vision.shared !== false && inPlay(sc)) {
      const now = sightFor(sc, ''), a = fogArr(sc); for (let i = 0; i < now.length; i++) if (now[i] && !a[i]) explore.add(i);
    }
    // with fog of war on, what the party sees stays revealed (they've explored it)
    if (explore.size) revealFog(sc, [...explore].map((i) => [i % sc.cols, Math.floor(i / sc.cols)]), true);
    else if (sc.combat && sc.combat.active) sendCombat(sc);
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
      return res.end(JSON.stringify({ app: 'tabletop', version: VERSION, passcode: !!state.passcode }));
    }

    if (p === '/api/info') { // DM only: the addresses players can use to connect
      if (url.searchParams.get('key') !== dmKey) { res.writeHead(403); return res.end('DM only'); }
      const ips = Object.values(os.networkInterfaces()).flat()
        .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ips, port: server.address().port, version: VERSION, network: network ? network.info() : null }));
    }

    if (p === '/api/network' && req.method === 'POST') { // DM only: the port, and opening it on the router (the DM app does this)
      if (req.headers['x-dm-key'] !== dmKey) { res.writeHead(403); return res.end('DM only'); }
      if (!network) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, message: 'Network settings are part of the Tabletop DM app' })); }
      let body = ''; req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
      req.on('end', async () => {
        let m = {}; try { m = JSON.parse(body || '{}'); } catch { /* empty */ }
        let out; try { out = await network.configure(m); } catch (e) { out = { ok: false, message: e.message }; }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
      });
      return;
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
        fog: { on: fogOn(sc), data: sc.fog ? sc.fog.data : '' }, vision: sc.vision || null,
        atmo: sc.atmo ? { ...sc.atmo, sound: builtinOnly(sc.atmo.sound) } : null, // the DM's own sound files stay behind
        wallStyle: sc.wallStyle || 'built'
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
          tiles: m.tiles, props: m.props, labels: m.labels, walls: m.walls, doors: m.doors, lights: m.lights, fog: m.fog, atmo: m.atmo, wallStyle: m.wallStyle,
          bg: m.bg && to(m.bg.url) ? { url: to(m.bg.url) } : null,
          tokens: Array.isArray(m.tokens) ? m.tokens.map((t) => ({ ...t, img: t.img ? to(t.img) : null })) : []
        });
        sc.showGrid = m.showGrid !== false;
        if (DIAGONALS.includes(m.diag)) sc.diag = m.diag;
        if (m.vision && typeof m.vision === 'object') sc.vision = { on: !!m.vision.on, ambient: AMBIENT.includes(m.vision.ambient) ? m.vision.ambient : 'bright', shared: m.vision.shared !== false, explore: m.vision.explore !== false };
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
      const type = (req.headers['content-type'] || '').split(';')[0].toLowerCase();
      const ext = IMAGE_EXT[type] || AUDIO_EXT[type];
      if (!ext) { res.writeHead(415); return res.end(type.startsWith('audio/') ? 'MP3, OGG, WAV, M4A, WebM or FLAC sound files only' : 'PNG, JPG, WebP or GIF only'); }
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
      req.on('close', () => { if (tooBig && !res.headersSent) { res.writeHead(413); res.end('File too large (100 MB max)'); } });
      return;
    }

    const root = p.startsWith('/uploads/') ? uploads : PUBLIC;
    const rel = p.startsWith('/uploads/') ? p.slice('/uploads/'.length) : (p === '/' ? 'index.html' : p);
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
      const head = {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': root === uploads ? 'public, max-age=31536000, immutable' : 'no-cache', 'Accept-Ranges': 'bytes'
      };
      // part of a file (sound players ask for these to jump around in long tracks)
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (m && (m[1] || m[2])) {
        let a = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2])), b = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
        if (a > b || a >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
        res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 });
        return fs.createReadStream(file, { start: a, end: b }).pipe(res);
      }
      res.writeHead(200, { ...head, 'Content-Length': st.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  });

  // ---------- WebSocket ----------
  const wss = new WebSocketServer({ server, maxPayload: 4 * 1024 * 1024 });
  wss.on('error', () => {}); // a port already in use comes through here too: startServer's promise reports it
  const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
  const clients = () => [...wss.clients].filter((c) => c.user && c.user.joined);
  const toDMs = (msg) => clients().forEach((c) => c.user.isDM && send(c, msg));
  // Send a scene change to every DM, and to players only if that scene is the one on the table.
  // ---------- floors ----------
  // A map can have floors (maps in one group, each with a level). Players see the floor their
  // character is on; anyone without a character on one sees the floor the DM showed.
  const floorsOf = (sc) => (sc && sc.group ? state.order.map((id) => state.scenes[id]).filter((x) => x && x.group === sc.group).sort((a, b) => (b.level || 0) - (a.level || 0)) : []);
  function viewOf(u) {
    const act = state.scenes[state.activeScene];
    if (u.isDM || !act || !act.group) return state.activeScene;
    const mine = (x) => Object.values(x.tokens).some((t) => !t.hidden && t.owner && t.owner !== '*' && sameName(t.owner, u.name));
    if (mine(act)) return act.id;
    const f = floorsOf(act).find(mine);
    return f ? f.id : act.id;
  }
  const seesScene = (c, sceneId) => c.user.isDM || viewOf(c.user) === sceneId;
  const inPlay = (sc) => !!sc && (sc.id === state.activeScene || (!!sc.group && (state.scenes[state.activeScene] || {}).group === sc.group));
  // after a character changes floor (or appears, or goes): players whose floor changed get the new one
  function refreshViews() {
    for (const c of clients()) {
      if (c.user.isDM) continue;
      const v = viewOf(c.user);
      if (c.user.view === v) continue;
      c.user.view = v;
      const sc = state.scenes[v]; if (!sc) continue;
      syncFog(sc);
      send(c, { type: 'sceneFull', scene: playerScene(sc, c.user), active: true });
      if (visionOn(sc)) scheduleVision(sc);
    }
  }
  function refreshFloors(group) {
    if (!group) return;
    const list = state.order.map((id) => state.scenes[id]).filter((x) => x && x.group === group);
    const floors = list.sort((a, b) => (b.level || 0) - (a.level || 0)).map((f) => ({ id: f.id, level: f.level || 0, floor: f.floor || '' }));
    for (const c of clients()) if (!c.user.isDM && list.some((f) => f.id === viewOf(c.user))) send(c, { type: 'floors', floors });
  }
  const toScene = (sceneId, msg) => clients().forEach((c) => seesScene(c, sceneId) && send(c, msg));
  const toPlayersOnScene = (sceneId, msg) => clients().forEach((c) => !c.user.isDM && seesScene(c, sceneId) && send(c, msg));
  // who may see a log entry: private rolls go to the roller and the DM; whispers to the sender, whoever
  // they're for and the DM ("DM" as a recipient means just the DM)
  const canSee = (u, e) => {
    if (u.isDM) return true;
    if (e.to) return sameName(e.who, u.name) || e.to.some((n) => sameName(n, u.name));
    return !e.private || u.name === e.who;
  };

  const playersOnScene = (sceneId) => clients().filter((c) => !c.user.isDM && seesScene(c, sceneId));

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
    // summoned spirits share their caster's Initiative and take their turn right after the caster (2024)
    const lead = c.entries.filter((e) => !(e.after && c.entries.some((x) => x.id === e.after && !x.after))), fol = c.entries.filter((e) => !lead.includes(e));
    lead.sort((a, b) => (b.init ?? -999) - (a.init ?? -999) || ((sc.tokens[b.id].initBonus || 0) - (sc.tokens[a.id].initBonus || 0)) || sc.tokens[a.id].label.localeCompare(sc.tokens[b.id].label));
    c.entries = lead.flatMap((e) => [e, ...fol.filter((f) => f.after === e.id).map((f) => { f.init = e.init; return f; })]);
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
    return { active: true, round: c.round, started: !!c.started, turnId: turnSeen ? c.turnId : null, hiddenTurn: !turnSeen && !!c.turnId, entries };
  }
  function sendCombat(sc) {
    clients().forEach((c) => {
      if (c.user.isDM) send(c, { type: 'combat', sceneId: sc.id, combat: combatOf(sc) });
      else if (seesScene(c, sc.id)) send(c, { type: 'combat', sceneId: sc.id, combat: combatFor(sc, c.user) });
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
    // walls and doors from imported maps are only for the DM's tools (they'd give away the layout). Imported lights
    // go to players for the look of the map: their screen shows light only where their character can see.
    const { walls, doors, ...rest } = sc;
    return { ...rest, tiles, props, tokens, labels, templates: sc.templates || {}, zones: sc.zones || {}, combat: combatFor(sc, u), sight: sightData(sc, u),
      floors: floorsOf(sc).map((f) => ({ id: f.id, level: f.level || 0, floor: f.floor || '' })) };
  }
  function sendSceneFull(sc) {
    syncFog(sc); sights.delete(sc.id);
    if (visionOn(sc)) scheduleVision(sc);
    clients().forEach((c) => {
      if (c.user.isDM) send(c, { type: 'sceneFull', scene: sc });
      else if (seesScene(c, sc.id)) send(c, { type: 'sceneFull', scene: playerScene(sc, c.user), active: true });
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
  const skinOf = (name) => state.diceSkins[String(name).toLowerCase()] || null;
  const charOf = (name) => state.characters[String(name).toLowerCase()] || null;

  // ---------- spells, features and monster abilities that land on tokens, and the saving throws around them (1.13–1.16) ----------
  let SRD = null;
  const srdOf = (t) => { if (!t.srd) return null; if (!SRD) try { SRD = new Map(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'monsters.json'), 'utf8')).monsters.map((m) => [m.id, m])); } catch { SRD = new Map(); } return SRD.get(t.srd) || null; };
  const ABL = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  const charForToken = (t) => (t.owner && t.ddb ? Object.values(state.characters).find((c) => c.link === t.ddb) : null);
  function saveBonus(t, abl) {
    const ch = charForToken(t); if (ch) { const sv = (ch.saves || []).find((x) => x.name === abl); return sv ? sv.bonus : 0; }
    const m = srdOf(t); if (!m) return 0;
    const hit = new RegExp('\\b' + abl + ' ([+-]\\d+)', 'i').exec(m.saves || ''); if (hit) return +hit[1];
    return Math.floor(((m.abl || [])[ABL.indexOf(abl)] - 10) / 2) || 0;
  }
  // Armor Class now: the sheet's, then Mage Armor (13 + Dex) and Barkskin (at least 17), Shield (+5), Shield of Faith and
  // Haste (+2), Warding Bond (+1), Slow (-2)
  function acOf(t) {
    let ac = t.ac || (charForToken(t) || {}).ac || (srdOf(t) || {}).ac || 10;
    const gr = gearOf(t); if (gr) { if (gr.acSet) ac = Math.max(ac, gr.acSet); ac += gr.ac; } // armour and bonuses from the DM's items
    const mk = spellsOn(t), c = new Set(t.conditions || []);
    for (const m of mk) if (m.acBase) ac = Math.max(ac, m.acBase + dexMod(t));
    for (const m of mk) if (m.ac) ac += m.ac;
    if (c.has('shielded')) ac += 2; if (c.has('hasted')) ac += 2; if (c.has('slowed')) ac -= 2;
    for (const m of mk) if (m.acMin) ac = Math.max(ac, m.acMin);
    return ac;
  }
  const dexMod = (t) => { const ch = charForToken(t); if (ch) return ((ch.abilities || [])[1] || {}).mod || 0; const m = srdOf(t); return m ? Math.floor(((m.abl || [])[1] - 10) / 2) || 0 : 0; };
  // how a creature takes this kind of damage: a monster's resistances, immunities and vulnerabilities (spells are magical,
  // so "nonmagical" clauses don't count for them), a character's resistances from D&D Beyond
  function takes(t, type, magical = true) {
    if (!type) return 1;
    const gr = gearOf(t); if (gr && gr.resist.includes(type)) return 0.5;
    if ((t.marks || []).some((m) => m.potionResist === type)) return 0.5;
    // fully under water, everything resists fire
    if (type === 'fire') for (const scn of Object.values(state.scenes)) if (scn.underwater && scn.tokens[t.id] === t) return 0.5;
    // Stoneskin, Protection from Energy, Warding Bond, Fire Shield, Aura of Life…
    if (spellsOn(t).some((m) => m.resist === 'all' || (Array.isArray(m.resist) && m.resist.includes(type)))) return 0.5;
    const ch = charForToken(t); if (ch) return (ch.resist || []).includes(type) ? 0.5 : 1;
    const m = srdOf(t); if (!m) return 1;
    const has = (list) => String(list || '').split(';').some((part) => !(magical && /nonmagical/i.test(part)) && new RegExp('\\b' + type + '\\b', 'i').test(part));
    return has(m.immune) ? 0 : has(m.resist) ? 0.5 : has(m.vuln) ? 2 : 1;
  }
  const SCENE_OF = { get: (t) => { for (const scn of Object.values(state.scenes)) if (scn.tokens[t.id] === t) return scn.tokens; return null; } };
  // conditions a creature can't have: a monster's condition immunities, a character's from D&D Beyond, Heroism against fear
  function immuneTo(t) {
    const m = srdOf(t), ch = charForToken(t), out = new Set();
    for (const w of String((m && m.cimmune) || '').toLowerCase().split(/[,;]\s*/)) if (w) out.add(w.trim());
    for (const w of (ch && ch.immuneCond) || []) out.add(w);
    if ((t.conditions || []).includes('heroism')) out.add('frightened');
    for (const m of spellsOn(t)) for (const c of m.immune || []) out.add(c); // Heroes' Feast
    // a paladin's Aura of Courage (level 10): allies in the aura can't be frightened while the paladin can act
    if (isPC(t)) for (const p of Object.values(SCENE_OF.get(t) || {})) {
      const pc = charForToken(p); if (!pc || !pc.aura || !pc.aura.courage) continue;
      if ((p.conditions || []).some((c) => ['incapacitated', 'unconscious', 'paralyzed', 'stunned', 'petrified', 'dead'].includes(c))) continue;
      if (Math.max(Math.abs(p.x - t.x), Math.abs(p.y - t.y)) * 5 <= pc.aura.feet) { out.add('frightened'); break; }
    }
    return out;
  }
  const doubleDice = (e) => e.replace(/(\d*)d(\d+)/g, (_, n, d) => (2 * (+n || 1)) + 'd' + d);
  const isPC = (t) => !!(t.owner && t.owner !== '*');
  // hit points change: damage (temporary hit points soak it first), healing, temporary hit points; at 0 a character is
  // unconscious and makes death saving throws; damage at 0 is a failed death save (a critical hit two), and damage that
  // leaves at least the hit point maximum over kills outright
  function hpTo(sc, tok, amount, temp, o = {}) {
    if (tok.sum && tok.hp == null && amount < 0) return; // Spiritual Weapon and the like: not a creature, can't be hurt
    const before = { ...tok }; let hp = tok.hp ?? tok.maxHp ?? 0, th = tok.tempHp || 0;
    if (temp) th = Math.max(th, temp);
    else if (amount < 0) {
      const soak = Math.min(th, -amount); th -= soak; hp = Math.max(0, hp - (-amount - soak));
      const dw = hp === 0 && (before.hp ?? 0) > 0 && spellsOn(tok).find((m) => m.deathWard); // Death Ward: 1 hit point instead, once
      if (dw) { hp = 1; liftMarks(tok, sameSpell(dw)); setImmediate(() => tellAbout(sc, tok, `🕊 Death Ward: ${tok.label || '?'} drops to 1 hit point instead, and the spell ends`)); }
    }
    else if (amount > 0) { hp = tok.maxHp ? Math.min(tok.maxHp, hp + amount) : hp + amount; if (hp > 0) { tok.conditions = (tok.conditions || []).filter((c) => c !== 'unconscious'); delete tok.death; } }
    tok.hp = hp; tok.tempHp = th;
    if (tok.sum && hp === 0 && amount < 0) { tokenChanged(sc, tok, before); setImmediate(() => removeSummon(sc, tok, 'drops to 0 hit points and disappears')); return; } // a summoned spirit vanishes
    const notes = [];
    if (amount < 0 && isPC(tok) && tok.maxHp) {
      const over = -amount - (before.hp ?? 0) - (before.tempHp || 0);
      if (hp === 0 && (before.hp ?? 0) > 0 && over >= tok.maxHp) { tok.conditions = [...new Set([...(tok.conditions || []), 'dead'])]; notes.push('killed outright (massive damage)'); }
      else if (hp === 0 && (before.hp ?? 0) === 0 && !(tok.conditions || []).includes('dead')) {
        if (-amount >= tok.maxHp) { tok.conditions = [...new Set([...(tok.conditions || []), 'dead'])]; notes.push('killed outright'); }
        else { const d = tok.death || { s: 0, f: 0 }; d.f = Math.min(3, d.f + (o.crit ? 2 : 1)); delete d.stable; tok.death = d; notes.push(`a failed death save (${d.f}/3)`); if (d.f >= 3) { tok.conditions = [...new Set([...(tok.conditions || []), 'dead'])]; notes.push('dies'); } }
      } else if (hp === 0 && (before.hp ?? 0) > 0) tok.death = { s: 0, f: 0 };
    }
    if (hp === 0 && amount < 0 && isPC(tok) && !(tok.conditions || []).includes('unconscious') && !(tok.conditions || []).includes('dead')) tok.conditions = [...(tok.conditions || []), 'unconscious'];
    tokenChanged(sc, tok, before);
    if (notes.length) setImmediate(() => tellAbout(sc, tok, `💀 ${tok.label || '?'}: ${notes.join(', ')}`));
    if (amount < 0) { onHurt(sc, tok, -amount); concCheck(sc, tok, -amount); }
  }
  const condName = (id) => ((TOKENS_JSON.conditions || []).find((c) => c.id === id) || { name: id }).name.toLowerCase();
  function post(entry) { state.log.push(entry); state.log = state.log.slice(-200); clients().forEach((c) => canSee(c.user, entry) && send(c, { type: entry.kind === 'chat' ? 'chat' : 'roll', entry })); }
  // a line for the table: a player's own token is everyone's business; a hidden monster's only the DM's.
  // Rolls: a player's own save rolls on screen for everyone; a monster's stays with the DM (the DM's rolls are secret)
  function tellAbout(sc, t, text, roll) {
    const mine = isPC(t), vis = t.hidden ? { to: ['DM'] } : {};
    if (roll) showRoll(t, roll);
    if (text) post({ kind: 'chat', who: mine ? t.owner : 'Monsters', ...vis, text, time: Date.now(), cast: true });
  }
  function showRoll(t, roll) { const mine = isPC(t); post({ who: mine ? t.owner : 'Monsters', ...roll, private: false, ...(mine ? {} : { to: ['DM'] }), time: Date.now(), skin: mine ? skinOf(t.owner) : null }); }

  // ----- the saving throw itself, with everything the 2024 rules say changes it -----
  //  Paralyzed, Stunned, Unconscious, Petrified: Strength and Dexterity saves fail automatically · Restrained: Disadvantage
  //  on Dexterity saves · Haste: Advantage on Dexterity saves · Slow: -2 to Dexterity saves · Irresistible Dance:
  //  Disadvantage on Dexterity saves · Bless +1d4 · Bane -1d4 · Synaptic Static -1d6 to concentration saves · Exhaustion
  //  -2 per level · Holy Aura: Advantage · Magic Resistance: Advantage against spells · a character's Advantages from
  //  D&D Beyond (Fey Ancestry against being charmed, Dwarven Resilience against poison, Gnome Cunning…) · War Caster
  //  for concentration · a paladin's Aura of Protection nearby. Advantage and Disadvantage cancel out. No automatic
  //  success or failure on a 20 or a 1 (that's attack rolls and death saves).
  function saveRoll(sc, t, abl, o = {}) {
    const conds = new Set(t.conditions || []), notes = [];
    if (abl && abl.includes('|')) abl = abl.split('|').sort((a, b) => saveBonus(t, b) - saveBonus(t, a))[0]; // the target's choice: its better one
    if ((abl === 'STR' || abl === 'DEX') && ['paralyzed', 'stunned', 'unconscious', 'petrified'].some((c) => conds.has(c))) return { ok: false, auto: true, abl, notes: ['fails automatically'], total: 0 };
    let bonus = abl ? saveBonus(t, abl) : 0, extra = '', adv = o.adv ? 1 : 0, dis = 0;
    if (abl === 'DEX' && conds.has('restrained')) { dis++; notes.push('Restrained'); }
    if (abl === 'DEX' && conds.has('dodging') && !['incapacitated', 'unconscious', 'paralyzed', 'stunned'].some((c) => conds.has(c))) { adv++; notes.push('Dodge'); }
    if (abl === 'DEX' && (conds.has('cover-half') || conds.has('cover-3q'))) { bonus += conds.has('cover-3q') ? 5 : 2; notes.push('cover'); }
    if (abl === 'DEX' && conds.has('hasted')) adv++;
    if (abl === 'DEX' && conds.has('slowed')) bonus -= 2;
    if (abl === 'DEX' && (t.marks || []).some((m) => /irresistible dance/i.test(m.spell) && m.c === 'charmed')) dis++;
    if (conds.has('blessed')) extra += '+1d4';
    if (conds.has('baned')) extra += '-1d4';
    if (o.conc && conds.has('muddled')) extra += '-1d6';
    if (conds.has('exhaustion')) bonus -= 2 * (t.exhaustion || 1);
    if (conds.has('holyaura')) adv++;
    { const gr = gearOf(t); if (gr && gr.saves && abl) bonus += gr.saves; }
    for (const mk of spellsOn(t)) { if (mk.saves) bonus += mk.saves; if ((mk.advSaves || []).includes(abl || 'death')) adv++; if (mk.advSpell && o.spell) adv++; }
    const m = srdOf(t), tr = m ? FX.traits(m) : null;
    if (o.spell && tr && tr.magicResistance) { adv++; notes.push('Magic Resistance'); }
    const ch = charForToken(t);
    if (ch) {
      for (const a of ch.saveAdv || []) {
        if (a.abl && abl && a.abl !== abl) continue;
        const vs = a.vs || '';
        if (!vs || (o.add || []).some((c) => vs.includes(c)) || (o.spell && /spell|magic/.test(vs)) || (o.conc && /concentrat/.test(vs)) || (o.poison && /poison/.test(vs))) { adv++; notes.push('Advantage'); break; }
      }
      if (o.conc && (ch.feats || []).some((f) => /war caster/i.test(f))) { adv++; notes.push('War Caster'); }
    }
    if (isPC(t) && abl) { // Aura of Protection: the best paladin aura in reach, if that paladin can still act
      let best = 0;
      for (const p of Object.values(sc.tokens)) {
        const pc = charForToken(p); if (!pc || !pc.aura) continue;
        if ((p.conditions || []).some((c) => ['incapacitated', 'unconscious', 'paralyzed', 'stunned', 'petrified', 'dead'].includes(c))) continue;
        if (Math.max(Math.abs(p.x - t.x), Math.abs(p.y - t.y)) * 5 <= pc.aura.feet) best = Math.max(best, pc.aura.bonus);
      }
      if (best) { bonus += best; notes.push('Aura of Protection +' + best); }
    }
    const mode = adv && !dis ? 'adv' : dis && !adv ? 'dis' : '';
    const expr = '1d20' + (bonus ? sgnS(bonus) : '') + extra + mode, r = rollDice(expr);
    return { ok: o.dc == null ? null : r.total >= o.dc, total: r.total, expr, r, abl, notes, mode };
  }
  // an ability check to get free (Web, Entangle: Strength (Athletics); a grapple: Athletics or Acrobatics, the better)
  function checkRoll(t, how, mk) {
    const ch = charForToken(t), m = srdOf(t), mods = (ch ? (ch.abilities || []).map((a) => a.mod) : (m ? (m.abl || []).map((v) => Math.floor((v - 10) / 2)) : [0, 0, 0, 0, 0, 0]));
    const skill = (name, ix) => { if (ch) { const s = (ch.skills || []).find((x) => x.name === name); return s ? s.bonus : mods[ix] || 0; } const h = new RegExp(name + ' ([+-]\\d+)').exec((m && m.skills) || ''); return h ? +h[1] : mods[ix] || 0; };
    let bonus, what;
    if (how === 'grapple') { const a = skill('Athletics', 0), b = skill('Acrobatics', 1); bonus = Math.max(a, b); what = (a >= b ? 'Strength (Athletics)' : 'Dexterity (Acrobatics)') + ' DC ' + mk.escapeDc; }
    else if (how === 'check') { const ix = ABL.indexOf(mk.checkAbl || 'STR'); bonus = mk.skill ? skill(mk.skill, ix) : mods[ix] || 0; what = `${({ STR: 'Strength', DEX: 'Dexterity' })[mk.checkAbl] || 'Strength'}${mk.skill ? ' (' + mk.skill + ')' : ''} DC ${mk.escapeDc}`; }
    else { bonus = skill('Athletics', 0); what = 'Strength (Athletics) DC ' + mk.dc; }
    const conds = new Set(t.conditions || []);
    const dis = conds.has('poisoned') || conds.has('frightened'), extra = conds.has('exhaustion') ? -2 * (t.exhaustion || 1) : 0;
    const expr = '1d20' + sgnS(bonus + extra) + (dis ? 'dis' : ''), r = rollDice(expr);
    return { ok: r.total >= (mk.escapeDc || mk.dc), total: r.total, expr, r, what };
  }

  // ----- an attack roll, with what the 2024 rules say changes it -----
  //  the attacker: Blinded, Frightened, Poisoned, Prone, Restrained → Disadvantage · Invisible → Advantage · Bless +1d4,
  //  Bane -1d4, Synaptic Static -1d6, Exhaustion -2 a level · the target: Blinded, Paralyzed, Petrified, Restrained,
  //  Stunned, Unconscious, Faerie Fire, Guiding Bolt → Advantage · Prone: Advantage up close, Disadvantage from range ·
  //  Invisible, Blur → Disadvantage · Blade Ward -1d4 · Protection from Evil and Good against its creature types ·
  //  Sanctuary: the attacker saves first or loses the attack · a hit on a Paralyzed or Unconscious creature from within
  //  5 feet is a critical hit
  // the gap between two creatures' spaces, in squares (0: next to each other)
  const sqDist = (a, b) => Math.max(0, Math.max(a.x - (b.x + b.size), b.x - (a.x + a.size)), Math.max(a.y - (b.y + b.size), b.y - (a.y + a.size))) + 1; // in squares, 1 = adjacent
  const foes = (a, b) => isPC(a) !== isPC(b);
  const canAct = (t) => !(t.conditions || []).some((c) => ['incapacitated', 'unconscious', 'paralyzed', 'stunned', 'petrified', 'dead'].includes(c)) && t.hp !== 0;
  const UNDERWATER_MELEE = /dagger|javelin|shortsword|spear|trident/i, UNDERWATER_RANGED = /crossbow|net|javelin|spear|trident|dart/i;
  function attackRoll(sc, src, t, bonus, o = {}) {
    const a = new Set((src && src.conditions) || []), d = new Set(t.conditions || []), notes = [];
    if (d.has('blinking')) return { blocked: true, ethereal: true, notes: ['Blink'] }; // in the Ethereal Plane until its turn
    let adv = 0, dis = 0, extra = '';
    const dist = src ? sqDist(src, t) : 1, near = dist <= 1, melee = o.melee != null ? o.melee : near;
    // range: past the normal range Disadvantage, past the long range it can't hit
    if (src && !melee && o.range) { const ft = dist * 5; if (o.range.long && ft > o.range.long) return { blocked: true, outOfRange: true, notes: [`out of range (${ft} ft, ${o.range.long} ft at most)`] }; if (ft > o.range.normal) { dis++; notes.push('long range'); } }
    if (src && melee && o.reach && dist > Math.max(1, o.reach / 5)) return { blocked: true, outOfRange: true, notes: ['out of reach'] };
    // a ranged attack with a foe right next to you
    if (src && !melee && Object.values(sc.tokens).some((x) => x !== src && x !== t && foes(x, src) && canAct(x) && !x.hidden && sqDist(x, src) <= 1)) { dis++; notes.push('foe within 5 ft'); }
    for (const c of ['blinded', 'frightened', 'poisoned', 'prone', 'restrained']) if (a.has(c)) { dis++; notes.push('attacker ' + c); }
    if ((a.has('invisible') || a.has('hidden')) && !d.has('blinded')) { adv++; notes.push('unseen attacker'); }
    if (a.has('blessed')) extra += '+1d4'; if (a.has('baned')) extra += '-1d4'; if (a.has('muddled')) extra += '-1d6';
    if (a.has('exhaustion')) extra += '-' + 2 * ((src && src.exhaustion) || 1);
    if (a.has('sapped')) { dis++; notes.push('Sap'); }
    if (a.has('dancing') || (src && (src.marks || []).some((m) => /irresistible dance/i.test(m.spell) && m.c === 'charmed'))) dis++;
    for (const c of ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious', 'outlined', 'distracted']) if (d.has(c)) { adv++; notes.push('target ' + c); }
    if (d.has('prone')) { if (melee) adv++; else dis++; }
    if ((d.has('invisible') || d.has('hidden')) && !d.has('outlined')) { dis++; notes.push('unseen target'); }
    if (d.has('dodging') && !a.has('hidden') && canAct(t)) { dis++; notes.push('Dodge'); }
    const vex = (t.marks || []).find((m) => m.c === 'vexed' && src && m.by === keyOf(src)); if (vex) { adv++; notes.push('Vex'); }
    // the DM's optional flanking rule: a friend of the attacker on the opposite side of the target
    if (sc.flanking && src && melee && near) {
      const cx = t.x + t.size / 2, cy = t.y + t.size / 2, ax = src.x + src.size / 2 - cx, ay = src.y + src.size / 2 - cy;
      if (Object.values(sc.tokens).some((x) => x !== src && x !== t && !foes(x, src) && canAct(x) && sqDist(x, t) <= 1 && ((x.x + x.size / 2 - cx) * ax + (x.y + x.size / 2 - cy) * ay) / (Math.hypot(ax, ay) * Math.hypot(x.x + x.size / 2 - cx, x.y + x.size / 2 - cy) || 1) < -0.9)) { adv++; notes.push('flanking'); }
    }
    // underwater: most melee weapons and ranged attacks have Disadvantage (a swimmer's natural weapons don't)
    if (sc.underwater && src && o.weapon != null) {
      const swims = /swim/i.test(((srdOf(src) || {}).speed) || '');
      if (melee && !swims && !UNDERWATER_MELEE.test(o.weapon)) { dis++; notes.push('underwater'); }
      if (!melee) { if (o.range && dist * 5 > o.range.normal) return { blocked: true, outOfRange: true, notes: ['underwater: misses past normal range'] }; if (!UNDERWATER_RANGED.test(o.weapon)) { dis++; notes.push('underwater'); } }
    }
    const marks = spellsOn(t);
    if (marks.some((m) => m.disAgainst)) { dis++; notes.push('Blur'); }
    const once = marks.find((m) => m.advAgainst); if (once) { adv++; notes.push(once.spell); }
    for (const m of marks) if (m.atkAgainst) extra += m.atkAgainst;
    const sm = src && srdOf(src);
    if (sm && marks.some((m) => (m.disFrom || []).some((ty) => new RegExp(ty, 'i').test(sm.type || '')))) { dis++; notes.push('Protection from Evil and Good'); }
    const sanct = marks.find((m) => m.sanctuary);
    if (sanct && src && !o.noSanctuary) { const sv = saveRoll(sc, src, 'WIS', { dc: sanct.dc, spell: true }); if (sv.r) showRoll(src, { label: 'Sanctuary: WIS save', expr: sv.expr, ...sv.r }); if (!sv.ok) return { blocked: true, notes: ['Sanctuary'] }; }
    const mode = adv && !dis ? 'adv' : dis && !adv ? 'dis' : '';
    const cover = d.has('cover-3q') ? 5 : d.has('cover-half') ? 2 : 0;
    const expr = String(bonus).startsWith('1d20') ? String(bonus) + extra + mode : '1d20' + sgnS(+bonus || 0) + extra + mode, r = rollDice(expr), ac = acOf(t) + cover;
    if (cover) notes.push(cover === 5 ? 'three-quarters cover' : 'half cover');
    const autoCrit = melee && near && (d.has('paralyzed') || d.has('unconscious'));
    let hit = r.crit === 'nat20' || (r.crit !== 'nat1' && r.total >= ac); const crit = hit && (r.crit === 'nat20' || autoCrit);
    // used up: Help, Guiding Bolt, Vex on the target; Sap on the attacker; attacking gives a hidden attacker away
    const b1 = { ...t }; let tch = false;
    if (once && once.advAgainst === 'once' && hit) { liftMarks(t, sameSpell(once)); tch = true; }
    if (d.has('distracted')) { t.conditions = t.conditions.filter((c) => c !== 'distracted'); liftMarks(t, (m) => m.c === 'distracted'); tch = true; }
    if (vex) { liftMarks(t, (m) => m === vex); tch = true; }
    if (tch) tokenChanged(sc, t, b1);
    if (src && (a.has('sapped') || a.has('hidden'))) { const b2 = { ...src }; src.conditions = src.conditions.filter((c) => c !== 'sapped' && c !== 'hidden'); liftMarks(src, (m) => m.c === 'sapped' || m.c === 'hidden'); tokenChanged(sc, src, b2); }
    // Mirror Image: a duplicate may take the hit (a d6 for each, 3 or higher)
    const mi = hit && (t.marks || []).find((m) => m.c === 'mirrored' && m.dupes > 0);
    if (mi) { const x = rollDice(mi.dupes + 'd6'); if (x.dice.some((dd) => dd.v >= 3)) { const b3 = { ...t }; mi.dupes--; if (!mi.dupes) liftMarks(t, (m) => m === mi); tokenChanged(sc, t, b3); return { hit: false, duplicate: true, left: mi.dupes, total: r.total, expr, r, ac, mode, notes }; } }
    return { hit, crit, total: r.total, expr, r, ac, mode, notes };
  }
  const missWhy = (a, who) => (a.ethereal ? `👻 ${who} is in the Ethereal Plane (Blink)` : a.outOfRange ? `📏 ${who}: ${a.notes[0]}` : a.duplicate ? `🪞 ${who}: a Mirror Image duplicate takes the hit${a.left ? ` (${a.left} left)` : ' (the last one)'}` : `🕊 ${who} is protected by Sanctuary`);
  // a creature leaving a foe's reach without Disengaging: that foe may make an opportunity attack (in combat, once per round)
  const reachOf = (t) => { const ch = charForToken(t); if (ch) return Math.max(5, ...(ch.attacks || []).filter((a) => !a.ranged).map((a) => a.reach || 5)); const m = srdOf(t); if (!m) return 5; return Math.max(5, ...(m.actions || []).map((a) => FX.meta(a, m).reach || 0)); };
  // ----- reactions (1.19): one per round, back at the start of the creature's turn -----
  const reactionFree = (sc, t) => !(sc.combat && sc.combat.active && t.reactUsed);
  const spendReaction = (sc, t) => { if (sc.combat && sc.combat.active) t.reactUsed = true; };
  // a question to one player (by name) or to the DM, with buttons; no answer in time counts as "no"
  const prompts = new Map();
  const askable = (to) => clients().some((c) => (to === 'dm' ? c.user.isDM : !c.user.isDM && c.user.name.toLowerCase() === to));
  function ask(to, p, resolve, ttl = 15000) {
    const id = uid();
    prompts.set(id, { to, resolve, timer: setTimeout(() => { if (!prompts.has(id)) return; prompts.delete(id); closePrompt(id); resolve(null, null); }, ttl) });
    for (const c of clients()) if (to === 'dm' ? c.user.isDM : !c.user.isDM && c.user.name.toLowerCase() === to) send(c, { type: 'prompt', id, ttl, ...p });
    return id;
  }
  const closePrompt = (id) => clients().forEach((c) => send(c, { type: 'promptClose', id }));
  const dropPrompt = (id) => { const p = prompts.get(id); if (!p) return; clearTimeout(p.timer); prompts.delete(id); closePrompt(id); };
  // the token a mark's "by" names: 'p:<player>' or 't:<token id>'
  const tokOfKey = (sc, key) => { if (!key) return null; if (key.startsWith('t:')) return sc.tokens[key.slice(2)] || null; if (key.startsWith('p:')) { const n = key.slice(2); return Object.values(sc.tokens).find((t) => t.owner && t.owner.toLowerCase() === n && t.ddb) || null; } return null; };
  // a melee attack it can make: a character's weapons, a monster's melee attacks
  function meleeOptions(o) {
    const ch = charForToken(o);
    if (ch) return (ch.attacks || []).filter((a) => a.damage && a.ranged !== true && !/bow|crossbow|sling|dart|blowgun/i.test(a.name)).slice(0, 4).map((a) => ({ label: '🗡 ' + a.name, value: a.name }));
    const m = srdOf(o); if (!m) return [];
    return (m.actions || []).map((a, i) => ({ a, i })).filter(({ a }) => /Melee/i.test(a.d) && FX.parse(a.d, m.name, 'actions').attack != null).slice(0, 4).map(({ a, i }) => ({ label: '🗡 ' + a.n.replace(/\s*\(.*?\)\s*$/, ''), value: String(i) }));
  }
  // a creature leaving a foe's reach: the foe's player (or the DM, for a monster) is asked, and one click makes the attack
  function oppAttacks(sc, mover, from) {
    const c = sc.combat; if (!c || !c.active || !c.started) return;
    if ((mover.conditions || []).some((x) => ['disengaged', 'dead'].includes(x)) || mover.hp === 0) return;
    for (const o of Object.values(sc.tokens)) {
      if (o === mover || !foes(o, mover) || !canAct(o) || o.hidden) continue;
      const r = Math.max(1, reachOf(o) / 5), was = sqDist(o, { ...mover, x: from.x, y: from.y }) <= r, now = sqDist(o, mover) <= r;
      if (!was || now || !reactionFree(sc, o)) continue;
      const to = isPC(o) ? o.owner.toLowerCase() : 'dm', opts = meleeOptions(o);
      if (!opts.length || !askable(to)) { post({ kind: 'chat', who: 'Monsters', to: isPC(o) ? [o.owner, 'DM'] : ['DM'], text: `⚔ ${mover.label || '?'} leaves ${o.label || '?'}'s reach: ${o.label || '?'} can make an opportunity attack (its Reaction)`, time: Date.now(), cast: true }); continue; }
      const sceneId = sc.id, moverId = mover.id, oId = o.id;
      ask(to, { title: 'Opportunity attack', text: `${mover.label || '?'} is leaving ${o.label || '?'}'s reach. Attack with ${isPC(o) ? 'your' : 'its'} Reaction?`, buttons: [...opts, { label: 'Let them go', value: '' }] }, (val, ws2) => {
        const scn = state.scenes[sceneId], me2 = scn && scn.tokens[oId], tg = scn && scn.tokens[moverId];
        if (!val || !ws2 || !me2 || !tg || !reactionFree(scn, me2)) return;
        spendReaction(scn, me2);
        if (isPC(me2)) handle(ws2, { type: 'attackEffect', name: val, target: moverId, opp: true });
        else handle(ws2, { type: 'monsterEffect', sceneId, src: oId, kind: 'actions', idx: +val, targets: [moverId], opp: true });
      });
    }
  }
  // ----- Counterspell (2024): a creature within 60 feet casts a spell; a foe who can see it may use its Reaction -----
  // the cast is held until they answer (or 15 seconds pass); countered, the caster makes a Constitution save against the
  // counterspeller's DC: on a failure the spell fizzles and its slot isn't spent
  function castInfo(u, sc, msg) {
    if (msg.type === 'spellEffect' && !u.isDM && msg.cast && msg.name && !msg.res) {
      const ch = charOf(u.name), sp = ch && (ch.spells || []).find((x) => x.name === msg.name); if (!sp) return null;
      const me = Object.values(sc.tokens).find((t) => t.owner === u.name && t.ddb === ch.link); if (!me) return null;
      return { caster: me, name: sp.name, level: sp.level ? clamp(int(msg.slot, sp.level), sp.level, 9) : 0, who: ch.name.split(' ')[0] };
    }
    if (msg.type === 'dmSpell' && u.isDM && msg.src && !msg.again) {
      const src = sc.tokens[msg.src], e = RULES.dbSpell(msg.spell); if (!src || !e) return null;
      return { caster: src, name: e.name, level: e.level ? clamp(int(msg.level, e.level), e.level, 9) : 0, who: src.label || '?' };
    }
    if (msg.type === 'itemUse' && !u.isDM) {
      const x = invOf(u.name).find((y) => y.id === msg.inv); if (!x || !x.item.spell || !['scroll', 'wand'].includes(x.item.kind)) return null;
      const ch = charOf(u.name), me = ch && Object.values(sc.tokens).find((t) => t.owner === u.name && t.ddb === ch.link); if (!me) return null;
      return { caster: me, name: x.item.spell.name, level: x.item.spell.level || 0, who: ch.name.split(' ')[0] };
    }
    return null;
  }
  function counterers(sc, caster) {
    const out = [];
    for (const o of Object.values(sc.tokens)) {
      if (o === caster || !foes(o, caster) || !canAct(o) || !reactionFree(sc, o) || sqDist(o, caster) * 5 > 60 || (o.conditions || []).includes('silenced')) continue;
      const ch = charForToken(o);
      if (ch) {
        if (!(ch.spells || []).some((x) => /^counterspell$/i.test(x.name))) continue;
        if (![...(ch.slots || []), ...(ch.pact || [])].some((sl) => sl.level >= 3 && sl.used < sl.max)) continue;
        if (askable(o.owner.toLowerCase())) out.push({ o, ch, dc: (ch.casting || {}).dc || 13, to: o.owner.toLowerCase() });
        continue;
      }
      const m = srdOf(o); if (!m || o.hidden) continue;
      const scs = FX.spellcasting(m), list = scs.flatMap((x) => x.lists).find((l) => l.spells.some((n) => /^counterspell$/i.test(n))); if (!list) continue;
      const entry = scs.find((x) => x.lists.includes(list)), useKey = /\(\d+\/Day/i.test(entry.name) ? entry.name.replace(/\s*\(.*?\)\s*$/, '') : 'Counterspell'; // "Protective Magic (3/Day)" counts its uses by that name
      const per = +((/(\d+)\/Day/i.exec(list.label) || [])[1] || 0) || +((/\((\d+)\/Day/i.exec(entry.name) || [])[1] || 0);
      if (per && ((o.uses || {})[useKey] || 0) >= per) continue;
      if (askable('dm')) out.push({ o, dc: (scs.find((x) => x.dc) || {}).dc || 13, per, useKey, to: 'dm' });
    }
    return out;
  }
  function holdForCounter(ws, sc, msg, ci, rs) {
    let open = rs.length, done = false; const ids = [];
    const go = () => handle(ws, { ...msg, _cs: true });
    rs.forEach((r) => {
      const id = ask(r.to, { title: 'Counterspell?', text: `${ci.who} is casting ${ci.name}${ci.level ? ` (level ${ci.level})` : ''} within 60 feet of ${r.o.label || '?'}. Use ${r.ch ? 'your' : 'its'} Reaction and ${r.ch ? 'a level 3+ slot' : 'Counterspell'}?`, buttons: [{ label: '✋ Counterspell', value: 'yes' }, { label: 'Let it happen', value: '' }] }, (val) => {
        if (done) return;
        if (val !== 'yes') { if (--open === 0) { done = true; go(); } return; }
        done = true; ids.forEach((x) => x !== id && dropPrompt(x));
        const scn = state.scenes[sc.id], caster = scn && scn.tokens[ci.caster.id], o = scn && scn.tokens[r.o.id];
        if (!caster || !o) return go();
        spendReaction(scn, o);
        if (r.ch) { const sl = [...(r.ch.slots || [])].filter((x) => x.level >= 3 && x.used < x.max).sort((a, b) => a.level - b.level)[0] || (r.ch.pact || []).find((x) => x.level >= 3 && x.used < x.max); if (sl) sl.used++; sendCharTo(o.owner); }
        else { o.uses = o.uses || {}; o.uses[r.useKey] = (o.uses[r.useKey] || 0) + 1; }
        const sv = saveRoll(scn, caster, 'CON', { dc: r.dc, spell: true }), mine = isPC(caster);
        post({ who: mine ? caster.owner : 'Monsters', label: str(`${caster.label || '?'}: CON save vs Counterspell`, 30), expr: sv.expr, ...sv.r, private: false, ...(mine ? {} : { to: ['DM'] }), time: Date.now(), skin: mine ? skinOf(caster.owner) : null });
        if (sv.ok) { post({ kind: 'chat', who: r.ch ? o.owner : 'Monsters', text: `✋ ${o.label || '?'} casts Counterspell, but ${ci.who} keeps hold of ${ci.name}`, time: Date.now(), cast: true }); go(); }
        else { post({ kind: 'chat', who: r.ch ? o.owner : 'Monsters', text: `✋ ${o.label || '?'} casts Counterspell: ${ci.who}'s ${ci.name} fizzles${ci.level ? ' (no spell slot spent)' : ''}`, time: Date.now(), cast: true }); save(); }
      });
      ids.push(id);
    });
  }
  const sendCharTo = (name) => { const ch = charOf(name); if (!ch) return; for (const c of clients()) if (!c.user.isDM && sameName(c.user.name, name)) send(c, { type: 'character', character: ch, quiet: true }); toDMs({ type: 'characters', characters: state.characters }); };
  // ----- a grapple moves with its grappler (2024: the grappler drags it); it ends when they're pulled apart -----
  function grappleAfterMove(sc, tok, before, noDrag) {
    const dx = tok.x - before.x, dy = tok.y - before.y, key = keyOf(tok), moved = [];
    if (!noDrag) for (const t of Object.values(sc.tokens)) {
      if (t === tok || !(t.marks || []).some((m) => m.c === 'grappled' && m.by === key)) continue;
      const b = { ...t }; t.x = clamp(t.x + dx, 0, sc.cols - t.size); t.y = clamp(t.y + dy, 0, sc.rows - t.size);
      tokenChanged(sc, t, b); zonesAfterMove(sc, t, b); moved.push(t.label || '?');
    }
    // a grappled creature moved apart from its grappler (pushed, teleported, or moved by the DM): the grapple ends
    for (const m of (tok.marks || []).filter((x) => x.c === 'grappled' && x.by)) {
      const g = tokOfKey(sc, m.by); if (!g) continue;
      if (sqDist(g, tok) > Math.max(1, reachOf(g) / 5)) { const b = { ...tok }; liftMarks(tok, (x) => x === m); tokenChanged(sc, tok, b); post({ kind: 'chat', who: 'Monsters', text: `🤝 ${tok.label || '?'} is out of ${g.label || '?'}'s reach: no longer grappled`, time: Date.now(), cast: true }); }
    }
    if (moved.length) post({ kind: 'chat', who: 'Monsters', ...(tok.hidden ? { to: ['DM'] } : {}), text: `🤝 ${tok.label || '?'} drags ${moved.join(', ')} along (moving at half speed while dragging)`, time: Date.now(), cast: true });
  }
  // the Resistance cantrip: the first damage of its type each turn is reduced by 1d4
  function reduceBy(sc, t, n, type) {
    const mk = (t.marks || []).find((m) => m.reduce && m.reduce.type === type); if (!mk || !(n > 0)) return n;
    const k = turnKey(sc); if (mk.used === k) return n; mk.used = k;
    return Math.max(0, n - rollDice(mk.reduce.dice || '1d4').total);
  }
  // Armor of Agathys: a creature that hits it up close takes cold damage while the temporary hit points last
  function retaliate(sc, src, t, melee) {
    const ag = spellsOn(t).find((m) => m.agathys); if (!ag || !src || !melee || !(t.tempHp > 0)) return '';
    hpTo(sc, src, -ag.agathys); return ` · Armor of Agathys: ${src.label || '?'} takes ${ag.agathys} cold damage`;
  }

  // ----- what holds a creature: "marks" on its token, one per condition, saying who put it there and how it ends -----
  const keyOf = (t) => (t.owner && t.ddb ? 'p:' + t.owner.toLowerCase() : 't:' + t.id);
  const concKey = keyOf;
  const srcTokenOf = (sc, key) => (key.startsWith('t:') ? sc.tokens[key.slice(2)] : Object.values(sc.tokens).find((t) => keyOf(t) === key)) || null;
  const spellsOn = (t) => { const seen = new Map(); for (const m of t.marks || []) { const k = m.by + '|' + m.spell; if (!seen.has(k)) seen.set(k, m); } return [...seen.values()]; };
  const sameSpell = (a) => (m) => m.by === a.by && m.spell === a.spell;
  const FIELDS = ['end', 'start', 'hurt', 'escape', 'escapeDc', 'checkAbl', 'skill', 'expire', 'tick', 'count', 'manual', 'note', 'afterEnd', 'temp', 'breakConc',
    'ac', 'acBase', 'acMin', 'saves', 'resist', 'disAgainst', 'advAgainst', 'atkAgainst', 'disFrom', 'sanctuary', 'deathWard', 'advSaves', 'maxHeal', 'agathys', 'weaponDmg', 'immune', 'advSpell', 'weaponHit', 'dupes', 'blink', 'reduce'];
  // put an effect's conditions on a token and remember how they end
  function putOn(sc, t, rule, ctx) {
    const before = { ...t }, immune = immuneTo(t);
    const add = (rule.add || []).filter((c) => !immune.has(c));
    if ((rule.add || []).length && !add.length) return { immune: true };
    if (rule.removes) t.conditions = (t.conditions || []).filter((c) => !rule.removes.includes(c));
    t.conditions = [...new Set([...(t.conditions || []), ...add])];
    const c = sc.combat && sc.combat.active && sc.combat.started ? sc.combat : null, turn = c ? c.turnId : null, src = srcTokenOf(sc, ctx.by);
    const base = { by: ctx.by, spell: ctx.spell, conc: !!ctx.conc, dc: ctx.dc, save: rule.endSave || (rule.save && rule.save.split ? rule.save.split('|')[0] : rule.save) || null };
    for (const f of FIELDS) if (rule[f] != null && rule[f] !== false && rule[f] !== '') base[f] = rule[f];
    if (rule.escape === 'athletics' && !base.escapeDc) base.escapeDc = ctx.dc;
    if (rule.escape === 'grapple' && !base.escapeDc) base.escapeDc = ctx.dc;
    if (rule.sleep) { base.stage = 1; base.then = { add: ['unconscious'], hurt: 'end' }; }
    if (rule.then) { base.stage = rule.stage || 1; base.then = rule.then; }
    if (rule.count) base.cnt = { s: 0, f: 0 };
    if (rule.spell) base.spellish = true;
    // "until the end of its next turn": not this one, if it's its turn now; likewise for the caster's
    if (base.expire === 'tgtEnd' && turn === t.id) base.skip = 1;
    if (base.expire === 'srcEnd' && src && turn === src.id) base.skip = 1;
    if (base.stage === 1 && turn === t.id) base.skip = 1;
    const rounds = rule.rounds || ctx.rounds || 0;
    if (c && rounds && !ctx.conc && rounds < 1000) base.until = c.round + rounds;
    t.marks = [...(t.marks || []).filter((m) => !sameSpell(base)(m)), ...add.map((cd) => ({ c: cd, ...base }))];
    if (!t.marks.length) delete t.marks;
    tokenChanged(sc, t, before);
    return { added: add };
  }
  // take marks off a token, and the conditions only they were holding (prone stays: standing up is the creature's own
  // doing; and when Unconscious ends, the creature is left Prone, by the 2024 rules)
  function liftMarks(t, pick) {
    if (!(t.marks || []).some(pick)) return false;
    const gone = t.marks.filter(pick).map((m) => m.c); t.marks = t.marks.filter((m) => !pick(m));
    const still = new Set(t.marks.map((m) => m.c));
    t.conditions = (t.conditions || []).filter((c) => c === 'prone' || !gone.includes(c) || still.has(c));
    if (gone.includes('unconscious') && !still.has('unconscious') && !(t.conditions || []).includes('unconscious') && t.hp !== 0) t.conditions = [...new Set([...(t.conditions || []), 'prone'])];
    if (!t.marks.length) delete t.marks;
    return true;
  }
  function liftSpell(sc, t, mk, line) {
    const before = { ...t }, after = mk.afterEnd; liftMarks(t, sameSpell(mk)); tokenChanged(sc, t, before);
    if (after) putOn(sc, t, after, { by: mk.by, spell: mk.spell + ' (after)', dc: mk.dc });
    return line;
  }
  // a creature fails a save against something a Legendary Resistance could shrug off: the DM gets the choice
  function offerLegendary(sc, t, spell, by, heal) {
    const m = srdOf(t), tr = m ? FX.traits(m) : null; if (!tr || !tr.legendary) return;
    if (t.lrLeft == null) t.lrLeft = tr.legendary;
    if (t.lrLeft <= 0) return;
    t.lrOffer = { spell, by, heal: heal || 0 };
    toDMs({ type: 'token', sceneId: sc.id, token: t });
    post({ kind: 'chat', who: 'Monsters', to: ['DM'], text: `🛡 ${t.label || '?'} failed its save against ${spell}. It has Legendary Resistance (${t.lrLeft} left): select it and click Use Legendary Resistance to succeed instead.`, time: Date.now(), cast: true });
  }

  // ----- trying again: a save at the end or start of a turn, when hurt, or an action to break free -----
  function retry(sc, t, mk, how) {
    mk = (t.marks || []).find(sameSpell(mk)) || mk;
    const who = t.label || '?', before = { ...t };
    const escaping = how === 'escape' && mk.escape && mk.escape !== 'save';
    let res, what, label;
    if (escaping) { res = checkRoll(t, mk.escape, mk); what = res.what; label = `${mk.spell}: break free`; }
    else { res = saveRoll(sc, t, mk.save || 'WIS', { dc: mk.dc, spell: mk.spellish, add: [mk.c], adv: how === 'adv' }); what = `${res.abl || mk.save} save DC ${mk.dc}${res.mode === 'adv' ? ', Advantage' : res.mode === 'dis' ? ', Disadvantage' : ''}${res.auto ? ', fails automatically' : ''}`; label = `${mk.spell}: ${res.abl || mk.save} save`; }
    if (res.r) showRoll(t, { label: label.slice(0, 30), expr: res.expr, ...res.r });
    const tell = (text) => { tellAbout(sc, t, text); save(); };
    if (mk.cnt) { // three successes or three failures (Contagion, Flesh to Stone)
      const cnt = { ...mk.cnt }; if (res.ok) cnt.s++; else cnt.f++;
      if (cnt.s >= 3) return tell(liftSpell(sc, t, mk, `💪 ${who} shakes off ${mk.spell}: three successes (${what})`)), true;
      if (cnt.f >= 3) {
        t.marks = t.marks.map((m) => (sameSpell(mk)(m) ? { ...m, cnt, end: false, c: mk.count === 'petrified' ? 'petrified' : m.c } : m));
        if (mk.count === 'petrified') t.conditions = [...new Set([...(t.conditions || []).filter((c) => c !== 'restrained'), 'petrified'])];
        tokenChanged(sc, t, before);
        return tell(mk.count === 'petrified' ? `🗿 ${who} turns to stone: three failed saves against ${mk.spell}` : `☠ ${who} fails three saves: ${mk.spell} lasts its full time`), false;
      }
      t.marks = t.marks.map((m) => (sameSpell(mk)(m) ? { ...m, cnt } : m)); tokenChanged(sc, t, before);
      return tell(`${res.ok ? '✔' : '✖'} ${who} ${res.ok ? 'succeeds' : 'fails'} against ${mk.spell} (${cnt.s} successes, ${cnt.f} failures)`), res.ok;
    }
    if (res.ok) return tell(liftSpell(sc, t, mk, `${escaping ? '🪢' : '💪'} ${who} ${escaping ? 'breaks free of' : 'shakes off'} ${mk.spell} (${what})`)), true;
    if (mk.stage === 1 && mk.then) { // the second failed save: asleep, or stone
      const nowAdd = mk.then.add;
      t.marks = t.marks.filter((m) => !sameSpell(mk)(m)).concat(nowAdd.map((c) => ({ ...mk, c, stage: 2, end: false, hurt: mk.then.hurt || undefined, then: undefined, skip: undefined })));
      const keep = new Set(t.marks.map((m) => m.c));
      t.conditions = [...new Set([...(t.conditions || []).filter((c) => keep.has(c) || !(before.marks || []).some((m) => sameSpell(mk)(m) && m.c === c)), ...nowAdd])];
      tokenChanged(sc, t, before);
      return tell(nowAdd.includes('petrified') ? `🗿 ${who} turns to stone (${mk.spell})` : `😴 ${who} falls asleep (${mk.spell}): unconscious until it takes damage or someone shakes it awake`), false;
    }
    if (mk.tick && mk.tick.onFail) { const x = rollDice(mk.tick.dice); const k = takes(t, mk.tick.type), dealt = Math.floor(x.total * k); showRoll(t, { label: `${mk.spell} damage`, expr: mk.tick.dice, ...x }); tell(`🔗 ${who} is still held by ${mk.spell} (${what}) and takes ${dealt}${mk.tick.type ? ' ' + mk.tick.type : ''} damage`); hpTo(sc, t, -dealt); return false; }
    return tell(`🔗 ${who} is still held by ${mk.spell} (${what})`), false;
  }
  // damage at the start or end of a turn (Ensnaring Strike, Yellow Mold, a gelatinous cube's acid), with a save if it has one
  function tickOn(sc, t, mk) {
    const tk = mk.tick; let note = '';
    if (tk.save) { const res = saveRoll(sc, t, tk.save.abl, { dc: tk.save.dc }); if (res.r) showRoll(t, { label: `${mk.spell}: ${tk.save.abl} save`, expr: res.expr, ...res.r }); if (res.ok) return tellAbout(sc, t, `🛡 ${t.label || '?'} avoids ${mk.spell}'s damage this turn`); note = ' (failed save)'; }
    const x = rollDice(tk.dice), k = takes(t, tk.type, !mk.spellish ? false : true), dealt = Math.floor(x.total * k);
    showRoll(t, { label: `${mk.spell} damage`, expr: tk.dice, ...x });
    tellAbout(sc, t, `🔥 ${t.label || '?'} takes ${dealt}${tk.type ? ' ' + tk.type : ''} damage from ${mk.spell}${note}`);
    hpTo(sc, t, -dealt);
  }
  function endOfTurn(sc, t) {
    if (!t) return;
    zonesAtTurn(sc, t, 'end');
    // Blink: a d20 at the end of its turn, 11 or higher and it's in the Ethereal Plane until the start of its next turn
    const bl = (t.marks || []).find((m) => m.blink);
    if (bl) { const x = rollDice('1d20'); showRoll(t, { label: 'Blink', expr: '1d20', ...x }); if (x.total >= 11) { putOn(sc, t, { add: ['blinking'], expire: 'tgtStart' }, { by: bl.by, spell: 'Blink (ethereal)', dc: 0 }); tellAbout(sc, t, `👻 ${t.label || '?'} blinks into the Ethereal Plane (${x.total}) until the start of its next turn`); } else tellAbout(sc, t, `${t.label || '?'} stays put (Blink: ${x.total})`); }
    for (const mk of spellsOn(t)) {
      if (mk.tick && mk.tick.when === 'end' && !mk.tick.onFail) tickOn(sc, t, mk);
      if (mk.end) retry(sc, t, mk);
      else if (mk.stage === 1 && mk.then) { if (mk.skip) { for (const m of t.marks) if (sameSpell(mk)(m)) m.skip = 0; } else retry(sc, t, mk); }
      else if (mk.manual) post({ kind: 'chat', who: 'Monsters', to: isPC(t) ? [t.owner] : ['DM'], text: `❔ ${t.label || '?'} (${mk.spell}): ${mk.manual}. Select the token and click Roll the save if it does.`, time: Date.now(), cast: true });
    }
    // timed effects ending now: its own "until the end of its next turn", and what it put on others "until the end of its next turn"
    const key = keyOf(t);
    for (const mk of spellsOn(t)) if (mk.expire === 'thisTurn') tellAbout(sc, t, liftSpell(sc, t, mk, `⌛ ${mk.spell} ends for ${t.label || '?'}`));
    for (const o of Object.values(sc.tokens)) for (const mk of spellsOn(o)) {
      if (!((o === t && mk.expire === 'tgtEnd') || (mk.by === key && mk.expire === 'srcEnd'))) continue;
      if (mk.skip) { for (const m of o.marks || []) if (sameSpell(mk)(m)) m.skip = 0; continue; } // put on during this very turn: next time
      tellAbout(sc, o, liftSpell(sc, o, mk, `⌛ ${mk.spell} wears off ${o.label || '?'}`));
    }
  }
  function startOfTurn(sc, t) {
    if (!t) return;
    if (t.reactUsed) delete t.reactUsed; // its Reaction comes back
    zonesAtTurn(sc, t, 'start');
    // a monster's turn: its spent Recharge abilities roll to come back, its legendary actions refresh
    const mon = srdOf(t);
    if (mon && t.uses) for (const a of [...(mon.actions || []), ...(mon.bonus || []), ...(mon.reactions || []), ...(mon.traits || []), ...(mon.legendary || [])]) {
      const mt = FX.meta(a, mon), nm = a.n.replace(/\s*\(.*?\)\s*$/, '');
      if (mt.recharge && t.uses[nm] === 'spent') { const x = rollDice('1d6'); const back = x.total >= mt.recharge; if (back) delete t.uses[nm]; post({ kind: 'chat', who: 'Monsters', to: ['DM'], text: `🔋 ${t.label || '?'}'s ${nm}: ${x.total} on the recharge roll${back ? ', ready again' : ', not yet'}`, time: Date.now(), cast: true }); }
    }
    if (mon && (mon.legendary || []).length) t.legLeft = FX.legendaryCount(mon);
    if (mon) toDMs({ type: 'token', sceneId: sc.id, token: t });
    const key = keyOf(t);
    // what this creature put on others "until the start of its next turn" ends; its "at the start of each of its turns" damage happens
    for (const o of Object.values(sc.tokens)) for (const mk of spellsOn(o)) {
      if (mk.by === key && mk.expire === 'srcStart') tellAbout(sc, o, liftSpell(sc, o, mk, `⌛ ${mk.spell} wears off ${o.label || '?'}`));
      else if (mk.by === key && mk.tick && mk.tick.when === 'srcStart') tickOn(sc, o, mk);
    }
    for (const mk of spellsOn(t)) {
      if (mk.expire === 'tgtStart') { tellAbout(sc, t, liftSpell(sc, t, mk, `⌛ ${mk.spell} wears off ${t.label || '?'}`)); continue; }
      if (mk.tick && mk.tick.when === 'start' && !mk.tick.onFail) tickOn(sc, t, mk);
      if (mk.start && (t.marks || []).some(sameSpell(mk))) retry(sc, t, mk);
      if (mk.escape && (t.marks || []).some(sameSpell(mk))) post({ kind: 'chat', who: 'Monsters', to: isPC(t) ? [t.owner, 'DM'] : ['DM'], text: `🕸 ${t.label || '?'} is held by ${mk.spell}: it can use its action to ${mk.escape === 'save' ? 'repeat the save' : 'try to break free'} (${mk.escape === 'grapple' ? 'Athletics or Acrobatics' : mk.escape === 'check' ? (mk.checkAbl === 'DEX' ? 'Dexterity' : 'Strength') + (mk.skill ? ' (' + mk.skill + ')' : '') : mk.escape === 'save' ? (mk.save || '') + ' save' : 'Strength (Athletics)'} DC ${mk.escapeDc || mk.dc}). Select the token and click ${mk.escape === 'save' ? 'Roll the save' : 'Try to break free'}.`, time: Date.now(), cast: true });
      if (mk.temp && mk.c === 'heroism') { hpTo(sc, t, 0, mk.temp); tellAbout(sc, t, `💪 ${t.label || '?'} gains ${mk.temp} temporary hit points (Heroism)`); }
    }
    if (isPC(t) && t.hp === 0 && t.maxHp && !(t.conditions || []).includes('dead') && !(t.death && t.death.stable)) deathSave(sc, t);
  }
  // a new round: effects with a set time (1 minute = 10 rounds) run out; concentration runs out at the spell's duration
  function newRound(sc) {
    const c = sc.combat;
    let gone = 0; for (const [id, z] of Object.entries(sc.zones || {})) if (z.until && c.round > z.until) { delete sc.zones[id]; gone++; }
    if (gone) { sendZones(sc); zoneInside(sc); }
    for (const t of Object.values(sc.tokens)) for (const mk of spellsOn(t)) if (mk.until && c.round > mk.until) tellAbout(sc, t, liftSpell(sc, t, mk, `⌛ ${mk.spell} runs out on ${t.label || '?'}`));
    for (const [k, ch] of Object.entries(state.characters)) if (ch.concOn && ch.concUntil && ch.concScene === sc.id && c.round > ch.concUntil) {
      const { spell, freed } = endConc('p:' + k); post({ kind: 'chat', who: ch.player || k, text: `⌛ ${spell || 'The spell'} runs out${freed.length ? ': it ends for ' + freed.join(', ') : ''}`, time: Date.now(), cast: true });
    }
  }
  // taking damage: Charm Person, Hypnotic Pattern, Sleep, Turn Undead, Knock Out end; Dominate gets a save, Hideous Laughter one with Advantage
  function onHurt(sc, t, dmg) {
    for (const mk of spellsOn(t)) {
      if (mk.hurt === 'end') setImmediate(() => { if ((t.marks || []).some(sameSpell(mk))) { tellAbout(sc, t, liftSpell(sc, t, mk, `💢 The hurt breaks ${mk.spell} on ${t.label || '?'}`)); save(); } });
      else if (mk.hurt === 'save' || mk.hurt === 'adv') setImmediate(() => { if ((t.marks || []).some(sameSpell(mk))) retry(sc, t, mk, mk.hurt === 'adv' ? 'adv' : ''); save(); });
    }
  }
  // death saving throws: at the start of the turn at 0 hit points; 10 or more succeeds; a 1 is two failures; a 20 is back on
  // 1 hit point; three successes and it's stable, three failures and it dies
  function deathSave(sc, t) {
    const res = saveRoll(sc, t, null, {}), d = t.death || { s: 0, f: 0 }, who = t.label || '?', before = { ...t };
    showRoll(t, { label: 'Death saving throw', expr: res.expr, ...res.r });
    if (res.r.crit === 'nat20') { delete t.death; tokenChanged(sc, t, before); hpTo(sc, t, 1); return tellAbout(sc, t, `✨ ${who} rolls a 20 on a death save and is back up with 1 hit point`); }
    if (res.r.crit === 'nat1') d.f += 2; else if (res.total >= 10) d.s++; else d.f++;
    t.death = d;
    if (d.f >= 3) { t.conditions = [...new Set([...(t.conditions || []), 'dead'])]; tokenChanged(sc, t, before); return tellAbout(sc, t, `💀 ${who} fails a third death save and dies`); }
    if (d.s >= 3) { d.stable = true; tokenChanged(sc, t, before); return tellAbout(sc, t, `🩹 ${who} is stable: unconscious, but no more death saves`); }
    tokenChanged(sc, t, before);
    tellAbout(sc, t, `${res.total >= 10 && res.r.crit !== 'nat1' ? '✔' : '✖'} ${who}'s death save: ${res.total}${res.r.crit === 'nat1' ? ' (a 1: two failures)' : ''} · ${d.s} successes, ${d.f} failures`);
  }

  // what the DM's app needs to cast any spell: its options, damage types, darts or rays, and whether it's for friends or self
  let SPELL_INFO = null;
  function spellInfo() {
    if (SPELL_INFO) return SPELL_INFO;
    SPELL_INFO = {};
    try { for (const e of require('../public/spells.json').spells) { const sp = RULES.fromDb(e, { level: 5 }), c = sp.cond || {}; const i = {}; if (c.options) i.options = c.options.map((o) => o.name); if (sp.types) i.types = sp.types; if (sp.multi) i.multi = { n: sp.multi.n, word: sp.multi.word, up: sp.multi.up }; if (c.ally) i.ally = 1; if (c.self || sp.selfOnly) i.self = 1; if (sp.dice || sp.heal || sp.temp || sp.maxUp || sp.cond || sp.multi) i.lands = 1; if (sp.targets && !sp.multi) i.targets = sp.targets; SPELL_INFO[e.name.toLowerCase()] = i; } } catch { /* the table is missing */ }
    return SPELL_INFO;
  }
  // ----- casting a spell on tokens, for a player or a monster (1.17): healing, temporary hit points, revival, darts and
  // rays, spell attacks and saves with every damage part, the type picked (Chromatic Orb), then conditions and protections
  // cast: { caster (token or null), at (slot level), up (levels above), dc, mod (spellcasting modifier), option, raw (target ids with repeats) }
  function castSpell(sc, sp, targets, cast, ctx) {
    const lines = ctx.lines, roll = ctx.roll, who = (t) => t.label || '?', up = cast.up || 0, dc = cast.dc;
    // how many it can target (Bless: three, and one more for each slot level above 1st)
    if (sp.targets && !sp.multi) { const max = sp.targets.n + (sp.targets.up || 0) * up; if (targets.length > max) { lines.push(`ℹ ${sp.name} can target ${max} at this level: ${targets.slice(max).map(who).join(', ')} left out`); targets = targets.slice(0, max); } }
    const hp = (t) => (isPC(t) ? ` (${t.hp}/${t.maxHp ?? '?'}${t.tempHp ? ' +' + t.tempHp + ' temp' : ''})` : t.hp === 0 ? ' (down)' : '');
    let rule = sp.cond ? { ...sp.cond } : null, name = ctx.name;
    if (rule && rule.options) { const o = rule.options[clamp(int(cast.option, 0), 0, rule.options.length - 1)]; rule = { ...rule, ...o, options: undefined }; if (!o.add) rule.add = rule.add || []; }
    // the damage type picked (Chromatic Orb, Dragon's Breath, Spirit Guardians, Protection from Energy)
    const types = sp.types && sp.types.length ? sp.types : null, pick = types ? types[clamp(int(cast.type, 0), 0, types.length - 1)] : '';
    const parts = [{ dice: diceAt(sp.dice, sp.per, up), type: sp.type || '' }, ...(sp.dmgParts || []).map((d) => ({ ...d }))].filter((d) => d.dice).map((d) => (types && (!d.type || types.includes(d.type)) ? { ...d, type: pick } : d));
    if (types && pick) name += ` (${pick})`;
    if (rule && rule.agathys) rule.agathys = 5 * (cast.at || 1);
    if (rule && rule.tempTick) rule.temp = Math.max(1, cast.mod || 0);
    if (rule && rule.weaponDmg && types) rule.weaponDmg = { ...rule.weaponDmg, type: pick || rule.weaponDmg.type };
    const condDone = new Set(), hitIds = new Set(), failIds = new Set();
    const maxDice = (e) => String(e).replace(/(\d*)d(\d+)/g, (_, n, f) => String((+n || 1) * +f)).split(/(?=[+-])/).reduce((a, b) => a + (+b || 0), 0);
    // healing (Beacon of Hope: the most it can be), a pool split between targets (Mass Heal), all of it (Power Word Heal)
    if (sp.heal && targets.length) {
      const expr = diceAt(sp.heal, sp.healPer, up) + (sp.healMod ? sgnS(sp.healMod) : ''), x = /d/.test(expr) ? roll(expr, sp.name + ' healing') : { total: maxDice(expr) };
      let pool = sp.pool ? x.total : 0;
      for (const t of targets) {
        if ((t.conditions || []).includes('dead')) { lines.push(`✖ ${who(t)} is dead: healing can't help`); continue; }
        let amt = spellsOn(t).some((m) => m.maxHeal) ? maxDice(expr) : x.total;
        if (sp.pool) { amt = Math.min(pool, Math.max(0, (t.maxHp || 0) - (t.hp || 0))); pool -= amt; }
        hpTo(sc, t, amt); lines.push(`💚 ${who(t)} regains ${amt} hit points${hp(t)}`);
      }
    }
    if (rule && rule.healFull) for (const t of targets) { const b = { ...t }; t.conditions = (t.conditions || []).filter((c) => !(rule.removes || []).includes(c)); tokenChanged(sc, t, b); hpTo(sc, t, Math.max(1, (t.maxHp || 0) - (t.hp || 0))); lines.push(`💚 ${who(t)} regains all its hit points${hp(t)}`); }
    if (rule && rule.revive) for (const t of targets) {
      if (!(t.conditions || []).includes('dead') && t.hp !== 0) { lines.push(`✖ ${who(t)} isn't dead`); continue; }
      const b = { ...t }; t.conditions = (t.conditions || []).filter((c) => c !== 'dead' && c !== 'unconscious'); delete t.death; t.hp = rule.revive === 'full' ? t.maxHp || 1 : 1; tokenChanged(sc, t, b);
      lines.push(`✨ ${who(t)} comes back to life with ${t.hp} hit point${t.hp === 1 ? '' : 's'}`);
    }
    // ending conditions (Lesser and Greater Restoration, Remove Curse, Freedom of Movement…), stabilising, dispelling
    if (rule && rule.cure) for (const t of targets) {
      const b = { ...t }, cures = rule.cures || [], had = (t.conditions || []).filter((c) => cures.includes(c));
      liftMarks(t, (m) => cures.includes(m.c)); t.conditions = (t.conditions || []).filter((c) => !cures.includes(c));
      if (rule.exhaustion && (t.conditions || []).includes('exhaustion')) { t.exhaustion = (t.exhaustion || 1) - 1; if (t.exhaustion < 1) { delete t.exhaustion; t.conditions = t.conditions.filter((c) => c !== 'exhaustion'); } had.push('one Exhaustion level'); }
      tokenChanged(sc, t, b); lines.push(had.length ? `✨ ${who(t)}: no longer ${had.map(condName).join(' or ')}` : `✨ ${who(t)}: nothing to end`);
    }
    if (rule && rule.stabilize) for (const t of targets) { if (t.hp !== 0 || (t.conditions || []).includes('dead')) { lines.push(`✖ ${who(t)} isn't dying`); continue; } const b = { ...t }; t.death = { ...(t.death || { s: 0, f: 0 }), stable: true }; tokenChanged(sc, t, b); lines.push(`🩹 ${who(t)} is stable`); }
    if (rule && rule.dispel) for (const t of targets) {
      const spells = spellsOn(t).filter((m) => m.spellish || /^p:|^t:/.test(m.by)).map((m) => m.spell);
      const b = { ...t }; liftMarks(t, (m) => spells.includes(m.spell)); if ((t.conditions || []).includes('concentrating') && !isPC(t)) { tokenChanged(sc, t, b); endConc(keyOf(t)); } else tokenChanged(sc, t, b);
      lines.push(spells.length ? `✨ ${who(t)}: ${[...new Set(spells)].join(', ')} ended (a spell of 4th level or higher needs the caster's ability check against DC 10 + its level: the DM decides)` : `✨ ${who(t)}: no spells to end`);
    }
    if (rule && rule.maxUpDice) { const x = roll(rule.maxUpDice, sp.name + ' hit points'); for (const t of targets) { const b = { ...t }; t.maxHp = (t.maxHp || 0) + x.total; t.hp = (t.hp ?? 0) + x.total; tokenChanged(sc, t, b); lines.push(`💪 ${who(t)}: hit point maximum up by ${x.total}${hp(t)}`); } }
    if (sp.maxUp && targets.length) {
      const add = sp.maxUp + 5 * up;
      for (const t of targets) { const before = { ...t }; t.maxHp = (t.maxHp || 0) + add; t.hp = (t.hp ?? 0) + add; tokenChanged(sc, t, before); lines.push(`💪 ${who(t)}: hit point maximum up by ${add}${hp(t)}`); }
    }
    if (sp.temp && targets.length) {
      const base = sp.temp.replace(/\s/g, ''), x = /d/.test(base) ? roll(base, sp.name + ' temp HP') : { total: +base || 0 }, amt = x.total + (sp.tempPer || 0) * up;
      for (const t of targets) { hpTo(sc, t, 0, amt); lines.push(`🛡 ${who(t)} gains ${amt} temporary hit points`); }
    }
    // Power Word Kill: 100 hit points or fewer and it dies; otherwise 12d12 psychic
    if (rule && rule.pwk) {
      for (const t of targets) {
        if ((t.hp ?? 999) <= rule.pwk) { const b = { ...t }; t.hp = 0; t.conditions = [...new Set([...(t.conditions || []), 'dead'])]; tokenChanged(sc, t, b); lines.push(`☠ ${who(t)} dies`); }
        else { const x = roll('12d12', sp.name + ' damage'); hpTo(sc, t, -x.total); lines.push(`💥 ${who(t)}: ${x.total} psychic damage${hp(t)}`); }
      }
      return;
    }
    const caster = cast.caster;
    if (sp.multi && targets.length) { // darts, rays or beams: each picks its own target
      const M = sp.multi, total = M.n + (sp.level > 0 ? M.up * up : 0), per = new Map();
      for (const id of cast.raw || targets.map((t) => t.id)) if ([...per.values()].reduce((a, b) => a + b, 0) < total && sc.tokens[id]) per.set(id, (per.get(id) || 0) + 1);
      const times = (d, k) => d.replace(/(\d*)d(\d+)/g, (_, n, f) => (k * (+n || 1)) + 'd' + f).replace(/\+(\d+)$/, (_, c) => '+' + k * c);
      const mtype = pick || M.type;
      for (const [id, k] of per) {
        const t = sc.tokens[id]; let amount = 0, hits = 0, crits = 0;
        if (sp.attack) for (let i = 0; i < k; i++) {
          const a = attackRoll(sc, caster, t, sp.attack, { melee: false });
          if (a.blocked || a.duplicate) { lines.push(missWhy(a, who(t))); if (a.blocked) break; continue; }
          ctx.atk(`${sp.name} ${M.word} → ${who(t)}`, a);
          if (a.hit) { hits++; if (a.crit) crits++; amount += roll(a.crit ? doubleDice(M.dice) : M.dice, sp.name + ' damage').total; }
        } else { hits = k; amount = roll(times(M.dice, k), `${sp.name} → ${who(t)}`).total; }
        if (!hits) { lines.push(`💨 ${who(t)}: ${k > 1 ? `all ${k} ${M.word}s miss` : 'miss'}`); continue; }
        const kk = takes(t, mtype), dealt = Math.floor(amount * kk);
        hpTo(sc, t, -dealt);
        lines.push(`💥 ${who(t)}: ${sp.attack ? `${hits} of ${k} ${M.word}${k > 1 ? 's' : ''} hit${crits ? ' (critical!)' : ''}` : `${k} ${M.word}${k > 1 ? 's' : ''}`}, ${dealt} ${mtype} damage${kk === 0 ? ' (immune)' : kk === 0.5 ? ' (resists)' : kk === 2 ? ' (vulnerable)' : ''}${hp(t)}`);
      }
    } else if (parts.length && targets.length && !(rule && (rule.ally || rule.healFull))) {
      const saveAbl = sp.save ? ((/\b(STR|DEX|CON|INT|WIS|CHA)\b/i.exec(sp.save) || [])[1] || '').toUpperCase() : '';
      for (const t of targets) {
        if (sp.attack) { // a spell attack, with everything that changes it; a critical hit doubles the dice
          const a = attackRoll(sc, caster, t, sp.attack, { melee: /melee/i.test(sp.attackKind || '') || /touch|self/i.test(sp.range || '') });
          if (a.blocked || a.duplicate) { lines.push(missWhy(a, who(t))); continue; }
          ctx.atk(`${sp.name} → ${who(t)}`, a);
          if (!a.hit) { lines.push(`💨 ${who(t)}: miss (${a.total} vs AC ${a.ac}${a.mode ? ', ' + (a.mode === 'adv' ? 'Advantage' : 'Disadvantage') : ''})`); continue; }
          hitIds.add(t.id); let dealt = 0; const bits = [];
          for (const d of parts) { const x = roll(a.crit ? doubleDice(d.dice) : d.dice, sp.name + ' damage'), k = takes(t, d.type), n = reduceBy(sc, t, Math.floor(x.total * k), d.type); dealt += n; bits.push(`${n} ${d.type}${k === 0 ? ' (immune)' : k === 0.5 ? ' (resists)' : k === 2 ? ' (vulnerable)' : ''}`); }
          hpTo(sc, t, -dealt);
          lines.push(`💥 ${who(t)}: ${a.crit ? 'critical hit! ' : `hit (${a.total} vs AC ${a.ac}) `}${bits.join(' + ')} damage${hp(t)}${retaliate(sc, caster, t, false)}`);
          if (rule && rule.drain && caster) { const back = Math.floor(dealt * rule.drain); hpTo(sc, caster, back); lines.push(`🩸 ${who(caster)} regains ${back} hit points`); }
        } else if (saveAbl) { // a save for everyone, the damage rolled once, and the spell's conditions on the same save
          const same = rule && !rule.ally && !rule.reaction && (!rule.save || rule.save === saveAbl) && (rule.add || []).length;
          for (const d of parts) ctx.shared[d.dice + d.type] = ctx.shared[d.dice + d.type] || roll(d.dice, sp.name + ' damage');
          const res = landOn(sc, t, { save: { abl: saveAbl, dc }, fail: parts, half: sp.half, ...(same ? { ...rule, save: { abl: saveAbl, dc } } : {}), spell: true }, ctx);
          if (res && !res.ok) failIds.add(t.id);
          if (same) condDone.add(t.id);
        } else { // no attack, no save: it just hits (Divine Smite, Power Word…)
          let dealt = 0; const bits = [];
          // Divine Smite: another 1d8 against a fiend or undead
          const mt = srdOf(t), vs = rule && rule.vsTypes && mt && rule.vsTypes.types.some((ty) => new RegExp(ty, 'i').test(mt.type || '')) ? [{ dice: rule.vsTypes.dice, type: parts[0].type }] : [];
          for (const d of [...parts, ...vs]) { const x = ctx.shared[d.dice + d.type] = ctx.shared[d.dice + d.type] || roll(d.dice, sp.name + ' damage'), k = takes(t, d.type), n = Math.floor(x.total * k); dealt += n; bits.push(`${n} ${d.type}`); }
          hpTo(sc, t, -dealt); hitIds.add(t.id); lines.push(`💥 ${who(t)}: ${bits.join(' + ')} damage${hp(t)}`);
        }
      }
    }
    // conditions and protections: Hold Person, Bless, Shield, Stoneskin, Faerie Fire…
    if (cast.first) startZone(sc, sp, cast, ctx, parts, rule, targets);
    if (cast.first) { summonFrom(sc, sp, cast, ctx); moveFrom(sc, sp, cast, ctx, targets, parts, failIds, hitIds); }
    // a save with no damage or condition, just an outcome (Counterspell: the other caster's spell fails)
    if (rule && rule.saveOnly && rule.save) for (const t of targets) { const r = saveRoll(sc, t, rule.save, { dc, spell: true }); if (r.r) showRoll(t, { label: `${sp.name}: ${rule.save} save`, expr: r.expr, ...r.r }); lines.push(r.ok ? `🛡 ${who(t)} saves against ${sp.name}` : `✖ ${who(t)} fails the save: ${rule.saveOnly}`); }
    if (rule && targets.length && !(rule.reaction && cast.first) && ((rule.add || []).length || rule.divine || rule.hpCap)) {
      for (const t of targets) {
        if (condDone.has(t.id)) continue;
        if (t.hp === 0 && !isPC(t)) continue; // already down
        if ((sp.attack || rule.onHit) && parts.length && !hitIds.has(t.id)) continue; // Ray of Sickness, Guiding Bolt: only on a hit
        if (rule.onFail && !failIds.has(t.id)) continue;
        landOn(sc, t, { ...rule, save: rule.save && !sp.attack ? { abl: rule.save, dc } : null, spell: true }, ctx);
      }
    }
  }
  // ----- areas that keep working: a creature entering, starting or ending its turn there (1.18) -----
  const tplL = (t) => t.size / 5;
  function tplHas(t, px, py) { // the same shapes the map draws
    const dx = px - t.x, dy = py - t.y, e = 1e-6;
    if (t.shape === 'sphere' || t.shape === 'cylinder') return dx * dx + dy * dy <= tplL(t) * tplL(t) + e;
    if (t.shape === 'cube') { const sx = Math.cos(t.angle) >= -1e-9 ? 1 : -1, sy = Math.sin(t.angle) >= -1e-9 ? 1 : -1; return dx * sx >= -e && dx * sx <= tplL(t) + e && dy * sy >= -e && dy * sy <= tplL(t) + e; }
    const c = Math.cos(t.angle), sn = Math.sin(t.angle), along = dx * c + dy * sn, perp = Math.abs(-dx * sn + dy * c);
    if (along < -e || along > tplL(t) + e) return false;
    if (t.shape === 'cone') return perp <= along / 2 + e;
    if (t.shape === 'line') return perp <= (t.width || 5) / 10 + e;
    return perp <= tplL(t) / 2 + e;
  }
  function zoneShape(sc, z) {
    if (z.follow) { const c = sc.tokens[z.follow]; return c ? { shape: 'sphere', x: c.x + c.size / 2, y: c.y + c.size / 2, size: z.radius + 2.5 * c.size, angle: 0 } : null; }
    return (sc.templates || {})[z.tpl] || null;
  }
  // is any square of this token inside the area (at this position)?
  function inZone(sc, z, t, pos) {
    const s = zoneShape(sc, z); if (!s) return false;
    const x0 = pos ? pos.x : t.x, y0 = pos ? pos.y : t.y;
    if (z.follow === t.id) return false; // the caster itself
    for (let y = y0; y < y0 + t.size; y++) for (let x = x0; x < x0 + t.size; x++) if (tplHas(s, x + 0.5, y + 0.5)) return true;
    return false;
  }
  const turnKey = (sc) => (sc.combat && sc.combat.active && sc.combat.started ? `${sc.combat.round}:${sc.combat.turnId}` : 'ooc:' + Math.floor(Date.now() / 6000));
  // the area does its thing to a creature (once a turn for each creature)
  function zoneHit(sc, z, t, when, extra) {
    const eff = z.on && z.on[when]; if (!eff || !t || (t.conditions || []).includes('dead')) return;
    if (z.others && isPC(t) === z.pcSide) return; // Spirit Guardians: the caster's foes only
    const k = turnKey(sc); z.hits = z.hits || {}; if (z.hits[t.id] === k && when !== 'move') return; z.hits[t.id] = k;
    const lines = [], ctx = { by: z.by, spell: true, conc: z.conc, dc: z.dc, name: z.spell, shared: {}, lines, roll: (e, l) => { const r = rollDice(e); post({ who: z.who || 'Monsters', ...(z.pc ? {} : { to: ['DM'] }), label: str(l, 30), expr: e, ...r, private: false, time: Date.now(), skin: z.pc ? skinOf(z.who) : null }); return r; } };
    const verb = when === 'enter' ? 'moves into' : when === 'start' ? 'starts its turn in' : when === 'end' ? 'ends its turn in' : 'moves through';
    if (when === 'move') { // Spike Growth: damage for every 5 feet moved there
      const n = extra || 1, x = ctx.roll(eff.dice.replace(/^(\d+)/, (_, a) => String(+a * n)), z.spell + ' damage'), k2 = takes(t, eff.type), dealt = Math.floor(x.total * k2);
      hpTo(sc, t, -dealt); lines.push(`💥 ${t.label || '?'}: ${dealt} ${eff.type} damage`);
    } else landOn(sc, t, { ...eff, spell: true }, ctx);
    const vis = t.hidden ? { to: ['DM'] } : {};
    post({ kind: 'chat', who: z.who || 'Monsters', ...vis, text: (`🌀 ${t.label || '?'} ${verb} ${z.spell}\n` + lines.join('\n')).slice(0, 1200), time: Date.now(), cast: true });
  }
  // conditions only while inside (Silence: deafened, Hunger of Hadar: blinded)
  function zoneInside(sc) {
    for (const t of Object.values(sc.tokens)) {
      const want = new Map();
      for (const z of Object.values(sc.zones || {})) if (z.inside && inZone(sc, z, t)) for (const c of z.inside) want.set(c + '|' + z.id, { c, z });
      const have = (t.marks || []).filter((m) => m.zone);
      const before = { ...t }; let changed = false;
      for (const m of have) if (!want.has(m.c + '|' + m.zone)) { liftMarks(t, (x) => x.zone === m.zone && x.c === m.c); changed = true; }
      for (const [k, { c, z }] of want) if (!have.some((m) => m.c + '|' + m.zone === k)) { t.marks = [...(t.marks || []), { c, by: z.by, spell: z.spell, zone: z.id, conc: z.conc }]; t.conditions = [...new Set([...(t.conditions || []), c])]; changed = true; }
      if (changed) tokenChanged(sc, t, before);
    }
  }
  // a token moved (or an area moved): who just came into which area
  function zonesAfterMove(sc, moved, from) {
    if (!sc.zones || !Object.keys(sc.zones).length) return;
    for (const z of Object.values(sc.zones)) {
      const followMoved = z.follow && moved && z.follow === moved.id;
      if (followMoved) { // the area moved into creatures' spaces
        const old = sc.tokens[z.follow], cur = { x: old.x, y: old.y };
        old.x = from.x; old.y = from.y; const was = new Set(Object.values(sc.tokens).filter((t) => inZone(sc, z, t)).map((t) => t.id)); old.x = cur.x; old.y = cur.y;
        for (const t of Object.values(sc.tokens)) if (!was.has(t.id) && inZone(sc, z, t)) zoneHit(sc, z, t, 'enter');
      } else if (moved && from) {
        const was = inZone(sc, z, moved, from), now = inZone(sc, z, moved);
        if (now && !was && z.on.enter) zoneHit(sc, z, moved, 'enter');
        if (now && z.on.move) zoneHit(sc, z, moved, 'move', Math.max(1, Math.max(Math.abs(moved.x - from.x), Math.abs(moved.y - from.y))));
      }
    }
    zoneInside(sc);
  }
  // an area's template moved or changed shape
  function zonesAfterTemplate(sc, tplId, before) {
    for (const z of Object.values(sc.zones || {})) if (z.tpl === tplId && before) {
      const cur = sc.templates[tplId]; sc.templates[tplId] = before; const was = new Set(Object.values(sc.tokens).filter((t) => inZone(sc, z, t)).map((t) => t.id)); sc.templates[tplId] = cur;
      for (const t of Object.values(sc.tokens)) if (!was.has(t.id) && inZone(sc, z, t)) zoneHit(sc, z, t, 'enter');
    }
    zoneInside(sc);
  }
  function zonesAtTurn(sc, t, when) { for (const z of Object.values(sc.zones || {})) if (z.on[when] && inZone(sc, z, t)) zoneHit(sc, z, t, when); }
  const sendZones = (sc) => toScene(sc.id, { type: 'zones', sceneId: sc.id, zones: sc.zones || {} });
  function endZones(key) {
    for (const scn of Object.values(state.scenes)) {
      let n = 0; for (const [id, z] of Object.entries(scn.zones || {})) if (z.by === key && z.conc) { delete scn.zones[id]; n++; }
      if (n) { for (const t of Object.values(scn.tokens)) { const b = { ...t }; if (liftMarks(t, (m) => m.zone && !scn.zones[m.zone])) tokenChanged(scn, t, b); } sendZones(scn); }
    }
  }
  // a spell with a lasting area is cast: remember the area (its template, or the caster for Spirit Guardians)
  function startZone(sc, sp, cast, ctx, parts, rule, targets) {
    const Z = RULES.ZONES[sp.name.toLowerCase()]; if (!Z) return;
    const caster = cast.caster, tpl = Z.follow ? null : Object.values(sc.templates || {}).filter((t) => (cast.tplOwner ? t.owner === cast.tplOwner : !t.owner)).pop();
    if (!Z.follow && !tpl) { ctx.lines.push(`ℹ Place ${sp.name}'s area on the map (◎ Area) before casting, and it will hit creatures that move into it or stay there`); return; }
    if (Z.follow && !caster) return;
    const saveAbl = sp.save ? ((/\b(STR|DEX|CON|INT|WIS|CHA)\b/i.exec(sp.save) || [])[1] || '') : '';
    const fromSpell = { save: saveAbl ? { abl: saveAbl, dc: cast.dc } : null, fail: parts, half: !!sp.half, ...(rule && (rule.add || []).length && !rule.ally ? { ...rule, save: saveAbl || rule.save ? { abl: saveAbl || rule.save, dc: cast.dc } : null } : {}) };
    const own = (x) => (x === 'spell' ? fromSpell : x === 'nosave' ? { save: null, fail: parts } : x ? { save: x.save ? { abl: x.save, dc: cast.dc } : null, fail: x.dmg || [], half: false } : null);
    const id = uid(), c = sc.combat && sc.combat.active ? sc.combat : null;
    const z = { id, spell: sp.name, by: ctx.by, who: cast.who || '', pc: ctx.by.startsWith('p:'), pcSide: caster ? isPC(caster) : ctx.by.startsWith('p:'), conc: !!sp.conc, dc: cast.dc, tpl: tpl ? tpl.id : null, follow: Z.follow && caster ? caster.id : null, radius: Z.follow || 0,
      others: !!Z.others, inside: Z.inside || null, on: { enter: own(Z.enter), start: own(Z.start), end: own(Z.end), move: Z.move || null }, until: c && sp.duration ? c.round + (RULES.roundsOf(sp.duration) || 0) : null, hits: {} };
    const k = turnKey(sc); for (const t of targets) z.hits[t.id] = k; // what the casting itself hit isn't hit again this turn
    sc.zones = sc.zones || {}; sc.zones[id] = z; sendZones(sc); zoneInside(sc);
    ctx.lines.push(`🌀 ${sp.name} stays: creatures that move into it${Z.start ? ' or start their turn there' : Z.end ? ' or end their turn there' : ''} are hit`);
  }
  // ----- 1.19: summons on the map, teleports and pushes -----
  const wallAt = (sc, x, y) => { const k = sc.tiles && sc.tiles[x + ',' + y]; return k === 'wall' || k === 'void'; };
  const freeAt = (sc, x, y, n, skip) => {
    for (let j = y; j < y + n; j++) for (let i = x; i < x + n; i++) if (i < 0 || j < 0 || i >= sc.cols || j >= sc.rows || wallAt(sc, i, j)) return false;
    return !Object.values(sc.tokens).some((t) => t !== skip && !(skip && Array.isArray(skip) && skip.includes(t)) && t.x < x + n && x < t.x + t.size && t.y < y + n && y < t.y + t.size);
  };
  // the nearest free space around a point, rings outward
  function freeNear(sc, cx, cy, n, skip) {
    for (let d = 0; d < 12; d++) for (let y = cy - d; y <= cy + d; y++) for (let x = cx - d; x <= cx + d; x++) if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) === d && freeAt(sc, x, y, n, skip)) return [x, y];
    return null;
  }
  const entryFor = (t) => (t.sum && t.sum.init === 'share' && t.sum.casterId ? { id: t.id, init: null, after: t.sum.casterId } : { id: t.id, init: null });
  // a summon made during a fight joins the initiative: right after its caster, or with its own roll (a familiar, the undead)
  function summonToInit(sc, t) {
    const c = sc.combat; if (!c || !c.active || !t.sum || !t.sum.init || c.entries.some((e) => e.id === t.id)) return;
    const e = entryFor(t);
    if (!e.after || !c.entries.some((x) => x.id === e.after)) {
      delete e.after; const b = t.initBonus || 0, r = rollDice('1d20' + (b ? sgnS(b) : '')); e.init = r.total;
      const mine = !!t.owner; post({ who: mine ? t.owner : 'DM', label: str(`${t.label} · Initiative`, 30), expr: r.expr || '1d20' + (b ? sgnS(b) : ''), ...r, private: !mine, ...(mine ? {} : { to: ['DM'] }), time: Date.now(), skin: mine ? skinOf(t.owner) : null });
    }
    c.entries.push(e); sortCombat(sc); sendCombat(sc);
  }
  // a spell that puts creatures or things on the map: next to the caster, owned by the caster's player (who moves them)
  function summonFrom(sc, sp, cast, ctx) {
    const S = SUMS.SUMMONS[sp.name.toLowerCase().replace(/[’]/g, "'")], caster = cast.caster; if (!S || !caster) return;
    const f = S.forms[clamp(int(cast.option, 0), 0, S.forms.length - 1)], L = cast.at || sp.level || 1, mod = cast.mod || 0;
    const n = clamp(S.n ? S.n(L, mod) : 1, 1, 10), owner = isPC(caster) ? caster.owner : '', made = [];
    for (let i = 0; i < n; i++) {
      if (Object.keys(sc.tokens).length >= 500) break;
      const mon = f.srd ? srdOf({ srd: f.srd }) : null, size = mon ? mon.token.size : S.size || 1;
      const at = freeNear(sc, caster.x + caster.size, caster.y, size); if (!at) { ctx.lines.push(`ℹ No room for ${S.label} near ${caster.label || '?'}`); break; }
      const hp = mon ? mon.hp : S.object ? null : (f.hp || S.hp || (() => 10))(L, mod, caster.maxHp);
      const label = `${mon ? mon.name : S.label + (S.forms.length > 1 && !f.srd ? ' (' + f.name + ')' : '')}${n > 1 ? ' ' + (i + 1) : ''}`;
      const id = uid(), atk = cast.atk != null ? cast.atk : 5;
      const attacks = mon ? [] : (f.attacks || []).map((a) => ({ name: a.name, dice: a.dice(L, mod), type: a.type, melee: !!a.melee, reach: a.reach || 5, range: a.range || 0, extra: a.extra || null }));
      sc.tokens[id] = { id, ...tokenFields({ label: label.slice(0, 24), icon: mon ? mon.token.icon : S.icon || 'ghost', color: mon ? mon.token.color : S.color || '#7dd3fc', size, owner, x: at[0], y: at[1], hp, maxHp: hp, ac: mon ? mon.ac : S.object ? null : (f.ac || S.ac || (() => 10))(L, mod), srd: mon ? mon.id : null, light: S.light || undefined }, sc) };
      sc.tokens[id].initBonus = mon ? mon.token.init : caster.initBonus || 0;
      sc.tokens[id].sum = { casterId: caster.id, init: S.init || null, by: ctx.by, spell: sp.name, conc: !!sp.conc && !S.keep, keep: !!S.keep, owner, attack: atk, attacks, multi: S.multi ? Math.max(1, S.multi(L)) : 1 };
      tokenChanged(sc, sc.tokens[id], null); made.push(sc.tokens[id]); summonToInit(sc, sc.tokens[id]);
      if (S.zone) startPackZone(sc, sp, sc.tokens[id], S.zone, f, L, cast, ctx);
    }
    if (made.length) ctx.lines.push(`✨ ${made.length > 1 ? made.length + ' × ' + made[0].label.replace(/ \d+$/, '') : made[0].label} appear${made.length > 1 ? '' : 's'} next to ${caster.label || '?'}${owner ? ' (drag to move; its attacks are under My character)' : ''}${made[0].sum.attacks.length && made[0].sum.multi > 1 ? ` · ${made[0].sum.multi} attacks a turn` : ''}`);
    if (visionOn(sc)) scheduleVision(sc);
  }
  // Conjure Animals' pack, Conjure Elemental's spirit: an area around the token that moves with it
  function startPackZone(sc, sp, tok, Z, f, L, cast, ctx) {
    const id = uid(), dmg = Z.dmg ? [Z.dmg(L, f)] : [], hit = { save: Z.save ? { abl: Z.save, dc: cast.dc } : null, fail: dmg, half: !!(Z.save && !Z.add), ...(Z.add ? { add: Z.add, save: { abl: Z.save, dc: cast.dc } } : {}) };
    sc.zones = sc.zones || {};
    sc.zones[id] = { id, spell: sp.name, by: ctx.by, who: cast.who || '', pc: ctx.by.startsWith('p:'), pcSide: cast.caster ? isPC(cast.caster) : false, conc: !!sp.conc, dc: cast.dc, tpl: null, follow: tok.id, radius: Z.radius, others: true, inside: null,
      on: { enter: hit, start: Z.start ? hit : null, end: Z.start ? null : hit, move: null }, until: null, hits: {} };
    sendZones(sc);
  }
  function removeSummon(sc, t, why) {
    if (!sc.tokens[t.id]) return;
    delete sc.tokens[t.id]; toScene(sc.id, { type: 'removeToken', sceneId: sc.id, id: t.id });
    for (const [zid, z] of Object.entries(sc.zones || {})) if (z.follow === t.id) delete sc.zones[zid];
    sendZones(sc);
    if (sc.combat && sc.combat.entries.some((e) => e.id === t.id)) { sortCombat(sc); sendCombat(sc); }
    if (why) post({ kind: 'chat', who: 'Monsters', ...(t.sum && t.sum.owner ? {} : { to: ['DM'] }), text: `✨ ${t.label || '?'} ${why}`, time: Date.now(), cast: true });
    save();
  }
  // concentration ends: the spirits it called go
  function endSummons(key) {
    for (const scn of Object.values(state.scenes)) for (const t of Object.values(scn.tokens)) if (t.sum && t.sum.by === key && t.sum.conc) removeSummon(scn, t, 'fades away (the spell ended)');
  }
  // teleports wait for a click on the map; pushes happen at once
  const pendingMoves = new Map();
  function moveFrom(sc, sp, cast, ctx, targets, parts, failIds, hitIds) {
    const key = sp.name.toLowerCase().replace(/[’]/g, "'"), T = SUMS.TELEPORTS[key], P = SUMS.PUSHES[key], caster = cast.caster;
    if (T && caster) {
      const ids = T.targets ? targets.map((t) => t.id) : [caster.id];
      if (T.bring) { const mate = targets.find((t) => t !== caster && sqDist(t, caster) <= 1); if (mate) ids.push(mate.id); }
      if (!ids.length) return;
      const id = uid(), to = cast.ws ? cast.ws.user : null;
      pendingMoves.set(id, { sceneId: sc.id, ids, from: { x: caster.x, y: caster.y }, sq: T.feet ? T.feet / 5 : 0, near: T.nearTarget ? targets.map((t) => t.id) : null, who: to ? (to.isDM ? 'dm' : to.name.toLowerCase()) : 'dm', spell: sp.name });
      setTimeout(() => pendingMoves.delete(id), 120000);
      if (cast.ws) send(cast.ws, { type: 'pickCell', id, title: `${sp.name}: click where ${sc.tokens[ids[0]].label || '?'} appears${T.feet ? ` (up to ${T.feet} ft)` : T.nearTarget ? ' (next to a target)' : ''}`, from: { x: caster.x, y: caster.y }, range: T.feet || 0, size: caster.size });
      return;
    }
    if (P && caster) {
      const saveAbl = sp.save ? ((/\b(STR|DEX|CON|INT|WIS|CHA)\b/i.exec(sp.save) || [])[1] || '').toUpperCase() : '';
      for (const t of targets) {
        let go = P.onHit ? hitIds.has(t.id) : failIds.has(t.id);
        if (P.onFail && !parts.length && saveAbl) { const r = saveRoll(sc, t, saveAbl, { dc: cast.dc, spell: true }); showRoll(t, { label: `${sp.name}: ${saveAbl} save`, expr: r.expr, ...r.r }); go = !r.ok; if (r.ok) ctx.lines.push(`🛡 ${t.label || '?'} holds its ground`); }
        if (!go || t.size > 2) continue;
        const moved = pushAway(sc, caster, t, P.feet / 5);
        if (moved) ctx.lines.push(`💨 ${t.label || '?'} is ${P.feet < 0 ? 'pulled' : 'pushed'} ${moved * 5} feet`);
      }
    }
  }
  // push (or pull, with a negative number of squares) a creature straight away from a point, stopping at walls and creatures
  function pushAway(sc, from, t, squares) {
    const fx = from.x + from.size / 2, fy = from.y + from.size / 2, tx = t.x + t.size / 2, ty = t.y + t.size / 2;
    let dx = Math.sign(Math.round(tx - fx)), dy = Math.sign(Math.round(ty - fy)); if (!dx && !dy) dx = 1;
    if (squares < 0) { dx = -dx; dy = -dy; }
    const b = { ...t }; let n = 0;
    for (let i = 0; i < Math.abs(squares); i++) {
      if (squares < 0 && sqDist(from, { ...t, x: t.x + dx, y: t.y + dy }) < 1) break; // pulled right up to it
      if (!freeAt(sc, t.x + dx, t.y + dy, t.size, t)) break;
      t.x += dx; t.y += dy; n++;
    }
    if (n) { tokenChanged(sc, t, b); zonesAfterMove(sc, t, b); grappleAfterMove(sc, t, b, true); }
    return n;
  }
  // ----- 1.18: items the DM makes and gives to players -----
  //  kind: weapon · armor · shield · potion · scroll · wand (a spell with charges) · wondrous (an effect with a save, or
  //  bonuses while worn) · gear. Each player's are kept apart from their D&D Beyond sheet, so bringing it in again keeps them.
  const ITEM_KINDS = ['weapon', 'armor', 'shield', 'potion', 'scroll', 'wand', 'wondrous', 'gear'];
  const TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];
  const DICE = /^(\d{1,2}d\d{1,3}([+-]\d{1,3})?|\d{1,3})$/;
  function itemFields(m) {
    const it = { name: str(m.name, 40).trim() || 'Item', kind: ITEM_KINDS.includes(m.kind) ? m.kind : 'gear', desc: str(m.desc, 1500), rarity: str(m.rarity, 20), value: str(m.value, 20), attune: !!m.attune };
    const dice = (v) => (DICE.test(String(v || '').replace(/\s/g, '')) ? String(v).replace(/\s/g, '') : '');
    if (it.kind === 'weapon') it.weapon = { dice: dice(m.weapon && m.weapon.dice) || '1d6', type: TYPES.includes(m.weapon && m.weapon.type) ? m.weapon.type : 'slashing', bonus: clamp(int(m.weapon && m.weapon.bonus, 0), 0, 3), ability: ['STR', 'DEX', 'finesse', 'spell'].includes(m.weapon && m.weapon.ability) ? m.weapon.ability : 'STR',
      range: /^\d{1,3}\/\d{1,4}$/.test(String(m.weapon && m.weapon.range || '')) ? m.weapon.range : '', reach: clamp(int(m.weapon && m.weapon.reach, 5), 5, 15), extra: m.weapon && dice(m.weapon.extraDice) ? { dice: dice(m.weapon.extraDice), type: TYPES.includes(m.weapon.extraType) ? m.weapon.extraType : 'fire' } : null, mastery: str(m.weapon && m.weapon.mastery, 10) };
    if (it.kind === 'armor' || it.kind === 'shield') it.armor = { base: clamp(int(m.armor && m.armor.base, it.kind === 'shield' ? 2 : 11), 0, 20), dexMax: m.armor && m.armor.dexMax === '' ? null : clamp(int(m.armor && m.armor.dexMax, 99), 0, 99), bonus: clamp(int(m.armor && m.armor.bonus, 0), 0, 3) };
    if (it.kind === 'potion') it.potion = { heal: dice(m.potion && m.potion.heal), temp: dice(m.potion && m.potion.temp), cures: (Array.isArray(m.potion && m.potion.cures) ? m.potion.cures : []).filter((c) => CONDITIONS.has(c)).slice(0, 6), resist: TYPES.includes(m.potion && m.potion.resist) ? m.potion.resist : '' };
    if (it.kind === 'scroll' || it.kind === 'wand') { const e = RULES.dbSpell(m.spell && m.spell.name); it.spell = e ? { name: e.name, level: clamp(int(m.spell.level, e.level), e.level, 9), dc: m.spell.dc === 'yours' ? 'yours' : clamp(int(m.spell.dc, 13), 1, 30), attack: m.spell.attack === 'yours' ? 'yours' : clamp(int(m.spell.attack, 5), -5, 20) } : null; }
    if (it.kind === 'wand' || it.kind === 'wondrous' || it.kind === 'weapon') it.charges = m.charges && int(m.charges.max, 0) > 0 ? { max: clamp(int(m.charges.max, 1), 1, 50), regain: dice(m.charges.regain) || '' } : null;
    if (it.kind === 'wondrous' && m.effect && CONDITIONS.has(m.effect.cond)) it.effect = { cond: m.effect.cond, save: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].includes(m.effect.save) ? m.effect.save : null, dc: clamp(int(m.effect.dc, 13), 1, 30), how: str(m.effect.how, 12), dice: dice(m.effect.dice), type: TYPES.includes(m.effect.type) ? m.effect.type : '' };
    it.bonus = { ac: clamp(int(m.bonus && m.bonus.ac, 0), 0, 5), saves: clamp(int(m.bonus && m.bonus.saves, 0), 0, 5), resist: (Array.isArray(m.bonus && m.bonus.resist) ? m.bonus.resist : []).filter((x) => TYPES.includes(x)).slice(0, 4), attack: clamp(int(m.bonus && m.bonus.attack, 0), 0, 3) };
    return it;
  }
  const invOf = (name) => (state.inventory[String(name).toLowerCase()] = state.inventory[String(name).toLowerCase()] || []);
  // what a character's worn DM items add: AC (armour, shield, a Cloak of Protection), saves, resistances
  function gearOf(t) {
    const ch = charForToken(t); if (!ch || !ch.player) return null;
    const inv = (state.inventory[String(ch.player).toLowerCase()] || []).filter((x) => x.equipped);
    if (!inv.length) return null;
    const g = { acSet: null, ac: 0, saves: 0, resist: [], attack: 0 }, dex = ((ch.abilities || [])[1] || {}).mod || 0;
    for (const x of inv) {
      if (x.item.kind === 'armor' && x.item.armor) g.acSet = Math.max(g.acSet || 0, x.item.armor.base + Math.min(dex, x.item.armor.dexMax == null ? 99 : x.item.armor.dexMax) + x.item.armor.bonus);
      if (x.item.kind === 'shield' && x.item.armor) g.ac += x.item.armor.base + x.item.armor.bonus;
      if (x.item.bonus) { g.ac += x.item.bonus.ac || 0; g.saves += x.item.bonus.saves || 0; g.resist.push(...(x.item.bonus.resist || [])); g.attack += x.item.bonus.attack || 0; }
    }
    return g;
  }
  const sendInv = (name) => { const key = String(name).toLowerCase(); for (const c of clients()) if (!c.user.isDM && c.user.name.toLowerCase() === key) send(c, { type: 'inventory', items: state.inventory[key] || [] }); toDMs({ type: 'inventories', inventories: state.inventory }); };
  // ----- concentration -----
  function endConc(key) {
    endZones(key); endSummons(key);
    let spell = '';
    const ch = key.startsWith('p:') ? charOf(key.slice(2)) : null;
    if (ch) { spell = ch.concOn || ''; delete ch.concOn; delete ch.concUntil; delete ch.concScene; }
    const freed = [];
    for (const scn of Object.values(state.scenes)) for (const t of Object.values(scn.tokens)) {
      const before = { ...t }; let changed = false;
      if (keyOf(t) === key && (t.conditions || []).includes('concentrating')) { if (!ch) spell = spell || t.concOn || ''; delete t.concOn; t.conditions = t.conditions.filter((c) => c !== 'concentrating'); changed = true; }
      const after = (t.marks || []).filter((m) => m.by === key && m.conc !== false && m.afterEnd);
      if (liftMarks(t, (m) => m.by === key && m.conc !== false)) { changed = true; freed.push(t.label || '?'); }
      if (changed) tokenChanged(scn, t, before);
      if (after.length) putOn(scn, t, after[0].afterEnd, { by: key, spell: after[0].spell + ' (after)', dc: after[0].dc });
    }
    return { spell, freed };
  }
  // damage while concentrating: a Constitution save, DC half the damage (at least 10, at most 30); at 0 hit points it just ends
  function concCheck(sc, tok, dmg) {
    if (!(dmg > 0) || !(tok.conditions || []).includes('concentrating')) return;
    const key = keyOf(tok), player = key.startsWith('p:'), who = tok.label || '?', dc = Math.min(30, Math.max(10, Math.floor(dmg / 2)));
    const vis = player ? {} : { to: ['DM'] }; // a monster's check stays with the DM
    let lost = tok.hp === 0, res = null;
    if (!lost) { res = saveRoll(sc, tok, 'CON', { dc, conc: true }); lost = !res.ok; showRoll(tok, { label: `Concentration (DC ${dc})`, expr: res.expr, ...res.r }); }
    setImmediate(() => { // after the hit's own line in the log
      if (!lost) return post({ kind: 'chat', who: player ? tok.owner : 'Monsters', ...vis, text: `🧠 ${who} keeps concentration (${res.total} vs DC ${dc}${res.notes.length ? ', ' + res.notes.join(', ') : ''})`, time: Date.now(), cast: true });
      const { spell, freed } = endConc(key);
      post({ kind: 'chat', who: player ? tok.owner : 'Monsters', ...vis, text: `💫 ${who} loses concentration${spell ? ' on ' + spell : ''}${res ? ` (${res.total} vs DC ${dc})` : ' (down)'}${freed.length ? ': it ends for ' + freed.join(', ') : ''}`, time: Date.now(), cast: true });
      save();
    });
  }
  // a player starts concentrating on a spell: any earlier one ends first; it runs out at the spell's duration
  function startConc(sc, u, ch, sp) {
    const key = 'p:' + u.name.toLowerCase(), notes = [];
    if (ch.concOn) { const { spell, freed } = endConc(key); notes.push(`(${spell || 'the last spell'} ends${freed.length ? ' for ' + freed.join(', ') : ''})`); }
    ch.concOn = sp.name;
    const rounds = RULES.roundsOf(sp.duration), c = sc.combat;
    if (rounds && rounds <= 600 && c && c.active) { ch.concUntil = c.round + rounds; ch.concScene = sc.id; }
    for (const t of Object.values(sc.tokens)) if (t.owner === u.name && t.ddb === ch.link && !(t.conditions || []).includes('concentrating')) { const before = { ...t }; t.conditions = [...(t.conditions || []), 'concentrating']; tokenChanged(sc, t, before); }
    return notes;
  }
  // a monster or a character loses concentration because of what happened to it (Earthquake, Sleet Storm)
  function breakConcOf(t) { if ((t.conditions || []).includes('concentrating')) return endConc(keyOf(t)); return null; }

  // ----- an effect landing on a token: the save (or none), damage, then conditions; used by spells, features, monsters and the DM -----
  // eff: { name, save: { abl, dc } | null, fail: [{ dice, type }], half, add, …rule fields }
  // ctx: { by, spell (true for spells), conc, dc, rounds, shared: { rolls by dice }, roll(expr, label), lines }
  function landOn(sc, t, eff, ctx, prev) {
    const who = t.label || '?', lines = ctx.lines;
    if ((t.conditions || []).includes('blinking')) { lines.push(`👻 ${who} is in the Ethereal Plane (Blink): unaffected`); return null; }
    let res = null;
    if (eff.save && eff.save.abl) {
      if (prev) res = prev;
      else {
        res = saveRoll(sc, t, eff.save.abl, { dc: eff.save.dc, spell: !!ctx.spell, add: eff.add || [], poison: (eff.add || []).includes('poisoned') || (eff.fail || []).some((d) => d.type === 'poison') });
        if (res.r) showRoll(t, { label: `${ctx.name}: ${res.abl} save`, expr: res.expr, ...res.r });
      }
    }
    const failed = !res || !res.ok, label = res ? (failed ? (res.auto ? 'fails automatically' : 'fails the save') : 'saves') : '';
    let dealtTotal = 0, full = 0;
    // Evasion: a Dexterity save for half damage takes none on a success and half on a failure (not while incapacitated)
    const chT = charForToken(t), m2 = srdOf(t);
    const evasion = eff.half && eff.save && res && res.abl === 'DEX' && ((chT && chT.evasion) || (m2 && (m2.traits || []).some((x) => /^Evasion/i.test(x.n)))) && !(t.conditions || []).some((c) => ['incapacitated', 'paralyzed', 'stunned', 'unconscious', 'petrified'].includes(c));
    for (const d of eff.fail || []) {
      if (!failed && !eff.half) continue;
      if (!failed && evasion) { lines.push(`🛡 ${who} saves and takes no damage (Evasion)`); continue; }
      const roll = ctx.shared[d.dice + d.type] = ctx.shared[d.dice + d.type] || ctx.roll(d.dice, `${ctx.name} damage`);
      const amt = failed && !evasion ? roll.total : Math.floor(roll.total / 2), k = takes(t, d.type, !!ctx.spell), dealt = reduceBy(sc, t, Math.floor(amt * k), d.type);
      full += Math.floor(roll.total * k); dealtTotal += dealt;
      if (dealt) hpTo(sc, t, -dealt);
      if (dealt || k === 0) lines.push(`💥 ${who}: ${label ? label + ', ' : ''}${dealt} ${d.type} damage${k === 0 ? ' (immune)' : k === 0.5 ? ' (resists)' : k === 2 ? ' (vulnerable)' : ''}${isPC(t) ? ` (${t.hp}/${t.maxHp ?? '?'})` : t.hp === 0 ? ' (down)' : ''}`);
    }
    if (failed && eff.breakConc) { const b = breakConcOf(t); if (b) lines.push(`💫 ${who} loses concentration${b.spell ? ' on ' + b.spell : ''}`); }
    let add = eff.add || [];
    if (failed && res && eff.by5 && eff.by5.length && res.total <= eff.save.dc - 5) add = [...add, ...eff.by5];
    if (eff.divine && failed) { // Divine Word: by its hit points now
      const hp = t.hp ?? 99;
      if (hp <= 20) { lines.push(`☠ ${who} (${hp} hit points or fewer): dies`); const b = { ...t }; t.conditions = [...new Set([...(t.conditions || []), 'dead'])]; tokenChanged(sc, t, b); return res; }
      add = hp <= 30 ? ['blinded', 'deafened', 'stunned'] : hp <= 40 ? ['blinded', 'deafened'] : hp <= 50 ? ['deafened'] : [];
      eff = { ...eff, rounds: hp <= 30 ? 600 : hp <= 40 ? 100 : 10 };
    }
    if (eff.hpCap && (t.hp ?? 0) > eff.hpCap) { lines.push(`🛡 ${who} has more than ${eff.hpCap} hit points: its Speed is 0 until the start of your next turn instead`); return res; }
    if (!failed) {
      if (!(eff.fail || []).length) lines.push(`🛡 ${who} ${res && res.notes.length ? 'saves (' + res.notes.join(', ') + ')' : 'saves'} against ${ctx.name}`);
      if (eff.onSave) putOn(sc, t, eff.onSave, { by: ctx.by, spell: ctx.name + ' (saved)', dc: ctx.dc });
      return res;
    }
    if (add.length && !(t.hp === 0 && !isPC(t))) {
      const put = putOn(sc, t, { ...eff, add, save: (eff.save && eff.save.abl) || eff.saveAbl || null }, { by: ctx.by, spell: ctx.name, conc: ctx.conc, dc: (eff.save && eff.save.dc) || ctx.dc, rounds: eff.rounds || ctx.rounds });
      if (put.immune) lines.push(`🛡 ${who} is immune to ${add.map(condName).join(' and ')}`);
      else lines.push(`${eff.ally ? '✨' : '🔗'} ${who}${res ? ' ' + label : ''}: ${put.added.map(condName).join(' and ')}${eff.note ? ' · ' + eff.note : ''}`);
    }
    if (res && failed && !isPC(t)) offerLegendary(sc, t, ctx.name, ctx.by, eff.half ? full - Math.floor(full / 2) : full);
    return res;
  }
  const diceAt = (base, per, extra) => {
    if (!base) return ''; if (!per || extra <= 0) return base;
    const m = /^(\d+)d(\d+)(.*)$/.exec(base), q = /^(\d+)d(\d+)$/.exec(per);
    if (m && q && m[2] === q[2]) return `${+m[1] + +q[1] * extra}d${m[2]}${m[3]}`;
    return base + Array(extra).fill('+' + per).join('');
  };
  const ORD = (n) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
  const sgnS = (n) => (n >= 0 ? '+' + n : String(n));
  // spend a slot (or a use) for a spell; returns the level it was cast at, or an error message
  function spendSpell(ch, sp, msg) {
    if (sp.level > 0 && sp.usesSlot && !msg.free) {
      const list = msg.pact ? ch.pact : ch.slots, sl = (list || []).find((x) => x.level === int(msg.slot, sp.level) && x.level >= sp.level);
      if (!sl || sl.used >= sl.max) return { error: `No ${msg.pact ? 'pact' : 'level ' + int(msg.slot, sp.level)} slots left` };
      sl.used++; return { at: sl.level };
    }
    if (sp.uses && !msg.free) {
      const n = ch.spellUses[sp.name] || 0; if (n >= sp.uses) return { error: `${sp.name}: no uses left until you rest` };
      ch.spellUses[sp.name] = n + 1;
    }
    return { at: sp.level };
  }
  function viewFor(u) {
    const effects = u.isDM ? { presets: FEATS.PRESETS.map((x) => ({ name: x.name, dc: x.dc, save: x.save })), spells: Object.entries(RULES.RULES).filter(([, r]) => !r.ally && ((r.add || []).length || r.divine)).map(([k, r]) => ({ name: k, save: r.save || r.endSave || '', options: (r.options || []).map((o) => o.name) })), info: spellInfo() } : null;
    const base = { effects, items: u.isDM ? state.items : null, inventories: u.isDM ? state.inventory : null, inventory: u.isDM ? null : state.inventory[u.name.toLowerCase()] || [], diceSkin: skinOf(u.name), character: u.isDM ? null : charOf(u.name), activeScene: u.isDM ? state.activeScene : viewOf(u), log: state.log.filter((e) => canSee(u, e)), myMacros: state.macros[u.name] || [], sound: soundOut(), now: Date.now() };
    if (u.isDM) { Object.values(state.scenes).forEach(syncFog); return { ...base, characters: state.characters, scenes: state.scenes, order: state.order, library: state.library, table: tableSettings(), handouts: state.handouts || [], encounters: state.encounters || [], audio: state.audio }; }
    u.view = viewOf(u);
    return { ...base, scene: playerScene(state.scenes[u.view], u), handouts: (state.handouts || []).filter((h) => forPlayer(h, u.name)) };
  }

  // D&D Beyond: fetch the character, keep its portrait here, and remember the sheet for this player
  async function importCharacter(u, link) {
    const ch = await ddb.fetchCharacter(link);
    try { fs.mkdirSync(path.join(dataDir, 'dndbeyond'), { recursive: true }); fs.writeFileSync(path.join(dataDir, 'dndbeyond', ch.id + '.json'), JSON.stringify(ch.raw, null, 1)); } catch { /* only for looking into problems */ }
    delete ch.raw;
    ch.img = null;
    if (ch.avatar) try { // the portrait, as an upload, so everyone's screen can show it without going online
      const r = await fetch(ch.avatar, { signal: AbortSignal.timeout(15000) });
      const type = (r.headers.get('content-type') || '').split(';')[0].toLowerCase(), ext = IMAGE_EXT[type];
      if (r.ok && ext) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 8 * 1024 * 1024) { const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + ext; fs.mkdirSync(uploads, { recursive: true }); fs.writeFileSync(path.join(uploads, name), buf); ch.img = '/uploads/' + name; }
      }
    } catch { /* no portrait then */ }
    // what's been spent at this table stays spent when the character is brought in again
    const old = state.characters[u.name.toLowerCase()];
    if (old && old.id === ch.id) {
      for (const k of ['slots', 'pact']) for (const sl of ch[k] || []) { const o = (old[k] || []).find((x) => x.level === sl.level); if (o) sl.used = Math.min(sl.max, o.used || 0); }
      ch.spellUses = old.spellUses || {};
      for (const r of ch.resources || []) { const o = (old.resources || []).find((x) => x.name === r.name); if (o) r.used = Math.min(r.max, o.used || 0); }
    } else ch.spellUses = {};
    const perception = ch.skills.find((s) => s.name === 'Perception');
    ch.pp = 10 + (perception ? perception.bonus : 0);
    ch.at = Date.now(); ch.player = u.name;
    state.characters[u.name.toLowerCase()] = ch; save();
    return ch;
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
    if (m.frame !== undefined) t.frame = ['gold', 'silver', 'bronze', 'iron', 'wood', 'color'].includes(m.frame) ? m.frame : '';
    if (m.imgPos !== undefined) t.imgPos = m.imgPos && typeof m.imgPos === 'object' ? { x: clamp(num(m.imgPos.x, 0), -1, 1), y: clamp(num(m.imgPos.y, 0), -1, 1), z: clamp(num(m.imgPos.z, 1), 1, 4) } : null;
    const hpVal = (v, lo) => (v === null || v === '' ? null : clamp(int(v, 0), lo, 99999));
    if (m.hp !== undefined) t.hp = hpVal(m.hp, -999);
    if (m.maxHp !== undefined) t.maxHp = hpVal(m.maxHp, 0);
    if (m.tempHp !== undefined) t.tempHp = clamp(int(m.tempHp, 0), 0, 9999);
    if (m.exhaustion !== undefined) t.exhaustion = clamp(int(m.exhaustion, 1), 1, 6); // 2024: -2 per level to every d20 test, 6 is death
    if (m.hpShow !== undefined) t.hpShow = HP_SHOW.includes(m.hpShow) ? m.hpShow : undefined;
    if (m.initBonus !== undefined) t.initBonus = clamp(int(m.initBonus, 0), -10, 30);
    if (m.light !== undefined) t.light = Array.isArray(m.light) && int(m.light[1], 0) > 0 ? [clamp(int(m.light[0], 0), 0, 300), clamp(int(m.light[1], 0), 0, 600)] : null;
    if (m.darkvision !== undefined) t.darkvision = clamp(int(m.darkvision, 0), 0, 300);
    if (m.ac !== undefined) t.ac = m.ac === null || m.ac === '' ? null : clamp(int(m.ac, 10), 0, 40);
    if (m.speed !== undefined) t.speed = m.speed === null ? null : clamp(int(m.speed, 30), 0, 300);
    if (m.pp !== undefined) t.pp = m.pp === null ? null : clamp(int(m.pp, 10), 0, 40);
    if (m.srd !== undefined) t.srd = typeof m.srd === 'string' && /^[a-z0-9-]{1,60}$/.test(m.srd) ? m.srd : null;
    if (m.ddb !== undefined) t.ddb = typeof m.ddb === 'string' && DDB.test(m.ddb.trim()) ? m.ddb.trim() : null;
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
    if (m.fx !== undefined) t.fx = SPELL_FX.includes(m.fx) ? m.fx : '';
    if (m.cast) t.cast = (t.cast || 0) + 1; // cast (again): everyone sees it go off
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
    if (m.vision && typeof m.vision === 'object') sc.vision = { on: !!m.vision.on, ambient: AMBIENT.includes(m.vision.ambient) ? m.vision.ambient : 'bright', shared: m.vision.shared !== false, explore: m.vision.explore !== false };
    if (m.atmo && typeof m.atmo === 'object') sc.atmo = atmoFields(m.atmo); // a regenerated map keeps its weather and sound
    if (WALL_STYLES.includes(m.wallStyle)) sc.wallStyle = m.wallStyle; // how walls are drawn: built stone, or natural rock (caves)
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

  // ---------- who may join ----------
  const tableSettings = () => ({ passcode: state.passcode, blocked: state.blocked, pins: Object.values(state.pins).map((p) => p.name) });

  const wrongTries = new Map(); // address → { n, until }: slows down passcode guessing
  // Reveal (or cover) squares of fog, and send players what's now in view or gone from it.
  function revealFog(sc, cells, reveal) {
    const a = fogArr(sc), v = reveal ? 1 : 0, changed = [];
    for (const c of cells) {
      const x = int(c && c[0], -1), y = int(c && c[1], -1);
      if (x < 0 || y < 0 || x >= sc.cols || y >= sc.rows || a[y * sc.cols + x] === v) continue;
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
  }
  // Handouts: the DM's notes and pictures for the players.
  const forPlayer = (h, name) => h.to === 'all' || (Array.isArray(h.to) && h.to.some((n) => sameName(n, name)));
  function handoutFields(m, old) {
    const h = { id: old ? old.id : uid(), time: old ? old.time : Date.now() };
    h.title = str(m.title, 80).trim() || 'Handout';
    h.text = str(m.text, 8000);
    h.img = typeof m.img === 'string' && UPLOAD_URL.test(m.img) ? m.img : null;
    h.to = m.to === 'all' ? 'all' : Array.isArray(m.to) ? m.to.map((n) => str(n, 24).trim()).filter(Boolean).slice(0, 50) : 'all';
    if (!h.text.trim() && !h.img) return null;
    return h;
  }
  // send it to the players it's for (popping up if show); players it's no longer for lose it
  function showHandout(h, show) {
    for (const c of clients()) {
      if (c.user.isDM) continue;
      if (forPlayer(h, c.user.name)) send(c, { type: 'handout', handout: h, show });
      else send(c, { type: 'handoutRemove', id: h.id });
    }
  }
  // ---------- atmosphere: music and ambience (what's playing is the same for everyone), weather and time of day ----------
  const soundById = (id) => SOUNDS.find((x) => x.id === id) || state.audio.find((x) => x.id === id) || null;
  // { music: {id, vol} | null, amb: [{id, vol}] } → what to store, keeping the start time of anything already playing
  // (everyone works out how far into a loop to be from its start time, so they all hear the same moment)
  function cleanSound(m, old) {
    old = old || { music: null, amb: [] };
    const vol = (v, d) => Math.round(clamp(num(v, d), 0, 1) * 100) / 100, now = Date.now();
    const music = m && m.music && soundById(m.music.id) ? { id: m.music.id, vol: vol(m.music.vol, 0.8), at: old.music && old.music.id === m.music.id ? old.music.at : now } : null;
    const amb = [];
    for (const a of m && Array.isArray(m.amb) ? m.amb : []) {
      if (!a || !soundById(a.id) || amb.some((x) => x.id === a.id) || amb.length >= MAX_AMB) continue;
      const o = (old.amb || []).find((x) => x.id === a.id);
      amb.push({ id: a.id, vol: vol(a.vol, 0.7), at: o ? o.at : now });
    }
    return { music, amb };
  }
  const preset = (snd) => (snd && (snd.music || snd.amb.length) ? { music: snd.music ? { id: snd.music.id, vol: snd.music.vol } : null, amb: snd.amb.map((a) => ({ id: a.id, vol: a.vol })) } : null);
  function builtinOnly(snd) {
    if (!snd) return null;
    const b = (x) => x && SOUNDS.some((y) => y.id === x.id);
    return preset({ music: b(snd.music) ? snd.music : null, amb: (snd.amb || []).filter(b) });
  }
  const withInfo = (x) => { const d = soundById(x.id); return { ...x, name: d.name, url: d.url }; };
  const soundOut = () => ({ music: state.sound.music && soundById(state.sound.music.id) ? withInfo(state.sound.music) : null, amb: (state.sound.amb || []).filter((a) => soundById(a.id)).map(withInfo) });
  function setSound(m) {
    state.sound = cleanSound(m, state.sound);
    clients().forEach((c) => send(c, { type: 'sound', sound: soundOut(), now: Date.now() }));
    save();
  }
  // a map's weather and time of day (only a look: lighting rules use the map's light setting), and its sound
  function atmoFields(m, old) {
    const a = { weather: 'none', level: 2, time: 'day', sound: null, auto: false, ...(old || {}) };
    if (WEATHER.includes(m.weather)) a.weather = m.weather;
    if (m.level != null) a.level = clamp(int(m.level, 2), 1, 3);
    if (TIMES.includes(m.time)) a.time = m.time;
    if (MOODS.includes(m.mood)) a.mood = m.mood;
    if ('sound' in m) a.sound = preset(cleanSound(m.sound));
    if ('auto' in m) a.auto = !!m.auto;
    return a;
  }

  wss.on('connection', (ws, req) => {
    ws.addr = (req && req.socket && req.socket.remoteAddress) || '?';
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
      u.isDM = msg.key === dmKey;
      if (!u.isDM) {
        const deny = (reason) => { send(ws, { type: 'denied', reason }); setTimeout(() => ws.close(), 50); };
        if (state.blocked.some((b) => sameName(b, u.name))) return deny('blocked');
        if (state.passcode) {
          const t = wrongTries.get(ws.addr) || { n: 0, until: 0 };
          if (Date.now() < t.until) return deny('wait');
          if (String(msg.passcode || '') !== state.passcode) {
            t.n++; if (t.n >= 5) { t.until = Date.now() + 30000; t.n = 0; } wrongTries.set(ws.addr, t);
            return deny(msg.passcode ? 'passcode-wrong' : 'passcode');
          }
          wrongTries.delete(ws.addr);
        }
        const pin = state.pins[u.name.toLowerCase()];
        if (pin) { // this name is protected by its player's PIN
          const t = wrongTries.get(ws.addr + '|pin') || { n: 0, until: 0 };
          if (Date.now() < t.until) return deny('wait');
          if (!msg.pin || pinHash(msg.pin, pin.salt) !== pin.hash) {
            if (msg.pin) { t.n++; if (t.n >= 5) { t.until = Date.now() + 30000; t.n = 0; } wrongTries.set(ws.addr + '|pin', t); }
            return deny(msg.pin ? 'pin-wrong' : 'pin');
          }
          wrongTries.delete(ws.addr + '|pin');
        }
      }
      u.joined = true;
      if (!u.isDM && visionOn(state.scenes[viewOf(u)])) scheduleVision(state.scenes[viewOf(u)]);
      send(ws, { type: 'welcome', isDM: u.isDM, name: u.name, version: VERSION, pinSet: !!state.pins[u.name.toLowerCase()], state: viewFor(u) });
      return presence();
    }
    if (!u.joined) return;

    // Scene targeted by the message: DMs may name any scene, players always act on the active one.
    const sc = state.scenes[u.isDM && msg.sceneId ? msg.sceneId : viewOf(u)];
    const tok = sc && msg.id ? sc.tokens[msg.id] : null;
    const inside = (x, y) => sc && x >= 0 && y >= 0 && x < sc.cols && y < sc.rows;

    // a spell being cast: anyone who could Counterspell it is asked first
    if (!msg._cs && sc && ['spellEffect', 'dmSpell', 'itemUse'].includes(msg.type)) {
      const ci = castInfo(u, sc, msg), rs = ci ? counterers(sc, ci.caster) : [];
      if (rs.length) return holdForCounter(ws, sc, msg, ci, rs);
    }
    switch (msg.type) {
      case 'teleport': { // the square picked for a teleport
        const p = pendingMoves.get(msg.id); if (!p || !(p.who === 'dm' ? u.isDM : !u.isDM && u.name.toLowerCase() === p.who)) return;
        const scn = state.scenes[p.sceneId], t = scn && scn.tokens[p.ids[0]]; if (!t) return;
        const x = clamp(int(msg.x, t.x), 0, scn.cols - t.size), y = clamp(int(msg.y, t.y), 0, scn.rows - t.size);
        if (p.sq && Math.max(Math.abs(x - p.from.x), Math.abs(y - p.from.y)) > p.sq) return send(ws, { type: 'error', message: `Too far: ${p.spell} reaches ${p.sq * 5} feet` });
        if (p.near && !p.near.some((id) => scn.tokens[id] && sqDist(scn.tokens[id], { ...t, x, y }) <= 1)) return send(ws, { type: 'error', message: 'Pick a space next to one of the targets' });
        if (!freeAt(scn, x, y, t.size, t)) return send(ws, { type: 'error', message: 'That space is taken' });
        pendingMoves.delete(msg.id);
        const moved = [];
        for (const [i, id] of p.ids.entries()) {
          const m = scn.tokens[id]; if (!m) continue; const b = { ...m };
          const at = i === 0 ? [x, y] : freeNear(scn, x + t.size, y, m.size, m); if (!at) continue;
          m.x = at[0]; m.y = at[1]; tokenChanged(scn, m, b); zonesAfterMove(scn, m, b); grappleAfterMove(scn, m, b, true); moved.push(m.label || '?');
        }
        post({ kind: 'chat', who: u.isDM ? 'Monsters' : u.name, ...(u.isDM && t.hidden ? { to: ['DM'] } : {}), text: `🌀 ${moved.join(' and ')} ${moved.length > 1 ? 'teleport' : 'teleports'} (${p.spell})`, time: Date.now(), cast: true });
        if (visionOn(scn)) scheduleVision(scn);
        save(); break;
      }
      case 'summonAttack': { // a summoned spirit attacks: the caster's spell attack bonus, its own damage
        const s = tok; if (!s || !s.sum || !(u.isDM || (s.owner && s.owner === u.name))) return;
        const a = s.sum.attacks[int(msg.idx, -1)], t = sc.tokens[msg.target]; if (!a || !t) return;
        const mine = !!s.owner, rolls = [], lines = [];
        const R2 = (e, l) => { const r = rollDice(e); rolls.push({ who: mine ? s.owner : 'Monsters', ...(mine ? {} : { to: ['DM'] }), label: str(l, 30), expr: e, ...r, private: false, time: Date.now(), skin: mine ? skinOf(s.owner) : null }); return r; };
        const melee = a.melee && (!a.range || sqDist(s, t) <= Math.max(1, a.reach / 5));
        const at = attackRoll(sc, s, t, '1d20' + sgnS(s.sum.attack), { melee, range: melee ? null : a.range ? { normal: a.range, long: a.range } : null, reach: melee ? a.reach : null, weapon: a.name });
        if (at.blocked || at.duplicate) { post({ kind: 'chat', who: mine ? s.owner : 'Monsters', ...(mine ? {} : { to: ['DM'] }), text: missWhy(at, t.label || '?'), time: Date.now(), cast: true }); break; }
        rolls.push({ who: mine ? s.owner : 'Monsters', ...(mine ? {} : { to: ['DM'] }), label: str(`${a.name} → ${t.label || '?'}`, 30), expr: at.expr, ...at.r, private: false, time: Date.now(), skin: mine ? skinOf(s.owner) : null });
        if (!at.hit) lines.push(`💨 ${s.label}'s ${a.name} misses ${t.label || '?'}`);
        else {
          let dealt = 0; const bits = [];
          for (const d of [{ dice: a.dice, type: a.type }, ...(a.extra ? [a.extra] : [])]) { const x = R2(at.crit ? doubleDice(d.dice) : d.dice, a.name + ' damage'), k = takes(t, d.type), n2 = reduceBy(sc, t, Math.floor(x.total * k), d.type); dealt += n2; bits.push(`${n2} ${d.type}`); }
          hpTo(sc, t, -dealt, 0, { crit: at.crit });
          lines.push(`🗡 ${s.label}'s ${a.name} hits ${t.label || '?'}${at.crit ? ' (critical!)' : ''}: ${bits.join(' + ')} damage`);
        }
        for (const r of rolls) post(r);
        post({ kind: 'chat', who: mine ? s.owner : 'Monsters', ...(mine ? {} : { to: ['DM'] }), text: lines.join('\n'), time: Date.now(), cast: true });
        save(); break;
      }
      case 'summonDismiss': { const s = tok; if (!s || !s.sum || !(u.isDM || (s.owner && s.owner === u.name))) return; removeSummon(sc, s, 'is dismissed'); break; }
      case 'promptAnswer': { const p = prompts.get(msg.id); if (!p || !(p.to === 'dm' ? u.isDM : !u.isDM && u.name.toLowerCase() === p.to)) return; clearTimeout(p.timer); prompts.delete(msg.id); closePrompt(msg.id); p.resolve(typeof msg.value === 'string' ? msg.value.slice(0, 60) : '', ws); break; }
      // ----- tokens -----
      case 'move':
        if (!tok || (!u.isDM && (tok.hidden || (tok.owner !== u.name && tok.owner !== '*')))) return;
        if (!u.isDM && (tok.conditions || []).some((c) => ['grappled', 'restrained', 'paralyzed', 'petrified', 'stunned', 'unconscious'].includes(c)) && (int(msg.x, tok.x) !== tok.x || int(msg.y, tok.y) !== tok.y)) {
          const why = (tok.conditions || []).find((c) => ['grappled', 'restrained', 'paralyzed', 'petrified', 'stunned', 'unconscious'].includes(c));
          send(ws, { type: 'error', message: `${tok.label || 'Your token'} is ${why}: its speed is 0${why === 'grappled' ? ' (try to escape first)' : ''}` }); send(ws, { type: 'token', sceneId: sc.id, token: tok }); return;
        }
        { const before = { ...tok };
          tok.x = clamp(int(msg.x, tok.x), 0, sc.cols - tok.size);
          tok.y = clamp(int(msg.y, tok.y), 0, sc.rows - tok.size);
          tokenChanged(sc, tok, before);
          if (before.x !== tok.x || before.y !== tok.y) { zonesAfterMove(sc, tok, before); oppAttacks(sc, tok, before); grappleAfterMove(sc, tok, before); } }
        if (visionOn(sc) && (tok.owner || tok.light)) scheduleVision(sc);
        save();
        break;
      case 'addToken': {
        if (!u.isDM || !sc || Object.keys(sc.tokens).length >= 500) return;
        const id = uid();
        sc.tokens[id] = { id, ...tokenFields({ label: '?', color: '#e8390e', owner: '', size: 1, x: 1, y: 1, ...msg }, sc) };
        tokenChanged(sc, sc.tokens[id], null); save();
        if (visionOn(sc)) scheduleVision(sc);
        if (sc.group) refreshViews();
        break;
      }
      case 'tokenUpdate': {
        if (!tok) return;
        const mine = tok.owner && tok.owner === u.name;
        if (!u.isDM && !mine) return;
        const before = { ...tok };
        // players can only change their own character's health, conditions and initiative bonus
        const m = u.isDM ? msg : Object.fromEntries(['hp', 'maxHp', 'tempHp', 'conditions', 'initBonus', 'light', 'darkvision', 'ddb', 'exhaustion', 'frame', 'imgPos', 'img'].filter((k) => k in msg).map((k) => [k, msg[k]]));
        Object.assign(tok, tokenFields({ ...m, x: m.x ?? tok.x, y: m.y ?? tok.y, size: m.size ?? tok.size }, sc, tok));
        tokenChanged(sc, tok, before);
        // concentration taken off by hand: the spell's conditions go too
        if ((before.conditions || []).includes('concentrating') && !(tok.conditions || []).includes('concentrating')) { const { spell, freed } = endConc(concKey(tok)); if (freed.length) post({ kind: 'chat', who: u.name, ...(tok.owner ? {} : { to: ['DM'] }), text: `💫 ${tok.label || '?'} stops concentrating${spell ? ' on ' + spell : ''}: it ends for ${freed.join(', ')}`, time: Date.now(), cast: true }); }
        // a condition taken off by hand isn't put back when concentration ends
        if (tok.marks) { tok.marks = tok.marks.filter((mk) => (tok.conditions || []).includes(mk.c)); if (!tok.marks.length) delete tok.marks; }
        if (visionOn(sc)) scheduleVision(sc);
        if (sc.group && (before.owner !== tok.owner || before.hidden !== tok.hidden)) refreshViews();
        if (sc.combat && sc.combat.active && 'initBonus' in m) { sortCombat(sc); sendCombat(sc); }
        save();
        break;
      }
      case 'hpChange': { // damage (negative) or healing (positive); temporary HP soaks damage first
        if (!tok || (!u.isDM && !(tok.owner && tok.owner === u.name))) return;
        const amt = clamp(int(msg.amount, 0), -99999, 99999);
        if (!amt || (tok.hp == null && tok.maxHp == null)) return;
        hpTo(sc, tok, amt); save(); // a hit on someone concentrating makes them check it
        break;
      }
      case 'removeToken':
        if (!u.isDM || !tok) return;
        delete sc.tokens[msg.id];
        toScene(sc.id, { type: 'removeToken', sceneId: sc.id, id: msg.id });
        if (visionOn(sc)) scheduleVision(sc);
        if (sc.group) refreshViews();
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
        for (const id of ids.slice(0, 200)) if (sc.tokens[id] && !c.entries.some((e) => e.id === id)) c.entries.push(entryFor(sc.tokens[id]));
        // a summon whose caster joins the fight comes with it
        for (const t of Object.values(sc.tokens)) if (t.sum && t.sum.init && ids.includes(t.sum.casterId) && !c.entries.some((e) => e.id === t.id)) c.entries.push(entryFor(t));
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
        list = list.filter((e) => !(e.after && c.entries.some((x) => x.id === e.after))); // they go with their caster
        for (const e of list.slice(0, 100)) {
          const t = sc.tokens[e.id], b = t.initBonus || 0, surprised = (t.conditions || []).includes('surprised');
          const r = rollDice('1d20' + (b ? (b > 0 ? '+' : '') + b : '') + (surprised ? 'dis' : '')); // 2024: surprised rolls initiative with Disadvantage
          if (surprised) { const b0 = { ...t }; t.conditions = t.conditions.filter((x) => x !== 'surprised'); tokenChanged(sc, t, b0); }
          e.init = r.total;
          // monsters' rolls stay between the DM and the dice
          const who = u.isDM && !t.owner ? 'DM' : u.name;
          const entry = { who, label: t.label === who ? 'Initiative' : `${t.label} · Initiative`, expr: '1d20' + (b ? (b > 0 ? '+' : '') + b : '') + (surprised ? 'dis' : ''), ...r, private: u.isDM && !t.owner, time: Date.now(), skin: skinOf(u.name) };
          if (u.isDM) delete entry.dice; // a whole room of monsters rolling at once stays in the log
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
        const started0 = !!c.started; sortCombat(sc); c.started = true;
        const i = Math.max(0, c.entries.findIndex((e) => e.id === c.turnId)), wasStarted = started0, ending = c.turnId;
        if (msg.type === 'combatNext' && wasStarted && ending) endOfTurn(sc, sc.tokens[ending]);
        if (msg.type === 'combatNext') { if (i + 1 >= c.entries.length) { c.round++; c.turnId = c.entries[0].id; newRound(sc); } else c.turnId = c.entries[i + 1].id; }
        else if (i === 0) { if (c.round > 1) { c.round--; c.turnId = c.entries[c.entries.length - 1].id; } } else c.turnId = c.entries[i - 1].id;
        sendCombat(sc);
        if (msg.type === 'combatNext' && c.turnId !== ending) startOfTurn(sc, sc.tokens[c.turnId]);
        save();
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
          if (visionOn(sc)) scheduleVision(sc);
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
        const was = sc.props[id];
        sc.props[id] = { id, kind: msg.kind, x, y, rot: ((int(msg.rot, 0) % 4) + 4) % 4 };
        if (was && was.open && was.kind === msg.kind) sc.props[id].open = true;
        toDMs({ type: 'prop', sceneId: sc.id, prop: sc.props[id] });
        if (visionOn(sc)) scheduleVision(sc);
        // players see it only if it's not secret and not under fog; if it moved into fog, they lose it
        toPlayersOnScene(sc.id, !DM_ONLY.has(msg.kind) && revealed(sc, x, y)
          ? { type: 'prop', sceneId: sc.id, prop: sc.props[id] } : { type: 'propRemove', sceneId: sc.id, propId: id });
        save();
        break;
      }

      // ----- who may join (DM only) -----
      case 'setPasscode':
        if (!u.isDM) return;
        state.passcode = str(msg.passcode, 40).trim();
        toDMs({ type: 'table', table: tableSettings() }); save();
        break;
      case 'removePlayer': { // disconnect a player; with block, they can't come back under that name
        if (!u.isDM || !msg.name) return;
        const name = str(msg.name, 24).trim();
        if (msg.block && !state.blocked.some((b) => sameName(b, name))) state.blocked.push(name);
        clients().filter((c) => !c.user.isDM && sameName(c.user.name, name)).forEach((c) => { send(c, { type: 'denied', reason: msg.block ? 'blocked' : 'removed' }); c.user.joined = false; setTimeout(() => c.close(), 50); });
        toDMs({ type: 'table', table: tableSettings() }); save();
        setTimeout(presence, 100);
        break;
      }
      case 'unblock':
        if (!u.isDM) return;
        state.blocked = state.blocked.filter((b) => !sameName(b, msg.name || ''));
        toDMs({ type: 'table', table: tableSettings() }); save();
        break;

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
        toScene(sc.id, { type: 'template', sceneId: sc.id, tpl: t });
        if (old && (old.x !== t.x || old.y !== t.y || old.size !== t.size || old.angle !== t.angle)) zonesAfterTemplate(sc, id, old);
        save();
        break;
      }
      case 'templateRemove': { // one by id; or all of the sender's ("mine"); or the DM clears the lot ("all")
        if (!sc || !sc.templates) return;
        const ids = Object.values(sc.templates).filter((t) =>
          (msg.id ? t.id === msg.id : msg.all ? u.isDM : msg.mine ? (u.isDM ? !t.owner : t.owner === u.name) : false)
          && (u.isDM || t.owner === u.name)).map((t) => t.id);
        if (!ids.length) return;
        ids.forEach((id) => delete sc.templates[id]);
        if (sc.zones) { for (const [zid, z] of Object.entries(sc.zones)) if (ids.includes(z.tpl)) delete sc.zones[zid]; sendZones(sc); zoneInside(sc); }
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

      case 'moment': { // lightning or an earthquake, on every screen showing this map
        if (!u.isDM || !sc || !MOMENTS.includes(msg.kind)) return;
        toScene(sc.id, { type: 'moment', sceneId: sc.id, kind: msg.kind });
        break;
      }
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
        clients().forEach((c) => c !== ws && seesScene(c, sc.id) && send(c, out));
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
      case 'fog': // reveal or cover a list of cells
        if (!u.isDM || !sc || !Array.isArray(msg.cells) || msg.cells.length > 30000) return;
        revealFog(sc, msg.cells, !!msg.reveal);
        break;
      case 'doorToggle': { // open or close the door at a point (squares); players only doors they can see
        if (!sc) return;
        const px = num(msg.x, -1), py = num(msg.y, -1), cx = Math.floor(px), cy = Math.floor(py);
        if (!inside(cx, cy)) return;
        const canSeeAt = (x, y) => u.isDM || ((!fogOn(sc) || revealed(sc, x, y)) && (!visionOn(sc) || sightFor(sc, u.name)[y * sc.cols + x] > 0));
        // chests open and close like doors; a trap is the DM's to spring, and everyone sees it go off
        const chest = Object.values(sc.props).find((p) => p.x === cx && p.y === cy && p.kind === 'chest');
        if (chest) {
          if (!canSeeAt(cx, cy)) return;
          chest.open = !chest.open;
          toScene(sc.id, { type: 'prop', sceneId: sc.id, prop: chest });
          toScene(sc.id, { type: 'sfx', sceneId: sc.id, name: chest.open ? 'chest-open' : 'chest-close', x: cx + 0.5, y: cy + 0.5, fx: chest.open ? 'chest' : '' });
          save(); break;
        }
        const trap = u.isDM && Object.values(sc.props).find((p) => p.x === cx && p.y === cy && p.kind === 'trap');
        if (trap) { toScene(sc.id, { type: 'sfx', sceneId: sc.id, name: 'trap', x: cx + 0.5, y: cy + 0.5, fx: 'trap' }); break; }
        const prop = Object.values(sc.props).find((p) => p.x === cx && p.y === cy && DOOR_KINDS.has(p.kind));
        if (prop) {
          if (!canSeeAt(cx, cy)) return;
          prop.open = !prop.open;
          toScene(sc.id, { type: 'prop', sceneId: sc.id, prop });
          toScene(sc.id, { type: 'sfx', sceneId: sc.id, name: prop.open ? 'door-open' : 'door-close', x: prop.x + 0.5, y: prop.y + 0.5 });
        } else {
          let best = -1, bd = 0.8;
          (sc.doors || []).forEach((d, i) => { const mx = (d[0] + d[2]) / 2, my = (d[1] + d[3]) / 2, dd = Math.hypot(mx - px, my - py); if (dd < bd) { bd = dd; best = i; } });
          if (best < 0) return;
          const d = sc.doors[best];
          if (!canSeeAt(clamp(Math.floor((d[0] + d[2]) / 2), 0, sc.cols - 1), clamp(Math.floor((d[1] + d[3]) / 2), 0, sc.rows - 1))) return;
          d[4] = d[4] ? 0 : 1;
          toDMs({ type: 'doors', sceneId: sc.id, doors: sc.doors });
          toPlayersOnScene(sc.id, { type: 'doorFlash', sceneId: sc.id, x: (d[0] + d[2]) / 2, y: (d[1] + d[3]) / 2, open: !!d[4] });
          toScene(sc.id, { type: 'sfx', sceneId: sc.id, name: d[4] ? 'door-open' : 'door-close', x: (d[0] + d[2]) / 2, y: (d[1] + d[3]) / 2 });
        }
        scheduleVision(sc); save();
        break;
      }

      // ----- handouts (the DM shows them; players get the ones meant for them) -----
      case 'handoutSave': {
        if (!u.isDM) return;
        state.handouts = state.handouts || [];
        const old = state.handouts.find((h) => h.id === msg.handout?.id);
        const h = handoutFields(msg.handout || {}, old);
        if (!h) return;
        if (!old) { if (state.handouts.length >= 300) state.handouts.shift(); state.handouts.push(h); } else Object.assign(old, h);
        const hh = old || h;
        toDMs({ type: 'handouts', handouts: state.handouts });
        if (msg.show) showHandout(hh, true); else if (old) showHandout(hh, false);
        save();
        break;
      }
      case 'handoutShow': {
        if (!u.isDM) return;
        const h = (state.handouts || []).find((x) => x.id === msg.id); if (!h) return;
        if (Array.isArray(msg.to) || msg.to === 'all') { h.to = msg.to === 'all' ? 'all' : msg.to.map((n) => str(n, 24).trim()).filter(Boolean).slice(0, 50); toDMs({ type: 'handouts', handouts: state.handouts }); }
        showHandout(h, true); save();
        break;
      }
      case 'handoutDelete': {
        if (!u.isDM) return;
        state.handouts = (state.handouts || []).filter((h) => h.id !== msg.id);
        toDMs({ type: 'handouts', handouts: state.handouts });
        clients().filter((c) => !c.user.isDM).forEach((c) => send(c, { type: 'handoutRemove', id: msg.id }));
        save();
        break;
      }
      case 'propRemove':
        if (!u.isDM || !sc || !sc.props[msg.propId]) return;
        delete sc.props[msg.propId];
        toScene(sc.id, { type: 'propRemove', sceneId: sc.id, propId: msg.propId }); save();
        if (visionOn(sc)) scheduleVision(sc);
        break;

      // ----- scenes (DM only) -----
      case 'sceneCreate': {
        if (!u.isDM || state.order.length >= 200) return;
        const s = newScene(msg.name, msg.cols, msg.rows);
        if (msg.content) fillScene(s, msg.content);
        syncFog(s);
        state.scenes[s.id] = s; state.order.push(s.id);
        // 1.11: a generated building, ship, castle or dungeon can come with its other floors (stairs between them)
        const extra = Array.isArray(msg.floors) ? msg.floors.slice(0, 4).filter((f) => f && f.content) : [];
        if (extra.length && state.order.length + extra.length <= 200) {
          const base = s.name;
          s.group = uid(); s.level = 0; s.floor = str(msg.floorName, 30).trim() || 'Ground floor'; s.name = str(`${base} – ${s.floor}`, 40);
          for (const f of extra) {
            const name = str(f.floor, 30).trim() || 'Floor';
            const fs = newScene(`${base} – ${name}`, f.cols || s.cols, f.rows || s.rows);
            fillScene(fs, f.content); syncFog(fs);
            Object.assign(fs, { group: s.group, level: clamp(int(f.level, 1), -9, 9), floor: name, showGrid: s.showGrid });
            state.scenes[fs.id] = fs; state.order.push(fs.id);
          }
          // one at a time, each with the order as far as the DM's screen knows it
          const fresh = state.order.slice(-extra.length), known = state.order.filter((id) => !fresh.includes(id));
          toDMs({ type: 'sceneAdded', scene: s, order: known });
          fresh.forEach((id, i) => toDMs({ type: 'sceneAdded', scene: state.scenes[id], order: [...known, ...fresh.slice(0, i + 1)] }));
          refreshFloors(s.group); save();
          break;
        }
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
        delete s.group; delete s.level; delete s.floor; // a copy is its own map, not another floor
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
        if (WALL_STYLES.includes(msg.wallStyle)) patch.wallStyle = msg.wallStyle;
        if (msg.floor != null && sc.group) patch.floor = str(msg.floor, 30).trim() || sc.floor;
        if (msg.vision && typeof msg.vision === 'object') {
          const v = { on: false, ambient: 'bright', shared: true, explore: true, ...(sc.vision || {}) };
          if ('on' in msg.vision) v.on = !!msg.vision.on;
          if (AMBIENT.includes(msg.vision.ambient)) v.ambient = msg.vision.ambient;
          if ('shared' in msg.vision) v.shared = !!msg.vision.shared;
          if ('explore' in msg.vision) v.explore = !!msg.vision.explore;
          patch.vision = v;
        }
        if (msg.atmo && typeof msg.atmo === 'object') patch.atmo = atmoFields(msg.atmo, sc.atmo);
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
        if (patch.vision) scheduleVision(sc);
        if (patch.floor || patch.name) refreshFloors(sc.group);
        save();
        break;
      }
      case 'floorAdd': { // a new floor above or below this map (making it a building with floors)
        if (!u.isDM || !sc || state.order.length >= 200) return;
        const dir = msg.dir < 0 ? -1 : 1;
        if (!sc.group) { sc.group = uid(); sc.level = 0; sc.floor = 'Ground floor'; toDMs({ type: 'sceneMeta', sceneId: sc.id, patch: { group: sc.group, level: 0, floor: sc.floor } }); }
        const floors = floorsOf(sc), level = dir > 0 ? Math.max(...floors.map((f) => f.level || 0)) + 1 : Math.min(...floors.map((f) => f.level || 0)) - 1;
        const floorName = str(msg.floor, 30).trim() || (level > 0 ? (level === 1 ? 'Upper floor' : `Floor ${level + 1}`) : level === -1 ? 'Cellar' : `Cellar ${-level}`);
        const base = sc.name.replace(/\s+–\s+.*$/, '');
        if (!/\s+–\s+/.test(sc.name)) { sc.name = str(`${base} – ${sc.floor}`, 40); toScene(sc.id, { type: 'sceneMeta', sceneId: sc.id, patch: { name: sc.name } }); }
        const f = newScene(`${base} – ${floorName}`, sc.cols, sc.rows);
        Object.assign(f, { group: sc.group, level, floor: floorName, showGrid: sc.showGrid, diag: sc.diag, vision: { ...(sc.vision || {}) } });
        if (sc.fog) f.fog = { on: sc.fog.on, data: '' };
        if (sc.atmo) f.atmo = atmoFields({ time: sc.atmo.time }); // same time of day on every floor
        state.scenes[f.id] = f;
        const last = Math.max(...floors.map((x) => state.order.indexOf(x.id)));
        state.order.splice(last + 1, 0, f.id);
        toDMs({ type: 'sceneAdded', scene: f, order: state.order });
        refreshFloors(sc.group); save();
        break;
      }
      case 'tokenFloor': { // take a token up or down to another floor of the same building
        if (!sc || !tok) return;
        if (!u.isDM && !(tok.owner && sameName(tok.owner, u.name))) return;
        const to = state.scenes[msg.to];
        if (!to || to === sc || !sc.group || to.group !== sc.group) return;
        delete sc.tokens[tok.id];
        toScene(sc.id, { type: 'removeToken', sceneId: sc.id, id: tok.id });
        if (sc.combat && sc.combat.entries.some((e) => e.id === tok.id)) { sortCombat(sc); sendCombat(sc); }
        tok.x = clamp(tok.x, 0, to.cols - tok.size); tok.y = clamp(tok.y, 0, to.rows - tok.size);
        to.tokens[tok.id] = tok;
        tokenChanged(to, tok, null);
        refreshViews();
        if (visionOn(sc)) scheduleVision(sc); if (visionOn(to)) scheduleVision(to);
        save();
        break;
      }
      case 'sceneDelete':
        if (!u.isDM || !sc || state.order.length <= 1) return;
        delete state.scenes[sc.id];
        state.order = state.order.filter((id) => id !== sc.id);
        toDMs({ type: 'sceneRemoved', sceneId: sc.id, order: state.order });
        if (state.activeScene === sc.id) activate(state.order[0]);
        else refreshViews();
        if (sc.group) refreshFloors(sc.group);
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
          // the DM's rolls stay on the DM's screen unless the DM shows one to the players
          const priv = u.isDM ? !msg.show : !!msg.private;
          const entry = { who: u.name, label: str(msg.label, 30), expr: str(msg.expr, 60), ...r, private: priv, time: Date.now(), skin: skinOf(u.name) };
          state.log.push(entry); state.log = state.log.slice(-200);
          clients().forEach((c) => canSee(c.user, entry) && send(c, { type: 'roll', entry }));
          save();
        } catch (e) { send(ws, { type: 'error', message: e.message }); }
        break;
      case 'chat': { // table talk; whispers go only to who they're for (and the DM); the DM can speak as anyone
        const text = str(msg.text, 1000).trim();
        if (!text) return;
        const now = Date.now();
        if (!u.isDM) { if (now - (u.lastChat || 0) < 100) return; u.lastChat = now; }
        const entry = { kind: 'chat', who: u.name, dm: u.isDM, text, time: now };
        if (Array.isArray(msg.to) && msg.to.length) entry.to = [...new Set(msg.to.map((n) => str(n, 24).trim()).filter(Boolean))].slice(0, 20);
        if (u.isDM && msg.as) entry.as = str(msg.as, 24).trim() || undefined;
        if (u.isDM && msg.narrate && !entry.to) { entry.narrate = true; delete entry.as; } // read aloud to the table
        state.log.push(entry); state.log = state.log.slice(-200);
        clients().forEach((c) => canSee(c.user, entry) && send(c, { type: 'chat', entry }));
        save();
        break;
      }
      case 'ddbImport': { // a player brings in their character from D&D Beyond (the DM's PC fetches it)
        if (u.isDM) return;
        if (u.importing) return send(ws, { type: 'error', message: 'Still reading your character…' });
        u.importing = true; send(ws, { type: 'characterBusy', on: true });
        importCharacter(u, String(msg.link || '').slice(0, 300))
          .then((ch) => { send(ws, { type: 'character', character: ch }); toDMs({ type: 'characters', characters: state.characters }); toDMs({ type: 'note', text: `${u.name} brought in ${ch.name} from D&D Beyond` }); })
          .catch((e) => send(ws, { type: 'error', message: e.message }))
          .finally(() => { u.importing = false; send(ws, { type: 'characterBusy', on: false }); });
        break;
      }
      // ----- 1.12: spells: slots spent, casting, rests -----
      case 'charSlot': { // tick a slot used or free
        if (u.isDM) return; const ch = charOf(u.name); if (!ch) return;
        const list = msg.pact ? ch.pact : ch.slots, sl = (list || []).find((x) => x.level === int(msg.level, 0)); if (!sl) return;
        sl.used = clamp(int(msg.used, 0), 0, sl.max);
        send(ws, { type: 'character', character: ch, quiet: true }); toDMs({ type: 'characters', characters: state.characters }); save();
        break;
      }
      case 'charCast': {
        if (u.isDM) return; const ch = charOf(u.name); if (!ch) return;
        const sp = (ch.spells || []).find((x) => x.name === msg.name); if (!sp) return;
        const spent = spendSpell(ch, sp, msg); if (spent.error) return send(ws, { type: 'error', message: spent.error });
        const at = spent.at;
        const ord = (n) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
        const entry = { kind: 'chat', who: u.name, text: `✨ ${ch.name.split(' ')[0]} casts ${sp.name}${at > sp.level ? ` at ${ord(at)} level` : ''}${sp.save ? ` (${sp.save})` : ''}${msg.ritual ? ' as a ritual' : ''}`, time: Date.now(), cast: true };
        // concentration shows on the caster's token (and ends any earlier spell)
        if (sp.conc && sc) { const notes = startConc(sc, u, ch, sp); if (notes.length) entry.text += ' ' + notes.join(' '); }
        state.log.push(entry); state.log = state.log.slice(-200);
        clients().forEach((c) => send(c, { type: 'chat', entry }));
        send(ws, { type: 'character', character: ch, quiet: true }); toDMs({ type: 'characters', characters: state.characters }); save();
        break;
      }
      case 'charRest': { // short: pact magic back; long: everything back, hit points full, concentration ends
        if (u.isDM) return; const ch = charOf(u.name); if (!ch) return;
        const long = msg.kind === 'long';
        for (const sl of ch.pact || []) sl.used = 0;
        for (const r of ch.resources || []) if (long || r.reset === 'short') r.used = 0;
        if (long && ch.concOn) endConc('p:' + u.name.toLowerCase());
        if (long) for (const hd of ch.hitDice || []) hd.used = 0; // 2024: a long rest gives back every Hit Die
        if (long) { for (const x of invOf(u.name)) if (x.item.charges && x.used) { const back = x.item.charges.regain ? rollDice(x.item.charges.regain).total : x.item.charges.max; x.used = Math.max(0, x.used - back); } sendInv(u.name); } // items' charges come back at dawn
        if (long) { for (const sl of ch.slots || []) sl.used = 0; ch.spellUses = {}; }
        if (long) for (const scn of Object.values(state.scenes)) for (const t of Object.values(scn.tokens)) if (t.owner === u.name && t.ddb === ch.link) {
          const before = { ...t }; if (ch.maxHp) t.maxHp = ch.maxHp; if (t.maxHp) t.hp = t.maxHp; t.tempHp = 0; t.conditions = (t.conditions || []).filter((c) => c !== 'concentrating' && c !== 'unconscious'); tokenChanged(scn, t, before);
        }
        const entry = { kind: 'chat', who: u.name, text: long ? `⛺ ${ch.name.split(' ')[0]} takes a long rest: hit points and spell slots restored` : `☾ ${ch.name.split(' ')[0]} takes a short rest${(ch.pact || []).length ? ': pact slots restored' : ''}`, time: Date.now(), cast: true };
        state.log.push(entry); state.log = state.log.slice(-200); clients().forEach((c) => send(c, { type: 'chat', entry }));
        send(ws, { type: 'character', character: ch, quiet: true }); toDMs({ type: 'characters', characters: state.characters }); save();
        break;
      }
      // ----- 1.13: a spell or class feature that lands on tokens: rolled once here, applied straight away -----
      case 'spellEffect': {
        if (u.isDM || !sc) return; const ch = charOf(u.name); if (!ch) return;
        const first = ch.name.split(' ')[0];
        const raw = (Array.isArray(msg.targets) ? msg.targets : []).filter((id) => typeof id === 'string' && sc.tokens[id] && tokVisible(sc, sc.tokens[id], u)).slice(0, 40);
        const targets = [...new Set(raw)].slice(0, 30).map((id) => sc.tokens[id]);
        const lines = [], rolls = [];
        const rollOut = (expr, label) => { const r = rollDice(expr); const entry = { who: u.name, label: str(label, 30), expr, ...r, private: false, time: Date.now(), skin: skinOf(u.name) }; rolls.push(entry); return r; };
        const nameOf = (t) => t.label || '?';
        const hpNote = (t) => (t.owner ? ` (${t.hp}/${t.maxHp ?? '?'}${t.tempHp ? ' +' + t.tempHp + ' temp' : ''})` : t.hp === 0 ? ' (down)' : '');
        try {
          if (msg.res) { // a class feature: Lay on Hands (an amount from the pool), Second Wind and friends (dice)
            const r = (ch.resources || []).find((x) => x.name === msg.res); if (!r) return;
            if (r.pool) {
              const amt = clamp(int(msg.amount, 0), 1, r.max - r.used); if (!(r.max - r.used)) return send(ws, { type: 'error', message: `${r.name}: the pool is empty until you rest` });
              const t = targets[0]; if (!t) return send(ws, { type: 'error', message: 'Pick who to heal first' });
              r.used += amt; hpTo(sc, t, amt);
              lines.push(`💛 ${first} uses ${r.name} on ${nameOf(t)}: ${amt} hit points${hpNote(t)}. ${r.max - r.used} left in the pool`);
            } else {
              if (r.used >= r.max) return send(ws, { type: 'error', message: `${r.name}: none left until you rest` });
              r.used++;
              const who = r.self ? Object.values(sc.tokens).filter((t) => t.owner === u.name && t.ddb === ch.link).slice(0, 1) : targets;
              if (r.heal && who.length) { const x = rollOut(r.heal, r.name); for (const t of who) { hpTo(sc, t, x.total); lines.push(`💚 ${first} uses ${r.name}: ${nameOf(t)} regains ${x.total} hit points${hpNote(t)}`); } }
              else lines.push(`⭐ ${first} uses ${r.name} (${r.max - r.used}/${r.max} left)`);
            }
          } else {
            const sp = (ch.spells || []).find((x) => x.name === msg.name); if (!sp) return;
            // without casting: a cantrip's roll, or a spell you're concentrating on doing its thing again (Sunbeam, Bigby's Hand…)
            if (!msg.cast && sp.level > 0 && !((sp.cond && sp.cond.again && !sp.conc) || (sp.conc && ch.concOn === sp.name))) return send(ws, { type: 'error', message: `Cast ${sp.name} first` });
            const spent = msg.cast ? spendSpell(ch, sp, msg) : { at: clamp(int(msg.slot, sp.level), sp.level, 9) };
            if (spent.error) return send(ws, { type: 'error', message: spent.error });
            const at = spent.at, up = at - sp.level;
            const casting = `${msg.cast ? '✨' : '🎯'} ${first} ${msg.cast ? 'casts' : 'uses'} ${sp.name}${up > 0 ? ` at ${ORD(at)} level` : ''}`;
            lines.push(casting + (targets.length ? ' on ' + targets.map(nameOf).join(', ') : ''));
            const dc = +((/DC (\d+)/.exec(sp.save || '') || [])[1] || (ch.casting || {}).dc || 10);
            if (sp.conc && msg.cast) lines.push(...startConc(sc, u, ch, sp));
            // what it does beyond damage (conditions and how they end), with the option picked (Eyebite: Asleep, Panicked, Sickened)
            let rule = sp.cond ? { ...sp.cond } : null, name = sp.name;
            if (rule && rule.options) { const o = rule.options[clamp(int(msg.option, 0), 0, rule.options.length - 1)]; rule = { ...rule, ...o, options: undefined }; if (o.name) name = `${sp.name} (${o.name})`; if (!o.add) rule.add = []; }
            const ctx = { by: 'p:' + u.name.toLowerCase(), spell: true, conc: !!sp.conc, dc, rounds: (rule && rule.rounds) || 0, name, shared: {}, roll: (e, l) => rollOut(e, l), lines,
              atk: (l, a) => rolls.push({ who: u.name, label: str(l, 30), expr: a.expr, ...a.r, private: false, time: Date.now(), skin: skinOf(u.name) }) };
            const caster = Object.values(sc.tokens).find((t) => t.owner === u.name && t.ddb === ch.link) || null;
            castSpell(sc, sp, targets, { caster, at, up, dc, mod: ch.casting ? ch.casting.dc - 8 - (ch.prof || 2) : 0, option: msg.option, type: msg.dmgType, raw, first: !!msg.cast, tplOwner: u.name, who: u.name, ws, atk: ch.casting ? ch.casting.attack : 5 }, ctx);
          }
        } catch (e) { return send(ws, { type: 'error', message: e.message }); }
        for (const entry of rolls) { state.log.push(entry); clients().forEach((c) => canSee(c.user, entry) && send(c, { type: 'roll', entry })); }
        const entry = { kind: 'chat', who: u.name, text: lines.join('\n').slice(0, 1500), time: Date.now(), cast: true };
        state.log.push(entry); state.log = state.log.slice(-200); clients().forEach((c) => send(c, { type: 'chat', entry }));
        send(ws, { type: 'character', character: ch, quiet: true }); toDMs({ type: 'characters', characters: state.characters }); save();
        break;
      }
      case 'spellRetry': { // roll a held creature's save now (out of combat, Fear, Compulsion), or its action to break free
        if (!tok || !(u.isDM || (tok.owner && tok.owner === u.name))) return;
        const mk = spellsOn(tok).find((m) => m.by === msg.by && m.spell === msg.spell); if (!mk) return;
        retry(sc, tok, mk, msg.how === 'escape' ? 'escape' : ''); save();
        break;
      }
      case 'lrUse': { // the DM spends a Legendary Resistance: the failed save becomes a success
        if (!u.isDM || !tok || !tok.lrOffer || !(tok.lrLeft > 0)) return;
        const o = tok.lrOffer, before = { ...tok };
        tok.lrLeft--; delete tok.lrOffer;
        liftMarks(tok, (m) => m.by === o.by && m.spell === o.spell);
        if (o.heal) tok.hp = Math.min(tok.maxHp ?? Infinity, (tok.hp ?? 0) + o.heal);
        tokenChanged(sc, tok, before);
        tellAbout(sc, tok, `🛡 ${tok.label || '?'} uses Legendary Resistance: it succeeds against ${o.spell} after all${o.heal ? ' (taking half damage)' : ''}`);
        save();
        break;
      }
      case 'deathSave': { // roll a death save by hand (outside the initiative tracker)
        if (!tok || !(u.isDM || (tok.owner && tok.owner === u.name)) || tok.hp !== 0 || (tok.conditions || []).includes('dead')) return;
        deathSave(sc, tok); save();
        break;
      }
      case 'featEffect': { // a class feature or feat used on creatures: Stunning Strike, Cunning Strike, Turn Undead, Grapple…
        if (u.isDM || !sc) return; const ch = charOf(u.name); if (!ch) return;
        const f = FEATS.FEATURES.find((x) => x.name === msg.name); if (!f || !(ch.features || []).includes(f.name)) return;
        if (f.cost) {
          const r = (ch.resources || []).find((x) => x.name === f.cost || (f.cost === 'Focus Points' && /^(Focus|Ki)/i.test(x.name)));
          if (r) { if (r.used >= r.max) return send(ws, { type: 'error', message: `${r.name}: none left until you rest` }); r.used++; }
        }
        const targets = [...new Set((Array.isArray(msg.targets) ? msg.targets : []).filter((id) => typeof id === 'string'))].slice(0, 30).map((id) => sc.tokens[id]).filter((t) => t && tokVisible(sc, t, u));
        let rule = { ...f }, name = f.name;
        if (rule.options) { const o = rule.options[clamp(int(msg.option, 0), 0, rule.options.length - 1)]; rule = { ...rule, ...o, options: undefined }; name = `${f.name} (${o.name})`; }
        const dc = FEATS.dcFor(ch, f.dc), lines = [`⚔ ${ch.name.split(' ')[0]} uses ${name}${targets.length ? ' on ' + targets.map((t) => t.label || '?').join(', ') : ''} (DC ${dc})`], rolls = [];
        const ctx = { by: 'p:' + u.name.toLowerCase(), spell: false, dc, rounds: f.rounds || 0, name, shared: {}, lines, roll: (e, l) => { const r = rollDice(e); rolls.push({ who: u.name, label: str(l, 30), expr: e, ...r, private: false, time: Date.now(), skin: skinOf(u.name) }); return r; } };
        for (const t of targets) landOn(sc, t, { ...rule, save: rule.save ? { abl: rule.save, dc } : null, fail: rule.dice ? [{ dice: rule.dice, type: rule.type }] : [] }, ctx);
        for (const r of rolls) post(r);
        post({ kind: 'chat', who: u.name, text: lines.join('\n').slice(0, 1500), time: Date.now(), cast: true });
        send(ws, { type: 'character', character: ch, quiet: true }); toDMs({ type: 'characters', characters: state.characters }); save();
        break;
      }
      case 'monsterEffect': { // the DM uses a monster's action on tokens: its attack (secret), the target's save, damage and conditions
        if (!u.isDM || !sc) return;
        const src = sc.tokens[msg.src], m = src ? srdOf(src) : null; if (!m) return send(ws, { type: 'error', message: 'Select the monster on the map first' });
        const list = { actions: m.actions, bonus: m.bonus, legendary: m.legendary, reactions: m.reactions, traits: m.traits }[msg.kind] || [], act = list[int(msg.idx, -1)]; if (!act) return;
        const targets = [...new Set((Array.isArray(msg.targets) ? msg.targets : []).filter((id) => typeof id === 'string'))].slice(0, 30).map((id) => sc.tokens[id]).filter(Boolean);
        const who = src.label || m.name, lines = [], dmRolls = [], meta = FX.meta(act, m), short = act.n.replace(/\s*\(.*?\)\s*$/, '');
        // how often: Recharge 5–6, 3/Day, after a rest, legendary actions left this round
        src.uses = src.uses || {};
        if ((meta.recharge || meta.rest) && src.uses[short] === 'spent') return send(ws, { type: 'error', message: `${who}'s ${short} ${meta.recharge ? 'is recharging (it rolls at the start of its turns)' : 'comes back after a rest'}` });
        if (meta.perDay && (src.uses[short] || 0) >= meta.perDay) return send(ws, { type: 'error', message: `${who} has used ${short} ${meta.perDay} times today` });
        if (msg.kind === 'legendary') {
          const max = FX.legendaryCount(m); if (src.legLeft == null) src.legLeft = max;
          const cost = meta.cost || 1; if (src.legLeft < cost) return send(ws, { type: 'error', message: `${who} has ${src.legLeft} legendary action${src.legLeft === 1 ? '' : 's'} left this round` });
          src.legLeft -= cost; lines.push(`(${src.legLeft} legendary action${src.legLeft === 1 ? '' : 's'} left)`);
        }
        if (meta.recharge || meta.rest) src.uses[short] = 'spent'; else if (meta.perDay) src.uses[short] = (src.uses[short] || 0) + 1;
        const roll = (e, l) => { const r = rollDice(e); dmRolls.push({ who: 'Monsters', to: ['DM'], label: str(`${who}: ${l}`, 30), expr: e, ...r, private: false, time: Date.now() }); return r; };
        // one action on its targets (a Multiattack runs each of its attacks in turn, sharing out the targets)
        const useOne = (a, tlist, variant) => {
          const P = FX.parse(a.d, m.name, msg.kind), v = P.variants[clamp(int(variant, 0), 0, Math.max(0, P.variants.length - 1))] || null, am = FX.meta(a, m);
          const name = a.n.replace(/\s*\(.*?\)\s*$/, '') + (v && P.variants.length > 1 ? ` (${v.name})` : '');
          const ctx = { by: 't:' + src.id, spell: /\bspell\b/i.test(a.d) && msg.kind !== 'actions', dc: v && v.save ? v.save.dc : 10, rounds: (v && v.rounds) || 0, name: `${who}'s ${name}`, shared: {}, roll, lines };
          for (const t of tlist) {
            if (P.attack != null) { // the attack roll stays with the DM; the table hears hit or miss
              const melee = msg.opp || /Melee/i.test(a.d) && !/^Ranged/i.test(a.d.trim()) && !(/Ranged Weapon Attack/i.test(a.d) && !/Melee or Ranged/i.test(a.d)) && (!am.range || sqDist(src, t) <= Math.max(1, (am.reach || 5) / 5));
              const at = attackRoll(sc, src, t, P.attack, { melee, range: melee ? null : am.range, reach: msg.opp ? 999 : melee ? am.reach || 5 : null, weapon: a.n });
              if (msg.opp) lines.push(`⚔ Opportunity attack as ${t.label || '?'} leaves`);
              if (at.blocked || at.duplicate) { lines.push(missWhy(at, t.label || '?')); continue; }
              dmRolls.push({ who: 'Monsters', to: ['DM'], label: str(`${who}: ${name} → ${t.label || '?'}`, 30), expr: at.expr, ...at.r, private: false, time: Date.now() });
              if (!at.hit) { lines.push(`💨 ${who}'s ${name} misses ${t.label || '?'}`); continue; }
              const crit = at.crit; let dealt = 0; const parts = [];
              for (const d of P.hit) { const x = roll(crit ? doubleDice(d.dice) : d.dice, `${name} damage`), k = takes(t, d.type, false), n = reduceBy(sc, t, Math.floor(x.total * k), d.type); dealt += n; parts.push(`${n} ${d.type}`); }
              const back = retaliate(sc, src, t, melee); // while it still has Armor of Agathys's temporary hit points
              if (dealt) hpTo(sc, t, -dealt, 0, { crit });
              lines.push(`🗡 ${who}'s ${name} hits ${t.label || '?'}${crit ? ' (critical!)' : ''}${parts.length ? ': ' + parts.join(' + ') + ' damage' : ''}${isPC(t) ? ` (${t.hp}/${t.maxHp ?? '?'})` : ''}${back}`);
            }
            if (v) landOn(sc, t, { ...v }, ctx);
          }
        };
        if (meta.multi && meta.multi.length) {
          let i = 0;
          for (const part of meta.multi) for (let k = 0; k < part.n; k++) {
            const a = (m.actions || []).find((y) => y.n.replace(/\s*\(.*?\)\s*$/, '') === part.name); if (!a || !targets.length) continue;
            const isSave = !/to hit|Attack Roll/i.test(a.d); // Frightful Presence and the like reach everyone chosen
            useOne(a, isSave ? targets : [targets[i++ % targets.length]], 0);
          }
        } else useOne(act, targets, msg.variant);
        for (const r of dmRolls) post(r);
        const name = short + (msg.variant != null && FX.parse(act.d, m.name, msg.kind).variants.length > 1 ? ` (${(FX.parse(act.d, m.name, msg.kind).variants[int(msg.variant, 0)] || {}).name || ''})` : '');
        post({ kind: 'chat', who: 'Monsters', ...(src.hidden ? { to: ['DM'] } : {}), text: (`⚔ ${who} uses ${name}${targets.length ? ' on ' + targets.map((t) => t.label || '?').join(', ') : ''}\n` + lines.join('\n')).slice(0, 1500), time: Date.now(), cast: true });
        toDMs({ type: 'token', sceneId: sc.id, token: src });
        save();
        break;
      }
      case 'dmSpell': { // the DM casts a spell: a monster from its Spellcasting, or a wand, scroll or trap; its rolls stay secret
        if (!u.isDM || !sc) return;
        const e = RULES.dbSpell(msg.spell); if (!e) return send(ws, { type: 'error', message: `No spell called ${str(msg.spell, 40)}` });
        const src = msg.src && sc.tokens[msg.src] || null, m = src ? srdOf(src) : null, scs = m ? FX.spellcasting(m) : [], tr = scs.find((x) => x.dc) || {};
        const ABLI = { STR: 0, DEX: 1, CON: 2, INT: 3, WIS: 4, CHA: 5 }, mod = m && tr.ability ? Math.floor(((m.abl || [])[ABLI[tr.ability]] - 10) / 2) : 0;
        const dc = clamp(int(msg.dc, tr.dc || 13), 1, 40), attack = clamp(int(msg.attack, tr.attack != null ? tr.attack : 5), -5, 30);
        const sp = RULES.fromDb(e, { dc, attack, mod, level: tr.level || (m ? Math.max(1, Math.round(m.cr || 1)) : 5) });
        const at = clamp(int(msg.level, sp.level), sp.level, 9), up = at - sp.level;
        const targets = [...new Set((Array.isArray(msg.targets) ? msg.targets : []).filter((id) => typeof id === 'string'))].slice(0, 40).map((id) => sc.tokens[id]).filter(Boolean);
        const raw = (Array.isArray(msg.targets) ? msg.targets : []).filter((id) => typeof id === 'string' && sc.tokens[id]).slice(0, 40);
        const who = src ? src.label || m && m.name || '?' : 'The DM', lines = [`✨ ${who} ${msg.again ? 'uses' : 'casts'} ${sp.name}${up > 0 ? ` at ${ORD(at)} level` : ''}${targets.length ? ' on ' + targets.map((t) => t.label || '?').join(', ') : ''}`];
        const secret = (l, x) => post({ who: 'Monsters', to: ['DM'], label: str(`${who}: ${l}`, 30), expr: x.expr || '', ...(x.r || x), private: false, time: Date.now() });
        const by = src ? 't:' + src.id : 'dm';
        // a monster concentrating: its earlier spell ends, the ring goes on its token
        if (sp.conc && src && !msg.again) {
          if ((src.conditions || []).includes('concentrating')) { const r = endConc(by); if (r.spell) lines.push(`(${r.spell} ends${r.freed.length ? ' for ' + r.freed.join(', ') : ''})`); }
          const b = { ...src }; src.concOn = sp.name; src.conditions = [...new Set([...(src.conditions || []), 'concentrating'])]; tokenChanged(sc, src, b);
        }
        const ctx = { by, spell: true, conc: !!sp.conc, dc, rounds: (sp.cond && sp.cond.rounds) || 0, name: sp.name, shared: {}, lines,
          roll: (ex, l) => { const r = rollDice(ex); secret(l, { expr: ex, r }); return r; }, atk: (l, a) => secret(l, a) };
        try { castSpell(sc, sp, targets, { caster: src, at, up, dc, mod, option: msg.option, type: msg.dmgType, raw, first: !msg.again, tplOwner: '', who: '', ws, atk: attack }, ctx); } catch (err) { return send(ws, { type: 'error', message: err.message }); }
        post({ kind: 'chat', who: 'Monsters', ...(src && src.hidden ? { to: ['DM'] } : {}), text: lines.join('\n').slice(0, 1500), time: Date.now(), cast: true });
        save();
        break;
      }
      case 'attackEffect': { // a player's weapon attack on a token: Advantage and Disadvantage, AC, crits, Hex, Hunter's Mark, Divine Favor
        if (u.isDM || !sc) return; const ch = charOf(u.name); if (!ch) return;
        let w0 = (ch.attacks || []).find((x) => x.name === msg.name && x.damage);
        // a weapon the DM made: its dice and bonus, with Strength, Dexterity (or the better, for finesse) or your spellcasting ability
        const invW = msg.inv && invOf(u.name).find((y) => y.id === msg.inv && y.item.kind === 'weapon');
        if (invW) {
          const W = invW.item.weapon, A = (ch.abilities || []).map((x) => x.mod || 0), abil = W.ability === 'DEX' ? A[1] : W.ability === 'finesse' ? Math.max(A[0], A[1]) : W.ability === 'spell' ? (ch.casting ? ch.casting.attack - (ch.prof || 2) : A[0]) : A[0];
          if (invW.item.charges && msg.useCharge) { if (invW.used >= invW.item.charges.max) return send(ws, { type: 'error', message: `${invW.item.name} has no charges left` }); invW.used++; sendInv(u.name); }
          w0 = { name: invW.item.name, base: invW.item.name, mastery: W.mastery || '', hit: '1d20' + sgnS(abil + (ch.prof || 2) + W.bonus), damage: W.dice + sgnS(abil + W.bonus).replace(/^\+0$/, ''), type: W.type, mod: abil + W.bonus, range: W.range, ranged: !!W.range && W.ability === 'DEX', reach: W.reach, extra: W.extra };
        }
        if (!w0) return; const w = { ...w0 };
        const t = sc.tokens[msg.target]; if (!t || !tokVisible(sc, t, u)) return;
        const me = Object.values(sc.tokens).find((x) => x.owner === u.name && x.ddb === ch.link) || null, key = 'p:' + u.name.toLowerCase();
        const lines = [], rolls = [], R2 = (ex, l) => { const r = rollDice(ex); rolls.push({ who: u.name, label: str(l, 30), expr: ex, ...r, private: false, time: Date.now(), skin: skinOf(u.name) }); return r; };
        const melee = w.ranged === true ? false : w.ranged === false ? true : !/bow|crossbow|sling|dart|blowgun|javelin|net/i.test(w.name) || (me && Math.max(Math.abs(me.x - t.x), Math.abs(me.y - t.y)) <= 1);
        const plus = (me ? spellsOn(me).reduce((n, mk) => n + (mk.weaponHit || 0), 0) : 0) + ((me && gearOf(me)) || { attack: 0 }).attack;
        // True Strike: the weapon, but your spellcasting ability for the attack and damage, and Radiant damage if you like
        const ts = !!msg.trueStrike && (ch.spells || []).some((x) => /^true strike$/i.test(x.name)), smod = ch.casting ? ch.casting.attack - (ch.prof || 2) : 0;
        if (ts) { w.hit = '1d20' + sgnS(ch.casting ? ch.casting.attack : 0); w.damage = (/^\d+d\d+/.exec(w.damage) || ['1'])[0] + sgnS(smod); if (msg.radiant) w.type = 'Radiant'; }
        const range = (() => { const m = /(\d+)\/(\d+)/.exec(w.range || w.name || ''); return m ? { normal: +m[1], long: +m[2] } : null; })();
        const a = attackRoll(sc, me, t, plus ? w.hit + sgnS(plus) : w.hit, msg.opp ? { melee: true, weapon: w.name, reach: 999 } : { melee, range, weapon: w.name, reach: w.reach });
        if (msg.opp) lines.push(`⚔ Opportunity attack as ${t.label || '?'} leaves`);
        if (a.blocked || a.duplicate) { post({ kind: 'chat', who: u.name, text: missWhy(a, t.label || '?'), time: Date.now(), cast: true }); save(); break; }
        rolls.push({ who: u.name, label: str(`${w.name} → ${t.label || '?'}`, 30), expr: a.expr, ...a.r, private: false, time: Date.now(), skin: skinOf(u.name) });
        const mastery = ch.mastery && !ts ? (w.mastery || FEATS.masteryOf(w.base || w.name)) : '';
        if (!a.hit) {
          lines.push(`💨 ${ch.name.split(' ')[0]}'s ${w.name} misses ${t.label || '?'} (${a.total} vs AC ${a.ac}${a.mode ? ', ' + (a.mode === 'adv' ? 'Advantage' : 'Disadvantage') : ''})`);
          if (mastery === 'Graze' && (w.mod || 0) > 0) { const n = reduceBy(sc, t, Math.floor((w.mod || 0) * takes(t, String(w.type || '').toLowerCase(), false)), String(w.type || '').toLowerCase()); hpTo(sc, t, -n); lines.push(`🗡 Graze: ${t.label || '?'} still takes ${n} ${String(w.type || '').toLowerCase()} damage`); }
        }
        else {
          const parts = [{ dice: w.damage, type: String(w.type || '').toLowerCase() }];
          // Hex and Hunter's Mark on this target from this character, Divine Favor and Elemental Weapon on the character
          for (const mk of spellsOn(t)) if (mk.by === key && mk.c === 'hexed') parts.push({ dice: '1d6', type: 'necrotic', from: 'Hex' }); else if (mk.by === key && mk.c === 'marked' && /hunter/i.test(mk.spell)) parts.push({ dice: '1d6', type: 'force', from: "Hunter's Mark" });
          if (me) for (const mk of spellsOn(me)) if (mk.weaponDmg) parts.push({ ...mk.weaponDmg, type: mk.weaponDmg.type || parts[0].type, from: mk.spell });
          if (w.extra) parts.push({ dice: w.extra.dice, type: w.extra.type, from: w.name });
          if (ts) { const lv = RULES.levelOf(ch), n = lv >= 17 ? 3 : lv >= 11 ? 2 : lv >= 5 ? 1 : 0; if (n) parts.push({ dice: n + 'd6', type: 'radiant', from: 'True Strike' }); }
          let dealt = 0; const bits = [];
          for (const d of parts) { const x = R2(a.crit ? doubleDice(d.dice) : d.dice, `${d.from || w.name} damage`), k = takes(t, d.type, false), n = reduceBy(sc, t, Math.max(0, Math.floor(x.total * k)), d.type); dealt += n; bits.push(`${n} ${d.type}${d.from ? ' (' + d.from + ')' : ''}${k === 0 ? ' (immune)' : k === 0.5 ? ' (resists)' : k === 2 ? ' (vulnerable)' : ''}`); }
          const back = retaliate(sc, me, t, melee);
          // knocking a creature out: a melee attack that drops it leaves it unconscious and stable instead
          if (msg.knockout && melee && dealt >= (t.hp ?? 0) && (t.hp ?? 0) > 0) { const b0 = { ...t }; t.hp = 0; t.conditions = [...new Set([...(t.conditions || []).filter((x) => x !== 'dead'), 'unconscious'])]; t.death = { s: 0, f: 0, stable: true }; tokenChanged(sc, t, b0); lines.push(`😵 ${t.label || '?'} is knocked out: unconscious and stable`); dealt = 0; }
          else hpTo(sc, t, -dealt, 0, { crit: a.crit });
          lines.push(`🗡 ${ch.name.split(' ')[0]}'s ${w.name} hits ${t.label || '?'}${a.crit ? ' (critical!)' : ` (${a.total} vs AC ${a.ac})`}: ${bits.join(' + ')} damage${isPC(t) ? ` (${t.hp}/${t.maxHp ?? '?'})` : t.hp === 0 ? ' (down)' : ''}${back}`);
          // Weapon Mastery: what the weapon does on a hit
          if (mastery && t.hp > 0) {
            const k = 'p:' + u.name.toLowerCase(), dcM = 8 + (ch.prof || 2) + (w.mod || 0);
            if (mastery === 'Sap') { putOn(sc, t, { add: ['sapped'], expire: 'srcStart' }, { by: k, spell: 'Sap', dc: 0 }); lines.push(`⚔ Sap: ${t.label || '?'} has Disadvantage on its next attack`); }
            else if (mastery === 'Slow') { putOn(sc, t, { add: ['hobbled'], expire: 'srcStart' }, { by: k, spell: 'Slow (weapon)', dc: 0 }); lines.push(`⚔ Slow: ${t.label || '?'}'s Speed is 10 feet lower until your next turn`); }
            else if (mastery === 'Vex') { putOn(sc, t, { add: ['vexed'], expire: 'srcEnd' }, { by: k, spell: 'Vex', dc: 0 }); lines.push(`⚔ Vex: your next attack on ${t.label || '?'} has Advantage`); }
            else if (mastery === 'Topple') { const sv = saveRoll(sc, t, 'CON', { dc: dcM }); if (sv.r) showRoll(t, { label: 'Topple: CON save', expr: sv.expr, ...sv.r }); if (!sv.ok) { const b0 = { ...t }; t.conditions = [...new Set([...(t.conditions || []), 'prone'])]; tokenChanged(sc, t, b0); } lines.push(sv.ok ? `⚔ Topple: ${t.label || '?'} keeps its feet` : `⚔ Topple: ${t.label || '?'} is knocked prone`); }
            else if (mastery === 'Push') { const n = t.size <= 2 && me ? pushAway(sc, me, t, 2) : 0; lines.push(n ? `⚔ Push: ${t.label || '?'} is pushed ${n * 5} feet away` : `⚔ Push: ${t.label || '?'} can't be pushed${t.size > 2 ? ' (too big)' : ''}`); }
            else if (mastery === 'Cleave') lines.push(`⚔ Cleave: you can attack another creature within 5 feet of ${t.label || '?'} (once a turn, no ability bonus to its damage)`);
            else if (mastery === 'Nick') lines.push('⚔ Nick: your Light weapon\'s extra attack is part of this Attack action');
          }
        }
        for (const r of rolls) post(r);
        post({ kind: 'chat', who: u.name, text: lines.join('\n'), time: Date.now(), cast: true });
        save();
        break;
      }
      // ----- 1.18: the actions anyone can take, and the other combat rules from the books -----
      case 'combatAction': { // Dodge, Disengage, Help, Hide, Dash, Ready: by the DM for any token, by a player for their own
        if (!tok || !(u.isDM || (tok.owner && tok.owner === u.name))) return;
        const who = tok.label || '?', act = String(msg.action || ''), k = keyOf(tok), target = msg.target && sc.tokens[msg.target];
        let text = '';
        if (act === 'dodge') { putOn(sc, tok, { add: ['dodging'], expire: 'tgtStart' }, { by: k, spell: 'Dodge', dc: 0 }); text = `🛡 ${who} takes the Dodge action: attacks against it have Disadvantage and it has Advantage on Dexterity saves until its next turn`; }
        else if (act === 'disengage') { putOn(sc, tok, { add: ['disengaged'], expire: 'thisTurn' }, { by: k, spell: 'Disengage', dc: 0 }); text = `🏃 ${who} Disengages: no opportunity attacks against it this turn`; }
        else if (act === 'help') { if (!target) return send(ws, { type: 'error', message: 'Pick the foe to help against' }); putOn(sc, target, { add: ['distracted'], expire: 'srcStart' }, { by: k, spell: 'Help', dc: 0 }); text = `🤝 ${who} Helps: the next attack against ${target.label || '?'} by an ally has Advantage`; }
        else if (act === 'hide') {
          const ch = charForToken(tok), m = srdOf(tok); let bonus = 0;
          if (ch) { const sk = (ch.skills || []).find((x) => x.name === 'Stealth'); bonus = sk ? sk.bonus : ((ch.abilities || [])[1] || {}).mod || 0; } else if (m) { const h = /Stealth ([+-]\d+)/.exec(m.skills || ''); bonus = h ? +h[1] : Math.floor(((m.abl || [])[1] - 10) / 2) || 0; }
          const r = rollDice('1d20' + sgnS(bonus)); showRoll(tok, { label: 'Hide: Stealth', expr: '1d20' + sgnS(bonus), ...r });
          if (r.total >= 15) { const b = { ...tok }; tok.conditions = [...new Set([...(tok.conditions || []), 'hidden'])]; tokenChanged(sc, tok, b); text = `🫥 ${who} hides (${r.total} against DC 15): it's unseen until it attacks or is found`; } else text = `👀 ${who} tries to hide but is seen (${r.total})`;
        }
        else if (act === 'dash') text = `🏃 ${who} Dashes: double movement this turn`;
        else if (act === 'ready') text = `⏳ ${who} Readies an action: it uses its Reaction when the trigger happens`;
        else return;
        tellAbout(sc, tok, text); save();
        break;
      }
      case 'stabilize': { // a Wisdom (Medicine) check, DC 10, to stabilise a dying creature
        if (!tok || tok.hp !== 0 || (tok.conditions || []).includes('dead') || (tok.death && tok.death.stable)) return;
        const ch = u.isDM ? null : charOf(u.name), sk = ch && (ch.skills || []).find((x) => x.name === 'Medicine'), bonus = sk ? sk.bonus : ch ? ((ch.abilities || [])[4] || {}).mod || 0 : 0;
        const r = rollDice('1d20' + sgnS(bonus)), helper = ch ? ch.name.split(' ')[0] : 'The DM';
        post({ who: u.name, label: 'Medicine (stabilise)', expr: '1d20' + sgnS(bonus), ...r, private: false, time: Date.now(), skin: skinOf(u.name), ...(u.isDM ? { to: ['DM'] } : {}) });
        if (r.total >= 10) { const b = { ...tok }; tok.death = { ...(tok.death || { s: 0, f: 0 }), stable: true }; tokenChanged(sc, tok, b); tellAbout(sc, tok, `🩹 ${helper} stabilises ${tok.label || '?'} (${r.total})`); }
        else tellAbout(sc, tok, `✖ ${helper} fails to stabilise ${tok.label || '?'} (${r.total} against DC 10)`);
        save();
        break;
      }
      case 'hitDie': { // spend a Hit Die on a short rest: the die plus Constitution back
        if (u.isDM) return; const ch = charOf(u.name); if (!ch || !sc) return;
        const hd = (ch.hitDice || []).find((x) => x.used < x.max && (!msg.die || x.die === int(msg.die, 0))); if (!hd) return send(ws, { type: 'error', message: 'No Hit Dice left until a long rest' });
        const con = ((ch.abilities || [])[2] || {}).mod || 0, r = rollDice('1d' + hd.die + sgnS(con)), amt = Math.max(1, r.total); hd.used++;
        post({ who: u.name, label: 'Hit Die', expr: '1d' + hd.die + sgnS(con), ...r, private: false, time: Date.now(), skin: skinOf(u.name) });
        const t = Object.values(sc.tokens).find((x) => x.owner === u.name && x.ddb === ch.link); if (t) hpTo(sc, t, amt);
        post({ kind: 'chat', who: u.name, text: `🎲 ${ch.name.split(' ')[0]} spends a Hit Die (d${hd.die}) and regains ${amt} hit points${t ? ` (${t.hp}/${t.maxHp})` : ''}`, time: Date.now(), cast: true });
        send(ws, { type: 'character', character: ch, quiet: true }); toDMs({ type: 'characters', characters: state.characters }); save();
        break;
      }
      case 'hazard': { // falling: 1d6 bludgeoning per 10 feet (at most 20d6), and prone if it took damage
        if (!u.isDM || !sc) return;
        const ts = (Array.isArray(msg.ids) ? msg.ids : [msg.id]).map((id) => sc.tokens[id]).filter(Boolean).slice(0, 30); if (!ts.length) return;
        const feet = clamp(int(msg.feet, 10), 0, 1000), n = Math.min(20, Math.floor(feet / 10)), lines = [`🪂 A fall of ${feet} feet`];
        for (const t of ts) {
          if (!n) { lines.push(`${t.label || '?'}: no damage`); continue; }
          const r = rollDice(n + 'd6'); post({ who: 'Monsters', to: ['DM'], label: `Fall: ${t.label || '?'}`.slice(0, 30), expr: n + 'd6', ...r, private: false, time: Date.now() });
          const dealt = Math.floor(r.total * takes(t, 'bludgeoning', false)); hpTo(sc, t, -dealt);
          if (dealt) { const b = { ...t }; t.conditions = [...new Set([...(t.conditions || []), 'prone'])]; tokenChanged(sc, t, b); }
          lines.push(`💥 ${t.label || '?'}: ${dealt} bludgeoning damage${dealt ? ', lands prone' : ''}${isPC(t) ? ` (${t.hp}/${t.maxHp ?? '?'})` : ''}`);
        }
        post({ kind: 'chat', who: 'Monsters', text: lines.join('\n'), time: Date.now(), cast: true }); save();
        break;
      }
      case 'sceneFlags': { // the DM's combat options for this map: under water, the optional flanking rule
        if (!u.isDM || !sc) return;
        if ('underwater' in msg) sc.underwater = !!msg.underwater;
        if ('flanking' in msg) sc.flanking = !!msg.flanking;
        toScene(sc.id, { type: 'sceneFlags', sceneId: sc.id, underwater: !!sc.underwater, flanking: !!sc.flanking }); save();
        break;
      }
      case 'monsterRest': { // a new day: every monster on this map gets its daily and rest-recharged uses back
        if (!u.isDM || !sc) return;
        for (const t of Object.values(sc.tokens)) if (t.uses || t.lrLeft != null) { delete t.uses; delete t.lrLeft; toDMs({ type: 'token', sceneId: sc.id, token: t }); }
        post({ kind: 'chat', who: 'Monsters', to: ['DM'], text: '🌅 The monsters on this map have their daily uses, rest abilities and Legendary Resistances back', time: Date.now(), cast: true }); save();
        break;
      }
      // ----- items the DM makes and hands out -----
      case 'itemSave': { // the DM makes or changes an item in the item list
        if (!u.isDM || !msg.item) return;
        const id = typeof msg.item.id === 'string' && /^[a-z0-9]{4,16}$/.test(msg.item.id) ? msg.item.id : uid();
        if (!state.items[id] && Object.keys(state.items).length >= 500) return send(ws, { type: 'error', message: 'That\'s 500 items already' });
        state.items[id] = { id, ...itemFields(msg.item) };
        toDMs({ type: 'items', items: state.items }); save();
        break;
      }
      case 'itemDelete': { if (!u.isDM) return; delete state.items[msg.id]; toDMs({ type: 'items', items: state.items }); save(); break; }
      case 'itemGive': { // the DM gives an item (a copy, so changing the list later doesn't change what they hold) to a player
        if (!u.isDM) return; const it = state.items[msg.id], name = str(msg.player, 24).trim(); if (!it || !name) return;
        const inv = invOf(name), qty = clamp(int(msg.qty, 1), 1, 99);
        const same = inv.find((x) => x.item.name === it.name && ['potion', 'scroll', 'gear'].includes(it.kind));
        if (same) same.qty += qty; else { if (inv.length >= 100) return; inv.push({ id: uid(), item: JSON.parse(JSON.stringify(it)), qty, used: 0, equipped: false }); }
        sendInv(name);
        for (const c of clients()) if (!c.user.isDM && c.user.name.toLowerCase() === name.toLowerCase()) send(c, { type: 'note', text: `🎁 The DM gives you ${qty > 1 ? qty + ' × ' : ''}${it.name}` });
        post({ kind: 'chat', who: 'DM', to: [name], text: `🎁 ${name} receives ${qty > 1 ? qty + ' × ' : ''}${it.name}`, time: Date.now(), cast: true });
        save(); break;
      }
      case 'itemTake': { if (!u.isDM) return; const inv = invOf(str(msg.player, 24)); const i = inv.findIndex((x) => x.id === msg.inv); if (i >= 0) inv.splice(i, 1); sendInv(msg.player); save(); break; }
      case 'itemEquip': { // wear it or not: armour, a shield, a cloak or ring with bonuses
        if (u.isDM) return; const x = invOf(u.name).find((y) => y.id === msg.inv); if (!x) return;
        x.equipped = !!msg.on;
        if (x.equipped && x.item.kind === 'armor') for (const y of invOf(u.name)) if (y !== x && y.item.kind === 'armor') y.equipped = false;
        sendInv(u.name);
        if (sc) for (const t of Object.values(sc.tokens)) if (t.owner === u.name && charForToken(t)) { tokenChanged(sc, t, { ...t }); send(ws, { type: 'note', text: `${x.equipped ? 'Wearing' : 'Took off'} ${x.item.name}: your AC is ${acOf(t)}` }); break; }
        save(); break;
      }
      case 'itemDrop': { if (u.isDM) return; const inv = invOf(u.name), i = inv.findIndex((y) => y.id === msg.inv); if (i >= 0) inv.splice(i, 1); sendInv(u.name); save(); break; }
      case 'itemUse': { // drink a potion, read a scroll, use a wand's charge, a wondrous item's effect
        if (u.isDM || !sc) return; const ch = charOf(u.name); if (!ch) return send(ws, { type: 'error', message: 'Bring in your character first' });
        const x = invOf(u.name).find((y) => y.id === msg.inv); if (!x) return; const it = x.item;
        if (it.charges && x.used >= it.charges.max) return send(ws, { type: 'error', message: `${it.name} has no charges left` });
        const me = Object.values(sc.tokens).find((t) => t.owner === u.name && t.ddb === ch.link) || null;
        let targets = [...new Set((Array.isArray(msg.targets) ? msg.targets : []).filter((id) => typeof id === 'string'))].slice(0, 30).map((id) => sc.tokens[id]).filter((t) => t && tokVisible(sc, t, u));
        const raw = (Array.isArray(msg.targets) ? msg.targets : []).filter((id) => typeof id === 'string' && sc.tokens[id]).slice(0, 40);
        const first = ch.name.split(' ')[0], lines = [], rolls = [], key = 'p:' + u.name.toLowerCase();
        const R2 = (e, l) => { const r = rollDice(e); rolls.push({ who: u.name, label: str(l, 30), expr: e, ...r, private: false, time: Date.now(), skin: skinOf(u.name) }); return r; };
        if (it.kind === 'potion') {
          if (!targets.length && me) targets = [me];
          const t = targets[0]; if (!t) return send(ws, { type: 'error', message: 'Put your token on the map first' });
          lines.push(`🧪 ${first} ${t === me ? 'drinks' : 'gives ' + (t.label || '?')} ${it.name}`);
          if (it.potion.heal) { const r = R2(it.potion.heal, it.name); hpTo(sc, t, r.total); lines.push(`💚 ${t.label || '?'} regains ${r.total} hit points (${t.hp}/${t.maxHp ?? '?'})`); }
          if (it.potion.temp) { const r = /d/.test(it.potion.temp) ? R2(it.potion.temp, it.name) : { total: +it.potion.temp }; hpTo(sc, t, 0, r.total); lines.push(`🛡 ${t.label || '?'} gains ${r.total} temporary hit points`); }
          if ((it.potion.cures || []).some((c) => (t.conditions || []).includes(c))) { const b = { ...t }; liftMarks(t, (m) => it.potion.cures.includes(m.c)); t.conditions = (t.conditions || []).filter((c) => !it.potion.cures.includes(c)); tokenChanged(sc, t, b); lines.push(`✨ ${t.label || '?'}: no longer ${it.potion.cures.map(condName).join(' or ')}`); }
          if (it.potion.resist) { putOn(sc, t, { add: ['warded'], rounds: 600 }, { by: key, spell: it.name, dc: 0 }); (t.marks || []).forEach((m) => { if (m.spell === it.name) m.potionResist = it.potion.resist; }); lines.push(`🛡 ${t.label || '?'} resists ${it.potion.resist} damage for an hour`); }
          x.qty--; if (x.qty <= 0) invOf(u.name).splice(invOf(u.name).indexOf(x), 1);
        } else if ((it.kind === 'scroll' || it.kind === 'wand') && it.spell) {
          const e = RULES.dbSpell(it.spell.name); if (!e) return;
          const dc = it.spell.dc === 'yours' ? (ch.casting || {}).dc || 13 : it.spell.dc, attack = it.spell.attack === 'yours' ? (ch.casting || {}).attack || 5 : it.spell.attack;
          const sp = RULES.fromDb(e, { dc, attack, mod: ch.casting ? ch.casting.dc - 8 - (ch.prof || 2) : 0, level: RULES.levelOf(ch) }), at = Math.max(sp.level, it.spell.level || sp.level);
          lines.push(`${it.kind === 'scroll' ? '📜' : '🪄'} ${first} uses ${it.name}: ${sp.name}${at > sp.level ? ` at ${ORD(at)} level` : ''}${targets.length ? ' on ' + targets.map((t) => t.label || '?').join(', ') : ''}`);
          if (sp.conc) lines.push(...startConc(sc, u, ch, sp));
          const ctx = { by: key, spell: true, conc: !!sp.conc, dc, rounds: (sp.cond && sp.cond.rounds) || 0, name: sp.name, shared: {}, roll: R2, lines, atk: (l, a) => rolls.push({ who: u.name, label: str(l, 30), expr: a.expr, ...a.r, private: false, time: Date.now(), skin: skinOf(u.name) }) };
          castSpell(sc, sp, targets, { caster: me, at, up: at - sp.level, dc, mod: 0, option: msg.option, type: msg.option, raw, first: true, tplOwner: u.name, who: u.name, ws, atk: attack }, ctx);
          if (it.kind === 'scroll') { x.qty--; if (x.qty <= 0) invOf(u.name).splice(invOf(u.name).indexOf(x), 1); } else x.used++;
        } else if (it.kind === 'wondrous' && it.effect) {
          const ef = it.effect, rule = { add: [ef.cond], save: ef.save };
          if (ef.how === 'end') rule.end = true; else if (ef.how === 'start') rule.start = true; else if (ef.how === 'hurtEnd') rule.hurt = 'end'; else if (ef.how === 'athletics' || ef.how === 'grapple') { rule.escape = ef.how; rule.escapeDc = ef.dc; } else if (ef.how === 'tgtEnd') rule.expire = 'tgtEnd';
          lines.push(`✨ ${first} uses ${it.name}${targets.length ? ' on ' + targets.map((t) => t.label || '?').join(', ') : ''}`);
          const ctx = { by: key, spell: false, dc: ef.dc, name: it.name, shared: {}, roll: R2, lines };
          for (const t of targets) landOn(sc, t, { ...rule, save: ef.save ? { abl: ef.save, dc: ef.dc } : null, saveAbl: ef.save, fail: ef.dice ? [{ dice: ef.dice, type: ef.type }] : [], half: false }, ctx);
          if (it.charges) x.used++;
        } else return send(ws, { type: 'error', message: `${it.name} has nothing to use` });
        for (const r of rolls) post(r);
        post({ kind: 'chat', who: u.name, text: lines.join('\n').slice(0, 1500), time: Date.now(), cast: true });
        sendInv(u.name); save();
        break;
      }
      case 'markAdd': { // the DM puts an effect with a way out on a token: a Dungeon Master's Guide item, poison or hazard, a monster's spell, or their own
        if (!u.isDM || !tok) return;
        let rule = null, name = '';
        if (msg.preset) { rule = FEATS.PRESETS.find((p) => p.name === msg.preset); name = msg.preset; }
        else if (msg.spell) { const r = RULES.RULES[String(msg.spell).toLowerCase()]; if (r) { rule = { ...r, spell: true }; name = msg.spell.replace(/\b\w/g, (c) => c.toUpperCase()); if (r.options) { const o = r.options[clamp(int(msg.option, 0), 0, r.options.length - 1)]; rule = { ...rule, ...o, options: undefined }; name += ` (${o.name})`; } } }
        else if (msg.custom && typeof msg.custom === 'object') {
          const c = msg.custom, cond = CONDITIONS.has(c.cond) ? c.cond : null; if (!cond) return;
          rule = { add: [cond], save: ABL.includes(c.save) ? c.save : null };
          const how = String(c.how || '');
          if (how === 'end') rule.end = true; else if (how === 'start') rule.start = true; else if (how === 'hurtSave') rule.hurt = 'save'; else if (how === 'hurtEnd') rule.hurt = 'end';
          else if (how === 'athletics' || how === 'grapple') rule.escape = how; else if (how === 'tgtEnd' || how === 'srcEnd' || how === 'srcStart' || how === 'tgtStart') rule.expire = how; else if (how === 'manual') rule.manual = 'Roll its save when the effect says it can';
          if (/^\d+d\d+(\+\d+)?$/.test(String(c.dice || ''))) rule.tick = { when: c.when === 'end' ? 'end' : 'start', dice: c.dice, type: String(c.type || '').toLowerCase().slice(0, 12) };
          rule.rounds = clamp(int(c.rounds, 0), 0, 600);
          name = str(c.name, 40).trim() || condName(cond);
        }
        if (!rule) return;
        const dc = clamp(int(msg.dc, rule.dc || 10), 1, 40), srcTok = msg.src && sc.tokens[msg.src];
        const ctx = { by: srcTok ? 't:' + srcTok.id : 'dm', spell: !!rule.spell, dc, rounds: rule.rounds || 0, name, shared: {}, lines: [], roll: (e, l) => { const r = rollDice(e); post({ who: 'Monsters', to: ['DM'], label: str(l, 30), expr: e, ...r, private: false, time: Date.now() }); return r; } };
        // roll its first save now (the effect lands only on a failure), or put it straight on (the DM already knows it failed)
        landOn(sc, tok, { ...rule, save: msg.roll && rule.save ? { abl: rule.save, dc } : null, saveAbl: rule.save }, ctx);
        post({ kind: 'chat', who: 'Monsters', ...(tok.hidden ? { to: ['DM'] } : {}), text: (`✨ ${name} on ${tok.label || '?'}\n` + ctx.lines.join('\n')).slice(0, 1500), time: Date.now(), cast: true });
        save();
        break;
      }
      case 'charRes': { // tick a class feature used or back
        if (u.isDM) return; const ch = charOf(u.name); if (!ch) return;
        const r = (ch.resources || []).find((x) => x.name === msg.name); if (!r) return;
        r.used = clamp(int(msg.used, 0), 0, r.max);
        send(ws, { type: 'character', character: ch, quiet: true }); toDMs({ type: 'characters', characters: state.characters }); save();
        break;
      }
      case 'charForget': { if (u.isDM) return; delete state.characters[u.name.toLowerCase()]; send(ws, { type: 'character', character: null }); save(); break; }
      case 'charToken': { // a player puts their character's token on the map they're on (or updates the one that's there)
        if (u.isDM || !sc) return;
        const ch = charOf(u.name); if (!ch) return send(ws, { type: 'error', message: 'Bring in your character from D&D Beyond first' });
        const f = { label: ch.name.split(' ')[0].slice(0, 24), owner: u.name, img: ch.img || null, maxHp: ch.maxHp, initBonus: ch.init, darkvision: ch.darkvision, ac: ch.ac, speed: ch.speed, pp: ch.pp, ddb: ch.link };
        let t = Object.values(sc.tokens).find((x) => x.owner === u.name && (x.ddb === ch.link || sameName(x.label, f.label)));
        if (t) { // keep where it is and how hurt it is; refresh the rest
          const before = { ...t };
          Object.assign(t, tokenFields(f, sc, t)); if (t.hp == null || t.hp > t.maxHp) t.hp = Math.min(t.hp ?? ch.hp, t.maxHp);
          tokenChanged(sc, t, before);
        } else {
          if (Object.keys(sc.tokens).length >= 500) return;
          const want = [clamp(int(msg.x, 1), 0, sc.cols - 1), clamp(int(msg.y, 1), 0, sc.rows - 1)], used = new Set(Object.values(sc.tokens).map((x) => x.x + ',' + x.y));
          let spot = want;
          for (let r = 0; r < 12 && used.has(spot[0] + ',' + spot[1]); r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = want[0] + dx, y = want[1] + dy; if (inside(x, y) && !used.has(x + ',' + y) && used.has(spot[0] + ',' + spot[1])) spot = [x, y]; }
          const id = uid();
          sc.tokens[id] = { id, ...tokenFields({ color: '#2563eb', size: 1, ...f, hp: ch.hp, x: spot[0], y: spot[1] }, sc) };
          tokenChanged(sc, sc.tokens[id], null);
          if (sc.group) refreshViews();
        }
        if (visionOn(sc)) scheduleVision(sc);
        save();
        break;
      }
      case 'tokenPicture': { // a picture for a token (a portrait): the DM for any token, a player for their own
        if (!tok || !(u.isDM || (tok.owner && tok.owner === u.name))) return;
        const hit = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(msg.img || ''));
        if (!hit || msg.img.length > 1200 * 1024) return send(ws, { type: 'error', message: 'Use a PNG, JPG or WebP picture' });
        const buf = Buffer.from(hit[2], 'base64'), name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + (hit[1] === 'jpeg' ? '.jpg' : '.' + hit[1]);
        try { fs.mkdirSync(uploads, { recursive: true }); fs.writeFileSync(path.join(uploads, name), buf); } catch { return send(ws, { type: 'error', message: 'Could not save the picture' }); }
        const before = { ...tok }; tok.img = '/uploads/' + name; tok.imgPos = null; if (!tok.frame) tok.frame = 'gold';
        tokenChanged(sc, tok, before); save();
        break;
      }
      case 'diceSkin': { // the look of this person's dice: a built-in skin, or their own picture
        const key = u.name.toLowerCase(), m = msg.skin || {};
        if (m.img && typeof m.img === 'string') {
          const hit = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(m.img);
          if (!hit || m.img.length > 400 * 1024) return send(ws, { type: 'error', message: 'Use a PNG, JPG or WebP picture under 300 KB' });
          const buf = Buffer.from(hit[2], 'base64'), name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + (hit[1] === 'jpeg' ? '.jpg' : '.' + hit[1]);
          try { fs.mkdirSync(uploads, { recursive: true }); fs.writeFileSync(path.join(uploads, name), buf); } catch { return send(ws, { type: 'error', message: 'Could not save the picture' }); }
          state.diceSkins[key] = { img: '/uploads/' + name, ink: /^#[0-9a-f]{6}$/i.test(m.ink || '') ? m.ink : '#ffffff' };
        } else if (typeof m.id === 'string' && /^[a-z]{2,16}$/.test(m.id)) state.diceSkins[key] = { id: m.id };
        else delete state.diceSkins[key];
        send(ws, { type: 'diceSkin', skin: skinOf(u.name) }); save();
        break;
      }
      case 'setPin': { // a player protects their name with a PIN (or removes it)
        if (u.isDM) return;
        const key = u.name.toLowerCase();
        if (msg.pin == null || msg.pin === '') delete state.pins[key];
        else {
          const pin = String(msg.pin);
          if (!/^\d{4,8}$/.test(pin)) return send(ws, { type: 'error', message: 'A PIN is 4 to 8 digits' });
          const salt = crypto.randomBytes(8).toString('hex');
          state.pins[key] = { name: u.name, salt, hash: pinHash(pin, salt) };
        }
        send(ws, { type: 'pinSet', on: !!state.pins[key] });
        toDMs({ type: 'table', table: tableSettings() }); save();
        break;
      }
      case 'encounterSave': { // the DM keeps encounters to use later
        if (!u.isDM || !msg.encounter) return;
        state.encounters = state.encounters || [];
        const e = msg.encounter, monsters = Array.isArray(e.monsters) ? e.monsters.filter((m) => m && /^[a-z0-9-]{1,60}$/.test(m.id)).slice(0, 50).map((m) => ({ id: m.id, n: clamp(int(m.n, 1), 1, 50) })) : [];
        if (!monsters.length) return;
        const enc = { id: typeof e.id === 'string' && /^[a-z0-9]{4,16}$/.test(e.id) ? e.id : uid(), name: str(e.name, 60).trim() || 'Encounter', monsters, party: { size: clamp(int(e.party && e.party.size, 4), 1, 12), level: clamp(int(e.party && e.party.level, 1), 1, 20) } };
        const i = state.encounters.findIndex((x) => x.id === enc.id);
        if (i >= 0) state.encounters[i] = enc; else { if (state.encounters.length >= 200) state.encounters.shift(); state.encounters.push(enc); }
        toDMs({ type: 'encounters', encounters: state.encounters }); save();
        break;
      }
      case 'encounterDelete':
        if (!u.isDM) return;
        state.encounters = (state.encounters || []).filter((x) => x.id !== msg.id);
        toDMs({ type: 'encounters', encounters: state.encounters }); save();
        break;
      // ----- sound (the DM plays it; everyone hears it) -----
      case 'sound': // what's playing: { music: {id, vol} | null, amb: [{id, vol}] }
        if (!u.isDM) return;
        setSound(msg);
        break;
      case 'audioAdd': { // a sound file the DM uploaded
        if (!u.isDM || typeof msg.url !== 'string' || !AUDIO_URL.test(msg.url)) return;
        if (state.audio.length >= 300) return send(ws, { type: 'error', message: 'You have 300 sounds already. Delete some first.' });
        if (!state.audio.some((a) => a.url === msg.url)) state.audio.push({ id: 'u' + uid(), name: str(msg.name, 60).trim() || 'My sound', kind: msg.kind === 'music' ? 'music' : 'ambience', url: msg.url });
        toDMs({ type: 'audio', audio: state.audio }); save();
        break;
      }
      case 'audioUpdate': {
        const a = state.audio.find((x) => x.id === msg.id);
        if (!u.isDM || !a) return;
        if (msg.name != null) a.name = str(msg.name, 60).trim() || a.name;
        if (msg.kind === 'music' || msg.kind === 'ambience') a.kind = msg.kind;
        toDMs({ type: 'audio', audio: state.audio });
        if ((state.sound.music && state.sound.music.id === a.id) || state.sound.amb.some((x) => x.id === a.id)) setSound(state.sound); else save();
        break;
      }
      case 'audioRemove': {
        if (!u.isDM) return;
        state.audio = state.audio.filter((x) => x.id !== msg.id);
        toDMs({ type: 'audio', audio: state.audio });
        setSound(state.sound); // stops it if it was playing
        break;
      }
      case 'resetPin': // the DM clears a player's PIN (they forgot it)
        if (!u.isDM) return;
        delete state.pins[String(msg.name || '').toLowerCase()];
        toDMs({ type: 'table', table: tableSettings() }); save();
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
    state.activeScene = id; sights.delete(id);
    const atmo = state.scenes[id] && state.scenes[id].atmo;
    if (atmo && atmo.auto && atmo.sound) setSound(atmo.sound); // this map's own sound
    if (visionOn(state.scenes[id])) scheduleVision(state.scenes[id]); // explored fog catches up with what the party can see
    clients().forEach((c) => {
      if (c.user.isDM) return send(c, { type: 'active', sceneId: id });
      c.user.view = viewOf(c.user);
      const v = state.scenes[c.user.view]; syncFog(v);
      send(c, { type: 'sceneFull', scene: playerScene(v, c.user), active: true });
    });
  }

  return new Promise((resolve, reject) => {
    server.once('error', (e) => { wss.close(); reject(e); });
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve({
        port: server.address().port, dmKey, dataDir, version: VERSION,
        notifyNetwork: () => network && toDMs({ type: 'network', network: network.info() }),
        players: () => clients().filter((c) => !c.user.isDM).map((c) => c.user.name),
        close: () => new Promise((r) => { saveNow(); wss.clients.forEach((c) => c.terminate()); server.close(() => r()); })
      });
    });
  });
}

module.exports = { startServer, TERRAINS, PROPS, VERSION };
