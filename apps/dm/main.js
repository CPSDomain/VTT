// Tabletop DM: desktop app that runs the game server and opens the DM view.
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { startServer } = require('../../src/server');
const { checkForUpdates } = require('../shared/update');
const { saveGuide } = require('../shared/guides');
const { openPort } = require('../../src/upnp');

process.on('uncaughtException', (e) => { try { require('electron').dialog.showErrorBox('Tabletop hit a problem', String((e && e.stack) || e)); } catch { /* not ready yet */ } });
app.setName('Tabletop DM'); // own settings folder and single-instance lock, separate from the player app
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null, server = null, dmKey = '', upnp = null, note = '';
const userDir = app.getPath('userData');
const dataDir = path.join(userDir, 'data');
const configFile = path.join(userDir, 'config.json');

// config.json: { port: 3000, upnp: true }
function readConfig() {
  try { return { port: 3000, upnp: true, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) }; } catch { return { port: 3000, upnp: true }; }
}
function writeConfig(cfg) { try { fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2)); } catch (e) { note = 'Couldn\'t save the network settings: ' + e.message; } }

// ---------- network: the port players connect to, and opening it on the router (UPnP) ----------
const network = {
  info: () => {
    const cfg = readConfig();
    return { port: server ? server.port : cfg.port, upnp: cfg.upnp !== false, note, router: cfg.upnp === false ? { state: 'off' } : upnp ? upnp.status() : { state: 'working' } };
  },
  async configure(m) {
    const cfg = readConfig();
    if (m.retry) { if (upnp) upnp.retry(); return { ok: true }; }
    if (typeof m.upnp === 'boolean' && m.upnp !== (cfg.upnp !== false)) { cfg.upnp = m.upnp; writeConfig(cfg); await startUpnp(); }
    if (m.port != null) {
      const p = Number(m.port);
      if (!Number.isInteger(p) || p < 1024 || p > 65535) return { ok: false, message: 'Choose a port number from 1024 to 65535' };
      if (p !== server.port) { setTimeout(() => moveTo(p), 150); return { ok: true, restarting: true, port: p }; }
    }
    notify();
    return { ok: true };
  }
};
const notify = () => { if (server && server.notifyNetwork) server.notifyNetwork(); };
const ssdpOverride = process.env.TABLETOP_SSDP ? { host: process.env.TABLETOP_SSDP.split(':')[0], port: Number(process.env.TABLETOP_SSDP.split(':')[1]) } : undefined; // for tests
async function startUpnp() {
  if (upnp) { const old = upnp; upnp = null; await old.close(); }
  if (server && readConfig().upnp !== false) upnp = openPort(server.port, { description: 'Tabletop DM', onChange: notify, ssdp: ssdpOverride });
  notify();
}
async function start(port) {
  dmKey = crypto.randomBytes(12).toString('hex'); // new every start; only this window gets it
  return startServer({ port, dataDir, dmKey, network });
}
// the DM picked another port: start the table there (back to the old one if it can't be used)
async function moveTo(p) {
  const old = server.port;
  if (upnp) { const u = upnp; upnp = null; await u.close(); }
  await server.close(); server = null;
  try { server = await start(p); const cfg = readConfig(); cfg.port = p; writeConfig(cfg); note = ''; }
  catch (e) { server = await start(old); note = `Port ${p} couldn't be used (${e.code === 'EADDRINUSE' ? 'another program is using it' : e.message}), so the table stays on ${old}.`; }
  win.loadURL(`http://localhost:${server.port}/?dm=${dmKey}`);
  startUpnp();
}

async function boot() {
  const cfg = readConfig();
  // Try the chosen port, then the next few if something else is using it.
  let lastErr;
  for (let p = cfg.port; p < cfg.port + 10 && !server; p++) {
    try { server = await start(p); } catch (e) { lastErr = e; if (e.code !== 'EADDRINUSE') break; }
  }
  if (!server) {
    dialog.showErrorBox('Tabletop DM could not start', `The game server failed to start: ${lastErr && lastErr.message}`);
    return app.quit();
  }
  if (server.port !== cfg.port) note = `Port ${cfg.port} is in use by another program, so the table is on ${server.port} for now.`;
  startUpnp();

  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1100, minHeight: 650,
    title: 'Tabletop DM', backgroundColor: '#121212', show: false,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' }
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); setTimeout(() => checkForUpdates(win), 4000); });
  setTimeout(() => { if (win && !win.isDestroyed() && !win.isVisible()) { win.maximize(); win.show(); } }, 6000); // slow or odd graphics: show it anyway
  win.on('page-title-updated', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL(`http://localhost:${server.port}/?dm=${dmKey}`);

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Open data folder (maps, saves)', click: () => shell.openPath(dataDir) },
      { label: 'Back up table…', click: backup },
      { label: 'Restore from backup…', click: restore },
      { type: 'separator' },
      { role: 'quit', label: 'Exit' }
    ] },
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' },
      { role: 'toggleDevTools' }
    ] },
    { label: 'Help', submenu: [
      { label: 'Check for updates…', click: () => checkForUpdates(win, { manual: true }) },
      { label: 'Download the DM guide (PDF)…', click: () => saveGuide(win, 'dm') },
      { label: 'Download the player guide (PDF)…', click: () => saveGuide(win, 'player') },
      { label: 'Guides and releases on GitHub', click: () => shell.openExternal('https://github.com/CPSDomain/VTT') },
      { type: 'separator' },
      { label: 'Server info', click: () => dialog.showMessageBox(win, {
        type: 'info', title: 'Tabletop DM', message: `Tabletop DM ${server.version}`,
        detail: `Server port: ${server.port}\nData folder: ${dataDir}\n\nPlayers connect with the Tabletop Player app using the address shown at the top right of the DM window. Change the port, and opening it on your router, under the players count → Connection.`
      }) }
    ] }
  ]));
}

async function backup() {
  const stamp = new Date().toISOString().slice(0, 10);
  const { filePath } = await dialog.showSaveDialog(win, { title: 'Back up table', defaultPath: `tabletop-backup-${stamp}.json`, filters: [{ name: 'Tabletop backup', extensions: ['json'] }] });
  if (!filePath) return;
  try {
    // state.json references uploaded images by name; copy them alongside the backup
    fs.copyFileSync(path.join(dataDir, 'state.json'), filePath);
    const imgDir = filePath.replace(/\.json$/i, '') + '-images';
    fs.mkdirSync(imgDir, { recursive: true });
    for (const f of fs.readdirSync(path.join(dataDir, 'uploads'))) fs.copyFileSync(path.join(dataDir, 'uploads', f), path.join(imgDir, f));
    dialog.showMessageBox(win, { type: 'info', message: 'Backup saved', detail: `${filePath}\n${imgDir}` });
  } catch (e) { dialog.showErrorBox('Backup failed', e.message); }
}

// Put a backup back: everything on the table now is replaced, after saving a safety copy of it.
async function restore() {
  const { filePaths } = await dialog.showOpenDialog(win, { title: 'Restore from backup', properties: ['openFile'], filters: [{ name: 'Tabletop backup', extensions: ['json'] }] });
  const file = filePaths && filePaths[0];
  if (!file) return;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return dialog.showErrorBox('Restore failed', 'That file isn\'t a Tabletop backup.'); }
  if (!data || typeof data !== 'object' || !(data.scenes || data.map)) return dialog.showErrorBox('Restore failed', 'That file isn\'t a Tabletop backup.');
  const maps = data.scenes ? Object.keys(data.scenes).length : 1;
  const imgDir = file.replace(/\.json$/i, '') + '-images';
  const hasImages = fs.existsSync(imgDir);
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Restore', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Restore from backup',
    message: `Replace everything on the table with this backup (${maps} map${maps === 1 ? '' : 's'})?`,
    detail: `${file}\n\nYour current maps, tokens and rolls are saved first as a safety copy in the data folder (before-restore-…json), so you can go back.` +
      (hasImages ? '' : `\n\nThe backup's image folder (${path.basename(imgDir)}) wasn't found next to it: maps and tokens using uploaded images will show without them.`)
  });
  if (response !== 0) return;
  const port = server.port, stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  try {
    await server.close(); server = null;
    const stateFile = path.join(dataDir, 'state.json');
    if (fs.existsSync(stateFile)) fs.copyFileSync(stateFile, path.join(dataDir, `before-restore-${stamp}.json`));
    fs.copyFileSync(file, stateFile);
    if (hasImages) { const up = path.join(dataDir, 'uploads'); fs.mkdirSync(up, { recursive: true }); for (const f of fs.readdirSync(imgDir)) fs.copyFileSync(path.join(imgDir, f), path.join(up, f)); }
  } catch (e) { dialog.showErrorBox('Restore failed', e.message); }
  // start the table again on the same port, with the restored data
  try { server = await start(port); } catch (e) { dialog.showErrorBox('Tabletop DM could not restart', e.message); return app.quit(); }
  win.loadURL(`http://localhost:${server.port}/?dm=${dmKey}`);
  dialog.showMessageBox(win, { type: 'info', message: 'Backup restored', detail: 'Players need to reconnect (their app does this by itself after a few seconds).' });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(boot);
// Closing, however it happens (the window's ✕, File → Exit, Windows shutting down): take the port off the
// router again, save the table and stop it, then quit.
let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  e.preventDefault(); quitting = true;
  (async () => {
    if (upnp) { const u = upnp; upnp = null; await Promise.race([u.close(), new Promise((r) => setTimeout(r, 2500))]); }
    if (server) { const sv = server; server = null; await sv.close(); }
  })().catch(() => {}).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
