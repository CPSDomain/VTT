import { CELL, TERRAINS, PROPS, PROP_CATS, DM_ONLY, texture, drawProp, swatch } from './art.js';
import { generate, SCHEMA, defaults } from './generate.js';
import { interpret, EXAMPLES } from './prompt.js';
import { readMapTool, layout as mapToolLayout, inArea as inMapToolArea } from './maptool.js';
import { drawTokenArt, thumb, builtins, credit, whenArtLoads, conditions, drawCondition, conditionThumb } from './tokens.js';
import { createSound } from './audio.js';
import { createWeather, TINT, MATCH } from './weather.js';
import { createLighting } from './lighting.js';
import { buildChunk, drawTokenRing } from './art2.js';
import { createDice, SKINS, skinById, defaultSkin } from './dice3d.js';
import { createFx, SPELLS, LIVE_CONDITIONS } from './fx.js';

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
  ws.onopen = () => sendMsg({ type: 'join', name: me.name, key: dmKey, passcode, pin: pin || tryGet('tt-pin:' + me.name.toLowerCase()) || '' });
  ws.onclose = () => { if (denied) return; $('status').textContent = 'Disconnected, reconnecting…'; $('status').style.display = ''; setTimeout(connect, 2000); };
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
}

function onMessage(msg) {
  const s = msg.sceneId ? scenes[msg.sceneId] : null;
  switch (msg.type) {
    case 'welcome': {
      me.isDM = msg.isDM; me.name = msg.name;
      document.body.classList.toggle('dm', me.isDM);
      pinSet = !!msg.pinSet;
      const st = msg.state;
      if (st.table) table = st.table;
      handouts = st.handouts || []; renderHandouts();
      audioLib = st.audio || []; soundNow = st.sound || { music: null, amb: [] }; snd.apply(soundNow, st.now); renderSound();
      encounters = st.encounters || [];
      if (me.isDM) loadMonsters().then(() => renderEditor()).catch(() => {});
      setTimeout(renderChatTargets, 0);
      if (!me.isDM && passcode) trySet('tt-code', passcode);
      $('gate').hidden = true;
      active = st.activeScene;
      if (me.isDM) {
        scenes = st.scenes; order = st.order; library = st.library || [];
        const last = tryGet('tt-editing');
        editing = scenes[editing] ? editing : scenes[last] ? last : active;
        fetch('/api/info?key=' + encodeURIComponent(dmKey)).then((r) => r.json()).then(showConn).catch(() => {});
      } else {
        scenes = st.scene ? { [st.scene.id]: st.scene } : {}; order = Object.keys(scenes); editing = active;
      }
      $('me').textContent = me.isDM ? '' : `Playing as ${me.name}` + (msg.pinSet ? ' 🔑' : '');
      $('privLabel').textContent = me.isDM ? 'Show this roll to the players' : 'Roll privately (only the DM sees it)';
      mySkin = st.diceSkin || null; renderMyDice();
      snd.resume(); // the apps may play sound straight away; a browser waits for the first click
      $('status').style.display = 'none';
      $('log').innerHTML = ''; st.log.forEach((e) => addLog(e, false));
      macros = st.myMacros || []; renderMacros();
      sceneChanged(true);
      break;
    }
    case 'sight': if (s) { s.sight = msg.data; } break;
    case 'floors': { const cur = scenes[editing]; if (cur) cur.floors = msg.floors; break; }
    case 'doors': if (s) { s.doors = msg.doors; } break;
    case 'doorFlash': pings.push({ sceneId: msg.sceneId, x: msg.x, y: msg.y, who: msg.open ? 'Door opened' : 'Door closed', dm: false, t0: performance.now() }); break;
    case 'handouts': handouts = msg.handouts; renderHandouts(); break;
    case 'sfx': if (s && msg.sceneId === editing) { const at = hear(s, msg.x, msg.y, 20, 0.15); snd.effect(msg.name, { vol: at.vol, pan: at.pan, rate: 0.95 + Math.random() * 0.1 }); } break;
    case 'sound': soundNow = msg.sound; snd.apply(msg.sound, msg.now); renderSound(); break;
    case 'audio': audioLib = msg.audio; renderSound(); break;
    case 'encounters': encounters = msg.encounters; renderEncLoad(); break;
    case 'handout': {
      const i = handouts.findIndex((h) => h.id === msg.handout.id);
      if (i >= 0) handouts[i] = msg.handout; else handouts.push(msg.handout);
      renderHandouts();
      if (msg.show) { openHandout(msg.handout); }
      break;
    }
    case 'handoutRemove': handouts = handouts.filter((h) => h.id !== msg.id); renderHandouts(); if (viewing === msg.id) $('handoutView').hidden = true; break;
    case 'presence': players = msg.players; renderPlayers(); renderTablePanel(); renderChatTargets(); break;
    case 'table': table = msg.table; renderTablePanel(); renderPlayers(); break;
    case 'network': netInfo = msg.network; if (!$('netChip')) fetch('/api/info?key=' + encodeURIComponent(dmKey)).then((r) => r.json()).then(showConn).catch(() => {}); else renderNet(); break;
    case 'denied': showDenied(msg.reason); break;
    case 'library': library = msg.library; if (!$('libModal').hidden) renderLibrary(); break;
    case 'token': if (s) { const before = s.tokens[msg.token.id]; if (before && msg.sceneId === editing) reactTo(s, before, msg.token); s.tokens[msg.token.id] = msg.token; if (msg.token.id === selected) renderEditor(); if (msg.sceneId === editing) renderInit(); } break;
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
    case 'template': if (s) { const old = (s.templates = s.templates || {})[msg.tpl.id]; s.templates[msg.tpl.id] = msg.tpl; if (msg.tpl.fx && (msg.tpl.cast || 0) > ((old && old.cast) || 0) && msg.sceneId === editing) castSpell(s, msg.tpl); } break;
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
    case 'sceneMeta': if (s) { Object.assign(s, msg.patch); if (msg.patch.vision && !me.isDM) { s.sight = null; visionMask = null; } if (msg.sceneId === editing) sceneChanged(false); } break;
    case 'sceneFull':
      if (msg.active) { const switched = active !== msg.scene.id; if (switched && active) titleCard(msg.scene.name); scenes = { [msg.scene.id]: msg.scene }; order = [msg.scene.id]; active = editing = msg.scene.id; sceneChanged(switched); }
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
    case 'roll': addLog(msg.entry, true); showRoll(msg.entry); break;
    case 'diceSkin': mySkin = msg.skin; renderMyDice(); renderSkins(); break;
    case 'chat': {
      addLog(msg.entry, true); if (msg.entry.narrate) narrate(msg.entry.text); else speechBubble(msg.entry);
      const e = msg.entry;
      if (e.to && !sameName(e.who, me.name) && e.to.some((n) => sameName(n, me.name) || (me.isDM && sameName(n, 'DM')))) toast(`Whisper from ${e.as || e.who}: ${e.text.slice(0, 80)}`, 5000);
      break;
    }
    case 'pinSet': pinSet = msg.on; renderMePop(); $('me').textContent = `Playing as ${me.name}` + (msg.on ? ' 🔑' : ''); toast(msg.on ? 'Your name is now protected by your PIN' : 'PIN removed'); break;
    case 'macros': macros = msg.macros; renderMacros(); break;
    case 'error': toast(msg.message); break;
  }
  draw();
}

let netInfo = null, lanAddr = '';
function showConn(info) {
  const addr = lanAddr = (info.ips[0] || 'localhost') + ':' + info.port;
  if (info.network) netInfo = info.network;
  $('conn').innerHTML = '';
  const label = document.createElement('span'); label.textContent = 'Players connect to';
  const b = document.createElement('b'); b.textContent = addr;
  b.title = info.ips.length > 1 ? 'Other addresses on this PC:\n' + info.ips.slice(1).map((i) => i + ':' + info.port).join('\n') : '';
  const copy = document.createElement('button'); copy.textContent = 'Copy'; copy.style.padding = '3px 8px';
  copy.onclick = () => { navigator.clipboard.writeText(addr).then(() => toast('Address copied: ' + addr)); };
  $('conn').append(label, b, copy);
  if (netInfo) { const chip = document.createElement('span'); chip.id = 'netChip'; chip.onclick = () => { $('tablePop').hidden = false; $('soundPop').hidden = true; renderTablePanel(); }; $('conn').append(chip); }
  renderNet();
}
// the internet side: is the port open on the router, and what address to give players outside
function renderNet() {
  const n = netInfo; if (!n) return;
  const r = n.router || {}, open = r.state === 'open', chip = $('netChip');
  const wan = r.external || ''; // shown even when it may not work, so the DM can test it
  if (chip) {
    chip.className = open ? 'open' : r.state === 'working' ? '' : 'warn';
    chip.textContent = open ? (r.checked === false || !wan ? '🌐 Online?' : '🌐 Online') : r.state === 'working' ? '🌐 Opening port…' : r.state === 'off' ? '🌐 Same network only' : '🌐 Not reachable online';
    if (open && (r.checked === false || !wan)) chip.className = 'warn';
    if (open && wan) { const ad = document.createElement('span'); ad.className = 'addr'; ad.textContent = (chip.textContent.endsWith('?') ? ' ' : ': ') + wan; chip.append(ad); }
    chip.title = open ? 'Players outside your network connect to ' + (wan || 'your internet address') + '. Click for connection settings.' : (r.message || 'Click for connection settings');
  }
  if ($('tablePop').hidden) return;
  $('tpNet').hidden = false;
  $('tpLan').textContent = lanAddr;
  $('tpWan').textContent = wan || (r.state === 'working' ? 'checking…' : '—');
  $('tpWanCopy').disabled = !wan;
  const st = $('tpWanState');
  st.className = 'hint ' + (open && r.checked ? 'ok' : open && r.checked === null ? '' : r.state === 'working' || r.state === 'off' ? '' : 'warn');
  st.textContent = r.state === 'off' ? `Only players on your network can join. To play over the internet, tick the box below (or forward port ${n.port} on your router by hand).`
    : open ? r.message + (wan && !table.passcode ? ' Anyone who has the address can try to join, so set a table passcode above.' : '')
    : r.state === 'working' ? r.message || 'Asking your router…'
    : `${r.message || 'Your router didn\'t open the port.'} Players on your network can still join. To play online, turn on UPnP in your router's settings, or forward port ${n.port} (TCP) to ${r.local || 'this PC'} by hand.`;
  $('tpUpnp').checked = n.upnp;
  if (document.activeElement !== $('tpPort')) $('tpPort').value = n.port;
  $('tpRetry').hidden = !(n.upnp && (r.state === 'failed' || r.state === 'shared'));
  $('tpNote').textContent = n.note || '';
}
async function setNetwork(m) {
  try {
    const res = await fetch('/api/network', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DM-Key': dmKey }, body: JSON.stringify(m) });
    const out = await res.json();
    if (!out.ok) return toast(out.message || 'That didn\'t work', 5000);
    if (out.restarting) toast(`Moving the table to port ${out.port}… Players reconnect with the new address.`, 6000);
  } catch (e) { toast('That didn\'t work: ' + e.message, 5000); }
}
$('tpUpnp').onchange = () => setNetwork({ upnp: $('tpUpnp').checked });
$('tpRetry').onclick = () => setNetwork({ retry: true });
$('tpPortSave').onclick = () => { const p = Number($('tpPort').value); if (netInfo && p === netInfo.port) return toast('The table is already on port ' + p); setNetwork({ port: p }); };
$('tpPort').onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') $('tpPortSave').click(); };
$('tpLanCopy').onclick = () => navigator.clipboard.writeText(lanAddr).then(() => toast('Address copied: ' + lanAddr));
$('tpWanCopy').onclick = () => { const a = $('tpWan').textContent; navigator.clipboard.writeText(a).then(() => toast('Internet address copied: ' + a)); };
// ----- who may join: passcode, removing and blocking players (DM) -----
let table = { passcode: '', blocked: [] };
function renderTablePanel() {
  if (!me.isDM || $('tablePop').hidden) return;
  renderNet();
  if (document.activeElement !== $('tpCode')) $('tpCode').value = table.passcode || '';
  $('tpCodeState').textContent = table.passcode ? 'Players need this passcode to join.' : 'No passcode: anyone who can reach your address can join.';
  const list = $('tpPlayers'); list.innerHTML = '';
  if (!players.length) list.innerHTML = '<div class="hint">No players connected.</div>';
  for (const name of players) {
    const row = document.createElement('div'); row.className = 'tprow';
    const n = document.createElement('span'); n.textContent = name;
    const rm = document.createElement('button'); rm.textContent = 'Remove'; rm.title = 'Disconnect them. They can join again.';
    rm.onclick = () => sendMsg({ type: 'removePlayer', name });
    const bl = document.createElement('button'); bl.textContent = 'Block'; bl.className = 'danger'; bl.title = 'Disconnect them and stop anyone joining with this name until you unblock it.';
    bl.onclick = () => sendMsg({ type: 'removePlayer', name, block: true });
    row.append(n, rm, bl); list.appendChild(row);
  }
  const pl = $('tpPins'); pl.innerHTML = '';
  $('tpPinSec').style.display = (table.pins || []).length ? '' : 'none';
  for (const name of table.pins || []) {
    const row = document.createElement('div'); row.className = 'tprow';
    const n = document.createElement('span'); n.textContent = '🔑 ' + name;
    const rs = document.createElement('button'); rs.textContent = 'Reset PIN'; rs.title = 'Clear their PIN (if they forgot it). They can set a new one.';
    rs.onclick = () => { sendMsg({ type: 'resetPin', name }); toast(`${name}'s PIN is cleared`); };
    row.append(n, rs); pl.appendChild(row);
  }
  const bl = $('tpBlocked'); bl.innerHTML = '';
  $('tpBlockedSec').style.display = table.blocked.length ? '' : 'none';
  for (const name of table.blocked) {
    const row = document.createElement('div'); row.className = 'tprow';
    const n = document.createElement('span'); n.textContent = name;
    const ub = document.createElement('button'); ub.textContent = 'Unblock'; ub.onclick = () => sendMsg({ type: 'unblock', name });
    row.append(n, ub); bl.appendChild(row);
  }
}
$('players').onclick = () => { $('tablePop').hidden = !$('tablePop').hidden; $('soundPop').hidden = true; renderTablePanel(); renderSound(); };
$('tpClose').onclick = () => { $('tablePop').hidden = true; };
$('tpSave').onclick = () => { sendMsg({ type: 'setPasscode', passcode: $('tpCode').value }); toast($('tpCode').value.trim() ? 'Passcode set. Players already at the table stay connected.' : 'Passcode removed'); };
$('tpCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('tpSave').click(); });
// ----- players: when the table won't let us in -----
let passcode = '', pin = '', denied = false, pinSet = false;
function showDenied(reason) {
  denied = true;
  const gate = $('gate'); gate.hidden = false;
  const ask = reason === 'passcode' || reason === 'passcode-wrong' || reason === 'wait' || reason === 'pin' || reason === 'pin-wrong';
  const forPin = reason === 'pin' || reason === 'pin-wrong';
  $('gateCode').placeholder = forPin ? 'Your PIN' : 'Passcode'; $('gateCode').type = forPin ? 'password' : 'text';
  $('gateCode').dataset.pin = forPin ? '1' : '';
  $('gateMsg').textContent = {
    passcode: 'This table has a passcode. Ask your DM for it.',
    'passcode-wrong': 'That passcode isn\'t right. Check with your DM.',
    pin: `"${me.name}" is protected by a PIN. Type yours to join. (Forgotten it? The DM can reset it.)`,
    'pin-wrong': 'That PIN isn\'t right. Forgotten it? Ask the DM to reset it.',
    wait: 'Too many wrong passcodes. Wait half a minute and try again.',
    removed: 'The DM removed you from the table.',
    blocked: `The DM has blocked the name "${me.name}" at this table.`
  }[reason] || 'The table didn\'t let you in.';
  $('gateCode').style.display = ask ? '' : 'none';
  $('gateGo').textContent = ask ? 'Join' : 'Join again';
  $('gateGo').style.display = reason === 'blocked' ? 'none' : '';
  if (ask) { $('gateCode').value = ''; setTimeout(() => $('gateCode').focus(), 0); }
  $('status').style.display = 'none';
}
$('gateForm').onsubmit = (e) => {
  e.preventDefault();
  if ($('gateCode').style.display !== 'none') {
    if ($('gateCode').dataset.pin) { pin = $('gateCode').value.trim(); trySet('tt-pin:' + me.name.toLowerCase(), pin); } else passcode = $('gateCode').value.trim();
  }
  denied = false; $('gate').hidden = true; connect();
};
function renderPlayers() {
  $('players').innerHTML = `<span class="dot ${players.length ? 'on' : ''}"></span>`;
  $('players').append(players.length ? `${players.length} player${players.length > 1 ? 's' : ''}` : 'No players yet');
  if (table.passcode) $('players').append(' 🔒');
  $('players').title = players.join(', ');
}

// ---------- scene switching ----------
function sceneChanged(refit) {
  const s = sc();
  if (!s) return;
  fogDirty = true;
  if (refit) { selTpl = null; tplDraft = null; ruler = null; if (labelEdit) closeLabelEditor(); }
  renderChatTargets();
  renderInit(); renderEditor();
  if (me.isDM) { trySet('tt-editing', editing); renderSceneBar(); fillMapSettings(); renderFogBar(); renderVisionPop(); renderWxPop(); renderSound(); if (refit) clearMapSelection(); }
  else $('playerScene').textContent = s.name;
  if (s.bg) loadImg(s.bg.url);
  if (refit) fitView();
  draw();
}
// ---------- floors ----------
// Floors of a building are maps in one group, each with a level. The DM switches between them with the
// floor buttons; characters move between them by the stairs (or the Floor box on the token).
const STAIRS = new Set(['stairs', 'ladder', 'trapdoor']);
function floorList(s) {
  if (!s) return [];
  if (me.isDM) return s.group ? order.map((id) => scenes[id]).filter((x) => x && x.group === s.group).sort((a, b) => (b.level || 0) - (a.level || 0)).map((f) => ({ id: f.id, level: f.level || 0, floor: f.floor || f.name })) : [];
  return s.floors || [];
}
function renderFloorBar() {
  const s = sc(), bar = $('floorBar'); if (!me.isDM || !s) return;
  bar.innerHTML = '';
  const floors = floorList(s);
  bar.classList.add('on');
  for (const f of floors) {
    const b = document.createElement('button'); b.textContent = f.floor; b.title = `Go to ${f.floor}`;
    b.classList.toggle('on', f.id === editing); b.classList.toggle('live', f.id === active);
    b.onclick = () => { editing = f.id; sceneChanged(true); };
    bar.appendChild(b);
  }
  const add = (dir, text, title) => { const b = document.createElement('button'); b.className = 'add'; b.textContent = text; b.title = title; b.onclick = () => { pendingNewScene = true; sendMsg({ type: 'floorAdd', sceneId: editing, dir }); }; bar.appendChild(b); };
  add(1, floors.length ? '＋▲' : '＋ Floor above', floors.length ? 'Add a floor on top' : 'Add a floor above this map (it becomes a building with floors)');
  add(-1, floors.length ? '＋▼' : '＋ Cellar', floors.length ? 'Add a floor underneath' : 'Add a floor below this map');
}
// a token dropped on stairs, a ladder or a trapdoor: offer the floors above and below
function offerStairs(s, t) {
  const floors = floorList(s); if (floors.length < 2) return;
  let onStairs = false;
  for (const p of Object.values(s.props)) if (STAIRS.has(p.kind) && p.x >= t.x && p.x < t.x + t.size && p.y >= t.y && p.y < t.y + t.size) onStairs = true;
  if (!onStairs) return;
  const here = floors.find((f) => f.id === editing); if (!here) return;
  const near = floors.filter((f) => Math.abs(f.level - here.level) === 1).sort((a, b) => b.level - a.level);
  if (!near.length) return;
  const pop = $('floorPop'), btns = $('fpBtns'); btns.innerHTML = '';
  $('fpText').textContent = `${t.label}: take the stairs?`;
  for (const f of near) { const b = document.createElement('button'); b.className = 'primary'; b.textContent = `${f.level > here.level ? '▲ Up to' : '▼ Down to'} ${f.floor}`; b.onclick = () => { pop.hidden = true; sendMsg({ type: 'tokenFloor', sceneId: editing, id: t.id, to: f.id }); }; btns.appendChild(b); }
  const stay = document.createElement('button'); stay.textContent = 'Stay'; stay.onclick = () => { pop.hidden = true; }; btns.appendChild(stay);
  const [x, y] = window.tabletop.cellToScreen(t.x + t.size, t.y), r = canvas.getBoundingClientRect();
  pop.style.left = Math.min(r.width - 260, x - r.left + 10) + 'px'; pop.style.top = Math.max(10, y - r.top - 10) + 'px';
  pop.hidden = false;
  clearTimeout(offerStairs.t); offerStairs.t = setTimeout(() => { pop.hidden = true; }, 8000);
}
function renderSceneBar() {
  const sel = $('sceneSel'); sel.innerHTML = '';
  for (const id of order) {
    const o = document.createElement('option'); o.value = id;
    o.textContent = (id === active ? '● ' : '') + scenes[id].name; sel.appendChild(o);
  }
  sel.value = editing;
  const live = editing === active, cur = scenes[editing], act = scenes[active];
  const floorInPlay = !live && cur && act && cur.group && cur.group === act.group; // another floor of the building on the table
  $('liveBadge').textContent = live ? 'PLAYERS SEE THIS' : floorInPlay ? 'IN PLAY' : 'PRIVATE PREP';
  $('liveBadge').className = 'badge dm-only ' + (live || floorInPlay ? 'live' : 'prep');
  $('liveBadge').title = live ? 'Changes you make here appear on players\' screens straight away' : floorInPlay ? 'Another floor of the building on the table: players whose characters are on this floor see it, live' : 'Players can\'t see this map. Build in peace.';
  $('showPlayers').style.visibility = live ? 'hidden' : 'visible';
  $('delMap').disabled = order.length <= 1;
  renderFloorBar();
}
function fillMapSettings() {
  const s = sc();
  if (document.activeElement !== $('mapName')) $('mapName').value = s.name;
  $('mapCols').value = s.cols; $('mapRows').value = s.rows; $('showGrid').checked = s.showGrid !== false; $('mapDiag').value = s.diag || '5'; $('mapWalls').value = s.wallStyle === 'rock' ? 'rock' : 'built';
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
let frame = 0, mapRev = 0, staticKey = '', animTimer = 0;
const staticLayer = document.createElement('canvas');
// draw(): something changed, draw it all again. tick(): only the moving things (fire, water…) changed.
function draw() { mapRev++; if (!frame) frame = requestAnimationFrame(render); }
function tick() { animTimer = 0; if (!frame) frame = requestAnimationFrame(render); }
const lighting = createLighting({ CELL, VIS: window.TabletopVision });
const efx = createFx({ CELL }); // spells, hits, heals and condition looks
const fxMode = () => (prefs.fx === 'still' || prefs.fx === 'off' ? prefs.fx : 'full');
// the parts of the map that don't move, for the current view: drawn again only after a change
// ---------- the 1.7 map art, in blocks of 16×16 squares (see art2.js) ----------
// Blocks on screen are built at the sharpness the zoom needs, a few at a time between frames; until one is ready,
// that part shows the classic drawing. A block is built again only when something in it (or next to it) changes.
const CH = 16, chunks = new Map();
let chunkPx = 0, chunkWant = [], chunkTimer = 0;
const chunkRes = () => { const want = view.zoom * devicePixelRatio * CELL; return want <= 20 ? 16 : want <= 40 ? 32 : want <= 64 ? 64 : 96; }; // 96 is sharp enough close up and builds about twice as fast as 128
function chunkSigs(s, list) { // what's in each block and the two squares round it
  const props = new Map();
  for (const id in s.props) {
    const p = s.props[id], h = (p.kind.length * 131 + p.kind.charCodeAt(0) * 7 + p.x * 977 + p.y * 31 + (p.rot || 0) * 3 + (p.open ? 1 : 0) + (p.off ? 2 : 0)) | 0;
    for (let cy = Math.floor((p.y - 3) / CH); cy <= Math.floor((p.y + 3) / CH); cy++) for (let cx = Math.floor((p.x - 3) / CH); cx <= Math.floor((p.x + 3) / CH); cx++) { const k = cx + ',' + cy; props.set(k, ((props.get(k) || 0) * 31 + h) | 0); }
  }
  return list.map(([cx, cy]) => {
    let h = 0;
    for (let y = cy * CH - 2; y < cy * CH + CH + 2; y++) for (let x = cx * CH - 2; x < cx * CH + CH + 2; x++) { const t = s.tiles[x + ',' + y]; if (t) h = (h * 31 + t.charCodeAt(0) * 7 + t.length + x * 13 + y * 17) | 0; }
    return [h, props.get(cx + ',' + cy) || 0, s.wallStyle || '', s.showGrid !== false ? 1 : 0, s.cols, s.rows].join(':');
  });
}
// Blocks are built by background workers when the app can make them (it always can in Electron 33); otherwise here, a few at a time.
const chunkJobs = new Map(); let chunkJobId = 0, chunkWorkers = null;
function workers() {
  if (chunkWorkers) return chunkWorkers;
  chunkWorkers = [];
  try {
    if (typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') return chunkWorkers;
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker('/js/chunkworker.js'); w.busy = false;
      w.onmessage = (e) => chunkDone(w, e.data);
      w.onerror = (e) => { console.warn('block worker failed, building here instead', e.message); for (const x of chunkWorkers) x.terminate(); chunkWorkers.length = 0; chunkJobs.clear(); chunkWant = []; draw(); };
      chunkWorkers.push(w);
    }
  } catch (e) { console.warn('no block workers', e); chunkWorkers = []; }
  return chunkWorkers;
}
function chunkDone(w, d) {
  w.busy = false;
  const job = chunkJobs.get(d.id); chunkJobs.delete(d.id);
  if (job && d.bm) {
    const old = chunks.get(job.key); if (old) { chunkPx -= old.c.width * old.c.height; chunks.delete(job.key); }
    chunks.set(job.key, { sig: job.sig, c: d.bm, R: job.R, scene: job.scene, cx: job.cx, cy: job.cy }); chunkPx += d.bm.width * d.bm.height;
    while (chunkPx > 32e6 && chunks.size > 1) { const [k, v] = chunks.entries().next().value; chunkPx -= v.c.width * v.c.height; if (v.c.close) v.c.close(); chunks.delete(k); }
    chunkDraw();
  } else if (d.err) { // something the worker can't do: build here from now on
    console.warn('block worker failed, building here instead', d.err);
    for (const x of chunkWorkers) x.terminate(); chunkWorkers.length = 0; chunkJobs.clear(); chunkWant = []; draw(); return;
  }
  scheduleChunks();
}
let chunkDrawT = 0; // show finished blocks a few times a second, not after every one
function chunkDraw() { if (chunkDrawT) return; chunkDrawT = setTimeout(() => { chunkDrawT = 0; draw(); }, chunkJobs.size || chunkWant.length ? 120 : 0); }
function chunkRegion(s, x0, y0, n) { // just the squares and props a block needs (and the two rows round it)
  const tiles = {}, props = {};
  for (let y = y0 - 2; y < y0 + n + 2; y++) for (let x = x0 - 2; x < x0 + n + 2; x++) { const t = s.tiles[x + ',' + y]; if (t) tiles[x + ',' + y] = t; }
  for (const id in s.props) { const p = s.props[id]; if (p.x >= x0 - 3 && p.x <= x0 + n + 2 && p.y >= y0 - 3 && p.y <= y0 + n + 2) props[id] = { ...p }; }
  return { cols: s.cols, rows: s.rows, tiles, props, showGrid: s.showGrid };
}
function scheduleChunks() {
  const ws = workers();
  if (!ws.length) { if (chunkWant.length && !chunkTimer) chunkTimer = setTimeout(buildChunks, 0); return; }
  const s = sc(), busy = new Set([...chunkJobs.values()].map((j) => j.key));
  for (const w of ws) {
    if (w.busy) continue;
    let job = null;
    while (chunkWant.length) { const c = chunkWant.shift(); if (s && c.scene === s.id && !(chunks.has(c.key) && chunks.get(c.key).sig === c.sig) && !busy.has(c.key)) { job = c; break; } }
    if (!job) break;
    const id = ++chunkJobId; chunkJobs.set(id, job); busy.add(job.key); w.busy = true;
    w.postMessage({ id, sc: chunkRegion(s, job.cx * CH, job.cy * CH, CH), R: job.R, opts: { blend: true, detail: true, height: true, cave: s.wallStyle === 'rock', props: true }, x0: job.cx * CH, y0: job.cy * CH, n: CH });
  }
}
function buildChunks() { // a few blocks, then show them (only when there are no workers)
  chunkTimer = 0;
  const s = sc(), t0 = performance.now(); let built = 0;
  while (chunkWant.length && performance.now() - t0 < 14) {
    const w = chunkWant.shift(); if (!s || w.scene !== s.id || (chunks.has(w.key) && chunks.get(w.key).sig === w.sig)) continue;
    const c = buildChunk(s, w.R, { blend: true, detail: true, height: true, cave: s.wallStyle === 'rock', props: true }, w.cx * CH, w.cy * CH, CH);
    const old = chunks.get(w.key); if (old) { chunkPx -= old.c.width * old.c.height; chunks.delete(w.key); }
    chunks.set(w.key, { sig: w.sig, c, R: w.R, scene: s.id, cx: w.cx, cy: w.cy }); chunkPx += c.width * c.height; built++;
    while (chunkPx > 32e6 && chunks.size > 1) { const [k, v] = chunks.entries().next().value; chunkPx -= v.c.width * v.c.height; chunks.delete(k); }
  }
  if (built) draw();
  if (chunkWant.length) chunkTimer = setTimeout(buildChunks, 0);
}
// which blocks are on screen, and which are ready (or have a copy at another sharpness to stand in)
function planChunks(s, x0, y0, x1, y1) {
  const R = chunkRes(), list = [];
  for (let cy = Math.floor(y0 / CH); cy <= Math.floor(y1 / CH); cy++) for (let cx = Math.floor(x0 / CH); cx <= Math.floor(x1 / CH); cx++) list.push([cx, cy]);
  const sigs = chunkSigs(s, list), want = [], ready = [], missing = [];
  let all = true;
  list.forEach(([cx, cy], i) => {
    const key = s.id + ':' + cx + ',' + cy + ':' + R; let v = chunks.get(key);
    if (v && v.sig !== sigs[i]) { // changed (painting, a door opening): the old block stays up until the new one is ready
      want.push({ key, scene: s.id, cx, cy, R, sig: sigs[i], d: -1 }); ready.push([cx, cy, v]); return;
    }
    if (!v) { // a sharper or blurrier copy of the same block will do meanwhile
      for (const r of [64, 96, 32, 16]) { const o = chunks.get(s.id + ':' + cx + ',' + cy + ':' + r); if (o && o.sig === sigs[i]) { v = o; break; } }
      want.push({ key, scene: s.id, cx, cy, R, sig: sigs[i], d: Math.hypot(cx - (x0 + x1) / 2 / CH, cy - (y0 + y1) / 2 / CH) });
      if (!v) { all = false; missing.push([cx, cy]); return; }
    } else { chunks.delete(key); chunks.set(key, v); } // most recently used
    ready.push([cx, cy, v]);
  });
  const building = new Set([...chunkJobs.values()].map((j) => j.key));
  chunkWant = want.filter((w) => !building.has(w.key)).sort((a, b) => a.d - b.d);
  if (chunkWant.length) scheduleChunks();
  return { all, ready, missing, sig: sigs.join('|') };
}
function paintChunks(g, ready) { for (const [cx, cy, v] of ready) g.drawImage(v.c, cx * CH * CELL, cy * CH * CELL, v.c.width / v.R * CELL, v.c.height / v.R * CELL); }
const classicLayer = document.createElement('canvas'); let classicKey = '';
function renderStatic(s, x0, y0, x1, y1, lit) {
  if (staticLayer.width !== canvas.width || staticLayer.height !== canvas.height) { staticLayer.width = canvas.width; staticLayer.height = canvas.height; }
  const g = staticLayer.getContext('2d'), dpr = devicePixelRatio, W = s.cols * CELL, Hh = s.rows * CELL;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, staticLayer.width, staticLayer.height);
  g.setTransform(view.zoom * dpr, 0, 0, view.zoom * dpr, view.x * dpr, view.y * dpr);
  g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, W, Hh);
  if (s.bg) { const img = loadImg(s.bg.url); if (img.complete && img.naturalWidth) g.drawImage(img, 0, 0, W, Hh); }
  let painted = false; for (const k in s.tiles) { painted = true; break; } // a map with no squares painted (a picture map, a new map) has nothing for blocks to add
  if (lit && painted) { // the 1.7 look: the blocks on screen, over the classic drawing while any aren't built yet
    const plan = planChunks(s, x0, y0, x1, y1);
    if (!plan.all) { // the classic drawing under blocks that aren't built yet; kept, so each finished block costs only a copy
      const key = [s.id, plan.sig, view.x, view.y, view.zoom, staticLayer.width, staticLayer.height].join(':');
      if (classicKey !== key) {
        classicKey = key; classicLayer.width = staticLayer.width; classicLayer.height = staticLayer.height;
        const cg = classicLayer.getContext('2d'); cg.setTransform(view.zoom * dpr, 0, 0, view.zoom * dpr, view.x * dpr, view.y * dpr);
        classicStatic(cg, s, x0, y0, x1, y1, lit);
      }
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(classicLayer, 0, 0); g.restore();
    }
    paintChunks(g, plan.ready);
    g.strokeStyle = '#3a3a3a'; g.lineWidth = 2 / view.zoom; g.strokeRect(0, 0, W, Hh);
    return;
  }
  classicStatic(g, s, x0, y0, x1, y1, lit);
}
// the classic drawing (1.6 and before): square by square
function classicStatic(g, s, x0, y0, x1, y1, lit) {
  const W = s.cols * CELL, Hh = s.rows * CELL;

  // floors
  g.imageSmoothingEnabled = view.zoom < 1.3;
  const walls = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = s.tiles[x + ',' + y];
    if (!t) continue;
    if (t === 'wall') { walls.push([x, y]); continue; }
    g.drawImage(texture(t, x, y), x * CELL, y * CELL, CELL + 0.6, CELL + 0.6);
  }
  // soft shadows inside pits, along any non-pit neighbour
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (s.tiles[x + ',' + y] !== 'pit') continue;
    const n = (dx, dy) => s.tiles[(x + dx) + ',' + (y + dy)] !== 'pit';
    g.fillStyle = 'rgba(80,70,60,.35)';
    if (n(0, -1)) g.fillRect(x * CELL, y * CELL, CELL, 6);
    if (n(-1, 0)) g.fillRect(x * CELL, y * CELL, 4, CELL);
  }
  if (lit) lighting.drawAO(g, s); // soft shading where floors meet walls
  // walls: cast shadow, then the block, then lit and shaded edges
  g.fillStyle = 'rgba(0,0,0,.45)';
  for (const [x, y] of walls) g.fillRect(x * CELL + 6, y * CELL + 7, CELL, CELL);
  for (const [x, y] of walls) g.drawImage(texture('wall', x, y), x * CELL, y * CELL, CELL + 0.6, CELL + 0.6);
  for (const [x, y] of walls) {
    const open = (dx, dy) => s.tiles[(x + dx) + ',' + (y + dy)] !== 'wall';
    const X = x * CELL, Y = y * CELL;
    g.fillStyle = 'rgba(255,255,255,.13)';
    if (open(0, -1)) g.fillRect(X, Y, CELL, 3);
    if (open(-1, 0)) g.fillRect(X, Y, 3, CELL);
    g.fillStyle = 'rgba(0,0,0,.55)';
    if (open(0, 1)) g.fillRect(X, Y + CELL - 4, CELL, 4);
    if (open(1, 0)) g.fillRect(X + CELL - 4, Y, 4, CELL);
  }
  g.imageSmoothingEnabled = true;

  // props (torch light first so it sits under everything else)
  const props = Object.values(s.props).filter((p) => p.x >= x0 - 1 && p.x <= x1 + 1 && p.y >= y0 - 1 && p.y <= y1 + 1)
    .sort((a, b) => (a.kind === 'torch' ? -1 : 0) - (b.kind === 'torch' ? -1 : 0) || a.y - b.y);
  for (const p of props) drawProp(g, p.open && (p.kind === 'door' || p.kind === 'doubledoor') ? { ...p, kind: 'dooropen' } : p, { lit });

  // grid
  if (s.showGrid !== false) {
    g.strokeStyle = s.bg || Object.keys(s.tiles).length ? 'rgba(0,0,0,.32)' : '#2a2a2a';
    g.lineWidth = 1 / view.zoom; g.beginPath();
    for (let x = x0; x <= x1 + 1; x++) { g.moveTo(x * CELL, y0 * CELL); g.lineTo(x * CELL, (y1 + 1) * CELL); }
    for (let y = y0; y <= y1 + 1; y++) { g.moveTo(x0 * CELL, y * CELL); g.lineTo((x1 + 1) * CELL, y * CELL); }
    g.stroke();
  }
  g.strokeStyle = '#3a3a3a'; g.lineWidth = 2 / view.zoom; g.strokeRect(0, 0, W, Hh);
}
function render() {
  frame = 0;
  const dpr = devicePixelRatio, s = sc();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!s) return;
  const W = s.cols * CELL, Hh = s.rows * CELL;

  // visible cell range
  const r = canvas.getBoundingClientRect();
  const x0 = Math.max(0, Math.floor(-view.x / view.zoom / CELL)), y0 = Math.max(0, Math.floor(-view.y / view.zoom / CELL));
  const x1 = Math.min(s.cols - 1, Math.ceil((r.width - view.x) / view.zoom / CELL)), y1 = Math.min(s.rows - 1, Math.ceil((r.height - view.y) / view.zoom / CELL));
  const fx = fxMode(), lit = fx !== 'off', moving = fx === 'full' && !document.hidden, t = performance.now() / 1000, cells = [x0, y0, x1, y1];

  const key = [mapRev, view.x, view.y, view.zoom, canvas.width, canvas.height, editing, fx].join('|');
  if (key !== staticKey) { renderStatic(s, x0, y0, x1, y1, lit); staticKey = key; }
  ctx.drawImage(staticLayer, 0, 0);
  ctx.setTransform(view.zoom * dpr, 0, 0, view.zoom * dpr, view.x * dpr, view.y * dpr);

  let amb = null;
  if (lit) { // the new look: light and darkness, fire, water (see lighting.js); vision rules are untouched by it
    amb = me.isDM && mode === 'build' ? [255, 255, 255] : lighting.ambient(s); // building happens in daylight
    if (me.isDM) amb = amb.map((v) => Math.max(v, 66)); // the DM still makes out the layout in the dark
    lighting.prepare(s);
    lighting.step(s, t, cells, moving, amb, view.zoom);
    lighting.drawWater(ctx, s, t, cells, moving);
    lighting.drawLitParticles(ctx);
    if (!lighting.isDay(amb)) lighting.applyLight(ctx, s, t, view, dpr, canvas.width, canvas.height, me.isDM ? null : sightNow(s), moving, amb);
    ctx.setTransform(view.zoom * dpr, 0, 0, view.zoom * dpr, view.x * dpr, view.y * dpr);
    lighting.drawEmissive(ctx, s, t, cells, moving, amb, view.zoom);
  } else {
    // the classic look: time of day colours the map, lights drawn as pools
    const tint = s.atmo && TINT[s.atmo.time];
    if (tint) { ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = tint; ctx.fillRect(0, 0, W, Hh); ctx.restore(); drawLightPools(s, s.atmo.time); }
    drawTokenLights(s);
  }
  drawVision(s);
  drawFog(s);
  drawTemplates(s);
  drawLabels(s);

  // tokens (hidden ones only ever reach the DM, drawn faded)
  const turnId = s.combat && s.combat.active ? s.combat.turnId : null;
  for (const t of Object.values(s.tokens)) {
    const base = drag && drag.id === t.id ? drag.pos : { x: t.x * CELL, y: t.y * CELL }, [ox, oy] = efx.offset(t), pos = { x: base.x + ox, y: base.y + oy };
    const rad = (t.size * CELL) / 2, cx = pos.x + rad, cy = pos.y + rad;
    const pct0 = hpFraction(t), down = efx.lying(t, pct0 === 0);
    if (!t.hidden) { if (pct0 === 0 || (t.conditions || []).includes('dead')) efx.pool(ctx, t, cx, cy, rad); efx.under(ctx, t, cx, cy, rad); }
    if (t.id === turnId) { // whose turn it is: a glowing gold ring
      ctx.save(); ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 18; ctx.lineWidth = 5; ctx.strokeStyle = '#fbbf24';
      ctx.beginPath(); ctx.arc(cx, cy, rad - 1, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    const unseen = previewSight && !(t.owner && t.owner !== '') && !tokenSeen(s, t, previewSight);
    ctx.globalAlpha = (t.hidden || unseen ? (unseen ? 0.3 : 0.5) : 1) * efx.tokenAlpha(t);
    const tl = lit ? lighting.tokenLight(s, cx, cy, amb) : null;
    if (tl) { // a soft shadow cast away from the light it stands in
      const k = tl.shadow.k, sx = cx + tl.shadow.dx * k, sy = cy + tl.shadow.dy * k, sg = ctx.createRadialGradient(sx, sy, rad * 0.35, sx, sy, rad * 1.15);
      sg.addColorStop(0, 'rgba(0,0,0,.5)'); sg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, rad * 1.15, 0, Math.PI * 2); ctx.fill();
    }
    if (down) { ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 2); ctx.translate(-cx, -cy); } // lying on the ground
    drawTokenArt(ctx, t, cx, cy, rad - 4, draw);
    if (down) ctx.restore();
    efx.over(ctx, t, cx, cy, rad);
    if (tl && tl.tint) { // shaded by that light, but never so dark it can't be made out
      const m = (v) => Math.round(255 * Math.min(1, 0.42 + 0.58 * v));
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = `rgb(${m(tl.tint[0])},${m(tl.tint[1])},${m(tl.tint[2])})`;
      ctx.beginPath(); ctx.arc(cx, cy, rad - 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    const pct = hpFraction(t);
    if (pct === 0) { // down: fallen over (above), in a pool, darkened
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.arc(cx, cy, rad - 4, 0, Math.PI * 2); ctx.fill();
    }
    if (lit && !t.hidden) { // 1.7: a metal rim, gold for player characters
      drawTokenRing(ctx, cx, cy, rad - 4, !!(t.owner && t.owner !== '*'));
      if (t.id === selected) { ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, rad - 0.5, 0, Math.PI * 2); ctx.stroke(); }
    } else {
      ctx.lineWidth = t.id === selected ? 4 : 2.5;
      ctx.strokeStyle = t.id === selected ? '#fff' : t.owner && t.owner !== '*' ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.65)';
      if (t.hidden) ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.arc(cx, cy, rad - 4, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
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
      const label = (t.hidden ? '◌ ' : '') + t.label, w = ctx.measureText(label).width + (lit ? 10 : 8);
      ctx.fillStyle = t.hidden ? 'rgba(60,40,0,.8)' : lit ? 'rgba(14,14,18,.82)' : 'rgba(0,0,0,.7)';
      if (lit) { ctx.beginPath(); ctx.roundRect(cx - w / 2, pos.y + t.size * CELL - 5, w, 13, 6.5); ctx.fill(); if (!t.hidden) { ctx.lineWidth = 1; ctx.strokeStyle = t.owner && t.owner !== '*' ? 'rgba(217,176,76,.7)' : 'rgba(154,161,169,.6)'; ctx.stroke(); } }
      else ctx.fillRect(cx - w / 2, pos.y + t.size * CELL - 5, w, 13);
      ctx.fillStyle = t.hidden ? '#fcd34d' : '#ddd'; ctx.fillText(label, cx, pos.y + t.size * CELL + 2);
    }
  }

  efx.draw(ctx); // spells going off
  efx.drawFloats(ctx, (id) => { const t = s.tokens[id]; if (!t) return null; const r = (t.size * CELL) / 2; return [t.x * CELL + r, t.y * CELL + r, r]; }, view.zoom);
  drawOverlays(s);
  drawToolPreview(s);
  weather.update();
  // fire flickers and water moves: keep drawing, about 30 times a second, while there's some in view
  if (!animTimer && (efx.active() || (moving && (lighting.animating(s, cells) || Object.values(s.tokens).some((t) => (t.conditions || []).some((c) => LIVE_CONDITIONS.has(c))))))) animTimer = setTimeout(tick, 33);
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
  if (!me.isDM || !((s.walls && s.walls.length) || (s.doors && s.doors.length)) || !(mode === 'build' || fogTool === 'room' || tt === 'door')) return;
  const z = view.zoom;
  ctx.save(); ctx.lineCap = 'round';
  ctx.lineWidth = 2.5 / z; ctx.strokeStyle = 'rgba(56,189,248,.85)'; ctx.beginPath();
  for (const g of s.walls || []) { ctx.moveTo(g[0] * CELL, g[1] * CELL); ctx.lineTo(g[2] * CELL, g[3] * CELL); } ctx.stroke();
  for (const open of [false, true]) {
    ctx.lineWidth = 4 / z; ctx.strokeStyle = open ? 'rgba(74,222,128,.95)' : 'rgba(251,146,60,.95)'; ctx.beginPath();
    for (const g of s.doors || []) if (!!g[4] === open) { ctx.moveTo(g[0] * CELL, g[1] * CELL); ctx.lineTo(g[2] * CELL, g[3] * CELL); }
    ctx.stroke();
  }
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

// ---------- lighting and vision ----------
// Players get "sight" from the table: one byte per square (2 seen, 1 seen dimly, 0 not seen now).
// Squares they can't see right now are dark (what's there is what they remember). The DM can preview it.
const VIS = window.TabletopVision;
let previewSight = null, previewKey = '', visionMask = null;
const decodeSight = (b64) => { if (!b64) return null; const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
function sightNow(s) {
  if (!s || !s.vision || !s.vision.on) return null;
  if (!me.isDM) { if (typeof s.sight === 'string') s.sight = decodeSight(s.sight); return s.sight || null; }
  const who = $('vPreview').value;
  if (!who || !VIS) return null;
  // the DM's preview: worked out here, the same way the table does it for players
  const key = JSON.stringify([editing, who, s.vision, s.cols, s.rows, Object.values(s.tokens).map((t) => [t.x, t.y, t.size, t.owner, t.light, t.darkvision, t.hidden]), (s.doors || []).map((d) => d[4] ? 1 : 0), Object.keys(s.tiles).length, Object.values(s.props).map((p) => p.kind + p.x + ',' + p.y + (p.open ? 'o' : ''))]);
  if (key !== previewKey) { previewKey = key; const name = who === '*' ? '' : who; const sc2 = who === '*' ? { ...s, vision: { ...s.vision, shared: true } } : s; previewSight = VIS.sight(sc2, VIS.viewersFor(sc2, name)); visionMask = null; }
  return previewSight;
}
function tokenSeen(s, t, S) { for (let y = t.y; y < t.y + t.size; y++) for (let x = t.x; x < t.x + t.size; x++) if (S[y * s.cols + x]) return true; return false; }
let noTokenNote = false;
function drawVision(s) {
  const S = sightNow(s);
  // a player with vision on but no token of their own sees nothing: say why
  const lonely = !me.isDM && !!S && !Object.values(s.tokens).some((t) => t.owner === me.name);
  if (lonely !== noTokenNote) { noTokenNote = lonely; $('status').textContent = lonely ? 'You see what your character sees: ask the DM to give you a token on this map' : ''; $('status').style.display = lonely ? '' : 'none'; }
  if (!me.isDM) previewSight = null; else if (!S) previewSight = null;
  if (!S || S.length !== s.cols * s.rows) return;
  const P = 2, Z = 4;
  if (!visionMask || visionMask.src !== S) {
    const w = (s.cols + 2 * P) * Z, h = (s.rows + 2 * P) * Z, c1 = document.createElement('canvas'); c1.width = w; c1.height = h;
    const g = c1.getContext('2d'); g.fillStyle = 'rgba(6,6,10,.8)'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) {
      const v = S[y * s.cols + x]; if (!v) continue;
      g.clearRect((x + P) * Z, (y + P) * Z, Z, Z);
      if (v === 1) { g.fillStyle = 'rgba(10,12,30,.42)'; g.fillRect((x + P) * Z, (y + P) * Z, Z, Z); }
    }
    const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
    const g2 = c2.getContext('2d'); g2.filter = 'blur(1.2px)'; g2.drawImage(c1, 0, 0);
    visionMask = c2; visionMask.src = S;
  }
  ctx.save(); ctx.imageSmoothingEnabled = true;
  ctx.drawImage(visionMask, -P * CELL, -P * CELL, (s.cols + 2 * P) * CELL, (s.rows + 2 * P) * CELL);
  ctx.restore();
}
// light from tokens carrying it: a soft warm glow everyone sees
// at dawn, dusk and night: torches, fires and lamps (and lit tokens) throw warm pools of light on the darkened map
function drawLightPools(s, time) {
  const k = time === 'night' ? 1 : 0.55, pools = [];
  for (const p of Object.values(s.props)) { const L = VIS.PROP_LIGHT[p.kind]; if (L && !p.off) pools.push([p.x + 0.5, p.y + 0.5, L[0] / 5, L[1] / 5]); }
  for (const l of s.lights || []) if (l[2] > 0) pools.push([l[0], l[1], l[2] * 0.5, l[2]]);
  for (const t of Object.values(s.tokens)) if (t.light && t.light[1] > 0) pools.push([t.x + t.size / 2, t.y + t.size / 2, t.light[0] / 5, t.light[1] / 5]);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, s.cols * CELL, s.rows * CELL); ctx.clip(); ctx.globalCompositeOperation = 'lighter';
  for (const [x, y, bright, dim] of pools.slice(0, 400)) {
    const cx = x * CELL, cy = y * CELL, r = Math.max(0.5, dim) * CELL;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(150,95,40,${0.55 * k})`); g.addColorStop(Math.min(0.95, (bright / dim) || 0.5), `rgba(110,68,28,${0.3 * k})`); g.addColorStop(1, 'rgba(90,55,20,0)');
    ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
}
function drawTokenLights(s) {
  for (const t of Object.values(s.tokens)) {
    if (!t.light || !(t.light[1] > 0)) continue;
    const cx = (t.x + t.size / 2) * CELL, cy = (t.y + t.size / 2) * CELL, r = (t.light[1] / 5) * CELL;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,196,110,.20)'); g.addColorStop((t.light[0] / t.light[1]) || 0.5, 'rgba(255,180,90,.10)'); g.addColorStop(1, 'rgba(255,170,80,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
}
// The DM's vision settings
function renderVisionPop() {
  const s = sc(); if (!s || !me.isDM) return;
  const v = { on: false, ambient: 'bright', shared: true, explore: true, ...(s.vision || {}) };
  $('vOn').checked = v.on; $('vAmbient').value = v.ambient; $('vShared').checked = v.shared; $('vExplore').checked = v.explore;
  $('visionBtn').classList.toggle('on', v.on);
  const owners = [...new Set(Object.values(s.tokens).map((t) => t.owner).filter((o) => o && o !== '*'))].sort();
  const cur = $('vPreview').value, sel = $('vPreview');
  sel.innerHTML = '<option value="">Nobody: I see everything</option><option value="*">The whole party</option>' + owners.map((o) => `<option value="${o.replace(/"/g, '&quot;')}"></option>`).join('');
  [...sel.options].slice(2).forEach((o, i) => { o.textContent = owners[i]; });
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
  sel.disabled = !v.on;
}
const setVision = (patch) => { const s = sc(); s.vision = { on: false, ambient: 'bright', shared: true, explore: true, ...(s.vision || {}), ...patch }; sendMsg({ type: 'sceneUpdate', sceneId: editing, vision: patch }); renderVisionPop(); draw(); };
$('visionBtn').onclick = () => { $('visionPop').hidden = !$('visionPop').hidden; $('wxPop').hidden = true; renderVisionPop(); };
$('vClose').onclick = () => { $('visionPop').hidden = true; };
$('vOn').onchange = () => { setVision({ on: $('vOn').checked }); toast($('vOn').checked ? 'Vision on: players see only what their characters can see. Players see through tokens they own.' : 'Vision off: players see the whole map (apart from fog)', 5000); };
$('vAmbient').onchange = () => setVision({ ambient: $('vAmbient').value });
$('vShared').onchange = () => setVision({ shared: $('vShared').checked });
$('vExplore').onchange = () => setVision({ explore: $('vExplore').checked });
$('vPreview').onchange = () => { previewKey = ''; draw(); };

// ---------- encounter builder and stat blocks ----------
// SRD 5.1 monsters (public/monsters.json); difficulty from the D&D 2024 XP budget per character.
const XP_BUDGET = [null, [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100], [600, 1000, 1400], [750, 1300, 1700], [1000, 1700, 2100], [1300, 2000, 2600], [1600, 2300, 3100],
  [1900, 2900, 4100], [2200, 3700, 4700], [2600, 4200, 5400], [2900, 4900, 6200], [3300, 5400, 7800], [3800, 6100, 9800], [4500, 7200, 11700], [5000, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000]];
const CRS = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)];
const crText = (c) => (c === 0.125 ? '1/8' : c === 0.25 ? '1/4' : c === 0.5 ? '1/2' : String(c));
let monsters = null, monsterById = new Map(), encounters = [], enc = { id: null, picked: [] };
async function loadMonsters() {
  if (monsters) return monsters;
  const r = await fetch('monsters.json'); const j = await r.json();
  monsters = j.monsters; monsterById = new Map(monsters.map((m) => [m.id, m]));
  return monsters;
}
// a token's monster: its own link, or the SRD monster with the same name (Goblin 3 → Goblin)
function monsterOf(t) {
  if (!monsters || !t) return null;
  if (t.srd && monsterById.get(t.srd)) return monsterById.get(t.srd);
  const base = String(t.label || '').replace(/\s+\d+$/, '').toLowerCase();
  return monsters.find((m) => m.name.toLowerCase() === base) || null;
}
async function openEncounters() {
  await loadMonsters();
  if (!$('encType').options.length || $('encType').options.length === 1) {
    [...new Set(monsters.map((m) => m.type.split(' (')[0]))].sort().forEach((t) => { const o = document.createElement('option'); o.value = t; o.textContent = t[0].toUpperCase() + t.slice(1); $('encType').appendChild(o); });
    for (const sel of [$('encCrMin'), $('encCrMax')]) CRS.forEach((c) => { const o = document.createElement('option'); o.value = c; o.textContent = crText(c); sel.appendChild(o); });
    $('encCrMin').value = '0'; $('encCrMax').value = '30';
  }
  // the party: players with tokens on this map, and the level used last time
  const owners = new Set(Object.values(sc().tokens).map((t) => t.owner).filter((o) => o && o !== '*'));
  if (owners.size) $('encSize').value = owners.size;
  $('encLevel').value = tryGet('tt-partyLevel') || $('encLevel').value;
  renderEncList(); renderEncPicked(); renderEncLoad();
  $('encModal').hidden = false; setTimeout(() => $('encSearch').focus(), 0);
}
function renderEncList() {
  const q = $('encSearch').value.trim().toLowerCase(), type = $('encType').value, lo = Number($('encCrMin').value), hi = Number($('encCrMax').value);
  const list = monsters.filter((m) => (!q || m.name.toLowerCase().includes(q) || m.type.toLowerCase().includes(q)) && (!type || m.type.startsWith(type)) && m.cr >= lo && m.cr <= hi);
  if (q) { const rank = (m) => (m.name.toLowerCase().startsWith(q) ? 0 : m.name.toLowerCase().includes(q) ? 1 : 2); list.sort((x, y) => rank(x) - rank(y)); } // name matches first
  $('encCount').textContent = `${list.length} monsters`;
  const box = $('encList'); box.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const m of list.slice(0, 400)) {
    const row = document.createElement('div'); row.className = 'mrow';
    const n = document.createElement('span'); n.className = 'mn'; n.textContent = m.name; n.title = 'Show the stat block';
    const sm = document.createElement('small'); sm.textContent = m.type.split(' (')[0]; n.appendChild(sm); n.onclick = () => showStatBlock(m);
    const cr = document.createElement('span'); cr.className = 'cr'; cr.textContent = `CR ${crText(m.cr)}`;
    const xp = document.createElement('span'); xp.className = 'cr'; xp.textContent = `${m.xp.toLocaleString()} XP`;
    const add = document.createElement('button'); add.textContent = '+'; add.title = 'Add to the encounter'; add.onclick = () => { pick(m.id, 1); };
    row.append(n, cr, xp, add); frag.appendChild(row);
  }
  box.appendChild(frag);
}
function pick(id, d) {
  const p = enc.picked.find((x) => x.id === id);
  if (p) { p.n += d; if (p.n <= 0) enc.picked = enc.picked.filter((x) => x !== p); } else if (d > 0) enc.picked.push({ id, n: d });
  renderEncPicked();
}
function encXp() { return enc.picked.reduce((a, p) => a + (monsterById.get(p.id)?.xp || 0) * p.n, 0); }
function renderEncPicked() {
  const box = $('encPicked'); box.innerHTML = '';
  if (!enc.picked.length) box.innerHTML = '<div class="hint" style="padding:8px">Click + next to a monster to add it.</div>';
  for (const p of enc.picked) {
    const m = monsterById.get(p.id); if (!m) continue;
    const row = document.createElement('div'); row.className = 'prow';
    const cv = document.createElement('canvas'); thumb({ icon: m.token.icon, color: m.token.color, label: m.name }, 22, cv);
    const n = document.createElement('span'); n.className = 'mn'; n.textContent = m.name; n.onclick = () => showStatBlock(m);
    const cnt = document.createElement('span'); cnt.className = 'cnt';
    const minus = document.createElement('button'); minus.textContent = '−'; minus.onclick = () => pick(p.id, -1);
    const num = document.createElement('b'); num.textContent = '×' + p.n;
    const plus = document.createElement('button'); plus.textContent = '+'; plus.onclick = () => pick(p.id, 1);
    cnt.append(minus, num, plus);
    const xp = document.createElement('span'); xp.className = 'xp'; xp.textContent = `${(m.xp * p.n).toLocaleString()} XP`;
    row.append(cv, n, cnt, xp); box.appendChild(row);
  }
  // the difficulty meter
  const size = Math.max(1, Math.min(12, Number($('encSize').value) || 4)), lvl = Math.max(1, Math.min(20, Number($('encLevel').value) || 1));
  const [low, mod, high] = XP_BUDGET[lvl].map((v) => v * size), xp = encXp(), max = high * 1.5;
  $('encMeter').querySelector('.fill').style.width = Math.min(100, (xp / max) * 100) + '%';
  $('encMeter').querySelector('.marks').innerHTML = [low, mod, high].map((v) => `<span style="left:${(v / max) * 100}%">▲</span>`).join('')
    + `<div class="legend">Low up to ${low.toLocaleString()} · Moderate up to ${mod.toLocaleString()} · High up to ${high.toLocaleString()} XP</div>`;
  const verdict = !xp ? '' : xp <= low ? `Low · ${xp.toLocaleString()} XP: an easy fight` : xp <= mod ? `Moderate · ${xp.toLocaleString()} XP: a real fight, a slim chance someone dies`
    : xp <= high ? `High · ${xp.toLocaleString()} XP: could be deadly` : `Beyond High · ${xp.toLocaleString()} XP: very likely deadly for ${size} level-${lvl} characters`;
  $('encVerdict').textContent = verdict; $('encVerdict').style.color = !xp ? '' : xp <= low ? '#4ade80' : xp <= mod ? '#facc15' : xp <= high ? '#fb923c' : '#f87171';
  $('encDel').style.display = enc.id ? '' : 'none';
}
function renderEncLoad() {
  const sel = $('encLoad'); sel.innerHTML = '<option value="">Saved encounters…</option>';
  for (const e of encounters) { const o = document.createElement('option'); o.value = e.id; o.textContent = e.name; sel.appendChild(o); }
}
const rollHp = (expr) => { const m = String(expr).replace(/\s/g, '').match(/^(\d+)d(\d+)([+-]\d+)?$/); if (!m) return null; let t = Number(m[3] || 0); for (let i = 0; i < +m[1]; i++) t += 1 + Math.floor(Math.random() * +m[2]); return Math.max(1, t); };
// put the encounter on the map: near the middle of the DM's view, on free floor, numbered like the library does
function placeEncounter() {
  const s = sc(); if (!s || !enc.picked.length) return toast('Add some monsters first');
  const r = canvas.getBoundingClientRect(), cx = Math.floor((r.width / 2 - view.x) / view.zoom / CELL), cy = Math.floor((r.height / 2 - view.y) / view.zoom / CELL);
  const taken = new Set();
  for (const t of Object.values(s.tokens)) for (let y = t.y; y < t.y + t.size; y++) for (let x = t.x; x < t.x + t.size; x++) taken.add(x + ',' + y);
  const free = (x, y, n) => { for (let j = y; j < y + n; j++) for (let i = x; i < x + n; i++) if (!inside(s, i, j) || taken.has(i + ',' + j) || s.tiles[i + ',' + j] === 'wall') return false; return true; };
  const spots = []; for (let d = 0; d < 30; d++) for (let y = cy - d; y <= cy + d; y++) for (let x = cx - d; x <= cx + d; x++) if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) === d) spots.push([x, y]);
  let placed = 0;
  const used = new Set(Object.values(s.tokens).map((t) => t.label));
  const nameFor = (m, many) => { // Goblin 1, Goblin 2… (a lone monster keeps its plain name if it's free)
    if (!many && !used.has(m.name) && !used.has(m.name + ' 1')) { used.add(m.name); return m.name; }
    let n = 1; while (used.has(`${m.name} ${n}`)) n++; used.add(`${m.name} ${n}`); return `${m.name} ${n}`;
  };
  for (const p of enc.picked) {
    const m = monsterById.get(p.id);
    for (let k = 0; k < p.n; k++) {
      const sz = m.token.size, at = spots.find(([x, y]) => free(x, y, sz));
      if (!at) { toast('No room left near the middle of your view'); break; }
      for (let y = at[1]; y < at[1] + sz; y++) for (let x = at[0]; x < at[0] + sz; x++) taken.add(x + ',' + y);
      const hp = $('encHp').value === 'roll' ? rollHp(m.hd) || m.hp : m.hp;
      sendMsg({ type: 'addToken', sceneId: editing, label: nameFor(m, p.n > 1), icon: m.token.icon, color: m.token.color, size: sz, owner: '', x: at[0], y: at[1],
        hidden: $('encHidden').checked, hp, maxHp: hp, initBonus: m.token.init, srd: m.id });
      placed++;
    }
  }
  if (placed) { $('encModal').hidden = true; toast(`Placed ${placed} monster${placed === 1 ? '' : 's'}${$('encHidden').checked ? ', hidden from players' : ''}. Select one for its stat block.`, 5000); }
}
// a stat block, with its attacks, damage and ability checks clickable to roll
function showStatBlock(m) {
  const b = $('sbBody'); b.innerHTML = '';
  $('sbName').textContent = m.name;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; b.appendChild(e); return e; };
  const line = (label, value) => { if (!value) return; const p = el('p'); const s = document.createElement('b'); s.textContent = label + ' '; p.append(s, value); };
  const roll = (expr, label) => rollWithPrivacy(expr, `${m.name}: ${label}`);
  el('div', 'sub', `${m.size} ${m.type}, ${m.align}`);
  el('hr');
  line('Armor Class', `${m.ac}${m.acType ? ` (${m.acType})` : ''}`);
  const hp = el('p'); hp.innerHTML = '<b>Hit Points</b> '; hp.append(`${m.hp} (`); hp.appendChild(rollBtn(m.hd, () => roll(m.hd, 'hit points'))); hp.append(')');
  line('Speed', m.speed);
  el('hr');
  const abl = el('div', 'abl');
  ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].forEach((n, i) => { const v = m.abl[i], md = Math.floor((v - 10) / 2), bt = document.createElement('button'); bt.title = `Roll a ${n} check`; bt.innerHTML = `<b>${n}</b>${v} (${md >= 0 ? '+' : ''}${md})`; bt.onclick = () => roll(`1d20${md ? (md > 0 ? '+' : '') + md : ''}`, `${n} check`); abl.appendChild(bt); });
  el('hr');
  line('Saving Throws', m.saves); line('Skills', m.skills); line('Damage Vulnerabilities', m.vuln); line('Damage Resistances', m.resist);
  line('Damage Immunities', m.immune); line('Condition Immunities', m.cimmune); line('Senses', m.senses); line('Languages', m.lang);
  line('Challenge', `${crText(m.cr)} (${m.xp.toLocaleString()} XP)`);
  el('hr');
  const section = (title, items) => { if (!items || !items.length) return; if (title) el('h3', null, title); for (const it of items) { const p = el('p'); const s = document.createElement('b'); s.textContent = it.n + '. '; s.style.fontStyle = 'italic'; p.appendChild(s); richText(p, it.d, (expr, what) => roll(expr, `${it.n}${what ? ' ' + what : ''}`)); } };
  section(null, m.traits); section('Actions', m.actions); section('Reactions', m.reactions); section('Legendary Actions', m.legendary);
  const c = el('p', 'hint'); c.textContent = 'From the SRD 5.1 by Wizards of the Coast, CC BY 4.0.';
  $('statModal').hidden = false;
}
function rollBtn(text, onclick) { const bt = document.createElement('button'); bt.className = 'roll'; bt.textContent = text; bt.title = 'Roll ' + text; bt.onclick = onclick; return bt; }
// "+5 to hit" and "(2d6 + 3)" become buttons that roll
function richText(p, text, roll) {
  const re = /([+-]\d+) to hit|\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)/g; let last = 0, m;
  while ((m = re.exec(text))) {
    p.append(text.slice(last, m.index));
    if (m[1]) { const expr = '1d20' + m[1]; p.appendChild(rollBtn(`${m[1]} to hit`, () => roll(expr, 'attack'))); }
    else { const expr = m[2].replace(/\s/g, ''); p.append('('); p.appendChild(rollBtn(m[2], () => roll(expr, 'damage'))); p.append(')'); }
    last = re.lastIndex;
  }
  p.append(text.slice(last));
}
const rollWithPrivacy = (expr, label) => sendMsg({ type: 'roll', expr, label: label.slice(0, 30), show: $('sbPrivate').checked }); // the stat block is the DM's: hidden unless shown

$('openEnc').onclick = () => openEncounters().catch((e) => toast('Couldn\'t load the monsters: ' + e.message));
$('encSearch').oninput = () => renderEncList();
$('encType').onchange = $('encCrMin').onchange = $('encCrMax').onchange = () => renderEncList();
$('encSize').oninput = () => renderEncPicked();
$('encLevel').oninput = () => { trySet('tt-partyLevel', $('encLevel').value); renderEncPicked(); };
$('encPlace').onclick = placeEncounter;
$('encSave').onclick = () => {
  if (!enc.picked.length) return toast('Add some monsters first');
  const id = enc.id || uid(); enc.id = id;
  sendMsg({ type: 'encounterSave', encounter: { id, name: $('encName').value.trim() || 'Encounter', monsters: enc.picked, party: { size: $('encSize').value, level: $('encLevel').value } } });
  toast('Encounter saved');
};
$('encDel').onclick = () => { if (!enc.id) return; sendMsg({ type: 'encounterDelete', id: enc.id }); enc = { id: null, picked: [] }; $('encName').value = ''; renderEncPicked(); };
$('encLoad').onchange = () => {
  const e = encounters.find((x) => x.id === $('encLoad').value); $('encLoad').value = ''; if (!e) return;
  enc = { id: e.id, picked: e.monsters.map((m) => ({ ...m })) }; $('encName').value = e.name;
  $('encSize').value = e.party.size; $('encLevel').value = e.party.level; renderEncPicked();
};
$('eStat').onclick = async () => { await loadMonsters(); const m = monsterOf(selected && sc().tokens[selected]); if (m) showStatBlock(m); else toast('No SRD stat block for this token'); };

// ---------- chat ----------
// Table talk in the log. Whispers go to one person (and the DM sees them); the DM can speak as an NPC.
const speakers = new Set(); // names seen talking or rolling, to whisper to
function noteSpeaker(e) { if (e.who && !e.dm && !sameName(e.who, me.name)) speakers.add(e.who); }
function renderChatTargets() {
  const s = sc(), sel = $('chatTo'), cur = sel.value;
  const names = new Set([...players, ...speakers]);
  if (s) Object.values(s.tokens).forEach((t) => { if (t.owner && t.owner !== '*') names.add(t.owner); });
  [...names].forEach((n) => { if (sameName(n, me.name)) names.delete(n); });
  sel.innerHTML = '';
  const add = (v, txt) => { const o = document.createElement('option'); o.value = v; o.textContent = txt; sel.appendChild(o); };
  add('', 'To everyone');
  if (!me.isDM) add('DM', 'Whisper to the DM');
  [...names].sort().forEach((n) => add(n, 'Whisper to ' + n));
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
  if (!me.isDM) return;
  const as = $('chatAs'), curAs = as.value;
  as.innerHTML = '';
  const addAs = (v, txt) => { const o = document.createElement('option'); o.value = v; o.textContent = txt; as.appendChild(o); };
  addAs('', 'As the DM'); addAs('Narrator', 'As the Narrator');
  if (s) [...new Set(Object.values(s.tokens).filter((t) => !t.owner).map((t) => t.label))].sort().forEach((n) => addAs(n, 'As ' + n));
  as.value = [...as.options].some((o) => o.value === curAs) ? curAs : '';
}
$('chatTo').onfocus = renderChatTargets; $('chatAs').onfocus = renderChatTargets;
$('chatTo').onmousedown = renderChatTargets; $('chatAs').onmousedown = renderChatTargets;
$('chatForm').onsubmit = (e) => {
  e.preventDefault();
  let text = $('chatText').value.trim(); if (!text) return;
  let to = $('chatTo').value ? [$('chatTo').value] : [];
  const m = text.match(/^\/(r|roll)\s+(.+)$/i);
  if (m) { rollWith(m[2], '', {}); $('chatText').value = ''; return; }
  const w = text.match(/^\/(w|whisper)\s+("([^"]+)"|(\S+))\s+([\s\S]+)$/i);
  if (w) { to = [w[3] || w[4]]; text = w[5]; }
  else if (/^\/(w|whisper)\b/i.test(text)) return toast('Whisper like this: /w Bob meet me by the door');
  sendMsg({ type: 'chat', text, to, as: me.isDM ? $('chatAs').value : undefined });
  $('chatText').value = '';
};
// a speech bubble over the speaker's token for a few seconds (not for whispers)
const bubbles = [];
function speechBubble(e) {
  if (e.to) return;
  const s = scenes[editing]; if (!s) return;
  const t = e.as ? Object.values(s.tokens).find((x) => sameName(x.label, e.as)) : Object.values(s.tokens).find((x) => x.owner && sameName(x.owner, e.who));
  if (!t) return;
  for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].id === t.id) bubbles.splice(i, 1);
  bubbles.push({ id: t.id, text: e.text.length > 140 ? e.text.slice(0, 137) + '…' : e.text, t0: performance.now(), npc: !!e.as });
  draw();
}
function drawBubbles(s) {
  const now = performance.now(), z = view.zoom;
  for (let i = bubbles.length - 1; i >= 0; i--) if (now - bubbles[i].t0 > 7000) bubbles.splice(i, 1);
  for (const b of bubbles) {
    const t = s.tokens[b.id]; if (!t) continue;
    const age = now - b.t0, alpha = age > 6200 ? Math.max(0, 1 - (age - 6200) / 800) : 1;
    const fs = 14 / z, pad = 8 / z, maxW = 240 / z;
    ctx.save(); ctx.globalAlpha = alpha; ctx.font = `500 ${fs}px system-ui, sans-serif`;
    const words = b.text.split(/\s+/), lines = []; let line = '';
    for (const w of words) { const test = line ? line + ' ' + w : w; if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test; }
    if (line) lines.push(line);
    const shown = lines.slice(0, 4); if (lines.length > 4) shown[3] += '…';
    const w = Math.max(...shown.map((l) => ctx.measureText(l).width)) + pad * 2, h = shown.length * fs * 1.3 + pad * 1.6;
    const cx = (t.x + t.size / 2) * CELL, top = t.y * CELL - 10 / z - h;
    ctx.fillStyle = b.npc ? 'rgba(255,248,230,.97)' : 'rgba(255,255,255,.97)'; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.2 / z;
    ctx.beginPath(); ctx.roundRect(cx - w / 2, top, w, h, 8 / z); ctx.moveTo(cx - 7 / z, top + h); ctx.lineTo(cx, top + h + 9 / z); ctx.lineTo(cx + 7 / z, top + h); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    shown.forEach((l, i) => ctx.fillText(l, cx, top + pad * 0.8 + i * fs * 1.3));
    ctx.restore();
  }
  if (bubbles.length) draw();
}
// ---------- the player's own name: protect it with a PIN ----------
function renderMePop() {
  if (me.isDM) return;
  $('mpState').textContent = pinSet ? 'Your name is protected by a PIN: nobody else can join as you. Type a new one to change it.' : 'Anyone who knows the table\'s address can join as you. Set a PIN so only you can.';
  $('mpRemove').style.display = pinSet ? '' : 'none';
}
$('me').onclick = () => { if (me.isDM) return; $('mePop').hidden = !$('mePop').hidden; $('soundPop').hidden = true; renderSound(); renderMePop(); if (!$('mePop').hidden) setTimeout(() => $('mpPin').focus(), 0); };
$('mpClose').onclick = () => { $('mePop').hidden = true; };
$('mpSave').onclick = () => {
  const v = $('mpPin').value.trim();
  if (!/^\d{4,8}$/.test(v)) return toast('A PIN is 4 to 8 digits');
  trySet('tt-pin:' + me.name.toLowerCase(), v); pin = v;
  sendMsg({ type: 'setPin', pin: v }); $('mpPin').value = ''; $('mePop').hidden = true;
};
$('mpPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('mpSave').click(); });
$('mpRemove').onclick = () => { sendMsg({ type: 'setPin', pin: null }); trySet('tt-pin:' + me.name.toLowerCase(), ''); pin = ''; $('mePop').hidden = true; };

// ---------- handouts ----------
let handouts = [], viewing = null, hEdit = null;
function renderHandouts() {
  const list = $('handoutList'); list.innerHTML = '';
  $('handoutSec').classList.toggle('none', !handouts.length);
  if (me.isDM && !handouts.length) list.innerHTML = '<div class="hint" style="margin-top:0">Letters, pictures and clues to show the players.</div>';
  for (const h of [...handouts].reverse()) {
    const row = document.createElement('div'); row.className = 'hitem';
    const t = document.createElement('span'); t.className = 'ht'; t.textContent = h.title; t.title = 'Open'; t.onclick = () => openHandout(h);
    row.appendChild(t);
    if (me.isDM) {
      const who = document.createElement('small'); who.textContent = h.to === 'all' ? 'everyone' : h.to.join(', '); row.appendChild(who);
      const show = document.createElement('button'); show.textContent = 'Show'; show.title = 'Pop it up on their screens again'; show.onclick = () => { sendMsg({ type: 'handoutShow', id: h.id }); toast(`Showing "${h.title}" to ${h.to === 'all' ? 'everyone' : h.to.join(', ')}`); };
      const ed = document.createElement('button'); ed.textContent = 'Edit'; ed.onclick = () => editHandout(h);
      row.append(show, ed);
    }
    list.appendChild(row);
  }
}
function openHandout(h) {
  viewing = h.id;
  $('hvTitle').textContent = h.title; $('hvText').textContent = h.text || '';
  if (h.img) $('hvImg').src = h.img; else $('hvImg').removeAttribute('src');
  $('handoutView').hidden = false;
}
function editHandout(h) {
  hEdit = h ? { ...h } : { title: '', text: '', img: null, to: 'all' };
  $('hmTitle').textContent = h ? 'Edit handout' : 'New handout';
  $('hTitle').value = hEdit.title; $('hText').value = hEdit.text || '';
  if (hEdit.img) $('hImgPrev').src = hEdit.img; else $('hImgPrev').removeAttribute('src');
  $('hImgDel').style.display = hEdit.img ? '' : 'none';
  $('hDel').style.display = h ? '' : 'none';
  document.querySelector(`input[name="hTo"][value="${hEdit.to === 'all' ? 'all' : 'some'}"]`).checked = true;
  // everyone the DM might give it to: players here now and owners of tokens
  const names = [...new Set([...players, ...Object.values(scenes).flatMap((x) => Object.values(x.tokens).map((t) => t.owner)).filter((o) => o && o !== '*'), ...(Array.isArray(hEdit.to) ? hEdit.to : [])])].sort();
  $('hWho').innerHTML = names.length ? '' : '<div class="hint" style="margin:0">No players yet. Give tokens owners, or wait for players to join.</div>';
  for (const n of names) {
    const l = document.createElement('label'); l.className = 'check';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = n; cb.checked = Array.isArray(hEdit.to) && hEdit.to.includes(n);
    cb.onchange = () => { if (cb.checked) document.querySelector('input[name="hTo"][value="some"]').checked = true; };
    l.append(cb, ' ' + n); $('hWho').appendChild(l);
  }
  $('handoutModal').hidden = false; setTimeout(() => $('hTitle').focus(), 0);
}
function saveHandout(show) {
  const to = document.querySelector('input[name="hTo"]:checked').value === 'all' ? 'all' : [...$('hWho').querySelectorAll('input:checked')].map((c) => c.value);
  if (to !== 'all' && !to.length) return toast('Tick who gets it, or choose Everyone');
  const h = { id: hEdit.id, title: $('hTitle').value.trim() || 'Handout', text: $('hText').value, img: hEdit.img || null, to };
  if (!h.text.trim() && !h.img) return toast('Add some text or a picture');
  sendMsg({ type: 'handoutSave', handout: h, show });
  $('handoutModal').hidden = true;
  toast(show ? `Showing "${h.title}" to ${to === 'all' ? 'everyone' : to.join(', ')}` : 'Handout saved. Click Show when you want the players to see it.', 4000);
}
$('newHandout').onclick = () => editHandout(null);
$('hDel').onclick = () => {
  if (!hEdit || !hEdit.id) return;
  if ($('hDel').dataset.sure !== '1') { $('hDel').dataset.sure = '1'; $('hDel').textContent = 'Sure?'; setTimeout(() => { $('hDel').dataset.sure = ''; $('hDel').textContent = 'Delete'; }, 3000); return; }
  sendMsg({ type: 'handoutDelete', id: hEdit.id }); $('handoutModal').hidden = true; $('hDel').dataset.sure = ''; $('hDel').textContent = 'Delete';
};
$('hSave').onclick = () => saveHandout(false);
$('hShow').onclick = () => saveHandout(true);
$('hImgBtn').onclick = () => $('hImgIn').click();
$('hImgIn').onchange = async () => {
  const f = $('hImgIn').files[0]; $('hImgIn').value = ''; if (!f) return;
  try { toast('Uploading picture…', 10000); hEdit.img = await uploadFile(f); $('hImgPrev').src = hEdit.img; $('hImgDel').style.display = ''; toast('Picture added'); } catch (e) { toast('Upload failed: ' + e.message); }
};
$('hImgDel').onclick = () => { hEdit.img = null; $('hImgPrev').removeAttribute('src'); $('hImgDel').style.display = 'none'; };

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
    color: $('tplFx').value ? SPELLS[$('tplFx').value].col : personColour(me.name, me.isDM), dragged: false };
}
// a spell going off over its template, with its sound from where it is
function castSpell(s, t) {
  const cells = tplCells(s, t); if (!cells.length) return;
  efx.spell(t.fx, { cells, ox: t.x, oy: t.y, shape: t.shape, angle: t.angle, clip: () => tplOutline(t) });
  const [cx, cy] = cells.reduce((a, [x, y]) => [a[0] + x + 0.5, a[1] + y + 0.5], [0, 0]).map((v) => v / cells.length), at = hear(s, cx, cy, 30, 0.3);
  snd.effect(t.fx === 'healing' ? 'heal' : 'spell-' + t.fx, { vol: at.vol, pan: at.pan });
  draw();
}
function finishTemplate() {
  const d = tplDraft; tplDraft = null;
  const id = uid();
  const fxk = $('tplFx').value;
  sendMsg({ type: 'templateSet', sceneId: editing, tpl: { id, shape: d.shape, x: d.x, y: d.y, angle: d.angle, size: d.size, width: d.width, color: d.color, fx: fxk, cast: !!fxk } });
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
$('tplCast').onclick = () => { const t = selTpl && (sc().templates || {})[selTpl]; if (!t) return toast('Click a template first, then Cast'); if (!canEditTpl(t)) return toast('That template isn\'t yours'); const k = $('tplFx').value || t.fx; if (!k) return toast('Pick an effect first'); sendMsg({ type: 'templateSet', sceneId: editing, tpl: { id: t.id, fx: k, color: SPELLS[k].col, cast: true } }); };
$('tplFx').onchange = () => { const t = selTpl && (sc().templates || {})[selTpl]; if (t && canEditTpl(t) && $('tplFx').value) sendMsg({ type: 'templateSet', sceneId: editing, tpl: { id: t.id, fx: $('tplFx').value, color: SPELLS[$('tplFx').value].col } }); };
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
  drawBubbles(s);
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
  const lv = t.light && t.light[1] > 0 ? t.light.join(',') : '';
  if (keep !== $('eLight')) { $('eLight').value = lv; if ($('eLight').value !== lv) { const o = document.createElement('option'); o.value = lv; o.textContent = `${t.light[0]} / ${t.light[1]} ft`; $('eLight').appendChild(o); $('eLight').value = lv; } }
  setv('eDark', String(t.darkvision || 0)); setv('eDdb', t.ddb || '');
  $('eDdbOpen').disabled = !t.ddb;
  $('eStatRow').classList.toggle('off', !(me.isDM && monsterOf(t)));
  const floors = floorList(sc());
  $('eFloorRow').classList.toggle('off', !(me.isDM && floors.length > 1));
  if (me.isDM && floors.length > 1 && keep !== $('eFloor')) {
    $('eFloor').innerHTML = floors.map((f) => `<option value="${f.id}"></option>`).join('');
    [...$('eFloor').options].forEach((o, i) => { o.textContent = floors[i].floor; });
    $('eFloor').value = editing;
  }
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
$('eFloor').onchange = () => { const to = $('eFloor').value; if (selected && to !== editing) { sendMsg({ type: 'tokenFloor', sceneId: editing, id: selected, to }); toast('Moved to ' + $('eFloor').selectedOptions[0].textContent); select(null); } };
$('eLight').onchange = () => { const v = $('eLight').value.split(',').map(Number); updateSelected({ light: v[1] > 0 ? [v[0], v[1]] : null }); };
$('eDark').onchange = () => updateSelected({ darkvision: Number($('eDark').value) || 0 });
const DDB_LINK = /^https:\/\/(www\.)?(dndbeyond\.com\/(profile\/[^/]+\/)?characters\/\d+[\w\-/]*|ddb\.ac\/characters\/\d+[\w\-/]*)$/i;
$('eDdb').onchange = () => {
  const v = $('eDdb').value.trim();
  if (v && !DDB_LINK.test(v)) { toast('That isn\'t a D&D Beyond character link. Open the character on D&D Beyond and copy the address, e.g. https://www.dndbeyond.com/characters/12345678', 7000); return; }
  updateSelected({ ddb: v || null });
};
const openSheet = (t) => { if (t && t.ddb) window.open(t.ddb, '_blank', 'noopener'); };
$('eDdbOpen').onclick = () => openSheet(selected && sc().tokens[selected]);
canvas.addEventListener('dblclick', (e) => { const s = sc(); if (!s) return; const t = tokenAt(s, toWorld(e)); if (t && t.ddb) openSheet(t); });
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
    if (t.ddb) { const sh = document.createElement('button'); sh.className = 'sheet'; sh.textContent = '📜'; sh.title = `Open ${t.label}'s character sheet`; sh.onclick = (ev) => { ev.stopPropagation(); openSheet(t); }; row.appendChild(sh); }
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
    if (tt === 'door') { const q = toSq(p); sendMsg({ type: 'doorToggle', sceneId: editing, x: q.x, y: q.y }); return; }
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
    if (t) setTimeout(() => offerStairs(s, t), 50);
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
    const pick = { v: 'move', r: 'ruler', t: 'template', p: 'ping', l: 'label', d: 'door' }[k];
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
$('mapWalls').onchange = () => { sc().wallStyle = $('mapWalls').value; updateScene({ wallStyle: $('mapWalls').value }); draw(); };
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
// MapTool drawings, painted into the map picture
function fillArea(g, segs) { // non-zero fill of an Area's edges, a row at a time
  if (!segs.length) return;
  const y0 = Math.floor(Math.min(...segs.map((s) => Math.min(s[1], s[3])))), y1 = Math.ceil(Math.max(...segs.map((s) => Math.max(s[1], s[3]))));
  for (let y = y0; y < y1; y++) {
    const py = y + 0.5, xs = [];
    for (const [a, b, c, d, dir] of segs) { if (b === d || py < Math.min(b, d) || py >= Math.max(b, d)) continue; xs.push([a + (c - a) * (py - b) / (d - b), dir]); }
    xs.sort((p, q) => p[0] - q[0]);
    let w = 0;
    for (let i = 0; i < xs.length; i++) { const was = w; w += xs[i][1]; if (was !== 0 && i > 0) g.fillRect(xs[i - 1][0], y, xs[i][0] - xs[i - 1][0], 1); }
  }
}
function drawMapToolDrawing(g, d) {
  g.save();
  g.globalAlpha = Math.max(0, Math.min(1, d.opacity));
  g.lineWidth = d.width; g.lineCap = d.square ? 'square' : 'round'; g.lineJoin = 'round';
  if (d.stroke) g.strokeStyle = d.stroke; if (d.fill) g.fillStyle = d.fill;
  g.beginPath();
  if (d.kind === 'line') { d.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); }
  else if (d.kind === 'rect') g.rect(d.x, d.y, d.w, d.h);
  else if (d.kind === 'oval') g.ellipse(d.x + d.w / 2, d.y + d.h / 2, d.w / 2, d.h / 2, 0, 0, Math.PI * 2);
  else if (d.kind === 'cross') { g.moveTo(d.x, d.y); g.lineTo(d.x + d.w, d.y + d.h); g.moveTo(d.x + d.w, d.y); g.lineTo(d.x, d.y + d.h); }
  else if (d.kind === 'path') {
    let k = 0; const c = d.coords;
    for (const t of d.types) {
      if (t === 0) { g.moveTo(c[k], c[k + 1]); k += 2; } else if (t === 1) { g.lineTo(c[k], c[k + 1]); k += 2; }
      else if (t === 2) { g.quadraticCurveTo(c[k], c[k + 1], c[k + 2], c[k + 3]); k += 4; } else if (t === 3) { g.bezierCurveTo(c[k], c[k + 1], c[k + 2], c[k + 3], c[k + 4], c[k + 5]); k += 6; } else if (t === 4) g.closePath();
    }
  } else if (d.kind === 'area') {
    if (d.fill) fillArea(g, d.segs);
    for (const [a, b, c2, e] of d.segs) { g.moveTo(a, b); g.lineTo(c2, e); }
    if (d.stroke) g.stroke();
    g.restore(); return;
  }
  if (d.fill && d.kind !== 'line' && d.kind !== 'cross') g.fill();
  if (d.stroke) g.stroke();
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
  let unitsToFeet = 1;
  // a token's MapTool light as [bright, dim] feet; lights the file doesn't define (a single map file) count as a torch
  const lightOf = (t) => { for (const id of t.lights) { const l = mt.lightDefs[id]; if (l) return [Math.round(l[0] * unitsToFeet), Math.round(l[1] * unitsToFeet)]; } return [20, 40]; };
  const made = [], notes = [];
  for (const [i, z] of mt.maps.entries()) {
    toast(`Importing ${z.name} (${i + 1} of ${mt.maps.length})…`, 60000);
    const imgs = {}, sizes = {};
    for (const id of new Set([z.mapAsset, z.bgTexture, ...z.tokens.map((t) => t.img)].filter(Boolean))) {
      const blob = await mt.asset(id); if (!blob) continue;
      try { const bmp = await createImageBitmap(blob); imgs[id] = { blob, bmp }; sizes[id] = { w: bmp.width, h: bmp.height }; } catch { /* not an image we can read */ }
    }
    unitsToFeet = 5 / (z.unitsPerCell || 5);
    const L = mapToolLayout(z, sizes);
    if (!L) { notes.push(`${z.name} is empty`); continue; }
    const cols = Math.min(200, L.cols), rows = Math.min(200, L.rows);
    if (L.cols > 200 || L.rows > 200) notes.push(`${z.name} was cut to 200 × 200 squares`);
    if (z.hex) notes.push(`${z.name} uses a hex grid; it's shown on squares`);
    // the map picture: MapTool's map image, background texture and the stamps on its Background and Object layers, flattened into one image
    const stamps = L.placed.filter((t) => (t.layer === 'BACKGROUND' || t.layer === 'OBJECT') && imgs[t.img])
      .sort((a, b) => (a.layer === b.layer ? 0 : a.layer === 'BACKGROUND' ? -1 : 1) || a.z - b.z);
    let bg = null;
    if ((z.mapAsset && imgs[z.mapAsset]) || stamps.length || (z.bgTexture && imgs[z.bgTexture]) || z.drawings.length) {
      const W = cols * L.S, H = rows * L.S, k = Math.min(1, 8192 / Math.max(W, H));
      const cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(H * k);
      const g = cv.getContext('2d'); g.scale(k, k); g.translate(-L.originX, -L.originY);
      if (z.bgTexture && imgs[z.bgTexture]) g.fillStyle = g.createPattern(imgs[z.bgTexture].bmp, 'repeat'); else g.fillStyle = z.bgColour || '#1a1a1a';
      g.fillRect(L.originX, L.originY, W, H);
      if (z.mapAsset && imgs[z.mapAsset]) g.drawImage(imgs[z.mapAsset].bmp, z.boardX, z.boardY, sizes[z.mapAsset].w * z.imageScaleX, sizes[z.mapAsset].h * z.imageScaleY);
      // MapTool's layers, bottom to top: background stamps and drawings, then object stamps and drawings, then drawings on the token layer
      for (const layer of ['BACKGROUND', 'OBJECT', 'TOKEN']) {
        for (const t of stamps) if (t.layer === layer) drawStamp(g, imgs[t.img].bmp, t);
        for (const d of z.drawings) if (d.layer === layer) drawMapToolDrawing(g, d);
      }
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
        ...(t.lights.length ? { light: lightOf(t) } : {}), ...(t.hasSight && /dark/i.test(t.sight) ? { darkvision: 60 } : {}),
        ...(t.hp != null ? { hp: t.hp, maxHp: t.maxHp != null ? t.maxHp : t.hp } : {}) });
    }
    // several tokens with the same name: number them, as Tabletop does (Goblin 1, Goblin 2…)
    const count = {}; tokens.forEach((t) => { count[t.label] = (count[t.label] || 0) + 1; });
    const seen = {}; tokens.forEach((t) => { if (count[t.label] > 1 && !/\d$/.test(t.label)) t.label = `${t.label.slice(0, 20)} ${seen[t.label] = (seen[t.label] || 0) + 1}`; });
    const labels = z.labels.map((l) => ({ text: l.text, x: (l.x - L.originX) / L.S, y: (l.y - L.originY) / L.S }));
    // fog: squares whose middle MapTool had revealed
    let fog = { on: false };
    if (z.hasFog) {
      const a = new Uint8Array(cols * rows);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const px = L.originX + (x + 0.5) * L.S, py = L.originY + (y + 0.5) * L.S;
        if (z.exposed.some((segs) => inMapToolArea(segs, px, py))) a[y * cols + x] = 1;
      }
      let bin = ''; for (let i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
      fog = { on: true, data: btoa(bin) };
    }
    // vision blocking and walls → wall lines; lights on stamps and hidden tokens → lights on the map
    const sq = (v, o) => Math.round(((v - o) / L.S) * 1000) / 1000;
    const walls = z.blockSegs.slice(0, 20000).map(([a, b, c, d]) => [sq(a, L.originX), sq(b, L.originY), sq(c, L.originX), sq(d, L.originY)]);
    const lights = L.placed.filter((t) => t.lights.length && t.layer !== 'TOKEN').map((t) => { const l = lightOf(t); return [sq(t.px + t.pw / 2, L.originX), sq(t.py + t.ph / 2, L.originY), (l[1] / 5), '#ffd27f']; });
    const vision = z.visionType !== 'OFF' ? { on: true, ambient: z.visionType === 'NIGHT' ? 'dark' : 'bright' } : undefined;
    if (walls.length || fog.on || vision) notes.push(`${z.name}: ${[walls.length ? `${walls.length} wall lines` : '', fog.on ? 'fog' : '', vision ? `vision (${vision.ambient === 'dark' ? 'night' : 'day'})` : '', lights.length ? `${lights.length} lights` : ''].filter(Boolean).join(', ')}`);
    pendingNewScene = true;
    sendMsg({ type: 'sceneCreate', name: z.name.slice(0, 40), cols, rows, content: { bg, tokens, labels, walls, lights, fog, vision } });
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
  const content = { tiles: out.tiles, props: out.props, tokens, fog: { on: fog, reveal: out.start ? [out.start] : [] }, wallStyle: out.wallStyle || 'built' };
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
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
function addChat(e, fresh) {
  const div = document.createElement('div');
  div.className = 'entry chat' + (e.to ? ' whisper' : '') + (e.as ? ' npc' : '') + (e.narrate ? ' narrate' : '') + (fresh ? ' fresh' : '');
  const head = document.createElement('div'), b = document.createElement('b');
  b.textContent = e.as || e.who; head.appendChild(b);
  const to = document.createElement('span'); to.className = 'to';
  if (e.narrate) to.textContent = ' reads aloud';
  else if (e.to) to.textContent = ' → ' + e.to.join(', ') + ' (whisper)';
  else if (e.as && me.isDM) to.textContent = ' (you, as an NPC)';
  head.appendChild(to);
  const say = document.createElement('div'); say.className = 'say'; say.textContent = e.text;
  div.append(head, say);
  $('log').prepend(div);
  while ($('log').children.length > 200) $('log').lastChild.remove();
  noteSpeaker(e);
}
function addLog(e, fresh) {
  if (e.kind === 'chat') return addChat(e, fresh);
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
  sendMsg({ type: 'roll', expr: x, label, private: $('private').checked, show: $('private').checked }); // the box means "private" for players, "show" for the DM
}
// ---------- sounds from the map, and what happens on it ----------
// where this screen listens from: a player hears from their character, the DM from the middle of their view
function listener(s) {
  if (!me.isDM) {
    const mine = Object.values(s.tokens).filter((t) => t.owner && sameName(t.owner, me.name));
    const t = mine.find((x) => x.id === selected) || mine[0];
    if (t) return [t.x + t.size / 2, t.y + t.size / 2];
  }
  const r = canvas.getBoundingClientRect();
  return [(r.width / 2 - view.x) / view.zoom / CELL, (r.height / 2 - view.y) / view.zoom / CELL];
}
function hear(s, x, y, range = 18, floor = 0.12) {
  const [lx, ly] = listener(s), d = Math.hypot(x - lx, y - ly);
  return { vol: Math.max(floor, Math.pow(Math.max(0, 1 - d / range), 1.2)), pan: Math.max(-0.8, Math.min(0.8, (x - lx) / 10)), d };
}
const STEP = { stone: 'stone', cobble: 'stone', marble: 'stone', wall: 'stone', lava: 'stone', wood: 'wood', grass: 'grass', snow: 'dirt', dirt: 'dirt', path: 'dirt', sand: 'dirt', farm: 'dirt', pit: 'dirt', water: 'water' };
function reactTo(s, a, b) {
  // hurt or healed
  const hpA = a.hp != null ? a.hp : a.hpPct, hpB = b.hp != null ? b.hp : b.hpPct;
  if (hpA != null && hpB != null && hpA !== hpB && !b.hidden) {
    const amount = a.hp != null && b.hp != null ? Math.abs(b.hp - a.hp) : null, at = hear(s, b.x + b.size / 2, b.y + b.size / 2, 22, 0.25);
    if (hpB < hpA) { efx.hit(b.id, amount); snd.effect('hit-' + (1 + Math.floor(Math.random() * 3)), { vol: at.vol * 0.9, pan: at.pan, rate: 0.92 + Math.random() * 0.16 }); }
    else { efx.heal(b.id, amount); snd.effect('heal', { vol: at.vol * 0.7, pan: at.pan }); }
  }
  // footsteps along the way
  const n = Math.round(Math.hypot(b.x - a.x, b.y - a.y));
  if (n && n <= 12 && !b.hidden && (!drag || drag.id !== b.id)) {
    const k = Math.min(n * 2, 8);
    for (let i = 1; i <= k; i++) {
      const x = a.x + (b.x - a.x) * (i / k) + b.size / 2, y = a.y + (b.y - a.y) * (i / k) + b.size / 2, at = hear(s, x, y, 16, 0);
      if (at.vol < 0.04) continue;
      const kind = STEP[s.tiles[Math.floor(x) + ',' + Math.floor(y)]] || 'stone';
      snd.effect(`step-${kind}-${1 + Math.floor(Math.random() * 3)}`, { vol: at.vol * 0.8, pan: at.pan, rate: (b.size > 1 ? 0.82 : 1) * (0.94 + Math.random() * 0.12), delay: (i - 1) * 0.27 });
    }
  }
}
// torches, fires, water and lava near the listener, every half second
const LOOPS = { torch: { name: 'loop-torch', range: 5, vol: 0.35 }, brazier: { name: 'loop-torch', range: 7, vol: 0.5, rate: 0.85 }, campfire: { url: '/audio/campfire.mp3', range: 8, vol: 0.45 }, fireplace: { url: '/audio/campfire.mp3', range: 7, vol: 0.4 } };
function mapSounds() {
  const s = sc();
  if (!s || prefs.mute || prefs.map === 0 || !snd.running() || document.hidden) { snd.setSpatial([]); return; }
  const [lx, ly] = listener(s), list = [];
  for (const p of Object.values(s.props)) {
    const L = LOOPS[p.kind]; if (!L || p.off) continue;
    const d = Math.hypot(p.x + 0.5 - lx, p.y + 0.5 - ly); if (d > L.range) continue;
    list.push({ key: 'p:' + p.id, name: L.name, url: L.url, rate: L.rate, d, vol: L.vol * Math.pow(1 - d / L.range, 1.5), pan: Math.max(-0.8, Math.min(0.8, (p.x + 0.5 - lx) / 8)) });
  }
  list.sort((a, b) => a.d - b.d); list.length = Math.min(list.length, 6);
  for (const [tile, L] of [['water', { url: '/audio/river.mp3', range: 8, vol: 0.3 }], ['lava', { name: 'loop-lava', range: 8, vol: 0.45 }]]) {
    let best = null;
    for (let y = Math.floor(ly - L.range); y <= ly + L.range; y++) for (let x = Math.floor(lx - L.range); x <= lx + L.range; x++) if (s.tiles[x + ',' + y] === tile) { const d = Math.hypot(x + 0.5 - lx, y + 0.5 - ly); if (!best || d < best.d) best = { d, x: x + 0.5 }; }
    if (best && best.d <= L.range) list.push({ key: tile, name: L.name, url: L.url, vol: L.vol * Math.pow(1 - best.d / L.range, 1.3), pan: Math.max(-0.7, Math.min(0.7, (best.x - lx) / 8)) });
  }
  snd.setSpatial(list);
}
setInterval(mapSounds, 500);
// ---------- the scene and the story ----------
// a player's screen fades to black and names the new place, then fades in on it
let titleTimer = 0;
function titleCard(name) {
  const el = $('titleCard'); clearTimeout(titleTimer);
  el.querySelector('.tc-name').textContent = name || '';
  el.hidden = false; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  snd.effect('transition', { vol: 0.8 }); efx.clear(); dice3d.clear();
  titleTimer = setTimeout(() => { el.classList.remove('show'); titleTimer = setTimeout(() => { el.hidden = true; }, 800); }, 2900);
}
let narrTimer = 0;
function narrate(text) {
  const el = $('narration'); clearTimeout(narrTimer);
  el.querySelector('.nr-text').textContent = text;
  el.classList.toggle('long', text.length > 140 || text.includes('\n')); // short lines sit in the middle
  el.hidden = false; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); el.scrollTop = 0;
  snd.effect('page', { vol: 0.8 });
  const words = text.split(/\s+/).length;
  narrTimer = setTimeout(closeNarration, Math.min(60000, 6000 + words * 380)); // long enough to read
}
function closeNarration() { const el = $('narration'); clearTimeout(narrTimer); el.classList.remove('show'); narrTimer = setTimeout(() => { el.hidden = true; }, 650); }
$('narration').onclick = closeNarration;
$('chatRead').onclick = () => { const text = $('chatText').value.trim(); if (!text) return toast('Type the text to read aloud first'); sendMsg({ type: 'chat', text, narrate: true }); $('chatText').value = ''; };
// ---------- dice on screen ----------
let mySkin = null, lastHit = 0;
const dice3d = createDice($('diceLayer'), { onHit: (v) => { const now = performance.now(); if (now - lastHit < 28) return; lastHit = now; snd.effect('dice-' + (1 + Math.floor(Math.random() * 4)), { vol: 0.2 + v * 0.8, rate: 0.9 + Math.random() * 0.25, pan: Math.random() * 0.6 - 0.3 }); } });
function showRoll(e) {
  if (!e.dice || !e.dice.length || prefs.dice === false || document.hidden) return;
  const mine = sameName(e.who, me.name);
  const note = !e.private ? '' : me.isDM && mine ? '🔒 only you' : mine ? '🔒 you and the DM' : '🔒 private';
  dice3d.roll(e, { note });
  if (e.crit) setTimeout(() => snd.effect(e.crit === 'nat20' ? 'nat20' : 'nat1', { vol: 0.8 }), 1350);
}
const skinLook = (sk, who) => (sk && sk.img ? { img: sk.img, ink: sk.ink || '#fff' } : (sk && skinById(sk.id)) || defaultSkin(who));
function renderMyDice() {
  const c = $('myDicePrev'); if (!c) return;
  if (!dice3d.preview(c, skinLook(mySkin, me.name))) setTimeout(renderMyDice, 300); // a picture still loading
}
function renderSkins() {
  if ($('skinModal').hidden) return;
  const grid = $('skinGrid'); grid.innerHTML = '';
  const cur = mySkin && mySkin.img ? 'img' : mySkin && mySkin.id ? mySkin.id : defaultSkin(me.name).id;
  const tiles = SKINS.map((k) => ({ key: k.id, name: k.name, look: k, pick: () => sendMsg({ type: 'diceSkin', skin: { id: k.id } }) }));
  if (mySkin && mySkin.img) tiles.unshift({ key: 'img', name: 'My picture', look: skinLook(mySkin), pick: () => {} });
  for (const t of tiles) {
    const d = document.createElement('div'); d.className = 'tile' + (t.key === cur ? ' on' : ''); d.title = t.name;
    const c = document.createElement('canvas'); c.width = c.height = 120; const sp = document.createElement('span'); sp.textContent = t.name;
    d.append(c, sp); d.onclick = t.pick; grid.append(d);
    const paint = () => { if (!dice3d.preview(c, t.look)) setTimeout(paint, 300); }; paint();
  }
  $('skinShow').checked = prefs.dice !== false;
  if (mySkin && mySkin.ink) $('skinInk').value = mySkin.ink;
}
$('openSkins').onclick = () => { $('skinModal').hidden = false; renderSkins(); };
$('myDicePrev').onclick = $('openSkins').onclick;
$('skinShow').onchange = () => { prefs.dice = $('skinShow').checked; savePrefs(); if (!prefs.dice) dice3d.clear(); };
$('skinImgBtn').onclick = () => $('skinImgIn').click();
$('skinInk').onchange = () => { if (mySkin && mySkin.img) sendSkinImage(null); };
let skinSrc = null;
function sendSkinImage(file) {
  const go = (img) => {
    const n = 256, c = document.createElement('canvas'); c.width = c.height = n; const s = Math.min(img.naturalWidth, img.naturalHeight);
    c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, n, n);
    sendMsg({ type: 'diceSkin', skin: { img: c.toDataURL('image/jpeg', 0.86), ink: $('skinInk').value } });
  };
  if (file) { const url = URL.createObjectURL(file), img = new Image(); img.onload = () => { skinSrc = img; go(img); URL.revokeObjectURL(url); }; img.onerror = () => toast('That picture could not be read'); img.src = url; }
  else if (skinSrc) go(skinSrc);
  else if (mySkin && mySkin.img) { const img = new Image(); img.onload = () => { skinSrc = img; go(img); }; img.src = mySkin.img; }
}
$('skinImgIn').onchange = () => { const f = $('skinImgIn').files[0]; $('skinImgIn').value = ''; if (f) sendSkinImage(f); };
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

// ---------- sound: music and ambience ----------
// The DM picks what plays; everyone's screen plays it (see audio.js). Each person sets their own volume.
let audioLib = [], soundNow = { music: null, amb: [] }, builtinSounds = [], sdKind = 'music', sdRename = null, sdDelete = null;
const prefs = { master: 1, music: 1, amb: 1, sfx: 1, map: 0.6, mute: false, wx: true, dice: true };
try { Object.assign(prefs, JSON.parse(tryGet('tt-sound') || '{}')); } catch { /* defaults */ }
const snd = createSound({ onState: (st) => { $('soundBlocked').hidden = !st.blocked; $('soundBtn').classList.toggle('playing', st.playing); } });
snd.setLevels(prefs);
fetch('/audio/catalog.json').then((r) => r.json()).then((c) => { builtinSounds = c.sounds || []; renderSound(); }).catch(() => {});
const allSounds = () => [...builtinSounds.map((x) => ({ ...x, builtin: true })), ...audioLib];
const soundName = (id) => (allSounds().find((x) => x.id === id) || {}).name || 'Unknown sound';
const savePrefs = () => { trySet('tt-sound', JSON.stringify(prefs)); snd.setLevels(prefs); renderSound(); };
const cleanNow = (n) => ({ music: n.music ? { id: n.music.id, vol: n.music.vol } : null, amb: (n.amb || []).map((a) => ({ id: a.id, vol: a.vol })) });
function sendSound(next) { sendMsg({ type: 'sound', ...cleanNow(next) }); }
function toggleSound(item) {
  const n = cleanNow(soundNow);
  if (item.kind === 'music') n.music = n.music && n.music.id === item.id ? null : { id: item.id, vol: n.music ? n.music.vol : 0.7 };
  else if (n.amb.some((a) => a.id === item.id)) n.amb = n.amb.filter((a) => a.id !== item.id);
  else { if (n.amb.length >= 5) return toast('Five ambiences are playing already: stop one first'); n.amb.push({ id: item.id, vol: 0.7 }); }
  sendSound(n);
}
let volTimer = 0;
function setLayerVol(which, id, vol) { // while dragging, send a few times a second
  const n = cleanNow(soundNow);
  if (which === 'music' && n.music) n.music.vol = vol; else { const a = n.amb.find((x) => x.id === id); if (a) a.vol = vol; }
  soundNow = { ...soundNow, music: soundNow.music && which === 'music' ? { ...soundNow.music, vol } : soundNow.music, amb: soundNow.amb.map((a) => (a.id === id && which === 'amb' ? { ...a, vol } : a)) };
  clearTimeout(volTimer); volTimer = setTimeout(() => sendSound(n), 120);
}
const describeSound = (x) => (x && (x.music || (x.amb && x.amb.length)) ? [x.music ? '♫ ' + soundName(x.music.id) : null, ...(x.amb || []).map((a) => soundName(a.id))].filter(Boolean).join(' + ') : '');
function renderSound() {
  $('soundBtn').textContent = prefs.mute ? '🔇' : '🔊';
  $('soundBtn').classList.toggle('playing', !!(soundNow.music || soundNow.amb.length));
  $('soundBtn').classList.toggle('open', !$('soundPop').hidden);
  for (const [id, k] of [['vMaster', 'master'], ['vMusic', 'music'], ['vAmb', 'amb'], ['vSfx', 'sfx'], ['vMap', 'map']]) { $(id).value = Math.round(prefs[k] * 100); $(id + 'N').textContent = Math.round(prefs[k] * 100); }
  $('vMute').checked = !!prefs.mute; $('vWx').checked = prefs.wx !== false; $('vFx').value = fxMode();
  if ($('soundPop').hidden) return;
  // playing now
  const now = $('sdNow'); now.innerHTML = '';
  const layer = (which, x) => {
    const r = document.createElement('div'); r.className = 'snow';
    const ic = document.createElement('span'); ic.textContent = which === 'music' ? '♫' : '〰'; ic.style.color = 'var(--accent2)';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = x.name || soundName(x.id); nm.title = nm.textContent;
    r.append(ic, nm);
    if (me.isDM) {
      const v = document.createElement('input'); v.type = 'range'; v.min = 0; v.max = 100; v.value = Math.round(x.vol * 100); v.title = 'Volume for everyone';
      v.oninput = () => setLayerVol(which, x.id, v.value / 100);
      const st = document.createElement('button'); st.textContent = '✕'; st.title = 'Stop (fades out)';
      st.onclick = () => { const n = cleanNow(soundNow); if (which === 'music') n.music = null; else n.amb = n.amb.filter((a) => a.id !== x.id); sendSound(n); };
      r.append(v, st);
    } else r.style.gridTemplateColumns = '18px 1fr';
    now.append(r);
  };
  if (soundNow.music) layer('music', soundNow.music);
  soundNow.amb.forEach((a) => layer('amb', a));
  if (!soundNow.music && !soundNow.amb.length) { const h = document.createElement('div'); h.className = 'hint'; h.style.marginTop = '2px'; h.textContent = me.isDM ? 'Nothing. Pick music or an ambience below.' : 'Nothing at the moment.'; now.append(h); }
  if (!me.isDM) return;
  $('sdStopAll').disabled = !(soundNow.music || soundNow.amb.length);
  document.querySelectorAll('#sdTabs button').forEach((b) => b.classList.toggle('on', b.dataset.sdk === sdKind));
  // the library
  const q = $('sdSearch').value.trim().toLowerCase(), list = $('sdList'); list.innerHTML = '';
  const items = allSounds().filter((x) => x.kind === sdKind && (!q || (x.name + ' ' + (x.tags || '')).toLowerCase().includes(q)));
  for (const x of items) {
    const r = document.createElement('div'); r.className = 'srow';
    const on = sdKind === 'music' ? soundNow.music && soundNow.music.id === x.id : soundNow.amb.some((a) => a.id === x.id);
    const play = document.createElement('button'); play.textContent = on ? '■' : '▶'; play.classList.toggle('on', !!on);
    play.title = on ? 'Stop it for everyone' : sdKind === 'music' ? 'Play for everyone (fades from what\'s playing)' : 'Add this layer for everyone';
    play.onclick = () => toggleSound(x);
    const pv = document.createElement('button'); pv.className = 'pv'; pv.textContent = '🎧'; pv.title = 'Listen on your own screen only';
    pv.classList.toggle('on', snd.previewing() === x.url);
    pv.onclick = () => { snd.preview(snd.previewing() === x.url ? null : x.url); setTimeout(renderSound, 0); };
    const nm = document.createElement('span'); nm.className = 'nm'; nm.title = x.name;
    if (sdRename === x.id) {
      const inp = document.createElement('input'); inp.value = x.name; inp.maxLength = 60; inp.style.padding = '2px 6px';
      const done = (save) => { sdRename = null; if (save && inp.value.trim() && inp.value.trim() !== x.name) sendMsg({ type: 'audioUpdate', id: x.id, name: inp.value.trim() }); renderSound(); };
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
      inp.onblur = () => done(true);
      nm.append(inp); setTimeout(() => { inp.focus(); inp.select(); }, 0);
    } else { nm.textContent = x.name; if (!x.builtin) { const sm = document.createElement('small'); sm.textContent = 'yours'; nm.append(sm); } }
    r.append(play, pv, nm);
    if (!x.builtin) {
      const mv = document.createElement('button'); mv.textContent = sdKind === 'music' ? '→〰' : '→♫'; mv.title = sdKind === 'music' ? 'Move to ambiences' : 'Move to music';
      mv.onclick = () => sendMsg({ type: 'audioUpdate', id: x.id, kind: sdKind === 'music' ? 'ambience' : 'music' });
      const ed = document.createElement('button'); ed.textContent = '✎'; ed.title = 'Rename'; ed.onclick = () => { sdRename = x.id; renderSound(); };
      const del = document.createElement('button'); del.className = 'danger';
      del.textContent = sdDelete === x.id ? 'Delete?' : '🗑'; del.title = 'Remove it from your sounds';
      del.onclick = () => { if (sdDelete !== x.id) { sdDelete = x.id; renderSound(); setTimeout(() => { if (sdDelete === x.id) { sdDelete = null; renderSound(); } }, 3000); return; } sdDelete = null; sendMsg({ type: 'audioRemove', id: x.id }); };
      r.append(mv, ed, del);
    }
    list.append(r);
  }
  if (!items.length) { const h = document.createElement('div'); h.className = 'hint'; h.style.padding = '8px'; h.textContent = q ? 'No sounds match.' : 'None yet.'; list.append(h); }
  // this map's sound
  const s = sc(), a = (s && s.atmo) || {};
  $('sdMapName').textContent = s ? '· ' + s.name : '';
  $('sdMapInfo').textContent = a.sound ? describeSound(a.sound) : 'None saved. Start what should play here, then Save.';
  $('sdSaveMap').disabled = !(soundNow.music || soundNow.amb.length);
  $('sdPlayMap').disabled = $('sdClearMap').disabled = !a.sound;
  $('sdAuto').checked = !!a.auto; $('sdAuto').disabled = !a.sound;
}
$('soundBtn').onclick = () => { $('soundPop').hidden = !$('soundPop').hidden; $('tablePop').hidden = $('mePop').hidden = true; if ($('soundPop').hidden) { snd.preview(null); sdRename = null; } renderSound(); };
$('sdClose').onclick = () => { $('soundPop').hidden = true; snd.preview(null); renderSound(); };
document.querySelectorAll('#sdTabs button').forEach((b) => b.onclick = () => { sdKind = b.dataset.sdk; renderSound(); });
$('sdSearch').oninput = renderSound;
$('sdSearch').onkeydown = (e) => e.stopPropagation();
$('sdStopAll').onclick = () => sendSound({ music: null, amb: [] });
$('sdAdd').onclick = () => $('sdFiles').click();
const AUDIO_TYPES = { mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac', webm: 'audio/webm' };
$('sdFiles').onchange = async () => {
  const files = [...$('sdFiles').files]; $('sdFiles').value = '';
  for (const f of files) {
    const ext = (f.name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase(), type = AUDIO_TYPES[ext] || (f.type.startsWith('audio/') ? f.type : '');
    if (!type) { toast(`${f.name}: not a sound file Tabletop can play`); continue; }
    toast(`Adding ${f.name}…`, 20000);
    try {
      const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': type, 'X-DM-Key': dmKey }, body: f });
      if (!res.ok) throw new Error(await res.text());
      const { url } = await res.json();
      sendMsg({ type: 'audioAdd', url, kind: sdKind, name: f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim().slice(0, 60) });
      toast(`Added ${f.name} to ${sdKind === 'music' ? 'music' : 'ambiences'}`);
    } catch (e) { toast(`${f.name}: ${e.message}`, 5000); }
  }
};
const atmoOf = (s) => ({ weather: 'none', level: 2, time: 'day', sound: null, auto: false, ...((s && s.atmo) || {}) });
function setAtmo(patch) { const s = sc(); if (!s) return; s.atmo = { ...atmoOf(s), ...patch }; updateScene({ atmo: patch }); renderWxPop(); renderSound(); draw(); }
$('sdSaveMap').onclick = () => { setAtmo({ sound: cleanNow(soundNow) }); toast('Saved as this map\'s sound'); };
$('sdPlayMap').onclick = () => { const a = atmoOf(sc()); if (a.sound) sendSound(a.sound); };
$('sdClearMap').onclick = () => setAtmo({ sound: null, auto: false });
$('sdAuto').onchange = () => setAtmo({ auto: $('sdAuto').checked });
for (const [id, k] of [['vMaster', 'master'], ['vMusic', 'music'], ['vAmb', 'amb'], ['vSfx', 'sfx'], ['vMap', 'map']]) $(id).oninput = () => { prefs[k] = $(id).value / 100; savePrefs(); };
$('vMute').onchange = () => { prefs.mute = $('vMute').checked; savePrefs(); };
$('vWx').onchange = () => { prefs.wx = $('vWx').checked; savePrefs(); draw(); };
$('vFx').onchange = () => { prefs.fx = $('vFx').value; savePrefs(); draw(); };
$('soundBlocked').onclick = () => snd.resume();
// browsers keep sound off until the first click or key press on the page
addEventListener('pointerdown', () => { if (!snd.running()) snd.resume(); }, true); // effects and map sounds need the sound running too
addEventListener('keydown', () => { if (!snd.running()) snd.resume(); }, true);

// ---------- weather and time of day ----------
const weather = createWeather($('wx'), () => {
  const s = sc(); if (!s || !s.atmo || !s.atmo.weather || s.atmo.weather === 'none' || prefs.wx === false || mode === 'build') return null;
  return { weather: s.atmo.weather, level: s.atmo.level || 2, rect: { x: view.x, y: view.y, w: s.cols * CELL * view.zoom, h: s.rows * CELL * view.zoom } };
});
function renderWxPop() {
  const a = atmoOf(sc());
  $('wxBtn').classList.toggle('on', a.weather !== 'none' || a.time !== 'day');
  if ($('wxPop').hidden) return;
  document.querySelectorAll('#wxKinds button').forEach((b) => b.classList.toggle('on', b.dataset.wx === a.weather));
  document.querySelectorAll('#wxLevels button').forEach((b) => { b.classList.toggle('on', +b.dataset.lv === a.level); b.disabled = a.weather === 'none'; });
  document.querySelectorAll('#wxTimes button').forEach((b) => b.classList.toggle('on', b.dataset.tm === a.time));
  const m = MATCH[a.weather] || MATCH[a.time];
  $('wxSound').disabled = !m || soundNow.amb.some((x) => x.id === m);
  $('wxSound').textContent = m ? `▶ Play matching sound: ${soundName(m)}` : '▶ Play matching sound';
}
$('wxBtn').onclick = () => { $('wxPop').hidden = !$('wxPop').hidden; $('visionPop').hidden = true; renderWxPop(); };
$('wxClose').onclick = () => { $('wxPop').hidden = true; };
document.querySelectorAll('#wxKinds button').forEach((b) => b.onclick = () => setAtmo({ weather: b.dataset.wx }));
document.querySelectorAll('#wxLevels button').forEach((b) => b.onclick = () => setAtmo({ level: +b.dataset.lv }));
document.querySelectorAll('#wxTimes button').forEach((b) => b.onclick = () => setAtmo({ time: b.dataset.tm }));
$('wxSound').onclick = () => {
  const a = atmoOf(sc()), m = MATCH[a.weather] || MATCH[a.time]; if (!m) return;
  const n = cleanNow(soundNow); if (n.amb.some((x) => x.id === m)) return;
  if (n.amb.length >= 5) return toast('Five ambiences are playing already: stop one first');
  n.amb.push({ id: m, vol: 0.7 }); sendSound(n);
};

// ---------- start ----------
function tryGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function trySet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
function start(name) {
  me.name = name; $('join').remove();
  // the player app passes the passcode after #; a browser remembers the last one that worked here
  const h = new URLSearchParams(location.hash.slice(1));
  passcode = h.get('code') || (dmKey ? '' : tryGet('tt-code') || '');
  if (h.get('code') != null) history.replaceState(null, '', location.pathname + location.search);
  connect();
}

setTerrain('stone'); setPropKind('door'); setTool('select'); updateUndo(); resize();
window.tabletop = { view, sound: snd, diceBusy: () => dice3d.busy(), chunksPending: () => chunkWant.length + chunkJobs.size + (chunkTimer ? 1 : 0), chunkInfo: () => ({ built: chunks.size, workers: (chunkWorkers || []).length, fx: fxMode() }), renderTime: () => { mapRev++; const t0 = performance.now(); render(); return performance.now() - t0; }, frameTime: () => { const t0 = performance.now(); render(); return performance.now() - t0; }, scene: () => sc(), cellToScreen: (x, y) => { const r = canvas.getBoundingClientRect(); return [r.left + view.x + (x + 0.5) * CELL * view.zoom, r.top + view.y + (y + 0.5) * CELL * view.zoom]; } };
const preset = params.get('name') || (dmKey ? 'DM' : '');
if (preset) start(preset);
else {
  $('name').value = tryGet('vtt-name') || '';
  $('joinForm').onsubmit = (e) => { e.preventDefault(); const n = $('name').value.trim(); if (!n) return; trySet('vtt-name', n); start(n); };
}
