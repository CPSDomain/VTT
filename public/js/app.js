import { CELL, TERRAINS, PROPS, PROP_CATS, DM_ONLY, texture, drawProp, swatch } from './art.js';
import { GENERATORS } from './generate.js';
import { drawTokenArt, thumb, builtins, credit, whenArtLoads } from './tokens.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c'), ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);
const dmKey = params.get('dm') || '';

// ---------- state ----------
let ws, me = { name: '', isDM: false };
let scenes = {}, order = [], active = null, editing = null;
let mode = 'play', tool = 'select', terrain = 'stone', propKind = 'door', propRot = 0, brush = 1;
let selected = null, hover = null, players = [];
const view = { x: 0, y: 0, zoom: 1 };
const imgCache = {};
const undoStack = [], redoStack = [];
let pendingNewScene = false;

const sc = () => scenes[editing];
const uid = () => Math.random().toString(16).slice(2, 10).padEnd(8, '0');
const inside = (s, x, y) => s && x >= 0 && y >= 0 && x < s.cols && y < s.rows;
const sendMsg = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));

function toast(text, ms = 3000) {
  const t = $('toast'); t.textContent = text; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- connection ----------
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => sendMsg({ type: 'join', name: me.name, key: dmKey });
  ws.onclose = () => { $('status').textContent = 'Disconnected, reconnecting…'; $('status').style.display = ''; setTimeout(connect, 2000); };
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
}

function onMessage(msg) {
  const s = msg.sceneId ? scenes[msg.sceneId] : null;
  switch (msg.type) {
    case 'welcome': {
      me.isDM = msg.isDM; me.name = msg.name;
      document.body.classList.toggle('dm', me.isDM);
      const st = msg.state;
      active = st.activeScene;
      if (me.isDM) {
        scenes = st.scenes; order = st.order; library = st.library || [];
        const last = tryGet('tt-editing');
        editing = scenes[editing] ? editing : scenes[last] ? last : active;
        fetch('/api/info?key=' + encodeURIComponent(dmKey)).then((r) => r.json()).then(showConn).catch(() => {});
      } else {
        scenes = st.scene ? { [st.scene.id]: st.scene } : {}; order = Object.keys(scenes); editing = active;
      }
      $('me').textContent = me.isDM ? '' : `Playing as ${me.name}`;
      $('privLabel').textContent = me.isDM ? 'Roll privately (players won\'t see it)' : 'Roll privately (only the DM sees it)';
      $('status').style.display = 'none';
      $('log').innerHTML = ''; st.log.forEach((e) => addLog(e, false));
      macros = st.myMacros || []; renderMacros();
      sceneChanged(true);
      break;
    }
    case 'presence': players = msg.players; renderPlayers(); break;
    case 'library': library = msg.library; if (!$('libModal').hidden) renderLibrary(); break;
    case 'token': if (s) { s.tokens[msg.token.id] = msg.token; if (msg.token.id === selected) renderEditor(); } break;
    case 'removeToken': if (s) { delete s.tokens[msg.id]; if (selected === msg.id) select(null); } break;
    case 'tiles': if (s) for (const [x, y, t] of msg.cells) { if (t === null) delete s.tiles[x + ',' + y]; else s.tiles[x + ',' + y] = t; } break;
    case 'prop': if (s) s.props[msg.prop.id] = msg.prop; break;
    case 'fog': if (s) { const a = fogArr(s); for (const [x, y] of msg.cells) a[y * s.cols + x] = msg.reveal ? 1 : 0; fogDirty = true; if (fogTool === 'room' && hover) fogPreview = roomCells(s, hover); } break;
    case 'fogReveal': // player: an area came into view, with what's in it
      if (s) {
        const a = fogArr(s); for (const [x, y] of msg.cells) a[y * s.cols + x] = 1;
        Object.assign(s.tiles, msg.tiles); msg.props.forEach((p) => { s.props[p.id] = p; }); msg.tokens.forEach((t) => { s.tokens[t.id] = t; });
        fogDirty = true;
      }
      break;
    case 'fogHide': // player: an area was covered again; forget what was there
      if (s) {
        const a = fogArr(s), set = new Set(msg.cells.map(([x, y]) => x + ',' + y));
        for (const [x, y] of msg.cells) { a[y * s.cols + x] = 0; delete s.tiles[x + ',' + y]; }
        for (const p of Object.values(s.props)) if (set.has(p.x + ',' + p.y)) delete s.props[p.id];
        msg.tokens.forEach((id) => { delete s.tokens[id]; if (selected === id) select(null); });
        fogDirty = true;
      }
      break;
    case 'propRemove': if (s) delete s.props[msg.propId]; break;
    case 'sceneMeta': if (s) { Object.assign(s, msg.patch); if (msg.sceneId === editing) sceneChanged(false); } break;
    case 'sceneFull':
      if (msg.active) { const switched = active !== msg.scene.id; scenes = { [msg.scene.id]: msg.scene }; order = [msg.scene.id]; active = editing = msg.scene.id; sceneChanged(switched); }
      else { scenes[msg.scene.id] = msg.scene; if (msg.scene.id === editing) sceneChanged(false); }
      break;
    case 'sceneAdded':
      scenes[msg.scene.id] = msg.scene; order = msg.order;
      if (pendingNewScene) { pendingNewScene = false; editing = msg.scene.id; sceneChanged(true); toast('New map created'); }
      else renderSceneBar();
      break;
    case 'sceneRemoved':
      delete scenes[msg.sceneId]; order = msg.order;
      if (editing === msg.sceneId) { editing = active && scenes[active] ? active : order[0]; sceneChanged(true); } else renderSceneBar();
      break;
    case 'order': order = msg.order; renderSceneBar(); break;
    case 'active': active = msg.sceneId; renderSceneBar(); break;
    case 'roll': addLog(msg.entry, true); break;
    case 'macros': macros = msg.macros; renderMacros(); break;
    case 'error': toast(msg.message); break;
  }
  draw();
}

function showConn(info) {
  const addr = (info.ips[0] || 'localhost') + ':' + info.port;
  $('conn').innerHTML = '';
  const label = document.createElement('span'); label.textContent = 'Players connect to';
  const b = document.createElement('b'); b.textContent = addr;
  b.title = info.ips.length > 1 ? 'Other addresses on this PC:\n' + info.ips.slice(1).map((i) => i + ':' + info.port).join('\n') : '';
  const copy = document.createElement('button'); copy.textContent = 'Copy'; copy.style.padding = '3px 8px';
  copy.onclick = () => { navigator.clipboard.writeText(addr).then(() => toast('Address copied: ' + addr)); };
  $('conn').append(label, b, copy);
}
function renderPlayers() {
  $('players').innerHTML = `<span class="dot ${players.length ? 'on' : ''}"></span>`;
  $('players').append(players.length ? `${players.length} player${players.length > 1 ? 's' : ''}` : 'No players yet');
  $('players').title = players.join(', ');
}

// ---------- scene switching ----------
function sceneChanged(refit) {
  const s = sc();
  if (!s) return;
  fogDirty = true;
  if (me.isDM) { trySet('tt-editing', editing); renderSceneBar(); fillMapSettings(); renderFogBar(); if (refit) clearMapSelection(); }
  else $('playerScene').textContent = s.name;
  if (s.bg) loadImg(s.bg.url);
  if (refit) fitView();
  draw();
}
function renderSceneBar() {
  const sel = $('sceneSel'); sel.innerHTML = '';
  for (const id of order) {
    const o = document.createElement('option'); o.value = id;
    o.textContent = (id === active ? '● ' : '') + scenes[id].name; sel.appendChild(o);
  }
  sel.value = editing;
  const live = editing === active;
  $('liveBadge').textContent = live ? 'PLAYERS SEE THIS' : 'PRIVATE PREP';
  $('liveBadge').className = 'badge dm-only ' + (live ? 'live' : 'prep');
  $('liveBadge').title = live ? 'Changes you make here appear on players\' screens straight away' : 'Players can\'t see this map. Build in peace.';
  $('showPlayers').style.visibility = live ? 'hidden' : 'visible';
  $('delMap').disabled = order.length <= 1;
}
function fillMapSettings() {
  const s = sc();
  if (document.activeElement !== $('mapName')) $('mapName').value = s.name;
  $('mapCols').value = s.cols; $('mapRows').value = s.rows; $('showGrid').checked = s.showGrid !== false;
  const pv = $('bgPreview');
  if (s.bg) { pv.style.backgroundImage = `url("${s.bg.url}")`; pv.textContent = ''; }
  else { pv.style.backgroundImage = ''; pv.textContent = 'No image. Upload a battle map, or drag one onto the map.'; }
}

function loadImg(url) {
  if (imgCache[url]) return imgCache[url];
  const img = new Image(); imgCache[url] = img;
  img.onload = draw; img.onerror = () => toast('Couldn\'t load the map image');
  img.src = url;
  return img;
}

// ---------- view ----------
let lastSize = null;
function resize() {
  const r = canvas.getBoundingClientRect();
  // keep the map centred where it was when panels open/close
  if (lastSize) { view.x += (r.width - lastSize.w) / 2; view.y += (r.height - lastSize.h) / 2; }
  lastSize = { w: r.width, h: r.height };
  canvas.width = Math.max(1, r.width * devicePixelRatio); canvas.height = Math.max(1, r.height * devicePixelRatio);
  draw();
}
function fitView() {
  const s = sc(); if (!s) return;
  const r = canvas.getBoundingClientRect(), pad = 30;
  view.zoom = Math.min(3, Math.max(0.1, Math.min((r.width - pad * 2) / (s.cols * CELL), (r.height - pad * 2) / (s.rows * CELL))));
  view.x = (r.width - s.cols * CELL * view.zoom) / 2; view.y = (r.height - s.rows * CELL * view.zoom) / 2;
  draw();
}
function zoomAt(mx, my, factor) {
  const z = Math.min(4, Math.max(0.1, view.zoom * factor));
  view.x = mx - (mx - view.x) * (z / view.zoom); view.y = my - (my - view.y) * (z / view.zoom); view.zoom = z;
  draw();
}
const toWorld = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.zoom, y: (e.clientY - r.top - view.y) / view.zoom }; };
const toCell = (p) => ({ x: Math.floor(p.x / CELL), y: Math.floor(p.y / CELL) });

// ---------- rendering ----------
let frame = 0;
function draw() { if (!frame) frame = requestAnimationFrame(render); }
function render() {
  frame = 0;
  const dpr = devicePixelRatio, s = sc();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!s) return;
  ctx.setTransform(view.zoom * dpr, 0, 0, view.zoom * dpr, view.x * dpr, view.y * dpr);
  const W = s.cols * CELL, Hh = s.rows * CELL;

  // visible cell range
  const r = canvas.getBoundingClientRect();
  const x0 = Math.max(0, Math.floor(-view.x / view.zoom / CELL)), y0 = Math.max(0, Math.floor(-view.y / view.zoom / CELL));
  const x1 = Math.min(s.cols - 1, Math.ceil((r.width - view.x) / view.zoom / CELL)), y1 = Math.min(s.rows - 1, Math.ceil((r.height - view.y) / view.zoom / CELL));

  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, W, Hh);
  if (s.bg) { const img = loadImg(s.bg.url); if (img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, W, Hh); }

  // floors
  ctx.imageSmoothingEnabled = view.zoom < 1.3;
  const walls = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = s.tiles[x + ',' + y];
    if (!t) continue;
    if (t === 'wall') { walls.push([x, y]); continue; }
    ctx.drawImage(texture(t, x, y), x * CELL, y * CELL, CELL + 0.6, CELL + 0.6);
  }
  // soft shadows inside pits, along any non-pit neighbour
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (s.tiles[x + ',' + y] !== 'pit') continue;
    const n = (dx, dy) => s.tiles[(x + dx) + ',' + (y + dy)] !== 'pit';
    ctx.fillStyle = 'rgba(80,70,60,.35)';
    if (n(0, -1)) ctx.fillRect(x * CELL, y * CELL, CELL, 6);
    if (n(-1, 0)) ctx.fillRect(x * CELL, y * CELL, 4, CELL);
  }
  // walls: cast shadow, then the block, then lit and shaded edges
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  for (const [x, y] of walls) ctx.fillRect(x * CELL + 6, y * CELL + 7, CELL, CELL);
  for (const [x, y] of walls) ctx.drawImage(texture('wall', x, y), x * CELL, y * CELL, CELL + 0.6, CELL + 0.6);
  for (const [x, y] of walls) {
    const open = (dx, dy) => s.tiles[(x + dx) + ',' + (y + dy)] !== 'wall';
    const X = x * CELL, Y = y * CELL;
    ctx.fillStyle = 'rgba(255,255,255,.13)';
    if (open(0, -1)) ctx.fillRect(X, Y, CELL, 3);
    if (open(-1, 0)) ctx.fillRect(X, Y, 3, CELL);
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    if (open(0, 1)) ctx.fillRect(X, Y + CELL - 4, CELL, 4);
    if (open(1, 0)) ctx.fillRect(X + CELL - 4, Y, 4, CELL);
  }
  ctx.imageSmoothingEnabled = true;

  // props (torch light first so it sits under everything else)
  const props = Object.values(s.props).filter((p) => p.x >= x0 - 1 && p.x <= x1 + 1 && p.y >= y0 - 1 && p.y <= y1 + 1)
    .sort((a, b) => (a.kind === 'torch' ? -1 : 0) - (b.kind === 'torch' ? -1 : 0) || a.y - b.y);
  for (const p of props) drawProp(ctx, p);

  // grid
  if (s.showGrid !== false) {
    ctx.strokeStyle = s.bg || Object.keys(s.tiles).length ? 'rgba(0,0,0,.32)' : '#2a2a2a';
    ctx.lineWidth = 1 / view.zoom; ctx.beginPath();
    for (let x = x0; x <= x1 + 1; x++) { ctx.moveTo(x * CELL, y0 * CELL); ctx.lineTo(x * CELL, (y1 + 1) * CELL); }
    for (let y = y0; y <= y1 + 1; y++) { ctx.moveTo(x0 * CELL, y * CELL); ctx.lineTo((x1 + 1) * CELL, y * CELL); }
    ctx.stroke();
  }
  ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 2 / view.zoom; ctx.strokeRect(0, 0, W, Hh);

  drawFog(s);

  // tokens (hidden ones only ever reach the DM, drawn faded)
  for (const t of Object.values(s.tokens)) {
    const pos = drag && drag.id === t.id ? drag.pos : { x: t.x * CELL, y: t.y * CELL };
    const rad = (t.size * CELL) / 2, cx = pos.x + rad, cy = pos.y + rad;
    ctx.globalAlpha = t.hidden ? 0.5 : 1;
    drawTokenArt(ctx, t, cx, cy, rad - 4, draw);
    ctx.lineWidth = t.id === selected ? 4 : 2.5;
    ctx.strokeStyle = t.id === selected ? '#fff' : t.owner && t.owner !== '*' ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.65)';
    if (t.hidden) ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.arc(cx, cy, rad - 4, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    if (view.zoom > 0.55) { // name tag under the token
      ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label = (t.hidden ? '◌ ' : '') + t.label, w = ctx.measureText(label).width + 8;
      ctx.fillStyle = t.hidden ? 'rgba(60,40,0,.8)' : 'rgba(0,0,0,.7)'; ctx.fillRect(cx - w / 2, pos.y + t.size * CELL - 5, w, 13);
      ctx.fillStyle = t.hidden ? '#fcd34d' : '#ddd'; ctx.fillText(label, cx, pos.y + t.size * CELL + 2);
    }
  }

  drawToolPreview(s);
}

function drawSelection(s) {
  if (!me.isDM || mode !== 'build' || tool !== 'select') return;
  const z = view.zoom, box = (r, dx = 0, dy = 0, fill = 'rgba(255,107,53,.12)') => {
    const x = (r.x0 + dx) * CELL, y = (r.y0 + dy) * CELL, w = (r.x1 - r.x0 + 1) * CELL, h = (r.y1 - r.y0 + 1) * CELL;
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
    ctx.setLineDash([8 / z, 5 / z]); ctx.lineWidth = 2 / z; ctx.strokeStyle = '#ff6b35'; ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
  };
  if (marquee) box(normRect(marquee.a, marquee.b));
  if (area) {
    if (areaDrag && (areaDrag.dx || areaDrag.dy)) {
      // ghost of what's moving, drawn at its new spot
      const { tiles, props } = areaContents(s, area);
      ctx.globalAlpha = 0.6;
      for (const [x, y, t] of tiles) ctx.drawImage(texture(t, x, y), (x + areaDrag.dx) * CELL, (y + areaDrag.dy) * CELL, CELL, CELL);
      for (const p of props) drawProp(ctx, { ...p, x: p.x + areaDrag.dx, y: p.y + areaDrag.dy });
      ctx.globalAlpha = 1;
      box(area, areaDrag.dx, areaDrag.dy, 'rgba(255,107,53,.08)');
    } else box(area);
  }
  const pr = selProp && s.props[selProp];
  if (pr) {
    const dx = propDrag ? propDrag.dx : 0, dy = propDrag ? propDrag.dy : 0;
    if (dx || dy) { ctx.globalAlpha = 0.7; drawProp(ctx, { ...pr, x: pr.x + dx, y: pr.y + dy }); ctx.globalAlpha = 1; }
    ctx.lineWidth = 2.5 / z; ctx.strokeStyle = '#ff6b35'; ctx.setLineDash([6 / z, 4 / z]);
    ctx.strokeRect((pr.x + dx) * CELL + 1, (pr.y + dy) * CELL + 1, CELL - 2, CELL - 2); ctx.setLineDash([]);
  }
}
// ---------- fog of war ----------
// One byte per cell (1 = revealed). Players never receive what's under the fog; the DM sees it shaded.
const fogCache = new WeakMap();
let fogDirty = true, fogMask = null, fogTool = null, fogPreview = null, fogStroke = null;
const fogOn = (s) => !!(s && s.fog && s.fog.on);
function fogArr(s) {
  let a = fogCache.get(s);
  if (!a || a.length !== s.cols * s.rows) {
    a = new Uint8Array(s.cols * s.rows);
    const d = s.fog && s.fog.data;
    if (d) { const bin = atob(d); if (bin.length === a.length) for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); }
    fogCache.set(s, a); fogDirty = true;
  }
  return a;
}
// A small soft-edged mask (4 px per cell, padded so the map border stays dark), scaled up when drawn.
function drawFog(s) {
  if (!fogOn(s)) return;
  const a = fogArr(s), S = 4, P = 2;
  if (fogDirty || !fogMask || fogMask.key !== s) {
    const w = (s.cols + 2 * P) * S, h = (s.rows + 2 * P) * S;
    const c1 = document.createElement('canvas'); c1.width = w; c1.height = h;
    const g1 = c1.getContext('2d'); g1.fillStyle = '#09090b'; g1.fillRect(0, 0, w, h);
    for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) if (a[y * s.cols + x]) g1.clearRect((x + P) * S, (y + P) * S, S, S);
    const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
    const g2 = c2.getContext('2d'); g2.filter = 'blur(1.5px)'; g2.drawImage(c1, 0, 0);
    fogMask = c2; fogMask.key = s; fogDirty = false;
  }
  ctx.save();
  ctx.globalAlpha = me.isDM ? 0.55 : 1;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fogMask, -P * CELL, -P * CELL, (s.cols + 2 * P) * CELL, (s.rows + 2 * P) * CELL);
  ctx.restore();
}
const DOORISH = new Set(['door', 'doubledoor', 'dooropen', 'secretdoor', 'portcullis', 'archway', 'bars']);
// The room under a cell: floor connected without passing walls or doors, plus the walls and doors round it.
function roomCells(s, c) {
  const tileAt = (x, y) => s.tiles[x + ',' + y];
  if (!inside(s, c.x, c.y) || !tileAt(c.x, c.y)) return null;
  const doors = new Set(Object.values(s.props).filter((p) => DOORISH.has(p.kind)).map((p) => p.x + ',' + p.y));
  const seen = new Set(), out = new Set(), q = [[c.x, c.y]], startWall = tileAt(c.x, c.y) === 'wall';
  while (q.length) {
    const [x, y] = q.pop(), k = x + ',' + y;
    if (seen.has(k) || !inside(s, x, y)) continue;
    const t = tileAt(x, y);
    if (!t || (t === 'wall' && !startWall)) continue;
    seen.add(k); out.add(k);
    if (doors.has(k) && !(x === c.x && y === c.y)) continue; // reveal the doorway, but don't spill through it
    if (startWall) continue;
    q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  for (const k of seen) { // walls (and doors in them) round the edge
    const [x, y] = k.split(',').map(Number);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nk = (x + dx) + ',' + (y + dy);
      if (tileAt(x + dx, y + dy) === 'wall' || doors.has(nk)) out.add(nk);
    }
  }
  return [...out].map((k) => k.split(',').map(Number)).filter(([x, y]) => inside(s, x, y));
}
let fogPending = [], fogPendingReveal = true, fogTimer = null;
function fogCells(s, cells, reveal) {
  const a = fogArr(s), v = reveal ? 1 : 0;
  if (reveal !== fogPendingReveal) flushFog();
  fogPendingReveal = reveal;
  for (const [x, y] of cells) { const i = y * s.cols + x; if (a[i] !== v) { a[i] = v; fogPending.push([x, y]); } }
  fogDirty = true;
  if (!fogTimer) fogTimer = setTimeout(flushFog, 60);
}
function flushFog() {
  clearTimeout(fogTimer); fogTimer = null;
  if (fogPending.length) { sendMsg({ type: 'fog', sceneId: editing, reveal: fogPendingReveal, cells: fogPending }); fogPending = []; }
}
function fogBrushAt(s, cx, cy, reveal) {
  const n = Number($('fogSize').value), o = Math.floor((n - 1) / 2), cells = [];
  for (let y = cy - o; y < cy - o + n; y++) for (let x = cx - o; x < cx - o + n; x++) if (inside(s, x, y)) cells.push([x, y]);
  fogCells(s, cells, reveal);
}
function setFogTool(t) {
  if (t && !fogOn(sc())) { toast('Tick "Fog of war" on the left of this bar first'); t = null; }
  fogTool = fogTool === t ? null : t;
  document.querySelectorAll('#fogBar [data-fog]').forEach((b) => b.classList.toggle('on', b.dataset.fog === fogTool));
  fogPreview = null;
  canvas.style.cursor = fogTool ? 'crosshair' : '';
  if (!fogTool) updateCursor();
  draw();
}
function renderFogBar() { const s = sc(); if (!s) return; $('fogOn').checked = fogOn(s); if (!fogOn(s) && fogTool) setFogTool(null); }
document.querySelectorAll('#fogBar [data-fog]').forEach((b) => b.onclick = () => setFogTool(b.dataset.fog));
$('fogOn').onchange = () => {
  const on = $('fogOn').checked;
  sendMsg({ type: 'fogSet', sceneId: editing, on });
  toast(on ? 'Fog on: players now see only what you reveal. Use Reveal room or the brushes.' : 'Fog off: players see the whole map');
};
$('fogRevealAll').onclick = () => { if (!fogOn(sc())) return toast('Tick "Fog of war" first'); sendMsg({ type: 'fogAll', sceneId: editing, reveal: true }); };
$('fogCoverAll').onclick = () => { if (!fogOn(sc())) return toast('Tick "Fog of war" first'); sendMsg({ type: 'fogAll', sceneId: editing, reveal: false }); };

function drawToolPreview(s) {
  drawSelection(s);
  if (me.isDM && fogTool && hover) {
    const z = view.zoom;
    if (fogTool === 'room' && fogPreview) {
      ctx.fillStyle = 'rgba(255,200,90,.22)';
      for (const [x, y] of fogPreview) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    } else if (fogTool !== 'room') {
      const n = Number($('fogSize').value), o = Math.floor((n - 1) / 2);
      ctx.lineWidth = 2 / z; ctx.strokeStyle = fogTool === 'reveal' ? '#fcd34d' : '#94a3b8';
      ctx.strokeRect((hover.x - o) * CELL, (hover.y - o) * CELL, n * CELL, n * CELL);
    }
    return;
  }
  if (!me.isDM || mode !== 'build' || !hover) return;
  ctx.lineWidth = 2 / view.zoom;
  if (rectDrag) {
    const x0 = Math.min(rectDrag.a.x, rectDrag.b.x), y0 = Math.min(rectDrag.a.y, rectDrag.b.y);
    const w = Math.abs(rectDrag.a.x - rectDrag.b.x) + 1, h = Math.abs(rectDrag.a.y - rectDrag.b.y) + 1;
    ctx.fillStyle = 'rgba(255,107,53,.18)'; ctx.fillRect(x0 * CELL, y0 * CELL, w * CELL, h * CELL);
    ctx.strokeStyle = '#ff6b35'; ctx.strokeRect(x0 * CELL, y0 * CELL, w * CELL, h * CELL);
    if (tool === 'room' && w > 2 && h > 2) { ctx.setLineDash([6 / view.zoom, 4 / view.zoom]); ctx.strokeRect((x0 + 1) * CELL, (y0 + 1) * CELL, (w - 2) * CELL, (h - 2) * CELL); ctx.setLineDash([]); }
    $('cellInfo').textContent = `${w} × ${h} squares (${w * 5} × ${h * 5} ft)`;
    return;
  }
  if (tool === 'brush' || tool === 'erase') {
    const o = Math.floor((brush - 1) / 2);
    ctx.strokeStyle = tool === 'erase' ? '#f87171' : '#ff6b35';
    ctx.strokeRect((hover.x - o) * CELL, (hover.y - o) * CELL, brush * CELL, brush * CELL);
  } else if (tool === 'prop' && inside(s, hover.x, hover.y)) {
    ctx.globalAlpha = 0.65; drawProp(ctx, { kind: propKind, x: hover.x, y: hover.y, rot: propRot }); ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,107,53,.8)'; ctx.strokeRect(hover.x * CELL, hover.y * CELL, CELL, CELL);
  } else if (tool === 'rect' || tool === 'room' || tool === 'fill' || tool === 'token') {
    ctx.strokeStyle = '#ff6b35'; ctx.strokeRect(hover.x * CELL, hover.y * CELL, CELL, CELL);
  }
}

// ---------- map editing ----------
// Every change goes through these, recording before/after so it can be undone.
let stroke = null, pendingTiles = [], flushTimer = null;

function setTile(s, x, y, t, rec) {
  if (!inside(s, x, y)) return;
  const k = x + ',' + y, before = s.tiles[k] ?? null;
  if (before === t) return;
  if (rec && !rec.tiles.has(k)) rec.tiles.set(k, [x, y, before, t]); else if (rec) rec.tiles.get(k)[3] = t;
  if (t === null) delete s.tiles[k]; else s.tiles[k] = t;
  pendingTiles.push([x, y, t]);
  if (!flushTimer) flushTimer = setTimeout(flushTiles, 60);
}
function flushTiles() {
  clearTimeout(flushTimer); flushTimer = null;
  if (pendingTiles.length) { sendMsg({ type: 'tiles', sceneId: editing, cells: pendingTiles }); pendingTiles = []; }
}
function setProp(s, id, prop, rec) {
  const before = s.props[id] ? { ...s.props[id] } : null;
  if (rec) { const ex = rec.props.get(id); if (ex) ex[2] = prop; else rec.props.set(id, [id, before, prop]); }
  if (prop) { s.props[id] = { ...prop, id }; sendMsg({ type: 'propSet', sceneId: s.id, propId: id, kind: prop.kind, x: prop.x, y: prop.y, rot: prop.rot }); }
  else { delete s.props[id]; sendMsg({ type: 'propRemove', sceneId: s.id, propId: id }); }
}
const newRecord = () => ({ sceneId: editing, tiles: new Map(), props: new Map(), propCells: new Set() });
function commit(rec) {
  flushTiles();
  if (!rec.tiles.size && !rec.props.size) return;
  undoStack.push({ sceneId: rec.sceneId, tiles: [...rec.tiles.values()], props: [...rec.props.values()] });
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0; updateUndo();
}
function replay(entry, back) {
  const s = scenes[entry.sceneId];
  if (!s) return toast('That map no longer exists');
  if (entry.sceneId !== editing) { editing = entry.sceneId; sceneChanged(false); }
  for (const [x, y, b, a] of entry.tiles) setTile(s, x, y, back ? b : a, null);
  for (const [id, b, a] of entry.props) setProp(s, id, back ? b : a, null);
  flushTiles(); draw();
}
function undo() { const e = undoStack.pop(); if (!e) return; replay(e, true); redoStack.push(e); updateUndo(); }
function redo() { const e = redoStack.pop(); if (!e) return; replay(e, false); undoStack.push(e); updateUndo(); }
function updateUndo() { $('undo').disabled = !undoStack.length; $('redo').disabled = !redoStack.length; }

function paintAt(s, cx, cy) {
  const o = Math.floor((brush - 1) / 2);
  for (let y = cy - o; y < cy - o + brush; y++) for (let x = cx - o; x < cx - o + brush; x++) {
    if (tool === 'erase') {
      // props come off first; the floor only goes once the square is clear
      // (a cell touched earlier in this stroke for its prop keeps its floor)
      const here = Object.values(s.props).filter((p) => p.x === x && p.y === y);
      if (here.length) { here.forEach((p) => setProp(s, p.id, null, stroke)); stroke.propCells.add(x + ',' + y); }
      else if (!stroke.propCells.has(x + ',' + y)) setTile(s, x, y, null, stroke);
    } else setTile(s, x, y, terrain, stroke);
  }
}
function line(a, b, fn) { // Bresenham, so fast drags don't leave gaps
  let x = a.x, y = a.y; const dx = Math.abs(b.x - x), dy = -Math.abs(b.y - y), sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) { fn(x, y); if (x === b.x && y === b.y) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x += sx; } if (e2 <= dx) { err += dx; y += sy; } }
}
function fillRect(s, a, b, isRoom) {
  const rec = newRecord();
  const x0 = Math.max(0, Math.min(a.x, b.x)), x1 = Math.min(s.cols - 1, Math.max(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y)), y1 = Math.min(s.rows - 1, Math.max(a.y, b.y));
  const floor = terrain === 'wall' ? 'stone' : terrain;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const edge = x === x0 || x === x1 || y === y0 || y === y1;
    setTile(s, x, y, isRoom ? (edge ? 'wall' : floor) : terrain, rec);
  }
  commit(rec);
}
function floodFill(s, start) {
  if (!inside(s, start.x, start.y)) return;
  const target = s.tiles[start.x + ',' + start.y] ?? null;
  if (target === terrain) return;
  const rec = newRecord(), seen = new Set(), q = [[start.x, start.y]];
  while (q.length) {
    const [x, y] = q.pop(), k = x + ',' + y;
    if (seen.has(k) || !inside(s, x, y) || (s.tiles[k] ?? null) !== target) continue;
    seen.add(k); setTile(s, x, y, terrain, rec);
    q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  commit(rec);
}
function placeProp(s, c) {
  if (!inside(s, c.x, c.y)) return;
  const rec = newRecord();
  const same = Object.values(s.props).find((p) => p.x === c.x && p.y === c.y && p.kind === propKind);
  if (same) setProp(s, same.id, { ...same, rot: (same.rot + 1) % 4 }, rec);
  else setProp(s, uid(), { kind: propKind, x: c.x, y: c.y, rot: propRot }, rec);
  commit(rec);
}

// ---------- tokens ----------
const canMove = (t) => me.isDM || t.owner === me.name || t.owner === '*';
function tokenAt(s, p) {
  return Object.values(s.tokens).reverse().find((t) => p.x >= t.x * CELL && p.x < (t.x + t.size) * CELL && p.y >= t.y * CELL && p.y < (t.y + t.size) * CELL);
}
// art chosen for the next token(s) placed: { icon } or { img }, plus defaults from the library entry
let art = { name: 'Plain token' };
function setArt(entry) {
  art = entry ? { icon: entry.icon || null, img: entry.url || entry.img || null, name: entry.name } : { name: 'Plain token' };
  if (entry) {
    $('tLabel').value = nextFreeName(entry.name);
    if (entry.color) $('tColor').value = entry.color;
    if (entry.size) $('tSize').value = String(entry.size);
  }
  $('artName').textContent = art.name;
  refreshArtPreview();
}
function refreshArtPreview() { thumb({ icon: art.icon, img: art.img, color: $('tColor').value, label: $('tLabel').value }, 44, $('artPreview')); }
// "Goblin" -> "Goblin 1", or "Goblin 3" if 1 and 2 are already on this map
function nextFreeName(base) {
  const s = sc(); if (!s) return base;
  const names = new Set(Object.values(s.tokens).map((t) => t.label));
  if (!names.has(base) && !names.has(base + ' 1')) return base;
  let n = 1; while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
function select(id) { selected = id; renderEditor(); draw(); }
function addToken(x, y) {
  const label = $('tLabel').value.trim() || 'Token';
  sendMsg({ type: 'addToken', sceneId: editing, label, color: $('tColor').value, owner: $('tOwner').value, size: $('tSize').value, x, y, icon: art.icon || null, img: art.img || null, hidden: $('tHidden').checked });
  // number the next one automatically: "Goblin 1" -> "Goblin 2"
  const m = label.match(/^(.*?)(\d+)$/);
  $('tLabel').value = m ? m[1] + (Number(m[2]) + 1) : label + ' 2';
}

// ----- selected token editor (DM) -----
function renderEditor() {
  const t = selected && sc() && sc().tokens[selected];
  $('editSec').classList.toggle('off', !(me.isDM && t));
  if (!t || !me.isDM) return;
  const keep = document.activeElement;
  if (keep !== $('eLabel')) $('eLabel').value = t.label;
  if (keep !== $('eOwner')) $('eOwner').value = t.owner || '';
  $('eColor').value = t.color; $('eSize').value = String(t.size); $('eHidden').checked = !!t.hidden;
  thumb(t, 44, $('editArt'));
}
const updateSelected = (patch) => selected && sendMsg({ type: 'tokenUpdate', sceneId: editing, id: selected, ...patch });
$('eLabel').onchange = () => updateSelected({ label: $('eLabel').value });
$('eOwner').onchange = () => updateSelected({ owner: $('eOwner').value });
$('eColor').oninput = () => updateSelected({ color: $('eColor').value });
$('eSize').onchange = () => updateSelected({ size: $('eSize').value });
$('eHidden').onchange = () => { updateSelected({ hidden: $('eHidden').checked }); toast($('eHidden').checked ? 'Token hidden from players' : 'Token revealed to players'); };
$('eDup').onclick = () => {
  const t = sc().tokens[selected]; if (!t) return;
  sendMsg({ type: 'addToken', sceneId: editing, ...t, label: nextFreeName(t.label.replace(/\s*\d+$/, '')), x: Math.min(sc().cols - t.size, t.x + t.size), id: undefined });
};
$('eArt').onclick = () => openLibrary((entry) => updateSelected({ icon: entry.icon || null, img: entry.url || null, color: entry.color || undefined }));

// ----- token library (built-in + the DM's uploads) -----
let library = [], libCat = 'All', libPick = null;
function openLibrary(onPick) {
  libPick = onPick || null;
  $('libModal').hidden = false; $('libSearch').value = ''; renderLibrary(); setTimeout(() => $('libSearch').focus(), 50);
}
function renderLibrary() {
  const q = $('libSearch').value.trim().toLowerCase();
  const all = [...library.map((l) => ({ ...l, cat: 'My uploads', mine: true })), ...builtins()];
  const cats = ['All', 'My uploads', ...new Set(builtins().map((b) => b.cat))];
  $('libCats').innerHTML = '';
  for (const c of cats) {
    const b = document.createElement('button'); b.textContent = c + (c === 'My uploads' ? ` (${library.length})` : '');
    b.className = c === libCat ? 'on' : ''; b.onclick = () => { libCat = c; renderLibrary(); }; $('libCats').appendChild(b);
  }
  const list = all.filter((e) => (libCat === 'All' || e.cat === libCat) && (!q || e.name.toLowerCase().includes(q) || e.cat.toLowerCase().includes(q)));
  const grid = $('libGrid'); grid.innerHTML = '';
  if (!list.length) grid.innerHTML = `<div class="hint">${libCat === 'My uploads' ? 'No uploads yet. Click "Upload images…" or drop image files on the map.' : 'Nothing matches.'}</div>`;
  for (const e of list) {
    const tile = document.createElement('button'); tile.className = 'tile'; tile.title = `${e.name} (${['', 'Medium', 'Large', 'Huge', 'Gargantuan'][e.size || 1]})`;
    tile.appendChild(thumb({ icon: e.icon, img: e.url, color: e.color || '#555555', label: e.name }, 28));
    const nm = document.createElement('span'); nm.textContent = e.name; tile.appendChild(nm);
    const sm = document.createElement('small'); sm.textContent = ['', 'Medium', 'Large', 'Huge', 'Gargantuan'][e.size || 1]; tile.appendChild(sm);
    tile.onclick = () => { $('libModal').hidden = true; if (libPick) libPick(e); else { setArt(e); toast(`${e.name} ready: click Add to map, or use the Token tool to place`); } };
    if (e.mine) {
      const rm = document.createElement('button'); rm.className = 'rm'; rm.textContent = '✕'; rm.title = 'Remove from library';
      rm.onclick = (ev) => { ev.stopPropagation(); sendMsg({ type: 'libraryRemove', libId: e.id }); };
      tile.appendChild(rm);
    }
    grid.appendChild(tile);
  }
  $('libCredit').textContent = credit();
}
$('openLib').onclick = () => openLibrary(null);
$('libSearch').oninput = renderLibrary;
$('libUpload').onclick = () => $('libFiles').click();
$('libFiles').onchange = async () => { const files = [...$('libFiles').files]; $('libFiles').value = ''; const added = await uploadTokens(files); if (added.length) { libCat = 'My uploads'; $('libSearch').value = ''; renderLibrary(); } };
document.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => { b.closest('.modal').hidden = true; });
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('pointerdown', (e) => { if (e.target === m) m.hidden = true; }));
whenArtLoads(() => { draw(); refreshArtPreview(); if (!$('libModal').hidden) renderLibrary(); });

async function uploadFile(file) {
  const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': file.type, 'X-DM-Key': dmKey }, body: file });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).url;
}
const prettyName = (f) => f.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 24) || 'Token';
// Upload token images into the library; returns the new library items.
async function uploadTokens(files) {
  files = files.filter((f) => /^image\/(png|jpeg|webp|gif)$/.test(f.type));
  if (!files.length) { toast('Use PNG, JPG, WebP or GIF images'); return []; }
  toast(`Uploading ${files.length} token image${files.length > 1 ? 's' : ''}…`, 15000);
  const items = [];
  for (const f of files) { try { items.push({ name: prettyName(f.name), url: await uploadFile(f), size: 1 }); } catch (e) { toast(`${f.name}: ${e.message}`); } }
  if (items.length) { sendMsg({ type: 'libraryAdd', items }); toast(`Added ${items.length} token${items.length > 1 ? 's' : ''} to your library`); }
  return items;
}

// ---------- input ----------
let drag = null, pan = null, rectDrag = null, spaceDown = false, lastCell = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  const s = sc(); if (!s) return;
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 1 || e.button === 2 || spaceDown) { pan = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; canvas.style.cursor = 'grabbing'; return; }
  if (e.button !== 0) return;
  const p = toWorld(e), c = toCell(p);
  const building = me.isDM && mode === 'build';

  if (me.isDM && fogTool) { // fog tools take the click, in Play or Build mode
    if (fogTool === 'room') {
      const cells = roomCells(s, c);
      if (!cells) toast('Reveal room works on built or generated maps. On an uploaded image map, use the Reveal brush.');
      else fogCells(s, cells, true);
      flushFog();
    } else { fogStroke = { reveal: fogTool === 'reveal', last: c }; fogBrushAt(s, c.x, c.y, fogStroke.reveal); }
    draw(); return;
  }

  if (!building || tool === 'select') {
    const t = tokenAt(s, p);
    select(t ? t.id : null);
    if (t) {
      clearMapSelection();
      if (canMove(t)) drag = { id: t.id, off: { x: p.x - t.x * CELL, y: p.y - t.y * CELL }, pos: { x: t.x * CELL, y: t.y * CELL } };
    } else if (building) {
      // map pieces: drag a selected area, pick up a prop, or start drawing a selection box
      const pr = propAt(s, c);
      if (area && inArea(c)) areaDrag = { from: c, dx: 0, dy: 0, copy: e.altKey };
      else if (pr) { area = null; selProp = pr.id; propDrag = { id: pr.id, from: c, dx: 0, dy: 0 }; }
      else { selProp = null; area = null; marquee = { a: c, b: c }; }
      showSelection();
    }
    draw(); return;
  }
  if (tool === 'brush' || tool === 'erase') { stroke = newRecord(); lastCell = c; paintAt(s, c.x, c.y); }
  else if (tool === 'rect' || tool === 'room') rectDrag = { a: c, b: c };
  else if (tool === 'fill') floodFill(s, c);
  else if (tool === 'prop') placeProp(s, c);
  else if (tool === 'token' && inside(s, c.x, c.y)) addToken(c.x, c.y);
  draw();
});
canvas.addEventListener('pointermove', (e) => {
  const s = sc(); if (!s) return;
  const p = toWorld(e), c = toCell(p);
  if (!hover || hover.x !== c.x || hover.y !== c.y) {
    hover = c;
    $('cellInfo').textContent = inside(s, c.x, c.y) ? `${String.fromCharCode(65 + (c.x % 26))}${c.x >= 26 ? Math.floor(c.x / 26) : ''}${c.y + 1}` : '';
    if (me.isDM && fogTool === 'room' && !fogStroke) fogPreview = roomCells(s, c);
    if (me.isDM && (mode === 'build' || fogTool)) draw();
  }
  if (fogStroke) { line(fogStroke.last, c, (x, y) => fogBrushAt(s, x, y, fogStroke.reveal)); fogStroke.last = c; draw(); return; }
  if (pan) { view.x = pan.vx + e.clientX - pan.sx; view.y = pan.vy + e.clientY - pan.sy; draw(); }
  else if (drag) { drag.pos = { x: p.x - drag.off.x, y: p.y - drag.off.y }; draw(); }
  else if (stroke) { line(lastCell, c, (x, y) => paintAt(s, x, y)); lastCell = c; draw(); }
  else if (rectDrag) { rectDrag.b = c; draw(); }
  else if (marquee) { marquee.b = c; draw(); }
  else if (propDrag) { propDrag.dx = c.x - propDrag.from.x; propDrag.dy = c.y - propDrag.from.y; draw(); }
  else if (areaDrag) { areaDrag.dx = c.x - areaDrag.from.x; areaDrag.dy = c.y - areaDrag.from.y; draw(); }
  else if (me.isDM && mode === 'build' && tool === 'select' && !spaceDown) {
    canvas.style.cursor = tokenAt(s, p) ? 'grab' : area && inArea(c) ? 'move' : propAt(s, c) ? 'pointer' : 'crosshair';
  }
});
canvas.addEventListener('pointerup', () => {
  const s = sc();
  if (fogStroke) { fogStroke = null; flushFog(); }
  if (drag && s) {
    const t = s.tokens[drag.id];
    const x = Math.round(drag.pos.x / CELL), y = Math.round(drag.pos.y / CELL);
    if (t) { t.x = Math.max(0, Math.min(s.cols - t.size, x)); t.y = Math.max(0, Math.min(s.rows - t.size, y)); }
    sendMsg({ type: 'move', sceneId: editing, id: drag.id, x, y });
  }
  if (stroke) { commit(stroke); stroke = null; }
  if (rectDrag && s) { fillRect(s, rectDrag.a, rectDrag.b, tool === 'room'); rectDrag = null; }
  if (marquee) { area = normRect(marquee.a, marquee.b); marquee = null; showSelection(); }
  if (propDrag && s) {
    const pr = s.props[propDrag.id];
    if (pr && (propDrag.dx || propDrag.dy) && inside(s, pr.x + propDrag.dx, pr.y + propDrag.dy)) {
      const rec = newRecord(); setProp(s, pr.id, { ...pr, x: pr.x + propDrag.dx, y: pr.y + propDrag.dy }, rec); commit(rec);
    }
    propDrag = null;
  }
  if (areaDrag && s) { if (areaDrag.dx || areaDrag.dy) moveArea(s, areaDrag.dx, areaDrag.dy, areaDrag.copy); areaDrag = null; }
  drag = null; pan = null; updateCursor(); draw();
});

// ---------- selecting map pieces (Build mode, Select tool) ----------
let selProp = null, area = null, marquee = null, propDrag = null, areaDrag = null, clipboard = null;
const normRect = (a, b) => ({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) });
const inArea = (c) => area && c.x >= area.x0 && c.x <= area.x1 && c.y >= area.y0 && c.y <= area.y1;
function propAt(s, c) { const here = Object.values(s.props).filter((p) => p.x === c.x && p.y === c.y); return here[here.length - 1] || null; }
function clearMapSelection() { selProp = null; area = null; marquee = null; showSelection(); }
function areaContents(s, r) {
  const tiles = [], props = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { const t = s.tiles[x + ',' + y]; if (t) tiles.push([x, y, t]); }
  for (const p of Object.values(s.props)) if (p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1) props.push(p);
  return { tiles, props };
}
// Move (or with Alt held, copy) everything in the selected area by dx, dy. Undoable as one step.
function moveArea(s, dx, dy, copy) {
  const { tiles, props } = areaContents(s, area), rec = newRecord();
  if (!copy) for (let y = area.y0; y <= area.y1; y++) for (let x = area.x0; x <= area.x1; x++) setTile(s, x, y, null, rec);
  for (const [x, y, t] of tiles) if (inside(s, x + dx, y + dy)) setTile(s, x + dx, y + dy, t, rec);
  for (const p of props) {
    const np = { kind: p.kind, rot: p.rot, x: p.x + dx, y: p.y + dy };
    if (!inside(s, np.x, np.y)) { if (!copy) setProp(s, p.id, null, rec); continue; }
    setProp(s, copy ? uid() : p.id, np, rec);
  }
  commit(rec);
  area = { x0: area.x0 + dx, y0: area.y0 + dy, x1: area.x1 + dx, y1: area.y1 + dy };
  showSelection();
}
function deleteSelection(s) {
  const rec = newRecord();
  if (selProp && s.props[selProp]) { setProp(s, selProp, null, rec); selProp = null; }
  else if (area) {
    const { props } = areaContents(s, area);
    for (let y = area.y0; y <= area.y1; y++) for (let x = area.x0; x <= area.x1; x++) setTile(s, x, y, null, rec);
    props.forEach((p) => setProp(s, p.id, null, rec));
  }
  commit(rec); showSelection(); draw();
}
function copyArea(s) {
  if (!area) return;
  const { tiles, props } = areaContents(s, area);
  clipboard = { w: area.x1 - area.x0 + 1, h: area.y1 - area.y0 + 1,
    tiles: tiles.map(([x, y, t]) => [x - area.x0, y - area.y0, t]), props: props.map((p) => ({ kind: p.kind, rot: p.rot, x: p.x - area.x0, y: p.y - area.y0 })) };
  toast(`Copied ${clipboard.w} × ${clipboard.h} squares. Ctrl+V pastes where the mouse is.`);
}
function pasteArea(s) {
  if (!clipboard || !hover) return;
  const rec = newRecord(), ox = hover.x, oy = hover.y;
  for (const [x, y, t] of clipboard.tiles) setTile(s, ox + x, oy + y, t, rec);
  for (const p of clipboard.props) if (inside(s, ox + p.x, oy + p.y)) setProp(s, uid(), { ...p, x: ox + p.x, y: oy + p.y }, rec);
  commit(rec);
  area = { x0: ox, y0: oy, x1: ox + clipboard.w - 1, y1: oy + clipboard.h - 1 }; selProp = null;
  showSelection(); draw();
}
function rotateSelectedProp(s) {
  const pr = selProp && s.props[selProp]; if (!pr) return false;
  const rec = newRecord(); setProp(s, pr.id, { ...pr, rot: (pr.rot + 1) % 4 }, rec); commit(rec); draw(); return true;
}
// The line under the tools says what's selected and what you can do with it.
function showSelection() {
  const s = sc(), el = $('selInfo');
  if (!el) return;
  if (selProp && s && s.props[selProp]) {
    const name = (PROPS.find((p) => p.id === s.props[selProp].kind) || {}).name || 'Prop';
    el.innerHTML = `<b>${name}</b> selected · drag to move · <kbd>Q</kbd> rotate · <kbd>Del</kbd> remove · <kbd>Esc</kbd> deselect`;
  } else if (area) {
    el.innerHTML = `<b>Area ${area.x1 - area.x0 + 1} × ${area.y1 - area.y0 + 1}</b> selected · drag to move (hold <kbd>Alt</kbd> to copy) · <kbd>Del</kbd> clear · <kbd>Ctrl+C</kbd> / <kbd>Ctrl+V</kbd> copy &amp; paste · arrows nudge`;
  } else el.innerHTML = TOOL_HELP[tool] || '';
}
const TOOL_HELP = {
  select: 'Click a prop to pick it up, or drag across the map to select an area (walls, floors and props) to move, copy or delete. Tokens: click and drag.',
  brush: 'Click or drag to paint the chosen terrain. Keys <kbd>1</kbd>–<kbd>0</kbd> pick terrain.',
  rect: 'Drag to fill a rectangle with the chosen terrain.',
  room: 'Drag a rectangle: floor inside, walls round the edge.',
  fill: 'Click to fill a connected area with the chosen terrain.',
  erase: 'Click or drag. Removes props first, then the ground under them.',
  prop: 'Click to place the chosen prop. <kbd>Q</kbd> rotates. Click a placed prop of the same kind to turn it.',
  token: 'Click to place the token set up in the Add tokens panel.'
};
canvas.addEventListener('pointerleave', () => { hover = null; $('cellInfo').textContent = ''; draw(); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
}, { passive: false });
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe($('board'));

const TOOL_KEYS = { v: 'select', b: 'brush', r: 'rect', m: 'room', g: 'fill', e: 'erase', p: 'prop', k: 'token' };
window.addEventListener('keydown', (e) => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (e.key === ' ' && !typing) { spaceDown = true; updateCursor(); e.preventDefault(); return; }
  if (typing) return;
  if (e.key === 'Home') return fitView();
  if (!me.isDM) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected) return sendMsg({ type: 'removeToken', sceneId: editing, id: selected });
  if (e.key === 'Escape' && fogTool) return setFogTool(null);
  if (mode !== 'build') return;
  const s = sc(), k = e.key.toLowerCase();
  if (tool === 'select' && s) {
    if ((e.ctrlKey || e.metaKey) && k === 'c') { e.preventDefault(); return copyArea(s); }
    if ((e.ctrlKey || e.metaKey) && k === 'v') { e.preventDefault(); return pasteArea(s); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && (selProp || area)) { e.preventDefault(); return deleteSelection(s); }
    if (e.key === 'Escape') { clearMapSelection(); return draw(); }
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (arrow && (selProp || area)) {
      e.preventDefault();
      if (area) moveArea(s, arrow[0], arrow[1], false);
      else { const pr = s.props[selProp]; if (pr && inside(s, pr.x + arrow[0], pr.y + arrow[1])) { const rec = newRecord(); setProp(s, pr.id, { ...pr, x: pr.x + arrow[0], y: pr.y + arrow[1] }, rec); commit(rec); } }
      return draw();
    }
    if (k === 'q' && rotateSelectedProp(s)) return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
  else if (k === 'q') { propRot = (propRot + 1) % 4; draw(); }
  else { const t = TERRAINS.find((x) => x.key === e.key); if (t) setTerrain(t.id); }
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceDown = false; updateCursor(); } });
function updateCursor() {
  canvas.style.cursor = spaceDown ? 'grab' : (me.isDM && mode === 'build' && tool !== 'select') ? 'crosshair' : 'default';
}

// ---------- build UI ----------
function setMode(m) {
  mode = m;
  document.body.classList.toggle('build', m === 'build');
  $('modePlay').classList.toggle('on', m === 'play'); $('modeBuild').classList.toggle('on', m === 'build');
  if (m === 'build' && tool === 'select') setTool('brush');
  updateCursor(); draw();
}
function setTool(t) {
  tool = t;
  if (fogTool && typeof setFogTool === 'function') setFogTool(null);
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  $('brushRow').style.display = t === 'brush' || t === 'erase' ? '' : 'none';
  if (t !== 'select') clearMapSelection(); else showSelection();
  updateCursor(); draw();
}
function setTerrain(id) {
  terrain = id;
  document.querySelectorAll('#terrainPal .sw').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  const t = TERRAINS.find((x) => x.id === id); $('terrainName').textContent = t.key ? `${t.name}  ·  key ${t.key}` : t.name;
  if (!['brush', 'rect', 'room', 'fill'].includes(tool)) setTool('brush');
}
function setPropKind(id) {
  propKind = id;
  document.querySelectorAll('#propPal .sw').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  $('propName').textContent = PROPS.find((x) => x.id === id).name;
  if (tool !== 'prop') setTool('prop');
}
for (const t of TERRAINS) {
  const b = document.createElement('button'); b.className = 'sw'; b.dataset.id = t.id; b.title = `${t.name} (${t.key})`;
  b.appendChild(swatch(t.id, false)); b.onclick = () => setTerrain(t.id); $('terrainPal').appendChild(b);
}
let propCat = PROP_CATS[0];
function renderPropPalette() {
  $('propCats').innerHTML = '';
  for (const c of PROP_CATS) {
    const b = document.createElement('button'); b.textContent = c; b.className = c === propCat ? 'on' : '';
    b.onclick = () => { propCat = c; renderPropPalette(); }; $('propCats').appendChild(b);
  }
  $('propPal').innerHTML = '';
  for (const p of PROPS.filter((x) => x.cat === propCat)) {
    const b = document.createElement('button'); b.className = 'sw' + (p.id === propKind ? ' on' : ''); b.dataset.id = p.id; b.title = p.name;
    b.appendChild(swatch(p.id, true)); b.onclick = () => setPropKind(p.id); $('propPal').appendChild(b);
  }
}
renderPropPalette();
document.querySelectorAll('.tool').forEach((b) => b.onclick = () => setTool(b.dataset.tool));
document.querySelectorAll('#sizes button').forEach((b) => b.onclick = () => {
  brush = Number(b.dataset.size);
  document.querySelectorAll('#sizes button').forEach((x) => x.classList.toggle('on', x === b));
});
$('modePlay').onclick = () => setMode('play');
$('modeBuild').onclick = () => setMode('build');
$('undo').onclick = undo; $('redo').onclick = redo;
$('sceneSel').onchange = () => { editing = $('sceneSel').value; select(null); sceneChanged(true); };
$('showPlayers').onclick = () => { sendMsg({ type: 'sceneActivate', sceneId: editing }); toast(`Players now see "${sc().name}"`); };

const updateScene = (patch) => sendMsg({ type: 'sceneUpdate', sceneId: editing, ...patch });
$('mapName').onchange = () => updateScene({ name: $('mapName').value });
$('mapName').onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };
$('applySize').onclick = () => updateScene({ cols: $('mapCols').value, rows: $('mapRows').value });
$('showGrid').onchange = () => updateScene({ showGrid: $('showGrid').checked });
$('newMap').onclick = () => { pendingNewScene = true; sendMsg({ type: 'sceneCreate', name: `Map ${order.length + 1}`, cols: 30, rows: 20 }); };
$('dupMap').onclick = () => { pendingNewScene = true; sendMsg({ type: 'sceneDuplicate', sceneId: editing }); };
$('delMap').onclick = (e) => {
  const b = e.currentTarget;
  if (b.dataset.armed) { sendMsg({ type: 'sceneDelete', sceneId: editing }); b.textContent = 'Delete this map'; delete b.dataset.armed; return; }
  b.dataset.armed = 1; b.textContent = `Click again to delete "${sc().name}"`;
  setTimeout(() => { b.textContent = 'Delete this map'; delete b.dataset.armed; }, 3000);
};

// background image upload
async function uploadBg(file) {
  if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast('Use a PNG, JPG, WebP or GIF image');
  toast('Uploading ' + file.name + '…', 10000);
  try {
    const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': file.type, 'X-DM-Key': dmKey }, body: file });
    if (!res.ok) throw new Error(await res.text());
    const { url } = await res.json();
    const img = loadImg(url);
    await (img.complete ? Promise.resolve() : new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); }));
    const px = guessSquare(img);
    $('pxPerSq').value = px;
    updateScene({ bg: { url }, cols: Math.round(img.naturalWidth / px), rows: Math.round(img.naturalHeight / px) });
    toast(`Map uploaded (${img.naturalWidth}×${img.naturalHeight}px). Grid set to ${px}px squares; change it and press Fit grid if it doesn't line up.`, 6000);
    setTimeout(fitView, 150);
  } catch (err) { toast('Upload failed: ' + err.message); }
}
// Most battle maps use 70, 100, 128, 140, 150 or 200 px squares. Pick the one that gives whole squares.
function guessSquare(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const cands = [70, 72, 100, 128, 140, 150, 200, 256, 50, 64];
  const fit = cands.filter((c) => w % c === 0 && h % c === 0 && w / c <= 120 && h / c <= 120 && w / c >= 5);
  return fit[0] || Number($('pxPerSq').value) || 70;
}
$('uploadBtn').onclick = () => $('fileIn').click();
$('fileIn').onchange = () => { uploadBg($('fileIn').files[0]); $('fileIn').value = ''; };
$('clearBg').onclick = () => updateScene({ bg: null });
$('fitBg').onclick = () => {
  const s = sc(); if (!s.bg) return toast('Upload an image first');
  const img = loadImg(s.bg.url), px = Number($('pxPerSq').value);
  if (!img.naturalWidth || !(px >= 10)) return;
  updateScene({ cols: Math.round(img.naturalWidth / px), rows: Math.round(img.naturalHeight / px) });
  setTimeout(fitView, 150);
};
const board = $('board');
board.addEventListener('dragover', (e) => { if (me.isDM && e.dataTransfer.types.includes('Files')) { e.preventDefault(); board.classList.add('drop'); } });
board.addEventListener('dragleave', () => board.classList.remove('drop'));
// Dropping images: in Build mode (any tool but Token) they become the map background; otherwise tokens at the drop point.
board.addEventListener('drop', async (e) => {
  e.preventDefault(); board.classList.remove('drop');
  if (!me.isDM) return;
  const files = [...e.dataTransfer.files];
  if (mode === 'build' && tool !== 'token') return uploadBg(files[0]);
  const c = toCell(toWorld(e)), s = sc();
  const items = await uploadTokens(files);
  items.forEach((it, i) => sendMsg({ type: 'addToken', sceneId: editing, label: nextFreeName(it.name), img: it.url, color: '#444444', size: 1, owner: '', x: Math.max(0, Math.min(s.cols - 1, c.x + i)), y: Math.max(0, Math.min(s.rows - 1, c.y)) }));
});

// ---------- map generator ----------
let genType = 'village', genSize = 'medium';
const libByName = () => Object.fromEntries(builtins().map((b) => [b.name, b]));
function syncGenDialog() {
  document.querySelectorAll('#genTypes button').forEach((b) => b.classList.toggle('on', b.dataset.gen === genType));
  document.querySelectorAll('#genSize button').forEach((b) => b.classList.toggle('on', b.dataset.size === genSize));
  $('genCreaturesLabel').textContent = { village: 'Add villagers and animals', dungeon: 'Add monsters', forest: 'Add bandits and wolves' }[genType];
  $('genMonsterRow').style.display = genType === 'dungeon' ? '' : 'none';
  $('genReplace').textContent = `Reroll "${sc() ? sc().name : 'this map'}"`;
}
function runGenerator(replace) {
  const seed = (Math.random() * 2 ** 31) | 0;
  const out = GENERATORS[genType](genSize, seed, { creatures: $('genCreatures').checked, monsters: $('genMonsters').value }, libByName());
  // With fog on, the fog keeps monsters out of sight until their area is revealed, so they needn't be hidden too.
  const fog = $('genFog').checked;
  const tokens = fog ? out.tokens.map((t) => ({ ...t, hidden: false })) : out.tokens;
  const content = { tiles: out.tiles, props: out.props, tokens, fog: { on: fog, reveal: out.start ? [out.start] : [] } };
  if (replace) {
    sendMsg({ type: 'sceneReplace', sceneId: editing, name: out.name, cols: out.cols, rows: out.rows, content });
    undoStack.length = redoStack.length = 0; updateUndo();
    setTimeout(fitView, 200);
    toast(`Rerolled as "${out.name}"`);
  } else {
    pendingNewScene = true;
    sendMsg({ type: 'sceneCreate', name: out.name, cols: out.cols, rows: out.rows, content });
  }
  $('genModal').hidden = true;
}
$('genBtn').onclick = () => { $('genFog').checked = genType === 'dungeon'; syncGenDialog(); $('genModal').hidden = false; };
document.querySelectorAll('#genTypes button').forEach((b) => b.onclick = () => { genType = b.dataset.gen; $('genFog').checked = genType === 'dungeon'; syncGenDialog(); });
document.querySelectorAll('#genSize button').forEach((b) => b.onclick = () => { genSize = b.dataset.size; syncGenDialog(); });
$('genNew').onclick = () => runGenerator(false);
$('genReplace').onclick = (e) => {
  const b = e.currentTarget;
  if (editing === active && !b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Players can see this map. Click again to reroll'; setTimeout(() => { delete b.dataset.armed; syncGenDialog(); }, 3000); return; }
  delete b.dataset.armed; runGenerator(true);
};

$('zoomIn').onclick = () => { const r = canvas.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.25); };
$('zoomOut').onclick = () => { const r = canvas.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 0.8); };
$('zoomFit').onclick = fitView;

// tokens panel
$('addToken').onclick = () => {
  const s = sc(), r = canvas.getBoundingClientRect();
  const c = toCell({ x: (r.width / 2 - view.x) / view.zoom, y: (r.height / 2 - view.y) / view.zoom });
  addToken(Math.max(0, Math.min(s.cols - 1, c.x)), Math.max(0, Math.min(s.rows - 1, c.y)));
};
$('delToken').onclick = () => selected && sendMsg({ type: 'removeToken', sceneId: editing, id: selected });
$('tColor').oninput = refreshArtPreview;

// ---------- dice ----------
let macros = [];
function addLog(e, fresh) {
  const div = document.createElement('div');
  div.className = 'entry' + (e.private ? ' private' : '') + (e.crit ? ' ' + e.crit : '') + (fresh ? ' fresh' : '');
  div.innerHTML = '<span class="total"></span><b></b> <span class="what"></span><span class="tags"></span><div class="detail"></div>';
  div.querySelector('.total').textContent = e.total;
  div.querySelector('b').textContent = e.who;
  div.querySelector('.what').textContent = e.label ? '· ' + e.label : 'rolled ' + e.expr;
  const tags = div.querySelector('.tags');
  const tag = (cls, text) => { const t = document.createElement('span'); t.className = 'tag ' + cls; t.textContent = text; tags.appendChild(t); };
  if (e.crit === 'nat20') tag('n20', 'NAT 20');
  if (e.crit === 'nat1') tag('n1', 'NAT 1');
  if (e.private) tag('priv', 'PRIVATE');
  div.querySelector('.detail').textContent = (e.label ? e.expr + ' → ' : '') + e.detail;
  $('log').prepend(div);
  while ($('log').children.length > 200) $('log').lastChild.remove();
}
function rollWith(expr, label, ev) {
  let x = expr;
  if (ev && /(^|[+-])1?d20(?!\d)/.test(x) && !/(adv|dis)$/.test(x)) { if (ev.shiftKey) x += 'adv'; else if (ev.altKey) x += 'dis'; }
  sendMsg({ type: 'roll', expr: x, label, private: $('private').checked });
}
function renderMacros() {
  const box = $('macros'); box.innerHTML = '';
  macros.forEach((m, i) => {
    const wrap = document.createElement('div'); wrap.className = 'macro';
    const go = document.createElement('button'); go.className = 'go'; go.title = m.expr;
    go.textContent = m.label; const sm = document.createElement('small'); sm.textContent = m.expr; go.appendChild(sm);
    go.onclick = (ev) => rollWith(m.expr, m.label, ev);
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.title = 'Remove';
    x.onclick = () => sendMsg({ type: 'setMacros', macros: macros.filter((_, j) => j !== i) });
    wrap.append(go, x); box.appendChild(wrap);
  });
  if (!macros.length) box.innerHTML = '<div class="hint" style="margin:0">None yet. Add your attacks, saves and skills below.</div>';
}
document.querySelectorAll('[data-roll]').forEach((b) => b.onclick = () => rollWith(b.dataset.roll, ''));
$('rollForm').onsubmit = (e) => { e.preventDefault(); if ($('expr').value.trim()) rollWith($('expr').value.trim(), ''); $('expr').value = ''; };
$('macroForm').onsubmit = (e) => {
  e.preventDefault();
  const label = $('mLabel').value.trim(), expr = $('mExpr').value.trim();
  if (!label || !expr) return;
  sendMsg({ type: 'setMacros', macros: [...macros, { label, expr }] });
  $('mLabel').value = ''; $('mExpr').value = ''; $('mLabel').focus();
};

// ---------- start ----------
function tryGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function trySet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
function start(name) { me.name = name; $('join').remove(); connect(); }

setTerrain('stone'); setPropKind('door'); setTool('select'); updateUndo(); resize();
window.tabletop = { view, cellToScreen: (x, y) => { const r = canvas.getBoundingClientRect(); return [r.left + view.x + (x + 0.5) * CELL * view.zoom, r.top + view.y + (y + 0.5) * CELL * view.zoom]; } };
const preset = params.get('name') || (dmKey ? 'DM' : '');
if (preset) start(preset);
else {
  $('name').value = tryGet('vtt-name') || '';
  $('joinForm').onsubmit = (e) => { e.preventDefault(); const n = $('name').value.trim(); if (!n) return; trySet('vtt-name', n); start(n); };
}
