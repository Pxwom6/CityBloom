# M35 Into battle: design (plan)

Written before M35 started, from a read of SPEC-5.md, the M34 code, disasters/incidents, the region
room and the balance mayor. A plan, not a record: DECISIONS holds what was actually chosen, and
this file is updated or deleted as M35 lands. Numbers marked *est.* are to be measured in step 1.

## Key calls
1. **One pure battle module, `src/sim/battle/`**: a `Battle` takes a `BattleInput` (a frozen
   `BattleLayout` of the defending city, both forces, orders, caps, a seed), steps at a fixed 0.5
   game-second, emits `BattleEvent`s, a `result()` and a `hash()`. DMath only; under `src/sim` so lint
   covers it.
2. **Toy time**: one city tick (a game minute) carries 2 battle steps (1 battle-second). A skirmish
   is 200–600 ticks (25–75 s real at 1×). The city's speed buttons are the battle speed.
3. **Home battles run inside the defending city's sim** (a rival's raid, a friend's raid while you
   are online, replays): stored as `war.battle = {input, step, start}`, stepped in `Sim.step`, rebuilt
   on load by re-running from the input. Every event enters through one internal `warDamage`
   command: "results as commands" literally; saves, lockstep and checksums just work.
4. **Away battles run outside your sim** (your raid on a computer neighbour's town, or on an offline
   friend) in a second worker (`src/sim/battleWorker.ts`); your sim tracks the expedition and gets
   a page-only `battleReport` command with your losses.
5. **Damage reuses disasters**: homes and shops catch fire (`ignite`) or fall to rubble (`toRubble`,
   no ambulance); rubble clears after 36 h and the lot regrows. Civic and military buildings close
   for repairs (`damage` hours, a new optional `Civic.wrecked` rubble look) repaired by
   `disastersHour`. Roads crater (`roadDamage`). Nothing is removed, so every loss rebuilds itself.
6. **Computer neighbours' towns**: grown by the careful balance mayor (moved to
   `src/sim/ai/mayor.ts`, `Math.hypot` → `DMath.hypot`) in sandbox mode to min(population, a cap,
   *est.* 12,000, 1,500 in test builds), then armed (HQ, barracks and depot by the highway, bunkers
   along the first avenue, anti-air in the centre, coastal guns on coasts).
7. **Town caching**: grown in the battle worker in the background when war starts, cached in
   IndexedDB (`towns` store) by seed, neighbour, kind, personality, cap and `TOWN.version`. Battle
   records keep their layout, so replays never depend on regrowing.
8. **AI raids**: hourly on the war dice, a rival raids if aggression × (its forces ÷ your strength) ×
   relation beats the roll; only past 3,000 residents and 12 months, ≥ 6 months since that rival's
   last raid and ≥ 2 since any. Target and unit mix by personality; retaliates sooner after your
   raid; its losses lower its numbers, which re-arm monthly.
9. **Defenders fight on their own**: bunkers, anti-air and coastal guns are fixed shooters manned by
   staff × power × readiness; units leave their bases after a delay set by readiness. Attackers
   follow precomputed shortest-path fields on the battle's road graph, cover the last stretch over
   open ground, and pull back at their withdrawal threshold.
10. **Region map** (a war room tab): highway, rail, sea and air routes (base 6, 4, 10, 1.5 game
    hours), forces in transit as tokens, incoming raids with a countdown, fronts. Warning lead 1 h +
    3 h per working radar (≤ 6 h), a `raidSiren`, residents to the M34 shelters.
11. **Friends both online**: the room stamps departure and arrival on its real clock (fair at 3×);
    first claim at arrival wins; the defender claims with its live layout and hosts (resolves at once
    if paused: pausing never protects); the attacker re-runs the same input to watch and learn its
    losses. Nothing streamed.
12. **Defender offline**: the attacker fetches the defender's region save (`fetchCitySave`), runs the
    battle, posts a record (input + result hash) to the room; on return the defender's client saves
    the city as the replay backdrop, sends `battleResolve` (instant); its sim re-runs, checks the
    hash and applies the damage. The report is built from what was applied, so it matches.
13. **Watching another city's battle**: a read-only viewer page (`?battle=<id>&back=<slot>`, like
    M32's visit) loads the backdrop save and hosts the battle in watch mode. In-place swapping: M39.
14. **Save v28** (identity migration). New optional keys under `war` (`expeditions`, `incoming`,
    `battle`, `reports`, `raids`, `Unit.away`) and `Civic.wrecked`. Relay protocol 3.

## Types (`src/sim/battle/types.ts`)
```ts
export const BATTLE_VERSION = 1;
export type Side = 0 | 1; // attacker, defender
export type Route = 'highway' | 'rail' | 'sea' | 'air';
export type TargetKind = 'military' | 'industry' | 'power' | 'cityhall';
export const TAG = { home: 1, job: 2, industry: 4, power: 8, military: 16, defence: 32,
  shelter: 64, hq: 128, base: 256, civic: 512 } as const;
export interface BattleLayout {
  v: number; seedCity: string; tick: number;
  box: [number, number, number, number];
  nodes: number[];   // x, z, y per node
  segs: number[];    // a, b, speed, firstPt, nPts, segId
  pts: number[];     // x, z, y polyline points every 12 m
  grid: { cell: 32; nx: number; nz: number; h: number[]; water: number[] }; // water 0 land, 1 shallow, 2 navigable
  structs: number[]; // packed: id, tags, x, z, hw, hd, angle, h, hp, node, def… (id order)
  names: Record<number, string>;
  entries: { route: Route; from: 'west' | 'north' | 'south' | 'east'; x: number; z: number; node: number }[];
  defenders: BattleUnitIn[];
  readiness: number;
}
export interface BattleUnitIn { id: number; kind: UnitKind; hp: number; x: number; z: number; base?: number }
export interface ForceIn { side: Side; name: string; color: number; units: BattleUnitIn[];
  route: Route; target: TargetKind; withdrawAt: number }
export interface BattleOrder { step: number; side: Side; kind: 'withdraw' | 'focus'; struct?: number }
export interface BattleInput { v: number; id: string; seed: string; scale: 'skirmish';
  layout: BattleLayout; attacker: ForceIn; defenderName: string; defenderColor: number;
  orders: BattleOrder[]; caps: { maxCollapse: number; maxWreck: number }; maxSteps: number }
export type BattleEvent =
  | { k: 'hit'; struct: number; hp: number; max: number } | { k: 'fire'; struct: number }
  | { k: 'collapse'; struct: number } | { k: 'road'; seg: number }
  | { k: 'out'; side: Side; unit: number; kind: UnitKind } | { k: 'left'; side: Side; unit: number }
  | { k: 'end'; outcome: Outcome };
export type Outcome = 'raided' | 'repelled' | 'withdrew' | 'timeout';
```
`BattleFrame` (FrameDiff.battle, each tick while a battle runs): typed arrays of units (id, kind,
side, x, y, z, yaw, turret, rolled, state), shots (from, to, kind), booms, sides and targets' hp.

City side (optional, under `SimState.war`): `Expedition {id, units, to, slot?, route, target,
withdrawAt, depart, arrive, home?, state: 'out'|'fighting'|'back', record?}`, `Raid {id, from,
slot?, units, route, target, warn, arrive, seed, shelter?}`, `HostedBattle {id, input, step, start,
raid?, mode: 'live'|'instant'|'watch', expect?}`, `BattleReport {id, tick, ours, away, other,
outcome, target, collapsed, burning, civics, roads, lost, theirLost, sheltered?, repairs, hash,
replay?}` (last 12). `Sim.battleRun` is derived, rebuilt in `fromSave` by re-running `step` steps.

Commands: `sendForce {units, to, route, target, stance}`, `recallForce {expedition}` (player);
`battleReport`, `battleResolve {record, mode}`, `battleStart` (page-only); `warDamage` (internal;
outside only in test mode); `cheat raidIn {neighbour, hours}` (test mode). None undoable.

## The battle simulation
- **Layout** (`battleLayout(sim, spec)`): deterministic, id order; box = targets ∪ entry ∪ military
  + 300 m, clipped; ≤ 4,000 structures (military, defences, targets first, then by distance to the
  entry–target corridor); roads in the box as 12 m points with y; 32 m terrain/water grid. The same
  function on `Sim.fromSave(save)` for away battles; tested live ≡ from save.
- **Step** 0.5 s, 2 per tick, ≤ 1,440 steps (12 game hours), then attackers withdraw.
- **Land movement**: shortest-path fields (Dijkstra with `MinHeap` from `systems/graph.ts`) per
  target's road node (≤ 6) and one to the exit, built one per step at the start; the last stretch
  over open ground at ×0.6, stopped by water, slowed on steep cells. Infantry ride trucks to 250 m
  out when there's one truck per 4 squads. Defenders follow an intercept field from the attackers'
  nodes, recomputed every 30 steps. **Air** flies straight at a height per kind and circles 150 m
  round its target. **Sea** follows a breadth-first water path from the sea entry.
- **Targeting** every 4 steps (staggered): a 64 m grid of live units; candidates sorted by
  (priority, distance², id): threats > manned defences > objective structures (siege units) > the
  nearest structure; domains from `UnitStats.targets`.
- **Firing**: reload by dt; artillery and infantry fire standing; a hit rolls the battle's own
  `Rng.fromSeed(input.seed)` at 0.65–0.9 by kind and readiness; damage = attack × (1 − armour) ×
  (1 − cover); cover when a standing structure within 12 m lies between (infantry 0.4, vehicles
  0.2); against structures attack × siege, 15 % of siege hits crater a road within 10 m. Defences:
  attack = strength × 8 every 3 s against their domains, hp 600, manned share = staff × powered ×
  readiness; a rival's town gets defences from its `defences` points ÷ 3.
- **Structures**: hp < 60 % → fire (homes, shops) or repair hours (civics); hp ≤ 0 → collapse or
  wreck; `caps` hold a structure at 1 hp once the quota is used.
- **End**: no attacker left in play → `raided` (a target fell), `repelled`, `withdrew` or `timeout`.
  Defenders' reaction delay (1 − readiness) × 120 steps.
- **Determinism**: arrays in creation order, structures by id, sorted grid queries, the battle's
  own Rng, `hash()` with sync.ts's mixer; `Battle.run(input)` and `fastForward(n)` ≡ n steps (tested).
- **Cost**: attackers ≤ 24, defender units ≤ 64, manned defences ≤ 48 (≤ 136 actors); *est.* 15–40
  µs a step, ≤ 0.1 ms a tick; spikes: path fields 1–2 ms each at the start, layout capture 5–15 ms
  at 100k (once), re-run on load ≤ 90 ms. Measure with `scripts/dev/battlebench.ts`.

## Where battles run
| Case | Runs on | Layout from | Defender gets | Attacker gets | Watched |
|---|---|---|---|---|---|
| Rival raids you | your sim (hosted, live) | your live state | `warDamage` each tick | rival's numbers in your sim | live in your city |
| You raid a rival | battle worker | cached town save | nothing (rival numbers fall, relation down) | `battleReport` | viewer (`?battle=`) on the town's save |
| Friend raids you, you're online | your sim (instant if paused) | your live state (`battleStart`) | `warDamage` | its own run of the claimed input → `battleReport` | you live; friend in the viewer |
| Friend raids you, you're offline | friend's battle worker | the region's save | on return: `battleResolve` instant, hash checked | `battleReport` at once | replay viewer on return |

Expedition (single player): `sendForce` checks war, rules and scale, HQ, units home with hp ≥ 0.5,
≤ 24 units, domains fit the route, target allowed and town scouted; units `away`; at arrival the
page builds the input (cached town layout, `rivalDefenders`, seed `${citySeed}:battle:${id}`), runs
it in the worker, stores a record, dispatches `battleReport` (knocked-out units removed, survivors'
hp kept, rival numbers fall, relation −20, the force heads home; units mend 5 %/h at a staffed,
powered base).

Rooms: `{t:'force'}` → the room stamps `departAt`/`arriveAt` (route table × 7.5 s per game hour);
`RegionView.forces`; first `{t:'claim', force, input}` wins; offline defender: the attacker claims
from the region save and the room keeps the record (≤ 8 pending per slot, within the row budget)
until the defender's `seen`. The defender always re-runs: its result stands; a hash mismatch is
logged. Live orders, allies, spectators: M39. Per-day attack limits and the away damage cap: M36
(`caps` already in the input).

## Region map, routes, warning
Routes from `routesTo(sim, neighbour)`: highway always (6 h; north/south ×1.2); rail if both ends
have it, land units only (4 h); sea if the defender's navigable water reaches a map edge and the
attacker is coastal, sea units plus air escorts (10 h); air for air units (1.5 h). No trucks ×1.4,
one per 4 squads ×0.8. Skirmish targets: military; industry or power within 600 m of the entry;
city hall refused ("A skirmish can't strike the city hall: that takes a declared war"). Warning at
arrive − lead (1 h + 3 h a radar, ≤ 6 h): event, top-bar countdown chip, `raidSiren`, notice, shelters.
Map (`RegionMap.tsx`, SVG): cities, routes with times (disabled with reasons), tokens, incoming raids,
fronts (relation ≤ −40 or a battle within 3 months), scouting status.

## Rival towns and tactics
`growRivalTown({seed: `${citySeed}:town:${id}`, kind, personality, name, target})`: preset by kind
(industrial → highlands, suburb → river, resort → coast), `Sim.create({sandbox, easy, no disasters,
no elections, region: false})`, `unlockAll`, careful `Player`, `play()` every 6 h until the target or
36 months; then `startWar` + `armTown`. Rival forces from strength points with a personality mix
(aggressive: tanks, artillery, infantry; cautious: infantry, artillery; mercantile: drones,
infantry; honourable: balanced; treacherous: helicopters, drones, tanks), on the war dice. Raid
chance per hour = aggression × clamp(forces / cityStrength, 0, 2) / 96; relation ≤ −25 ×2, ≥ 25
×0.25, retaliation ×4; share 30–50 %; targets by personality.

## Damage, shelters, reports
`warDamage` (systems/warDamage.ts): fire → `ignite`; collapse → `toRubble(b, 'collapsed')` without
emergency incidents; civics → `damageCivic` hours (export from disasters.ts), `wrecked` at 0 hp,
cleared in `disastersHour` with `civicRepaired`; roads → `damageRoad` 12 h; defender units out →
removed (`unitLost`). Shelters at the warning: residents within 1.2 km of the entry and targets,
places filled by homes within 300 m; approval −0.04 × the share unsheltered, fading over 3 days.
`buildReport` from what changed, so it matches by construction. Replays: IndexedDB `battles`
(input, hash, backdrop save; last 10 per city); `war.reports` in the save; the viewer re-hosts the
battle in watch mode on the backdrop.

## Steps (each with its tests)
1. Data (`src/data/battle.ts`) and a town-growing probe (`scripts/dev/towngrow.ts`): set `TOWN.cap`.
2. Move the mayor to `src/sim/ai/mayor.ts` (DMath); scenario and legacy tests green; `balance` drift logged.
3. Layout, battle graph, terrain grid: `tests/battle/layout.test.ts` (caps, entries, live ≡ from save, tags).
4. Battle core: `tests/battle/battle.test.ts` (same hash twice and via fastForward; 8 tanks beat a
   bunker; cover; caps; withdrawal; anti-air only hits air; boats keep to water; 136 actors × 1,440
   steps < 150 ms).
5. Damage: `tests/war/damage.test.ts` (fire → engine; rubble → cleared → regrows; civic repaired;
   no emergencies; report ≡ changes).
6. Raids and home battles: `tests/war/raid.test.ts` (protection; warning lead and radar; report;
   save mid-battle ≡ uninterrupted; two lockstep copies agree; peace golden; v27 → v28).
7. Rival towns and the battle worker: `tests/battle/town.test.ts` (same hash twice; armed; manned sites).
8. Expeditions and the viewer: `tests/war/expedition.test.ts` (refusals; travel; away and back;
   report applied; a full scripted skirmish in Node).
9. Cross-browser (done 1): `tests/battle/skirmish.ts` in `tests/lockstep/determinism.ts`,
   `browserEntry`/`shellEntry`, `e2e-xb/determinism.spec.ts`.
10. Rendering: battle poses in `units.ts`, `render/battle.ts` (tracers, shells, puffs, wrecks),
    wrecked civics, `scripts/dev/battleshot.mjs`, a `framebench` battle view.
11. UI and e2e (done 2): `RegionMap`, `SendForce`, `BattleBar`, `BattleReport`, the chip, the
    siren, tips; `e2e/m35-battle.spec.ts` (send a force through the war room, watch, report; a raid
    with warning; damage repaired after 5 game days).
12. Rooms and the offline defender (done 3): relay messages and storage, `src/net/regionWar.ts`;
    `relay/tests/regionWar.test.ts`, a two-city harness test, `e2e/m35-away.spec.ts`.
13. Wrap-up: bench, battlebench, balance, cross-browser; DESIGN §3.29, DECISIONS, SPEC_REVIEW,
    PROGRESS; `M35 complete:` and its pull request.

## Risks (and the call)
- Battle speed: 1 battle-second a tick; tune from screenshots; add ½× if too fast.
- Battles in the defender's state add 100–300 KB to saves while running: accepted (packed arrays, caps).
- The frozen layout ignores mid-battle edits: the handler skips missing ids.
- Mayor growth time: sandbox, cap, background, cache; "Scouting Ashford's streets…" until ready.
- The mayor's switch to DMath can shift balance and scenario results: accept and log; retune
  scripted moves if a scenario flips.
- Away battles need a page switch: accepted for M35.
- Trust: the defender always re-runs; `BATTLE_VERSION` in the input; protocol 3.
- Pausing: rivals' raids run on the city's clock; in rooms a paused defender resolves at once.
- One hosted battle at a time: later raids slip until 2 h after it ends.
- No city hall building yet: the skirmish refuses that target; M36 adds one.
- Firefox and WebKit run only on CI here: keep the battle part of the cross-browser test small.
