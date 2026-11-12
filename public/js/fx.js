// Moments on the map: spells going off over their templates, tokens flinching when hurt and glowing when healed,
// and the looks of conditions (burning, poisoned, raging…). All drawn in map space, on top of the tokens.
// Purely for looks: nothing here changes what anyone can see or do.

const rand = (a, b) => a + Math.random() * (b - a);
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

// how each kind of spell looks: duration (s), colour for the template and the glow
export const SPELLS = {
  fire: { name: 'Fire', dur: 2.0, col: '#ff6a1a' },
  lightning: { name: 'Lightning', dur: 1.5, col: '#7ec8ff' },
  cold: { name: 'Cold', dur: 2.2, col: '#9fe4ff' },
  acid: { name: 'Acid', dur: 2.0, col: '#8ee03a' },
  thunder: { name: 'Thunder', dur: 1.6, col: '#d9d4ff' },
  necrotic: { name: 'Necrotic', dur: 2.2, col: '#7a3fb0' },
  radiant: { name: 'Radiant', dur: 2.0, col: '#ffd65a' },
  poison: { name: 'Poison', dur: 2.8, col: '#6fbf3a' },
  force: { name: 'Force', dur: 1.4, col: '#8f7bff' },
  psychic: { name: 'Psychic', dur: 1.8, col: '#ff6ad5' },
  healing: { name: 'Healing', dur: 2.0, col: '#62e08a' }
};
// conditions that move: they keep the map drawing while a token has them
export const LIVE_CONDITIONS = new Set(['burning', 'poisoned', 'raging', 'blessed', 'concentrating', 'frightened', 'invisible', 'hasted', 'bleeding']);

export function createFx({ CELL }) {
  const spells = [], parts = [], toks = new Map(), floats = [], bursts = [];
  const now = () => performance.now() / 1000;

  // ---------- spells ----------
  // cells: the squares the template covers; ox, oy: where it starts (squares); clip(g): the template's outline as a path
  function spell(kind, { cells, ox, oy, clip, shape, angle }) {
    const k = SPELLS[kind]; if (!k || !cells.length) return;
    const centred = shape === 'sphere' || shape === 'cylinder';
    const pts = cells.map(([x, y]) => [(x + 0.5) * CELL, (y + 0.5) * CELL]);
    let cx = ox * CELL, cy = oy * CELL;
    if (shape === 'cube') { cx = pts.reduce((s, p) => s + p[0], 0) / pts.length; cy = pts.reduce((s, p) => s + p[1], 0) / pts.length; }
    const dists = pts.map(([x, y]) => Math.hypot(x - cx, y - cy)), D = Math.max(CELL, ...dists);
    spells.push({ kind, k, t0: now(), pts, dists, D, cx, cy, clip, centred, angle: angle || 0, bolts: [], lastBolt: 0, done: false });
  }
  const pick = (S, front) => { // a random point already reached by the spell's front
    for (let i = 0; i < 6; i++) { const j = (Math.random() * S.pts.length) | 0; if (S.dists[j] <= front + CELL * 0.5) return [S.pts[j][0] + rand(-0.5, 0.5) * CELL, S.pts[j][1] + rand(-0.5, 0.5) * CELL]; }
    return [S.cx, S.cy];
  };
  function emit(S, t, dt) {
    const k = S.kind, life = t / S.k.dur, front = ease(t / (S.k.dur * 0.35)) * S.D, area = S.pts.length;
    const rate = (n) => { let c = n * dt * Math.min(area, 80); while (c > 0) { if (c >= 1 || Math.random() < c) spawn(); c -= 1; } };
    let spawn = () => {};
    if (life > 0.85) return;
    if (k === 'fire') spawn = () => { const [x, y] = pick(S, front); parts.push({ k: 'flame', x, y, vx: rand(-10, 10), vy: rand(-45, -15), r: rand(0.18, 0.4) * CELL, life: 0, max: rand(0.5, 0.9) }); if (Math.random() < 0.2) parts.push({ k: 'smoke', x, y, vx: rand(-6, 6), vy: rand(-25, -10), r: rand(0.25, 0.5) * CELL, life: 0, max: rand(1.0, 1.6) }); if (Math.random() < 0.15) parts.push({ k: 'ember', x, y, vx: rand(-30, 30), vy: rand(-80, -30), r: 2, life: 0, max: rand(0.8, 1.4) }); };
    else if (k === 'cold') spawn = () => { const [x, y] = pick(S, front); if (Math.random() < 0.5) parts.push({ k: 'crystal', x, y, r: rand(0.12, 0.28) * CELL, rot: rand(0, 1), life: 0, max: rand(1.0, 1.6) }); else parts.push({ k: 'mist', x, y, vx: rand(-8, 8), vy: rand(-8, 4), r: rand(0.3, 0.6) * CELL, life: 0, max: rand(1.0, 1.6) }); };
    else if (k === 'acid') spawn = () => { const [x, y] = pick(S, front); parts.push({ k: 'drop', x, y, vx: rand(-60, 60), vy: rand(-90, -30), r: rand(2, 4), life: 0, max: rand(0.4, 0.8), g: 260 }); if (Math.random() < 0.4) parts.push({ k: 'bubble', x, y, r: rand(3, 8), life: 0, max: rand(0.5, 1.0) }); };
    else if (k === 'thunder') spawn = () => { const [x, y] = pick(S, front), a = Math.atan2(y - S.cy, x - S.cx); parts.push({ k: 'dust', x, y, vx: Math.cos(a) * rand(30, 90), vy: Math.sin(a) * rand(30, 90), r: rand(0.15, 0.35) * CELL, life: 0, max: rand(0.6, 1.1) }); };
    else if (k === 'necrotic') spawn = () => { const [x, y] = pick(S, front); parts.push({ k: 'shadow', x, y, vx: rand(-12, 12), vy: rand(-20, -4), r: rand(0.25, 0.5) * CELL, life: 0, max: rand(0.9, 1.5), sw: rand(0, 6) }); if (Math.random() < 0.15) parts.push({ k: 'wisp', x, y, vx: rand(-15, 15), vy: rand(-50, -20), r: 2.5, life: 0, max: rand(0.8, 1.3) }); };
    else if (k === 'radiant') spawn = () => { const [x, y] = pick(S, front); parts.push({ k: Math.random() < 0.25 ? 'beam' : 'spark', x, y, vx: rand(-6, 6), vy: rand(-40, -10), r: Math.random() < 0.25 ? rand(0.15, 0.3) * CELL : rand(1.5, 3), life: 0, max: rand(0.6, 1.1), col: '255,220,120' }); };
    else if (k === 'poison') spawn = () => { const [x, y] = pick(S, front); parts.push({ k: 'cloud', x, y, vx: rand(-10, 10), vy: rand(-10, 6), r: rand(0.35, 0.7) * CELL, life: 0, max: rand(1.4, 2.2) }); };
    else if (k === 'force' || k === 'psychic') spawn = () => { const [x, y] = pick(S, front); parts.push({ k: 'spark', x, y, vx: rand(-20, 20), vy: rand(-20, 20), r: rand(1.5, 3), life: 0, max: rand(0.4, 0.9), col: k === 'force' ? '170,160,255' : '255,140,230' }); };
    else if (k === 'healing') spawn = () => { const [x, y] = pick(S, front); parts.push({ k: 'mote', x, y, vx: rand(-6, 6), vy: rand(-55, -25), r: rand(1.5, 3.2), life: 0, max: rand(0.8, 1.4), col: Math.random() < 0.5 ? '120,240,160' : '255,230,140' }); };
    else if (k === 'lightning') spawn = () => { const [x, y] = pick(S, front); parts.push({ k: 'spark', x, y, vx: rand(-90, 90), vy: rand(-90, 90), r: rand(1, 2.2), life: 0, max: rand(0.15, 0.4), col: '200,230,255' }); };
    rate({ fire: 9, cold: 2.2, acid: 3, thunder: 2.5, necrotic: 3, radiant: 3, poison: 0.9, force: 2, psychic: 2, healing: 3, lightning: 2 }[k] || 2);
  }
  function bolt(x0, y0, x1, y1, rough) { // a jagged line, split in the middle again and again
    let p = [[x0, y0], [x1, y1]];
    for (let d = 0; d < 5; d++) { const q = [p[0]]; for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / (L || 1), ny = (b[0] - a[0]) / (L || 1), o = rand(-1, 1) * L * rough; q.push([(a[0] + b[0]) / 2 + nx * o, (a[1] + b[1]) / 2 + ny * o], b); } p = q; rough *= 0.55; }
    return p;
  }

  function drawSpell(g, S, t) {
    const k = S.kind, life = t / S.k.dur, front = ease(t / (S.k.dur * 0.35)) * S.D;
    const fadeOut = life > 0.6 ? Math.max(0, 1 - (life - 0.6) / 0.4) : 1;
    g.save(); S.clip(g); g.clip();
    // the wash of colour that sweeps across the area
    const wash = (rgb, a, op = 'lighter') => { const gr = g.createRadialGradient(S.cx, S.cy, 0, S.cx, S.cy, Math.max(1, front)); gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(0.85, `rgba(${rgb},${a * 0.7})`); gr.addColorStop(1, `rgba(${rgb},0)`); g.globalCompositeOperation = op; g.fillStyle = gr; g.fillRect(S.cx - S.D - CELL, S.cy - S.D - CELL, (S.D + CELL) * 2, (S.D + CELL) * 2); g.globalCompositeOperation = 'source-over'; };
    if (k === 'fire') { wash('255,120,30', 0.55 * fadeOut); if (t < 0.25) wash('255,240,200', (0.25 - t) * 3); }
    else if (k === 'cold') { wash('180,230,255', 0.4 * fadeOut, 'source-over'); wash('230,250,255', 0.2 * fadeOut); }
    else if (k === 'acid') wash('120,220,40', 0.35 * fadeOut, 'source-over');
    else if (k === 'necrotic') wash('30,10,40', 0.55 * fadeOut, 'source-over');
    else if (k === 'radiant') { wash('255,225,140', 0.5 * fadeOut); if (t < 0.3) wash('255,255,235', (0.3 - t) * 2.5); }
    else if (k === 'poison') wash('90,170,40', 0.3 * fadeOut, 'source-over');
    else if (k === 'force') wash('140,120,255', 0.35 * fadeOut * (0.7 + 0.3 * Math.sin(t * 30)));
    else if (k === 'healing') wash('110,230,150', 0.35 * fadeOut);
    else if (k === 'lightning') { if (Math.random() < 0.5) wash('200,225,255', 0.35 * fadeOut); }
    else if (k === 'thunder' || k === 'psychic') { // rings rolling outwards
      const col = k === 'thunder' ? '235,235,255' : '255,130,225';
      for (let i = 0; i < 3; i++) { const r = ((t * 1.3 - i * 0.18) / 1.0) * S.D * 1.2; if (r <= 0 || r > S.D * 1.25) continue; g.lineWidth = CELL * (k === 'thunder' ? 0.35 : 0.18) * (1 - r / (S.D * 1.3)); g.strokeStyle = `rgba(${col},${0.7 * fadeOut * (1 - r / (S.D * 1.3))})`; g.globalCompositeOperation = 'lighter'; g.beginPath(); g.arc(S.cx, S.cy, r, 0, 7); g.stroke(); }
      g.globalCompositeOperation = 'source-over';
    }
    if (k === 'lightning' && life < 0.7) { // bolts, redrawn a few times a second
      if (t - S.lastBolt > 0.06) {
        S.lastBolt = t; S.bolts = [];
        const n = S.centred ? 5 : 3;
        for (let i = 0; i < n; i++) {
          const far = S.pts.reduce((b, p, j) => (S.dists[j] > S.dists[b] * rand(0.7, 1.1) ? j : b), 0), [tx, ty] = S.centred ? S.pts[(Math.random() * S.pts.length) | 0] : S.pts[far];
          S.bolts.push(bolt(S.centred ? S.cx : S.cx, S.centred ? S.cy : S.cy, tx + rand(-0.4, 0.4) * CELL, ty + rand(-0.4, 0.4) * CELL, 0.35));
        }
      }
      g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; g.lineJoin = 'round';
      for (const b of S.bolts) for (const [w, c] of [[CELL * 0.35, 'rgba(90,150,255,.25)'], [CELL * 0.12, 'rgba(170,210,255,.7)'], [CELL * 0.04, 'rgba(255,255,255,.95)']]) {
        g.lineWidth = w; g.strokeStyle = c; g.beginPath(); b.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
    }
    g.restore();
  }

  function drawParts(g, dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life += dt; if (p.life >= p.max) { parts.splice(i, 1); continue; }
      const u = p.life / p.max; p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; if (p.g) p.vy += p.g * dt;
      const a = Math.sin(Math.PI * Math.min(1, u * 1.4)) * (1 - u * 0.3);
      if (p.k === 'flame') { const r = p.r * (1 - u * 0.5), gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); const c = u < 0.3 ? '255,230,150' : u < 0.6 ? '255,140,40' : '200,50,20'; gr.addColorStop(0, `rgba(${c},${0.8 * a})`); gr.addColorStop(1, `rgba(${c},0)`); g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(p.x - r, p.y - r, r * 2, r * 2); }
      else if (p.k === 'smoke' || p.k === 'shadow' || p.k === 'cloud' || p.k === 'mist' || p.k === 'dust') {
        const r = p.r * (1 + u * 0.8), c = p.k === 'smoke' ? '40,36,34' : p.k === 'shadow' ? '20,6,30' : p.k === 'cloud' ? '110,190,60' : p.k === 'mist' ? '230,248,255' : '150,140,125';
        const op = p.k === 'shadow' ? 0.55 : p.k === 'cloud' ? 0.32 : p.k === 'mist' ? 0.35 : 0.4;
        if (p.sw != null) p.x += Math.sin(p.life * 4 + p.sw) * 0.6;
        const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); gr.addColorStop(0, `rgba(${c},${op * a})`); gr.addColorStop(1, `rgba(${c},0)`); g.globalCompositeOperation = 'source-over'; g.fillStyle = gr; g.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      } else if (p.k === 'crystal') { // a snowflake of ice that grows and fades
        const r = p.r * ease(u * 2.5); g.globalCompositeOperation = 'lighter'; g.strokeStyle = `rgba(220,245,255,${0.85 * (1 - u)})`; g.lineWidth = 1.4; g.beginPath();
        for (let j = 0; j < 6; j++) { const an = p.rot + (j * Math.PI) / 3; g.moveTo(p.x, p.y); g.lineTo(p.x + Math.cos(an) * r, p.y + Math.sin(an) * r); const bx = p.x + Math.cos(an) * r * 0.6, by = p.y + Math.sin(an) * r * 0.6; g.moveTo(bx, by); g.lineTo(bx + Math.cos(an + 0.6) * r * 0.3, by + Math.sin(an + 0.6) * r * 0.3); g.moveTo(bx, by); g.lineTo(bx + Math.cos(an - 0.6) * r * 0.3, by + Math.sin(an - 0.6) * r * 0.3); }
        g.stroke();
      } else if (p.k === 'beam') { const h = CELL * 1.6, gr = g.createLinearGradient(p.x, p.y - h, p.x, p.y); gr.addColorStop(0, 'rgba(255,240,190,0)'); gr.addColorStop(1, `rgba(255,236,170,${0.55 * a})`); g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(p.x - p.r / 2, p.y - h, p.r, h); }
      else if (p.k === 'bubble') { g.globalCompositeOperation = 'source-over'; g.strokeStyle = `rgba(190,255,120,${0.7 * (1 - u)})`; g.lineWidth = 1.2; g.beginPath(); g.arc(p.x, p.y, p.r * (0.5 + u), 0, 7); g.stroke(); }
      else { // spark, ember, drop, wisp, mote: a small bright dot
        const c = p.col || (p.k === 'ember' ? '255,170,70' : p.k === 'drop' ? '170,255,70' : p.k === 'wisp' ? '170,120,255' : '255,255,255');
        g.globalCompositeOperation = p.k === 'drop' ? 'source-over' : 'lighter'; g.fillStyle = `rgba(${c},${a})`; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill();
      }
    }
    g.globalCompositeOperation = 'source-over';
  }

  // ---------- things on the map going off: a chest opened, a trap sprung (x, y: the square) ----------
  function burst(kind, x, y) {
    const cx = (x + 0.5) * CELL, cy = (y + 0.5) * CELL;
    if (kind === 'chest') for (let i = 0; i < 26; i++) parts.push({ k: 'mote', x: cx + rand(-0.3, 0.3) * CELL, y: cy + rand(-0.2, 0.1) * CELL, vx: rand(-12, 12), vy: rand(-70, -25), r: rand(1.4, 3), life: 0, max: rand(0.7, 1.4), col: Math.random() < 0.7 ? '255,215,110' : '255,250,220' });
    if (kind === 'trap') { for (let i = 0; i < 14; i++) { const a = rand(0, 6.28), v = rand(30, 80); parts.push({ k: 'dust', x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: rand(0.15, 0.3) * CELL, life: 0, max: rand(0.6, 1.1) }); } }
    bursts.push({ kind, cx, cy, t0: now() });
  }
  function drawBursts(g) {
    const T = now();
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i], u = T - b.t0;
      if (u > 1.6) { bursts.splice(i, 1); continue; }
      if (b.kind === 'chest') { const k = Math.max(0, 1 - u / 1.2), gr = g.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, CELL * 1.2); gr.addColorStop(0, `rgba(255,210,110,${0.55 * k})`); gr.addColorStop(1, 'rgba(255,210,110,0)'); g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(b.cx - CELL * 1.2, b.cy - CELL * 1.2, CELL * 2.4, CELL * 2.4); g.restore(); }
      if (b.kind === 'trap') { // spikes shoot up, hold, and sink back
        const up = u < 0.12 ? u / 0.12 : u < 0.9 ? 1 : Math.max(0, 1 - (u - 0.9) / 0.5);
        if (u < 0.4) { g.fillStyle = `rgba(220,30,20,${0.4 * (1 - u / 0.4)})`; g.fillRect(b.cx - CELL / 2, b.cy - CELL / 2, CELL, CELL); }
        g.save();
        for (const [dx, dy] of [[-0.28, -0.25], [0.02, -0.3], [0.3, -0.22], [-0.18, 0.12], [0.16, 0.1], [-0.32, 0.32], [0.06, 0.34], [0.32, 0.3]]) {
          const x = b.cx + dx * CELL, y = b.cy + dy * CELL + CELL * 0.12, h = CELL * 0.42 * up, w = CELL * 0.07;
          g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(x + 2, y + 1, w * 1.3, w * 0.6, 0, 0, 7); g.fill();
          const gr = g.createLinearGradient(x - w, 0, x + w, 0); gr.addColorStop(0, '#5a5f66'); gr.addColorStop(0.5, '#d9dde2'); gr.addColorStop(1, '#3e4248');
          g.fillStyle = gr; g.beginPath(); g.moveTo(x - w, y); g.lineTo(x, y - h); g.lineTo(x + w, y); g.closePath(); g.fill();
        }
        g.restore();
      }
    }
  }

  // ---------- tokens ----------
  function hit(id, amount) { toks.set(id, { kind: 'hit', t0: now() }); if (amount != null) floats.push({ id, text: '−' + amount, col: '#ff6a5a', t0: now() }); }
  function heal(id, amount) { toks.set(id, { kind: 'heal', t0: now() }); if (amount != null) floats.push({ id, text: '+' + amount, col: '#6ef0a0', t0: now() }); }
  // how far the token is pushed this moment (a flinch when hit, a shiver when frightened)
  function offset(t) {
    const r = toks.get(t.id), T = now(); let dx = 0, dy = 0;
    if (r && r.kind === 'hit') { const u = T - r.t0; if (u < 0.45) { const k = (1 - u / 0.45) * CELL * 0.08; dx += Math.sin(u * 70) * k; dy += Math.cos(u * 53) * k * 0.5; } }
    if (t.conditions && t.conditions.includes('frightened')) { dx += Math.sin(T * 47) * 0.8; dy += Math.cos(T * 39) * 0.5; }
    return [dx, dy];
  }
  // under the token: auras of conditions
  function under(g, t, cx, cy, rad) {
    const c = t.conditions || [], T = now();
    const aura = (rgb, a, w = 1.25) => { const gr = g.createRadialGradient(cx, cy, rad * 0.6, cx, cy, rad * w); gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, rad * w, 0, 7); g.fill(); };
    if (c.includes('raging')) aura('230,40,30', 0.45 + 0.15 * Math.sin(T * 6));
    if (c.includes('blessed')) aura('255,215,110', 0.35 + 0.1 * Math.sin(T * 2.5), 1.3);
    if (c.includes('hasted')) aura('120,200,255', 0.3 + 0.15 * Math.sin(T * 10), 1.2);
    if (c.includes('burning')) aura('255,120,30', 0.45 + 0.2 * Math.sin(T * 17) * Math.sin(T * 7), 1.3);
  }
  // over the token: flashes, tints and little moving signs
  function over(g, t, cx, cy, rad) {
    const c = t.conditions || [], T = now(), r = toks.get(t.id);
    if (r) {
      const u = T - r.t0;
      if (r.kind === 'hit' && u < 0.6) { g.fillStyle = `rgba(230,30,20,${0.55 * (1 - u / 0.6)})`; g.beginPath(); g.arc(cx, cy, rad - 4, 0, 7); g.fill(); }
      else if (r.kind === 'heal' && u < 1.2) { const k = 1 - u / 1.2, gr = g.createRadialGradient(cx, cy, rad * 0.3, cx, cy, rad * 1.4); gr.addColorStop(0, `rgba(140,255,170,${0.45 * k})`); gr.addColorStop(1, 'rgba(140,255,170,0)'); g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, rad * 1.4, 0, 7); g.fill();
        for (let i = 0; i < 8; i++) { const a = i * 0.785 + u * 2, y = cy + rad * 0.6 - u * rad * 1.4 - (i % 3) * 6; g.fillStyle = `rgba(200,255,200,${k})`; g.beginPath(); g.arc(cx + Math.cos(a) * rad * 0.7, y, 2, 0, 7); g.fill(); } g.restore(); }
      else if (u > 1.5) toks.delete(t.id);
    }
    if (c.includes('poisoned')) { g.fillStyle = `rgba(90,200,40,${0.22 + 0.1 * Math.sin(T * 3)})`; g.beginPath(); g.arc(cx, cy, rad - 4, 0, 7); g.fill(); }
    if (c.includes('petrified')) { g.save(); g.globalCompositeOperation = 'saturation'; g.fillStyle = '#888'; g.beginPath(); g.arc(cx, cy, rad - 4, 0, 7); g.fill(); g.restore(); g.fillStyle = 'rgba(150,150,150,.25)'; g.beginPath(); g.arc(cx, cy, rad - 4, 0, 7); g.fill(); }
    if (c.includes('concentrating')) { g.save(); g.strokeStyle = 'rgba(140,200,255,.85)'; g.lineWidth = 2; g.setLineDash([6, 6]); g.lineDashOffset = -T * 20; g.beginPath(); g.arc(cx, cy, rad + 1, 0, 7); g.stroke(); g.restore(); }
    if (c.includes('burning')) { g.save(); g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 5; i++) { const a = i * 1.25 + T * 1.5, ph = (T * 2.2 + i * 0.37) % 1, x = cx + Math.cos(a) * rad * 0.75, y = cy + Math.sin(a) * rad * 0.6 - ph * rad * 0.6, s = rad * 0.22 * (1 - ph), gr = g.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, `rgba(255,200,90,${0.9 * (1 - ph)})`); gr.addColorStop(1, 'rgba(255,90,20,0)'); g.fillStyle = gr; g.fillRect(x - s, y - s, s * 2, s * 2); } g.restore(); }
    if (c.includes('bleeding')) { const ph = (T * 0.8) % 1; g.fillStyle = `rgba(150,10,10,${0.8 * (1 - ph)})`; g.beginPath(); g.ellipse(cx + rad * 0.35, cy + rad * 0.1 + ph * rad * 0.5, 2.2, 3.2, 0, 0, 7); g.fill(); }
  }
  const tokenAlpha = (t) => ((t.conditions || []).includes('invisible') ? 0.42 + 0.12 * Math.sin(now() * 3) : 1);
  const lying = (t, down) => down || (t.conditions || []).some((c) => c === 'prone' || c === 'unconscious' || c === 'dead');
  // a pool under a fallen creature
  function pool(g, t, cx, cy, rad) {
    g.save(); g.fillStyle = 'rgba(110,8,8,.55)'; g.beginPath();
    for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 2, rr = rad * (0.95 + 0.18 * Math.sin(i * 2.7 + t.id.charCodeAt(0))); i ? g.lineTo(cx + rad * 0.15 + Math.cos(a) * rr, cy + rad * 0.2 + Math.sin(a) * rr * 0.7) : g.moveTo(cx + rad * 0.15 + Math.cos(a) * rr, cy + rad * 0.2 + Math.sin(a) * rr * 0.7); }
    g.fill(); g.restore();
  }
  // numbers that float up from a token
  function drawFloats(g, posOf, zoom) {
    const T = now();
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i], u = (T - f.t0) / 1.4; if (u >= 1) { floats.splice(i, 1); continue; }
      const p = posOf(f.id); if (!p) continue;
      const fs = Math.max(14, 18 / Math.max(0.5, zoom));
      g.save(); g.globalAlpha = u < 0.8 ? 1 : (1 - u) / 0.2; g.font = `800 ${fs}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = fs * 0.22; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(f.text, p[0], p[1] - p[2] - u * CELL * 0.8); g.fillStyle = f.col; g.fillText(f.text, p[0], p[1] - p[2] - u * CELL * 0.8); g.restore();
    }
  }

  let lastT = 0;
  return {
    spell, burst, hit, heal, offset, under, over, tokenAlpha, lying, pool, drawFloats,
    // the spells and their bits, over everything on the map
    draw(g) {
      const T = now(), dt = lastT ? Math.min(0.05, T - lastT) : 0.016; lastT = T;
      for (let i = spells.length - 1; i >= 0; i--) {
        const S = spells[i], t = T - S.t0;
        if (t > S.k.dur) { spells.splice(i, 1); continue; }
        emit(S, t, dt); drawSpell(g, S, t);
      }
      drawParts(g, dt); drawBursts(g);
    },
    // is anything moving (so the map keeps drawing)
    active: () => spells.length > 0 || parts.length > 0 || bursts.length > 0 || floats.length > 0 || [...toks.values()].some((r) => now() - r.t0 < 1.5),
    clear() { spells.length = 0; parts.length = 0; floats.length = 0; toks.clear(); }
  };
}
