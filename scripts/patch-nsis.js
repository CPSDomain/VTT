// Fixes a crash in the Windows installer (exit code 0xC0000005 in System.dll: the installer closes right after
// "Windows protected your PC"). electron-builder's installer template asks Windows for the per-user Programs folder,
// then reads back 2048 bytes from a string of about 60 characters; reading past its end crashes when the string
// happens to sit at the end of a memory page. The installer already starts from the same default folder
// (%LOCALAPPDATA%\Programs), so the lookup is removed. The original template is kept next to it as multiUser.nsh.orig.
// Runs after npm install (package.json "postinstall"), so GitHub's builds get it too.
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'multiUser.nsh');
if (!fs.existsSync(file)) { console.log('patch-nsis: electron-builder not installed, nothing to do'); process.exit(0); }
const src = fs.readFileSync(file, 'utf8');
if (src.includes('Tabletop: no SHGetKnownFolderPath')) { console.log('patch-nsis: already applied'); process.exit(0); }
const open = '      System::Store S\n', close = '      System::Store L\n';
const start = src.indexOf(open), end = src.indexOf(close);
if (start < 0 || end < start || !src.slice(start, end).includes('SHGetKnownFolderPath')) {
  console.error('patch-nsis: electron-builder\'s installer template has changed; check multiUser.nsh by hand');
  process.exit(1);
}
if (!fs.existsSync(file + '.orig')) fs.writeFileSync(file + '.orig', src);
fs.writeFileSync(file, src.slice(0, start) + '      ; Tabletop: no SHGetKnownFolderPath here (it read past the end of the folder name and crashed)\n' + src.slice(end + close.length));
console.log('patch-nsis: installer folder lookup fixed');
