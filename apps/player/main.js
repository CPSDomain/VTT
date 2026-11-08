// Tabletop Player: desktop app that connects to a DM's Tabletop server.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

app.setName('Tabletop Player'); // own settings folder and single-instance lock, separate from the DM app
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
let win = null;
const connectPage = path.join(__dirname, 'connect.html');

function create() {
  win = new BrowserWindow({
    width: 1400, height: 880, minWidth: 900, minHeight: 600,
    title: 'Tabletop', backgroundColor: '#121212', show: false,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', (e) => e.preventDefault());
  // Links that open new windows (e.g. a D&D Beyond sheet later) go to the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  // Only ever show the connect page or a Tabletop server's own pages.
  win.webContents.on('will-navigate', (e, url) => {
    const cur = win.webContents.getURL();
    const ok = url.startsWith('file:') || (cur.startsWith('file:') && /^https?:/.test(url)) || (/^https?:/.test(cur) && new URL(url).origin === new URL(cur).origin);
    if (!ok) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  win.loadFile(connectPage);

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Table', submenu: [
      { label: 'Disconnect', accelerator: 'CmdOrCtrl+D', click: () => win.loadFile(connectPage, { query: { left: '1' } }) },
      { type: 'separator' },
      { role: 'quit', label: 'Exit' }
    ] },
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' },
      { role: 'toggleDevTools' }
    ] }
  ]));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
