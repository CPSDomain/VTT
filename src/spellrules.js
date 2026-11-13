// What a spell does beyond its dice: conditions it puts on its targets, and spells split into darts, rays or beams.
// Worked out from the spell's name and description, so it also fills in characters brought in before 1.14.

// name → [conditions, saving throw ability (null: no save, it just lands), who it's for, how it ends on a target]
// How it ends, from the 2024 Player's Handbook:
//   end        the target repeats the save at the end of each of its turns (Hold Person, Slow, Blindness/Deafness…)
//   end+hurtAdv  that, and again with Advantage whenever it takes damage (Hideous Laughter)
//   hurt       it repeats the save whenever it takes damage (Dominate Person)
//   damage     it ends when the target takes damage (Charm Person, Hypnotic Pattern)
//   sleep      incapacitated until the end of its next turn, then a second save or unconscious; damage ends it
//   escape     the target can use its action for a Strength (Athletics) check against the DC (Web, Entangle)
//   fear       it repeats the save only if it ends its turn out of sight of the caster (the DM decides)
// Prone stays when a spell ends: standing up is up to the creature.
const CONDS = {
  'bless': [['blessed'], null, 'ally'],
  'shield of faith': [['shielded'], null, 'ally'],
  'haste': [['hasted'], null, 'ally'],
  'invisibility': [['invisible'], null, 'ally'],
  'greater invisibility': [['invisible'], null, 'ally'],
  "hunter's mark": [['marked'], null, 'enemy'],
  'hex': [['hexed'], null, 'enemy'],
  'bane': [['baned'], 'CHA', 'enemy'],
  'faerie fire': [['outlined'], 'DEX', 'enemy'],
  'hold person': [['paralyzed'], 'WIS', 'enemy', 'end'],
  'hold monster': [['paralyzed'], 'WIS', 'enemy', 'end'],
  'slow': [['slowed'], 'WIS', 'enemy', 'end'],
  'blindness/deafness': [['blinded'], 'CON', 'enemy', 'end'],
  'cause fear': [['frightened'], 'WIS', 'enemy', 'end'],
  'fear': [['frightened'], 'WIS', 'enemy', 'fear'],
  'charm person': [['charmed'], 'WIS', 'enemy', 'damage'],
  'charm monster': [['charmed'], 'WIS', 'enemy', 'damage'],
  'dominate person': [['charmed'], 'WIS', 'enemy', 'hurt'],
  'dominate beast': [['charmed'], 'WIS', 'enemy', 'hurt'],
  'dominate monster': [['charmed'], 'WIS', 'enemy', 'hurt'],
  'hypnotic pattern': [['charmed', 'incapacitated'], 'WIS', 'enemy', 'damage'],
  'entangle': [['restrained'], 'STR', 'enemy', 'escape'],
  'ensnaring strike': [['restrained'], 'STR', 'enemy', 'escape'],
  'web': [['restrained'], 'DEX', 'enemy', 'escape'],
  "tasha's hideous laughter": [['prone', 'incapacitated'], 'WIS', 'enemy', 'end+hurtAdv'],
  'hideous laughter': [['prone', 'incapacitated'], 'WIS', 'enemy', 'end+hurtAdv'],
  'sleep': [['incapacitated'], 'WIS', 'enemy', 'sleep'], // then unconscious if it fails again
  'banishment': [['banished'], 'CHA', 'enemy'],
  'grease': [['prone'], 'DEX', 'enemy'],
  'command': [['prone'], 'WIS', 'enemy'],
  'ray of sickness': [['poisoned'], 'CON', 'enemy'],
  'contagion': [['poisoned'], 'CON', 'enemy'],
  'stinking cloud': [['poisoned'], 'CON', 'enemy'],
  'flesh to stone': [['restrained'], 'CON', 'enemy'],
  'earth tremor': [['prone'], 'DEX', 'enemy'],
  'sleet storm': [['prone'], 'DEX', 'enemy'],
  'blinding smite': [['blinded'], 'CON', 'enemy', 'end'],
  'color spray': [['blinded'], 'CON', 'enemy'],
  'compelled duel': [['marked'], 'WIS', 'enemy']
};

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (w) => WORDS[String(w).toLowerCase()] || +w || 0;
const plain = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

function enrich(sp, level) {
  if (!sp || !sp.name) return sp;
  const key = sp.name.toLowerCase().replace(/[’]/g, "'"), c = CONDS[key], d = plain(sp.desc);
  if (c) {
    let save = c[1];
    const s = sp.save && /\b(STR|DEX|CON|INT|WIS|CHA)\b/.exec(sp.save); if (save && s) save = s[1];
    sp.cond = { add: c[0], save, ally: c[2] === 'ally', ends: c[3] || '' };
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
function enrichCharacter(ch) { if (ch && Array.isArray(ch.spells)) { const lv = levelOf(ch); ch.spells.forEach((sp) => enrich(sp, lv)); } return ch; }

module.exports = { enrich, enrichCharacter, levelOf, CONDS };
