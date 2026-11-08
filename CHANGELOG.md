# Changelog

All notable changes to Tabletop. Newest first. Each version's section is used as the release notes on GitHub.

## [0.4.1] - 2026-11-08

### Added
- **Select tool works on the map, not just tokens.** Click a prop to select it, then drag to move, `Q` to rotate, arrow keys to nudge or `Delete` to remove it.
- **Area selection.** Drag a box over part of the map (walls, floors and props together, such as a whole house) to move it. Hold `Alt` while dragging to copy it instead. `Delete` clears it; `Ctrl+C` / `Ctrl+V` copies and pastes at the mouse. A faded preview follows the mouse while dragging.
- A help line under the tools says what the current tool does, or what's selected and which keys work on it.

### Fixed
- The Terrain and Props sections looked greyed out (as if disabled) until you picked something from them.
- Terrains without a number key showed "key undefined".

## [0.4.0] - 2026-11-08

### Added
- **Generate a map:** village, dungeon or forest road, in three sizes, with optional villagers or monsters. Generated maps open privately; **Reroll** regenerates the map you're on.
  - Village: winding roads, market square with well or fountain and stalls, furnished tavern, smithy, temple with graveyard, shop, stable and houses with doors and windows, fenced fields, often a river with a bridge.
  - Dungeon: rooms joined by corridors with doors, portcullises, archways, secret doors and traps; throne room, crypt, library, prison, shrine, treasure, barracks, flooded and collapsed rooms. Choose goblins, kobolds, undead or beasts.
  - Forest road: groves of trees, bandit campsite, pond and old ruins.
- **Token library** with 215 built-in tokens in categories (dragons, kobolds and goblinoids, humanoids, undead, beasts, giants and monsters, fiends and fey, villagers and NPCs, farm animals, heroes), searchable, each at the right size.
- **Upload your own token art**, several files at once or by dropping images on the map; kept under "My uploads".
- **Selected token panel:** change a token's name, art, colour, owner or size; duplicate it.
- **Hidden tokens:** hide a token from players and reveal it later. Monsters in generated dungeons and on the forest road start hidden.
- 55 more props (69 in all) in five tabs: Doors & windows, Furniture, Dungeon, Village, Nature. Includes double doors, open doors, secret doors, portcullis, archway, windows, bars, bookshelves, fireplace, bar counter, throne, coffins, cages, braziers, traps, well, fountain, market stall, cart, fences, tents, lamp posts, pine trees, flowers and more.
- **Secret doors and traps are DM-only:** players' screens never receive them.
- 4 more terrains: marble, gravel path, farmland, snow.

### Fixed
- Several tokens that share artwork showed initials instead of art until the map was redrawn.

## [0.3.0] - 2026-11-08

### Added
- **Desktop apps:** Tabletop DM (runs the server and the DM view) and Tabletop Player (connect screen: type the DM's address and your name).
- **Map builder** ("Build map" mode): paint, rectangle, room, bucket fill, erase and prop tools; 10 terrains; 14 props; undo and redo.
- Upload a battle-map image as the background, with automatic grid fitting.
- Multiple maps: prepare maps privately and **Show to players** when ready.
- The DM sees the address players should use and who is connected.
- Token tool to click tokens into place; automatic numbering (Goblin 1, Goblin 2…).
- File → Back up table in the DM app.

## [0.2.0] - 2026-11-07

### Added
- Quick rolls: each player saves labelled rolls (e.g. "Longsword hit 1d20+5"); Shift-click for advantage, Alt-click for disadvantage.
- Private rolls, seen only by the DM and the player who rolled.
- Natural 20 and natural 1 highlighted in the roll log.

## [0.1.0] - 2026-11-07

### Added
- First playable version: shared grid map, tokens that players can move if they own them, dice rolled on the server, shared roll log, live sync between DM and players.
