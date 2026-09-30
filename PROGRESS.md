# PROGRESS

Phase 3 (graphics, SPEC-3.md) runs locally on the owner's Mac on the `phase-3` branch; the owner
merges it into `main`, which deploys the live site at https://pxwom6.github.io/CityBloom/.

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
- [ ] M25 Baseline and model pipeline
- [ ] M26 Light and sky
- [ ] M27 Ground, lots and streets
- [ ] M28 Buildings and variety

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
8. **Custom glTF models** through the existing asset registry (`src/render/assets/registry.ts`).
9. **Balance**: commercial demand runs a little low in small towns; the big-city running costs and
   the scenario star thresholds want a second look once real players have tried them.

## In progress
M25 (baseline and model pipeline): built, and being closed out. All 136 models pass
`models:check`; unit tests pass (371 before the last converter fixes, the 37 model tests after).
A review workflow (every model looked at in the game, plus a code review by area) is part-way
through; its results are in the session's workflow journal (`wf_e6d94600-b44`).

Done from the reviews: double-sided sheets, project stages seen from inside, cranes and cabins
clear of the building, only real boxes hide faces, distant versions keep undersides, glazed rooms,
frame faces and crown posts, damaged files fail the check, quarter turns caught, party walls back
on the footprint edge.

Still to do from the code review of `handmade.ts` (found, not yet fixed):
1. Annexes can land on entrance roads and in front of doors (landfill, fire station, recycling):
   give the bake a keep-clear mask (entrance roads, aprons, forecourts, a strip in front of each
   door and garage door) and have `clearPlace` try smaller sizes at the back and sides before
   any spot along the front.
2. Garden trees of a hand-made civic building stay after it is demolished or moved
   (`renderer.ts`: `world.onCivics` ignores `removed`); rebuild every tree region a lot or site
   touches, for zoned lots too (a lot across a 512 m region line).
3. A shrunk annex's ground slab is within a millimetre of the site's surface: leave an inset's
   ground triangles out (the site has its own ground).
4. Different looks of one design can paint identically (hi-tech industry: three wall colours):
   pick the wall colour and mirroring by the look's rank among the hand-made looks.

Then: the rest of the review's results (homes, industry, night and seasons, distant versions of
civic and shop models, code review of levels of detail, renderer changes, build), the full e2e
run, final frame times (all presets, against `dist-base`), bench and balance numbers
(`bench-results/balance-m25.log`: careful 71,565 / 72 % at year 20, every election won),
SPEC_REVIEW, the regenerated `docs/screenshots`, and the `M25 complete:` commit.

## Next tasks
1. M25: fixes from the reviews; full e2e; final numbers; `M25 complete`.
2. M26 Light and sky: ambient occlusion, split shadow maps with distant versions casting, sky and
   sun through the day, haze, glow at night.
3. M28 note: most level-2 and -3 buildings stand on lots smaller than their type's own (upgrades
   rarely widen), where the type's model can't fit, so they stay generated: 17 % of the bench city's
   buildings wear hand-made models. Decide there whether a smaller sibling's model may stand in.

## Models (phase 3)
136 files in `assets/models/` (every zoned type, `R103-2`, 8 annexes, 46 civic buildings);
`npm run models:check` passes all 136. Converted: 169k triangles in the files, 139k drawn near, 82k
far, 50k in the skyline; the models file is 2.3 MB (0.8 MB gzipped), fetched at start.

| File | Status |
|---|---|
| `R103.glb` (the tenement) | passes as a row model (8 × 16 m, three abreast on its 24 m lot, two on a 16 m lot), with notes: 16 m deep on a 24 m lot, and trim, steps and the awning overhang its footprint by up to 1.5 m |
| `library.glb`, `primary.glb`, `university.glb` | failed as first delivered (a gable or wall slid 4–9 m off its building: "a wall hangs in the air", and the library was 24 m wide on its 20 m site); the owner's fixed files pass |
| the other 132 | pass with no notes |

Things seen in the models while reviewing every one in the game (they pass the check and are in; for
the owner, if a model is ever remade):
- `firestation`: a thin strip of roof along the ridge sits a little proud of the roof.
- `skyneedle`: benches stand inside the planters at its foot.
- `nuclear`: the cooling towers' bases run into the boundary wall.
- `recycling`: the shed roofs' end caps are in the roof material, so they repaint with the roof.
- `C223`: the lobby glass lies in the plane of the wall (it can shimmer at a distance).
- `university`: the back walls of the wings have no windows.
- Several civic sites leave no clear back corner, so an add-on annex stands at the nearest clear
  spot, shrunk (the clinic's and the police station's most).
- `tree_spot`s within a metre or two of a wall put a tree's crown into the wall (a few homes).

**Models that pass but rarely or never appear** (a lot-size matter, not a fault in the models): a
model stands only on a lot as wide as it (or two or three times as wide, in a row) and at least as
deep. Buildings start at level 1 on the level-1 lot and an upgrade widens only if the cells beside
it are free, which on a built-up street they aren't. So in played cities:
- **Family houses and villas (`R002`, `R012`, `R022`, `R003`, `R013`, `R023`, 16 m wide) never
  appear**: low-density homes stay one cell (8 m) wide (in 50 saved cities, 4,398 villas, none on a
  16 m lot). Only the cottages (`R0x1`, 8 m) fit. Versions 8 m wide (8 × 16 or 8 × 24 m) would.
- Level-2 and -3 medium- and high-density buildings mostly stay on 16 m lots: the 24 m models
  (`R1x3` courtyard blocks, `C1x3`, `R2x2`/`R2x3`, `C2x2`/`C2x3`, …) appear only where a lot did widen
  (the tenement, 8 m wide, fits everywhere its type grows).
- In the bench city 17 % of buildings wear hand-made models, in the menu's demo town 25 %
  (`node scripts/dev/modelcensus.mjs <save>` lists them by type and lot). The rest are generated.
  Whether a smaller sibling's model may stand in on a small lot is a question for M28.

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

## Real hardware (Phase 2 review)
- The ~110k bench city on a MacBook Pro M5, High graphics, 3× speed: about 60 fps (58–65) in Safari in every view (whole city, mid-zoom, street level, night, a tornado), which is Safari's 60 fps cap; in Chrome at 120 Hz, 100–118 fps with 1.5–4.4 ms of frame work. 287 draw calls and 2.75M triangles at the whole-city view. Sim tick avg 0.6–0.8 ms, worst 6 ms, at 24 ticks a second: the worst ticks this VM measured (15–28 ms) are the VM, so the profile-guided pass on the matcher and happiness (review item 6) was dropped.

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
