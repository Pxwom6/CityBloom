# Review against SPEC.md (M12)

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
  they would plug in. Listed as next steps at the top of PROGRESS.md.
- **Visitors in traffic** (M10): tourists are counted, spend and shop, but don't drive through the
  traffic model.
- **Render triangle budget**: 2.5M at the whole-city overview of a 100k city (half of it the shadow
  pass) against an early 1.5M target; draw calls are within budget. Flagged for the Mac check.

---

# SPEC-2.md (phase 2, M13–M24)

Each phase-2 milestone mapped to where it's done. Filled in as milestones complete.

## Rules for all of phase 2

| Rule | Where |
|---|---|
| Work in order, each milestone playable, UI-tested with screenshots, `M<n> complete:` commits | git history; `e2e/m13-*.spec.ts` onwards; `docs/screenshots/m13-*.png` onwards |
| New saved state bumps the save version with a migration and a test that older saves load and play on | M13: SAVE_VERSION 12 (`terrainDelta`), `tests/grading.test.ts` loads the version-10 playtest save; M14: v13 (undo history no longer saved), `tests/history.test.ts` loads a v12 save |
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
