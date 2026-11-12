// Procedural map art: terrain textures and props, drawn in code (no image assets).
export const CELL = 50;
const catalog = await (await fetch(new URL('../catalog.json', import.meta.url))).json();
export const TERRAINS = catalog.terrains;
export const PROPS = catalog.props;
export const PROP_CATS = catalog.propCats;
export const DM_ONLY = new Set(PROPS.filter((p) => p.dmOnly).map((p) => p.id));

// ---------- seeded randomness so textures look the same on every screen ----------
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909), (s ^= s >>> 16) >>> 0) / 4294967296);
}
export const cellHash = (x, y) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;

const T = 64;        // texture size in pixels
const VARIANTS = 4;  // per terrain, picked per cell so floors don't look tiled

function speckle(g, r, n, colors, min, max) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    const s = min + r() * (max - min);
    g.fillRect(r() * T, r() * T, s, s);
  }
}

const painters = {
  stone(g, r) {
    g.fillStyle = '#77736b'; g.fillRect(0, 0, T, T);
    speckle(g, r, 140, ['rgba(255,255,255,.05)', 'rgba(0,0,0,.08)'], 2, 7);
    g.strokeStyle = 'rgba(30,26,22,.55)'; g.lineWidth = 1.5;
    const off = r() * 20;
    g.beginPath(); g.moveTo(0, 32); g.lineTo(T, 32);
    for (const [y0, y1, o] of [[0, 32, off], [32, 64, off + 22]]) for (let x = o % 32; x < T; x += 32) { g.moveTo(x, y0); g.lineTo(x, y1); }
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.beginPath(); g.moveTo(0, 33.5); g.lineTo(T, 33.5); g.stroke();
  },
  cobble(g, r) {
    g.fillStyle = '#4c4842'; g.fillRect(0, 0, T, T);
    for (let i = 0; i < 26; i++) {
      const x = r() * T, y = r() * T, rx = 6 + r() * 5, ry = 5 + r() * 4, v = 100 + r() * 40, a = r() * 3;
      g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
      for (const dx of [-T, 0, T]) for (const dy of [-T, 0, T]) { g.beginPath(); g.ellipse(x + dx, y + dy, rx, ry, a, 0, 7); g.fill(); }
    }
    speckle(g, r, 60, ['rgba(0,0,0,.12)'], 1, 3);
  },
  wood(g, r) {
    g.fillStyle = '#7a5434'; g.fillRect(0, 0, T, T);
    for (let i = 0; i < 4; i++) {
      const v = r() * 22 - 11;
      g.fillStyle = `rgb(${122 + v},${84 + v},${52 + v})`; g.fillRect(0, i * 16, T, 16);
      g.strokeStyle = 'rgba(60,35,18,.35)'; g.lineWidth = 1;
      for (let k = 0; k < 3; k++) { const y = i * 16 + 3 + r() * 10; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(20, y + r() * 3, 44, y - r() * 3, T, y); g.stroke(); }
      g.fillStyle = 'rgba(30,18,8,.7)'; g.fillRect(0, i * 16 + 15, T, 1.5);
      g.fillRect(r() * T, i * 16, 1.5, 16);
    }
  },
  dirt(g, r) {
    g.fillStyle = '#6b5236'; g.fillRect(0, 0, T, T);
    speckle(g, r, 220, ['rgba(0,0,0,.12)', 'rgba(255,230,190,.06)', 'rgba(60,40,20,.2)'], 1, 5);
    speckle(g, r, 8, ['#857055', '#5a4630'], 3, 6);
  },
  grass(g, r) {
    g.fillStyle = '#4d6b2e'; g.fillRect(0, 0, T, T);
    speckle(g, r, 120, ['rgba(0,0,0,.1)', 'rgba(140,180,70,.18)'], 3, 9);
    g.lineWidth = 1.2;
    for (let i = 0; i < 70; i++) {
      const x = r() * T, y = r() * T; g.strokeStyle = r() > .5 ? '#6a8f3a' : '#3b5522';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + r() * 3 - 1.5, y - 3 - r() * 4); g.stroke();
    }
  },
  sand(g, r) {
    g.fillStyle = '#c8ab76'; g.fillRect(0, 0, T, T);
    speckle(g, r, 260, ['rgba(120,90,40,.14)', 'rgba(255,250,230,.16)'], 1, 2.5);
    g.strokeStyle = 'rgba(150,115,60,.25)'; g.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) { const y = 10 + i * 20 + r() * 6; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(20, y - 5, 40, y + 5, T, y); g.stroke(); }
  },
  water(g, r) {
    const grd = g.createLinearGradient(0, 0, T, T); grd.addColorStop(0, '#24557a'); grd.addColorStop(1, '#1d4766');
    g.fillStyle = grd; g.fillRect(0, 0, T, T);
    g.strokeStyle = 'rgba(160,210,240,.25)'; g.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) { const x = r() * T, y = r() * T, w = 8 + r() * 10; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 3, x + w, y); g.stroke(); }
  },
  lava(g, r) {
    g.fillStyle = '#5a1606'; g.fillRect(0, 0, T, T);
    for (let i = 0; i < 9; i++) {
      const x = r() * T, y = r() * T, rad = 6 + r() * 12;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, '#ffd34d'); grd.addColorStop(.5, '#ff6a14'); grd.addColorStop(1, 'rgba(160,30,0,0)');
      g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    g.strokeStyle = 'rgba(30,8,2,.6)'; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(r() * T, r() * T); g.lineTo(r() * T, r() * T); g.stroke(); }
  },
  pit(g, r) { g.fillStyle = '#060607'; g.fillRect(0, 0, T, T); speckle(g, r, 30, ['rgba(255,255,255,.03)'], 1, 3); },
  wall(g, r) {
    g.fillStyle = '#3d3934'; g.fillRect(0, 0, T, T);
    for (let row = 0; row < 4; row++) for (let col = -1; col < 3; col++) {
      const x = col * 32 + (row % 2) * 16, y = row * 16, v = 56 + r() * 18;
      g.fillStyle = `rgb(${v},${v - 3},${v - 8})`; g.fillRect(x + 1, y + 1, 30, 14);
    }
    speckle(g, r, 60, ['rgba(0,0,0,.18)', 'rgba(255,255,255,.04)'], 1, 4);
  },
  marble(g, r) {
    for (let i = 0; i < 4; i++) {
      const x = (i % 2) * 32, y = Math.floor(i / 2) * 32, v = 205 + r() * 25;
      g.fillStyle = (i % 3 === 0) ? `rgb(${v},${v - 2},${v - 6})` : `rgb(${v - 30},${v - 32},${v - 34})`; g.fillRect(x, y, 32, 32);
      g.strokeStyle = 'rgba(120,115,110,.35)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + r() * 32, y); g.bezierCurveTo(x + r() * 32, y + 10, x + r() * 32, y + 20, x + r() * 32, y + 32); g.stroke();
    }
    g.strokeStyle = 'rgba(60,55,50,.5)'; g.lineWidth = 1.5; g.strokeRect(0, 0, 32, 32); g.strokeRect(32, 32, 32, 32); g.strokeRect(32, 0, 32, 32); g.strokeRect(0, 32, 32, 32);
  },
  path(g, r) {
    g.fillStyle = '#8a7a62'; g.fillRect(0, 0, T, T);
    speckle(g, r, 300, ['#9d8d73', '#766750', '#a99a80', 'rgba(0,0,0,.15)'], 1.5, 3.5);
  },
  farm(g, r) {
    g.fillStyle = '#5c4126'; g.fillRect(0, 0, T, T);
    for (let y = 0; y < T; y += 8) {
      g.fillStyle = 'rgba(30,18,8,.45)'; g.fillRect(0, y + 5, T, 3);
      g.fillStyle = 'rgba(140,110,70,.25)'; g.fillRect(0, y + 1, T, 2);
      for (let x = 2; x < T; x += 5 + r() * 3) { g.fillStyle = r() > .3 ? '#6a8f3a' : '#87a94a'; g.fillRect(x, y + 1, 2, 3); }
    }
  },
  snow(g, r) {
    g.fillStyle = '#e8eef3'; g.fillRect(0, 0, T, T);
    speckle(g, r, 120, ['rgba(160,180,200,.2)', 'rgba(255,255,255,.8)'], 2, 6);
  }
};

const cache = {};
export function texture(id, x, y) {
  if (!cache[id]) {
    cache[id] = [];
    const n = TERRAINS.findIndex((t) => t.id === id) + 1;
    for (let v = 0; v < VARIANTS; v++) {
      const c = typeof document === 'undefined' ? new OffscreenCanvas(T, T) : document.createElement('canvas'); c.width = c.height = T; // OffscreenCanvas in the block worker
      (painters[id] || painters.dirt)(c.getContext('2d'), rng(1000 * n + v * 17 + 3));
      cache[id].push(c);
    }
  }
  return cache[id][cellHash(x, y) % VARIANTS];
}

// ---------- props ----------
// Each draws inside a CELL×CELL box centred on (0,0), already rotated. Rotation 0 = runs left–right.
const H = CELL / 2;
function shadow(g, blur = 6) { g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = blur; g.shadowOffsetX = 2; g.shadowOffsetY = 3; }
function noShadow(g) { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0; }
function rr(g, x, y, w, h, rad) { g.beginPath(); g.roundRect(x, y, w, h, rad); }
function circle(g, x, y, rad, fill) { g.beginPath(); g.arc(x, y, rad, 0, 7); if (fill) { g.fillStyle = fill; g.fill(); } }
function grad(g, x0, y0, x1, y1, a, b) { const k = g.createLinearGradient(x0, y0, x1, y1); k.addColorStop(0, a); k.addColorStop(1, b); return k; }
let lit = false; // the new lighting draws glows and flames itself (see lighting.js)
function glow(g, rad, inner = 'rgba(255,190,90,.45)') {
  if (lit) return;
  const k = g.createRadialGradient(0, 0, 0, 0, 0, rad); k.addColorStop(0, inner); k.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = k; g.beginPath(); g.arc(0, 0, rad, 0, 7); g.fill();
}
function flame(g, x, y, s) {
  if (lit) return;
  circle(g, x, y, 5 * s, '#ff8a1f'); circle(g, x, y, 3 * s, '#ffd166'); circle(g, x, y, 1.5 * s, '#fff6d5');
}
function frame(g) { g.fillStyle = '#2a2420'; g.fillRect(-H, -7, 6, 14); g.fillRect(H - 6, -7, 6, 14); }
function planks(g, x, y, w, h, color = '#8a5a2b') {
  g.fillStyle = color; g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(40,22,8,.6)'; g.lineWidth = 1;
  for (let k = x + 6; k < x + w; k += 6) { g.beginPath(); g.moveTo(k, y); g.lineTo(k, y + h); g.stroke(); }
}

const P = {
  // ----- doors & windows -----
  door(g) { frame(g); shadow(g, 4); planks(g, -H + 5, -5, CELL - 10, 10); noShadow(g); circle(g, H - 13, 0, 2, '#d9b44a'); },
  doubledoor(g) {
    frame(g); shadow(g, 4); planks(g, -H + 5, -5, H - 6, 10); planks(g, 1, -5, H - 6, 10); noShadow(g);
    g.fillStyle = '#1c140c'; g.fillRect(-1, -5, 2, 10); circle(g, -4, 0, 1.6, '#d9b44a'); circle(g, 4, 0, 1.6, '#d9b44a');
  },
  dooropen(g) {
    frame(g); g.save(); g.translate(-H + 6, 0); g.rotate(-1.2); shadow(g, 4); planks(g, 0, -4, CELL - 14, 8); noShadow(g); g.restore();
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.setLineDash([3, 3]); g.lineWidth = 1; g.beginPath(); g.arc(-H + 6, 0, CELL - 14, -1.2, 0); g.stroke(); g.setLineDash([]);
  },
  secretdoor(g) {
    g.strokeStyle = '#f59e0b'; g.lineWidth = 2; g.setLineDash([5, 4]); g.strokeRect(-H + 4, -7, CELL - 8, 14); g.setLineDash([]);
    g.fillStyle = 'rgba(245,158,11,.25)'; g.fillRect(-H + 4, -7, CELL - 8, 14);
    g.fillStyle = '#fbbf24'; g.font = '700 12px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('S', 0, 1);
  },
  portcullis(g) {
    frame(g); g.strokeStyle = '#6b7280'; g.lineWidth = 2.5;
    for (let x = -H + 9; x < H - 6; x += 6) { g.beginPath(); g.moveTo(x, -6); g.lineTo(x, 6); g.stroke(); }
    g.lineWidth = 2; g.beginPath(); g.moveTo(-H + 6, -3); g.lineTo(H - 6, -3); g.moveTo(-H + 6, 3); g.lineTo(H - 6, 3); g.stroke();
  },
  archway(g) {
    g.fillStyle = '#5b5650'; g.fillRect(-H, -8, 8, 16); g.fillRect(H - 8, -8, 8, 16);
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1; g.strokeRect(-H + .5, -7.5, 7, 15); g.strokeRect(H - 7.5, -7.5, 7, 15);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(-H + 8, -8, CELL - 16, 16);
  },
  window(g) {
    g.fillStyle = '#2a2420'; g.fillRect(-H + 6, -5, CELL - 12, 10);
    g.fillStyle = grad(g, 0, -4, 0, 4, '#bfe3f5', '#7fb6d6'); g.fillRect(-H + 9, -3, CELL - 18, 6);
    g.fillStyle = '#2a2420'; g.fillRect(-1, -4, 2, 8);
    g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(-H + 11, -2, 5, 1.5);
  },
  bars(g) {
    frame(g); g.strokeStyle = '#4b5563'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(-H + 6, 0); g.lineTo(H - 6, 0); g.stroke();
    g.fillStyle = '#6b7280'; for (let x = -H + 9; x < H - 6; x += 6) circle(g, x, 0, 2.2, '#6b7280');
  },

  // ----- furniture -----
  table(g) {
    shadow(g, 8); rr(g, -21, -15, 42, 30, 4); g.fillStyle = '#8b5e34'; g.fill(); noShadow(g);
    g.strokeStyle = 'rgba(50,28,10,.5)'; g.lineWidth = 1;
    for (let y = -9; y < 15; y += 7) { g.beginPath(); g.moveTo(-20, y); g.lineTo(20, y); g.stroke(); }
    circle(g, -8, -3, 4, '#e6dcc4'); circle(g, 9, 4, 3, '#c0392b');
  },
  roundtable(g) {
    shadow(g, 8); circle(g, 0, 0, 18, '#8b5e34'); noShadow(g);
    g.strokeStyle = 'rgba(50,28,10,.5)'; g.lineWidth = 1.5; circle(g, 0, 0, 14); g.stroke();
    circle(g, -5, -4, 3.5, '#e6dcc4'); circle(g, 6, 5, 2.5, '#b8860b');
  },
  chair(g) {
    shadow(g, 4); g.fillStyle = '#7a4f2a'; g.fillRect(-9, -9, 18, 18); noShadow(g);
    g.fillStyle = '#5b3a1e'; g.fillRect(-9, -12, 18, 5);
  },
  bench(g) { shadow(g, 4); planks(g, -H + 3, -6, CELL - 6, 12, '#7a4f2a'); noShadow(g); },
  bed(g) {
    shadow(g); g.fillStyle = '#5b3a1e'; g.fillRect(-14, -22, 28, 44); noShadow(g);
    g.fillStyle = '#7d2e2e'; g.fillRect(-12, -8, 24, 28);
    rr(g, -10, -19, 20, 9, 3); g.fillStyle = '#e8e0cc'; g.fill();
    g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(-12, -8, 24, 3);
  },
  bookshelf(g) {
    shadow(g, 4); g.fillStyle = '#5b3a1e'; g.fillRect(-H + 2, -9, CELL - 4, 14); noShadow(g);
    const cols = ['#7f1d1d', '#1e3a8a', '#14532d', '#78350f', '#4c1d95', '#a16207'];
    for (let x = -H + 4, i = 0; x < H - 5; x += 4, i++) { g.fillStyle = cols[i % cols.length]; g.fillRect(x, -7, 3, 10); }
  },
  wardrobe(g) {
    shadow(g, 5); g.fillStyle = '#6b4423'; g.fillRect(-18, -11, 36, 22); noShadow(g);
    g.strokeStyle = '#3e2512'; g.lineWidth = 1.5; g.strokeRect(-17, -10, 34, 20); g.beginPath(); g.moveTo(0, -10); g.lineTo(0, 10); g.stroke();
    circle(g, -3, 0, 1.5, '#d9b44a'); circle(g, 3, 0, 1.5, '#d9b44a');
  },
  desk(g) {
    shadow(g, 6); g.fillStyle = '#7a4f2a'; g.fillRect(-20, -12, 40, 24); noShadow(g);
    g.fillStyle = '#efe6cf'; g.fillRect(-12, -6, 12, 9); g.fillStyle = '#1f2937'; g.fillRect(6, -5, 4, 4);
    g.strokeStyle = '#d6c8a5'; g.lineWidth = 1; g.beginPath(); g.moveTo(-10, -3); g.lineTo(-3, -3); g.moveTo(-10, 0); g.lineTo(-4, 0); g.stroke();
  },
  fireplace(g) {
    glow(g, 55); g.fillStyle = '#4b4540'; g.fillRect(-22, -20, 44, 16);
    g.fillStyle = '#1a1512'; g.fillRect(-14, -14, 28, 14);
    flame(g, -4, -8, 1.1); flame(g, 5, -7, .9);
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1.5; g.strokeRect(-22, -20, 44, 16);
  },
  bar(g) {
    shadow(g, 5); g.fillStyle = '#6b4423'; g.fillRect(-H, -8, CELL, 16); noShadow(g);
    g.fillStyle = '#8b5e34'; g.fillRect(-H, -8, CELL, 5);
    circle(g, -12, 2, 3, '#d4a017'); circle(g, 8, 3, 3, '#e6dcc4');
  },
  rug(g) {
    g.fillStyle = '#7f1d1d'; g.fillRect(-22, -16, 44, 32);
    g.strokeStyle = '#d4a017'; g.lineWidth = 2; g.strokeRect(-18, -12, 36, 24);
    g.strokeStyle = '#1e3a8a'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -8); g.lineTo(10, 0); g.lineTo(0, 8); g.lineTo(-10, 0); g.closePath(); g.stroke();
  },
  chest(g) {
    shadow(g); rr(g, -17, -12, 34, 24, 3); g.fillStyle = '#7b4a22'; g.fill(); noShadow(g);
    g.fillStyle = '#c9a03a'; g.fillRect(-17, -2, 34, 4); g.fillRect(-4, -12, 3, 24); g.fillRect(1, -12, 3, 24);
    g.fillStyle = '#3a2410'; g.fillRect(-2, -1, 4, 5);
  },
  chestopen(g) { // lid thrown back, coins and a glint inside
    shadow(g); rr(g, -17, -4, 34, 16, 3); g.fillStyle = '#7b4a22'; g.fill(); noShadow(g);
    g.fillStyle = '#2a170a'; g.fillRect(-14, -2, 28, 9);
    for (const [x, y, r] of [[-8, 2, 3.2], [-2, 3, 3.4], [5, 1, 3.2], [10, 3, 2.8], [1, 0, 2.6]]) { g.fillStyle = '#e8b93a'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.fillStyle = '#fff1b0'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, 7); g.fill(); }
    rr(g, -17, -20, 34, 14, 3); g.fillStyle = '#5e3818'; g.fill(); // the lid, open behind
    g.fillStyle = '#c9a03a'; g.fillRect(-17, -9, 34, 3); g.fillRect(-4, -20, 3, 14); g.fillRect(1, -20, 3, 14);
  },
  // ----- ships and mines (1.11) -----
  mast(g) { // seen from above: the mast, its yard and the furled sail along it
    shadow(g, 8); g.fillStyle = '#e8dcc0'; rr(g, -H + 3, -6, CELL - 6, 12, 6); g.fill(); noShadow(g);
    g.strokeStyle = 'rgba(120,100,70,.6)'; g.lineWidth = 1; for (let x = -H + 9; x < H - 6; x += 6) { g.beginPath(); g.moveTo(x, -6); g.lineTo(x, 6); g.stroke(); }
    g.fillStyle = '#6b4423'; g.fillRect(-H + 1, -1.5, CELL - 2, 3);
    circle(g, 0, 0, 7, '#7a4f2a'); circle(g, 0, 0, 4, '#5b3a1e');
  },
  cannon(g) {
    shadow(g, 5); g.fillStyle = '#6b4423'; g.fillRect(-12, -9, 20, 18); noShadow(g);
    circle(g, -9, -10, 3.5, '#3a2a1a'); circle(g, -9, 10, 3.5, '#3a2a1a'); circle(g, 5, -10, 3.5, '#3a2a1a'); circle(g, 5, 10, 3.5, '#3a2a1a');
    g.fillStyle = grad(g, 0, -6, 0, 6, '#5a5f66', '#22252a'); rr(g, -14, -5.5, 36, 11, 5); g.fill();
    circle(g, 22, 0, 5.5, '#2a2d31'); circle(g, 22, 0, 2.5, '#0b0c0e');
  },
  helm(g) {
    shadow(g, 4); g.strokeStyle = '#6b4423'; g.lineWidth = 3.5; circle(g, 0, 0, 13); g.stroke(); noShadow(g);
    g.lineWidth = 3; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(Math.cos(a) * 4, Math.sin(a) * 4); g.lineTo(Math.cos(a) * 19, Math.sin(a) * 19); g.stroke(); circle(g, Math.cos(a) * 19, Math.sin(a) * 19, 2.6, '#8b5e34'); }
    circle(g, 0, 0, 5, '#8b5e34'); circle(g, 0, 0, 2, '#c9a03a');
  },
  rails(g) { // a straight run of mine track
    for (let x = -H + 3; x < H; x += 9) { g.fillStyle = '#5b3a1e'; g.fillRect(x, -15, 5, 30); }
    g.fillStyle = '#9aa0a6'; g.fillRect(-H, -11, CELL, 3); g.fillRect(-H, 8, CELL, 3);
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(-H, -11, CELL, 1); g.fillRect(-H, 8, CELL, 1);
  },
  minecart(g) {
    shadow(g, 6); g.fillStyle = '#4b4f55'; rr(g, -17, -13, 34, 26, 3); g.fill(); noShadow(g);
    g.fillStyle = '#2a2d31'; g.fillRect(-14, -10, 28, 20);
    for (const [x, y, r] of [[-7, -3, 5], [2, -5, 4.5], [8, 3, 5], [-3, 5, 4]]) { g.fillStyle = '#6b6560'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.fillStyle = '#c9a03a'; g.fillRect(x - 1, y - 1, 2, 2); }
    g.fillStyle = '#7a7f86'; g.fillRect(-17, -2, 34, 3);
  },
  hammock(g) {
    g.strokeStyle = '#5b3a1e'; g.lineWidth = 2; g.beginPath(); g.moveTo(-H + 1, 0); g.lineTo(-17, 0); g.moveTo(17, 0); g.lineTo(H - 1, 0); g.stroke();
    shadow(g, 4); g.fillStyle = '#d6c7a1'; g.beginPath(); g.ellipse(0, 0, 18, 8, 0, 0, 7); g.fill(); noShadow(g);
    g.strokeStyle = 'rgba(120,100,70,.5)'; g.lineWidth = 1; for (let x = -12; x <= 12; x += 6) { g.beginPath(); g.moveTo(x, -6); g.lineTo(x, 6); g.stroke(); }
  },
  anchor(g) {
    shadow(g, 4); g.strokeStyle = '#3e4248'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, -16); g.lineTo(0, 14); g.moveTo(-8, -10); g.lineTo(8, -10); g.stroke();
    g.beginPath(); g.arc(0, 2, 13, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke(); noShadow(g);
    circle(g, 0, -19, 4); g.lineWidth = 2.5; g.stroke(); g.lineCap = 'butt';
  },
  crate(g) {
    shadow(g); g.fillStyle = '#9a6b3c'; g.fillRect(-16, -16, 32, 32); noShadow(g);
    g.strokeStyle = '#5b3a1c'; g.lineWidth = 3; g.strokeRect(-14.5, -14.5, 29, 29);
    g.beginPath(); g.moveTo(-14, -14); g.lineTo(14, 14); g.moveTo(14, -14); g.lineTo(-14, 14); g.stroke();
  },
  barrel(g) {
    shadow(g); g.fillStyle = (() => { const k = g.createRadialGradient(-4, -4, 2, 0, 0, 15); k.addColorStop(0, '#a87543'); k.addColorStop(1, '#5e3b1d'); return k; })();
    circle(g, 0, 0, 14); g.fill(); noShadow(g);
    g.strokeStyle = '#3b3b3b'; g.lineWidth = 2.5; circle(g, 0, 0, 13); g.stroke(); g.lineWidth = 1.5; circle(g, 0, 0, 8); g.stroke();
  },
  sack(g, r) {
    for (const [x, y] of [[-8, -4], [7, -6], [0, 7]]) { shadow(g, 4); g.beginPath(); g.ellipse(x, y, 9, 8, r() * 2, 0, 7); g.fillStyle = '#b89b6a'; g.fill(); noShadow(g); circle(g, x, y - 5, 2, '#7a6440'); }
  },
  throne(g) {
    shadow(g, 8); g.fillStyle = '#7c5a12'; g.fillRect(-16, -18, 32, 34); noShadow(g);
    g.fillStyle = '#9b1c1c'; g.fillRect(-11, -8, 22, 20);
    g.fillStyle = '#d4a017'; g.fillRect(-16, -18, 32, 8); circle(g, -12, -20, 3, '#d4a017'); circle(g, 12, -20, 3, '#d4a017'); circle(g, 0, -21, 3.5, '#d4a017');
  },
  candle(g) {
    glow(g, 40, 'rgba(255,210,120,.4)'); circle(g, 0, 0, 7, '#a08040');
    for (const [x, y] of [[0, -6], [-6, 4], [6, 4]]) { circle(g, x, y, 2.6, '#f5f0e0'); circle(g, x, y, 1.6, '#ffcf6b'); }
  },
  cauldron(g) {
    glow(g, 24, 'rgba(120,255,120,.25)'); shadow(g, 6); circle(g, 0, 0, 15, '#2a2a2a'); noShadow(g);
    circle(g, 0, 0, 11, '#3f8f3a'); circle(g, -3, -2, 2.5, '#7be070'); circle(g, 4, 3, 1.8, '#7be070');
  },

  // ----- dungeon -----
  pillar(g) {
    shadow(g, 8); const k = g.createRadialGradient(-5, -5, 2, 0, 0, 18); k.addColorStop(0, '#b4aea3'); k.addColorStop(1, '#5d5850');
    circle(g, 0, 0, 17); g.fillStyle = k; g.fill(); noShadow(g);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.5; circle(g, 0, 0, 12); g.stroke();
  },
  brokenpillar(g, r) {
    shadow(g, 6); g.beginPath(); g.moveTo(-15, -6); g.lineTo(-6, -16); g.lineTo(9, -13); g.lineTo(16, 2); g.lineTo(6, 15); g.lineTo(-12, 11); g.closePath();
    g.fillStyle = '#8a847a'; g.fill(); noShadow(g);
    for (let i = 0; i < 5; i++) circle(g, r() * 40 - 20, r() * 40 - 20, 2 + r() * 3, '#77716a');
  },
  stairs(g) {
    for (let i = 0; i < 6; i++) {
      const v = 150 - i * 18; g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      g.fillRect(-H + 4, -H + 4 + i * 7, CELL - 8, 7);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-H + 4, -H + 10 + i * 7, CELL - 8, 1);
    }
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1; g.strokeRect(-H + 4, -H + 4, CELL - 8, 42);
  },
  ladder(g) {
    g.strokeStyle = '#7a4f2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(-8, -20); g.lineTo(-8, 20); g.moveTo(8, -20); g.lineTo(8, 20); g.stroke();
    g.lineWidth = 2.5; for (let y = -16; y <= 16; y += 8) { g.beginPath(); g.moveTo(-8, y); g.lineTo(8, y); g.stroke(); }
  },
  trapdoor(g) {
    planks(g, -15, -15, 30, 30, '#6b4423'); g.strokeStyle = '#2a2420'; g.lineWidth = 2.5; g.strokeRect(-15, -15, 30, 30);
    g.fillStyle = '#4b5563'; g.fillRect(-15, -10, 7, 3); g.fillRect(-15, 7, 7, 3); circle(g, 9, 0, 3); g.strokeStyle = '#9ca3af'; g.lineWidth = 1.5; g.stroke();
  },
  altar(g) {
    shadow(g, 6); g.fillStyle = '#6b6560'; g.fillRect(-20, -11, 40, 22); noShadow(g);
    g.fillStyle = '#e8e0cc'; g.fillRect(-20, -11, 40, 5); g.fillStyle = '#7f1d1d'; g.fillRect(-6, -11, 12, 22);
    circle(g, -14, 3, 2.5, '#ffcf6b'); circle(g, 14, 3, 2.5, '#ffcf6b');
  },
  statue(g) {
    shadow(g, 8); g.fillStyle = '#6d6a63'; g.fillRect(-18, -18, 36, 36); noShadow(g);
    circle(g, 0, -4, 7, '#a7a39a'); g.beginPath(); g.ellipse(0, 8, 11, 7, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1.5; g.strokeRect(-18, -18, 36, 36);
  },
  coffin(g) {
    shadow(g, 5); g.beginPath(); g.moveTo(-8, -22); g.lineTo(8, -22); g.lineTo(13, -10); g.lineTo(9, 22); g.lineTo(-9, 22); g.lineTo(-13, -10); g.closePath();
    g.fillStyle = '#4a2e18'; g.fill(); noShadow(g);
    g.strokeStyle = '#c9a03a'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -14); g.lineTo(0, 6); g.moveTo(-5, -8); g.lineTo(5, -8); g.stroke();
  },
  bones(g, r) {
    circle(g, -6, -4, 6, '#e7e0cc'); circle(g, -8, -5, 1.5, '#1f1a14'); circle(g, -4, -5, 1.5, '#1f1a14');
    g.strokeStyle = '#ddd5c0'; g.lineWidth = 3; g.lineCap = 'round';
    for (let i = 0; i < 4; i++) { const x = r() * 30 - 12, y = r() * 24 - 6, a = r() * 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12); g.stroke(); }
    g.lineCap = 'butt';
  },
  rubble(g, r) {
    for (let i = 0; i < 12; i++) { const v = 90 + r() * 50; circle(g, r() * 36 - 18, r() * 36 - 18, 2 + r() * 5, `rgb(${v},${v - 4},${v - 10})`); }
  },
  cage(g) {
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(-18, -18, 36, 36);
    g.strokeStyle = '#6b7280'; g.lineWidth = 2.5; g.strokeRect(-18, -18, 36, 36);
    g.lineWidth = 1.5; for (let k = -12; k <= 12; k += 6) { g.beginPath(); g.moveTo(k, -18); g.lineTo(k, 18); g.stroke(); }
  },
  weaponrack(g) {
    g.fillStyle = '#5b3a1e'; g.fillRect(-H + 4, -3, CELL - 8, 6);
    g.strokeStyle = '#9ca3af'; g.lineWidth = 2;
    for (const x of [-14, -5, 4, 13]) { g.beginPath(); g.moveTo(x, -14); g.lineTo(x, 10); g.stroke(); }
    g.fillStyle = '#9ca3af'; g.beginPath(); g.moveTo(-14, -18); g.lineTo(-11, -12); g.lineTo(-17, -12); g.fill();
    g.fillStyle = '#6b7280'; g.fillRect(2, -16, 8, 5);
  },
  brazier(g) { glow(g, 55); shadow(g, 5); circle(g, 0, 0, 12, '#3a3530'); noShadow(g); circle(g, 0, 0, 9, '#2a1a10'); flame(g, -2, -1, 1.1); flame(g, 3, 2, .8); },
  torch(g) { glow(g, 60); g.fillStyle = '#3a2a1a'; g.fillRect(-2, 2, 4, 12); flame(g, 0, 0, 1); },
  crystal(g) {
    glow(g, 30, 'rgba(140,200,255,.35)');
    for (const [x, y, h, c] of [[-6, 4, 18, '#7dd3fc'], [4, 2, 22, '#a5b4fc'], [10, 8, 12, '#67e8f9']]) {
      g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + 5, y); g.lineTo(x, y + 4); g.lineTo(x - 5, y); g.closePath(); g.fillStyle = c; g.fill();
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1; g.stroke();
    }
  },
  lever(g) {
    g.fillStyle = '#4b5563'; g.fillRect(-8, -4, 16, 8);
    g.strokeStyle = '#7a4f2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(9, -14); g.stroke(); circle(g, 9, -14, 3, '#b91c1c');
  },
  trap(g) {
    g.strokeStyle = '#ef4444'; g.lineWidth = 2; g.setLineDash([4, 3]); g.strokeRect(-20, -20, 40, 40); g.setLineDash([]);
    g.fillStyle = 'rgba(239,68,68,.18)'; g.fillRect(-20, -20, 40, 40);
    g.fillStyle = '#fca5a5'; for (const [x, y] of [[-8, -8], [8, -8], [-8, 8], [8, 8], [0, 0]]) { g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 4, y + 3); g.lineTo(x - 4, y + 3); g.fill(); }
  },

  // ----- village -----
  well(g) {
    shadow(g, 7); circle(g, 0, 0, 17, '#7a7470'); noShadow(g); circle(g, 0, 0, 11, '#1d3f57');
    g.fillStyle = '#5b3a1e'; g.fillRect(-20, -2, 40, 4); circle(g, 0, 0, 3, '#7a4f2a');
  },
  fountain(g) {
    shadow(g, 7); circle(g, 0, 0, 22, '#9a948c'); noShadow(g); circle(g, 0, 0, 18, '#2f6d93');
    circle(g, 0, 0, 6, '#9a948c'); circle(g, 0, 0, 3, '#bfe3f5');
    g.strokeStyle = 'rgba(200,235,255,.5)'; g.lineWidth = 1; circle(g, 0, 0, 11); g.stroke();
  },
  cart(g) {
    shadow(g, 6); planks(g, -22, -12, 36, 24, '#8b5e34'); noShadow(g);
    g.fillStyle = '#3a2a1a'; g.fillRect(-14, -16, 8, 4); g.fillRect(-14, 12, 8, 4);
    g.strokeStyle = '#5b3a1e'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(14, -6); g.lineTo(26, -6); g.moveTo(14, 6); g.lineTo(26, 6); g.stroke();
    circle(g, -4, -2, 4, '#c8a050'); circle(g, 4, 4, 4, '#a3c45a');
  },
  haystack(g, r) {
    shadow(g, 6); circle(g, 0, 0, 18, '#c9a54a'); noShadow(g);
    g.strokeStyle = '#a8862e'; g.lineWidth = 1.2;
    for (let i = 0; i < 18; i++) { const a = r() * 6.28, d = r() * 14; g.beginPath(); g.moveTo(Math.cos(a) * d, Math.sin(a) * d); g.lineTo(Math.cos(a) * d + 5, Math.sin(a) * d + 2); g.stroke(); }
  },
  fence(g) {
    g.strokeStyle = '#7a5530'; g.lineWidth = 3; g.beginPath(); g.moveTo(-H, -2); g.lineTo(H, -2); g.moveTo(-H, 2); g.lineTo(H, 2); g.stroke();
    for (const x of [-H + 3, 0]) { shadow(g, 3); g.fillStyle = '#5b3a1e'; g.fillRect(x - 3, -4, 6, 8); noShadow(g); }
  },
  signpost(g) {
    shadow(g, 3); circle(g, 0, 0, 3, '#5b3a1e'); noShadow(g);
    g.fillStyle = '#8b5e34'; g.beginPath(); g.moveTo(-3, -9); g.lineTo(16, -9); g.lineTo(20, -5); g.lineTo(16, -1); g.lineTo(-3, -1); g.fill();
    g.beginPath(); g.moveTo(3, 2); g.lineTo(-16, 2); g.lineTo(-20, 6); g.lineTo(-16, 10); g.lineTo(3, 10); g.fill();
  },
  lamppost(g) { glow(g, 70, 'rgba(255,220,140,.35)'); circle(g, 0, 0, 5, '#2a2a2a'); circle(g, 0, 0, 3, '#ffe39a'); },
  stall(g) {
    shadow(g, 6); g.fillStyle = '#7a4f2a'; g.fillRect(-22, -6, 44, 18); noShadow(g);
    for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#f5f0e0' : '#b91c1c'; g.fillRect(-24 + i * 8, -20, 8, 14); }
    for (const [x, c] of [[-14, '#dc2626'], [-5, '#f59e0b'], [5, '#65a30d'], [14, '#7c3aed']]) circle(g, x, 3, 3.5, c);
  },
  tent(g) {
    shadow(g, 8); g.beginPath(); g.moveTo(-20, -18); g.lineTo(20, -18); g.lineTo(20, 18); g.lineTo(-20, 18); g.closePath(); g.fillStyle = '#a89068'; g.fill(); noShadow(g);
    g.fillStyle = '#8a7350'; g.beginPath(); g.moveTo(-20, -18); g.lineTo(0, 0); g.lineTo(-20, 18); g.fill(); g.beginPath(); g.moveTo(20, -18); g.lineTo(0, 0); g.lineTo(20, 18); g.fill();
    g.strokeStyle = '#5b4a30'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -18); g.lineTo(0, 18); g.stroke();
  },
  campfire(g) {
    glow(g, 65); for (let i = 0; i < 8; i++) { const a = i * .785; circle(g, Math.cos(a) * 13, Math.sin(a) * 13, 4, '#6b6560'); }
    g.strokeStyle = '#5b3a1e'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(-8, -6); g.lineTo(8, 6); g.moveTo(8, -6); g.lineTo(-8, 6); g.stroke();
    flame(g, 0, 0, 1.4);
  },
  anvil(g) {
    shadow(g, 5); g.fillStyle = '#3f3f46'; g.beginPath(); g.moveTo(-16, -6); g.lineTo(10, -6); g.lineTo(20, -2); g.lineTo(10, 2); g.lineTo(6, 6); g.lineTo(-10, 6); g.lineTo(-12, 2); g.lineTo(-16, 2); g.closePath(); g.fill(); noShadow(g);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(-14, -5, 22, 2);
  },
  grave(g) {
    g.fillStyle = 'rgba(70,50,30,.5)'; g.fillRect(-9, -4, 18, 22);
    shadow(g, 4); rr(g, -10, -16, 20, 12, [8, 8, 2, 2]); g.fillStyle = '#8a857e'; g.fill(); noShadow(g);
    g.strokeStyle = '#5d5953'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -13); g.lineTo(0, -7); g.moveTo(-3, -11); g.lineTo(3, -11); g.stroke();
  },
  logs(g) {
    for (const y of [-9, 0, 9]) { shadow(g, 3); g.fillStyle = '#6b4423'; g.fillRect(-18, y - 4, 36, 8); noShadow(g); circle(g, 18, y, 4, '#c8a070'); circle(g, 18, y, 1.8, '#8b5e34'); }
  },
  bridge(g) {
    for (let x = -H; x < H; x += 7) { g.fillStyle = (x / 7) % 2 ? '#8b5e34' : '#7a5030'; g.fillRect(x, -H + 2, 6.5, CELL - 4); }
    g.fillStyle = '#5b3a1e'; g.fillRect(-H, -H + 2, CELL, 3); g.fillRect(-H, H - 5, CELL, 3);
  },
  boat(g) {
    shadow(g, 6); g.beginPath(); g.moveTo(-24, 0); g.quadraticCurveTo(-14, -11, 14, -10); g.lineTo(24, 0); g.lineTo(14, 10); g.quadraticCurveTo(-14, 11, -24, 0);
    g.fillStyle = '#7a4f2a'; g.fill(); noShadow(g);
    g.fillStyle = '#5b3a1e'; g.fillRect(-6, -8, 3, 16); g.fillRect(6, -8, 3, 16);
  },

  // ----- nature -----
  tree(g, r) {
    shadow(g, 10); circle(g, 0, 0, 30, '#2f4a1c'); noShadow(g);
    for (let i = 0; i < 9; i++) { const a = r() * 6.28, d = r() * 16, v = r() * 30; circle(g, Math.cos(a) * d, Math.sin(a) * d, 9 + r() * 9, `rgb(${50 + v},${85 + v},${32 + v / 2})`); }
    circle(g, -8, -8, 10, 'rgba(200,240,140,.15)');
  },
  pine(g) {
    shadow(g, 9); g.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * 6.28, d = i % 2 ? 14 : 24; g.lineTo(Math.cos(a) * d, Math.sin(a) * d); }
    g.closePath(); g.fillStyle = '#1f4d2b'; g.fill(); noShadow(g);
    g.beginPath(); for (let i = 0; i < 16; i++) { const a = (i / 16) * 6.28 + .2, d = i % 2 ? 7 : 14; g.lineTo(Math.cos(a) * d, Math.sin(a) * d); }
    g.closePath(); g.fillStyle = '#2c6a3b'; g.fill(); circle(g, 0, 0, 3, '#4a7c45');
  },
  deadtree(g, r) {
    g.strokeStyle = '#4a3a2a'; g.lineCap = 'round';
    for (let i = 0; i < 7; i++) { const a = r() * 6.28, l = 12 + r() * 14; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * l, Math.sin(a) * l); g.stroke(); }
    g.lineCap = 'butt'; circle(g, 0, 0, 6, '#5a4632');
  },
  bush(g, r) {
    shadow(g, 5); for (let i = 0; i < 6; i++) { const a = r() * 6.28, d = 4 + r() * 8, v = r() * 25; circle(g, Math.cos(a) * d, Math.sin(a) * d, 8 + r() * 4, `rgb(${55 + v},${95 + v},${38 + v})`); }
    noShadow(g);
  },
  rock(g, r) {
    shadow(g, 7); g.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.28, d = 13 + r() * 8; i ? g.lineTo(Math.cos(a) * d, Math.sin(a) * d) : g.moveTo(Math.cos(a) * d, Math.sin(a) * d); }
    g.closePath(); g.fillStyle = grad(g, -15, -15, 15, 15, '#9b958b', '#55514a'); g.fill(); noShadow(g);
    g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1.5; g.stroke();
  },
  flowers(g, r) {
    const cols = ['#f472b6', '#facc15', '#f8fafc', '#a78bfa', '#fb923c'];
    for (let i = 0; i < 14; i++) { const x = r() * 40 - 20, y = r() * 40 - 20; circle(g, x, y, 2.5, cols[Math.floor(r() * cols.length)]); circle(g, x, y, 1, '#fde68a'); }
  },
  stump(g) {
    shadow(g, 4); circle(g, 0, 0, 11, '#5b3a1e'); noShadow(g); circle(g, 0, 0, 8.5, '#b08850');
    g.strokeStyle = 'rgba(90,60,30,.6)'; g.lineWidth = 1; circle(g, 0, 0, 5.5); g.stroke(); circle(g, 0, 0, 2.5); g.stroke();
  },
  log(g) {
    shadow(g, 5); rr(g, -24, -6, 48, 12, 5); g.fillStyle = '#5b3a1e'; g.fill(); noShadow(g);
    g.strokeStyle = 'rgba(30,18,8,.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-20, -2); g.lineTo(18, -2); g.moveTo(-18, 2); g.lineTo(20, 2); g.stroke();
    circle(g, 23, 0, 5.5, '#b08850');
  },
  mushrooms(g, r) {
    for (let i = 0; i < 6; i++) { const x = r() * 30 - 15, y = r() * 30 - 15, s = 3 + r() * 4; circle(g, x, y, s, r() > .5 ? '#b91c1c' : '#c08a4a'); circle(g, x - s / 3, y - s / 3, s / 3, 'rgba(255,255,255,.7)'); }
  },
  reeds(g, r) {
    g.strokeStyle = '#6b8f3a'; g.lineWidth = 1.5;
    for (let i = 0; i < 18; i++) { const x = r() * 36 - 18, y = r() * 36 - 18; g.beginPath(); g.moveTo(x, y); g.lineTo(x + r() * 6 - 3, y - 8); g.stroke(); }
    for (let i = 0; i < 4; i++) { g.fillStyle = '#6b4423'; g.fillRect(r() * 30 - 15, r() * 30 - 20, 2.5, 6); }
  },
  lilypad(g, r) {
    for (let i = 0; i < 4; i++) {
      const x = r() * 30 - 15, y = r() * 30 - 15, s = 5 + r() * 4, a = r() * 6;
      g.beginPath(); g.moveTo(x, y); g.arc(x, y, s, a, a + 5.6); g.closePath(); g.fillStyle = '#3f7d3a'; g.fill();
      if (i === 0) circle(g, x, y, 2.5, '#f9a8d4');
    }
  }
};

export function drawProp(g, p, opts) {
  const fn = P[p.kind]; if (!fn) return;
  lit = !!(opts && opts.lit);
  g.save();
  g.translate(p.x * CELL + H, p.y * CELL + H);
  g.rotate((p.rot || 0) * Math.PI / 2);
  fn(g, rng(cellHash(p.x, p.y) + 7));
  g.restore();
  lit = false;
}

// Small preview icons for the palettes.
export function swatch(kind, isProp) {
  const c = document.createElement('canvas'); c.width = c.height = 40;
  const g = c.getContext('2d');
  if (isProp) {
    g.fillStyle = '#2a2a2a'; g.fillRect(0, 0, 40, 40);
    g.scale(40 / CELL, 40 / CELL);
    if (['window', 'secretdoor', 'bars', 'portcullis', 'archway'].includes(kind)) { g.fillStyle = '#3d3934'; g.fillRect(0, 18, CELL, 14); }
    drawProp(g, { kind, x: 0, y: 0, rot: 0 });
  } else g.drawImage(texture(kind, 1, 2), 0, 0, 40, 40);
  return c;
}
