// Dice that roll across the screen: real polyhedra (d4, d6, d8, d10, d12, d20, d100 as two d10s), thrown, bouncing
// and tumbling, then settling on the result the server rolled. Drawn on a transparent canvas over the map.
// Skins: built-in colours, or a picture of the player's own.

export const SKINS = [
  { id: 'ivory', name: 'Ivory', a: '#fbf6e9', b: '#d9cfb6', edge: '#a89c80', ink: '#3a2c1a' },
  { id: 'obsidian', name: 'Obsidian', a: '#4a4a55', b: '#141418', edge: '#000000', ink: '#e8d9a8' },
  { id: 'ruby', name: 'Ruby', a: '#e0465a', b: '#7a0e1f', edge: '#4a0612', ink: '#fff3d6' },
  { id: 'sapphire', name: 'Sapphire', a: '#4f8de8', b: '#12306e', edge: '#0a1c44', ink: '#ffffff' },
  { id: 'emerald', name: 'Emerald', a: '#3fc07a', b: '#0d5a33', edge: '#06341c', ink: '#f4ffe8' },
  { id: 'amethyst', name: 'Amethyst', a: '#a874e8', b: '#4a1d7a', edge: '#2a0e48', ink: '#fff6d6' },
  { id: 'gold', name: 'Gold', a: '#ffe08a', b: '#b07a12', edge: '#6e4a06', ink: '#3a2400' },
  { id: 'bone', name: 'Bone', a: '#efe6d0', b: '#a8987a', edge: '#6e604a', ink: '#5a1010' },
  { id: 'wood', name: 'Oak', a: '#b07a46', b: '#5e3a1c', edge: '#3a220e', ink: '#fbe9c8' },
  { id: 'ice', name: 'Frost', a: '#e6f6ff', b: '#7ab8e0', edge: '#3e7aa8', ink: '#0e3456' },
  { id: 'fire', name: 'Ember', a: '#ffb02e', b: '#c2260e', edge: '#5e0e04', ink: '#fff8e0' },
  { id: 'jade', name: 'Jade', a: '#9fe0c2', b: '#2e7a5c', edge: '#174a36', ink: '#0e2a1e' }
];
export const skinById = (id) => SKINS.find((s) => s.id === id) || null;
// the look for someone who hasn't chosen: the same built-in skin for the same name, every time
export function defaultSkin(name) { let h = 0; for (const ch of String(name || '').toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) | 0; return SKINS[Math.abs(h) % SKINS.length]; }

// ---------- shapes ----------
const PHI = (1 + Math.sqrt(5)) / 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]), unit = (a) => mul(a, 1 / (len(a) || 1));

function vertsOf(kind) {
  const v = [];
  if (kind === 4) v.push([1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]);
  else if (kind === 6) { for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]); }
  else if (kind === 8) v.push([1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]);
  else if (kind === 10) {
    const h = 1.1, c = Math.cos(Math.PI / 5), a = h * (1 - c) / (1 + c);
    v.push([0, 0, h], [0, 0, -h]);
    for (let k = 0; k < 10; k++) { const t = k * Math.PI / 5; v.push([Math.cos(t), Math.sin(t), k % 2 ? -a : a]); }
  } else if (kind === 12) {
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
    for (const a of [-1, 1]) for (const b of [-1, 1]) v.push([0, a / PHI, b * PHI], [a / PHI, b * PHI, 0], [a * PHI, 0, b / PHI]);
  } else { // 20
    for (const a of [-1, 1]) for (const b of [-1, 1]) v.push([0, a, b * PHI], [a, b * PHI, 0], [a * PHI, 0, b]);
  }
  const r = Math.max(...v.map(len));
  return v.map((p) => mul(p, 1 / r));
}
// the faces of a convex solid: every plane through three corners with all the others behind it
function facesOf(V) {
  const seen = new Set(), faces = [], eps = 1e-6;
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) for (let k = j + 1; k < V.length; k++) {
    let n = cross(sub(V[j], V[i]), sub(V[k], V[i])); if (len(n) < 1e-9) continue; n = unit(n);
    let d = dot(n, V[i]), pos = 0, neg = 0; const on = [];
    V.forEach((p, m) => { const s = dot(n, p) - d; if (Math.abs(s) < eps) on.push(m); else if (s > 0) pos++; else neg++; });
    if (pos && neg) continue;
    if (pos) { n = mul(n, -1); d = -d; }
    const key = on.slice().sort((a, b) => a - b).join(',');
    if (seen.has(key)) continue; seen.add(key);
    const c = mul(on.reduce((s, m) => add(s, V[m]), [0, 0, 0]), 1 / on.length);
    const e1 = unit(sub(V[on[0]], c)), e2 = cross(n, e1);
    on.sort((a, b) => Math.atan2(dot(sub(V[a], c), e2), dot(sub(V[a], c), e1)) - Math.atan2(dot(sub(V[b], c), e2), dot(sub(V[b], c), e1)));
    faces.push({ idx: on, n, c });
  }
  return faces;
}
const SHAPES = {};
function shape(kind) {
  if (SHAPES[kind]) return SHAPES[kind];
  const V = vertsOf(kind), F = facesOf(V);
  for (const f of F) { // which way is up on the face, for its number
    const pts = f.idx.map((i) => V[i]);
    let toward;
    if (kind === 10) toward = pts.reduce((b, p) => (Math.abs(p[2]) > Math.abs(b[2]) ? p : b)); // the tip of the kite
    else if (pts.length % 2 === 0) toward = mul(add(pts[0], pts[1]), 0.5); // the middle of an edge
    else toward = pts[0]; // a corner
    let up = sub(toward, f.c); up = unit(sub(up, mul(f.n, dot(up, f.n))));
    f.up = up; f.right = cross(f.n, up);
    // how big the number can be: the distance from the middle to the nearest edge
    let inr = 1e9; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], ab = unit(sub(b, a)), ac = sub(f.c, a); inr = Math.min(inr, len(sub(ac, mul(ab, dot(ac, ab))))); }
    f.inr = inr;
  }
  return (SHAPES[kind] = { V, F });
}

// ---------- rotations (quaternions [w, x, y, z]) ----------
const qmul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2], a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
const qnorm = (q) => { const l = Math.hypot(...q) || 1; return q.map((x) => x / l); };
function qmat(q) {
  const [w, x, y, z] = q;
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
}
function qfromMat(m) {
  const t = m[0][0] + m[1][1] + m[2][2];
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; return qnorm([0.25 * s, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s]); }
  if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; return qnorm([(m[2][1] - m[1][2]) / s, 0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s]); }
  if (m[1][1] > m[2][2]) { const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; return qnorm([(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s]); }
  const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; return qnorm([(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s]);
}
function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map((x) => -x); d = -d; }
  if (d > 0.9995) return qnorm(a.map((x, i) => x + (b[i] - x) * t));
  const th = Math.acos(d), s = Math.sin(th);
  return a.map((x, i) => (x * Math.sin((1 - t) * th) + b[i] * Math.sin(t * th)) / s);
}
const rot = (m, v) => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
// the turn that puts face f flat towards the viewer, its number upright (tilted by ang)
function restOn(f, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const G = [[c, s, 0], [s, -c, 0], [0, 0, 1]]; // columns: where right, up and the face's outside go on screen (y is down)
  const F = [f.right, f.up, f.n]; // rows of F^T
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) m[i][j] += G[i][k] * F[k][j];
  return qfromMat(m);
}

// ---------- the dice of one roll ----------
const rand = (a, b) => a + Math.random() * (b - a);
function labels(kind, sides, tens) {
  const n = shape(kind).F.length;
  return Array.from({ length: n }, (_, i) => {
    if (tens) return i === 0 ? '00' : String(i * 10);
    if (kind === 10) return String(i + 1);
    return String((i % sides) + 1);
  });
}
// one die on screen: { kind, labels, face (the one it lands on), text override }
function diceFor(entry) {
  const out = [];
  for (const d of entry.dice || []) {
    if (out.length >= 24) break;
    const s = d.s;
    if (s === 100) { // two d10s: tens and units
      const tens = Math.floor((d.v % 100) / 10), units = d.v % 10;
      out.push({ kind: 10, labels: labels(10, 10, true), face: tens, kept: d.k });
      out.push({ kind: 10, labels: labels(10, 10, false), face: (units || 10) - 1, kept: d.k });
    } else if ([4, 6, 8, 10, 12, 20].includes(s)) out.push({ kind: s, labels: labels(s, s), face: d.v - 1, kept: d.k });
    else { // an unusual die: a d20 shape showing the number
      const L = labels(20, s); L[0] = String(d.v); out.push({ kind: 20, labels: L, face: 0, kept: d.k });
    }
  }
  return out;
}

export function createDice(canvas, { onHit } = {}) {
  const g = canvas.getContext('2d');
  const groups = [], images = new Map();
  let raf = 0, last = 0;
  const L = unit([-0.45, -0.75, 0.9]); // light from the top left

  function img(url) {
    if (!images.has(url)) { const im = new Image(); im.src = url; images.set(url, im); }
    const im = images.get(url); return im.complete && im.naturalWidth ? im : null;
  }
  function fit() {
    const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
    return [r.width, r.height, dpr];
  }

  function roll(entry, { note = '' } = {}) {
    const list = diceFor(entry); if (!list.length) return;
    const [W, H] = fit();
    const R = Math.max(22, Math.min(46, Math.min(W, H) * 0.045)) * (list.length > 8 ? 0.8 : 1);
    // thrown in from one side, towards the middle of the free space
    const side = Math.floor(Math.random() * 4);
    let cx = W * rand(0.38, 0.62), cy = H * rand(0.38, 0.6), best = -1;
    for (let k = 0; k < 8 && groups.length; k++) { // away from rolls still on screen
      const x = W * rand(0.22, 0.78), y = H * rand(0.25, 0.72), m = Math.min(...groups.map((G) => Math.hypot(G.cx - x, G.cy - y)));
      if (m > best) { best = m; cx = x; cy = y; }
    }
    const gx = side === 0 ? -R * 2 : side === 1 ? W + R * 2 : W * rand(0.25, 0.75), gy = side === 2 ? -R * 2 : side === 3 ? H + R * 2 : H * rand(0.3, 0.7);
    const per = Math.min(list.length, 6); // in rows of up to six
    const dice = list.map((d, i) => {
      const sx = gx + rand(-R, R), sy = gy + rand(-R, R);
      const T = rand(0.75, 0.95), row = Math.floor(i / per), col = i % per, inRow = Math.min(per, list.length - row * per);
      const tx = cx + (col - (inRow - 1) / 2) * R * 2.4 + rand(-R * 0.4, R * 0.4), ty = cy + (row - (Math.ceil(list.length / per) - 1) / 2) * R * 2.4 + rand(-R * 0.4, R * 0.4);
      const sp = shape(d.kind), f = sp.F[d.face % sp.F.length];
      return {
        ...d, sp, x: sx, y: sy, z: rand(40, 90), vx: (tx - sx) / T, vy: (ty - sy) / T, vz: rand(60, 160),
        q: qnorm([rand(-1, 1), rand(-1, 1), rand(-1, 1), rand(-1, 1)]), w: [rand(-16, 16), rand(-16, 16), rand(-16, 16)],
        target: restOn(f, rand(-0.25, 0.25)), settle: null, R, done: false
      };
    });
    const skin = entry.skin && entry.skin.img ? { img: entry.skin.img, ink: entry.skin.ink || '#fff', edge: '#000', a: '#888', b: '#333' } : (entry.skin && skinById(entry.skin.id)) || defaultSkin(entry.who);
    groups.push({ entry, dice, skin, t: 0, rest: 0, note, W, H, cx, cy });
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  function step(G, dt) {
    G.t += dt;
    const W = G.W, H = G.H, MOVE = 1.35, SETTLE = 0.45;
    for (const d of G.dice) {
      if (d.done) continue;
      // fly, fall and bounce
      d.vz -= 1400 * dt; d.z += d.vz * dt;
      if (d.z <= 0) {
        d.z = 0;
        if (d.vz < -40) { if (onHit && G.t < MOVE) onHit(Math.min(1, -d.vz / 500)); d.vz = -d.vz * 0.42; } else d.vz = 0;
        const fr = Math.pow(0.12, dt); d.vx *= fr; d.vy *= fr;
      }
      d.x += d.vx * dt; d.y += d.vy * dt;
      const m = d.R * 1.1;
      if (d.x < m && d.vx < 0) { d.x = m; d.vx = -d.vx * 0.6; } if (d.x > W - m && d.vx > 0 && G.t > 0.4) { d.x = W - m; d.vx = -d.vx * 0.6; }
      if (d.y < m && d.vy < 0 && G.t > 0.4) { d.y = m; d.vy = -d.vy * 0.6; } if (d.y > H - m && d.vy > 0 && G.t > 0.4) { d.y = H - m; d.vy = -d.vy * 0.6; }
      // tumble, slowing on the table, then roll over onto the result
      if (G.t < MOVE - SETTLE) {
        const k = d.z > 0 ? 1 : Math.pow(0.25, dt); d.w = d.w.map((x) => x * k);
        const wq = [0, ...d.w]; const dq = qmul(wq, d.q); d.q = qnorm(d.q.map((x, i) => x + 0.5 * dt * dq[i]));
      } else {
        if (!d.settle) d.settle = { from: d.q, t: 0 };
        d.settle.t = Math.min(1, d.settle.t + dt / SETTLE);
        const e = 1 - Math.pow(1 - d.settle.t, 3);
        d.q = slerp(d.settle.from, d.target, e);
        if (d.settle.t >= 1) { d.q = d.target; d.done = true; d.vx = d.vy = 0; d.z = 0; }
      }
    }
    // dice knock each other aside
    for (let i = 0; i < G.dice.length; i++) for (let j = i + 1; j < G.dice.length; j++) {
      const a = G.dice[i], b = G.dice[j], dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy), min = (a.R + b.R) * 0.95;
      if (dist > 0 && dist < min) { const push = (min - dist) / 2, nx = dx / dist, ny = dy / dist; a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push; const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny; if (rel < 0) { a.vx += rel * nx * 0.9; a.vy += rel * ny * 0.9; b.vx -= rel * nx * 0.9; b.vy -= rel * ny * 0.9; } }
    }
    if (G.dice.every((d) => d.done)) G.rest += dt;
  }

  function fillFor(skin, d, x, y, R) {
    if (skin.img) { const im = img(skin.img); if (im) { const p = g.createPattern(im, 'repeat'); const k = (R * 2.2) / Math.max(im.naturalWidth, im.naturalHeight); p.setTransform(new DOMMatrix().translate(x - R * 1.1, y - R * 1.1).scale(k)); return p; } return '#666'; }
    const gr = g.createLinearGradient(x - R, y - R, x + R, y + R); gr.addColorStop(0, skin.a); gr.addColorStop(1, skin.b); return gr;
  }
  function drawDie(G, d, alpha) {
    const { V, F } = d.sp, M = qmat(d.q), R = d.R * (1 + d.z / 500), x = d.x, y = d.y - d.z * 0.55, skin = G.skin;
    // shadow on the table
    g.save(); g.globalAlpha = alpha * 0.35 * Math.max(0.3, 1 - d.z / 250); g.fillStyle = '#000';
    g.beginPath(); g.ellipse(d.x + R * 0.12 + d.z * 0.25, d.y + R * 0.3, R * 0.95, R * 0.7, 0, 0, 7); g.filter = `blur(${Math.max(2, R * 0.12 + d.z * 0.05)}px)`; g.fill(); g.restore();
    const P = V.map((v) => rot(M, v)), fill = fillFor(skin, d, x, y, R);
    g.save(); g.globalAlpha = alpha * (d.done && d.kept === false ? 0.45 : 1);
    for (const f of F) {
      const n = rot(M, f.n); if (n[2] <= 0.01) continue;
      g.beginPath(); f.idx.forEach((i, k) => { const p = P[i]; if (k) g.lineTo(x + p[0] * R, y + p[1] * R); else g.moveTo(x + p[0] * R, y + p[1] * R); }); g.closePath();
      g.fillStyle = fill; g.fill();
      const lam = dot(n, L);
      g.fillStyle = lam > 0.75 ? `rgba(255,255,255,${(lam - 0.75) * 0.9})` : `rgba(0,0,0,${Math.min(0.6, (0.75 - lam) * 0.75)})`; g.fill();
      g.strokeStyle = skin.edge; g.globalAlpha *= 0.7; g.lineWidth = Math.max(1, R * 0.035); g.lineJoin = 'round'; g.stroke(); g.globalAlpha /= 0.7;
      if (n[2] > 0.2) { // the number, on the face
        const c = rot(M, f.c), r = rot(M, f.right), u = rot(M, f.up), fs = f.inr * (d.labels[0].length > 1 || d.kind === 20 ? 0.95 : 1.15), k = (fs * R) / 50;
        const txt = d.labels[F.indexOf(f)] || '';
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); const dpr = devicePixelRatio || 1;
        g.setTransform(r[0] * k * dpr, r[1] * k * dpr, -u[0] * k * dpr, -u[1] * k * dpr, (x + c[0] * R) * dpr, (y + c[1] * R) * dpr);
        g.globalAlpha = alpha * Math.min(1, (n[2] - 0.2) * 2.5) * (d.done && d.kept === false ? 0.45 : 1);
        g.font = '700 50px Georgia, "Times New Roman", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        if (skin.img) { g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(txt, 0, 3); }
        g.fillStyle = skin.ink; g.fillText(txt, 0, 3);
        if ((txt === '6' || txt === '9') && d.kind !== 6) g.fillRect(-13, 26, 26, 5); // which way up a 6 or 9 is
        g.restore();
      }
    }
    g.restore();
  }
  function drawLabel(G, alpha) {
    const e = G.entry, xs = G.dice.map((d) => d.x), ys = G.dice.map((d) => d.y), R = G.dice[0].R;
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, top = Math.min(...ys) - R * 1.6, bottom = Math.max(...ys) + R * 1.5;
    const y = top > 70 ? top : bottom + 40;
    const crit = e.crit === 'nat20' ? 'gold' : e.crit === 'nat1' ? 'red' : '';
    if (crit === 'gold') { // a burst of light behind the dice
      const k = Math.min(1, G.rest / 0.5), gr = g.createRadialGradient(cx, (Math.min(...ys) + Math.max(...ys)) / 2, 0, cx, (Math.min(...ys) + Math.max(...ys)) / 2, R * (2 + 3 * k));
      gr.addColorStop(0, `rgba(255,214,90,${0.55 * alpha * (1 - k * 0.4)})`); gr.addColorStop(1, 'rgba(255,214,90,0)');
      g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(cx - R * 6, y - R * 6, R * 12, R * 14); g.restore();
    }
    g.save(); g.globalAlpha = alpha; g.textAlign = 'center';
    const title = [e.who, e.label].filter(Boolean).join(' · ') + (G.note ? '  ' + G.note : '');
    g.font = '600 13px system-ui, sans-serif'; const tw = g.measureText(title).width;
    g.font = '700 30px Georgia, serif'; const big = String(e.total), bw = g.measureText(big).width;
    const w = Math.max(tw, bw) + 36, h = 64;
    g.fillStyle = 'rgba(16,14,12,.82)'; g.strokeStyle = crit === 'gold' ? '#f2c14e' : crit === 'red' ? '#d0423a' : 'rgba(255,255,255,.18)'; g.lineWidth = crit ? 2 : 1;
    g.beginPath(); g.roundRect(cx - w / 2, y - h / 2, w, h, 10); g.fill(); g.stroke();
    g.fillStyle = '#cfc6b8'; g.font = '600 13px system-ui, sans-serif'; g.fillText(title, cx, y - 12);
    g.fillStyle = crit === 'gold' ? '#ffd65a' : crit === 'red' ? '#ff6a5a' : '#fff'; g.font = '700 30px Georgia, serif'; g.fillText(big, cx, y + 22);
    if (crit) { g.font = '800 12px system-ui, sans-serif'; g.fillStyle = crit === 'gold' ? '#ffd65a' : '#ff6a5a'; g.fillText(crit === 'gold' ? 'NATURAL 20!' : 'NATURAL 1', cx, y + h / 2 + 16); }
    g.restore();
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const [W, H, dpr] = fit();
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    for (let i = groups.length - 1; i >= 0; i--) {
      const G = groups[i]; G.W = W; G.H = H; step(G, dt);
      const alpha = G.rest > 3.2 ? Math.max(0, 1 - (G.rest - 3.2) / 0.6) : 1;
      for (const d of [...G.dice].sort((a, b) => a.y - b.y)) drawDie(G, d, alpha);
      if (G.rest > 0) drawLabel(G, alpha * Math.min(1, G.rest / 0.25));
      if (G.rest > 3.8) groups.splice(i, 1);
    }
    raf = groups.length ? requestAnimationFrame(frame) : 0;
    if (!raf) g.clearRect(0, 0, W, H);
  }

  return {
    roll,
    busy: () => groups.length > 0,
    clear() { groups.length = 0; },
    // a still die for the skin picker
    preview(c, skinOrEntry, kind = 20) {
      const pg = c.getContext('2d'), sp = shape(kind), M = qmat(qnorm([0.86, 0.32, -0.36, 0.12])), R = c.width * 0.4, x = c.width / 2, y = c.height / 2;
      const skin = skinOrEntry.img ? { ...skinOrEntry, edge: '#000', a: '#888', b: '#333' } : skinOrEntry;
      pg.clearRect(0, 0, c.width, c.height);
      const fillOf = () => { if (skin.img) { const im = img(skin.img); if (!im) return '#666'; const p = pg.createPattern(im, 'repeat'); const k = (R * 2.2) / Math.max(im.naturalWidth, im.naturalHeight); p.setTransform(new DOMMatrix().translate(x - R * 1.1, y - R * 1.1).scale(k)); return p; } const gr = pg.createLinearGradient(x - R, y - R, x + R, y + R); gr.addColorStop(0, skin.a); gr.addColorStop(1, skin.b); return gr; };
      const fill = fillOf(), P = sp.V.map((v) => rot(M, v));
      sp.F.forEach((f, fi) => {
        const n = rot(M, f.n); if (n[2] <= 0.01) return;
        pg.beginPath(); f.idx.forEach((i, k) => { const p = P[i]; if (k) pg.lineTo(x + p[0] * R, y + p[1] * R); else pg.moveTo(x + p[0] * R, y + p[1] * R); }); pg.closePath();
        pg.fillStyle = fill; pg.fill(); const lam = dot(n, L);
        pg.fillStyle = lam > 0.75 ? `rgba(255,255,255,${(lam - 0.75) * 0.9})` : `rgba(0,0,0,${Math.min(0.6, (0.75 - lam) * 0.75)})`; pg.fill();
        pg.strokeStyle = skin.edge; pg.lineWidth = 1; pg.stroke();
        if (n[2] > 0.5) { const c2 = rot(M, f.c), r = rot(M, f.right), u = rot(M, f.up), k = (f.inr * 0.95 * R) / 50; pg.save(); pg.setTransform(r[0] * k, r[1] * k, -u[0] * k, -u[1] * k, x + c2[0] * R, y + c2[1] * R); pg.font = '700 50px Georgia, serif'; pg.textAlign = 'center'; pg.textBaseline = 'middle'; if (skin.img) { pg.lineWidth = 7; pg.strokeStyle = 'rgba(0,0,0,.75)'; pg.strokeText(String(fi + 1), 0, 3); } pg.fillStyle = skin.ink; pg.fillText(String(fi + 1), 0, 3); pg.restore(); }
      });
      return !skin.img || !!img(skin.img);
    }
  };
}
