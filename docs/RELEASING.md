# Releasing a new version

Each version goes to GitHub as a commit, a tag and a Release with the two Windows zips attached. Testers download from the Releases page and read what's new in the release notes.

## Steps

1. **Bump the version** in `package.json` (`"version"`) and in `src/server.js` (`const VERSION`). Use `MAJOR.MINOR.PATCH`: patch for fixes, minor for new features.
2. **Add a section to `CHANGELOG.md`** at the top, in the same format as the others:

   ```markdown
   ## [0.5.0] - 2026-11-15

   ### Added
   - ...

   ### Fixed
   - ...
   ```

3. **Build the Windows apps:**

   ```bash
   npm install
   npm run build:win
   ```

4. **Gather the release:**

   ```bash
   npm run release
   ```

   This puts everything for GitHub in `dist/release/`:
   - `Tabletop-DM-<version>-Windows.zip`
   - `Tabletop-Player-<version>-Windows.zip`
   - `RELEASE_NOTES-<version>.md`: this version's changelog section plus download instructions, ready to paste.

   It stops with a message if the version has no changelog section or the zips are missing.

5. **Commit and tag:**

   ```bash
   git add -A
   git commit -m "Release 0.5.0"
   git tag v0.5.0
   git push && git push --tags
   ```

6. **Create the GitHub Release:** on GitHub go to **Releases → Draft a new release**, choose the tag `v0.5.0`, title it `Tabletop 0.5.0`, paste `RELEASE_NOTES-0.5.0.md` into the description, attach both zips, and publish.

   With the GitHub CLI installed, step 6 is one command:

   ```bash
   gh release create v0.5.0 dist/release/*.zip --title "Tabletop 0.5.0" --notes-file dist/release/RELEASE_NOTES-0.5.0.md
   ```

## What goes in git, and what doesn't

`.gitignore` keeps out `node_modules/`, `dist/` (built apps and zips) and `data/` (save files from the headless server). The zips belong on the Releases page, not in the repository: GitHub rejects files over 100 MB in a normal push, and each zip is about 110 MB.
