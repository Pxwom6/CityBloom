# DESIGN.md — technical design

Working title: **Citybloom** (single constant `GAME_TITLE` in `src/config.ts`).

This document is the technical design: architecture, data model and simulation model. `SPEC.md` is the
brief; this file says *how* we build it. Every number quoted here is an initial value that lives in
typed config under `src/data/` and gets tuned by the balance tool in M12. Keep this file in step with
the code.

---

## 1. Architecture

### 1.1 Component diagram

```
┌─────────────────────────────────── Main thread ───────────────────────────────────┐
│                                                                                   │
│  DOM input ──► InputRouter ──► Tools (road / zone / bulldoze / place / inspect)   │
│      │                            │  ghost preview (local)   │ commands, previews │
│      ▼                            ▼                          ▼                    │
│  CameraController          UI (Preact + CSS tokens)     SimClient                 │
│  (eased pan/rotate/zoom)   top bar, toolbar, panels,    typed postMessage wrapper │
│      │                     debug panel, menus, advisors   │ request/reply ids     │
│      ▼                            ▲ read                  │ applies Frame diffs   │
│  Renderer (Three.js, WebGL2) ◄────┴──── ClientWorld ◄─────┘                       │
│  terrain chunks, water, sky,           read-only mirror: roads, zone blocks,      │
│  trees (instanced), roads (per-segment  buildings, stats, time, vehicles,         │
│  meshes), buildings (chunk-merged),     traffic flows, overlay grids              │
│  vehicles (instanced), overlays, FX                                               │
│                                                                                   │
│  window.__game (dev/test): dispatch, getState, advance, setCamera                 │
└──────────────────────────────────────┬──────────────────▲─────────────────────────┘
                     Command / Query /  │                  │  Frame {tick, diff, stats}
                     Speed / Advance    ▼                  │  Reply {id, result}
┌──────────────────────────────────── Web Worker ─────────┴─────────────────────────┐
│  worker.ts  — real-time loop: ticksDue = speed × elapsed (capped), batches ticks, │
│               flushes one Frame per loop iteration (≤ 20 Hz)                     │
│     └─► Sim  (src/sim — pure TypeScript, no DOM / Three.js)                        │
│          ├─ CommandProcessor: validate → apply → ledger → undo stack → cmd log   │
│          ├─ World: terrain grids, road graph, zone blocks, buildings, vehicles    │
│          ├─ Systems (fixed schedule, see §3.2):                                   │
│          │    demand · growth · economy · utilities · coverage · traffic ·        │
│          │    incidents/dispatch · happiness · land value · pollution ·           │
│          │    health/education · disasters · progression · advisors               │
│          ├─ RNG streams (sfc32, seeded, saved)      Calendar (tick → date/time)   │
│          ├─ DiffTracker (dirty ids per collection → compact Frame diffs)          │
│          └─ Save/Load (versioned JSON + migrations) · stateHash (FNV-1a)          │
└───────────────────────────────────────────────────────────────────────────────────┘
      src/data (typed balancing config) is imported by both sides.
      Tests (Vitest) drive Sim synchronously and headlessly — no worker needed.
```

### 1.2 Module layout

```
src/config.ts         title, version, feature flags
src/data/             typed config: roads, zones, buildings, services, utilities, economy,
                      balance (demand/growth/happiness constants), unlocks, policies, names
src/sim/              pure simulation (runs in the worker and in Vitest)
  sim.ts              Sim class: create/load, dispatch, step, query, save, hash, diffs
  worker.ts           worker entry (the only sim file that touches `self`)
  protocol.ts         typed messages between threads
  commands.ts         Command union + result types
  rng.ts hash.ts time.ts geom.ts spatial.ts
  terrain/            noise + deterministic terrain/resource/tree generation
  world/              roads (graph, planning, splitting), zones (blocks/cells), buildings, lots
  systems/            one file per system
  save.ts             serialize / deserialize / migrations
  invariants.ts       per-tick checks used in test mode
src/client/           SimClient, ClientWorld mirror, test API
src/render/           Three.js scene, camera, terrain, water, sky, trees, roads, zones,
                      buildings (asset registry + procedural parts), vehicles, overlays, FX
src/tools/            input tools (road, zone, bulldoze, place, inspect)
src/ui/               Preact components + CSS (tokens.css holds every design token)
src/audio/            procedural Web Audio
tests/                Vitest unit + scenario tests      e2e/  Playwright tests
scripts/              bench + balance runners (Node, headless Sim)
docs/                 DECISIONS.md, screenshots/
```

### 1.3 Trade-offs weighed

| Decision | Chosen | Alternatives and why not |
|---|---|---|
| Where the sim runs | **Web Worker**, same `Sim` class runs synchronously in tests/scripts | Main thread: simpler API but sim spikes become frame hitches. Worker cost: async API, a mirrored copy of render-relevant state, one round trip for previews. |
| Main-thread state | **ClientWorld mirror** of render-relevant fields, updated by diffs | Full snapshots each tick: too big at 5k buildings. SharedArrayBuffer: needs COOP/COEP headers and makes entity data awkward. |
| Diff shape | Per-collection upserts + removals of dirty ids, stats every frame, grids on demand as transferable `Float32Array`s | Field-level patches: more bookkeeping for little gain. |
| Entity storage | Plain objects in `Map<id, T>` with monotonically increasing ids (insertion order = id order ⇒ deterministic iteration, JSON-friendly) | Struct-of-arrays: faster but much harder to read and serialize. Used only for grids and zone cells. |
| Grids | 128×128 rasters of 16 m cells (`Float32Array`/`Uint8Array`) | Per-building only: can't express drift/diffusion or data maps. |
| Road geometry | Nodes + segments, each a **quadratic Bézier** (straight = control at midpoint), sampled to polylines for everything geometric | Cubic/arbitrary splines: more UI complexity for little visual gain; free-form drawing is fitted with chains of quadratics. |
| Zoning | Cells (8 m) generated along both sides of each segment in **zone blocks**, remapped geometrically when roads split or upgrade | A global grid: breaks with curved roads. |
| Traffic | **Aggregated assignment** (nearest-capacity trip distribution + congestion via BPR, averaged over rounds), visible cars sampled from real routes | Per-agent pathfinding: does not scale to 100k residents in JS. |
| Utilities | Flow through the **road network** by distance from plants; capacity-limited | Pipes/lines: spec says no. |
| Coverage | Bounded Dijkstra over the road graph in travel time, including congestion | Radius: spec forbids. |
| Buildings on screen | **Chunk-merged geometry** (128 m chunks, one draw call per chunk) with a shared vertex-coloured material; constructing/burning buildings drawn separately | Instancing per model: procedural variety creates hundreds of models, so instancing degrades to many draw calls. Instancing *is* used for trees, vehicles, zone cells, props. |
| UI framework | **Preact** (3 kB, JSX, hooks) + plain CSS with custom-property tokens | Vanilla DOM: panels (budget, inspector, menus) get messy. React: heavier. |
| Determinism | Integer tick, seeded sfc32 streams, no wall-clock or `Math.random` in `src/sim` (lint-enforced), money in integer dollars | Floats for money would make "income − expenses = Δtreasury, exactly" fragile. |
| Undo | Sim keeps an undo record per placement (created ids, painted cells, cost) and a single `undo` command reverses the latest one with a full refund | Snapshot-based undo: too much memory. Bulldozing is not undoable (spec: undo reverses placements). |

### 1.4 Threads and messages

Main → worker (`protocol.ts`): `init {seed, options} | load {save}`, `command {id, cmd}`, `preview {id, cmd}`
(dry run: validity, cost, affected entities; never mutates), `query {id, q}` (inspect building, overlay grid,
coverage preview, full state summary), `setSpeed {speed}`, `advance {id, ticks}` (run N ticks now, then
reply), `save {id}`.

Worker → main: `ready {snapshot}`, `frame {tick, diff, stats, perf}`, `reply {id, result}`.

The worker loop runs every ~16 ms: `due += elapsedMs × ticksPerSecond(speed)`, runs `min(floor(due), cap)`
ticks (cap prevents spiral-of-death; excess is dropped and reported in perf stats), then posts one frame
if anything changed. Commands are applied at the next tick boundary and logged as `{tick, cmd}`, so a
replay of the log from the same seed reproduces the same state hash.

### 1.5 Determinism rules

- All randomness from `Rng` streams (sfc32) seeded from the map seed; stream states are saved.
- Fixed tick; systems run on `tick % period === offset`; sliced work keeps its cursor in saved state.
- Iteration over entity maps is in id order. No `Date`, `performance`, `Math.random` inside `src/sim`
  (ESLint `no-restricted-globals`/`no-restricted-properties`).
- `stateHash()` = FNV-1a over the canonical save JSON. Tests assert: same seed + same command log ⇒
  same hash; save → load ⇒ same hash; load then run N ticks ⇒ same hash as running N ticks directly.

---

## 2. Data model

### 2.1 World coordinates

Metres. `x` east, `z` south, `y` up. Buildable area `[0, 2048] × [0, 2048]`. Water level `y = 0`.
Terrain grid: 257×257 heights at 8 m (bilinear sampling). Rasters: 128×128 cells of 16 m.
Scenery extends 3 km beyond each edge, generated on the main thread from the same pure height function.

### 2.2 Sim state (saved)

```ts
SimState {
  version, seed, options {preset, difficulty, sandbox, disasters, terrain}, tick,
  rng: {growth, events, traffic, world, disasters}          // sfc32 states
  terrain: { heights: Float32Array(257²) }                  // regenerated from seed + options.terrain
                                                            // (generator version), not saved
  terrainDelta: Float32Array(257²)                          // earthworks (M13): heights = seed + delta
  grids:   { trees, groundwater, ore, oil,                  // Uint8/Float32, 128²
             airPollution, groundPollution, landValue, crime, garbageField, ... }
  roads:   { nodes: Map<id, RoadNode>, segments: Map<id, RoadSegment>, nextId }
  zones:   { blocks: Map<id, ZoneBlock> }
  buildings: Map<id, Building>
  vehicles:  Map<id, ServiceVehicle>                        // dispatched fire/police/ambulance/garbage/bus
  incidents: Map<id, Incident>                              // fires, crimes, emergencies, disasters
  traffic:   { segmentVolume (per segment id), round cursor, samples }
  economy:   { treasury, taxRates[3][3], funding{dept}, loans[], ledger {month, history[]}, carry }
  city:      { name, population, jobs, approval, milestonesReached[], unlocks[], policies[],
               specialisations, achievements[] }
  demand:    { R, C, I (−1..1), factors: {R: Factor[], ...} }
  undo:      UndoRecord[] (bounded)
  log:       CommandLogEntry[] (for replays; bounded in saves)
}
```

Key entities:

```ts
RoadNode    { id, x, z, y, segs: number[] }                 // segs is derived, rebuilt on load
RoadSegment { id, a, b, cx, cz, type: RoadTypeId, length, blocks: [left, right], name,
              deck?: number[] }                             // viaduct over dry ground: heights / 4 m (M13)
ZoneBlock   { id, seg, side: 1 | -1, s0, cols, rows,        // cell (c, r) centre = P(s0 + (c+½)·8) +
              zone: Uint8Array, valid: Uint8Array,          //   N·(halfWidth + (r+½)·8), angle = tangent
              bld: Int32Array }                             // building id or 0
Building    { id, def: string, kind: 'zoned'|'service'|'utility'|'park'|'landmark'|'special',
              zone?: 'R'|'C'|'I', density: 0|1|2, wealth: 0|1|2, level: 1..3, variant,
              lot?: {block, col, w, d}, x, z, y, angle, w, d,          // footprint in metres
              access?: {seg, s},                                       // frontage on the road graph
              state: 'construction'|'active'|'abandoned'|'rubble', progress,
              residents, capacity, jobs, workers, students, sick, edu, garbage,
              served: {power, water, sewage}, coverage: {fire, police, health, school, park, ...},
              happiness, factors: Factor[], distress, fire, flags, funding?, modules? }
```

### 2.3 Derived (not saved, rebuilt on load)

Node adjacency, segment polylines and arc-length tables, spatial hashes (segments, cells, buildings),
connected components, coverage caches. Everything derived must be a pure function of saved state so
that load → run stays deterministic.

### 2.4 Client mirror (`ClientWorld`)

Only what rendering and UI need: nodes, segments, blocks (zone + valid + occupied), buildings
(def, footprint, level, state, progress, flags), vehicles, traffic flow per segment, sample routes,
stats, time, notifications, active overlay grid. Details (happiness breakdown, residents) are fetched
by `query` when the inspector opens.

---

## 3. Simulation model

### 3.1 Time

- 1 tick = 1 game minute. 60 ticks = 1 hour. **1 day = 1 calendar month** (1440 ticks): the calendar is
  compressed so a day/night cycle and the monthly budget share one clock. 12 months = 1 year
  (17 280 ticks). The date reads e.g. `Mar, Year 3 — 18:40`.
- Speeds: pause, 1× = 8 ticks/s (a month ≈ 3 min), 2× = 16, 3× = 24.
- The main thread interpolates time of day between frames for smooth lighting.

### 3.2 Schedule

| Period | System |
|---|---|
| every tick | apply commands · move service vehicles · advance fires/incidents · construction progress |
| 10 ticks | growth pass (slice of zone blocks) · occupancy |
| hour, spread by minute (`HOURLY_AT`) | :00 utilities · :03 coverage cache rebuild (only after a road/service change) · :06 school seats and hospital beds · :07 coverage fields · :12 health · :18 garbage · :24/:25 ground, then air pollution and crime decay (every 3 h) · :30–:33 commute matching, a quarter of the origins per tick (every 2 h) · :36 happiness · :42 incidents and lifecycle · :48 totals, demand, economy, progress · :54 land value (every 3 h) |
| month | budget close + history · education progression · milestones · advisors digest |

### 3.3 Demand (RCI)

Demand is a sum of **named factors**, clamped to [−1, 1]; the UI lists each factor, so the player can
always see why. `pending` capacity (under construction) counts as supply so growth doesn't overshoot.

```
workers      = residents · WORKFORCE_SHARE (0.5)
unemployed   = workers − filledJobs            (from the employment/commute matcher, §3.8)
openJobs     = totalJobs − filledJobs

R = clamp( Jobs:        1.5 · (openJobs + pendingJobs − unemployed − pendingHomes·0.5) / (workers + 100)
         + Newcomers:   0.6 · max(0, 1 − population / 400)          // highway brings settlers
         + Appeal:      0.8 · (approval − 0.55)
         + Taxes:       −0.04 · (avgResidentialTax − 9) )

C = clamp( Shoppers:    1.2 · (residents · SHOP_JOBS_PER_RES (0.12) + tourists·k − cJobsAll) / (cJobsAll + 20)
         + Workforce:   0.6 · unemployed / (workers + 50)
         + Goods:       −0.4 · goodsShortage                          // M6: freight
         + Taxes:       −0.04 · (avgCommercialTax − 9) )

I = clamp( Workforce:   1.5 · unemployed / (workers + 50)
         + Exports:     0.25 · highwayConnected · tradeMultiplier     // regional demand for goods
         + Freight:     −0.3 · freightCongestion
         + Taxes:       −0.04 · (avgIndustrialTax − 9) )
```

The loop: settlers → unemployed workers → C/I demand → jobs → R demand → … Exports and appeal keep
the loop gain above 1 for a well-run city and below 1 for a badly run one. Per-wealth tax rates add a
term to the spawn probability of that wealth level (§3.4), so taxing the rich only slows rich growth.

### 3.4 Growth, upgrading and decline

- **Lots.** Growth walks zone blocks round-robin. A lot is `w` columns × `d` rows of same-zone,
  valid, empty cells starting at row 0 (road frontage). Adjacent columns must differ in angle by
  < 6° (so multi-column buildings don't straddle sharp curves).
- **Spawn.** For each candidate lot per pass: `p = 0.25 · max(0, demand_z) · wealthMod · lvMod`, capped
  by `maxConstructions = 2 + ceil(population / 400)`.
  - `density = min(road.maxDensity, unlockedDensity(zone), lotAllows)`.
  - `wealth` from land value at the lot (§3.10), lowered one step if that wealth's tax term makes its
    spawn chance ≤ 0; high wealth also needs fire+police+health coverage ≥ 0.4.
  - Industry "wealth" = industry tier: 0 dirty, 1 manufacturing, 2 high-tech (needs educated workforce, §3.11).
- **Construction.** `progress += 1 / def.buildTicks` (90–400 ticks). Scaffolding is visible.
- **Occupancy (R).** Each pass residents move toward `target = capacity · clamp(0.3 + happiness, 0, 1)`
  (only moving in while R demand > −0.2). Move-in ≤ 10 % capacity per pass, move-out ≤ 5 %.
- **Jobs (C/I).** `jobs` is capacity; `workers` comes from the matcher (§3.8).
- **Upgrade.** Active, happiness ≥ 0.66 and occupancy ≥ 88 % for 3 consecutive hourly checks, level < 3:
  chance per check → rebuild in place at level+1 (bigger model and capacity). If the road now allows a
  higher density and it's unlocked: redevelop to the next density on a larger lot. In-place upgrades
  keep their occupants and don't count against `maxConstructions` (only new buildings do).
- **Decline.** `distress += 1/h` while happiness < 0.3 or power or water is below half, `+2/h`
  without a road link to the highway, else `distress −= 2/h`. (A pleasant neighbourhood can't
  outweigh having no power or water.) `distress ≥ 48` ⇒ **abandoned** (occupants leave, jobs 0,
  −0.15 land value within 64 m, 4× fire risk). Abandoned buildings re-occupy if their would-be happiness
  stays > 0.5 for 24 h. Businesses **close** (jobs 0) after 12 h without power or water, before abandoning.

### 3.5 Economy

Money is **integer dollars**. Each hour every income/expense category accrues a float amount; the
integer part is booked to the ledger and the fraction is carried to the next hour, so over time nothing
is lost and at every instant `Δtreasury = Σ ledger entries` exactly (one-off costs, refunds and loans
are ledger entries too). Monthly rates below are divided by 24 per hour.

```
Tax(R, b)   = residents_b · RES_INCOME[w] · rateR[w] / 100            RES_INCOME = 24, 44, 80 $/month
Tax(C, b)   = workers_b · COM_INCOME[w] · rateC[w] / 100 · (0.5 + 0.5·customers_b)   60, 100, 160
Tax(I, b)   = workers_b · IND_INCOME[t] · rateI[t] / 100 · (0.6 + 0.4·freightOK_b)    50, 90, 140
Upkeep(b)   = def.upkeep · funding_dept(0–150 %) · (1 + 0.5·modules)
Roads       = Σ length · ROAD_UPKEEP[type]                             $/m/month
Loans       = annuity payment: P · r / (1 − (1 + r)^−n), r = annual/12, n months
Policies    = policy.monthlyCost (some scale with population)
Trade       = export revenue, specialisation revenue (M10)
```

- 9 tax rates (R/C/I × low/med/high, 0–20 %, default 9 %). Taxes enter demand (§3.3), spawn chance per
  wealth, and happiness (§3.9).
- Funding effectiveness `eff(f) = f ≤ 1 ? f : 1 + 0.5·(f − 1)` (diminishing returns above 100 %).
- Budget panel: current month ledger by line, last 24 months history, projection = last full month.
- Loans: 25k/50k/100k (more at later milestones), 6–9 % a year, 5-year term, repay early allowed.
- **Bankruptcy.** Treasury < 0 ⇒ escalating warnings; after 2 months continuously negative
  (the grace period) the city is **bankrupt**: game over screen, the sim refuses further commands except
  load/new game. Sandbox: huge treasury and no bankruptcy.
- **Difficulty** (`DIFFICULTY` in `data/economy.ts`, M11): Relaxed / Standard / Tough start with
  $100k / $60k / $35k, and the upkeep of roads and buildings is ×0.8 / ×1 / ×1.25 (applied in the
  monthly rates, so the inspector, budget projection and ledger all agree).

### 3.6 Utilities (power, water, sewage, garbage)

Civic buildings (`src/data/civic.ts`) are placed by the player beside a road, facing it; their front
edge must touch the road corridor, which gives their access point on the graph. Zone cells under them
become invalid. Use per consumer = capacity × a per-zone rate (`UTILITY_USE`).

Flow through the road network. For utility U, each network component `k` has
`supply_k = Σ plant.capacity · eff(funding) · condition` (water pumps × `0.3 + 0.7·groundwater` at the
pump; river pumps full). Consumers are sorted by road travel distance to the nearest producer
(multi-source Dijkstra) and served in that order until supply runs out, so shortages hit the far end
of the network first — readable on the data map. `served_b ∈ [0, 1]`.

- Water is **polluted** if ground pollution at a pump > 0.3: buildings on that component get a sickness
  modifier. Sewage demand = water use; outflow pipes (within 36 m of water) emit ground/water pollution
  downstream; septic tanks (M12: cheap, 120 units, anywhere) taint the ground around them; treatment
  plants don't. Unserved sewage adds ground pollution at the building.
- Garbage: `garbage_b += rate_b/h`, up to a cap of 120 per building (twice the level where it does
  its worst). Landfills/recycling/incinerators dispatch trucks (real vehicles) to the fullest buildings
  in their road coverage. A truck works a round (playtest fixes): it collects from its target and the
  neighbours within 48 m, then drives on to the nearest building within 200 m with garbage that no
  other truck is heading for, until it's 85 % full or has made 10 stops, and only then drives back to
  unload. Vehicles move at their drawn speed, so a drive across town takes hours of game time; one
  stop per trip left trucks carrying a fifth of a load. Each site has its starting trucks plus up to
  four bought in its inspector ($1,200, +$45/month each), all scaled by garbage funding; the inspector
  shows trucks out, collected vs made per day, the backlog and the last day's rounds. Landfills fill
  up; incinerators make power and air pollution; recycling earns trade revenue. Piles are drawn above a
  threshold.
- Consequences escalate: happiness penalty immediately (§3.9) → businesses close after 12 h without
  power/water → distress towards abandonment (§3.4). Icons over buildings; advisor alerts.

### 3.7 Service coverage and incidents

- **Coverage** of a service building: bounded Dijkstra from its access point in travel **time** over
  the road graph (free-flow speeds until M6 adds congestion). Each road touching a reached junction is
  then **sampled every 24 m** at `t(s) = min(t_a + s/v, t_b + (len − s)/v, |s − s_access|/v on its own
  road)`, and coverage is `min(1, eff) · clamp((T − t) / (T − 0.5·T), 0, 1)` (full within half the
  range), with `T = range · (0.85 + 0.15·eff)` and `eff` the department's funding effect. A road's
  coverage is the max over stations of that kind. Ranges (s): fire 55, police 60, clinic 45, hospital
  100, primary 45, high school 80, library 50, university 240, pocket park 16, plaza 20, city park 32
  (a street is 11 m/s, so a fire station fully covers ~300 m of street and fades out by ~600 m).
  Buildings read the value at their frontage (`seg`, `s`); the data maps tint the roads themselves
  with these samples, so coverage visibly follows the roads.
- The coverage table is a pure function of roads, service buildings and funding. The sim caches it and
  drops the cache whenever one of those changes, so a reload mid-hour computes the same numbers.
- **Capacity**: vehicles per station (scaled by funding). School seats: children = 20 % of residents;
  each school's Dijkstra fills the nearest homes first, and `covEdu = seated share · max(0.5, roadCov)`.
  Hospital beds arrive with sickness in M7.
- **Incidents**, rolled hourly per building (probabilities per hour):
  - Fire: `p = 0.00012 · (1 − 0.75·fireCov) · (abandoned ? 4 : 1) · (industry ? 1.5 : 1)`. Intensity
    starts at 0.05 and grows 0.004/tick; above 0.5 it spreads every 30 ticks to buildings within 14 m
    (`p = 0.06 · intensity · (1 − 0.5·theirCov)`); after 700 ticks at full intensity the building
    collapses to **rubble**, which clears after 36 h so the lot can regrow. The nearest station (by road
    time from the fire) with an engine at home dispatches it; at the scene it lowers intensity by
    `0.012·eff` per tick until the fire is out. Fires still unanswered are re-dispatched hourly.
  - Crime: `p = 0.0015 · (1 + 2·unemployment + 0.5·[low wealth] + 1.5·max(0, 0.5 − H)) ·
    (1 − 0.8·policeCov) · occupancy`. The nearest free patrol car is sent; if nobody arrives within
    420 ticks the crime raster rises around the building (+0.12, decaying every 3 h).
  - Emergencies: `p = 0.00004 · residents · (1 + 2·groundPollution)`; an ambulance is sent; if none
    arrives within 600 ticks a resident dies. Sickness proper arrives in M7.
- Service vehicles are sim entities with a route of road legs and progress, moving each tick at the
  segment's congested speed — traffic delays response. The renderer extrapolates them between frames.
- **Vehicle time.** One tick is a game minute, so a truck driving at real speed would cross the map in
  a few ticks (a blur on screen). Dispatched vehicles instead move `0.2 m per tick per m/s of road
  speed` (≈ 60 km/h on screen at 1×), and incident timings (fire spread, collection rounds) are tuned
  in ticks to match. Commute times used for happiness stay realistic. (The Cities: Skylines approach:
  the clock runs faster than the cars.)

### 3.8 Traffic, commuting and employment

One mechanism does job matching, shopping, traffic and transit (every 2 game hours):

1. **Origins** = road nodes with residents attached (buildings attach to the nearer end of their segment).
   Each round processes origins in a rotating order (fairness).
2. For an origin, a Dijkstra over **rush-hour travel times** visits job and shop buildings in order of
   time; workers fill open job slots nearest-first up to `maxCommute` (30 min), shoppers fill shop
   capacity within 15 min.
3. **Trips → roads.** Each job assignment of `n` workers makes `n · 2 · 0.9 / 1.2` car trips (there and
   back, car share, occupancy; shopping 0.5 trips per resident). The Dijkstra records predecessor edges;
   loads at the destination nodes are pushed back along the search tree in reverse settle order, adding
   to each segment's next volume. Each building's own street gets its trips too.
4. **Freight**: industry makes `0.12` truck trips per worker per day and ships to the nearest shops that
   need goods (`0.06` per commercial job); the rest is exported via the highway, and shops still short
   import from it. One tree grown from the highway connection carries exports and imports. Trucks
   count 2.5 cars.
5. **Volumes** (state, daily PCU both directions) move towards each new assignment by successive
   averages: `vol += 0.2 · (next − vol)`, which settles route choice within a game day.
6. **Travel time** per segment at `share` of the rush-hour peak:
   `t = t0 · (1 + 0.15·(v/c)^4)` (capped at 8×) `+ 600 s · max(0, 1 − c/v)` with
   `v = vol · 0.25 · share` and `c` = capacity (× 0.8–1.0 for road maintenance). The second term is the
   average wait in a queue that builds through the rush hour at an oversaturated bottleneck, so a narrow
   link between homes and jobs costs minutes, not seconds.
7. **Rush hours**: an hourly profile (peaks 08:00 and 17:00, night ≈ 5 %) scales the instantaneous
   congestion used by service vehicles, visible cars and the traffic map; commute times (happiness)
   use the peak. Service vehicles route over the current hour's congested times.
8. **Visible vehicles**: each round keeps ~320 sample trips (weighted reservoir sampling on the traffic
   RNG stream) with their road legs and purpose (work, shop, freight, export, import). The client
   spawns cars and trucks along them in proportion to `√(daily trips) · share(hour)` (capped at 360),
   commuters outbound in the morning and homebound in the evening, driving at each road's congested
   speed. Clicking one shows its trip and highlights its route. Nothing here feeds back into the sim.
9. **Buses**: a depot (civic building) and stops (snapped to roads). Each stop belongs to the depot
   that reaches it soonest; each depot runs its buses round one loop through its stops, nearest-first
   from the depot, with 20 s dwell per stop. For a commuter whose origin and job nodes both lie within
   360 m of stops on the same loop: `bus = walk + headway/2 + ride (rush-hour speeds) + walk` and
   `busShare = 0.7 · load / (1 + e^−((car + 300 − bus) / 240))` (300 s of parking and hassle saved).
   Riders don't drive; buses add `passes · 2.5 PCU` spread over the day. If riders exceed what the
   buses carry in the peak hour, `load` (state) scales the share down next round.
10. **Road upgrades** change a segment's type in place for the cost difference; zone cells keep their
   indices and slide with the new width, so buildings move with the road. **Bridges**: streets and
   wider cross up to 360 m of water on a deck 6 m above it, with 8 % ramps (~68 m) on dry land at each
   end; bridge metres cost 6× and upkeep 3×. The deck profile is a pure function of the curve and the
   terrain, shared by the planner and the renderer.
11. Service coverage (§3.7) stays on free-flow times so the coverage maps are stable; actual responses
   are slowed by traffic through the vehicles' congested speeds.

### 3.9 Happiness

Per building, `H = clamp(0.55 + Σ contributions, 0, 1)`; each contribution is stored as a named
factor for the inspector (e.g. "No water: −30 %").

| Factor | Residential contribution |
|---|---|
| Power / water / sewage | −0.28 / −0.28 / −0.15 · (1 − served); polluted water −0.10 |
| Garbage | −0.15 · clamp((garbage − 10) / 30, 0, 1) |
| Fire / police / health / education | +0.05·cov − 0.06·(1 − cov)·expect[w] each |
| Parks & amenities | +0.10 · parkCov (+ landmarks, policies) |
| Commute | +0.06 at ≤ 8 min, linear to −0.12 at ≥ 25 min |
| Jobs | −0.15 · unemploymentRate(b) |
| Shopping | +0.04·shopAccess − 0.06·(1 − shopAccess) |
| Air / ground pollution | −0.20·air·sens[w] / −0.10·ground |
| Crime | −0.15 · crime (businesses ×0.7) |
| On fire | −0.30 |
| Taxes | −0.015 · (rateR[w] − 9) · taxSens[w] |
| Sickness | −0.20 · sickFraction |

`expect = [0.6, 1.0, 1.5]`, `sens = [0.8, 1.0, 1.4]`, `taxSens = [1.4, 1.0, 0.8]` (low/med/high).
Wealthier residents pay more and expect more: that's the core tension. Businesses weigh fire and
police at `+0.03·cov − 0.04·(1 − cov)·expect[w]`; shops like parks at half the residential effect.
Commercial: utilities, customers, workers, goods, crime, fire, taxes. Industrial: utilities, workers, freight access, fire,
taxes. **Approval** = 85 % resident-weighted residential H + 15 % job-weighted business H.

### 3.10 Land value and wealth

Raster (16 m), recomputed every 3 h and eased (`LV += 0.25·(target − LV)`), then 3×3 blurred:

```
target = 0.30 + 0.15·waterfront + 0.07·view + 0.05·trees + 0.20·(neighbourHappiness − 0.5)
       + civic effects (parks +0.12…0.20 within 110–240 m, library +0.06; plants, landfills negative)
       + 0.12·avgServiceCoverage (blurred)
       − 0.08·industryNuisance − 0.06·abandonedNearby − 0.20·ground − 0.20·crime
```
(Air pollution joins in M7.)

Wealth that moves in: `LV < 0.40` low, `< 0.70` medium, else high. Happy buildings in a higher-LV
area redevelop to the higher wealth (gentrification); decline lowers it.

### 3.11 Environment, health and education

- **Wind**: a prevailing direction from the map seed, wobbling ±20° over five months
  (`windAngle(seed, tick)`, a pure function, so nothing is saved).
- **Air pollution** raster (16 m), every 3 h: sources (industry by tier `[0.03, 0.01, 0.0015]` per lot
  cell × occupancy, plants and incinerators `1.1 × airPollution`, traffic `3e-7 × PCU` per metre of
  road) → move the field 2.5 cells downwind (semi-Lagrangian, bilinear) → diffuse (0.22) → decay ×0.95 →
  trees absorb up to 30 % per update, parks up to 50 % within their grounds. The plume from a coal
  plant is ~0.3 at the stacks, ~0.1 some 150 m downwind.
- **Ground pollution**: industry, landfill, sewage outflow, unserved sewage; slow spread; decays ×0.994.
- **Sickness**, hourly per home: `new = healthy · (0.0004 + 0.015·air + 0.003·ground + 0.004·polluted
  water + 0.002·garbage)`. Clinic and hospital beds (funding-scaled capacity) go to the nearest sick
  first by road; recovery is 25 %/h in a bed and 5 %/h without; 0.4 %/h of the untreated sick die.
  Moods: `−1.5 × untreated share` and `−0.2 × air × sensitivity[wealth]`; 15 % of pollution-driven
  cases need an ambulance.
- **Education**: pupils are 10 % / 6 % / 4 % of residents at primary / high school / university; each
  school fills its level's seats nearest-first (libraries count as primary seats). A home's average
  education moves 0.4 %/h towards `0.3 + 0.7·primary + highSchool + university` (seated shares);
  newcomers arrive at 0.5. Shares educated to ≥ 1 and ≥ 2 come from the average
  (`(e − 0.3)/0.7` and `e − 1`, clamped). The workforce (by employed residents) sets which industry
  tier grows or retools (2 %/h per building): manufacturing with ≥ 40 % at level 1, high-tech with
  ≥ 30 % at level 2 and land value ≥ 0.4; offices (high-wealth commerce) need ≥ 20 % at level 2.
- Air pollution lowers land value (`−0.3 × air`). Problem icons show untreated sickness and smog.

### 3.12 Disasters (M9)

Fires are always on (§3.7). The optional disasters live in `sim/systems/disasters.ts` as saved state
(`disasters`, `roadDamage`, `craters`, `civic.damage`/`flooded`, `building.flooded`; save v8) and draw
only on the `disasters` RNG stream, so they replay exactly. Each disaster keeps its parameters (point,
start/end tick, size, heading, seed) and its motion is a pure function of them and the tick, so the
client animates it between frames with the same maths (`tornadoAt`, `floodLevel`, `impactTick`).

- **Earthquake** (magnitude 5.6–7.4, skewed low): radius 120 + 220·(M − 5) m. Intensity falls off as
  (1 − d/R)^1.3. Buildings collapse with chance 0.6·I² (more for tall, abandoned or unfinished ones),
  otherwise catch fire with 0.12·I; roads within 70 % of the radius crack (0.7·I, closed 6–24 h);
  civic buildings go offline (0.7·I, 8–24 h). The camera shakes for the 20 ticks it lasts.
- **Tornado**: touches down and heads for the city centre (±0.4 rad), 28 m/tick for 45–70 ticks with a
  lazy sideways wobble; every tick, buildings within its half-width (18–32 m) are destroyed (35 % in
  the core, 10 % at the edge), civics hit go offline 36 h, roads get debris (8 h), trees are flattened.
- **Flood**: needs open water within 320 m. The peak level is 1.8 m above the typical land within
  150 m of the water near the source (4–13 m): water rises over 4 h, holds 10 h, drains over 8 h,
  within 520 m of the source. Anything whose ground is below the level is under water: homes and
  businesses close (mood −0.5) and may be wrecked after 3 h (5 %/h low density, 2 % otherwise), civic
  buildings are out of action, and roads with any stretch under water are impassable.
- **Meteor**: a 30-tick warning while it falls, then everything within the crater radius (28–48 m) is
  flattened (a civic building hit squarely is destroyed and must be rebuilt), fires start out to 2.2×
  the radius, roads in the crater close for 72 h and a scorched crater stays for 60 days.

Consequences reuse the existing systems: collapsed homes with people inside raise ambulance calls,
fires go to the fire service, and closed roads (damaged or flooded) are left out of the routing
graph, so commutes, service coverage, utilities and buses route around them until repaired. Whether a
place is linked to the highway at all uses the network as built, so a temporary closure doesn't mark a
neighbourhood as cut off. Offline civic buildings supply nothing (`civicOnline`). Repairs count down
hourly and are paid when done ('Disaster repairs': half a road's build cost, a quarter of a civic
building's). Recovery: rubble clears after 36 h (or bulldoze it), and abandoned buildings nobody moves
back into crumble after four days, so lots regrow as demand returns. Random disasters strike about
once per 30 game days once the city has 1,500 residents, and can be switched off (`setDisasters`); the
disasters menu can set any one off at a chosen point whatever that setting.

### 3.13 Progression and specialisations (M10)

- **Milestones** (`data/progression.ts`): Hamlet 0 → Village 800 → Town 2,000 → Large town 5,000 →
  Small city 10,000 → City 20,000 → Large city 40,000 → Major city 70,000 → Metropolis 100,000. Every
  unlockable (civic buildings, road types, zone densities, modules, policies, loans) has its
  `unlockPopulation` on one of these, so each milestone brings a batch (`data/unlocks.ts` lists them
  for the UI). Unlocks follow `progress.peak`, the highest population ever reached, so they stay if
  the city shrinks; each milestone is announced once (banner, fanfare, notification). The unlock-all
  cheat unlocks things to build, not zone densities, which follow the city's own growth (sandbox
  mode unlocks everything).
- **Policies** (`data/policies.ts`): a monthly cost (base + per resident, the 'Policies' ledger line)
  and one effect applied where that system lives: fire safety halves outbreak risk, free buses make
  the bus 5 min "quicker" in the mode choice, recycling cuts garbage 25 %, neighbourhood watch cuts
  crime 25 %, healthy living cuts sickness 30 %, clean industry grants cut industrial pollution 40 %,
  the high-rise ban caps growth at medium density, the tourism campaign brings 50 % more visitors.
- **Service modules** (`data/modules.ts`): one-off cost, extra upkeep, and extra engines / patrol
  cars / ambulances, beds, seats or buses on the building they're added to (each once). The systems
  read `civicVehicles/Capacity/Buses/Upkeep(c)`; the model gets a small annex per module.
- **Tourism**: landmarks (clock tower, observation wheel, glass conservatory, sky needle, grand
  arch; one of each) draw visitors a day × funding × appeal (0.6 + 0.4 × approval) × campaign; hotels
  host up to 45 % of them overnight. Day trippers spend $3, overnight guests $10 ('Tourism' line), and
  visitors lift commercial demand (up to +0.25).
- **Trade**: ore mines and oil wells must stand on a deposit (mean richness ≥ 0.2 under the
  footprint; choosing one opens the resources map). They extract `perDay × richness × remaining`
  units (falling to 20 % as the deposit runs down) and sell them ('Ore and oil sales'). A freight
  terminal earns $0.6 per industrial job a day ('Trade and exports'; a second adds half) and lifts
  industrial demand by 0.12 each (two at most).
- **Technology**: a research park (needs a university) lowers high-tech industry's education bar
  (workforce share 0.3 → 0.2, land value 0.4 → 0.3) and earns $1.2 per high-tech job a day
  ('Research licences').
- **Achievements** (`data/achievements.ts`, checks in `systems/progress.ts`): twelve goals checked
  hourly (none in sandbox mode), from a first road to a metropolis, including a comeback after a
  disaster that flattened ten buildings.

### 3.14 How the systems feed each other

```
         taxes ─────────────┐                  ┌──────────── land value ◄── parks, water, services
                            ▼                  ▼                               ▲       │
 zoning ─► lots ─► GROWTH ◄─ DEMAND ◄── employment/shopping ◄── TRAFFIC ◄──────┼───┐   │ wealth
            ▲        │         ▲             (matcher)            │  congestion  │   │   ▼
            │        ▼         │                                  ▼              │   │ RESIDENTS
            │    buildings ────┴──► ECONOMY ◄── upkeep ◄── services, utilities   │   │   │
            │        │                 │                        │               │   │   │
            │        ▼                 ▼                        ▼               │   │   ▼
            │   UTILITIES, SERVICES (road coverage, capacity) ──► HAPPINESS ─────┘   │ approval
            │        │                                             ▲    ▲            │
            │        ▼                                             │    │            │
            │   pollution (wind) ──► sickness ──► health ──────────┘    │            │
            │   crime ◄── unemployment, low happiness ──────────────────┘            │
            └── decline / abandonment ◄── unhappiness, unmet needs ◄─────────────────┘
```

### 3.15 Road grading and earthworks (M13)

Roads no longer drape over the raw ground. `world/grading.ts` gives each dry-land piece a vertical
profile sampled every 4 m:

1. The ground along the centre line is averaged over 40 m (the window narrows symmetrically at the
   ends), so short bumps are shaved off rather than followed.
2. Ends that join an existing road (or an earlier piece of the same road) are pinned to its height;
   a new dead end is free. If two pinned ends are further apart in height than the type can climb
   over the length, the piece fails ("make it longer, or wind it up the slope").
3. The profile is the one within the type's grade limit (`RoadType.maxGrade`: dirt 20 %, street
   16 %, avenue 12 %, boulevard 8 %) that strays least from the smoothed ground: a bisection on the
   worst cut, with fill held to 8/14 of it, finds the smallest tolerance for which a forward pass of
   reachable heights (grade-limited, inside the pins' band) stays non-empty; a backward pass then
   picks the height closest to the ground at each sample. If that needs a cutting deeper than
   14 m, a second fit lets fill run tall instead (a viaduct beats an impossible cutting).
4. Samples more than 8 m above the ground are carried on a viaduct (stored on the segment as
   `deck`, drawn and costed like a bridge; not at a road's end, not for dirt roads, at most
   `BRIDGE.maxSpan`). A cutting deeper than 14 m fails with the ground's steepness, the limit and
   the fix. Pieces over water keep the M6 bridge rules.

`world/earthworks.ts` turns profiles into terrain edits. Each height sample within reach of the
road is claimed by the nearest piece: out to the road's half-width plus a 1.5 m shoulder plus a
bench (2 m per metre of cut or fill nearby, up to 8 m, so that in a cutting or on an embankment
the road, draped on 8 m samples, comes out flat across and the first lots are level) it is set to
the profile; beyond, side slopes run back to the natural ground, 1:1 in cuttings and 1:3 on
embankments (gentle enough that lots on them stay buildable). Changes under 0.25 m are skipped,
so a road at grade leaves the ground beside it alone and costs nothing extra. Water, other
roads' corridors (road + shoulder), ground beyond an end that joins another road, samples under a
viaduct, and ground under buildings that stay are left alone. Earth moved costs $0.40 per cubic
metre, part of the road's price (not refunded by bulldozing). Civic buildings whose footprint
varies by more than 1 m get a level pad at the height where they meet their road (4 m margin,
same side slopes, same price); beyond 12 m the site is too steep.

Edits are written as `terrainDelta` in whole centimetres (height = seed terrain + delta, computed
the same way live and on load, so saves and undo are exact) and sent to the client as `FrameDiff.terrain`. After any edit
the sim re-seats buildings and civic buildings (highest ground under their corners and centre),
clears trees on ground that moved more than half a metre, forgets bridge decks and the water
distance / land-setting cache, and rechecks zone cells there (a lot on a steep cut face loses its
zoning). The client rebuilds the terrain chunks (tinting cut faces earth-brown, embankments fresh
green), roads, zone cells and trees in the box. Undo records keep the deltas they replaced. Road
upgrades regrade to the new type between the road's two junctions, or say why they can't.

### 3.16 Undo, redo and moving buildings (M14)

`history.ts` keeps the last 30 actions. `Sim.dispatch` brackets each undoable command
(`buildRoad`, `zone`, `bulldoze`, `placeBuilding`, `moveBuilding`, `addModule`, `upgradeRoad`,
`placeStop`) with two captures of what it can touch: the entity maps (buildings, civic buildings,
vehicles, incidents, road nodes and segments, lots, bus stops, traffic and damage entries), the
terrain delta and tree rasters, a few values (the id counter, the random generators, the burning
list, bus ridership) and the treasury and this month's ledger. Zoning captures lots only. The diff
between the captures is the edit: per entity, whole (added or removed) or per changed field, and per
changed element of typed arrays (a lot's zone, validity and building cells; terrain samples), plus
the key order of any map the command reordered, and the money as deltas per ledger line.

Undo applies an edit backwards, redo forwards. First every structural change is checked against
the state (roads and lots, a building's type and place, a civic building's place and add-ons, bus
stops, the ground): if any differs from what the edit left, nothing is applied and the reason is
returned ("Can't undo the road: buildings have grown or lots have changed there since"). Then each
change is applied; volatile ones (residents, vehicles, trees, generators) only where untouched
since, and a zone cell isn't taken from under a building that grew there since. Map order is
restored, money booked back on its lines, and the sim re-indexes what changed (road network
derived data, spatial hashes, heights from the terrain delta, caches) and marks it dirty for the
client. Edits of one zoning drag (same `stroke`) merge into one step; a new action clears redo.
History is not saved (save v13 dropped the old undo list), and the state hash covers the city only.

`moveBuilding` moves a civic building: the same placement check as a new building of that kind
(ignoring itself and unlocks), a fee of 10 % of its price (at least $250) plus earthworks for a
level pad, then `Sim.relocateCivic` updates its pose and access, re-indexes it, rechecks the lots
at both ends, and returning vehicles are re-routed to the new site.

---

### 3.17 City history (M16)

`SimState.chronicle` (`src/sim/systems/chronicle.ts`): ten figures recorded as each month closes
(population, approval, jobs, unemployment %, treasury, the closed month's income and spending from
the ledger, resident-weighted air pollution and crime %, average commute minutes), summed into a
bucket of `step` months and pushed as its average. When a series reaches 240 points, neighbouring
pairs are averaged and `step` doubles, so the whole life fits in ≤ 240 points per figure (monthly
for 20 years, then 2 months a point to 40 years, 4 to 80, and so on). Milestones and disasters are
appended as events (`{tick, kind, ref}`, at most 300). It is saved and hashed with the rest of the
state (save v14; a v13 city starts an empty history at its current tick). The client reads it with
the `chronicle` query; `src/ui/History.tsx` charts it with `TimeChart` (`src/ui/charts.tsx`).

### 3.18 Big projects and elections (M17)

**Projects** are civic defs with a `project` block (`src/data/projects.ts`: stages with months and
cost, requirements, perk text and perk numbers), appended to `CIVIC_DEFS` with category `project`.
Placing one (`placeCivic`) pays `placementPrice` (the first stage) and sets `Civic.build = {stage,
months, waiting}`; `civicOnline` is false and `civicUpkeep` 0 while `build` is set, so every system
that reads civic output or service ignores a site for free. `projectsMonth` (month close) counts
months on the current stage and, when it's done, pays the next stage from the treasury (ledger line
`projects`) or sets `waiting`; after the last stage it deletes `build`, marks the civic changed and
records a chronicle event. Requirements are checked in `checkPlacement` via `projectBlocked`
(population peak, education shares of the workforce from `totals.eduWorkforce`, visitors, a running
civic). Scheduled perks run in `projectEvents` at month close: the stadium's match day
(`SimState.matchDay = {civic, until}`) is read by totals (approval), specialisations (visitors) and
the freight/visitor loads in `commute.ts` (fans as `event` trips from the highway to the stadium);
the launch complex's launches are events only. Static perks are plain numbers read by the systems
that already handle them (power output, tourism draw, demand factors, research income). Models per
stage are in `src/render/assets/projectModels.ts`; `CivicData.stage` keys the model cache.

**Elections** (`src/sim/systems/elections.ts`, `src/data/elections.ts`): `SimState.election =
{nextMonth, promises, results, term}` (save v15). `electionsMonth` opens the campaign six months
ahead (an event) and holds the vote at `nextMonth`: `projectedShare` (approval, plus or minus each
promise kept or broken, measured by `promiseKept` against the baseline stored when it was made) plus
a seeded swing from the events stream. A result sets `term` for 12 months: a win adds the grant
(ledger `grants`) and approval via `honeymoon`; a loss makes `setTax` refuse rises and `takeLoan`
refuse loans until `term.until`. `nextMonth = -1` means no elections (sandbox, or switched off by
`setElections`). The summary for the UI is `CityStats.election`.

### 3.19 Scenarios (M18)

A scenario is data (`src/data/scenarios.ts`): the starting city as a save in `public/scenarios/`,
goals (a measure with a `min` or `max` and months it must `hold`), limits (forbidden civic buildings
or zones, no loans, a tax cap), a time limit in months, two star rules (win within so many months,
or with a bonus goal met on the day) and whether disasters and elections are on. The measures are the
city history's monthly figures (population, approval, jobs, unemployment, treasury, income, spending,
air pollution and crime at homes, the average commute) plus the month's net, visitors, abandoned
buildings, loans owed, a big project open, and an election won since the start.

`SimState.scenario` (save v16; a v15 city has none) holds the id, start tick, status, stars, end
tick, reason and each goal's months held. `startScenario` begins it on the loaded city (setting
disasters and elections as the scenario says). `scenarioMonth` runs at month close after the ledger,
history and elections: each goal's held count goes up or back to 0, every goal at its hold wins
(stars from the rules), and the first month close at or after the deadline (start plus the months,
rounded up to a month close) loses. Bankruptcy and, where `mustWinElection`, a lost vote lose at
once. Limits are checked in `dispatch` (`scenarioForbids`) before the command: placement, zoning,
loans and taxes. `CityStats.scenario` carries the goals panel's summary, worked out once a game hour.

Starting cities are built by `scripts/scenarios.ts` from recipes in `scripts/lib/scenarioCities.ts`,
most with the balance tool's mayor (`scripts/lib/mayor.ts`, which can take over a city it laid out
with `adopt()`), two with purpose-built layouts (Gridlock, Smokestack Valley). The client boots
`?scenario=<id>` by fetching the save, loading it and dispatching `startScenario`; progress (best
stars and months per scenario) is in localStorage (`src/client/scenarioProgress.ts`); the screens are
in `src/ui/Scenario.tsx`.

## 4. Rendering

- **Scene**: WebGL2 renderer, ACES tone mapping, sRGB. Hemisphere + directional sun (PCF soft shadows,
  shadow camera fitted around the view target and sized by zoom) + small ambient. Gradient sky dome
  shader with sun disc and stars; fog matches the horizon colour. Day/night drives sun direction and
  colour, sky colours, window emission and street lights.
- **Terrain**: buildable area as 8×8 chunks (32×32 quads each) with vertex colours (grass hues from
  noise, sand near water, rock on slopes); scenery ring at lower resolution. A shader hook samples the
  active overlay texture (data maps) and draws the buildable-area border.
- **Water**: one large plane at `y = 0` with a shader: depth from a height texture (shallow tint,
  shoreline foam), procedural ripples, sky reflection tint.
- **Trees**: 3 species, instanced per 256 m chunk (frustum-culled), placements hashed from the tree
  grid; trees under roads/buildings are filtered out on change.
- **Roads**: per-segment ribbon meshes (asphalt + sidewalk + markings via vertex colour and a tiny
  procedural texture) draped on terrain with polygon offset; intersections as fans; merged per chunk.
- **Buildings**: `AssetRegistry.get(key)` returns a procedural geometry built from parts (walls with
  window grids, pitched/flat roofs, parapets, awnings, signs, chimneys) seeded by variant; vertex
  attributes: colour, emissive-window mask, baked AO. Completed buildings are merged per 128 m chunk
  (rebuilt incrementally, ≤ 2 chunks per frame); buildings under construction and burning ones are
  individual meshes with scaffolding/flames. The registry can later return glTF-loaded geometry.
- **Vehicles**: instanced meshes per vehicle class; matrices updated in place (no per-frame allocation).
  Visible traffic follows the sim's sampled trips (§3.8); cars carry head and tail lights (one additive
  point system) after dark.
- **Pedestrians** (close zoom, camera distance < 420 m): up to 240 instanced figures walking the
  sampled *short* trips (shop ≤ 1.2 km, work ≤ 0.9 km) along the pavement of their route, at walking
  pace on the vehicles' time scale. Clickable like cars; the inspector shows the trip.
- **Street lights**: lamps every 34 m along every street/avenue/boulevard (alternating sides), rebuilt
  when the network changes. Heads glow and additive light pools (polygon-offset quads, no real lights)
  appear as night falls; lit windows come from the buildings' emissive mask.
- **Building variety**: detached homes in four styles (classic, L-shaped, modern flat-roofed, cottage
  with dormer) with gardens, trees, fences, driveways and parked cars; shops as corner stores, cafés
  with terraces or mini-markets behind a car park; brick walk-ups with pitched roofs and roof gardens;
  heavy industry as saw-tooth sheds, barrel-roofed warehouses with container yards, or tank farms;
  high-tech campuses with glass drums. `scripts/dev/gallery.mjs` screenshots every archetype.
- **Overlays**: a 128×128 `DataTexture` per active data map, sampled by terrain and building shaders
  with a colour-blind-friendly ramp (viridis/cividis) and legend.
- **Picking**: a 2D spatial index of building oriented boxes walked along the view ray (no GPU picking).
- **Post** (optional, off by default): tilt-shift. After the scene renders, the finished frame is
  copied to a texture and blurred in two separable passes whose radius grows away from a focus band
  just below the centre, scaled by zoom (none beyond 520 m). Working on the tone-mapped frame keeps the
  look (and the custom shaders) identical with it on or off.
- **Audio** (`src/audio`): everything synthesised with Web Audio (noise buffers, oscillators, filters,
  envelopes), no samples. Effects: click (every UI button), build, place, zone, bulldoze, error,
  alert, good news, siren. The ambient bed has continuous layers (traffic rumble and tyre hiss, wind,
  fire roar) and scheduled events (bird trills by day, crickets at night, hammering and drills,
  sirens, fire crackle). `ambientScene()` summarises what's around the view centre four times a second
  (cars, buildings, construction, fires, emergency vehicles, tree density, zoom, night, paused) and the
  pure `ambientMix()` turns that into layer levels. Master/effects/ambience volumes and mute are
  player settings; the context starts on the first gesture and suspends when the tab is hidden.

### 4.1 Photo mode (M16)

`Game.enterPhoto()` (K or the toolbar's camera): the app renders only `PhotoMode.tsx`; the renderer
(`setPhoto`) hides the helper groups (icons, ghost and selection, route and coverage ribbons, zone
markings unless asked) and street labels; the camera (`CameraController.photo`) allows 2.5 m
distance, a near-level pitch and an eye-height target, and can `follow` a pose each frame (the
follow camera: heading from smoothed motion, player turns kept as an offset). The renderer lights
the scene at the photo hour and uses the photo field of view. When a lens effect or grade is on,
`PhotoLens` (`src/render/photo.ts`) draws the scene into a half-float MSAA target with depth and
runs two passes: a 48-tap spiral gather for depth of field (radius from relative distance to the
focus = camera-to-target distance) and tilt-shift (from the distance to the middle band), keeping
each pixel's blur radius (samples are clamped first, so a stray huge highlight in the HDR frame
can't bloom into a blob); then a light smoothing of blurred areas (the gather's grain), tone
mapping, the grade (tint, saturation, contrast, lift, vignette) and sRGB.
`GameRenderer.capture(scale)` redraws the frame at `scale` × the screen's physical pixels (capped by
GPU limits and ~36 MP) and copies the canvas to a PNG with `toBlob`, so only the 3D view can be in
the picture.

## 5. UI

Preact components over the canvas. All colours, type scale, spacing, radii and shadows are CSS custom
properties in `src/ui/styles/tokens.css`. Top bar (money, net income, population, date/time, speed,
RCI, approval), bottom toolbar by category with SVG icons and tooltips (cost, upkeep, effect, shortcut),
panels (budget, inspector, data maps, advisors, policies), notifications, debug panel (backtick),
menus.

- **Advisors** (`sim/systems/advisors.ts`, queried every 2 s): finance, utilities, safety, health,
  education, transport, environment and planning each read the live state and return findings with a
  severity (0 fine … 3 urgent), a concrete suggestion, the centre of the affected buildings or the
  worst road, and the data map that shows it. "Show me" flies there and opens that map.
- **Notifications**: sim events and newly urgent advice go into a log (repeats of a kind within a
  minute collapse into a count); at most one toast per kind every 20 s, and only the first new urgent
  advice of a refresh toasts. Entries fly to their place.
- **Resident thoughts**: a feed of short lines picked per game hour by hashing building ids (no RNG,
  so determinism is untouched), each voicing that building's strongest mood factor (sometimes the
  runner-up). Clicking one opens the building.
- **Street names**: client-side and not saved. Segments that carry straight on through a junction
  (same type, > 150°) are joined into one street; each street is named from its lowest segment id, so
  names stay put as the city grows. Neighbourhoods are named per 384 m cell. Labels follow the roads
  at close zoom (≤ 10, DOM); inspectors and advisors use addresses ("Maple Street, Northgate"). The UI reads `ClientWorld` via a small subscribe/selector hook and sends commands through
`SimClient`.

- **Game shell (M11)** (`src/ui/Shell.tsx`, state in `Game.mode`/`Game.screens`). A page opened
  without city parameters opens a small demo town (`public/demo.citybloom`, a save grown by the
  balance tool's careful player on the backdrop map; the bare map if it can't be read) running at
  normal speed with its notices silenced, the camera slowly circling it, and shows only the main menu: Continue (the newest save of any kind), New city, Load city, Settings.
  New city picks a name, one of the four presets (a 128² preview is drawn on a canvas by sampling the
  sim's own `TerrainGen`, so it matches the map exactly), a seed, difficulty, sandbox, random disasters
  and the tutorial, then reloads the page with those as URL parameters (`?new=1&seed=…`); a load is
  `?load=<slot>`. After booting either, the URL is reset to `/`, so a reload returns to the main menu
  rather than re-creating the city; tests and dev links keep using `?seed=…&paused=1` directly, which
  skips the menu. A loaded city opens paused; a save the worker can't read is reported back
  (`loadFailed`) and the page opens a fresh map with a toast rather than hanging. Reloading the page is the one way to swap worlds: the worker, renderer and mirror
  never need tearing down.
- **Pause menu**: Escape with nothing left to cancel (no drag, tool, selection or panel), or the ☰
  button. Any menu over a city pauses it (the previous speed returns on close), turns off camera keys
  and edge scrolling, and swallows tool shortcuts. Resume, Save (named slots, overwrite with a
  confirm), Quick save, Load, Settings, Export/Import, Quit to main menu (autosaves first).
- **Settings** (`client/settings.ts`, localStorage, validated field by field on load): graphics quality
  (pixel ratio cap 0.75/1/2, shadow map 1024/1536/2048, crowd share 40/70/100 % of cars and walkers),
  shadows, draw distance (fog ×0.65/1/1.5 and the tree low-poly distance 450/750/1200 m), tilt-shift,
  interface size (the `--ui-scale` root font size; every UI length is in rem, and `#ui[data-width]`
  size classes, computed from the viewport width in scaled rem, tighten the top bar on narrow screens or
  large interface sizes), edge scrolling, tips,
  volumes and mute, random disasters (this city and new ones) and the autosave interval (off/2/5/10 min
  of real time, into the `auto` slot; also on quitting). `Game.applySettings()` pushes them all to the
  renderer, camera, audio and CSS at start-up and on every change.
- **Tutorial and tips** (`client/tutorial.ts`): eight steps (welcome, road, homes, jobs, power,
  water/sewage, run time, keeping people happy); each step with a `done(game)` check ticks itself off
  (checked every 2 s), so a resumed tutorial skips work already done; the step's button pulses.
  Progress lives in settings, so it survives a reload. Contextual tips (no power, no water, deficit,
  unemployment, abandonment, no fire station at 400 residents, long commutes, first milestone) each
  show once, one at a time, never during the tutorial, and can be switched off.

## 6. Saves

`{format: 'citybloom-save', version, meta {name, population, date, savedAt}, state}`; typed arrays are
base64 in JSON; compressed with gzip (fflate) and stored in IndexedDB, one record per slot with a label:
`auto` (autosave), `quick`, and one per named save (`s<time><rand>`); imports get their own slot.
Export writes a `.citybloom` file (gzip JSON); import accepts it (or plain JSON) and opens it.
`migrations[v]` upgrades version v → v+1 on load. Round-trip is tested by state hash, including through
the main menu's Continue and an exported-then-imported file (e2e `m11-shell`).

### 6.1 Publishing, offline play and updates (M15)

- **Deploy.** `.github/workflows/deploy.yml` runs on pushes to `main`: `npm ci`, unit tests, then
  `npm run build` with `BASE_PATH` (Vite `base`) and `SITE_URL` (absolute share-preview URLs) from
  `actions/configure-pages`, and `BUILD_ID` = the commit; the `dist/` folder goes to Pages.
- **Offline.** `scripts/vite-pwa.ts` writes `sw.js` after each build from `src/pwa/sw.js`, filled in
  with every built file (minus source maps and the share image) and a version hashed from their
  contents. The worker precaches them (past the HTTP cache) under `citybloom-<version>`, answers
  every same-origin GET from that cache first (page navigations, with any query, get `index.html`),
  deletes older caches when it activates, and claims open pages. So the game opens offline after
  one visit, and a page always runs one version's files.
- **Updates.** `src/client/pwa.ts` registers the worker in built pages and checks for a new one on
  each visit, hourly and on returning to the tab. A new worker installs and then waits; the page
  shows "New version of Citybloom" with Reload, which autosaves a city in play, tells the waiting
  worker to take over (`skipWaiting`) and reloads on `controllerchange`. Saves (IndexedDB) and
  settings (localStorage) are outside the cache, so they carry over; save migrations handle format
  changes.
- **Install.** `public/manifest.webmanifest` (relative `start_url` and `scope`, so any base path
  works), icons in `public/icons` (SVG sources; PNGs from `scripts/dev/icons.mjs`), theme colour,
  Apple touch icon.
- **Share preview.** Title, description, Open Graph and Twitter card tags in `index.html`; the
  image is `public/social.jpg` (1200×630, from `scripts/dev/socialshot.mjs`), linked absolutely
  when the build knows its address.
- **First-launch graphics.** `src/client/graphicsCheck.ts`: on the first main menu, frames at the
  high preset are timed after a 1.5 s warm-up (at least 2.5 s and 8 frames, at most 9 s of visible
  time) and the median picks high (< 22 ms), medium (< 40 ms) or low; software renderers go straight
  to low and dual-core machines get medium at most. The pick is kept in the settings
  (`graphicsChecked`, `autoGraphics`) and shown in Settings, which can run the check again.

## 7. Testing and tooling

- Vitest unit tests for every system; scenario tests build cities by commands and run for years with
  per-tick invariants in test mode (no NaN/Infinity, no negatives, in bounds, money balances).
- Playwright e2e against a `--mode test` build served from `/Sim-Cities/` by `e2e/serve.mjs`, as
  on Pages (M15; the server can also switch to another build or drop every request, for the update
  and offline tests): builds a small town through the real UI, runs time, opens panels,
  screenshots presets into `docs/screenshots/`, fails on console errors.
- `scripts/bench.ts` (large city: sim tick ms, draw calls, triangles) and `scripts/balance.ts`
  (careful / greedy / neglectful strategies over 20+ years, CSV + ASCII curves).

## 8. Performance budget

- Sim: average tick < 1 ms and worst tick < 15 ms at 100k residents (sliced systems), so 3× speed
  uses < 5 % of a worker core on average and never stalls the worker for long. Met (M12,
  `scripts/bench.ts --big`): at 80–106k residents the average is 0.6–0.8 ms and each month's worst
  tick 9–14 ms. How: the hourly systems run on different minutes, commute matching is split over
  four ticks (a save completes a round in progress first, so a loaded city carries on identically),
  coverage is split in two with its cache rebuilt on a quiet tick, and land value and garbage
  dispatch were made cheaper without changing their results. Exceptions: the first hour after
  loading or founding a big city (cold caches and JIT, one-off ticks of 25–30 ms).
- Render: < 300 draw calls, < 1.5 M triangles at the default overview; no allocations in per-frame
  paths (vehicles, camera, animation); chunk rebuilds budgeted per frame. Measured on the ~100k
  benchmark city (`scripts/dev/bigshot.mjs`, M12): 288 draw calls at the whole-city overview, 156 at
  the city preset, 92 at street level. Triangles: 2.5 M at the overview, about half of it the shadow
  pass (over the 1.5 M target; per-building LOD would be the next step if the Mac check shows the GPU
  struggling). Zoned buildings merge per 256 m chunk and civic buildings per 512 m chunk (a chunk is
  rebuilt only when a building's look changes), roads and zone cells per 512 m, tree regions use
  low-poly models and cast no shadows beyond 750 m (3-D distance), and problem icons shrink and fade
  with distance.
