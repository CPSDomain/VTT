// Reads a DM's plain-words map description and turns it into generator settings.
// Works offline: it looks for words and phrases, it doesn't "understand" sentences.
// interpret("snowy fishing village on the coast with a lighthouse") ->
//   { type: 'village', settings: { setting: 'snowy', water: 'coast', tower: true, docks: true }, understood: ['Village', 'Snowy', ...], name }

// [pattern, settings, label]. Patterns match whole words; a leading "no"/"without" flips booleans off.
const RULES = {
  common: [
    [/\b(tiny|small|little|cramped|modest)\b/, { size: 'small' }, 'Small'],
    [/\b(large|big|huge|vast|sprawling|massive|enormous|grand)\b/, { size: 'large' }, 'Large'],
    [/\b(medium|mid-sized|average)\b/, { size: 'medium' }, 'Medium']
  ],
  village: [
    [/\b(snow|snowy|winter|wintry|frozen|icy|arctic|northern|frost)\b/, { setting: 'snowy' }, 'Snowy'],
    [/\b(desert|sand|sandy|arid|dunes?)\b/, { setting: 'desert' }, 'Desert'],
    [/\b(swamp|swampy|marsh|marshy|bog|fen|bayou|wetlands?)\b/, { setting: 'swamp' }, 'Swamp'],
    [/\b(coast|coastal|sea|seaside|harbou?r|port|beach|fishing|cove|bay|shore)\b/, { water: 'coast' }, 'Coast'],
    [/\b(river|stream|riverside|riverbank)\b/, { water: 'river' }, 'River'],
    [/\b(lake|lakeside|loch|lakeshore)\b/, { water: 'lake' }, 'Lake'],
    [/\b(landlocked|dry|no water)\b/, { water: 'none' }, 'No water'],
    [/\b(walled|fortified|walls?|stockade|palisade|fort|gated)\b/, { layout: 'walled' }, 'Walled town'],
    [/\b(hamlet|homestead|few houses|tiny village)\b/, { layout: 'hamlet' }, 'Hamlet'],
    [/\b(crossroads?|junction)\b/, { layout: 'crossroads' }, 'Crossroads'],
    [/\b(one street|single street|main street|roadside|along (a|the) road|high street)\b/, { layout: 'street' }, 'One street'],
    [/\b(town|city|busy|bustling|crowded|many houses|lots of houses)\b/, { buildings: 'many' }, 'Many buildings'],
    [/\b(sparse|quiet|sleepy|few buildings)\b/, { buildings: 'few' }, 'Few buildings'],
    [/\b(ruined|ruins|abandoned|burn(ed|t)|destroyed|raided|ghost town|deserted|overrun|sacked|plague)\b/, { condition: 'ruined' }, 'Ruined'],
    [/\b(thriving|prosperous|rich|wealthy|festival|market day|lively)\b/, { condition: 'thriving' }, 'Thriving'],
    [/\b(forest|wooded|woods|woodland|trees|leafy)\b/, { trees: 'dense' }, 'Lots of trees'],
    [/\b(open|plains|barren|treeless|grassland|meadow)\b/, { trees: 'light' }, 'Few trees'],
    [/\b(market|bazaar|trade|traders|stalls|merchants)\b/, { market: true }, 'Market'],
    [/\b(temple|church|chapel|shrine|graveyard|cemetery|priests?)\b/, { temple: true }, 'Temple'],
    [/\b(farms?|fields|farming|crops|farmland|orchards?|farmers?)\b/, { farms: true }, 'Farms'],
    [/\b(mill|windmill|watermill|millers?)\b/, { mill: true }, 'Mill'],
    [/\b(lighthouse)\b/, { tower: true, water: 'coast' }, 'Lighthouse'],
    [/\b(tower|watchtower|lookout|keep)\b/, { tower: true }, 'Watchtower'],
    [/\b(docks?|pier|piers|wharf|jetty|boats?|ships?|fishing boats)\b/, { docks: true }, 'Docks'],
    [/\b(empty|no people|nobody|no villagers|uninhabited)\b/, { creatures: false }, 'No people'],
    [/\b(villagers|people|folk|townsfolk|crowd|inhabitants|locals)\b/, { creatures: true }, 'Villagers'],
    [/\b(goblins?|hobgoblins?)\b/, { raiders: 'goblinoid', creatures: true }, 'Goblin raiders'],
    [/\b(orcs?|ogres?)\b/, { raiders: 'orcs', creatures: true }, 'Orc raiders'],
    [/\b(bandits?|brigands|outlaws|raiders)\b/, { raiders: 'bandits', creatures: true }, 'Bandits'],
    [/\b(undead|zombies?|skeletons?|ghouls?|haunted|plague)\b/, { raiders: 'undead', creatures: true }, 'Undead']
  ],
  dungeon: [
    [/\b(caves?|caverns?|grotto|natural|underground lake)\b/, { style: 'caves' }, 'Natural caves'],
    [/\b(crypt|tombs?|catacombs?|ossuary|necropolis|burial|mausoleum|barrow)\b/, { style: 'crypt' }, 'Crypt'],
    [/\b(mines?|mining|dwarven|dwarf|shafts?|quarry)\b/, { style: 'mine' }, 'Mine'],
    [/\b(sewers?|drains?|cisterns?|undercity)\b/, { style: 'sewer' }, 'Sewer'],
    [/\b(temple|sanctum|cathedral|fane|cult temple)\b/, { style: 'temple' }, 'Temple'],
    [/\b(lava|magma|volcan\w*|fiery|forge|furnace|molten|infernal|fire)\b/, { style: 'lava' }, 'Lava forge'],
    [/\b(flooded|sunken|drowned|underwater|waterlogged|wet|flooding)\b/, { style: 'flooded' }, 'Flooded'],
    [/\b(halls|fortress|castle|prison|dungeon cells|stronghold|keep)\b/, { style: 'halls' }, 'Stone halls'],
    [/\b(many rooms|lots of rooms|sprawling)\b/, { rooms: 'many' }, 'Many rooms'],
    [/\b(few rooms|single room|small lair)\b/, { rooms: 'few' }, 'Few rooms'],
    [/\b(wide|broad|grand corridors|wide corridors)\b/, { corridors: 'wide' }, 'Wide corridors'],
    [/\b(narrow|tight|twisting corridors|claustrophobic)\b/, { corridors: 'narrow' }, 'Narrow corridors'],
    [/\b(maze|labyrinth\w*|twisting|confusing|warren|winding)\b/, { loops: 'maze' }, 'Maze-like'],
    [/\b(linear|straight|simple|one path|single path)\b/, { loops: 'linear' }, 'Linear'],
    [/\b(deadly|full of traps|lots of traps|a lot of traps|many traps|trap-filled|booby[- ]trapped|riddled with traps)\b/, { traps: 'many' }, 'Many traps'],
    [/\b(traps?|trapped)\b/, { traps: 'some' }, 'Traps', true],
    [/\b(empty|cleared|no monsters|abandoned)\b/, { monsters: 'none' }, 'No monsters'],
    [/\b(goblins?|hobgoblins?|bugbears?)\b/, { monsters: 'goblinoid' }, 'Goblins'],
    [/\b(kobolds?)\b/, { monsters: 'kobold' }, 'Kobolds'],
    [/\b(orcs?|ogres?|orcish)\b/, { monsters: 'orcs' }, 'Orcs'],
    [/\b(undead|zombies?|skeletons?|ghouls?|ghosts?|liches?|vampires?|wights?|mummies|mummy|haunted)\b/, { monsters: 'undead' }, 'Undead'],
    [/\b(rats?|spiders?|beasts?|wolves|bats?|vermin|insects|animals|owlbears?)\b/, { monsters: 'beasts' }, 'Beasts'],
    [/\b(cult|cults|cultists?|fanatics?|demon worshippers?)\b/, { monsters: 'cultists' }, 'Cultists'],
    [/\b(bandits?|thieves|thief|smugglers?|pirates?|outlaws?|thieves' guild)\b/, { monsters: 'bandits' }, 'Bandits'],
    [/\b(dragon|dragon's lair|wyrm)\b/, { monsters: 'kobold', boss: true }, "Dragon's lair"],
    [/\b(secret|secrets|hidden passages?|secret doors?)\b/, { secrets: true }, 'Secret doors'],
    [/\b(boss|lair|throne room|chieftain|warlord|final room)\b/, { boss: true }, 'Boss room']
  ],
  wilderness: [
    [/\b(forest road|road through|woods road|wooded road|king's road)\b/, { kind: 'forest' }, 'Forest road'],
    [/\b(clearing|glade|grove)\b/, { kind: 'clearing', road: false }, 'Forest clearing'],
    [/\b(swamp|marsh|bog|fen|bayou|wetlands?|mire)\b/, { kind: 'swamp' }, 'Swamp'],
    [/\b(river|ford|crossing|riverbank|stream)\b/, { kind: 'river' }, 'River crossing'],
    [/\b(pass|mountains?|mountain pass|cliffs?|canyon|ravine|rocky|hills|highlands|gorge)\b/, { kind: 'pass' }, 'Mountain pass'],
    [/\b(oasis|desert|dunes?|sands?|arid)\b/, { kind: 'oasis' }, 'Desert oasis'],
    [/\b(snow|snowy|winter|frozen|tundra|icy|frost)\b/, { kind: 'snowy' }, 'Snowy woods'],
    [/\b(coast|coastline|beach|shore|cove|seaside|sea|shipwreck)\b/, { kind: 'coast' }, 'Coastline'],
    [/\b(dense|thick|deep|overgrown|dark|tangled)\b/, { density: 'dense' }, 'Dense'],
    [/\b(open|sparse|light|plains|grassland)\b/, { density: 'light' }, 'Open'],
    [/\b(road|path|trail|highway|track)\b/, { road: true }, 'Road', true],
    [/\b(no road|off road|off-road|trackless|pathless|untamed)\b/, { road: false }, 'No road'],
    [/\b(camp|campsite|camping|tents|encampment)\b/, { camp: true }, 'Campsite'],
    [/\b(ruins?|ruined|ancient|crumbling|old tower)\b/, { ruins: true }, 'Ruins'],
    [/\b(pond|pool|lake|spring|water ?hole)\b/, { pond: true }, 'Pond'],
    [/\b(cave|cavern|den|lair)\b/, { cave: true }, 'Cave entrance'],
    [/\b(shrine|altar|statue|standing stones?|idol|monolith)\b/, { shrine: true }, 'Shrine'],
    [/\b(wreck|wrecked|caravan|broken wagon|overturned|ambushed)\b/, { wreck: true, road: true }, 'Wagon wreck'],
    [/\b(peaceful|safe|quiet|no enemies|no monsters|nobody)\b/, { foes: 'none' }, 'No creatures'],
    [/\b(bandits?|thieves|highwaymen|brigands|outlaws|ambush)\b/, { foes: 'bandits' }, 'Bandits'],
    [/\b(wolf|wolves|pack)\b/, { foes: 'wolves' }, 'Wolves'],
    [/\b(goblins?|hobgoblins?)\b/, { foes: 'goblins' }, 'Goblins'],
    [/\b(undead|zombies?|skeletons?|ghosts?|haunted)\b/, { foes: 'undead' }, 'Undead'],
    [/\b(bears?|spiders?|beasts?|animals|owlbears?|boars?)\b/, { foes: 'beasts' }, 'Beasts']
  ],
  building: [
    [/\b(tavern|inn|pub|alehouse|taproom|tap room|hostel)\b/, { kind: 'tavern' }, 'Tavern / inn'],
    [/\b(temple|church|chapel|monastery|abbey|shrine)\b/, { kind: 'temple' }, 'Temple'],
    [/\b(manor|mansion|estate|noble|lord's|villa|hall)\b/, { kind: 'manor' }, 'Manor house'],
    [/\b(shop|store|emporium|merchant|trading post|pawn)\b/, { kind: 'shop' }, 'Shop'],
    [/\b(guardhouse|guard house|guard post|barracks|watch house|jail|gaol)\b/, { kind: 'guardhouse' }, 'Guardhouse'],
    [/\b(wizard|mage|sorcer\w*|alchemist|laboratory|wizard's tower|mage tower|tower)\b/, { kind: 'tower' }, 'Wizard tower'],
    [/\b(abandoned|ruined|haunted|derelict|deserted|empty|ransacked)\b/, { condition: 'abandoned' }, 'Abandoned'],
    [/\b(no yard|no garden|just the building)\b/, { yard: false }, 'No yard'],
    [/\b(garden|yard|courtyard|grounds)\b/, { yard: true }, 'Yard'],
    [/\b(nobody|no people|unoccupied)\b/, { occupants: false }, 'Nobody inside'],
    [/\b(busy|crowded|patrons|people|staff)\b/, { occupants: true }, 'People inside']
  ]
};

const FIRST_WINS = new Set(['style', 'kind', 'setting', 'water']);

// Which kind of map is being described.
const TYPE_WORDS = {
  building: /\b(tavern|inn|pub|alehouse|manor|mansion|shop|store|emporium|guardhouse|guard house|barracks|jail|wizard'?s? tower|mage tower|interior|inside (a|an|the)|floor ?plan)\b/,
  dungeon: /\b(dungeon|lava|magma|sanctum|cult|cultists|crypt|tomb|catacombs?|caves?|caverns?|grotto|mines?|sewers?|vault|lair|labyrinth|maze|underground|undercity|ossuary|barrow|stronghold|warren|delve)\b/,
  village: /\b(village|town|hamlet|city|settlement|port|harbou?r|outpost|fishing village)\b/,
  wilderness: /\b(forest|woods|road|swamp|marsh|bog|river|ford|crossing|pass|mountains?|oasis|desert|coast|coastline|beach|shore|clearing|glade|wilderness|camp|trail|canyon|ravine)\b/
};

export function interpret(text, fallbackType = 'village', keepType = false) {
  const t = ' ' + String(text || '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ') + ' ';
  if (!t.trim()) return { type: fallbackType, settings: {}, understood: [], name: null };

  // pick the map type: the most specific kind of place mentioned wins
  let type = fallbackType;
  // the type with the most place-words wins ("mountain pass with a cave" is wilderness, "cave in the woods" a dungeon);
  // ties go to the more specific kind of place
  if (!keepType) {
    let best = 0;
    for (const k of ['building', 'dungeon', 'village', 'wilderness']) {
      const hits = new Set((t.match(new RegExp(TYPE_WORDS[k].source, 'g')) || []).map((w) => w.trim())).size;
      if (hits > best) { best = hits; type = k; }
    }
  }

  const firstAt = {}, labelFor = {};
  const settings = {}, understood = [{ village: 'Village', dungeon: 'Dungeon', wilderness: 'Wilderness', building: 'Building' }[type]];
  // a 4th entry of true marks a general rule that mustn't overwrite something more specific
  for (const [re, set, label, weak] of [...RULES.common, ...RULES[type]]) {
    const m = t.match(re);
    if (!m || (weak && Object.keys(set).every((k) => k in settings))) continue;
    // "no market", "without a temple": switch the feature off instead
    const before = t.slice(Math.max(0, m.index - 14), m.index);
    const negated = /\b(no|without|not|never|lacking)\s+(a |an |the |any )?$/.test(before);
    const applied = {};
    for (const [k, v] of Object.entries(set)) {
      // the main choice (style, terrain, setting, water) goes to whichever is mentioned first
      if (FIRST_WINS.has(k) && k in firstAt && firstAt[k] < m.index) continue;
      if (FIRST_WINS.has(k)) {
        if (labelFor[k]) understood.splice(understood.indexOf(labelFor[k]), 1); // superseded
        firstAt[k] = m.index; labelFor[k] = negated ? 'No ' + label.toLowerCase() : label;
      }
      applied[k] = negated && typeof v === 'boolean' ? !v : v;
    }
    if (!Object.keys(applied).length) continue;
    if (negated && !Object.values(set).some((v) => typeof v === 'boolean')) continue;
    Object.assign(settings, applied);
    understood.push(negated ? 'No ' + label.toLowerCase() : label);
  }
  // a number of rooms
  const nRooms = t.match(/\b(\d{1,2})\s+rooms?\b/);
  if (nRooms && type === 'dungeon') { const n = +nRooms[1]; settings.rooms = n <= 7 ? 'few' : n >= 14 ? 'many' : 'normal'; understood.push(`~${n} rooms`); }
  // a name: "called Oakhollow", "named The Rusty Anchor"
  const named = String(text).match(/\b(?:called|named)\s+["“]?([A-Z][\w'’ -]{1,30}?)["”]?(?=[,.;!?]|\s+(?:with|on|in|by|near|and|that|where)\b|$)/);
  if (named) understood.push(`Named "${named[1].trim()}"`);
  return { type, settings, understood: [...new Set(understood)], name: named ? named[1].trim() : null };
}

export const EXAMPLES = [
  'A snowy fishing village on the coast with a lighthouse and docks',
  'Walled desert town with a big market, called Sunhold',
  'A ruined hamlet by a river, overrun with goblins',
  'Flooded crypt full of zombies with a few secret doors',
  'Kobold mine with a dragon\'s lair at the bottom',
  'Natural caves with spiders and a lot of traps',
  'Lava forge held by orcs, wide corridors',
  'Bandit ambush on a forest road with a wrecked caravan',
  'Misty swamp with ancient ruins and a shrine',
  'Mountain pass with a cave and wolves',
  'A busy tavern called The Rusty Anchor',
  'Abandoned wizard tower'
];
