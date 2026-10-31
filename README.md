# Citybloom

An original 3D city-building game for the browser. Lay roads across a green valley, zone homes,
shops and industry, and keep the city powered, watered, safe, healthy and solvent while it grows
from a hamlet into a city of a hundred thousand. Residents are counted per building rather than
simulated one by one (each home knows how many live there, how many work or study and how happy they
are), but their trips are routed over the real roads: commuting, shopping and freight add up to the
traffic on every street, so jams form where the city sends them, and the cars, buses and walkers you
see follow samples of those trips. Trams and trains take people out of their cars, and freight trains
take the trucks off the roads. Fire engines, police cars, ambulances and garbage trucks drive to
each call. Pollution drifts on the wind; fires, earthquakes, tornadoes, floods and meteors test the
city from time to time.

![A grown city of 110,000 in the afternoon](docs/screenshots/phase3-city.jpg)

The city is drawn bright, warm and toy-like: the buildings wear hand-made models (two designs or
more for every type on every lot it can stand on, repainted copy by copy, so every zoned building in
any city wears one), each with lighter versions for the distance; the sun crosses the sky through golden and blue hours, lit windows glow at night, grass
and trees turn with the seasons, and fields, kerbs, zebra crossings and benches make a grown city
read as a place. Graphics quality (High, Medium, Low)
switches each effect.

![The same city at night](docs/screenshots/phase3-night.jpg)

Built with TypeScript, Vite, Three.js and Preact. The hand-made building models were made for the
game (`assets/models/`, checked and converted at build time); the rest of the buildings, the icons
and the sounds are generated in code. There are no bought or borrowed assets (see `CREDITS.md` for
the open-source libraries).

## Play online

Once GitHub Pages is on for this repository (see the top of `PROGRESS.md`), every push to `main`
publishes the game at **https://pxwom6.github.io/CityBloom/**. It's an installable app: after one
visit it plays offline, **Install Citybloom** on the main menu (Chrome and Edge; in Safari, File →
Add to Dock, or Share → Add to Home Screen on iPhone and iPad) puts it in a window of its own, and
when a new version is out the game offers to reload into it, saving your city first. Saves stay in
your browser across updates, and the game asks the browser to keep them; export them from the load
screen to keep a copy or move one to another browser or device. On the first launch a quick check
picks graphics that suit the device (a lighter preset on older laptops); Settings shows the pick and
can check again.

## Play with friends

Build one city together, or each play your own side by side. No accounts: a room or a region is
found by its code (six characters for an online one; one on someone's computer has a longer code,
like `A7KQ2M-BCDF-GHJK-MNPQ`, which the invite link carries), and nobody sees anything about you but
the name and colour you choose.

- **One city together (co-op, up to 8).** Main menu → **Play with friends**: pick a name and a
  colour, then **Host online** (the city lives in an online room and waits there between sessions;
  once online rooms are set up for the site, until then the button says so) or **Host on this
  computer** (your browser is the room; friends play while you're there). Or, in a
  city you're already playing, pause (Escape) → **Invite friends**. Send your friends the invite
  link from the room button by the city's name; opening it drops them straight into the city.
  Everyone builds on the same map with the same money; you see each other's cursors and what's in
  their hands, **Shift+G** over the map points the others at a spot, the room panel has a short
  chat and **Follow** to ride along with someone's view. The host decides who may do what (taxes,
  policies, big projects, bulldozing others' work, spending above a limit, pausing) and can lock the
  room, mute someone, turn the chat off or remove a player.
- **A shared region (up to 4 cities).** Open your city → **Region** (Shift+N) → **Start a region**,
  and give friends the code; each brings their own city with **Join**. Your cities take the places
  of the neighbouring towns: you trade power, water and garbage (each city settles its deals every
  game month on its own clock), share commuters and shoppers along the highway, pay together for
  **Sunfield Commons** (the biggest giver builds it, everyone who gave shares its power) and can
  **Visit** each other's cities, read-only. Everyone plays at their own speed; a city that's offline
  keeps its last offers. The region's host can also turn **war** on, so friends' cities can raid each
  other, fight live battles and make peace (see [War](#war)).

**When something goes wrong**

- **"Couldn't connect directly to the host's computer"**: some home, school and office networks
  block direct connections between browsers. Try another network (a phone's hotspot often works),
  or let a friend on a different network host. Once online rooms are set up, **Host online** goes
  through a server and works on any network.
- **"The host's game has closed, and the room with it"**: a room on someone's computer runs in
  their browser, so it closes when they leave; everyone keeps a copy of the city to play alone.
- **"This room is full"**: 8 players are in it (players who are away don't count); try again when
  someone leaves. **"The host has locked this room"**: nobody new gets in until the host unlocks it
  (removing a player locks it). **"This region is full"**: a region has places for 4 cities, and each
  keeps its place while its mayor is away, so start another region for more.
- **Hosting on your own computer** connects everyone straight to your browser, so the players can see
  each other's internet (IP) addresses; an online room doesn't share them.
- **"Sam's game fell out of step; catching up"**: one player's game stopped agreeing with the
  others (rare; a crashed or very slow tab can do it). The room sends that player the city as it
  stands and they carry on a moment later; nothing is lost.
- **"Waiting for Sam…"**: one player's computer is falling behind; the city waits up to a few
  seconds for them. Games in a background tab aren't waited for, and catch up when they return.
- **"Reconnecting…"**: the connection dropped; the game keeps trying by itself and carries on where
  it was.
- **Online rooms aren't set up yet**: the online relay needs a one-time setup by whoever runs this
  copy of the game (`PROGRESS.md`); hosting on your own computer works without it.

## Run it

Needs Node.js 20.19+ or 22.12+ and a browser with WebGL2.

```sh
npm install
npm run dev          # play at http://localhost:5173
```

To build a static copy you can host anywhere (it's plain files; saves live in the browser):

```sh
npm run build        # type-checks, then writes dist/
npm run preview      # serves dist/ at http://localhost:4173
BASE_PATH=/my-city/ npm run build   # for a site served from a subpath
```

The deploy workflow is `.github/workflows/deploy.yml` (unit tests, then a build with the Pages
path, then publish). The service worker (`sw.js`) is written by the build with every file it
produced, so any change makes a new version.

## Play

The main menu opens over a small town that keeps living in the background. Choose **New city**,
pick a map (river, coast, lakes or highlands, or one of your own from the map editor), a seed, a difficulty, and whether you want sandbox
money, random disasters or elections. The tutorial is on for your first city and walks through the basics:

1. **Roads** off the highway: drag to draw a straight road, or click point to point to keep going;
   the curve tool takes a start, a bend and an end, and the free tool follows the mouse. Over hills
   the ground is cut and filled so a road climbs no steeper than its type allows (streets 16 %,
   avenues 12 %, boulevards 8 %), with a viaduct across deep dips: the ghost shows the road at its
   built height, turning amber near the limit and red where it's too steep, and the hint gives the
   climb, the earthworks' cost, or what would fix it.
2. **Zones** beside them: residential, commercial and industrial. Buildings grow on their own when
   there's demand (the R, C and I bars in the top bar tell you what the city wants, and why).
3. **Power, water and sewage** from the Utilities menu. Homes without them empty out.
4. **Garbage, fire, police, health, schools and parks** as the town grows. The advisors say what's
   missing, and the data maps show where. Click a landfill to see whether its trucks keep up, and
   buy extra trucks there before you need a second landfill.
5. **Taxes and budget**: the budget panel shows every line of income and cost. Keep an eye on it.

**Traffic tools** in the road tool help once the town starts to queue. Junctions have their own
capacity, so a busy crossroads jams before its roads do: the **Roundabout** mode puts a ring on a
junction or a road (drag out to size it), and it passes far more traffic. The **One-way** mode turns
a road one way, round, or back (free), and **O** draws new roads one-way in the direction you draw;
a one-way road carries a quarter more. At 10,000 residents the **city highway** unlocks: four fast
lanes with no zoning or junctions, passing over the roads it crosses (or under a viaduct), joined to
them only by one-way **ramps** and to the regional highway where it ends. Click any road to inspect
its traffic, switch its direction, and add or remove a roundabout at its ends; the traffic map
shades junctions by their load and marks one-way roads and ramps with chevrons. Visible cars queue
behind each other, wait their turn at busy junctions and give way to cars already on a roundabout.

**Rail** unlocks at 5,000 residents. Pick **Railway** in the road tool and draw track anywhere (it
climbs gently and curves wide): across the middle of a street, avenue or dirt road it makes a level
crossing, and it bridges over boulevards and highways. Two **railway stations** on connected track
start a train line that shuttles between them; people walk further to catch a train than a bus and
like the ride, so a line beside a jammed road takes cars off it. The **Tram track** mode in the road
tool lays track along streets, avenues and boulevards (click a road, or drag along a route); a **tram
depot** on the track runs trams round the **tram stops** you place. The regional railway comes in at
the map's west edge: lay track from it to a **rail freight terminal** near your industry, and the
trucks that drove to the highway take their goods there to go on by train, while stations on track
joined to it bring the neighbours' commuters in by train. (A city from an older version whose edge was
built up may have no link: **Regional rail link** in the Transit menu lays one anywhere on the west
edge.) At level crossings the barriers come down as a train nears and cars wait for it; trams wait
for cars in their way, and cars for trams. Click a stop, a station, a
depot or the track to see its line, how often it runs and who rides it; the **Ridership** map shows
every line by how full it runs.

**Districts** (I, or the flag in the toolbar) are parts of the city you paint with a brush and name
(each takes its neighbourhood's name to start with). Most policies can be switched on for one
district instead of the whole city, and cost its share (by the people who live and work there) of
the city-wide price; a **high-rise ban** keeps one district low while the rest grows up. Two are for
districts only: a **heavy-traffic ban** sends lorries round it (if there's another way), and
**heritage** keeps it as it stands (nothing is rebuilt bigger, new buildings stay low or medium, and
its land is worth more). The Districts panel shows each one's residents, jobs, happiness, land
value, the taxes it pays and what its services and policies cost, and can show any data map for that
district alone.

**Seasons and weather.** A season is three months of the game's calendar, and a new city starts in
spring. Each map has its own climate (temperate by the river, mild and wet on the coast, hot summers
and snowy winters by the lakes, long alpine winters in the highlands), with clear days, cloud, rain,
thunderstorms, fog, snow and heatwaves. Grass and trees change with the seasons, from spring blossom
to autumn gold to bare branches, and snow settles on fields, roofs, trees and roads. The weather
matters: heating pushes power demand up in winter and heatwaves raise power and water use; snow
slows every car on the roads it lies on until it melts or a **public works depot** (Garbage and snow
bar) sends ploughs out; heavy rain raises the river and, with disasters on, can flood homes by the
water; dry spells lower what groundwater pumps give; and parks see fewer visitors in the rain. The
date in the top bar shows the weather, the temperature and the season, and opens a panel saying what
the weather is doing to the city. Settings turn seasons off or set the weather from off to wild, and
photo mode can pick any season and weather for a shot.

**The region.** Three neighbouring towns lie beyond the map, each with a character (an industrial
town, a commuter suburb, a resort) and fortunes of its own. Their people drive in along the highway,
or come by train to a station on the regional line, to take jobs your residents can't fill and to
shop; your residents without work take jobs there; and the region panel (the towns button in the top
bar, Shift+N) signs deals to buy or sell power, water and garbage processing, paid for what actually
comes through. Past 10,000 residents a **seaport** on deep water puts the city's goods on ships and
brings ferry passengers; past 20,000 an **airport** flies visitors and business travellers in, loud
along its runway (see the noise map). Visitors now arrive by road, train, air and sea and drive
through town to the sights; the region traffic map shows where they and the commuters go.

**Terrain and maps.** The terrain tool (the hill in the toolbar, Shift+T) raises, lowers, levels
and smooths the ground with a round brush, paid for by the cubic metre: level a hillside before
building on it and far more of its lots can be built on, or cut a pass through a ridge for a road.
Roads and buildings hold the ground they stand on, water is left alone, and a drag undoes in one
step. The **map editor** (from the main menu) makes maps of your own: start from a generated map or
flat meadow, sculpt hills and valleys, paint rivers, lakes and sea, plant forests, lay ore and oil,
say where the highway and railway come in and pick the climate. A playability check says whether a
first town has room by the highway (and what to fix if not); playable maps appear on the new-city
screen under your own maps, and any map exports as a `.citymap` file to share and opens from one.

New buildings, services, policies and landmarks unlock as the population passes each milestone.
Later on, a city can specialise in tourism, trade or technology, and mine ore or pump oil where the
ground holds them.

**Big projects** (the crane in the toolbar) open at 20,000 and 40,000 residents: a city stadium, a
solar tower array, a convention centre, a garden expo and a launch complex. Each has requirements
(population, and for some an educated workforce, a hotel, a research park or visitors), is built in
stages over months that you watch rise on site, pays for each stage as it starts (the site waits,
and says so, if the treasury can't) and gives a lasting perk once open: match days that fill the
city with visitors and the roads with fans, clean power, trade and research, tourism. The
inspector follows the build.

**Elections** come every four years and are won mostly on approval. In the six months before a
vote, the city panel's Election tab (P) lets you make up to two promises (cut crime, open a
hospital, shorter commutes, cleaner air, jobs for all, no tax rises), each judged on the day against
where the city stood when you made it. A win brings the region's grant and a year's goodwill; a
loss never ends the game, but the council blocks tax rises and new loans for a year. There are
none in sandbox, and Settings can switch them off.

**Scenarios** (from the main menu) are fourteen set challenges, each a ready-made city with goals, limits
and a time limit: grow a town to 10,000 on clean power alone, pay off a spendthrift mayor's loans,
win back a town before it votes, open a stadium without borrowing, untangle a gridlocked town,
unjam a town that queues at one crossroads, put an ironworks' freight on the train, clear the smoke
from a mill town, rebuild a lake town's waterworks after a flood, turn a coastal town into a
resort, keep the lorries out of an old market street, see an alpine town through its first
hard winter, keep a harbour town lit while opening it to the sea, and cut a hill town a way through
its ridge. Each opens with a brief; the city's name in the top bar opens its goals (G),
showing each against its target and the time left. Goals are checked as each month closes. A win
earns one to three stars (the card says what the second and third ask for), kept on this device;
win or lose, the city plays on.

**City history** (Y, or the chart button in the top bar) charts the city's life month by month:
population, approval, jobs and unemployment, the treasury, income and spending, air pollution, crime
and commute times, with milestones and disasters marked on the timeline. **Photo mode** (K, or the
camera at the end of the toolbar) hides the interface and lets the camera come down to eye level;
set the time of day, field of view, depth of field, tilt-shift and one of six colour grades, ride
along with a car, bus or passer-by, and save a PNG at up to twice the screen's resolution.

### Controls

| Action | Mouse | Trackpad | Keys |
| --- | --- | --- | --- |
| Pan | drag with the left button (when the tool doesn't use it) or middle button; screen edge (setting) | swipe with two fingers | W A S D / arrow keys |
| Rotate and tilt | drag with the right button | Option (Alt) or Shift + two-finger swipe; rotate gesture | Q / E rotate, R / F tilt |
| Zoom | wheel | pinch | + / − |
| Road tool | | | T |
| Road modes: straight, curve, free, upgrade, one-way, roundabout, tram track | road options | | Tab |
| Draw one-way roads, grid snap | road options | | O, G |
| Zone residential / commercial / industrial / dezone | | | Z / X / C / V |
| Bulldoze | | | B |
| Terrain: raise, lower, level, smooth | toolbar hill | | Shift+T, Tab, [ ] brush size |
| Districts: paint, erase, and their panel | toolbar flag | | I, [ ] brush size |
| Weather, season and what they're doing to the city | the date in the top bar | click | |
| Select and inspect | click a building, car, walker, road, railway or stop | click | H |
| Move a civic building | select it, then Move | | |
| Cancel, leave a tool, close a panel, pause menu | right click | | Escape |
| Undo / redo (last 30 actions) | toolbar | | ⌘Z / ⇧⌘Z on a Mac, Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y elsewhere; U / Shift+U |
| Pause / speeds | top bar | | Space, 1, 2, 3 |
| Budget / advisors / notifications / city (progress, policies, election, achievements) | top bar | | M / J / N / P |
| City history | top bar | | Y |
| Region: neighbours, deals, commuters and visitors | top bar towns button | | Shift+N |
| War room (with war on and a military HQ) | top bar war room button | | Shift+M |
| Battle map in a live battle (command or watch) | Command in the battle bar | | O |
| Scenario goals | the city's name in the top bar | | G |
| Photo mode (H hides its panel, Enter saves, Esc leaves) | toolbar camera | | K |
| Data maps | toolbar | | L toggles the power map |
| Every shortcut on one card | | | ? |
| Debug panel (FPS, cheats) | | | backtick |

The game tells a trackpad from a mouse by what it sends; Settings → Pointing device fixes it to
one or the other. Undo reaches back 30 actions (building, zoning, bulldozing, road changes, moves)
and gives the money back; if something has grown on top since, it says so instead.

In the map editor the brushes take [ ] for size and , . for strength, and holding the button keeps
a brush working; its bar has the map's name and climate, the check, save, export and play.

The pause menu (Escape) has save, load, settings (graphics quality, shadows, draw distance,
interface size, pointing device, volumes, edge scrolling, disasters, elections, autosave) and export/import of `.citybloom`
save files. The city autosaves every few minutes.

## War

War is off unless you ask for it, so everything above plays as a peaceful city builder. Turn it on and
your city can raise an army, be raided, send raids of its own and go to war, against the towns along the
highway or against a friend's city. Nothing is lost for good: a building knocked down by a battle is rubble
that clears and regrows, a city building that is hit closes for repairs, and roads that are cratered mend.

**Turning it on**

- **A city of your own:** on the New city screen tick **Rival neighbours**. The neighbouring towns then
  arm month by month, each with a character (aggressive, cautious, mercantile, honourable or
  treacherous), and in time raid, trade and bargain with you. The tick isn't remembered: every new city
  starts at peace.
- **A shared region:** its host decides. Tick **War in the region** on the New city screen when starting
  the region, or later in the Region panel (Shift+N), and choose how far it may go (**Skirmishes only**,
  **Up to war** or **Total war allowed**) and whether **Superweapons** are allowed. Turning war off again
  ends every war in plain peace; cities keep what they built. Everyone else in the region sees the rules
  and can't change them.

**Raising forces.** From 2,000 residents the toolbar's **Military** button builds a military HQ, which
opens the **war room** (Shift+M, or its button in the top bar) and the other military buildings: barracks
for infantry, a vehicle depot for tanks, artillery and transports, then airfields and naval yards, bunkers,
shelters, radar and the rest. Click a base to train units: they take workers from nearby homes (the forces
may take a quarter of the city's workers at most), need power and a funded defence budget, and cost upkeep.
The war room's tabs are Forces, Send, Map, Research, Intelligence, Diplomacy, Trade, Upkeep, Readiness and
Reports.

**Raids.** Computer neighbours raid a city of at least 3,000 residents that is a year old, with an hour's
warning (the red countdown in the top bar; a radar warns earlier). Bunkers, guns and units fight on their
own and residents near the targets go to the shelters. You can raid too: the war room's **Send** tab picks
the town (a neighbour or a friend's city), what to strike (military buildings, industry or power near the
border, or the HQ in a declared war), the way (road, rail, sea or air) and up to 24 units. The battle is
fought when the force arrives; **Reports** lists it and **Watch** plays it again.

**Diplomacy.** The **Diplomacy** tab declares war (with a reason; it opens after a warning) and shows each
war's score. At a score of −60 a side capitulates and the winner sets the terms. Treaties put into words
what each side gives: peace, a ceasefire, reparations, tribute, a non-aggression pact, an alliance, a
defensive pact, an embargo, trade, independence. Break a pact and everyone hears of it. In a **total war**
a fallen city can be taken as a **vassal**: it pays its overlord a fifth of its taxes every month and may go
to war only to rise against it. Research (six branches, the fourth tier a superweapon), spies
(Intelligence) and trade (stakes in a neighbour's industry, loans and arms deals with allies) have tabs of
their own.

### War with friends

In a region where war is on, the other players' cities are in the Send tab and the Diplomacy tab's
**Friends in the region** list.

- **Raids and live battles.** A friend's city is raided like a neighbour. If its player is in the region
  when your force arrives, the battle is **live**: both of you watch it and command it on the **battle
  map** (the **O** key, or **Command** in the bar under the top bar). Choose units (click, drag a box, or
  **All**) and give an order: **Focus** (attackers: a building to strike; defenders: an attacker to hit),
  **Guard** a building, **Hold** (stand still and only fire), **Free** them to use their own judgement
  again, or **Withdraw**. The region passes every order to both pages and the map shows when it was "heard". The
  battle runs at the pace of the slower page; if a page stops answering for ten seconds its units fight on
  their own until the player presses **Take command again**. Each city runs the battle and the two compare
  the result at the end. If the defender isn't there, the battle is fought against the region's saved copy
  of their city (with the damage it can do capped at half, if they have left) and waits for them: they take it, and it shows in
  their Reports, when they come back.
- **Allies' help.** A friend with an alliance with one of the fighters, or a defensive pact with the city
  being attacked, can send a force into a live battle (**Send help** in the bar or the battle map while
  watching). It arrives about half a minute later (three-quarters of a minute by sea), fights on its own judgement and
  its losses go back to its own city: one force of up to 24 units per city, three helpers a battle.
- **Watching and replays.** Any player in the region may **Watch** a live battle between two other cities,
  from the bar or the Region panel: the battle map, read-only. The region keeps its last 20 battles, and
  **City history** (Y) has a **Region at war** list, in real time, with a Watch button on each.
- **Declaring war and making peace.** In the Diplomacy tab press **Declare war…** by a friend, give a
  reason and a scale; they're told at once and the war opens **two minutes** later. Each battle between
  your cities moves the score. Press **Offer terms** next to a war to propose peace (adding reparations or
  a pact if you like); a proposal waits a day for its answer, so a friend who is away answers when they're
  back, and a treaty signed binds both cities. A side that capitulates gives the winner a day to set the
  terms (then plain peace stands), and in a total war the winner may take it as a vassal; a vassal that
  wins battles against its overlord goes free, or the overlord can agree to it by treaty. Ending a pact
  early costs the city's reputation.
- **The limits.** A city with fewer than 3,000 residents, or less than a year old, is protected as a newcomer:
  friends can raid it only once it has raided them, or when a war between you has opened. A city can be **neutral**
  (Diplomacy tab): it raids no one and is raided by no one. A city takes three raids a day (UTC). A
  region's war runs on real time: the **fair clock** lets training and research run at the pace of the
  region's clock plus 48 game hours, so nobody builds an army by fast-forwarding, and a war's warning, a
  proposal and a ceasefire are counted in real minutes and hours (a game hour is 7.5 seconds at normal
  speed). A region on someone's computer ends with its host, and refuses raids on a player who isn't there.
- **Roles in a shared city.** In a co-op city the host chooses who may **Wage war**, make **Treaties** and
  spend on **Defence** (the room panel's list of permissions, with taxes and the rest). A shared city can't
  stand in a region, so its wars are with the computer neighbours.

## Develop

```sh
npm run typecheck && npm run lint && npm test && npm run e2e   # everything
npm test             # unit and scenario tests (Vitest)
npm run e2e          # end-to-end tests through the real UI (Playwright), with screenshots,
                     # against a production-mode build served from /CityBloom/ as on Pages
npm run soak         # ten minutes of top-speed play with disasters; fails on any console error
npm run bench        # sim tick timing (add --big for a ~100k-resident city)
npm run balance      # scripted players over 20 game years: careful, greedy, neglectful
npm run models:check # check every hand-made model in assets/models against its spec
npm run relay        # the local relay for shared cities and regions (ws://127.0.0.1:8787)
npm run xbrowser     # the same city, bit for bit, in Chromium, WebKit and Firefox
```

Frame times on real hardware come from `scripts/dev/framebench.mjs` (a headed Chrome window with the
frame cap off; see `CLAUDE.md`).

The simulation is pure, deterministic TypeScript running in a Web Worker (`src/sim`); the page
renders a mirror of it (`src/client`, `src/render`) and every player action is a command, so the
same seed and commands always give the same city. Balancing numbers live in `src/data`.

- `SPEC.md`, `SPEC-2.md`, `SPEC-3.md`, `SPEC-4.md`: the briefs (the game, phase 2's features,
  phase 3's graphics, phase 4's multiplayer).
- `relay/`: the rooms and regions for playing with friends (the local relay, the Cloudflare Worker,
  and the room code a host's browser runs), with their own tests in `relay/tests`.
- `docs/models/PROMPTS.md`: the model spec and a prompt for every building; `PROMPTS-2.md`, `PROMPTS-3.md`, …
  the later batches (further designs, each with the spec as it then stood).
- `DESIGN.md`: the technical design (architecture, simulation model, rendering, saves).
- `PROGRESS.md`: where things stand, known issues, performance numbers and ideas for what's next.
- `docs/DECISIONS.md`: the design calls made along the way, one line each.
- `docs/SPEC_REVIEW.md`: every item in the brief and where it's done.
- `CLAUDE.md`: working notes, dev scripts and gotchas.
