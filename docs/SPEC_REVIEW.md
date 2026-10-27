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
| Done when: a production build served from a subpath passes the e2e suite, works offline after one visit, detects and applies an update | `npm run e2e` builds with `--base /CityBloom/` and serves it from that path (`e2e/serve.mjs`); `e2e/m15-publish.spec.ts` plays offline after one visit (server dropping every request, browser offline), then deploys a real second build and applies it through the notice |

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
| Done when: the careful mayor passes 50k, completes a big project and wins an election in the balance run, and its late-game money curve shows spending goals met rather than an ever-growing pile | `npx tsx scripts/balance.ts 25` (seed `balance`): the careful mayor passes 50k in year 11 (peak 67.5k in year 18, when the map is full); opens all five projects (stadium year 7 … launch complex year 13) and every landmark it reaches; wins all six elections (62–81 %) on kept promises. Its treasury holds between $0.2M and $2.4M through the years it spends $8.5M on goals (years 5–13), then rises about $0.3M a year at 2 % taxes once none are left (before the retune: $10.4M by year 20). Chart: `docs/screenshots/m17-money.png` (`scripts/dev/moneychart.mjs`). On seed `s1` it reaches 75k with three projects. *Phase 2 review: this had stopped holding (by M24 the careful mayor ended on $25.2M, holding 6 % for a decade because the launch complex's education bar was out of reach, and a built-out city at 6 % netted about $2.40 a resident a month at every milestone). The mayor now builds schools by the seats needed and saves for goals it can have, and past 30,000 residents running costs rise (×2 at 57,000): on seeds `balance`, `s1` and `s2` a built-out city at 6 % runs within about $40k a month of even, 5 % runs a deficit, the treasury holds between $0.1M and $2M through year 20 while the projects get bought, and every election is won (DECISIONS, Phase 2 review)* |

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

# Phase 3 (SPEC-3.md)

## M25 Baseline and model pipeline

| Item | Where |
|---|---|
| Measure the baseline with the uncapped benchmark window (whole city, city and street zoom, day and night) and write it into PROGRESS.md | `scripts/dev/framebench.mjs` (headed Chrome, `--disable-gpu-vsync --disable-frame-rate-limit`, the ~110k bench city imported through the load screen, average and 95th-percentile frame times per view and preset, plus the heavy view: the whole city at night at 3× with a tornado kept on screen); PROGRESS.md "Frame times", DECISIONS M25 ("How frame times are measured") |
| Models in `assets/models/` named after what they replace, extra designs `-2`, `-3` | `targetOf` (`src/models/spec.ts`): civic ids, zoned type ids, `annex-<module>`, `-n` designs; `tests/models.test.ts` ('reads what a file name stands for') |
| `npm run models:check` validates every file against PROMPTS.md and the game's data: footprint (exact, or a half or third of a zoned lot's width), origin and front, budget, material names, window groups, smoke stacks on polluting buildings, no textures, nothing outside the site; a plain report; a failing model is skipped with a warning, never a crash | `scripts/models-check.ts`, `src/models/check.ts` (and `glb.ts`, a reader with no dependencies); beyond the brief it also catches a wall hanging in the air, a model turned round (half or a quarter), damaged files; `tests/models.test.ts` ('passes good models', 'catches deliberately broken models, each for its own reason', 'every kind of break is caught', damaged files as failed reports), `scripts/dev/modelturn.ts`; the build logs skipped models and carries on (`scripts/vite-models.ts`) |
| Convert at build time into the registry's `ModelData`, so the game ships without a glTF loader: transforms baked, colours by role, the baked darkening near the ground, window glass with the night glow | `src/models/bake.ts` (transforms, roles, window units, hidden faces removed, distant versions, party walls, site occupancy), `codec.ts` (one packed file, 2.3 MB, 0.8 MB gzipped), `scripts/vite-models.ts` (a content-named asset; dev rebuilds and reloads when a model, a budget or a site changes); `src/render/assets/handmade.ts` (the darkening at the foot of walls, lit windows) and `registry.ts` (hand-made where one fits, generated otherwise) |
| Variety: repainted from the palettes (nearest palette per role), own mix of lit windows per copy, mirroring, mixing with the generator while a type has fewer than three designs, no identical neighbours | `nearestPalette`, `layout` (walls in turn by look, so looks differ until the combinations run out), `litWindows` in `modelMerge.ts`, `HandmadeModels.zoned` (n designs share looks with the generator, n/(n+1)), `BuildingRenderer.look` (no two neighbours of a type and size alike); `tests/handmade.test.ts` |
| Rows: a model half or a third as wide as its lot fills it side by side, each copy painted differently; the tenement three abreast on its 24 m lot | `layout` (copies, party walls dropped between them, each painted differently); `e2e/m25-models.spec.ts` (grown by normal zoning), `docs/screenshots/m25-tenement.png` |
| Everything the game does to buildings keeps working: construction reveal, fire and damage, abandonment; snow; seasonal grass and hedge; tree_spot trees; smoke from smoke_stack tops; the landfill's mound; project stages with cranes and hoardings; annexes in their back corner | `tests/handmade.test.ts` (construction and states through `appendModel`, seasonal tags, garden trees, stacks, the mound rising with fill, a project raised stage by stage inside its hoarding, annexes clear of the building and its doors); `scripts/dev/modelshot.mjs --states`, `stages`, `annexes`, `landfill`; `docs/screenshots/m25-tenement-winter.png`, `m25-tenement-night.png` |
| Distant versions from the named parts (walls kept, windows as flat panels, small parts dropped), switching with distance without a visible pop | a far and a skyline version per model (`FAR_KEEP`, `SKY_KEEP` in `src/models/baked.ts`), chunk meshes per level with a complementary per-pixel dither across each hand-over band (`src/render/lodChunks.ts`, `buildings.ts`); `e2e/m25-models.spec.ts` measures the pixels that change across the hand-over; `docs/screenshots/m25-handover-*.png` |
| Start with the tenement | `R103.glb`, the first model in; every other delivered model after it (136 in all) |
| Done when: `models:check` passes good models and catches a broken one | `tests/models.test.ts`; fixtures in `tests/fixtures/models/good` and `broken` |
| Done when: the tenement grows in a real city through normal zoning: three abreast, painted differently, lit at night, snowed on, switching to its far version invisibly | `e2e/m25-models.spec.ts` (a town grown by zoning and services until an R103 stands on a 3×3 lot; three copies, differently painted; lit windows at night; snow in winter; hand-over pixel differences under 2 %) |
| Done when: the frame budget holds | PROGRESS.md "Frame times": the heavy view at High under 12 ms, Medium and Low faster than at the start of the phase |

## M26 Light and sky

| Item | Where |
|---|---|
| Soft shading where things meet: SSAO at High, cheaper at Medium, off at Low, alongside the baked darkening | `src/render/post.ts` (ambient occlusion from depth at half resolution, a warm violet multiply over the generator's own darkening at the foot of walls); `QUALITY_PARAMS` (12 taps and a depth-aware blur at High, 4 taps at Medium with 2× multisampling and an earlier fade, off at Low); `tests/light.test.ts`, `e2e/m26-light.spec.ts` (occlusion darkens the frame a little, never more than a tenth) |
| Shadows crisper near the camera and cheaper far away, cascaded, far buildings casting from distant versions; bring the overview's shadow-pass triangles down | `src/render/sunShadow.ts` (three's `SunLight`, two cascades fitted to the ground in view at High, one at Medium and Low); the shadow pass draws only casting triangles (`drawCastersOnly`, `ModelData.shade`) and small things only in the near cascade (`castNearOnly`); distant buildings cast from their far and skyline versions (M25's levels, the same rule in the shadow pass); `tests/sunShadow.test.ts`; `scripts/dev/passprobe.mjs`: the whole-city view's shadow pass from 872k to 454k triangles |
| Sky and sun colour through the day, with a golden hour and a blue hour | `src/render/lighting.ts` (new keyframes, a glow round a low sun along the horizon, sun turning to moon across the blue hours, a little more exposure while the sun is low); `docs/screenshots/m26-dawn.png`, `m26-golden.png` |
| Soft bounce light from sky and ground | `src/render/lightChunks.ts` (sunlight bounced from opposite the sun, tinted by the hemisphere light's ground colour, which follows season and snow: `Lighting.groundBounce`) |
| Gentle haze with distance | `src/render/lightChunks.ts` (the fog chunk: a soft haze from a third of the fog's start, at most a fifth) |
| A soft glow round lit windows and street lights at night | `src/render/post.ts` (a soft-knee bright pass at a quarter resolution, blurred, added; stronger from far off) and lit windows brighter with distance (`buildings.ts`); `e2e/m26-light.spec.ts` (the glow brightens the pixels round lights and darkens none), `docs/screenshots/m26-night.png`, `m26-street-night.png` |
| Every new effect has a cost switch; the first-launch check keeps choosing sensibly | `QUALITY_PARAMS` (ao, aoBlur, glow, samples, cascades, aoFar per quality; the graphics check's presets pick among them as before); `e2e/m26-light.spec.ts` changes quality through Settings and checks what the renderer applied (`getShell().applied`) |
| Done when: before-and-after screenshots at dawn, noon, golden hour and night, at whole-city and street zoom, look brighter and richer while still toy-like | `docs/screenshots/m26-dawn.png`, `m26-noon.png`, `m26-golden.png`, `m26-night.png` (each: before on the left, after on the right; whole city above, street below; the ~110k bench city, `scripts/dev/lookshot.mjs`) |
| Done when: the frame budget holds | PROGRESS.md "Frame times": the heavy view at High under 12 ms; Medium and Low faster than at the start in the heavy view |

## M27 Ground, lots and streets

| Item | Where |
|---|---|
| Terrain: gentle variety in the grass (patches, tone, field edges, worn paths), still following the seasons | `src/render/terrain.ts` (tone patches and a mottle from a tiling noise texture; farms of staggered fields with their own shades and hedgerows, and metre-wide worn paths, in the country at Medium and High; tidier grass within 46 m of a town road), all before the season colouring so they turn with it; `docs/screenshots/m27-city.png`, `m27-seasons.png` |
| Sandy shores, following the seasons | the terrain's sand colour (unchanged, under snow in winter as before) with damp sand darker just above the water |
| Empty zoned land stops looking like graph paper: subtle (outline or faint tint), full only while zoning or on a zone data map | `src/render/zones.ts` (a faint tint and an outline where the zoned area ends, one mesh a chunk; the cell-by-cell look and the unzoned grid only while a zoning tool is out); there is no zone data map, and data maps hide zone paint (DECISIONS M27); `e2e/m27-ground.spec.ts` (subtle, then full with the zone tool through the toolbar, then subtle again), `docs/screenshots/m27-street.png`, `m27-zoning.png` |
| Built lots get proper surfaces: lawns, paths, driveways, yards and car parks | generated houses already had lawns, paths, drives and gardens and markets their car parks; new: front gardens with paths for generated terraces and flats (`models.ts`), and behind every hand-made model that leaves part of its lot bare a car park with marked bays and cars (shops, offices), a marked yard with crates or a container (industry), or a lawn with a path and a shed (homes) (`handmade.ts` `yard`); `scripts/dev/modelshot.mjs … --backs` |
| Streets: kerbs and pavements | `src/render/roadStyle.ts` (kerb stones, a darker kerb face, slabs and an edging along the back; medians planted inside kerb stones), junction corners in the same bands (`roadMesh.ts` `buildJunction`); medians and verges in their season and under snow (`roads.ts` shader) |
| Zebra crossings at busy junctions | `roads.ts` `junctionPaint` (where an avenue or boulevard meets, or a crossroads beside shops), `roadMesh.ts` `buildJunctionPaint` (stripes off the junction, a stop line across the lanes coming in); `e2e/m27-ground.spec.ts` (the planned town's avenue crossroads are painted: `getStreets().zebra`) |
| Cleaner road markings | lane markings stop short of crossings and give-way lines; give-way lines on side roads; stop lines at crossings (`buildSegmentRibbon` `clear`) |
| A few instanced street props where they make sense: benches, bins, planters and bus shelters | `src/render/streetProps.ts` (benches with bins and planters outside shops, bins outside homes, none by bus stops or on bridges; merged per 512 m chunk so whole chunks are culled, put away beyond 900 m, off at Low); bus shelters are M7's (`transit.ts`); `e2e/m27-ground.spec.ts` (out close up, away from far off and at Low) |
| Every new effect has a cost switch | `QUALITY_PARAMS.ground` (fields, hedgerows, paths and street furniture; off at Low), checked through Settings in `e2e/m27-ground.spec.ts` (`getShell().applied.ground`) |
| Done when: a grown city at city zoom reads as a place rather than a grid | `docs/screenshots/m27-city.png` (before on the left, after on the right: the demo town and the bench city at city zoom, and street level) |
| Done when: the frame budget holds | PROGRESS.md "Frame times": the heavy view at High under 12 ms; Medium and Low within noise of M26 (far below the start of the phase); fewer triangles than M26 in every view |

## M28 Buildings and variety

| Item | Where |
|---|---|
| Bring in every model added by then, and keep doing so | all 136 files in `assets/models/` pass `npm run models:check` and are in the game (PROGRESS.md, "Models"); none arrived during M27–M28 |
| Refresh the generator in the same style for everything still generated (roof shapes, facade details, tower silhouettes) | `src/render/assets/models.ts`: towers in five silhouettes (setbacks, steps under a lit crown, twins, an offset pair, a crown with a spire or pyramid cap), corner piers, balcony bands, fins, water tanks; residential tower walls by wealth; mansards, cornices, stone ground floors and bay windows on flats; cornices, stepped parapets and turrets on offices; mansard and saltbox houses; false fronts on stores; `tests/generated.test.ts` ('towers come in several silhouettes'); `docs/screenshots/m28-towers.png` |
| Give every building a distant version, generated ones included | `ModelBuilder.detail` and `build()` (`builder.ts`): far and skyline versions from the same triangles for every generated model; `lodChunks.ts` then draws none "plain"; `tests/generated.test.ts` (every zoned building, every civic one and rubble), `tests/handmade.test.ts`; `e2e/m28-buildings.spec.ts` (`getLod().buildings.plain` is 0 in a loaded city) |
| The whole-city view ends with fewer triangles than 2.75M despite the new detail | `scripts/dev/passprobe.mjs`: the bench city's whole-city colour pass 1.73M triangles (start of the phase 2.68M); `e2e/m28-buildings.spec.ts` (under 2.75M in the demo town, through the load screen) |
| Done when: the bench city at city zoom looks varied, with no identical neighbours | `docs/screenshots/m28-city-sheet.png` (before and after at city zoom and street level); `getNeighbours()`: no touching pair drawn with the same model (`e2e/m28-buildings.spec.ts`, the demo town's 1,308 pairs); the type now in the generator's seed (`tests/generated.test.ts`) |
| Done when: the overview draws fewer triangles than at the start of this phase | as above: 1.73M against 2.68M (colour pass), PROGRESS.md "Frame times" |
| Done when: the frame budget holds | PROGRESS.md "Frame times": the heavy view at High 9.2 ms (12 allowed); Medium and Low faster than at the start in the whole-city and heavy views; close up a little slower (Medium's street level 0.7–0.85 ms, Low 0.1–0.35 ms), a deviation from "no slower" recorded in DECISIONS M28 |

## When every milestone is done (phase 3)

| Item | Where |
|---|---|
| Update the summary in PROGRESS.md | PROGRESS.md: a phase 3 paragraph in the summary (the models, light and sky, ground and streets, buildings, the frame budget), the next tasks, and the ideas list (more hand-made models on the lots buildings grow on) |
| This brief's section in SPEC_REVIEW | the M25–M28 sections above and this one |
| The README's screenshots | `README.md`: `docs/screenshots/phase3-city.jpg` (the bench city in the afternoon) and `phase3-night.jpg` (the same at night), shot on the real GPU with the problem icons hidden as in photo mode; the text says what phase 3 added and that the hand-made models were made for the game |
| The social preview image | `public/social.jpg` (1200×630): the bench city at 17:24 on the real GPU (`node scripts/dev/socialshot.mjs bench-results/city.gz public/social.jpg 17.4 2.4 520 0.36 --gpu`) |
| Walk through the game at every zoom, by day and night and in each season, and fix whatever looks off | 72 shots: the demo town in spring, summer, autumn and winter and the bench city in summer and winter, each at the whole-city view, city zoom and street level at dawn, noon, golden hour and night (`lookshot.mjs`), reviewed by six reviewers and a consolidation pass, then by six checkers comparing before and after. Fixed (DECISIONS, "Phase 3 walk-through"): glass towers glowing as cream slabs at night, golden-hour snow reading as sand, olive dawn and golden-hour overviews, autumn grass green at noon, the night water lit teal, lamp heads blooming into pearls from far off, a very dark whole-city view at night, pencil-thin towers on narrow lots, stippled half-trees at the near-to-far hand-over, black cars, and the problem icons showing in photo mode (a bug since M4). Left, with reasons: the hand-made C213's floor-wide window groups (model side), bare rock on the steepest scenery cliffs, the river ending at the map edge |


# Phase 4 (SPEC-4.md)

Multiplayer: co-op in one city, then a shared region, over online rooms (Cloudflare) and peer-to-peer.
Each milestone's rows are filled in as it's done.

## M29 Same city everywhere

| Item | Where |
|---|---|
| Deterministic maths: replace hypot, sin, cos, atan2, pow, exp in `src/sim` | `src/sim/dmath.ts` (fdlibm ports built from exact operations), used across `src/sim` and `src/data`; `tests/lockstep/dmath.test.ts` (accuracy against the engine, golden bits). V8, SpiderMonkey and JavaScriptCore were checked to give different bits for five of the six functions (DECISIONS, M29) |
| A lint rule that forbids the originals | `eslint.config.js` `DETERMINISM`: engine maths, `**`, `toLocaleString`, `localeCompare`, `Intl` in `src/sim` and `src/data` |
| Fix any sort that isn't a total order | all 119 sorts audited; id tie-breaks added where values could tie, a divide-by-zero guarded (DECISIONS) |
| Single player changes only in the last bits; rerun balance, bench, scenario tests | every unit, scenario and legacy test passes unchanged; `bench` identical populations and tick times; `balance`: greedy and neglectful identical, careful identical for nine years then within its spread (PROGRESS, "Performance (M29)") |
| Cross-browser test: every command kind, two game years, same hash each month in Chromium, WebKit and Firefox | `npm run xbrowser` (`e2e-xb/determinism.spec.ts`, `tests/lockstep/scriptedTown.ts`, `determinism.ts`): Chromium, WebKit and the SpiderMonkey shell match Node at all 24 month ends, plus the map editor's commands and a scenario; Playwright's Firefox doesn't launch on macOS 27 (DECISIONS; "To check on the Mac") |
| Stamped commands: run to a given tick, apply at the stamped tick, never drop a tick, report how far behind; single player keeps its clock | `src/sim/lockstep.ts`, the worker's shared mode (`share`, `stamped`, `perf.behind`); `tests/lockstep/worker.test.ts` (the real worker with a stand-in scope), `e2e/m29-lockstep.spec.ts` (two real pages) |
| Snapshots leave the future alone, or every player takes them at the same tick | `settle` events (every machine finishes the commute round at that tick; the taker saves); a copy in a shared city doesn't settle; `tests/lockstep/lockstep.test.ts` ("a settled snapshot carries on exactly…") |
| No preview or query changes a city's future (two identical sims, a year) | `tests/lockstep/lockstep.test.ts`: every command the town issued previewed, every query kind, stats, frames and budgets between ticks on one of two sims for a year: identical |
| Out-of-step detection: hourly checksum, full hash at month end, a report naming the first difference | `src/sim/sync.ts` (`checksum` 0.4 ms at 110k, `partHashes` 44 ms monthly outside the tick, `desyncReport`/`simDesync`), the event fingerprint in `Lockstep` |
| Undo rule every machine agrees on and a late joiner can follow | per-player stacks, own newest action only while nothing since changed it, carried in room snapshots (`historyState`); tests in `tests/lockstep/lockstep.test.ts` ("undo in a shared city") |
| Cheats refused in a shared city | `Sim.shared`; tested in the lockstep and worker tests |
| Done when: the cross-browser test passes | as above |
| Done when: two sims fed the same stamped commands stay in step for a game year | `tests/lockstep/lockstep.test.ts` (two runners and the reference, every hour's checksum and every month's part hashes); `e2e/m29-lockstep.spec.ts` (two pages for three months, every hour's checksum equal to each other and to Node) |
| Done when: a third sim given one command a tick late is caught within a game hour, and the report names what differs | `tests/lockstep/lockstep.test.ts` ("a sim given one command a tick late…") |
| Done when: single player's tests, balance and bench unchanged apart from documented last-bit drift | as above |

## M30 Rooms, online and peer-to-peer

| Item | Where |
|---|---|
| One room protocol over two transports | `relay/protocol.ts`, `relay/room.ts` (the same Room in the local relay, the Durable Object and a host's browser), `src/net/session.ts` (a player's side), `src/net/link.ts` |
| Online rooms on Cloudflare: a Durable Object per room, Hibernation API, SQLite; the city kept between sessions | `relay/worker.ts` (`RoomObject`, `SqlStore`), `relay/wrangler.jsonc`; tested under `wrangler dev` with `RELAY_URL=ws://localhost:8790 npx vitest run relay/tests/local.test.ts` (a year in step; a city kept after everyone left) |
| Peer-to-peer: the host's browser is the room, WebRTC data channels | `src/net/p2p.ts` (`P2PHost`, `p2pConnect`); `e2e/m30-rooms.spec.ts` (p2p) |
| Signal through the Worker; also a way with no server of ours | relay signalling (`relay/signal.ts`, `SignalObject`); Trystero over Nostr when no relay is set up, tried between two pages over the internet (DECISIONS, M30) |
| Public STUN; plain words when players can't connect, offering an online room; TURN optional | `ICE_SERVERS`, `p2pFailed` in `src/net/p2p.ts` (an online room only offered when those are set up, review F10); no TURN for now (DECISIONS) |
| A clock that suits both; waits for anyone too far behind; a background host doesn't stall everyone | the pacer's `clock` (`RoomSession.clockTick`), "Waiting for …" (`waitingFor`), pacer handover and background tabs not waited for (`relay/tests/room.test.ts`, "a host whose tab goes to the background…") |
| Lobby: Host online, Host on this computer, Join with a code | `src/ui/Friends.tsx` (`FriendsScreen`), `e2e/m30-lobby.spec.ts`, `docs/screenshots/m30-lobby.png`, `m30-lobby-no-relay.png` |
| Short codes without look-alikes; invite links `?join=CODE` | `makeCode`/`normaliseCode`/`codeKind` in `relay/protocol.ts`; `inviteLink`, the boot path in `src/main.ts` |
| A name and colour each; up to 8 players | `src/client/profile.ts`, `MAX_PLAYERS`; the room panel (`RoomPanel`) |
| Joining midway loads a snapshot and catches up | settle snapshots; `relay/tests/room.test.ts`, `e2e/m30-rooms.spec.ts` (Kit) |
| A dropped connection reconnects without a reload | `RoomSession.dropped`/rejoin; tests as above (Sam) |
| An out-of-step player is resynced with a short message | the room's checksum comparison; `Sim.takeOverFrom` (no reload); tests as above (Kit) |
| A local relay speaking the same protocol | `relay/local.ts` (`npm run relay`), started by the e2e config |
| A workflow that deploys the Worker from main once the secrets exist and gives the site its address | `.github/workflows/deploy.yml` (`relay` job → `VITE_RELAY_URL`); PROGRESS.md top says what's needed |
| With no relay, online says it isn't set up; peer-to-peer still works | `relayUrl()`; `docs/screenshots/m30-lobby-no-relay.png`; Trystero tried |
| Done when: two players build one city together, in step for a game year, through the local relay and peer-to-peer | headless through the local relay's sockets for a game year (`relay/tests/local.test.ts`); real pages online and peer-to-peer building and running together, hashes equal (`e2e/m30-rooms.spec.ts`); peer-to-peer for a full year headlessly isn't possible without WebRTC in Node, so it runs the same Room in-page over loopback for the year-long tests and over real data channels in the browser test |
| Done when: a third player joins halfway and catches up | as above |
| Done when: a dropped connection comes back | as above |
| Done when: a deliberately desynced player is caught and resynced | as above (`netPerturb`, the headless `treasury` nudge) |
| Done when: the free-plan cost of an hour of play is logged | PROGRESS.md "Network (M30)", DECISIONS M30 (`scripts/dev/netbudget.ts`) |

## M31 Building together

| Item | Where |
|---|---|
| Every player's cursor and tool ghost on the map, in their colour, with their name | `src/render/presence.ts`, presence messages (`relay/protocol.ts` `here`), `Game.presenceFrame`; `e2e/m31-together.spec.ts`, `docs/screenshots/m31-ada.png` |
| A player list in the top bar | the room chip (`RoomChip`: code, a dot per player, what's being waited for) |
| Follow rides along with someone's camera | room panel Follow (`Game.follow`) |
| Ping a spot ("look here") | Shift+G (`Game.pingAt`), a ring, a sound and a toast; tested in `e2e/m31-together.spec.ts` |
| One treasury, budget, tax rates and policies | one sim; a tax change by Ada shows in Sam's budget (`e2e/m31-together.spec.ts`) |
| Own commands show at once as pending, settle when ordered | pending outlines (`Game.pending`) |
| A refusal goes back to the player who acted; same spot: the room's order decides, the loser is told why | refusals return to the issuer's promise; "(Sam got there first)" (`Game.dispatch`) |
| Roles: the host decides who can bulldoze others' work, change taxes and policies, take loans, start big projects, spend above an amount | `src/sim/rules.ts`, the room panel's Allow… and Spending limit; `tests/lockstep/rules.test.ts` |
| The room checks roles before ordering | `roomRefusal` in `Room.handle`; the sim checks the rest (`simRefusal`) |
| The inspector shows who built what | `SimState.builtBy` (save v25), `BuiltBy` in `src/ui/Inspector.tsx`; tested in `e2e/m31-together.spec.ts` |
| Chat, join/leave notices, the host can mute a player or turn chat off | room panel chat, `admin` mute/chatOff; tested in `e2e/m31-together.spec.ts` |
| Who can pause, change speed or save; everyone sees who did it | the speed permission, notices ("Sam paused the city"); DECISIONS |
| Invite friends in the pause menu turns the city into a room | `InviteButtons` (`pause-invite`) |
| Any player can export a copy | Export in the pause menu (an unsettled copy) |
| Online rooms autosave in the room, peer-to-peer cities in the host's browser, at a moment every player agrees on | settle snapshots every ten minutes and on joins; P2P hosts write them to "Shared: <city>" (`Multiplayer.host`) |
| Elections, approval, scenarios, achievements in a shared city | they're the sim's: one city, one mayor's office (DECISIONS) |
| Done when: a scripted e2e with two players grows a town through the real UI, each laying roads, zones and a service | `e2e/m31-together.spec.ts` |
| Done when: each sees the other's cursor and chat | as above |
| Done when: a tax change by one player shows for the other | as above |
| Done when: the room's city reopens later with everything in it | as above (Kit opens the code after both left) |
| Done when: the frame and tick budgets hold with 4 players | PROGRESS.md "Network (M31)" (`scripts/dev/coopbench.ts`) |

## M32 Shared regions

| Item | Where |
|---|---|
| Up to 4 player cities share a region, online or peer-to-peer while the host is online | `relay/region.ts` (`MAX_CITIES`), the Worker's `RegionObject`, a host's browser (`P2PHost` with a `RegionRoom`) |
| Each city played on its owner's machine at its own speed | the cities stay single player; region news is a `regionUpdate` command |
| Players take the place of M23's simulated neighbours; empty spots keep simulated ones | `applyRegionUpdate` in `src/sim/systems/region.ts` |
| Deals between player cities | player offers and contracts (`capacity`, `regionExport`), `REGION.playerPrice` |
| Commuters and shoppers along the highway and rail links, and visitors | `pools` in `regionFlows.ts` from the reports |
| Deals settle every game month on each city's own clock; offline neighbours' last offers stand; nobody gains by pausing or 3× | DECISIONS M32; `relay/tests/region.test.ts` |
| The region view: name, mayor, population, a small picture, the deals, visiting read-only | the Region panel (`NeighbourCard`, `SharedRegion`), `Game.thumbnail`, `?visit=`; `docs/screenshots/m32-*.png` |
| A region project | Sunfield Commons (`REGION_PROJECT`, CIVIC `sunfield`, `contributeProject`) |
| Done when: three players in one region trade power and commuters | `relay/tests/region.test.ts` (three cities); `e2e/m32-region.spec.ts` (two through the interface) |
| Done when: one goes offline and the others keep playing on the last deals | `relay/tests/region.test.ts` |
| Done when: a scripted test shows each deal settling the same in both cities | `relay/tests/region.test.ts` (`regionRates` both sides), `e2e/m32-region.spec.ts` |
| Done when: the region project completes with money from all three | `relay/tests/region.test.ts` |

## M33 Ready for friends

| Item | Where |
|---|---|
| A soak test: four players for two hours of real time at mixed speeds, with joins, leaves, reconnects and a resync, and no unexplained desync | `scripts/dev/soak.ts` (four headless players through the local relay's sockets; the log is `bench-results/soak.log`); PROGRESS.md "Soak (M33)" |
| The lobby, invites and messages on narrow windows and touch screens | `e2e/m33-narrow.spec.ts` (a phone and a tablet, by touch), `docs/screenshots/m33-*.png` |
| Tutorial tips for the multiplayer screens | tips `shared`, `sharedHost`, `region` in `src/client/tutorial.ts`; tooltips on the lobby's and room panel's controls |
| A "Play with friends" section in the README | `README.md` |
| Troubleshooting in the game and the README: peer-to-peer can't connect, a full room, out of step | `Troubleshooting` in `src/ui/Friends.tsx` (the lobby and the room panel), `README.md` "When something goes wrong" |
| Free-plan check: compare with real play, tune batching and snapshot writes | progress each second, the clock each half second and presence at most four times a second halved the messages (`scripts/dev/netbudget.ts`: 1,128 requests an hour for four players, 1.1 %); the worker paces the city between clock moves; snapshots every ten minutes of play; PROGRESS.md "Network (M33)" |
| Done when: the soak test passes | as above |
| Done when: the cross-browser test passes | `XB_FIREFOX=0 npm run xbrowser` (Chromium, WebKit, SpiderMonkey) |
| Done when: a friend could be sent a link and play without reading instructions | the invite link opens the game straight into the room; the lobby, room panel and messages say what to do (PROGRESS.md "Final playthrough (phase 4)") |

## When every milestone is done (phase 4)

| Item | Where |
|---|---|
| Update the summary at the top of PROGRESS.md | PROGRESS.md: the phase 4 paragraph, the soak, the network budget, the Cloudflare steps |
| This brief's section in SPEC_REVIEW | the M29–M33 sections above and this one |
| The README | `README.md`: Play with friends, When something goes wrong, the relay and cross-browser scripts |
| Play a co-op city and a region through the real UI with at least two players, and fix whatever feels off | `e2e/m30-*.spec.ts`, `e2e/m31-together.spec.ts`, `e2e/m32-region.spec.ts`, `e2e/m33-narrow.spec.ts` and their screenshots (reviewed). Fixed on the way: joining a paused room waited for ever; a frozen pacer held joiners; a city in a shared room moved in bursts between clock messages (now paced); panels ran off a phone; the region's first view didn't show the others' deals |

# Phase 5 (SPEC-5.md)

War between cities: armed forces, live battles, diplomacy and the stakes of war, weapon research and
spies, investments, war with friends, and the race for the atom bomb. Each milestone's rows are
filled in as it's done.

## Before you start

| Item | Where |
|---|---|
| Start from the latest `main` (phase 4 and the war models merged) | the session's branch `claude/new-session-a0qpy4` (standing in for `war`), made from `main` at 6883790 |
| SPEC-5.md saved word for word | `SPEC-5.md` |
| CLAUDE.md: the current brief, the start-of-session steps, the checklist M0–M40 | `CLAUDE.md` |
| M34–M40 on PROGRESS.md's checklist; a phase 5 section here and in DECISIONS | `PROGRESS.md`, this section, `docs/DECISIONS.md` "Phase 5" |
| Read the war models' README before M34 | `assets/models/war/README.md` (its allowances are taken up in M34) |

## Rules for all of phase 5

| Rule | Where |
|---|---|
| Peaceful play doesn't change; existing saves load and play on (save version bumps with a migration and a test) | war state only where war is on (DESIGN §3.28); `tests/war/forces.test.ts` "peace is unchanged" (part hashes against a golden from `main`); save v27 (`migrations[26]`), the legacy corpus tests |
| Phase 4's rules: deterministic maths, the cross-browser test each milestone, the sim pure, free plan, safe for friends, budgets | war code uses DMath and its own dice; the cross-browser run grows a rivals town too (`tests/lockstep/determinism.ts` `war`); region rules through the region room (protocol 2) |
| Battles are deterministic, applied as commands to each city's sim | M35 |
| Reuse what's there | civic buildings, the seaport's quay rules, the noise raster, mood factors, loans' annuity, the region room |
| Models: sites and sizes from the prompts; PROMPTS-WAR budgets; spec v6 and unit spec v1; the README's allowances; a generated look for every one | M34: see the M34 rows |
| Budgets for big battles | M35, M37 |
| Keep players informed: warnings, a war room, plain reasons, tutorial tips | M34: the war room, refusal reasons ("Military buildings need war on…", "Needs a Military HQ first", "The barracks is full…"), tips `rivals` and `warRoom` |
| Milestones: playable and tested through the real UI, screenshots reviewed, an `M<n> complete:` commit and pull request, balance and bench | per milestone below |

## M34 Armed forces

| Item | Where |
|---|---|
| Military buildings with upkeep, jobs and power, and an effect on approval (safety, noise) | `MILITARY_DEFS` (src/data/war.ts), `militaryStaffing`, `serveMilitary`, `safetyAt`, noise.ts; `tests/war/forces.test.ts` |
| Barracks, vehicle depot, airfield, naval yard on deep water, radar, anti-air, coastal guns, bunkers, shelters, military HQ (opens the war room), proving ground | the same; `WATERFRONT` (naval yard, coastal gun) and its test |
| Units: infantry, tanks, artillery, planes, helicopters, drones, boats, transport | `UNIT_DEFS` (base set; research adds the rest in M37) |
| Cost from money, goods, ore, oil and power; upkeep; train over time | `trainUnit`, `unitBill`, the stores (`warHour`), `forcesUpkeep`, the war clock |
| Visible in the city: parked, on drills, patrolling | `src/render/units.ts` (see below) |
| A defence line in the budget | `upkeep:defence` and `forces`, the Defence funding slider (war only) |
| War bonds with an approval cost | `issueBond`, `bondsHour`, `bondMood` |
| An arms factory: munitions and vehicles, jobs | `armsfactory` (`arms`: goods, munitions, storage, faster vehicles) |
| The war room: forces, upkeep, readiness, research | `WarRoomPanel` (src/ui/Military.tsx), Shift+M, the top-bar button, the HQ's inspector |
| "Rival neighbours": the new-city option; region rules (war on/off, largest scale) | `new-rivals`, `?rivals=1`, `markRivals`/`rivalsMonth`; `RegionWarRules`, `rrules`, the Region panel's War in the region; `relay/tests/warRules.test.ts` |
| Models: the war models in the pipeline (PROMPTS-WAR budgets, spec v6, unit spec v1, the README's allowances), a generated look for every one | `npm run models:check` (all 39 war models pass, with notes), `src/models/unit.ts`, `warCodec.ts` (their own file, fetched only at war; the main file is byte-identical), `militaryModels.ts`, `unitModels.ts`; `tests/warModels.test.ts`, `tests/war/units.test.ts` |
| Units visible: parked, on drills, patrolling (and flying and sailing) | `src/render/units.ts`, `unitPoses.ts` (pure functions of the display clock), one instanced mesh per kind and level, dots far off, the quality's `units` switch; `node scripts/dev/unitshot.mjs <out>` |
| *Done:* every military building built and every kind of unit trained through the real UI | `e2e/m34-forces.spec.ts` (the kinds without research; heavy tanks, repair crews, bombers, gunboats, submarines and landing craft need M37's research, and say so) |
| *Done:* upkeep and approval in the budget and the inspector | the budget's Forces upkeep and Defence upkeep lines and the Defence slider; the inspector's upkeep, staff, power, "feel safer" and noise lines; homes' "Feels safe" mood factor; the e2e checks each |
| *Done:* war off plays and saves exactly as before; `balance` with rivals off unchanged | `tests/war/forces.test.ts` "peace is unchanged" (14 months, part for part, against `main`); `balance` 20 years careful, greedy and neglectful identical to `main` (PROGRESS) |

## M35 Into battle

| Item | Where |
|---|---|
| A region map: the cities, routes (highway, rail, sea lanes, air) with travel times, forces in transit as tokens, fronts | the war room's Map tab (`RegionMap`, src/ui/Battle.tsx): road and air hours to each neighbour, rail with a rail link, the sea lane with boats (`WarSummary.routes`), our tokens and the raid on its way, fronts (fighting lately or hostile), when raids may come (`war-threat`) |
| Sending forces: units, route, target (military, industry, power, city hall); leave by the edge, arrive after the travel time, with a warning to the defender | the Send tab (`SendForce`), `sendForce`/`sendRefusal`/`recallForce`, `travelHours`; the city hall needs a declared war (M36) and says so; raids on the city warn by `warningHours` (radars) with the raid chip's countdown and the siren |
| A deterministic battle simulation in the defender's city: roads and terrain, fire, cover, buildings hit | `src/sim/battle/battle.ts` on `battleLayout`'s picture; `tests/battle/battle.test.ts`, `layout.test.ts`, `away.test.ts` |
| Defences and units respond on their own | defences fire at what they defend against (staff × power); defenders from the city's forces; computer towns manned by `rivalDefence` |
| Buildings damaged, on fire, falling into rubble through the disaster system | `applyWarDamage` (`ignite`, `toRubble`, civic damage and wrecks, road craters), repairs in `disastersHour`; `tests/war/raid.test.ts` |
| Residents shelter, then move out or come back | `shelterCount` (places in shelters near the target), `raidMood` for those left out; homes in rubble move out and regrow as after a disaster |
| Watchable from both cities, speed and camera each player's own | a raid on the city plays in its own sim at its own speed; the attacker watches in the town (`?battle=`, the replay re-run there); a friend online watches theirs live (`battleResolve watch`); Follow the fighting |
| The defender away: the battle runs from the latest layout the region holds; applied when they next open their city; a replay and a damage report waiting | `relay/region.ts` (`battle`, `battleSeen`, `City.pending`), `RegionLink.sendBattle`, the leaving save (`last`), `Game.takeBattle`; `relay/tests/regionBattles.test.ts`, `e2e/m35-friends.spec.ts` |
| Computer neighbours attack and defend with simple tactics | `raidsHour` (bar, gaps, aggression × odds, hostility, retaliation), `rivalForce` by character, `RIVAL_TARGET`, cautious or bold; towns grown by the mayor (`growRivalTown`) and armed (`armTown`) |
| Skirmishes the only scale | `BattleInput.scale: 'skirmish'`, `SKIRMISH` (targets, 12 buildings and 3 city buildings at most) |
| Players kept informed | notices (raids may come now, sirens, battle started, our force arrived, the report, home), the raid chip and battle bar, the Reports tab, tips `raidComing` and `sendForce`, refusal reasons in the Send tab |
| *Done:* a scripted skirmish against a computer neighbour, the same result in Chromium, WebKit and Firefox | `tests/lockstep/determinism.ts` `battle` (an expedition against a mayor-grown town, and a raid fought in the war town), `e2e-xb/determinism.spec.ts`; Chromium here, WebKit and Firefox in `.github/workflows/xbrowser.yml` |
| *Done:* an e2e sends a force through the real UI, watches the battle and sees the damage repaired | `e2e/m35-battle.spec.ts` (and a neighbour's raid with its countdown and siren, fought and repaired) |
| *Done:* an offline defender gets the replay and a report that matches the damage | `e2e/m35-friends.spec.ts` (two players through the UI), `relay/tests/regionBattles.test.ts` |

## M36 Diplomacy and the stakes of war

| Item | Where |
|---|---|
| Declaring war at each scale, within the region's rules, with a warning period and a reason the other side sees | `declareWar`/`declareRefusal` (`warScaleAllowed`: the region's rules, total war in a rivals city), `War.opens` 12 game hours on, `War.reason` (80 characters) in the notice and the war card; computer neighbours' own declarations give theirs (`WAR_REASONS`) |
| War score from battles won, targets held and economic damage; capitulation once it collapses | `scoreBattle` (8–15 a battle by how decisive, ±1 per $25,000 of buildings lost, `holdPerHour`, `allyPerDay`), `checkCapitulation` at −60 (`capitulate`: a ceasefire, raids and forces turned back, the winner's terms imposed) |
| Treaties: proposals and counter-proposals with ceasefire, peace with reparations, tribute, demilitarised zones, occupied districts, non-aggression, alliances, defensive pacts, embargoes | `Term` (src/data/diplomacy.ts), `propose`, `answerProposal`, `withdrawProposal`, `sign` (`Pact`s), `counterTerms`; tribute and occupations in `diplomacyRates` (ledger lines), embargoes in `setDeal`, DMZs in `standsDown` and placement |
| Both sides must accept, except terms imposed after a capitulation | `answerFromComputer` (`weigh` by character, feelings, reputation and the score) and `answerProposal`; `propose` to a capitulated neighbour signs at once (`imposed`), `imposedTerms` for the city's own capitulation |
| Breaking a pact has consequences: reputation, allies leaving | `breakPacts` (reputation −30, the victim's allies −40, their pacts ended, those that keep pacts at war); asked first (`info.breaks`, `breakPact`) |
| Total war and conquest: hold a city hall long enough and the city falls | the military HQ is the seat of power (DECISIONS); `War.hold` from a seat knocked down in a total war, broken by a battle its defender wins, `conquer` after 48 hours |
| Its player plays on as a vassal or starts again; a vassal can rebel when strong enough | `diplomacy.vassal` (a fifth of its taxes to the overlord, no wars but a rising), `FallenCard` (play on, or start again with the save kept), a rising at 1.2× the overlord's strength (`declareRefusal`); a conquered computer neighbour (`rival.vassal`) pays and rises in `computerMoves` |
| Fairness: newcomer protection, attack limits per real day, the damage cap while away, cooldowns between wars, a neutral stance | `raidThreat` for computer declarations; for friends the region room decides (`raidRefusal`: neutral, new unless struck first within a day, three raids a UTC day, eight waiting at most, absent in a peer-to-peer region), shown to the page first (`raidVerdict`, `strikeRefusal`), and the attacker's sim takes a battle only once the room keeps it (`battleSettling`, `battleKept`/`battleRefused`); half caps for a battle kept while its target was away (`away`, `SKIRMISH.awayCollapse`); three months between wars (`ended`); `setNeutral` (a month to leave) |
| Computer neighbours' diplomacy follows personality and reputation | `DIPLOMATS`, `weigh`, `computerMoves` (proposals by character, declarations by aggressive and treacherous neighbours that outgun and dislike the city), `rivalAllies` |
| *Done:* a skirmish changes no land | `tests/war/diplomacy.test.ts` "a skirmish changes no land" |
| *Done:* a war ends in a treaty with tribute paid month by month | `tests/war/diplomacy.test.ts` "declared, won in battle, and settled" (six months' tribute, each a full month's) |
| *Done:* a total war conquers a city that then plays on as a vassal and later rebels | `tests/war/diplomacy.test.ts` "a city whose HQ is held falls, plays on as a vassal, and later rises and goes free" (and a conquered neighbour that rises) |
| *Done:* a pact broken with a computer neighbour turns its allies | `tests/war/diplomacy.test.ts` "a pact broken with a computer neighbour turns its allies" |
| *Done:* the fairness limits hold against a test that tries to raid an offline city all night | `relay/tests/freeplan.test.ts` "holds a friend raided all night…", "turns away a raid on a neutral friend…", "answers every battle…" (and the sim's own checks in `tests/war/diplomacy.test.ts` "friends' raids") |
| Reviewed | three adversarial passes (32, 11 and 4 confirmed findings, all fixed: DECISIONS "An adversarial review of M36") |

