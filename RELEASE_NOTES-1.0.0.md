Version 1.0: ready for any group to use, not only ours.

### Added
- **Table passcode:** click the players count at the top right (**Who can join**) and set a passcode. Players then need it to join: the Player app asks for it on the connect screen, and the browser asks before showing the table. Players already at the table stay connected. A 🔒 by the players count shows a passcode is set. After five wrong tries, an address has to wait half a minute.
- **Remove or block a player** in the same panel: **Remove** disconnects them (they can join again); **Block** also stops anyone joining under that name until you **Unblock** it.
- **Update check:** both apps tell you when a newer version is on GitHub, with what's new and a Download button (at most once a day; **Skip this version** stops the reminder). **Help → Check for updates…** checks straight away.
- **Windows installers:** `Tabletop-DM-Setup` and `Tabletop-Player-Setup` install the apps with Start menu and desktop shortcuts and an uninstaller, without needing admin rights. Installing a new version over the old one keeps everything. The zips are still there for running without installing.
- **Automatic builds:** pushing a version tag to GitHub builds the apps for Windows, macOS and Linux and publishes the release by itself (see [docs/RELEASING.md](docs/RELEASING.md)).
- **macOS and Linux apps** (built by the workflow): a `.dmg` for Mac and an `.AppImage` for Linux.
- **Help menu** in the Player app, with the Player guide.

### Not yet
- The apps aren't code-signed, so Windows still shows the SmartScreen prompt the first time.

## Download

| File | For |
| --- | --- |
| `Tabletop-DM-Setup-1.0.0.exe` | The DM: Windows installer (recommended) |
| `Tabletop-DM-1.0.0-Windows.zip` | The DM: Windows, no install (unzip and run **Tabletop DM.exe**) |
| `Tabletop-Player-Setup-1.0.0.exe` | Players: Windows installer (recommended) |
| `Tabletop-Player-1.0.0-Windows.zip` | Players: Windows, no install (unzip and run **Tabletop Player.exe**) |

Updating keeps your maps, tokens and library: run the new installer over the old version (or unzip the new zip anywhere). First run on Windows: **More info → Run anyway** on the SmartScreen prompt, and the DM clicks **Allow** on the firewall prompt.

Guides: [DM guide](https://github.com/CPSDomain/VTT/blob/v1.0.0/docs/DM-GUIDE.md) · [Player guide](https://github.com/CPSDomain/VTT/blob/v1.0.0/docs/PLAYER-GUIDE.md) · [Full changelog](https://github.com/CPSDomain/VTT/blob/v1.0.0/CHANGELOG.md)
