// Tells the DM or player when a newer Tabletop is on GitHub, and installs it in one click.
// Checks at most once a day (4 seconds after starting), never blocks starting up, and stays quiet when offline.
// Help → Check for updates asks straight away.
//   Installed with the installer: "Update now" downloads that app's installer from the release (progress on the
//   taskbar), closes the app and runs it; it installs over the old one, keeping maps, tokens and settings.
//   Unzipped copy (no installer): "Download" opens the release page, as before.
const { app, dialog, net, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const pkg = require('../../package.json');

const REPO = String((pkg.repository && pkg.repository.url) || pkg.repository || '').replace(/^git\+/, '').replace(/\.git$/, '').replace(/^https:\/\/github\.com\//, '');
const API = process.env.TABLETOP_UPDATE_API || 'https://api.github.com'; // tests point this at a pretend GitHub
const file = () => path.join(app.getPath('userData'), 'update-check.json');
const read = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };
const write = (d) => { try { fs.writeFileSync(file(), JSON.stringify(d)); } catch { /* ignore */ } };
const isDM = () => /DM/.test(app.getName());

// 1.2.10 > 1.2.9; a version with a suffix (1.0.0-beta) counts as older than without
function newer(a, b) {
  const p = (v) => String(v).replace(/^v/i, '').split('-');
  const [an, as] = p(a), [bn, bs] = p(b);
  const x = an.split('.').map(Number), y = bn.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return !as && !!bs;
}
// this app's installer among the release's files (Tabletop-DM-Setup-1.6.0.exe or Tabletop-Player-Setup-1.6.0.exe)
function installerFor(assets, appName = app.getName()) {
  const want = /DM/.test(appName) ? /^Tabletop-DM-Setup-[\w.-]+\.exe$/i : /^Tabletop-Player-Setup-[\w.-]+\.exe$/i;
  return (assets || []).find((a) => want.test(a.name)) || null;
}
// installed with the installer (it leaves its uninstaller next to the app), rather than unzipped somewhere
function installed() {
  if (process.env.TABLETOP_UPDATE_INSTALLED) return process.env.TABLETOP_UPDATE_INSTALLED === '1';
  return process.platform === 'win32' && fs.existsSync(path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`));
}

async function latest() {
  const page = `https://github.com/${REPO}/releases/latest`;
  try {
    const r = await net.fetch(`${API}/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Tabletop-app' } });
    if (!r.ok) throw new Error('GitHub answered ' + r.status);
    const rel = await r.json();
    return { version: String(rel.tag_name || '').replace(/^v/i, ''), url: rel.html_url || page, notes: String(rel.body || ''),
      assets: (rel.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })) };
  } catch (e) {
    if (process.env.TABLETOP_UPDATE_API) throw e;
    // GitHub's API limits how often one address can ask; the releases page redirects to the latest tag too
    const r = await net.fetch(page, { redirect: 'manual', headers: { 'User-Agent': 'Tabletop-app' } });
    const m = String(r.headers.get('location') || r.url || '').match(/\/releases\/tag\/v?([^/?#]+)/i);
    if (!m) throw e;
    const v = decodeURIComponent(m[1]), name = `Tabletop-${isDM() ? 'DM' : 'Player'}-Setup-${v}.exe`;
    // the asset list wasn't available, but release files have predictable names
    return { version: v, url: page, notes: '', assets: [{ name, url: `https://github.com/${REPO}/releases/download/v${v}/${name}`, size: 0 }] };
  }
}

// download the installer, showing progress on the taskbar button
async function download(win, asset) {
  const dir = path.join(os.tmpdir(), 'tabletop-update'); fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, asset.name), part = dest + '.part';
  const r = await net.fetch(asset.url, { headers: { 'User-Agent': 'Tabletop-app' } });
  if (!r.ok) throw new Error('GitHub answered ' + r.status);
  const total = Number(r.headers.get('content-length')) || asset.size || 0;
  const out = fs.createWriteStream(part); let got = 0;
  const reader = r.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res));
      if (win && !win.isDestroyed() && total) win.setProgressBar(got / total);
    }
  } finally { await new Promise((res) => out.end(res)); if (win && !win.isDestroyed()) win.setProgressBar(-1); }
  if ((asset.size && got !== asset.size) || got < 1024) { fs.rmSync(part, { force: true }); throw new Error('The download was incomplete'); }
  fs.renameSync(part, dest);
  return dest;
}
// run the installer once this app has closed; it installs over the old one and starts the new version
function runInstaller(exe) {
  if (process.env.TABLETOP_UPDATE_DRYRUN) { fs.writeFileSync(process.env.TABLETOP_UPDATE_DRYRUN, exe); return app.quit(); }
  spawn(exe, ['--updated'], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
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
  const asset = installed() ? installerFor(rel.assets) : null;
  const whatsNew = rel.notes.split('\n## Download')[0].replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim().slice(0, 900);
  const closing = isDM() ? ' Tabletop DM closes while it installs: players are disconnected and reconnect by themselves when it\'s back.' : '';
  const { response } = await dialog.showMessageBox(win, {
    type: 'info', buttons: [asset ? 'Update now' : 'Download', 'Later', 'Skip this version'], defaultId: 0, cancelId: 1,
    title: 'Update available', message: `Tabletop ${rel.version} is available`,
    detail: `You have ${current}. Your maps, tokens and settings are kept when you update.` + (asset ? closing : '') + (whatsNew ? '\n\nWhat\'s new:\n' + whatsNew + (rel.notes.length > 900 ? '…' : '') : '')
  });
  if (response === 2) return write({ ...read(), skip: rel.version });
  if (response !== 0) return;
  if (!asset) return shell.openExternal(rel.url);
  try { runInstaller(await download(win, asset)); } catch (e) {
    const { response: r2 } = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Open the download page', 'Cancel'], defaultId: 0, cancelId: 1, message: 'The update couldn\'t be downloaded', detail: `${e.message}\n\nYou can download the installer from the release page instead.` });
    if (r2 === 0) shell.openExternal(rel.url);
  }
}

module.exports = { checkForUpdates, newer, installerFor };
if (process.env.TABLETOP_UPDATE_API) global.tabletopUpdate = module.exports; // tests drive it directly
