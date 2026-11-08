// Procedural map generators. Each returns { name, cols, rows, tiles: {"x,y": terrain}, props: [...], tokens: [...] }.
import { rng } from './art.js';

const SIZES = { small: [40, 30], medium: [60, 44], large: [84, 60] };

function makeMap(cols, rows, seed) {
  const r = rng(seed);
  const tiles = {}, props = [], tokens = [], used = new Uint8Array(cols * rows);
  const M = {
    cols, rows, r, tiles, props, tokens,
    int: (a, b) => a + Math.floor(r() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    chance: (p) => r() < p,
    inb: (x, y) => x >= 0 && y >= 0 && x < cols && y < rows,
    get: (x, y) => tiles[x + ',' + y],
    set(x, y, t) { if (M.inb(x, y)) { if (t) tiles[x + ',' + y] = t; else delete tiles[x + ',' + y]; } },
    // what occupies a cell: 0 free, 1 road, 2 water, 3 building, 4 square, 5 field, 6 prop, 7 reserved
    use: (x, y) => (M.inb(x, y) ? used[y * cols + x] : 255),
    mark(x, y, v) { if (M.inb(x, y)) used[y * cols + x] = v; },
    free(x0, y0, w, h, margin = 0) {
      for (let y = y0 - margin; y < y0 + h + margin; y++) for (let x = x0 - margin; x < x0 + w + margin; x++) if (!M.inb(x, y) || used[y * cols + x]) return false;
      return true;
    },
    prop(kind, x, y, rot = 0) { if (M.inb(x, y)) props.push({ kind, x, y, rot }); },
    token(entry, x, y, extra = {}) { if (entry && M.inb(x, y)) tokens.push({ label: extra.label || entry.name, icon: entry.icon, color: entry.color, size: entry.size, x, y, owner: '', ...extra }); }
  };
  return M;
}

// A wandering line across the map: returns the centre cell for each step.
function wander(M, start, len, horizontal, drift = 0.25) {
  const pts = []; let c = start, dir = 0;
  for (let i = 0; i < len; i++) {
    if (M.chance(drift)) dir = M.pick([-1, 0, 0, 1]);
    c = Math.max(4, Math.min((horizontal ? M.rows : M.cols) - 5, c + (M.chance(0.5) ? dir : 0)));
    pts.push(horizontal ? [i, c] : [c, i]);
  }
  return pts;
}
function paintBand(M, pts, width, horizontal, terrain, useVal, overwrite = () => true) {
  const o = Math.floor(width / 2);
  for (const [x, y] of pts) for (let k = -o; k < width - o; k++) {
    const cx = horizontal ? x : x + k, cy = horizontal ? y + k : y;
    if (!M.inb(cx, cy) || !overwrite(cx, cy)) continue;
    M.set(cx, cy, terrain); if (useVal) M.mark(cx, cy, useVal);
  }
}
function scatter(M, n, kinds, ok, tries = 6) {
  for (let i = 0; i < n * tries && n > 0; i++) {
    const x = M.int(0, M.cols - 1), y = M.int(0, M.rows - 1);
    if (M.use(x, y) || !ok(x, y)) continue;
    M.prop(M.pick(kinds), x, y, M.int(0, 3)); M.mark(x, y, 6); n--;
  }
}

// ---------- buildings (shared by village) ----------
function building(M, x0, y0, w, h, doorSide, floor) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
    M.set(x, y, edge ? 'wall' : floor); M.mark(x, y, 3);
  }
  // door in the middle of the side facing the road
  let dx, dy, rot;
  if (doorSide === 'n') { dx = x0 + Math.floor(w / 2); dy = y0; rot = 0; }
  if (doorSide === 's') { dx = x0 + Math.floor(w / 2); dy = y0 + h - 1; rot = 0; }
  if (doorSide === 'w') { dx = x0; dy = y0 + Math.floor(h / 2); rot = 1; }
  if (doorSide === 'e') { dx = x0 + w - 1; dy = y0 + Math.floor(h / 2); rot = 1; }
  M.set(dx, dy, floor); M.prop(w >= 9 && (rot === 0) ? 'doubledoor' : 'door', dx, dy, rot);
  // windows along the walls, skipping corners and the door
  for (let x = x0 + 2; x < x0 + w - 2; x += 3) for (const y of [y0, y0 + h - 1]) if (!(x === dx && y === dy) && Math.abs(x - dx) > 1) M.prop('window', x, y, 0);
  for (let y = y0 + 2; y < y0 + h - 2; y += 3) for (const x of [x0, x0 + w - 1]) if (!(x === dx && y === dy) && Math.abs(y - dy) > 1) M.prop('window', x, y, 1);
  return { x0, y0, w, h, door: [dx, dy], doorSide, ix0: x0 + 1, iy0: y0 + 1, iw: w - 2, ih: h - 2 };
}
// Interior helpers: "back" is the wall opposite the door.
function interior(b) {
  const cells = [];
  for (let y = b.iy0; y < b.iy0 + b.ih; y++) for (let x = b.ix0; x < b.ix0 + b.iw; x++) cells.push([x, y]);
  const inFront = ([x, y]) => Math.abs(x - b.door[0]) + Math.abs(y - b.door[1]) <= 2;
  const back = {
    n: cells.filter(([, y]) => y === b.iy0 + b.ih - 1), s: cells.filter(([, y]) => y === b.iy0),
    w: cells.filter(([x]) => x === b.ix0 + b.iw - 1), e: cells.filter(([x]) => x === b.ix0)
  }[b.doorSide];
  const backRot = b.doorSide === 'n' || b.doorSide === 's' ? 0 : 1;
  return { cells, back, backRot, inFront };
}

const FURNISH = {
  tavern(M, b, lib) {
    const I = interior(b), taken = new Set(), put = (k, [x, y], rot = 0) => { if (!taken.has(x + ',' + y)) { M.prop(k, x, y, rot); taken.add(x + ',' + y); } };
    I.back.slice(1, -1).forEach((c) => put('bar', c, I.backRot));
    I.back.slice(0, 1).concat(I.back.slice(-1)).forEach((c) => put('barrel', c));
    const free = I.cells.filter((c) => !taken.has(c[0] + ',' + c[1]) && !I.inFront(c) && !I.back.includes(c));
    const centre = free.filter(([x, y]) => x > b.ix0 && x < b.ix0 + b.iw - 1 && y > b.iy0 && y < b.iy0 + b.ih - 1);
    for (let i = 0; i < Math.min(3, Math.floor(centre.length / 8)); i++) {
      const c = centre[Math.floor(M.r() * centre.length)]; if (taken.has(c[0] + ',' + c[1])) continue;
      put('roundtable', c);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1]]) { const n = [c[0] + dx, c[1] + dy]; if (centre.some((q) => q[0] === n[0] && q[1] === n[1])) put('chair', n); }
    }
    const side = I.cells.filter(([x, y]) => (x === b.ix0 || x === b.ix0 + b.iw - 1 || y === b.iy0 || y === b.iy0 + b.ih - 1) && !I.inFront([x, y]));
    const fp = side.find((c) => !taken.has(c[0] + ',' + c[1]) && !I.back.includes(c)); if (fp) put('fireplace', fp);
    const innkeeper = I.back[Math.floor(I.back.length / 2)];
    return [[lib.Innkeeper, [innkeeper[0] + (I.backRot ? (b.doorSide === 'w' ? -1 : 1) : 0), innkeeper[1] + (I.backRot ? 0 : (b.doorSide === 'n' ? -1 : 1))]]];
  },
  smithy(M, b, lib) {
    const I = interior(b), c = I.cells.filter((q) => !I.inFront(q));
    const s = (n) => c[Math.floor((c.length - 1) * n)];
    M.prop('fireplace', ...I.back[0]); M.prop('anvil', ...s(.5)); M.prop('weaponrack', ...I.back[I.back.length - 1], I.backRot);
    M.prop('barrel', ...s(.15)); M.prop('crate', ...s(.85)); M.prop('logs', ...s(.3));
    return [[lib.Blacksmith, s(.6)]];
  },
  temple(M, b, lib) {
    const I = interior(b), mid = I.back[Math.floor(I.back.length / 2)];
    M.prop('altar', ...mid, I.backRot);
    M.prop('candle', ...I.back[0]); M.prop('candle', ...I.back[I.back.length - 1]);
    // pews in rows facing the altar
    for (const q of I.cells) {
      const d = I.backRot ? Math.abs(q[0] - mid[0]) : Math.abs(q[1] - mid[1]);
      const across = I.backRot ? q[1] - b.iy0 : q[0] - b.ix0, span = I.backRot ? b.ih : b.iw;
      if (d >= 2 && d % 2 === 0 && across > 0 && across < span - 1 && Math.abs(across - Math.floor(span / 2)) > 0 && !I.inFront(q)) M.prop('bench', ...q, I.backRot ? 1 : 0);
    }
    return [[lib['Village Priest'], I.backRot ? [mid[0] + (b.doorSide === 'w' ? -1 : 1), mid[1]] : [mid[0], mid[1] + (b.doorSide === 'n' ? -1 : 1)]]];
  },
  store(M, b, lib) {
    const I = interior(b);
    I.back.forEach((c) => M.prop('bookshelf', ...c, I.backRot));
    const c = I.cells.filter((q) => !I.inFront(q) && !I.back.includes(q));
    const s = (n) => c[Math.floor((c.length - 1) * n)];
    M.prop('crate', ...s(0)); M.prop('barrel', ...s(.12)); M.prop('sack', ...s(.9)); M.prop('crate', ...s(1)); M.prop('bar', ...s(.5), I.backRot);
    return [[lib.Merchant, s(.45)]];
  },
  house(M, b, lib) {
    const I = interior(b), c = I.cells.filter((q) => !I.inFront(q));
    const corner = c.reduce((a, q) => (Math.abs(q[0] - b.door[0]) + Math.abs(q[1] - b.door[1]) > Math.abs(a[0] - b.door[0]) + Math.abs(a[1] - b.door[1]) ? q : a), c[0]);
    M.prop('bed', ...corner, 0);
    const rest = c.filter((q) => Math.abs(q[0] - corner[0]) + Math.abs(q[1] - corner[1]) > 1);
    const s = (n) => rest[Math.floor((rest.length - 1) * n)];
    if (rest.length > 3) { M.prop('table', ...s(.5)); M.prop('chair', ...s(.5).map((v, i) => v + (i === 0 ? 1 : 0))); }
    if (rest.length > 1) M.prop('chest', ...s(0));
    if (rest.length > 6) M.prop(M.pick(['fireplace', 'bookshelf', 'wardrobe', 'rug']), ...s(1));
    return M.chance(0.5) ? [[M.pick([lib.Villager, lib.Commoner, lib.Farmer, lib.Child]), s(.3)]] : [];
  },
  stable(M, b, lib) {
    const I = interior(b);
    I.back.forEach((c, i) => M.prop(i % 2 ? 'haystack' : 'fence', ...c, I.backRot ? 1 : 0));
    const c = I.cells.filter((q) => !I.inFront(q) && !I.back.includes(q));
    if (c.length) M.prop('barrel', ...c[0]);
    return [[lib.Horse, c[Math.floor(c.length / 2)] || I.cells[0]]];
  }
};

// ---------- village ----------
export function village(size, seed, opts = {}, lib = {}) {
  const [cols, rows] = SIZES[size] || SIZES.medium;
  const M = makeMap(cols, rows, seed);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) M.set(x, y, 'grass');
  // dirt patches for variety
  for (let i = 0; i < cols * rows / 120; i++) { const cx = M.int(0, cols), cy = M.int(0, rows), rad = M.int(1, 2); for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (M.chance(.6)) M.set(cx + x, cy + y, 'dirt'); }

  // river down one side
  let river = null;
  if (opts.river !== false && M.chance(0.75)) {
    const side = M.chance(.5) ? Math.floor(cols * 0.16) : Math.floor(cols * 0.84);
    river = wander(M, side, rows, false, 0.35);
    paintBand(M, river, M.int(3, 4), false, 'water', 2);
    for (const [x, y] of river) for (const dx of [-3, 3]) if (M.chance(.12) && !M.use(x + dx, y)) { M.prop('reeds', x + dx, y); M.mark(x + dx, y, 6); }
    for (let i = 0; i < rows / 6; i++) { const [x, y] = M.pick(river); M.prop('lilypad', x, y); }
  }

  // roads: a main road east–west, a branch north or south from the square
  const mainY = Math.floor(rows / 2) + M.int(-3, 3);
  const main = wander(M, mainY, cols, true, 0.2);
  const sqX = Math.floor(cols / 2) + M.int(-4, 4), sqY = main[sqX][1];
  const goNorth = M.chance(.5);
  const branch = wander(M, sqX, goNorth ? sqY : rows - sqY, false, 0.2).map(([x, y]) => [x, goNorth ? y : sqY + y]);
  const isWater = (x, y) => M.use(x, y) === 2;
  paintBand(M, main, 3, true, 'path', 1, (x, y) => !isWater(x, y));
  paintBand(M, branch, 2, false, 'path', 1, (x, y) => !isWater(x, y));
  // bridges where the road crosses the river
  for (const [x, y] of main) for (let k = -1; k <= 1; k++) if (isWater(x, y + k)) { M.prop('bridge', x, y + k, 0); }

  // village square
  const rad = size === 'small' ? 4 : 5;
  for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
    if (x * x + y * y > rad * rad + 2) continue;
    const cx = sqX + x, cy = sqY + y; if (!M.inb(cx, cy) || isWater(cx, cy)) continue;
    M.set(cx, cy, 'cobble'); M.mark(cx, cy, 4);
  }
  M.prop(M.chance(.5) ? 'well' : 'fountain', sqX, sqY);
  const stallSpots = [[-3, -3], [3, -3], [-3, 3], [3, 3]].sort(() => M.r() - .5).slice(0, size === 'small' ? 2 : 3);
  stallSpots.forEach(([dx, dy]) => M.prop('stall', sqX + dx, sqY + dy, 0));
  [[-rad, 0], [rad, 0]].forEach(([dx, dy]) => M.prop('lamppost', sqX + dx, sqY + dy));

  // lamp posts along the main road, signposts at the ends
  for (let i = 4; i < cols - 4; i += 9) { const [x, y] = main[i]; if (!isWater(x, y - 2) && M.use(x, y - 2) !== 4) { M.prop('lamppost', x, y - 2); } }
  M.prop('signpost', 2, main[2][1] - 2); M.prop('signpost', cols - 3, main[cols - 3][1] + 2);

  // buildings along the roads
  const roadCells = [...main.map(([x, y]) => ({ x, y, h: true })), ...branch.map(([x, y]) => ({ x, y, h: false }))]
    .filter(({ x, y }) => Math.abs(x - sqX) > rad + 1 || Math.abs(y - sqY) > rad + 1);
  const plan = ['tavern', 'smithy', 'temple', 'store', 'stable'];
  const houses = size === 'small' ? 5 : size === 'medium' ? 9 : 15;
  for (let i = 0; i < houses; i++) plan.push('house');
  const dims = { tavern: [11, 8], smithy: [7, 6], temple: [9, 11], store: [8, 6], stable: [8, 6], house: [6, 5] };
  const placed = [], people = [];
  for (const kind of plan) {
    for (let tries = 0; tries < 250; tries++) {
      const rc = M.pick(roadCells), side = M.chance(.5) ? -1 : 1;
      let [w, h] = dims[kind];
      if (kind === 'house') { w = M.int(5, 7); h = M.int(5, 6); }
      if (!rc.h) [w, h] = [h, w];
      const gap = M.int(1, 2);
      let x0, y0, doorSide;
      if (rc.h) { x0 = rc.x - Math.floor(w / 2); y0 = side < 0 ? rc.y - 2 - gap - h + 1 : rc.y + 2 + gap; doorSide = side < 0 ? 's' : 'n'; }
      else { y0 = rc.y - Math.floor(h / 2); x0 = side < 0 ? rc.x - 1 - gap - w + 1 : rc.x + 2 + gap; doorSide = side < 0 ? 'e' : 'w'; }
      if (x0 < 1 || y0 < 1 || x0 + w > cols - 1 || y0 + h > rows - 1 || !M.free(x0, y0, w, h, 1)) continue;
      const floor = { temple: 'marble', stable: 'dirt', smithy: 'stone' }[kind] || 'wood';
      const b = building(M, x0, y0, w, h, doorSide, floor);
      // path from the door to the road
      let [px, py] = b.door; const step = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[doorSide];
      for (let k = 0; k < 4; k++) { px += step[0]; py += step[1]; if (M.use(px, py) === 1 || M.use(px, py) === 4 || !M.inb(px, py)) break; if (M.use(px, py) === 0 || M.use(px, py) === 6) { M.set(px, py, 'path'); M.mark(px, py, 7); } }
      const who = FURNISH[kind](M, b, lib);
      placed.push({ kind, b }); people.push(...who);
      // a small graveyard beside the temple
      if (kind === 'temple') {
        const gx = x0 + w + 2, gy = y0;
        if (M.free(gx, gy, 5, 5, 0)) {
          for (let yy = 0; yy < 5; yy++) for (let xx = 0; xx < 5; xx++) {
            const edge = xx === 0 || yy === 0 || xx === 4 || yy === 4;
            if (edge) M.prop('fence', gx + xx, gy + yy, yy === 0 || yy === 4 ? 0 : 1);
            else if ((xx + yy) % 2 === 0) M.prop('grave', gx + xx, gy + yy);
            M.mark(gx + xx, gy + yy, 7);
          }
        }
      }
      if (kind === 'stable' || kind === 'store') { const cx = b.door[0] + (b.doorSide === 'n' || b.doorSide === 's' ? 2 : 0), cy = b.door[1] + (b.doorSide === 'w' || b.doorSide === 'e' ? 2 : 0); if (!M.use(cx, cy)) { M.prop('cart', cx, cy, b.doorSide === 'n' || b.doorSide === 's' ? 0 : 1); M.mark(cx, cy, 6); } }
      break;
    }
  }

  // farm fields in the open spaces
  const fields = size === 'small' ? 2 : size === 'medium' ? 3 : 5;
  const fieldSpots = [];
  for (let f = 0, tries = 0; f < fields && tries < 400; tries++) {
    const w = M.int(7, 11), h = M.int(5, 8), x0 = M.int(2, cols - w - 2), y0 = M.int(2, rows - h - 2);
    if (!M.free(x0 - 1, y0 - 1, w + 2, h + 2, 1)) continue;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { M.set(x, y, 'farm'); M.mark(x, y, 5); }
    for (let x = x0 - 1; x <= x0 + w; x++) { M.prop('fence', x, y0 - 1, 0); M.prop('fence', x, y0 + h, 0); M.mark(x, y0 - 1, 7); M.mark(x, y0 + h, 7); }
    for (let y = y0; y < y0 + h; y++) { M.prop('fence', x0 - 1, y, 1); M.prop('fence', x0 + w, y, 1); M.mark(x0 - 1, y, 7); M.mark(x0 + w, y, 7); }
    M.prop('haystack', x0 + w - 1, y0); fieldSpots.push([x0, y0, w, h]); f++;
  }

  // trees: dense round the edges, a few through the village; flowers and bushes
  const edge = (x, y) => Math.min(x, y, cols - 1 - x, rows - 1 - y);
  scatter(M, Math.floor(cols * rows / 14), ['tree', 'tree', 'pine', 'bush'], (x, y) => edge(x, y) < 3 && M.chance(.85), 3);
  scatter(M, Math.floor(cols * rows / 90), ['tree', 'bush', 'tree', 'stump'], () => true);
  scatter(M, Math.floor(cols * rows / 120), ['flowers', 'rock', 'logs'], () => true);

  if (opts.creatures) {
    for (const [entry, [x, y]] of people) M.token(entry, x, y);
    for (let i = 0; i < (size === 'small' ? 3 : 6); i++) { const a = M.int(0, 359) * Math.PI / 180, d = M.int(2, rad); M.token(M.pick([lib.Villager, lib.Commoner, lib.Child, lib.Dog, lib.Chicken]), Math.round(sqX + Math.cos(a) * d), Math.round(sqY + Math.sin(a) * d)); }
    M.token(lib['Town Guard'], 3, main[3][1] + 2); M.token(lib['Town Guard'], cols - 4, main[cols - 4][1] - 2);
    for (const [x0, y0, w, h] of fieldSpots) { M.token(lib.Farmer, x0 + 1, y0 + 1); if (M.chance(.6)) M.token(M.pick([lib.Cow, lib.Sheep, lib.Pig]), x0 + Math.floor(w / 2), y0 + Math.floor(h / 2)); }
  }
  const sy = main[0][1];
  return { name: villageName(M), cols, rows, tiles: M.tiles, props: M.props, tokens: M.tokens, start: [0, sy - 5, 7, sy + 5] };
}
function villageName(M) {
  return M.pick(['Oak', 'Mill', 'Ash', 'Elm', 'Thorn', 'Stone', 'Raven', 'Wolf', 'Green', 'Fern', 'Kings', 'Black', 'Red', 'High', 'Low', 'Bram', 'Willow', 'Barrow']) +
    M.pick(['ford', 'brook', 'field', 'stead', 'wick', 'ton', 'bury', 'dale', 'holm', 'moor', 'hollow', 'bridge', 'well', 'by']);
}

// ---------- dungeon ----------
export function dungeon(size, seed, opts = {}, lib = {}) {
  const [cols, rows] = SIZES[size] || SIZES.medium;
  const M = makeMap(cols, rows, seed);
  const floor = new Uint8Array(cols * rows), at = (x, y) => (M.inb(x, y) ? floor[y * cols + x] : 0);
  const rooms = [];
  const target = size === 'small' ? 7 : size === 'medium' ? 12 : 20;
  for (let tries = 0; tries < 600 && rooms.length < target; tries++) {
    const w = M.int(5, 11), h = M.int(5, 9), x = M.int(2, cols - w - 3), y = M.int(2, rows - h - 3);
    if (rooms.some((o) => x < o.x + o.w + 3 && x + w + 3 > o.x && y < o.y + o.h + 3 && y + h + 3 > o.y)) continue;
    rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
  }
  const inRoom = (x, y) => rooms.find((o) => x >= o.x && y >= o.y && x < o.x + o.w && y < o.y + o.h);
  for (const o of rooms) for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) { floor[y * cols + x] = 1; M.set(x, y, 'stone'); }

  // connect every room to its nearest connected neighbour (a spanning tree), plus a couple of loops
  const corridor = new Set();
  const dig = (a, b) => {
    let x = a.cx, y = a.cy; const horizFirst = M.chance(.5);
    const stepTo = (tx, ty) => {
      while (x !== tx || y !== ty) {
        if (x !== tx && (horizFirst ? true : y === ty)) x += Math.sign(tx - x); else y += Math.sign(ty - y);
        if (!floor[y * cols + x]) { floor[y * cols + x] = 2; M.set(x, y, 'cobble'); corridor.add(x + ',' + y); }
      }
    };
    if (horizFirst) { stepTo(b.cx, a.cy); stepTo(b.cx, b.cy); } else { stepTo(a.cx, b.cy); stepTo(b.cx, b.cy); }
  };
  const done = [rooms[0]], todo = rooms.slice(1);
  while (todo.length) {
    let best = null;
    for (const t of todo) for (const d of done) { const dist = Math.abs(t.cx - d.cx) + Math.abs(t.cy - d.cy); if (!best || dist < best[2]) best = [t, d, dist]; }
    dig(best[1], best[0]); done.push(best[0]); todo.splice(todo.indexOf(best[0]), 1);
  }
  for (let i = 0; i < Math.max(1, rooms.length / 5); i++) dig(M.pick(rooms), M.pick(rooms));

  // walls around every floor cell
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (at(x, y)) continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (at(x + dx, y + dy)) { near = true; break; }
    if (near) M.set(x, y, 'wall');
  }
  const taken = new Set(), put = (k, x, y, rot = 0) => { if (!taken.has(x + ',' + y)) { M.prop(k, x, y, rot); taken.add(x + ',' + y); return true; } return false; };

  // doors where a corridor meets a room's edge
  for (const key of corridor) {
    const [x, y] = key.split(',').map(Number);
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => inRoom(x + dx, y + dy));
    if (n.length !== 1) continue;
    const [dx, dy] = n[0];
    const sideWalls = dx ? M.get(x, y - 1) === 'wall' && M.get(x, y + 1) === 'wall' : M.get(x - 1, y) === 'wall' && M.get(x + 1, y) === 'wall';
    if (!sideWalls || !M.chance(.7)) continue;
    const roll = M.r();
    const kind = roll < .12 ? 'secretdoor' : roll < .2 ? 'portcullis' : roll < .3 ? 'archway' : 'door';
    if (kind === 'secretdoor') M.set(x, y, 'wall'); // looks like solid wall to players until the DM opens it up
    put(kind, x, y, dx ? 1 : 0);
  }

  // dress the rooms
  const themes = ['throne', 'crypt', 'storage', 'library', 'prison', 'shrine', 'treasure', 'barracks', 'pool', 'collapsed', 'lair'];
  const monsters = (opts.monsters || 'goblinoid');
  const foes = {
    goblinoid: ['Goblin', 'Goblin', 'Hobgoblin', 'Bugbear', 'Goblin Boss'],
    kobold: ['Kobold', 'Kobold', 'Winged Kobold', 'Kobold Chieftain', 'Dragon Wyrmling'],
    undead: ['Skeleton', 'Zombie', 'Ghoul', 'Skeleton Archer', 'Wight'],
    beasts: ['Giant Rat', 'Giant Spider', 'Wolf', 'Giant Centipede', 'Swarm of Bats']
  }[monsters] || ['Goblin'];
  rooms.forEach((o, i) => {
    const cells = []; for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) cells.push([x, y]);
    const edgeCells = cells.filter(([x, y]) => x === o.x || y === o.y || x === o.x + o.w - 1 || y === o.y + o.h - 1);
    const doorAdj = ([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => corridor.has((x + dx) + ',' + (y + dy)));
    const wallSpots = edgeCells.filter((c) => !doorAdj(c));
    const rnd = () => M.pick(cells.filter((c) => !taken.has(c[0] + ',' + c[1]) && !doorAdj(c))) || cells[0];
    // torches on a few wall-side cells
    for (let k = 0; k < Math.max(1, Math.floor(wallSpots.length / 10)); k++) { const c = M.pick(wallSpots); put('torch', ...c); }
    if (i === 0) { put('stairs', o.cx, o.cy); return; } // entrance
    if (i === rooms.length - 1 && rooms.length > 3) { put('stairs', o.cx, o.cy, 2); }
    const theme = themes[(i + Math.floor(M.r() * themes.length)) % themes.length];
    const props = {
      throne: () => { put('throne', o.cx, o.y + 1); put('rug', o.cx, o.y + 2); [[o.x + 1, o.y + 1], [o.x + o.w - 2, o.y + 1], [o.x + 1, o.y + o.h - 2], [o.x + o.w - 2, o.y + o.h - 2]].forEach((c) => put('pillar', ...c)); put('brazier', o.cx - 1, o.y + 1); put('brazier', o.cx + 1, o.y + 1); },
      crypt: () => { for (let k = 0; k < Math.min(6, (o.w - 2) * (o.h - 2) / 4); k++) put('coffin', ...rnd()); put('bones', ...rnd()); put('candle', ...rnd()); },
      storage: () => { for (let k = 0; k < 6; k++) put(M.pick(['crate', 'barrel', 'sack', 'crate']), ...M.pick(wallSpots)); },
      library: () => { wallSpots.filter(([, y]) => y === o.y).forEach((c) => put('bookshelf', ...c)); put('desk', o.cx, o.cy); put('candle', ...rnd()); },
      prison: () => { put('cage', ...rnd()); put('cage', ...rnd()); put('bones', ...rnd()); put('lever', ...M.pick(wallSpots)); },
      shrine: () => { put('altar', o.cx, o.y + 1); put('statue', o.x + 1, o.y + 1); put('statue', o.x + o.w - 2, o.y + 1); put('candle', ...rnd()); },
      treasure: () => { put('chest', o.cx, o.cy); put('chest', o.cx + 1, o.cy); put('crystal', ...rnd()); put('trap', o.cx, o.cy + 1); },
      barracks: () => { wallSpots.filter(([, y]) => y === o.y).slice(0, 4).forEach((c, k) => k % 2 === 0 && put('bed', ...c)); put('table', o.cx, o.cy); put('weaponrack', ...M.pick(wallSpots)); },
      pool: () => { for (let y = o.cy - 1; y <= o.cy + 1; y++) for (let x = o.cx - 1; x <= o.cx + 1; x++) if (o.w > 5 && o.h > 5) M.set(x, y, 'water'); put('reeds', o.x + 1, o.y + 1); },
      collapsed: () => { for (let k = 0; k < 5; k++) put('rubble', ...rnd()); put('brokenpillar', ...rnd()); if (o.w > 6) M.set(o.cx, o.cy, 'pit'); },
      lair: () => { put('bones', ...rnd()); put('bones', ...rnd()); put('chest', ...M.pick(wallSpots)); put('campfire', o.cx, o.cy); }
    };
    props[theme]();
    if (opts.creatures) {
      const n = M.int(0, Math.min(4, Math.floor(cells.length / 12)));
      for (let k = 0; k < n; k++) { const c = rnd(); const name = foes[Math.min(foes.length - 1, Math.floor(M.r() * M.r() * foes.length))]; M.token(lib[name], c[0], c[1], { hidden: true }); taken.add(c[0] + ',' + c[1]); }
    }
  });
  // a few traps in corridors
  const cor = [...corridor];
  for (let k = 0; k < Math.floor(cor.length / 25); k++) { const [x, y] = M.pick(cor).split(',').map(Number); put('trap', x, y); }
  const name = M.pick(['The Sunken', 'The Forgotten', 'The Black', 'The Howling', 'The Drowned', 'The Ember']) + ' ' + M.pick(['Crypt', 'Halls', 'Warrens', 'Vault', 'Keep', 'Catacombs', 'Mine']);
  const e = rooms[0]; // the entrance room, with its walls
  return { name, cols, rows, tiles: M.tiles, props: M.props, tokens: M.tokens, start: [e.x - 1, e.y - 1, e.x + e.w, e.y + e.h] };
}

// ---------- forest road ----------
export function forest(size, seed, opts = {}, lib = {}) {
  const [cols, rows] = SIZES[size] || SIZES.medium;
  const M = makeMap(cols, rows, seed);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) M.set(x, y, 'grass');
  for (let i = 0; i < cols * rows / 200; i++) { const cx = M.int(0, cols), cy = M.int(0, rows); for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (M.chance(.5)) M.set(cx + x, cy + y, 'dirt'); }
  const road = wander(M, Math.floor(rows / 2), cols, true, 0.35);
  paintBand(M, road, 3, true, 'path', 1);
  // grassy verges either side of the road stay clear of trees
  for (const [x, y] of road) for (const dy of [-3, -2, 2, 3]) if (M.inb(x, y + dy) && !M.use(x, y + dy)) M.mark(x, y + dy, 7);
  // clearings: campsite, pond, ruins
  const clear = (cx, cy, rad, v = 7) => { for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad && M.inb(cx + x, cy + y) && !M.use(cx + x, cy + y)) M.mark(cx + x, cy + y, v); };
  const near = (i, off) => [road[i][0], road[i][1] + off];
  const [campX, campY] = near(Math.floor(cols * .3), M.chance(.5) ? -6 : 6);
  clear(campX, campY, 4);
  M.prop('campfire', campX, campY); M.prop('tent', campX - 2, campY - 2); M.prop('tent', campX + 2, campY - 2); M.prop('log', campX, campY + 2); M.prop('logs', campX + 3, campY + 1); M.prop('crate', campX - 3, campY + 1);
  const pondX = Math.floor(cols * .7) + M.int(-3, 3), pondY = road[Math.floor(cols * .7)][1] + (M.chance(.5) ? -9 : 9);
  for (let y = -4; y <= 4; y++) for (let x = -5; x <= 5; x++) { const d = (x * x) / 25 + (y * y) / 16; if (d <= 1 && M.inb(pondX + x, pondY + y)) { M.set(pondX + x, pondY + y, 'water'); M.mark(pondX + x, pondY + y, 2); } else if (d <= 1.5 && M.inb(pondX + x, pondY + y) && !M.use(pondX + x, pondY + y)) { if (M.chance(.3)) M.prop('reeds', pondX + x, pondY + y); M.mark(pondX + x, pondY + y, 7); } }
  M.prop('lilypad', pondX - 1, pondY); M.prop('lilypad', pondX + 2, pondY + 1);
  if (opts.ruins !== false && M.chance(.7)) {
    const [rx, ry] = near(Math.floor(cols * .55), M.chance(.5) ? -7 : 7); clear(rx, ry, 4);
    for (let k = 0; k < 6; k++) M.prop(M.pick(['brokenpillar', 'rubble', 'rubble', 'pillar']), rx + M.int(-3, 3), ry + M.int(-3, 3));
    M.prop('statue', rx, ry);
  }
  M.prop('signpost', road[3][0], road[3][1] - 2);
  M.prop('cart', road[Math.floor(cols * .8)][0], road[Math.floor(cols * .8)][1], 0);
  // the forest: thick groves with open glades between, rather than an even spread
  const groves = Array.from({ length: Math.floor(cols * rows / 180) }, () => [M.int(0, cols), M.int(0, rows), M.int(4, 9), M.chance(.5) ? 'pine' : 'tree']);
  const grove = (x, y) => groves.find(([gx, gy, gr]) => (x - gx) ** 2 + (y - gy) ** 2 <= gr * gr);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (M.use(x, y)) continue;
    const g = grove(x, y);
    if (g ? M.chance(.42) : M.chance(.04)) { M.prop(g ? (M.chance(.8) ? g[3] : 'bush') : M.pick(['tree', 'bush', 'pine']), x, y, M.int(0, 3)); M.mark(x, y, 6); }
    else if (g && M.chance(.12)) M.set(x, y, 'dirt'); // leaf litter under the trees
  }
  scatter(M, Math.floor(cols * rows / 70), ['rock', 'stump', 'log', 'mushrooms', 'deadtree', 'flowers', 'flowers'], () => true);
  if (opts.creatures) {
    for (let k = 0; k < 4; k++) M.token(lib.Bandit, campX + M.int(-3, 3), campY + M.int(-3, 3), { hidden: true });
    M.token(lib['Bandit Captain'], campX + 1, campY + 1, { hidden: true });
    for (let k = 0; k < 3; k++) M.token(lib.Wolf, pondX + M.int(-6, 6), pondY + M.int(5, 7) * (M.chance(.5) ? 1 : -1), { hidden: true });
  }
  const name = M.pick(['Old', 'Dark', 'King\'s', 'Merchant\'s', 'Wolf', 'Hollow']) + ' ' + M.pick(['Road', 'Way', 'Trail', 'Wood Road']);
  const ry = road[0][1];
  return { name, cols, rows, tiles: M.tiles, props: M.props, tokens: M.tokens, start: [0, ry - 5, 7, ry + 5] };
}

export const GENERATORS = { village, dungeon, forest };
