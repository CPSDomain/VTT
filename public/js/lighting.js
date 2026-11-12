// The map's look: darkness and light, and the things that move. Purely visual: what characters can see is
// decided by vision.js on the server and is never changed by anything here. Light ranges follow the game's
// lights (a torch is bright to 20 ft, dim to 40 ft), so what looks lit is what counts as lit.
//   - a light map: the map's darkness (light setting × time of day), each light added with shadows from
//     walls, closed doors and imported walls, plus pillars, statues, trees and tents (shadows for looks only)
//   - flickering flames, sparks and smoke; ripples on water; glowing lava; dust in torchlight; fireflies at night
//   - soft shading where floors meet walls, and token shadows and tinting by the light they stand in
// Mode 'full' moves; 'still' keeps the light and shadows without motion; 'off' is the classic look (app.js).
const TAU = Math.PI * 2;
const hash = (i) => { let x = Math.imul(i ^ 0x2c1b3c6d, 0x297a2d39); x ^= x >>> 15; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; return (x >>> 0) / 4294967296; };
const vn = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };
const nz = (x, seed) => vn(x + seed * 97.13) * 2 - 1;
const rand = (a, b) => a + Math.random() * (b - a);

// how the map's light setting and the time of day darken it (multiplied in; 255 = untouched)
const AMB_LIGHT = { bright: [255, 255, 255], dim: [150, 148, 165], dark: [34, 35, 48] };
const AMB_TIME = { day: [255, 255, 255], dawn: [222, 190, 182], dusk: [196, 150, 140], night: [58, 68, 108] };
// how each kind of light looks: colour, strength, flicker (0 steady … 1 a torch), flame size and where the flame sits
const KINDS = {
  torch: { col: [255, 164, 86], I: 0.85, flick: 1, flame: 9, at: [0, 0], sparks: 0.6 },
  brazier: { col: [255, 150, 70], I: 0.92, flick: 1, flame: 15, at: [0, 0], sparks: 1.2, smoke: 1 },
  campfire: { col: [255, 156, 76], I: 1, flick: 1, flame: 21, at: [0, 0], sparks: 2, smoke: 1.4 },
  fireplace: { col: [255, 150, 70], I: 0.88, flick: 0.9, flame: 12, at: [0, -8], sparks: 0.6 },
  candle: { col: [255, 196, 130], I: 0.6, flick: 0.7, flame: 0, candles: [[0, -6], [-6, 4], [6, 4]] },
  lamppost: { col: [255, 222, 175], I: 1, flick: 0.12, bulb: 5 },
  cauldron: { col: [130, 255, 120], I: 0.45, flick: 0.3, bulb: 7 },
  crystal: { col: [140, 190, 255], I: 0.5, flick: 0.15, bulb: 6 },
  // lights carried by tokens, told apart by their range
  'token:5,10': { col: [255, 196, 130], I: 0.6, flick: 0.7 },
  'token:20,40': { col: [255, 170, 95], I: 0.8, flick: 0.75 },
  'token:15,45': { col: [255, 205, 140], I: 0.78, flick: 0.3 },
  'token:30,60': { col: [255, 214, 160], I: 0.78, flick: 0.15 },
  'token:60,120': { col: [255, 246, 228], I: 1, flick: 0 },
  token: { col: [255, 200, 140], I: 0.8, flick: 0.4 },
  imported: { col: [255, 210, 127], I: 0.82, flick: 0.45 }
};
// things that throw shadows for looks only (they never block sight): radius in squares
const SHADE = { pillar: 0.3, brokenpillar: 0.24, statue: 0.28, tree: 0.32, pine: 0.3, deadtree: 0.16, tent: 0.42, cart: 0.34, wardrobe: 0.3, bookshelf: 0.26 };
const BLOOM_KINDS = new Set(['lamppost', 'cauldron', 'crystal']);

function hexRgb(h, d) { const m = /^#([0-9a-f]{6})$/i.exec(h || ''); if (!m) return d; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }

// the outline a light reaches before something blocks it (walls etc. as line segments, in pixels)
function reach(lx, ly, R, all) {
  const box = [[lx - R, ly - R, lx + R, ly - R], [lx + R, ly - R, lx + R, ly + R], [lx + R, ly + R, lx - R, ly + R], [lx - R, ly + R, lx - R, ly - R]];
  const S = [];
  for (const s of all) if (Math.max(s[0], s[2]) > lx - R && Math.min(s[0], s[2]) < lx + R && Math.max(s[1], s[3]) > ly - R && Math.min(s[1], s[3]) < ly + R) S.push(s);
  if (S.length > 1500) S.length = 1500; // a pathological map: settle for an approximation
  S.push(...box);
  const angs = [];
  for (const s of S) for (let e = 0; e < 4; e += 2) { const a = Math.atan2(s[e + 1] - ly, s[e] - lx); angs.push(a - 1e-4, a, a + 1e-4); }
  const pts = [];
  for (const a of angs) {
    const dx = Math.cos(a), dy = Math.sin(a); let best = Infinity;
    for (const s of S) {
      const sx = s[2] - s[0], sy = s[3] - s[1], den = dx * sy - dy * sx;
      if (den > -1e-9 && den < 1e-9) continue;
      const t = ((s[0] - lx) * sy - (s[1] - ly) * sx) / den;
      if (t <= 0 || t >= best) continue;
      const u = ((s[0] - lx) * dy - (s[1] - ly) * dx) / den;
      if (u >= 0 && u <= 1) best = t;
    }
    if (best < Infinity) pts.push([a, lx + dx * best, ly + dy * best]);
  }
  pts.sort((p, q) => p[0] - q[0]);
  const path = new Path2D(); pts.forEach((p, i) => (i ? path.lineTo(p[1], p[2]) : path.moveTo(p[1], p[2]))); path.closePath();
  return { path, pts };
}
function inside(pts, x, y) { // point in polygon
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[2] > y) !== (b[2] > y) && x < ((b[1] - a[1]) * (y - a[2])) / (b[2] - a[2]) + a[1]) c = !c;
  }
  return c;
}
function caustics(size, warm) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'), im = g.createImageData(size, size), k = TAU / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = Math.sin(x * k * 3 + Math.sin(y * k * 2) * 2.2) + Math.sin(y * k * 4 + Math.sin(x * k * 3) * 1.8) + 0.6 * Math.sin((x + y) * k * 5 + Math.sin(x * k) * 3);
    const b = Math.pow(Math.max(0, 1 - Math.abs(v) / 0.9), warm ? 3 : 5), i = (y * size + x) * 4;
    if (warm) { im.data[i] = 255; im.data[i + 1] = 120 + 110 * b; im.data[i + 2] = 30; } else { im.data[i] = 205; im.data[i + 1] = 232; im.data[i + 2] = 255; }
    im.data[i + 3] = 255 * b;
  }
  g.putImageData(im, 0, 0); return c;
}

export function createLighting({ CELL, VIS }) {
  const H = CELL / 2;
  let geoKey = '', segs = [], wallCells = null, shadeCells = null, lights = [], polyCache = new Map(), aoKey = '', ao = null, lavaKey = '', lavaMask = null;
  let lc = null, soft = null, add = null, seenMask = null, sprites = new Map(), spritePixels = 0, lightKey = '', parts = [], partScene = null, causW = null, causL = null, seenKey = null, lastT = 0;

  // everything that stops light: wall squares, closed doors, imported walls and doors, and the shadow-casting props
  function geometry(s) {
    const solid = (x, y) => s.tiles[x + ',' + y] === 'wall';
    const out = [];
    for (const k in s.tiles) {
      if (s.tiles[k] !== 'wall') continue;
      const c = k.indexOf(','), x = +k.slice(0, c), y = +k.slice(c + 1), X = x * CELL, Y = y * CELL;
      if (!solid(x, y - 1)) out.push([X, Y, X + CELL, Y]);
      if (!solid(x, y + 1)) out.push([X, Y + CELL, X + CELL, Y + CELL]);
      if (!solid(x - 1, y)) out.push([X, Y, X, Y + CELL]);
      if (!solid(x + 1, y)) out.push([X + CELL, Y, X + CELL, Y + CELL]);
    }
    for (const id in s.props) {
      const p = s.props[id], X = p.x * CELL, Y = p.y * CELL;
      if (VIS.SOLID_DOORS[p.kind] && !p.open) out.push([X, Y, X + CELL, Y], [X + CELL, Y, X + CELL, Y + CELL], [X + CELL, Y + CELL, X, Y + CELL], [X, Y + CELL, X, Y]);
      const r = SHADE[p.kind];
      if (r) { const cx = X + H, cy = Y + H, k = r * CELL; for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, b = ((i + 1) / 8) * TAU; out.push([cx + Math.cos(a) * k, cy + Math.sin(a) * k, cx + Math.cos(b) * k, cy + Math.sin(b) * k]); } }
    }
    for (const w of s.walls || []) out.push([w[0] * CELL, w[1] * CELL, w[2] * CELL, w[3] * CELL]);
    for (const d of s.doors || []) if (!d[4]) out.push([d[0] * CELL, d[1] * CELL, d[2] * CELL, d[3] * CELL]);
    return out;
  }
  function geometryKey(s) {
    let n = 0, h = 0;
    for (const k in s.tiles) if (s.tiles[k] === 'wall') { n++; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0; }
    for (const id in s.props) { const p = s.props[id]; if (SHADE[p.kind] || VIS.SOLID_DOORS[p.kind]) h = (h * 31 + p.x * 977 + p.y * 7 + (p.open ? 1 : 0) + p.kind.length) | 0; }
    for (const d of s.doors || []) h = (h * 31 + (d[4] ? 1 : 2)) | 0;
    return s.id + ':' + n + ':' + h + ':' + (s.walls || []).length + ':' + s.cols + 'x' + s.rows;
  }

  function ambientOf(s) {
    const a = AMB_LIGHT[(s.vision && s.vision.ambient) || 'bright'] || AMB_LIGHT.bright, b = AMB_TIME[(s.atmo && s.atmo.time) || 'day'] || AMB_TIME.day;
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
  }
  const isDay = (amb) => amb[0] >= 255 && amb[1] >= 255 && amb[2] >= 255;

  // the map's lights, with what each reaches; rebuilt when walls, doors or lights change
  function prepare(s, rev) {
    const gk = geometryKey(s);
    if (gk !== geoKey) { geoKey = gk; segs = geometry(s); polyCache = new Map(); wallCells = null; shadeCells = null; sprites = new Map(); spritePixels = 0; }
    lights = [];
    for (const id in s.props) {
      const p = s.props[id], L = VIS.PROP_LIGHT[p.kind];
      if (!L || p.off) continue;
      const k = KINDS[p.kind] || KINDS.torch, rot = (p.rot || 0) * Math.PI / 2, at = k.at || [0, 0];
      const fx = (p.x + 0.5) * CELL + at[0] * Math.cos(rot) - at[1] * Math.sin(rot), fy = (p.y + 0.5) * CELL + at[0] * Math.sin(rot) + at[1] * Math.cos(rot);
      lights.push({ x: (p.x + 0.5) * CELL, y: (p.y + 0.5) * CELL, fx, fy, rot, bright: L[0] / VIS.SQ, dim: L[1] / VIS.SQ, k, kind: p.kind, seed: (p.x * 13.1 + p.y * 7.7) % 97 });
    }
    for (const id in s.tokens) {
      const t = s.tokens[id]; if (!t.light || !(t.light[1] > 0)) continue;
      const k = KINDS['token:' + t.light[0] + ',' + t.light[1]] || KINDS.token;
      lights.push({ x: (t.x + t.size / 2) * CELL, y: (t.y + t.size / 2) * CELL, bright: t.light[0] / VIS.SQ, dim: t.light[1] / VIS.SQ, k, kind: 'token', seed: id.length * 3.1 + (id.charCodeAt(0) || 0) % 50 });
    }
    for (const l of s.lights || []) if (l[2] > 0) lights.push({ x: l[0] * CELL, y: l[1] * CELL, bright: l[2] / 2, dim: l[2], k: { ...KINDS.imported, col: hexRgb(l[3], KINDS.imported.col) }, kind: 'imported', seed: (l[0] * 3 + l[1] * 5) % 89 });
    for (const L of lights) {
      L.R = Math.min(L.dim, 48) * CELL;
      const key = (L.x | 0) + ',' + (L.y | 0) + ',' + (L.R | 0);
      let v = polyCache.get(key);
      if (!v) { v = reach(L.x, L.y, L.R * 1.02, segs); v.key = geoKey + '@' + key; polyCache.set(key, v); if (polyCache.size > 600) polyCache.delete(polyCache.keys().next().value); }
      L.poly = v;
    }
    if (partScene !== s.id) { parts = []; partScene = s.id; }
    return lights;
  }

  // flicker: strength, a slightly changing reach, and a small wobble of the flame
  function flick(L, t, moving) {
    const f = moving ? L.k.flick : 0, s = L.seed;
    if (!f) return { I: L.k.I, R: 1, jx: 0, jy: 0 };
    const I = L.k.I * (0.9 + f * (0.08 * nz(t * 7.5, s) + 0.045 * nz(t * 19, s + 3)) - f * 0.07 * Math.max(0, nz(t * 1.3, s + 7)) ** 3);
    return { I, R: 1 + f * 0.03 * nz(t * 4.2, s + 11), jx: f * 1.4 * nz(t * 5.1, s + 13), jy: f * 1.4 * nz(t * 4.7, s + 17) };
  }
  function gradient(g, L, x, y, r, I, alpha = 1) {
    const [cr, cg, cb] = L.k.col, b = Math.min(0.9, L.bright / Math.max(L.dim, 0.01)), mix = (k) => `${cr},${(cg + (255 - cg) * k) | 0},${(cb + (255 - cb) * k) | 0}`;
    const gr = g.createRadialGradient(x, y, 0, x, y, r), a = I * alpha;
    gr.addColorStop(0, `rgba(${mix(0.35)},${Math.min(1, 0.95 * a)})`); gr.addColorStop(Math.min(0.05, b / 2), `rgba(${mix(0.18)},${Math.min(1, 0.82 * a)})`);
    gr.addColorStop(b * 0.55, `rgba(${cr},${cg},${cb},${0.52 * a})`); gr.addColorStop(b, `rgba(${cr},${cg * 0.94 | 0},${cb * 0.82 | 0},${0.3 * a})`);
    gr.addColorStop(b + (1 - b) * 0.5, `rgba(${cr},${cg * 0.82 | 0},${cb * 0.62 | 0},${0.09 * a})`); gr.addColorStop(1, `rgba(${cr},${cg * 0.72 | 0},${cb * 0.5 | 0},0)`);
    return gr;
  }

  // ----- the static layer: soft shading where floors meet walls -----
  function drawAO(g, s) {
    let n = 0, h = 0;
    for (const k in s.tiles) if (s.tiles[k] === 'wall') { n++; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0; }
    if (!n) return;
    const key = s.id + n + ':' + h + s.cols + 'x' + s.rows;
    if (key !== aoKey) {
      const Z = 8, c = document.createElement('canvas'); c.width = s.cols * Z; c.height = s.rows * Z;
      const m = document.createElement('canvas'); m.width = c.width; m.height = c.height; const mg = m.getContext('2d'); mg.fillStyle = '#000';
      for (const k in s.tiles) if (s.tiles[k] === 'wall') { const [x, y] = k.split(',').map(Number); mg.fillRect(x * Z, y * Z, Z, Z); }
      const cg = c.getContext('2d'); cg.filter = 'blur(2.4px)'; cg.drawImage(m, 0, 0);
      ao = c; aoKey = key;
    }
    g.save(); g.globalAlpha = 0.55; g.imageSmoothingEnabled = true; g.drawImage(ao, 0, 0, s.cols * CELL, s.rows * CELL); g.restore();
  }

  // ----- each frame -----
  function visibleCells(s, view, w, h) {
    return [Math.max(0, Math.floor(-view.x / view.zoom / CELL)), Math.max(0, Math.floor(-view.y / view.zoom / CELL)),
      Math.min(s.cols - 1, Math.ceil((w - view.x) / view.zoom / CELL)), Math.min(s.rows - 1, Math.ceil((h - view.y) / view.zoom / CELL))];
  }
  // squares of water or lava, leaving out the ones with a bridge or pier over them (the ripples and glow belong under the planks)
  function cellsOf(s, kind, r) {
    const p = new Path2D(); let any = false, covered = null;
    for (const id in s.props) { const q = s.props[id]; if (q.kind === 'bridge') (covered = covered || new Set()).add(q.x + ',' + q.y); }
    for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) if (s.tiles[x + ',' + y] === kind && !(covered && covered.has(x + ',' + y))) { p.rect(x * CELL, y * CELL, CELL, CELL); any = true; }
    return any ? p : null;
  }
  // ripples of light on water (under everything else)
  function drawWater(g, s, t, r, moving) {
    const p = cellsOf(s, 'water', r); if (!p) return;
    causW = causW || caustics(160, false);
    g.save(); g.clip(p); g.globalCompositeOperation = 'lighter';
    const x0 = r[0] * CELL, y0 = r[1] * CELL, x1 = (r[2] + 1) * CELL, y1 = (r[3] + 1) * CELL;
    for (const [a, sx, sy, k] of [[0.2, 9, 5, 1], [0.14, -6, 8, 1.6]]) {
      g.globalAlpha = a; const o = 160 * k, ox = moving ? ((t * sx) % o + o) % o : 0, oy = moving ? ((t * sy) % o + o) % o : 0;
      for (let x = Math.floor(x0 / o) * o - o; x < x1 + o; x += o) for (let y = Math.floor(y0 / o) * o - o; y < y1 + o; y += o) g.drawImage(causW, x + ox, y + oy, o, o);
    }
    g.restore();
  }
  // smoke and dust are lit by the light, so they go under it
  function drawLitParticles(g) {
    for (const p of parts) {
      if (p.k === 'smoke') { const a = 0.3 * Math.sin(Math.PI * Math.min(1, (1 - p.life) * 3)) * p.life; const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r); gr.addColorStop(0, `rgba(92,90,88,${a})`); gr.addColorStop(1, 'rgba(92,90,88,0)'); g.fillStyle = gr; g.fillRect(p.x - p.r, p.y - p.r, 2 * p.r, 2 * p.r); }
      else if (p.k === 'mote') { g.fillStyle = `rgba(255,242,220,${0.6 * Math.sin(Math.PI * p.life)})`; g.fillRect(p.x, p.y, 1.5, 1.5); }
    }
  }
  function particles(s, t, dt, r, amb) {
    const vx0 = r[0] * CELL, vy0 = r[1] * CELL, vx1 = (r[2] + 1) * CELL, vy1 = (r[3] + 1) * CELL, inView = (x, y) => x > vx0 - CELL && x < vx1 + CELL && y > vy0 - CELL && y < vy1 + CELL;
    const shown = lights.filter((L) => inView(L.x, L.y));
    for (const L of shown) {
      const k = L.k;
      if (k.sparks && Math.random() < dt * 5 * k.sparks) parts.push({ k: 'spark', x: (L.fx || L.x) + rand(-3, 3), y: (L.fy || L.y) - k.flame * 0.4, vx: rand(-14, 14), vy: rand(-50, -22) * (0.6 + k.sparks * 0.3), life: 1, max: rand(0.5, 1.4) });
      if (k.smoke && Math.random() < dt * 2.6 * k.smoke) parts.push({ k: 'smoke', x: (L.fx || L.x) + rand(-4, 4), y: (L.fy || L.y) - k.flame * 0.6, vx: rand(4, 12), vy: rand(-26, -15), life: 1, max: rand(3.5, 6), r: rand(6, 10) });
    }
    if (!isDay(amb)) { // dust drifting in the light of fires and lamps indoors
      const motes = parts.reduce((n, p) => n + (p.k === 'mote'), 0), lit = shown.filter((L) => L.kind !== 'token');
      if (lit.length && motes < Math.min(160, lit.length * 14) && s.tiles && Math.random() < 0.9) {
        const L = lit[(Math.random() * lit.length) | 0], a = rand(0, TAU), d = Math.sqrt(Math.random()) * L.bright * CELL;
        const x = L.x + Math.cos(a) * d, y = L.y + Math.sin(a) * d, t2 = s.tiles[Math.floor(x / CELL) + ',' + Math.floor(y / CELL)];
        if (t2 && t2 !== 'grass' && t2 !== 'water' && t2 !== 'wall') parts.push({ k: 'mote', x, y, vx: rand(-4, 4), vy: rand(-3, 3), life: 1, max: rand(6, 14), ph: rand(0, 6) });
      }
    }
    const time = (s.atmo && s.atmo.time) || 'day';
    if ((time === 'night' || time === 'dusk') && parts.reduce((n, p) => n + (p.k === 'fly'), 0) < 26) { // fireflies over grass and reeds
      const x = rand(vx0, vx1), y = rand(vy0, vy1), t2 = s.tiles[Math.floor(x / CELL) + ',' + Math.floor(y / CELL)];
      if (t2 === 'grass' || t2 === 'farm') parts.push({ k: 'fly', x, y, vx: 0, vy: 0, life: 1, max: rand(8, 16), ph: rand(0, 6) });
    }
    for (const p of parts) {
      p.life -= dt / p.max;
      if (p.k === 'fly' || p.k === 'mote') { p.ph += dt; const f = p.k === 'fly' ? 40 : 6; p.vx = (p.vx + nz(p.ph * 0.7, p.max) * dt * f) * 0.98; p.vy = (p.vy + nz(p.ph * 0.7, p.max + 5) * dt * f) * 0.98; }
      if (p.k === 'smoke') { p.vx += 3 * dt; p.r += dt * 9; }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    parts = parts.filter((p) => p.life > 0 && inView(p.x, p.y));
    if (parts.length > 900) parts.splice(0, parts.length - 900);
  }

  // each light with its shadows, drawn once at low resolution; each frame just stamps it (flicker = strength and size)
  function sprite(L, s, want) {
    // as sharp as the screen needs at this zoom (in steps, so zooming doesn't redraw them all the time)
    const q = Math.min(0.34, 150 / L.R, Math.pow(2, Math.ceil(Math.log2(Math.max(0.02, want)))));
    const key = L.poly.key + '|' + L.kind + '|' + L.k.col + '|' + L.k.I + '|' + L.bright + '|' + q;
    let sp = sprites.get(key);
    if (sp) { sprites.delete(key); sprites.set(key, sp); return sp; }
    const R = L.R, size = Math.ceil(2 * R * q) + 2, c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); g.setTransform(q, 0, 0, q, 1 - (L.x - R) * q, 1 - (L.y - R) * q);
    const gr = gradient(g, L, L.x, L.y, R, L.k.I * 1.12);
    g.save(); g.clip(L.poly.path); g.fillStyle = gr; g.fillRect(L.x - R, L.y - R, 2 * R, 2 * R); g.restore();
    g.globalCompositeOperation = 'lighter';
    // the faces of nearby walls catch some of the light, and the things that cast shadows (pillars, trees, tents) are lit themselves
    if (!wallCells) { wallCells = new Path2D(); for (const kk in s.tiles) if (s.tiles[kk] === 'wall') { const [a, b] = kk.split(',').map(Number); wallCells.rect(a * CELL, b * CELL, CELL, CELL); } }
    if (!shadeCells) { shadeCells = new Path2D(); for (const id in s.props) { const p = s.props[id], rr = SHADE[p.kind]; if (rr) { shadeCells.moveTo((p.x + 0.5) * CELL + rr * CELL * 1.6, (p.y + 0.5) * CELL); shadeCells.arc((p.x + 0.5) * CELL, (p.y + 0.5) * CELL, rr * CELL * 1.6, 0, TAU); } } }
    g.save(); g.clip(wallCells); g.globalAlpha = 0.4; g.fillStyle = gr; g.fillRect(L.x - R, L.y - R, 2 * R, 2 * R); g.restore();
    g.save(); g.clip(shadeCells); g.globalAlpha = 0.85; g.fillStyle = gr; g.fillRect(L.x - R, L.y - R, 2 * R, 2 * R); g.restore();
    sp = { c, q }; sprites.set(key, sp);
    spritePixels += size * size;
    while (spritePixels > 9e6 && sprites.size > 1) { const [k0, v0] = sprites.entries().next().value; spritePixels -= v0.c.width * v0.c.width; sprites.delete(k0); } // about 36 MB at most
    return sp;
  }
  // darkness and light, multiplied over the map (screen pixels)
  function applyLight(ctx, s, t, view, dpr, cw, ch, sight, moving, amb) {
    const k = 1 / 3, w = Math.ceil(cw * k), h = Math.ceil(ch * k);
    const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const still = [view.x, view.y, view.zoom, cw, ch, geoKey, lights.map((L) => (L.x | 0) + ',' + (L.y | 0) + ',' + L.kind).join(';'), amb, s.cols].join('|');
    if (!moving && soft && soft.width === w && soft.height === h && still === lightKey && seenKey === sight) { composite(); return; }
    lightKey = moving ? '' : still;
    if (!lc || lc.width !== w || lc.height !== h) { lc = mk(); soft = mk(); add = mk(); }
    const base = lc.getContext('2d'), Z = view.zoom * dpr * k, toWorld = (q) => q.setTransform(Z, 0, 0, Z, view.x * dpr * k, view.y * dpr * k);
    base.setTransform(1, 0, 0, 1, 0, 0); base.globalCompositeOperation = 'source-over'; base.globalAlpha = 1;
    base.fillStyle = `rgb(${amb})`; base.fillRect(0, 0, w, h);
    // a player under vision rules: light shows only where their character can see (never pitch black there),
    // so the lights go on their own layer first, which is then trimmed to what they see, with a soft edge
    const g = sight ? add.getContext('2d') : base, clip = null;
    if (sight) {
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, w, h);
      if (seenKey !== sight) {
        const P = 2, Zm = 4, c1 = document.createElement('canvas'); c1.width = (s.cols + 2 * P) * Zm; c1.height = (s.rows + 2 * P) * Zm;
        const g1 = c1.getContext('2d'); g1.fillStyle = '#fff';
        for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) if (sight[y * s.cols + x]) g1.fillRect((x + P) * Zm, (y + P) * Zm, Zm, Zm);
        seenMask = document.createElement('canvas'); seenMask.width = c1.width; seenMask.height = c1.height;
        const g2 = seenMask.getContext('2d'); g2.filter = 'blur(2px)'; g2.drawImage(c1, 0, 0); seenMask.P = P; seenKey = sight;
      }
      toWorld(g); g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgb(${Math.max(0, 88 - amb[0])},${Math.max(0, 90 - amb[1])},${Math.max(0, 104 - amb[2])})`; g.fillRect(0, 0, s.cols * CELL, s.rows * CELL);
    }
    toWorld(g); g.globalCompositeOperation = 'lighter';
    const vw = cw / dpr / view.zoom, vh = ch / dpr / view.zoom, vx = -view.x / view.zoom, vy = -view.y / view.zoom;
    for (const L of lights) {
      if (L.x + L.R < vx || L.x - L.R > vx + vw || L.y + L.R < vy || L.y - L.R > vy + vh) continue;
      const f = L.now = flick(L, t, moving), sp = sprite(L, s, Z), sc = f.R, W2 = sp.c.width / sp.q * sc;
      g.globalAlpha = Math.min(1, f.I / (L.k.I * 1.12));
      g.drawImage(sp.c, L.x + f.jx - (L.R + 1 / sp.q) * sc, L.y + f.jy - (L.R + 1 / sp.q) * sc, W2, W2);
    }
    g.globalAlpha = 1;
    // lava lights its surroundings
    const lk = s.id + ':' + Object.keys(s.tiles).length + ':' + s.cols + 'x' + s.rows;
    if (lk !== lavaKey) {
      lavaKey = lk; lavaMask = null;
      const cells = Object.keys(s.tiles).filter((q) => s.tiles[q] === 'lava');
      if (cells.length) { const Zm = 6, c = document.createElement('canvas'); c.width = s.cols * Zm; c.height = s.rows * Zm; const cg = c.getContext('2d'); cg.filter = 'blur(9px)'; cg.fillStyle = 'rgb(255,112,34)'; for (const q of cells) { const [a, b] = q.split(',').map(Number); cg.fillRect(a * Zm, b * Zm, Zm, Zm); } cg.filter = 'none'; for (const q of cells) { const [a, b] = q.split(',').map(Number); cg.fillRect(a * Zm, b * Zm, Zm, Zm); } lavaMask = c; }
    }
    if (lavaMask) { g.save(); g.globalAlpha = moving ? 0.85 + 0.12 * Math.sin(t * 1.7) : 0.9; g.drawImage(lavaMask, 0, 0, s.cols * CELL, s.rows * CELL); g.drawImage(lavaMask, 0, 0, s.cols * CELL, s.rows * CELL); g.restore(); }
    if (sight) { // keep the light only where they see, then add it to the darkness
      g.setTransform(Z, 0, 0, Z, view.x * dpr * k, view.y * dpr * k); g.globalAlpha = 1; g.globalCompositeOperation = 'destination-in'; g.imageSmoothingEnabled = true;
      const P = seenMask.P; g.drawImage(seenMask, -P * CELL, -P * CELL, (s.cols + 2 * P) * CELL, (s.rows + 2 * P) * CELL);
      base.setTransform(1, 0, 0, 1, 0, 0); base.globalCompositeOperation = 'lighter'; base.drawImage(add, 0, 0); base.globalCompositeOperation = 'source-over';
    }
    // soften (low resolution plus a little blur), then multiply over the map
    const sg = soft.getContext('2d'); sg.globalCompositeOperation = 'copy'; sg.filter = 'blur(2px)'; sg.drawImage(lc, 0, 0); // lc: the darkness with every light added
    sg.filter = 'none'; sg.globalCompositeOperation = 'destination-over'; sg.drawImage(lc, 0, 0);
    composite();
    function composite() {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath(); ctx.rect(view.x * dpr, view.y * dpr, s.cols * CELL * view.zoom * dpr, s.rows * CELL * view.zoom * dpr); ctx.clip();
    ctx.globalCompositeOperation = 'multiply'; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(soft, 0, 0, w / k, h / k);
    ctx.restore();
    }
  }

  function flameShape(g, x, y, w, h, lean) {
    g.beginPath(); g.moveTo(x + lean, y - h);
    g.bezierCurveTo(x + w * 0.9 + lean * 0.4, y - h * 0.55, x + w, y - w * 0.1, x, y + w * 0.35);
    g.bezierCurveTo(x - w, y - w * 0.1, x - w * 0.9 + lean * 0.4, y - h * 0.55, x + lean, y - h); g.fill();
  }
  function drawFlame(g, L, t, moving, day) {
    const k = L.k, s = k.flame, I = L.now ? L.now.I : k.I, x = L.fx, y = L.fy + s * 0.15;
    g.save(); g.globalCompositeOperation = 'lighter';
    const br = s * (day ? 1.8 : 3.2), bloom = g.createRadialGradient(x, y - s * 0.3, 0, x, y - s * 0.3, br);
    bloom.addColorStop(0, `rgba(255,150,60,${(day ? 0.3 : 0.45) * I})`); bloom.addColorStop(1, 'rgba(255,90,20,0)'); g.fillStyle = bloom; g.fillRect(x - br, y - s * 0.3 - br, 2 * br, 2 * br);
    const n = s > 12 ? 6 : s > 10 ? 4 : 3;
    for (const [col, sc] of [['rgba(255,90,20,.55)', 1], ['rgba(255,170,50,.6)', 0.7], ['rgba(255,240,190,.78)', 0.38]]) {
      g.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const sd = L.seed + i * 1.91, ox = (i - (n - 1) / 2) * s * 0.22 * sc;
        const hh = s * sc * (moving ? 1.05 + 0.45 * nz(t * 7 + i, sd) : 1.1), w = s * 0.36 * sc * (moving ? 1 + 0.12 * nz(t * 9, sd + 1) : 1);
        flameShape(g, x + ox, y, w, hh, moving ? s * 0.18 * nz(t * 3.3 + i * 0.4, sd + 2) : 0);
      }
    }
    g.restore();
  }
  // things that give off their own light: lava, flames, lamps, sparks, fireflies
  function drawEmissive(g, s, t, r, moving, amb, zoom = 1) {
    const day = isDay(amb);
    const lava = cellsOf(s, 'lava', r);
    if (lava) {
      causL = causL || caustics(140, true);
      g.save(); g.clip(lava); g.globalCompositeOperation = 'lighter'; g.globalAlpha = moving ? 0.48 + 0.14 * Math.sin(t * 1.7) : 0.5;
      const o = 140, ox = moving ? (t * 6) % o : 0, oy = moving ? (t * 3) % o : 0;
      for (let x = Math.floor(r[0] * CELL / o) * o - o; x < (r[2] + 1) * CELL + o; x += o) for (let y = Math.floor(r[1] * CELL / o) * o - o; y < (r[3] + 1) * CELL + o; y += o) g.drawImage(causL, x + ox, y - oy, o, o);
      g.restore();
    }
    const x0 = r[0] * CELL - CELL, y0 = r[1] * CELL - CELL, x1 = (r[2] + 2) * CELL, y1 = (r[3] + 2) * CELL;
    for (const L of lights) {
      if (L.x < x0 || L.x > x1 || L.y < y0 || L.y > y1) continue;
      if (!L.now) L.now = flick(L, t, moving);
      if (L.k.flame && L.k.flame * zoom < 5) { // too small to see a flame: just its glow
        const rr = L.k.flame * 2.2, gr = g.createRadialGradient(L.fx, L.fy, 0, L.fx, L.fy, rr); gr.addColorStop(0, `rgba(255,214,140,${0.9 * L.now.I})`); gr.addColorStop(1, 'rgba(255,120,30,0)');
        g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(L.fx - rr, L.fy - rr, 2 * rr, 2 * rr); g.restore();
      } else if (L.k.flame) drawFlame(g, L, t, moving, day);
      else if (L.k.candles) {
        g.save(); g.globalCompositeOperation = 'lighter'; g.translate(L.x, L.y); g.rotate(L.rot || 0);
        for (const [cx, cy] of L.k.candles) {
          const a = L.now.I * (moving ? 0.85 + 0.15 * nz(t * 11 + cx, L.seed) : 1), gr = g.createRadialGradient(cx, cy, 0, cx, cy, 9);
          gr.addColorStop(0, `rgba(255,236,180,${0.9 * a})`); gr.addColorStop(0.3, `rgba(255,170,80,${0.45 * a})`); gr.addColorStop(1, 'rgba(255,140,40,0)'); g.fillStyle = gr; g.fillRect(cx - 9, cy - 9, 18, 18);
        }
        g.restore();
      } else if (BLOOM_KINDS.has(L.kind)) {
        const [cr, cg, cb] = L.k.col, b = L.k.bulb, a = L.now.I * (day ? 0.5 : 0.8), gr = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, b * 2.6);
        gr.addColorStop(0, `rgba(255,255,255,${0.7 * a})`); gr.addColorStop(0.25, `rgba(${cr},${cg},${cb},${0.55 * a})`); gr.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(L.x - b * 2.6, L.y - b * 2.6, b * 5.2, b * 5.2); g.restore();
      }
    }
    if (!parts.length) return;
    g.save(); g.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      if (p.k === 'spark') { g.fillStyle = `rgba(255,${150 + 80 * p.life | 0},60,${p.life})`; g.beginPath(); g.arc(p.x, p.y, 1.3, 0, TAU); g.fill(); }
      else if (p.k === 'fly') { const a = Math.max(0, Math.sin(p.ph * 2.1)) ** 3 * Math.sin(Math.PI * p.life); if (a < 0.02) continue; const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, 7); gr.addColorStop(0, `rgba(220,255,120,${a})`); gr.addColorStop(1, 'rgba(160,255,60,0)'); g.fillStyle = gr; g.fillRect(p.x - 7, p.y - 7, 14, 14); }
    }
    g.restore();
  }

  // the light a token stands in (for its shadow and its shading), worked out from the lights rather than read back
  function tokenLight(s, cx, cy, amb) {
    let r = amb[0] / 255, gg = amb[1] / 255, b = amb[2] / 255, best = null, bw = 0;
    for (const L of lights) {
      const d = Math.hypot(cx - L.x, cy - L.y); if (d > L.R || d < 1) continue;
      if (!inside(L.poly.pts, cx, cy)) continue;
      const q = d / L.R, bb = L.bright / Math.max(L.dim, 0.01), f = q < bb ? 0.9 - 0.6 * (q / bb) : 0.3 * Math.max(0, 1 - (q - bb) / (1 - bb)) ** 1.6;
      const I = (L.now ? L.now.I : L.k.I) * f;
      r += L.k.col[0] / 255 * I; gg += L.k.col[1] / 255 * I; b += L.k.col[2] / 255 * I;
      if (I > bw) { bw = I; best = { dx: (cx - L.x) / d, dy: (cy - L.y) / d, k: Math.min(10, 3 + 7 * (1 - q)) }; }
    }
    const day = isDay(amb);
    return { tint: day ? null : [Math.min(1, r), Math.min(1, gg), Math.min(1, b)], shadow: best || { dx: 0.35, dy: 0.6, k: day ? 5 : 3 } };
  }

  return {
    ambient: ambientOf, isDay, prepare, drawAO, drawWater, drawLitParticles, applyLight, drawEmissive, tokenLight, visibleCells,
    step(s, t, r, moving, amb, zoom = 1) { const dt = Math.min(0.05, lastT ? t - lastT : 0.016); lastT = t; if (moving && zoom >= 0.4) particles(s, t, dt, r, amb); else parts = []; },
    // does this view need to keep moving?
    animating: (s, r) => lights.some((L) => L.x >= (r[0] - 2) * CELL && L.x <= (r[2] + 3) * CELL && L.y >= (r[1] - 2) * CELL && L.y <= (r[3] + 3) * CELL && (L.k.flick || L.k.flame)) || parts.length > 0 || !!cellsOf(s, 'water', r) || !!cellsOf(s, 'lava', r) || (s.atmo && (s.atmo.time === 'night' || s.atmo.time === 'dusk'))
  };
}
