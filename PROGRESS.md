# PROGRESS

Phase 3 (graphics, SPEC-3.md) and model batches 3 and 4 are merged into `main`, which deploys the
live site at https://pxwom6.github.io/CityBloom/. Model batch 5, the last, is on the `models-5`
branch, in a pull request into `main` for the owner to merge.

- [x] M0 Foundation
- [x] M1 Roads and zoning
- [x] M2 Growth
- [x] M3 Money
- [x] M4 Utilities
- [x] M5 Services and happiness
- [x] M6 Traffic and transport
- [x] M7 Environment, health and education
- [x] M8 Life and feedback
- [x] M9 Disasters
- [x] M10 Progression and specialisations
- [x] M11 Game shell
- [x] M12 Balance, performance and polish
- [x] M13 Gentler roads
- [x] M14 Controls and editing
- [x] M15 Publish it
- [x] M16 Photo mode and city history
- [x] M17 Big projects and elections
- [x] M18 Scenarios
- [x] M19 Traffic tools
- [x] M20 Rail
- [x] M21 Districts
- [x] M22 Seasons and weather
- [x] M23 Region, airport and seaport
- [x] M24 Terrain and map editor
- [x] M25 Baseline and model pipeline
- [x] M26 Light and sky
- [x] M27 Ground, lots and streets
- [x] M28 Buildings and variety

## Playthrough fixes (PLAYTHROUGH-FIXES.md)
Work order: roads (P7, P2, P1, P5, P10), input and layout (P3, P4, P11, P6, P13, P14, P23, P12), economy, advice and labels (P8, P9, P15, P25, P16, P17, P19, P20, P24, P22, P21, P18, P26).

- [x] P1 Road ends that miss are silent
- [x] P2 Building and upgrading roads remove buildings without saying so
- [x] P3 A drag with a tool out builds
- [x] P4 A category click arms its first tool
- [x] P5 Roundabouts are refused near bends
- [x] P6 Narrow windows lose the toolbar and top bar
- [x] P7 Some roads are planned at height 0
- [x] P8 Bought power is resold at a loss
- [x] P9 The tutorial's "Lay a road" and "Breaking ground" tick before any road exists
- [x] P10 Street names change and repeat
- [x] P11 Escape doesn't always leave the road tool
- [x] P12 Bus stops are refused on the road (check first: reproduced on bridges)
- [x] P13 Tooltips run off the screen
- [x] P14 The citizen-thought feed covers the data-map menu
- [x] P15 Tips and thoughts contradict the numbers
- [x] P16 Dates read backwards around New Year
- [x] P17 Tax bands nobody pays
- [x] P18 Purchases made while paused (check first: reproduced as a display lag)
- [x] P19 Two road-maintenance lines in the budget
- [x] P20 The Region panel doesn't show supply and demand
- [x] P21 City limits are invisible
- [x] P22 The save toast names the city, not the slot
- [x] P23 Clickable toasts can't be clicked
- [x] P24 Loan terms appear only after borrowing
- [x] P25 "No school nearby" beside a primary school
- [x] P26 Notification groups have no headings

## Summary
Citybloom is a complete, playable city builder in the browser. From the main menu (over a living
demo town) a player founds a city on one of four seeded maps with a difficulty, sandbox and
disasters option and an optional tutorial, then lays straight, curved and free-form roads and
bridges off the highway (graded into the hills with cuttings, embankments and viaducts, M13), zones
homes, shops and industry, and keeps the city supplied with power (five plant types), water and
sewage, garbage collection, fire, police, health, schools and parks. Residents are aggregated per
building but travel for real: rush-hour commutes congest roads, buses take cars off them, service
vehicles drive to incidents, and any car or walker can be clicked. Air pollution drifts on the wind,
sickness and education follow services, land value shapes wealth, and the budget books every dollar
(taxes by zone and wealth, funding, loans, policies). Milestones unlock buildings, landmarks and
three specialisations (tourism, trade, technology) plus ore and oil. Fires, earthquakes, tornadoes,
floods and meteors strike and the city rebuilds. Saves are versioned and compressed with autosave,
slots and file export. It deploys to GitHub Pages as an installable app that plays offline and
offers each new version (M15). Cities keep their history for charts and photos (M16), and past
20,000 residents raise big projects in stages (a stadium, a solar tower, a convention centre, a
garden expo, a launch complex) and face elections every four years (M17). Scenarios, each
a ready-made city with goals, limits and a time limit, are played from the main menu for one to
three stars (M18). Roads can be one-way, junctions take roundabouts, and past 10,000 residents a city
highway passes over the town's streets, joined by ramps; visible cars queue and give way (M19). Past
5,000, railways with level crossings and stations run train lines, tram track on the streets runs
trams, and a freight terminal linked to the regional railway puts industry's goods on trains (M20).
Districts are painted and named, and take their own policies, including a heavy-traffic ban and
heritage status, with their own figures, budget share and data maps (M21). The year turns through
four seasons with rain, snow, fog, storms and heatwaves drawn from each map's climate: heating lifts
winter power demand, heatwaves raise power and water, dry spells weaken pumps, heavy rain lifts the
river, and snow slows traffic until a public works depot's ploughs clear it (M22). Three neighbouring
towns send commuters and shoppers, take the city's unemployed and trade power, water and garbage
processing under deals; a seaport ships goods and an airport flies visitors in, loud along its
runway (M23). The terrain tool raises, lowers, levels and smooths the ground, paid by the cubic metre
and holding the ground under roads and buildings; the map editor (from the main menu) sculpts land,
paints rivers, lakes and sea, lays forests, ore and oil and places the highway and railway, checks
that a first town has room, and saves maps to play and share as files (M24). Fourteen scenarios.
Everything runs from a deterministic sim in a Web Worker: 0.7–1.3 ms
per tick on average at 100k residents on this VM (it varies by day; see Performance), with 288 draw
calls at the city overview (on an M5 MacBook Pro: 60 fps in Safari, 100–118 in Chrome at 120 Hz,
worst tick 6 ms). Checked by 338 unit, scenario and legacy-save tests (48 saves from every save
version since M12 played for two years), the UI specs in `e2e/`, a 10-minute soak and full
playthroughs through the UI (`docs/SPEC_REVIEW.md` maps every SPEC item to where it's done). A
review after phase 2 retuned the late-game money, added a placeable regional rail link for older
cities, a grace for cities meeting seasons for the first time, and level-crossing barriers and
trams that give way (DECISIONS, "Phase 2 review").

**Phase 3 (graphics, M25–M28)** made it look the part without touching the simulation. The owner's
hand-made building models (318 in five batches: every zoned type with two designs or more on every
lot its buildings can stand on, skyline towers for 24 m lots, 46 civic buildings, annexes) are checked against their spec, converted at build
time and stand in wherever they fit, painted from the game's palettes, with far and skyline versions
that fade in by a dither (M25); every zoned building in any city wears one, and long
window bands light at night in runs of 3–4 m, not as one stripe a floor. Light and sky: cascaded
shadows fitted to the ground in view, soft occlusion in corners, a glow round lit windows at night,
golden and blue hours, bounce light and haze, Neutral tone mapping (M26). Ground, lots and streets:
grass with fields, hedgerows and worn paths, empty zoned land as a faint tint and outline, kerbs,
zebra crossings, benches, bins and planters, and car parks, lawns and yards behind buildings (M27).
Buildings: every generated building now has distant versions too, and the generator was refreshed
(five tower silhouettes, crowns, spires, balcony bands, mansards, cornices, more colours) so no two
neighbours look alike (M28). Every effect has a switch in the graphics quality. On an M5 MacBook
Pro the heaviest view (the 110k city at night at 3× with a tornado) takes 10–11 ms a frame at High
with batch 5's models, against 22–25 at the start of the phase; the whole-city view draws 1.9M triangles where it drew 2.7M.

## Ideas for what's next
1. **Real-hardware pass**: the rest of the list under "To check on the Mac" (the 100k city runs at
   60 fps and more on an M5 MacBook Pro, so per-building LOD isn't needed).
2. **Terrain, further**: a water tool in running cities (dig a harbour basin or a canal, with the
   water, flood and groundwater systems following it live), tunnels through ridges for roads and
   rail, and map sharing through a link rather than a file.
3. **Rail, further**: branching train lines with services per branch, and tram and bus stops shared as
   interchanges.
4. **Traffic lights** as a third junction type between a plain junction and a roundabout.
5. **The region, further**: neighbours that grow with the trade and commuting the city gives them,
   regional competition for industry, and deals the neighbours propose.
6. **Weather, further**: weather fronts that cross the map, frozen lakes, and seasonal tourism
   (ski resorts in winter, beaches in summer).
7. **More specialisations** (education hub, gambling/entertainment, electronics) using the same
   building + economy pattern as M10.
8. **More hand-made models** (PROGRESS, "Models"): every zoned type has two designs or more on
   every lot it can stand on since batch 5, so further designs would be for variety (the commonest
   lots most), plus fixes from the smaller notes below; a procedural window shader would let distant
   homes' windows merge too.
9. **Balance**: commercial demand runs a little low in small towns; the big-city running costs and
   the scenario star thresholds want a second look once real players have tried them.

## In progress
The playthrough fix round (`PLAYTHROUGH-FIXES.md`), on the `playthrough-fixes` branch: 23 of 26
items are done and ticked; P6, P13 and P14 (layout) are in progress. Every sim change is in, and
`balance` has been rerun (below); `bench` and the frame times wait for a quiet machine.

## Next tasks
1. Merge P6, P13 and P14, then add narrow windows, tooltips and the thought feed to
   `e2e/fixes-tour.spec.ts`.
2. `bench` (base `main` at 5b261bd against the branch, back to back) and the frame times
   (`framebench.mjs`, the same two builds); log them under "Performance (playthrough fixes)".
3. The brief's "When everything's done": the full check (`npm run typecheck && npm run lint &&
   npm test && npm run e2e`) and `npm run playthrough`, then the pull request into `main`.

## Models (phase 3)
318 files in `assets/models/`: the first batch (136: every zoned type, `R103-2`, 8 annexes, 46 civic
buildings), the second (`docs/models/PROMPTS-2.md`: 40 designs sized for the lots buildings stand
on, and a remade `C213`), the third (`PROMPTS-3.md`: 19, skyline towers and a headquarters for
24 × 24 m lots), the fourth (`PROMPTS-4.md`, model spec v5: 102 of its 121 prompts, seven fixed by
the owner's Claude to pass the check, and two extra designs, `C021-3` and `I121-3`) and the fifth
(`PROMPTS-5.md`, model spec v6: its 38 prompts, the 19 of batch 4 not made then and 19 remakes that
replace their first versions, plus `I223-3` with its smoke stack taken off and its walls made white).
Batches 1–4 were made in Claude Design; batch 5 was built by Claude in a cloud session with three.js
and GLTFExporter and checked with the game's own check. `npm run models:check` passes all 318.
Converted: 359k triangles in the files, 326k drawn near, 240k far, 154k in the skyline (320k, 293k,
212k and 136k before batch 5); the models file is 6.0 MB raw and 514 KB gzipped as Pages serves it
(443 KB before batch 5), fetched at start.

| File | Status |
|---|---|
| `R103.glb` (the tenement) | passes as a row model (8 × 16 m, three abreast on its 24 m lot, two on a 16 m lot), with notes: 16 m deep on a 24 m lot, and trim, steps and the awning overhang its footprint by up to 1.5 m |
| `library.glb`, `primary.glb`, `university.glb` | failed as first delivered (a gable or wall slid 4–9 m off its building: "a wall hangs in the air", and the library was 24 m wide on its 20 m site); the owner's fixed files pass |
| 13 of batch 2: `C103-2`, `C113-2`, `C213-2`, `I003-2`, `I013-2`, `I013-3`, `I103-2`, `I113-2`, `I213-2`, `R202-2`, `R203-2`, `R212-2`, `R213-2` | skipped under the first rules (a zoned model had to be its type's lot, or a half or a third of its width); pass since a zoned model may be any whole number of cells up to its type's lot (DECISIONS, "Model batch 2") |
| `I101-2`, `I111-2` | failed as "the front faces along X": the canopy over the loading docks down their side counted as an entrance; pass since a canopy over garage doors counts as a dock |
| all 41 batch-2 files | pass with a note: their lawns lie at 1 cm and paths at 4 cm, under and level with the game's 4 cm lot base; the game lifts a model's ground to 5 cm |
| `C213.glb` (remade) | lights window by window (285 runs of 5.6–6.3 m; each is now lit as two, below) |
| all 19 batch-3 files | pass as delivered: no check needed changing, every lawn lies 5 cm up or more, and none fails on facing |
| `I113-5`, `I203-3`, `I213-4` (batch 4) | failed because of the check, not the models: the conveyor's second leg and the open shed's corner columns stood between the points the check sampled under a wall ("a wall hangs in the air"), and the business units facing each other across a lane counted as a front along X; pass since anything under a wall holds it however thin, and doors that face each other cancel out (DECISIONS, "Model batch 4") |
| the other 101 batch-4 files | pass as delivered, with notes: `C202-4`, `C203-4`, `C212-3`, `C212-4`, `I112-4`, `R122-3`, `R202-4`, `R212-4`, `R222-2`, `R223-4` have the inside of their parapet ring wound inside out (12–24 faces; the game turns them round, DECISIONS "Model batch 4"); `I022-2` had no glass and `I023-3`, `I023-4`, `I123-4`, `I222-2`, `I223-3`, `I223-4` smoke stacks (batch 5 replaced or fixed all seven) |
| all 39 batch-5 files | pass as delivered; the only notes are lots deeper than the model (the game leaves a yard behind): no faces inside out, no lawn under the lot base, no smoke stack on high-tech, and no glass outside a window or band |
| the other first-batch files | pass with no notes |

**Long windows light in runs** (DECISIONS, "Model batch 3"): the conversion cuts every window or band
longer than 4.5 m into runs of about 3.5 m, each lit on its own, with a 0.4 m strip of unlit glass
between two (near and far; in the skyline, where the strip is a pixel or less, the runs meet).
`npx tsx scripts/dev/windowruns.ts` lists what is still long.

Which way they face (`npx tsx scripts/dev/modelturn.ts`): none fails as delivered; turned half round
292 of 310 are caught, a quarter round 285 (272 and 265 of 291 before batch 5). The rest are
symmetrical or have entrances on more than one side (half round: `C212-4`, `C213`, `C213-2`, `I003-3`,
`I102-3`, `I103`, `I103-5`, `I113`, `R001-3`, `R003`, `R013`, `R023`, `R103-2`, `R113`, `R123`,
`grandarch`, the parks; a quarter round 25, listed in `bench-results/batch5/modelturn.log`, of them
batch 5's `I023-2` and `I023-4`).

**Who wears them** (`node scripts/dev/modelcensus.mjs <saves …>`; logs in `bench-results/batch5/`).
The three test cities grow no rich shops or offices and next to no high-tech industry, so batch 5 adds
a fourth: the careful balance mayor's city after 20 years (`balance.ts 20 careful --save dir`, 71,565
residents, with a university and a research park; the run is deterministic, so the save isn't kept):

| City | Buildings | First batch only | After batch 2 | After batch 3 | After batch 4 | After batch 5 |
|---|---|---|---|---|---|---|
| Bench city (110k) | 2,158 | 359 (17 %) | 1,618 (75 %) | 2,035 (94 %) | 2,158 (100 %) | 2,158 (100 %) |
| Menu demo town | 1,001 | 252 (25 %) | 914 (91 %) | 980 (98 %) | 1,001 (100 %) | 1,001 (100 %) |
| `Saves/Ashton.citybloom` | 192 | 3 (2 %) | 184 (96 %) | 188 (98 %) | 192 (100 %) | 192 (100 %) |
| Careful mayor, year 20 | 1,817 | | | | 1,811 (99.7 %) | 1,817 (100 %) |

133 buildings across the four cities wear a batch-5 design. In the three test cities they are the
remakes for ordinary cities, on the same buildings as before (a remake keeps its name): `I113-3` 32,
`I213-3` 16, `I103-3` 9, `C103-3` 7, `I203-3` 1. The year-20 city adds `I113-3` 45, `I213-3` 7, `C103-3` 6,
`C101-2` 1 and its high-tech industry: `I023-3` 4, `I223-2` 2, `I123-2`, `I123-3`, `I223-4` 1 each; before
the batch its two `I123` complexes on 16 × 24 m lots had no design and its four `I023` plants took
turns with the generator. Triangles drawn near: bench city 2.32M → 2.34M, demo town 0.69M → 0.72M,
year-20 city 1.55M → 1.60M.

**Every lot has two designs** (`npx tsx scripts/dev/modelcoverage.ts`, new): following growth's
rules (founded on the level-1 shape; each upgrade takes the next shape, deepens the lot or rebuilds
on it), the 81 zoned types can stand on 174 type-and-lot pairs. Before batch 5, 3 had no design
(`C022@8×8`, `I123@16×24`, `I123@16×32`) and 20 had one, which took turns with the generator (rich
shopfronts, market halls, offices, department stores, towers and headquarters, and high-tech
warehouses, plants, assembly works, complexes, big factories, processing works and parks); now all
174 have two or more, as PROMPTS-5 meant. Every lot the four cities' 5,168 buildings stand on (99
type-and-lot pairs) is on the list.

Batch 4 had put 770 buildings in the three test cities into its designs, most of them third and fourth
designs for the commonest homes and industry (`R013-4` 155, `R113-4` 133, `R001-3` 68, `R003-4` 66).

**What is still generated, and why**: nothing, in any city. Every type and lot a building can stand
on has two designs or more, so every look is hand-made; a generated look would stand only where a
model failed the check (the build leaves it out) or the models file missed `loadModels`' deadline on
a very slow line (below, "Start-up").

**Models that rarely or never appear, and why** (across the three test cities: 161 of 264 zoned
designs worn by three buildings or fewer, 61 of them batch 4's and 35 batch 5's; with the year-20
city, 145):
- Types that don't grow in these cities: no rich homes, shops or offices, and high-tech industry only
  in the year-20 city (9 buildings). 28 of batch 5's designs appear in none of the four (every rich
  shop, office, department store and tower, and `I021-2`, `I022-2`, `-3`, `I023-2`, `-4`, `I121-2`, `-3`,
  `I122-2`, `-3`, `-4`, `I123-4`, `-5`, `I221-2`, `I222-2`, `-3`), as do 23 of batch 4's (`R021-2` …
  `R222-4`, `C121-2` … `C223-4`, `I002-2`, `-3`, `I202-2`, `-3`) and its extra `C021-3`: none of the four
  grows `I002`, `I022` or `I202`. `I023-2` and `I223-3`
  fit lots that buildings in the year-20 city stand on, but its four `I023` plants and two `I223`
  parks there happen to wear the other design.
- Designs for lots these cities' buildings don't stand on: `C113-4` and `C103-4` (24 × 24 m
  department stores; the 100 in the test cities stand on 16 × 16 m), `I013-4` and `I003-4` (24 × 24 m
  plants; the 90 stand on 16 × 16), `I103-4`, `I103-5` (complexes, 24 × 24), `I112-4`, `I203-4`, `I102-4`,
  `C202-4`, `R223-4`, `R223-5`; and batch 5's `I023-4`, `I123-4`, `I123-5` (24 × 24 m; the year-20
  city's high-tech plants and complexes stand on 16 m lots).
- Designs that take turns on lots few buildings stand on: `R203-5` (3 of 62 skyline residences: most
  stand on 16 m lots), `I113-4`, `I113-5` (2 and none of 60 complexes: four stand on a lot they fit),
  `I213-4` (3 of the 7 parks on 32 × 32 m lots), `C203-2` … `-5` (1–4 each of 9 headquarters), `C211-2`,
  `C212-3`, `R202-4`, `R102-3`; and batch 5's `I203-3` (1 of 4 heavy-industry parks), `C101-2` (1 of 2
  shopping rows in the year-20 city).

**Notes on the models for the owner.** From reviewing every batch-5 design in the game by day, from
behind and at night (`docs/screenshots/batch5-industry.jpg`, `batch5-shops.jpg`, `batch5-night.jpg`,
`batch5-remakes.jpg` with every remake's row before and after, and `batch5-incity.jpg`, the year-20
city's high-tech parks by day and at night; seven reviewers, each note checked
by a second look that tried to refute it, then a look across all of them for what is systematic;
`bench-results/batch5/review/`): all 39 read as their prompts ask and differ from the designs they
share lots with; none is the wrong building and none is worth a remake. The 19 remakes fix what
their prompts said went wrong (`C103-3` partly, below), so the remake lists of the batch-3 and batch-4
reviews are done: `I022-2`, `I023-3`, `I222-2`, `I023-4`, `I021-2`, `I121-3`, `I122-2`, `I123-4`, `I223-4`,
`I203-3`, `I213-3`, `C021-2`, `C023-2`, `C123-2`, `C123-4` (batch 4) and `C101-2`, `C103-3`, `I113-3`,
`I103-3` (batch 3); and `I223-3` has lost its smoke stack.

Fixed in the files after the review (branch `models-5-fixes`; 16 files, all still pass the check):
- `C101-2` and `C103-3` were brick under a light-grey roof the game keeps, so every copy looked the
  same apart from its signs. Both roofs are slate now, which the game repaints per copy; `C101-2`'s
  balcony parapets and `C103-3`'s chequer (brick and a pastel, the pastel from the home walls) vary
  per copy too.
- The other four commercial designs that kept a grey roof (`C022-2`, `C023-2`, `C122-3`, `C223-3`)
  have slate roofs as well, so no commercial design keeps one roof colour on every copy.
- `I213-3`'s halls were 9–12 m where the prompt asks for 23, and its 21 m top was two slim 20 m tanks
  that read as chimneys. Its main hall is a 21 m high bay now (the U's other halls 10.5 and 13.3 m),
  and the tanks are fat and domed (4 m across, 14.6 m).
- `I223-3` (batch 4's design, touched up in batch 5): its two courtyard tree_spots stood 1 m from the
  walls, under the skybridge; they stand at the courtyard's street side now.

Smaller notes:
- High-tech fronts that lean towards offices or labs, with the industry behind: `I122-2`, `I122-3` (a
  flush 4 × 3 grid of dark glass), `I123-2`, `I123-4`, `I222-3`, `I223-3`, `I223-4` (a campus, as its
  prompt asks), and the manufacturing `I113-3` (two rows of three identical window runs, and amber
  doors under a canopy that look like shopfronts). Tanks, dishes, roof units, solar panels or a hall
  keep each of them industrial; `I121-3`, `I122-4`, `I123-3`, `I123-5`, `I221-2`, `I222-2` and `I223-2`
  read as industry from the street.
- Named features the street barely sees: `I022-3`'s loading bays (on a side wall; some copies show
  them), `I223-4`'s covered walkways (hidden between the pavilions), `I103-3`'s ore heap and conveyor
  (behind the hall; from the street the foundry reads by its furnace), `I221-2`'s glazed vault ends
  (they face the neighbours).
- Trees in front of entrances: the tree_spots of `I021-2`, `I022-2`, `I022-3` and `I023-2` stood in front
  of the glazed front or a door, so the season's tree hid part of it (fixed: moved to the lot's
  corners or out towards the street, and `I021-2`'s front one taken out; a rougher count adds `I122-2`,
  `I122-3`, `I122-4`, `I123-5`, `C222-3`, still as they were).
- Over the prompt's height by rooftop features the prompts ask for: `C123-4` 31 m (a 22 m store and
  its cupola), `C123-2` 25 m (the cafe pavilion), `C123-3` 24.5 m, `C103-3` 24.4 m (a lift housing),
  `C022-3` 6.7 m (its mansard).
- The rich towers `C222-3` and `C223-3` had their canopies in the awning material, so the game painted
  them purple, orange or red and they read as shop awnings (fixed: trim, like `C223-5`'s).
- Copies alike: `C123-3` has next to nothing the game repaints (white walls, no roof), so a street of
  it changes only its canopy and sign (`C122-3` was the same; its roof repaints now); high-tech accents and doors
  never repaint, so copies of one high-tech design differ only by mirroring and a shade of white.
- Thin, busy parts (fixed): `I222-3`'s purple louvres (0.26 m slats) broke up into dotted stripes at
  row distance, and are fewer and 0.44 m now; the roller-door slats of 0.1 m (`I021-2`, `I121-2`) are
  gone; `I113-3`'s 0.12 m mullions are one 0.26 m mullion and a 0.24 m transom per run.
- `I203-3`'s five-storey brick tower at the front corner echoes `I203-2`'s; its gantry, open shed and
  shredders tell them apart.

**Batch 5 against the Claude Design batches** (the look across all the reviews, checked against the
pictures and against `npx tsx scripts/dev/batchstats.ts`, new; `bench-results/batch5/batchstats.log`):
- It reads as its prompts: 39 of 39, against 88 of 104 in batch 4, with every named feature there and
  nearly always seen from the street. Part of that is the brief (spec v6 and the remake prompts carry
  batch 4's lessons), part that its builder ran the game's check as it went; the reviewers are the
  same family of model as the builder.
- Night: no glass outside a window or band, so nothing lights as one bar (six of batch 4's designs
  still do: `C113-4`, `C121-2`, `C223-4`, `I013-4`, `I112-3`, `I112-4`; and 15 of the first batch's); roof
  glass in 2–4 m runs; solar panels named, so they stay dark. Its high-tech lights more of its front
  (13 % of the facade, against 5 % for the first batch's high-tech); its towers less than their
  Claude Design siblings (13–17 % against 21–31 %), as spec v6 asks for solid walls with windows;
  both read well.
- Backs: a door or window on every side of every design; by a part check, 19 of batch 4's 58
  industrial and commercial designs have a bare back wall.
- Spec v6's rules hold: heights near the prompts (6 of 38 more than 2 m over, all from rooftop
  features, against 53 of 88 in batch 4), trees 3 m from walls except the few in front of entrances,
  no chimneys on high-tech, green roofs in grass, and white high-tech walls that take the rich whites
  instead of industry's beiges (the before pictures show batch 4's high-tech repainted beige under
  terracotta roofs).
- More varied high-tech (vaults, sawtooth, domes, drums, courtyards, a different accent per design,
  where the first batch's nine share a dish, solar panels and one cyan), and designed rooftops on the
  rich shops and offices (pavilions, a cupola, terraces, roof gardens), where the Claude Design ones
  show slabs with air units: it matters from the game's high camera.
- Repainting was weaker: 24 of 38 kept a colour on every copy, every one a light-grey flat roof (0 of
  102 in batches 3 and 4). On high-tech that is what spec v6 asks for and it reads well (the first
  batch's nine high-tech designs keep the same grey); on the six commercial designs it cost variety,
  so their roofs are slate now (above): 18 of 38 keep one, all high-tech apart from `I213-3`'s office.
- Finer detail than the spec's 0.3 m: 16 of 38 have bars under 0.2 m (mullions, seams, bay lines,
  slats; none in batches 1, 3 and 4), so they look a little busier and less toy-like than their
  Claude Design neighbours up close. Their far
  versions keep 81 % of the near triangles (77 % in batch 4), the fine bars included; the skyline
  versions drop the bars, so nothing that thin is drawn at whole-city distance. The skyline drops roof
  solar panels too (as for every batch), so from the whole-city view high-tech roofs read as plain
  light grey (`bench-results/batch5/sheets/lod.jpg`: near, far and skyline side by side).
- Costlier: 73 % of the triangle budget on average against 53 % in batch 4, about a third more
  triangles near and half again far per building (the ordinary-industry remakes are 3–3.7 times their
  Claude Design lot-mates), and 3.5 KB a design in the models file against 2.6. In a city it is small
  (1–3 % more triangles drawn, no change in frame times); the models file grew 16 % ("Start-up").
- The same: the palette and the chunky board-game style (no visible break beside Claude Design
  neighbours), and high-tech that leans office-like from the street (batch 4's did too).

From batch 4 (still open; its remake list is done):
- Departures from the prompt that look good, so keep: `C223-4` is a round tower under a glass dome
  (not a rectangular one with stacked boxes), `C222-4` two slabs of 58 and 48 m (not a slot of
  terraces), `C221-2` and `C222-2` have flat tops (no stepped crown or roof garden), `C121-2` a flat
  roof (no mansard), `C223-2` no sign panel, `I223-3` a U (not a ring).
- `C121-2`'s roof light glows at night as one bar (the other designs noted for it were remade).
- tree_spots 0–1.5 m from the back wall, so the trees stand in the wall: `C122-2`, `C121-2`; `C203-5`'s
  stands in front of its door.
- Roof gardens in the roof material take the roof's colour and read as plain roofs: `R221-2`,
  `R222-2`, `R223-4`, `C202-4` (a garden in `grass` stays green).
- The same on every copy (not a repainted role): `C103-4`'s strong blue bands, `C202-4`'s second sign.
- Bare backs at street level: `I002-3`, `I011-3`, `I102-2`, `I102-3`, `I111-3`, `I203-2`, `C113-4`,
  `C202-2`, `C212-2`, `C212-3`, and `I213-4`'s end wall facing the road.
- Sparse or tall against the prompt: `I103-5` (the sawmill covers about 30 % of its lot), `I102-4`,
  `I113-5`; `I003-4` is 24 m tall (11 asked), `I012-3` 10.8 m (7).
- `C213-4`: window frames 3 cm off the brick wall shimmer as white speckles at a distance.
- `C021-3` (the extra design): its shop glass is small and 1.6 m back behind the arcade, so it reads
  as a loggia more than a shop.
- `R122-3` and nine others had the inside of a parapet ring wound inside out; the game turns those
  faces round (DECISIONS, "Model batch 4"; `docs/screenshots/batch4-parapet.jpg`).

From batch 3 (still open; its remake list is done): smaller notes on `R213-3`, `R213-4`, `R213-5`,
`R203-3`, `C213-3`, `R212-3`, `R112-3`, `C113-3`, `I201-2`, and a bare back on `C003-3` (in git,
`PROGRESS.md` at 3fdc560).

From batch 2 (still open; the window bands of `R201-2`, `R213-2` and `C213-2` are now lit in runs by
the game):
- Sawtooth roofs (`I013-2`, `I013-3`, `I011-2`, `I003-2`, `I101-2`, `I111-2`, `I103-2`, `I113-2`):
  hairline gaps between the glazing and the roof planes show the grass through.
- Wealth levels alike: `R102-2` is nearly `R112-2`, and the low-wealth villas and family houses
  (`R003-2`, `R003-3`, `R002-2`) nearly the medium-wealth ones; `R213-2` and `R203-2` are both navy
  glass towers.
- `R113-2`: a dark strip with slit windows at each side of its front shows between copies standing
  side by side (a party wall would be plain).
- `C213-2`: the "two-storey glass lobby" is a solid wall with a door; its sign panel reads as one
  more window. `C013-2`, `C013-3`: the sign is a blank cream plaque close to the wall's colour.
- `I003-2`, `I001-2`: brown roller doors on brick barely show. `I213-2` looks slight beside its
  neighbours, much of its lot bare paving.
- `R101-2` reads as two and a half storeys (three asked); `R013-2`, `R003-2`: from behind the dormer
  roof pokes above the ridge; `R001-2`: its side hedges run the whole lot as thin tall walls.
- `C113-2`, `C103-2`: their grey roofs and navy signs are too far from the game's palettes to be
  repainted, so every copy keeps them.

From the first batch (still open): `firestation`: a thin strip of roof along the ridge sits a little
proud of the roof. `skyneedle`: benches stand inside the planters at its foot. `nuclear`: the cooling
towers' bases run into the boundary wall. `recycling`: the shed roofs' end caps are in the roof
material, so they repaint with the roof. `C223`: the lobby glass lies in the plane of the wall (it can
shimmer at a distance). `university`: the back walls of the wings have no windows. Several civic
sites leave no clear back corner, so an add-on annex stands at the nearest clear spot, shrunk (the
clinic's and the police station's most). `tree_spot`s within a metre or two of a wall put a tree's
crown into the wall (a few homes, and two at the back of the remade `C213`).

## Known issues
- Photo mode's depth of field is a screen-space gather: fine for stills, but thin bright things right against a blurred background can show a faint halo, and saving at 2× takes up to a minute on this VM's software renderer (a fraction of a second on a GPU).
- The follow camera loses a car when it parks (the panel says so); buses loop for good.
- Homes without power or water still empty after about two days; the balance runs show a careful player never hits this, so no grace period was added.
- Visible cars and walkers follow trip samples from the last assignment round, so for up to two game hours after a road closes some still drive along it; commuters, services and utilities reroute at once.
- Buildings along a road closed for repairs lose power and water until it reopens (lines run under the roads); with 6–24 h repairs this rarely empties them, but a big quake still costs a town a lot.
- Visible cars queue and wait at junctions (M19) but don't change lanes, and a car can still sit briefly on top of one in the next road's lane for one step when both move at once; roundabout rings have one lane.
- Bus riders' door-to-door time includes walking and waiting, so a bus line mainly helps by taking cars off jammed roads (≈10–20 % less traffic in the test town), not by being faster than driving.
- Towns without services stagnate and slowly lose residents (the neglectful balance run); that's intended, but it could be clearer to a new player why.
- Commercial demand runs negative once a town has zoned a strip of shops in every district (shoppers vs. shops); the careful balance mayor now zones shops only while they're wanted. Big cities run short of jobs rather than homes: industry demand stays high once the map is full.
- Visitors drive from where they arrive to the landmarks and hotels (M23); with no sight in town they're counted but stay put. Ships sail a straight line from the berth out to sea, so on a very irregular coast one could cross a headland.
- The finale playthrough's town is a feature tour, not a growth run: it stays around 550 residents at 71 % approval after seven months on relaxed (the M12 playthrough is the one that grows a first city through its first two years). District policies unlock at 800 residents, so its district has none yet and says so.
- The M24 full e2e run: 32 of 33 passed; the button-label audit caught the Advisors button mid-transition (its text turns white at once while its background fades in over a moment) and now waits for transitions before judging; it also covers the map editor now. Rerun: passes.
- The M23 full e2e run had two old specs fail on view-dependent details (M14 clicked a warehouse that M23's regional commuters grew in front of the police station at a low camera angle; M16 hovered the history chart before its panel settled). Both now click and hover robustly and pass.
- The scenario tests run the scripted mayor for up to two game years each and the legacy-save tests play 50 saves for two years: `npm test` takes about 13 minutes on this VM (the files run four at a time).
- Scenario star thresholds were set against the scripted players (which earn one to three stars); real players may find some easy or hard, worth a look once people have played them.
- Late-game money (Phase 2 review): before the review the careful mayor's city piled up about $2M a year (from $1M to $25M between years 10 and 20), holding 6 % taxes because the launch complex's education bar was out of reach. With schools built by the seats needed, goals saved for, and big-city running costs past 30,000 residents, a built-out city at 6 % runs within about $40k a month of even and the treasury stays between $0.1M and $2M through year 20 on seeds `balance`, `s1` and `s2`; the tuning is from the balance mayor and wants a look once people have played big cities.
- Growth to 100k residents is exercised by the large-city benchmark (a sandbox grid); the scripted careful mayor fills the river map at about 67k (M17).
- Tree count is high in forests (~25k in-map); LOD switches to low-poly beyond 750 m.
- Cutting faces and embankments read softly: the terrain is 8 m height samples, so a 1:1 cut face shows as a brown bank over one cell rather than a crisp edge.
- Roads can't join a viaduct mid-span; the planner says to meet it where it's back on the ground. They can pass under one high enough (M19), and local roads crossing each other always meet at a junction (only the city and regional highways pass over).
- Undo history costs a snapshot per command (about 25 ms in a 12k town, ~55 ms at 112k, on the worker, so the UI doesn't stall); it isn't saved, so undo starts fresh after loading.
- Undo refuses (with a toast saying why) when the city has changed underneath: buildings grown on an unzoned strip, a road now carrying traffic incidents, and so on; the change stays and the history moves past it.
- Rail (M20): each connected stretch of track runs one train line in order of running time from its far end, so a branching network gets one line that may double back; trips use one line (no changing between buses, trams and trains). Trains run to their timetable (cars give way to them at crossings, not the other way round); trams keep their own place and wait for cars, so a tram line bunches up in heavy traffic. Walkers still cross a closed level crossing. A city with no regional rail link can lay one from the Transit menu (Phase 2 review).
- The benchmark grid still fails 5 avenue links whose junctions differ in height by more than 12 % of their length, and 26 bridges without land for ramps (81 failures before M13).

## Frame times (phase 3; MacBook Pro M5, Chrome, frame cap off)
`node scripts/dev/framebench.mjs bench-results/city.gz` on the ~110k bench city (`bench.ts 6 --big --save`), a
1512×781 window at 2× (High draws 3024×1562), every view at 3× speed; average / 95th-percentile
frame time in ms. `heavy` is SPEC-3's heaviest view: the whole city at night with a tornado on
screen. Runs vary by about ±15 %, so compare runs made back to back.

**Baseline, the start of phase 3** (commit 0631561; 289 draw calls / 2.68M triangles at the whole-city
view, 169 / 1.89M at city zoom, 100 / 1.05M at street level):

| | whole city | city | street | whole city, night | city, night | street, night | heavy |
|---|---|---|---|---|---|---|---|
| High | 10.1 / 30.0 | 6.9 / 16.0 | 4.5 / 8.5 | 10.3 / 28.0 | 6.9 / 14.1 | 4.5 / 8.5 | **23.1 / 192** |
| Medium | 6.9 / 19.5 | 4.4 / 8.8 | 2.4 / 4.2 | 6.5 / 12.9 | 4.3 / 8.6 | 2.4 / 4.3 | 16.5 / 99.9 |
| Low | 3.7 / 6.3 | 2.4 / 3.8 | 1.6 / 2.6 | 3.3 / 5.7 | 2.4 / 3.6 | 1.5 / 2.6 | 9.7 / 15.0 |

The whole-city view at High is 99 fps, as the owner measured (100–118 at 120 Hz). The heavy view was
well over SPEC-3's 12 ms before phase 3 changed anything: a tornado flattens trees, every change to
the tree grid rebuilt all sixteen tree regions, and each candidate tree asked `civicAt`, a scan of
every civic building (4.9 s of a 7 s profile).

**After the first two fixes** (tree regions rebuilt only where cells changed, once a frame, with
civic footprints in a spatial hash; instanced meshes upload only the instances in use, not their
whole buffers every frame):

| | whole city | city | street | whole city, night | city, night | street, night | heavy |
|---|---|---|---|---|---|---|---|
| High | 9.9 / 26.4 | 6.4 / 12.4 | 4.1 / 5.0 | 11.2 / 27.2 | 6.6 / 7.6 | 4.2 / 5.4 | **11.6 / 27.3** |
| Medium | 6.2 / 11.7 | 4.1 / 5.1 | 2.2 / 3.0 | 6.2 / 10.5 | 4.0 / 5.0 | 2.2 / 3.0 | 6.2 / 11.6 |
| Low | 2.9 / 4.7 | 2.0 / 3.7 | 1.4 / 2.7 | 2.9 / 4.2 | 2.0 / 3.7 | 1.4 / 2.7 | 2.9 / 4.8 |

The whole-city view at High is GPU-bound (about 2.3 ms per million triangles plus 3–4 ms of pixels at
2×): with the cap off the main thread runs ahead of the GPU and then waits inside whichever WebGL
call next needs it, now usually the upload of a rebuilt building chunk (single waits of 0.3–0.7 s
show up as the p99 and max in the logs; with the cap on the queue can't build up). Fewer triangles
(distant versions, a cheaper shadow pass) and smaller chunk uploads are what bring it down.
Sim ticks while saving the city: avg 0.59 ms at 110k, worst 28 ms (month 1, cold start).

**M25 complete** (the hand-made models, levels of detail and the fixes above), run back to back
with the phase-start build (`--dist dist-base`); new / start:

| | whole city | city | street | whole city, night | city, night | street, night | heavy |
|---|---|---|---|---|---|---|---|
| High | 9.2 / 10.6 | 6.6 / 7.1 | 4.3 / 4.6 | 10.7 / 10.4 | 7.1 / 7.0 | 4.6 / 4.5 | **9.7 / 23.0** |
| Medium | 5.7 / 6.6 | 4.0 / 4.3 | 2.4 / 2.4 | 6.0 / 6.4 | 4.1 / 4.2 | 2.5 / 2.4 | 6.5 / 15.0 |
| Low | 3.0 / 3.7 | 2.2 / 2.3 | 1.6 / 1.6 | 3.0 / 3.3 | 2.2 / 2.3 | 1.6 / 1.6 | 3.1 / 9.2 |

Average frame times in ms (95th percentiles in `bench-results/frames-m25-final*.log`). The heavy
view at High is 9.7 ms, inside the 12 ms budget; Medium and Low are faster than at the start in
the heavy view and within run-to-run noise (±15 %) of it everywhere else. The whole-city view draws
319 calls and 2.70M triangles (start: 289 and 2.69M): the levels of detail add chunk meshes.
`bench.ts 6 --big`: tick avg 0.24–0.27 ms at 97–110k, worst 15.8 ms (month 1, the cold start),
populations identical to before (110,174 at month 6). `balance.ts 20`: careful 71,565 / 72 % at
year 20, every election won, treasury $1.5M; greedy 420 / 16 %, neglectful 354 / 37 %, both losing
every election (no sim change in phase 3).

**M26 complete** (light and sky), run back to back with the phase-start build; new / start, average
ms (95th percentiles in `bench-results/frames-m26-final*.log`):

| | whole city | city | street | whole city, night | city, night | street, night | heavy |
|---|---|---|---|---|---|---|---|
| High | 7.5 / 9.9 | 9.0 / 6.7 | 6.9 / 4.2 | 9.5 / 9.7 | 9.4 / 6.6 | 7.3 / 4.3 | **10.0 / 21.8** |
| Medium | 4.5 / 6.3 | 3.1 / 4.0 | 2.8 / 2.3 | 4.8 / 5.8 | 3.5 / 3.9 | 2.9 / 2.3 | 5.0 / 14.3 |
| Low | 2.8 / 3.5 | 2.2 / 2.2 | 1.3 / 1.5 | 2.8 / 3.2 | 2.2 / 2.1 | 1.4 / 1.5 | 3.0 / 8.2 |

The heavy view at High is 10.0 ms, inside the 12 ms budget. Low is as fast as at the start or
faster everywhere; Medium is faster in the heavy and whole-city views, and about half a millisecond
slower close up at street level, where its new occlusion and the night glow are on. High pays for
its effects close up (occlusion, two shadow cascades reaching three camera distances; 6.9 ms is
still 145 fps). Shadow maps from far off are redrawn 30 times a second, so the triangles and draw
calls per frame vary; the whole-city view's shadow pass draws 454k triangles where it drew 872k.
`bench.ts 6 --big` and `balance.ts 20` are identical to M25's (no sim change): tick avg 0.25–0.28
ms at 97–110k, worst 16 ms (month 1); careful 71,565 / 72 %, greedy 420 / 16 %, neglectful 354 /
36 % at year 20.

**M27 complete** (ground, lots and streets), run back to back with the phase-start build; new /
start, average ms (95th percentiles in `bench-results/frames-m27-final*.log`):

| | whole city | city | street | whole city, night | city, night | street, night | heavy |
|---|---|---|---|---|---|---|---|
| High | 8.3 / 10.7 | 10.1 / 7.4 | 7.5 / 4.7 | 10.5 / 10.7 | 10.6 / 7.3 | 7.8 / 4.7 | **10.8 / 24.9** |
| Medium | 4.6 / 7.0 | 3.5 / 4.4 | 3.0 / 2.5 | 5.0 / 6.5 | 4.0 / 4.3 | 3.2 / 2.5 | 5.1 / 18.2 |
| Low | 3.0 / 3.7 | 2.2 / 2.3 | 1.5 / 1.6 | 3.0 / 3.2 | 2.2 / 2.2 | 1.5 / 1.5 | 3.0 / 8.3 |

The heavy view at High is 10.8 ms, inside the 12 ms budget. Against M26 (run alongside): Low the
same, Medium within noise, High about the same from far off and 0.5–1 ms slower at city zoom,
where the country's fields and paths are drawn (an A/B with `setGround(0)` in one build puts them at
0.4–0.9 ms; they fade out on the way to the whole-city view, which without that fade measured
12.6–13 ms in a full run). Every view draws fewer triangles than at M26 (the whole-city view's
colour pass 1.67M against 1.73M): road ribbons step 6 m on straight runs, which more than pays for
the kerb stones and edging. `bench.ts 6 --big` and `balance.ts 20` are identical to M26's (no sim
change): 110,174 at month 6, tick avg 0.24–0.27 ms, worst 15 ms (month 1); careful 71,565 / 72 %,
greedy 420 / 16 %, neglectful 354 / 36 % at year 20. Checks: 381 unit tests, and all 41 e2e specs
pass (`e2e/m27-ground.spec.ts` new; the crossings spec, which longer frames had made fail 2 runs in
5, passes 8 in 8 after two fixes to visible cars at level crossings, DECISIONS M27).

**M28 complete** (buildings and variety), run back to back with the phase-start build; new / start,
average ms (95th percentiles in `bench-results/frames-m28-final*.log`):

| | whole city | city | street | whole city, night | city, night | street, night | heavy |
|---|---|---|---|---|---|---|---|
| High | 8.0 / 10.3 | 11.0 / 7.1 | 8.0 / 4.5 | 10.2 / 10.3 | 11.8 / 7.0 | 8.5 / 4.5 | **9.2 / 22.3** |
| Medium | 4.6 / 6.4 | 3.9 / 4.1 | 3.1 / 2.4 | 5.0 / 6.1 | 4.4 / 4.1 | 3.3 / 2.3 | 4.8 / 12.7 |
| Low | 3.0 / 3.6 | 2.7 / 2.2 | 1.7 / 1.6 | 2.9 / 3.2 | 2.7 / 2.2 | 1.7 / 1.5 | 2.8 / 7.8 |

The heavy view at High is 9.2 ms (inside 12; M27 10.8): with every building in the levels of detail
the whole-city view draws 152 calls (289 at the start) and 1.73M triangles in its colour pass (2.68M).
Medium and Low are faster than at the start in the whole-city and heavy views and at Medium's city
zoom. Close up they are slower, which SPEC-3 asks them not to be: in runs alternating with the
start's build, Medium's street level by 0.7 ms by day and 0.85 at night (its shadow maps,
occlusion and glow from M26, now drawn 60 times a second close up, plus the refreshed buildings'
detail), Low's street level by 0.1–0.2 ms and its city zoom at night by 0.35 (its city zoom by day
is even). Every Medium view stays under 5 ms and every Low view under 3 ms (200–600 fps on this
GPU); taking Medium's shadows to 30 times a second or dropping its occlusion would cost more in looks
than it saves (DECISIONS M28). `bench.ts 6 --big` and `balance.ts 20` are identical to M27's (no sim
change). Checks: 386 unit tests and all 42 e2e specs; `e2e/m28-buildings.spec.ts` loads the demo town
through the load screen: 1,308 touching pairs, none drawn with the same model, no building drawn
"plain", 0.90M triangles from the whole-city view.

**Phase 3 final** (after the walk-through fixes), back to back with the phase-start build; new /
start, average ms (`bench-results/frames-phase3-final*.log`):

| | whole city | city | street | whole city, night | city, night | street, night | heavy |
|---|---|---|---|---|---|---|---|
| High | 7.5 / 10.6 | 10.6 / 7.1 | 7.8 / 4.6 | 10.6 / 10.5 | 11.3 / 7.1 | 8.2 / 4.6 | **10.0 / 25.1** |
| Medium | 4.7 / 6.7 | 3.9 / 4.3 | 3.3 / 2.5 | 4.9 / 6.4 | 4.3 / 4.6 | 3.5 / 2.4 | 4.8 / 15.7 |
| Low | 3.0 / 3.8 | 2.7 / 2.4 | 1.7 / 1.6 | 2.9 / 3.3 | 2.7 / 2.3 | 1.7 / 1.6 | 2.9 / 10.6 |

The heaviest view at High is 10.0 ms (12 allowed; 25.1 at the start in this run); the whole-city
view draws 152 calls and 1.75M triangles (289 and 2.69M at the start). Medium and Low are faster than
at the start in the whole-city and heavy views and at Medium's city zoom, and slower close up as
recorded for M28 (DECISIONS M28).

**Model batch 2** (three buildings in four hand-made), in runs alternating with the build before the
batch (the first 136 models, commit 9e7a42e): after / before, average ms of two runs each
(`bench-results/batch2/frames-*.log`):

| | whole city | city | street | whole city, night | city, night | street, night | heavy |
|---|---|---|---|---|---|---|---|
| High | 8.7 / 8.6 | 13.1 / 11.6 | 9.1 / 8.3 | 11.1 / 10.3 | 12.9 / 11.7 | 9.2 / 8.4 | **10.9 / 9.7** |
| Medium | 4.9 / 4.5 | 4.3 / 3.9 | 3.4 / 3.1 | 5.3 / 4.9 | 4.8 / 4.3 | 3.5 / 3.2 | 5.0 / 4.7 |
| Low | 3.2 / 2.9 | 2.6 / 2.7 | 1.8 / 1.7 | 2.9 / 2.9 | 2.6 / 2.7 | 1.8 / 1.8 | 3.0 / 2.9 |

The heaviest view at High is 10.9 ms (10.5 and 11.2 in the two runs; 12 allowed), and 10.1 ms on the
finished build (with the ground lift and the mirroring) in a third pair, beside 10.4 for the build
before the batch (`frames-final.log`, `frames-before3.log`): the hand-made
buildings cost about 1 ms a frame at High at city and street zoom and in the heavy view, 0.3–0.5 ms at
Medium, nothing measurable at Low (DECISIONS, "Model batch 2"). Colour-pass triangles (`passprobe`):
the whole-city view 1.76M against 1.74M, city zoom 1.65M against 1.49M (buildings 728k against 604k,
trees from the models' tree spots 244k against 206k), street level 1.04M against 0.93M. Every Medium
view stays under 5.5 ms and every Low view under 3.5 ms. A view at High varies by up to 2 ms from one
run to the next, so two alternating pairs are averaged. Checks: 392 unit tests and all 42 e2e specs;
the M28 spec loads the demo town through the load screen: 1,308 touching pairs, none looking alike
(now compared by design, paint and mirroring), every building on a lot two designs fit hand-made (805
of 805), 0.95M triangles from the whole-city view; the M25 spec's town is 53 of 57 hand-made, with
generated looks only where fewer than two designs fit.

**Model batch 3** (more than nine buildings in ten hand-made, long windows in runs), in runs
alternating with the build before the batch (`main` at 7bbb133): after / before, average ms of two
runs each (`bench-results/batch3/frames-*.log`):

| | whole city | city | street | whole city, night | city, night | street, night | heavy |
|---|---|---|---|---|---|---|---|
| High | 9.3 / 8.6 | 12.9 / 12.3 | 9.4 / 8.7 | 10.8 / 10.7 | 13.6 / 12.7 | 9.6 / 9.0 | **10.8 / 10.5** |
| Medium | 5.1 / 4.8 | 4.6 / 4.3 | 3.6 / 3.4 | 5.5 / 5.2 | 4.9 / 4.7 | 3.7 / 3.5 | 5.3 / 5.2 |
| Low | 3.3 / 3.2 | 2.6 / 2.6 | 1.8 / 1.8 | 3.0 / 3.0 | 2.7 / 2.8 | 1.8 / 1.9 | 3.1 / 3.1 |

The heaviest view at High is 10.8 ms (10.76 and 10.87 in the two runs, against 10.52 and 10.47 for
the build before; 12 allowed). The batch costs 0.6–0.9 ms a frame at High at city and street zoom,
0.2–0.3 ms at Medium and nothing measurable at Low (DECISIONS, "Model batch 3"). City zoom at High was
already over 12 ms before the batch (12.3, and 13.1 in batch 2's runs; SPEC-3's budget is the heavy
view). Colour-pass triangles (`passprobe`, by day): the whole-city view 1.87M against 1.76M, city zoom
1.85M against 1.65M (buildings 909k against 728k), street level 1.15M against 1.04M; draw calls
unchanged. No sim change, so `bench` and `balance` aren't rerun. Checks: typecheck, lint, 394 unit
tests (two new: long windows in runs at every level with all their glass, and the strips never lit)
and all 42 e2e specs (29.5 min); the M28 spec loads the demo town through the load screen: 1,308
touching pairs, none looking alike, every building on a lot two designs fit hand-made (965 of 965),
0.98M triangles from the whole-city view; the M25 spec's town is 55 of 57 hand-made.

**Model batch 4** (every building in the test cities hand-made), in runs alternating with the build
before the batch (`main` at 0f8258c): after / before, average ms of two runs each
(`bench-results/batch4/frames-*.log`):

| | whole city | city | street | whole city, night | city, night | street, night | heavy |
|---|---|---|---|---|---|---|---|
| High | 8.6 / 9.0 | 11.7 / 12.2 | 8.8 / 9.1 | 10.6 / 10.2 | 13.0 / 13.2 | 9.3 / 9.3 | **10.2 / 10.6** |
| Medium | 4.9 / 4.8 | 4.2 / 4.3 | 3.4 / 3.5 | 5.2 / 5.2 | 4.8 / 4.8 | 3.6 / 3.6 | 5.3 / 4.9 |
| Low | 3.3 / 3.4 | 2.5 / 2.7 | 1.7 / 1.9 | 3.0 / 2.9 | 2.5 / 2.7 | 1.8 / 1.8 | 3.1 / 3.0 |

The heaviest view at High is 10.2 ms (10.43 and 9.91 in the two runs, against 10.82 and 10.40 for the
build before; 12 allowed). Every view is within run-to-run noise of the build before: the batch's
designs are lighter on average than what they replace or share lots with, so the colour pass draws
fewer triangles (`passprobe`, by day: buildings 872k against 886k from the whole-city view, 871k
against 909k at city zoom, 459k against 478k at street level; draw calls the same). No sim change,
so `bench` and `balance` aren't rerun. Checks: typecheck, lint, 398 unit tests (new: the check's
three changes, faces turned round, the packed file) and all 42 e2e specs (28.8 min); the M28 spec
loads the demo town through the load screen: 1,308 touching pairs, none alike, 1,001 of 1,001
buildings hand-made, 0.98M triangles from the whole-city view; the M25 spec's town is 57 of 57
hand-made.

**Model batch 5** (every lot two designs), in runs alternating with the build before the batch
(`main` at eed0eea): after / before, average ms of two runs each (`bench-results/batch5/frames-*.log`,
`frames-summary.txt`):

| | whole city | city | street | whole city, night | city, night | street, night | heavy |
|---|---|---|---|---|---|---|---|
| High | 8.3 / 9.2 | 12.1 / 12.8 | 8.9 / 9.3 | 10.6 / 10.6 | 13.0 / 13.6 | 9.3 / 9.6 | **10.7 / 11.0** |
| Medium | 5.1 / 5.0 | 4.4 / 4.5 | 3.5 / 3.6 | 5.4 / 5.4 | 5.0 / 5.0 | 3.6 / 3.7 | 5.2 / 5.1 |
| Low | 3.3 / 3.2 | 2.8 / 2.7 | 1.9 / 1.9 | 3.0 / 3.0 | 2.8 / 2.8 | 1.9 / 1.9 | 3.1 / 3.0 |

The heaviest view at High is 10.7 ms (10.35 and 11.06 in the two runs, against 10.99 and 10.92 for
the build before; 12 allowed). Every view is within run-to-run noise: the bench city's only batch-5
designs are 31 buildings wearing remakes (`I213-3`, `I113-3`, `C103-3`), with 0.9 % more triangles
drawn near, and the same draw calls. (The draw calls Medium reports at night swing between about 105
and 210 from run to run in either build, by whether the frame sampled redraws the close shadows.) The
batch's designs carry about a third more triangles than batch 4's, but its new types (rich commerce
and high-tech) grow only in rich or educated cities: in the year-20 city the batch adds 2.6 % to the
triangles drawn near. No sim change, so `bench` and `balance` aren't rerun. Checks: typecheck, lint,
398 unit tests and all 42 e2e specs: 41 in the full run (29.2 min), and M16, which failed there
once because the car its photo mode followed stood in a queue for the four game minutes the spec
waits (a timing flake under load: it passes alone, twice; `bench-results/batch5/e2e*.log`). The M28
spec loads the demo town through the load screen: 1,308 touching pairs, none alike, 1,001 of 1,001
hand-made, 1.00M triangles from the whole-city view (0.98M before); the M25 spec's town is 57 of 57
hand-made, its tenement measured as before.

## Start-up (model batches 4 and 5; MacBook Pro M5, Chrome)
`node scripts/dev/startup.mjs --dist dist-test,dist-before` serves each build gzipped as GitHub Pages
does and opens it in a fresh Chrome profile on a throttled connection; time from navigation until
the main menu is up over the demo town (a new city in brackets), average of three runs, in seconds
(`bench-results/batch4/startup*.log`, `bench-results/batch5/startup*.log`). The models file over the
wire: 1,287 KB before batch 4; 1,991 KB with it, stored as plain numbers; 443 KB stored as differences
(DECISIONS, "Model batch 4"); 514 KB with batch 5.

| Connection | Before batch 4 | Batch 4, plain numbers | Batch 4, as shipped | Batch 5 (batch 4 alongside) |
|---|---|---|---|---|
| unthrottled | 0.70 (0.50) | 0.72 (0.50) | 0.76 (0.51) | 0.79 (0.50) / 0.76 (0.50) |
| 20 Mbit/s | 1.48 (1.22) | 1.77 (1.50) | **1.11 (0.85)** | 1.16 (0.89) / 1.11 (0.86) |
| 10 Mbit/s | 2.39 (2.02) | 2.96 (2.60) | **1.68 (1.31)** | 1.74 (1.40) / 1.69 (1.33) |
| 5 Mbit/s | 4.15 (3.57) | 5.31 (4.72) | **2.75 (2.19)** | 2.90 (2.32) / 2.75 (2.21) |
| 3 Mbit/s | 6.37 (5.49) | 7.65, no models (7.42) | **4.07 (3.19)** | 4.26 (3.41) / 4.09 (3.20) |

At 3 Mbit/s the batch as plain numbers missed `loadModels`' 6 s deadline on the menu, and every
building was generated. As shipped, the menu gets its models down to 1.5 Mbit/s (7.4 s), and a new
city down to 1 Mbit/s (8.3 s). Unthrottled, the 0.06 s on the menu is the probe's server gzipping
the file on its first request (a new city, with it gzipped already, is even); decoding takes 4–8 ms.
Batch 5 opens 0.05 s later at 20 Mbit/s and 0.18 s at 3 (the batch-4 build measured alongside, in
turn, run by run); the menu still gets its models down to 1.5 Mbit/s (they arrive 4.9 s into the 6 s,
against 4.5 s before) and a new city down to 1 Mbit/s (5.1 s, against 4.6); at 1 Mbit/s the menu
misses with either build (`startup-slow.log`).

## Real hardware (Phase 2 review)
- The ~110k bench city on a MacBook Pro M5, High graphics, 3× speed: about 60 fps (58–65) in Safari in every view (whole city, mid-zoom, street level, night, a tornado), which is Safari's 60 fps cap; in Chrome at 120 Hz, 100–118 fps with 1.5–4.4 ms of frame work. 287 draw calls and 2.75M triangles at the whole-city view. Sim tick avg 0.6–0.8 ms, worst 6 ms, at 24 ticks a second: the worst ticks this VM measured (15–28 ms) are the VM, so the profile-guided pass on the matcher and happiness (review item 6) was dropped.

## Performance (playthrough fixes)
- `balance.ts 20` on the Mac, base `main` at 5b261bd against this branch: greedy (420 / 16 % at year
  20, $566k) and neglectful (354 / 36 %, $480k) are byte-identical. The careful mayor's city ends
  year 20 at **50,377 residents, 78 % approval, $1.71M** against 71,565, 72 % and $1.50M (every
  election won either way). Bisected to P20's corrected winter forecast alone: the careful mayor
  builds a power plant whenever "Winter will need more power" shows, and the old forecast raised it
  far more often, so the mayor had been building power well ahead and grew a bigger city on it
  (DECISIONS, "The balance runs after this round"). No rule of the game changed; P7, P1, P5, P8,
  P10, P15 and P25 leave the runs byte-identical.

## Performance (latest: M24)
- `bench.ts 8 --big --profile` (M24 adds no work to the tick: terraforming and the editor run only on a command): two runs at 97–110k gave tick avg 0.78–1.05 ms, p99 6.2–9.7 ms, and worst per month 10.4–25.1 ms and 14.4–28.3 ms; an A/B run of the M23 commit the same hour gave 0.77–1.03 ms and 7.9–16.0 ms with identical populations. The worst ticks are single-system outliers (landValue or utilities at the month-4 growth burst, one 27.8 ms matcher round in month 8) that land in different months each run. The average sits at or just over the 1 ms budget in months 4–5 in all three runs, and single ticks over 15 ms have shown up since M20 (M23 17.3, M22 16.4, M20 17.2). A profile-guided pass on the matcher and happiness is the next performance step if real hardware shows it. `balance.ts 20`: identical to M23 (careful 66,127 / 71 % at year 20, every election won, treasury $25M; greedy 420 / 16 %; neglectful 354 / 36 %), as expected with no tick changes. Draw calls: M24 adds nothing drawn in normal play (the brush ring is the existing ghost; entry markers are DOM labels in the editor only).

## Performance (M23)
- `bench.ts 8 --big --profile` (M23: the bench city has its neighbours, so regional commuters, shoppers and visitors run in every matching round): at 97–110k tick avg 0.67–1.04 ms, p99 5.4–8.8 ms, worst per month 8.3–17.3 ms (M22: 0.87–1.02 ms, 10.5–16.4 ms); the matcher, which now does the regional pass, peaks at 12.5 ms and is usually under 8; noise and the region don't show among the costliest. Rendering the saved city (`bigshot.mjs`): 289 draw calls / 2.59M triangles at the overview, 157 / 1.77M at the city preset, 94 / 0.94M at street level (M13: 288, 158, 95); planes and ships are one instanced draw each, only when there are any. `balance.ts 20`: careful 66,127 / 71 % at year 20 (peak ≈68k in year 12; M22 56,406 / 75 %), every election won, treasury $25M; greedy 420 / 16 % (M22 292: the neighbours' commuters staff its industry), neglectful 354 / 36 % (M22 485).

## Performance (M22)
- `bench.ts 8 --big --profile` (M22: the bench city has the lakes preset's continental weather; its eight months run March to October, so the snowstorm case is timed separately below): at 99–111k tick avg 0.87–1.02 ms, worst per month 10.5–16.4 ms (M21: 0.65–1.04 ms, 9.4–15.5 ms); the weather system doesn't show among the costliest. `snowbench.ts` on the saved 100k city (four depots, ten hours of heavy snow, the first day after loading): tick avg 3.58 ms vs 3.47 ms for the same day without snow, p99 19 vs 18 ms, weather (with plough dispatch) ≤ 7.3 ms; the heavy first day is the cold start after a load, with or without snow. `balance.ts 20`: careful 56,406 / 75 % at year 20 (peak ≈57.8k; M21 67,411 / 71 %), every goal met including the launch complex, five elections won, taxes handed back down to 2 % once rich (so net ≈ −$5k a month on a $3.6M treasury by year 20); greedy 292 / 16 %, neglectful 485 / 41 %. The smaller careful city isn't the weather: an A/B with `--weather 0 --seasons off` goes both ways across four seeds (see DECISIONS M22); those runs found and fixed a mayor dead end on seed s1. The menu demo town (M19's, 27k) holds 26–28k through a year of M22 weather.
- `bench.ts 8 --big --profile` (M21: the bench city paints no districts, so this checks the per-building `policyAt` lookups and the rest idle): at 100–110k tick avg 0.65–1.04 ms, p99 5.6–9.4 ms, worst per month 9.4–15.5 ms over two runs, except one 52 ms utilities tick in month 6 of the first run that the second didn't reproduce (the VM or GC; watch for it). An A/B run of the M20 commit straight after: 0.77–1.04 ms, worst 12.0–16.0 ms, identical populations, so M21 costs nothing measurable. `balance.ts 20`: identical to M20 (careful 67,411 / 71 % at year 20, five elections won, treasury $32M; greedy 368 / 22 %; neglectful 490 / 36 %); the balance mayors paint no districts. Draw calls are unchanged in normal play: the district view draws through the data-map overlay texture and names are DOM labels.
- `bench.ts 8 --big` (M20: the bench city builds no rail, so this checks the cost of the new systems idle): at 100–110k tick avg 0.65–0.92 ms, p99 5.5–8.6 ms, worst per month 9.4–17.2 ms over two runs (the worst at month 5's growth burst: utilities 14.5 ms once, 17.2 ms once; ~51–57 ms once in month 1, the cold start). An A/B run of the M19 commit the same hour: 0.64–0.87 ms, worst 9.7–15.9 ms (landValue 15.9 at month 5), with identical populations, so M20 costs nothing measurable and the month-5 spikes near 15 ms predate it. Rendering the saved 100k city (`bigshot.mjs`): 289 draw calls / 2.65M triangles at the overview, 156 / 1.78M at the city preset, 94 / 0.96M at street level (M13: 288 / 2.67M, 158, 95). `balance.ts 20`: careful 67,411 / 71 % at year 20 (peak 71.8k in year 9; M19 64,907 / 72 %, path-dependent), four of five projects open (the launch complex still waits on education), five elections won, treasury $32M; greedy 368 / 22 %, neglectful 490 / 36 % (unchanged). The balance mayors don't build rail. Rail scenes on SwiftShader: a 1,200-resident town with a train line, a tram loop and a freight train draws 137 calls / 0.57M triangles at street level (`railshot.mjs`).
- `bench.ts 8 --big --profile` (M19: junction delays in every route cost): at 100–110k tick avg 0.64–0.92 ms, p99 5.5–8.8 ms, worst per month 9.4–14.5 ms (61.8 ms once in month 1, the cold start). An M18 baseline run the same hour: 0.64–0.97 ms, worst 9.6–25.7 ms, and the same populations within 1 % (both cities lose jobs in months 7–8: that's the bench city, not M19). Visible cars (following, junctions, roundabouts) cost 0.44 ms a frame for 122 cars in the 100k city here (`renderStats.trafficMs`). `balance.ts 20`: careful 64,907 / 72 % at year 20 (peak 67.6k in year 7; M18 67,137 / 78 %: junction delays lengthen commutes a little), four of the five projects open (the launch complex waits on high-school education, 19 % of the 35 % it needs), five elections won, treasury $26.6M by year 20; greedy 368 / 22 %, neglectful 490 / 36 % (both lose every election). The menu demo town: 27k residents, 147 draw calls behind the menu.
- `bench.ts 8 --big` (M18; the sandbox bench plays no scenario, populations identical to M17): at 97–111k tick avg 0.66–0.94 ms, p99 5.6–8.2 ms, worst per month 10–14 ms (54.8 ms once in month 1 at 639 residents, the cold start). `balance.ts 20` (M18: the careful mayor starts a big project once the first stage is in hand and the treasury plus its income over the build will cover the rest, and refused commands skip the undo snapshot): careful 67,137 / 78 % at year 20 (passes 50k in year 11, peak 68.6k in year 14), all five projects open, the sky needle built, five elections won; greedy 234 / 16 %, neglectful 288 / 41 % (both unchanged). The careful 20-year run takes about 3 minutes (M17: about 5).
- `bench.ts 8 --big` (M17): at 97–111k tick avg 0.61–0.92 ms, p99 5–8 ms, worst per month 7–15 ms (66.8 ms once in month 1 at 639 residents, the known cold start). `balance.ts 25` (the careful mayor now plans the whole map, so its numbers aren't comparable with M16's): careful 64,733 / 78 % at year 20 (passes 50k in year 11, peak 67.5k), all five projects open, six elections won; greedy 234 / 16 %, neglectful 288 / 41 % at year 20 (both lose every election). Chart of the careful mayor's money: `docs/screenshots/m17-money.png`.
- `bench.ts 8 --big` (M16; history recorded each month): at 97–111k tick avg 0.65–1.02 ms, p99 5–10 ms. Worst per month 8–17 ms in a profiled run (month-start work now timed separately); an unprofiled run the same hour had one-off 92 ms (month 4) and 64 ms (month 6) ticks that the profiled rerun didn't reproduce (GC or the VM; watch for it). `balance.ts 20`: careful 18,906 / 68 % (treasury $9.8M by year 20: the surplus M17 has to find uses for), greedy 102 / 14 %, neglectful 346 / 38 %, identical to M15.
- M15 changes no sim code; reruns match M14. `bench.ts 8 --big` at 97–111k: tick avg 0.87–1.15 ms, p99 7–10 ms, worst per month 11–20 ms; `balance.ts 20`: careful 18,906 / 68 %, greedy 102 / 14 %, neglectful 346 / 38 % (identical).
- `npx tsx scripts/bench.ts 30 --big` (M14): ~111k residents by month 5. At 97–111k: tick avg 0.91–1.28 ms, p99 7–11 ms, worst per month 10–21 ms. No regression from M14 (it changes no tick system): an A/B run back to back on this VM gave M13 code 0.83–1.22 ms / worst 10–17 ms and M14 0.91–1.20 ms / 10–20 ms, with identical populations. The VM measures about 25 % slower today than when M13 was logged (M13: 0.69–0.96 ms, worst 7–15 ms; M12: 0.68–0.81 ms and 11–14 ms at 84–110k). One-off 65–85 ms ticks in the first game hour of a freshly built big city (cold caches, JIT).
- `npx tsx scripts/balance.ts 20` (M13, identical at M14): careful 18,906 residents / 68 % approval at year 20 (22,214 / 69 % before; path-dependent, see DECISIONS M13: on seeds s1–s3 the careful city now reaches 16.5–17k by year 8 where the old roads left two of them at 700–1,050); greedy 102 / 14 %, neglectful 346 / 38 %, unchanged.
- `npx tsx scripts/bench.ts 12 9` (the older ~12k town): tick avg ~0.12–0.21 ms.
- Rendering the ~100k city (`scripts/dev/bigshot.mjs`, SwiftShader, M13 at 112k): 288 draw calls / 2.67M triangles at the whole-city overview (about half the triangles are the shadow pass), 158 / 1.85M at the city preset, 95 / 1.05M at street level (M12 at 106k: 288 / 2.5M, 156 / 1.8M, 92 / 1.05M). Was 1,241 draw calls before civic, building, road and zone chunks were enlarged.
- Night town (720 residents, M9): ~95 draw calls, ~0.75M triangles on SwiftShader. A tornado adds 3 point systems (~2,200 points); flood water is one mesh; dust bursts share one point system.
- Procedural models: mean triangles per building R0 139, R1 329, R2 622, C0 102, C1 254, C2 481, I 174–217 (`scripts/dev/modelstats.ts`).

## To check on the Mac
- Terrain and map editor (M24): how smooth dragging the terrain tool and the editor's big brushes feels (each pass rebuilds the terrain chunks under the brush); how a levelled terrace and a cut pass look close up; how a custom map's edge blends into the scenery beyond it (a sea painted to the edge fades out 400 m past it); the editor's labels and panels at 140 % interface size.
- Level crossings and trams (Phase 2 review): the barriers coming down and cars waiting behind them, and trams and cars sharing a busy avenue, at 60 fps; visible cars cost 0.3–1.2 ms a frame in the rail scene on this VM, where a slow frame runs up to 20 traffic steps (`renderStats.trafficMs`).
- Rail (M20): trams, trains and freight trains at 60 fps in a big city with several lines; how the tram wires, level crossings, stations and the freight yard look close up; whether cars following round the tram depot and crossings read well.
- Visible cars (M19): 360 cars following, queueing and going round roundabouts at 60 fps in a big city (`renderStats.trafficMs` in the debug panel should stay well under 1 ms); how the ring, the flyover decks and the ramp merges look close up.
- [x] The ~100k city at 3× speed: checked on a MacBook Pro M5 (High graphics), 60 fps in every view in Safari (its cap) and 100–118 fps in Chrome at 120 Hz; no per-building LOD needed (see "Real hardware" under Performance).
- Game shell: the main menu's slow orbit over the backdrop should be smooth; the three quality levels should look and perform distinctly; interface size 140 % on a laptop screen (the top bar drops the Jobs stat and city name when it would not fit).
- Landmarks and specialisation buildings (clock tower, wheel, sky needle, arch, hotel, mine, well, freight terminal, research park): how they look close up at full resolution, and the milestone banner's confetti at 60 fps.
- Disasters: frame rate with a tornado funnel and flood water on screen; whether the earthquake camera shake feels right at 60 fps.
- Audio: listen to the effects (build, zone, bulldoze, place, alert, siren) and the ambient bed over a busy street, woods by day and night, and from high up; check the mix and that nothing clips.
- Tilt-shift (menu → Graphics): frame cost at 60 fps and whether the blur strength feels right.
- Pedestrians at street level: frame time with 240 walkers.
- Graded roads (M13): how cuttings, embankments and civic pads look at full resolution (`node scripts/dev/earthshot.mjs` scene, or build a street over a hill on the highlands preset), and whether the road ghost's grade colours and the see-through ghost read well while drawing.
- Trackpad (M14): two-finger swipe pans, pinch zooms, ⌥/Alt + swipe turns and tilts, and Safari's rotate gesture; check that the automatic mouse/trackpad detection guesses right on a MacBook trackpad and a Magic Mouse, and that ⌘Z / ⇧⌘Z undo and redo.
- Published app (M15), once Pages is on: open https://pxwom6.github.io/CityBloom/ in Safari and Chrome; install it (Chrome's install icon in the address bar; Safari → File → Add to Dock); turn Wi-Fi off and open it again (it should start and play); after the next push to `main`, an open copy should show "New version of Citybloom · Reload" within an hour or on returning to the tab, and Reload should come back with your city under Continue. Check that the first launch picked High on the Mac (Settings → Graphics says what it picked) and the icon looks right in the Dock and the share preview (paste the link into a chat app).
- Scenarios (M18): the scenario screen's previews and the brief, goals and win screens at full resolution and 140 % interface size.
- Photo mode (M16): frame rate with depth of field and tilt-shift on (the lens pass costs two full-screen passes, 48 depth-aware taps a pixel) at Retina resolution; how long a 2× save takes (should be well under a second); whether the six grades and the golden-hour light look right on a calibrated screen; the follow camera's ride along a busy street at 60 fps.
- Big projects (M17): the five projects at each construction stage close up at full resolution (`node scripts/dev/projectshot.mjs`), and a match day's crowd of cars around the stadium at 60 fps.
- Frame rate while panning the overview and street presets (expect 60 fps).
- Fire/smoke particles and siren lights: check they read well and cost little at 60 fps.
- Visible traffic at 360 cars: frame time while panning (cars follow, queue and give way since M19).
