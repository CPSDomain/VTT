// Reads a monster's action, trait or reaction text (SRD 5.1 wording, and the 2024 "Failure: … Success: …" wording)
// into what it does to a creature: an attack and its damage, a saving throw and the damage on a failure, the
// conditions it puts on, and how the creature gets out of them again (a save at the end or start of each of its
// turns, an escape DC, a check as an action, damage ending it, or a set time).
// Used by the app (to put a "Use on…" button on the stat block) and by the server (to do it). Plain script on purpose:
// the app loads it with a <script> tag, the server with require().
(function () {
  const ABL = { strength: 'STR', dexterity: 'DEX', constitution: 'CON', intelligence: 'INT', wisdom: 'WIS', charisma: 'CHA' };
  const CONDS = 'blinded|charmed|deafened|frightened|grappled|incapacitated|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious';
  const dmgRe = /(\d+)(?:\s*\((\d+d\d+(?:\s*[+-]\s*\d+)?)\))?\s*(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\s+damage/gi;
  const dmgIn = (s) => { const out = []; let m; dmgRe.lastIndex = 0; while ((m = dmgRe.exec(s))) out.push({ dice: (m[2] || m[1]).replace(/\s/g, ''), type: m[3].toLowerCase() }); return out; };
  const condsIn = (s) => {
    const found = new Set();
    // not "immunity to being charmed and frightened", nor what happens once it's out ("exiting prone", "regurgitate…falls prone")
    s = s.replace(new RegExp('immun\\w* to (?:being )?(?:(?:' + CONDS + ')(?:,? (?:and |or )?)?)+', 'gi'), '').replace(/[^.]*(?:regurgitat|exiting|dies,|no longer restrained)[^.]*\./gi, '');
    // lists: "is blinded, restrained, and unable to breathe"
    const list = new RegExp('\\b(?:is|are|be|becomes?)\\s+((?:' + CONDS + ')(?:,? (?:and |or )?(?:' + CONDS + '))+)', 'gi');
    let lm; while ((lm = list.exec(s))) for (const c of lm[1].split(/,? (?:and |or )?|, /)) if (c && new RegExp('^(' + CONDS + ')$', 'i').test(c.trim())) found.add(c.trim().toLowerCase());
    // "or be paralyzed", "is grappled", "be knocked prone", "has the Frightened condition", "magically charmed"
    const re = new RegExp('\\b(?:or be(?:come)?|be|is|are|becomes?|has the|have the|knocked|falls?|and (?:is|be)|magically)\\s+(?:magically\\s+|also\\s+)?(' + CONDS + ')\\b', 'gi');
    let m; while ((m = re.exec(s))) found.add(m[1].toLowerCase());
    const re2 = new RegExp('\\bthe (' + CONDS + ') condition', 'gi'); while ((m = re2.exec(s))) found.add(m[1].toLowerCase());
    const re3 = new RegExp('\\b(' + CONDS + ') and (' + CONDS + ')\\b', 'gi'); while ((m = re3.exec(s))) { found.add(m[1].toLowerCase()); found.add(m[2].toLowerCase()); }
    // not "immune to being charmed", "can't be frightened", "while grappled"
    for (const c of [...found]) if (new RegExp('(immune to (?:being )?|can\'t be |cannot be |while |isn\'t )' + c, 'i').test(s) && !new RegExp('(?:or be|is|has the) ' + c, 'i').test(s)) found.delete(c);
    return [...found];
  };
  const roundsIn = (s) => { const m = /for (\d+|one) (round|minute|hour|day)s?/i.exec(s); if (!m) return 0; const n = m[1] === 'one' ? 1 : +m[1]; return n * ({ round: 1, minute: 10, hour: 600, day: 14400 })[m[2].toLowerCase()]; };

  // one saving throw and what follows it
  function readSave(seg, monster) {
    const e = {};
    // "If it fails the saving throw by 5 or more, it is also paralyzed" (mummy): only on a bad failure
    const by5 = /[^.]*fails? (?:the|its|a|this) saving throw by 5 or more[^.]*\./i.exec(seg);
    if (by5) { e.by5 = condsIn(by5[0]); seg = seg.replace(by5[0], ''); }
    // "If the poison damage reduces the target to 0 hit points, it is stable but poisoned…" (giant spider): left to the DM
    seg = seg.replace(/[^.]*reduces the target to 0 hit points[^.]*\.(?:[^.]*while poisoned in this way[^.]*\.)?/gi, '');
    const sv = /DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/i.exec(seg) || /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:?\s*DC (\d+)/i.exec(seg);
    if (sv) e.save = /^\d/.test(sv[1]) ? { abl: ABL[sv[2].toLowerCase()], dc: +sv[1] } : { abl: ABL[sv[1].toLowerCase()], dc: +sv[2] };
    // damage on a failed save (and half on a success)
    // damage on a failure: in the "Failure:" part, or in the sentence with the DC (later sentences are what happens next)
    const failPart = (/Failure:([\s\S]*?)(?:Success:|$)/i.exec(seg) || [])[1] || (seg.slice(Math.max(0, seg.search(/DC \d+/))).split(/(?<=\.)\s+/)[0] || '');
    const fail = dmgIn(failPart.replace(/[^.]*at the start of each of (?:its|the [\w' -]+?'s) turns[^.]*\./gi, ''));
    if (fail.length && e.save) e.fail = fail;
    e.half = /half as much damage|Success:\s*Half damage/i.test(seg);
    e.add = condsIn(seg.replace(/Success:[\s\S]*$/i, ''));
    // effects that aren't a named condition still get a marker on the token, so their save is tracked
    if (!e.add.length && /speed is halved|can't use reactions/i.test(seg)) e.add.push('slowed');
    if (!e.add.length && /disadvantage on Strength/i.test(seg)) e.add.push('enfeebled');
    if (/swallowed/i.test(seg)) { e.add = [...new Set([...e.add, 'blinded', 'restrained'])]; e.note = 'Swallowed: it gets out if the monster takes enough damage from inside, or the monster dies'; }
    if (/repeats? the sav(?:e|ing throw) at the end of each of its turns|at the end of each of its turns, (?:the (?:\w+ )?(?:target|creature) )?repeats? the save|makes? (?:another|a) \w+ saving throw at the end of each of its turns/i.test(seg)) e.end = true;
    if (/repeats? the sav(?:e|ing throw) at the start of each of its turns|at the start of each of its turns, (?:the (?:\w+ )?(?:target|creature) )?(?:repeats? the save|must (?:succeed on|make))/i.test(seg)) e.start = true;
    let m;
    if ((m = /grappled[^.(]*\(escape DC (\d+)\)|Grappled condition \(escape DC (\d+)\)|escape DC (\d+)/i.exec(seg))) { e.escape = 'grapple'; e.escapeDc = +(m[1] || m[2] || m[3]); if (!e.add.includes('grappled')) e.add.push('grappled'); }
    if ((m = /(?:as an action|takes? an action|taking an action|use its action)[^.]*?make a DC (\d+) (Strength|Dexterity)(?: \((Athletics|Acrobatics)\))? check/i.exec(seg))) { e.escape = e.escape || 'check'; e.escapeDc = +m[1]; e.checkAbl = ABL[m[2].toLowerCase()]; e.skill = m[3] || ''; }
    if (/until this grapple ends/i.test(seg) && /restrained/i.test(seg) && !e.add.includes('restrained')) e.add.push('restrained');
    if (/(?:ends?|wakes? up|awakens?)[^.]*if (?:it|the (?:target|creature)) takes (?:any )?damage|until (?:it|the target) takes damage/i.test(seg)) e.hurt = 'end';
    const who = monster ? String(monster).toLowerCase().split(' ').pop() : '';
    if (/until the end of its next turn|until the end of the target's next turn/i.test(seg)) e.expire = 'tgtEnd';
    else if (/until the start of its next turn|until the start of the target's next turn/i.test(seg)) e.expire = 'tgtStart';
    else if ((m = /until the (end|start) of (?:the|this) ([\w' -]+?)'s next turn/i.exec(seg)) || (who && (m = new RegExp('until the (end|start) of the ' + who + "'s next turn", 'i').exec(seg)))) e.expire = m[1].toLowerCase() === 'end' ? 'srcEnd' : 'srcStart';
    if ((m = /(?:takes?|taking) (\d+) \((\d+d\d+(?:\s*[+-]\s*\d+)?)\) (\w+) damage at the start of each of (its|the [\w' -]+?'s) turns|at the start of each of (its|the [\w' -]+?'s) turns[^.]*?takes? (\d+) \((\d+d\d+(?:\s*[+-]\s*\d+)?)\) (\w+) damage/i.exec(seg)))
      e.tick = { when: /^its$/i.test(m[4] || m[5]) ? 'start' : 'srcStart', dice: (m[2] || m[7]).replace(/\s/g, ''), type: (m[3] || m[8]).toLowerCase() };
    // turning to stone: restrained now, a second save at the end of its next turn, then petrified
    if (/petrified/i.test(seg) && /restrained/i.test(seg) && /(?:end of its next turn|repeat the saving throw)/i.test(seg)) { e.add = ['restrained']; e.then = { add: ['petrified'] }; e.end = false; e.stage = 1; delete e.expire; }
    // Sleep-like: incapacitated until the end of its next turn, then paralyzed (silver dragon breath, 2024)
    e.rounds = roundsIn(seg);
    return e;
  }

  // the whole action: an attack (with what a hit does), or one or more saving throws (each a variant the DM picks)
  function parse(text, monster, kind) {
    let t = String(text || '').replace(/\s+/g, ' ').replace(/\{@\w+ ([^}|]+)[^}]*\}/g, '$1');
    // the monster's own saving throws ("the behir must succeed on a DC 14 Constitution saving throw… or regurgitate") aren't the target's
    const me = monster ? String(monster).toLowerCase().split(' ').pop() : '';
    if (me) t = t.replace(new RegExp("(^|\\.\\s+)(?:If [^.,]*,\\s*)?(?:the|a) " + me + " (?:must|makes?)[^.]*saving throw[^.]*\\.", 'gi'), '$1');
    const atk = /([+-]\d+) to hit(?! with spell)/i.exec(t) || /Attack Roll:\s*([+-]\d+)/i.exec(t);
    const out = { attack: atk ? +atk[1] : null, hit: [], variants: [] };
    // extra damage only sometimes ("plus 2 (1d4) if the attack roll had Advantage", "or 7 (1d10 + 2) if used with two hands") isn't counted
    if (atk) { const hit = ((/Hit:([^]*?)(?:\.|$)(?:\s|$)/i.exec(t) || [])[1] || '').split(/DC \d+|saving throw/i)[0].replace(/,?\s*(?:plus|or) \d+ \([^)]*\) \w+ damage,? (?:if|when|while|against)[^.]*/gi, ''); out.hit = dmgIn(hit); }
    // split at each saving throw (a breath weapon has one; a beholder's eye rays have many)
    // by sentence: each one naming a DC starts a new effect; what comes before the first belongs to the first
    const parts = [], titles = []; let lead = '', title = '';
    for (const sen of t.split(/(?<=\.)\s+/)) {
      if (/^[A-Z][\w' -]{2,30}\.$/.test(sen)) { title = sen.slice(0, -1); continue; }
      if (/\bDC \d+ (?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw|(?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:? DC \d+/i.test(sen)) { parts.push(sen); titles.push(title); title = ''; lead = ''; }
      else if (parts.length) parts[parts.length - 1] += ' ' + sen; else lead += sen + ' ';
    }
    const named = (s, i) => { const m = /(?:^|\. )(\d+\. )?([A-Z][\w' -]{2,28} Ray)\b/.exec(s) || /^\s*([A-Z][\w' -]{2,24})\. /.exec(s); return (m && (m[2] || m[1])) || ''; };
    for (const [i, seg] of parts.entries()) {
      const e = readSave(seg, monster); if (!e.save) continue;
      // "must succeed on a DC 14 Constitution saving throw at the start of each of the mound's turns or take…": a save against each turn's damage
      const rep = /saving throw at the start of each of (its|the [\w' -]+?'s) turns or take (\d+) \((\d+d\d+(?:\s*[+-]\s*\d+)?)\) (\w+) damage/i.exec(seg);
      if (rep) { e.tick = { when: /^its$/i.test(rep[1]) ? 'start' : 'srcStart', dice: rep[3].replace(/\s/g, ''), type: rep[4].toLowerCase(), save: e.save }; delete e.save; delete e.fail; }
      // a later sentence about the same effect ("The target can repeat the saving throw…") belongs to it
      if (!e.add.length && e.end) e.add.push('afflicted');
      e.name = titles[i] || named(seg, i) || (e.add.length ? e.add.join(' and ') : e.fail ? e.fail.map((d) => d.type).join(' and ') + ' damage' : 'Saving throw ' + (i + 1));
      if (e.add.length || e.fail || e.end) out.variants.push(e);
    }
    // a hit that grapples, knocks prone or restrains without a save ("the target is grappled (escape DC 13)")
    if (!out.variants.length && (atk || kind === 'actions' || kind === 'legendary')) {
      const e = readSave(t.replace(/^[^]*?Hit:/i, ''), monster); delete e.save;
      if (e.add.length) { e.name = e.add.join(' and '); out.variants.push(e); }
    }
    out.usable = out.attack != null || out.variants.length > 0;
    return out;
  }
  // traits that change saving throws
  const traits = (m) => {
    const names = (m.traits || []).map((x) => x.n + ': ' + x.d).join(' || ');
    const lr = /Legendary Resistance \((\d+)\/Day/i.exec(names) || /Legendary Resistance:[^|]*?\((\d+)\/Day\)/i.exec(names);
    // SRD stat blocks name it without the uses; it's 3 a day for every SRD monster that has it
    return { magicResistance: /Magic Resistance/i.test(names), legendary: lr ? +lr[1] : /Legendary Resistance/i.test(names) ? 3 : 0 };
  };

  // a monster's Spellcasting (or Innate Spellcasting) trait: its spell save DC, attack bonus, caster level and spell lists
  function spellcasting(m) {
    const out = [];
    for (const t of [...(m.traits || []), ...(m.actions || []), ...(m.bonus || []), ...(m.reactions || [])]) {
      if (!t.cast && !/Spellcasting/i.test(t.n)) continue;
      const d = String(t.d || ''), dc = /spell save DC (\d+)/i.exec(d), atk = /([+-]\d+) to hit with spell attacks/i.exec(d), lv = /(\d+)(?:st|nd|rd|th)-level spellcaster/i.exec(d);
      const abil = /(?:spellcasting ability is|ability is) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)/i.exec(d);
      const lists = [];
      for (const line of d.split(/\n+/)) {
        const m2 = /^\s*[-•]?\s*([^:]{2,40}):\s*(.+)$/.exec(line); if (!m2) continue;
        const label = m2[1].trim(), slot = /^(\d+)(?:st|nd|rd|th) level/i.exec(label) || /^Level (\d+)/i.exec(label), raw = m2[2].split(/,\s*/), names = raw.map((x) => x.replace(/\(.*?\)|\*/g, '').trim()).filter(Boolean);
        // "Lightning Bolt (level 7 version)": cast with a higher slot
        const levels = {}; for (const x of raw) { const lv = /\(level (\d) version\)/i.exec(x); if (lv) levels[x.replace(/\(.*?\)|\*/g, '').trim()] = +lv[1]; }
        if (!/cantrip|level|will|day|each/i.test(label)) continue;
        lists.push({ label, level: slot ? +slot[1] : /cantrip|will/i.test(label) ? 0 : null, spells: names, levels });
      }
      out.push({ name: t.n, dc: dc ? +dc[1] : null, attack: atk ? +atk[1] : null, level: lv ? +lv[1] : null, ability: abil ? ABL[abil[1].toLowerCase()] : null, lists });
    }
    return out;
  }
  // limits on an action: Recharge 5–6, 3/Day, a legendary action's cost; and what a Multiattack is made of
  const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  function meta(a, m) {
    const n = String(a.n || ''), d = String(a.d || ''), out = {};
    let x;
    if (a.recharge) out.recharge = a.recharge; if (a.perDay) out.perDay = a.perDay; if (a.rest) out.rest = true;
    if ((x = /Recharge (\d)(?:[–-](\d))?/i.exec(n))) out.recharge = +x[1];
    if (/Recharges after a (?:Short or )?Long Rest/i.test(n)) out.rest = true;
    if ((x = /\((\d+)\/Day/i.exec(n))) out.perDay = +x[1];
    if ((x = /Costs (\d+) Actions/i.exec(n))) out.cost = +x[1];
    if (/^Multiattack/i.test(n) && Array.isArray(a.ma)) out.multi = a.ma.filter((y) => (m.actions || []).some((z) => z.n.replace(/\s*\(.*?\)\s*$/, '') === y.name && (/to hit|saving throw|Attack Roll/i.test(z.d))));
    else if (/^Multiattack/i.test(n)) {
      const names = [...(m.actions || [])].map((y) => y.n.replace(/\s*\(.*?\)\s*$/, '')).filter((y) => !/^Multiattack/i.test(y));
      const list = [];
      for (const part of d.split(/[:,;]| and /)) for (const nm of names) {
        const re = new RegExp('(one|two|three|four|\\d+) (?:attacks? )?with (?:its |his |her )?' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's?\\b', 'i'), y = re.exec(part);
        if (y) list.push({ name: nm, n: NUM[y[1].toLowerCase()] || +y[1] || 1 });
      }
      if (!list.length) { const y = /makes (one|two|three|four) (?:melee |ranged )?attacks/i.exec(d); const atk = (m.actions || []).find((z) => /to hit/i.test(z.d)); if (y && atk) list.push({ name: atk.n.replace(/\s*\(.*?\)\s*$/, ''), n: NUM[y[1].toLowerCase()] }); }
      out.multi = list;
    }
    const reach = /reach (\d+) ft/i.exec(d); if (reach) out.reach = +reach[1];
    const range = /range (\d+)\/(\d+) ft/i.exec(d); if (range) out.range = { normal: +range[1], long: +range[2] };
    return out;
  }
  const legendaryCount = (m) => { if (m.legN) return m.legN; const x = /can take (\d+) legendary actions/i.exec(JSON.stringify(m.legendary || []) + JSON.stringify(m.traits || [])); return x ? +x[1] : (m.legendary || []).length ? 3 : 0; };
  const api = { parse, traits, condsIn, spellcasting, meta, legendaryCount };
  if (typeof module === 'object' && module.exports) module.exports = api; else globalThis.monsterFx = api;
})();
