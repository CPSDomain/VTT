// Reads a monster's action, trait or reaction text (SRD 5.1 wording, and the 2024 "Failure: … Success: …" wording)
// into what it does to a creature: an attack and its damage, a saving throw and the damage on a failure, the
// conditions it puts on, and how the creature gets out of them again (a save at the end or start of each of its
// turns, an escape DC, a check as an action, damage ending it, or a set time).
// Used by the app (to put a "Use on…" button on the stat block) and by the server (to do it). Plain script on purpose:
// the app loads it with a <script> tag, the server with require().
(function () {
  const ABL = { strength: 'STR', dexterity: 'DEX', constitution: 'CON', intelligence: 'INT', wisdom: 'WIS', charisma: 'CHA' };
  const CONDS = 'blinded|charmed|deafened|frightened|grappled|incapacitated|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious';
  const dmgRe = /(\d+)\s*\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)\s*(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\s+damage/gi;
  const dmgIn = (s) => { const out = []; let m; dmgRe.lastIndex = 0; while ((m = dmgRe.exec(s))) out.push({ dice: m[2].replace(/\s/g, ''), type: m[3].toLowerCase() }); return out; };
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
    const atk = /([+-]\d+) to hit/i.exec(t);
    const out = { attack: atk ? +atk[1] : null, hit: [], variants: [] };
    if (atk) { const hit = ((/Hit:([^]*?)(?:\.|$)(?:\s|$)/i.exec(t) || [])[1] || '').split(/DC \d+|saving throw/i)[0]; out.hit = dmgIn(hit); }
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

  const api = { parse, traits, condsIn };
  if (typeof module === 'object' && module.exports) module.exports = api; else globalThis.monsterFx = api;
})();
