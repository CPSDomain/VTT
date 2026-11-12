// A little life on the map, for looks only: cloud shadows and birds over open country by day, fish in the water,
// a rat running along a dungeon wall now and then, and moths round the lights at night.

const rand = (a, b) => a + Math.random() * (b - a);
const OPEN = new Set(['grass', 'sand', 'snow', 'dirt', 'path', 'farm']);
const LIGHTS = new Set(['torch', 'brazier', 'campfire', 'fireplace', 'lamppost', 'candle']);

export function createLife({ CELL }) {
  let key = '', info = null, fish = [], rats = [], flock = null, nextFlock = 0, nextRat = 0, sceneId = null;

  // what kind of place this is, worked out again only when the map changes
  function study(s) {
    const k = s.id + ':' + Object.keys(s.tiles).length + ':' + s.cols + 'x' + s.rows;
    if (k === key) return info;
    key = k; let open = 0, total = 0; const water = [], edges = [];
    const at = (x, y) => s.tiles[x + ',' + y];
    for (const kk in s.tiles) {
      const t = s.tiles[kk]; total++; if (OPEN.has(t)) open++;
      const [x, y] = kk.split(',').map(Number);
      if (t === 'water') water.push([x, y]);
      else if (t !== 'wall' && t !== 'pit' && t !== 'lava') { const w = [at(x, y - 1), at(x, y + 1), at(x - 1, y), at(x + 1, y)].map((v) => v === 'wall'); if (w.some(Boolean)) edges.push([x, y, w]); }
    }
    info = { open: total ? open / total : 0, water, waterSet: new Set(water.map(([x, y]) => x + ',' + y)), edges };
    if (s.id !== sceneId) { sceneId = s.id; fish = []; rats = []; flock = null; }
    return info;
  }
  const inView = (x, y, r) => x >= r[0] - 1 && x <= r[2] + 1 && y >= r[1] - 1 && y <= r[3] + 1;

  // under the light: cloud shadows, fish, rats (night darkens them like everything else)
  function under(g, s, r, t, dt, time) {
    const I = study(s), day = time !== 'night';
    // cloud shadows drifting over open country
    if (I.open > 0.4 && day) {
      g.save(); g.beginPath(); g.rect(0, 0, s.cols * CELL, s.rows * CELL); g.clip();
      const W = s.cols * CELL, H = s.rows * CELL;
      for (let i = 0; i < 3; i++) {
        const R = CELL * (5 + i * 1.5), span = W + R * 4, x = ((t * CELL * (0.18 + i * 0.05) + i * span / 3) % span) - R * 2, y = H * (0.2 + 0.3 * i) + Math.sin(t * 0.05 + i) * CELL * 2;
        for (const [ox, oy, k] of [[0, 0, 1], [R * 0.6, R * 0.2, 0.8], [-R * 0.5, R * 0.3, 0.7], [R * 0.2, -R * 0.35, 0.6]]) {
          const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, R * k); gr.addColorStop(0, 'rgba(10,20,30,.13)'); gr.addColorStop(1, 'rgba(10,20,30,0)');
          g.fillStyle = gr; g.fillRect(x + ox - R * k, y + oy - R * k, R * k * 2, R * k * 2);
        }
      }
      g.restore();
    }
    // fish
    const want = Math.min(10, Math.floor(I.water.length / 8));
    while (fish.length < want) { const [x, y] = I.water[(Math.random() * I.water.length) | 0]; fish.push({ x: x + 0.5, y: y + 0.5, a: rand(0, 6.28), v: rand(0.4, 0.9), turn: 0, size: rand(0.18, 0.3) }); }
    fish.length = Math.min(fish.length, want);
    for (const f of fish) {
      f.turn += rand(-1.5, 1.5) * dt; f.turn *= 0.97; f.a += f.turn * dt * 2;
      const nx = f.x + Math.cos(f.a) * f.v * dt, ny = f.y + Math.sin(f.a) * f.v * dt;
      if (I.waterSet.has(Math.floor(nx + Math.cos(f.a) * 0.3) + ',' + Math.floor(ny + Math.sin(f.a) * 0.3))) { f.x = nx; f.y = ny; } else { f.a += Math.PI * rand(0.6, 1.0); }
      if (!inView(f.x, f.y, r)) continue;
      const x = f.x * CELL, y = f.y * CELL, L = f.size * CELL, sw = Math.sin(t * 9 + f.size * 40) * 0.35;
      g.save(); g.translate(x, y); g.rotate(f.a); g.fillStyle = 'rgba(10,30,40,.42)';
      g.beginPath(); g.ellipse(0, 0, L, L * 0.32, 0, 0, 7); g.fill();
      g.beginPath(); g.moveTo(-L * 0.8, 0); g.lineTo(-L * 1.4, -L * 0.35 + sw * L * 0.3); g.lineTo(-L * 1.4, L * 0.35 + sw * L * 0.3); g.closePath(); g.fill();
      g.restore();
    }
    // a rat along a wall, now and then, in dungeons
    if (I.open < 0.25 && I.edges.length && t > nextRat) {
      nextRat = t + rand(10, 22);
      const seen = I.edges.filter(([x, y]) => inView(x, y, r));
      if (seen.length) {
        const [x, y, w] = seen[(Math.random() * seen.length) | 0], horiz = w[0] || w[1], dir = Math.random() < 0.5 ? -1 : 1;
        const off = horiz ? (w[0] ? -0.32 : 0.32) : (w[2] ? -0.32 : 0.32);
        rats.push({ x: x + 0.5 + (horiz ? 0 : off), y: y + 0.5 + (horiz ? off : 0), dx: horiz ? dir : 0, dy: horiz ? 0 : dir, t0: t, len: rand(3, 6) });
      }
    }
    for (let i = rats.length - 1; i >= 0; i--) {
      const R = rats[i], u = (t - R.t0) * 3.2; if (u > R.len) { rats.splice(i, 1); continue; }
      const x = (R.x + R.dx * u) * CELL, y = (R.y + R.dy * u) * CELL, a = Math.atan2(R.dy, R.dx), k = CELL * 0.1, hop = Math.abs(Math.sin(t * 30)) * 1.5;
      const tile = s.tiles[Math.floor(R.x + R.dx * u) + ',' + Math.floor(R.y + R.dy * u)]; if (!tile || tile === 'wall') { rats.splice(i, 1); continue; }
      g.save(); g.translate(x, y - hop); g.rotate(a);
      g.strokeStyle = 'rgba(70,55,50,.9)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-k * 1.2, 0); g.quadraticCurveTo(-k * 2.2, Math.sin(t * 20) * k, -k * 3.2, 0); g.stroke();
      g.fillStyle = '#5a4a44'; g.beginPath(); g.ellipse(0, 0, k * 1.4, k * 0.75, 0, 0, 7); g.fill();
      g.beginPath(); g.ellipse(k * 1.3, 0, k * 0.6, k * 0.45, 0, 0, 7); g.fill();
      g.fillStyle = '#c99a9a'; g.beginPath(); g.arc(k * 1.1, -k * 0.45, k * 0.22, 0, 7); g.arc(k * 1.1, k * 0.45, k * 0.22, 0, 7); g.fill();
      g.restore();
    }
  }

  // over the light: birds by day, moths round lamps and fires at night
  function over(g, s, r, t, dt, time, dark) {
    const I = study(s);
    if (I.open > 0.35 && time !== 'night' && !dark) {
      if (!flock && t > nextFlock) {
        const fromLeft = Math.random() < 0.5, y0 = rand(r[1], r[3] + 1), n = 3 + ((Math.random() * 4) | 0);
        flock = { x: fromLeft ? r[0] - 3 : r[2] + 4, y: y0, vx: (fromLeft ? 1 : -1) * rand(2.5, 4), vy: rand(-0.6, 0.6), birds: Array.from({ length: n }, (_, i) => ({ ox: -i * 0.7 * (fromLeft ? 1 : -1) + rand(-0.3, 0.3), oy: (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.55 + rand(-0.2, 0.2), ph: rand(0, 6.28) })) };
      }
      if (flock) {
        flock.x += flock.vx * dt; flock.y += flock.vy * dt;
        if (flock.x < r[0] - 8 || flock.x > r[2] + 9) { flock = null; nextFlock = t + rand(14, 30); }
        else for (const b of flock.birds) {
          const x = (flock.x + b.ox) * CELL, y = (flock.y + b.oy) * CELL, w = CELL * 0.22, flap = Math.sin(t * 11 + b.ph) * w * 0.55, dir = Math.sign(flock.vx);
          g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - w + CELL * 0.9, y + flap + CELL * 1.3); g.lineTo(x + CELL * 0.9, y + CELL * 1.3); g.lineTo(x + w + CELL * 0.9, y + flap + CELL * 1.3); g.stroke(); // its shadow
          g.strokeStyle = 'rgba(30,26,24,.9)'; g.lineWidth = 2.2; g.lineJoin = 'round'; g.beginPath(); g.moveTo(x - w, y + flap); g.quadraticCurveTo(x - w * 0.4, y - Math.abs(flap) * 0.4, x + dir * 2, y); g.quadraticCurveTo(x + w * 0.4, y - Math.abs(flap) * 0.4, x + w, y + flap); g.stroke();
        }
      }
    }
    if (dark || time === 'night' || time === 'dusk') {
      let n = 0;
      for (const p of Object.values(s.props)) {
        if (!LIGHTS.has(p.kind) || p.off || !inView(p.x, p.y, r) || n++ > 10) continue;
        const cx = (p.x + 0.5) * CELL, cy = (p.y + 0.3) * CELL;
        for (let i = 0; i < 3; i++) {
          const ph = i * 2.1 + p.x * 0.7 + p.y, rr = CELL * (0.35 + 0.18 * Math.sin(t * 0.7 + ph)), x = cx + Math.cos(t * (2.2 + i * 0.4) + ph) * rr, y = cy + Math.sin(t * (2.9 + i * 0.3) + ph) * rr * 0.7;
          g.fillStyle = `rgba(255,240,215,${0.55 + 0.35 * Math.sin(t * 25 + ph)})`; g.fillRect(x - 1, y - 1, 2.2, 2.2);
        }
      }
    }
  }

  return {
    under, over,
    // does this view have something alive in it (so the map keeps drawing)
    active(s, time, dark) { const I = study(s); return (I.open > 0.35 && time !== 'night') || I.water.length >= 8 || (I.open < 0.25 && I.edges.length > 0) || ((dark || time === 'night' || time === 'dusk') && Object.values(s.props).some((p) => LIGHTS.has(p.kind))); }
  };
}
