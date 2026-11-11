# Releasing a new version

Each version goes to GitHub as a commit, a tag and a Release with the apps attached. Testers download from the Releases page, read what's new in the release notes, and the apps tell everyone when a new version is out.

## Prepare the version

1. **Bump the version** in `package.json` (`"version"`) and in `src/server.js` (`const VERSION`). Use `MAJOR.MINOR.PATCH`: patch for fixes, minor for new features.
2. **Add a section to `CHANGELOG.md`** at the top, in the same format as the others. It becomes the release notes and the "What's new" in the apps' update message.

   ```markdown
   ## [1.1.0] - 2026-12-01

   ### Added
   - ...

   ### Fixed
   - ...
   ```

## Publish it: the automatic way (recommended)

The repository has a GitHub Actions workflow (`.github/workflows/release.yml`). Pushing a version tag builds the apps on one of GitHub's Windows machines and publishes the Release with everything attached and the notes filled in.

```bash
git add -A
git commit -m "Release 1.1.0"
git tag v1.1.0
git push && git push --tags
```

**With GitHub Desktop** instead of the command line:

1. Commit the changes (summary e.g. `Release 1.1.0`) and click **Push origin**.
2. Open the **History** tab, right-click that commit and choose **Create Tag…**. Type `v1.1.0` and click **Create Tag**.
3. Click **Push origin** again: the tag goes up with it and starts the build.

Then watch it under the repository's **Actions** tab (about 10 minutes). When it's green, the Release is on the Releases page as the latest version: the installers and zips for the DM and Player apps.

- The tag must match `package.json` (`v1.1.0` for `1.1.0`), or the workflow stops and says so. A capital `V1.1.0` works too: the release is still published as `v1.1.0`, on the same commit.
- **Actions → Release → Run workflow** builds everything without publishing, to check a build works. The files are under that run's **Artifacts**.
- The first time, check **Settings → Actions → General → Workflow permissions** is set to **Read and write**, so the workflow may create releases.

## Publish it by hand

When you build on your own PC instead:

1. **Build the Windows apps** (the installer needs Windows, or Wine on Linux):

   ```bash
   npm install
   npm run build:win
   ```

2. **Gather the release:**

   ```bash
   npm run release
   ```

   This puts everything for GitHub in `dist/release/`: the installers (`Tabletop-DM-Setup-<version>.exe`, `Tabletop-Player-Setup-<version>.exe`), the zips (`…-Windows.zip`), and `RELEASE_NOTES-<version>.md`, this version's changelog section plus a download table, ready to paste. It stops with a message if the version has no changelog section or the Windows builds are missing.

3. **Commit and tag** as above (if the workflow is in the repository, it will build and publish by itself; skip step 4).

4. **Create the GitHub Release:** **Releases → Draft a new release**, choose the tag, title it `Tabletop 1.1.0`, paste the release notes, attach the installers and zips, and publish. Under **Release label**, choose **None**, not **Pre-release**: GitHub skips pre-releases when it works out the latest version, so the README badge, the **Download the latest version** link and the apps' update check only see releases that aren't pre-releases.

   With the GitHub CLI installed, step 4 is one command:

   ```bash
   gh release create v1.1.0 dist/release/*.exe dist/release/*.zip --title "Tabletop 1.1.0" --notes-file dist/release/RELEASE_NOTES-1.1.0.md
   ```

## Code signing

The apps aren't code-signed, so Windows shows "Windows protected your PC" the first time (**More info → Run anyway**). That's a deliberate choice: removing the warning needs a paid code-signing certificate, which isn't worth it for one group.

## What goes in git, and what doesn't

`.gitignore` keeps out `node_modules/`, `dist/` (built apps and zips) and `data/` (save files from the headless server). The apps belong on the Releases page, not in the repository: GitHub rejects files over 100 MB in a normal push, and each zip is about 110 MB.
