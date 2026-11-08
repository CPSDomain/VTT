# Player guide

## Connect

1. Run `Tabletop-Player-Setup-<version>.exe` (no admin rights needed), or unzip `Tabletop-Player-<version>-Windows.zip` anywhere and run **Tabletop Player.exe**.
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
- **Ping** (`P`): click to flash a spot for everyone ("over here!"). `Alt`+click pings with any tool.

`Esc` goes back to Move.

## In combat

- The **Initiative** list appears at the top right when the DM starts a fight. Click **🎲** next to your name to roll initiative, or type your score.
- Whose turn it is glows gold on the map and is highlighted in the list.
- **Click your token** to open your character's box: set your HP and max HP, temporary HP and initiative bonus, type an amount and press **Damage** or **Heal**, and toggle conditions like Concentrating or Prone.

Keep your character sheet in D&D Beyond as usual; Tabletop is for the map and the dice.
