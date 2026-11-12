// Procedural map generators (v2). generate(type, settings, seed, lib) returns
// { name, summary, cols, rows, tiles: {"x,y": terrain}, props, tokens, start: [x0,y0,x1,y1] }.
// SCHEMA describes every setting; the Generate dialog and the description box are both built from it.
import { rng } from './art.js';

const yes = { type: 'bool' };
const choice = (options, def) => ({ type: 'choice', options, def });
// 1.11: monsters sized for the party, treasure, room names and DM notes, on every kind of map that has foes
const LEVELS = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i + 1), 'Level ' + (i + 1)]));
const READY = {
  partyLevel: { label: 'Party level', ...choice(LEVELS, '3') },
  partySize: { label: 'Party size', ...choice({ 2: '2 players', 3: '3 players', 4: '4 players', 5: '5 players', 6: '6 players', 7: '7 players' }, '4') },
  difficulty: { label: 'Fights', ...choice({ easy: 'Easy', medium: 'Medium', hard: 'Hard' }, 'medium') },
  notes: { label: 'Room names & DM notes', ...yes, def: true },
  loot: { label: 'Treasure in chests', ...yes, def: true }
};

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
      roomSize: { label: 'Room size', ...choice({ small: 'Small', normal: 'Normal', large: 'Large' }, 'normal') },
      corridors: { label: 'Corridors', ...choice({ narrow: 'Narrow', wide: 'Wide', twisty: 'Twisty' }, 'narrow') },
      doors: { label: 'Doors', ...choice({ few: 'Few', normal: 'Normal', many: 'Many' }, 'normal') },
      clutter: { label: 'Clutter', ...choice({ none: 'None', some: 'Some', lots: 'Lots' }, 'some') },
      levels: { label: 'Levels', ...choice({ 1: 'One', 2: 'Two (stairs down)', 3: 'Three' }, '1') },
      loops: { label: 'Layout', ...choice({ linear: 'Linear', branching: 'Branching', maze: 'Maze-like' }, 'branching') },
      traps: { label: 'Traps', ...choice({ none: 'None', some: 'Some', many: 'Many' }, 'some') },
      monsters: { label: 'Monsters', ...choice({ auto: 'Suit the style', none: 'None', goblinoid: 'Goblins', kobold: 'Kobolds', orcs: 'Orcs', undead: 'Undead', beasts: 'Beasts', cultists: 'Cultists', bandits: 'Bandits' }, 'auto') },
      secrets: { label: 'Secret doors', ...yes, def: true },
      boss: { label: 'Boss room', ...yes, def: true },
      lake: { label: 'Underground lake (caves)', ...yes, def: false },
      tracks: { label: 'Cart tracks (mines)', ...yes, def: true },
      ...READY
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
      floors: { label: 'Floors', ...choice({ none: 'Ground only', upstairs: 'Upstairs', cellar: 'Cellar', both: 'Upstairs & cellar' }, 'none') },
      yard: { label: 'Yard outside', ...yes, def: true },
      occupants: { label: 'People inside', ...yes, def: true }
    }
  },
  ship: {
    label: 'Ship', blurb: 'A sailing ship at sea or at the docks, with its hold below',
    fields: {
      kind: { label: 'Ship', ...choice({ merchant: 'Merchant ship', warship: 'Warship', longship: 'Longship' }, 'merchant') },
      setting: { label: 'Where', ...choice({ sea: 'At sea', docked: 'At the docks' }, 'sea') },
      crew: { label: 'Aboard', ...choice({ sailors: 'Sailors', pirates: 'Pirates', raid: 'Sea raiders boarding', ghost: 'Ghost ship', none: 'Nobody' }, 'pirates') },
      weather: { label: 'Weather', ...choice({ calm: 'Calm', rain: 'Rain', storm: 'Storm', fog: 'Fog' }, 'calm') },
      hold: { label: 'Hold below decks', ...yes, def: true },
      ...READY
    }
  },
  castle: {
    label: 'Castle', blurb: 'Walls and towers, a gatehouse, courtyard and keep',
    fields: {
      size: { label: 'Size', ...choice({ small: 'Small', medium: 'Medium', large: 'Large' }, 'medium') },
      setting: { label: 'Setting', ...choice({ temperate: 'Green', snowy: 'Snowy', desert: 'Desert' }, 'temperate') },
      condition: { label: 'Condition', ...choice({ held: 'Held', ruined: 'Ruined', besieged: 'Under siege' }, 'held') },
      occupants: { label: 'Inside', ...choice({ garrison: 'Garrison', bandits: 'Bandits', undead: 'Undead', cultists: 'Cultists', none: 'Nobody' }, 'garrison') },
      moat: { label: 'Moat', ...yes, def: true },
      keepFloors: { label: 'Keep with an upper floor', ...yes, def: true },
      ...READY
    }
  },
  graveyard: {
    label: 'Graveyard', blurb: 'Graves, crypts and a chapel, at night in the fog',
    fields: {
      size: { label: 'Size', ...choice({ small: 'Small', medium: 'Medium', large: 'Large' }, 'medium') },
      age: { label: 'Kept', ...choice({ tended: 'Tended', old: 'Old', forgotten: 'Forgotten' }, 'old') },
      chapel: { label: 'Chapel', ...yes, def: true },
      mausoleum: { label: 'Mausoleum (with a crypt below)', ...yes, def: true },
      dead: { label: 'Restless dead', ...yes, def: true },
      ...READY
    }
  },
  city: {
    label: 'City streets', blurb: 'Cobbled streets, blocks of houses and shops, a plaza',
    fields: {
      size: { label: 'Size', ...choice({ small: 'Small', medium: 'Medium', large: 'Large' }, 'medium') },
      district: { label: 'District', ...choice({ market: 'Market', noble: 'Noble', slums: 'Slums', docks: 'Docks' }, 'market') },
      time: { label: 'Time', ...choice({ day: 'Day', dusk: 'Dusk', night: 'Night' }, 'day') },
      trouble: { label: 'Trouble', ...choice({ none: 'None', thieves: 'Thieves', cult: 'A cult', watch: 'The watch' }, 'thieves') },
      ...READY
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
    token(entry, x, y, extra = {}) { if (entry && M.inb(x, y)) tokens.push({ label: extra.label || entry.name, icon: entry.icon, color: entry.color, size: entry.size, x, y, owner: '', ...(entry.hp ? { hp: entry.hp, maxHp: entry.hp } : {}), ...(entry.init != null ? { initBonus: entry.init } : {}), ...extra }); }
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
  const labels = (out.labels || []).map((l) => ({ ...l, x: fx ? out.cols - l.x - 2 : l.x, y: fy ? out.rows - l.y : l.y }));
  const down = out.down ? [X(out.down[0]), Y(out.down[1])] : out.down;
  return { ...out, tiles, props, tokens, labels, down, start: [Math.min(X(a), X(c)), Math.min(Y(b), Y(d)), Math.max(X(a), X(c)), Math.max(Y(b), Y(d))] };
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

// ---------- 1.11: ready to play ----------
// SRD monsters by kind of foe (names as in public/monsters.json); the app passes them in as lib.__srd
const FAMILY = {
  goblinoid: ['Goblin', 'Hobgoblin', 'Bugbear', 'Worg'], kobold: ['Kobold', 'Giant Weasel', 'Red Dragon Wyrmling', 'Young Red Dragon'],
  orcs: ['Orc', 'Berserker', 'Ogre', 'Troll'], undead: ['Skeleton', 'Zombie', 'Ghoul', 'Shadow', 'Specter', 'Ghast', 'Wight', 'Mummy', 'Wraith', 'Vampire Spawn', 'Ghost', 'Mummy Lord', 'Lich'],
  beasts: ['Wolf', 'Giant Spider', 'Dire Wolf', 'Brown Bear', 'Ettercap', 'Ankheg', 'Owlbear', 'Giant Scorpion'],
  cultists: ['Cultist', 'Cult Fanatic', 'Imp', 'Quasit', 'Priest', 'Hell Hound', 'Mage'], bandits: ['Bandit', 'Thug', 'Scout', 'Bandit Captain', 'Veteran', 'Gladiator', 'Assassin'],
  wolves: ['Wolf', 'Dire Wolf', 'Winter Wolf'], goblins: ['Goblin', 'Hobgoblin', 'Bugbear'],
  pirates: ['Bandit', 'Thug', 'Bandit Captain', 'Veteran', 'Berserker'], raiders: ['Sahuagin', 'Merrow', 'Giant Crab', 'Reef Shark', 'Sea Hag'],
  garrison: ['Guard', 'Veteran', 'Knight', 'Priest', 'Mage'], sewer: ['Giant Rat', 'Swarm of Rats', 'Ghoul', 'Gray Ooze', 'Gelatinous Cube', 'Otyugh', 'Ochre Jelly'],
  mine: ['Kobold', 'Duergar', 'Gray Ooze', 'Darkmantle', 'Grick', 'Rust Monster', 'Roper'], fire: ['Magma Mephit', 'Azer', 'Hell Hound', 'Salamander', 'Fire Elemental'],
  water: ['Lizardfolk', 'Giant Toad', 'Crocodile', 'Swarm of Quippers', 'Chuul', 'Water Elemental'], city: ['Bandit', 'Thug', 'Spy', 'Cultist', 'Cult Fanatic', 'Veteran', 'Assassin', 'Doppelganger']
};
// XP a party can face per character, D&D 2024: low, moderate, high (the same table as the encounter builder)
const XP_PC = [null, [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100], [600, 1000, 1400], [750, 1300, 1700], [1000, 1700, 2100], [1300, 2000, 2600], [1600, 2300, 3100],
  [1900, 2900, 4100], [2200, 3700, 4700], [2600, 4200, 5400], [2900, 4900, 6200], [3300, 5400, 7800], [3800, 6100, 9800], [4500, 7200, 11700], [5000, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000]];
const srdEntry = (m) => ({ name: m.name, icon: m.token.icon, color: m.token.color, size: m.token.size, hp: m.hp, init: m.token.init, srd: m.id, xp: m.xp, cr: m.cr });
function srdPool(lib, fam) { const all = lib && lib.__srd; if (!all || !FAMILY[fam]) return null; const p = FAMILY[fam].map((n) => all.find((m) => m.name === n)).filter(Boolean); return p.length ? p : null; }
// a group of monsters worth about the party's budget for this kind of room ("boss" a step harder, "light" half)
function stockMonsters(M, S, pool, kind = 'room', maxN = 6) {
  if (!pool) return [];
  const lvl = Math.max(1, Math.min(20, parseInt(S.partyLevel, 10) || 3)), size = Math.max(1, parseInt(S.partySize, 10) || 4), d = { easy: 0, medium: 1, hard: 2 }[S.difficulty] ?? 1;
  let budget = XP_PC[lvl][kind === 'boss' ? Math.min(2, d + 1) : d] * size * (kind === 'light' ? 0.5 : kind === 'boss' ? 1.2 : 1);
  const maxCr = kind === 'boss' ? lvl + 3 : Math.max(0.5, lvl + (d - 1));
  const fits = pool.filter((m) => m.cr <= maxCr), picks = [];
  if (!fits.length) return [];
  if (kind === 'boss') { const lead = fits.filter((m) => m.xp <= budget).sort((a, b) => b.xp - a.xp)[0] || fits.sort((a, b) => a.xp - b.xp)[0]; picks.push(lead); budget -= lead.xp; }
  for (let i = 0; i < 12 && picks.length < maxN; i++) {
    const c = fits.filter((m) => m.xp <= budget).sort((a, b) => a.xp - b.xp); if (!c.length) break;
    const m = c[Math.floor(M.r() * Math.max(1, Math.ceil(c.length * 0.6)))]; // mostly the weaker ones: a crowd, not a giant
    picks.push(m); budget -= m.xp;
  }
  if (!picks.length) { const weakest = fits.sort((a, b) => a.xp - b.xp)[0]; if (weakest.xp <= budget * 2) picks.push(weakest); }
  return picks.map(srdEntry);
}
// treasure for a chest, by the party's tier (a hoard for the boss)
function rollLoot(M, S, hoard) {
  const lvl = parseInt(S.partyLevel, 10) || 3, tier = lvl <= 4 ? 1 : lvl <= 10 ? 2 : lvl <= 16 ? 3 : 4;
  const d = (n, sides) => { let t = 0; for (let i = 0; i < n; i++) t += M.int(1, sides); return t; };
  const coins = [[`${d(hoard ? 6 : 3, 6) * 10} gp`, `${d(2, 6) * 10} sp`], [`${d(hoard ? 6 : 4, 6) * (hoard ? 50 : 20)} gp`, `${d(2, 6) * 10} pp`], [`${d(hoard ? 6 : 4, 6) * (hoard ? 200 : 100)} gp`, `${d(3, 6) * 50} pp`], [`${d(hoard ? 8 : 4, 6) * (hoard ? 1000 : 300)} gp`, `${d(4, 6) * 100} pp`]][tier - 1];
  const items = [
    ['Potion of Healing', 'Potion of Climbing', 'Spell scroll (cantrip)', 'Spell scroll (1st level)', 'Bag of Holding', 'Driftglobe', 'Potion of Healing ×2', 'Goggles of Night', 'Cloak of Protection', '+1 Shield'],
    ['Potion of Greater Healing', 'Spell scroll (3rd level)', '+1 weapon', 'Boots of Elvenkind', 'Wand of Magic Missiles', 'Ring of Protection', 'Bracers of Archery', 'Cloak of Elvenkind', '+1 armor'],
    ['Potion of Superior Healing', 'Spell scroll (5th level)', '+2 weapon', 'Flame Tongue', 'Ring of Spell Storing', 'Staff of Healing', '+2 armor', 'Belt of Hill Giant Strength'],
    ['Potion of Supreme Healing', 'Spell scroll (7th level)', '+3 weapon', 'Ring of Regeneration', 'Staff of Power', '+3 armor', 'Cloak of Invisibility']
  ][tier - 1];
  const gems = [['10 gp', '50 gp'], ['50 gp', '100 gp'], ['100 gp', '500 gp'], ['1,000 gp', '5,000 gp']][tier - 1];
  const out = [coins[0]];
  if (M.chance(hoard ? 0.9 : 0.4)) out.push(coins[1]);
  if (M.chance(hoard ? 0.8 : 0.3)) out.push(`${d(hoard ? 3 : 1, 4)} gems (${M.pick(gems)} each)`);
  const n = hoard ? M.int(1, 3) : M.chance(0.35) ? 1 : 0;
  for (let i = 0; i < n; i++) out.push(M.pick(items));
  return out.join(', ');
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : /s$/.test(w) ? '' : 's'}`;
function foesText(list) { const c = {}; for (const e of list) c[e.name] = (c[e.name] || 0) + 1; return Object.entries(c).map(([n, k]) => (k > 1 ? `${k} ${n.toLowerCase()}${/s$/.test(n) ? '' : 's'}` : `a ${n.toLowerCase()}`)).join(', '); }
// a DM note in the top left of a room: its number and name, and what's in it
function roomNote(labels, x, y, n, name, bits) {
  const text = `${n}. ${name}` + (bits.filter(Boolean).length ? ' — ' + bits.filter(Boolean).join('; ') : '');
  labels.push({ x: x + 0.15, y: y + 0.35, text: text.slice(0, 120), dmOnly: true, size: 's' });
}
// lighting, time of day, weather and sound that suit the place (the dialog's "Set the mood" box)
const SOUND = (music, ...amb) => ({ music: music ? { id: music, vol: 0.55 } : null, amb: amb.map((id) => ({ id, vol: 0.7 })) });

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
  mine: { family: 'mine', floor: 'dirt', corridor: 'dirt', themes: ['storage', 'storage', 'collapsed', 'lair', 'crystals', 'camp'], roomW: [5, 10], roomH: [4, 8], names: ['Mine', 'Delve', 'Diggings', 'Shafts'], monsters: 'kobold', jagged: true, wide: true },
  sewer: { family: 'sewer', floor: 'cobble', corridor: 'cobble', themes: ['pool', 'storage', 'lair', 'collapsed', 'prison'], roomW: [5, 8], roomH: [5, 8], names: ['Sewers', 'Drains', 'Undercity', 'Cisterns'], monsters: 'beasts', channel: true, wide: true },
  lava: { family: 'fire', floor: 'stone', corridor: 'cobble', themes: ['forge', 'forge', 'lavapool', 'throne', 'storage', 'barracks', 'treasure'], roomW: [6, 11], roomH: [5, 9], names: ['Forge', 'Furnace', 'Cinderhold', 'Crucible'], monsters: 'orcs' },
  flooded: { family: 'water', floor: 'stone', corridor: 'cobble', themes: ['pool', 'pool', 'crypt', 'collapsed', 'storage', 'shrine'], roomW: [5, 11], roomH: [5, 9], names: ['Drowned Halls', 'Sunken Vault', 'Flooded Keep'], monsters: 'undead', wet: true }
};

function dungeon(S, seed, lib) {
  const [cols, rows] = SIZES[S.size] || SIZES.medium;
  const M = makeMap(cols, rows, seed);
  if (S.style === 'caves') return caves(S, M, lib);
  const st = DSTYLE[S.style] || DSTYLE.halls;
  const floor = new Uint8Array(cols * rows), at = (x, y) => (M.inb(x, y) ? floor[y * cols + x] : 0);
  const rooms = [];
  const target = Math.round({ small: 7, medium: 12, large: 20 }[S.size] * { few: 0.6, normal: 1, many: 1.5 }[S.rooms] * (st.more || 1));
  const rs = { small: 0.7, normal: 1, large: 1.4 }[S.roomSize] || 1, rw = st.roomW.map((v) => Math.max(3, Math.round(v * rs))), rh = st.roomH.map((v) => Math.max(3, Math.round(v * rs)));
  if (S.anchor) { const w = M.int(...rw), h = M.int(...rh), x = Math.max(2, Math.min(cols - w - 3, S.anchor[0] - (w >> 1))), y = Math.max(2, Math.min(rows - h - 3, S.anchor[1] - (h >> 1))); rooms.push({ x, y, w, h, cx: S.anchor[0], cy: S.anchor[1] }); }
  for (let tries = 0; tries < 1500 && rooms.length < target; tries++) {
    const w = M.int(...rw), h = M.int(...rh), x = M.int(2, cols - w - 3), y = M.int(2, rows - h - 3);
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
    if (S.corridors === 'twisty') { // wander there: mostly towards it, sometimes sideways
      for (let i = 0; i < 4000 && (x !== b.cx || y !== b.cy); i++) {
        const dx = Math.sign(b.cx - x), dy = Math.sign(b.cy - y), r = M.r();
        if (r < 0.62) { if ((M.chance(.5) && dx) || !dy) x += dx; else y += dy; }
        else if (r < 0.85) { if (dx) y += M.chance(.5) ? 1 : -1; else x += M.chance(.5) ? 1 : -1; }
        x = Math.max(2, Math.min(cols - 3, x)); y = Math.max(2, Math.min(rows - 3, y)); carve(x, y);
      }
      return;
    }
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
    if (!sideWalls || !M.chance({ few: 0.3, normal: 0.7, many: 1 }[S.doors] ?? 0.7)) continue;
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
  const pool = foeKey === 'none' ? null : srdPool(lib, S.monsters === 'auto' ? (st.family || foeKey) : foeKey), labels = [];
  const THEME = { throne: 'Throne room', crypt: 'Crypt', storage: 'Storeroom', library: 'Library', prison: 'Cells', shrine: 'Shrine', treasure: 'Treasury', barracks: 'Barracks', pool: 'Flooded chamber', collapsed: 'Collapsed hall', lair: 'Lair', crystals: 'Crystal grotto', camp: 'Camp', forge: 'Forge', lavapool: 'Lava pool' };

  rooms.forEach((o, i) => {
    const cells = []; for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) if (at(x, y) === 1) cells.push([x, y]);
    const edgeCells = cells.filter(([x, y]) => x === o.x || y === o.y || x === o.x + o.w - 1 || y === o.y + o.h - 1);
    const doorAdj = ([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => corridor.has((x + dx) + ',' + (y + dy)));
    const wallSpots = edgeCells.filter((c) => !doorAdj(c));
    const rnd = () => M.pick(cells.filter((c) => !taken.has(c[0] + ',' + c[1]) && !doorAdj(c))) || cells[0];
    for (let k = 0; k < Math.max(1, Math.floor(wallSpots.length / 10)); k++) { const c = M.pick(wallSpots); if (c) put(st.floor === 'dirt' ? 'torch' : M.chance(.8) ? 'torch' : 'brazier', ...c); }
    if (st.pillars && o.w >= 7 && o.h >= 6) for (let x = o.x + 1; x < o.x + o.w - 1; x += 2) { put('pillar', x, o.y + 1); put('pillar', x, o.y + o.h - 2); }
    if (i === 0) { put('stairs', o.cx, o.cy); if (S.notes) roomNote(labels, o.x, o.y, 1, S.anchor ? 'Stairs up' : 'Entrance', []); return; }
    const theme = o === bossRoom ? (st === DSTYLE.temple ? 'shrine' : 'throne') : M.pick(st.themes);
    const before = M.tokens.length, chestsBefore = M.props.filter((p) => p.kind === 'chest').length;
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
    if (o === bossRoom) { put('chest', o.cx, o.y + o.h - 2); if (foes && !pool) M.token(lib[foes.boss], o.cx, o.cy, { hidden: true }); }
    if (pool) { // SRD monsters sized for the party: about four rooms in ten are empty
      if (o === bossRoom || M.chance(0.5)) for (const e of stockMonsters(M, S, pool, o === bossRoom ? 'boss' : M.chance(0.5) ? 'light' : 'room', Math.max(1, Math.min(o === bossRoom ? 6 : 4, Math.floor(cells.length / 8))))) { const c = rnd(); if (!c) break; M.token(e, c[0], c[1], { hidden: true, srd: e.srd }); taken.add(c[0] + ',' + c[1]); }
    } else if (foes) {
      const n = M.int(o === bossRoom ? 2 : 0, Math.min(o === bossRoom ? 5 : 4, Math.floor(cells.length / 12)));
      for (let k = 0; k < n; k++) { const c = rnd(); M.token(lib[pickFoe(M, foes)], c[0], c[1], { hidden: true }); taken.add(c[0] + ',' + c[1]); }
    }
    // clutter
    const clutter = { none: 0, some: 1, lots: 3 }[S.clutter] ?? 1;
    for (let k = 0; k < clutter * Math.ceil(cells.length / 25); k++) { const c = rnd(); if (c) put(M.pick(st.clutter || ['rubble', 'bones', 'barrel', 'crate', 'sack', 'rubble']), ...c, M.int(0, 3)); }
    if (S.notes) {
      const chests = M.props.filter((p) => p.kind === 'chest').length - chestsBefore;
      const loot = S.loot && chests ? `chest${chests > 1 ? 's' : ''}: ${rollLoot(M, S, o === bossRoom)}` : chests ? plural(chests, 'chest') : '';
      roomNote(labels, o.x, o.y, i + 1, (o === bossRoom ? 'Boss: ' : '') + (THEME[theme] || 'Room'), [M.tokens.length > before ? foesText(M.tokens.slice(before).map((t) => ({ name: t.label }))) : '', loot]);
    }
  });
  let down = null;
  if (S.down) { const o = rooms.slice(1).filter((r) => r !== bossRoom).reduce((a, r) => (dist(r, rooms[0]) > dist(a, rooms[0]) ? r : a), rooms[rooms.length - 1]); taken.delete(o.cx + ',' + o.cy); for (let i = M.props.length - 1; i >= 0; i--) if (M.props[i].x === o.cx && M.props[i].y === o.cy) M.props.splice(i, 1); M.prop('stairs', o.cx, o.cy, 2); taken.add(o.cx + ',' + o.cy); down = [o.cx, o.cy]; if (S.notes) labels.push({ x: o.cx + 1, y: o.cy + 0.5, text: 'Stairs down', dmOnly: true, size: 's' }); }
  else if (rooms.length > 3 && !bossRoom) put('stairs', rooms[rooms.length - 1].cx, rooms[rooms.length - 1].cy, 2);
  // mines: cart tracks along the passages, and a cart or two
  if (st.jagged && S.tracks) {
    for (const k of corridor) { const [x, y] = k.split(',').map(Number); if (taken.has(k)) continue; const h = corridor.has((x - 1) + ',' + y) || corridor.has((x + 1) + ',' + y), v = corridor.has(x + ',' + (y - 1)) || corridor.has(x + ',' + (y + 1)); if (h !== v) put('rails', x, y, h ? 0 : 1); }
    for (let k = 0; k < Math.max(1, rooms.length / 3); k++) { const r = M.pick(rooms); put('minecart', r.cx + 1, r.cy); }
  }
  const cor = [...corridor].filter((k) => !taken.has(k));
  const nTraps = Math.floor(cor.length / { none: Infinity, some: 25, many: 10 }[S.traps]);
  for (let k = 0; k < nTraps; k++) { const [x, y] = M.pick(cor).split(',').map(Number); put('trap', x, y); }
  if (st.channel) for (let k = 0; k < cor.length / 30; k++) { const [x, y] = M.pick(cor).split(',').map(Number); put(M.pick(['bars', 'rubble', 'bones']), x, y); }

  const name = M.pick(['The Sunken', 'The Forgotten', 'The Black', 'The Howling', 'The Ember', 'The Hollow', 'The Silent', 'The Rotting']) + ' ' + M.pick(st.names);
  const e = rooms[0];
  const styleName = { halls: 'Stone halls', crypt: 'Crypt', temple: 'Temple', mine: 'Mine', sewer: 'Sewer', lava: 'Lava forge', flooded: 'Flooded dungeon' }[S.style] || 'Dungeon';
  const summary = [styleName, `${rooms.length} rooms`, foes ? `${M.tokens.length} ${foeKey === 'goblinoid' ? 'goblins' : foeKey}` : 'no monsters', nTraps ? `${nTraps} traps` : '', secrets ? `${secrets} secret doors` : '', bossRoom ? 'boss room' : ''].filter(Boolean).join(' · ');
  const out = { name, summary, cols, rows, tiles: M.tiles, props: M.props, tokens: M.tokens, labels, down, start: [e.x - 1, e.y - 1, e.x + e.w, e.y + e.h] };
  return S.noMirror ? out : mirror(out, M.chance(.5), M.chance(.5));
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
  // an underground lake in the widest part of the cave, with an island and a boat
  let lakeAt = null;
  if (S.lake) {
    const roomy = cells.filter(([x, y]) => { let n = 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (open(x + dx, y + dy)) n++; return n >= 45 && x > cols * 0.3; });
    if (roomy.length) {
      const [lx, ly] = roomy[Math.floor(roomy.length / 2)], rx = Math.max(3, Math.round(cols / 9)), ry = Math.max(3, Math.round(rows / 8)); lakeAt = [lx, ly];
      blob(M, lx, ly, rx, ry, (x, y, d) => { if (open(x, y)) M.set(x, y, d < 0.12 && rx > 4 ? 'sand' : 'water'); });
      M.prop('boat', lx - rx + 1, ly, 0); M.prop('reeds', lx - rx, ly + 1);
    }
  }
  // pools, rocks, mushrooms, crystals
  for (let i = 0; i < cells.length / 400; i++) { const [x, y] = M.pick(cells); blob(M, x, y, M.int(1, 3), M.int(1, 2), (xx, yy) => { if (open(xx, yy)) M.set(xx, yy, 'water'); }); }
  const taken = new Set(), put = (k, x, y) => { if (!taken.has(x + ',' + y) && open(x, y)) { M.prop(k, x, y, M.int(0, 3)); taken.add(x + ',' + y); } };
  for (let i = 0; i < cells.length / 45; i++) put(M.pick(['rock', 'rock', 'mushrooms', 'rubble', 'bones', 'crystal']), ...M.pick(cells));
  // entrance at the cell nearest the left edge; "rooms" are spread-out points for monsters
  const entry = cells.reduce((a, c) => (c[0] < a[0] ? c : a), cells[0]);
  put('stairs', ...entry);
  const foes = FOES[S.monsters === 'auto' ? 'beasts' : S.monsters === 'none' ? null : S.monsters];
  const pool = S.monsters === 'none' ? null : srdPool(lib, S.monsters === 'auto' ? (S.lake ? 'water' : 'beasts') : S.monsters), labels = [];
  const dry = cells.filter(([x, y]) => M.get(x, y) !== 'water');
  const far = cells.reduce((a, c) => (Math.abs(c[0] - entry[0]) + Math.abs(c[1] - entry[1]) > Math.abs(a[0] - entry[0]) + Math.abs(a[1] - entry[1]) ? c : a), cells[0]);
  if (S.boss) { put('chest', far[0], far[1]); put('bones', far[0] + 1, far[1]); if (foes && !pool) M.token(lib[foes.boss], far[0], far[1] - 1, { hidden: true }); }
  if (pool) { // groups of SRD monsters sized for the party, spread through the caves, the strongest at the far end
    const spots = [far, ...Array.from({ length: Math.max(2, Math.round(cells.length / 260)) }, () => M.pick(dry))];
    spots.forEach((c, i) => {
      if (!c || Math.abs(c[0] - entry[0]) + Math.abs(c[1] - entry[1]) < 10) return;
      const group = stockMonsters(M, S, pool, i === 0 && S.boss ? 'boss' : M.chance(0.5) ? 'light' : 'room'), placed = [];
      for (const e of group) { const near = dry.filter(([x, y]) => Math.abs(x - c[0]) <= 2 && Math.abs(y - c[1]) <= 2 && !taken.has(x + ',' + y)); const q = near.length ? M.pick(near) : c; M.token(e, q[0], q[1], { hidden: true, srd: e.srd }); taken.add(q[0] + ',' + q[1]); placed.push(e); }
      if (S.notes && placed.length) labels.push({ x: c[0] + 1, y: c[1] - 1, text: ((i === 0 && S.boss ? 'Lair: ' : '') + foesText(placed) + (i === 0 && S.boss && S.loot ? '; chest: ' + rollLoot(M, S, true) : '')).slice(0, 120), dmOnly: true, size: 's' });
    });
  } else if (foes) for (let i = 0; i < Math.round(cells.length / 90); i++) { const c = M.pick(cells); if (Math.abs(c[0] - entry[0]) + Math.abs(c[1] - entry[1]) > 10 && !taken.has(c[0] + ',' + c[1])) { M.token(lib[pickFoe(M, foes)], c[0], c[1], { hidden: true }); taken.add(c[0] + ',' + c[1]); } }
  const nTraps = S.traps === 'none' ? 0 : S.traps === 'many' ? 8 : 3;
  for (let i = 0; i < nTraps; i++) put('trap', ...M.pick(cells));
  const name = M.pick(['The Dripping', 'The Echoing', 'The Black', 'Wyrm', 'Bat', 'The Glittering']) + ' ' + M.pick(['Caves', 'Caverns', 'Grotto', 'Hollows']);
  if (S.notes) { labels.push({ x: entry[0] + 1, y: entry[1] + 0.5, text: 'Entrance', dmOnly: true, size: 's' }); if (lakeAt) labels.push({ x: lakeAt[0] - 2, y: lakeAt[1] - 3, text: 'Underground lake: cold, deep and dark', dmOnly: true, size: 's' }); }
  return { labels, wallStyle: 'rock', name, summary: `Natural caves${lakeAt ? ' with a lake' : ''} · ${foes ? M.tokens.length + ' creatures' : 'no monsters'}${nTraps ? ` · ${nTraps} traps` : ''}${S.boss ? ' · lair at the far end' : ''}`, cols, rows, tiles: M.tiles, props: M.props, tokens: M.tokens, start: [entry[0] - 5, entry[1] - 5, entry[0] + 5, entry[1] + 5] };
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
const ROOM_NAMES = { cellar: 'cellar', crypt: 'crypt', common: 'common room', kitchen: 'kitchen', storage: 'storeroom', bedroom: 'bedroom', nave: 'nave', vestry: 'vestry', library: 'library', hall: 'great hall', dining: 'dining room', study: 'study', shopfloor: 'shop floor', barracks: 'barracks', armory: 'armoury', cells: 'cells', office: 'office', lab: 'laboratory' };

// floors above and below (1.11): the same outline, other rooms; the stairs in the same square on every floor
const UPPER = { tavern: ['bedroom', 'bedroom', 'bedroom', 'bedroom', 'storage', 'bedroom'], temple: ['library', 'vestry', 'bedroom', 'bedroom'], manor: ['bedroom', 'study', 'library', 'bedroom', 'bedroom', 'storage'], shop: ['bedroom', 'storage', 'study'], guardhouse: ['barracks', 'armory', 'office'], tower: ['lab', 'library', 'bedroom', 'storage'] };
const CELLAR = { tavern: ['cellar', 'cellar', 'storage'], temple: ['crypt', 'crypt', 'storage'], manor: ['cellar', 'storage', 'cells'], shop: ['cellar', 'storage'], guardhouse: ['cells', 'cells', 'storage'], tower: ['lab', 'storage', 'cells'] };
function buildingMap(S, seed, lib) {
  const story = S.story || 'ground';
  const dims = { small: [14, 10], medium: [20, 14], large: [28, 18] }[S.size];
  const pad = story === 'ground' ? (S.yard ? 5 : 2) : S.pad;
  const cols = dims[0] + pad * 2, rows = dims[1] + pad * 2;
  const M = makeMap(cols, rows, seed);
  if (story === 'ground') {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) M.set(x, y, 'grass');
    for (let i = 0; i < cols * rows / 60; i++) M.set(M.int(0, cols), M.int(0, rows), 'dirt');
  }
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
  let mainRoom;
  if (story === 'ground') {
    const mainW = Math.max(6, Math.round(inner.w * (S.kind === 'shop' ? 0.4 : S.kind === 'tower' ? 0.42 : 0.5)));
    mainRoom = { x: inner.x, y: inner.y, w: mainW, h: inner.h };
    walls.push({ x: inner.x + mainW, y: inner.y, w: 1, h: inner.h, vert: true });
    leaves.push(mainRoom);
    split({ x: inner.x + mainW + 1, y: inner.y, w: inner.w - mainW - 1, h: inner.h }, 0);
  } else { split(inner, 0); mainRoom = leaves.reduce((a, r) => (r.w * r.h > a.w * a.h ? r : a), leaves[0]); }

  // draw: outer walls, inner walls, floors
  const floorFor = story === 'cellar' ? new Proxy({}, { get: () => 'stone' }) : { kitchen: 'stone', storage: 'stone', nave: 'marble', cells: 'stone', armory: 'stone', hall: S.kind === 'manor' ? 'marble' : 'wood', lab: 'stone', barracks: 'wood' };
  for (let y = Y0; y < Y0 + H; y++) for (let x = X0; x < X0 + W; x++) M.set(x, y, x === X0 || y === Y0 || x === X0 + W - 1 || y === Y0 + H - 1 ? 'wall' : 'wood');
  for (const w of walls) for (let y = w.y; y < w.y + w.h; y++) for (let x = w.x; x < w.x + w.w; x++) M.set(x, y, 'wall');
  const purposes = story === 'upper' ? UPPER[S.kind] : story === 'cellar' ? CELLAR[S.kind] : ROOMS[S.kind];
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
  if (story === 'ground') { M.set(X0, fy, 'wood'); M.prop(abandoned ? 'dooropen' : 'doubledoor', X0, fy, 1); }
  // windows on the outer walls (none in a cellar)
  if (story !== 'cellar') for (let x = X0 + 2; x < X0 + W - 2; x += 3) for (const y of [Y0, Y0 + H - 1]) if (M.get(x, y) === 'wall' && M.get(x, y === Y0 ? y + 1 : y - 1) !== 'wall') M.prop('window', x, y, 0);
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
      cellar() { edge.forEach((c, i) => put(i % 3 === 2 ? 'sack' : 'barrel', ...c)); put('crate', ...any()); put('candle', ...any()); },
      crypt() { for (let k = 0; k < Math.min(4, Math.floor(mid.length / 4)); k++) put('coffin', ...any()); put('candle', ...any()); put('statue', ...(edge[0] || any())); },
      lab() { put('cauldron', cx, cy); put('crystal', ...any()); put('desk', ...any()); if (top.length) put('bookshelf', ...top[0]); put('candle', ...any()); people.push([lib.Mage, [cx + 1, cy + 1]]); }
    };
    (F[r.purpose] || F.storage)();
  }
  // stairs: in a corner of the last room (or the square the floor below put them in)
  let stairsAt = null;
  const stairsHere = (x, y) => { for (let i = M.props.length - 1; i >= 0; i--) if (M.props[i].x === x && M.props[i].y === y) M.props.splice(i, 1); M.set(x, y, story === 'cellar' ? 'stone' : floorFor[(roomAt(x, y) || {}).purpose] || 'wood'); M.prop('stairs', x, y, story === 'cellar' ? 2 : 0); taken.add(x + ',' + y); stairsAt = [x, y]; };
  if (story !== 'ground' && S.stairsAt) stairsHere(...S.stairsAt);
  else if (S.size !== 'small' || (S.floors && S.floors !== 'none')) { const r = order[order.length - 1]; stairsHere(r.x, r.y); }

  // yard: path to the door, trees, maybe a well and a cart
  if (S.yard && story === 'ground') {
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
  if (S.occupants && !abandoned && story === 'ground') for (const [e, [x, y]] of people) if (e && M.get(x, y) !== 'wall') M.token(e, x, y);
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
  const labels = [];
  if (S.notes !== false) order.forEach((r, i) => roomNote(labels, r.x, r.y, i + 1, (ROOM_NAMES[r.purpose] || r.purpose).replace(/^./, (c) => c.toUpperCase()), [S.loot !== false && M.props.some((p) => p.kind === 'chest' && p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h) ? 'chest: ' + rollLoot(M, { partyLevel: S.partyLevel || 3 }, false) : '']));
  if (story !== 'ground') return { cols, rows, tiles: M.tiles, props: M.props, tokens: M.tokens, labels, start: stairsAt ? [stairsAt[0] - 4, stairsAt[1] - 4, stairsAt[0] + 4, stairsAt[1] + 4] : [X0, Y0, X0 + W, Y0 + H], rooms: order.length };
  return { name: (abandoned ? 'Abandoned ' : '') + names[S.kind](), summary: `${SCHEMA.building.fields.kind.options[S.kind]} · ${order.length} rooms (${roomList}${order.length > 5 ? '…' : ''})`, cols, rows, tiles: M.tiles, props: M.props, tokens: M.tokens, labels, stairsAt, pad, start: [0, fy - 4, X0 + 3, fy + 4] };
}

// =========================================================================================
// SHIP (1.11): a hull on the water, masts, cannons, the wheel; the hold below as its own floor
// =========================================================================================
function shipMap(S, seed, lib) {
  const L = { merchant: 30, warship: 40, longship: 26 }[S.kind] || 30, B = { merchant: 9, warship: 11, longship: 7 }[S.kind] || 9;
  const cols = L + 16, rows = B + 14, M = makeMap(cols, rows, seed), x0 = 7, cy = Math.floor(rows / 2), labels = [];
  const docked = S.setting === 'docked', hold = S.story === 'hold';
  // the outline: square stern on the left, pointed bow on the right
  const half = (x) => { const u = (x - x0) / L; return u < 0.08 ? (B / 2) * (0.75 + u * 3) : u > 0.72 ? (B / 2) * Math.max(0.15, 1 - ((u - 0.72) / 0.28) ** 1.6) : B / 2; };
  const deck = (x, y) => x >= x0 && x < x0 + L && Math.abs(y + 0.5 - cy) <= half(x + 0.5);
  if (!hold) for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) M.set(x, y, 'water');
  if (docked && !hold) { for (let y = 0; y < 4; y++) for (let x = 0; x < cols; x++) M.set(x, y, y < 2 ? 'cobble' : 'wood'); for (let x = 2; x < cols - 2; x += 5) M.prop('barrel', x, 1); M.prop('crate', 4, 0); M.prop('lamppost', 12, 1); }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (deck(x, y)) {
    const rim = !deck(x - 1, y) || !deck(x + 1, y) || !deck(x, y - 1) || !deck(x, y + 1);
    if (hold) M.set(x, y, rim ? 'wall' : 'wood');
    else { M.set(x, y, 'wood'); if (rim) M.prop('fence', x, y, !deck(x, y - 1) || !deck(x, y + 1) ? 0 : 1); } // the deck's rail
  }
  const free = (x, y) => M.get(x, y) === 'wood' && !M.propAt(x, y);
  const unrail = (x, y) => { for (let i = M.props.length - 1; i >= 0; i--) if (M.props[i].x === x && M.props[i].y === y && M.props[i].kind === 'fence') M.props.splice(i, 1); };
  const put = (k, x, y, r = 0) => { if (free(x, y)) { M.prop(k, x, y, r); return true; } return false; };
  const masts = { merchant: [0.3, 0.6], warship: [0.22, 0.45, 0.68], longship: [0.5] }[S.kind] || [0.45];
  const holdAt = [x0 + Math.round(L * 0.4), cy];
  if (!hold) {
    for (const u of masts) put('mast', x0 + Math.round(L * u), cy, 1);
    put('helm', x0 + 3, cy); put('lamppost', x0 + 2, cy - 2); put('lamppost', x0 + 2, cy + 2);
    put('anchor', x0 + L - 5, cy - 1);
    if (S.kind === 'warship') for (let x = x0 + 5; x < x0 + L - 8; x += 3) { put('cannon', x, cy - Math.floor(B / 2) + 1, 3); put('cannon', x, cy + Math.floor(B / 2) - 1, 1); }
    if (S.kind === 'longship') for (let x = x0 + 3; x < x0 + L - 5; x += 2) { put('bench', x, cy - 1, 1); put('bench', x, cy + 1, 1); }
    for (let i = 0; i < 6; i++) put(M.pick(['crate', 'barrel', 'barrel', 'sack']), M.int(x0 + 4, x0 + L - 6), M.int(cy - 2, cy + 2));
    if (S.story !== 'none' && S.hold) { M.set(...holdAt, 'wood'); M.prop('trapdoor', ...holdAt); }
    // a boat or two alongside, or the gangplank to the pier
    if (docked) { const gx = holdAt[0] + 3; for (let y = 2; y <= cy; y++) { if (deck(gx, y) && !deck(gx, y - 1)) { unrail(gx, y); break; } if (!deck(gx, y)) M.prop('bridge', gx, y, 1); } }
    else M.prop('boat', x0 + L - 4, cy + Math.ceil(B / 2) + 2, 0);
  } else {
    // the hold: cargo, hammocks, the brig
    for (let x = x0 + 3; x < x0 + L - 4; x++) for (const y of [cy - Math.floor(B / 2) + 1, cy + Math.floor(B / 2) - 1]) if (M.chance(0.6)) put(M.pick(['crate', 'barrel', 'sack', 'crate']), x, y);
    for (let x = x0 + 4; x < x0 + 10; x += 2) put('hammock', x, cy - 1, 1);
    const bx = x0 + L - 9; for (let y = cy - 2; y <= cy + 2; y++) M.prop('bars', bx, y, 1);
    put('chest', bx + 2, cy); put('lamppost', x0 + 2, cy);
    M.set(...holdAt, 'wood'); for (let i = M.props.length - 1; i >= 0; i--) if (M.props[i].x === holdAt[0] && M.props[i].y === holdAt[1]) M.props.splice(i, 1); M.prop('ladder', ...holdAt);
  }
  // who's aboard
  const fam = { sailors: null, pirates: 'pirates', raid: 'raiders', ghost: 'undead', none: null }[S.crew];
  const pool = fam && srdPool(lib, fam), deckCells = []; for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (deck(x, y) && free(x, y)) deckCells.push([x, y]);
  const crew = [];
  if (S.crew === 'sailors' && !hold) for (let i = 0; i < 5; i++) { const c = M.pick(deckCells); M.token(lib[M.pick(['Commoner', 'Fisher', 'Commoner'])] || lib.Commoner, c[0], c[1]); }
  else if (pool) for (const e of stockMonsters(M, S, pool, hold ? 'light' : 'room')) { const c = M.pick(deckCells); if (!c) break; M.token(e, c[0], c[1], { hidden: S.crew !== 'raid', srd: e.srd }); crew.push(e); }
  if (S.notes) { roomNote(labels, x0 + 1, cy - Math.floor(B / 2) - 1.4, 1, hold ? 'The hold' : 'Main deck', [crew.length ? foesText(crew) : '', hold && S.loot ? 'chest in the brig: ' + rollLoot(M, S, true) : '']); }
  const name = `The ${M.pick(['Salt', 'Black', 'Grey', 'Crimson', 'Silver', 'Drowned', 'Lucky'])} ${M.pick(['Gull', 'Maiden', 'Serpent', 'Wind', 'Marlin', 'Kraken', 'Star'])}`;
  return { name, summary: `${SCHEMA.ship.fields.kind.options[S.kind]} · ${docked ? 'at the docks' : 'at sea'} · ${crew.length ? foesText(crew) : S.crew}`, cols, rows, tiles: M.tiles, props: M.props, tokens: M.tokens, labels, stairsAt: holdAt, start: docked ? [0, 0, cols, cy] : [x0, cy - B, x0 + 10, cy + B] };
}

// =========================================================================================
// CASTLE (1.11): curtain wall with towers, gatehouse over a moat, courtyard buildings, the keep
// =========================================================================================
function castleMap(S, seed, lib) {
  const [cols, rows] = { small: [44, 34], medium: [58, 44], large: [76, 56] }[S.size] || [58, 44];
  const M = makeMap(cols, rows, seed), labels = []; fillGround(M, S.setting);
  const ruined = S.condition === 'ruined', m = S.moat ? 3 : 1, x0 = 3 + m, y0 = 3 + m, x1 = cols - 4 - m, y1 = rows - 4 - m;
  if (S.moat) for (let y = y0 - 2; y <= y1 + 2; y++) for (let x = x0 - 2; x <= x1 + 2; x++) if (x < x0 - 0 || x > x1 || y < y0 || y > y1) if (x <= x0 - 1 && x >= x0 - 2 || x >= x1 + 1 && x <= x1 + 2 || y <= y0 - 1 && y >= y0 - 2 || y >= y1 + 1 && y <= y1 + 2) M.set(x, y, 'water');
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const edge = x === x0 || x === x1 || y === y0 || y === y1; M.set(x, y, edge ? 'wall' : M.chance(0.12) ? 'dirt' : 'cobble'); M.mark(x, y, edge ? 3 : 0); }
  // towers at the corners: 4×4 blocks with a room inside
  for (const [tx, ty] of [[x0 - 1, y0 - 1], [x1 - 2, y0 - 1], [x0 - 1, y1 - 2], [x1 - 2, y1 - 2]]) { for (let y = ty; y < ty + 4; y++) for (let x = tx; x < tx + 4; x++) { const e = x === tx || y === ty || x === tx + 3 || y === ty + 3; M.set(x, y, e ? 'wall' : 'stone'); M.mark(x, y, 3); } M.prop('torch', tx + 1, ty + 1); }
  // gatehouse in the south wall
  const gx = (x0 + x1) >> 1;
  for (let x = gx - 2; x <= gx + 2; x++) for (let y = y1 - 1; y <= y1 + 1; y++) { M.set(x, y, Math.abs(x - gx) === 2 ? 'wall' : 'cobble'); M.mark(x, y, 3); }
  M.prop(ruined ? 'rubble' : 'portcullis', gx, y1, 0); M.prop('torch', gx - 1, y1 - 1); M.prop('torch', gx + 1, y1 - 1);
  for (let y = y1 + 2; y < rows; y++) { M.set(gx - 1, y, 'path'); M.set(gx, y, 'path'); M.set(gx + 1, y, 'path'); }
  if (S.moat) for (let y = y1 + 1; y <= y1 + 2; y++) for (let x = gx - 1; x <= gx + 1; x++) M.prop('bridge', x, y, 1);
  // the keep at the back, with rooms inside (the great hall the biggest)
  const kw = Math.round((x1 - x0) * 0.5), kh = Math.round((y1 - y0) * 0.4), kx = gx - (kw >> 1), ky = y0 + 3;
  const keep = building(M, kx, ky, kw, kh, 's', 'stone');
  const hallW = Math.max(6, Math.round((kw - 2) * 0.55));
  for (let y = ky + 1; y < ky + kh - 1; y++) M.set(kx + 1 + hallW, y, 'wall');
  const door = [kx + 1 + hallW, ky + (kh >> 1)]; M.set(...door, 'stone'); M.prop('door', ...door, 1);
  for (let x = kx + 1; x < kx + 1 + hallW; x++) for (let y = ky + 1; y < ky + kh - 1; y++) M.set(x, y, 'marble');
  const hcx = kx + 1 + (hallW >> 1);
  M.prop('throne', hcx, ky + 1); M.prop('rug', hcx, ky + 2); M.prop('rug', hcx, ky + 3); for (let x = kx + 2; x < kx + hallW; x += 3) { M.prop('pillar', x, ky + 2); M.prop('pillar', x, ky + kh - 3); }
  M.prop('fireplace', kx + 1, ky + (kh >> 1)); M.prop('brazier', hcx - 2, ky + 1); M.prop('brazier', hcx + 2, ky + 1);
  const sx = kx + kw - 3, sy = ky + 1; M.prop('stairs', sx, sy, 0); // up the keep
  M.prop('bed', kx + kw - 2, ky + kh - 3); M.prop('chest', kx + kw - 3, ky + kh - 2); M.prop('desk', kx + hallW + 3, ky + (kh >> 1)); M.prop('bookshelf', kx + hallW + 2, ky + 1);
  // courtyard: a well, stables and barracks along the walls, a smithy
  M.prop('well', gx + 4, y1 - 5);
  const side = (bx, by, w, h, door, kind) => { if (!M.free(bx, by, w, h)) return null; const b = building(M, bx, by, w, h, door, kind === 'stable' ? 'dirt' : 'wood'); const f = FURNISH[kind === 'barracks' ? 'guardhouse' : kind]; return f ? f(M, b, lib) : []; };
  side(x0 + 1, y1 - 8, 8, 7, 'e', 'stable'); side(x1 - 9, y1 - 8, 9, 7, 'w', 'barracks'); side(x0 + 1, ky + 1, 7, 6, 'e', 'smithy');
  for (let i = 0; i < 6; i++) { const x = M.int(x0 + 2, x1 - 2), y = M.int(y0 + kh + 4, y1 - 2); if (!M.use(x, y) && !M.propAt(x, y)) M.prop(M.pick(['cart', 'barrel', 'crate', 'haystack', 'weaponrack']), x, y, M.int(0, 3)); }
  if (ruined) { for (let i = 0; i < (cols + rows) * 1.5; i++) { const x = M.int(x0, x1), y = M.int(y0, y1); if (M.get(x, y) === 'wall' && M.chance(0.4)) { M.set(x, y, 'dirt'); M.prop('rubble', x, y); } else if (M.chance(0.08) && !M.propAt(x, y)) M.prop(M.pick(['rubble', 'bones', 'bush', 'deadtree']), x, y); } }
  if (S.condition === 'besieged') { for (let i = 0; i < 6; i++) M.prop(M.pick(['tent', 'campfire', 'cart', 'weaponrack']), M.int(2, cols - 3), M.int(y1 + 4, rows - 2)); }
  // the people in it
  const fam = { garrison: 'garrison', bandits: 'bandits', undead: 'undead', cultists: 'cultists', none: null }[S.occupants];
  const pool = fam && srdPool(lib, fam), placed = { hall: [], yard: [] };
  if (pool) {
    for (const e of stockMonsters(M, S, pool, 'boss')) { const x = M.int(kx + 2, kx + hallW - 1), y = M.int(ky + 2, ky + kh - 3); M.token(e, x, y, { hidden: fam !== 'garrison', srd: e.srd }); placed.hall.push(e); }
    for (const e of stockMonsters(M, S, pool, 'room')) { const x = M.int(gx - 4, gx + 4), y = M.int(y1 - 6, y1 - 2); M.token(e, x, y, { hidden: fam !== 'garrison', srd: e.srd }); placed.yard.push(e); }
  }
  if (S.notes) {
    roomNote(labels, kx + 1, ky + 1, 1, 'Great hall', [foesText(placed.hall)]);
    roomNote(labels, kx + hallW + 2, ky + 1, 2, 'Lord’s chambers', [S.loot ? 'chest: ' + rollLoot(M, S, true) : '']);
    roomNote(labels, gx - 2, y1 - 3, 3, 'Gatehouse & courtyard', [foesText(placed.yard)]);
  }
  const name = `${M.pick(['Castle', 'Fort', 'Keep of'])} ${M.pick(['Ravenmoor', 'Highwatch', 'Greystone', 'Blackthorn', 'Stormhold', 'Dunmere', 'Ashcliff'])}`;
  return { name, summary: `${S.size} castle · ${S.condition === 'held' ? 'held' : S.condition === 'ruined' ? 'in ruins' : 'under siege'} · ${placed.hall.length + placed.yard.length ? foesText([...placed.hall, ...placed.yard]) : 'empty'}`, cols, rows, tiles: M.tiles, props: M.props, tokens: M.tokens, labels, keep: { x: kx, y: ky, w: kw, h: kh, stairs: [sx, sy] }, start: [gx - 6, y1 - 4, gx + 6, rows - 1] };
}
// the keep's upper floor: bedrooms, a chapel and the battlements' stairs
function keepUpper(S, seed, lib, base) {
  const M = makeMap(base.cols, base.rows, seed), k = base.keep, labels = [];
  for (let y = k.y; y < k.y + k.h; y++) for (let x = k.x; x < k.x + k.w; x++) M.set(x, y, x === k.x || y === k.y || x === k.x + k.w - 1 || y === k.y + k.h - 1 ? 'wall' : 'wood');
  const mid = k.x + (k.w >> 1); for (let y = k.y + 1; y < k.y + k.h - 1; y++) M.set(mid, y, 'wall'); M.set(mid, k.y + (k.h >> 1), 'wood'); M.prop('door', mid, k.y + (k.h >> 1), 1);
  for (let x = k.x + 2; x < mid - 1; x += 3) { M.prop('bed', x, k.y + 1); M.prop('chest', x, k.y + k.h - 2); }
  M.prop('altar', mid + ((k.x + k.w - mid) >> 1), k.y + 1); for (let x = mid + 2; x < k.x + k.w - 2; x += 2) M.prop('bench', x, k.y + (k.h >> 1) + 1, 0);
  M.prop('stairs', ...k.stairs, 2); M.prop('window', k.x + 3, k.y, 0); M.prop('window', k.x + k.w - 4, k.y, 0);
  if (S.notes) { roomNote(labels, k.x + 1, k.y + 1, 4, 'Bedchambers', []); roomNote(labels, mid + 1, k.y + 1, 5, 'Chapel', []); }
  return { cols: base.cols, rows: base.rows, tiles: M.tiles, props: M.props, tokens: M.tokens, labels, start: [k.x, k.y, k.x + k.w, k.y + k.h] };
}

// =========================================================================================
// GRAVEYARD (1.11): a walled field of graves, paths, a chapel, a mausoleum with a crypt below
// =========================================================================================
function graveyardMap(S, seed, lib) {
  const [cols, rows] = { small: [34, 26], medium: [46, 34], large: [60, 44] }[S.size] || [46, 34];
  const M = makeMap(cols, rows, seed), labels = []; fillGround(M, 'temperate');
  const wild = { tended: 0.05, old: 0.25, forgotten: 0.5 }[S.age] ?? 0.25;
  for (let x = 1; x < cols - 1; x++) for (const y of [1, rows - 2]) if (!(S.age === 'forgotten' && M.chance(0.25))) M.prop('fence', x, y, 0);
  for (let y = 2; y < rows - 2; y++) for (const x of [1, cols - 2]) if (!(S.age === 'forgotten' && M.chance(0.25))) M.prop('fence', x, y, 1);
  const gx = cols >> 1; for (let y = 0; y < rows - 1; y++) { M.set(gx, y, 'path'); M.set(gx + 1, y, 'path'); M.mark(gx, y, 1); M.mark(gx + 1, y, 1); }
  for (let i = M.props.length - 1; i >= 0; i--) if (M.props[i].y === rows - 2 && Math.abs(M.props[i].x - gx) <= 1) M.props.splice(i, 1);
  const cy = rows >> 1; for (let x = 2; x < cols - 2; x++) { M.set(x, cy, 'path'); M.mark(x, cy, 1); }
  let crypt = null;
  if (S.chapel) { const b = building(M, gx - 4, 3, 10, 7, 's', 'stone'); FURNISH.temple(M, b, {}); }
  if (S.mausoleum) { const mx = cols - 11, my = rows - 10; const b = building(M, mx, my, 7, 6, 'w', 'marble'); for (const p of M.props) if (p.x === b.door[0] && p.y === b.door[1]) p.kind = 'portcullis'; M.prop('statue', mx + 2, my + 1); M.prop('statue', mx + 4, my + 1); crypt = [mx + 4, my + 3]; M.prop('stairs', ...crypt, 2); M.prop('coffin', mx + 2, my + 4); }
  // rows of graves either side of the paths
  for (let y = 3; y < rows - 3; y += 2) for (let x = 3; x < cols - 3; x += 2) {
    if (M.use(x, y) || M.propAt(x, y) || Math.abs(y - cy) < 1 || Math.abs(x - gx) < 2) continue;
    if (M.chance(0.78)) { M.prop(M.chance(0.12) ? 'statue' : 'grave', x, y, 0); if (M.chance(wild)) M.set(x, y, 'dirt'); }
  }
  for (let i = 0; i < (cols * rows) / 70; i++) { const x = M.int(2, cols - 3), y = M.int(2, rows - 3); if (!M.use(x, y) && !M.propAt(x, y)) M.prop(M.pick(['deadtree', 'deadtree', 'bush', 'rock', 'mushrooms', 'bones']), x, y, M.int(0, 3)); }
  for (const [x, y] of [[gx - 1, rows - 3], [gx + 2, rows - 3], [gx - 1, cy - 1], [gx + 2, cy + 1]]) if (!M.propAt(x, y)) M.prop('lamppost', x, y);
  // an open grave or two, and the dead
  for (let k = 0; k < 2; k++) { const x = M.int(4, cols - 5), y = M.int(4, rows - 5); if (!M.use(x, y)) { M.set(x, y, 'pit'); M.prop('rubble', x + 1, y); } }
  const pool = S.dead ? srdPool(lib, 'undead') : null, dead = [];
  if (pool) for (const e of stockMonsters(M, S, pool, 'room')) { const x = M.int(3, cols - 4), y = M.int(3, rows - 4); M.token(e, x, y, { hidden: true, srd: e.srd }); dead.push(e); }
  if (S.notes) { labels.push({ x: gx + 2.2, y: rows - 3, text: 'Lychgate', dmOnly: true, size: 's' }); if (dead.length) labels.push({ x: 3, y: 3, text: 'Restless dead: ' + foesText(dead), dmOnly: true, size: 's' }); if (crypt) labels.push({ x: crypt[0] - 4, y: crypt[1] + 2.5, text: 'Mausoleum: stairs down to the crypt', dmOnly: true, size: 's' }); }
  const name = `${M.pick(['Old', 'Saint', 'Hollow', 'Raven', 'Mourning', 'Black'])} ${M.pick(['Hill', 'Aldric’s', 'Vale', 'Barrow', 'Yew'])} Graveyard`;
  return { name, summary: `Graveyard · ${S.age} · ${dead.length ? foesText(dead) : 'quiet'}${crypt ? ' · crypt below' : ''}`, cols, rows, tiles: M.tiles, props: M.props, tokens: M.tokens, labels, crypt, start: [gx - 5, rows - 8, gx + 6, rows - 1] };
}

// =========================================================================================
// CITY STREETS (1.11): cobbled streets around blocks of houses and shops, a plaza in the middle
// =========================================================================================
function cityMap(S, seed, lib) {
  const [cols, rows] = SIZES[S.size] || SIZES.medium, M = makeMap(cols, rows, seed), labels = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) M.set(x, y, 'cobble');
  const docks = S.district === 'docks', slums = S.district === 'slums', noble = S.district === 'noble';
  if (docks) for (let y = rows - 7; y < rows; y++) for (let x = 0; x < cols; x++) M.set(x, y, y < rows - 5 ? 'wood' : 'water');
  const pcx = cols >> 1, pcy = (docks ? rows - 7 : rows) >> 1;
  // blocks between streets
  const streetsX = [], streetsY = []; for (let x = 2; x < cols - 3; x += M.int(10, 14)) streetsX.push(x); for (let y = 2; y < (docks ? rows - 8 : rows) - 3; y += M.int(9, 12)) streetsY.push(y);
  const blocks = [], used = new Set(), people = [];
  for (let i = 0; i < streetsX.length - 1; i++) for (let j = 0; j < streetsY.length - 1; j++) {
    const bx = streetsX[i] + 2, by = streetsY[j] + 2, bw = streetsX[i + 1] - streetsX[i] - 3, bh = streetsY[j + 1] - streetsY[j] - 3;
    if (Math.abs(bx + bw / 2 - pcx) < 8 && Math.abs(by + bh / 2 - pcy) < 6) { // the plaza
      M.prop(noble ? 'statue' : 'fountain', pcx, pcy); for (const [dx, dy] of [[-3, -2], [3, -2], [-3, 2], [3, 2]]) M.prop(slums ? 'barrel' : 'lamppost', pcx + dx, pcy + dy);
      if (S.district === 'market') for (let k = 0; k < 6; k++) M.prop('stall', pcx - 5 + k * 2, pcy + 4);
      continue;
    }
    // one or two buildings per block
    const two = bw >= 11, w1 = two ? (bw >> 1) - 1 : bw, kinds = docks ? ['store', 'house', 'tavern'] : noble ? ['house', 'house', 'temple', 'store'] : slums ? ['house', 'house', 'house', 'tavern'] : ['store', 'house', 'tavern', 'smithy', 'house'];
    for (const [x, w] of two ? [[bx, w1], [bx + w1 + 2, bw - w1 - 2]] : [[bx, w1]]) {
      if (w < 5 || bh < 5) continue;
      const kind = M.pick(kinds), b = building(M, x, by, w, bh, M.pick(['n', 's']), kind === 'temple' ? 'marble' : 'wood');
      const who = (FURNISH[kind] || FURNISH.house)(M, b, lib) || []; people.push(...who);
      blocks.push({ x, y: by, kind });
      if (slums) ruin(M, b);
    }
  }
  for (let i = 0; i < (cols + rows) / 2; i++) { const x = M.int(1, cols - 2), y = M.int(1, rows - 2); if (!M.use(x, y) && !M.propAt(x, y) && M.get(x, y) === 'cobble') M.prop(M.pick(slums ? ['rubble', 'barrel', 'crate', 'bones', 'sack'] : ['barrel', 'crate', 'cart', 'lamppost', 'sack', 'signpost']), x, y, M.int(0, 3)); }
  if (docks) { for (let x = 3; x < cols - 3; x += 8) M.prop('boat', x, rows - 3, 0); for (let x = 6; x < cols - 6; x += 8) for (let y = rows - 5; y < rows - 1; y++) M.prop('bridge', x, y, 1); }
  for (const [e, [x, y]] of people) if (e && M.chance(0.6)) M.token(e, x, y);
  const fam = { thieves: 'bandits', cult: 'cultists', watch: 'garrison', none: null }[S.trouble], pool = fam && srdPool(lib, fam === 'bandits' ? 'city' : fam), trouble = [];
  if (pool) for (const e of stockMonsters(M, S, pool, 'room')) { const x = M.int(2, cols - 3), y = M.int(2, rows - 3); if (M.get(x, y) === 'cobble') { M.token(e, x, y, { hidden: fam !== 'garrison', srd: e.srd }); trouble.push(e); } }
  if (S.notes) { labels.push({ x: pcx + 1.5, y: pcy - 1, text: S.district === 'market' ? 'Market square' : 'Plaza', dmOnly: true, size: 's' }); if (trouble.length) labels.push({ x: 2, y: 1, text: 'Trouble: ' + foesText(trouble), dmOnly: true, size: 's' }); }
  const name = `${M.pick(['Copper', 'Lantern', 'Old', 'Silver', 'Rook', 'Gull', 'Mason'])} ${M.pick(['Lane', 'Row', 'Street', 'Ward', 'Quarter'])}`;
  return { name, summary: `${SCHEMA.city.fields.district.options[S.district]} district · ${blocks.length} buildings${trouble.length ? ' · ' + foesText(trouble) : ''}`, cols, rows, tiles: M.tiles, props: M.props, tokens: M.tokens, labels, start: [pcx - 6, pcy - 5, pcx + 6, pcy + 5] };
}

// ---------- the mood that suits each place ----------
function moodFor(type, S, out) {
  const night = { time: 'night' };
  switch (type) {
    case 'dungeon': {
      const st = S.style, amb = st === 'temple' || st === 'lava' ? 'dim' : 'dark';
      return { vision: { on: true, ambient: amb }, atmo: { sound: SOUND(st === 'crypt' ? 'music-dungeon' : null, st === 'lava' ? 'campfire' : st === 'sewer' || st === 'flooded' ? 'river' : 'cave'), auto: true } };
    }
    case 'building': return S.kind === 'tavern' && S.condition !== 'abandoned' ? { atmo: { sound: SOUND('music-tavern', 'campfire'), auto: true } } : S.condition === 'abandoned' ? { vision: { on: true, ambient: 'dim' }, atmo: { sound: SOUND(null, 'wind'), auto: true } } : null;
    case 'village': return { atmo: { sound: SOUND('music-exploration'), auto: true } };
    case 'wilderness': return { atmo: { weather: S.kind === 'swamp' ? 'fog' : S.kind === 'snowy' ? 'snow' : 'none', level: 1, sound: SOUND('music-exploration', S.kind === 'river' ? 'river' : S.kind === 'coast' ? 'ocean' : S.kind === 'pass' || S.kind === 'snowy' ? 'wind' : 'night'), auto: true } };
    case 'ship': return { atmo: { weather: { calm: 'none', rain: 'rain', storm: 'storm', fog: 'fog' }[S.weather] || 'none', level: 2, sound: SOUND(S.crew === 'pirates' || S.crew === 'raid' ? 'music-battle' : null, S.weather === 'storm' ? 'thunderstorm' : 'ocean', 'wind'), auto: true } };
    case 'castle': return { atmo: { time: S.condition === 'ruined' ? 'dusk' : 'day', sound: SOUND(S.condition === 'besieged' ? 'music-battle' : 'music-exploration', 'wind'), auto: true } };
    case 'graveyard': return { vision: { on: true, ambient: 'dim' }, atmo: { ...night, weather: 'fog', level: 2, sound: SOUND('music-dungeon', 'night', 'wind'), auto: true } };
    case 'city': return { atmo: { time: S.time, sound: SOUND(S.district === 'market' || S.district === 'docks' ? 'music-tavern' : null, S.district === 'docks' ? 'ocean' : null), auto: true }, ...(S.time === 'night' ? { vision: { on: true, ambient: 'dim' } } : {}) };
  }
  return null;
}

// ---------- entry point ----------
const GEN = { village, dungeon, wilderness, building: buildingMap, ship: shipMap, castle: castleMap, graveyard: graveyardMap, city: cityMap };
export function generate(type, settings, seed, lib = {}) {
  const S = { ...defaults(type), ...settings };
  seed = seed >>> 0;
  let out, floors = [];
  if (type === 'dungeon' && S.style !== 'caves' && +S.levels > 1) { // several levels, each with stairs down into the next
    const n = Math.min(3, +S.levels);
    out = dungeon({ ...S, noMirror: true, down: true, boss: false }, seed, lib);
    let prev = out;
    for (let k = 1; k < n && prev.down; k++) {
      const last = k === n - 1, lv = dungeon({ ...S, noMirror: true, anchor: prev.down, down: !last, boss: last && S.boss }, seed + k * 7919, lib);
      floors.push({ ...lv, floor: `Level ${k + 1}`, level: -k }); prev = lv;
    }
    out.floorName = 'Level 1'; out.summary += ` · ${n} levels`;
  } else if (type === 'building' && S.floors && S.floors !== 'none') {
    out = buildingMap(S, seed, lib);
    if (S.floors === 'upstairs' || S.floors === 'both') floors.push({ ...buildingMap({ ...S, story: 'upper', pad: out.pad, stairsAt: out.stairsAt }, seed + 101, lib), floor: 'Upper floor', level: 1 });
    if (S.floors === 'cellar' || S.floors === 'both') floors.push({ ...buildingMap({ ...S, story: 'cellar', pad: out.pad, stairsAt: out.stairsAt }, seed + 202, lib), floor: S.kind === 'temple' ? 'Crypt' : 'Cellar', level: -1 });
    out.summary += ' · ' + floors.map((f) => f.floor.toLowerCase()).join(' and ');
  } else if (type === 'ship' && S.hold) {
    out = shipMap(S, seed, lib);
    floors.push({ ...shipMap({ ...S, story: 'hold' }, seed + 31, lib), floor: 'Hold', level: -1 }); out.floorName = 'Deck';
  } else if (type === 'castle' && S.keepFloors) {
    out = castleMap(S, seed, lib); floors.push({ ...keepUpper(S, seed + 41, lib, out), floor: 'Keep, upper floor', level: 1 });
  } else if (type === 'graveyard' && S.mausoleum) {
    out = graveyardMap(S, seed, lib);
    if (out.crypt) { const c = dungeon({ ...defaults('dungeon'), ...S, size: S.size === 'small' ? 'small' : 'medium', rooms: 'few', style: 'crypt', monsters: S.dead ? 'undead' : 'none', levels: '1', noMirror: true, anchor: out.crypt, down: false, boss: true }, seed + 53, lib); floors.push({ ...c, floor: 'Crypt', level: -1 }); }
  } else out = GEN[type](S, seed, lib);
  out.mood = moodFor(type, S, out);
  if (floors.length) out.floors = floors.map((f) => ({ floor: f.floor, level: f.level, cols: f.cols || out.cols, rows: f.rows || out.rows, tiles: f.tiles, props: f.props, tokens: f.tokens, labels: f.labels || [], start: f.start, mood: type === 'dungeon' || f.floor === 'Crypt' || f.floor === 'Hold' || f.floor === 'Cellar' ? { vision: { on: true, ambient: 'dark' }, atmo: { sound: SOUND(null, 'cave'), auto: true } } : out.mood }));
  return { ...out, seed };
}
