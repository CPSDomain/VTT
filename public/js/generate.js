// Procedural map generators (v2). generate(type, settings, seed, lib) returns
// { name, summary, cols, rows, tiles: {"x,y": terrain}, props, tokens, start: [x0,y0,x1,y1] }.
// SCHEMA describes every setting; the Generate dialog and the description box are both built from it.
import { rng } from './art.js';

const yes = { type: 'bool' };
const choice = (options, def) => ({ type: 'choice', options, def });

export const SCHEMA = {
  village: {
    label: 'Village', blurb: 'Roads, square, tavern, smithy, temple, houses, fields',
    fields: {
      size: { label: 'Size', ...choice({ small: 'Small', medium: 'Medium', large: 'Large' }, 'medium') },
      setting: { label: 'Setting', ...choice({ temperate: 'Green', snowy: 'Snowy', desert: 'Desert', swamp: 'Swamp' }, 'temperate') },
      water: { label: 'Water', ...choice({ random: 'Surprise me', none: 'None', river: 'River', lake: 'Lake', coast: 'Coast' }, 'random') },
      layout: { label: 'Layout', ...choice({ crossroads: 'Crossroads', street: 'One street', hamlet: 'Hamlet', walled: 'Walled town' }, 'crossroads') },
      buildings: { label: 'Buildings', ...choice({ few: 'Few', normal: 'Normal', many: 'Many' }, 'normal') },
      condition: { label: 'Condition', ...choice({ thriving: 'Thriving', normal: 'Lived in', ruined: 'Ruined' }, 'normal') },
      trees: { label: 'Trees', ...choice({ light: 'Light', normal: 'Normal', dense: 'Dense' }, 'normal') },
      market: { label: 'Market square', ...yes, def: true },
      temple: { label: 'Temple & graveyard', ...yes, def: true },
      farms: { label: 'Farm fields', ...yes, def: true },
      mill: { label: 'Mill', ...yes, def: false },
      tower: { label: 'Watchtower / lighthouse', ...yes, def: false },
      docks: { label: 'Docks & boats', ...yes, def: true },
      raiders: { label: 'Raiders (if ruined)', ...choice({ auto: 'Surprise me', goblinoid: 'Goblins', orcs: 'Orcs', bandits: 'Bandits', undead: 'Undead' }, 'auto') },
      creatures: { label: 'Villagers & animals', ...yes, def: true }
    }
  },
  dungeon: {
    label: 'Dungeon', blurb: 'Rooms, corridors, doors, traps, monsters',
    fields: {
      size: { label: 'Size', ...choice({ small: 'Small', medium: 'Medium', large: 'Large' }, 'medium') },
      style: { label: 'Style', ...choice({ halls: 'Stone halls', caves: 'Natural caves', crypt: 'Crypt', mine: 'Mine', sewer: 'Sewer', temple: 'Temple', lava: 'Lava forge', flooded: 'Flooded' }, 'halls') },
      rooms: { label: 'Rooms', ...choice({ few: 'Few', normal: 'Normal', many: 'Many' }, 'normal') },
      corridors: { label: 'Corridors', ...choice({ narrow: 'Narrow', wide: 'Wide' }, 'narrow') },
      loops: { label: 'Layout', ...choice({ linear: 'Linear', branching: 'Branching', maze: 'Maze-like' }, 'branching') },
      traps: { label: 'Traps', ...choice({ none: 'None', some: 'Some', many: 'Many' }, 'some') },
      monsters: { label: 'Monsters', ...choice({ auto: 'Suit the style', none: 'None', goblinoid: 'Goblins', kobold: 'Kobolds', orcs: 'Orcs', undead: 'Undead', beasts: 'Beasts', cultists: 'Cultists', bandits: 'Bandits' }, 'auto') },
      secrets: { label: 'Secret doors', ...yes, def: true },
      boss: { label: 'Boss room', ...yes, def: true }
    }
  },
  wilderness: {
    label: 'Wilderness', blurb: 'Forests, swamps, rivers, passes, oases, coasts',
    fields: {
      size: { label: 'Size', ...choice({ small: 'Small', medium: 'Medium', large: 'Large' }, 'medium') },
      kind: { label: 'Terrain', ...choice({ forest: 'Forest road', clearing: 'Forest clearing', swamp: 'Swamp', river: 'River crossing', pass: 'Mountain pass', oasis: 'Desert oasis', snowy: 'Snowy woods', coast: 'Coastline' }, 'forest') },
      density: { label: 'Cover', ...choice({ light: 'Open', normal: 'Normal', dense: 'Dense' }, 'normal') },
      road: { label: 'Road', ...yes, def: true },
      camp: { label: 'Campsite', ...yes, def: true },
      ruins: { label: 'Ruins', ...yes, def: false },
      pond: { label: 'Pond', ...yes, def: false },
      cave: { label: 'Cave entrance', ...yes, def: false },
      shrine: { label: 'Shrine', ...yes, def: false },
      wreck: { label: 'Wagon wreck', ...yes, def: false },
      foes: { label: 'Creatures', ...choice({ none: 'None', bandits: 'Bandits', wolves: 'Wolves', goblins: 'Goblins', undead: 'Undead', beasts: 'Beasts' }, 'bandits') }
    }
  },
  building: {
    label: 'Building', blurb: 'Inside a tavern, temple, manor, shop, guardhouse or tower',
    fields: {
      kind: { label: 'Building', ...choice({ tavern: 'Tavern / inn', temple: 'Temple', manor: 'Manor house', shop: 'Shop', guardhouse: 'Guardhouse', tower: 'Wizard tower' }, 'tavern') },
      size: { label: 'Size', ...choice({ small: 'Small', medium: 'Medium', large: 'Large' }, 'medium') },
      condition: { label: 'Condition', ...choice({ normal: 'Lived in', abandoned: 'Abandoned' }, 'normal') },
      yard: { label: 'Yard outside', ...yes, def: true },
      occupants: { label: 'People inside', ...yes, def: true }
    }
  }
};
export const defaults = (type) => Object.fromEntries(Object.entries(SCHEMA[type].fields).map(([k, f]) => [k, f.def]));

const SIZES = { small: [40, 30], medium: [60, 44], large: [84, 60] };

// ---------- shared helpers ----------
function makeMap(cols, rows, seed) {
  const r = rng(seed);
  const tiles = {}, props = [], tokens = [], used = new Uint8Array(cols * rows);
  const M = {
    cols, rows, r, tiles, props, tokens,
    int: (a, b) => a + Math.floor(r() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    chance: (p) => r() < p,
    shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; },
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
    propAt: (x, y) => props.some((p) => p.x === x && p.y === y),
    token(entry, x, y, extra = {}) { if (entry && M.inb(x, y)) tokens.push({ label: extra.label || entry.name, icon: entry.icon, color: entry.color, size: entry.size, x, y, owner: '', ...extra }); }
  };
  return M;
}
function wander(M, start, len, horizontal, drift = 0.25, lo = 4, hi = null) {
  const pts = []; let c = start, dir = 0;
  const max = (hi ?? ((horizontal ? M.rows : M.cols) - 5));
  for (let i = 0; i < len; i++) {
    if (M.chance(drift)) dir = M.pick([-1, 0, 0, 1]);
    c = Math.max(lo, Math.min(max, c + (M.chance(0.5) ? dir : 0)));
    pts.push(horizontal ? [i, c] : [c, i]);
  }
  return pts;
}
function paintBand(M, pts, width, horizontal, terrain, useVal, ok = () => true) {
  const o = Math.floor(width / 2);
  for (const [x, y] of pts) for (let k = -o; k < width - o; k++) {
    const cx = horizontal ? x : x + k, cy = horizontal ? y + k : y;
    if (!M.inb(cx, cy) || !ok(cx, cy)) continue;
    M.set(cx, cy, terrain); if (useVal) M.mark(cx, cy, useVal);
  }
}
function scatter(M, n, kinds, ok = () => true, tries = 6) {
  for (let i = 0; i < n * tries && n > 0; i++) {
    const x = M.int(0, M.cols - 1), y = M.int(0, M.rows - 1);
    if (M.use(x, y) || !ok(x, y)) continue;
    M.prop(M.pick(kinds), x, y, M.int(0, 3)); M.mark(x, y, 6); n--;
  }
}
function blob(M, cx, cy, rx, ry, fn) { // irregular ellipse
  for (let y = -ry - 1; y <= ry + 1; y++) for (let x = -rx - 1; x <= rx + 1; x++) {
    const d = (x * x) / (rx * rx) + (y * y) / (ry * ry) + (M.r() - 0.5) * 0.35;
    if (d <= 1 && M.inb(cx + x, cy + y)) fn(cx + x, cy + y, d);
  }
}
function fillGround(M, setting) {
  const base = { snowy: 'snow', desert: 'sand' }[setting] || 'grass';
  for (let y = 0; y < M.rows; y++) for (let x = 0; x < M.cols; x++) M.set(x, y, base);
  const patch = { temperate: 'dirt', snowy: 'stone', desert: 'dirt', swamp: 'dirt' }[setting] || 'dirt';
  for (let i = 0; i < M.cols * M.rows / 130; i++) blob(M, M.int(0, M.cols), M.int(0, M.rows), M.int(1, 2), M.int(1, 2), (x, y) => M.set(x, y, patch));
  if (setting === 'swamp') for (let i = 0; i < M.cols * M.rows / 160; i++) blob(M, M.int(0, M.cols), M.int(0, M.rows), M.int(1, 3), M.int(1, 2), (x, y) => { M.set(x, y, 'water'); M.mark(x, y, 2); });
}
const TREES = { temperate: ['tree', 'tree', 'pine', 'bush'], snowy: ['pine', 'pine', 'pine', 'deadtree'], desert: ['bush', 'rock', 'deadtree'], swamp: ['deadtree', 'tree', 'bush', 'reeds'] };
const roadTerrain = (setting) => ({ snowy: 'dirt', desert: 'dirt', swamp: 'dirt' }[setting] || 'path');

// Mirror the whole map left-right and/or top-bottom so layouts don't always face the same way.
function mirror(out, fx, fy) {
  if (!fx && !fy) return out;
  const X = (x) => (fx ? out.cols - 1 - x : x), Y = (y) => (fy ? out.rows - 1 - y : y);
  const tiles = {};
  for (const [k, t] of Object.entries(out.tiles)) { const [x, y] = k.split(',').map(Number); tiles[X(x) + ',' + Y(y)] = t; }
  const flipRot = (p) => (p.kind === 'stairs' && ((fy && p.rot % 2 === 0) || (fx && p.rot % 2 === 1)) ? (p.rot + 2) % 4 : p.rot);
  const props = out.props.map((p) => ({ ...p, x: X(p.x), y: Y(p.y), rot: flipRot(p) }));
  const tokens = out.tokens.map((t) => ({ ...t, x: fx ? out.cols - t.x - (t.size || 1) : t.x, y: fy ? out.rows - t.y - (t.size || 1) : t.y }));
  const [a, b, c, d] = out.start;
  return { ...out, tiles, props, tokens, start: [Math.min(X(a), X(c)), Math.min(Y(b), Y(d)), Math.max(X(a), X(c)), Math.max(Y(b), Y(d))] };
}

// ---------- monster groups ----------
const FOES = {
  goblinoid: { minions: ['Goblin', 'Goblin', 'Hobgoblin'], elite: ['Bugbear', 'Hobgoblin Captain'], boss: 'Goblin Boss' },
  kobold: { minions: ['Kobold', 'Kobold', 'Winged Kobold'], elite: ['Kobold Chieftain'], boss: 'Young Dragon' },
  orcs: { minions: ['Orc', 'Orc', 'Orc'], elite: ['Ogre'], boss: 'Orc War Chief' },
  undead: { minions: ['Skeleton', 'Zombie', 'Skeleton Archer'], elite: ['Ghoul', 'Wight'], boss: 'Vampire Spawn' },
  beasts: { minions: ['Giant Rat', 'Giant Centipede', 'Swarm of Bats', 'Wolf'], elite: ['Giant Spider'], boss: 'Owlbear' },
  cultists: { minions: ['Cultist', 'Cultist', 'Cult Fanatic'], elite: ['Cult Fanatic'], boss: 'Mage' },
  bandits: { minions: ['Bandit', 'Bandit', 'Thug'], elite: ['Scout', 'Veteran'], boss: 'Bandit Captain' },
  wolves: { minions: ['Wolf', 'Wolf'], elite: ['Dire Wolf'], boss: 'Dire Wolf' },
  goblins: { minions: ['Goblin', 'Goblin'], elite: ['Hobgoblin'], boss: 'Goblin Boss' }
};
const pickFoe = (M, set) => (M.chance(0.18) ? M.pick(set.elite) : M.pick(set.minions));

// ---------- buildings ----------
function building(M, x0, y0, w, h, doorSide, floor) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
    M.set(x, y, edge ? 'wall' : floor); M.mark(x, y, 3);
  }
  let dx, dy, rot;
  if (doorSide === 'n') { dx = x0 + Math.floor(w / 2); dy = y0; rot = 0; }
  if (doorSide === 's') { dx = x0 + Math.floor(w / 2); dy = y0 + h - 1; rot = 0; }
  if (doorSide === 'w') { dx = x0; dy = y0 + Math.floor(h / 2); rot = 1; }
  if (doorSide === 'e') { dx = x0 + w - 1; dy = y0 + Math.floor(h / 2); rot = 1; }
  M.set(dx, dy, floor); M.prop(w >= 9 && rot === 0 ? 'doubledoor' : 'door', dx, dy, rot);
  for (let x = x0 + 2; x < x0 + w - 2; x += 3) for (const y of [y0, y0 + h - 1]) if (Math.abs(x - dx) > 1 || y !== dy) M.prop('window', x, y, 0);
  for (let y = y0 + 2; y < y0 + h - 2; y += 3) for (const x of [x0, x0 + w - 1]) if (Math.abs(y - dy) > 1 || x !== dx) M.prop('window', x, y, 1);
  return { x0, y0, w, h, door: [dx, dy], doorSide, ix0: x0 + 1, iy0: y0 + 1, iw: w - 2, ih: h - 2 };
}
function interior(b) {
  const cells = [];
  for (let y = b.iy0; y < b.iy0 + b.ih; y++) for (let x = b.ix0; x < b.ix0 + b.iw; x++) cells.push([x, y]);
  const inFront = ([x, y]) => Math.abs(x - b.door[0]) + Math.abs(y - b.door[1]) <= 2;
  const back = {
    n: cells.filter(([, y]) => y === b.iy0 + b.ih - 1), s: cells.filter(([, y]) => y === b.iy0),
    w: cells.filter(([x]) => x === b.ix0 + b.iw - 1), e: cells.filter(([x]) => x === b.ix0)
  }[b.doorSide];
  return { cells, back, backRot: b.doorSide === 'n' || b.doorSide === 's' ? 0 : 1, inFront };
}
const frontOf = (b, [x, y]) => (b.doorSide === 'n' ? [x, y - 1] : b.doorSide === 's' ? [x, y + 1] : b.doorSide === 'w' ? [x - 1, y] : [x + 1, y]);

const FURNISH = {
  tavern(M, b, lib) {
    const I = interior(b), taken = new Set(), put = (k, [x, y], rot = 0) => { if (!taken.has(x + ',' + y)) { M.prop(k, x, y, rot); taken.add(x + ',' + y); } };
    I.back.slice(1, -1).forEach((c) => put('bar', c, I.backRot));
    [I.back[0], I.back[I.back.length - 1]].forEach((c) => put('barrel', c));
    const centre = I.cells.filter(([x, y]) => x > b.ix0 && x < b.ix0 + b.iw - 1 && y > b.iy0 && y < b.iy0 + b.ih - 1 && !I.inFront([x, y]) && !I.back.some((q) => q[0] === x && q[1] === y));
    for (let i = 0; i < Math.min(3, Math.floor(centre.length / 7)); i++) {
      const c = M.pick(centre); if (taken.has(c[0] + ',' + c[1])) continue;
      put('roundtable', c);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1]]) { const n = [c[0] + dx, c[1] + dy]; if (centre.some((q) => q[0] === n[0] && q[1] === n[1])) put('chair', n); }
    }
    const side = I.cells.find(([x, y]) => (x === b.ix0 || x === b.ix0 + b.iw - 1) && !I.inFront([x, y]) && !taken.has(x + ',' + y));
    if (side) put('fireplace', side);
    const mid = I.back[Math.floor(I.back.length / 2)];
    return [[lib.Innkeeper, frontOf(b, mid)]]; // in front of the bar, on the customers' side
  },
  smithy(M, b, lib) {
    const I = interior(b), c = I.cells.filter((q) => !I.inFront(q)), s = (n) => c[Math.floor((c.length - 1) * n)];
    M.prop('fireplace', ...I.back[0]); M.prop('anvil', ...s(.5)); M.prop('weaponrack', ...I.back[I.back.length - 1], I.backRot);
    M.prop('barrel', ...s(.15)); M.prop('crate', ...s(.85)); M.prop('logs', ...s(.3));
    return [[lib.Blacksmith, s(.6)]];
  },
  temple(M, b, lib) {
    const I = interior(b), mid = I.back[Math.floor(I.back.length / 2)];
    M.prop('altar', ...mid, I.backRot); M.prop('candle', ...I.back[0]); M.prop('candle', ...I.back[I.back.length - 1]);
    for (const q of I.cells) {
      const d = I.backRot ? Math.abs(q[0] - mid[0]) : Math.abs(q[1] - mid[1]);
      const across = I.backRot ? q[1] - b.iy0 : q[0] - b.ix0, span = I.backRot ? b.ih : b.iw;
      if (d >= 2 && d % 2 === 0 && across > 0 && across < span - 1 && across !== Math.floor(span / 2) && !I.inFront(q)) M.prop('bench', ...q, I.backRot ? 1 : 0);
    }
    return [[lib['Village Priest'], frontOf(b, mid)]];
  },
  store(M, b, lib) {
    const I = interior(b);
    I.back.forEach((c) => M.prop('bookshelf', ...c, I.backRot));
    const c = I.cells.filter((q) => !I.inFront(q) && !I.back.includes(q)), s = (n) => c[Math.floor((c.length - 1) * n)];
    M.prop('crate', ...s(0)); M.prop('barrel', ...s(.12)); M.prop('sack', ...s(.9)); M.prop('crate', ...s(1)); M.prop('bar', ...s(.5), I.backRot);
    return [[lib.Merchant, s(.45)]];
  },
  house(M, b, lib) {
    const I = interior(b), c = I.cells.filter((q) => !I.inFront(q));
    const far = c.reduce((a, q) => (Math.abs(q[0] - b.door[0]) + Math.abs(q[1] - b.door[1]) > Math.abs(a[0] - b.door[0]) + Math.abs(a[1] - b.door[1]) ? q : a), c[0]);
    M.prop('bed', ...far, 0);
    const rest = c.filter((q) => Math.abs(q[0] - far[0]) + Math.abs(q[1] - far[1]) > 1), s = (n) => rest[Math.floor((rest.length - 1) * n)];
    if (rest.length > 3) M.prop(M.pick(['table', 'roundtable']), ...s(.5));
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
  },
  mill(M, b, lib) {
    const I = interior(b), c = I.cells.filter((q) => !I.inFront(q)), s = (n) => c[Math.floor((c.length - 1) * n)];
    M.prop('rock', ...s(.5)); M.prop('sack', ...s(.1)); M.prop('sack', ...s(.2)); M.prop('logs', ...s(.9)); M.prop('crate', ...s(1));
    return [[lib.Farmer, s(.35)]];
  },
  tower(M, b, lib) {
    const I = interior(b), c = I.cells.filter((q) => !I.inFront(q)), s = (n) => c[Math.floor((c.length - 1) * n)];
    M.prop('ladder', ...s(1)); M.prop(b.coast ? 'brazier' : 'weaponrack', ...s(0)); M.prop('barrel', ...s(.5));
    return [[b.coast ? lib.Fisher : lib['Town Guard'], s(.3)]];
  },
  guardhouse(M, b, lib) {
    const I = interior(b), c = I.cells.filter((q) => !I.inFront(q)), s = (n) => c[Math.floor((c.length - 1) * n)];
    M.prop('weaponrack', ...I.back[0], I.backRot); M.prop('table', ...s(.5)); M.prop('chair', ...s(.6)); M.prop('bed', ...s(1)); M.prop('chest', ...s(.1));
    return [[lib['Town Guard'], s(.4)], [lib['Town Guard'], s(.7)]];
  }
};

// Knock a building about: holes in the walls, rubble, missing furniture.
function ruin(M, b) {
  for (let y = b.y0; y < b.y0 + b.h; y++) for (let x = b.x0; x < b.x0 + b.w; x++) {
    const edge = x === b.x0 || y === b.y0 || x === b.x0 + b.w - 1 || y === b.y0 + b.h - 1;
    if (edge && M.get(x, y) === 'wall' && M.chance(0.28)) { M.set(x, y, 'dirt'); if (M.chance(0.6)) M.prop('rubble', x, y); }
    else if (!edge && M.chance(0.12)) M.prop(M.pick(['rubble', 'bones', 'bush']), x, y, M.int(0, 3));
  }
  const inside = (p) => p.x >= b.x0 && p.y >= b.y0 && p.x < b.x0 + b.w && p.y < b.y0 + b.h;
  for (let i = M.props.length - 1; i >= 0; i--) {
    const p = M.props[i];
    if (inside(p) && (p.kind === 'door' || p.kind === 'doubledoor' || p.kind === 'window' || (!['rubble', 'bones', 'bush'].includes(p.kind) && M.chance(0.5)))) M.props.splice(i, 1);
  }
}

// =========================================================================================
// VILLAGE
// =========================================================================================
function village(S, seed, lib) {
  // a walled town needs room for its walls and streets, so a small one still gets the medium map area
  const [cols, rows] = SIZES[S.layout === 'walled' && S.size === 'small' ? 'medium' : S.size] || SIZES.medium;
  const M = makeMap(cols, rows, seed);
  const setting = S.setting, roadT = roadTerrain(setting);
  const water = S.water === 'random' ? M.pick(['none', 'river', 'river', 'lake', 'coast']) : S.water;
  const ruined = S.condition === 'ruined', thriving = S.condition === 'thriving';
  fillGround(M, setting);
  const isWater = (x, y) => M.use(x, y) === 2;
  const summary = [];

  // --- water ---
  let coastY = rows, river = null, lake = null, shoreline = [];
  if (water === 'coast') { // sea along the bottom edge (the map may be mirrored later)
    const depth = M.int(7, 9);
    const line = wander(M, rows - depth, cols, true, 0.4, rows - depth - 2, rows - depth + 2);
    coastY = Math.min(...line.map(([, y]) => y));
    for (const [x, y] of line) {
      for (let yy = y; yy < rows; yy++) { M.set(x, yy, 'water'); M.mark(x, yy, 2); }
      for (let yy = y - 2; yy < y; yy++) if (M.inb(x, yy)) M.set(x, yy, 'sand');
      shoreline.push([x, y]);
    }
    summary.push('on the coast');
  } else if (water === 'river') {
    const side = M.chance(.5) ? Math.floor(cols * 0.18) : Math.floor(cols * 0.82);
    river = wander(M, side, rows, false, 0.35);
    paintBand(M, river, M.int(3, 4), false, 'water', 2);
    for (const [x, y] of river) for (const dx of [-3, 3]) if (M.chance(.12) && !M.use(x + dx, y)) { M.prop('reeds', x + dx, y); M.mark(x + dx, y, 6); }
    for (let i = 0; i < rows / 6; i++) { const [x, y] = M.pick(river); M.prop('lilypad', x, y); }
    summary.push('by a river');
  } else if (water === 'lake') {
    const lx = M.chance(.5) ? Math.floor(cols * .15) : Math.floor(cols * .85), ly = M.chance(.5) ? Math.floor(rows * .2) : Math.floor(rows * .8);
    lake = { x: lx, y: ly, rx: M.int(5, 8), ry: M.int(4, 6) };
    blob(M, lx, ly, lake.rx, lake.ry, (x, y) => { M.set(x, y, 'water'); M.mark(x, y, 2); });
    blob(M, lx, ly, lake.rx + 2, lake.ry + 2, (x, y) => { if (!isWater(x, y) && M.chance(.12)) { M.prop('reeds', x, y); M.mark(x, y, 6); } });
    for (let i = 0; i < 4; i++) M.prop('lilypad', lx + M.int(-lake.rx + 2, lake.rx - 2), ly + M.int(-lake.ry + 2, lake.ry - 2));
    summary.push('by a lake');
  }

  // --- walls (walled town): a ring with gates where the roads pass through ---
  const walled = S.layout === 'walled';
  const ring = walled ? { x0: 3, y0: 3, x1: cols - 4, y1: Math.min(rows - 4, coastY - 4) } : null;

  // --- roads ---
  const midY = Math.floor((walled ? (ring.y0 + ring.y1) / 2 : Math.min(rows / 2, coastY - 10))) + M.int(-2, 2);
  const main = wander(M, Math.max(6, midY), cols, true, S.layout === 'street' ? 0.12 : 0.2, 5, Math.max(6, coastY - 7));
  const sqX = Math.floor(cols / 2) + M.int(-4, 4), sqY = main[sqX][1];
  let branch = [];
  if (S.layout === 'crossroads' || walled) {
    const up = wander(M, sqX, sqY, false, 0.2).map(([x, y]) => [x, y]);
    const down = wander(M, sqX, Math.max(0, Math.min(rows, coastY + (water === 'coast' ? 2 : 0)) - sqY), false, 0.2).map(([x, y]) => [x, sqY + y]);
    branch = water === 'coast' ? [...up, ...down] : M.chance(.5) ? [...up, ...down] : (M.chance(.5) ? up : down);
  } else if (water === 'coast' || (S.layout === 'street' && M.chance(.4))) {
    branch = wander(M, sqX, Math.max(0, coastY - sqY), false, 0.2).map(([x, y]) => [x, sqY + y]);
  }
  paintBand(M, main, S.layout === 'hamlet' ? 2 : 3, true, roadT, 1, (x, y) => !isWater(x, y));
  paintBand(M, branch, 2, false, roadT, 1, (x, y) => !isWater(x, y));
  for (const [x, y] of main) for (let k = -1; k <= 1; k++) if (isWater(x, y + k)) M.prop('bridge', x, y + k, 0);
  for (const [x, y] of branch) for (let k = 0; k <= 1; k++) if (isWater(x + k, y) && y < coastY - 1) M.prop('bridge', x + k, y, 1);

  if (walled) {
    const gates = new Set();
    for (const [x, y] of main) if (x === ring.x0 || x === ring.x1) for (let k = -1; k <= 1; k++) gates.add(x + ',' + (y + k));
    for (const [x, y] of branch) if (y === ring.y0 || y === ring.y1) for (let k = 0; k <= 1; k++) gates.add((x + k) + ',' + y);
    for (let x = ring.x0; x <= ring.x1; x++) for (const y of [ring.y0, ring.y1]) if (!gates.has(x + ',' + y) && !isWater(x, y)) { M.set(x, y, 'wall'); M.mark(x, y, 3); }
    for (let y = ring.y0; y <= ring.y1; y++) for (const x of [ring.x0, ring.x1]) if (!gates.has(x + ',' + y) && !isWater(x, y)) { M.set(x, y, 'wall'); M.mark(x, y, 3); }
    for (const g of gates) { const [x, y] = g.split(',').map(Number); if (M.inb(x, y) && !isWater(x, y)) { M.prop('archway', x, y, x === ring.x0 || x === ring.x1 ? 1 : 0); M.mark(x, y, 1); } }
    for (const [x, y] of [[ring.x0, ring.y0], [ring.x1, ring.y0], [ring.x0, ring.y1], [ring.x1, ring.y1]]) M.prop('brazier', x, y);
    summary.push('walled');
  }

  // --- square ---
  const hasSquare = S.market && S.layout !== 'hamlet';
  const rad = S.size === 'small' ? 4 : thriving ? 6 : 5;
  if (hasSquare) {
    for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
      if (x * x + y * y > rad * rad + 2) continue;
      const cx = sqX + x, cy = sqY + y; if (!M.inb(cx, cy) || isWater(cx, cy) || M.use(cx, cy) === 3) continue;
      M.set(cx, cy, 'cobble'); M.mark(cx, cy, 4);
    }
    M.prop(M.chance(.5) ? 'well' : 'fountain', sqX, sqY);
    const spots = M.shuffle([[-3, -3], [3, -3], [-3, 3], [3, 3], [0, -4], [0, 4], [-4, 0], [4, 0]]).slice(0, thriving ? 6 : S.size === 'small' ? 2 : 3);
    if (!ruined) spots.forEach(([dx, dy]) => M.prop('stall', sqX + dx, sqY + dy, 0));
    [[-rad, 0], [rad, 0]].forEach(([dx, dy]) => M.prop('lamppost', sqX + dx, sqY + dy));
    summary.push('market square');
  } else if (S.layout !== 'hamlet') { M.prop('well', sqX, sqY - 2); }
  if (!ruined) for (let i = 4; i < cols - 4; i += thriving ? 6 : 9) { const [x, y] = main[i]; if (!isWater(x, y - 2) && !M.use(x, y - 2)) M.prop('lamppost', x, y - 2); }
  M.prop('signpost', 2, main[2][1] - 2);

  // --- buildings ---
  const roadCells = [...main.map(([x, y]) => ({ x, y, h: true })), ...branch.map(([x, y]) => ({ x, y, h: false }))]
    .filter(({ x, y }) => !hasSquare || Math.abs(x - sqX) > rad + 1 || Math.abs(y - sqY) > rad + 1);
  const houseCount = { small: 5, medium: 9, large: 15 }[S.size] * { few: 0.5, normal: 1, many: 1.7 }[S.buildings] * (S.layout === 'hamlet' ? 0.5 : 1);
  const plan = S.layout === 'hamlet' ? ['tavern'] : ['tavern', 'smithy', 'store', 'stable'];
  if (S.temple) plan.splice(1, 0, 'temple');
  if (S.mill) plan.push('mill');
  if (S.tower) plan.push('tower');
  if (walled) plan.push('guardhouse');
  for (let i = 0; i < Math.round(houseCount); i++) plan.push('house');
  const dims = S.size === 'small'
    ? { tavern: [9, 7], smithy: [6, 5], temple: [7, 9], store: [6, 5], stable: [7, 5], house: [5, 5], mill: [5, 5], tower: [5, 5], guardhouse: [6, 5] }
    : { tavern: [11, 8], smithy: [7, 6], temple: [9, 11], store: [8, 6], stable: [8, 6], house: [6, 5], mill: [6, 6], tower: [5, 5], guardhouse: [7, 6] };
  const inRing = (x0, y0, w, h) => !walled || (x0 > ring.x0 && y0 > ring.y0 && x0 + w <= ring.x1 && y0 + h <= ring.y1);
  const placed = [], people = [];
  for (const kind of plan) {
    for (let tries = 0; tries < 300; tries++) {
      let rc = M.pick(roadCells);
      if (kind === 'mill' && (river || lake)) { const w = river ? M.pick(river) : [lake.x + M.int(-lake.rx - 3, lake.rx + 3), lake.y + M.int(-lake.ry - 3, lake.ry + 3)]; rc = roadCells.reduce((a, q) => (Math.abs(q.x - w[0]) + Math.abs(q.y - w[1]) < Math.abs(a.x - w[0]) + Math.abs(a.y - w[1]) ? q : a), roadCells[0]); }
      if (kind === 'tower' && water === 'coast') rc = M.pick(roadCells.filter((q) => !q.h) .concat(roadCells.filter((q) => q.y > coastY - 12)).concat([roadCells[0]]));
      const side = M.chance(.5) ? -1 : 1;
      let [w, h] = dims[kind];
      if (kind === 'house') { w = M.int(5, S.size === 'small' ? 6 : 7); h = M.int(5, 6); }
      if (!rc.h) [w, h] = [h, w];
      // first along the road; if that's full, set back behind the front row
      const gap = tries < 150 ? M.int(1, S.layout === 'hamlet' ? 4 : 2) : M.int(3, 9);
      let x0, y0, doorSide;
      if (rc.h) { x0 = rc.x - Math.floor(w / 2) + M.int(-1, 1); y0 = side < 0 ? rc.y - 2 - gap - h + 1 : rc.y + 2 + gap; doorSide = side < 0 ? 's' : 'n'; }
      else { y0 = rc.y - Math.floor(h / 2); x0 = side < 0 ? rc.x - 1 - gap - w + 1 : rc.x + 2 + gap; doorSide = side < 0 ? 'e' : 'w'; }
      if (x0 < 1 || y0 < 1 || x0 + w > cols - 1 || y0 + h > Math.min(rows - 1, coastY - 1) || !inRing(x0, y0, w, h) || !M.free(x0, y0, w, h, 1)) continue;
      const floor = { temple: 'marble', stable: 'dirt', smithy: 'stone', tower: 'stone', guardhouse: 'stone' }[kind] || 'wood';
      const b = building(M, x0, y0, w, h, doorSide, floor);
      b.coast = water === 'coast';
      let [px, py] = b.door; const step = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[doorSide];
      for (let k = 0; k < 5; k++) { px += step[0]; py += step[1]; const u = M.use(px, py); if (u === 1 || u === 4 || !M.inb(px, py)) break; if (u === 0 || u === 6) { M.set(px, py, roadT); M.mark(px, py, 7); } }
      people.push(...FURNISH[kind](M, b, lib).map((p) => [...p, kind]));
      placed.push({ kind, b });
      if (kind === 'temple') { // graveyard beside the temple
        const gx = x0 + w + 2, gy = y0;
        if (M.free(gx, gy, 5, 5, 0) && inRing(gx, gy, 5, 5)) {
          for (let yy = 0; yy < 5; yy++) for (let xx = 0; xx < 5; xx++) {
            const e = xx === 0 || yy === 0 || xx === 4 || yy === 4;
            if (e) M.prop('fence', gx + xx, gy + yy, yy === 0 || yy === 4 ? 0 : 1); else if ((xx + yy) % 2 === 0) M.prop('grave', gx + xx, gy + yy);
            M.mark(gx + xx, gy + yy, 7);
          }
        }
      }
      if (kind === 'stable' || kind === 'store') { const cx = b.door[0] + (b.doorSide === 'n' || b.doorSide === 's' ? 2 : 0), cy = b.door[1] + (b.doorSide === 'w' || b.doorSide === 'e' ? 2 : 0); if (!M.use(cx, cy)) { M.prop('cart', cx, cy, b.doorSide === 'n' || b.doorSide === 's' ? 0 : 1); M.mark(cx, cy, 6); } }
      break;
    }
  }
  summary.push(`${placed.length} buildings`);

  // --- docks: a pier into the sea or lake, with boats ---
  if (S.docks && (water === 'coast' || water === 'lake' || water === 'river')) {
    let made = false;
    if (water === 'coast') {
      const bx = branch.length ? branch[branch.length - 1][0] : sqX;
      const sy = shoreline.find(([x]) => x === bx)?.[1] ?? coastY;
      for (let y = sy - 1; y < Math.min(rows, sy + 5); y++) for (let k = 0; k <= 1; k++) { M.set(bx + k, y, 'water'); M.prop('bridge', bx + k, y, 1); }
      M.prop('boat', bx - 1, sy + 3, 1); M.prop('boat', bx + 3, sy + 2, 1); M.prop('crate', bx + 2, sy - 2); M.prop('barrel', bx - 1, sy - 2);
      made = true;
    } else if (lake) {
      for (let k = 0; k < 4; k++) M.prop('bridge', lake.x + (lake.x < cols / 2 ? lake.rx - k : -lake.rx + k), lake.y, 0);
      M.prop('boat', lake.x, lake.y + 2, 0); made = true;
    } else if (river) {
      const [rx, ry] = river[Math.floor(rows * .7)]; M.prop('boat', rx, ry, 1); made = true;
    }
    if (made) summary.push('docks');
  }

  // --- fields ---
  const fieldSpots = [];
  if (S.farms && setting !== 'desert') {
    const n = { small: 2, medium: 3, large: 5 }[S.size] + (S.layout === 'hamlet' ? 1 : 0);
    for (let f = 0, tries = 0; f < n && tries < 500; tries++) {
      const w = M.int(7, 11), h = M.int(5, 8), x0 = M.int(2, cols - w - 2), y0 = M.int(2, Math.max(3, Math.min(rows, coastY - 2) - h - 2));
      if (!M.free(x0 - 1, y0 - 1, w + 2, h + 2, 1)) continue;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { M.set(x, y, setting === 'snowy' ? 'snow' : 'farm'); M.mark(x, y, 5); }
      for (let x = x0 - 1; x <= x0 + w; x++) { M.prop('fence', x, y0 - 1, 0); M.prop('fence', x, y0 + h, 0); M.mark(x, y0 - 1, 7); M.mark(x, y0 + h, 7); }
      for (let y = y0; y < y0 + h; y++) { M.prop('fence', x0 - 1, y, 1); M.prop('fence', x0 + w, y, 1); M.mark(x0 - 1, y, 7); M.mark(x0 + w, y, 7); }
      M.prop('haystack', x0 + w - 1, y0); fieldSpots.push([x0, y0, w, h]); f++;
    }
    if (fieldSpots.length) summary.push('farms');
  }

  // --- ruin it ---
  if (ruined) {
    placed.forEach(({ b }) => { if (M.chance(0.75)) ruin(M, b); });
    scatter(M, Math.floor(cols * rows / 140), ['rubble', 'bones', 'deadtree', 'bush'], () => true);
    summary.unshift('ruined');
  }

  // --- trees and greenery ---
  const trees = TREES[setting];
  const dens = { light: 0.5, normal: 1, dense: 1.8 }[S.trees];
  const edge = (x, y) => Math.min(x, y, cols - 1 - x, rows - 1 - y);
  scatter(M, Math.floor(cols * rows / 14 * dens), trees, (x, y) => edge(x, y) < (S.trees === 'dense' ? 5 : 3) && M.chance(.85) && y < coastY - 1, 3);
  scatter(M, Math.floor(cols * rows / 90 * dens), [...trees, 'stump'], (x, y) => y < coastY - 2);
  scatter(M, Math.floor(cols * rows / 120), setting === 'desert' ? ['rock', 'rock', 'bush'] : setting === 'snowy' ? ['rock', 'logs', 'stump'] : thriving ? ['flowers', 'flowers', 'rock'] : ['flowers', 'rock', 'logs'], (x, y) => y < coastY - 1);
  if (water === 'coast') scatter(M, Math.floor(cols / 4), ['rock', 'rock', 'logs'], (x, y) => y >= coastY - 2 && y < coastY + 1 && !isWater(x, y));

  // --- people ---
  if (S.creatures) {
    if (ruined) {
      const set = FOES[S.raiders && S.raiders !== 'auto' ? S.raiders : M.pick(['goblinoid', 'bandits', 'undead', 'orcs'])];
      for (let i = 0; i < (placed.length ? Math.round(houseCount / 1.5) + 2 : 0); i++) { const { b } = M.pick(placed); M.token(lib[pickFoe(M, set)], b.ix0 + M.int(0, b.iw - 1), b.iy0 + M.int(0, b.ih - 1), { hidden: true }); }
    } else {
      for (const [entry, [x, y]] of people) M.token(entry, x, y);
      const crowd = thriving ? 10 : S.size === 'small' ? 3 : 6;
      for (let i = 0; i < crowd; i++) { const a = M.int(0, 359) * Math.PI / 180, d = M.int(2, rad); M.token(M.pick([lib.Villager, lib.Commoner, lib.Child, lib.Dog, lib.Chicken, lib.Merchant]), Math.round(sqX + Math.cos(a) * d), Math.round(sqY + Math.sin(a) * d)); }
      if (walled || thriving) { M.token(lib['Town Guard'], 3, main[3][1] + 2); M.token(lib['Town Guard'], cols - 4, main[cols - 4][1] - 2); }
      for (const [x0, y0, w, h] of fieldSpots) { M.token(lib.Farmer, x0 + 1, y0 + 1); if (M.chance(.6)) M.token(M.pick([lib.Cow, lib.Sheep, lib.Pig, lib.Goat]), x0 + Math.floor(w / 2), y0 + Math.floor(h / 2)); }
      if (water === 'coast') M.token(lib.Fisher, sqX, Math.max(2, coastY - 3));
    }
  }

  const name = M.pick(['Oak', 'Mill', 'Ash', 'Elm', 'Thorn', 'Stone', 'Raven', 'Wolf', 'Green', 'Fern', 'Kings', 'Black', 'Red', 'High', 'Low', 'Bram', 'Willow', 'Barrow', 'Frost', 'Salt', 'Dun', 'Marsh'])
    + M.pick(water === 'coast' ? ['haven', 'port', 'mouth', 'cove', 'wick'] : setting === 'snowy' ? ['hold', 'fell', 'stead', 'moor'] : ['ford', 'brook', 'field', 'stead', 'wick', 'ton', 'bury', 'dale', 'holm', 'hollow', 'bridge', 'well', 'by']);
  const sy = main[0][1];
  const label = { temperate: '', snowy: 'Snowy ', desert: 'Desert ', swamp: 'Swamp ' }[setting] + ({ walled: 'town', hamlet: 'hamlet' }[S.layout] || 'village');
  return mirror({ name, summary: [label, ...summary.filter((s) => s !== 'walled' || !label.includes('town'))].join(' · '), cols, rows, tiles: M.tiles, props: M.props, tokens: M.tokens, start: [0, sy - 5, 7, sy + 5] }, M.chance(.5), water === 'coast' && M.chance(.5));
}

// =========================================================================================
// DUNGEON
// =========================================================================================
const DSTYLE = {
  halls: { floor: 'stone', corridor: 'cobble', themes: ['throne', 'crypt', 'storage', 'library', 'prison', 'shrine', 'treasure', 'barracks', 'pool', 'collapsed', 'lair'], roomW: [5, 11], roomH: [5, 9], names: ['Halls', 'Keep', 'Vault', 'Warrens'] },
  crypt: { floor: 'stone', corridor: 'stone', themes: ['crypt', 'crypt', 'crypt', 'shrine', 'prison', 'treasure', 'collapsed'], roomW: [4, 8], roomH: [4, 7], names: ['Crypt', 'Catacombs', 'Tomb', 'Ossuary'], monsters: 'undead', more: 1.3 },
  temple: { floor: 'marble', corridor: 'marble', themes: ['shrine', 'shrine', 'throne', 'library', 'barracks', 'treasure', 'pool'], roomW: [7, 13], roomH: [6, 10], names: ['Temple', 'Sanctum', 'Fane', 'Shrine'], monsters: 'cultists', pillars: true },
  mine: { floor: 'dirt', corridor: 'dirt', themes: ['storage', 'storage', 'collapsed', 'lair', 'crystals', 'camp'], roomW: [5, 10], roomH: [4, 8], names: ['Mine', 'Delve', 'Diggings', 'Shafts'], monsters: 'kobold', jagged: true, wide: true },
  sewer: { floor: 'cobble', corridor: 'cobble', themes: ['pool', 'storage', 'lair', 'collapsed', 'prison'], roomW: [5, 8], roomH: [5, 8], names: ['Sewers', 'Drains', 'Undercity', 'Cisterns'], monsters: 'beasts', channel: true, wide: true },
  lava: { floor: 'stone', corridor: 'cobble', themes: ['forge', 'forge', 'lavapool', 'throne', 'storage', 'barracks', 'treasure'], roomW: [6, 11], roomH: [5, 9], names: ['Forge', 'Furnace', 'Cinderhold', 'Crucible'], monsters: 'orcs' },
  flooded: { floor: 'stone', corridor: 'cobble', themes: ['pool', 'pool', 'crypt', 'collapsed', 'storage', 'shrine'], roomW: [5, 11], roomH: [5, 9], names: ['Drowned Halls', 'Sunken Vault', 'Flooded Keep'], monsters: 'undead', wet: true }
};

function dungeon(S, seed, lib) {
  const [cols, rows] = SIZES[S.size] || SIZES.medium;
  const M = makeMap(cols, rows, seed);
  if (S.style === 'caves') return caves(S, M, lib);
  const st = DSTYLE[S.style] || DSTYLE.halls;
  const floor = new Uint8Array(cols * rows), at = (x, y) => (M.inb(x, y) ? floor[y * cols + x] : 0);
  const rooms = [];
  const target = Math.round({ small: 7, medium: 12, large: 20 }[S.size] * { few: 0.6, normal: 1, many: 1.5 }[S.rooms] * (st.more || 1));
  for (let tries = 0; tries < 1500 && rooms.length < target; tries++) {
    const w = M.int(...st.roomW), h = M.int(...st.roomH), x = M.int(2, cols - w - 3), y = M.int(2, rows - h - 3);
    const gap = S.rooms === 'many' ? 2 : 3;
    if (rooms.some((o) => x < o.x + o.w + gap && x + w + gap > o.x && y < o.y + o.h + gap && y + h + gap > o.y)) continue;
    rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
  }
  if (!rooms.length) rooms.push({ x: 3, y: 3, w: 7, h: 6, cx: 6, cy: 6 });
  const inRoom = (x, y) => rooms.find((o) => x >= o.x && y >= o.y && x < o.x + o.w && y < o.y + o.h);
  for (const o of rooms) for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) { floor[y * cols + x] = 1; M.set(x, y, st.floor); }
  // ragged mine chambers: nibble the corners
  if (st.jagged) for (const o of rooms) for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) {
    const e = Math.min(x - o.x, y - o.y, o.x + o.w - 1 - x, o.y + o.h - 1 - y);
    if (e === 0 && M.chance(0.35) && !(x === o.cx || y === o.cy)) { floor[y * cols + x] = 0; M.set(x, y, null); }
  }

  const wide = S.corridors === 'wide' || st.wide;
  const corridor = new Set();
  const carve = (x, y) => { if (!M.inb(x, y) || x < 1 || y < 1 || x > cols - 2 || y > rows - 2) return; if (!floor[y * cols + x]) { floor[y * cols + x] = 2; M.set(x, y, st.corridor); corridor.add(x + ',' + y); } };
  const dig = (a, b) => {
    let x = a.cx, y = a.cy; const hf = M.chance(.5);
    const stepTo = (tx, ty) => { while (x !== tx || y !== ty) { const horiz = x !== tx && (hf || y === ty); if (horiz) x += Math.sign(tx - x); else y += Math.sign(ty - y); carve(x, y); if (wide) { if (horiz) carve(x, y + 1); else carve(x + 1, y); } } };
    if (hf) { stepTo(b.cx, a.cy); stepTo(b.cx, b.cy); } else { stepTo(a.cx, b.cy); stepTo(b.cx, b.cy); }
  };
  const done = [rooms[0]], todo = rooms.slice(1), links = [];
  while (todo.length) {
    let best = null;
    for (const t of todo) for (const d of done) { const dist = Math.abs(t.cx - d.cx) + Math.abs(t.cy - d.cy); if (!best || dist < best[2]) best = [t, d, dist]; }
    if (S.loops === 'linear') { const last = done[done.length - 1]; best = [todo.reduce((a, t) => (Math.abs(t.cx - last.cx) + Math.abs(t.cy - last.cy) < Math.abs(a.cx - last.cx) + Math.abs(a.cy - last.cy) ? t : a)), last]; }
    dig(best[1], best[0]); links.push([best[1], best[0]]); done.push(best[0]); todo.splice(todo.indexOf(best[0]), 1);
  }
  const extra = { linear: 0, branching: Math.max(1, rooms.length / 5), maze: rooms.length * 0.8 }[S.loops];
  for (let i = 0; i < extra; i++) dig(M.pick(rooms), M.pick(rooms));
  // maze-like: extra dead-end side passages
  if (S.loops === 'maze') for (let i = 0; i < rooms.length; i++) { const o = M.pick(rooms); dig(o, { cx: M.int(3, cols - 4), cy: M.int(3, rows - 4) }); }

  // sewer channel down the middle of corridors; flooded dungeons get standing water
  if (st.channel) for (const k of corridor) { const [x, y] = k.split(',').map(Number); if (corridor.has((x + 1) + ',' + y) && corridor.has(x + ',' + (y + 1)) && M.chance(0.75)) M.set(x, y, 'water'); }
  if (st.wet) for (let i = 0; i < rooms.length * 2; i++) { const k = M.pick([...corridor]); if (!k) break; const [x, y] = k.split(',').map(Number); blob(M, x, y, M.int(1, 2), M.int(1, 2), (xx, yy) => { if (at(xx, yy)) M.set(xx, yy, 'water'); }); }

  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (at(x, y)) continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (at(x + dx, y + dy)) { near = true; break; }
    if (near) M.set(x, y, 'wall');
  }
  const taken = new Set(), put = (k, x, y, rot = 0) => { if (M.inb(x, y) && !taken.has(x + ',' + y) && at(x, y)) { M.prop(k, x, y, rot); taken.add(x + ',' + y); return true; } return false; };

  // doors where a corridor meets a room
  let secrets = 0;
  if (!st.jagged && !st.channel) for (const key of corridor) {
    const [x, y] = key.split(',').map(Number);
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => inRoom(x + dx, y + dy));
    if (n.length !== 1) continue;
    const [dx] = n[0];
    const sideWalls = dx ? M.get(x, y - 1) === 'wall' && M.get(x, y + 1) === 'wall' : M.get(x - 1, y) === 'wall' && M.get(x + 1, y) === 'wall';
    if (!sideWalls || !M.chance(.7)) continue;
    const roll = M.r();
    const kind = S.secrets && roll < .12 ? 'secretdoor' : roll < .2 ? 'portcullis' : roll < .3 ? 'archway' : 'door';
    if (kind === 'secretdoor') { M.set(x, y, 'wall'); secrets++; }
    put(kind, x, y, dx ? 1 : 0);
  }

  // furthest room from the entrance becomes the boss room
  const dist = (a, b) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
  const bossRoom = S.boss && rooms.length > 3 ? rooms.slice(1).reduce((a, o) => (dist(o, rooms[0]) > dist(a, rooms[0]) ? o : a), rooms[1]) : null;
  const foeKey = S.monsters === 'auto' ? (st.monsters || 'goblinoid') : S.monsters;
  const foes = FOES[foeKey === 'none' ? null : foeKey];

  rooms.forEach((o, i) => {
    const cells = []; for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) if (at(x, y) === 1) cells.push([x, y]);
    const edgeCells = cells.filter(([x, y]) => x === o.x || y === o.y || x === o.x + o.w - 1 || y === o.y + o.h - 1);
    const doorAdj = ([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => corridor.has((x + dx) + ',' + (y + dy)));
    const wallSpots = edgeCells.filter((c) => !doorAdj(c));
    const rnd = () => M.pick(cells.filter((c) => !taken.has(c[0] + ',' + c[1]) && !doorAdj(c))) || cells[0];
    for (let k = 0; k < Math.max(1, Math.floor(wallSpots.length / 10)); k++) { const c = M.pick(wallSpots); if (c) put(st.floor === 'dirt' ? 'torch' : M.chance(.8) ? 'torch' : 'brazier', ...c); }
    if (st.pillars && o.w >= 7 && o.h >= 6) for (let x = o.x + 1; x < o.x + o.w - 1; x += 2) { put('pillar', x, o.y + 1); put('pillar', x, o.y + o.h - 2); }
    if (i === 0) { put('stairs', o.cx, o.cy); return; }
    const theme = o === bossRoom ? (st === DSTYLE.temple ? 'shrine' : 'throne') : M.pick(st.themes);
    const T = {
      throne: () => { put('throne', o.cx, o.y + 1); put('rug', o.cx, o.y + 2); [[o.x + 1, o.y + 1], [o.x + o.w - 2, o.y + 1], [o.x + 1, o.y + o.h - 2], [o.x + o.w - 2, o.y + o.h - 2]].forEach((c) => put('pillar', ...c)); put('brazier', o.cx - 1, o.y + 1); put('brazier', o.cx + 1, o.y + 1); },
      crypt: () => { for (let k = 0; k < Math.min(6, cells.length / 4); k++) put('coffin', ...rnd()); put('bones', ...rnd()); put('candle', ...rnd()); },
      storage: () => { for (let k = 0; k < 6; k++) { const c = M.pick(wallSpots); if (c) put(M.pick(['crate', 'barrel', 'sack', 'crate']), ...c); } },
      library: () => { wallSpots.filter(([, y]) => y === o.y).forEach((c) => put('bookshelf', ...c)); put('desk', o.cx, o.cy); put('candle', ...rnd()); },
      prison: () => { put('cage', ...rnd()); put('cage', ...rnd()); put('bones', ...rnd()); const c = M.pick(wallSpots); if (c) put('lever', ...c); },
      shrine: () => { put('altar', o.cx, o.y + 1); put('statue', o.x + 1, o.y + 1); put('statue', o.x + o.w - 2, o.y + 1); put('candle', ...rnd()); put('candle', ...rnd()); },
      treasure: () => { put('chest', o.cx, o.cy); put('chest', o.cx + 1, o.cy); put('crystal', ...rnd()); if (S.traps !== 'none') put('trap', o.cx, o.cy + 1); },
      barracks: () => { wallSpots.filter(([, y]) => y === o.y).slice(0, 6).forEach((c, k) => k % 2 === 0 && put('bed', ...c)); put('table', o.cx, o.cy); const c = M.pick(wallSpots); if (c) put('weaponrack', ...c); },
      pool: () => { if (o.w > 5 && o.h > 5) blob(M, o.cx, o.cy, Math.max(1, (o.w >> 1) - 2), Math.max(1, (o.h >> 1) - 2), (x, y) => { if (at(x, y) === 1) M.set(x, y, 'water'); }); put('reeds', o.x + 1, o.y + 1); put('lilypad', o.cx, o.cy); },
      collapsed: () => { for (let k = 0; k < 6; k++) put('rubble', ...rnd()); put('brokenpillar', ...rnd()); if (o.w > 6) M.set(o.cx, o.cy, 'pit'); },
      lair: () => { put('bones', ...rnd()); put('bones', ...rnd()); const c = M.pick(wallSpots); if (c) put('chest', ...c); put('campfire', o.cx, o.cy); },
      crystals: () => { for (let k = 0; k < 4; k++) put('crystal', ...rnd()); put('rock', ...rnd()); },
      camp: () => { put('campfire', o.cx, o.cy); put('tent', o.x + 1, o.y + 1); put('logs', ...rnd()); put('cart', ...rnd()); },
      forge: () => { put('anvil', o.cx, o.cy); put('fireplace', o.cx, o.y); put('weaponrack', ...(M.pick(wallSpots) || [o.x, o.y])); put('barrel', ...rnd()); put('crate', ...rnd()); for (let x = o.x + 1; x < o.x + o.w - 1; x++) if (M.chance(.5)) M.set(x, o.y + o.h - 1, 'lava'); },
      lavapool: () => { const y = o.cy; for (let x = o.x; x < o.x + o.w; x++) M.set(x, y, 'lava'); M.prop('bridge', o.cx, y, 1); taken.add(o.cx + ',' + y); put('brazier', ...rnd()); }
    };
    (T[theme] || T.storage)();
    if (o === bossRoom) { put('chest', o.cx, o.y + o.h - 2); if (foes) M.token(lib[foes.boss], o.cx, o.cy, { hidden: true }); }
    if (foes) {
      const n = M.int(o === bossRoom ? 2 : 0, Math.min(o === bossRoom ? 5 : 4, Math.floor(cells.length / 12)));
      for (let k = 0; k < n; k++) { const c = rnd(); M.token(lib[pickFoe(M, foes)], c[0], c[1], { hidden: true }); taken.add(c[0] + ',' + c[1]); }
    }
  });
  if (rooms.length > 3 && !bossRoom) put('stairs', rooms[rooms.length - 1].cx, rooms[rooms.length - 1].cy, 2);
  const cor = [...corridor];
  const nTraps = Math.floor(cor.length / { none: Infinity, some: 25, many: 10 }[S.traps]);
  for (let k = 0; k < nTraps; k++) { const [x, y] = M.pick(cor).split(',').map(Number); put('trap', x, y); }
  if (st.channel) for (let k = 0; k < cor.length / 30; k++) { const [x, y] = M.pick(cor).split(',').map(Number); put(M.pick(['bars', 'rubble', 'bones']), x, y); }

  const name = M.pick(['The Sunken', 'The Forgotten', 'The Black', 'The Howling', 'The Ember', 'The Hollow', 'The Silent', 'The Rotting']) + ' ' + M.pick(st.names);
  const e = rooms[0];
  const styleName = { halls: 'Stone halls', crypt: 'Crypt', temple: 'Temple', mine: 'Mine', sewer: 'Sewer', lava: 'Lava forge', flooded: 'Flooded dungeon' }[S.style] || 'Dungeon';
  const summary = [styleName, `${rooms.length} rooms`, foes ? `${M.tokens.length} ${foeKey === 'goblinoid' ? 'goblins' : foeKey}` : 'no monsters', nTraps ? `${nTraps} traps` : '', secrets ? `${secrets} secret doors` : '', bossRoom ? 'boss room' : ''].filter(Boolean).join(' · ');
  return mirror({ name, summary, cols, rows, tiles: M.tiles, props: M.props, tokens: M.tokens, start: [e.x - 1, e.y - 1, e.x + e.w, e.y + e.h] }, M.chance(.5), M.chance(.5));
}

// Natural caves: cellular automata, keep the biggest open area.
function caves(S, M, lib) {
  const { cols, rows } = M;
  let g = new Uint8Array(cols * rows);
  const fill = { few: 0.5, normal: 0.46, many: 0.43 }[S.rooms];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) g[y * cols + x] = x < 2 || y < 2 || x > cols - 3 || y > rows - 3 || M.chance(fill) ? 1 : 0;
  for (let it = 0; it < 5; it++) {
    const n = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; c += xx < 0 || yy < 0 || xx >= cols || yy >= rows ? 1 : g[yy * cols + xx]; }
      n[y * cols + x] = c >= 5 ? 1 : 0;
    }
    g = n;
  }
  // biggest connected open region
  const region = new Int32Array(cols * rows).fill(-1); let best = -1, bestSize = 0, id = 0;
  for (let i = 0; i < g.length; i++) {
    if (g[i] || region[i] >= 0) continue;
    const q = [i]; region[i] = id; let size = 0;
    while (q.length) { const j = q.pop(); size++; const x = j % cols, y = (j / cols) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy, k = yy * cols + xx; if (xx >= 0 && yy >= 0 && xx < cols && yy < rows && !g[k] && region[k] < 0) { region[k] = id; q.push(k); } } }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  const open = (x, y) => M.inb(x, y) && region[y * cols + x] === best;
  const cells = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (open(x, y)) { M.set(x, y, M.chance(.15) ? 'stone' : 'dirt'); cells.push([x, y]); }
    else { let near = false; for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (open(x + dx, y + dy)) { near = true; break; } if (near) M.set(x, y, 'wall'); }
  }
  // pools, rocks, mushrooms, crystals
  for (let i = 0; i < cells.length / 400; i++) { const [x, y] = M.pick(cells); blob(M, x, y, M.int(1, 3), M.int(1, 2), (xx, yy) => { if (open(xx, yy)) M.set(xx, yy, 'water'); }); }
  const taken = new Set(), put = (k, x, y) => { if (!taken.has(x + ',' + y) && open(x, y)) { M.prop(k, x, y, M.int(0, 3)); taken.add(x + ',' + y); } };
  for (let i = 0; i < cells.length / 45; i++) put(M.pick(['rock', 'rock', 'mushrooms', 'rubble', 'bones', 'crystal']), ...M.pick(cells));
  // entrance at the cell nearest the left edge; "rooms" are spread-out points for monsters
  const entry = cells.reduce((a, c) => (c[0] < a[0] ? c : a), cells[0]);
  put('stairs', ...entry);
  const foes = FOES[S.monsters === 'auto' ? 'beasts' : S.monsters === 'none' ? null : S.monsters];
  const far = cells.reduce((a, c) => (Math.abs(c[0] - entry[0]) + Math.abs(c[1] - entry[1]) > Math.abs(a[0] - entry[0]) + Math.abs(a[1] - entry[1]) ? c : a), cells[0]);
  if (S.boss) { put('chest', far[0], far[1]); put('bones', far[0] + 1, far[1]); if (foes) M.token(lib[foes.boss], far[0], far[1] - 1, { hidden: true }); }
  if (foes) for (let i = 0; i < Math.round(cells.length / 90); i++) { const c = M.pick(cells); if (Math.abs(c[0] - entry[0]) + Math.abs(c[1] - entry[1]) > 10 && !taken.has(c[0] + ',' + c[1])) { M.token(lib[pickFoe(M, foes)], c[0], c[1], { hidden: true }); taken.add(c[0] + ',' + c[1]); } }
  const nTraps = S.traps === 'none' ? 0 : S.traps === 'many' ? 8 : 3;
  for (let i = 0; i < nTraps; i++) put('trap', ...M.pick(cells));
  const name = M.pick(['The Dripping', 'The Echoing', 'The Black', 'Wyrm', 'Bat', 'The Glittering']) + ' ' + M.pick(['Caves', 'Caverns', 'Grotto', 'Hollows']);
  return { name, summary: `Natural caves · ${foes ? M.tokens.length + ' creatures' : 'no monsters'}${nTraps ? ` · ${nTraps} traps` : ''}${S.boss ? ' · lair at the far end' : ''}`, cols, rows, tiles: M.tiles, props: M.props, tokens: M.tokens, start: [entry[0] - 5, entry[1] - 5, entry[0] + 5, entry[1] + 5] };
}

// =========================================================================================
// WILDERNESS
// =========================================================================================
function wilderness(S, seed, lib) {
  const [cols, rows] = SIZES[S.size] || SIZES.medium;
  const M = makeMap(cols, rows, seed);
  const kind = S.kind;
  const setting = { snowy: 'snowy', oasis: 'desert', swamp: 'swamp' }[kind] || 'temperate';
  fillGround(M, setting);
  if (kind === 'pass') for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) M.set(x, y, M.chance(.6) ? 'stone' : 'dirt');
  const isWater = (x, y) => M.use(x, y) === 2;
  const summary = [SCHEMA.wilderness.fields.kind.options[kind]];
  const clear = (cx, cy, rad, v = 7) => { for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad && M.inb(cx + x, cy + y) && !M.use(cx + x, cy + y)) M.mark(cx + x, cy + y, v); };

  // water features that define the kind
  let coastY = rows;
  if (kind === 'river') {
    const river = wander(M, Math.floor(rows / 2), cols, true, 0.3);
    paintBand(M, river, M.int(4, 6), true, 'water', 2);
    for (const [x, y] of river) for (const dy of [-4, 4]) if (M.chance(.15) && !M.use(x, y + dy)) { M.prop('reeds', x, y + dy); M.mark(x, y + dy, 6); }
  }
  if (kind === 'coast') {
    const line = wander(M, rows - M.int(10, 13), cols, true, 0.45, rows - 15, rows - 9);
    coastY = Math.min(...line.map(([, y]) => y));
    for (const [x, y] of line) { for (let yy = y; yy < rows; yy++) { M.set(x, yy, 'water'); M.mark(x, yy, 2); } for (let yy = y - 4; yy < y; yy++) if (M.inb(x, yy)) M.set(x, yy, 'sand'); }
    scatter(M, cols / 2, ['rock', 'rock', 'logs'], (x, y) => y > coastY - 5 && y < coastY + 1);
    M.prop('boat', Math.floor(cols * .6), coastY + 2, 0);
  }
  if (kind === 'oasis') {
    const ox = Math.floor(cols / 2) + M.int(-5, 5), oy = Math.floor(rows / 2) + M.int(-4, 4);
    blob(M, ox, oy, 9, 7, (x, y) => M.set(x, y, 'grass'));
    blob(M, ox, oy, 4, 3, (x, y) => { M.set(x, y, 'water'); M.mark(x, y, 2); });
    blob(M, ox, oy, 7, 5, (x, y) => { if (!isWater(x, y) && M.chance(.18)) { M.prop(M.pick(['tree', 'bush', 'reeds']), x, y); M.mark(x, y, 6); } });
    for (let i = 0; i < 3; i++) { const a = M.r() * 6.28; M.prop('tent', Math.round(ox + Math.cos(a) * 10), Math.round(oy + Math.sin(a) * 8)); }
  }
  if (kind === 'pass') { // rocky ridges along both sides
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const wall = Math.abs(y - rows / 2) / (rows / 2);
      if (wall > 0.55 && M.chance(wall * 0.9)) { M.prop('rock', x, y, M.int(0, 3)); M.mark(x, y, 6); }
    }
  }

  // road
  let road = null;
  if (S.road && kind !== 'clearing') {
    const vertical = kind === 'river';
    road = wander(M, vertical ? Math.floor(cols / 2) : Math.min(Math.floor(rows / 2), coastY - 8), vertical ? rows : cols, !vertical, kind === 'pass' ? 0.15 : 0.35);
    paintBand(M, road, kind === 'pass' ? 2 : 3, !vertical, kind === 'pass' || setting !== 'temperate' ? 'dirt' : 'path', 1, (x, y) => !isWater(x, y) || kind !== 'coast');
    for (const [x, y] of road) for (let k = -1; k <= 1; k++) { const cx = vertical ? x + k : x, cy = vertical ? y : y + k; if (M.inb(cx, cy) && M.get(cx, cy) === 'water') { M.set(cx, cy, 'water'); M.prop('bridge', cx, cy, vertical ? 1 : 0); M.mark(cx, cy, 1); } }
    for (const [x, y] of road) for (const d of [-3, -2, 2, 3]) { const cx = vertical ? x + d : x, cy = vertical ? y : y + d; if (M.inb(cx, cy) && !M.use(cx, cy)) M.mark(cx, cy, 7); }
    M.prop('signpost', ...(vertical ? [road[3][0] + 2, road[3][1]] : [road[3][0], road[3][1] - 2]));
    summary.push('road');
  }
  const along = (f, off) => { if (!road) return [Math.floor(cols * f), Math.floor(rows / 2) + off]; const p = road[Math.floor(road.length * f)]; return kind === 'river' ? [p[0] + off, p[1]] : [p[0], p[1] + off]; };
  const spot = (f) => along(f, (M.chance(.5) ? -1 : 1) * M.int(6, 9));

  // features
  const feats = [];
  if (kind === 'clearing') { const cx = Math.floor(cols / 2), cy = Math.floor(rows / 2); clear(cx, cy, 9); for (let y = -9; y <= 9; y++) for (let x = -9; x <= 9; x++) if (x * x + y * y <= 64 && M.chance(.3)) M.set(cx + x, cy + y, M.pick(['grass', 'dirt'])); }
  if (S.camp) { const [x, y] = kind === 'clearing' ? [Math.floor(cols / 2), Math.floor(rows / 2)] : spot(.3); clear(x, y, 4); M.prop('campfire', x, y); M.prop('tent', x - 2, y - 2); M.prop('tent', x + 2, y - 2); M.prop('log', x, y + 2); M.prop('logs', x + 3, y + 1); M.prop('crate', x - 3, y + 1); feats.push(['camp', x, y]); summary.push('campsite'); }
  if (S.pond && kind !== 'oasis') { const [x, y] = spot(.7); blob(M, x, y, 5, 4, (xx, yy) => { M.set(xx, yy, 'water'); M.mark(xx, yy, 2); }); blob(M, x, y, 7, 6, (xx, yy) => { if (!isWater(xx, yy) && M.chance(.25)) { M.prop('reeds', xx, yy); M.mark(xx, yy, 6); } else if (!M.use(xx, yy)) M.mark(xx, yy, 7); }); M.prop('lilypad', x, y); feats.push(['pond', x, y]); summary.push('pond'); }
  if (S.ruins) { const [x, y] = spot(.55); clear(x, y, 4); for (let k = 0; k < 7; k++) M.prop(M.pick(['brokenpillar', 'rubble', 'rubble', 'pillar']), x + M.int(-3, 3), y + M.int(-3, 3)); M.prop('statue', x, y); for (let k = -2; k <= 2; k++) { M.set(x + k, y - 3, 'cobble'); M.set(x + k, y + 3, 'cobble'); } feats.push(['ruins', x, y]); summary.push('ruins'); }
  if (S.cave) { const [x, y] = spot(.85); clear(x, y, 3); for (let a = 0; a < 6.28; a += 0.5) { M.prop('rock', Math.round(x + Math.cos(a) * 3), Math.round(y + Math.sin(a) * 2.5), M.int(0, 3)); } M.set(x, y, 'pit'); M.set(x + 1, y, 'pit'); M.prop('bones', x - 1, y + 1); feats.push(['cave', x, y]); summary.push('cave entrance'); }
  if (S.shrine) { const [x, y] = spot(.15); clear(x, y, 3); M.prop('statue', x, y); M.prop('candle', x - 1, y + 1); M.prop('candle', x + 1, y + 1); M.prop('flowers', x, y + 2); for (let k = -1; k <= 1; k++) M.set(x + k, y, 'marble'); feats.push(['shrine', x, y]); summary.push('shrine'); }
  if (S.wreck && road) { const [x, y] = along(.62, 0); M.prop('cart', x, y, 1); M.prop('crate', x + 1, y + 1); M.prop('barrel', x - 1, y - 1); M.prop('rubble', x + 2, y); M.prop('sack', x - 2, y + 1); feats.push(['wreck', x, y]); summary.push('wagon wreck'); }

  // cover: groves of trees (or rocks in a pass, dead trees in a swamp)
  const dens = { light: 0.5, normal: 1, dense: 1.7 }[S.density];
  const trees = kind === 'pass' ? ['rock', 'pine', 'rock'] : kind === 'oasis' ? ['rock', 'bush', 'deadtree'] : TREES[setting];
  const groves = Array.from({ length: Math.floor(cols * rows / 180 * dens) }, () => [M.int(0, cols), M.int(0, rows), M.int(4, 9), M.pick(trees)]);
  const grove = (x, y) => groves.find(([gx, gy, gr]) => (x - gx) ** 2 + (y - gy) ** 2 <= gr * gr);
  const base = kind === 'oasis' ? 0.25 : kind === 'pass' ? 0.6 : 1;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (M.use(x, y) || y >= coastY - 3) continue;
    const g = grove(x, y);
    if (g ? M.chance(.42 * base) : M.chance(.04 * dens * base)) { M.prop(g ? (M.chance(.8) ? g[3] : M.pick(trees)) : M.pick(trees), x, y, M.int(0, 3)); M.mark(x, y, 6); }
    else if (g && M.chance(.12) && setting === 'temperate') M.set(x, y, 'dirt');
  }
  scatter(M, Math.floor(cols * rows / 70), kind === 'swamp' ? ['reeds', 'mushrooms', 'deadtree', 'lilypad'] : kind === 'oasis' ? ['rock', 'rock', 'bush'] : setting === 'snowy' ? ['rock', 'stump', 'log'] : ['rock', 'stump', 'log', 'mushrooms', 'deadtree', 'flowers', 'flowers'], (x, y) => y < coastY - 1);

  // creatures, hidden until revealed
  const foes = FOES[S.foes === 'none' ? null : S.foes];
  if (foes) {
    const where = feats.length ? M.pick(feats) : ['x', Math.floor(cols / 2), Math.floor(rows / 2)];
    const camp = feats.find((f) => f[0] === 'camp') || where;
    const n = { small: 4, medium: 6, large: 9 }[S.size];
    for (let k = 0; k < n; k++) M.token(lib[pickFoe(M, foes)], camp[1] + M.int(-4, 4), camp[2] + M.int(-4, 4), { hidden: true });
    M.token(lib[foes.boss], camp[1] + 1, camp[2] + 1, { hidden: true });
    summary.push(`${n + 1} ${S.foes}`);
  }
  const name = { forest: ['Old Road', 'King\'s Road', 'Wolf Road'], clearing: ['Hidden Glade', 'Elder Clearing', 'Stag Glade'], swamp: ['Blackwater Fen', 'Rotting Marsh', 'Grey Bog'], river: ['Ford of the Willows', 'Stonebridge Crossing', 'Rushing Ford'], pass: ['Wind Gap', 'Giant\'s Stair', 'Crow Pass'], oasis: ['Palm Well', 'Mirage Spring', 'Sandsong Oasis'], snowy: ['Frostpine Woods', 'Winter Road', 'Whitefell'], coast: ['Wreckers\' Cove', 'Gull Strand', 'Saltrock Shore'] }[kind];
  const start = road ? (kind === 'river' ? [road[0][0] - 5, 0, road[0][0] + 5, 7] : [0, road[0][1] - 5, 7, road[0][1] + 5]) : [0, Math.floor(rows / 2) - 5, 7, Math.floor(rows / 2) + 5];
  return mirror({ name: M.pick(name), summary: summary.join(' · '), cols, rows, tiles: M.tiles, props: M.props, tokens: M.tokens, start }, M.chance(.5), kind !== 'coast' && M.chance(.5));
}

// =========================================================================================
// BUILDING INTERIOR
// =========================================================================================
const ROOMS = {
  tavern: ['common', 'kitchen', 'storage', 'bedroom', 'bedroom', 'bedroom', 'bedroom', 'bedroom'],
  temple: ['nave', 'vestry', 'library', 'bedroom', 'storage', 'bedroom'],
  manor: ['hall', 'dining', 'library', 'kitchen', 'bedroom', 'bedroom', 'study', 'storage', 'bedroom'],
  shop: ['shopfloor', 'storage', 'kitchen', 'bedroom', 'study'],
  guardhouse: ['barracks', 'armory', 'cells', 'office', 'kitchen', 'storage', 'cells'],
  tower: ['lab', 'library', 'bedroom', 'storage', 'study', 'lab']
};
const ROOM_NAMES = { common: 'common room', kitchen: 'kitchen', storage: 'storeroom', bedroom: 'bedroom', nave: 'nave', vestry: 'vestry', library: 'library', hall: 'great hall', dining: 'dining room', study: 'study', shopfloor: 'shop floor', barracks: 'barracks', armory: 'armoury', cells: 'cells', office: 'office', lab: 'laboratory' };

function buildingMap(S, seed, lib) {
  const dims = { small: [14, 10], medium: [20, 14], large: [28, 18] }[S.size];
  const pad = S.yard ? 5 : 2;
  const cols = dims[0] + pad * 2, rows = dims[1] + pad * 2;
  const M = makeMap(cols, rows, seed);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) M.set(x, y, 'grass');
  for (let i = 0; i < cols * rows / 60; i++) M.set(M.int(0, cols), M.int(0, rows), 'dirt');
  const X0 = pad, Y0 = pad, W = dims[0], H = dims[1];
  const abandoned = S.condition === 'abandoned';

  // split the floor plan into rooms (binary space partition)
  const leaves = [], walls = [];
  const split = (r, depth) => {
    const canV = r.w >= 8, canH = r.h >= 8;
    const big = r.w * r.h > ({ small: 22, medium: 28, large: 36 }[S.size]);
    if ((!canV && !canH) || (!big && depth > 1) || depth > 5) { leaves.push(r); return; }
    const vert = canV && (!canH || r.w > r.h * 1.2 || (r.w >= r.h * 0.8 && M.chance(.5)));
    if (vert) { const at = r.x + M.int(3, r.w - 4); walls.push({ x: at, y: r.y, w: 1, h: r.h, vert: true, a: { x: r.x, y: r.y, w: at - r.x, h: r.h }, b: { x: at + 1, y: r.y, w: r.x + r.w - at - 1, h: r.h } }); split({ x: r.x, y: r.y, w: at - r.x, h: r.h }, depth + 1); split({ x: at + 1, y: r.y, w: r.x + r.w - at - 1, h: r.h }, depth + 1); }
    else { const at = r.y + M.int(3, r.h - 4); walls.push({ x: r.x, y: at, w: r.w, h: 1, vert: false }); split({ x: r.x, y: r.y, w: r.w, h: at - r.y }, depth + 1); split({ x: r.x, y: at + 1, w: r.w, h: r.y + r.h - at - 1 }, depth + 1); }
  };
  // the main room keeps a big share: carve it off first
  const inner = { x: X0 + 1, y: Y0 + 1, w: W - 2, h: H - 2 };
  const mainW = Math.max(6, Math.round(inner.w * (S.kind === 'shop' ? 0.4 : S.kind === 'tower' ? 0.42 : 0.5)));
  const mainRoom = { x: inner.x, y: inner.y, w: mainW, h: inner.h };
  walls.push({ x: inner.x + mainW, y: inner.y, w: 1, h: inner.h, vert: true });
  leaves.push(mainRoom);
  split({ x: inner.x + mainW + 1, y: inner.y, w: inner.w - mainW - 1, h: inner.h }, 0);

  // draw: outer walls, inner walls, floors
  const floorFor = { kitchen: 'stone', storage: 'stone', nave: 'marble', cells: 'stone', armory: 'stone', hall: S.kind === 'manor' ? 'marble' : 'wood', lab: 'stone', barracks: 'wood' };
  for (let y = Y0; y < Y0 + H; y++) for (let x = X0; x < X0 + W; x++) M.set(x, y, x === X0 || y === Y0 || x === X0 + W - 1 || y === Y0 + H - 1 ? 'wall' : 'wood');
  for (const w of walls) for (let y = w.y; y < w.y + w.h; y++) for (let x = w.x; x < w.x + w.w; x++) M.set(x, y, 'wall');
  const purposes = ROOMS[S.kind];
  const order = [mainRoom, ...leaves.filter((l) => l !== mainRoom).sort((a, b) => b.w * b.h - a.w * a.h)];
  order.forEach((r, i) => { r.purpose = purposes[Math.min(i, purposes.length - 1)] || 'storage'; if (i >= purposes.length) r.purpose = M.pick(['storage', 'bedroom']); });
  for (const r of order) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) M.set(x, y, floorFor[r.purpose] || 'wood');

  // doors: one through each interior wall between two rooms that touch it
  const roomAt = (x, y) => order.find((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);
  const connected = new Set();
  for (const w of walls) {
    const cands = [];
    for (let y = w.y; y < w.y + w.h; y++) for (let x = w.x; x < w.x + w.w; x++) {
      const a = w.vert ? roomAt(x - 1, y) : roomAt(x, y - 1), b = w.vert ? roomAt(x + 1, y) : roomAt(x, y + 1);
      if (a && b && a !== b) cands.push([x, y, a, b]);
    }
    const byPair = {};
    for (const c of cands) { const k = order.indexOf(c[2]) + '-' + order.indexOf(c[3]); (byPair[k] = byPair[k] || []).push(c); }
    for (const [k, list] of Object.entries(byPair)) {
      if (connected.has(k)) continue; connected.add(k);
      const [x, y, a] = list[Math.floor(list.length / 2)];
      M.set(x, y, floorFor[a.purpose] || 'wood');
      M.prop(abandoned && M.chance(.4) ? 'dooropen' : 'door', x, y, w.vert ? 1 : 0);
    }
  }
  // front door on the main room's outer wall, facing the yard
  const fy = mainRoom.y + Math.floor(mainRoom.h / 2);
  M.set(X0, fy, 'wood'); M.prop(abandoned ? 'dooropen' : 'doubledoor', X0, fy, 1);
  // windows on the outer walls
  for (let x = X0 + 2; x < X0 + W - 2; x += 3) for (const y of [Y0, Y0 + H - 1]) if (M.get(x, y) === 'wall' && M.get(x, y === Y0 ? y + 1 : y - 1) !== 'wall') M.prop('window', x, y, 0);
  for (let y = Y0 + 2; y < Y0 + H - 2; y += 3) for (const x of [X0, X0 + W - 1]) if (y !== fy && M.get(x, y) === 'wall' && M.get(x === X0 ? x + 1 : x - 1, y) !== 'wall') M.prop('window', x, y, 1);

  // furnish each room
  const taken = new Set();
  const put = (k, x, y, rot = 0) => { const t = M.get(x, y); if (t && t !== 'wall' && !taken.has(x + ',' + y) && !M.props.some((p) => p.x === x && p.y === y)) { M.prop(k, x, y, rot); taken.add(x + ',' + y); return true; } return false; };
  const people = [];
  for (const r of order) {
    const cells = []; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cells.push([x, y]);
    const nearDoor = ([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => M.props.some((p) => (p.kind.includes('door')) && p.x === x + dx && p.y === y + dy));
    const edge = cells.filter(([x, y]) => (x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1) && !nearDoor([x, y]));
    const top = edge.filter(([, y]) => y === r.y), left = edge.filter(([x]) => x === r.x), right = edge.filter(([x]) => x === r.x + r.w - 1);
    const mid = cells.filter(([x, y]) => x > r.x && y > r.y && x < r.x + r.w - 1 && y < r.y + r.h - 1 && !nearDoor([x, y]));
    const any = () => M.pick(mid.length ? mid : cells);
    const cx = r.x + (r.w >> 1), cy = r.y + (r.h >> 1);
    const F = {
      common() {
        right.slice(1, -1).forEach(([x, y]) => put('bar', x, y, 1)); put('barrel', ...right[0] || [cx, cy]); put('barrel', ...right[right.length - 1] || [cx, cy]);
        for (let y = r.y + 1; y < r.y + r.h - 1; y += 3) for (let x = r.x + 1; x < r.x + r.w - 3; x += 3) { if (put('roundtable', x, y)) { put('chair', x + 1, y); put('chair', x, y + 1); } }
        if (top.length > 2) put('fireplace', ...top[Math.floor(top.length / 2)]); put('rug', cx, cy);
        people.push([lib.Innkeeper, [r.x + r.w - 2, cy]], [lib.Commoner, [r.x + 2, r.y + 1]], [lib.Villager, [r.x + 1, r.y + 4]], [M.pick([lib.Bard, lib.Traveller, lib.Merchant]), [r.x + 4, r.y + 2]]);
      },
      kitchen() { if (top.length) put('fireplace', ...top[0]); put('cauldron', cx, cy); put('table', ...any()); edge.slice(0, 3).forEach((c) => put(M.pick(['barrel', 'sack', 'crate']), ...c)); people.push([lib.Commoner, [cx + 1, cy]]); },
      storage() { edge.slice(0, Math.max(3, edge.length / 2)).forEach((c) => put(M.pick(['crate', 'barrel', 'sack', 'crate']), ...c)); },
      bedroom() { const c = edge[0] || [cx, cy]; put('bed', ...c); put('chest', ...(edge[2] || any())); put(M.pick(['wardrobe', 'chair', 'rug', 'candle']), ...any()); },
      nave() { const ax = r.x + r.w - 2; put('altar', ax, cy, 1); put('candle', ax, cy - 2); put('candle', ax, cy + 2); put('statue', r.x + r.w - 1, r.y); for (let x = r.x + 1; x < ax - 1; x += 2) for (let y = r.y + 1; y < r.y + r.h - 1; y++) if (y !== cy) put('bench', x, y, 1); people.push([lib.Priest, [ax - 1, cy]], [lib.Acolyte, [ax - 1, cy + 1]]); },
      vestry() { edge.slice(0, 2).forEach((c) => put('wardrobe', ...c)); put('chest', ...any()); put('candle', ...any()); },
      library() { top.forEach(([x, y]) => put('bookshelf', x, y)); left.slice(1).forEach(([x, y]) => put('bookshelf', x, y, 1)); put('desk', cx, cy); put('candle', cx + 1, cy); },
      hall() { put('throne', r.x + r.w - 2, cy, 1); put('rug', cx, cy); for (let x = r.x + 1; x < r.x + r.w - 1; x += 3) { put('pillar', x, r.y + 1); put('pillar', x, r.y + r.h - 2); } if (top.length > 2) put('fireplace', ...top[Math.floor(top.length / 2)]); people.push([lib.Noble, [r.x + r.w - 3, cy]], [lib.Guard, [r.x + r.w - 3, cy - 2]]); },
      dining() { for (let x = r.x + 1; x < r.x + r.w - 1; x++) if (put('table', x, cy)) { put('chair', x, cy - 1); put('chair', x, cy + 1); } put('candle', r.x, cy); },
      study() { put('desk', cx, cy); put('chair', cx, cy + 1); if (top.length) put('bookshelf', ...top[0]); put('chest', ...any()); },
      shopfloor() { for (let y = r.y + 1; y < r.y + r.h - 1; y++) put('bar', r.x + r.w - 2, y, 1); top.forEach(([x, y]) => put('bookshelf', x, y)); edge.filter(([, y]) => y === r.y + r.h - 1).forEach((c) => put(M.pick(['crate', 'barrel', 'sack']), ...c)); people.push([lib.Merchant, [r.x + r.w - 1, cy]]); },
      barracks() { edge.forEach((c, i) => { if (i % 2 === 0) put('bed', ...c); }); put('table', cx, cy); people.push([lib['Town Guard'], [cx, cy + 1]], [lib.Veteran, [cx + 1, cy]]); },
      armory() { edge.forEach((c, i) => put(i % 3 ? 'weaponrack' : 'crate', ...c, (c[0] === r.x || c[0] === r.x + r.w - 1) ? 1 : 0)); },
      cells() { for (let y = r.y; y < r.y + r.h; y++) put('bars', cx, y, 1); put('bones', ...any()); put('bed', ...(edge[0] || any())); },
      office() { put('desk', cx, cy); put('chair', cx, cy + 1); put('chest', ...(edge[0] || any())); if (top.length) put('bookshelf', ...top[0]); people.push([lib.Knight, [cx + 1, cy]]); },
      lab() { put('cauldron', cx, cy); put('crystal', ...any()); put('desk', ...any()); if (top.length) put('bookshelf', ...top[0]); put('candle', ...any()); people.push([lib.Mage, [cx + 1, cy + 1]]); }
    };
    (F[r.purpose] || F.storage)();
  }
  // stairs up in a corner room for bigger buildings
  if (S.size !== 'small') { const r = order[order.length - 1]; put('stairs', r.x, r.y); }

  // yard: path to the door, trees, maybe a well and a cart
  if (S.yard) {
    for (let x = 0; x < X0; x++) M.set(x, fy, 'path');
    M.prop('signpost', X0 - 2, fy - 2); M.prop('lamppost', X0 - 1, fy + 2);
    if (S.kind === 'tavern' || S.kind === 'manor') M.prop('well', X0 - 3, fy + 4);
    if (S.kind === 'tavern' || S.kind === 'shop') M.prop('cart', X0 - 3, fy - 4, 1);
    if (S.kind === 'temple') for (let k = 0; k < 4; k++) M.prop('grave', X0 + 3 + k * 2, Y0 + H + 2);
    for (let i = 0; i < (cols + rows) * 0.8; i++) {
      const x = M.int(0, cols - 1), y = M.int(0, rows - 1);
      if (x >= X0 - 1 && x <= X0 + W && y >= Y0 - 1 && y <= Y0 + H) continue;
      if (Math.abs(y - fy) < 2 && x < X0) continue;
      if (!M.propAt(x, y)) M.prop(M.pick(['tree', 'bush', 'flowers', 'tree', 'rock']), x, y, M.int(0, 3));
    }
  }

  if (abandoned) {
    for (let i = M.props.length - 1; i >= 0; i--) if (!['door', 'dooropen', 'doubledoor', 'window', 'bars'].includes(M.props[i].kind) && M.chance(.35)) M.props.splice(i, 1);
    for (const r of order) for (let k = 0; k < 2; k++) { const x = r.x + M.int(0, r.w - 1), y = r.y + M.int(0, r.h - 1); if (!M.propAt(x, y)) M.prop(M.pick(['rubble', 'bones', 'rubble']), x, y); }
    for (const [x, y] of [[X0, Y0 + 3], [X0 + W - 1, Y0 + H - 4]]) { M.set(x, y, 'dirt'); M.prop('rubble', x, y); }
  }
  if (S.occupants && !abandoned) for (const [e, [x, y]] of people) if (e && M.get(x, y) !== 'wall') M.token(e, x, y);
  if (S.occupants && abandoned) { const set = FOES[M.pick(['undead', 'beasts', 'bandits'])]; for (let k = 0; k < 4; k++) { const r = M.pick(order); M.token(lib[pickFoe(M, set)], r.x + M.int(0, r.w - 1), r.y + M.int(0, r.h - 1), { hidden: true }); } }

  const names = {
    tavern: () => `The ${M.pick(['Prancing', 'Drunken', 'Golden', 'Sleeping', 'Rusty', 'Laughing', 'Green', 'Wandering'])} ${M.pick(['Stag', 'Dragon', 'Goose', 'Griffon', 'Barrel', 'Boar', 'Lantern', 'Pony'])}`,
    temple: () => `Temple of the ${M.pick(['Dawn', 'Silver Flame', 'Harvest', 'Tides', 'Morning Star'])}`,
    manor: () => `${M.pick(['Ashford', 'Blackwood', 'Ravensworth', 'Thornfield', 'Greymoor'])} Manor`,
    shop: () => `${M.pick(['Bram\'s', 'Old Nell\'s', 'The Copper', 'Silas\'s'])} ${M.pick(['Goods', 'Curios', 'Emporium', 'Supplies'])}`,
    guardhouse: () => `${M.pick(['North', 'River', 'East', 'Old'])} Gate Guardhouse`,
    tower: () => `${M.pick(['Azure', 'Crooked', 'Ivory', 'Whispering'])} Tower`
  };
  const roomList = [...new Set(order.map((r) => ROOM_NAMES[r.purpose]))].slice(0, 5).join(', ');
  return { name: (abandoned ? 'Abandoned ' : '') + names[S.kind](), summary: `${SCHEMA.building.fields.kind.options[S.kind]} · ${order.length} rooms (${roomList}${order.length > 5 ? '…' : ''})`, cols, rows, tiles: M.tiles, props: M.props, tokens: M.tokens, start: [0, fy - 4, X0 + 3, fy + 4] };
}

// ---------- entry point ----------
const GEN = { village, dungeon, wilderness, building: buildingMap };
export function generate(type, settings, seed, lib = {}) {
  const S = { ...defaults(type), ...settings };
  return { ...GEN[type](S, seed >>> 0, lib), seed: seed >>> 0 };
}
