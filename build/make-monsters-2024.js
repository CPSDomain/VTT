// Adds the 2024 monsters (the SRD 5.2 stat blocks) to public/monsters.json, next to the SRD 5.1 ones.
// Source: the 5etools data for the 2025 Monster Manual (bestiary-xmm.json); only the entries marked as in the SRD 5.2
// (CC BY 4.0) are used. Run after make-monsters.js:
//   node build/make-monsters-2024.js path/to/bestiary-xmm.json
// Each one gets the id "<name>-2024" and ed: 2024; the 2014 ones keep their ids (saved maps still find them).
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
if (!src) { console.error('Usage: node build/make-monsters-2024.js path/to/bestiary-xmm.json'); process.exit(1); }
const all = JSON.parse(fs.readFileSync(src, 'utf8')).monster.filter((m) => m.srd52);
const file = path.join(__dirname, '..', 'public', 'monsters.json');
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
const old = db.monsters.filter((m) => m.ed !== 2024).map((m) => ({ ...m, ed: 2014 }));
const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'tokens.json'), 'utf8')).library;

const BY_TYPE = {
  aberration: ['interlaced-tentacles', '#6d28d9'], beast: ['wolf-head', '#78716c'], celestial: ['sun-priest', '#ca8a04'],
  construct: ['golem-head', '#57534e'], dragon: ['dragon-head', '#b91c1c'], elemental: ['whirlwind', '#0e7490'],
  fey: ['fairy', '#15803d'], fiend: ['daemon-skull', '#991b1b'], giant: ['giant', '#92400e'], humanoid: ['person', '#475569'],
  monstrosity: ['griffin-symbol', '#a16207'], ooze: ['slime', '#4d7c0f'], plant: ['tree-face', '#166534'], undead: ['skeleton', '#a8a29e'],
  swarm: ['bat', '#44403c']
};
const SIZES = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan' };
const SQ = { Tiny: 1, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4 };
const ALIGN = { L: 'lawful', N: 'neutral', C: 'chaotic', G: 'good', E: 'evil', U: 'unaligned', A: 'any alignment' };
const ABL = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const XP = { 0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000, 28: 120000, 29: 135000, 30: 155000 };
const byName = new Map(tokens.map((t) => [t.name.toLowerCase(), t]));
const art = (name) => { const n = name.toLowerCase(); if (byName.has(n)) return byName.get(n); return tokens.filter((t) => n.includes(t.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0] || null; };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// 5etools markup to the words of the stat block
function text(s) {
  s = String(s);
  for (let i = 0; i < 6 && /\{@/.test(s); i++) s = s.replace(/\{@(\w+)\s*([^{}]*)\}/g, (_, tag, body) => {
    const p = body.split('|');
    switch (tag) {
      case 'atkr': return { m: 'Melee Attack Roll:', r: 'Ranged Attack Roll:', 'm,r': 'Melee or Ranged Attack Roll:', 'r,m': 'Melee or Ranged Attack Roll:' }[p[0].trim()] || 'Attack Roll:';
      case 'hit': return (+p[0] >= 0 ? '+' : '') + p[0];
      case 'h': return 'Hit: ';
      case 'm': return 'Miss: ';
      case 'hom': return 'Hit or Miss: ';
      case 'dc': return 'DC ' + p[0];
      case 'actSave': return (ABL[p[0].trim()] || cap(p[0])) + ' Saving Throw:';
      case 'actSaveFail': return p[0] ? `Failure by ${p[0]} or More:` : 'Failure:';
      case 'actSaveFailBy': return `Failure by ${p[0]} or More:`;
      case 'actSaveSuccess': return 'Success:';
      case 'actSaveSuccessOrFail': return 'Failure or Success:';
      case 'actTrigger': return 'Trigger:';
      case 'actResponse': return 'Response:';
      case 'recharge': return p[0] ? `(Recharge ${p[0]}–6)` : '(Recharge 6)';
      case 'damage': case 'dice': return p[0];
      case 'chance': return p[0] + ' percent';
      default: return (p.length >= 3 && p[2]) || p[0];
    }
  });
  return s.replace(/\s+/g, ' ').trim();
}
const flat = (entries) => (entries || []).map((e) => (typeof e === 'string' ? text(e)
  : e.type === 'list' ? (e.items || []).map((x) => (typeof x === 'string' ? '• ' + text(x) : `• ${x.name ? text(x.name) + '. ' : ''}${flat(x.entries || [x.entry]).join(' ')}`)).join('\n')
  : e.entries ? `${e.name ? text(e.name) + '. ' : ''}${flat(e.entries).join(' ')}` : '')).filter(Boolean);
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
// "makes two Tentacle attacks", "one Bite attack and two Claw attacks", "three attacks, using Scimitar or Shortbow in any combination"
function multi(d, names) {
  const out = [];
  for (const m of d.matchAll(/\b(one|two|three|four|five|six)\s+([A-Z][\w' -]*?)(?:\s+or\s+[A-Z][\w' -]*?)?\s+attacks?\b/g)) {
    const nm = names.find((n) => n.toLowerCase() === m[2].toLowerCase()); if (nm) out.push({ name: nm, n: NUM[m[1]] });
  }
  if (!out.length) { const m = /makes (one|two|three|four|five|six) attacks, using ([A-Z][\w' -]*?)(?: or | and |,| in )/.exec(d); const nm = m && names.find((n) => n.toLowerCase() === m[2].toLowerCase()); if (nm) out.push({ name: nm, n: NUM[m[1]] }); }
  return out.length ? out : undefined;
}
// one action, trait or reaction
function entry(x) {
  const n = text(x.name), e = { n, d: flat(x.entries).join('\n') };
  let r;
  if ((r = /\(Recharge (\d)/.exec(n))) e.recharge = +r[1];
  if ((r = /\((\d+)\/Day/i.exec(n))) e.perDay = +r[1];
  if (/Recharges after a (?:Short or )?Long Rest/i.test(n)) e.rest = true;
  return e;
}
// a Spellcasting block: its header, then "At will: …", "2/Day each: …" lines the app reads into buttons
function spells(s) {
  const lines = [flat(s.headerEntries).join(' ')], names = (xs) => xs.map((x) => text(x).replace(/\s*\((?!level \d version)[^)]*\)/gi, '')).join(', '); // notes like "(Beast or Humanoid form only, …)" would break the list
  if (s.will) lines.push('At will: ' + names(s.will));
  for (const [k, xs] of Object.entries(s.daily || {})) lines.push(`${k.replace('e', '')}/Day${/e$/.test(k) ? ' each' : ''}: ${names(xs)}`);
  for (const [lv, o] of Object.entries(s.spells || {})) lines.push(`${lv === '0' ? 'Cantrips (at will)' : `Level ${lv} (${o.slots} slots)`}: ${names(o.spells)}`);
  const e = { n: text(s.name), d: lines.join('\n'), cast: true }; let r;
  if ((r = /\((\d+)\/Day/i.exec(e.n))) e.perDay = +r[1];
  return e;
}
const listOf = (xs, key) => (xs || []).map((x) => (typeof x === 'string' ? text(x) : x.special ? text(x.special) : `${(x[key] || []).map((y) => (typeof y === 'string' ? y : '')).filter(Boolean).join(', ')}${x.note ? ' ' + text(x.note) : ''}`)).filter(Boolean);
const crOf = (c) => { const s = typeof c === 'object' ? c.cr : c; return s.includes('/') ? s.split('/').reduce((a, b) => a / b) : +s; };
const pbOf = (cr) => (cr < 5 ? 2 : cr < 9 ? 3 : cr < 13 ? 4 : cr < 17 ? 5 : cr < 21 ? 6 : cr < 25 ? 7 : cr < 29 ? 8 : 9);

const added = all.map((m) => {
  const size = m.size.map((z) => SIZES[z]).join(' or ') || 'Medium', sq = SQ[SIZES[m.size[m.size.length - 1]]] || 1, tp = typeof m.type === 'object' ? m.type : { type: m.type };
  const tName = typeof tp.type === 'object' ? (tp.type.choose || []).join(' or ') : tp.type;
  const type = (tp.swarmSize ? `swarm of ${SIZES[tp.swarmSize]} ${tName}s` : tName) + ((tp.tags || []).length ? ` (${tp.tags.map((t) => (typeof t === 'string' ? t : t.tag)).join(', ')})` : '');
  const t = art(m.name), key = /^swarm/.test(type) ? 'swarm' : String(tName).split(' ')[0];
  const [icon, color] = t ? [t.icon, t.color] : BY_TYPE[key] || ['person', '#475569'];
  const cr = crOf(m.cr), pb = pbOf(cr), mod = (v) => Math.floor((v - 10) / 2);
  const ac0 = m.ac[0], ac = typeof ac0 === 'number' ? ac0 : ac0.ac, acType = typeof ac0 === 'object' && ac0.from ? ac0.from.map(text).join(', ') : undefined;
  const sp = m.speed || {}, speed = Object.entries(sp).filter(([k]) => k !== 'canHover').map(([k, v]) => { const n = typeof v === 'object' ? `${v.number} ft.${v.condition ? ' ' + text(v.condition) : ''}` : `${v} ft.`; return k === 'walk' ? n : `${k} ${n}`; }).join(', ') + (sp.canHover ? ' (hover)' : '');
  const init = mod(m.dex) + (m.initiative && m.initiative.proficiency ? m.initiative.proficiency * pb : 0);
  const sc = m.spellcasting || [], at = (where) => sc.filter((s) => (s.displayAs || 'trait') === where).map(spells);
  const actions = [...(m.action || []).map(entry), ...at('action')];
  const names = actions.map((a) => a.n.replace(/\s*\(.*?\)\s*$/, ''));
  for (const a of actions) if (/^Multiattack/.test(a.n)) { const ma = multi(a.d, names); if (ma) a.ma = ma; }
  const legN = m.legendaryActions || (m.legendary ? 3 : 0);
  return {
    id: slug(m.name) + '-2024', ed: 2024, name: m.name, size, type, align: (m.alignment || []).map((a) => (typeof a === 'string' ? ALIGN[a] : '')).join(' ') || 'unaligned',
    ac, acType, hp: m.hp.average || 1, hd: (m.hp.formula || String(m.hp.average)).replace(/\s/g, ''), speed,
    abl: [m.str, m.dex, m.con, m.int, m.wis, m.cha],
    saves: Object.entries(m.save || {}).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(', ') || undefined,
    skills: Object.entries(m.skill || {}).map(([k, v]) => `${k.replace(/\b\w/g, (c) => c.toUpperCase())} ${v}`).join(', ') || undefined,
    vuln: listOf(m.vulnerable, 'vulnerable').join('; ') || undefined, resist: listOf(m.resist, 'resist').join('; ') || undefined,
    immune: listOf(m.immune, 'immune').join('; ') || undefined, cimmune: listOf(m.conditionImmune, 'conditionImmune').join(', ') || undefined,
    senses: [...(m.senses || []).map((s) => text(s).toLowerCase()), `passive Perception ${m.passive}`].join(', '),
    lang: (m.languages || []).map(text).join(', ') || '—', cr, xp: XP[cr] || 0, pb, init,
    traits: [...(m.trait || []).map(entry), ...at('trait')], actions, bonus: [...(m.bonus || []).map(entry), ...at('bonus')],
    legendary: (m.legendary || []).map(entry), legN, reactions: [...(m.reaction || []).map(entry), ...at('reaction')],
    token: { icon, color, size: sq, init }
  };
});
db.credit = 'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") and the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 and SRD 5.2 are licensed under the Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/legalcode). SRD 5.1 data prepared by the 5e-database project (MIT).';
db.monsters = [...old, ...added];
fs.writeFileSync(file, JSON.stringify(db));
console.log(`${old.length} SRD 5.1 monsters, ${added.length} SRD 5.2 (2024) monsters, ${added.filter((m) => art(m.name)).length} with their own token art`);
