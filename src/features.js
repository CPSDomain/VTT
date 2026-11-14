// Saving throws that come from somewhere other than a spell, by the 2024 rules:
//  - class features and feats a player uses on a creature (Stunning Strike, Cunning Strike, Turn Undead…), and the
//    Grapple and Shove everyone can do with an Unarmed Strike;
//  - presets from the Dungeon Master's Guide for the DM: magic items, poisons and hazards that hold a creature until it
//    saves (Wand of Paralysis, Yellow Mold, Carrion Crawler Mucus…).
// The fields are the same as a spell rule (see spellrules.js). dc: 'k:WIS' is 8 + proficiency + that modifier,
// 'k:STR|DEX' the better of the two, 'spell' the character's spell save DC.

const F = (name, x) => ({ name, ...x });
const FEATURES = [
  F('Grapple', { all: true, add: ['grappled'], save: 'STR|DEX', dc: 'k:STR', escape: 'grapple', note: 'Unarmed Strike: Strength or Dexterity save (the target picks the better). Escape: its action, Athletics or Acrobatics.' }),
  F('Shove prone', { all: true, add: ['prone'], save: 'STR|DEX', dc: 'k:STR', note: 'Unarmed Strike: knocked Prone on a failed save.' }),
  F('Stunning Strike', { cls: 'Monk', lvl: 5, add: ['stunned'], save: 'CON', dc: 'k:WIS', expire: 'srcStart', cost: 'Focus Points', note: 'Stunned until the start of your next turn.' }),
  F('Topple (Open Hand)', { cls: 'Monk', sub: 'Open Hand', lvl: 3, add: ['prone'], save: 'DEX', dc: 'k:WIS' }),
  F('Cunning Strike: Poison', { cls: 'Rogue', lvl: 5, add: ['poisoned'], save: 'CON', dc: 'k:DEX', end: true, rounds: 10 }),
  F('Cunning Strike: Trip', { cls: 'Rogue', lvl: 5, add: ['prone'], save: 'DEX', dc: 'k:DEX' }),
  F('Devious Strike: Daze', { cls: 'Rogue', lvl: 14, add: ['dazed'], save: 'CON', dc: 'k:DEX', expire: 'tgtEnd' }),
  F('Devious Strike: Knock Out', { cls: 'Rogue', lvl: 14, add: ['unconscious'], save: 'CON', dc: 'k:DEX', end: true, hurt: 'end', rounds: 10 }),
  F('Devious Strike: Obscure', { cls: 'Rogue', lvl: 14, add: ['blinded'], save: 'DEX', dc: 'k:DEX', expire: 'tgtEnd' }),
  F('Rend Mind', { cls: 'Rogue', sub: 'Soulknife', lvl: 17, add: ['stunned'], save: 'WIS', dc: 'k:DEX', end: true, rounds: 10 }),
  F('Intimidating Presence', { cls: 'Barbarian', sub: 'Berserker', lvl: 10, add: ['frightened'], save: 'WIS', dc: 'k:STR', end: true, rounds: 10 }),
  F('Turn Undead', { cls: 'Cleric', lvl: 2, add: ['frightened', 'incapacitated'], save: 'WIS', dc: 'spell', hurt: 'end', rounds: 10, cost: 'Channel Divinity' }),
  F('Abjure Foes', { cls: 'Paladin', lvl: 9, add: ['frightened'], save: 'WIS', dc: 'spell', hurt: 'end', rounds: 10, cost: 'Channel Divinity' }),
  F("Nature's Wrath", { cls: 'Paladin', sub: 'Ancients', lvl: 3, add: ['restrained'], save: 'STR', dc: 'spell', end: true, rounds: 10, cost: 'Channel Divinity' }),
  F('Frightful Aura (Avenging Angel)', { cls: 'Paladin', sub: 'Vengeance', lvl: 20, add: ['frightened'], save: 'WIS', dc: 'spell', hurt: 'end', rounds: 10 }),
  F('Beguiling Magic', { cls: 'Bard', sub: 'Glamour', lvl: 3, add: ['charmed'], save: 'WIS', dc: 'spell', end: true, rounds: 10, options: [{ name: 'Charmed', add: ['charmed'] }, { name: 'Frightened', add: ['frightened'] }] }),
  F('Beguiling Twist', { cls: 'Ranger', sub: 'Fey Wanderer', lvl: 11, add: ['charmed'], save: 'WIS', dc: 'spell', end: true, rounds: 10, options: [{ name: 'Charmed', add: ['charmed'] }, { name: 'Frightened', add: ['frightened'] }] }),
  F("Stalker's Flurry: Mass Fear", { cls: 'Ranger', sub: 'Gloom Stalker', lvl: 15, add: ['frightened'], save: 'WIS', dc: 'spell', expire: 'srcStart' }),
  F('Hurl Through Hell', { cls: 'Warlock', sub: 'Fiend', lvl: 14, add: ['banished', 'incapacitated'], save: 'CHA', dc: 'spell', expire: 'srcEnd', dice: '8d10', type: 'psychic' }),
  F('Menacing Attack', { cls: 'Fighter', sub: 'Battle Master', lvl: 3, add: ['frightened'], save: 'WIS', dc: 'k:STR|DEX', expire: 'srcEnd', cost: 'Superiority Dice' }),
  F('Trip Attack', { cls: 'Fighter', sub: 'Battle Master', lvl: 3, add: ['prone'], save: 'STR', dc: 'k:STR|DEX', cost: 'Superiority Dice' }),
  F('Telekinetic Thrust', { cls: 'Fighter', sub: 'Psi Warrior', lvl: 7, add: ['prone'], save: 'STR', dc: 'k:INT' }),
  F('Shield Bash (Shield Master)', { feat: 'Shield Master', add: ['prone'], save: 'STR', dc: 'k:STR' }),
  F('Poisoned weapon (Poisoner)', { feat: 'Poisoner', add: ['poisoned'], save: 'CON', dc: 'k:INT|WIS', expire: 'srcEnd', dice: '2d8', type: 'poison' })
];

// for the DM: Dungeon Master's Guide items, poisons and hazards whose effect lasts until the creature saves
const P = (name, x) => ({ name, ...x });
const PRESETS = [
  P('Wand of Paralysis', { add: ['paralyzed'], save: 'CON', dc: 15, end: true, rounds: 10 }),
  P('Carrion Crawler Mucus (poison)', { add: ['poisoned', 'paralyzed'], save: 'CON', dc: 13, end: true, rounds: 10 }),
  P('Yellow Mold', { add: ['poisoned'], save: 'CON', dc: 15, end: true, rounds: 10, tick: { when: 'start', dice: '1d10', type: 'poison' } }),
  P('Burnt Othur Fumes (poison)', { add: ['afflicted'], save: 'CON', dc: 13, start: true, tick: { when: 'start', dice: '3d6', type: 'poison', onFail: true } }),
  P('Dust of Sneezing and Choking', { add: ['incapacitated'], save: 'CON', dc: 15, end: true }),
  P('Gem of Brightness', { add: ['blinded'], save: 'CON', dc: 15, end: true, rounds: 10 }),
  P('Mace of Terror', { add: ['frightened'], save: 'WIS', dc: 15, end: true, rounds: 10 }),
  P('Pipes of Haunting', { add: ['frightened'], save: 'WIS', dc: 15, end: true, rounds: 10 }),
  P('Figurine of Wondrous Power (Ivory Goats)', { add: ['frightened'], save: 'WIS', dc: 15, end: true, rounds: 10 }),
  P('Rod of Lordly Might: Paralyze', { add: ['paralyzed'], save: 'CON', dc: 17, end: true, rounds: 10 }),
  P('Rod of Lordly Might: Terrify', { add: ['frightened'], save: 'WIS', dc: 17, end: true, rounds: 10 }),
  P('Tentacle Rod', { add: ['restrained'], save: 'DEX', dc: 15, end: true, tick: { when: 'start', dice: '3d6', type: 'psychic' } }),
  P('Whelm', { add: ['stunned'], save: 'CON', dc: 20, end: true, rounds: 10 }),
  P('Cackle Fever (laughing fit)', { add: ['incapacitated'], save: 'CON', dc: 13, end: true }),
  P('Green Slime', { add: ['afflicted'], save: null, dc: 10, tick: { when: 'start', dice: '1d10', type: 'acid' }, manual: 'Scraping it off takes an action; then take the effect off' }),
  P('Vicious Vine', { add: ['grappled'], save: 'DEX', dc: 12, escape: 'grapple', tick: { when: 'start', dice: '1d10', type: 'necrotic' } }),
  P('Pale Tincture (poison)', { add: ['poisoned'], save: 'CON', dc: 16, manual: 'It repeats the save every 24 hours, taking 1d6 poison damage on a failure' })
];

const levelIn = (ch, cls) => { const m = new RegExp('\\b' + cls + '\\b[^/]*?(\\d+)\\s*(?:/|$)', 'i').exec(String(ch.classes || '')); return m ? +m[1] : 0; };
const hasSub = (ch, sub) => new RegExp(sub, 'i').test(String(ch.classes || '') + ' ' + (ch.subclasses || []).join(' '));
// the features this character has, from their class levels, subclass and feats
function featuresFor(ch) {
  return FEATURES.filter((f) => f.all || (f.feat ? (ch.feats || []).some((x) => new RegExp(f.feat, 'i').test(x)) : levelIn(ch, f.cls) >= f.lvl && (!f.sub || hasSub(ch, f.sub)))).map((f) => f.name);
}
// a DC for a character: 8 + proficiency + the ability's modifier (or the better of two), or the spell save DC
function dcFor(ch, dc) {
  if (typeof dc === 'number') return dc;
  if (dc === 'spell') return (ch.casting && ch.casting.dc) || 8 + (ch.prof || 2);
  const abls = String(dc).slice(2).split('|'), ix = { STR: 0, DEX: 1, CON: 2, INT: 3, WIS: 4, CHA: 5 };
  return 8 + (ch.prof || 2) + Math.max(...abls.map((a) => ((ch.abilities || [])[ix[a]] || {}).mod || 0));
}

// Weapon Mastery properties (2024 Player's Handbook)
const MASTERY = { club: 'Slow', dagger: 'Nick', greatclub: 'Push', handaxe: 'Vex', javelin: 'Slow', 'light hammer': 'Nick', mace: 'Sap', quarterstaff: 'Topple', sickle: 'Nick', spear: 'Sap',
  dart: 'Vex', 'light crossbow': 'Slow', shortbow: 'Vex', sling: 'Slow', battleaxe: 'Topple', flail: 'Sap', glaive: 'Graze', greataxe: 'Cleave', greatsword: 'Graze', halberd: 'Cleave', lance: 'Topple',
  longsword: 'Sap', maul: 'Topple', morningstar: 'Sap', pike: 'Push', rapier: 'Vex', scimitar: 'Nick', shortsword: 'Vex', trident: 'Topple', warhammer: 'Push', 'war pick': 'Sap', whip: 'Slow',
  blowgun: 'Vex', 'hand crossbow': 'Vex', 'heavy crossbow': 'Push', longbow: 'Slow', musket: 'Slow', pistol: 'Vex' };
const masteryOf = (name) => { const n = String(name || '').toLowerCase(); let best = ''; for (const k of Object.keys(MASTERY)) if (n.includes(k) && k.length > best.length) best = k; return best ? MASTERY[best] : ''; };

module.exports = { FEATURES, PRESETS, featuresFor, dcFor, MASTERY, masteryOf };
