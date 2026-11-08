# Changelog

All notable changes to Tabletop. Newest first. Each version's section is used as the release notes on GitHub.

## [0.10.0] - 2026-11-08

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

## [0.9.0] - 2026-11-08

### Added
- **Import maps** from other map makers: **Build map → 📥 Import map…**, or drop the file on the map.
  - **Universal VTT files** (`.uvtt`, `.dd2vtt`, `.df2vtt`), from Dungeon Scrawl, Dungeondraft, Dungeon Alchemist and others. The map comes in at the right size with its walls and doors.
  - **Reveal room follows imported walls:** with fog of war on, clicking in a room reveals that room and stops at walls and doors, as it does on built maps. You see the imported walls (blue) and doors (orange) in Build mode and while using Reveal room; players never receive them.
  - **Map images** (PNG, JPG, WebP), e.g. from Canvas of Kings or Inkarnate, become a new map. If the image has grid lines, Tabletop finds the grid and sizes the map to match.
- Uploading a background image also finds the grid in it.

### Changed
- Maps can be up to 200 × 200 squares (was 120), and images up to 100 MB (was 40 MB).

## [0.8.0] - 2026-11-08

### Added
- **Table tools** on the left of the map in Play mode, for the DM and players: Move, Ruler, Spell, Ping and (DM only) Label. Keys: `V`, `R`, `T`, `P`, `L`; `Esc` goes back to Move.
- **Ruler:** drag to measure in feet. Press `Space` while dragging to add a corner and measure round walls. Everyone sees your ruler with your name on it while you measure.
  - Diagonals count 5 ft each (the 5e rule), or 5 / 10 / 5 ft per map: **Ruler diagonals** in the Build panel.
- **Movement distance:** dragging a token shows how far it has moved, and players' moves show on everyone's screen. `Space` adds a corner here too. The DM's moves stay private.
- **Spell templates:** cone, sphere, cube, line and cylinder, in everyone's own colour. Drag from where the spell starts to aim it and set its size, or click to place one at the size in the box. The squares it covers are shaded.
  - Click one of your templates to select it: drag to move it, drag its dot to re-aim or resize it, `Del` removes it. **Clear mine** removes all of yours; the DM can move or remove anyone's and **Clear all**.
- **Ping:** click with the Ping tool, or `Alt`+click with any tool, to flash a spot for everyone with your name. The DM can `Shift`+ping to bring everyone's view to that spot.
- **Map labels and DM notes:** with the Label tool, click the map to add text in three sizes, e.g. room names. Tick **DM note** for reminders only you can see (traps, DCs, what's behind the door). Drag a label to move it, click it to edit or delete. Under fog of war, players see a label once its square is revealed.

## [0.7.0] - 2026-11-08

### Added
- **Initiative tracker** at the top of the right-hand panel. **⚔ Start combat** adds every token on the map (or add them one at a time with **+ Selected** or **⚔ Add to initiative**).
  - **🎲 Roll for monsters** rolls 1d20 + initiative bonus for every monster without a score; the rolls stay private to the DM.
  - Players roll their own initiative with the 🎲 button, or type their score; the DM can type anyone's.
  - Turn order sorts itself; **Next turn** / **◀** move through it and count rounds. Whose turn it is glows gold on the map.
  - Players only see combatants they can see: hidden monsters and monsters in the fog stay off their list ("Something unseen is taking its turn…").
  - Click a name to select that token and bring it into view.
- **Hit points.** Select a token to set HP, max HP and temporary HP, or type an amount and press **Damage** or **Heal** (temporary HP soaks damage first). Health bars show on tokens; at 0 HP a token is darkened and crossed out.
  - **What players see** is set per token: HP numbers, a health bar only, or nothing. Default: numbers for player characters, a bar for everyone else.
  - **Players can manage their own character:** clicking their token opens a panel with their HP, temp HP, initiative bonus and conditions.
- **Conditions:** the 15 standard 5e conditions plus concentrating, bleeding, blessed, hasted, raging, burning, marked, hidden and dead, shown as icons on tokens and in the initiative list.
- **Monster stats:** 88 tokens in the library (goblins, kobolds, orcs, undead, beasts, bandits, cultists, guards, dragons and more) come with their standard HP and initiative bonus, including monsters placed by the map generators.
- Monsters placed by the generators are numbered (Goblin 1, Goblin 2…).

## [0.6.0] - 2026-11-08

### Added
- **Describe the map you want.** The Generate dialog has a description box: type something like *"a snowy fishing village on the coast with a lighthouse"* or *"flooded crypt full of zombies with secret doors"*. It picks the map type and settings from your words and shows what it understood; change anything before generating. Add *"called …"* to name the map. The **Example** button cycles through ideas. Works offline: it reads key words rather than understanding full sentences.
- **Many more generator settings**, all adjustable by hand:
  - **Village:** setting (green, snowy, desert, swamp), water (river, lake, coast), layout (crossroads, one street, hamlet, walled town with gates), number of buildings, condition (thriving, lived in, ruined, with raiders), trees, and extras: market square, temple and graveyard, farm fields, mill, watchtower or lighthouse, docks and boats, villagers.
  - **Dungeon:** eight styles (stone halls, natural caves, crypt, mine, sewer, temple, lava forge, flooded), number of rooms, corridor width, linear / branching / maze-like layout, traps (none, some, many), secret doors, a boss room at the far end, and monsters (goblins, kobolds, orcs, undead, beasts, cultists, bandits, or ones that suit the style).
  - **Wilderness** (replaces Forest road): forest road, forest clearing, swamp, river crossing, mountain pass, desert oasis, snowy woods or coastline, with campsite, ruins, pond, cave entrance, shrine, wagon wreck, and creatures.
  - **Building interiors (new):** tavern or inn, temple, manor house, shop, guardhouse or wizard tower: rooms with doors, windows and furniture for their purpose (common room, kitchen, bedrooms, library, armoury, cells, laboratory…), people inside, a yard, or abandoned and ransacked.
- **Seeds:** every map shows its seed; type a seed to make the same map again.
- Maps are sometimes mirrored, so layouts don't always face the same way.
- **Roadmap** in [docs/ROADMAP.md](docs/ROADMAP.md).

### Changed
- After generating, a message sums up the map (e.g. *"Frostharbour: Snowy town · on the coast · 11 buildings · docks"*).

## [0.5.0] - 2026-11-08

### Added
- **Fog of war.** Turn it on per map with the **Fog of war** box in the bar at the top of the map. Players then see only what you reveal; you see everything, with unrevealed areas shaded.
  - **Reveal room:** click inside a room to reveal it with its walls. It stops at doors, so each room opens on its own. Hovering shows what will be revealed.
  - **Reveal brush** and **Cover brush** (sizes 1, 3, 5, 9) to reveal by hand or cover areas up again; **Reveal all** and **Cover all**.
  - Nothing under the fog is sent to players: no floor, walls, props or monsters. They can't peek.
  - Monsters standing in fog are invisible to players and appear when they step into a revealed area (or when you reveal theirs). Players always see their own tokens.
  - Fog is saved with the map and survives resizing.
- **Generated maps can start fogged**, with only the way in revealed. On by default for dungeons. With fog on, generated monsters aren't marked hidden: the fog keeps them out of sight until you reveal their room.

### Changed
- Players' view no longer re-centres when the DM changes something on the current map.

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
