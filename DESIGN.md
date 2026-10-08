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
- **Big-city running costs** (`BIG_CITY` in `data/economy.ts`, Phase 2 review): above 30,000
  residents the upkeep of roads and buildings grows by a further 1/27,000 per resident (×2 at
  57,000), applied through `sim.upkeepScale()` with the difficulty factor, so a large city's surplus
  stays a choice between taxes, services and goals rather than piling up. The budget's overview
  shows the factor (`BudgetReport.bigCity`).

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

### 3.20 Traffic tools (M19)

**One-way roads.** `RoadSegment.oneway` (1: a → b, −1: b → a; save v17, absent means two-way) is set
when a road is drawn one-way (`buildRoad.oneway`) or later by `setOneWay` (free; ramps can't be made
two-way), and kept when a crossing road splits it. The road graph gives the wrong-way edge an
infinite cost, so Dijkstra, `routeBetween` and every system that routes skip it. A one-way road's
capacity is `TRAFFIC.oneWayCapacity` (1.25) × its type's. Where one-ways exist the graph also keeps a
reverse adjacency: commute matching sends half of each trip's load out along the forward tree and
half back along a reverse search (`Dijkstra.runReverse`), so the way home may differ from the way
there, and trip samples carry `back` legs for the visible cars; freight exports route the same way.
Without one-ways nothing changes.

**Junctions.** A node where three or more roads meet is a junction with its own capacity:
`JUNCTION.plainShare` (0.5) × half the capacity of its approaches (every car uses two of them), or
`roundaboutShare` (0.85) on a roundabout. Its volume is half its approaches' traffic; the delay to
get through at `share` of the rush hour is `base × slowdown(v/c)` plus, over capacity, the same
queue term as a road (`queueSeconds`, 300 s × (1 − c/v)); `base` is 3 s, or 4 s on a roundabout.
`congestedEdgeCosts` adds the delay of the node each edge arrives at, so commutes, service vehicles
and routing all see junctions. Nodes where the city highway meets only ramps (merges) and bends are
free. **Roundabouts** are `RoadNode.roundabout` (the ring's centre-line radius, 12–40 m, by default
just enough for its widest road): `roundabout` puts one on a junction, or on a road (split there);
it needs every approach long enough to meet the ring, no other road or civic building across it
(zoned buildings are cleared) and room from other roundabouts; roads can join it later from far
enough out but not cross its ring, and zone cells stay off it. `removeRoundabout` refunds a share.
Costs are 40 $/m of ring.

**The city highway** (`motorway`, "City highway": 6,000/h, 90 km/h, 5 % grade, unlocks at 10,000) and
**ramps** (`ramp`: one lane, 1,500/h, always one-way as drawn) have `access: false`: no zone blocks,
no civic entrances or bus stops, no roundabouts, and they can't be upgraded to or from local roads.
The planner refuses a junction that mixes the highway with a local road (`roadClass`), except at
the regional highway's end (the interchange); ramps meet the highway at down to 8° and may run beside
it for 200 m. **Grade separation**: when a new road crosses the city or regional highway, or any road
on a viaduct at least `GRADE_SEP.clearance` (7.5 m) above the ground, the planner records a
`Crossing` on the piece instead of splitting both roads. Passing over, the grading gets a floor
(`GradeLimit.min`: the lower road's surface + 7.5 m, forced onto a deck over the lower road's corridor
plus a margin) with its slopes at the road's grade limit; passing under, a ceiling. The fit holds
those heights however far they stray from the ground, earthworks never touch the other road's
corridor, the deck is saved as the segment's viaduct heights (M13), and the clearance check skips
the stretch where the two corridors overlap. Nothing here is road-specific: rail (M20) reuses the
crossings, limits and decks.

**Tools and UI.** The road tool gains One-way (click a road: two-way → one way → the other way) and
Roundabout (click a junction or road; drag out to size the ring) modes, and a draw-one-way toggle
(O). Clicking a road selects it (`Selection.kind` 'road'): the road inspector shows its traffic,
rush-hour load and capacity, a direction switch, and each end's junction with its load and a button
to add or remove a roundabout. The traffic map shades junctions and roundabouts as discs by their
own load (`ClientWorld.junctionVC`, mirroring the sim) and puts chevrons on one-way roads and ramps;
tints follow flyover decks. Advisors flag the worst plain junction over capacity (suggesting a
roundabout) and, past 10,000 with a main road jammed and no highway, a bypass; tips cover both.

**Visible cars** (`src/render/traffic.ts`) move in short steps: each keeps `SPACING` (7.5 m) behind
the car ahead in its lane (road, direction, lane), waits at the end of a road while the next one is
backed up to its start, and at a junction waits while another approach's car holds it (a claim of
4 ticks); at a roundabout it gives way to cars about to pass its entry, then drives round the ring
anticlockwise at 25 km/h and leaves where its next road begins. One-way roads and ramps spread cars
across their lanes. Walkers keep to a roundabout's footway. The renderer reports the cost per frame
(`renderStats.trafficMs`).

The done-criterion tests are town-scale: `tests/junctions.test.ts` grows the crossroads town
(`tests/junctionTown.ts`: homes north and west, jobs south and east, one crossroads between) and
compares the same city with and without a roundabout; `tests/highway.test.ts` does the same for a
bypass round a main-street town (`tests/bypassTown.ts`). The Crossroads scenario is the first town.

### 3.21 Rail (M20)

**Track.** Railways are network segments of type `rail` ("Railway": two tracks, 110 km/h, 3.5 %
grade, 100 m minimum radius, $70/m, unlocks at 5,000) and `mainline` (the regional link, not
buildable); `isRail` covers both. They are drawn, graded, bridged and put on decks like roads, and
cross the city highway or roads on viaducts through M19's crossings and grade limits; the planner
chains grade limits across a stroke's internal joints so a long straight run reaches its bridges.
`RoadGraph` takes a `kind`: the road graph leaves railways out, `Sim.railGraph()` has only them, and
`Sim.tramGraph()` only roads with tram track. A railway can't be made one-way or carry a roundabout,
and railways can't join roads at existing nodes. **Level crossings**: a dirt road, street or avenue
drawn across the middle of a railway (both new ends off the track) splits both at a shared node,
junction kind `crossing` (capacity `JUNCTION.crossingShare` 0.8 of a plain junction's, delay
`crossingDelay` 8 s for cars); bigger roads must pass over or under. Railway joints and switches
have no junction polygon: the tracks run on into each other.

**The regional railway.** `SimState.railway` (save v18) holds the link: a `mainline` segment from the
regional highway's line to the west edge at x = 24, 260–700 m north or south of the highway's link,
on the flattest dry stretch clear of roads and buildings (`Sim.buildRailway`). New cities get it at
creation; older saves get one on load where it fits (`railway` undefined → laid; null → none fits).
It is drawn off the map as a north–south line beside the regional highway, joined by a curve.

**Stations and train lines.** A station (`CivicDef.rail`, `track: 'rail'`) faces a railway. Every
station on one connected stretch of track makes one line (`trainLines`): ordered by running time
from the station farthest from the first, trains shuttle end to end at `RAIL.speedShare` (0.7) of
the line speed, standing `RAIL.dwell` (40 s) at each. Trains = 1.5 per station × transit funding,
but no closer than `RAIL.minHeadway` (300 s) apart; capacity 480 a train. Lines carry `stopPos` and
`stopDist` (metres along the line to each stop) as well as bus-style times. **Mode choice**
(`busTime`) weighs every line: walking reach is `TRANSIT.walkRadius` × 1.6 for stations (× 1.15 for
tram stops), and a train ride counts `RAIL.trainBonus` (150 s) better than the same time on a bus,
a tram `TRAM.bonus` (60 s). Riders per stop (`Sim.stopUse`) and per line are recorded each
assignment round (stops per line are not saved; line riders are).

**Trams.** `RoadSegment.tram` marks tram track on a street, avenue or boulevard (`ROAD_TYPES.tram`):
`setTram` lays it (`TRAM.trackCost` $45/m; `trackUpkeep` 0.04 $/m a month, booked with road
upkeep) or takes it up (free); a drag lays a line as one undo step (`stroke`, like zoning). Splits,
merges and upgrades keep it; an upgrade to a type without it is refused. A **tram depot**
(`CivicDef.tram`: 5 trams of 140) must face a tracked road. **Tram stops** are `BusStop.tram`, on
tracked roads (they follow the track and go when it does). `loopLines(sim, 'bus' | 'tram')` builds
both kinds of loop: stops go to the depot that reaches them soonest; trams route on the tram graph
and feel `TRAM.trafficShare` (0.5) of the road's congestion, stand 25 s at a stop, run no closer
than `TRAM.minHeadway` (120 s) and add `TRAM.pcu` (2) per pass to their roads' traffic.

**Rail freight.** A rail freight terminal (`CivicDef.railFreight`, 700 truckloads a day) faces a road
and needs a railway within `RAIL.sidingReach` (30 m) of its back (`railSiding`), linked to the
regional railway (`railTerminals`: same rail-graph component as the link). In the freight step of the
assignment (`railFreight` in `commute.ts`), each terminal runs a search from its road entrance seeded
with `RAIL.freightHandling` (20 s); every export or import load whose node reaches the terminal
sooner than the highway sends its trucks there instead (up to the terminal's capacity), with trip
samples for visible trucks; the rest drive to the highway as before. `Sim.railFreight` records each
terminal's truckloads a day. Terminals count as freight hubs for industrial demand and trade.

**Client.** `TransitData` lines carry stop distances, headway, capacity, load and riders, plus riders
per stop (`use`) and each shipping terminal's track from the regional link (`freight`). Visible
trams and trains (`src/render/railVehicles.ts`) run a timetable per line on the display clock
(directions × stops × dwells) as consists whose cars follow the path: trams (three cars) round their
loop in the lane next to the centre line, trains (four cars) out on the right-hand track and back on
the other, standing alongside each platform, and one container freight train per terminal in off
the regional railway and back. Roads with tram track draw rails, a darker band, overhead wires and
masts, joined through junctions (tracked approaches paired straightest first); level crossings draw
rails and panels across the road, crossbucks and raised barriers. The Ridership data map shades each
line by rush-hour riders over capacity and each stop by its riders.

**Tools and UI.** The road tool gets Railway and a Tram track mode (click a road to lay or take up
track, drag along roads for a line); the transit bar gets tram stops. Stations snap to railways and
tram depots to tracked roads. Clicking a stop selects it (`Selection.kind` 'stop'): its line, how
often it runs and its riders; stations and depots show their line (or why there's none), freight
terminals their truckloads, railways their trains and crossings, and roads their tram track. The
transport advisor suggests trams or trains for a jammed corridor, a terminal when trucks crowd the
highway link, and flags stations and depots that run nothing.

The done-criterion tests: `tests/trains.test.ts` grows the M6 jam town and runs a railway with two
stations beside its link (`tests/railTown.ts`); `tests/freight.test.ts` grows an industrial town a
kilometre from the highway (`tests/freightTown.ts`) and links a terminal to the regional railway;
`tests/trams.test.ts` puts trams through the same jam town. The Railhead scenario is the freight town.

### 3.22 Districts (M21)

**State.** `SimState.districts` (save v19) maps id (1–255) → `{id, name, color, policies}`;
`districtCells` is a `Uint8Array` on the 128 × 128 land-value raster (16 m cells), 0 for no district.
A raster rather than polygons: painting, erasing, lookups (`districtAt`, one array read) and the
per-cell systems (land value, the data-map filter) all index it directly, and a 16 m cell is finer
than a lot. `createDistrict` takes the lowest free id and the lowest colour slot no district uses
(12 slots, up to `DISTRICT.limit` 24 districts, names up to 32 characters); `paintDistrict` sets
every cell whose centre lies within a brush path's radius (0 erases) and refuses a stroke that
changes nothing; `removeDistrict` clears its cells. All five commands are undoable (`DISTRICT_SCOPE`:
the `districts` container and the `districtCells` array); a paint drag carries a `stroke` id and
merges into one undo step, like zoning.

**Policies.** A policy's `scope` is `'city'` (tourism campaign: visitors come to the city, not a
street), `'district'` (heavy-traffic ban, heritage), or both (the rest). `Sim.policyAt(id, x, z)`
answers "in force here?" (city-wide, or the cell's district has it) and every per-place policy reads
it: recycling per building in garbage, healthy living per home, fire safety and neighbourhood watch
per building in incidents, clean industry per polluter (air and ground), free transit per trip
origin in the mode choice, the high-rise ban and heritage per lot in growth (`densityAt`). A
district policy costs the city-wide price × the district's share of the people who live or work in
the city (residents plus filled jobs; `districtPolicyCosts`,
booked under Policies), and nothing where the city already has it; `setDistrictPolicy` refuses a
policy that is locked, city-only, or already city-wide, and `setPolicy` refuses district-only ones.
`districtPolicies()` caches policy → districts and is dropped by `districtsChanged()` after any
district edit or undo.

- **Heavy-traffic ban**: the freight assignment routes trucks on `truckCosts`, which multiplies
  the cost of every road whose midpoint lies in a banned district by `DISTRICT.truckBan` (6). Trucks
  go round where another way exists and still reach shops and industry inside (deliveries get in).
  Cars and buses are untouched.
- **Heritage**: no building in it is rebuilt at a higher density or tier or retooled (the
  lifecycle skips upgrades there), new growth stays low or medium density, and its land is worth
  `DISTRICT.heritageLandValue` (0.05) more.

**Figures.** `districtReports` (query `districts`) returns, per district and for the rest of the
city (id 0): residents, jobs, workers, mean happiness, mean land value over its cells, buildings,
cells, the taxes its buildings pay a month (`buildingTax`), the upkeep of civic buildings standing
in it, and its policies' cost.

**Client.** `ClientWorld` mirrors the districts and cells (`FrameDiff.districts` when they change);
`names.neighbourhood()` prefers a district's name over the generated one. `DistrictView` tints
painted cells in their colour through the data-map overlay texture, draws borders stronger and
floats each name over its cells while the district tool or panel is open. The district tool (I)
paints with a round brush (16–192 m, [ ]), picks a district, erases, or starts a new one named after
the neighbourhood under the first stroke (numbered if taken). The Districts panel lists them with
their figures and policies, renames and dissolves them, and sets the data-map filter
(`Overlay.district`): every data map masks its terrain and road tints to that district's cells.

The done-criterion tests (`tests/districtPolicies.test.ts`): a heavy-traffic ban on a freight
town's housing estate cuts truck traffic through its homes and moves it to the back road while the
other side's roads carry the same; recycling in one half of a town cuts garbage there and nowhere
else, for its share of the cost; heritage on the Big Game city stops rebuilding inside and raises
land value there, with the rest unchanged. The Market Town scenario puts the ban to work.

### 3.23 Seasons and weather (M22)

**Calendar.** One day/night cycle is a month, so a season is three months: Dec–Feb winter, Mar–May
spring and so on. `START_MONTH` (2) makes a new city start in March. Years are calendar years
(playthrough fix P16): Year 1 runs from March to December and Year 2 starts in January
(`calendarMonth(k)` and `calendarYear(k)`; every label goes through `monthLabel`, `shortMonthLabel`,
`formatMonth` or `formatDate`, so lists and charts read in time order across New Year). Only display
code reads the calendar month or year; elections and the chronicle count months since founding.

**Climates** (`src/data/climate.ts`). Each map preset has one (`PRESET_CLIMATE`: river temperate,
coast maritime, lakes continental, highlands alpine): monthly mean temperatures, a day–night swing,
and per-season weights for clear, cloudy, rain, storm, fog and heatwave spells.

**State** (`SimState.weather`, save v20; `src/sim/systems/weather.ts`): the climate, `seasons` and
`intensity` (0 off … 3 wild), the spell (`kind`, `strength`, `until`, its temperature `offset`), the
temperature now and the day's mean, ground `snow`, `wet`, `river` rise (m) and `dryness`, plus
`RoadSegment.snow` per road. Hourly, before utilities (`weatherHour`): when the spell ends, draw the
next from the season's weights on its own RNG stream (`weather`; intensity scales the weights of
anything but clear and the strength); rain and storms fall as snow when the spell's mean is ≤ 1 °C,
and a storm that falls as snow is a blizzard. A new city's first 12 hours are fair. With seasons off
every month has May's temperatures (no snow, no heatwaves); with weather off it's always clear.
Then snow falls on the ground and every road (0.07 an hour at full strength) and melts above 0 °C
(faster in rain and, on roads, with traffic); rain soaks the ground and raises the river, which
drains a little each hour; warm dry weather raises dryness and rain lowers it. `season` and
`weather` events (storms, heavy snow, heatwaves) drive notices.

**Effects**, each where it acts:
- *Power and water* (`buildingUse` with `weatherUse`): heating adds up to 60 % (homes), 40 % (shops)
  and 20 % (industry) as the day's mean falls from 14 °C to −10 °C; above 23 °C cooling adds up to
  30–35 % and water use up to 30 %. Groundwater pumps lose up to 45 % of their output with dryness;
  solar follows the cloud and the season (0.35–1.05), wind turbines run 35 % harder in storms.
- *Traffic*: a road's travel time × `snowFactor` (1 + 0.9 × snow) in route costs
  (`congestedEdgeCosts`) and for visible vehicles (`segSpeed`).
- *Parks* count for up to half as much in rain and snow (`parkShare`).
- *Floods*: with disasters on, a river more than 1.2 m up gives an hourly chance (5 % per metre over)
  of M9's flood at a home near the water (`riverFlood` in `disasters.ts`).

**Ploughs** (`src/sim/systems/ploughs.ts`). A public works depot (`CivicDef.plough`: 3 ploughs,
3 km of road, 12 roads a round; road maintenance funding scales the ploughs) sends idle ploughs each
hour to the busiest snowy roads (snow ≥ 0.1) within its reach. A plough clears every road it drives
along (the vehicle `passed` hook), works on to the nearest snowy road left, and after its round
heads home; ploughs run at four times a service vehicle's pace and aren't slowed by snow.
Metres cleared are the depot's `processedToday`/`lastDay`. Road snow reaches the client as
per-segment changes (`FrameDiff.roadSnow`).

**Interface.** The top bar's date shows the weather, temperature and season and opens a panel of
what the weather is doing (`src/ui/weather.ts`); Settings set seasons and intensity for this city
(`setWeather`, refused while a scenario plays; scenarios set theirs at start) and new ones; road
inspectors show snow, depot inspectors their ploughs; advisors warn of winter power headroom
(demand at the climate's coldest month), snow no plough clears, a dry spell on tight water and a
high river.

The done-criterion tests: `tests/winter.test.ts` (the alpine test town uses 26 % more power per
resident in January than July, snow lifts its commute 98 → 115 s and a depot brings it back to
98 s) and the Long Winter scenario (`tests/scenarios/winter.test.ts`).

### 3.24 Region, airport and seaport (M23)

**Neighbours** (`src/data/region.ts`, `src/sim/systems/region.ts`; `SimState.region`, save v21).
Three towns beyond the map edges, one of each character (industrial town, commuter suburb, resort),
named and sized from the seed and placed north and south up and down the regional highway and west
along the railway. Each month their growth rate drifts on their own RNG stream (`region`) within the
kind's bounds, and their population follows. Per 1,000 residents a kind sells and buys power, water
and garbage processing, sends workers and shoppers, and has jobs for the city's unemployed
(`NEIGHBOUR_KIND[k].per`). An industrial town has up to 30 % less spare power in the cold; resort
shoppers follow the season.

**Deals.** `setDeal` signs, changes or ends one contract per neighbour, resource and direction, up to
what the neighbour offers now. Bought power and water come into `updateUtilities` as a producer at
the highway's connection node; sold power and water take what the highway's component has left after
the city's own buildings are served, so a sale never blacks out a home. Garbage deals move garbage
hourly: a neighbour that takes it empties the fullest landfills; one that sends it has it burnt or
recycled where there's room, else buried. Everything is paid monthly (hourly accrual) for what was
actually delivered, on the 'Bought from / Sold to neighbours' ledger lines.

**Commuters, shoppers and visitors** (`src/sim/systems/regionFlows.ts`), in each matching round after
the city's own residents are matched, so locals always get first pick:
- The neighbours' workers take jobs still open within a commute (30 min, of which 12 on the regional
  highway) of the way in: the highway's connection node, or a station on track linked to the
  regional railway (30 % come by train when there is one, entering at the station's road node).
  Their pull grows with the city: 10 % of the pool at first, all of it at 8,000 jobs (shoppers: at
  2,000 shop jobs).
- Half of the residents without a job in town take one in a neighbour, those nearest the highway
  first; their commute includes the drive out.
- The neighbours' shoppers fill shop capacity left within a shopping trip of the edge.
- Visitors (M10's count) now arrive by road, rail, air and sea (`tourism.by`) and travel from where
  they arrive to the landmarks and hotels.
All of it loads the roads and is sampled as trips (`incommute`, `outcommute`, `regionshop`,
`visit`). Buildings keep `fromRegion` (workers from out of town, counted in `pop`) and `toRegion`
(residents working out of town, counted in `employed`). Demand treats jobs held by commuters as open
to newcomers, and residents working out of town as still looking, so the region fills gaps without
choking the city's own growth. Scenarios play without neighbours unless they set `region: true`;
`GameOptions.region: false` founds a city without them (controlled test towns).

**Airport and seaport** (special category, unique). The airport (20,000 residents, 300 × 130 m)
brings its own visitors by air plus half as many again of the city's others, lifts commercial demand
and is loud along its runway's line. The seaport (10,000, coast) needs deep water (≤ −6 m) within 60 m
of its back; its quay may stand over the water and a sloping shore. It works as a freight terminal
without the wait to load a train: exports and imports go by sea when the drive there is less than ten
minutes longer than to the highway, up to 360 loads a day; plus trade income per industrial job,
industrial demand and ferry visitors.

**Noise** (`src/sim/systems/noise.ts`): a raster rebuilt every three game hours from the airport (an
ellipse along the runway's line), motorway and highway traffic, and heavy industry; residents mind it
above 0.35 ('Noise' mood factor, the advisors' 'Homes under the noise'). Data maps: Noise, and Region
traffic (roads used by trips to and from the region, from the sampled trips).


### 3.25 Terrain and map editor (M24)

**Terraforming** (`src/data/terraform.ts`, `src/sim/world/terraform.ts`, `src/sim/actions/terraform.ts`;
the `terraform` command). A round brush (16–128 m) along a drag raises or lowers the ground by up to a
metre a pass at its centre (falling off as (1 − q²)² to the rim), levels it towards the height where
the drag began, or pulls it towards the mean of the 5 × 5 samples around. Edits go into M13's
terrain delta through the same `reshapeGround` as a road's earthworks (trees cleared on disturbed
ground, lots rechecked), so they save as deltas, undo like earthworks (one step per drag, the
`stroke` merge zoning uses) and colour as fresh earthworks. Limits: water and the water table
(0.7 m) are left alone; the ground within 12 m of a building's footprint, or of a road's edge and
shoulders, is held (heights are interpolated between 8 m samples, so that is the ground they stand
on), and within 32 m of held ground the new ground keeps to 1 in 1 from it; no higher than 200 m or
more than 40 m from where the map began; the brush fades out towards the map's edge. It costs
$0.25 per cubic metre moved (a road's formation costs $0.40): levelling a steep hillside before
building a street on it turns 229 buildable lots into 392 for about $130k on the `hill` map.

**Custom maps** (`src/sim/terrain/customMap.ts`; `SimState.map`, save v22). A map is absolute heights
(centimetres, delta-coded along rows in an `Int16Array`, which compresses well), forest density, ore
and oil (16 m rasters), where the regional highway and railway come in on the west edge (z; no
railway is allowed), a climate, and a generator seed and preset. The ground inside the map is the
map's own; the seed and preset give the scenery beyond the edges (the client blends the map's edge
into it over 400 m), the wind and the region's names. `Terrain` builds from a map instead of the
generator, with groundwater derived from the heights and the distance to water as generated maps
have it. A city founded on a map keeps the map in its save, since terrain is rebuilt on load.
`checkMap` is the playability check: the highway must come in on dry land no steeper than 12 % over
its first 120 m, with at least 20 ha of buildable ground (dry, cells no steeper than lots allow)
within 600 m; a railway on water or rough ground, no water and no ore or oil are warnings.

**The editor** (`GameOptions.editor`; `src/sim/actions/mapEdit.ts`, `src/client/editor.ts`,
`src/tools/mapTool.ts`, `src/ui/Editor.tsx`, `src/ui/Maps.tsx`). The map editor is a paused city on
the map with no roads, neighbours or time, taking only the editor's commands: `editMap` brushes
(raise, lower, level, smooth; river and lake beds at −4 m, sea at −14 m, land back to 1.5 m; forest,
clear trees; ore, oil, clear), with undo (the scope adds the map's ore and oil rasters),
`setMapEntry` and `setMapInfo`. Height edits go into the terrain delta and are folded into the map by
the `exportMap` query, which also runs the check. The page keeps each map in the game's IndexedDB
(a `maps` store beside the saves, database version 2), saving a draft a few seconds after each edit;
maps that pass the check appear on the new-city screen ("Your maps", `?new=1&map=<id>`), and any
map exports and imports as a `.citymap` file (gzip JSON). The editor opens from the main menu (new
from a generated map or flat meadow, or one of the player's maps: `?editor=new|<id>`).

### 3.26 Phase 2 review

**Placeable regional rail link** (`src/sim/actions/railLink.ts`). A city whose west edge was built
up when M20 arrived got no railway on loading. While a city has none (and isn't a scenario, the
editor or a map made without a railway), the toolbar offers the rail link (`raillink`, $40k, unlocks
with railways): the player picks where on the west edge it comes in, at least `ENTRY_SPACING` from
the highway. `buildRailLink` lays the same `mainline` segment a new city starts with, plus a small
junction building beside it (inspector only; it can't be moved or bulldozed, nor can the mainline).
It refuses roads, civic buildings, water and ground rising more than 4 m under it, and clears homes
and businesses in its way (the ghost shows them); it is one undo step (the history captures
`railway`). Regional flows look for a station's road node only among nodes with an access road,
and match rail entries before road ones.

**Level crossings on screen** (`src/render/crossings.ts`, `railVehicles.ts`, `traffic.ts`). Every
train's run lists the crossings its path passes and when in its timetable its front reaches each
(`passes`, both ways at a terminus). Each frame this gives, per crossing, the time to the next
train (`eta`): under 5 s the crossing is closed and its barrier arms (one instanced mesh) swing down
over 1.5 s; under 8 s cars stop setting off across it (`holding`); it opens once the train's tail
is 6 m past. Cars wait at a stop line behind the barrier, only cross once the arms are fully up and
no train will arrive before they are over at half speed, never spawn on a crossing, and a car
already past the line carries on.

**Trams in traffic.** Trams keep their own position between line rebuilds (by route) and move at
the timetable's pace, but stop behind cars in their lane, at junctions a car from another road is
crossing, and at closed crossings; while over a junction a tram holds it as a car would. Cars read
the live tram bodies (`TrafficSim.trams`): they stop short of a tram ahead in their lane, don't start
a leg or spawn where a tram is, and one caught inside a tram's body drives out of it.

**Seasons' grace** (`WeatherState.grace`, `seasonEase`). A city loaded from before M22 was built for
mild weather all year. Its first winter after loading costs it no heating or cooling; the share
then ramps from the spring after to full at the next winter, and the grace is dropped. The advisor
explains it, and a notice on loading says seasons have come.

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
- **Buildings**: the asset registry returns a model for a type, lot and look: generated from parts
  (walls with window grids, pitched/flat roofs, parapets, awnings, signs, chimneys) seeded by variant,
  or built from a hand-made design (§4.3); vertex attributes: colour, emissive-window mask, baked AO.
  Completed buildings are merged per chunk (rebuilt incrementally, a chunk a frame); buildings under
  construction share one mesh with scaffolding, cut off at the height they have reached.
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

### 4.2 Seasons and weather on screen (M22)

`src/render/weather.ts` eases a *look* (season weights, weather kind and strength, snow, wet)
towards the city's — or photo mode's — over a few seconds and writes shared uniforms (`uSnow`,
`uWet`, `uSeason`, `uGrade`, `uRoadSnow`) that the terrain, tree, building and road materials read:
grass takes the season's colour and snow settles on flat ground (patchy as it starts); broadleaf
crowns (their green vertices) blossom, turn gold and red, then thin out bare; roofs and trees carry
snow on upward faces. Every road vertex carries its road's (or junction's) id (`aTag`), so snow per
road is a lookup in a 512² data texture — grey slush that still reads as road — rewritten at most
four times a second when `roadSnowVersion` changes. Cloud greys, dims and desaturates everything
(`weatherGrade`) and hides the sun disc; fog and falling rain or snow pull the fog in; heat warms the
grade and hazes the distance; storms flash (sky and fill light) and schedule thunder. Rain and snow
are one `Points` draw (up to 9,000 × the crowd quality) in a box between the camera and its target,
animated entirely in the shader. Data maps are shown in clear weather. Ambient sound adds rain and
patter layers, storm wind and muffles traffic under snow.

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

### 4.3 Hand-made models (phase 3, M25)

Buildings are generated (`src/render/assets/models.ts` and friends) or hand-made: GLB files in
`assets/models/`, named after what they replace (`R103.glb`, `firestation.glb`, `annex-ward.glb`;
`-2`, `-3` for further designs), made to the spec in `docs/models/PROMPTS.md`.

**Check** (`src/models/check.ts`, `npm run models:check`). A small GLB reader (`src/models/glb.ts`:
meshes only, every node's transform baked in, winding made to agree with the file's normals)
feeds checks against the spec and `src/data`: the footprint is the lot or site exactly and centred
on the origin (a zoned model may be a half or a third of the lot's width, a row; it may stop whole
cells short of the back of the lot; a wall-to-wall building's footprint is its walls, with trim and
steps overhanging a little); it stands on the ground; its front faces −Z (by the weight of
entrances, shopfronts and canopies on each side); materials are the spec's roles; window groups
hold `window_glass`; polluters have a `smoke_stack`; no textures; the triangle budget from its
prompt. A failed model is reported and left out; the building keeps its generated look.

**Convert** (`src/models/bake.ts`, at build time by `scripts/vite-models.ts`). Each good model
becomes triangles tagged per triangle with its material role, flags, the window it belongs to, and
the group the game drives (`mound`, `rocket`…); `tree_spot` cubes and `smoke_stack` tops become
markers. Faces that can't be seen are dropped (a face whose outside is inside another part that
is a plain box). Flags mark the triangles of two distant versions picked from the named parts:
*far* (frames, sills and fittings under half a metre gone, panes and frames as flat faces) and
*skyline* (shapes over about 2 m, and every pane); long thin parts (parapets, posts) and whatever
holds up a part that stays are kept. A window or band longer than 4.5 m along its wall is cut
across into runs of about 3.5 m, each a window of its own, with a 0.4 m strip of glass that never
lights between two (in the near and far versions; in the skyline the runs meet), so a floor-long
band lights at night as windows, not one stripe (model batch 3); shopfronts and glazed volumes stay
whole. For wall-to-wall models, flags mark what a neighbour in a
row hides. All models are packed into one file (`src/models/codec.ts`: 16-bit welded vertices,
about 17 bytes a triangle), emitted as `assets/models-<hash>.bin`; `virtual:citybloom-models` is
its URL, and the game fetches it at start (`src/client/models.ts`) while the city loads, waiting
for it up to 6 s before opening with generated looks. Vertices and indices are stored as the
difference from the one before (a model's x's, y's and z's each in a run of their own), and each
kind of array of every model together, so the server's gzip packs the file to about 1.5 bytes a
triangle (model batch 4: 457 KB for 299 models, against 2.0 MB as plain numbers); decoding is a
running sum, a few milliseconds. Without it every building is generated.

**Draw** (`src/render/assets/handmade.ts`, `registry.ts`). `assets.zoned(def, w, d, look)` asks
for a design that fits the lot: as wide as the lot or a half or a third of it, and no deeper.
With two designs or more every look is hand-made; a lone design shares the twelve looks with the
generator's variants. A design becomes a `ModelData` for that lot: copies side by side across
its width, each repainted (for `wall`, `wall_alt`, `roof`, `awning` and `sign`, a colour from the
game palette nearest the model's own, so brick stays brick; a colour near none is kept), perhaps
mirrored, less the faces a neighbour in the row hides, standing at the front of the lot on the
game's lot base (which hides a slope and is the yard behind a shallow model), with the
generator's darkening near the ground. Window vertices carry a window number; when a building is
merged into its chunk (`modelMerge.ts`) each copy lights its own mix, seeded by the building's id.
Lawns and hedges are tagged (a negative emissive) and follow the seasons in the building shader,
as the generator's now do too. Markers ride along: the renderer plants the game's own trees at
`tree_spot`s (`trees.lotTrees`), and smoke rises from stack tops (`effects.models`). Civic models
take the same path without mirroring: the landfill's `mound` group is scaled by how full it is, a
big project under construction is the finished model cut off at a height that rises by stage
inside the generator's hoarding and under its cranes, and add-on annexes (their own models, or the
generated wing) stand in the back corners. `BuildingRenderer.look` moves a building on to the next
look when a neighbour of its type and size already wears its own: no two alike side by side.

**Levels of detail** (`src/render/lodChunks.ts`). A model with distant versions is merged into
near, far and skyline chunk meshes (chunks of 128, 128 and 512 m); one without goes into a plain
mesh (256 m) drawn at every distance, as before. The shader gives each pixel a fixed threshold
and draws near where its fade (170–230 m at High; nearer on coarser pixels) is under it, far
where near isn't, and the skyline past 520–680 m: exactly one level per pixel, so the hand-over is
a dither across a band, never a pop; the shadow pass uses the same rule from the view camera. A
chunk wholly inside one level's range is drawn with the plain material (no `discard`, which would
cost a tile-based GPU its hidden-surface removal). A level's mesh is built only when the camera
is near enough to need it, and near meshes far behind are dropped.

### 4.4 Light and sky (phase 3, M26)

**The frame** (`src/render/post.ts`). While ambient occlusion is on (close up), the frame is
drawn into a multisampled 8-bit target with its depth, then copied to the canvas with the effects
laid over it; when only the glow is on (at night, from far off) the frame goes straight to the
canvas and the glow is laid over a copy of it; otherwise straight to the canvas (Low always). The target is marked as an XR target, the one kind three.js tone-maps and sRGB-encodes
into as it does the screen, so materials behave exactly as before and 8 bits a channel suffice;
its storage is named `RGBA8` (otherwise three gives the multisampled buffer and the texture
different formats and the copy fails). The depth is resolved only when something reads it. The
paths look the same: in each, the materials tone-map.
Effects: *ambient occlusion* at half resolution from the depth alone (normals from neighbouring
depths, taps on a spiral turned per pixel, reach growing with the view, faded out by about 900 m
so the whole-city view pays nothing), smoothed by a depth-aware blur at High, laid on as a warm
violet multiply; a *glow* at night (a soft-knee bright pass at a quarter resolution, blurred twice,
added). Photo mode's lens reads the finished frame (`PhotoLens.renderFrom`, display-referred).
Tone mapping is Neutral: a toy's colours stay true (ACES took brick to near black in shade).

**Shadows** (`src/render/sunShadow.ts`). The sun is three.js's `SunLight`: two shadow maps in one
atlas, picked by view depth. `CitySunShadow` fits them to the ground in view rather than to the
view frustum: the part of each depth slice inside the slab from the lowest ground to the highest
roof (`ShadowFit`, set each frame from sampled heights), boxed in the sun's space, in 5 % size
steps snapped to texels. One map when the ground's far edge is less than 2.2× its near edge (the
whole-city view); else a near map to the geometric split and a far one beyond. Shadows reach 3.2
camera distances (at least 500 m). Medium and Low use one map. The maps are drawn every frame
close up, 60 times a second from middle distance and 30 from far off (`shadow.autoUpdate` off,
`needsUpdate` when due). The shadow pass draws only what
casts: merged chunks put their casting triangles first (`Arrays` split; `ModelData.shade`: not
panes, not small fittings close up, nothing flat on the ground) and draw just that range in the
shadow pass (`drawCastersOnly`); small things (cars, walkers, lamp posts, rubbish) cast in the near
map only (`castNearOnly`); rubbish and lamp-post shadows go from far off.

**Sky and light** (`src/render/lighting.ts`, `lightChunks.ts`). Keyframes through the day add the
blue hour (deep blue, violet horizon) and the golden hour (a low warm sun, amber horizon); the sky
glows round a low sun along the horizon; the light turns from the sun to the moon through the blue
hours so shadows swing rather than jump; exposure rises a little while the sun is low. A patch to
three's lighting chunk adds light bounced off the ground opposite the sun, tinted by the
hemisphere light's ground colour, which follows the season and snow (`groundBounce`); a patch to
the fog chunk adds a gentle haze from nearer in.

### 4.5 Ground, lots and streets (phase 3, M27)

**Grass** (`src/render/terrain.ts`, fragment shader, before the seasons so all of it turns with
them). Warm and cool tone patches (~90 m) and a fine mottle (~4 m, mipmapped so it fades to an
even shade far off) everywhere, from a 256² tiling texture of random bytes (`noiseTexture`: one
lookup gives four smooth value noises, much cheaper than sine hashes). Out in the country, only at
Medium and High (`uGroundDetail`, the quality's `ground`): farms of 420 m squares, 70 % of them
farmed, each turned its own way about its middle and laid out in staggered rows of fields with
their own shades (a few golden) and hedgerows along some sides; and worn paths where a slow,
domain-warped noise crosses its middle, the band's width divided by the noise's slope (from the
same four corners, `wNoiseD`) so a path is about a metre wide everywhere. Hedgerows and paths are
left out where a pixel spans more than about 2 m. The town mask (`uUrban`, a byte per 8 m cell)
fades country to tidy grass within 46 m of a town road (not motorways or railways); it is rebuilt
at most once a second, and only when roads change. Sand just above the water is darker (damp).

**Zones** (`src/render/zones.ts`). Empty zoned cells are drawn as a faint tint over the whole cell
with a 0.45 m outline on each side where the zoned area ends (the same zone neither side), in one
mesh a chunk with each vertex's own opacity (RGBA colours). While a zoning tool is out
(`setGridVisible`) the old cell-by-cell look and the unzoned grid show instead. Data maps hide
both, as before.

**Streets** (`src/render/roadStyle.ts`, `roadMesh.ts`, `roads.ts`). Town roads (street, avenue,
boulevard) have kerb stones along the pavement's road edge, a darker kerb face, slabs and an
edging along the back; medians are planted inside kerb stones; junction corners follow the same
bands. Medians and verges are grass in the road shader: in their season and under lying snow
(never ploughed). Ribbons step 2.5 m round bends and up to 6 m along straight runs (fine always on
bridge decks), which more than pays for the extra strips. At a junction of three or more town
roads, `junctionPaint` decides: where an avenue or boulevard meets, or four roads meet beside a
commercial block, every approach long enough gets a zebra crossing (1–4 m off the junction) and a
stop line behind it across the incoming lanes (traffic keeps right); elsewhere a side road
narrower than the road it joins gets a dashed give-way line. Lane markings stop short of both.

**Street furniture** (`src/render/streetProps.ts`). Between the lamps (every 34 m, offset 17),
on the pavement's back, by the zone of the frontage cell there: a bench with a bin beside it and a
planter (avenues) or bin (streets) in turn outside shops, a bin every third place outside homes;
none near a bus stop or on a bridge. Each road's pieces (boxes, 20–40 triangles each) are merged
into its 512 m chunk, one mesh a chunk; a road is rebuilt only when its type, length, frontage
zoning or stops change. Shown within 900 m of the camera at Medium and High, casting shadows
within 450 m (near cascade only).

**Lots** (`src/render/assets/handmade.ts` `yard`, `models.ts`). A hand-made model shallower than
its lot leaves a yard at the back: a car park with marked bays (two rows facing across an aisle
if deep enough) and parked cars behind shops and offices; a marked loading box with crates or a
container behind industry; a lawn (on paved lots too) with a path and a garden shed behind homes.
Markings, cars and clutter only in the near level; the surfaces in far; nothing in the skyline.
Generated terraces get a path to each door between strips of lawn with low hedges; generated
flats a path to the entrance between lawns.

### 4.6 Buildings and variety (phase 3, M28)

**Distant versions for generated buildings** (`src/render/assets/builder.ts`). Every triangle the
generator draws carries a mask of the levels it is drawn at; `detail(level, fn)` narrows it for a
block of drawing: `NEAR_ONLY` (doors, cars, fences, garden trees, terrace umbrellas, small roof
units), `IN_FAR` (balconies and balcony bands, signs, awnings, rooftop plant, paths and lawns,
dormers, chimneys) and `SKY_ONLY` (stand-ins). `build()` returns the near model with `far` and `sky`
filtered from the same triangles, so every generated building (zoned, civic, rubble, a project's
site works) fades through the levels exactly as a hand-made one (`lodChunks.ts`; nothing is drawn
"plain" any more). Windows stay in every level, since they are most of a generated building; along a
band of windows (offices, industry, luxury flats) the skyline draws each run of neighbouring
windows that are alike (lit or dark) as one pane across their gaps, lit at their average. Each
window's light is drawn from the building's random stream once, so the near, far and skyline
versions light the same windows.

**The generator refreshed** (`src/render/assets/models.ts`). The seed includes the type (zone,
density, wealth): two types on the same lot used to draw the same building. Towers stand on a
podium (one or two floors, with a parapet) in one of five silhouettes: a slab with setbacks, a
wedding cake of three steps under a lit crown band and a mast, twin towers (on 24 m lots), a tall
block beside a lower one, or a slab whose top floors step in under a spire or a pyramid cap; some
get coloured corner piers, homes balcony bands (every floor or every other), offices fins close up;
roofs carry plant, masts or a water tank on legs. Residential towers take their walls by wealth:
pastels and some brick, white and modern greys for the rich, and glass with banded windows for a
few luxury ones. Mid-rise flats get mansard roofs with dormers, cornices, stone ground floors under
brick and corner bay windows; mid-rise offices a cornice, a stepped parapet or a corner turret;
houses now and then a mansard or a saltbox roof; stores a false front.

**Neighbours.** `BuildingRenderer.look` already moves a building off a look its touching neighbour
of the same type and size wears; with the type in the seed, buildings of different types no longer
share models either. Test API `getNeighbours()` counts touching pairs drawn with the same model.

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
- **Street names (playthrough fix P10)**: a name is part of each road segment (`RoadSegment.name`,
  saved from v24); a street is the segments sharing one. `nameSegments` (`src/sim/world/streetNames.ts`)
  names a new segment inside the command that makes it: it takes the name of the same-type road it
  carries straight on from (more than 150° apart at the junction; its `a` end first, then `b`), else a
  fresh name: a stem from `STREET_STEMS` (60 legacy plus 40 more) picked by hashing (seed, segment id),
  skipping stems in use until all are, then the least used, with a suffix of its type that makes the
  whole name new. A split copies the name to both halves; a type change keeps the stem and moves the
  suffix (Maple Terrace becomes Maple Parade) in `Network.setSegmentType`; undo and redo restore names
  with the segments. The client's `StreetNames.street` only reads it. The v23 to v24 migration names
  old roads as the client used to (`legacyStreetNames`, checked against goldens from the old code).
  Neighbourhoods are still client-only, per 384 m cell. Labels follow the roads at close zoom (≤ 10,
  DOM); inspectors and advisors use addresses ("Maple Street, Northgate"). The UI reads `ClientWorld` via a small subscribe/selector hook and sends commands through
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
the main menu's Continue and an exported-then-imported file (e2e `m11-shell`). v17 (M19) adds only
optional fields (one-way roads, roundabouts; city highway and ramp segments are new type values), so
its migration is the identity and older cities load with two-way roads and plain junctions. v18
(M20) adds `railway` (the regional rail link) and optional fields (tram track, tram stops); its
migration is also the identity, and `Sim.fromSave` lays the rail link on a city that has none
(`railway` missing) where it fits, so an older city loads, gains its link and plays on
(`tests/trains.test.ts` loads the version-10 playtest save). v19 (M21) adds `districts` (an empty
map) and `districtCells` (all zero); `tests/districts.test.ts` loads the version-10 playtest save,
paints a district and round-trips it. v20 (M22) adds `weather` (the preset's climate, a fair first spell) and the `weather` RNG
stream; `tests/weather.test.ts` loads the version-10 playtest save, plays on and round-trips it.
v21 (M23) adds `region` (the seed's neighbours, no deals) and the `region` RNG stream;
`tests/region.test.ts` loads the version-10 playtest save, signs a deal, plays on and round-trips it.
v22 (M24) adds `map` (null: every older city stands on a generated map); `tests/customMap.test.ts`
loads a version-21 save and the version-10 playtest save and plays on, and round-trips a city founded
on a custom map, which carries the map in its save. v23 (Phase 2 review) changes only the v19 → v20
step, which now also sets `weather.grace` (§3.26), so a pre-M22 city eases into heating; a v22 city
already has its seasons and loads unchanged. `repairState` fills totals and tourism fields any older
save lacks. The legacy corpus (`Saves/legacy/`, 48 saves, v10 to v21 on each of the four presets, made from
past commits by `scripts/dev/legacy-corpus.mjs`) is loaded and played two years in
`tests/legacy/`, and three of them through the UI in e2e `review-legacy`.

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
- Playwright e2e against a `--mode test` build served from `/CityBloom/` by `e2e/serve.mjs`, as
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
