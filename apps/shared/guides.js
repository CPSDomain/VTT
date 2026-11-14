// Help → Download the guide (PDF): copies the PDF that ships with the app to where the user picks, then opens it.
const { app, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const GUIDES = {
  dm: { file: 'Tabletop-DM-Guide.pdf', title: 'Save the DM guide' },
  player: { file: 'Tabletop-Player-Guide.pdf', title: 'Save the player guide' }
};

async function saveGuide(win, which) {
  const g = GUIDES[which];
  const src = path.join(__dirname, '..', '..', 'public', 'guides', g.file);
  const { filePath } = await dialog.showSaveDialog(win, { title: g.title, defaultPath: path.join(app.getPath('downloads'), g.file), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!filePath) return;
  try {
    fs.writeFileSync(filePath, fs.readFileSync(src)); // readFileSync works inside the app's asar archive
    shell.openPath(filePath);
  } catch (err) {
    dialog.showMessageBox(win, { type: 'error', title: 'Tabletop', message: "Couldn't save the guide", detail: String(err.message || err) });
  }
}

module.exports = { saveGuide };
