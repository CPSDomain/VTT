// Reads a character from D&D Beyond: name, portrait, hit points, AC, speed, initiative, darkvision, ability scores,
// saving throws, skills and attacks. D&D Beyond has no official way for other apps to do this; like other tools,
// this reads the same character data its own character sheet uses, so the character must be public
// (Character Settings → Character Privacy → Public). If D&D Beyond changes that data, this may need updating.

const STATS = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const SHORT = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const SKILLS = [ // name, ability index
  ['Acrobatics', 1], ['Animal Handling', 4], ['Arcana', 3], ['Athletics', 0], ['Deception', 5], ['History', 3], ['Insight', 4], ['Intimidation', 5], ['Investigation', 3],
  ['Medicine', 4], ['Nature', 3], ['Perception', 4], ['Performance', 5], ['Persuasion', 5], ['Religion', 3], ['Sleight of Hand', 1], ['Stealth', 1], ['Survival', 4]
];
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const mod = (score) => Math.floor((score - 10) / 2);
const sign = (n) => (n >= 0 ? '+' + n : String(n));

// the character's number from any D&D Beyond link: dndbeyond.com/characters/123, …/profile/x/characters/123, ddb.ac/characters/123/AbC
function characterId(link) {
  const s = String(link || '').trim();
  const m = /(?:dndbeyond\.com|ddb\.ac)\/(?:[^\s]*\/)?characters\/(\d{4,12})/i.exec(s) || /^(\d{4,12})$/.exec(s);
  return m ? m[1] : null;
}

async function fetchJson(url) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json', 'User-Agent': 'Tabletop-VTT' } });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json: j };
  } finally { clearTimeout(timer); }
}

async function fetchCharacter(link) {
  const id = characterId(link);
  if (!id) throw new Error('That isn\'t a D&D Beyond character link. Open your character on D&D Beyond, click Share, and copy the link.');
  let res;
  const api = process.env.TABLETOP_DDB_API || 'https://character-service.dndbeyond.com/character/v5/character/'; // tests point this elsewhere
  try { res = await fetchJson(`${api}${id}?includeCustomItems=true`); }
  catch (e) { throw new Error('Couldn\'t reach D&D Beyond from the DM\'s PC (' + (e.name === 'AbortError' ? 'it took too long' : e.message) + '). Is it online?'); }
  const data = res.json && (res.json.data || (res.json.id ? res.json : null));
  if (res.status === 403 || res.status === 401 || (res.json && res.json.success === false && !data)) throw new Error('D&D Beyond won\'t share that character. Make it public: on its sheet, Manage → Character Settings → Character Privacy → Public.');
  if (res.status === 404) throw new Error('D&D Beyond doesn\'t know that character. Check the link.');
  if (!data || !data.name) throw new Error('D&D Beyond sent something Tabletop doesn\'t understand (code ' + res.status + '). It may have changed how it shares characters.');
  return { id, link: `https://www.dndbeyond.com/characters/${id}`, raw: data, ...readCharacter(data) };
}

// ---------- turning D&D Beyond's data into a sheet ----------
function readCharacter(d) {
  const inv = Array.isArray(d.inventory) ? d.inventory : [];
  const equippedIds = new Set(inv.filter((i) => i.equipped && (!(i.definition && i.definition.canAttune) || i.isAttuned)).map((i) => i.definition && i.definition.id));
  // every modifier that applies: race, class, background, feats, and items that are equipped (and attuned if they need it)
  const mods = [];
  for (const [src, list] of Object.entries(d.modifiers || {})) for (const m of list || []) {
    if (src === 'item' && !equippedIds.has(m.componentId)) continue;
    mods.push(m);
  }
  const has = (type, sub) => mods.some((m) => m.type === type && m.subType === sub);
  const sum = (type, sub) => mods.filter((m) => m.type === type && m.subType === sub).reduce((s, m) => s + (Number(m.value ?? m.fixedValue) || 0), 0);
  const max = (types, sub) => mods.filter((m) => types.includes(m.type) && m.subType === sub).reduce((s, m) => Math.max(s, Number(m.value ?? m.fixedValue) || 0), 0);

  // ability scores: base, plus bonuses, unless something sets them (a belt of giant strength) or the sheet overrides them
  const byId = (arr, i) => (Array.isArray(arr) ? (arr.find((x) => x.id === i + 1) || {}).value : null);
  const scores = STATS.map((st, i) => {
    const over = byId(d.overrideStats, i); if (over != null) return over;
    let v = (byId(d.stats, i) || 10) + (byId(d.bonusStats, i) || 0) + sum('bonus', st + '-score');
    const set = max(['set'], st + '-score'); if (set > v) v = set;
    return Math.min(30, v);
  });
  const M = scores.map(mod);
  const classes = (d.classes || []).map((c) => ({ name: c.definition && c.definition.name, sub: c.subclassDefinition && c.subclassDefinition.name, level: c.level || 0, cast: c.definition && c.definition.spellCastingAbilityId, unarmored: c.definition && c.definition.name }));
  const level = Math.max(1, classes.reduce((s, c) => s + c.level, 0));
  const prof = 2 + Math.floor((level - 1) / 4);

  // hit points
  const perLevel = sum('bonus', 'hit-points-per-level');
  const maxHp = d.overrideHitPoints != null ? d.overrideHitPoints : Math.max(1, (d.baseHitPoints || 0) + (d.bonusHitPoints || 0) + (M[2] + perLevel) * level + sum('bonus', 'hit-points'));
  const hp = Math.max(0, maxHp - (d.removedHitPoints || 0));

  // armour class
  let armour = null, shield = 0;
  for (const i of inv) {
    if (!i.equipped || !i.definition) continue;
    const def = i.definition, t = def.armorTypeId;
    if (t === 4) shield = Math.max(shield, (def.armorClass || 2));
    else if (t >= 1 && t <= 3 && (def.armorClass || 0) > 0) { const base = def.armorClass + (def.grantedModifiers || []).filter((g) => g.type === 'bonus' && g.subType === 'armor-class').reduce((s, g) => s + (g.value || 0), 0); const ac = base + (t === 1 ? M[1] : t === 2 ? Math.min(2, M[1]) : 0); if (!armour || ac > armour.ac) armour = { ac, type: t }; }
  }
  let ac;
  if (armour) ac = armour.ac + sum('bonus', 'armored-armor-class');
  else {
    ac = 10 + M[1];
    // unarmoured defence: barbarians add CON, monks WIS (D&D Beyond lists it as a modifier with the ability)
    for (const m of mods.filter((x) => x.subType === 'unarmored-armor-class')) {
      if (m.statId) ac = Math.max(ac, 10 + M[1] + M[m.statId - 1]); else if (m.value) ac = Math.max(ac, 10 + M[1] + Number(m.value));
    }
    const natural = max(['set'], 'unarmored-armor-class'); if (natural) ac = Math.max(ac, natural + M[1]);
  }
  ac += shield + sum('bonus', 'armor-class');
  if (d.characterValues) { const o = d.characterValues.find((v) => v.typeId === 1 && v.value != null); if (o) ac = Number(o.value); } // the sheet's AC override

  // movement, initiative, senses
  const ws = d.race && d.race.weightSpeeds && d.race.weightSpeeds.normal;
  const speed = ((ws && ws.walk) || 30) + sum('bonus', 'speed') + sum('bonus', 'speed-walking') + (armour ? 0 : sum('bonus', 'unarmored-movement'));
  const jack = has('half-proficiency', 'ability-checks') || has('half-proficiency', 'initiative');
  const init = M[1] + sum('bonus', 'initiative') + (jack ? Math.floor(prof / 2) : 0) + (has('proficiency', 'initiative') ? prof : 0);
  const darkvision = Math.max(max(['set-base', 'sense'], 'darkvision'), 0);

  // saving throws and skills
  const saves = STATS.map((st, i) => ({ name: SHORT[i], bonus: M[i] + (has('proficiency', st + '-saving-throws') ? prof : 0) + sum('bonus', 'saving-throws') + sum('bonus', st + '-saving-throws') }));
  const skills = SKILLS.map(([name, a]) => {
    const s = slug(name), exp = has('expertise', s), pro = exp || has('proficiency', s), half = !pro && (has('half-proficiency', s) || jack);
    return { name, bonus: M[a] + (exp ? prof * 2 : pro ? prof : half ? Math.floor(prof / 2) : 0) + sum('bonus', s) + sum('bonus', 'ability-checks'), prof: exp ? 2 : pro ? 1 : 0 };
  });

  // attacks: equipped weapons, then spell attacks
  const attacks = [];
  const profWith = (def) => has('proficiency', slug(def.type || def.name)) || has('proficiency', slug(def.name)) || (def.categoryId === 1 && has('proficiency', 'simple-weapons')) || (def.categoryId === 2 && has('proficiency', 'martial-weapons'));
  for (const i of inv) {
    const def = i.definition; if (!def || !i.equipped || !(def.damage && def.damage.diceString) || def.filterType !== 'Weapon') continue;
    const props = (def.properties || []).map((p) => p.name);
    const ranged = def.attackType === 2, finesse = props.includes('Finesse');
    const a = ranged ? M[1] : finesse ? Math.max(M[0], M[1]) : M[0];
    const magic = (def.grantedModifiers || []).filter((g) => g.type === 'bonus' && g.subType === 'magic').reduce((s, g) => s + (g.value || 0), 0);
    const hit = a + (profWith(def) ? prof : 0) + magic, dmg = a + magic;
    attacks.push({ name: (i.definition.name || 'Weapon').slice(0, 24), hit: '1d20' + sign(hit), damage: def.damage.diceString + (dmg ? sign(dmg) : ''), type: def.damageType || '' });
  }
  const casters = classes.filter((c) => c.cast);
  const seenStat = new Set();
  for (const c of casters) {
    const k = c.cast - 1; if (seenStat.has(k)) continue; seenStat.add(k);
    attacks.push({ name: 'Spell attack' + (casters.length > 1 ? ' (' + SHORT[k] + ')' : ''), hit: '1d20' + sign(prof + M[k]), damage: '', dc: 8 + prof + M[k] });
  }

  const avatar = (d.decorations && d.decorations.avatarUrl) || d.avatarUrl || null;
  return {
    name: String(d.name).slice(0, 40), level, prof, race: (d.race && (d.race.fullName || d.race.baseName)) || '',
    classes: classes.map((c) => `${c.name || ''}${c.sub ? ' (' + c.sub + ')' : ''} ${c.level}`.trim()).join(' / '),
    hp, maxHp, tempHp: d.temporaryHitPoints || 0, ac, speed, init, darkvision,
    abilities: SHORT.map((n, i) => ({ name: n, score: scores[i], mod: M[i] })), saves, skills, attacks: attacks.slice(0, 12),
    avatar: typeof avatar === 'string' && /^https?:\/\//.test(avatar) ? avatar : null
  };
}

module.exports = { fetchCharacter, characterId, readCharacter };
