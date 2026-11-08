import { CELL, TERRAINS, PROPS, PROP_CATS, DM_ONLY, texture, drawProp, swatch } from './art.js';
import { generate, SCHEMA, defaults } from './generate.js';
import { interpret, EXAMPLES } from './prompt.js';
import { readMapTool, layout as mapToolLayout } from './maptool.js';
import { drawTokenArt, thumb, builtins, credit, whenArtLoads, conditions, drawCondition, conditionThumb } from './tokens.js';

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
    case 'token': if (s) { s.tokens[msg.token.id] = msg.token; if (msg.token.id === selected) renderEditor(); if (msg.sceneId === editing) renderInit(); } break;
    case 'combat': if (s) { s.combat = msg.combat; if (msg.sceneId === editing) { renderInit(); renderEditor(); } } break;
    case 'removeToken': if (s) { delete s.tokens[msg.id]; if (selected === msg.id) select(null); renderInit(); } break;
    case 'tiles': if (s) for (const [x, y, t] of msg.cells) { if (t === null) delete s.tiles[x + ',' + y]; else s.tiles[x + ',' + y] = t; } break;
    case 'prop': if (s) s.props[msg.prop.id] = msg.prop; break;
    case 'fog': if (s) { const a = fogArr(s); for (const [x, y] of msg.cells) a[y * s.cols + x] = msg.reveal ? 1 : 0; fogDirty = true; if (fogTool === 'room' && hover) fogPreview = roomCells(s, hover); } break;
    case 'fogReveal': // player: an area came into view, with what's in it
      if (s) {
        const a = fogArr(s); for (const [x, y] of msg.cells) a[y * s.cols + x] = 1;
        Object.assign(s.tiles, msg.tiles); msg.props.forEach((p) => { s.props[p.id] = p; }); msg.tokens.forEach((t) => { s.tokens[t.id] = t; });
        (msg.labels || []).forEach((l) => { (s.labels = s.labels || {})[l.id] = l; });
        fogDirty = true;
      }
      break;
    case 'fogHide': // player: an area was covered again; forget what was there
      if (s) {
        const a = fogArr(s), set = new Set(msg.cells.map(([x, y]) => x + ',' + y));
        for (const [x, y] of msg.cells) { a[y * s.cols + x] = 0; delete s.tiles[x + ',' + y]; }
        for (const p of Object.values(s.props)) if (set.has(p.x + ',' + p.y)) delete s.props[p.id];
        for (const l of Object.values(s.labels || {})) if (set.has(Math.floor(l.x) + ',' + Math.floor(l.y))) delete s.labels[l.id];
        msg.tokens.forEach((id) => { delete s.tokens[id]; if (selected === id) select(null); });
        fogDirty = true;
      }
      break;
    case 'propRemove': if (s) delete s.props[msg.propId]; break;
    case 'template': if (s) { (s.templates = s.templates || {})[msg.tpl.id] = msg.tpl; } break;
    case 'templateRemove': if (s && s.templates) { msg.ids.forEach((id) => delete s.templates[id]); if (msg.ids.includes(selTpl)) selTpl = null; } break;
    case 'label': if (s) { (s.labels = s.labels || {})[msg.label.id] = msg.label; } break;
    case 'labelRemove': if (s && s.labels) { delete s.labels[msg.id]; if (labelEdit && labelEdit.id === msg.id) closeLabelEditor(); } break;
    case 'ping':
      pings.push({ sceneId: msg.sceneId, x: msg.x, y: msg.y, who: msg.who, dm: msg.dm, t0: performance.now() });
      if (msg.focus && msg.sceneId === editing) centreOnSquare(msg.x, msg.y);
      break;
    case 'measure': {
      const key = (msg.dm ? 'dm:' : 'p:') + msg.who;
      if (msg.points) remoteRulers.set(key, { sceneId: msg.sceneId, points: msg.points, name: msg.who, dm: msg.dm, t: Date.now() }); else remoteRulers.delete(key);
      break;
    }
    case 'sceneMeta': if (s) { Object.assign(s, msg.patch); if (msg.sceneId === editing) sceneChanged(false); } break;
    case 'sceneFull':
      if (msg.active) { const switched = active !== msg.scene.id; scenes = { [msg.scene.id]: msg.scene }; order = [msg.scene.id]; active = editing = msg.scene.id; sceneChanged(switched); }
      else { scenes[msg.scene.id] = msg.scene; if (msg.scene.id === editing) sceneChanged(false); }
      break;
    case 'sceneAdded':
      scenes[msg.scene.id] = msg.scene; order = msg.order;
      if (pendingNewScene) { pendingNewScene = false; editing = msg.scene.id; sceneChanged(true); if (!$('toast').classList.contains('show')) toast('New map created'); }
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
  if (refit) { selTpl = null; tplDraft = null; ruler = null; if (labelEdit) closeLabelEditor(); }
  renderInit(); renderEditor();
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
  $('mapCols').value = s.cols; $('mapRows').value = s.rows; $('showGrid').checked = s.showGrid !== false; $('mapDiag').value = s.diag || '5';
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
  drawTemplates(s);
  drawLabels(s);

  // tokens (hidden ones only ever reach the DM, drawn faded)
  const turnId = s.combat && s.combat.active ? s.combat.turnId : null;
  for (const t of Object.values(s.tokens)) {
    const pos = drag && drag.id === t.id ? drag.pos : { x: t.x * CELL, y: t.y * CELL };
    const rad = (t.size * CELL) / 2, cx = pos.x + rad, cy = pos.y + rad;
    if (t.id === turnId) { // whose turn it is: a glowing gold ring
      ctx.save(); ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 18; ctx.lineWidth = 5; ctx.strokeStyle = '#fbbf24';
      ctx.beginPath(); ctx.arc(cx, cy, rad - 1, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    ctx.globalAlpha = t.hidden ? 0.5 : 1;
    drawTokenArt(ctx, t, cx, cy, rad - 4, draw);
    const pct = hpFraction(t);
    if (pct === 0) { // down: darken and cross out
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.arc(cx, cy, rad - 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(220,38,38,.9)'; ctx.lineWidth = Math.max(3, rad * 0.12); const d = rad * 0.45;
      ctx.beginPath(); ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d); ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d); ctx.stroke();
    }
    ctx.lineWidth = t.id === selected ? 4 : 2.5;
    ctx.strokeStyle = t.id === selected ? '#fff' : t.owner && t.owner !== '*' ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.65)';
    if (t.hidden) ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.arc(cx, cy, rad - 4, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    // health bar along the bottom of the token
    if (pct != null) {
      const bw = t.size * CELL * 0.72, bh = Math.max(4, t.size * 3), bx = cx - bw / 2, by = pos.y + t.size * CELL - 14 - bh;
      ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#f59e0b' : '#ef4444'; ctx.fillRect(bx, by, bw * pct, bh);
      if (t.tempHp > 0 && t.maxHp > 0) { ctx.fillStyle = '#38bdf8'; ctx.fillRect(bx + bw * Math.min(1, pct), by, Math.min(bw * (1 - pct) + bw * 0.25, bw * t.tempHp / t.maxHp), bh); }
    }
    // condition badges round the top-right of the token
    const conds = t.conditions || [];
    if (conds.length) {
      const r = Math.max(7, rad * 0.24), shown = conds.slice(0, conds.length > 5 ? 4 : 5);
      shown.forEach((id, i) => { const a = -Math.PI / 2 + 0.5 + i * 0.62; drawCondition(ctx, id, cx + Math.cos(a) * (rad - 3), cy + Math.sin(a) * (rad - 3), r, draw); });
      if (conds.length > 5) { const a = -Math.PI / 2 + 0.5 + 4 * 0.62, x = cx + Math.cos(a) * (rad - 3), y = cy + Math.sin(a) * (rad - 3);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = `700 ${r}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('+' + (conds.length - 4), x, y + 1); }
    }
    ctx.globalAlpha = 1;
    if (view.zoom > 0.55) { // name tag under the token
      ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label = (t.hidden ? '◌ ' : '') + t.label, w = ctx.measureText(label).width + 8;
      ctx.fillStyle = t.hidden ? 'rgba(60,40,0,.8)' : 'rgba(0,0,0,.7)'; ctx.fillRect(cx - w / 2, pos.y + t.size * CELL - 5, w, 13);
      ctx.fillStyle = t.hidden ? '#fcd34d' : '#ddd'; ctx.fillText(label, cx, pos.y + t.size * CELL + 2);
    }
  }

  drawOverlays(s);
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
  if (!inside(s, c.x, c.y)) return null;
  if (!tileAt(c.x, c.y)) return s.walls && s.walls.length ? wallRoom(s, c) : null;
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
// On an imported map (no painted floor), a room is every square you can reach without crossing a wall or door.
const wallIndexes = new WeakMap();
function wallIndex(s) {
  let ix = wallIndexes.get(s.walls);
  if (ix && ix.doors === s.doors) return ix;
  ix = new Map(); ix.doors = s.doors;
  const segs = [...s.walls, ...(s.doors || [])];
  segs.forEach((g, i) => {
    const len = Math.hypot(g[2] - g[0], g[3] - g[1]), steps = Math.max(1, Math.ceil(len * 4));
    for (let k = 0; k <= steps; k++) {
      const x = g[0] + (g[2] - g[0]) * k / steps, y = g[1] + (g[3] - g[1]) * k / steps;
      for (const [cx, cy] of [[Math.floor(x), Math.floor(y)], [Math.floor(x - 1e-6), Math.floor(y - 1e-6)]]) {
        const key = cx + ',' + cy; let list = ix.get(key); if (!list) ix.set(key, list = new Set()); list.add(g);
      }
    }
  });
  wallIndexes.set(s.walls, ix);
  return ix;
}
function crosses(ax, ay, bx, by, g) {
  const d = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = d(g[0], g[1], g[2], g[3], ax, ay), d2 = d(g[0], g[1], g[2], g[3], bx, by), d3 = d(ax, ay, bx, by, g[0], g[1]), d4 = d(ax, ay, bx, by, g[2], g[3]);
  return ((d1 > 0) !== (d2 > 0) || d1 === 0 || d2 === 0) && ((d3 > 0) !== (d4 > 0) || d3 === 0 || d4 === 0) && !(d1 === 0 && d2 === 0);
}
function wallRoom(s, c) {
  const ix = wallIndex(s), seen = new Set([c.x + ',' + c.y]), q = [[c.x, c.y]], out = [];
  const blocked = (x, y, nx, ny) => {
    const ax = x + 0.5, ay = y + 0.5, bx = nx + 0.5, by = ny + 0.5;
    for (const key of [x + ',' + y, nx + ',' + ny]) { const list = ix.get(key); if (list) for (const g of list) if (crosses(ax, ay, bx, by, g)) return true; }
    return false;
  };
  while (q.length) {
    const [x, y] = q.pop(); out.push([x, y]);
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const k = nx + ',' + ny;
      if (seen.has(k) || !inside(s, nx, ny) || blocked(x, y, nx, ny)) continue;
      seen.add(k); q.push([nx, ny]);
    }
  }
  return out;
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
  if (fogTool && typeof tt !== 'undefined' && tt !== 'move') { tt = 'move'; ruler = null; $('tplPop').hidden = true; if (labelEdit) closeLabelEditor(); document.querySelectorAll('#tableBar [data-tt]').forEach((b) => b.classList.toggle('on', b.dataset.tt === 'move')); }
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

function drawWalls(s) {
  if (!me.isDM || !s.walls || !s.walls.length || !(mode === 'build' || fogTool === 'room')) return;
  const z = view.zoom;
  ctx.save(); ctx.lineCap = 'round';
  ctx.lineWidth = 2.5 / z; ctx.strokeStyle = 'rgba(56,189,248,.85)'; ctx.beginPath();
  for (const g of s.walls) { ctx.moveTo(g[0] * CELL, g[1] * CELL); ctx.lineTo(g[2] * CELL, g[3] * CELL); } ctx.stroke();
  ctx.lineWidth = 4 / z; ctx.strokeStyle = 'rgba(251,146,60,.95)'; ctx.beginPath();
  for (const g of s.doors || []) { ctx.moveTo(g[0] * CELL, g[1] * CELL); ctx.lineTo(g[2] * CELL, g[3] * CELL); } ctx.stroke();
  ctx.restore();
}
function drawToolPreview(s) {
  drawWalls(s);
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

// ---------- table tools (Play mode): ruler, spell templates, ping, labels ----------
// Positions here are in squares (1 = one 5-ft square), so they don't depend on zoom.
let tt = 'move';
let ruler = null;                    // my ruler: { points: [[x, y], ...], cur: [x, y] }
const remoteRulers = new Map();      // who → { sceneId, points, t }
const pings = [];                    // { sceneId, x, y, who, t0 }
let tplShape = 'cone', tplDraft = null, selTpl = null, tplDrag = null, tplAim = null;
const tplSizes = { cone: 15, sphere: 20, cube: 15, line: 60, cylinder: 10 };
let labelEdit = null, labelDrag = null;
const labelBoxes = new Map();        // id → box in world pixels, from the last frame

const PALETTE = ['#3b82f6', '#22c55e', '#a855f7', '#eab308', '#06b6d4', '#ec4899', '#f97316', '#14b8a6'];
const personColour = (name, dm) => dm ? '#e8390e' : PALETTE[[...String(name)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
const toSq = (p) => ({ x: p.x / CELL, y: p.y / CELL });
const centreOf = (c) => [c.x + 0.5, c.y + 0.5];

// Distance along a path of square centres. 5e: every diagonal square is 5 ft;
// the variant rule makes every second diagonal 10 ft (counted along the whole path).
function pathFeet(points, diag) {
  let squares = 0, diagonals = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = Math.round(Math.abs(points[i][0] - points[i - 1][0])), dy = Math.round(Math.abs(points[i][1] - points[i - 1][1]));
    const d = Math.min(dx, dy);
    squares += Math.max(dx, dy) - d;
    if (diag === '5105') { for (let k = 0; k < d; k++) squares += (++diagonals % 2 === 0) ? 2 : 1; }
    else squares += d;
  }
  return squares * 5;
}

// share what I'm measuring (a ruler, or a token I'm dragging) with the table, a few times a second
let measureTimer = null, measureLast = '';
function shareMeasure(points) {
  const key = points ? JSON.stringify(points) : '';
  if (key === measureLast) return;
  measureLast = key;
  clearTimeout(measureTimer);
  const go = () => { measureTimer = null; sendMsg({ type: 'measure', sceneId: editing, points: points || null }); };
  if (!points) go(); else measureTimer = setTimeout(go, 40);
}

function drawRuler(points, colour, who) {
  if (!points || points.length < 2) return;
  const s = sc(), ft = pathFeet(points, s.diag), z = view.zoom, end = points[points.length - 1];
  if (ft === 0 && points.length === 2) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); points.forEach(([x, y], i) => (i ? ctx.lineTo(x * CELL, y * CELL) : ctx.moveTo(x * CELL, y * CELL)));
  ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 7 / z; ctx.stroke();
  ctx.strokeStyle = colour; ctx.lineWidth = 3.5 / z; ctx.setLineDash([10 / z, 6 / z]); ctx.stroke(); ctx.setLineDash([]);
  for (const [x, y] of points) { ctx.beginPath(); ctx.arc(x * CELL, y * CELL, 5 / z, 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill(); ctx.lineWidth = 1.5 / z; ctx.strokeStyle = '#000'; ctx.stroke(); }
  const text = `${ft} ft` + (who ? ` · ${who}` : ''), fs = 15 / z;
  ctx.font = `700 ${fs}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 14 / z, bx = end[0] * CELL, by = end[1] * CELL - 24 / z;
  ctx.fillStyle = 'rgba(10,10,10,.88)'; ctx.beginPath(); ctx.roundRect(bx - w / 2, by - 12 / z, w, 24 / z, 6 / z); ctx.fill();
  ctx.strokeStyle = colour; ctx.lineWidth = 1.5 / z; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.fillText(text, bx, by + 1 / z);
  ctx.restore();
}
// the path of the token being dragged: from where it started, through any waypoints, to the square under it
function dragPath(s) {
  if (!drag || !drag.start) return null;
  const t = s.tokens[drag.id]; if (!t) return null;
  const h = t.size / 2, x = Math.max(0, Math.min(s.cols - t.size, Math.round(drag.pos.x / CELL))), y = Math.max(0, Math.min(s.rows - t.size, Math.round(drag.pos.y / CELL)));
  return [[drag.start.x + h, drag.start.y + h], ...drag.waypoints, [x + h, y + h]];
}

// ----- spell templates -----
const L = (t) => t.size / 5;
// a cube sits square on the grid: from its corner, towards whichever diagonal it was dragged
const cubeDir = (t) => [Math.cos(t.angle) >= -1e-9 ? 1 : -1, Math.sin(t.angle) >= -1e-9 ? 1 : -1];
function tplContains(t, px, py) {
  const dx = px - t.x, dy = py - t.y, e = 1e-6;
  if (t.shape === 'sphere' || t.shape === 'cylinder') return dx * dx + dy * dy <= L(t) * L(t) + e;
  if (t.shape === 'cube') { const [sx, sy] = cubeDir(t); return dx * sx >= -e && dx * sx <= L(t) + e && dy * sy >= -e && dy * sy <= L(t) + e; }
  const c = Math.cos(t.angle), sn = Math.sin(t.angle), along = dx * c + dy * sn, perp = Math.abs(-dx * sn + dy * c);
  if (along < -e || along > L(t) + e) return false;
  if (t.shape === 'cone') return perp <= along / 2 + e;
  if (t.shape === 'line') return perp <= (t.width || 5) / 10 + e;
  return perp <= L(t) / 2 + e; // cube
}
// squares whose centre is inside the template: the ones the spell hits
function tplCells(s, t) {
  const r = L(t) + 1, out = [];
  for (let y = Math.max(0, Math.floor(t.y - r)); y <= Math.min(s.rows - 1, Math.ceil(t.y + r)); y++)
    for (let x = Math.max(0, Math.floor(t.x - r)); x <= Math.min(s.cols - 1, Math.ceil(t.x + r)); x++)
      if (tplContains(t, x + 0.5, y + 0.5)) out.push([x, y]);
  return out;
}
function tplOutline(t) {
  const c = Math.cos(t.angle), sn = Math.sin(t.angle), P = (a, b) => [(t.x + a * c - b * sn) * CELL, (t.y + a * sn + b * c) * CELL];
  ctx.beginPath();
  if (t.shape === 'sphere' || t.shape === 'cylinder') { ctx.arc(t.x * CELL, t.y * CELL, L(t) * CELL, 0, Math.PI * 2); return; }
  if (t.shape === 'cube') { const [sx, sy] = cubeDir(t); ctx.rect(t.x * CELL, t.y * CELL, sx * L(t) * CELL, sy * L(t) * CELL); return; }
  const half = t.shape === 'cone' ? L(t) / 2 : t.shape === 'line' ? (t.width || 5) / 10 : L(t) / 2;
  const pts = t.shape === 'cone' ? [P(0, 0), P(L(t), -half), P(L(t), half)] : [P(0, -half), P(L(t), -half), P(L(t), half), P(0, half)];
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
}
const tplHandle = (t) => { if (t.shape === 'cube') { const [sx, sy] = cubeDir(t); return [t.x + sx * L(t), t.y + sy * L(t)]; } return [t.x + Math.cos(t.angle) * L(t), t.y + Math.sin(t.angle) * L(t)]; };
const tplName = (t) => `${t.size}-ft ${t.shape === 'sphere' || t.shape === 'cylinder' ? 'radius ' : ''}${t.shape}${t.shape === 'line' && t.width > 5 ? ` (${t.width} ft wide)` : ''}`;
const canEditTpl = (t) => me.isDM || (t.owner && t.owner === me.name);
function drawTemplate(s, t, draft) {
  const z = view.zoom, col = t.color || '#e8390e', shown = tplShown(t);
  ctx.save();
  ctx.fillStyle = col; ctx.globalAlpha = 0.28;
  for (const [x, y] of tplCells(s, shown)) ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
  ctx.globalAlpha = 0.14; tplOutline(shown); ctx.fill();
  ctx.globalAlpha = 1; ctx.lineWidth = (selTpl === t.id || draft ? 3 : 2) / z; ctx.strokeStyle = col;
  if (t.shape === 'cylinder') ctx.setLineDash([9 / z, 5 / z]);
  tplOutline(shown); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(shown.x * CELL, shown.y * CELL, 4 / z, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 / z; ctx.stroke();
  ctx.restore();
}
const tplShown = (t) => tplDrag && tplDrag.id === t.id && tplDrag.moved ? { ...t, x: tplDrag.x, y: tplDrag.y } : tplAim && tplAim.id === t.id ? { ...t, angle: tplAim.angle, size: tplAim.size } : t;
// drawn above the tokens: the selected template's size and its aiming handle
function drawTemplateInfo(t, draft) {
  const z = view.zoom, col = t.color || '#e8390e', shown = tplShown(t);
  ctx.save();
  { // size readout, and a handle to re-aim or resize it
    const [hx, hy] = tplHandle(shown);
    if (!draft) { ctx.beginPath(); ctx.arc(hx * CELL, hy * CELL, 7 / z, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 / z; ctx.stroke(); }
    const text = tplName(shown) + (t.by && t.by !== me.name ? ` · ${t.by}` : ''), fs = 13 / z;
    ctx.font = `700 ${fs}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 12 / z, bx = shown.x * CELL, by = shown.y * CELL - 18 / z;
    ctx.fillStyle = 'rgba(10,10,10,.88)'; ctx.fillRect(bx - w / 2, by - 10 / z, w, 20 / z);
    ctx.fillStyle = '#fff'; ctx.fillText(text, bx, by + 1 / z);
  }
  ctx.restore();
}
function templateAt(s, p) {
  const q = toSq(p), list = Object.values(s.templates || {}).filter(canEditTpl);
  for (let i = list.length - 1; i >= 0; i--) if (tplContains(list[i], q.x, q.y)) return list[i];
  return null;
}
function onTplHandle(s, p) {
  const t = selTpl && (s.templates || {})[selTpl]; if (!t || !canEditTpl(t)) return null;
  const [hx, hy] = tplHandle(t), q = toSq(p);
  return Math.hypot(q.x - hx, q.y - hy) * CELL * view.zoom < 12 ? t : null;
}
// aim from the origin towards the mouse; the distance sets the size (whole squares)
function aimAt(origin, q, minSize, shape) {
  if (shape === 'cube') { const dx = q.x - origin.x, dy = q.y - origin.y; return { angle: Math.atan2(dy >= 0 ? 1 : -1, dx >= 0 ? 1 : -1), size: Math.max(minSize, Math.round(Math.max(Math.abs(dx), Math.abs(dy))) * 5) }; }
  let angle = Math.atan2(q.y - origin.y, q.x - origin.x);
  const step = Math.PI / 4, near = Math.round(angle / step) * step;
  if (Math.abs(angle - near) < 0.07) angle = near; // snap to straight and diagonal
  const dist = Math.hypot(q.x - origin.x, q.y - origin.y);
  return { angle, size: Math.max(minSize, Math.round(dist) * 5) };
}
function newTemplate(p) {
  const q = toSq(p), o = { x: Math.round(q.x), y: Math.round(q.y) }; // spells start on a grid corner
  tplDraft = { shape: tplShape, x: o.x, y: o.y, angle: tplShape === 'cube' ? Math.PI / 4 : 0, size: Number($('tplSize').value) || tplSizes[tplShape], width: Number($('tplWidth').value) || 5,
    color: personColour(me.name, me.isDM), dragged: false };
}
function finishTemplate() {
  const d = tplDraft; tplDraft = null;
  const id = uid();
  sendMsg({ type: 'templateSet', sceneId: editing, tpl: { id, shape: d.shape, x: d.x, y: d.y, angle: d.angle, size: d.size, width: d.width, color: d.color } });
  tplSizes[d.shape] = d.size; $('tplSize').value = d.size;
  selTpl = id;
}

const TPL_HELP = {
  cone: 'Drag from where the cone starts, in the direction it points. Or click to place one pointing right.',
  sphere: 'Click a grid corner for the centre, or drag out to the radius you want.',
  cube: 'Drag from one corner of the cube to the opposite corner.',
  line: 'Drag from the caster in the direction of the line.',
  cylinder: 'Click a grid corner for the centre, or drag out to the radius you want.'
};
function setTplShape(shape) {
  tplShape = shape;
  document.querySelectorAll('#tplPop [data-shape]').forEach((b) => b.classList.toggle('on', b.dataset.shape === shape));
  $('tplSize').value = tplSizes[shape];
  $('tplSizeLbl').textContent = shape === 'sphere' || shape === 'cylinder' ? 'Radius' : shape === 'cube' ? 'Side' : 'Length';
  document.querySelectorAll('#tplPop .tplw').forEach((el) => { el.style.display = shape === 'line' ? '' : 'none'; });
  $('tplHelp').innerHTML = TPL_HELP[shape] + ' Click one of yours to move it; drag its dot to aim or resize; <kbd>Del</kbd> removes it.';
}
document.querySelectorAll('#tplPop [data-shape]').forEach((b) => b.onclick = () => setTplShape(b.dataset.shape));
$('tplSize').onchange = () => { const v = Math.max(5, Math.round(Number($('tplSize').value) / 5) * 5 || 5); $('tplSize').value = v; tplSizes[tplShape] = v;
  const t = selTpl && (sc().templates || {})[selTpl]; if (t && t.shape === tplShape && canEditTpl(t)) sendMsg({ type: 'templateSet', sceneId: editing, tpl: { id: t.id, size: v } }); };
$('tplWidth').onchange = () => { const t = selTpl && (sc().templates || {})[selTpl]; if (t && t.shape === 'line' && canEditTpl(t)) sendMsg({ type: 'templateSet', sceneId: editing, tpl: { id: t.id, width: $('tplWidth').value } }); };
$('tplClearMine').onclick = () => { sendMsg({ type: 'templateRemove', sceneId: editing, mine: true }); selTpl = null; };
$('tplClearAll').onclick = () => { sendMsg({ type: 'templateRemove', sceneId: editing, all: true }); selTpl = null; };

// ----- pings -----
function sendPing(p, focus) { const q = toSq(p); sendMsg({ type: 'ping', sceneId: editing, x: q.x, y: q.y, focus: !!focus }); }
function drawPings() {
  const now = performance.now(), z = view.zoom;
  for (let i = pings.length - 1; i >= 0; i--) if (now - pings[i].t0 > 2400) pings.splice(i, 1);
  for (const pg of pings) {
    if (pg.sceneId !== editing) continue;
    const age = (now - pg.t0) / 2400, X = pg.x * CELL, Y = pg.y * CELL, col = personColour(pg.who, pg.dm);
    ctx.save();
    for (let k = 0; k < 3; k++) {
      const a = (age * 1.6 - k * 0.22); if (a < 0 || a > 1) continue;
      ctx.globalAlpha = (1 - a) * 0.9; ctx.strokeStyle = col; ctx.lineWidth = 4 / z;
      ctx.beginPath(); ctx.arc(X, Y, (8 + a * 70) / z, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = Math.min(1, (1 - age) * 2);
    ctx.beginPath(); ctx.arc(X, Y, 7 / z, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2 / z; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.font = `700 ${13 / z}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(pg.who).width + 12 / z;
    ctx.fillStyle = 'rgba(10,10,10,.85)'; ctx.fillRect(X - w / 2, Y + 14 / z, w, 19 / z); ctx.fillStyle = '#fff'; ctx.fillText(pg.who, X, Y + 24 / z);
    ctx.restore();
  }
  if (pings.length) draw();
}

// ----- labels and DM notes -----
const LABEL_PX = { s: 11, m: 16, l: 26 };
function drawLabels(s) {
  labelBoxes.clear();
  for (const l of Object.values(s.labels || {})) {
    const pos = labelDrag && labelDrag.id === l.id ? labelDrag.pos : l;
    const fs = LABEL_PX[l.size] || 16, text = (l.dmOnly ? '📝 ' : '') + l.text, X = pos.x * CELL, Y = pos.y * CELL;
    ctx.font = `${l.dmOnly ? 600 : 700} ${fs}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + fs * 0.9, h = fs * 1.6, box = { x: X - w / 2, y: Y - h / 2, w, h };
    labelBoxes.set(l.id, box);
    if (l.dmOnly) {
      ctx.fillStyle = 'rgba(253,230,138,.93)'; ctx.fillRect(box.x, box.y, w, h);
      ctx.setLineDash([4, 3]); ctx.strokeStyle = '#a16207'; ctx.lineWidth = 1.5; ctx.strokeRect(box.x, box.y, w, h); ctx.setLineDash([]);
      ctx.fillStyle = '#422006'; ctx.fillText(text, X, Y + 1);
    } else {
      ctx.fillStyle = 'rgba(12,12,12,.72)'; ctx.beginPath(); ctx.roundRect(box.x, box.y, w, h, h / 2); ctx.fill();
      ctx.fillStyle = '#f5f0e6'; ctx.fillText(text, X, Y + 1);
    }
    if (labelEdit && labelEdit.id === l.id) { ctx.strokeStyle = '#ff6b35'; ctx.lineWidth = 2 / view.zoom; ctx.strokeRect(box.x - 3, box.y - 3, w + 6, h + 6); }
  }
}
function labelAt(p) {
  const ids = [...labelBoxes.keys()].reverse();
  for (const id of ids) { const b = labelBoxes.get(id); if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return id; }
  return null;
}
function openLabelEditor(l) {
  labelEdit = l;
  const pop = $('labelPop'), X = view.x + l.x * CELL * view.zoom, Y = view.y + l.y * CELL * view.zoom, r = canvas.getBoundingClientRect();
  pop.hidden = false;
  pop.style.left = Math.max(70, Math.min(r.width - 290, X - 140)) + 'px';
  pop.style.top = Math.max(10, Math.min(r.height - 120, Y + 24)) + 'px';
  $('lblText').value = l.text || ''; $('lblSize').value = l.size || 'm'; $('lblNote').checked = !!l.dmOnly;
  $('lblDel').style.display = l.id ? '' : 'none';
  setTimeout(() => $('lblText').focus(), 0);
  draw();
}
function closeLabelEditor() { labelEdit = null; $('labelPop').hidden = true; draw(); }
function saveLabel() {
  if (!labelEdit) return;
  const text = $('lblText').value.trim();
  if (!text) { if (labelEdit.id) sendMsg({ type: 'labelRemove', sceneId: editing, id: labelEdit.id }); return closeLabelEditor(); }
  sendMsg({ type: 'labelSet', sceneId: editing, label: { id: labelEdit.id || uid(), x: labelEdit.x, y: labelEdit.y, text, size: $('lblSize').value, dmOnly: $('lblNote').checked } });
  trySet('tt-labelNote', $('lblNote').checked ? '1' : '');
  closeLabelEditor();
}
$('lblSave').onclick = saveLabel;
$('lblCancel').onclick = closeLabelEditor;
$('lblDel').onclick = () => { if (labelEdit && labelEdit.id) sendMsg({ type: 'labelRemove', sceneId: editing, id: labelEdit.id }); closeLabelEditor(); };
$('lblText').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveLabel(); if (e.key === 'Escape') closeLabelEditor(); });

// ----- the tool bar -----
function setTableTool(t) {
  if (t === 'label' && !me.isDM) t = 'move';
  tt = t;
  if (fogTool) setFogTool(null);
  document.querySelectorAll('#tableBar [data-tt]').forEach((b) => b.classList.toggle('on', b.dataset.tt === t));
  $('tplPop').hidden = t !== 'template';
  if (t === 'template') setTplShape(tplShape);
  if (t !== 'label') closeLabelEditor();
  if (t !== 'template' && t !== 'move') selTpl = null;
  ruler = null; shareMeasure(null);
  updateCursor(); draw();
}
document.querySelectorAll('#tableBar [data-tt]').forEach((b) => b.onclick = () => setTableTool(b.dataset.tt));

function drawTemplates(s) {
  for (const t of Object.values(s.templates || {})) drawTemplate(s, t, false);
  if (tplDraft) drawTemplate(s, tplDraft, true);
}
function drawOverlays(s) {
  const st = selTpl && (s.templates || {})[selTpl];
  if (st) drawTemplateInfo(st, false);
  if (tplDraft) drawTemplateInfo(tplDraft, true);
  const now = Date.now();
  for (const [who, r] of remoteRulers) {
    if (now - r.t > 15000) { remoteRulers.delete(who); continue; }
    if (r.sceneId === editing) drawRuler(r.points, personColour(r.name, r.dm), r.name);
  }
  if (ruler) drawRuler([...ruler.points, ruler.cur], personColour(me.name, me.isDM));
  const dp = dragPath(s); if (dp) drawRuler(dp, personColour(me.name, me.isDM));
  drawPings();
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
  art = entry ? { icon: entry.icon || null, img: entry.url || entry.img || null, name: entry.name, hp: entry.hp, init: entry.init } : { name: 'Plain token' };
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
function select(id) { selected = id; renderEditor(); renderInit(); draw(); }
function addToken(x, y) {
  const label = $('tLabel').value.trim() || 'Token';
  const stats = art.hp ? { hp: art.hp, maxHp: art.hp } : {};
  if (art.init != null) stats.initBonus = art.init;
  sendMsg({ type: 'addToken', sceneId: editing, label, color: $('tColor').value, owner: $('tOwner').value, size: $('tSize').value, x, y, icon: art.icon || null, img: art.img || null, hidden: $('tHidden').checked, ...stats });
  // number the next one automatically: "Goblin 1" -> "Goblin 2"
  const m = label.match(/^(.*?)(\d+)$/);
  $('tLabel').value = m ? m[1] + (Number(m[2]) + 1) : label + ' 2';
}

// ----- selected token panel: DM edits everything; players edit their own character's health and conditions -----
const mine = (t) => t && t.owner && t.owner === me.name;
// fraction of health left (0–1), or null when unknown/not shown
function hpFraction(t) {
  if (t.maxHp > 0 && t.hp != null) return Math.max(0, Math.min(1, t.hp / t.maxHp));
  if (t.hpPct != null) return t.hpPct / 100;
  return null;
}
function renderEditor() {
  const t = selected && sc() && sc().tokens[selected];
  const show = !!t && (me.isDM || mine(t));
  $('editSec').classList.toggle('off', !show);
  if (!show) return;
  $('editTitle').textContent = me.isDM ? 'Selected token' : t.label;
  const keep = document.activeElement, setv = (id, v) => { if (keep !== $(id)) $(id).value = v ?? ''; };
  if (me.isDM) {
    setv('eLabel', t.label); setv('eOwner', t.owner || '');
    $('eColor').value = t.color; $('eSize').value = String(t.size); $('eHidden').checked = !!t.hidden;
    $('eHpShow').value = t.hpShow || '';
    thumb(t, 44, $('editArt'));
    const c = sc().combat; $('eToInit').textContent = c && c.active && c.entries.some((e) => e.id === t.id) ? '✓ In initiative' : '⚔ Add to initiative';
  }
  setv('eHp', t.hp); setv('eMaxHp', t.maxHp); setv('eTemp', t.tempHp || ''); setv('eInit', t.initBonus ?? '');
  const on = new Set(t.conditions || []);
  $('eConds').querySelectorAll('button').forEach((b) => b.classList.toggle('on', on.has(b.dataset.id)));
}
function buildConditionGrid() {
  const box = $('eConds'); box.innerHTML = '';
  for (const c of conditions()) {
    const b = document.createElement('button'); b.dataset.id = c.id; b.title = c.name;
    b.appendChild(conditionThumb(c.id, 14));
    b.onclick = () => {
      const t = sc() && sc().tokens[selected]; if (!t) return;
      const set = new Set(t.conditions || []); set.has(c.id) ? set.delete(c.id) : set.add(c.id);
      updateSelected({ conditions: [...set] });
    };
    box.appendChild(b);
  }
}
const numOrNull = (v) => (String(v).trim() === '' ? null : Number(v));
$('eHp').onchange = () => updateSelected({ hp: numOrNull($('eHp').value) });
$('eMaxHp').onchange = () => { const t = sc().tokens[selected]; const max = numOrNull($('eMaxHp').value); updateSelected(t && t.hp == null && max != null ? { maxHp: max, hp: max } : { maxHp: max }); };
$('eTemp').onchange = () => updateSelected({ tempHp: Number($('eTemp').value) || 0 });
$('eInit').onchange = () => updateSelected({ initBonus: Number($('eInit').value) || 0 });
$('eHpShow').onchange = () => updateSelected({ hpShow: $('eHpShow').value || null });
const applyHp = (sign) => {
  const n = Math.abs(parseInt($('eAmt').value, 10)); if (!n || !selected) return;
  const t = sc().tokens[selected];
  if (t && t.hp == null && t.maxHp == null) return toast('Set the token\'s HP first');
  sendMsg({ type: 'hpChange', sceneId: editing, id: selected, amount: sign * n }); $('eAmt').value = '';
};
$('eDmg').onclick = () => applyHp(-1); $('eHeal').onclick = () => applyHp(1);
$('eAmt').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); applyHp(e.shiftKey ? 1 : -1); } };
$('eToInit').onclick = () => {
  if (!selected) return;
  const c = sc().combat;
  sendMsg({ type: c && c.active ? 'combatAdd' : 'combatStart', sceneId: editing, ids: [selected] });
};

// ----- initiative panel -----
function renderInit() {
  const s = sc(), c = s && s.combat;
  const active = !!(c && c.active);
  $('initSec').classList.toggle('off', !active);
  $('startSec').classList.toggle('off', active || !me.isDM);
  if (!active) return;
  $('initRound').textContent = `Round ${c.round}`;
  $('initHidden').style.display = c.hiddenTurn ? '' : 'none';
  const list = $('initList'); list.innerHTML = '';
  if (!c.entries.length) list.innerHTML = '<div class="hint">No one yet. Select a token and click "+ Selected", or add everyone on the map.</div>';
  for (const e of c.entries) {
    const t = s.tokens[e.id]; if (!t) continue;
    const row = document.createElement('div');
    const frac = hpFraction(t);
    row.className = 'irow' + (e.id === c.turnId ? ' turn' : '') + (frac === 0 ? ' down' : '');
    const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.textContent = e.id === c.turnId ? '▸' : ''; row.appendChild(arrow);
    row.appendChild(thumb(t, 13));
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = (t.hidden ? '◌ ' : '') + t.label;
    for (const id of (t.conditions || []).slice(0, 4)) { const cc = conditions().find((x) => x.id === id); if (cc) { const dot = document.createElement('span'); dot.className = 'ci'; dot.style.background = cc.color; dot.title = cc.name; nm.appendChild(dot); } }
    row.appendChild(nm);
    // health
    const hp = document.createElement('span'); hp.className = 'hp';
    if (t.hp != null && t.maxHp != null) { hp.innerHTML = `<b>${t.hp}</b>/${t.maxHp}`; if (t.tempHp > 0) { const tm = document.createElement('span'); tm.className = 'tmp'; tm.textContent = ` +${t.tempHp}`; hp.appendChild(tm); } }
    else if (frac != null) { const bar = document.createElement('div'); bar.className = 'minibar'; const f = document.createElement('div'); f.style.width = frac * 100 + '%'; f.style.background = frac > 0.5 ? '#22c55e' : frac > 0.25 ? '#f59e0b' : '#ef4444'; bar.appendChild(f); hp.appendChild(bar); }
    row.appendChild(hp);
    // initiative: editable by the DM, and by a player for their own token
    if (me.isDM || mine(t)) {
      if (e.init == null && (mine(t) || !me.isDM)) { const rb = document.createElement('button'); rb.className = 'rl'; rb.textContent = '🎲'; rb.title = `Roll initiative (1d20${t.initBonus ? (t.initBonus > 0 ? '+' : '') + t.initBonus : ''})`; rb.onclick = (ev) => { ev.stopPropagation(); sendMsg({ type: 'combatRoll', sceneId: editing, tokenIds: [t.id] }); }; row.appendChild(rb); }
      const inp = document.createElement('input'); inp.type = 'number'; inp.value = e.init ?? ''; inp.placeholder = '–'; inp.title = 'Initiative';
      inp.onclick = (ev) => ev.stopPropagation();
      inp.onchange = () => sendMsg({ type: 'combatInit', sceneId: editing, tokenId: t.id, init: inp.value === '' ? null : Number(inp.value) });
      row.appendChild(inp);
    } else { const ini = document.createElement('span'); ini.className = 'ini'; ini.textContent = e.init ?? '–'; row.appendChild(ini); }
    if (me.isDM) { const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.title = 'Remove from initiative'; x.onclick = (ev) => { ev.stopPropagation(); sendMsg({ type: 'combatRemove', sceneId: editing, tokenId: t.id }); }; row.appendChild(x); }
    row.onclick = () => { select(t.id); centreOn(t); };
    list.appendChild(row);
  }
}
function centreOn(t) {
  const r = canvas.getBoundingClientRect(), cx = (t.x + t.size / 2) * CELL, cy = (t.y + t.size / 2) * CELL;
  const sx = view.x + cx * view.zoom, sy = view.y + cy * view.zoom;
  if (sx < 60 || sy < 60 || sx > r.width - 60 || sy > r.height - 60) { view.x = r.width / 2 - cx * view.zoom; view.y = r.height / 2 - cy * view.zoom; draw(); }
}
function centreOnSquare(x, y) {
  const r = canvas.getBoundingClientRect();
  view.x = r.width / 2 - x * CELL * view.zoom; view.y = r.height / 2 - y * CELL * view.zoom; draw();
}
// Everyone players can see, plus every monster (the DM decides who's actually in the fight)
const allTokenIds = () => Object.values(sc().tokens).map((t) => t.id);
$('combatStart').onclick = () => sendMsg({ type: 'combatStart', sceneId: editing, ids: allTokenIds() });
$('initAddAll').onclick = () => sendMsg({ type: 'combatAdd', sceneId: editing, ids: allTokenIds() });
$('initAddSel').onclick = () => selected ? sendMsg({ type: 'combatAdd', sceneId: editing, ids: [selected] }) : toast('Click a token on the map first');
$('initRollMon').onclick = () => sendMsg({ type: 'combatRoll', sceneId: editing, who: 'monsters', onlyUnrolled: true });
$('initNext').onclick = () => sendMsg({ type: 'combatNext', sceneId: editing });
$('initPrev').onclick = () => sendMsg({ type: 'combatPrev', sceneId: editing });
$('initEnd').onclick = (ev) => {
  const b = ev.currentTarget;
  if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Click again to end'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'End combat'; }, 3000); return; }
  delete b.dataset.armed; b.textContent = 'End combat'; sendMsg({ type: 'combatEnd', sceneId: editing });
};
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
whenArtLoads(() => { draw(); refreshArtPreview(); buildConditionGrid(); renderInit(); renderEditor(); if (!$('libModal').hidden) renderLibrary(); });

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
      if (!cells) toast('Reveal room works on built, generated and imported Universal VTT maps (it follows their walls). On a plain image map, use the Reveal brush.');
      else fogCells(s, cells, true);
      flushFog();
    } else { fogStroke = { reveal: fogTool === 'reveal', last: c }; fogBrushAt(s, c.x, c.y, fogStroke.reveal); }
    draw(); return;
  }

  if (!building) { // Play mode: the table tools
    if (e.altKey || tt === 'ping') { sendPing(p, e.shiftKey && me.isDM); return; }
    if (tt === 'ruler') { const c0 = centreOf(c); ruler = { points: [c0], cur: c0 }; draw(); return; }
    if (tt === 'template') {
      const h = onTplHandle(s, p);
      if (h) { tplAim = { id: h.id, angle: h.angle, size: h.size }; return; }
      const tp = templateAt(s, p);
      if (tp) { selTpl = tp.id; tplDrag = { id: tp.id, from: toSq(p), x: tp.x, y: tp.y, moved: false }; draw(); return; }
      selTpl = null; newTemplate(p); draw(); return;
    }
    if (tt === 'label' && me.isDM) {
      const id = labelAt(p), l = id && s.labels[id];
      if (l) labelDrag = { id, from: p, pos: { x: l.x, y: l.y }, moved: false };
      else { const c0 = centreOf(c); openLabelEditor({ x: c0[0], y: c0[1], text: '', size: 'm', dmOnly: tryGet('tt-labelNote') === '1' }); }
      return;
    }
    // Move tool: tokens first; otherwise a template of yours can be picked up
    if (!tokenAt(s, p)) {
      const h = onTplHandle(s, p);
      if (h) { tplAim = { id: h.id, angle: h.angle, size: h.size }; return; }
      const tp = templateAt(s, p);
      if (tp) { select(null); selTpl = tp.id; tplDrag = { id: tp.id, from: toSq(p), x: tp.x, y: tp.y, moved: false }; draw(); return; }
    }
    if (selTpl) { selTpl = null; draw(); }
  }

  if (!building || tool === 'select') {
    const t = tokenAt(s, p);
    select(t ? t.id : null);
    if (t) {
      clearMapSelection();
      if (canMove(t)) drag = { id: t.id, off: { x: p.x - t.x * CELL, y: p.y - t.y * CELL }, pos: { x: t.x * CELL, y: t.y * CELL }, start: { x: t.x, y: t.y }, waypoints: [] };
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
  if (ruler) { const cur = centreOf(c); if (cur[0] !== ruler.cur[0] || cur[1] !== ruler.cur[1]) { ruler.cur = cur; shareMeasure([...ruler.points, cur]); draw(); } return; }
  if (tplDraft) {
    const q = toSq(p), d = Math.hypot(q.x - tplDraft.x, q.y - tplDraft.y);
    if (d > 0.45 || tplDraft.dragged) { Object.assign(tplDraft, aimAt(tplDraft, q, 5, tplDraft.shape)); tplDraft.dragged = true; }
    draw(); return;
  }
  if (tplAim) { const t = (s.templates || {})[tplAim.id]; if (t) Object.assign(tplAim, aimAt(t, toSq(p), 5, t.shape)); draw(); return; }
  if (tplDrag) {
    const t = (s.templates || {})[tplDrag.id], q = toSq(p);
    if (t) { const nx = t.x + Math.round(q.x - tplDrag.from.x), ny = t.y + Math.round(q.y - tplDrag.from.y); tplDrag.moved = tplDrag.moved || nx !== t.x || ny !== t.y; tplDrag.x = nx; tplDrag.y = ny; }
    draw(); return;
  }
  if (labelDrag) {
    const l = s.labels[labelDrag.id];
    if (l && Math.hypot(p.x - labelDrag.from.x, p.y - labelDrag.from.y) > 4) { labelDrag.moved = true; const c0 = centreOf(c); labelDrag.pos = { x: c0[0], y: c0[1] }; }
    draw(); return;
  }
  if (pan) { view.x = pan.vx + e.clientX - pan.sx; view.y = pan.vy + e.clientY - pan.sy; draw(); }
  else if (drag) {
    drag.pos = { x: p.x - drag.off.x, y: p.y - drag.off.y };
    // players share the path of their token as they drag it; the DM's moves stay private (monsters in the dark)
    if (!me.isDM) { const dp = dragPath(s); if (dp) shareMeasure(pathFeet(dp, s.diag) ? dp : null); }
    draw();
  }
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
  if (ruler) { ruler = null; shareMeasure(null); draw(); }
  if (tplDraft) finishTemplate();
  if (tplAim) { sendMsg({ type: 'templateSet', sceneId: editing, tpl: { id: tplAim.id, angle: tplAim.angle, size: tplAim.size } }); const t = s && (s.templates || {})[tplAim.id]; if (t) Object.assign(t, { angle: tplAim.angle, size: tplAim.size }); tplAim = null; }
  if (tplDrag) {
    const t = s && (s.templates || {})[tplDrag.id];
    if (t && tplDrag.moved) { t.x = tplDrag.x; t.y = tplDrag.y; sendMsg({ type: 'templateSet', sceneId: editing, tpl: { id: t.id, x: t.x, y: t.y } }); }
    tplDrag = null;
  }
  if (labelDrag) {
    const l = s && s.labels[labelDrag.id];
    if (l && labelDrag.moved) { Object.assign(l, labelDrag.pos); sendMsg({ type: 'labelSet', sceneId: editing, label: { id: l.id, x: l.x, y: l.y } }); }
    else if (l) openLabelEditor(l);
    labelDrag = null;
  }
  if (drag && !me.isDM) shareMeasure(null);
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
  if (e.key === ' ' && !typing && (ruler || (drag && drag.start))) { // a corner in the path
    e.preventDefault(); if (e.repeat) return;
    const s = sc();
    if (ruler) { const last = ruler.points[ruler.points.length - 1]; if (last[0] !== ruler.cur[0] || last[1] !== ruler.cur[1]) ruler.points.push(ruler.cur); }
    else { const dp = dragPath(s); if (dp) drag.waypoints.push(dp[dp.length - 1]); }
    return draw();
  }
  if (e.key === ' ' && !typing) { spaceDown = true; updateCursor(); e.preventDefault(); return; }
  if (typing) return;
  if (e.key === 'Home') return fitView();
  if (mode !== 'build' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const k = e.key.toLowerCase(), s = sc();
    if (e.key === 'Escape' && (selTpl || labelEdit)) { selTpl = null; closeLabelEditor(); return draw(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selTpl && s && (s.templates || {})[selTpl]) { e.preventDefault(); sendMsg({ type: 'templateRemove', sceneId: editing, id: selTpl }); selTpl = null; return; }
    const pick = { v: 'move', r: 'ruler', t: 'template', p: 'ping', l: 'label' }[k];
    if (pick && !(pick === 'label' && !me.isDM)) return setTableTool(pick);
    if (e.key === 'Escape' && tt !== 'move' && !fogTool) return setTableTool('move');
  }
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
  canvas.style.cursor = spaceDown ? 'grab' : (me.isDM && mode === 'build' && tool !== 'select') || (mode !== 'build' && tt !== 'move') ? 'crosshair' : 'default';
}

// ---------- build UI ----------
function setMode(m) {
  mode = m;
  document.body.classList.toggle('build', m === 'build');
  if (m === 'build' && tt !== 'move') setTableTool('move');
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
$('mapDiag').onchange = () => updateScene({ diag: $('mapDiag').value });
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
    const px = detectGrid(img) || guessSquare(img);
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
  const fit = cands.filter((c) => w % c === 0 && h % c === 0 && w / c <= 200 && h / c <= 200 && w / c >= 5);
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
// ---------- importing maps ----------
// Universal VTT (.uvtt / .dd2vtt / .df2vtt: Dungeon Scrawl, Dungeondraft, Dungeon Alchemist…) bring the image,
// grid and walls; a plain image (Canvas of Kings, Inkarnate…) becomes a map with its grid worked out from the picture.
const UVTT_EXT = /\.(uvtt|dd2vtt|df2vtt|json)$/i, MAPTOOL_EXT = /\.(rpmap|cmpgn|rptok)$/i, TTMAP_EXT = /\.ttmap$/i;
const IMPORTABLE = (f) => UVTT_EXT.test(f.name) || MAPTOOL_EXT.test(f.name) || TTMAP_EXT.test(f.name);
const niceName = (f) => f.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Imported map';
async function importMapFile(file) {
  if (!file) return;
  try {
    if (UVTT_EXT.test(file.name)) return await importUvtt(file);
    if (MAPTOOL_EXT.test(file.name)) return await importMapTool(file);
    if (TTMAP_EXT.test(file.name)) return await importTtmap(file);
    if (/^image\/(png|jpeg|webp)$/.test(file.type)) return await importImage(file);
    toast('Import a MapTool file (.rpmap, .cmpgn, .rptok), a Tabletop map (.ttmap), a Universal VTT file (.uvtt, .dd2vtt, .df2vtt) or a PNG, JPG or WebP map image', 6000);
  } catch (err) { toast('Import failed: ' + err.message, 6000); }
}
async function importUvtt(file) {
  toast(`Reading ${file.name}…`, 20000);
  let d;
  try { d = JSON.parse(await file.text()); } catch { return toast(`${file.name} isn't a Universal VTT map file`, 5000); }
  const r = d && d.resolution;
  if (!r || !r.map_size || !(r.map_size.x > 0) || !(r.map_size.y > 0)) return toast(`${file.name} has no map size in it; is it a Universal VTT file?`, 5000);
  const ox = (r.map_origin && r.map_origin.x) || 0, oy = (r.map_origin && r.map_origin.y) || 0;
  const cols = Math.max(5, Math.ceil(r.map_size.x - 1e-6)), rows = Math.max(5, Math.ceil(r.map_size.y - 1e-6));
  if (cols > 200 || rows > 200) return toast(`That map is ${cols} × ${rows} squares. Tabletop handles up to 200 × 200.`, 6000);
  if (typeof d.image !== 'string' || d.image.length < 100) return toast(`${file.name} has no map image in it. Export it again with the image included.`, 6000);
  const b64 = d.image.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  const mime = b64.startsWith('iVBOR') ? 'image/png' : b64.startsWith('/9j/') ? 'image/jpeg' : b64.startsWith('UklGR') ? 'image/webp' : null;
  if (!mime) return toast('The map image in that file is in a format Tabletop can\'t show (needs PNG, JPG or WebP)', 6000);
  toast('Uploading the map image…', 30000);
  const blob = await (await fetch(`data:${mime};base64,${b64}`)).blob();
  const url = await uploadFile(new File([blob], file.name, { type: mime }));
  const P = (p) => [Number(p.x) - ox, Number(p.y) - oy];
  const walls = [];
  const addPoly = (poly) => { if (!Array.isArray(poly)) return; for (let i = 1; i < poly.length; i++) if (poly[i - 1] && poly[i]) walls.push([...P(poly[i - 1]), ...P(poly[i])]); };
  (d.line_of_sight || []).forEach(addPoly); (d.objects_line_of_sight || []).forEach(addPoly);
  const doors = (d.portals || []).filter((p) => p && Array.isArray(p.bounds) && p.bounds.length >= 2).map((p) => [...P(p.bounds[0]), ...P(p.bounds[1])]);
  const lights = (d.lights || []).filter((l) => l && l.position).map((l) => [...P(l.position), Number(l.range) || 0, '#' + String(l.color || 'ffd27f').replace('#', '').slice(-6)]);
  const name = niceName(file.name);
  pendingNewScene = true;
  sendMsg({ type: 'sceneCreate', name, cols, rows, content: { bg: { url }, walls, doors, lights } });
  toast(`Imported "${name}": ${cols} × ${rows} squares${walls.length ? `, ${walls.length} wall sections and ${doors.length} door${doors.length === 1 ? '' : 's'}. With fog of war on, Reveal room follows the walls` : ''}.`, 7000);
}
// ----- Tabletop's own map files (.ttmap), made with Export map -----
async function importTtmap(file) {
  toast(`Importing ${file.name}…`, 60000);
  pendingNewScene = true;
  const res = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DM-Key': dmKey }, body: file });
  if (!res.ok) { pendingNewScene = false; throw new Error(await res.text()); }
  const r = await res.json();
  toast(`Imported "${r.name}"`, 4000);
}
function exportMap() {
  const s = sc(); if (!s) return;
  const a = document.createElement('a');
  a.href = `/api/export?key=${encodeURIComponent(dmKey)}&scene=${encodeURIComponent(editing)}`;
  a.download = (s.name.replace(/[^\w\- ]+/g, '').trim() || 'map') + '.ttmap';
  document.body.appendChild(a); a.click(); a.remove();
  toast(`Exporting "${s.name}" with its images. Share the .ttmap file; another DM imports it with Import map.`, 6000);
}
// ----- MapTool -----
async function uploadBlob(blob, name) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) { // e.g. BMP: turn it into a PNG first
    const bmp = await createImageBitmap(blob), cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0); blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  }
  return uploadFile(new File([blob], name, { type: blob.type }));
}
function drawStamp(g, bmp, t) {
  g.save();
  g.translate(t.px + t.pw / 2, t.py + t.ph / 2);
  if (t.facing != null && /TOP_DOWN/i.test(t.shape)) g.rotate((-t.facing - 90) * Math.PI / 180);
  let w = t.pw, h = t.ph;
  if (t.snapScale) { const k = Math.min(t.pw / bmp.width, t.ph / bmp.height); w = bmp.width * k; h = bmp.height * k; } // fits its squares, keeping its shape
  g.drawImage(bmp, -w / 2, -h / 2, w, h);
  g.restore();
}
async function importMapTool(file) {
  toast(`Reading ${file.name}…`, 60000);
  const mt = await readMapTool(file);
  if (mt.kind === 'token') { // .rptok: into the token library
    const t = mt.token, blob = await mt.asset(t.img);
    if (!blob) return toast(`${file.name} has no token image in it`);
    const url = await uploadBlob(blob, file.name);
    sendMsg({ type: 'libraryAdd', items: [{ name: (t.name || niceName(file.name)).slice(0, 24), url, size: Math.min(4, t.fp) }] });
    return toast(`Added "${t.name || niceName(file.name)}" to your token library (My uploads)`, 5000);
  }
  if (!mt.maps.length) return toast(`No maps found in ${file.name}`, 5000);
  const made = [], notes = [];
  for (const [i, z] of mt.maps.entries()) {
    toast(`Importing ${z.name} (${i + 1} of ${mt.maps.length})…`, 60000);
    const imgs = {}, sizes = {};
    for (const id of new Set([z.mapAsset, z.bgTexture, ...z.tokens.map((t) => t.img)].filter(Boolean))) {
      const blob = await mt.asset(id); if (!blob) continue;
      try { const bmp = await createImageBitmap(blob); imgs[id] = { blob, bmp }; sizes[id] = { w: bmp.width, h: bmp.height }; } catch { /* not an image we can read */ }
    }
    const L = mapToolLayout(z, sizes);
    if (!L) { notes.push(`${z.name} is empty`); continue; }
    const cols = Math.min(200, L.cols), rows = Math.min(200, L.rows);
    if (L.cols > 200 || L.rows > 200) notes.push(`${z.name} was cut to 200 × 200 squares`);
    if (z.hex) notes.push(`${z.name} uses a hex grid; it's shown on squares`);
    // the map picture: MapTool's map image, background texture and the stamps on its Background and Object layers, flattened into one image
    const stamps = L.placed.filter((t) => (t.layer === 'BACKGROUND' || t.layer === 'OBJECT') && imgs[t.img])
      .sort((a, b) => (a.layer === b.layer ? 0 : a.layer === 'BACKGROUND' ? -1 : 1) || a.z - b.z);
    let bg = null;
    if ((z.mapAsset && imgs[z.mapAsset]) || stamps.length || (z.bgTexture && imgs[z.bgTexture])) {
      const W = cols * L.S, H = rows * L.S, k = Math.min(1, 8192 / Math.max(W, H));
      const cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(H * k);
      const g = cv.getContext('2d'); g.scale(k, k); g.translate(-L.originX, -L.originY);
      if (z.bgTexture && imgs[z.bgTexture]) g.fillStyle = g.createPattern(imgs[z.bgTexture].bmp, 'repeat'); else g.fillStyle = z.bgColour || '#1a1a1a';
      g.fillRect(L.originX, L.originY, W, H);
      if (z.mapAsset && imgs[z.mapAsset]) g.drawImage(imgs[z.mapAsset].bmp, z.boardX, z.boardY, sizes[z.mapAsset].w * z.imageScaleX, sizes[z.mapAsset].h * z.imageScaleY);
      for (const t of stamps) drawStamp(g, imgs[t.img].bmp, t);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/webp', 0.9));
      bg = { url: await uploadFile(new File([blob], 'map.webp', { type: 'image/webp' })) };
    }
    // tokens on the Token layer; GM-layer tokens come in hidden
    const urls = {}, tokens = [];
    for (const t of L.placed.filter((p) => p.layer === 'TOKEN' || p.layer === 'GM')) {
      const x = t.cx - L.gx0, y = t.cy - L.gy0;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      if (t.img && imgs[t.img] && !(t.img in urls)) urls[t.img] = await uploadBlob(imgs[t.img].blob, (t.name || 'token') + '.png').catch(() => null);
      tokens.push({ label: (t.name || t.gmName || 'Token').slice(0, 24), img: (t.img && urls[t.img]) || null, size: Math.max(1, Math.min(4, t.fp)), x, y,
        hidden: t.layer === 'GM' || !t.visible, owner: t.owners[0] || '', color: '#444444',
        ...(t.hp != null ? { hp: t.hp, maxHp: t.maxHp != null ? t.maxHp : t.hp } : {}) });
    }
    // several tokens with the same name: number them, as Tabletop does (Goblin 1, Goblin 2…)
    const count = {}; tokens.forEach((t) => { count[t.label] = (count[t.label] || 0) + 1; });
    const seen = {}; tokens.forEach((t) => { if (count[t.label] > 1 && !/\d$/.test(t.label)) t.label = `${t.label.slice(0, 20)} ${seen[t.label] = (seen[t.label] || 0) + 1}`; });
    const labels = z.labels.map((l) => ({ text: l.text, x: (l.x - L.originX) / L.S, y: (l.y - L.originY) / L.S }));
    pendingNewScene = true;
    sendMsg({ type: 'sceneCreate', name: z.name.slice(0, 40), cols, rows, content: { bg, tokens, labels } });
    made.push(`${z.name} (${cols} × ${rows}, ${tokens.length} token${tokens.length === 1 ? '' : 's'})`);
    await new Promise((r) => setTimeout(r, 150));
  }
  toast(made.length ? `Imported from MapTool: ${made.join(', ')}.${notes.length ? ' ' + notes.join('; ') + '.' : ''}` : `Nothing to import: ${notes.join('; ')}`, 9000);
}
async function importImage(file) {
  toast(`Uploading ${file.name}…`, 30000);
  const url = await uploadFile(file);
  const img = loadImg(url);
  await (img.complete && img.naturalWidth ? Promise.resolve() : new Promise((res) => { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); }));
  if (!img.naturalWidth) return toast('Couldn\'t open that image');
  const found = detectGrid(img), px = found || guessSquare(img);
  const cols = Math.max(5, Math.min(200, Math.round(img.naturalWidth / px))), rows = Math.max(5, Math.min(200, Math.round(img.naturalHeight / px)));
  $('pxPerSq').value = px;
  const name = niceName(file.name);
  pendingNewScene = true;
  sendMsg({ type: 'sceneCreate', name, cols, rows, content: { bg: { url } } });
  toast(found ? `Imported "${name}": found a grid of ${px} px squares, so ${cols} × ${rows} squares.`
    : `Imported "${name}" as ${cols} × ${rows} squares of ${px} px. If the grid doesn't line up, go to Build map → Background image, type the pixels per square and press Fit grid.`, 8000);
}
// Find the grid in a map image: grid lines repeat at a fixed spacing, so look for the spacing at which
// the picture's edges line up best with themselves. Returns pixels per square, or 0 if there's no clear grid.
function detectGrid(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const profile = (alongX) => {
    const n = alongX ? w : h, prof = new Float32Array(n), cv = document.createElement('canvas');
    cv.width = alongX ? n : 1; cv.height = alongX ? 1 : n;
    const g = cv.getContext('2d', { willReadFrequently: true });
    for (let k = 0; k < 32; k++) {
      const at = Math.floor(((k + 0.5) / 32) * (alongX ? h : w));
      g.clearRect(0, 0, cv.width, cv.height);
      if (alongX) g.drawImage(img, 0, at, w, 1, 0, 0, w, 1); else g.drawImage(img, at, 0, 1, h, 0, 0, 1, h);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let prev = 0;
      for (let i = 0; i < n; i++) { const L = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11; if (i) prof[i] += Math.abs(L - prev); prev = L; }
    }
    let mean = 0; for (const v of prof) mean += v; mean /= n;
    for (let i = 0; i < n; i++) prof[i] -= mean;
    return prof;
  };
  const period = (prof) => {
    const n = prof.length, maxLag = Math.min(400, Math.floor(n / 3)), score = new Float32Array(maxLag + 1);
    let zero = 0; for (let i = 0; i < n; i++) zero += prof[i] * prof[i]; zero /= n;
    if (!(zero > 0)) return null;
    let best = 0;
    for (let lag = 20; lag <= maxLag; lag++) { let s = 0; for (let i = 0; i + lag < n; i++) s += prof[i] * prof[i + lag]; score[lag] = s / (n - lag) / zero; if (score[lag] > score[best]) best = lag; }
    if (!best || score[best] < 0.2) return null;
    // a multiple of the real spacing also scores well: take the smallest spacing that scores nearly as high
    for (let lag = 20; lag < best; lag++) if (score[lag] > score[best] * 0.85 && score[lag] >= score[lag - 1] && score[lag] >= score[lag + 1] && Math.abs(best / lag - Math.round(best / lag)) < 0.08) return lag;
    return best;
  };
  try {
    const px = period(profile(true)), py = period(profile(false));
    if (!px || !py || Math.abs(px - py) > Math.max(2, px * 0.03)) return 0;
    const raw = (px + py) / 2, squares = Math.round(w / raw);
    const fit = w / squares; // whole squares across the image
    return Math.abs(fit - raw) < raw * 0.04 ? Math.round(fit * 100) / 100 : Math.round(raw);
  } catch { return 0; } // e.g. a cross-origin image
}
$('importMap').onclick = () => $('importIn').click();
$('exportMap').onclick = exportMap;
$('importIn').onchange = () => { importMapFile($('importIn').files[0]); $('importIn').value = ''; };

const board = $('board');
board.addEventListener('dragover', (e) => { if (me.isDM && e.dataTransfer.types.includes('Files')) { e.preventDefault(); board.classList.add('drop'); } });
board.addEventListener('dragleave', () => board.classList.remove('drop'));
// Dropping images: in Build mode (any tool but Token) they become the map background; otherwise tokens at the drop point.
board.addEventListener('drop', async (e) => {
  e.preventDefault(); board.classList.remove('drop');
  if (!me.isDM) return;
  const files = [...e.dataTransfer.files];
  const uv = files.find(IMPORTABLE);
  if (uv) return importMapFile(uv);
  if (mode === 'build' && tool !== 'token') return uploadBg(files[0]);
  const c = toCell(toWorld(e)), s = sc();
  const items = await uploadTokens(files);
  items.forEach((it, i) => sendMsg({ type: 'addToken', sceneId: editing, label: nextFreeName(it.name), img: it.url, color: '#444444', size: 1, owner: '', x: Math.max(0, Math.min(s.cols - 1, c.x + i)), y: Math.max(0, Math.min(s.rows - 1, c.y)) }));
});

// ---------- map generator ----------
// The dialog is built from the generator's SCHEMA. The description box fills settings in;
// the DM can then change any of them. Typing in the description again re-reads it from scratch.
let genType = 'village', genSettings = defaults('village'), genHits = new Set(), genName = null;
const libByName = () => Object.fromEntries(builtins().map((b) => [b.name, b]));
function renderGenTypes() {
  const box = $('genTypes'); box.innerHTML = '';
  for (const [k, def] of Object.entries(SCHEMA)) {
    const b = document.createElement('button'); b.className = k === genType ? 'on' : '';
    b.innerHTML = '<b></b><span></span>'; b.querySelector('b').textContent = def.label; b.querySelector('span').textContent = def.blurb;
    b.onclick = () => { setGenType(k, true); };
    box.appendChild(b);
  }
}
function setGenType(type, manual) {
  genType = type;
  const parsed = $('genPrompt').value.trim() ? interpret($('genPrompt').value, type, manual) : null;
  genSettings = { ...defaults(type), ...(parsed ? parsed.settings : {}) };
  genHits = new Set(parsed ? Object.keys(parsed.settings) : []);
  $('genFog').checked = type === 'dungeon';
  renderGenTypes(); renderGenFields(); renderUnderstood(parsed);
}
function renderGenFields() {
  const box = $('genFields'); box.innerHTML = '';
  const fields = Object.entries(SCHEMA[genType].fields);
  for (const [key, f] of fields.filter(([, f]) => f.type === 'choice')) {
    const lab = document.createElement('div'); lab.className = 'fl'; lab.textContent = f.label;
    const opts = document.createElement('div'); opts.className = 'opts';
    const entries = Object.entries(f.options);
    if (entries.length > 5) {
      const sel = document.createElement('select');
      for (const [v, t] of entries) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
      sel.value = genSettings[key]; sel.onchange = () => { genSettings[key] = sel.value; };
      if (genHits.has(key)) sel.style.boxShadow = '0 0 0 2px rgba(255,107,53,.5)';
      opts.appendChild(sel);
    } else for (const [v, t] of entries) {
      const b = document.createElement('button'); b.textContent = t;
      b.className = (genSettings[key] === v ? 'on' : '') + (genSettings[key] === v && genHits.has(key) ? ' hit' : '');
      b.onclick = () => { genSettings[key] = v; renderGenFields(); };
      opts.appendChild(b);
    }
    box.append(lab, opts);
  }
  const bools = fields.filter(([, f]) => f.type === 'bool');
  if (bools.length) {
    const lab = document.createElement('div'); lab.className = 'fl'; lab.textContent = 'Include';
    const wrap = document.createElement('div'); wrap.className = 'bools';
    for (const [key, f] of bools) {
      const l = document.createElement('label'); const cb = document.createElement('input'); cb.type = 'checkbox';
      cb.checked = !!genSettings[key]; cb.onchange = () => { genSettings[key] = cb.checked; };
      l.append(cb, f.label); if (genHits.has(key)) l.style.color = '#ffd2bf';
      wrap.appendChild(l);
    }
    box.append(lab, wrap);
  }
  $('genReplace').textContent = `Reroll "${sc() ? sc().name : 'this map'}"`;
}
function renderUnderstood(parsed) {
  const box = $('genUnderstood'); box.innerHTML = '';
  if (!parsed || parsed.understood.length <= 1) {
    if ($('genPrompt').value.trim()) box.innerHTML = '<span class="lead">Didn\'t spot any settings in that yet. Try words like snowy, coast, walled, ruined, crypt, kobolds, swamp, tavern.</span>';
    return;
  }
  const lead = document.createElement('span'); lead.className = 'lead'; lead.textContent = 'Understood:'; box.appendChild(lead);
  parsed.understood.forEach((u, i) => { const c = document.createElement('span'); c.className = 'chip' + (i === 0 ? ' type' : ''); c.textContent = u; box.appendChild(c); });
}
let promptTimer = null;
$('genPrompt').oninput = () => {
  clearTimeout(promptTimer);
  promptTimer = setTimeout(() => {
    const text = $('genPrompt').value;
    const parsed = interpret(text, genType);
    genName = parsed.name;
    if (parsed.type !== genType) { setGenType(parsed.type, false); return; }
    genSettings = { ...defaults(genType), ...parsed.settings }; genHits = new Set(Object.keys(parsed.settings));
    renderGenFields(); renderUnderstood(parsed);
  }, 220);
};
let exampleIx = Math.floor(Math.random() * EXAMPLES.length);
$('genExample').onclick = () => { $('genPrompt').value = EXAMPLES[exampleIx++ % EXAMPLES.length]; $('genPrompt').oninput(); };
function runGenerator(replace) {
  const typed = parseInt($('genSeed').value, 10);
  const seed = Number.isFinite(typed) ? typed >>> 0 : (Math.random() * 2 ** 31) >>> 0;
  const out = generate(genType, genSettings, seed, libByName());
  if (genName) out.name = genName;
  $('genLast').textContent = `Last map's seed: ${seed}`;
  toast(`${out.name}: ${out.summary}`, 6000);
  // With fog on, the fog keeps monsters out of sight until their area is revealed, so they needn't be hidden too.
  const fog = $('genFog').checked;
  // number repeated names so initiative and the map can tell them apart: Goblin 1, Goblin 2…
  const counts = {}, seen = {};
  out.tokens.forEach((t) => { counts[t.label] = (counts[t.label] || 0) + 1; });
  const numbered = out.tokens.map((t) => (counts[t.label] > 1 ? { ...t, label: `${t.label} ${(seen[t.label] = (seen[t.label] || 0) + 1)}` } : t));
  const tokens = fog ? numbered.map((t) => ({ ...t, hidden: false })) : numbered;
  const content = { tiles: out.tiles, props: out.props, tokens, fog: { on: fog, reveal: out.start ? [out.start] : [] } };
  if (replace) {
    sendMsg({ type: 'sceneReplace', sceneId: editing, name: out.name, cols: out.cols, rows: out.rows, content });
    undoStack.length = redoStack.length = 0; updateUndo();
    setTimeout(fitView, 200);
  } else {
    pendingNewScene = true;
    sendMsg({ type: 'sceneCreate', name: out.name, cols: out.cols, rows: out.rows, content });
  }
  $('genModal').hidden = true;
}
$('genPrompt').placeholder = 'e.g. ' + EXAMPLES[0];
$('genBtn').onclick = () => { renderGenTypes(); renderGenFields(); $('genModal').hidden = false; setTimeout(() => $('genPrompt').focus(), 50); };
setGenType('village', true);
$('genNew').onclick = () => runGenerator(false);
$('genReplace').onclick = (e) => {
  const b = e.currentTarget;
  if (editing === active && !b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Players can see this map. Click again to reroll'; setTimeout(() => { delete b.dataset.armed; renderGenFields(); }, 3000); return; }
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
window.tabletop = { view, scene: () => sc(), cellToScreen: (x, y) => { const r = canvas.getBoundingClientRect(); return [r.left + view.x + (x + 0.5) * CELL * view.zoom, r.top + view.y + (y + 0.5) * CELL * view.zoom]; } };
const preset = params.get('name') || (dmKey ? 'DM' : '');
if (preset) start(preset);
else {
  $('name').value = tryGet('vtt-name') || '';
  $('joinForm').onsubmit = (e) => { e.preventDefault(); const n = $('name').value.trim(); if (!n) return; trySet('vtt-name', n); start(n); };
}
