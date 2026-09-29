# Review against SPEC.md (M12)

*The phase-1 section below is the snapshot taken when M12 completed: its figures (test counts,
file counts, draw calls, performance) are M12's. Phase 2 changed many of them; the current figures
are in PROGRESS.md and the phase-2 sections further down.*

Every item in the brief, where it lives, and how it's checked. "e2e mN" is `e2e/mN-*.spec.ts`, and
screenshots are in `docs/screenshots/`. Anything not done is explained at the end and in
`docs/DECISIONS.md`.

## 2. Originality
| Item | Status |
|---|---|
| Original title in one constant | Done: `GAME_TITLE = 'Citybloom'` in `src/config.ts` |
| No SimCity/EA/Maxis names, art, text or sounds | Done: all models, icons and audio are generated in code |
| Third-party licences recorded | Done: `CREDITS.md` (three.js, Preact, fflate: MIT) |

## 3. Platform and stack
| Item | Status |
|---|---|
| TypeScript strict, Vite, Three.js, Vitest, Playwright, ESLint, Prettier | Done |
| WebGL2, HTML/CSS UI over the canvas, design tokens as custom properties | Done: Preact, `src/ui/styles/tokens.css` |
| 60 fps at ~100k residents; no hitches at top speed | Sim side met (`bench.ts --big`: avg 0.6–0.8 ms, worst 9–14 ms per tick); render side at 288 draw calls. The frame rate itself needs the Mac check (PROGRESS.md) |

## 4. Architecture
| Item | Status |
|---|---|
| Pure sim in a Web Worker, typed messages, compact diffs, vehicles animated on the main thread | Done: `src/sim/worker.ts`, `FrameDiff`, ESLint bans DOM/Three/`Math.random`/`Date` in `src/sim` |
| Every action is a command (UI, tests, debug, replays); undo | Done: `src/sim/commands.ts`; undo tested (unit) and in the toolbar |
| Deterministic: seed + commands → same state hash | Done: replay and save/load hash tests (unit, e2e m2, m11) |
| Data-driven balancing | Done: `src/data/*` |
| Road graph, straight and curved | Done: `src/sim/world/network.ts` |
| Instancing/chunked merged geometry, LOD, frustum culling, no per-frame allocations | Done: chunk-merged buildings (256 m), civics (512 m), roads and zones (512 m); instanced trees/vehicles/walkers with LOD; terrain chunks |
| Saves: versioned, compressed, IndexedDB, slots, autosave, export/import, migrations | Done: `src/sim/save.ts` (version 9, migrations), `src/client/saves.ts`; e2e m11 |
| Debug panel (backtick): FPS, tick time, counts; cheats (money, unlock all, disasters, fast-forward) | Done: `src/ui/DebugPanel.tsx` |
| `window.__game` with dispatch/getState/advance/setCamera | Done: `src/client/testApi.ts` |

## 5. Game design
| Area | Status |
|---|---|
| World: seeded terrain, hills, river/coast/lakes, forests, groundwater/ore/oil on data maps; 2×2 km with scenery; highway | Done (M0, M4, M10); every seed has a gentle start area by the highway (M12, terrain v2) |
| New-game options: seed/preset, difficulty, sandbox, disasters | Done (M11): new-city screen |
| Roads: dirt/street/avenue + boulevard, upgrades keep buildings, drag drawing with curves, snapping, intersections, cost preview, invalid state, slope limits, bridges, bulldozer with refunds | Done (M1, M6); e2e m1, m6 |
| Zoning and growth: cells on both sides, RCI painting, density by road and milestones, wealth by land value, construction, upgrades, decline, abandonment, RCI bars with reasons | Done (M1, M2, M10); e2e m1, m2 |
| Money: taxes by zone and wealth, funding sliders, budget panel with history, loans, warnings, bankruptcy, policies | Done (M3, M10); ledger balances to the dollar (unit); e2e m3, m10 |
| Utilities: power (coal, gas, wind, solar, nuclear), water (pumps, river pumps, polluted supply), sewage (septic tanks, outflow, treatment), garbage (landfill, recycling, incinerator, trucks, visible piles), escalating shortages | Done (M4, M12 septic); e2e m4 |
| Services: fire, police, clinic/hospital, primary/high school/university/library, parks and plazas; coverage by road travel; real dispatch | Done (M5); e2e m5 |
| Residents: aggregated per building; clickable pedestrians and cars with real trips; happiness factors; approval; land value; inspector; thoughts feed | Done (M5, M6, M8); e2e m2, m6, m8 |
| Traffic: commuting with rush hours, congestion per segment, freight trucks, service vehicles in traffic, buses | Done (M6); e2e m6 |
| Environment: wind-borne air pollution, ground pollution, sickness and care, trees and parks, education raising industry | Done (M7); e2e m7 |
| Disasters: fires always; earthquake, tornado, flood, meteor, random or from the menu; damage, response, rebuilding | Done (M9); e2e m9 |
| Progression: milestones with celebration, modules, three specialisations, landmarks, achievements | Done (M10); e2e m10 |
| Information: top bar, 16 data maps with legends, advisors with "show me", notifications, street and neighbourhood names | Done (M3–M8) |
| Controls: camera (drag, WASD, edge scroll, Q/E, wheel), toolbar with tooltips and shortcuts, Escape, undo, ghosts and coverage preview | Done (M0, M1, M5, M11) |
| Game shell: main and pause menus, save/load screens, settings (graphics quality, shadows, draw distance, UI scale, volumes, edge scrolling, disasters), tutorial and tips | Done (M11); e2e m11 |

## 6. Art and audio
| Item | Status |
|---|---|
| Bright, warm, low-poly look; soft shadows | Done (M0–M8) |
| Procedural models from parts, distinct per zone/density/wealth | Done: `src/render/assets/*`; `scripts/dev/gallery.mjs` |
| Vehicles, pedestrians, smoke, scaffolding, day/night with lit windows and street lights, tilt-shift | Done (M6, M8); e2e m8 |
| Asset registry for future glTF | Done: `src/render/assets/registry.ts` |
| Procedural sound effects and ambient bed with volume controls | Done (M8); e2e m8 renders every sound offline |
| Original SVG icons, colour-blind-friendly data-map ramps | Done: `src/ui/icons.tsx`, `src/client/overlay.ts` |

## 8. Verification
| Item | Status |
|---|---|
| Unit tests for demand, growth, economy (to the dollar), coverage, pathfinding, happiness, saves, determinism | Done: `tests/` (19 files) |
| Scenario tests (served town grows, no power declines, taxes cut demand, congestion rises and relief works); invariants every tick in test mode | Done: `tests/*` with `sim.testMode`; balance runs with `--invariants` |
| e2e through the real UI with screenshots, failing on console errors | Done: `e2e/` (15 tests) |
| Screenshots reviewed | Done each milestone; latest in `docs/screenshots/` |
| Performance benchmark | Done: `scripts/bench.ts` (and `--big` for ~100k) |
| Balance tool: careful / greedy / neglectful for 20+ years | Done: `scripts/balance.ts` |
| Long soak with zero console errors | Done: `npm run soak` (10 minutes of top-speed play with disasters, panels, maps, saves) |
| §9 final playthrough via tests and screenshots | Done: `npm run playthrough` (a first city through the real UI, menu to year two; `docs/screenshots/m12-play-*.png`) |
| §9 README (run, build, play); summary and ideas at the top of PROGRESS.md | Done |

## Not done, and why
- **Trams and trains** (§5 transport, "if time allows") and the §9 extras (neighbouring cities, weather
  and seasons, more specialisations, glTF models) weren't built; the time went on depth and polish in
  the required systems. The asset registry and the transit system (lines, stops, riders) are where
  they would plug in. Listed as next steps at the top of PROGRESS.md. *(Phase 2 has since built
  trams and trains (M20), weather and seasons (M22) and neighbouring cities (M23).)*
- **Visitors in traffic** (M10): tourists are counted, spend and shop, but don't drive through the
  traffic model. *(Closed in M23: visitors arrive by road, rail, air and sea and drive to the sights.)*
- **Render triangle budget**: 2.5M at the whole-city overview of a 100k city (half of it the shadow
  pass) against an early 1.5M target; draw calls are within budget. Flagged for the Mac check.

---

# SPEC-2.md (phase 2, M13–M24)

Each phase-2 milestone mapped to where it's done. Filled in as milestones complete.

## Rules for all of phase 2

| Rule | Where |
|---|---|
| Work in order, each milestone playable, UI-tested with screenshots, `M<n> complete:` commits | git history; `e2e/m13-*.spec.ts` onwards; `docs/screenshots/m13-*.png` onwards |
| New saved state bumps the save version with a migration and a test that older saves load and play on | M13: SAVE_VERSION 12 (`terrainDelta`), `tests/grading.test.ts` loads the version-10 playtest save; M14: v13 (undo history no longer saved), `tests/history.test.ts` loads a v12 save; each later milestone's section names its version and test, up to M24's v22 (`map`, `tests/customMap.test.ts`) |
| M12 performance budget kept; bench and balance rerun per milestone | numbers per milestone in PROGRESS.md |
| Everything original | procedural models, icons and sounds, as in phase 1 |
| Player kept informed (tooltips, shortcuts, tips, advisor hints, maps and inspector lines) | per milestone below |
| README and this section kept current; real-hardware checks under "To check on the Mac" | README.md, PROGRESS.md |

## M13 Gentler roads

| Item | Where |
|---|---|
| Smoothed vertical profile per road; grade measured on it | `src/sim/world/grading.ts` (40 m smoothing, fit within the limit, pinned at junctions); DESIGN.md §3.15 |
| Cut and fill under the road and to each side, visible embankments and cuttings | `src/sim/world/earthworks.ts` (formation, a bench that widens with the cut or fill, 1:1 cuttings, 1:3 embankments); terrain tint in `src/render/terrain.ts`; `docs/screenshots/m13-cutting.png` |
| Per-type grade limits; only extreme ground fails | `RoadType.maxGrade` in `src/data/roads.ts` (streets 16 %, boulevards 8 %); a cutting deeper than 14 m is the only land failure |
| Bridge over dry ground where fill is very tall | viaducts (`RoadSegment.deck`) where fill passes 8 m |
| Earthworks cost ∝ volume | $0.40/m³ in the road's price (`GRADING.costPerCubicMetre`): nothing extra at grade, a median 73 % on a street over 15 %+ ground; civic pads likewise |
| Preview shows grade along the ghost, colours too-steep sections, says by how much and what fixes it | `src/render/ghost.ts` (graded ghost, colours, cut/fill posts), `src/tools/roadTool.ts` (hint), reasons in `grading.ts`; `docs/screenshots/m13-preview.png`, `m13-too-steep.png` |
| Terrain edits saved as deltas on the seed | `SimState.terrainDelta`, save v12, `FrameDiff.terrain` |
| Nearby zone cells, buildings and trees adapt; nothing floats or sinks | `Sim.groundMoved` (re-seat), cells revalidated, trees cleared on moved ground; level pads for civic buildings; tested in `tests/grading.test.ts` |
| Existing saves load unchanged | migration 11 → 12 (zero delta); test loads the v10 playtest save and checks the ground is the seed's |
| Done when: sampled random streets across all presets refused only on extreme ground (before/after), screenshots of clean earthworks with buildings beside them | before 20.7 % refused (90 % on 8–15 % ground), after 0.7 %, only on ≥ 35 % ground (`scripts/dev/grades.ts`, `tests/grading.test.ts`); `scripts/dev/earthshot.mjs` town on a ridge |

## M14 Controls and editing

| Item | Where |
|---|---|
| Trackpad: two-finger swipe pans, pinch zooms, modifier + swipe or Safari's rotate gesture turns and tilts; auto-detected, setting to override | `src/render/camera.ts` (`onWheel`, `classify`, `onGesture`), Settings → Pointing device (`src/client/settings.ts`, `src/ui/Shell.tsx`), trackpad tip |
| Mouse and keyboard unchanged; Cmd on macOS | `src/client/platform.ts` (`modKey`, `modDown`); `src/tools/manager.ts` |
| Undo and redo for the last ~30 actions incl. bulldozing (roads, civic and zoned buildings with add-ons), zoning and dezoning, road changes and moves | `src/sim/history.ts` (generic state diff), `Sim.undoRedo`; toolbar undo and redo buttons, ⌘Z / ⇧⌘Z; DESIGN.md §3.16 |
| Toast when an undo can't be clean, saying why | `Game.history` toasts the reason ("Can't undo the road: buildings have grown …") |
| Move civic buildings, landmarks and specialisation buildings for a small fee, keeping add-ons, funding and upgrades | `moveBuilding` (`moveCivic` in `src/sim/world/civic.ts`), Move button in the civic inspector, place tool move mode |
| Shortcut cheat sheet on `?` | `src/ui/ShortcutSheet.tsx` |
| Done when: e2e pans, zooms and rotates with synthesized trackpad events, undoes and redoes a bulldoze and a zoning stroke exactly (state hash), moves a building | `e2e/m14-controls.spec.ts`; unit tests in `tests/history.test.ts` (exact round trips of every kind, conflicts, the limit, migration, moves) |

## M15 Publish it

| Item | Where |
|---|---|
| Deploy to GitHub Pages with a workflow on pushes to main, with the right Vite base path | `.github/workflows/deploy.yml` (pushed from this session; base path and site address from `actions/configure-pages`, unit tests first); `base` from `BASE_PATH` in `vite.config.ts` |
| Installable app: web app manifest, original icons | `public/manifest.webmanifest`, `public/icons/` (SVG sources, PNGs from `scripts/dev/icons.mjs`), links in `index.html` |
| Service worker that caches the game and offers "New version, reload" | `src/pwa/sw.js` (filled in by `scripts/vite-pwa.ts`), `src/client/pwa.ts`, the update notice in `src/ui/SystemMenu.tsx`; `docs/screenshots/m15-update.png`; DESIGN.md §6.1 |
| Saves survive updates | saves in IndexedDB and settings in localStorage, never in the cache; Reload autosaves first; e2e continues the city after the update |
| Link previews well: title, description, image from a game screenshot | meta and Open Graph/Twitter tags in `index.html`, absolute URLs from `SITE_URL`; `public/social.jpg` (`scripts/dev/socialshot.mjs`) |
| First launch picks a graphics preset from a quick performance check | `src/client/graphicsCheck.ts`, `Game.startGraphicsCheck`; shown and re-runnable in Settings; `tests/graphicsCheck.test.ts` |
| README no longer claims every resident is simulated | README intro: residents counted per building, trips routed over real roads, visible vehicles are samples |
| What to click, at the top of PROGRESS.md | PROGRESS.md "What you need to do" |
| Done when: a production build served from a subpath passes the e2e suite, works offline after one visit, detects and applies an update | `npm run e2e` builds with `--base /Sim-Cities/` and serves it from that path (`e2e/serve.mjs`); `e2e/m15-publish.spec.ts` plays offline after one visit (server dropping every request, browser offline), then deploys a real second build and applies it through the notice |

## M16 Photo mode and city history

| Item | Where |
|---|---|
| Photo mode hides all UI | `Game.enterPhoto` (K, toolbar camera): the app renders only `src/ui/PhotoMode.tsx`, H hides that too; the renderer hides icons, ghost, selection, ribbons, zone markings and street labels (`GameRenderer.setPhoto`) |
| Free camera lower and closer than normal | `CameraController.photo`: 2.5 m from its target, near-level pitch, eye-height target, 0.6 m above ground |
| Time of day, tilt-shift and depth-of-field strength, field of view | photo panel sliders; `PhotoLens` in `src/render/photo.ts` (two-pass lens); `PhotoView.hour` and `fov` in the renderer |
| A few colour grades | six original grades (`GRADES` in `src/render/photo.ts`) |
| Follow camera riding with a car, bus or walker | Pick / Car / Bus / Person in the panel; `Game.followNearest`, `CameraController.follow` |
| Save a PNG at up to twice screen resolution | `GameRenderer.capture(scale)`: the frame redrawn at 1× or 2× the screen's physical pixels and copied from the canvas |
| The city can pause or keep running | "Keep the city running" (Space) |
| City history: population, approval, jobs and unemployment, treasury, income and spending, pollution, crime, traffic over the whole life | `src/sim/systems/chronicle.ts` (`SimState.chronicle`, recorded as each month closes) |
| Downsampled so saves stay small | at most 240 points per figure, buckets doubling as the city ages |
| History panel in the budget's style, milestones and disasters marked | `src/ui/History.tsx` with `TimeChart` (`src/ui/charts.tsx`); `docs/screenshots/m16-history.png` |
| Older saves start their history when loaded | migration 13 → 14; `tests/chronicle.test.ts` loads the version-10 playtest save and plays on |
| Done when: photo mode saves a full-resolution PNG with no UI, and history survives save/load exactly | `e2e/m16-photo-history.spec.ts` (PNG at 2× the viewport from the canvas with helpers hidden and no interface mounted; history equal and state hash equal after save and load through the UI); `tests/chronicle.test.ts` |

## M17 Big projects and elections

| Item | Where |
|---|---|
| Four to six original big projects, expensive and multi-stage over months | five in `src/data/projects.ts`: city stadium, solar tower array, convention centre (20k), garden expo, launch complex (40k); three stages each over 9–10 months, $1.2M–$2.0M; `src/sim/systems/projects.ts` pays each stage as it starts and waits when it can't |
| Requirements (population, education, a specialisation or resources) | `requires` per project: population; 35 % of workers with a high-school education and the research park (launch complex); a hotel (convention centre); 1,500 visitors a day (garden expo); checked on placement (`projectBlocked`) and listed ✓/✗ in the toolbar tooltip |
| Visible construction stages | a model per stage (`src/render/assets/projectModels.ts`): hoardings, cranes and the structure rising; `docs/screenshots/m17-stadium-*.png`; `scripts/dev/projectshot.mjs` shows all five at every stage |
| A lasting perk | match days every other month (8,000 visitors, fans driving in from the highway, a cheer), 4,000 units of clean power, research income and industrial demand with launches, tourism and land value, commercial demand; wired into the systems that already handle each (`tests/projects.test.ts`) |
| Elections every four game years, decided mainly by approval | `src/sim/systems/elections.ts`: votes at the four-year marks, share from approval (50 % at 55 % approval) with a small seeded swing |
| One or two promises beforehand that voters judge | six promises (`PROMISES` in `src/data/elections.ts`), two at most, made in the six-month campaign from the city panel's Election tab and judged against where the city stood when each was made |
| Winning brings a perk | the region's grant ($4 a resident) and +3 points of approval for a year |
| Losing never ends the game but brings a year of limits | the council refuses tax rises and new loans for a year, saying until when (`tests/elections.test.ts`) |
| Through the real UI | `e2e/m17-projects-elections.spec.ts`: the Big projects category with each project's requirements, cost and perk in its tooltip; the stadium placed from the toolbar and followed in the inspector through every stage to opening (`docs/screenshots/m17-stadium-*.png`); an election campaign from the city panel with two promises made, a third refused, and the vote held (`m17-election-*.png`) |
| Off in sandbox, with a setting to turn them off | new-city option and Settings → Game → Elections (`setElections`); sandbox cities never vote |
| New saved state: version bump, migration and a test | save v15 (`matchDay`, `election`, `Civic.build`); migration 14 → 15 schedules elections from the next four-year mark; `tests/elections.test.ts` loads the version-10 playtest save and plays on |
| Careful mayor plans the whole map and grows past 50k | `scripts/balance.ts`: 20 district slots on both banks with river crossings, zoning that follows demand (industry when jobs are short, shops only while wanted), side streets widened to avenues after high-rises unlock, a quarter kept for landmarks and projects, services scaled with the city |
| Late-game economy retuned so projects, landmarks and specialisations soak up the surplus | project prices and upkeep, and the 40k+ landmarks (conservatory, sky needle, grand arch), raised; nothing below 20k changed (DECISIONS M17) |
| Done when: the careful mayor passes 50k, completes a big project and wins an election in the balance run, and its late-game money curve shows spending goals met rather than an ever-growing pile | `npx tsx scripts/balance.ts 25` (seed `balance`): the careful mayor passes 50k in year 11 (peak 67.5k in year 18, when the map is full); opens all five projects (stadium year 7 … launch complex year 13) and every landmark it reaches; wins all six elections (62–81 %) on kept promises. Its treasury holds between $0.2M and $2.4M through the years it spends $8.5M on goals (years 5–13), then rises about $0.3M a year at 2 % taxes once none are left (before the retune: $10.4M by year 20). Chart: `docs/screenshots/m17-money.png` (`scripts/dev/moneychart.mjs`). On seed `s1` it reaches 75k with three projects |

## M18 Scenarios

| Item | Where |
|---|---|
| Six to eight scenarios, each a fixed map and starting city with goals, limits and a time limit | eight in `src/data/scenarios.ts`: Clean Slate, Back from the Brink, Vote of Confidence, Big Game, Gridlock, Smokestack Valley, After the Flood, Seaside Resort (river, lakes and coast maps); goals, limits and the clock in `src/sim/systems/scenario.ts` |
| Examples: 10k without coal, rescue a bankrupt city, rebuild after a flood, fix gridlock, clean up a polluted industrial town, grow a tourist resort | all six, plus an election to win and a stadium to open (M17) |
| A scenario screen from the main menu with a description and preview of each | Main menu → Scenarios (`ScenarioScreen` in `src/ui/Scenario.tsx`): a preview image of each starting city (`public/scenarios/<id>.jpg`), the brief, goals, limits, time, star rules and the best result; `docs/screenshots/m18-scenarios.png` |
| A win screen with one to three stars | `ScenarioEnd`: the stars earned and the rules behind them (or why it was lost), then keep playing, try again or the next scenario; `docs/screenshots/m18-won.png` |
| Progress kept per device | `src/client/scenarioProgress.ts` (localStorage `citybloom.scenarios`: best stars and months); shown on the scenario screen and counted on the menu |
| Scenarios are data-driven, and their starting cities are saves | `src/data/scenarios.ts`; saves in `public/scenarios/*.citybloom`, built by `npx tsx scripts/scenarios.ts` (recipes in `scripts/lib/scenarioCities.ts`) |
| New saved state: version bump, migration and a test | save v16 (`SimState.scenario`); migration 15 → 16; `tests/scenarios/system.test.ts` (save/load exactly, the version-10 playtest save loads with no scenario and plays on) |
| Done when: a scripted player in the test suite wins each scenario and a neglectful one loses it | `tests/scenarios/<id>.test.ts`, one file per scenario: the scripted player (the careful mayor plus that scenario's moves) wins, the neglectful one (does nothing) loses, and the limits are enforced; `e2e/m18-scenarios.spec.ts` plays Gridlock from the main menu through the brief, the goals panel and the win screen to the stars kept on the scenario screen |

## M19 Traffic tools

| Item | Where |
|---|---|
| One-way streets, drawn with a direction and switchable on existing roads | `RoadSegment.oneway`; drawn with the road tool's one-way toggle (O) in the direction of the stroke (`buildRoad.oneway`), switched with the One-way mode or the road inspector's Direction buttons (`setOneWay`, free, undoable); routing, commute matching (return trips by a reverse search) and freight respect them (`src/sim/systems/graph.ts`, `commute.ts`); `tests/oneway.test.ts` |
| Roundabouts, placed on a junction or drawn as a ring, with their own capacity in the traffic model | `RoadNode.roundabout`; the road tool's Roundabout mode (click a junction or road; drag out to size the ring) or the road inspector's buttons (`placeRoundabout` / `removeRoundabout` in `src/sim/actions/roads.ts`); junction capacity and delay in `src/sim/systems/traffic.ts` (`JUNCTION` in `src/data/balance.ts`); drawn by `buildRoundabout` (`src/render/roadMesh.ts`); `tests/junctions.test.ts`, `docs/screenshots/m19-roundabout.png` |
| A city highway: high capacity, no zoning, joined only by on- and off-ramps, passing over or under the roads it crosses, with an interchange onto the regional highway | road types `motorway` and `ramp` (`src/data/roads.ts`, unlock at 10,000); connection rules and grade-separated `Crossing`s in `src/sim/world/roadPlanner.ts`, forced heights in `src/sim/world/grading.ts` (decks over, ceilings under); the interchange at the regional highway's end; `tests/highway.test.ts`, `docs/screenshots/m19-highway.png` |
| Build the grade separation so rail can reuse it in M20 | `gradeSeparated()`, `Crossing` / `GradeLimit` and the deck profiles are type-agnostic: a rail type joins by being grade-separated (DESIGN §3.20) |
| Visible cars follow each other, queue and give way at junctions, within the performance budget | `src/render/traffic.ts` (`step`, `mayEnter`, `driveRing`): spacing in lanes, waiting for backed-up roads, junction claims, giving way on roundabouts and driving round them; 0.44 ms a frame in the 100k city here (`renderStats.trafficMs`); `docs/screenshots/m19-crossroads.png`, `scripts/dev/queueshot.mjs` |
| The traffic data map shows direction and ramps | chevrons on one-way roads and ramps, junctions and roundabouts as discs shaded by their own load, tints on flyover decks (`src/client/overlay.ts`, `src/render/roadTint.ts`); the legend says so |
| Keep the player informed | road inspector (traffic, load, capacity, direction, junction load and roundabout buttons), tooltips on every road type and mode, the O and Tab shortcuts on the card, two tips (a jammed junction; the city highway unlocked), advisor hints (a jammed junction wants a roundabout; a jammed main road in a big town wants a bypass), hints saying which way a new road or ramp runs |
| Save migration with a test | save v17 (optional fields); `tests/oneway.test.ts` and `tests/highway.test.ts` load the version-10 playtest save and play on |
| An M18 scenario that shows the new system off | Crossroads (Four Ways), `tests/scenarios/crossroads.test.ts`: a roundabout wins it, neglect loses; `e2e/m19-traffic-tools.spec.ts` plays it through the UI |
| Done when: scenario tests show a roundabout measurably relieving a jammed junction, and a highway bypass taking through traffic off local streets | `tests/junctions.test.ts` (the crossroads town: with a roundabout the junction goes from over capacity to under it, its delay falls by more than two thirds and the average commute by over 8 %, against the same city left alone); `tests/highway.test.ts` (the main-street town: a bypass takes over a fifth of the centre's traffic, carries over 1,000 cars a day and shortens commutes, against the same city left alone) |

## M20 Rail

| Item | Where |
|---|---|
| Trams on streets, avenues and boulevards (track added to an existing road), with stops and a depot | `RoadSegment.tram`, laid or taken up with the road tool's Tram track mode (click, or drag a line as one undo step) or the road inspector (`setTram` in `src/sim/actions/roads.ts`); the tram depot (`src/data/civic.ts`) and tram stops (`BusStop.tram`, the transit bar); tram loops over `Sim.tramGraph()` (`loopLines` in `src/sim/systems/transit.ts`); drawn by `buildTramTrack` / `buildTramJunction` (`src/render/roadMesh.ts`); `tests/trams.test.ts`, `docs/screenshots/m20-trams.png` |
| Trains on their own track with stations, crossing roads on bridges or at level crossings, on gentle grades, using M13's grading and M19's grade separation | road types `rail` and `mainline` (3.5 %, 100 m radius) in the same network with their own graph (`Sim.railGraph()`); level crossings (a road drawn across a railway; junction kind `crossing`), grade-separated crossings of boulevards and highways and chained grade limits in `src/sim/world/roadPlanner.ts` / `grading.ts`; stations and train lines (`trainLines`); `tests/rail.test.ts`, `tests/trains.test.ts`, `docs/screenshots/m20-station.png`, `docs/screenshots/m20-crossing.png` |
| Mode choice adds tram and train alongside car, bus and walking | `busTime` weighs every line: walking reach 1.6× for stations and 1.15× for tram stops, a comfort bonus for trains (150 s) and trams (60 s), waits of half the headway (`src/sim/systems/transit.ts`, `RAIL`/`TRAM` in `src/data/balance.ts`) |
| A ridership data map | the Ridership map: each line along its roads and track by rush-hour riders over capacity, each stop and station by riders a day (`refreshRidership` in `src/client/overlay.ts`); `docs/screenshots/m20-ridership.png` |
| Line and stop inspectors | clicking a stop (`Selection.kind` 'stop') shows its line, frequency and riders and highlights the line; stations, tram and bus depots show their line (headway, capacity, riders, why none); railways their trains and crossings; roads their tram track (`src/ui/Inspector.tsx`) |
| Freight rail: a regional rail connection at the map edge and a freight terminal that serves industry and the trade specialisation, taking trucks off the roads | the regional rail link (`Sim.buildRailway`, `SimState.railway`), drawn off the west edge beside the highway; the rail freight terminal (`railFreight` in `src/data/civic.ts`, `railSiding` / `railTerminals` in `src/sim/world/civic.ts` and `src/sim/systems/rail.ts`), taking exports and imports in `commute.ts` and counting as a freight hub for demand and trade; `tests/freight.test.ts`, `docs/screenshots/m20-freight.png` |
| Animated trams and trains | `src/render/railVehicles.ts`: trams round their loops, trains shuttling on the right-hand track and standing at platforms, container freight trains in off the regional railway; `renderStats.rail` |
| Keep the player informed | tooltips on Railway, Tram track and tram stops; the Tab card lists the tram mode; tips when rail unlocks and when the railway is picked; advisor hints (trams or a train line for a jammed road; a freight terminal when trucks crowd the highway link; a station or tram depot with no line); inspectors as above; trucks to a terminal say so when clicked |
| Save migration with a test | save v18 (`railway`; optional tram fields), identity migration, the link laid on load where it fits; `tests/trains.test.ts` loads the version-10 playtest save, gets its link and plays on, and round-trips by hash |
| An M18 scenario that shows the new system off | Railhead (Ironbridge), `tests/scenarios/railhead.test.ts`: track from the regional link and a freight terminal at the works win it (681 trucks a day on the highway link down to 2), neglect loses; `e2e/m20-rail.spec.ts` builds rail and trams through the UI |
| Done when: scenario tests show a train line measurably cutting car traffic on a jammed corridor, and freight rail cutting truck traffic | `tests/trains.test.ts` (the jam town: a railway with two stations beside the link takes a quarter of its cars, over 400 ride, and commutes shorten, against the same city left alone); `tests/freight.test.ts` (an estate a kilometre from the highway: with a terminal linked to the regional railway, the highway link carries under 60 % of its trucks and the avenue through town fewer vehicles, against the same city left alone) |

## M21 Districts

| Item | Where |
|---|---|
| Paint named districts; generated neighbourhood names stay as defaults | the district tool (I, `src/tools/districtTool.ts`): a round brush (16–192 m, [ ]), new, pick, erase; a new district takes the neighbourhood name under its first stroke (numbered if taken); rename and dissolve in the Districts panel; `SimState.districts` / `districtCells` and the commands in `src/sim/systems/districts.ts`, undoable (`DISTRICT_SCOPE`); drawn by `src/client/districtView.ts`; `tests/districts.test.ts`, `docs/screenshots/m21-paint.png` |
| Most policies can apply to one district, with costs scaled to it | `Sim.policyAt` at every per-place policy site (garbage, health, incidents, pollution, free transit in the mode choice, growth); `setDistrictPolicy`; `districtPolicyCosts` in `src/sim/systems/economy.ts` (the city price × the district's share of the people who live or work in the city; nothing where the city already has it); the panel shows each policy's cost for that district |
| District-only policies: a heavy-traffic ban, a high-rise ban, heritage | heavy-traffic ban (`truckCosts` in `src/sim/systems/commute.ts`: trucks pay 6× on its roads) and heritage (no rebuilding bigger or retooling, new growth low or medium, +0.05 land value) are district-only; the high-rise ban (a city policy since M10) now also applies per district (`densityAt` in `growth.ts`); `POLICIES[].scope` in `src/data/policies.ts` |
| A district panel with population, jobs, happiness, land value and its share of the budget | `src/ui/Districts.tsx` (query `districts` → `districtReports`): residents, jobs, happiness, land value, taxes paid a month and the share of the city's, civic upkeep in it, its policies' cost; `docs/screenshots/m21-panel.png` |
| Data maps can be filtered to one district | the panel's "Data maps: this district only" (`Overlay.district`, masks terrain and road tints to its cells); the legend says which district and clears it; `docs/screenshots/m21-filtered.png` |
| Keep the player informed | tooltip and shortcut (I) on the toolbar flag, the shortcut card, a tip once the city passes 5,000 with no districts, the brush hint names the district (or the name a new one will take), a toast on creation, advisors suggest districts once the city passes 5,000 and a district clean-industry grant for smog, "District" badges on district-only policies, inspector neighbourhood lines use district names |
| Save migration with a test | save v19 (`districts`, `districtCells`); `tests/districts.test.ts` loads the version-10 playtest save and paints a district on it |
| An M18 scenario that shows the new system off | Market Town (Kingsmere), `tests/scenarios/market.test.ts`: a back road plus a heavy-traffic ban on Old Market wins it (its busiest road 2,209 → 1,710 vehicles a day), the back road alone, the ban alone and neglect don't; `e2e/m21-districts.spec.ts` paints districts and sets a policy through the UI |
| Done when: a district policy measurably changes its own district and not the rest of the city | `tests/districtPolicies.test.ts`: a heavy-traffic ban on a freight town's homes cuts truck traffic through them (and it moves to the back road) while the other side's roads are unchanged; recycling in one district cuts garbage there (×0.75) and not in the other (×1.00) at its share of the cost; heritage on the Big Game city stops rebuilding inside (0 vs 20) and raises land value there (0.152 → 0.184) with the rest unchanged |

## M22 Seasons and weather

| Item | Where |
|---|---|
| Seasons across the year (three day/night cycles each): autumn colours, bare trees and snow in winter, spring blossom | the calendar (`START_MONTH`, `calendarMonth` in `src/sim/time.ts`; `seasonOf` in `src/data/climate.ts`); on screen `src/render/weather.ts` (season weights eased through the year), the terrain's grass tint, broadleaf crowns in `src/render/trees.ts` (blossom, gold and red, bare and thin), snow on ground, roofs, trees and roads; `docs/screenshots/m22-spring.png`, `m22-summer.png`, `m22-autumn.png`, `m22-winter.png` |
| Weather: rain, snow, fog, storms and heatwaves, with particles, wet roads, clouds, lighting and sound, within the performance budget | spells drawn per climate and season (`src/sim/systems/weather.ts`); one `Points` draw for rain or snow, wet asphalt and ground, cloud grade and dimmed sun (`weatherGrade`, `Lighting.applyWeather`), fog, heat haze, lightning with thunder, rain/patter/wind layers in `src/audio`; `docs/screenshots/m22-rain.png`, `m22-storm.png`, `m22-fog.png`, `m22-heat.png`, `m22-snow.png`, `m22-cloudy.png`; bench at 100k on par with M21 and a snowstorm on the 100k city timed by `scripts/dev/snowbench.ts` (PROGRESS) |
| Heating raises power demand in winter; heatwaves raise power and water demand | `weatherUse` in `buildingUse` (`src/sim/systems/utilities.ts`): heating up to +60 % homes, +40 % shops, +20 % industry; cooling and thirst above 23 °C; `tests/winter.test.ts` (26 % more power per resident in January than July) |
| Snow slows traffic until ploughed (a new public works depot sends out ploughs) | `RoadSegment.snow`, `snowFactor` in route costs and vehicle speed; the public works depot (`works` in `src/data/civic.ts`) and ploughs (`src/sim/systems/ploughs.ts`), drawn as orange trucks with blades; `tests/winter.test.ts` (commute 98 → 115 s under snow, back to 98 s with a depot), `docs/screenshots/m22-plough.png` |
| Heavy rain raises rivers and flood risk; dry spells lower groundwater and pump output; parks are used less in the rain | `weather.river` and `riverFlood` in `src/sim/systems/disasters.ts` (M9's flood, disasters on); `weather.dryness` and `pumpShare` in `civicOutput`; `parkShare` in `src/sim/systems/happiness.ts` |
| Settings for seasons on or off and weather intensity; map presets have their own climates; photo mode gets season and weather controls | Settings → Game: Seasons, Weather (off, light, normal, wild) → `setWeather` (scenarios set their own); `PRESET_CLIMATE` (the new-city screen names the climate); photo mode's "Season and weather" (`PhotoView.season/weather`); `docs/screenshots/m22-settings.png`, `m22-photo.png` |
| Keep the player informed | the date in the top bar shows weather, temperature and season and opens a panel of what the weather is doing (`src/ui/weather.ts`); road inspector snow line; depot inspector (ploughs out, road cleared); advisors (winter power headroom, snow no plough clears, dry spell, high river); tips (snow, autumn, heatwave); notices for each season and for storms, heavy snow and heatwaves; tooltips on the Garbage and snow bar |
| Save migration with a test | save v20 (`weather`, the `weather` RNG stream); `tests/weather.test.ts` loads the version-10 playtest save, plays on and round-trips it |
| An M18 scenario that shows the new system off | Long Winter (Frostvale), `tests/scenarios/winter.test.ts`: more power and a depot win it; either alone, or neglect, loses; `e2e/m22-weather.spec.ts` plays it through the UI |
| Done when: scenario tests show winter power demand and snow slowdowns, and screenshots of every season and weather type have been reviewed | `tests/scenarios/winter.test.ts` (left alone, heating lifts demand well past the autumn's supply and homes go dark; snow covers every road and slows commutes); the season and weather screenshots above, made by `e2e/m22-weather.spec.ts` through photo mode's own season and weather buttons (with real snow in the sim for winter) and reviewed; the same spec plays Long Winter through the toolbar to a three-star win |

## M23 Region, airport and seaport

| Item | Where |
|---|---|
| Two or three neighbouring cities beyond the map edges, each with a character, growing or shrinking over time | three neighbours (industrial town, commuter suburb, resort) named and sized from the seed, north and south along the regional highway and west along the railway (`src/data/region.ts`, `initialRegion` and `regionMonth` in `src/sim/systems/region.ts`); their growth rate drifts monthly on their own dice; the Region panel charts each one's last two years; labels at the map edge (`src/client/regionView.ts`); `tests/region.test.ts` |
| Deals to buy or sell power, water and garbage processing | `setDeal`; bought power and water enter `updateUtilities` at the highway's connection node, sold only from what's left after the city's own buildings; garbage deals empty or fill the landfills and plants hourly; paid for what's delivered ('Bought from / Sold to neighbours'); the Region panel (Shift+N) signs, changes and ends them with a slider; `tests/region.test.ts` (a power deal covers a shortage, a sale never blacks out a home, a garbage deal empties a landfill), `docs/screenshots/m23-panel.png` |
| Commuters and shoppers travel between cities by highway and rail; the inspector and data maps show where they come from; kept readable | `src/sim/systems/regionFlows.ts`: after local matching, the neighbours' workers fill open jobs near the highway (or a station on the regional line, 30 % by train), half the city's unemployed take jobs out of town, neighbours' shoppers use spare shop capacity; all on the roads and sampled as trips; inspector lines ("from out of town", "in a neighbouring town"), the car inspector's purposes, the Region traffic map (`docs/screenshots/m23-region-map.png`), the Region panel's per-town figures; locals keep first pick and demand still counts those jobs as open (DECISIONS M23); `tests/regionFlows.test.ts` |
| An airport: big footprint, unlocked by population, boosting tourism and business, with a new noise data map and visible planes | `airport` (20,000 residents, 300 × 130 m, `src/data/civic.ts`): visitors by air and half as many again of the city's others, commercial demand; noise raster (`src/sim/systems/noise.ts`) with the 'Noise' mood factor and the Noise map; planes landing and taking off (`src/render/ports.ts`); `tests/ports.test.ts` (visitors 443 → 1,287, loud along the runway), `docs/screenshots/m23-airport.png`, `m23-noise.png` |
| A seaport on maps with deep water, boosting freight and trade, with visible ships | `seaport` (10,000, needs water ≤ −6 m behind it, `berth` in `src/sim/world/civic.ts`): ships take up to 360 truckloads a day off the highway, trade income per industrial job, industrial demand, ferry visitors; container ships sail in, lie alongside and sail out; `tests/ports.test.ts` (inland refused; highway trucks 379 → 300), `docs/screenshots/m23-seaport.png` |
| Visitors arrive by highway, rail, airport and seaport and travel through the traffic model (closing the M10 gap) | `tourism.by` (road, rail, air, sea) in `specialisationsHour`; visitor trips from where they arrive to the landmarks and hotels in `regionRound`; `tests/regionFlows.test.ts` (visitors drive in from the highway to the clock tower) |
| Keep the player informed | Region panel (top bar, Shift+N) with each town's offers, prices and deliveries; advisors (a neighbour would sell power or water in a shortage, take garbage from a full landfill; homes under the noise); tips (the region, the airport); inspectors for the airport (visitors, flights) and seaport (loads, ships); toolbar 'Trade, research and ports' |
| Save migration with a test | save v21 (`region`, the `region` RNG stream); `tests/region.test.ts` loads the version-10 playtest save, signs a deal, plays on and round-trips it |
| An M18 scenario that shows the new system off | Harbour Lights (Harbourside, coast), `tests/scenarios/harbour.test.ts`: a power deal and a seaport win it; either alone, or neglect, loses; `e2e/m23-region.spec.ts` plays it through the UI |
| Done when: scenario tests show a power deal covering a shortage, regional commuters filling jobs, and the airport raising visitor numbers | `tests/region.test.ts` (a closed coal plant's town back to every building powered on a deal), `tests/regionFlows.test.ts` (an industrial town's jobs filled by neighbours' commuters, 200+ more than alone), `tests/ports.test.ts` (an airport lifts visitors 443 → 1,287), and Harbour Lights |

## M24 Terrain and map editor

| Item | Where |
|---|---|
| In-game terraforming tools (raise, lower, level, smooth) built on M13's terrain deltas | the `terraform` command (`src/sim/actions/terraform.ts`, `planTerraform` in `src/sim/world/terraform.ts`) writes M13's saved terrain delta through `reshapeGround`; the Terrain tool in the toolbar (Shift+T, Tab through the four, [ ] brush size, `src/tools/terrainTool.ts`); `tests/terraform.test.ts`, `docs/screenshots/m24-terrain-tool.png` |
| A cost per volume | $0.25 per cubic metre cut or filled ('Landscaping' in the budget); the hint prices a pass before you drag and shows what a drag has cost; `tests/terraform.test.ts` (charged exactly by volume; refused when the city can't pay) |
| Limits near buildings | ground within 12 m of a building's footprint or a road's edge is held, and within 32 m of it the new ground keeps to 1 in 1; water and the water table are left alone; at most 40 m from how the map began; `tests/terraform.test.ts` (a town hacked at with big brushes: every building's height, and every civic building's, unchanged; no slope steeper than 1 in 1 beside held ground) |
| Undo | a drag is one undo step (merged like a zoning stroke); `tests/terraform.test.ts` (undo and redo restore the city's hash and the money exactly), `e2e/m24-terrain.spec.ts` (through the toolbar's undo) |
| A map editor from the main menu: sculpt terrain, paint water (rivers, lakes, coastline), place resources, forests and the highway and rail entries | Main menu → Map editor (`src/ui/Maps.tsx`): a new map from a generated one or flat meadow, or one of yours; the editor (`src/ui/Editor.tsx`, `src/tools/mapTool.ts`, `src/sim/actions/mapEdit.ts`): raise, lower, level, smooth; river and lake, sea, land; plant forest, clear trees; ore, oil, clear; highway and railway entries (or none); climate; undo; `tests/mapEditor.test.ts`, `docs/screenshots/m24-editor.png` |
| Before saving, it checks the map is playable (a buildable start area by the highway) | `checkMap` (`src/sim/terrain/customMap.ts`): the highway on dry land a street can climb from, and 20 ha of buildable land within 600 m of it; railway, water and resources as warnings; the top bar's status and the Playability panel (with each problem located on the map); only playable maps reach the new-city screen, drafts are kept; `tests/customMap.test.ts` (every generated map passes; a flooded or cliff-bound start fails) |
| Maps save and share as files and appear on the new-city screen | the player's maps in IndexedDB (`src/client/maps.ts`); `.citymap` export and import (from the editor screen and the new-city screen); "Your maps" on the new-city screen with a preview; cities keep their map in their save (v22); `docs/screenshots/m24-new-city.png`, `m24-city.png` |
| Save migration with a test | save v22 (`map`, null for generated maps); `tests/customMap.test.ts` loads a version-21 save and the version-10 playtest save and plays on, and round-trips a city on a custom map |
| An M18 scenario that shows the new system off | Over the Ridge (Ridgeholm, on a map in the editor's format, `scripts/lib/ridgeMap.ts`), `tests/scenarios/terraces.test.ts`: cutting a pass through the ridge with the terrain tool and building in the valley wins it; the shelf alone, however well run, loses; `e2e/m24-terrain.spec.ts` plays it through the UI |
| Done when: a map made in the editor saves, reloads, and grows a city in a scripted test | `tests/mapEditor.test.ts` ('a map made in the editor saves, reloads and grows a city': a river, a bay, hills, woods, ore and oil and moved entries, exported to a 15 KB `.citymap`, read back, a city founded on it grows to 1,834 in three months, and its save loads and plays on exactly); through the UI in `e2e/m24-terrain.spec.ts` (main menu → editor → save and export → new-city screen → a city that grows) |

## When every milestone is done

| Item | Where |
|---|---|
| Update the summary and ideas at the top of PROGRESS.md | PROGRESS.md: the summary covers M13–M24; the ideas list is rewritten for what phase 2 leaves (terrain water in running cities and tunnels, rail and traffic lights, a livelier region, weather fronts, specialisations, models, a balance pass with real players) |
| Finish this brief's section in SPEC_REVIEW | this section |
| A final playthrough through the real UI that uses the new features | `e2e/finale.spec.ts` (`npm run finale`): a map made in the map editor from the main menu, a city founded on it from the new-city screen, roads (one of them one-way), zones and utilities placed with the mouse, the terrain tool levelling a slope for a new street, undo, a district with a policy, a power deal with a neighbour, the weather panel, city history, photo mode, then save, quit and continue; screenshots `docs/screenshots/final-*.png`. The phase-1 playthrough (`e2e/playthrough.spec.ts`) still runs with it under `npm run playthrough` |

### Phase 2: not done, and why
- **Water in running cities** (M24): the terrain tool leaves water alone; lakes, canals and filled bays are made in the map editor before a city exists. Letting a live city dig new water would need the water, flood, groundwater and harbour systems to follow it (DECISIONS M24).
- **Lots right beside an existing road** can't be levelled with the terrain tool: the road stands on that ground. Shape the land first, then build (DECISIONS M24).
- **Real hardware** (frame rate, the look of new systems at full resolution) is listed under "To check on the Mac" in PROGRESS.md; everything here was verified on this VM's software renderer, by sim tick times, draw calls and triangle counts.
