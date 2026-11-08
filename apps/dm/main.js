// Tabletop DM: desktop app that runs the game server and opens the DM view.
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { startServer } = require('../../src/server');

app.setName('Tabletop DM'); // own settings folder and single-instance lock, separate from the player app
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null, server = null;
const userDir = app.getPath('userData');
const dataDir = path.join(userDir, 'data');
const configFile = path.join(userDir, 'config.json');

function readConfig() {
  try { return { port: 3000, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) }; } catch { return { port: 3000 }; }
}

async function boot() {
  const cfg = readConfig();
  const dmKey = crypto.randomBytes(12).toString('hex'); // new every launch; only this window gets it
  // Try the configured port, then the next few if something else is using it.
  let lastErr;
  for (let p = cfg.port; p < cfg.port + 10 && !server; p++) {
    try { server = await startServer({ port: p, dataDir, dmKey }); } catch (e) { lastErr = e; if (e.code !== 'EADDRINUSE') break; }
  }
  if (!server) {
    dialog.showErrorBox('Tabletop DM could not start', `The game server failed to start: ${lastErr && lastErr.message}`);
    return app.quit();
  }

  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1100, minHeight: 650,
    title: 'Tabletop DM', backgroundColor: '#121212', show: false,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.on('page-title-updated', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL(`http://localhost:${server.port}/?dm=${dmKey}`);

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Open data folder (maps, saves)', click: () => shell.openPath(dataDir) },
      { label: 'Back up table…', click: backup },
      { type: 'separator' },
      { role: 'quit', label: 'Exit' }
    ] },
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' },
      { role: 'toggleDevTools' }
    ] },
    { label: 'Help', submenu: [
      { label: 'Server info', click: () => dialog.showMessageBox(win, {
        type: 'info', title: 'Tabletop DM', message: `Tabletop DM ${server.version}`,
        detail: `Server port: ${server.port}\nData folder: ${dataDir}\n\nPlayers connect with the Tabletop Player app using the address shown at the top right of the DM window.\nTo change the port, edit ${configFile}`
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

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(boot);
app.on('window-all-closed', async () => { if (server) await server.close(); app.quit(); });
