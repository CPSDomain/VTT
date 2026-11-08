<p align="center"><img src="docs/images/banner.jpg" alt="Tabletop: a self-hosted virtual tabletop for D&D"></p>

<p align="center">
  <a href="https://github.com/CPSDomain/VTT/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/CPSDomain/VTT?label=latest%20release&color=e8390e"></a>
  <img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows-1f1f1f">
  <a href="CHANGELOG.md"><img alt="Changelog" src="https://img.shields.io/badge/changelog-what's%20new-ff6b35"></a>
</p>

<p align="center">
  <b><a href="https://github.com/CPSDomain/VTT/releases/latest">⬇ Download the latest version</a></b> &nbsp;·&nbsp;
  <a href="docs/DM-GUIDE.md">DM guide</a> &nbsp;·&nbsp;
  <a href="docs/PLAYER-GUIDE.md">Player guide</a> &nbsp;·&nbsp;
  <a href="CHANGELOG.md">What's new</a> &nbsp;·&nbsp;
  <a href="docs/ROADMAP.md">Roadmap</a>
</p>

---

**Tabletop** is a virtual tabletop for your own D&D group. The DM runs **Tabletop DM** on their PC: it hosts the game, builds maps and runs the session. Players connect with **Tabletop Player** (or any web browser) over the local network or Tailscale. No accounts, no subscriptions, no cloud: the table lives on the DM's PC.

D&D Beyond stays the character manager; maps, tokens and dice live in Tabletop.

![The map builder with a generated village](docs/images/builder-village.jpg)

## Download

Get the latest Windows build from the **[Releases page](https://github.com/CPSDomain/VTT/releases/latest)**:

| File | For | How |
| --- | --- | --- |
| `Tabletop-DM-<version>-Windows.zip` | The DM | Unzip anywhere, run **Tabletop DM.exe** |
| `Tabletop-Player-<version>-Windows.zip` | Each player | Unzip anywhere, run **Tabletop Player.exe** |

Nothing to install. The first time, Windows SmartScreen says "Windows protected your PC" because the apps aren't code-signed yet: click **More info → Run anyway**. The DM must also click **Allow** on the firewall prompt so players can connect.

What changed in each version: **[CHANGELOG.md](CHANGELOG.md)**. What's coming: **[Roadmap](docs/ROADMAP.md)**.

## Getting started

1. **DM:** start Tabletop DM. The address players need (e.g. `192.168.1.20:3000`) is at the top right, with a Copy button.
2. **Players:** start Tabletop Player, type that address and your name, and click Connect. Use the same name every session: the DM gives tokens to names.
3. **Playing online?** Everyone installs [Tailscale](https://tailscale.com) (free) and joins the DM's network; players then use the DM's Tailscale address.

Full walkthroughs: **[DM guide](docs/DM-GUIDE.md)** · **[Player guide](docs/PLAYER-GUIDE.md)**

## Features

**Map building**
- **Describe it, and it's generated:** type *"snowy fishing village on the coast with a lighthouse"* or *"kobold mine with a dragon's lair"* and the generator picks the settings, which you can adjust. Villages (green, snowy, desert or swamp; river, lake or coast; walled towns, hamlets, ruins), dungeons (stone halls, caves, crypts, mines, sewers, temples, lava forges, flooded halls), wilderness (forests, swamps, river crossings, mountain passes, oases, coastlines) and building interiors (taverns, temples, manors, shops, guardhouses, wizard towers). Seeds let you make the same map again.
- Tools: paint, rectangle, room (floor plus walls in one drag), bucket fill, erase, props, tokens, with undo and redo
- **Select tool:** move, rotate, nudge or delete any prop; box-select part of the map to move it, copy it (Alt-drag or Ctrl+C / Ctrl+V) or clear it
- 14 terrains and 69 props: doors, double doors, secret doors, portcullises, windows, furniture, dungeon dressing, village pieces and nature
- Upload your own battle maps (or drag them on) and line the grid up with them
- Build maps privately, then **Show to players** when ready

| Describe it | Get it |
| --- | --- |
| ![The Generate dialog with a description and the settings it picked](docs/images/generate-dialog.jpg) | ![Six generated maps: snowy fishing port, walled desert town, kobold mine, sewer maze, desert oasis, tavern interior](docs/images/generator-variety.jpg) |

**Fog of war, and what players see**
- Turn on fog of war and players see only what you reveal. **Reveal room** opens a whole room with one click, stopping at doors; brushes reveal or cover by hand
- Nothing under the fog, and no secret door, trap or hidden monster, is ever sent to players' screens
- Monsters in the dark are invisible to players until they step into the light, or you reveal their room
- Generated dungeons can start fogged with only the entrance showing

| DM's view | Player's view |
| --- | --- |
| ![DM view: the whole dungeon, unrevealed areas shaded, kobolds and secret doors visible](docs/images/fog-dm.jpg) | ![Player view: only the revealed rooms, everything else dark](docs/images/fog-player.jpg) |

**Tokens**
- A library of 215 ready-made tokens: dragons of every colour, kobolds, goblinoids, humanoids, undead, beasts, giants and monsters, fiends and fey, villagers, farm animals, hero classes
- Upload your own token art (several files at once, or drop images on the map), saved for reuse
- Edit any token: name, art, colour, owner, size. Hide it from players and reveal it later
- Players can move only their own tokens

![Token library](docs/images/token-library.jpg)

**Combat**
- Initiative tracker: start combat in one click, roll for all monsters at once, players roll their own; turn order, rounds, and whose turn glows on the map
- Hit points with damage and healing buttons, temporary HP, health bars on tokens; choose per token whether players see numbers, a bar, or nothing
- 24 conditions shown as icons on tokens; players manage their own character's HP and conditions
- 88 library monsters come with their standard HP and initiative bonus

![Combat: initiative order on the right, whose turn glows gold, health bars and condition icons on tokens](docs/images/combat.jpg)

**Dice**
- Rolled on the DM's PC so nobody can fudge them: `1d20+5`, `2d6+1d4-1`, `4d6kh3`, `1d20adv`, `d100`
- Saved quick rolls per player (copy bonuses from D&D Beyond once), private rolls, natural 20 and 1 highlighted

## Building from source

Needs Node.js 18 or newer.

```bash
git clone https://github.com/CPSDomain/VTT.git
cd VTT
npm install
npm run dm          # run the DM app from source
npm run player      # run the Player app from source
npm run server      # headless server, no window: DM_KEY=secret PORT=3000 node server.js
npm run build:win   # build the Windows zips into dist/
npm run release     # gather the zips and release notes into dist/release/
```

How a new version is cut: [docs/RELEASING.md](docs/RELEASING.md).

### Project layout

| Path | What's there |
| --- | --- |
| `src/` | The game server (Node.js + WebSocket). Owns all game state and checks every action |
| `public/` | The table itself: HTML, canvas rendering, map art, generators, token art |
| `apps/dm`, `apps/player` | The two desktop apps (Electron) |
| `build/` | Packaging config, app icon, token library builder |
| `scripts/` | Release helper |
| `docs/` | Guides and screenshots |

The DM app makes a new secret key each time it starts and gives it only to its own window; that key is what makes a connection the DM. Saves live in `%APPDATA%\Tabletop DM\data` on Windows.

## Credits

Built-in token artwork is from [game-icons.net](https://game-icons.net) by Lorc, Delapouite and contributors, licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). See [public/CREDITS.txt](public/CREDITS.txt). Map textures and props are drawn in code by Tabletop.
