// Spells that put a creature or a thing on the map (1.19), and spells that move creatures (teleports and pushes).
// Numbers only, from the 2024 Player's Handbook stat blocks (Bestial Spirit, Fey Spirit…): AC, hit points and attacks
// worked out for the spell's level. L = the slot level, mod = the caster's spellcasting ability modifier.
//   forms: the choices when casting (Air, Land, Water…), each with its own attacks or hit points
//   attacks: { name, dice(L, mod), type, melee, reach | range, extra } — made with the caster's spell attack bonus
//   multi(L): how many attacks it makes with its action
//   srd: a monster from the stat blocks instead (Find Familiar's owl, Animate Dead's skeletons)
//   object: no hit points (Spiritual Weapon); zone: an area that moves with it (Conjure Animals' pack)
//   init: 'share' (2024: shares the caster's Initiative, its turn right after the caster's) or 'roll' (its own roll:
//   Find Familiar, the undead); things without it (Spiritual Weapon, Bigby's Hand) act on the caster's turn
const F = (n) => Math.floor(n);
const half = (L) => F(L / 2);
const SPIRIT = { icon: 'ghost', color: '#7dd3fc' };

const SUMMONS = {
  'find familiar': { init: 'roll', label: 'Familiar', n: () => 1, forms: ['Bat', 'Cat', 'Frog', 'Hawk', 'Lizard', 'Octopus', 'Owl', 'Rat', 'Raven', 'Spider', 'Weasel'].map((x) => ({ name: x, srd: x.toLowerCase() + '-2024' })) },
  'find steed': { init: 'share', label: 'Otherworldly Steed', size: 2, icon: 'horse-head', color: '#a78bfa', ac: (L) => 10 + L, hp: (L) => 5 + 10 * L,
    forms: [['Celestial', 'radiant'], ['Fey', 'psychic'], ['Fiend', 'necrotic']].map(([name, type]) => ({ name, attacks: [{ name: 'Otherworldly Slam', dice: (L) => '1d8+' + L, type, melee: true }] })) },
  'summon beast': { init: 'share', label: 'Bestial Spirit', ...SPIRIT, icon: 'wolf-head', ac: (L) => 11 + L, multi: half,
    forms: [{ name: 'Air', hp: (L) => 20 + 5 * (L - 2) }, { name: 'Land', hp: (L) => 30 + 5 * (L - 2) }, { name: 'Water', hp: (L) => 30 + 5 * (L - 2) }].map((f) => ({ ...f, attacks: [{ name: 'Rend', dice: (L) => '1d8+' + (4 + L), type: 'piercing', melee: true }] })) },
  'summon fey': { init: 'share', label: 'Fey Spirit', ...SPIRIT, icon: 'fairy', ac: (L) => 12 + L, hp: (L) => 30 + 10 * (L - 3), multi: half,
    forms: ['Fuming', 'Mirthful', 'Tricksy'].map((name) => ({ name, attacks: [{ name: 'Fey Blade', dice: (L) => '2d6+' + (3 + L), type: 'force', melee: true }] })) },
  'summon undead': { init: 'share', label: 'Undead Spirit', ...SPIRIT, icon: 'skeleton', ac: (L) => 11 + L, multi: half,
    forms: [{ name: 'Ghostly', hp: (L) => 30 + 10 * (L - 3), attacks: [{ name: 'Deathly Touch', dice: (L) => '1d8+' + (3 + L), type: 'necrotic', melee: true }] },
      { name: 'Putrid', hp: (L) => 30 + 10 * (L - 3), attacks: [{ name: 'Rotting Claw', dice: (L) => '1d6+' + (3 + L), type: 'slashing', melee: true }] },
      { name: 'Skeletal', hp: (L) => 20 + 10 * (L - 3), attacks: [{ name: 'Grave Bolt', dice: (L) => '2d4+' + (3 + L), type: 'necrotic', range: 150 }] }] },
  'summon aberration': { init: 'share', label: 'Aberrant Spirit', ...SPIRIT, icon: 'interlaced-tentacles', ac: (L) => 11 + L, hp: (L) => 40 + 10 * (L - 4), multi: half,
    forms: [{ name: 'Beholderkin', attacks: [{ name: 'Eye Ray', dice: (L) => '1d8+' + (3 + L), type: 'psychic', range: 150 }] },
      { name: 'Mind Flayer', attacks: [{ name: 'Psychic Slam', dice: (L) => '1d8+' + (3 + L), type: 'psychic', melee: true }] },
      { name: 'Slaad', attacks: [{ name: 'Claw', dice: (L) => '1d10+' + (3 + L), type: 'slashing', melee: true }] }] },
  'summon construct': { init: 'share', label: 'Construct Spirit', ...SPIRIT, icon: 'golem-head', ac: (L) => 13 + L, hp: (L) => 40 + 15 * (L - 4), multi: half,
    forms: ['Clay', 'Metal', 'Stone'].map((name) => ({ name, attacks: [{ name: 'Slam', dice: (L) => '1d8+' + (4 + L), type: 'bludgeoning', melee: true }] })) },
  'summon elemental': { init: 'share', label: 'Elemental Spirit', ...SPIRIT, icon: 'whirlwind', ac: (L) => 11 + L, hp: (L) => 50 + 10 * (L - 4), multi: half,
    forms: [['Air', 'lightning'], ['Earth', 'bludgeoning'], ['Fire', 'fire'], ['Water', 'cold']].map(([name, type]) => ({ name, attacks: [{ name: 'Slam', dice: (L) => '1d10+' + (4 + L), type, melee: true }] })) },
  'summon celestial': { init: 'share', label: 'Celestial Spirit', ...SPIRIT, icon: 'sun-priest', size: 2, multi: half, hp: (L) => 40 + 10 * (L - 5),
    forms: [{ name: 'Avenger', ac: (L) => 11 + L, attacks: [{ name: 'Radiant Bow', dice: (L) => '2d6+' + (2 + L), type: 'radiant', range: 600 }] },
      { name: 'Defender', ac: (L) => 13 + L, attacks: [{ name: 'Radiant Mace', dice: (L) => '1d10+' + (3 + L), type: 'radiant', melee: true }] }] },
  'summon fiend': { init: 'share', label: 'Fiendish Spirit', ...SPIRIT, icon: 'daemon-skull', size: 2, ac: (L) => 12 + L, multi: half,
    forms: [{ name: 'Demon', hp: (L) => 50 + 15 * (L - 6), attacks: [{ name: 'Bite', dice: (L) => '1d12+' + (3 + L), type: 'necrotic', melee: true }] },
      { name: 'Devil', hp: (L) => 40 + 15 * (L - 6), attacks: [{ name: 'Fiery Strike', dice: (L) => '2d6+' + (3 + L), type: 'fire', melee: true, range: 150 }] },
      { name: 'Yugoloth', hp: (L) => 60 + 15 * (L - 6), attacks: [{ name: 'Claws', dice: (L) => '1d8+' + (3 + L), type: 'slashing', melee: true }] }] },
  'summon dragon': { init: 'share', label: 'Draconic Spirit', ...SPIRIT, icon: 'dragon-head', size: 2, ac: (L) => 14 + L, hp: (L) => 50 + 10 * (L - 5), multi: half,
    forms: ['Chromatic', 'Gem', 'Metallic'].map((name) => ({ name, attacks: [{ name: 'Rend', dice: (L) => '1d6+' + (4 + L), type: 'piercing', melee: true, reach: 10 }] })) },
  'giant insect': { init: 'share', label: 'Giant Insect', ...SPIRIT, icon: 'long-legged-spider', size: 2, ac: (L) => 11 + L, hp: (L) => 30 + 10 * (L - 4), multi: half,
    forms: [{ name: 'Centipede' }, { name: 'Spider', extra: [{ name: 'Web Bolt', dice: (L) => '1d10+' + (3 + L), type: 'bludgeoning', range: 60 }] }, { name: 'Wasp' }]
      .map((f) => ({ name: f.name, attacks: [{ name: 'Poison Jab', dice: (L) => '1d6+' + (3 + L), type: 'piercing', melee: true, reach: 10, extra: { dice: '1d4', type: 'poison' } }, ...(f.extra || [])] })) },
  'animate dead': { init: 'roll', label: 'Undead', n: (L) => 1 + 2 * (L - 3), forms: [{ name: 'Skeleton', srd: 'skeleton-2024' }, { name: 'Zombie', srd: 'zombie-2024' }], keep: true },
  'create undead': { init: 'roll', label: 'Undead', n: (L) => Math.max(3, L - 3), forms: [{ name: 'Ghoul', srd: 'ghoul-2024' }], keep: true },
  'animate objects': { init: 'share', label: 'Animated Object', icon: 'magic-shield', color: '#a8a29e', n: (L, mod) => Math.max(1, mod), ac: () => 15, hp: () => 10,
    forms: [{ name: 'Medium or smaller', attacks: [{ name: 'Slam', dice: (L, mod) => `${Math.max(1, L - 4)}d4+${3 + mod}`, type: 'force', melee: true }] }] },
  'spiritual weapon': { label: 'Spiritual Weapon', icon: 'star-swirl', color: '#facc15', object: true,
    forms: [{ name: 'Weapon', attacks: [{ name: 'Spiritual Weapon', dice: (L, mod) => `${L - 1}d8+${mod}`, type: 'force', melee: true }] }] },
  "mordenkainen's sword": { label: 'Arcane Sword', icon: 'star-swirl', color: '#93c5fd', object: true,
    forms: [{ name: 'Sword', attacks: [{ name: 'Arcane Sword', dice: (L, mod) => `4d12+${mod}`, type: 'force', melee: true }] }] },
  "bigby's hand": { label: "Bigby's Hand", icon: 'hand', color: '#93c5fd', size: 2, ac: () => 20, hp: (L, mod, maxHp) => maxHp || 40,
    forms: [{ name: 'Clenched Fist', attacks: [{ name: 'Clenched Fist', dice: (L) => `${5 + 2 * (L - 5)}d8`, type: 'force', melee: true }] }] },
  'conjure fey': { label: 'Fey Spirit', ...SPIRIT, icon: 'fairy', object: true,
    forms: [{ name: 'Fey', attacks: [{ name: 'Psychic strike', dice: (L, mod) => `${3 + 2 * (L - 6)}d12+${mod}`, type: 'psychic', melee: true }] }] },
  // the 2024 conjurings that are areas: a token to move, and the area goes with it
  'conjure animals': { label: 'Spirit Pack', icon: 'wolf-head', color: '#7dd3fc', size: 2, object: true, forms: [{ name: 'Pack' }], zone: { radius: 10, save: 'DEX', dmg: (L) => ({ dice: `${3 + (L - 3)}d10`, type: 'slashing' }) } },
  'conjure elemental': { label: 'Elemental Spirit', icon: 'whirlwind', color: '#7dd3fc', size: 2, object: true,
    forms: [['Air', 'lightning'], ['Earth', 'thunder'], ['Fire', 'fire'], ['Water', 'cold']].map(([name, type]) => ({ name, type })), zone: { radius: 5, save: 'DEX', dmg: (L, f) => ({ dice: `${8 + (L - 5)}d8`, type: f.type }), start: true, add: ['restrained'] } },
  'dancing lights': { label: 'Dancing Light', icon: 'sparkles', color: '#fde68a', object: true, n: () => 4, light: [0, 10], forms: [{ name: 'Lights' }] },
  'unseen servant': { init: 'roll', label: 'Unseen Servant', icon: 'ghost', color: '#d6d3d1', ac: () => 10, hp: () => 1, forms: [{ name: 'Servant' }], keep: true },
  "mordenkainen's faithful hound": { label: 'Faithful Hound', icon: 'wolf-head', color: '#93c5fd', object: true, forms: [{ name: 'Hound', attacks: [{ name: 'Bite', dice: () => '4d8', type: 'force', melee: true }] }], keep: true },
  'phantom steed': { label: 'Phantom Steed', icon: 'horse-head', color: '#d6d3d1', size: 2, ac: () => 10, hp: () => 1, forms: [{ name: 'Steed' }], keep: true }
};
SUMMONS['find greater steed'] = { ...SUMMONS['find steed'] };

// moving by magic: teleport (feet, who can come along) and push (feet, on a failed save)
const TELEPORTS = {
  'misty step': { feet: 30 },
  'dimension door': { feet: 500, bring: 1 },
  'steel wind strike': { feet: 0, nearTarget: true },
  'thunder step': { feet: 90, bring: 1 },
  'far step': { feet: 60 },
  'arcane gate': { feet: 500 },
  'scatter': { feet: 120, targets: true }
};
const PUSHES = {
  'thunderwave': { feet: 10, onFail: true },
  'gust of wind': { feet: 15, onFail: true },
  'thorn whip': { feet: -10, onHit: true },
  'lightning lure': { feet: -10, onFail: true },
  'telekinesis': { feet: 30, onFail: true }
};
module.exports = { SUMMONS, TELEPORTS, PUSHES };
