### Added
- **Import from MapTool:** campaigns (`.cmpgn`) and maps (`.rpmap`) with **Build map → 📥 Import map…**, or drop the file on the map. Each map in a campaign becomes a private Tabletop map:
  - the map image, the background, and the stamps on the Background and Object layers, flattened into one picture on the same grid;
  - tokens on the Token layer at their squares and sizes, with their images, names and owners, and HP where the campaign stores it;
  - GM-layer tokens come in hidden; map labels come in as labels; tokens with the same name are numbered.
- **MapTool tokens** (`.rptok`) import into the token library (My uploads).
- **Export map** (Build map → 📤 Export map) saves a map with its images as one `.ttmap` file, to share with another DM or keep. **Import map** opens it as a new map, with everything on it: walls, props, tokens, labels, notes and fog.
- **File → Restore from backup…** in Tabletop DM puts a backup made with Back up table back. Before replacing anything it saves a safety copy of the current table in the data folder.

### Not imported from MapTool yet
- Fog of war (revealed areas), vision blocking (walls), lights, drawings, macros and token properties other than HP: the map starts with fog off. Hex and isometric grids come in as squares.

## Download

| File | For |
| --- | --- |
| `Tabletop-DM-0.10.0-Windows.zip` | The DM: unzip and run **Tabletop DM.exe** |
| `Tabletop-Player-0.10.0-Windows.zip` | Players: unzip and run **Tabletop Player.exe** |

Updating keeps your maps, tokens and library. First run on Windows: **More info → Run anyway** on the SmartScreen prompt, and the DM clicks **Allow** on the firewall prompt.

Guides: [DM guide](https://github.com/CPSDomain/VTT/blob/v0.10.0/docs/DM-GUIDE.md) · [Player guide](https://github.com/CPSDomain/VTT/blob/v0.10.0/docs/PLAYER-GUIDE.md) · [Full changelog](https://github.com/CPSDomain/VTT/blob/v0.10.0/CHANGELOG.md)
