// Tabletop 1.7 map art: the still parts of a map, drawn richer. Built in blocks (buildChunk) so big maps work:
// each block is drawn as a little map of its own squares plus two around it, then trimmed, with textures, edge
// noise and scattered details all tied to the real map's coordinates, so neighbouring blocks match exactly.
//   - textures at 256 px for every 2 squares (128 px a square, sharp when zoomed in), seamless, made from noise
//   - natural ground (grass, dirt, sand, water, snow…) meets its neighbours along soft, uneven edges instead of
//     square ones; built floors (flagstones, cobbles, marble, planks) keep straight edges
//   - built walls with height (a top and a front face) and a cast shadow; or rough natural rock for caves
//   - scattered detail (tufts, flowers, pebbles, cracks, moss), every prop shaded with a contact shadow
// The grid, and every rule (movement, vision, walls for sight), stay on squares: only the drawing changes.
import { CELL, rng, cellHash, drawProp, texture } from './art.js';

const TEX = 256, SPAN = 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ---------- seamless noise ----------
function lattice(n, seed) { const r = rng(seed), a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = r(); return a; }
function smoothNoise(n, seed) {
  const a = lattice(n, seed);
  return (u, v) => {
    const x = Math.floor(u), y = Math.floor(v), fx = u - x, fy = v - y, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const i0 = ((x % n) + n) % n, i1 = (i0 + 1) % n, j0 = ((y % n) + n) % n, j1 = (j0 + 1) % n;
    const top = a[j0 * n + i0] * (1 - sx) + a[j0 * n + i1] * sx, bot = a[j1 * n + i0] * (1 - sx) + a[j1 * n + i1] * sx;
    return top * (1 - sy) + bot * sy;
  };
}
// fractal noise over a size×size texture that wraps at its edges; 0..1
function fbm(size, seed, octs = [[4, 0.5], [8, 0.26], [16, 0.14], [32, 0.1]]) {
  const fs = octs.map(([n], i) => smoothNoise(n, seed + i * 101)), out = new Float32Array(size * size);
  let lo = 1e9, hi = -1e9;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0; for (let k = 0; k < octs.length; k++) v += fs[k](x / size * octs[k][0], y / size * octs[k][0]) * octs[k][1];
    out[y * size + x] = v; if (v < lo) lo = v; if (v > hi) hi = v;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo);
  return out;
}
// distance to the nearest and second-nearest of some wrapped points (cobbles, cracks in lava, flagstones)
function voronoi(size, n, seed) {
  const r = rng(seed), pts = []; for (let i = 0; i < n; i++) pts.push([r() * size, r() * size]);
  const d1 = new Float32Array(size * size), d2 = new Float32Array(size * size), id = new Uint16Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let a = 1e9, b = 1e9, k = 0;
    for (let i = 0; i < n; i++) {
      let dx = Math.abs(x - pts[i][0]), dy = Math.abs(y - pts[i][1]); if (dx > size / 2) dx = size - dx; if (dy > size / 2) dy = size - dy;
      const d = Math.hypot(dx, dy); if (d < a) { b = a; a = d; k = i; } else if (d < b) b = d;
    }
    d1[y * size + x] = a; d2[y * size + x] = b; id[y * size + x] = k;
  }
  return { d1, d2, id };
}
function canvas(w, h) { if (typeof document === 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h)); const c = document.createElement('canvas'); c.width = w; c.height = h; return c; } // OffscreenCanvas in the block worker
function pixels(size, fn) { const c = canvas(size, size), g = c.getContext('2d'), im = g.createImageData(size, size); for (let i = 0; i < size * size; i++) { const [r, gg, b] = fn(i, i % size, (i / size) | 0); im.data[i * 4] = r; im.data[i * 4 + 1] = gg; im.data[i * 4 + 2] = b; im.data[i * 4 + 3] = 255; } g.putImageData(im, 0, 0); return c; }
function wrapDraw(g, size, x, y, rad, fn) { for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) if (x + dx > -rad && x + dx < size + rad && y + dy > -rad && y + dy < size + rad) fn(x + dx, y + dy); }

// ---------- textures ----------
const S = TEX;
const painters = {
  grass(r) {
    const n = fbm(S, 11), m = fbm(S, 12, [[3, 0.6], [6, 0.4]]), A = hex('#3f5d26'), B = hex('#5d7f33'), C = hex('#344e20');
    const c = pixels(S, (i) => mixc(mixc(A, B, n[i]), C, clamp01((0.38 - m[i]) * 3) * 0.6)), g = c.getContext('2d');
    g.lineCap = 'round';
    for (let i = 0; i < 1500; i++) { // blades
      const x = r() * S, y = r() * S, len = 3 + r() * 6, a = -Math.PI / 2 + (r() - 0.5) * 0.9, light = r() > 0.55;
      g.strokeStyle = light ? `rgba(${120 + r() * 40 | 0},${160 + r() * 30 | 0},${70 + r() * 20 | 0},.55)` : `rgba(30,52,18,${0.35 + r() * 0.3})`; g.lineWidth = 0.8 + r() * 0.6;
      wrapDraw(g, S, x, y, 10, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); g.stroke(); });
    }
    return c;
  },
  dirt(r) {
    const n = fbm(S, 21), A = hex('#56412b'), B = hex('#7b5f3f'), c = pixels(S, (i) => mixc(A, B, n[i])), g = c.getContext('2d');
    for (let i = 0; i < 140; i++) { const x = r() * S, y = r() * S, rx = 0.8 + r() * 2.2, v = 90 + r() * 60 | 0; wrapDraw(g, S, x, y, 5, (px, py) => { g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(px + 0.6, py + 0.8, rx, rx * 0.8, 0, 0, 7); g.fill(); g.fillStyle = `rgb(${v},${v * 0.82 | 0},${v * 0.62 | 0})`; g.beginPath(); g.ellipse(px, py, rx, rx * 0.8, 0, 0, 7); g.fill(); }); }
    g.strokeStyle = 'rgba(40,28,16,.35)'; g.lineWidth = 0.8;
    for (let i = 0; i < 8; i++) { let x = r() * S, y = r() * S; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 16; y += (r() - 0.5) * 16; g.lineTo(x, y); } g.stroke(); }
    return c;
  },
  path(r) {
    const n = fbm(S, 31), A = hex('#7d6d55'), B = hex('#a2917a'), c = pixels(S, (i) => mixc(A, B, n[i])), g = c.getContext('2d');
    for (let i = 0; i < 260; i++) { const x = r() * S, y = r() * S, rx = 1 + r() * 2.8, v = 110 + r() * 70 | 0; wrapDraw(g, S, x, y, 5, (px, py) => { g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(px + 0.7, py + 0.9, rx, rx * 0.75, 0.5, 0, 7); g.fill(); g.fillStyle = `rgb(${v},${v - 6},${v - 18})`; g.beginPath(); g.ellipse(px, py, rx, rx * 0.75, 0.5, 0, 7); g.fill(); }); }
    return c;
  },
  sand(r) {
    const n = fbm(S, 41), A = hex('#c2a370'), B = hex('#dcc596');
    return pixels(S, (i, x, y) => { const rip = Math.sin((y + 7 * Math.sin(x / S * 6.283 * 2)) / S * 6.283 * 9) * 0.5 + 0.5; const c = mixc(A, B, n[i] * 0.7 + rip * 0.3); const gr = (Math.sin(i * 12.9898) * 43758.5453) % 1; return c.map((v) => v + gr * 14 - 7); });
  },
  water(r) {
    const n = fbm(S, 51), m = fbm(S, 52, [[2, 0.6], [4, 0.4]]), A = hex('#163f5c'), B = hex('#2b6a8c');
    return pixels(S, (i) => mixc(A, B, n[i] * 0.55 + m[i] * 0.45));
  },
  lava(r) {
    const v = voronoi(S, 22, 61), n = fbm(S, 62), A = hex('#2a0d05'), B = hex('#4f1a09');
    return pixels(S, (i) => { const e = v.d2[i] - v.d1[i], k = clamp01(1 - e / 7); const crust = mixc(A, B, n[i]); return mixc(crust, k > 0.6 ? [255, 210, 90] : [255, 110, 25], k * (0.6 + n[i] * 0.4)); });
  },
  pit() { const n = fbm(S, 71); return pixels(S, (i) => [8 + n[i] * 10, 8 + n[i] * 9, 10 + n[i] * 10]); },
  stone(r) { return flagstones(r, '#6f6a62', '#8a857b', 81, 2); },
  marble(r) {
    const n = fbm(S, 91, [[3, 0.5], [6, 0.3], [12, 0.2]]);
    return pixels(S, (i, x, y) => {
      const tile = ((x >> 7) + (y >> 7)) & 1, vein = Math.abs(Math.sin((x * 0.6 + y + n[i] * 90) / 18));
      const base = tile ? hex('#d9d4cb') : hex('#a9a39a'), c = mixc(base, [120, 115, 110], (1 - vein) ** 12 * 0.6);
      const edge = (x % 128 < 2 || y % 128 < 2) ? 0.55 : 1;
      return c.map((v) => v * edge);
    });
  },
  cobble(r) {
    const v = voronoi(S, 120, 101), n = fbm(S, 102), shade = lattice(16, 103);
    return pixels(S, (i, x, y) => {
      const e = v.d2[i] - v.d1[i]; if (e < 1.6) return [74, 66, 56];
      const s = shade[v.id[i] % 256], round = clamp01(e / 6) ** 0.6, base = 104 + s * 34 + n[i] * 14, k = 0.7 + 0.3 * round;
      return [base * k + 6, (base - 2) * k, (base - 14) * k];
    });
  },
  wood(r) {
    const n = fbm(S, 111, [[2, 0.4], [32, 0.35], [64, 0.25]]), tone = lattice(16, 112), ends = lattice(16, 113);
    const c = pixels(S, (i, x, y) => {
      const plank = y >> 5, py = y & 31, seam = py === 0 || py === 31, endX = ends[plank] * S | 0, joint = Math.abs(x - endX) < 1;
      const t = tone[plank], grain = Math.sin((x * 0.04 + n[i] * 6 + plank * 3)) * 0.5 + 0.5;
      const base = mixc(hex('#6e4a2c'), hex('#9a6c43'), t * 0.6 + grain * 0.4);
      return seam || joint ? base.map((v) => v * 0.45) : base.map((v) => v * (0.9 + 0.1 * Math.sin(py / 31 * 3.14)));
    });
    const g = c.getContext('2d'); for (let p = 0; p < 8; p++) for (const xx of [ends[p] * S - 6, ends[p] * S + 6]) { g.fillStyle = 'rgba(30,20,12,.7)'; g.fillRect(((xx % S) + S) % S, p * 32 + 6, 1.6, 1.6); g.fillRect(((xx % S) + S) % S, p * 32 + 24, 1.6, 1.6); }
    return c;
  },
  farm(r) {
    const n = fbm(S, 121);
    const c = pixels(S, (i, x, y) => { const f = Math.sin(y / S * 6.283 * 16) * 0.5 + 0.5; return mixc(hex('#4a331e'), hex('#76563a'), f * 0.7 + n[i] * 0.3); }), g = c.getContext('2d');
    for (let row = 0; row < 16; row++) for (let x = 2; x < S; x += 5 + r() * 4) { const y = row * 16 + 4 + r() * 3; g.fillStyle = r() > 0.4 ? '#6f9a3c' : '#93b24f'; g.beginPath(); g.ellipse(x, y, 2, 2.6, 0, 0, 7); g.fill(); }
    return c;
  },
  snow(r) {
    const n = fbm(S, 131), c = pixels(S, (i) => mixc(hex('#cdd8e3'), hex('#f2f6fa'), n[i])), g = c.getContext('2d');
    for (let i = 0; i < 180; i++) { g.fillStyle = `rgba(255,255,255,${0.5 + r() * 0.5})`; g.fillRect(r() * S, r() * S, 1, 1); }
    return c;
  },
  // walls
  walltop(r) { return flagstones(r, '#3e3a35', '#55504a', 141, 4); },
  wallface(r) {
    const n = fbm(S, 151), c = pixels(S, (i, x, y) => { const row = y >> 4, off = (row & 1) * 16, brick = (x + off) % 32; const mortar = (y & 15) < 2 || brick < 2; const v = mortar ? 30 : 58 + n[i] * 26; return [v, v - 3, v - 8]; });
    return c;
  },
  rock(r) {
    const n = fbm(S, 161), v = voronoi(S, 14, 162);
    return pixels(S, (i) => { const e = v.d2[i] - v.d1[i], crack = e < 2.5 ? 0.62 : 1; const b = 96 + n[i] * 70; return [b * crack, (b - 7) * crack, (b - 16) * crack]; });
  },
  // rough natural rock floor, for caves (where a map's "stone" isn't laid flagstones)
  cavefloor(r) {
    const n = fbm(S, 171), v = voronoi(S, 26, 172), A = hex('#5c5750'), B = hex('#857e74');
    return pixels(S, (i) => { const e = v.d2[i] - v.d1[i], seam = e < 2 ? 0.7 : 1, c = mixc(A, B, n[i]); return c.map((x) => x * seam * (0.94 + 0.06 * clamp01(e / 10))); });
  }
};
// irregular flagstones in rows; each stone its own tone, bevelled
function flagstones(r, c1, c2, seed, rows) {
  const n = fbm(S, seed), A = hex(c1), B = hex(c2), c = pixels(S, (i) => mixc(A, B, n[i] * 0.5)), g = c.getContext('2d'), rh = S / rows;
  for (let row = 0; row < rows; row++) {
    let x = r() * 40; const widths = [];
    while (widths.reduce((a, b) => a + b, 0) < S - 30) widths.push(rh * (0.7 + r() * 0.8));
    const total = widths.reduce((a, b) => a + b, 0); widths.forEach((w, k) => (widths[k] = w * S / total));
    for (const w of widths) {
      const y = row * rh, t = r(), col = mixc(A, B, t), dark = col.map((v) => v * 0.72), lite = col.map((v) => Math.min(255, v * 1.12));
      wrapDraw(g, S, x, y, S, (px, py) => {
        g.fillStyle = 'rgba(20,18,15,.85)'; g.fillRect(px, py, w, rh);
        const gr = g.createLinearGradient(px, py, px + w, py + rh); gr.addColorStop(0, `rgb(${lite})`); gr.addColorStop(1, `rgb(${dark})`);
        g.fillStyle = gr; g.beginPath(); g.roundRect(px + 1.5, py + 1.5, w - 3, rh - 3, 4); g.fill();
      });
      x += w;
    }
  }
  // the texture's own speckle over the stones
  const im = g.getImageData(0, 0, S, S); for (let i = 0; i < S * S; i++) { const k = 0.88 + n[i] * 0.24; im.data[i * 4] *= k; im.data[i * 4 + 1] *= k; im.data[i * 4 + 2] *= k; } g.putImageData(im, 0, 0);
  return c;
}

const texCache = {};
function tex(id) { if (!texCache[id]) texCache[id] = (painters[id] || painters.dirt)(rng(7000 + id.length * 31 + id.charCodeAt(0))); return texCache[id]; }
let caveMode = false, ORX = 0, ORY = 0; // ORX, ORY: where the block being drawn starts on the real map (squares)
const patterns = new WeakMap(); // one pattern per texture per drawing surface (making one copies the texture)
function pattern(g, id, R) {
  if (caveMode && id === 'stone') id = 'cavefloor';
  let m = patterns.get(g); if (!m) patterns.set(g, (m = new Map()));
  const key = id + '@' + R + ':' + ORX + ',' + ORY; let p = m.get(key);
  if (!p) {
    p = g.createPattern(tex(id), 'repeat'); const k = SPAN * R / TEX, off = (id.charCodeAt(0) * 37) % TEX;
    p.setTransform(new DOMMatrix().translate(-ORX * R, -ORY * R).scale(k).translate(off, off * 0.7)); m.set(key, p);
  }
  return p;
}

// ---------- natural edges ----------
const NATURAL = ['water', 'lava', 'pit', 'dirt', 'path', 'farm', 'sand', 'grass', 'snow']; // low to high: later ones spread over earlier ones
const BUILT = new Set(['stone', 'cobble', 'marble', 'wood']);
const CAVE_NATURAL = ['water', 'lava', 'pit', 'stone', 'dirt', 'path', 'sand', 'grass', 'snow']; // in caves, stone is natural rock floor
const Z = 16; // mask pixels a square
const NA = smoothNoise(64, 5), NB = smoothNoise(64, 6);
function edgeNoise(sc) {
  const key = sc.cols + 'x' + sc.rows + '@' + ORX + ',' + ORY; if (edgeNoise.k === key) return edgeNoise.v;
  const w = sc.cols * Z, h = sc.rows * Z, a = NA, b = NB, out = new Float32Array(w * h), ox = ORX * Z, oy = ORY * Z;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = a((x + ox) / Z / 1.3, (y + oy) / Z / 1.3) * 0.65 + b((x + ox) / Z / 0.35, (y + oy) / Z / 0.35) * 0.35;
  edgeNoise.k = key; edgeNoise.v = out; return out;
}
// where a terrain is, with soft uneven edges: thr below 0.5 spreads it a little past its squares
function maskOf(sc, test, thr, rough) {
  const P = 2, w = (sc.cols + 2 * P) * Z, h = (sc.rows + 2 * P) * Z, c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#fff';
  for (let y = -P; y < sc.rows + P; y++) for (let x = -P; x < sc.cols + P; x++) { const cx = Math.min(sc.cols - 1, Math.max(0, x)), cy = Math.min(sc.rows - 1, Math.max(0, y)); if (test(sc.tiles[cx + ',' + cy], cx, cy)) g.fillRect((x + P) * Z, (y + P) * Z, Z, Z); }
  const b = canvas(w, h), bg = b.getContext('2d'); bg.filter = `blur(${Z * 0.42}px)`; bg.drawImage(c, 0, 0);
  const src = bg.getImageData(P * Z, P * Z, sc.cols * Z, sc.rows * Z), n = edgeNoise(sc), out = canvas(sc.cols * Z, sc.rows * Z), og = out.getContext('2d'), im = og.createImageData(out.width, out.height);
  for (let i = 0, j = 0; i < n.length; i++, j += 4) { const v = src.data[j + 3] / 255 + (n[i] - 0.5) * rough; im.data[j] = im.data[j + 1] = im.data[j + 2] = 255; im.data[j + 3] = clamp01((v - thr) / 0.07 + 0.5) * 255; }
  og.putImageData(im, 0, 0); return out;
}
function layerFrom(sc, R, id, mask, alpha = 1) {
  const c = canvas(sc.cols * R, sc.rows * R), g = c.getContext('2d');
  // only the part of the map where this ground is (plus its soft edge) needs painting
  const want = id === 'rock' ? 'wall' : id; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (const k in sc.tiles) if (sc.tiles[k] === want) { const [x, y] = k.split(',').map(Number); if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  if (x1 < 0) return c;
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(sc.cols, x1 + 2); y1 = Math.min(sc.rows, y1 + 2);
  const bw = x1 - x0, bh = y1 - y0, Zs = mask.width / sc.cols;
  g.fillStyle = pattern(g, id, R); g.fillRect(x0 * R, y0 * R, bw * R, bh * R);
  g.globalCompositeOperation = 'destination-in'; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.globalAlpha = alpha; g.drawImage(mask, x0 * Zs, y0 * Zs, bw * Zs, bh * Zs, x0 * R, y0 * R, bw * R, bh * R);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; // back to normal for whoever draws on it next
  return c;
}
function cellsMask(sc, R, test) { const c = canvas(sc.cols * R, sc.rows * R), g = c.getContext('2d'); g.fillStyle = '#fff'; for (const k in sc.tiles) { const [x, y] = k.split(',').map(Number); if (test(sc.tiles[k], x, y)) g.fillRect(x * R, y * R, R, R); } return c; }

// ---------- scattered detail ----------
function details(g, sc, R) {
  for (const k in sc.tiles) {
    const t = sc.tiles[k], [x, y] = k.split(',').map(Number), r = rng(cellHash(x + ORX, y + ORY) + 991), X = x * R, Y = y * R, u = R / 50;
    const near = (dx, dy) => sc.tiles[(x + dx) + ',' + (y + dy)];
    if (t === 'grass') {
      if (r() < 0.4) { const cx = X + r() * R, cy = Y + r() * R; g.lineCap = 'round'; for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (r() - 0.5) * 1.2, L = (5 + r() * 6) * u; g.strokeStyle = r() > 0.5 ? 'rgba(120,160,64,.8)' : 'rgba(34,58,20,.7)'; g.lineWidth = 1.3 * u; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); g.stroke(); } }
      if (r() < 0.1) { const cols = [['#f5f1e6', '#e8c34a'], ['#c9a2e8', '#f5e6a0'], ['#e8d24a', '#a0581c']][r() * 3 | 0]; for (let i = 0; i < 4; i++) { const fx = X + r() * R, fy = Y + r() * R; for (let p = 0; p < 5; p++) { const a = p * 1.2566; g.fillStyle = cols[0]; g.beginPath(); g.arc(fx + Math.cos(a) * 2 * u, fy + Math.sin(a) * 2 * u, 1.5 * u, 0, 7); g.fill(); } g.fillStyle = cols[1]; g.beginPath(); g.arc(fx, fy, 1.2 * u, 0, 7); g.fill(); } }
    } else if (t === 'dirt' || t === 'path') {
      if (r() < 0.35) for (let i = 0; i < 3; i++) { const px = X + r() * R, py = Y + r() * R, s = (2 + r() * 2.5) * u, v = 100 + r() * 60 | 0; g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(px + u, py + 1.4 * u, s, s * 0.75, 0, 0, 7); g.fill(); g.fillStyle = `rgb(${v},${v - 8},${v - 20})`; g.beginPath(); g.ellipse(px, py, s, s * 0.75, 0, 0, 7); g.fill(); }
    } else if (BUILT.has(t)) {
      const byWall = ['0,-1', '-1,0', '1,0', '0,1'].some((d) => { const [dx, dy] = d.split(',').map(Number); return near(dx, dy) === 'wall'; });
      if (r() < 0.12) { g.strokeStyle = 'rgba(20,18,15,.55)'; g.lineWidth = 1.1 * u; let px = X + r() * R, py = Y + r() * R; g.beginPath(); g.moveTo(px, py); for (let i = 0; i < 4; i++) { px += (r() - 0.5) * 18 * u; py += (r() - 0.5) * 18 * u; g.lineTo(px, py); } g.stroke(); }
      if (t !== 'wood' && t !== 'marble' && r() < (byWall ? 0.28 : 0.05)) { const px = X + r() * R, py = Y + r() * R, s = (6 + r() * 9) * u, gr = g.createRadialGradient(px, py, 0, px, py, s); gr.addColorStop(0, 'rgba(70,96,40,.55)'); gr.addColorStop(1, 'rgba(70,96,40,0)'); g.fillStyle = gr; g.fillRect(px - s, py - s, 2 * s, 2 * s); }
      if (t === 'wood' && r() < 0.06) { const px = X + r() * R, py = Y + r() * R, s = (5 + r() * 6) * u; g.fillStyle = 'rgba(40,22,10,.22)'; g.beginPath(); g.ellipse(px, py, s, s * 0.7, r() * 3, 0, 7); g.fill(); }
    } else if (t === 'sand' && r() < 0.12) { const px = X + r() * R, py = Y + r() * R; g.fillStyle = 'rgba(245,235,215,.9)'; g.beginPath(); g.ellipse(px, py, 2.4 * u, 1.8 * u, r() * 3, 0, 7); g.fill(); g.strokeStyle = 'rgba(150,120,90,.6)'; g.lineWidth = 0.6 * u; g.stroke(); }
  }
}

// ---------- props: shaded, with a contact shadow ----------
const FLAT = new Set(['rug', 'trap', 'trapdoor', 'lilypad', 'flowers', 'bones', 'stairs', 'mushrooms', 'reeds', 'grave', 'bridge', 'door', 'doubledoor', 'dooropen', 'secretdoor', 'window', 'archway', 'portcullis', 'bars', 'lever', 'rubble']);
const spriteCache = new Map();
function propSprite(kind, rot, R) {
  const key = kind + rot + '@' + R; if (spriteCache.has(key)) return spriteCache.get(key);
  const c = canvas(3 * R, 3 * R), g = c.getContext('2d'); g.scale(R / CELL, R / CELL);
  drawProp(g, { kind, x: 1, y: 1, rot }, { lit: true });
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-atop';
  const gr = g.createLinearGradient(R * 0.8, R * 0.8, R * 2.2, R * 2.2); gr.addColorStop(0, 'rgba(255,248,230,.16)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.26)');
  g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
  let sh = null;
  if (!FLAT.has(kind)) { sh = canvas(c.width, c.height); const sg = sh.getContext('2d'); sg.drawImage(c, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#000'; sg.fillRect(0, 0, sh.width, sh.height);
    const b = canvas(c.width, c.height), bg = b.getContext('2d'); bg.filter = `blur(${R * 0.05}px)`; bg.drawImage(sh, 0, 0); sh = b; }
  const v = { c, sh }; spriteCache.set(key, v); return v;
}

// soft shading only needs a few pixels a square: draw it small, blur it there, and let the scale-up smooth it
function small(sc, q) { const c = canvas(sc.cols * q, sc.rows * q); return [c, c.getContext('2d')]; }

// ---------- the whole still layer ----------
// opts: blend (natural edges), detail (new textures + scattered detail), height (walls with height and cast shadows),
//       cave (walls as rough natural rock), props (shaded props). R: pixels a square.
export function buildStatic(sc, R, opts) {
  const W = sc.cols * R, H = sc.rows * R, out = canvas(W, H), g = out.getContext('2d'), u = R / 50;
  caveMode = !!opts.cave;
  const built = (t) => BUILT.has(t) && !(caveMode && t === 'stone');
  const texId = (t) => (opts.detail ? t : null);
  // 1. every square, crisp (so nothing is ever left uncovered)
  for (const k in sc.tiles) {
    const t = sc.tiles[k], [x, y] = k.split(',').map(Number);
    if (t === 'wall') { if (opts.cave && opts.detail) { g.fillStyle = '#1a1a1a'; g.fillRect(x * R, y * R, R + 0.5, R + 0.5); } continue; } // under the rounded rock: the same dark as off the map, so no square corners show
    if (opts.detail) { g.fillStyle = pattern(g, t, R); g.fillRect(x * R, y * R, R, R); }
    else { g.drawImage(texture(t, x, y), x * R, y * R, R + 0.6, R + 0.6); }
  }
  // 2. natural ground spreads over its neighbours with soft uneven edges; built floors stay straight
  if (opts.blend) {
    const present = new Set(Object.values(sc.tiles));
    for (const t of caveMode ? CAVE_NATURAL : NATURAL) {
      if (!present.has(t)) continue;
      const m = maskOf(sc, (v) => v === t, t === 'water' || t === 'lava' || t === 'pit' ? 0.5 : 0.36, t === 'water' ? 0.22 : 0.3);
      const L = opts.detail ? layerFrom(sc, R, t, m) : (() => { const c = canvas(W, H), lg = c.getContext('2d'); for (const k in sc.tiles) if (sc.tiles[k] === t) { const [x, y] = k.split(',').map(Number); for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) lg.drawImage(texture(t, x, y), (x + dx) * R, (y + dy) * R, R + 0.6, R + 0.6); } lg.globalCompositeOperation = 'destination-in'; lg.drawImage(m, 0, 0, W, H); return c; })();
      g.drawImage(L, 0, 0);
    }
    // built floors back on top, straight-edged
    for (const k in sc.tiles) { const t = sc.tiles[k]; if (!built(t)) continue; const [x, y] = k.split(',').map(Number); if (opts.detail) { g.fillStyle = pattern(g, t, R); g.fillRect(x * R, y * R, R, R); } else g.drawImage(texture(t, x, y), x * R, y * R, R + 0.6, R + 0.6); }
    // water: darker towards its banks, a little foam where it meets land
    if (present.has('water')) {
      const wm = maskOf(sc, (v) => v === 'water', 0.5, 0.22), q = Math.min(R, 32), qw = sc.cols * q, qh = sc.rows * q;
      const [land, lg] = small(sc, q); lg.drawImage(wm, 0, 0, qw, qh); lg.globalCompositeOperation = 'source-out'; lg.fillStyle = '#000'; lg.fillRect(0, 0, qw, qh); // land = not water
      const [edge, eg] = small(sc, q); eg.filter = `blur(${q * 0.22}px)`; eg.drawImage(land, 0, 0); eg.filter = 'none';
      eg.globalCompositeOperation = 'destination-in'; eg.drawImage(wm, 0, 0, qw, qh);
      g.save(); g.globalAlpha = 0.55; g.drawImage(edge, 0, 0, W, H); g.restore(); // the shade under the bank
      const [foam, fg] = small(sc, q); fg.filter = `blur(${q * 0.06}px)`; fg.drawImage(land, 0, 0); fg.filter = 'none';
      fg.globalCompositeOperation = 'source-in'; fg.fillStyle = 'rgba(235,245,250,1)'; fg.fillRect(0, 0, qw, qh); fg.globalCompositeOperation = 'destination-in'; fg.drawImage(wm, 0, 0, qw, qh);
      g.save(); g.globalAlpha = 0.5; g.drawImage(foam, 0, 0, W, H); g.restore();
    }
  }
  if (opts.detail) details(g, sc, R);
  // 3. grid (faint, under the walls)
  if (sc.showGrid !== false) { g.strokeStyle = 'rgba(0,0,0,.17)'; g.lineWidth = Math.max(1, u); g.beginPath(); for (let x = 0; x <= sc.cols; x++) { g.moveTo(x * R, 0); g.lineTo(x * R, H); } for (let y = 0; y <= sc.rows; y++) { g.moveTo(0, y * R); g.lineTo(W, y * R); } g.stroke(); }
  // 4. walls
  const isWall = (x, y) => sc.tiles[x + ',' + y] === 'wall';
  if (opts.cave) {
    const rm = maskOf(sc, (v) => v === 'wall', 0.5, 0.42), rock = layerFrom(sc, R, 'rock', rm);
    const q = Math.min(R, 32), qw = sc.cols * q, qh = sc.rows * q;
    const [sh, sg] = small(sc, q); sg.filter = `blur(${q * 0.12}px)`; sg.drawImage(rm, q * 0.1, q * 0.16, qw, qh); sg.filter = 'none'; sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#000'; sg.fillRect(0, 0, qw, qh);
    g.save(); g.globalAlpha = 0.6; g.drawImage(sh, 0, 0, W, H); g.restore();
    const rg = rock.getContext('2d'), rim = (dx, dy, col, a) => { const e = canvas(W, H), eg = e.getContext('2d'); eg.drawImage(rm, 0, 0, W, H); eg.globalCompositeOperation = 'destination-out'; eg.drawImage(rm, dx, dy, W, H); eg.globalCompositeOperation = 'source-in'; eg.fillStyle = col; eg.fillRect(0, 0, W, H); rg.save(); rg.globalAlpha = a; rg.drawImage(e, 0, 0); rg.restore(); };
    rim(R * 0.06, R * 0.06, '#d8d2c6', 0.45); rim(-R * 0.08, -R * 0.08, '#000', 0.6);
    // deeper inside the rock is darker
    const [deep, dg] = small(sc, q); dg.filter = `blur(${q * 0.15}px)`; dg.drawImage(maskOf(sc, (v) => v === 'wall', 0.82, 0.3), 0, 0, qw, qh); dg.filter = 'none'; dg.globalCompositeOperation = 'source-in'; dg.fillStyle = '#000'; dg.fillRect(0, 0, qw, qh);
    rg.save(); rg.globalAlpha = 0.28; rg.globalCompositeOperation = 'source-atop'; rg.drawImage(deep, 0, 0, W, H); rg.restore();
    g.drawImage(rock, 0, 0);
  } else {
    if (opts.height) { // cast shadow on the floor
      // drawn small and sharp, then blurred once while scaling up (blurring per square is very slow)
      const q = Math.min(R, 24), sh = canvas(sc.cols * q, sc.rows * q), sg = sh.getContext('2d'); sg.fillStyle = '#000';
      for (const k in sc.tiles) if (sc.tiles[k] === 'wall') { const [x, y] = k.split(',').map(Number); sg.fillRect(x * q + q * 0.14, y * q + q * 0.22, q, q); }
      g.save(); g.globalAlpha = 0.5; g.filter = `blur(${R * 0.1}px)`; g.imageSmoothingEnabled = true; g.drawImage(sh, 0, 0, W, H); g.restore();
    } else { g.fillStyle = 'rgba(0,0,0,.45)'; for (const k in sc.tiles) if (sc.tiles[k] === 'wall') { const [x, y] = k.split(',').map(Number); g.fillRect(x * R + 6 * u, y * R + 7 * u, R, R); } }
    for (const k in sc.tiles) {
      if (sc.tiles[k] !== 'wall') continue; const [x, y] = k.split(',').map(Number), X = x * R, Y = y * R;
      if (!opts.detail) { g.drawImage(texture('wall', x, y), X, Y, R + 0.6, R + 0.6); }
      const face = opts.height && !isWall(x, y + 1) ? R * 0.34 : 0;
      if (opts.detail) { g.fillStyle = pattern(g, 'walltop', R); g.fillRect(X, Y, R + 0.5, R - face + 0.5); }
      if (face) { // the wall's front, facing the room below it
        g.fillStyle = pattern(g, 'wallface', R); g.fillRect(X, Y + R - face, R + 0.5, face);
        const fg = g.createLinearGradient(0, Y + R - face, 0, Y + R); fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(1, 'rgba(0,0,0,.45)'); g.fillStyle = fg; g.fillRect(X, Y + R - face, R + 0.5, face);
        g.fillStyle = 'rgba(255,245,225,.18)'; g.fillRect(X, Y + R - face, R, 2 * u);
      }
      g.fillStyle = 'rgba(255,255,255,.13)'; if (!isWall(x, y - 1)) g.fillRect(X, Y, R, 3 * u); if (!isWall(x - 1, y)) g.fillRect(X, Y, 3 * u, R - face);
      g.fillStyle = 'rgba(0,0,0,.5)'; if (!isWall(x + 1, y)) g.fillRect(X + R - 3 * u, Y, 3 * u, R); if (!face && !isWall(x, y + 1)) g.fillRect(X, Y + R - 4 * u, R, 4 * u);
    }
  }
  // 5. props
  const props = Object.values(sc.props).sort((a, b) => a.y - b.y);
  for (const p of props) {
    const kind = p.open && (p.kind === 'door' || p.kind === 'doubledoor') ? 'dooropen' : p.kind;
    if (opts.props) {
      const sp = propSprite(kind, p.rot || 0, R), x0 = (p.x - 1) * R, y0 = (p.y - 1) * R;
      if (sp.sh) { g.save(); g.globalAlpha = 0.42; g.drawImage(sp.sh, x0 + R * 0.07, y0 + R * 0.11); g.restore(); }
      g.drawImage(sp.c, x0, y0);
    } else { g.save(); g.scale(R / CELL, R / CELL); drawProp(g, { ...p, kind }, { lit: true }); g.restore(); }
  }
  return out;
}

// One block of a map: squares x0…x0+n-1, y0…y0+n-1 (fewer at the map's edge), R pixels a square.
const PAD = 2;
export function buildChunk(sc, R, opts, x0, y0, n) {
  const w = Math.min(n, sc.cols - x0), h = Math.min(n, sc.rows - y0), rx = x0 - PAD, ry = y0 - PAD, rw = w + 2 * PAD, rh = h + 2 * PAD;
  const tiles = {}, props = {};
  for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) { const t = sc.tiles[x + ',' + y]; if (t) tiles[(x - rx) + ',' + (y - ry)] = t; }
  for (const id in sc.props) { const p = sc.props[id]; if (p.x >= rx - 1 && p.x <= rx + rw && p.y >= ry - 1 && p.y <= ry + rh) props[id] = { ...p, x: p.x - rx, y: p.y - ry }; }
  ORX = rx; ORY = ry;
  const region = buildStatic({ cols: rw, rows: rh, tiles, props, showGrid: sc.showGrid }, R, opts);
  ORX = 0; ORY = 0;
  const out = canvas(w * R, h * R); out.getContext('2d').drawImage(region, -PAD * R, -PAD * R);
  return out;
}

// ---------- tokens: a metal rim, a little bevel, a soft shadow ----------
export function drawTokenFramed(g, t, cx, cy, rad, drawArt, framed) {
  if (!framed) { drawArt(rad - 4); g.lineWidth = 2.5; g.strokeStyle = t.owner ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.65)'; g.beginPath(); g.arc(cx, cy, rad - 4, 0, 7); g.stroke(); return; }
  const r = rad - 4, gold = !!t.owner;
  drawArt(r - 2);
  const ring = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  if (gold) { ring.addColorStop(0, '#fff1b8'); ring.addColorStop(0.35, '#d9b04c'); ring.addColorStop(0.7, '#8a6a22'); ring.addColorStop(1, '#e8c968'); }
  else { ring.addColorStop(0, '#f1f3f5'); ring.addColorStop(0.35, '#9aa1a9'); ring.addColorStop(0.7, '#4a5057'); ring.addColorStop(1, '#b8bec6'); }
  g.lineWidth = 3.6; g.strokeStyle = ring; g.beginPath(); g.arc(cx, cy, r - 0.5, 0, 7); g.stroke();
  g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.arc(cx, cy, r - 2.6, 0, 7); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, r + 1.4, Math.PI * 1.05, Math.PI * 1.55); g.stroke();
}

// just the rim, for the app's own token drawing: gold for player characters, iron for everything else
export function drawTokenRing(g, cx, cy, r, gold) {
  const ring = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  if (gold) { ring.addColorStop(0, '#fff1b8'); ring.addColorStop(0.35, '#d9b04c'); ring.addColorStop(0.7, '#8a6a22'); ring.addColorStop(1, '#e8c968'); }
  else { ring.addColorStop(0, '#f1f3f5'); ring.addColorStop(0.35, '#9aa1a9'); ring.addColorStop(0.7, '#4a5057'); ring.addColorStop(1, '#b8bec6'); }
  g.lineWidth = Math.max(2.6, r * 0.16); g.strokeStyle = ring; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.arc(cx, cy, r - g.lineWidth - Math.max(1.3, r * 0.08), 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, r + Math.max(1.3, r * 0.08) + 0.6, Math.PI * 1.05, Math.PI * 1.55); g.stroke();
}
