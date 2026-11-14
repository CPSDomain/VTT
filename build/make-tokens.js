// Builds public/tokens.json: the built-in token library, drawn from game-icons.net (CC BY 3.0).
// Run: node build/make-tokens.js
const fs = require('fs');
const path = require('path');
const set = require('@iconify-json/game-icons/icons.json');

// [icon, name, size (1 medium/small, 2 large, 3 huge, 4 gargantuan), colour]
const L = {
  Dragons: [
    ['dragon-head', 'Red Dragon', 3, '#b91c1c'], ['dragon-head', 'Blue Dragon', 3, '#1d4ed8'], ['dragon-head', 'Green Dragon', 3, '#15803d'],
    ['dragon-head', 'Black Dragon', 3, '#1c1917'], ['dragon-head', 'White Dragon', 3, '#e2e8f0'], ['dragon-head', 'Gold Dragon', 3, '#ca8a04'],
    ['dragon-head', 'Silver Dragon', 3, '#94a3b8'], ['dragon-head', 'Bronze Dragon', 3, '#a16207'], ['dragon-head', 'Brass Dragon', 3, '#d4a017'],
    ['dragon-head', 'Copper Dragon', 3, '#b45309'], ['spiked-dragon-head', 'Young Dragon', 2, '#9f1239'], ['spiked-dragon-head', 'Dragon Wyrmling', 1, '#be123c'],
    ['wyvern', 'Wyvern', 2, '#57534e'], ['hydra', 'Hydra', 3, '#166534'], ['sea-dragon', 'Sea Serpent', 3, '#0e7490'],
    ['turtle', 'Dragon Turtle', 4, '#065f46'], ['dragonfly', 'Pseudodragon', 1, '#c2410c']
  ],
  'Kobolds & goblinoids': [
    ['lizardman', 'Kobold', 1, '#a16207'], ['lizardman', 'Winged Kobold', 1, '#b45309'], ['lizardman', 'Kobold Chieftain', 1, '#7c2d12'],
    ['goblin', 'Goblin', 1, '#4d7c0f'], ['goblin-head', 'Goblin Boss', 1, '#365314'], ['orc-head', 'Hobgoblin', 1, '#c2410c'],
    ['warlord-helmet', 'Hobgoblin Captain', 1, '#9a3412'], ['brutal-helm', 'Bugbear', 1, '#78350f'], ['goblin-camp', 'Goblin Camp', 1, '#3f6212']
  ],
  Humanoids: [
    ['orc-head', 'Orc', 1, '#3f6212'], ['warlord-helmet', 'Orc War Chief', 1, '#1a2e05'], ['hyena-head', 'Gnoll', 1, '#a16207'],
    ['lizardman', 'Lizardfolk', 1, '#166534'], ['bandit', 'Bandit', 1, '#57534e'], ['pirate-captain', 'Bandit Captain', 1, '#44403c'],
    ['cultist', 'Cultist', 1, '#7f1d1d'], ['hooded-figure', 'Cult Fanatic', 1, '#450a0a'], ['strong-man', 'Thug', 1, '#52525b'],
    ['hooded-assassin', 'Assassin', 1, '#18181b'], ['wizard-face', 'Mage', 1, '#4338ca'], ['warlock-hood', 'Warlock', 1, '#581c87'],
    ['sun-priest', 'Priest', 1, '#b45309'], ['black-knight-helm', 'Knight', 1, '#334155'], ['spartan-helmet', 'Veteran', 1, '#475569'],
    ['visored-helm', 'Guard', 1, '#64748b'], ['centurion-helmet', 'Gladiator', 1, '#9a3412'], ['barbarian', 'Berserker', 1, '#7c2d12'],
    ['walking-scout', 'Scout', 1, '#3f6212'], ['archer', 'Archer', 1, '#4d7c0f'], ['dwarf-helmet', 'Duergar', 1, '#3f3f46'],
    ['elf-helmet', 'Dark Elf', 1, '#3b0764'], ['mermaid', 'Merfolk', 1, '#0e7490'], ['fish-monster', 'Sahuagin', 1, '#155e75'],
    ['werewolf', 'Werewolf', 1, '#44403c'], ['rat', 'Wererat', 1, '#57534e'], ['witch-face', 'Hag', 1, '#365314'],
    ['pirate-hat', 'Pirate', 1, '#1e3a8a'], ['viking-head', 'Raider', 1, '#78350f']
  ],
  Undead: [
    ['skeleton', 'Skeleton', 1, '#a8a29e'], ['shambling-zombie', 'Zombie', 1, '#4d7c0f'], ['dead-head', 'Ghoul', 1, '#57534e'],
    ['ghost', 'Ghost', 1, '#93c5fd'], ['spectre', 'Specter', 1, '#64748b'], ['grim-reaper', 'Wraith', 1, '#1e1b4b'],
    ['horned-skull', 'Wight', 1, '#3f3f46'], ['mummy-head', 'Mummy', 1, '#a8a29e'], ['vampire-dracula', 'Vampire', 1, '#7f1d1d'],
    ['female-vampire', 'Vampire Spawn', 1, '#991b1b'], ['crowned-skull', 'Lich', 1, '#6d28d9'], ['floating-ghost', 'Banshee', 1, '#c4b5fd'],
    ['shadow-follower', 'Shadow', 1, '#111827'], ['raise-skeleton', 'Skeleton Archer', 1, '#78716c'], ['raise-zombie', 'Zombie Horde', 2, '#365314']
  ],
  Beasts: [
    ['wolf-head', 'Wolf', 1, '#57534e'], ['direwolf', 'Dire Wolf', 2, '#292524'], ['bear-head', 'Brown Bear', 2, '#78350f'],
    ['polar-bear', 'Polar Bear', 2, '#cbd5e1'], ['long-legged-spider', 'Giant Spider', 2, '#292524'], ['spider-alt', 'Spider', 1, '#44403c'],
    ['rat', 'Giant Rat', 1, '#78716c'], ['bat', 'Swarm of Bats', 1, '#3f3f46'], ['evil-bat', 'Giant Bat', 2, '#27272a'],
    ['boar', 'Boar', 1, '#7c2d12'], ['snake', 'Giant Snake', 2, '#3f6212'], ['rattlesnake', 'Poisonous Snake', 1, '#a16207'],
    ['lion', 'Lion', 2, '#ca8a04'], ['tiger-head', 'Tiger', 2, '#ea580c'], ['saber-toothed-cat-head', 'Sabre-toothed Tiger', 2, '#c2410c'],
    ['lynx-head', 'Panther', 1, '#1c1917'], ['gorilla', 'Ape', 1, '#44403c'], ['hyena-head', 'Hyena', 1, '#a8a29e'],
    ['eagle-head', 'Giant Eagle', 2, '#78350f'], ['owl', 'Owl', 1, '#a16207'], ['raven', 'Raven', 1, '#18181b'],
    ['vulture', 'Vulture', 1, '#57534e'], ['scorpion', 'Giant Scorpion', 2, '#9a3412'], ['centipede', 'Giant Centipede', 1, '#7c2d12'],
    ['bee', 'Giant Wasp', 1, '#ca8a04'], ['frog', 'Giant Frog', 1, '#4d7c0f'], ['toad-teeth', 'Giant Toad', 2, '#65a30d'],
    ['shark-fin', 'Shark', 2, '#475569'], ['octopus', 'Giant Octopus', 2, '#9f1239'], ['giant-squid', 'Giant Squid', 3, '#be123c'],
    ['crab', 'Giant Crab', 2, '#dc2626'], ['mammoth', 'Mammoth', 4, '#78350f'], ['elephant', 'Elephant', 3, '#71717a'],
    ['deer', 'Deer', 1, '#a16207'], ['stag-head', 'Elk', 2, '#78350f'], ['horse-head', 'Warhorse', 2, '#292524'],
    ['dinosaur-rex', 'Tyrannosaurus', 4, '#3f6212'], ['velociraptor', 'Raptor', 1, '#65a30d'], ['triceratops-head', 'Triceratops', 3, '#57534e']
  ],
  'Giants & monsters': [
    ['ogre', 'Ogre', 2, '#78350f'], ['troll', 'Troll', 2, '#3f6212'], ['giant', 'Hill Giant', 3, '#a16207'],
    ['giant', 'Stone Giant', 3, '#57534e'], ['giant', 'Frost Giant', 3, '#7dd3fc'], ['giant', 'Fire Giant', 3, '#b91c1c'],
    ['cyclops', 'Cyclops', 3, '#92400e'], ['minotaur', 'Minotaur', 2, '#7c2d12'], ['centaur', 'Centaur', 2, '#a16207'],
    ['harpy', 'Harpy', 1, '#57534e'], ['griffin-symbol', 'Griffon', 2, '#ca8a04'], ['barn-owl', 'Owlbear', 2, '#78350f'],
    ['medusa-head', 'Medusa', 1, '#15803d'], ['salamander', 'Basilisk', 2, '#4d7c0f'], ['mimic-chest', 'Mimic', 1, '#92400e'],
    ['transparent-slime', 'Gelatinous Cube', 2, '#22d3ee'], ['slime', 'Black Pudding', 2, '#18181b'], ['worm-mouth', 'Purple Worm', 4, '#6b21a8'],
    ['kraken-tentacle', 'Kraken', 4, '#0f766e'], ['masked-spider', 'Phase Spider', 2, '#4c1d95'], ['unicorn', 'Unicorn', 2, '#e2e8f0'],
    ['pegasus', 'Pegasus', 2, '#cbd5e1'], ['greek-sphinx', 'Sphinx', 2, '#ca8a04'], ['rock-golem', 'Stone Golem', 2, '#57534e'],
    ['metal-golem-head', 'Iron Golem', 2, '#3f3f46'], ['golem-head', 'Clay Golem', 2, '#92400e'], ['frankenstein-creature', 'Flesh Golem', 2, '#4d7c0f'],
    ['gargoyle', 'Gargoyle', 1, '#57534e'], ['tree-face', 'Treant', 3, '#3f6212'], ['mushrooms-cluster', 'Fungus Creature', 1, '#7c2d12'],
    ['scarecrow', 'Scarecrow', 1, '#a16207'], ['oni', 'Oni', 2, '#1e40af']
  ],
  'Fiends, fey & spirits': [
    ['imp', 'Imp', 1, '#b91c1c'], ['devil-mask', 'Devil', 2, '#7f1d1d'], ['daemon-skull', 'Demon', 2, '#450a0a'],
    ['djinn', 'Djinni', 2, '#1d4ed8'], ['fire-bowl', 'Fire Elemental', 2, '#ea580c'], ['water-splash', 'Water Elemental', 2, '#0369a1'],
    ['whirlwind', 'Air Elemental', 2, '#94a3b8'], ['stone-pile', 'Earth Elemental', 2, '#78350f'], ['ice-golem', 'Ice Mephit', 1, '#7dd3fc'],
    ['fairy', 'Sprite', 1, '#16a34a'], ['fairy-wings', 'Pixie', 1, '#db2777'], ['woman-elf-face', 'Dryad', 1, '#15803d'],
    ['floating-tentacles', 'Tentacled Horror', 2, '#581c87'], ['brain-tentacle', 'Brain Horror', 1, '#9d174d'], ['six-eyes', 'Many-eyed Horror', 2, '#701a75'],
    ['interlaced-tentacles', 'Aberration', 2, '#4a044e']
  ],
  'Villagers & NPCs': [
    ['person', 'Villager', 1, '#a16207'], ['character', 'Commoner', 1, '#78716c'], ['farmer', 'Farmer', 1, '#65a30d'],
    ['blacksmith', 'Blacksmith', 1, '#44403c'], ['cook', 'Innkeeper', 1, '#b45309'], ['old-king', 'King', 1, '#a16207'],
    ['queen-crown', 'Noble', 1, '#7e22ce'], ['monk-face', 'Monk', 1, '#c2410c'], ['nun-face', 'Acolyte', 1, '#475569'],
    ['sun-priest', 'Village Priest', 1, '#ca8a04'], ['baby-face', 'Child', 1, '#f59e0b'], ['jester-hat', 'Jester', 1, '#be185d'],
    ['miner', 'Miner', 1, '#57534e'], ['lucky-fisherman', 'Fisher', 1, '#0e7490'], ['executioner-hood', 'Executioner', 1, '#18181b'],
    ['guards', 'Town Guard', 1, '#1e40af'], ['mounted-knight', 'Mounted Knight', 2, '#334155'], ['doctor-face', 'Healer', 1, '#0f766e'],
    ['mad-scientist', 'Alchemist', 1, '#4d7c0f'], ['pilgrim-hat', 'Pilgrim', 1, '#3f3f46'], ['robin-hood-hat', 'Hunter', 1, '#166534'],
    ['hood', 'Traveller', 1, '#57534e'], ['beard', 'Village Elder', 1, '#a8a29e'], ['dwarf-face', 'Dwarf', 1, '#92400e'],
    ['bad-gnome', 'Gnome', 1, '#dc2626'], ['top-hat', 'Merchant', 1, '#1f2937'], ['kneeling', 'Beggar', 1, '#78716c']
  ],
  'Farm & pets': [
    ['horse-head', 'Horse', 2, '#92400e'], ['cow', 'Cow', 2, '#e7e5e4'], ['bull', 'Ox', 2, '#57534e'], ['pig', 'Pig', 1, '#f9a8d4'],
    ['chicken', 'Chicken', 1, '#fafaf9'], ['rooster', 'Rooster', 1, '#b91c1c'], ['sheep', 'Sheep', 1, '#f5f5f4'], ['goat', 'Goat', 1, '#a8a29e'],
    ['sitting-dog', 'Dog', 1, '#a16207'], ['hound', 'Mastiff', 1, '#44403c'], ['cat', 'Cat', 1, '#ea580c'], ['donkey', 'Mule', 1, '#78716c'],
    ['duck', 'Duck', 1, '#65a30d'], ['goose', 'Goose', 1, '#d6d3d1'], ['rabbit', 'Rabbit', 1, '#a8a29e'], ['badger', 'Badger', 1, '#3f3f46'],
    ['fox', 'Fox', 1, '#ea580c']
  ],
  Heroes: [
    ['crested-helmet', 'Fighter', 1, '#1d4ed8'], ['pointy-hat', 'Wizard', 1, '#4338ca'], ['hooded-figure', 'Rogue', 1, '#27272a'],
    ['prayer', 'Cleric', 1, '#ca8a04'], ['archer', 'Ranger', 1, '#15803d'], ['barbarian', 'Barbarian', 1, '#b91c1c'],
    ['visored-helm', 'Paladin', 1, '#a16207'], ['jester-hat', 'Bard', 1, '#be185d'], ['woman-elf-face', 'Druid', 1, '#3f6212'],
    ['monk-face', 'Monk', 1, '#ea580c'], ['magic-hat', 'Sorcerer', 1, '#9333ea'], ['warlock-hood', 'Warlock', 1, '#581c87'],
    ['ninja-head', 'Ninja', 1, '#18181b'], ['swordwoman', 'Swordswoman', 1, '#0f766e']
  ]
};

// Standard 5e average HP and initiative bonus (Dex modifier) for common monsters and NPCs (SRD 5.1 where available).
const STATS = {
  Goblin: [7, 2], 'Goblin Boss': [21, 2], Hobgoblin: [11, 1], 'Hobgoblin Captain': [39, 2], Bugbear: [27, 2],
  Kobold: [5, 2], 'Winged Kobold': [7, 3], Orc: [15, 1], 'Orc War Chief': [93, 1], Ogre: [59, -1], Troll: [84, 1],
  Gnoll: [22, 1], Lizardfolk: [22, 0], Skeleton: [13, 2], 'Skeleton Archer': [13, 2], Zombie: [22, -2], Ghoul: [22, 2],
  Wight: [45, 2], 'Vampire Spawn': [82, 3], Mummy: [58, -1], Specter: [22, 2], Ghost: [45, 1], Shadow: [16, 2],
  Wolf: [11, 2], 'Dire Wolf': [37, 2], 'Brown Bear': [34, 0], 'Polar Bear': [42, 0], 'Giant Spider': [26, 3], 'Giant Rat': [7, 2],
  'Swarm of Bats': [22, 2], 'Giant Centipede': [4, 2], Boar: [11, 0], Owlbear: [59, 1], 'Giant Scorpion': [52, 1], 'Giant Frog': [18, 1],
  Bandit: [11, 1], 'Bandit Captain': [65, 3], Thug: [32, 0], Scout: [16, 2], Cultist: [9, 1], 'Cult Fanatic': [33, 2],
  Guard: [11, 1], 'Town Guard': [11, 1], Knight: [52, 0], Veteran: [58, 1], Mage: [40, 2], Priest: [27, 0], Berserker: [67, 1],
  Assassin: [78, 3], Gladiator: [112, 2], Archer: [75, 4], 'Young Dragon': [178, 0], 'Dragon Wyrmling': [75, 0],
  'Red Dragon': [256, 0], Minotaur: [76, 0], Imp: [10, 3], Gargoyle: [52, 0], Harpy: [38, 1], 'Giant Eagle': [26, 3],
  Commoner: [4, 0], Villager: [4, 0], Farmer: [4, 0], Noble: [9, 1], Acolyte: [9, 0], 'Stone Golem': [178, -1],
  'Clay Golem': [133, -1], 'Flesh Golem': [93, -1], 'Iron Golem': [210, -1], Basilisk: [52, -1], Medusa: [127, 2],
  'Hill Giant': [105, -1], 'Stone Giant': [126, 2], 'Frost Giant': [138, -1], 'Fire Giant': [162, -1], Cyclops: [138, 0],
  'Gelatinous Cube': [84, -4], 'Black Pudding': [85, -3], Mimic: [58, 1], 'Phase Spider': [32, 2], Sprite: [2, 4], Dryad: [22, 1],
  Hag: [82, 1], Werewolf: [58, 1], Wererat: [33, 2], Centaur: [45, 2], Griffon: [59, 2], Pegasus: [59, 2], Unicorn: [67, 2]
};

// 5e conditions plus a few common table states, shown as icons on tokens.
const CONDITIONS = [
  ['blinded', 'Blinded', 'blindfold', '#6b7280'], ['charmed', 'Charmed', 'charm', '#db2777'], ['deafened', 'Deafened', 'silenced', '#6b7280'],
  ['frightened', 'Frightened', 'terror', '#7c3aed'], ['grappled', 'Grappled', 'grab', '#b45309'], ['incapacitated', 'Incapacitated', 'knockout', '#475569'],
  ['invisible', 'Invisible', 'invisible', '#60a5fa'], ['paralyzed', 'Paralyzed', 'frozen-body', '#0ea5e9'], ['petrified', 'Petrified', 'stone-bust', '#78716c'],
  ['poisoned', 'Poisoned', 'poison-bottle', '#16a34a'], ['prone', 'Prone', 'falling', '#a16207'], ['restrained', 'Restrained', 'manacles', '#57534e'],
  ['stunned', 'Stunned', 'star-swirl', '#ca8a04'], ['unconscious', 'Unconscious', 'sleepy', '#334155'], ['exhaustion', 'Exhaustion', 'tired-eye', '#92400e'],
  ['concentrating', 'Concentrating', 'concentration-orb', '#6366f1'], ['bleeding', 'Bleeding', 'bleeding-wound', '#b91c1c'], ['blessed', 'Blessed', 'angel-wings', '#d97706'],
  ['hasted', 'Hasted', 'sprint', '#059669'], ['raging', 'Raging', 'enrage', '#dc2626'], ['burning', 'Burning', 'flame', '#ea580c'],
  ['marked', 'Marked', 'targeted', '#e11d48'],
  ['baned', 'Baned', 'cursed-star', '#9a3412'], ['slowed', 'Slowed', 'snail', '#0891b2'], ['outlined', 'Faerie fire', 'sparkles', '#a855f7'],
  ['hexed', 'Hexed', 'pentacle', '#6d28d9'], ['shielded', 'Shield of Faith', 'magic-shield', '#2563eb'], ['banished', 'Banished', 'vortex', '#4c1d95'],
  ['confused', 'Confused', 'spiral-arrow', '#c026d3'], ['enfeebled', 'Enfeebled', 'despair', '#57534e'], ['muddled', 'Muddled', 'brain-freeze', '#7c3aed'],
  ['haunted', 'Phantasmal Killer', 'haunting', '#4338ca'], ['dancing', 'Dancing', 'swirl-string', '#db2777'], ['befuddled', 'Befuddled', 'brain', '#9333ea'],
  ['commanded', 'Commanded', 'tied-scroll', '#a16207'], ['heroism', 'Heroism', 'muscle-up', '#ea580c'], ['holyaura', 'Holy Aura', 'holy-symbol', '#facc15'],
  ['cursed', 'Cursed', 'death-skull', '#581c87'], ['dazed', 'Dazed', 'magic-swirl', '#0e7490'], ['afflicted', 'Afflicted', 'bandaged', '#65a30d'],
  ['warded', 'Spell protection', 'checked-shield', '#0284c7'], ['glowing', 'Guiding Bolt', 'sun', '#fbbf24'], ['transformed', 'Transformed', 'wolf-howl', '#15803d'],
  ['dodging', 'Dodging', 'dodging', '#0891b2'], ['disengaged', 'Disengaged', 'run', '#4d7c0f'], ['distracted', 'Helped against (next attack has Advantage)', 'hand', '#ca8a04'],
  ['sapped', 'Sapped (Disadvantage on its next attack)', 'broken-shield', '#78350f'], ['vexed', 'Vexed (Advantage on the next attack against it)', 'targeted', '#be123c'], ['hobbled', 'Slowed by a weapon (-10 ft)', 'snail', '#0e7490'],
  ['cover-half', 'Half cover (+2 AC and Dex saves)', 'stone-wall', '#57534e'], ['cover-3q', 'Three-quarters cover (+5 AC and Dex saves)', 'stone-tower', '#44403c'],
  ['mirrored', 'Mirror Image', 'mirror-mirror', '#7c3aed'], ['surprised', 'Surprised (Disadvantage on initiative)', 'surprised', '#f59e0b'], ['blinking', 'Blink (in the Ethereal Plane)', 'teleport', '#6d28d9'], ['hidden', 'Hidden', 'hood', '#1f2937'], ['dead', 'Dead', 'skull-crossed-bones', '#111827']
];

const icons = {}, library = [], missing = [];
for (const [cat, rows] of Object.entries(L)) {
  for (const [icon, name, size, color] of rows) {
    if (!set.icons[icon]) { missing.push(icon); continue; }
    icons[icon] = set.icons[icon].body;
    const st = STATS[name];
    library.push({ id: 'b-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, cat, icon, size, color, ...(st ? { hp: st[0], init: st[1] } : {}) });
  }
}
const conditions = CONDITIONS.map(([id, name, icon, color]) => { if (!set.icons[icon]) missing.push(icon); icons[icon] = set.icons[icon].body; return { id, name, icon, color }; });
const out = {
  credit: 'Token artwork from game-icons.net by Lorc, Delapouite and contributors, licensed CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/).',
  size: set.width || 512, icons, library, conditions
};
fs.writeFileSync(path.join(__dirname, '..', 'public', 'tokens.json'), JSON.stringify(out));
console.log(`${library.length} tokens (${library.filter((l) => l.hp).length} with stats), ${conditions.length} conditions, ${Object.keys(icons).length} icons, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`, missing.length ? 'MISSING: ' + missing.join(', ') : '');
