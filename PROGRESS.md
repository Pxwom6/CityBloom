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
- [ ] M17 Big projects and elections
- [ ] M18 Scenarios
- [ ] M19 Traffic tools
- [ ] M20 Rail
- [ ] M21 Districts
- [ ] M22 Seasons and weather
- [ ] M23 Region, airport and seaport
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
offers each new version (M15). Everything runs from a deterministic sim in a Web Worker: 0.7–1.3 ms
per tick on average at 100k residents on this VM (it varies by day; see Performance), with 288 draw
calls at the city overview. Checked by 174 unit and scenario tests, 20 UI tests, a 10-minute soak
and a full playthrough through the UI (`docs/SPEC_REVIEW.md` maps every SPEC item to where it's
done).

## Ideas for what's next
1. **Real-hardware pass** (the list under "To check on the Mac"): frame rate at 100k, and
   per-building LOD if 2.5M triangles at the overview is too much for the GPU.
2. **Trams and trains**: the transit system (lines, stops, riders) and road graph are ready for
   rail lines with their own right of way; a rail freight link would feed the trade specialisation.
3. **Visible traffic that queues**: car-following and junction yielding for the drawn cars (the
   sim's congestion already works); tourists driving in from the highway.
4. **Neighbouring cities** that trade power, water and garbage and share the highway's demand.
5. **Weather and seasons**: snow on roofs, rain lowering park use, heating demand in winter.
6. **More specialisations** (education hub, gambling/entertainment, electronics) using the same
   building + economy pattern as M10.
7. **Custom glTF models** through the existing asset registry (`src/render/assets/registry.ts`).
8. **Balance**: commercial demand runs a little low in small towns and mature cities run a large
   surplus; a second tuning pass once real players have tried it.

## In progress
Phase 2 (SPEC-2.md, M13–M24). M15 Publish it is complete: a Pages deploy workflow, an installable
app that plays offline after one visit and offers "New version, reload" (autosaving first), a share
preview, a first-launch graphics check, and the README's simulation claim corrected. The whole e2e
suite runs against a production-mode build served from `/Sim-Cities/`. Publishing needs the two
clicks at the top of this file.

M16 Photo mode and city history is complete: the sim records ten figures each month (save v14)
and the City history panel (Y) charts them with milestones and disasters marked; photo mode (K)
hides the interface, brings the camera to eye level, sets light, lens (depth of field, tilt-shift),
field of view and six grades, follows a car, bus or person, and saves a PNG at 1× or 2×. All 20
e2e specs pass (M16's rerun after the full run, see DECISIONS), 174 unit tests.

## Next tasks
1. M17 Big projects and elections, in progress. Done and pushed: five projects (stadium, launch
   complex, solar tower array, garden expo, convention centre) built in stages with requirements,
   models per stage and perks; elections every four years with promises, a win's grant and
   goodwill, a loss's year of council limits (save v15); the Big projects toolbar, inspector
   progress, the city panel's Election tab, the elections setting; unit tests and the M17 e2e spec
   (passes). Left: the balance tool's careful mayor (whole-map plan, spending goals, promises;
   being tuned in `scripts/balance.ts`) passing 50k with a project built and an election won; a
   late-game money check; README, DESIGN, DECISIONS, SPEC_REVIEW; bench and balance reruns.
2. Then M18 Scenarios.
3. Performance watch: tick average at the big city's growth burst varies 0.9–1.3 ms by VM day;
   one unprofiled M16 run had one-off 64–92 ms ticks. Look for savings before M19 adds
   car-following.

## Known issues
- Photo mode's depth of field is a screen-space gather: fine for stills, but thin bright things right against a blurred background can show a faint halo, and saving at 2× takes up to a minute on this VM's software renderer (a fraction of a second on a GPU).
- The follow camera loses a car when it parks (the panel says so); buses loop for good.
- Homes without power or water still empty after about two days; the balance runs show a careful player never hits this, so no grace period was added.
- Visible cars and walkers follow trip samples from the last assignment round, so for up to two game hours after a road closes some still drive along it; commuters, services and utilities reroute at once.
- Buildings along a road closed for repairs lose power and water until it reopens (lines run under the roads); with 6–24 h repairs this rarely empties them, but a big quake still costs a town a lot.
- Visible cars don't queue or yield at junctions; they overlap when paths cross. Speeds do follow congestion.
- Bus riders' door-to-door time includes walking and waiting, so a bus line mainly helps by taking cars off jammed roads (≈10–20 % less traffic in the test town), not by being faster than driving.
- Towns without services stagnate and slowly lose residents (the neglectful balance run); that's intended, but it could be clearer to a new player why.
- Commercial demand runs negative once a town has zoned a strip of shops in every district (shoppers vs. shops); the careful balance mayor now zones shops only while they're wanted. Big cities run short of jobs rather than homes: industry demand stays high once the map is full.
- Visitors (M10) are counted, spend money and shop, but don't drive through the traffic model yet.
- Growth to 100k residents is exercised by the large-city benchmark (a sandbox grid); the scripted careful mayor fills the river map at about 67k (M17).
- Tree count is high in forests (~25k in-map); LOD switches to low-poly beyond 750 m.
- Cutting faces and embankments read softly: the terrain is 8 m height samples, so a 1:1 cut face shows as a brown bank over one cell rather than a crisp edge.
- Roads can't join or cross a viaduct mid-span (no grade separation until M19); the planner says to meet it where it's back on the ground.
- Undo history costs a snapshot per command (about 25 ms in a 12k town, ~55 ms at 112k, on the worker, so the UI doesn't stall); it isn't saved, so undo starts fresh after loading.
- Undo refuses (with a toast saying why) when the city has changed underneath: buildings grown on an unzoned strip, a road now carrying traffic incidents, and so on; the change stays and the history moves past it.
- The benchmark grid still fails 5 avenue links whose junctions differ in height by more than 12 % of their length, and 26 bridges without land for ramps (81 failures before M13).

## Performance (latest: M16)
- `bench.ts 8 --big` (M16; history recorded each month): at 97–111k tick avg 0.65–1.02 ms, p99 5–10 ms. Worst per month 8–17 ms in a profiled run (month-start work now timed separately); an unprofiled run the same hour had one-off 92 ms (month 4) and 64 ms (month 6) ticks that the profiled rerun didn't reproduce (GC or the VM; watch for it). `balance.ts 20`: careful 18,906 / 68 % (treasury $9.8M by year 20: the surplus M17 has to find uses for), greedy 102 / 14 %, neglectful 346 / 38 %, identical to M15.
- M15 changes no sim code; reruns match M14. `bench.ts 8 --big` at 97–111k: tick avg 0.87–1.15 ms, p99 7–10 ms, worst per month 11–20 ms; `balance.ts 20`: careful 18,906 / 68 %, greedy 102 / 14 %, neglectful 346 / 38 % (identical).
- `npx tsx scripts/bench.ts 30 --big` (M14): ~111k residents by month 5. At 97–111k: tick avg 0.91–1.28 ms, p99 7–11 ms, worst per month 10–21 ms. No regression from M14 (it changes no tick system): an A/B run back to back on this VM gave M13 code 0.83–1.22 ms / worst 10–17 ms and M14 0.91–1.20 ms / 10–20 ms, with identical populations. The VM measures about 25 % slower today than when M13 was logged (M13: 0.69–0.96 ms, worst 7–15 ms; M12: 0.68–0.81 ms and 11–14 ms at 84–110k). One-off 65–85 ms ticks in the first game hour of a freshly built big city (cold caches, JIT).
- `npx tsx scripts/balance.ts 20` (M13, identical at M14): careful 18,906 residents / 68 % approval at year 20 (22,214 / 69 % before; path-dependent, see DECISIONS M13: on seeds s1–s3 the careful city now reaches 16.5–17k by year 8 where the old roads left two of them at 700–1,050); greedy 102 / 14 %, neglectful 346 / 38 %, unchanged.
- `npx tsx scripts/bench.ts 12 9` (the older ~12k town): tick avg ~0.12–0.21 ms.
- Rendering the ~100k city (`scripts/dev/bigshot.mjs`, SwiftShader, M13 at 112k): 288 draw calls / 2.67M triangles at the whole-city overview (about half the triangles are the shadow pass), 158 / 1.85M at the city preset, 95 / 1.05M at street level (M12 at 106k: 288 / 2.5M, 156 / 1.8M, 92 / 1.05M). Was 1,241 draw calls before civic, building, road and zone chunks were enlarged.
- Night town (720 residents, M9): ~95 draw calls, ~0.75M triangles on SwiftShader. A tornado adds 3 point systems (~2,200 points); flood water is one mesh; dust bursts share one point system.
- Procedural models: mean triangles per building R0 139, R1 329, R2 622, C0 102, C1 254, C2 481, I 174–217 (`scripts/dev/modelstats.ts`).

## To check on the Mac
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
- Photo mode (M16): frame rate with depth of field and tilt-shift on (the lens pass costs two full-screen passes, 48 depth-aware taps a pixel) at Retina resolution; how long a 2× save takes (should be well under a second); whether the six grades and the golden-hour light look right on a calibrated screen; the follow camera's ride along a busy street at 60 fps.
- Frame rate while panning the overview and street presets (expect 60 fps).
- Fire/smoke particles and siren lights: check they read well and cost little at 60 fps.
- Visible traffic at 360 cars: frame time while panning; cars overlap at junctions (no car-following model).
