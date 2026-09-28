# PROGRESS

## What you need to do (to publish the game, M15)
1. **Merge this branch into `main`**: open a pull request from `claude/city-building-game-design-yk7dix`
   to `main` on GitHub and merge it. The deploy workflow (`.github/workflows/deploy.yml`, already
   pushed) runs on every push to `main`.
2. **Turn on Pages**: the repository's **Settings → Pages → Build and deployment → Source:
   "GitHub Actions"**. (Pages on a private repository needs a paid plan; on a free plan, make the
   repository public first.)
3. That's all. The merge starts the first deploy (or **Actions → Deploy to GitHub Pages → Run
   workflow**); after about two minutes the game is at **https://pxwom6.github.io/Sim-Cities/**.
   Later pushes to `main` redeploy, and open copies of the game offer "New version, reload".

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
- [ ] M24 Terrain and map editor

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
garden expo, a launch complex) and face elections every four years (M17). Thirteen scenarios, each
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
runway (M23).
Everything runs from a deterministic sim in a Web Worker: 0.7–1.3 ms
per tick on average at 100k residents on this VM (it varies by day; see Performance), with 288 draw
calls at the city overview. Checked by 251 unit and scenario tests, the UI specs in `e2e/`, a 10-minute soak
and a full playthrough through the UI (`docs/SPEC_REVIEW.md` maps every SPEC item to where it's
done).

## Ideas for what's next
1. **Real-hardware pass** (the list under "To check on the Mac"): frame rate at 100k, and
   per-building LOD if 2.5M triangles at the overview is too much for the GPU.
2. **Rail, further**: branching train lines with services per branch, tram and bus stops shared as
   interchanges, and level-crossing barriers that close when a train passes.
3. **Traffic lights** as a third junction type between a plain junction and a roundabout, and
   tourists driving in from the highway (visitors aren't in the traffic model yet).
4. **Neighbouring cities** that trade power, water and garbage and share the highway's demand.
5. **Weather, further**: weather fronts that cross the map, frozen lakes, and seasonal tourism
   (ski resorts in winter, beaches in summer).
6. **More specialisations** (education hub, gambling/entertainment, electronics) using the same
   building + economy pattern as M10.
7. **Custom glTF models** through the existing asset registry (`src/render/assets/registry.ts`).
8. **Balance**: commercial demand runs a little low in small towns, and a city that has bought every
   project and landmark still creeps into surplus; a second tuning pass once real players have
   tried it.

## In progress
M24 Terrain and map editor. Done and pushed: the terrain tool (Shift+T: raise, lower, level, smooth,
paid by the cubic metre, holding the ground under roads and buildings, one undo step per drag);
custom maps (heights, forests, ore, oil, highway and railway entries) kept in the city's save (v22);
the map editor from the main menu (sculpt, river and lake, sea, land, forest, ore and oil brushes
with undo, entries, climate, a playability check, save, `.citymap` export and import, play), and
"Your maps" on the new-city screen; `tests/terraform.test.ts`, `customMap.test.ts`,
`mapEditor.test.ts` (a map made in the editor saves, reloads and grows a city). Working on: the
Terraces scenario (a hill town on an editor-format map, `scripts/lib/ridgeMap.ts`).

## Next tasks
1. Terraces scenario: recipe, def, tests (won by cutting the pass, lost on the shelf alone), preview.
2. `e2e/m24-terrain.spec.ts` through the UI (terrain tool in a city; the editor from the main menu to
   a city on the map), screenshots reviewed.
3. Docs (README, DESIGN §3.25, DECISIONS, SPEC_REVIEW, CLAUDE.md), bench and balance, full e2e,
   `M24 complete:`.
4. The end of the brief: summary and ideas in PROGRESS, SPEC_REVIEW's last section, a final
   playthrough through the UI using the new features.

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
- The M23 full e2e run had two old specs fail on view-dependent details (M14 clicked a warehouse that M23's regional commuters grew in front of the police station at a low camera angle; M16 hovered the history chart before its panel settled). Both now click and hover robustly and pass.
- The scenario tests run the scripted mayor for up to two game years each: `npm test` takes about 2.5 minutes (the eight scenario files run in parallel).
- Scenario star thresholds were set against the scripted players (which earn one to three stars); real players may find some easy or hard, worth a look once people have played them.
- Once a big city has bought every project and landmark it can reach, its treasury still creeps up (≈ $0.3M a year for the careful mayor at 2 % taxes); later milestones add things to buy.
- Growth to 100k residents is exercised by the large-city benchmark (a sandbox grid); the scripted careful mayor fills the river map at about 67k (M17).
- Tree count is high in forests (~25k in-map); LOD switches to low-poly beyond 750 m.
- Cutting faces and embankments read softly: the terrain is 8 m height samples, so a 1:1 cut face shows as a brown bank over one cell rather than a crisp edge.
- Roads can't join a viaduct mid-span; the planner says to meet it where it's back on the ground. They can pass under one high enough (M19), and local roads crossing each other always meet at a junction (only the city and regional highways pass over).
- Undo history costs a snapshot per command (about 25 ms in a 12k town, ~55 ms at 112k, on the worker, so the UI doesn't stall); it isn't saved, so undo starts fresh after loading.
- Undo refuses (with a toast saying why) when the city has changed underneath: buildings grown on an unzoned strip, a road now carrying traffic incidents, and so on; the change stays and the history moves past it.
- Rail (M20): each connected stretch of track runs one train line in order of running time from its far end, so a branching network gets one line that may double back; trips use one line (no changing between buses, trams and trains); visible trams and trains follow their line's timetable rather than the traffic (a tram passes through queued cars, and cars don't visibly stop at level crossings, though crossings slow them in the model); level-crossing barriers are drawn raised. An old save whose west edge is built up gets no regional rail link.
- The benchmark grid still fails 5 avenue links whose junctions differ in height by more than 12 % of their length, and 26 bridges without land for ramps (81 failures before M13).

## Performance (latest: M23)
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
- Rail (M20): trams, trains and freight trains at 60 fps in a big city with several lines; how the tram wires, level crossings, stations and the freight yard look close up; whether cars following round the tram depot and crossings read well.
- Visible cars (M19): 360 cars following, queueing and going round roundabouts at 60 fps in a big city (`renderStats.trafficMs` in the debug panel should stay well under 1 ms); how the ring, the flyover decks and the ramp merges look close up.
- The ~100k city (`npx tsx scripts/bench.ts 6 --big --save city.gz`, then Load city → Import from file): frame rate while panning the overview and the city preset at 3× speed (target 60 fps); 2.5M triangles at the overview, if the GPU struggles, per-building LOD is the next step.
- Game shell: the main menu's slow orbit over the backdrop should be smooth; the three quality levels should look and perform distinctly; interface size 140 % on a laptop screen (the top bar drops the Jobs stat and city name when it would not fit).
- Landmarks and specialisation buildings (clock tower, wheel, sky needle, arch, hotel, mine, well, freight terminal, research park): how they look close up at full resolution, and the milestone banner's confetti at 60 fps.
- Disasters: frame rate with a tornado funnel and flood water on screen; whether the earthquake camera shake feels right at 60 fps.
- Audio: listen to the effects (build, zone, bulldoze, place, alert, siren) and the ambient bed over a busy street, woods by day and night, and from high up; check the mix and that nothing clips.
- Tilt-shift (menu → Graphics): frame cost at 60 fps and whether the blur strength feels right.
- Pedestrians at street level: frame time with 240 walkers.
- Graded roads (M13): how cuttings, embankments and civic pads look at full resolution (`node scripts/dev/earthshot.mjs` scene, or build a street over a hill on the highlands preset), and whether the road ghost's grade colours and the see-through ghost read well while drawing.
- Trackpad (M14): two-finger swipe pans, pinch zooms, ⌥/Alt + swipe turns and tilts, and Safari's rotate gesture; check that the automatic mouse/trackpad detection guesses right on a MacBook trackpad and a Magic Mouse, and that ⌘Z / ⇧⌘Z undo and redo.
- Published app (M15), once Pages is on: open https://pxwom6.github.io/Sim-Cities/ in Safari and Chrome; install it (Chrome's install icon in the address bar; Safari → File → Add to Dock); turn Wi-Fi off and open it again (it should start and play); after the next push to `main`, an open copy should show "New version of Citybloom · Reload" within an hour or on returning to the tab, and Reload should come back with your city under Continue. Check that the first launch picked High on the Mac (Settings → Graphics says what it picked) and the icon looks right in the Dock and the share preview (paste the link into a chat app).
- Scenarios (M18): the scenario screen's previews and the brief, goals and win screens at full resolution and 140 % interface size.
- Photo mode (M16): frame rate with depth of field and tilt-shift on (the lens pass costs two full-screen passes, 48 depth-aware taps a pixel) at Retina resolution; how long a 2× save takes (should be well under a second); whether the six grades and the golden-hour light look right on a calibrated screen; the follow camera's ride along a busy street at 60 fps.
- Big projects (M17): the five projects at each construction stage close up at full resolution (`node scripts/dev/projectshot.mjs`), and a match day's crowd of cars around the stadium at 60 fps.
- Frame rate while panning the overview and street presets (expect 60 fps).
- Fire/smoke particles and siren lights: check they read well and cost little at 60 fps.
- Visible traffic at 360 cars: frame time while panning; cars overlap at junctions (no car-following model).
