# Changelog

All notable changes to Tabletop. Newest first. Each version's section is used as the release notes on GitHub.

## [1.13.0] - 2026-11-12

### Added
- **Spells land on the map straight away.** Click **Cast** on a spell that heals, hurts or protects, click the tokens it's for (or **Me**, or **In my area** for every token inside your placed template), then **Apply**. Tabletop spends the slot, rolls once with dice on everyone's screen, and changes hit points at once:
  - **Healing** (Cure Wounds, Healing Word, Mass Cure Wounds, Prayer of Healing…) adds the roll plus your spellcasting modifier, up to each target's maximum, and gets an unconscious character back up.
  - **Temporary hit points** (False Life, Heroism…) and **Aid**'s higher maximum.
  - **Attack spells** (Fire Bolt, Guiding Bolt…) roll to hit against each target's AC; a natural 20 doubles the damage dice.
  - **Save spells** (Fireball, Sacred Flame…) roll the damage once and make each target's saving throw against your DC: half damage on a save where the spell says so. Monsters use their stat block's saves, players their character's.
  - Monsters' **resistances, immunities and vulnerabilities** count (an imp shrugs off Fireball). Temporary hit points soak damage first.
  - The log says who was hit, healed or saved. Monsters' hit points and saving throw rolls stay hidden from players, only the outcome shows.
- **Class features** under **My character → Spells → Class features**, from D&D Beyond: Lay on Hands (pick who and how many hit points from the pool), Second Wind, Channel Divinity, Focus/Ki points, Sorcery Points, Bardic Inspiration, Action Surge, Rage, Wild Shape and others with limited uses. Short and long rests bring them back.
- Healing spells that D&D Beyond only describes in words are read from their description too.

## [1.12.0] - 2026-11-12

### Added
- **Spells for players**, from their D&D Beyond character (click **↻ Update from D&D Beyond** once to bring them in):
  - **Spell slots** (and a warlock's pact magic) as pips under **My character → Spells**: click one to mark it used or get it back.
  - **Every spell opens** to show its school, casting time, range, duration, components, save and description.
  - **Cast** uses the lowest free slot at the spell's level, or pick a higher slot to upcast; the log tells the table what was cast (and the save DC). **As a ritual** casts without a slot. Racial and feat spells count their own uses.
  - **The spell's rolls:** spell attacks, damage with its type, healing. Damage and healing grow with the slot you pick, and cantrips with your level.
  - **◎ Area** picks the Spell tool with the spell's shape, size and effect (Burning Hands: a 15-ft cone of fire) so you just drag it into place.
  - **Concentration** spells put the concentrating ring on your token.
  - **☾ Short rest** brings back pact slots; **⛺ Long rest** brings back every slot and your hit points, and ends concentration. Both show in the log.
- The DM sees each player's slots in **🎒 Inventory and spells…**.

## [1.11.0] - 2026-11-12

### Added
- **New kinds of places** in **Generate a map…**:
  - **Ship:** a merchant ship, warship or longship at sea or at the docks: masts, cannons, the wheel, cargo, a boat alongside or a gangplank to the pier; sailors, pirates, sea raiders boarding or a ghost crew; and its **hold** below decks (cargo, hammocks, the brig) as a second floor.
  - **Castle:** curtain walls with corner towers, a gatehouse with a portcullis over the moat, a courtyard with stables, barracks, a smithy and a well, and the keep with its great hall, the lord's chambers and an upper floor. Held, ruined or under siege.
  - **Graveyard:** rows of graves round crossing paths, a chapel, a mausoleum with a **crypt** below, open graves, dead trees and lamps, at night in the fog, with restless dead.
  - **City streets:** blocks of houses, shops, taverns and smithies round a plaza (a fountain, a market), in the market, noble, slums or docks district, with thieves, a cult or the watch.
- **Dungeons:** two or three **levels** with stairs between them, **room size**, **twisty corridors**, how many **doors**, **clutter**, an **underground lake** in caves and **cart tracks** with mine carts in mines.
- **Buildings** can have an **upstairs**, a **cellar** (a crypt under a temple) or both.
- **Ready to play:** set the party's level and size and how hard the fights are, and the monsters come from the SRD, sized to the D&D 2024 XP budget, with hit points, initiative and stat blocks. **Treasure in chests** for the party's tier, and **room names & DM notes** in every room.
- **Set the mood:** generated maps come with the lighting, time of day, weather and sound that suit them (dark dungeons with vision on, a foggy graveyard at night, waves for a ship, music for a tavern). The sound plays when you show the map.
- New props: mast, cannon, ship's wheel, anchor, hammock, mine track and mine cart (Build mode → **Ships & mines**).
- The description box understands the new places: *"a pirate ship at sea in a storm"*, *"ruined castle full of undead"*, *"dwarven mine with cart tracks, three levels deep"*.

## [1.10.0] - 2026-11-12

### Added
- **Moods and moments** (🌦 Weather): **🌑 Magical darkness** sinks the whole map into black, **🩸 Blood moon** casts it red; **⚡ Lightning** flashes every screen white before the thunder rolls, **🌋 Earthquake** shakes it with a deep rumble.
- **Turn banner:** when combat moves on, everyone sees whose turn it is; on your own turn a big "Your turn, Thorin" appears with a chime.
- **Look here:** the DM's Shift+click with the Ping tool now glides every player's view to the spot, with a note saying the DM wants them to look.
- **A living map:** cloud shadows drift over open country and birds fly across by day, fish swim in ponds and rivers, a rat now and then runs along a dungeon wall, and moths circle torches and lamps at dusk and night. (On **Lit and moving** only.)
- **Places you've seen:** with fog of war and vision, areas your character explored but can't see right now stay on screen in faded grey, instead of going black.
- **Darkvision in black and white:** what a character sees by darkvision in the dark is shown without colour, as the rules describe it.
- **Chests and traps:** click a chest with the **Door** tool to open it (the lid flies back, gold glints, coins jingle) or close it. The DM clicks a trap with the Door tool to spring it: spikes shoot up with a snap for everyone to see.
- **Full-screen handouts:** a handout the DM shows fills each player's screen for a moment (picture, title and text on parchment), then waits under Handouts.

## [1.9.1] - 2026-11-12

### Added
- **Coins, inventory and spells from D&D Beyond.** **My character** now shows your platinum, gold, electrum, silver and copper; everything you carry, with quantities, what's equipped or attuned, rarity, and what's in which bag; and your spells by level (cantrips first), marked concentration, ritual or not prepared. Click **↻ Update from D&D Beyond** to bring them in for a character you imported with 1.9.0.
- **The DM can look:** select a player's token and click **🎒 Inventory and spells…** to see their character's coins, gear and spells.

### Fixed
- The DM guide still said a token at 0 HP is crossed out; it falls over now.

## [1.9.0] - 2026-11-12

### Added
- **Bring in your character from D&D Beyond.** In Tabletop Player, **My character** takes your character's link and fills in your name, portrait, level, race and class, hit points, AC, speed, initiative and darkvision.
  - **📍 Put my token on the map** places your token (with your portrait, hit points, initiative bonus and darkvision) in the middle of your view, or updates it if it's already there. No more waiting for the DM to make it.
  - **Every roll on your sheet** is a button: attacks (to hit and damage, magic weapons included), spell attack and save DC, ability checks, saving throws and all 18 skills. Shift-click for advantage, Alt-click for disadvantage. **🎲 Init** rolls initiative.
  - **↻ Update from D&D Beyond** after levelling up or changing gear.
  - The DM sees the character's AC, passive Perception and speed on its token.
  - The character must be public on D&D Beyond, and the DM's PC needs the internet to fetch it. D&D Beyond has no official way for apps to do this, so Tabletop reads the same data its character sheet uses; if D&D Beyond changes it, this may need an update. Damage taken in Tabletop doesn't go back to D&D Beyond.

## [1.8.2] - 2026-11-12

### Fixed
- **Players didn't hear the map:** the sound on a player's screen only started once they clicked something (or the DM played music). Tabletop Player now starts it as soon as it joins, so torches, fires, water and lava are heard straight away.
- **Read-aloud text:** the big first letter is gone (it split short lines like "alone" into "a lone"). Short lines sit in the middle of the page.

## [1.8.1] - 2026-11-12

### Changed
- **Map sounds have their own volume:** 🔊 → **Map sounds** sets how loud torches, fires, water and lava are on your screen (0 turns them off), apart from **Effects** (dice, doors, blows, spells, footsteps). Every player sets their own.
- **Map sounds are quieter** to start with (60%), and torches, fires, water and lava carry less far.

## [1.8.0] - 2026-11-12

### Added
- **Dice that roll on screen:** real dice (d4 to d20, and d100 as two d10s) are thrown across the map, bounce, tumble and land on the result, with the total and the roll's name. A natural 20 bursts gold with a fanfare, a natural 1 goes red. Dice dropped by advantage or keep-highest fade out.
  - A player's roll rolls on everyone's screen; a private roll only on theirs and the DM's.
  - **The DM's rolls are now the DM's alone**, on screen and in the log. **Show this roll to the players** shows one.
  - **My dice…**: twelve sets to choose from, or your own picture wrapped round your dice. Everyone sees your dice your way.
- **Sound from the map:** torches and braziers crackle, campfires and fireplaces burn, water runs and lava bubbles, louder the closer your character is. Doors creak open and shut, blows land when a token loses hit points, healing chimes, and footsteps follow tokens over stone, wood, grass, dirt and water. New **Effects** volume under 🔊.
- **Read aloud:** the DM's 📜 button shows text in the middle of every player's screen like a page from a book.
- **Scene changes:** showing players a new map fades their screens to black and names the place before the new map fades in.
- **Spell effects:** pick an effect for a spell template (fire, lightning, cold, acid, thunder, necrotic, radiant, poison, force, psychic, healing) and it goes off for everyone, with its sound. **Cast** sets it off again.
- **Tokens react:** a red flash and a flinch when hit, a green glow when healed, with the numbers floating up where you may see them. A token at 0 HP falls over in a pool of blood; prone, unconscious and dead tokens lie down. Burning, poisoned, raging, blessed, hasted, concentrating, frightened, invisible, petrified and bleeding tokens show it.

### Changed
- A token at 0 HP no longer gets a red cross: it lies down instead.

## [1.7.2] - 2026-11-12

### Fixed
- **Piers and bridges looked under water:** the moving ripples of light on water were drawn over the planks too. They now stay under any bridge or pier, and the glow of lava stays under bridges over lava.
- **Shorelines sit on the squares again:** with the 1.7 art, grass and sand spread a little over the edge of water, so water squares next to land (and the end of a pier) could look like land. Water and lava now keep their own soft edge on the line between squares, so what looks like water is water.

## [1.7.1] - 2026-11-11

The new map art. (1.7.0 was never released: its tag was typed with a capital V, so nothing was built. 1.7.1 is that version, plus the fix below.)

### Added
- **New map art** (the look from the Map Art Lab):
  - **Natural edges instead of squares:** grass, dirt, sand, snow, water, lava and pits spread into their neighbours with soft, uneven edges. Built floors (stone, wood, marble, cobbles, farmland) stay straight. The grid stays for movement and rules; only the drawing changes, on every map you already have.
  - **Detailed ground:** new seamless stone flags, cobbles, marble, planks, grass, dirt and more, with scattered detail (grass tufts, flowers, pebbles, cracks, moss). Water gets darker towards its banks with a little foam where it meets land.
  - **Walls with height:** a cast shadow on the floor and a visible front face on walls that face into a room.
  - **Props with shading** and a soft contact shadow.
  - **Rounded rock walls for caves:** generated natural caves use them by themselves; any map can switch under **Map settings → Walls look** (built or natural rock).
  - **Tokens:** gold rims for players' characters, iron for monsters and NPCs, name tags as small labels.
- The map is drawn in blocks in the background, so panning and animation stay smooth on big maps; until a block is ready, that part shows the classic drawing for a moment.

### Changed
- **🔊 → Map look → Classic** still gives the square-by-square look from before 1.6, for slow PCs. Picture maps (imported images) look as before.

### Fixed
- **Releases:** a version tag starting with a capital `V` (`V1.7.1`) now builds and publishes the release too, still as `v1.7.1`. The apps' update check accepts either.

## [1.7.0] - 2026-11-11

Not released (see 1.7.1).

## [1.6.2] - 2026-11-09

### Fixed
- **Playing over the internet: the internet address now shows even when the router doesn't say it.** Some routers open the port but don't answer when asked for their address; Tabletop DM now looks it up from a public "what's my IP" service (ipify, or Amazon's checkip) and shows it under **Connection** and at the top right.
- **It checks the address works:** Tabletop DM tries to reach the table at that address. When it can, it says players outside can reach it; when the router doesn't allow checking from inside the network, it says so (**🌐 Online?**) and how to test it once (canyouseeme.org, or a phone on mobile data).
- **Two routers in a row** (a provider's box in front of your own router, or an address shared by your provider) are now spotted by comparing the router's address with the one the internet sees, with an explanation of what to do.

## [1.6.1] - 2026-11-09

### Fixed
- **The installers could close straight after "Windows protected your PC" and install nothing** (even with Run as administrator; Windows logged a crash in System.dll). The cause was a bug in the installer template that comes with the build tools: it read past the end of the Programs folder's name. The faulty lookup is removed; Tabletop still installs to the same place (`%LOCALAPPDATA%\Programs`) unless you choose another folder.

## [1.6.0] - 2026-11-09

### Added
- **A new look for maps:** light and darkness.
  - **Light:** torches, braziers, campfires, fireplaces, candles, lamp posts, crystals, lit tokens and imported maps' lights throw flickering light that fades with distance, using the rules' ranges.
  - **Shadows:** walls, closed doors and imported walls block the light. Pillars, statues, trees and tents cast soft shadows.
  - **Movement:** flames move and throw sparks, braziers and campfires smoke, water ripples, lava glows and lights the room, dust floats in the torchlight, and fireflies come out at dusk and night.
  - **Tokens:** they cast a shadow away from the nearest light and are shaded by the light they stand in.
  - **How dark it gets:** from the map's light setting (bright, dim, dark) and the time of day. Daytime maps look as before, with live fires.
  - **It's only the look:** what characters can see still follows vision exactly as before, and a player's screen shows light only where their character can see.
  - **Each screen chooses its look** (**🔊 → Map look**): lit and moving, lit with nothing moving (for slower PCs), or classic.
- **Playing over the internet:**
  - Tabletop DM asks the router to open its port (UPnP), keeps it open while the table runs and closes it on exit.
  - **🌐 Online** at the top right shows the internet address to give players.
  - When the router won't open the port, the app says why: UPnP off, a port already taken, or an address shared by the internet provider. It also says what to do about it.
- **Choose the port:** players count → **Connection**. The table moves there straight away and the port is remembered. Opening the port on the router can be switched off there too.
- **One-click updates:** **Update now** downloads the new installer for that app (DM or Player), closes the app and runs it. Copies run from the unzipped folder still open the download page.

### Changed
- Maps draw faster: the parts that don't move are kept between frames.
- Imported maps' lights now reach players' screens (only where their character can see) so the light looks the same for everyone.

### Fixed
- Quitting with **File → Exit** now saves the table and closes it properly, like closing the window.
- A port that's already in use no longer pops up an error box when Tabletop DM starts or changes port.
- "Players connect to" at the top right had no space before the address.

## [1.5.0] - 2026-11-09

### Added
- **Music and ambience** (**🔊** at the top right): the DM plays it and everyone's screen plays it, all at the same point in the loop. Changes fade smoothly.
  - **Built in:** 4 music tracks (Exploration, Tavern jig, Battle, Dungeon dread) played on sampled instruments, and 8 ambiences (Rain, Thunderstorm, Wind, Campfire, Dripping cave, Ocean shore, River, Night crickets). All made for Tabletop, and each loops without a gap.
  - **One music track plus up to 5 ambiences at once**, each with its own volume for everyone. **🎧** lets the DM listen to a sound on their own screen before playing it.
  - **Your own sounds:** **＋ Add your own…** uploads MP3, OGG, WAV, M4A or FLAC files from your PC. Long tracks stream, so a full album is fine. You can rename them, move them between music and ambience, or remove them.
  - **A map's own sound:** **Save what's playing** remembers it for the map, and with **Play it when I show this map to players**, it starts when you show the map.
  - **Everyone sets their own volume:** everything, music and ambience separately, or mute.
- **Weather and time of day** (**🌦 Weather** in the bar above the map): rain, storm with lightning, snow, fog or embers, light, medium or heavy, over the map on everyone's screen.
  - Dawn, dusk and night colour the map, and torches, fires, lamps and lit tokens throw warm pools of light.
  - **Play matching sound** adds the ambience that goes with it.
  - Players can turn the moving weather off on their own screen.
  - It's a look only: what characters can see still follows **👁 Vision**.
- Exported maps keep their weather, time of day and built-in sounds.

### Changed
- The server now streams files, so it can jump around in long sound tracks.

The music is played on the FluidR3 GM soundfont by Frank Wen (MIT licence).

## [1.4.0] - 2026-11-09

### Added
- **Encounter builder** (**⚔ Encounter builder…** under Add tokens): the 334 monsters of the SRD 5.1, searchable by name or kind and filtered by challenge rating. Add monsters with **+**, set the party (how many characters, what level), and a meter shows the difficulty from the D&D 2024 XP budget: Low, Moderate, High or beyond. **Place on the map** drops them near the middle of your view on free squares, numbered, with average or rolled HP, their initiative bonus, and hidden if you like. **Save** keeps an encounter to use again.
- **Stat blocks:** click a monster's name in the builder, or select a monster on the map and click **📖 Stat block**. Attacks (**+4 to hit**), damage (**1d6 + 2**), hit dice and ability checks are buttons that roll (privately, unless you untick it). Works for library tokens with an SRD name too (a "Goblin 3" finds the Goblin).
- **Floors:** with the **＋ Floor above** / **＋ Cellar** buttons at the top, a map becomes a building with floors (same size, its own walls, fog and lights). Switch between floors with the floor buttons.
  - **Stairs:** a character dropped on stairs, a ladder or a trapdoor is offered the floor above or below. The DM can move any token with the **Floor** box in the token panel.
  - **Each player sees the floor their character is on**, so the party can split up; anyone without a character there sees the floor you showed. Other floors of the building you've shown are marked **IN PLAY**.

### Changed
- The GitHub build retries when a download times out, keeps its downloads between runs, and uses current versions of GitHub's actions.

Monster data from the SRD 5.1 by Wizards of the Coast, licensed under CC BY 4.0, prepared by the 5e-database project.

## [1.3.0] - 2026-11-08

### Added
- **MapTool import, part 2.** Campaigns and maps from MapTool now bring across much more:
  - **Fog of war:** what had been revealed in MapTool (for the party and each token) stays revealed; the map starts with fog on if it had fog.
  - **Walls:** vision blocking (VBL) and the wall lines of newer MapTool versions become walls, used by line of sight and by Reveal room. In Build mode you see them in blue.
  - **Lights:** light sources on tokens (torches, lanterns, the campaign's own lights) become token lights; lights on stamps and hidden tokens light the map. In a single map file (`.rpmap`), which doesn't carry the campaign's light list, a lit token gets a torch.
  - **Sight:** tokens with a darkvision sight type get darkvision 60 ft.
  - **Vision:** a map set to Day or Night vision in MapTool comes in with vision on, bright or dark.
  - **Drawings:** lines, rectangles, ovals, crosses and shapes on the Background, Object and Token layers are painted into the map picture (GM-layer drawings and spell templates are left out).
- With vision and fog of war on, the fog now catches up with what the party can see as soon as a map is shown or a player joins.

## [1.2.0] - 2026-11-08

### Added
- **Chat** at the bottom of the right-hand panel: type and press Enter. Messages go in the log with the rolls, and a speech bubble appears over the speaker's token for a few seconds.
  - **Whispers:** pick a player (or the DM) under **To**, or type `/w Bob meet me by the door`. Only they and the DM see it, and they get a pop-up.
  - **The DM speaks as NPCs:** choose **As the Innkeeper** (any token on the map without an owner) or **As the Narrator**. Players see the NPC's name and a bubble over that token.
  - `/r 1d20+5` rolls from the chat box.
  - Chat is kept with the rolls (the last 200 entries); players who join later see the table talk, but not whispers between others.
- **D&D Beyond link** on each character: select the token and paste the character's D&D Beyond address. Then **📜 Sheet** in the token panel, the 📜 in the initiative list, or double-clicking the token opens the sheet (in the normal browser). Players can set it on their own characters.
- **Choose where to install:** the installers ask for the install folder again (they still install just for you, with no admin rights). If you have 1.1.1 installed, the new version replaces it; if you end up with two in Settings → Apps, uninstall the older one.
- **Player PINs:** a player clicks **Playing as …** at the top right to protect their name with a 4 to 8 digit PIN. Nobody else can then join under that name; their own app remembers it. The DM sees protected names under **Who can join** and can **Reset PIN** for a player who forgot it. PINs are stored only as salted hashes.

## [1.1.1] - 2026-11-08

### Fixed
- **The Windows installers did nothing when double-clicked** on some PCs (they only worked with Run as administrator). They now install in one step, for you, in your own user folder, with no questions and no admin rights, then open the app. The DM and Player apps also get their own install folders. If you installed an earlier version with Run as administrator, uninstall it first (Settings → Apps).
- If an app's window doesn't appear (for example with unusual graphics drivers), it now shows anyway after a few seconds, and a problem at startup pops up a message instead of the app quietly closing.

## [1.1.0] - 2026-11-08

### Added
- **Lighting and vision.** Turn it on per map with **👁 Vision** in the bar at the top of the map. Players then see only what their characters can see:
  - **Line of sight:** walls and closed doors block it, on built, generated and imported maps (imported Universal VTT walls too). What a player can't see right now is shown dark; monsters out of sight aren't sent to their screen at all.
  - **Light on the map:** Bright, Dim or Dark. In the dark, characters see only lit squares and what their darkvision reaches.
  - **Lights:** torches, braziers, campfires, fireplaces, candles and lamp posts light the area around them, as do lights imported with Universal VTT maps. Select a token to give it a **Light** (candle, torch, lamp, lantern, the Light spell, Daylight) and **Darkvision** (30 to 120 ft); players can set these on their own characters.
  - **Party shares vision** (on by default), or each player sees only through their own tokens.
  - **With fog of war,** what the party sees stays revealed as they explore, so you don't have to reveal rooms by hand.
  - **Show me what's seen by:** the DM can preview the map as the whole party or one player sees it; monsters they can't see show faded.
- **Doors:** the new 🚪 **Door** tool (`D`) opens and closes doors, for the DM and for players (only doors they can see). Open doors let sight through; imported Universal VTT doors work too.
- **Handouts:** letters, pictures and clues for the players. **+ New handout** in the right-hand panel: a title, text and/or a picture, for everyone or only some players. **Save and show** pops it up on their screens; it stays in their Handouts list to read again. **Show** pops it up again later; Edit to change it or who gets it.

### Changed
- Tabletop is built for Windows only: the macOS and Linux apps are no longer made. Running the server from source with Node.js still works anywhere.

## [1.0.0] - 2026-11-08

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
