// Builds public/monsters.json, the encounter builder's monsters, from the SRD 5.1 monster data
// in the 5e-database project (https://github.com/5e-bits/5e-database, src/2014/en/5e-SRD-Monsters.json).
//   node build/make-monsters.js path/to/5e-SRD-Monsters.json
// Each monster gets a token picture from the token library: its own if the library has one,
// one for its kind of monster otherwise.
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
if (!src) { console.error('Usage: node build/make-monsters.js path/to/5e-SRD-Monsters.json'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(src, 'utf8'));
const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'tokens.json'), 'utf8')).library;

const BY_TYPE = {
  aberration: ['interlaced-tentacles', '#6d28d9'], beast: ['wolf-head', '#78716c'], celestial: ['sun-priest', '#ca8a04'],
  construct: ['golem-head', '#57534e'], dragon: ['dragon-head', '#b91c1c'], elemental: ['whirlwind', '#0e7490'],
  fey: ['fairy', '#15803d'], fiend: ['daemon-skull', '#991b1b'], giant: ['giant', '#92400e'], humanoid: ['person', '#475569'],
  monstrosity: ['griffin-symbol', '#a16207'], ooze: ['slime', '#4d7c0f'], plant: ['tree-face', '#166534'], undead: ['skeleton', '#a8a29e'],
  swarm: ['bat', '#44403c']
};
const SIZE = { Tiny: 1, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4 };
const byName = new Map(tokens.map((t) => [t.name.toLowerCase(), t]));
// the library token whose name is the longest part of the monster's name ("Adult Red Dragon" → "Red Dragon")
function art(m) {
  const n = m.name.toLowerCase();
  if (byName.has(n)) return byName.get(n);
  const hits = tokens.filter((t) => n.includes(t.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length);
  return hits[0] || null;
}
const mod = (v) => Math.floor((v - 10) / 2);
const list = (xs) => (xs || []).map((x) => (typeof x === 'string' ? x : x.name)).join(', ');
// each action, trait or legendary action: its text, plus how often it can be used (Recharge 5–6, 3/Day, after a rest)
// and, for a Multiattack, the attacks it's made of
const entries = (xs) => (xs || []).map((x) => {
  const e = { n: x.name, d: x.desc }, u = x.usage;
  if (u && u.type === 'recharge on roll') e.recharge = u.min_value;
  else if (u && u.type === 'per day') e.perDay = u.times;
  else if (u && u.type === 'recharge after rest') e.rest = true;
  if (Array.isArray(x.actions) && x.actions.length) e.ma = x.actions.map((a) => ({ name: a.action_name, n: +a.count || 1 }));
  return e;
});

const out = data.map((m) => {
  const t = art(m), type = String(m.type || '').toLowerCase().startsWith('swarm') ? 'swarm' : String(m.type || '').toLowerCase();
  const [icon, color] = t ? [t.icon, t.color] : BY_TYPE[type] || ['person', '#475569'];
  const ac = (m.armor_class || [])[0] || {};
  const saves = (m.proficiencies || []).filter((p) => /^saving-throw/.test(p.proficiency.index)).map((p) => `${p.proficiency.name.replace('Saving Throw: ', '')} +${p.value}`);
  const skills = (m.proficiencies || []).filter((p) => /^skill/.test(p.proficiency.index)).map((p) => `${p.proficiency.name.replace('Skill: ', '')} +${p.value}`);
  const senses = Object.entries(m.senses || {}).map(([k, v]) => (k === 'passive_perception' ? `passive Perception ${v}` : `${k.replace(/_/g, ' ')} ${v}`)).join(', ');
  return {
    id: m.index, name: m.name, size: m.size, type: m.type + (m.subtype ? ` (${m.subtype})` : ''), align: m.alignment,
    ac: ac.value, acType: ac.type === 'natural' ? 'natural armor' : ac.type === 'armor' && ac.armor ? ac.armor.map((x) => x.name.toLowerCase()).join(', ') : undefined,
    hp: m.hit_points, hd: m.hit_points_roll || m.hit_dice,
    speed: Object.entries(m.speed || {}).map(([k, v]) => (k === 'walk' ? v : `${k} ${v}`)).join(', '),
    abl: [m.strength, m.dexterity, m.constitution, m.intelligence, m.wisdom, m.charisma],
    saves: saves.join(', ') || undefined, skills: skills.join(', ') || undefined,
    vuln: list(m.damage_vulnerabilities) || undefined, resist: list(m.damage_resistances) || undefined,
    immune: list(m.damage_immunities) || undefined, cimmune: list(m.condition_immunities) || undefined,
    senses, lang: m.languages || '—', cr: m.challenge_rating, xp: m.xp, pb: m.proficiency_bonus,
    traits: entries(m.special_abilities), actions: entries(m.actions), legendary: entries(m.legendary_actions), reactions: entries(m.reactions),
    token: { icon, color, size: SIZE[m.size] || 1, init: mod(m.dexterity) }
  };
});
const credit = 'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/legalcode). Data prepared by the 5e-database project (MIT).';
fs.writeFileSync(path.join(__dirname, '..', 'public', 'monsters.json'), JSON.stringify({ credit, monsters: out }));
console.log(`${out.length} monsters, ${out.filter((m) => byName.has(m.name.toLowerCase()) || tokens.some((t) => m.name.toLowerCase().includes(t.name.toLowerCase()))).length} with their own token art`);
