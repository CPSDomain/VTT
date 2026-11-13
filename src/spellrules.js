// What a spell does beyond its dice, by the 2024 Player's Handbook: the conditions it puts on its targets, how each
// target gets out of it again, and spells split into darts, rays or beams. Worked out from the spell's name (and its
// description for darts and rays), so it also fills in characters brought in from D&D Beyond before these rules existed.
//
// A rule says:
//   add      the conditions it puts on (on a failed save, or straight away when save is null)
//   save     the saving throw against it (null: no save, it just lands)
//   ally     it's for friends (Bless); otherwise for foes
//   end      the target repeats the save at the end of each of its turns, ending it on a success
//   start    …at the start of each of its turns instead
//   hurt     'end': taking damage ends it · 'save': taking damage gives a new save · 'adv': a new save with Advantage
//   escape   'athletics': its action, a Strength (Athletics) check against the DC · 'grapple': Athletics or Acrobatics
//            against the escape DC · 'save': its action to repeat the save (Irresistible Dance)
//   expire   timed: 'tgtEnd' end of its next turn · 'srcEnd' end of the caster's next turn · 'srcStart' start of it
//   tick     damage on its turns: { when: 'start'|'end', dice, type, onFail: only when it fails that turn's save }
//   count    three successes end it, three failures make it last ('stay') or turn it to stone ('petrified')
//   sleep    Sleep: incapacitated, a second save at the end of its next turn, then unconscious
//   manual   the save only happens in a situation the DM judges (Fear: out of sight of you): a reminder and a button
//   options  pick one when casting (Eyebite: Asleep, Panicked or Sickened)
//   again    the spell keeps doing it while you concentrate (Sunbeam's new line, Bigby's Hand, a creature entering the area)
//   afterEnd what happens when the spell ends (Haste: incapacitated until the end of its next turn)
//   onSave   what a successful first save still does (Irresistible Dance: dancing until the end of its next turn)
// Prone stays when a spell ends: standing up is the creature's own doing. Unconscious ending leaves it prone (2024 rules).

const R = (add, save, x = {}) => ({ add, save, ...x });
const FOE_CHARM_HURT = (save = 'WIS', x = {}) => R(['charmed'], save, { hurt: 'end', ...x });
const RULES = {
  // ---- saves at the end of each of its turns
  'hold person': R(['paralyzed'], 'WIS', { end: true }),
  'hold monster': R(['paralyzed'], 'WIS', { end: true }),
  'slow': R(['slowed'], 'WIS', { end: true }),
  'blindness/deafness': R(['blinded'], 'CON', { end: true, options: [{ name: 'Blinded', add: ['blinded'] }, { name: 'Deafened', add: ['deafened'] }] }),
  'blinding smite': R(['blinded'], 'CON', { end: true }),
  'wrathful smite': R(['frightened'], 'WIS', { end: true }),
  'cause fear': R(['frightened'], 'WIS', { end: true }),
  'crown of madness': R(['charmed'], 'WIS', { end: true }),
  'confusion': R(['confused'], 'WIS', { end: true }),
  'ray of enfeeblement': R(['enfeebled'], 'CON', { end: true }),
  'synaptic static': R(['muddled'], 'INT', { end: true }),
  'sunburst': R(['blinded'], 'CON', { end: true }),
  'power word stun': R(['stunned'], null, { end: true, endSave: 'CON', hpCap: 150 }),
  'phantasmal killer': R(['haunted'], 'WIS', { end: true, tick: { when: 'end', dice: '4d10', type: 'psychic', onFail: true } }),
  'weird': R(['frightened'], 'WIS', { end: true, tick: { when: 'end', dice: '5d10', type: 'psychic', onFail: true } }),
  "tasha's hideous laughter": R(['prone', 'incapacitated'], 'WIS', { end: true, hurt: 'adv' }),
  'hideous laughter': R(['prone', 'incapacitated'], 'WIS', { end: true, hurt: 'adv' }),
  'contagion': R(['poisoned'], 'CON', { end: true, count: 'stay' }),
  'flesh to stone': R(['restrained'], 'CON', { end: true, count: 'petrified' }),
  // ---- saves at the start of each of its turns
  'searing smite': R(['burning'], null, { start: true, endSave: 'CON', tick: { when: 'start', dice: '1d6', type: 'fire' } }),
  'conjure elemental': R(['restrained'], 'DEX', { start: true, tick: { when: 'start', dice: '4d8', type: '', onFail: true }, again: true }),
  // ---- taking damage
  'dominate person': R(['charmed'], 'WIS', { hurt: 'save' }),
  'dominate beast': R(['charmed'], 'WIS', { hurt: 'save' }),
  'dominate monster': R(['charmed'], 'WIS', { hurt: 'save' }),
  'charm person': FOE_CHARM_HURT(),
  'charm monster': FOE_CHARM_HURT(),
  'animal friendship': FOE_CHARM_HURT(),
  'friends': FOE_CHARM_HURT(),
  'suggestion': FOE_CHARM_HURT(),
  'mass suggestion': FOE_CHARM_HURT(),
  'awaken': R(['charmed'], null, { ally: true, hurt: 'end' }),
  'hypnotic pattern': R(['charmed', 'incapacitated'], 'WIS', { hurt: 'end' }),
  'modify memory': R(['charmed', 'incapacitated'], 'WIS', { hurt: 'end' }),
  'sleep': R(['incapacitated'], 'WIS', { sleep: true, hurt: 'end' }),
  'eyebite': R(['unconscious'], 'WIS', { again: true, options: [{ name: 'Asleep', add: ['unconscious'], hurt: 'end' }, { name: 'Panicked', add: ['frightened'] }, { name: 'Sickened', add: ['poisoned'] }] }),
  // ---- breaking free with an action
  'web': R(['restrained'], 'DEX', { escape: 'athletics', again: true }),
  'entangle': R(['restrained'], 'STR', { escape: 'athletics' }),
  'ensnaring strike': R(['restrained'], 'STR', { escape: 'athletics', tick: { when: 'start', dice: '1d6', type: 'piercing' } }),
  "evard's black tentacles": R(['restrained'], 'STR', { escape: 'athletics', again: true }),
  'black tentacles': R(['restrained'], 'STR', { escape: 'athletics', again: true }),
  "bigby's hand": R(['grappled'], 'DEX', { escape: 'grapple', again: true }),
  'grasping vine': R(['grappled'], null, { escape: 'grapple', again: true }),
  "otto's irresistible dance": R(['charmed'], 'WIS', { escape: 'save', onSave: { add: ['dancing'], expire: 'tgtEnd' } }),
  'irresistible dance': R(['charmed'], 'WIS', { escape: 'save', onSave: { add: ['dancing'], expire: 'tgtEnd' } }),
  // ---- the DM judges when the save comes
  'fear': R(['frightened'], 'WIS', { manual: 'If it ended its turn out of sight of the caster, it repeats the save' }),
  'compulsion': R(['charmed'], 'WIS', { manual: 'After it moves in the chosen direction, it repeats the save' }),
  'befuddlement': R(['befuddled'], 'INT', { manual: 'It repeats the save at the end of every 30 days' }),
  // ---- for a set time
  'color spray': R(['blinded'], 'CON', { expire: 'srcEnd' }),
  'staggering smite': R(['stunned'], 'WIS', { expire: 'srcEnd' }),
  'ray of sickness': R(['poisoned'], null, { expire: 'srcEnd' }),
  'telekinesis': R(['restrained'], 'STR', { expire: 'srcEnd', again: true }),
  'sunbeam': R(['blinded'], 'CON', { expire: 'srcStart', again: true }),
  'conjure fey': R(['frightened'], null, { expire: 'srcStart', again: true }),
  'fount of moonlight': R(['blinded'], 'CON', { expire: 'srcEnd', again: true, reaction: true }),
  'holy aura': R(['holyaura'], null, { ally: true, again: true }),
  'stinking cloud': R(['poisoned'], 'CON', { expire: 'tgtEnd', again: true }),
  'command': R(['commanded'], 'WIS', { expire: 'tgtEnd', options: [{ name: 'Approach' }, { name: 'Drop' }, { name: 'Flee' }, { name: 'Grovel', add: ['commanded', 'prone'] }, { name: 'Halt' }] }),
  // ---- until the spell ends (concentration, or its duration)
  'bless': R(['blessed'], null, { ally: true }),
  'bane': R(['baned'], 'CHA'),
  'faerie fire': R(['outlined'], 'DEX'),
  'shield of faith': R(['shielded'], null, { ally: true }),
  'haste': R(['hasted'], null, { ally: true, afterEnd: { add: ['incapacitated'], expire: 'tgtEnd' } }),
  'heroism': R(['heroism'], null, { ally: true, removes: ['frightened'], tempTick: true }),
  'invisibility': R(['invisible'], null, { ally: true }),
  'greater invisibility': R(['invisible'], null, { ally: true }),
  'mislead': R(['invisible'], null, { ally: true }),
  "hunter's mark": R(['marked'], null),
  'hex': R(['hexed'], null),
  'bestow curse': R(['cursed'], 'WIS'),
  'banishment': R(['banished', 'incapacitated'], 'CHA'),
  'banishing smite': R(['banished', 'incapacitated'], 'CHA'),
  'geas': R(['charmed'], 'WIS'),
  'faerie fire ': R(['outlined'], 'DEX'),
  'compelled duel': R(['marked'], 'WIS'),
  'hunger of hadar': R(['blinded'], null, { again: true }),
  "jallarzi's storm of radiance": R(['blinded', 'deafened'], null, { again: true }),
  'silence': R(['deafened'], null, { again: true }),
  'storm of vengeance': R(['deafened'], 'CON'),
  'feign death': R(['blinded', 'incapacitated'], null, { ally: true }),
  'astral projection': R(['unconscious'], null, { ally: true }),
  'antipathy/sympathy': R(['frightened'], 'WIS', { options: [{ name: 'Antipathy', add: ['frightened'] }, { name: 'Sympathy', add: ['charmed'] }] }),
  'imprisonment': R(['restrained'], 'WIS', { options: [{ name: 'Chaining', add: ['restrained'] }, { name: 'Slumber', add: ['unconscious'] }, { name: 'Burial', add: ['restrained'] }, { name: 'Hedged Prison', add: ['banished'] }, { name: 'Minimus Containment', add: ['restrained'] }] }),
  'symbol': R(['frightened'], 'WIS', { options: [{ name: 'Fear', add: ['frightened'] }, { name: 'Pain', add: ['incapacitated'], save: 'CON' }, { name: 'Sleep', add: ['unconscious'], hurt: 'end' }, { name: 'Stunning', add: ['stunned'] }, { name: 'Discord', add: ['confused'] }] }),
  'divine word': R([], 'CHA', { divine: true }),
  // Prismatic Spray and Wall: pick the colour that hit (the damage colours are rolled from the spell's own dice)
  'prismatic spray': R([], 'DEX', { options: [{ name: 'Red, Orange, Yellow, Green or Blue (damage only)', add: [] }, { name: 'Indigo', add: ['restrained'], end: true, endSave: 'CON', count: 'petrified' }, { name: 'Violet', add: ['blinded'], manual: 'At the start of your next turn it makes a Wisdom save: a success ends it, a failure sends it to another plane' }] }),
  'prismatic wall': R(['blinded'], 'CON', { rounds: 10, options: [{ name: 'Blinded by the wall (1 minute)', add: ['blinded'], save: 'CON' }, { name: 'Indigo layer', add: ['restrained'], save: 'DEX', end: true, endSave: 'CON', count: 'petrified' }, { name: 'Violet layer', add: ['blinded'], save: 'DEX', manual: 'At the start of your next turn it makes a Wisdom save: a success ends it, a failure sends it to another plane' }, { name: 'Another layer (damage only)', add: [], save: 'DEX' }] }),
  'sequester': R(['invisible', 'unconscious'], null, { ally: true }),
  'wind walk': R(['stunned'], null, { ally: true, rounds: 10 }),
  'meld into stone': R([], null, { ally: true }),
  // ---- knocked down (prone stays; no save to end it)
  'grease': R(['prone'], 'DEX', { again: true }),
  'thunderous smite': R(['prone'], 'STR'),
  'destructive wave': R(['prone'], 'CON'),
  "yolande's regal presence": R(['prone'], 'WIS', { again: true }),
  'earth tremor': R(['prone'], 'DEX'),
  'sleet storm': R(['prone'], 'DEX', { again: true, breakConc: true }),
  'earthquake': R(['prone'], 'DEX', { again: true, breakConc: true })
};
delete RULES['faerie fire '];
// a 1.14/1.15 name for the same table, so older code keeps working
const CONDS = RULES;

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (w) => WORDS[String(w).toLowerCase()] || +w || 0;
const plain = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
// how long a spell lasts, in rounds (6 seconds each), from D&D Beyond's "Concentration, up to 1 minute"
function roundsOf(duration) {
  const m = /(\d+)\s*(round|minute|hour|day)/i.exec(String(duration || '')); if (!m) return 0;
  return +m[1] * ({ round: 1, minute: 10, hour: 600, day: 14400 })[m[2].toLowerCase()];
}

function enrich(sp, level) {
  if (!sp || !sp.name) return sp;
  const key = sp.name.toLowerCase().replace(/[’]/g, "'"), c = RULES[key], d = plain(sp.desc);
  delete sp.cond;
  if (c) {
    let save = c.save;
    const s = sp.save && /\b(STR|DEX|CON|INT|WIS|CHA)\b/.exec(sp.save); if (save && s && !c.options) save = s[1];
    sp.cond = { ...JSON.parse(JSON.stringify(c)), save, ally: !!c.ally, rounds: roundsOf(sp.duration) };
  }
  // darts, rays or beams: each one picks its own target
  let m = /creates? (\w+) (?:glowing )?(dart|ray|beam)s?/i.exec(d) || /\b(two|three|four|five|six) (?:[a-z]+ )?(dart|ray|beam)s\b/i.exec(d);
  let n = m ? num(m[1]) : 0, word = m ? m[2].toLowerCase() : '';
  if (/^eldritch blast$/i.test(sp.name)) { word = 'beam'; n = 1; }
  if (word === 'beam' && (/two beams at level 5/i.test(d) || /^eldritch blast$/i.test(sp.name))) n = level >= 17 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1;
  if (n > 1 || (word === 'beam' && n >= 1 && /^eldritch blast$/i.test(sp.name))) {
    const each = new RegExp(word + '[^.]*?(\\d+d\\d+(?: ?\\+ ?\\d+)?) (\\w+) damage', 'i').exec(d) || /(?:hit|target)[^.]*?takes? (\d+d\d+(?: ?\+ ?\d+)?) (\w+) damage/i.exec(d);
    let dice = each ? each[1].replace(/\s/g, '') : '';
    if (!dice && sp.dice) { // the whole spell's dice split evenly: 3d4+3 → 1d4+1
      const t = /^(\d+)d(\d+)(?:\+(\d+))?$/.exec(sp.dice);
      if (t && +t[1] % n === 0 && (+(t[3] || 0)) % n === 0) dice = `${t[1] / n}d${t[2]}${t[3] ? '+' + t[3] / n : ''}`;
    }
    const more = new RegExp('(one|two|three) (?:additional|more) ' + word + 's? for each (?:spell )?slot level above', 'i').exec(d);
    if (dice) sp.multi = { n, word, dice, type: (each && each[2].toLowerCase()) || sp.type || '', up: more ? num(more[1]) : 0 };
  }
  return sp;
}
// a character's total level, from what D&D Beyond gave us ("Cleric (Life Domain) 5 / Wizard 2" → 7)
const levelOf = (ch) => ch.level || (String(ch.classes || '').match(/\d+(?=\s*(?:\/|$))/g) || []).reduce((a, b) => a + +b, 0) || 1;
const classLevel = (ch, name) => { const m = new RegExp('\\b' + name + '\\b[^/]*?(\\d+)\\s*(?:/|$)', 'i').exec(String(ch.classes || '')); return m ? +m[1] : 0; };
function enrichCharacter(ch) {
  if (!ch) return ch;
  if (Array.isArray(ch.spells)) { const lv = levelOf(ch); ch.spells.forEach((sp) => enrich(sp, lv)); }
  // a paladin's Aura of Protection: allies nearby add the paladin's Charisma modifier to their saves (level 6; 30 ft at 18)
  const pl = classLevel(ch, 'Paladin'), cha = ((ch.abilities || [])[5] || {}).mod || 0;
  ch.aura = pl >= 6 ? { bonus: Math.max(1, cha), feet: pl >= 18 ? 30 : 10, courage: pl >= 10 } : null;
  // Evasion (Rogue 7, Monk 7): a Dexterity save for half damage takes none on a success and half on a failure
  ch.evasion = classLevel(ch, 'Rogue') >= 7 || classLevel(ch, 'Monk') >= 7;
  const FE = require('./features');
  ch.features = FE.featuresFor(ch);
  ch.featureInfo = ch.features.map((n) => { const f = FE.FEATURES.find((x) => x.name === n); return { name: n, options: (f.options || []).map((o) => o.name), note: f.note || '', cost: f.cost || '', save: f.save || '', dc: FE.dcFor(ch, f.dc) }; });
  return ch;
}

module.exports = { enrich, enrichCharacter, levelOf, classLevel, roundsOf, RULES, CONDS };
