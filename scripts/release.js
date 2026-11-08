// Gathers a release into dist/release/: the built apps (nicely named) and release notes taken from this
// version's section of CHANGELOG.md. Run after building (npm run build:win, or the GitHub workflow does it).
// Tabletop is built for Windows: an installer and a zip for each app.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const { version } = pkg;
// e.g. https://github.com/CPSDomain/VTT (from "repository" in package.json)
const repo = String((pkg.repository && pkg.repository.url) || pkg.repository || '').replace(/^git\+/, '').replace(/\.git$/, '');
const out = path.join(root, 'dist', 'release');
const fail = (msg) => { console.error('\n  ✗ ' + msg + '\n'); process.exit(1); };

// 1. The server must report the same version as package.json
const serverVersion = (fs.readFileSync(path.join(root, 'src', 'server.js'), 'utf8').match(/const VERSION = '([^']+)'/) || [])[1];
if (serverVersion !== version) fail(`package.json says ${version} but src/server.js says ${serverVersion}. Update both.`);

// 2. This version's changelog section
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const start = changelog.indexOf(`## [${version}]`);
if (start < 0) fail(`CHANGELOG.md has no "## [${version}]" section. Add one describing what changed.`);
const next = changelog.indexOf('\n## [', start + 1);
const section = changelog.slice(start, next < 0 ? undefined : next).trim();
const body = section.split('\n').slice(1).join('\n').trim();

// 3. The built apps: [built file, release name, required, what it is]
const builds = [];
for (const [dir, product, short, who] of [['dm', 'Tabletop DM', 'DM', 'The DM'], ['player', 'Tabletop Player', 'Player', 'Players']]) {
  const d = path.join(root, 'dist', dir);
  builds.push(
    [path.join(d, `${product}-Setup-${version}.exe`), `Tabletop-${short}-Setup-${version}.exe`, true, `${who}: Windows installer (recommended)`],
    [path.join(d, `${product}-${version}-win-x64.zip`), `Tabletop-${short}-${version}-Windows.zip`, true, `${who}: Windows, no install (unzip and run **${product}.exe**)`]
  );
}
for (const [src, , required] of builds) if (required && !fs.existsSync(src)) fail(`Missing ${path.relative(root, src)}. Run "npm run build:win" first (the installer needs Windows, or Wine on Linux).`);
const present = builds.filter(([src]) => fs.existsSync(src));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const [src, name] of present) fs.copyFileSync(src, path.join(out, name));

const rows = present.map(([, name, , what]) => `| \`${name}\` | ${what} |`).join('\n');
const notes = `${body}

## Download

| File | For |
| --- | --- |
${rows}

Updating keeps your maps, tokens and library: run the new installer over the old version (or unzip the new zip anywhere). First run on Windows: **More info → Run anyway** on the SmartScreen prompt, and the DM clicks **Allow** on the firewall prompt.

${repo ? `Guides: [DM guide](${repo}/blob/v${version}/docs/DM-GUIDE.md) · [Player guide](${repo}/blob/v${version}/docs/PLAYER-GUIDE.md) · [Full changelog](${repo}/blob/v${version}/CHANGELOG.md)` : 'Guides: see docs/DM-GUIDE.md and docs/PLAYER-GUIDE.md in the repository.'}
`;
fs.writeFileSync(path.join(root, 'dist', `RELEASE_NOTES-${version}.md`), notes);
fs.copyFileSync(path.join(root, 'dist', `RELEASE_NOTES-${version}.md`), path.join(out, `RELEASE_NOTES-${version}.md`));

console.log(`\n  Release ${version} is ready in dist/release/:`);
for (const f of fs.readdirSync(out)) console.log(`   • ${f}  (${(fs.statSync(path.join(out, f)).size / 1048576).toFixed(1)} MB)`);
console.log(`\n  Next: commit, tag v${version}, push, then create the GitHub Release (see docs/RELEASING.md).\n`);
