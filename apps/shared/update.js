// Tells the DM or player when a newer Tabletop is on GitHub. Checks at most once a day, never blocks
// starting up, and stays quiet when offline. Help → Check for updates asks straight away.
const { app, dialog, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const pkg = require('../../package.json');

const REPO = String((pkg.repository && pkg.repository.url) || pkg.repository || '').replace(/^git\+/, '').replace(/\.git$/, '').replace(/^https:\/\/github\.com\//, '');
const file = () => path.join(app.getPath('userData'), 'update-check.json');
const read = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };
const write = (d) => { try { fs.writeFileSync(file(), JSON.stringify(d)); } catch { /* ignore */ } };

// 1.2.10 > 1.2.9; a version with a suffix (1.0.0-beta) counts as older than without
function newer(a, b) {
  const p = (v) => String(v).replace(/^v/, '').split('-');
  const [an, as] = p(a), [bn, bs] = p(b);
  const x = an.split('.').map(Number), y = bn.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return !as && !!bs;
}

async function latest() {
  const page = `https://github.com/${REPO}/releases/latest`;
  try {
    const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Tabletop-app' } });
    if (!r.ok) throw new Error('GitHub answered ' + r.status);
    const rel = await r.json();
    return { version: String(rel.tag_name || '').replace(/^v/, ''), url: rel.html_url || page, notes: String(rel.body || '') };
  } catch (e) {
    // GitHub's API limits how often one address can ask; the releases page redirects to the latest tag too
    const r = await net.fetch(page, { redirect: 'manual', headers: { 'User-Agent': 'Tabletop-app' } });
    const m = String(r.headers.get('location') || r.url || '').match(/\/releases\/tag\/v?([^/?#]+)/);
    if (!m) throw e;
    return { version: decodeURIComponent(m[1]), url: page, notes: '' };
  }
}

async function checkForUpdates(win, { manual = false } = {}) {
  const current = pkg.version, saved = read();
  if (!manual && saved.last && Date.now() - saved.last < 20 * 3600 * 1000) return;
  if (!REPO) return;
  let rel;
  try { rel = await latest(); } catch (e) {
    if (manual) dialog.showMessageBox(win, { type: 'info', message: 'Couldn\'t check for updates', detail: `Check your internet connection and try again.\n\n${e.message}` });
    return;
  }
  write({ ...saved, last: Date.now() });
  if (!rel.version || !newer(rel.version, current)) {
    if (manual) dialog.showMessageBox(win, { type: 'info', message: 'You have the latest version', detail: `${app.getName()} ${current}` });
    return;
  }
  if (!manual && saved.skip === rel.version) return;
  const whatsNew = rel.notes.split('\n## Download')[0].replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim().slice(0, 900);
  const { response } = await dialog.showMessageBox(win, {
    type: 'info', buttons: ['Download', 'Later', 'Skip this version'], defaultId: 0, cancelId: 1,
    title: 'Update available', message: `Tabletop ${rel.version} is available`,
    detail: `You have ${current}. Your maps, tokens and settings are kept when you update.${whatsNew ? '\n\nWhat\'s new:\n' + whatsNew + (rel.notes.length > 900 ? '…' : '') : ''}`
  });
  if (response === 0) shell.openExternal(rel.url);
  if (response === 2) write({ ...read(), skip: rel.version });
}

module.exports = { checkForUpdates, newer };
