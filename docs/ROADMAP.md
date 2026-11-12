# Roadmap

What Tabletop has, what's coming next, and what's on the wish list. The order is a proposal: change it to match what the group needs most. Each version's details go in the [changelog](../CHANGELOG.md) when it ships.

Status: ✅ done · 🔨 in progress · 📋 planned · 💬 to discuss

## Done

| Version | What shipped |
| --- | --- |
| 0.1–0.2 | Shared grid map, tokens with owners, server-side dice, quick rolls, private rolls, nat 20/1 |
| 0.3 | Desktop apps (DM and Player), map builder, image maps, multiple maps with private prep |
| 0.4 | 69 props, token library (215 tokens + uploads), hidden tokens, map generators, Select tool for map pieces |
| 0.5 | Fog of war with Reveal room, brushes, and nothing hidden sent to players |
| 0.6 | Map generator v2: describe the map in words, many more settings, dungeon styles, wilderness kinds, building interiors, seeds |
| 0.7 | Combat: initiative tracker, HP with damage/heal and per-token visibility, 24 conditions, monster stats |
| 0.8 | Table tools: ruler with corners and movement distance, spell templates, ping, map labels and DM notes |
| 0.9 | Map import: Universal VTT (Dungeon Scrawl, Dungeondraft, Dungeon Alchemist) with walls for Reveal room; map images (Canvas of Kings) with automatic grid finding |
| 0.10 | MapTool import (campaigns, maps, tokens), export and import single maps, restore from backup |
| 1.0 | Table passcode, remove and block players, update check, Windows installers, automatic builds on GitHub, macOS and Linux apps |
| 1.1 | Lighting and vision (line of sight, lights, darkvision, doors, explore-to-reveal, DM preview), handouts; Windows only |
| 1.2 | Chat and whispers with speech bubbles, the DM speaking as NPCs, D&D Beyond links on characters, player PINs |
| 1.3 | MapTool import part 2: revealed fog, vision blocking as walls, lights, sight, Day/Night vision, drawings |
| 1.4 | Encounter builder with the SRD monsters and 2024 difficulty, stat blocks with clickable rolls, buildings with floors and stairs |
| 1.5 | Atmosphere: music and ambience the DM plays for everyone (12 built in, plus your own files), each map's own sound, weather and time of day on the map |
| 1.6 | New look: light and darkness with flickering fire and soft shadows, living fire, water and lava; playing over the internet with automatic port opening (UPnP) and a port of your choice; one-click updates |
| 1.7 | New map art: natural edges between kinds of ground, detailed textures, walls with height, shaded props, rounded rock walls for caves, token rims |
| 1.8 | Immersion: dice rolling on screen with skins (and your own picture), DM rolls kept secret, sound from the map (fires, water, doors, footsteps, blows), read-aloud text, scene title cards, spell effects, tokens that react to hits, healing and conditions |
| 1.9 | Characters from D&D Beyond: players bring in their character, place their own token and roll from their sheet; coins, inventory and spells (1.9.1) |
| 1.10 | More immersion: moods (magical darkness, blood moon), lightning and earthquakes, turn banner, look here, a living map, remembered places and black-and-white darkvision, chests and traps, full-screen handouts |

## Next

The wish list, in the order we plan to build it. Each phase is one release; the order can change if the group needs something sooner.

### Later — more map art 📋
Left over from the 1.7 plan:
- **Your own asset packs (optional):** point Tabletop at a folder of PNG tiles and props you own (Forgotten Adventures, Tom Cartos and the like) and use them in the build palettes. They stay on your PC; Tabletop can't ship them.
- **Portrait-style tokens** from uploaded art.

### 1.11 — A bigger map generator 🔨
- More kinds of places, more control over the result, and maps that come ready to play: built in, no internet or API key.
- Ideas to choose from: ships, castles, sewer networks, caverns with underground lakes, graveyards, mines with cart tracks, city blocks; buildings and dungeons with several floors (stairs between them); settings for room count and size, twisty corridors, doors, secret doors, traps and clutter; monsters for the party's level from the SRD, treasure, room names and DM notes; lighting, time of day, weather and sound set to fit.
- **To settle first:** which of these the group wants most.

### Parked — AI map generation
- Claude designing a map from a free-text description (needs internet and an Anthropic API key). Parked in favour of the bigger built-in generator; can come back later.

## Not planned

Decided against, so they're off the list:
- **Code signing** (no more "Windows protected your PC"): needs a paid certificate
- **Tablet support** (touch controls for players)
- **Adventure import** from the TaleSpire DM agent
- **macOS and Linux apps**: Tabletop is built for Windows

## Suggesting things

Open an issue on GitHub, or add it to this file as a new phase.
