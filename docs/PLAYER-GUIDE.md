# Player guide

## Connect

1. Run `Tabletop-Player-Setup-<version>.exe` (no admin rights needed), choose where to install it and click **Install**, or unzip `Tabletop-Player-<version>-Windows.zip` anywhere and run **Tabletop Player.exe**.
   The first time, Windows says "Windows protected your PC": click **More info → Run anyway**.
2. Type the **server address** your DM gives you (e.g. `192.168.1.20:3000`) and **your name**, then click **Connect**.
3. If the table has a passcode, the app asks for it: your DM can tell you it. The app remembers it for next time.
4. Use the **same name every session**. Your DM gives your token to that name, and your quick rolls are saved under it.

![Connect screen](images/player-connect.jpg)

The app remembers the address and your name, and tells you when there's a new version (**Help → Check for updates…**). **Table → Disconnect** (Ctrl+D) goes back to this screen.

No app? Open `http://<the address>` in Chrome or Edge instead.

**"Couldn't reach the table"** means one of these: the address is wrong, the DM hasn't started Tabletop DM, the DM's firewall is blocking it, or you're not on the same network. For online games, everyone joins the DM's [Tailscale](https://tailscale.com) network and uses the DM's Tailscale address.

## Play

- **Move your token** by dragging it. You can only move tokens the DM has given you. Scroll to zoom, right-drag to pan, Home fits the map to the screen.
- **Roll dice** with the buttons on the right, or type a roll like `1d20+5`, `2d6+3` or `4d6kh3` and press Roll.
- **Quick rolls:** add your attacks, saves and skills once under "My quick rolls" (e.g. name `Longsword hit`, roll `1d20+5`), copying the bonuses from your D&D Beyond sheet. Then click to roll. **Shift-click** for advantage, **Alt-click** for disadvantage.
- **Roll privately** sends the result only to the DM.

## Table tools

The bar on the left of the map:

- **Move** (`V`): drag your token. While dragging, it shows how far you've moved, and everyone sees it. Press `Space` mid-drag to go round a corner.
- **Ruler** (`R`): drag to measure in feet; `Space` adds a corner. Everyone sees your ruler.
- **Spell** (`T`): spell templates. Pick cone, sphere, cube, line or cylinder in the bar at the bottom, then drag from where the spell starts (or type the size and click). The squares it hits are shaded. Click one of yours to move it, drag its dot to aim or resize it, `Del` removes it. **Clear mine** removes all yours.
- **Door** (`D`): click a door you can see to open or close it.
- **Ping** (`P`): click to flash a spot for everyone ("over here!"). `Alt`+click pings with any tool.

`Esc` goes back to Move.

## Talking

- **Chat:** type in the box at the bottom right and press Enter. A speech bubble shows over your token.
- **Whisper:** pick someone under **To** (or the DM), or type `/w Bob let's sneak round the back`. Only they and the DM see it.
- `/r 1d20+5` rolls from the chat box.
- **Your character sheet:** click your token and paste your D&D Beyond character link. Then double-click your token (or 📜 Sheet) to open it.

## Protect your name

Click **Playing as …** at the top right and set a PIN (4 to 8 digits). Then nobody else can join as you. The app remembers your PIN; if you forget it, ask the DM to reset it.

## Seeing in the dark

When the DM turns vision on, you see only what your character can see: walls and closed doors block your view, and in a dark dungeon you see only what's lit. Click your token to set its **Light** (light a torch!) and **Darkvision** (if your character has it; it's on your D&D Beyond sheet). Open doors with the Door tool to see through them.

## Sound

The DM can play music and ambience (rain, a crackling fire, a tavern band) for the whole table. Click **🔊** at the top right to see what's playing and to set your own volume: everything, music and ambience separately, or **Mute**. If you joined in a web browser, click once on the page to let it play sound.

When the DM sets the weather (rain, snow, fog…) you'll see it over the map. If the moving weather bothers you, untick **Show moving weather** under **🔊**.

## Handouts

When the DM shows you a handout (a letter, a picture, a clue), it pops up on your screen. It stays under **Handouts** on the right; click it to read it again.

## In combat

- The **Initiative** list appears at the top right when the DM starts a fight. Click **🎲** next to your name to roll initiative, or type your score.
- Whose turn it is glows gold on the map and is highlighted in the list.
- **Click your token** to open your character's box: set your HP and max HP, temporary HP and initiative bonus, type an amount and press **Damage** or **Heal**, and toggle conditions like Concentrating or Prone.

Keep your character sheet in D&D Beyond as usual; Tabletop is for the map and the dice.
