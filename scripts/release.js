// Gathers a release into dist/release/: the two Windows zips (nicely named) and release notes
// taken from this version's section of CHANGELOG.md. Run after `npm run build:win`.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const { version } = pkg;
// e.g. https://github.com/RobvanBlerk/tabletop (from "repository" in package.json)
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

// 3. The built zips
const zips = [
  [path.join(root, 'dist', 'dm', `Tabletop DM-${version}-win-x64.zip`), `Tabletop-DM-${version}-Windows.zip`],
  [path.join(root, 'dist', 'player', `Tabletop Player-${version}-win-x64.zip`), `Tabletop-Player-${version}-Windows.zip`]
];
for (const [src] of zips) if (!fs.existsSync(src)) fail(`Missing ${path.relative(root, src)}. Run "npm run build:win" first.`);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const [src, name] of zips) fs.copyFileSync(src, path.join(out, name));

const notes = `${body}

## Download

| File | For |
| --- | --- |
| \`Tabletop-DM-${version}-Windows.zip\` | The DM: unzip and run **Tabletop DM.exe** |
| \`Tabletop-Player-${version}-Windows.zip\` | Players: unzip and run **Tabletop Player.exe** |

Updating keeps your maps, tokens and library. First run on Windows: **More info → Run anyway** on the SmartScreen prompt, and the DM clicks **Allow** on the firewall prompt.

${repo ? `Guides: [DM guide](${repo}/blob/v${version}/docs/DM-GUIDE.md) · [Player guide](${repo}/blob/v${version}/docs/PLAYER-GUIDE.md) · [Full changelog](${repo}/blob/v${version}/CHANGELOG.md)` : 'Guides: see docs/DM-GUIDE.md and docs/PLAYER-GUIDE.md in the repository.'}
`;
fs.writeFileSync(path.join(out, `RELEASE_NOTES-${version}.md`), notes);

console.log(`\n  Release ${version} is ready in dist/release/:`);
for (const f of fs.readdirSync(out)) console.log(`   • ${f}  (${(fs.statSync(path.join(out, f)).size / 1048576).toFixed(1)} MB)`);
console.log(`\n  Next: commit, tag v${version}, push, then create the GitHub Release (see docs/RELEASING.md).\n`);
