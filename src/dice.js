// Dice roller. Supports: 1d20+5, 2d6+1d4-1, 4d6kh3, 4d6kl1, 1d20adv, 1d20dis, d100
const crypto = require('crypto');

function rollDice(expr) {
  const clean = String(expr).toLowerCase().replace(/\s+/g, '');
  if (!clean || clean.length > 60) throw new Error('Bad expression');
  const adv = /adv$/.test(clean), dis = /dis$/.test(clean);
  const body = clean.replace(/(adv|dis)$/, '');
  const terms = body.match(/[+-]?[^+-]+/g);
  if (!terms) throw new Error('Bad expression');
  let total = 0, natural = null; const parts = [];
  for (const raw of terms) {
    const sign = raw[0] === '-' ? -1 : 1;
    const t = raw.replace(/^[+-]/, '');
    const m = t.match(/^(\d*)d(\d+)(k[hl]\d+)?$/);
    if (m) {
      let n = Number(m[1] || 1); const sides = Number(m[2]);
      if (n < 1 || n > 100 || sides < 2 || sides > 1000) throw new Error('Dice out of range');
      if ((adv || dis) && sides === 20 && n === 1) n = 2;
      const rolls = Array.from({ length: n }, () => crypto.randomInt(1, sides + 1));
      let kept = rolls.slice();
      if (m[3]) {
        const k = Number(m[3].slice(2));
        kept = rolls.slice().sort((a, b) => m[3][1] === 'h' ? b - a : a - b).slice(0, k);
      } else if ((adv || dis) && sides === 20 && rolls.length === 2) {
        kept = [adv ? Math.max(...rolls) : Math.min(...rolls)];
      }
      if (sides === 20 && kept.length === 1 && natural === null) natural = kept[0];
      const sum = kept.reduce((a, b) => a + b, 0);
      total += sign * sum;
      parts.push(`${sign < 0 ? '-' : ''}${n}d${sides}[${rolls.join(',')}]${kept.length !== rolls.length ? '→' + kept.join(',') : ''}`);
    } else if (/^\d+$/.test(t)) {
      total += sign * Number(t); parts.push(`${sign < 0 ? '-' : '+'}${t}`);
    } else throw new Error('Bad term: ' + t);
  }
  const crit = natural === 20 ? 'nat20' : natural === 1 ? 'nat1' : null;
  return { total, crit, detail: parts.join(' ') + (adv ? ' (adv)' : dis ? ' (dis)' : '') };
}

module.exports = { rollDice };
