// Lighting and vision: what each character can see. Used by the server (to decide what players are sent)
// and by the DM's screen (to preview what players see). Plain script: works with require() and in the browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TabletopVision = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SQ = 5; // feet per square
  // Props that give light, in feet (bright, dim), and doors that block sight while closed.
  const PROP_LIGHT = { torch: [20, 40], brazier: [20, 40], campfire: [20, 40], fireplace: [20, 40], candle: [5, 10], lamppost: [15, 30], cauldron: [5, 10], crystal: [10, 20] };
  const SOLID_DOORS = { door: 1, doubledoor: 1, secretdoor: 1 };
  const MAX_RANGE = 48; // squares (240 ft): far enough for any room, keeps big outdoor maps quick

  // Everything that blocks sight on a map: wall squares, closed doors, and imported wall lines.
  function blockers(sc) {
    const cols = sc.cols, rows = sc.rows, cell = new Uint8Array(cols * rows);
    for (const k in sc.tiles) {
      if (sc.tiles[k] !== 'wall') continue;
      const c = k.indexOf(','), x = +k.slice(0, c), y = +k.slice(c + 1);
      if (x >= 0 && y >= 0 && x < cols && y < rows) cell[y * cols + x] = 1;
    }
    for (const id in sc.props) {
      const p = sc.props[id];
      if (SOLID_DOORS[p.kind] && !p.open && p.x >= 0 && p.y >= 0 && p.x < cols && p.y < rows) cell[p.y * cols + p.x] = 1;
    }
    const segs = (sc.walls || []).slice();
    for (const d of sc.doors || []) if (!d[4]) segs.push(d); // d[4]: open
    const index = new Map();
    for (const g of segs) {
      const len = Math.hypot(g[2] - g[0], g[3] - g[1]), steps = Math.max(1, Math.ceil(len * 3));
      for (let k = 0; k <= steps; k++) {
        const x = g[0] + (g[2] - g[0]) * k / steps, y = g[1] + (g[3] - g[1]) * k / steps;
        for (const [cx, cy] of [[Math.floor(x), Math.floor(y)], [Math.floor(x - 1e-6), Math.floor(y - 1e-6)], [Math.floor(x - 1e-6), Math.floor(y)], [Math.floor(x), Math.floor(y - 1e-6)]]) {
          if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
          const i = cy * cols + cx; let list = index.get(i); if (!list) index.set(i, list = []); if (list[list.length - 1] !== g) list.push(g);
        }
      }
    }
    return { cols, rows, cell, index };
  }

  function segHit(ax, ay, bx, by, g) {
    const d = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
    const d1 = d(g[0], g[1], g[2], g[3], ax, ay), d2 = d(g[0], g[1], g[2], g[3], bx, by);
    const d3 = d(ax, ay, bx, by, g[0], g[1]), d4 = d(ax, ay, bx, by, g[2], g[3]);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }

  // Can you see from point a to point b? Walk the squares the line passes through: a wall square
  // on the way blocks it (the square at b itself doesn't, so you see the face of a wall), and so does
  // any imported wall line it crosses.
  function clear(B, ax, ay, bx, by) {
    let x = Math.floor(ax), y = Math.floor(ay);
    const tx = Math.floor(bx), ty = Math.floor(by), dx = bx - ax, dy = by - ay;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity;
    let mx = dx ? ((dx > 0 ? x + 1 - ax : ax - x) * tdx) : Infinity, my = dy ? ((dy > 0 ? y + 1 - ay : ay - y) * tdy) : Infinity;
    const seen = B.index.size ? new Set() : null;
    for (let n = 0; n < 1000; n++) {
      if (x >= 0 && y >= 0 && x < B.cols && y < B.rows) {
        const i = y * B.cols + x;
        if (n > 0 && !(x === tx && y === ty) && B.cell[i]) return false;
        if (seen) { const list = B.index.get(i); if (list) for (const g of list) { if (seen.has(g)) continue; seen.add(g); if (segHit(ax, ay, bx, by, g)) return false; } }
      }
      if (x === tx && y === ty) return true;
      if (mx < my) { mx += tdx; x += sx; } else { my += tdy; y += sy; }
    }
    return true;
  }
  // a square is in view if its centre is, or (looking past a corner) one of its corners just inside
  function seesSquare(B, ax, ay, cx, cy) {
    if (clear(B, ax, ay, cx + 0.5, cy + 0.5)) return true;
    const e = 0.08;
    return clear(B, ax, ay, cx + e, cy + e) || clear(B, ax, ay, cx + 1 - e, cy + e) || clear(B, ax, ay, cx + e, cy + 1 - e) || clear(B, ax, ay, cx + 1 - e, cy + 1 - e);
  }

  // The lights on a map, in squares: lit tokens, glowing props, and lights brought in with an imported map.
  function lights(sc) {
    const out = [];
    for (const id in sc.tokens) { const t = sc.tokens[id]; if (t.light && t.light[1] > 0) out.push({ x: t.x + t.size / 2, y: t.y + t.size / 2, bright: t.light[0] / SQ, dim: t.light[1] / SQ }); }
    for (const id in sc.props) { const p = sc.props[id], L = PROP_LIGHT[p.kind]; if (L && !p.off) out.push({ x: p.x + 0.5, y: p.y + 0.5, bright: L[0] / SQ, dim: L[1] / SQ }); }
    for (const l of sc.lights || []) if (l[2] > 0) out.push({ x: l[0], y: l[1], bright: l[2] / 2, dim: l[2] });
    return out;
  }

  // How lit each square is: 2 bright, 1 dim, 0 dark.
  function lightMap(sc, B) {
    const amb = ((sc.vision && sc.vision.ambient) || 'bright'), base = amb === 'bright' ? 2 : amb === 'dim' ? 1 : 0;
    const L = new Uint8Array(B.cols * B.rows).fill(base);
    if (base === 2) return L;
    for (const l of lights(sc)) {
      const r = Math.min(l.dim, MAX_RANGE);
      for (let y = Math.max(0, Math.floor(l.y - r)); y <= Math.min(B.rows - 1, Math.floor(l.y + r)); y++)
        for (let x = Math.max(0, Math.floor(l.x - r)); x <= Math.min(B.cols - 1, Math.floor(l.x + r)); x++) {
          const i = y * B.cols + x; if (L[i] === 2) continue;
          const d = Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y), v = d <= l.bright + 0.5 ? 2 : d <= r + 0.5 ? 1 : 0;
          if (v > L[i] && seesSquare(B, l.x, l.y, x, y)) L[i] = v;
        }
    }
    return L;
  }

  // The characters a player sees through: their own tokens, or every player's token when the party shares vision.
  function viewersFor(sc, name) {
    const shared = !sc.vision || sc.vision.shared !== false;
    return Object.values(sc.tokens).filter((t) => !t.hidden && t.owner && t.owner !== '*' && (shared || t.owner === name))
      .map((t) => ({ x: t.x + t.size / 2, y: t.y + t.size / 2, dv: (t.darkvision || 0) / SQ, size: t.size, tx: t.x, ty: t.y }));
  }

  // What these viewers can see: one byte per square, 2 seen clearly, 1 seen dimly (dim light or darkvision), 0 not seen.
  function sight(sc, viewers, B, L) {
    B = B || blockers(sc); L = L || lightMap(sc, B);
    const S = new Uint8Array(B.cols * B.rows);
    for (const v of viewers) {
      const reach = Math.min(MAX_RANGE, Math.max(B.cols, B.rows));
      for (let y = Math.max(0, Math.floor(v.y - reach)); y <= Math.min(B.rows - 1, Math.floor(v.y + reach)); y++)
        for (let x = Math.max(0, Math.floor(v.x - reach)); x <= Math.min(B.cols - 1, Math.floor(v.x + reach)); x++) {
          const i = y * B.cols + x; if (S[i] === 2) continue;
          const d = Math.hypot(x + 0.5 - v.x, y + 0.5 - v.y);
          if (d > reach + 0.5) continue;
          const inDv = v.dv > 0 && d <= v.dv + 0.5;
          // darkvision: dim light looks bright, darkness looks dim
          const val = L[i] === 2 ? 2 : L[i] === 1 ? (inDv ? 2 : 1) : (inDv ? 1 : 0);
          if (val <= S[i]) continue;
          const own = x >= v.tx && x < v.tx + v.size && y >= v.ty && y < v.ty + v.size;
          if (own || seesSquare(B, v.x, v.y, x, y)) S[i] = Math.max(val, own ? 1 : 0);
        }
    }
    return S;
  }

  return { SQ, PROP_LIGHT, SOLID_DOORS, blockers, clear, lights, lightMap, viewersFor, sight };
});
