# DM guide

Everything you need to run a session in Tabletop: starting the server, getting players in, building or generating maps, fog of war, and running play.

## Start Tabletop DM

1. Unzip `Tabletop-DM-<version>-Windows.zip` to a folder you'll keep, e.g. `Documents\Tabletop DM`. Keep all the files together; the .exe needs the rest of the folder.
2. Double-click **Tabletop DM.exe**.
3. Windows shows "Windows protected your PC" because the app isn't code-signed yet. Click **More info**, then **Run anyway**. This happens once.
4. Windows Firewall asks whether to allow Tabletop DM. Tick **Private networks** and click **Allow**. Without this, players can't reach you.
5. The DM window opens. Top right shows **Players connect to 192.168.x.x:3000**: give that address to your players. The Copy button copies it.

Your maps, tokens, token library and rolls save automatically to `%APPDATA%\Tabletop DM\data`. **File → Back up table** saves a copy, and **File → Restore from backup…** puts one back (it saves a safety copy of the current table first); **File → Open data folder** shows it. Updating to a new version keeps all of it.

## Get players connected

Each player unzips `Tabletop-Player-<version>-Windows.zip`, runs **Tabletop Player.exe**, types your address and their name, and clicks Connect. Players can also skip the app and open `http://your-address` in Chrome or Edge. See the [Player guide](PLAYER-GUIDE.md).

| Players are | Address to give them | Setup |
| --- | --- | --- |
| On your Wi-Fi or network | The one shown top right, e.g. `192.168.1.20:3000` | Allow the firewall prompt |
| Elsewhere (online game) | Your Tailscale address, e.g. `100.x.x.x:3000` | Everyone installs [Tailscale](https://tailscale.com) (free) and joins your network once |

To test alone, run Tabletop Player on the same PC and connect to `localhost:3000`.

## Private prep vs what players see

The dropdown at the top picks which map **you** are looking at.

- A red **PLAYERS SEE THIS** badge means every change shows on players' screens live.
- A grey **PRIVATE PREP** badge means only you see this map. Build in peace.
- When a map is ready, click **Show to players**.

## Fog of war

The bar at the top of the map controls fog for the map you're on.

1. Tick **Fog of war**. Players now see nothing until you reveal it; you see everything, with unrevealed areas shaded.
2. **Reveal room:** click inside a room. It reveals the room and its walls and stops at doors, so the party opens one room at a time. Hover first to see what will open. Works on built and generated maps; on an uploaded image map, use the brush.
3. **Reveal brush** / **Cover brush:** paint to reveal, or to cover an area again. Pick the size (1, 3, 5 or 9 squares) next to them.
4. **Reveal all** / **Cover all** do the whole map. Press **Esc** to put the fog tool down and go back to moving tokens.

Nothing under the fog is sent to players' screens. Monsters standing in fog are invisible to players and appear when they walk into a revealed area or you reveal theirs, so with fog on you rarely need **Hidden from players**. Players always see their own tokens.

Generated maps can start fogged with only the way in revealed (the **Start with fog of war** box; on by default for dungeons).

## Generate a map

Click **Build map**, then **Generate a map…**.

![Generate a map](images/generate-dialog.jpg)

1. **Describe the map** in the box at the top, in plain words: *"a snowy fishing village on the coast with a lighthouse"*, *"flooded crypt full of zombies with secret doors"*, *"bandit ambush on a forest road"*, *"a busy tavern called The Rusty Anchor"*. Under the box, **Understood** shows what it picked up, and the matching settings below light up. Stuck for ideas? Click **Example**.
2. **Adjust anything** below: the type (Village, Dungeon, Wilderness, Building) and every setting. Typing in the description again re-reads it from scratch.
3. Click **Create new map**. It opens privately, and a message sums it up. Not right? **Reroll** makes a new one in place.

The description box reads key words (snowy, coast, walled, ruined, crypt, kobolds, swamp, tavern…) rather than whole sentences, and works without internet. Add *"called …"* to name the map.

| Type | Settings |
| --- | --- |
| Village | Setting (green, snowy, desert, swamp) · water (river, lake, coast) · layout (crossroads, one street, hamlet, walled town) · buildings · condition (thriving, lived in, ruined, with raiders) · trees · market, temple and graveyard, farms, mill, watchtower or lighthouse, docks, villagers |
| Dungeon | Style (stone halls, natural caves, crypt, mine, sewer, temple, lava forge, flooded) · rooms · corridor width · linear, branching or maze-like · traps · secret doors · boss room · monsters (goblins, kobolds, orcs, undead, beasts, cultists, bandits, or to suit the style) |
| Wilderness | Forest road, clearing, swamp, river crossing, mountain pass, desert oasis, snowy woods or coastline · cover · road · campsite, ruins, pond, cave entrance, shrine, wagon wreck · creatures |
| Building | Tavern or inn, temple, manor house, shop, guardhouse, wizard tower · size · lived in or abandoned · yard · people inside |

**Seeds:** after generating, the dialog shows the map's seed. Type that seed (with the same settings) to make exactly the same map again, for example to rebuild a map you deleted.

Monsters stay out of players' sight: under the fog until you reveal their area, or marked hidden if fog is off. Dungeons start fogged by default (the **Start with fog of war** box). Everything generated can then be edited with the normal tools: use Select to drag a box round a building and move it, or click any prop to move or delete it.

## Import a map

Made the map somewhere else? Click **Build map**, then **📥 Import map…** under Maps, or drag the file onto the map. It opens as a new private map.

| From | Export it as | What comes in |
| --- | --- | --- |
| **MapTool** | The campaign file (`.cmpgn`), or File → Export → **Map** (`.rpmap`) | Every map: map image and stamps (one picture), tokens with images and sizes, GM-layer tokens hidden, labels |
| **MapTool tokens** | Right-click a token → **Save As** (`.rptok`) | Goes into your token library (My uploads) |
| **Another Tabletop** | Build map → **📤 Export map** (`.ttmap`) | The whole map: images, walls, props, tokens, labels, notes and fog |
| **Dungeon Scrawl** | Export → **Universal VTT** (`.uvtt`, Pro) | Map, grid, walls and doors |
| **Dungeondraft, Dungeon Alchemist**, other map makers | **Universal VTT** (`.dd2vtt`, `.df2vtt`, `.uvtt`) | Map, grid, walls and doors |
| **Canvas of Kings** | Export → **PNG** or **WebP**, with the **square grid** turned on | The map; the grid is found from the lines |
| Dungeon Scrawl (free), Inkarnate, anything else | PNG, JPG or WebP | The map; the grid is found if it has grid lines |

**Walls:** with a Universal VTT map, **Reveal room** follows its walls: turn on Fog of war, pick Reveal room and click inside a room. It reveals the room and stops at walls and doors. In Build mode (and while using Reveal room) you see the imported walls in blue and doors in orange; players never receive them.

![An imported Universal VTT map in Build mode: walls in blue, the door in orange, one room revealed](images/import-walls.jpg)

**Images:** Tabletop looks for grid lines and sizes the map so the squares match, and tells you what it found. If it couldn't find a grid (or got it wrong), open **Background image**, type how many pixels one square is in the image and press **Fit grid**. Exporting from Canvas of Kings with the square grid showing gives the best result. Hex grids aren't supported yet.

**MapTool:** a campaign with several maps becomes several Tabletop maps. MapTool maps have no edges, so each map is cut to what's on it (up to 200 × 200 squares). Not imported yet: fog of war, vision blocking, lights, drawings and macros, so turn fog on and reveal as you go. Hex grids come in as squares. If something's missing or out of place, keep the MapTool file: it helps to improve the import.

**Sharing a map:** **📤 Export map** saves the map you're on, with its images, as one `.ttmap` file. Another DM imports it with Import map; it opens as a new private map.

Maps can be up to 200 × 200 squares, and images up to 100 MB.

## Build a map by hand

In **Build map** mode the tools are on the left; one square is 5 ft. The line under Undo/Redo says what the current tool does.

| Tool | Key | What it does |
| --- | --- | --- |
| Select | V | Drag tokens. Click a prop to move it, rotate it (Q), nudge it (arrows) or delete it (Delete). Drag a box over part of the map to select it: drag to move (hold Alt to copy), Delete to clear, Ctrl+C / Ctrl+V to copy and paste |
| Paint | B | Paint terrain; brush size 1, 2, 3 or 5 |
| Rectangle | R | Drag to fill a rectangle with the chosen terrain |
| Room | M | Drag a rectangle: floor inside, walls round the edge |
| Fill | G | Bucket-fill a connected area |
| Erase | E | Removes a prop if there is one, otherwise the terrain |
| Props | P | Click to place; Q rotates; clicking a placed prop of the same kind turns it |
| Token | K | Click to place a token set up in the Add tokens panel |

**Terrains** (keys 1–0 for the first ten): stone, cobblestone, wood, dirt, grass, sand, water, lava, pit, wall, marble, gravel path, farmland, snow.

**Props** come in five tabs (69 in all): Doors & windows, Furniture, Dungeon, Village, Nature.

**Secret doors and traps are visible to you only.** Put a secret door on a wall square. When the party finds it, erase the prop and paint floor plus a normal door.

A quick dungeon by hand: the Room tool for each chamber, Rectangle with cobblestone for the corridor, Paint with stone over the walls where the corridor meets them, then a Door prop in each gap.

**Using an existing battle map:** under Background image, click **Upload image** or drag a PNG or JPG onto the map. The grid sizes itself if the image uses a common square size (70, 100, 140 px…). If the lines don't match, type the image's pixels per square and click **Fit grid**. You can paint and place props on top.

Ctrl+Z undoes, Ctrl+Y redoes. Pan with right-drag or Space+drag, zoom with the mouse wheel, press Home to fit the map.

## Tokens

Click **Token library…** in the right-hand panel: 215 ready-made tokens in categories, searchable by name. Click one, then **Add to map** (it lands in the middle of your view) or use the Token tool to click it into place. Each comes at a sensible size (dragons are Huge). Names count up by themselves: Goblin 1, Goblin 2…

![Token library](images/token-library.jpg)

- **Your own token art:** in the library, click **Upload images…** (pick many at once), or drag image files onto the map in Play mode. They're kept under **My uploads**. Token packs you've bought work this way.
- **Owner** decides who can move a token: a player's name (only them, and you), `*` (anyone), or empty (only you: monsters and NPCs).
- **Click any token** to edit it in the Selected token panel: name, art, colour, owner and size. **Duplicate** copies it with the next number. Delete removes it.
- **Hidden from players:** a hidden token shows faded with a dashed ring on your screen only. Untick to reveal it. Tick **Add hidden** before adding to place an ambush.

## Combat

![Combat](images/combat.jpg)

**Start:** click **⚔ Start combat** at the top of the right-hand panel. Every token on the map joins; remove anyone who isn't fighting with ✕, or add more later with **+ Selected** (or **⚔ Add to initiative** on a selected token).

**Roll initiative:** **🎲 Roll for monsters** rolls 1d20 + initiative bonus for every monster without a score (your rolls stay private). Players click 🎲 next to their name or type their score; you can type anyone's. The list sorts itself, highest first.

**Run turns:** **Next turn ▶** moves down the list and starts the next round at the bottom; **◀** goes back. Whose turn it is glows gold on the map. Click a name to select that token and bring it into view. **End combat** (click twice) clears the tracker.

**Hit points:** select a token to see its HP box. Library monsters come with their standard HP and initiative bonus; for others, type HP and max HP. To hurt or heal, type the amount and press **Damage** or **Heal** (Enter = damage, Shift+Enter = heal). Temporary HP soaks damage first. At 0 HP a token is darkened and crossed out.

**What players see of HP** is set per token under **Players see**: HP numbers, a health bar only, or nothing. By default player characters show numbers and everything else shows a bar.

**Conditions:** click the icons under Conditions to toggle them; they appear on the token and in the initiative list.

**Players** click their own token to get the same HP box for their character: they can track their own damage, temp HP, initiative bonus and conditions (but nobody else's). Monsters they can't see (hidden, or in the fog) don't appear in their initiative list.

## Table tools

The bar on the left of the map in Play mode has the tools you and the players use during play. `Esc` always goes back to **Move**.

| Tool | Key | What it does |
| --- | --- | --- |
| Move | V | Drag tokens. Dragging a token shows how far it has moved; press `Space` mid-drag to add a corner |
| Ruler | R | Drag to measure in feet; `Space` adds a corner. Everyone sees it while you measure |
| Spell | T | Spell templates: cone, sphere, cube, line, cylinder (see below) |
| Ping | P | Click to flash a spot for everyone. `Shift`+click also moves everyone's view there. `Alt`+click pings with any tool |
| Label | L | Text on the map, and notes only you can see (see below) |

**Diagonals:** by default every square counts 5 ft, diagonals too (the 5e rule). For the 5 / 10 / 5 variant, set **Ruler diagonals** in Build map → map settings. It's per map.

**Spell templates:** pick the shape in the bar at the bottom of the map. Drag from where the spell starts and let go: the drag sets the direction and size (a sphere's or cylinder's drag sets its radius; a cube goes from one corner to the opposite one). Or type the size and just click. The squares it covers are shaded. Click a template to select it: drag to move it, drag its dot to re-aim or resize, `Del` removes it. You can change or remove anyone's; **Clear all** removes every template on the map. Players' templates are in their own colour, with their name when selected.

**Labels and notes:** with the Label tool, click the map, type the text, pick a size and press Enter. Tick **DM note** for something only you see (shown as a yellow sticky note): trap DCs, what's in the chest, reminders. Drag a label to move it; click it to edit or delete it. With fog of war on, players see a label once its square is revealed.

Players' moves and rulers show on your screen too. Your own token moves aren't shown to players, so dragging a monster in the dark gives nothing away (your ruler and pings are shown).

## Dice

Everyone rolls in the right-hand panel: the die buttons, or type any roll such as `2d6+3`, `4d6kh3` or `d100`. Rolls happen on your PC, so nobody can fudge them, and everyone sees the log. Tick **Roll privately** for rolls players shouldn't see; a player's private roll is seen only by them and you.

Each player can save **quick rolls** (e.g. "Longsword hit" `1d20+5`), copying bonuses from D&D Beyond once. Shift-click rolls with advantage, Alt-click with disadvantage. Natural 20s show green, natural 1s red.

## Not in this version yet

Importing MapTool campaigns, and player passcodes. Players are identified only by name, so anyone typing another player's name gets their view: fine for a trusted group.
