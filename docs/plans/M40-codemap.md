# M40 code map (what the atom bomb builds on)

A survey of the code before M40, for whoever designs it. Names, not line numbers. State today: save v31
(`SAVE_VERSION`; `migrations[30]` is the identity, M40 is v32), relay protocol 6 (`PROTOCOL_VERSION`; `MIN_REGION_PROTOCOL`
5, `LIVE_PROTOCOL` 6), battle version 4 (stamped only when used; 2 when nothing of 3 or 4 is), 51 tips, 10 war room
tabs. Time: a tick is a game minute, a "month" a game day (3 min at 1x, 8 ticks/s), a year 12 of them (36 min at 1x).
Nothing of the bomb exists in sim, data, UI, relay or tests; only models and placeholders.

## 1. Research and the unlock
- Tree `src/data/research.ts`: `BRANCH_IDS` (land, air, sea, defence, intel, logistics), `TIERS` (24), `TIER_KEYS`, `TIER`,
  `prerequisite(key)`; `TierDef` has `points`, `cost`, `unlocks {units, civics, ops}`, `effects`, `park`. `PRICE` by tier
  300/$40k, 700/$90k, 1,500/$180k, 6,000/$400k; tier 4 needs a research park in service. `RESEARCH` (`labPoints`, `maxLabs` 3,
  `parkFactor`, `launchFactor`, `queueMax` 4); `UNIT_TIER`, `CIVIC_TIER` map things to their tier.
- State `WarState.research?: Research` (`systems/research.ts`, made on first queue/cheat): `done: TierKey[]`, `queue`,
  `points`, `paid`, `trials`. Readers `researched(sim, key)`, `tierCounts(sim)`, `researchSummary` (`stats.war.research.done`).
  Runs in `researchHour` on the war clock, so the fair clock bounds it in regions. Whole tree: about 118 game days with 3
  labs and a park (6 h of play at 1x). Tier-4 research stays allowed when supers are off (DECISIONS M37: "M40 needs every
  branch maxed").
- **"Maxed" has no name in code.** Robust test: `TIER_KEYS.every((k) => researched(sim, k))`. `tierCounts` all 4 can lie: the
  `research {tiers}` cheat skips prerequisites (`['land4']` alone gives 4). M37 note: clean-up crews stay outside the tier count.
- Gates to copy: `ProjectRequirement` kinds `population|education|civic|visitors|research` (`src/data/projects.ts`); `research`
  takes ONE `key`; the context is built twice (`projectRequirements` in `systems/projects.ts`, `Toolbar.tsx` from
  `st.war.research.done`), and the balance mayor calls `projectBlocked`. Hard gates: `civicLock(sim, id)` and `unitLock(sim, kind)`.
- Friends' progress is already reported: `RegionReport.tiers` (six counts, war cities) → `PlayerNeighbour.tiers`, drawn as bars
  by `RegionMap` (`Battle.tsx`, `map-tiers-<id>`); `Dossier.tiers`. A computer neighbour has only `RivalNeighbour.tech` 0–4.
- Missing for M40: an "all 24 done" helper or requirement kind; a bomb unlock flag; a clean-up `EffectKey` (logistics has
  `repair`, `repairMend`, `storeCapacity` but nothing that shrinks contamination).

## 2. The six superweapons and the dome
- The six are the tier 4s: units `windupbot`, `skyfortress`, `clockworkwhale` (`UnitDef.super {cooldown, routes}`; one per
  city, never lost, `Unit.ready`), buildings `domeshield`, `blackouttower`, `expressgate` (`military.superweapon:
  'dome'|'tower'|'gate'`). The only list of six is the client's `SUPER_SLOTS` (`Military.tsx`). Built building:
  `superBuilding(sim, kind)`; working: `superWorking(c)` (online, staff >= 0.25, powered >= 0.5).
- `WarState.supers?: Supers` (`systems/supers.ts`): `dome? {hours, mode 'all'|'super'|'off', reserve?, raised?}`, `tower?`, `gate?`;
  survives the building's loss. `DOME` (`research.ts`): `chargeHours` 240, `pool` 40,000, `reserveHours` 4 and **`bombRecharge`
  1,440, defined and read nowhere** (checked: no reader).
- `domePool(sim, bringsSuper)` (pure read), `raiseDome` (event `domeRaised`), `lowerDome` (clears `raised`, `hours = 0`, i.e.
  240 h), called from `startHomeBattle`/battle end in `raids.ts`; `layout.dome` soaks damage in `Battle.damage`, pool spent =
  `{k:'dome'}` → `domePopped`; `coverWithDome` for battles made elsewhere (the target's sim decides, never the sender's save).
  `mode: 'super'` is documented as "for M40's bomb". Blackout stops charging (4 h reserve, then `domeFell`). UI/effects:
  `SupersSummary.dome`, `setDome` (needs `defence`), `SuperEffects` (`render/shields.ts`, `popAt`), tip `dome`.
- Missing for M40: any bomb path through the dome (a bomb is not a `Battle`); a "down for long" marker (down is just
  `hours < chargeHours`, so 1,440 needs a new field and a save bump); a "bomb stopped" event; the rule: stops one bomb whole,
  or soaks a yield against the 40,000 pool.

## 3. Buildings, projects, costs
- `CIVIC 'nuclear'` (`src/data/civic.ts`: power, 56x64 m, $140k, upkeep $3,200, 6,000 MW, `unlockPopulation` 40,000) is a plain
  producer: no staff, fuel or research gate. No "plant running" helper: `civicOnline(c)` plus `civicOutput(sim, c, 'power') > 0`
  (the requirement kind `civic` only checks the building is finished). `sabotageTarget(sim, 'power')` finds the biggest online plant.
- Defs: `MILITARY_DEFS` (`src/data/war.ts`) pushed into `CIVIC`; `MilitaryInfo` (`jobs`, `power`, `lab`, `agency`, `shield`,
  `superweapon?`...). Template = `domeshield`: category military, dept defence, `cost: 0`, `unique`, `requires: 'militaryhq'`,
  `unlockPopulation` 20,000, a `project` of 3 stages (3+4+3 months, $1.6M–$2.0M in all; each cost paid as the stage starts).
- `placeCivic` → `checkPlacement` order: `scenarioForbids`, war on, `civicLock` (military), treaty `standsDown`, terrain,
  `unique`, `requires`, overlaps, road access, `unlockPopulation`, `projectBlocked`, money. Co-op: military needs `defence`,
  a `project` also `projects`. The Military toolbar shows only with war; `.project` defs render as `ProjectButton`.
- Projects (`systems/projects.ts`): `Civic.build {stage, months, waiting, clock?}`; short treasury sets `waiting`/`projectWaiting`
  (sandbox skips). `warProject(def)` = `project && military.superweapon` adds `clock: stageClock(sim)` so stages also wait for
  the war clock (fair clock); widening it drags in every `'dome'|'tower'|'gate'` union (`SuperBuilding`, `civicLock`,
  `buildingRefusal`, the `supersHour` loop). Unfinished: not online, no upkeep, `damageCivic` and `projectsMonth` ignore damage.
  Finish emits `projectDone` + `chronicleEvent(sim, 'project', def)`; the `finishStages` cheat skips the chronicle. Bulldozing
  refunds 25 % of accumulated `c.cost`: huge at M40 prices.
- Money scale: tier 4 $400k each; superweapon units $1.5M–$1.6M; buildings $1.6M–$2.0M. For "several years of a big city's
  income" take `monthlyTaxes(sim)` (`diplomacy.ts`) x 12 x k; probes `scripts/dev/econ.ts`, the 100k bench city.
- Missing for M40: `enrichment`/`atomsilo` defs (`w`/`d` must be 48x40 and 40x40 to match the models); a build of years, not
  10 months; the all-24 + running-plant requirement; one bomb per city; ore/oil in `ProjectStage` (it has `name`, `months`,
  `cost` only); a refund rule.

## 4. Units, materials, the bomb as a thing
- `UNIT_DEFS` (`src/data/war.ts`): `cost`, `goods`, `ore`, `oil`, `power`, `hours`, `upkeep`, `model`, `stats`, `research`;
  superweapon units take 360 h, ore 800–1,500, oil 600–1,200. **No `atombomb` kind**: only `LATER_UNITS = { atombomb: 'air' }` and
  `UNIT_PARTS.atombomb` (`src/models/unit.ts`) for the model check; `tests/warModels.test.ts` asserts `later` is `['atombomb']`.
- `unitBill(sim, kind)` (`systems/war.ts`) = money + stock first + shortfall imported (`WAR.materials.importPrice` ore 36, oil 55,
  ledger `warImports`). `WarState.stock {goods, ore, oil, munitions}` fills hourly (`warSupplyHour`) to `storeCapacity` (ore 150, oil
  150 + arms factories) from arms factories and half of each mine/well (`resourceShare`); only `trainUnit` spends it, so a bomb's ore
  and oil would be bought almost wholly as imports. `sync.ts` hashes stock.
- Training: one order a base; forces take at most a quarter of the workers (`WAR.enlistShare`); staffing rank HQ, training
  bases, trials, labs/superweapon buildings/agency (`militaryStaffing`); power `serveMilitary`. Trials (`startTrial`) are
  units only. One superweapon per force (`superRefusal`), a base keeping one can't be bulldozed (`baseKeepsSuper`).
- Missing for M40: the bomb as a `Unit` (fits one per city, not force/route/battle) or its own `WarState` entity; ore/oil for
  buildings; a launch-preparation timer; drawing it (`render/units.ts`, `unitPoses.ts`: poses from the display clock only).

## 5. The region room, reports, protocol
- One fact's path: `regionReport(sim)` → `RegionLink.reportNow` (every 30 s) → `parseRegionMsg`/`cleanReport` (`relay/region.ts`,
  builds field by field: an unlisted field is dropped) → `City.report` → `broadcast()` of `RegionView` → `regionUpdateFor`
  (`regionLink.ts`) → page-only `regionUpdate` → `applyRegionUpdate` → `PlayerNeighbour`. An optional field like `tiers`/`counter`/
  `coast`/`clock` touches those plus `RegionReport`, `RegionCity` and the UI (`RegionMap`, `NeighbourCard`); older rooms and pages
  drop it silently, so no message and no bump.
- Announcing: `notice` `{t:'notice', text}` goes to every connection of any protocol (toast only, `RegionLink.onNotice`).
  `FriendsWar.event(...)` (private) appends to `RegionMeta.history` (`FRIENDS.history` 100; `WarEventKind` is declared, opened,
  battle, ceasefire, treaty, capitulated, vassal, freed, hold, broken, ended) and sends `{t:'history'}` via `fwSend` to protocol >= 6
  only. Siren precedent: `incoming` → `RegionLink.onIncoming` → `Game.notice(..,'bad')` + `audio.play('raid')`. `Game.notice` merges
  by `kind` in the log (60 s) and toasts once per 20 s per kind (not per id).
- Rules: `RegionWarRules {war, scale, supers?: true}` (`src/data/war.ts`), host-only `rrules`. A new flag copies `supers`: stored only
  when true; `cleanWarRules`, `sameWarRules`, `warRulesText`, `parseRegionMsg` (`rhello`, `rrules`), `RegionMeta`/`RegionView`/
  `RegionUpdate.rules`, `regionUpdateFor`, `applyRegionUpdate`, UI `RegionWar` (`region-war-supers`). Sim gates `warScaleAllowed`
  (`options.rivals` alone = `'total'`), `superweaponsAllowed`; room gates `FriendsWar.declareRefusal` (`SCALE_RANK`, shields,
  `FRIENDS.cooldown` 72 game hours).
- **Protocol (checked, one reader had 5): `PROTOCOL_VERSION` is 6.** `RegionRoom.hello` refuses `v < 5 || v > 6`. An unknown client
  message hits `parseRegionMsg` `default: return null` → `reject('bad-message')`, which CLOSES the sender: new messages need a
  version gate or must ride existing ones. `relay/room.ts` (co-op) demands `v === PROTOCOL_VERSION`, so a bump to 7 locks v6 pages
  out of co-op rooms. `REGION_LIMITS` (`supersPerDay` 1, `opsPerDay` 4, `dailyRows` 3000).
- The room keeps the truth for friends and pages mirror it by idempotent page-only commands (`friendWar`, `friendTreaty`,
  `friendPacts`, `w.taken`). Regions are NOT lockstepped: each city runs alone; coupling is reports, `regionUpdate`, the fair clock.
- Missing for M40: a race field in the report; a bomb rule; a room diff announcing "X has begun enriching fuel"; a permanent
  region record (the ring evicts at 100); a strike path for friends; a shared signal for winter and fallout.

## 6. Spies and sabotage
- `SpyOp` reveal/sabotage/steal (`src/data/intel.ts`; sabotage needs `intel2`, $45k, 16 h); `SabotageTarget = 'power' | 'depot'`;
  `spyOdds`/`spyOutcome` shared by sim, room and `Intel.tsx`. State `WarState.intel` (`Mission`, `theirs`, `stolen`); `intelHour` on
  the war clock. `counterIntel`/`rivalCounter` have no per-building term. `INTEL` holds the sabotage durations and the caught costs.
- Against a computer neighbour (`resolveMission`): effects in `RivalIntel` as war-clock hours; sabotage is a strike (`strikeRefusal`,
  `info.breaks`). Against a friend: `friendSpyRefusal`; the agent waits `arrived`; `RegionOps` (`client/ops.ts`) pins it and calls
  `RegionLink.sendOp`; the ROOM rolls (`RegionRoom.op`, `opRefusal`: harm needs the target online, 1 sabotage/day, 8 pending);
  the target's page applies `opResolve` once and its own sim picks the building (`sabotageTarget`, `damageCivic`; `late` = notice only).
  Their spies (`intelMonth` → `TheirSpy` → `resolveTheirs`) pick `rng.chance(0.5) ? 'power' : 'depot'`.
- Hard-coded `'power'|'depot'`: `relay/region.ts` (`op` case), `commandCheck.ts`, `intel.ts` (`missionRefusal`, `TARGET_NAME`,
  `resolveMission`, `sabotageTarget`, the `intelMonth` pick), `regionOps.ts` (`checkOpInput`), `Intel.tsx` select, `regionLink.ts`
  types, `commands.ts`, relay op tests. A target an old room doesn't know closes the sender's connection (see 5).
- The room sees report numbers only, never buildings: it cannot know a plant is under way unless the report says so, nor weigh a
  guarded plant unless `report.counter` folds it in. `dossierOf` skips unfinished civics (`c.build`); `checkDossier` whitelists `supers`.
- Missing for M40: a delay effect on a plant under construction (`build.clock += hours` works for `warProject`s only; else
  `months`); enrichment state on `RivalNeighbour` for a rival's delay; a computer spy using it; dossier lines for the race.

## 7. The strike: warning, flight, impact
- Warning (`systems/raids.ts`): `WarState.incoming: Raid[]` with `warn`/`arrive`; `raidsTick` → `warnRaid` (event `raidWarning`,
  `shelterCount` = residents within 600 m of the target); `warningHours` = `WARNING.base` 1 + 3 per radar, max 6. Only ONE raid
  reaches the UI (`incomingSummary`, `WarSummary.incoming`; `RaidChip` `raid-chip`/`raid-eta`; tip `raidComing`). Evacuation is a
  count plus `raidMood` (a 3-day dip). Sounds: `siren`, `raid`, `alert`, `whoosh`, `boom`; no repeating siren.
- Nearest impact: the meteor (`systems/disasters.ts`): `Disaster {kind, x, z, start, end, size}`, `meteorImpact` at `fallTicks` 30
  collapses buildings within `size` (private `collapse()` → `toRubble`), ignites out to 2.2x, removes/damages civics, `roadDamage`,
  `clearTrees`, `Crater {x, z, r, tick}`; radius 28–48 m (quake about 650 m). `DisasterKind` = earthquake|tornado|flood|meteor
  (consumers: `randomDisaster`, `disasterReach`, `DISASTER_INFO`, Toolbar menu, `game.ts`, `commandCheck`). War route:
  `applyWarDamage` (caps live in the battle). Helpers `buildingsNear`, `civicsNear`, `segmentsNear`.
- `toRubble` zeroes `pop`/`sick`/`employed`; a home's `pop` IS the population (`totals.ts` is derived), so rubble removes residents
  with no casualty count. Growth re-spawns on zoned empty lots; civics removed stay gone.
- Render precedents: meteor `fireball`/`flash` Points (`DisasterRenderer`), `BattleEffects` puffs (`MAX_PUFFS` 400), planes/ships
  (`render/ports.ts`), expedition units (`units.ts`). Map 2048 m; neighbours on north/south/west only.
- Friends as targets: the tower/blackout is the template for a room-decided strike (`supers.tower.charging {slot, op, settling,
  kept}`, `RegionRoom.op` → `opKept/opRefused/opOn/opSeen`, `opResolve` once); superweapon battles are capped by `supersPerDay` 1;
  `strikeRefusal` + `SUPER_STRIKE {relation -40, allies -10}` price a superweapon strike. Forces and friend spies refuse when `sim.shared`.
- Missing for M40: bomb state, flight and countdown (one `incoming` only); a launch command and `NEED` role; a total-war check
  (`fightingWith(sim, id)` with `war.scale === 'total'`); a very wide impact function; the room path for a friend; behaviour for an
  offline or absent (p2p) friend; the mushroom cloud, flash and ring.

## 8. Fallout, wind, maps, health and mood
- Raster template: `airPollution`/`groundPollution` are `Float32Array(GRID_RES^2)` (128 cells of 16 m), saved (`encodeValue`),
  hashed in `sync.ts`, migrated (`zeros`). `updateAirPollution` (every 3rd hour): `splatField`, drift by `windAngle(seed, tick)` x
  `ENVIRONMENT.windCells`, diffusion, `DMath.pow` decay, tree/park absorption; cells off the map read 0, so no edge flux is counted.
  `windAngle` is pure from the CITY's seed: every city of a region has its own wind. 20 years of decay = 12 h of play at 1x.
- Data map: `OverlayMap` union + `computeOverlay` switch (`systems/overlays.ts`, no default) returning `{map, values, ramp, legend}`;
  ramps `diverging|sequential|traffic` (a hazard ramp touches `OverlayResult`, `rampColor` in `client/overlay.ts`, `MapLegend` in
  `Toolbar.tsx`); menu `MAPS`; the client polls once a second; `lockstep.test.ts` lists maps literally.
- Build/zone bans have three choke points, all new work: `zone()` (`actions/zoning.ts`), `checkPlacement`, `growthPass`/`lifecycle`
  upgrades. NOT `cellStaticValid`/`revalidate` (it destroys buildings). Roads obey no dynamic rule today; the clean-up building must
  be exempt. `scenarioForbids` is scenario-only.
- Sickness `sicknessRate` (`health.ts`, `HEALTH.airRate`...; untreated sick die and leave). Mood: `happinessFactors` pushes labelled
  terms ('Polluted air', 'Tired of war'); `totals.ts` adds city cheer terms (`raidMood`, `warCheer`...): a `bombMood` is one more.
  Move-outs follow happiness with no new path (`growthPass`, `GROWTH.moveOut`, `distress` → abandon → rubble). `landValue.ts` reads rasters.
- Productivity: no per-building multiplier. Output follows `b.pop` (`buildingTax`, `runFreight`, `specialisationIncome`): one
  `radiationWork(sim, b)` helper at those sites. `researchEffect`/`spinoff` are the 1-or-0 hook pattern.
- Neighbours: a computer one is a record (`side`, `population`, `trend`; `regionMonth`), so drift into it is an edge lookup by side;
  a friend is another sim, so flux must be room-forwarded and applied by a page-only command.
- Missing for M40: the raster (save field, migration, checksum), the map, bans, health/mood/productivity terms, edge-flux accounting,
  clean-up crews (building or project, ledger, shrink rule), a tip.

## 9. Nuclear winter
- `SimState.weather` (`systems/weather.ts`; `offset`, `temp`, `mean`, `kind`, snow, optional `grace`); `CLIMATES`, `WEATHER`
  (`data/climate.ts`). `monthMean(w, tick)` = calendar mean + `offset`; `nextSpell` rolls `sim.rng.weather` and turns rain into snow at
  `monthMean + offset <= WEATHER.snowBelow` 1 °C. **`disasters.ts` `riverFlood` draws from the same stream**: a winter must add no
  draws when inactive, only change values.
- Single readers to hook: `monthMean` (colder: heating via `weatherUse`, snow, melt via `temp`), `solarShare(w, tick)` (only solar
  reader, used by `civicOutput`) with `WINTER_SKY` in `utilities.ts` (the forecast constant), `nextSpell` weights. `region.ts`
  `capacity()` already reads `coldness`. The look comes from the calendar (`worldLook` in `render/weather.ts`): an all-year winter
  needs a `weatherSummary` field. `checksum` in `sync.ts` hashes only `weather.temp`; `partHashes` cover every key.
- No shared sky: each sim has its own weather and seed, so the start must reach friends by a room-forwarded page-only command
  (`friendWar`/`warClock` pattern), computer neighbours have none. A game year is 36 min at 1x.
- Tools: cheat `weather {kind, strength, hours}` (`setSpell`) is the template; test API `setWeatherLook`, `getWeather`;
  `tests/weather.test.ts`, `winter.test.ts`, `weathershot.mjs`.
- Missing for M40: `WeatherState.winter?`, `winterDepth(w, tick)` with ramps, its command/cheat, the look, forecast alignment, a tip.

## 10. Diplomacy
- Reputation `Diplomacy.reputation` (0–100, start 60), `reputationChange`; declare -5, `breakPact` -30, caught spy -5; mends +1 a month
  up to 60 (`diplomacyMonth`). Readers: `weigh()` ((rep - 60)/4 on every treaty), `sanctionCause` ('reputation' below 25),
  `diplomacySummary`. Never in a report (friends can't see it). "Collapses for good" needs a pinned state and ONE accessor.
- Embargo: the `embargo` Term is bilateral; unilateral = M38 `WarEconomy.sanctionedBy[id] {since, cause, last}`, `SanctionCause`
  'broke'|'ally'|'reputation', `sanctionsPass` only where `hasTies`, `cutTrade`, `sanctionText`. Pacts `d.pacts`: `endPactsWith`
  (a neighbour ends them, no breach), `breakPacts` (the city's, -30); friends' pacts live in the room (`FriendsWar.dropPact`, private).
- Declaring: sim `declareRefusal` (`d.ended[to]` vs `DIPLOMACY.cooldownMonths` 3; `warScaleAllowed`), room `FriendsWar.declareRefusal`
  (`FRIENDS.cooldown`, shields, pacts need `breakPact`); computers in `computerMoves` (aggression, relation <= -25, forces >= 1.5x,
  cooldown, pacts). "No usual cooldowns" = skipping both cooldown checks for a bomb owner.
- Deterrent: `weigh()` and `computerMoves` read `cityStrength` only. A fallen city (`conquer`, vassal) is not permanent collapse.
- Missing for M40: the pariah state, a 'bomb' sanction cause without `hasTies`, a flag the room honours (cooldown skip, pact drop),
  the protest term, changed computer declarations, deterrent maths.

## 11. Computer neighbours and difficulty
- `RivalNeighbour {personality, forces, defences, relation, allies, vassal, blackout, tech, techAt, intel}` (`systems/region.ts`);
  no buildings. `tech` advances in `intelMonth` only once the city has `war.research` (chance `INTEL_TECH.chance` 0.06 x character x
  size, dice `${seed}:tech:${month}`, 12 days apart, event `rivalTech`); consumer `ai/tech.ts`; tech 4 does nothing extra.
  "Computer neighbours bring no superweapons" (`startHomeBattle`). An optional field here needs no migration.
- `WAR_DIFFICULTY[easy|normal|hard]` (`src/data/warEconomy.ts`: `arming`, `raids`, `aggression`, `terms`, `weariness`) via
  `warDifficulty(sim)`; Normal must stay M37's war to the bit. A new draw in the `intelMonth` loop shifts later rivals: use its own
  stream (`${seed}:bomb:${month}`). `applyRegionUpdate` swaps computer neighbours for friends one for one.
- Missing for M40: a Hard bomb flag, a rival race clock (delayable by spies), a late/rare attempt and launch rule, a balance line.

## 12. The record forever
- City chronicle: `ChronicleEvent {tick, kind: milestone|disaster|project|election, ref}`, ring `CHRONICLE.maxEvents` 300 (oldest
  dropped), written only via `chronicleEvent`; `eventLabel` (`History.tsx`) and `TimeMarker.kind` (`charts.tsx`) are closed.
- Region: `RegionMeta.history` ring 100, closed `WarEventKind`, `KINDS` + `HISTORY_GROUPS` in `client/regionHistory.ts`, UI
  `RegionAtWar`; replays ring 20. Achievements: `ACHIEVEMENTS` (12) + `CHECKS[id](sim)` in `progress.ts` (missing key throws);
  "first in the region" is the room's fact, so it returns as a flag or page-only command.
- Missing for M40: a chronicle kind and region record outside both rings, a history line, the achievement and its carrier.

## 13. Models and render
- Present and checked: `assets/models/war/{enrichment,atomsilo,unit-atombomb,unit-bomber}.glb`; generated looks `enrichment()`,
  `atomsilo()` (`render/assets/militaryModels.ts`, `MILITARY_SITES`); `WAR_ALLOW`, `light` role. Building models are static, so the
  silo hatches need render code. Effects: `SuperEffects`, `BattleEffects`, meteor Points; quality switches per effect (SPEC-3).
- Missing for M40: `atombomb` in `UNIT_DEFS`/`handmade.unit`; flash, cloud, ring, flight trail, radiation colours, winter look,
  countdown on the map; a cost switch for each; a frame-time view (Mac only).

## 14. Tests, goldens, shipping
- Must not move: `tests/fixtures/war/peace-main.json` (no `war`, no always-present new key; fallout/winter inert without war),
  `m36-war.json` (mocks `SAVE_VERSION` 29; rewrite deliberately with `GOLDEN=write` and a DECISIONS entry), `battle-v2.json` and
  `stampBattle`, `v30-war.json`, `legacy/names.test.ts`; peace `balance.ts 20 careful` must diff line for line.
- Save: add `migrations[31]` or every legacy load throws; new state optional, made on first use. Test shape `saveV31.test.ts`.
  **No `v31-war.citybloom` fixture exists** (only v29, v30): save one from the M39 tip before M40 changes behaviour.
- Cross-browser: `runDeterminism` (`tests/lockstep/determinism.ts`) is now compared in both browser tests for months, editor, scenario,
  war, battle, diplomacy, research, economy, live, friends, refused (M39's gap is closed); add a town of its own (`atomSim`). Every new
  command kind must be used (`ALL_KINDS`, `COMMAND_KINDS`, `CHECKS`/`PAGE_ONLY`, a `SAMPLES` entry, `NEED`); `DMath` only.
- Cheats (test mode): `addMoney`, `unlockAll`, `ignite`, `weather`, `researchPoints`, `research`, `spyIn`, `rivalTech`, `offer`,
  `finishStages`, `superReady`, `unshield`, `fall`, `proposal`, `rival`, `raidIn`, `electionIn`. Helpers `labTown(0, {length: 800,
  streets: 7})` (staffs dome/tower/gate/agency), `economyHelpers.ts`, `liveHarness.ts`, `friendsHarness.ts`, `RegionRoom` + `loopTo`,
  `friendTakesPlace`. E2E template `e2e/m37-super.spec.ts` (10–20 min; four shots: countdown, cloud, radiation map, winter).
- Process: DECISIONS "M40", `docs/SPEC_REVIEW.md` rows, `DESIGN.md`, PROGRESS (tick M40, Mac checks), README War section (no bomb
  text yet), a tip per screen (unique ids), `M40 complete:` commit joining the open PR.
- Missing for M40: all of it for the bomb; a probe for rival progress.

## Open questions for the design
- Is the bomb a `Unit` (one per city, trained at a base) or its own entity with a launch timer, and how does it avoid `Battle`?
- Are `enrichment` and `atomsilo` projects (widen `warProject`) or buildings with their own progress counter, in months or years?
- Must the unlock be all 24 tiers done, or also the six built (fails where supers are off)? New requirement kind or `civicLock`?
- How are ore and oil charged to a building (stage field, monthly draw, imports), and what ends the 25 % bulldoze refund?
- What does the report carry for the race, and does the room diff it into a `notice` or a `history` line?
- Can a spy delay a plant under construction (new `SabotageTarget`, protocol gate, report field), and by how much?
- Does the dome stop the bomb whole or soak a yield against 40,000; where is the 1,440 h downtime stored?
- Which clock runs the countdown and flight (tick, war clock, the room's), and what of an offline, absent (p2p) or paused friend?
- A strike on a friend: a room-decided op like the tower, a new message (protocol 7), or riding `battle`?
- Can a shared co-op city own or fire a bomb, and which role launches it?
- Fallout half-life against play time (20 years = 12 h at 1x), and does it tick while the fair clock holds a region?
- How does fallout enter a neighbour (edge flux by `Neighbour.side`, room-forwarded for friends), and from whose wind?
- Stay buildable on contaminated ground: roads and clean-up crews? How much does a crew shrink the zone, at what cost?
- Does winter change values only (no new `rng.weather` draws), and how does a friend's city learn its start?
- What makes reputation "collapse for good" against the monthly mend and the cap of 60?
- Do computers embargo through a new sanction cause, and do pacts break at launch or at the first strike?
- What are "no usual cooldowns" for friends: a report flag the room honours, plus a sim-side skip?
- What does a Hard computer neighbour do: an abstract race clock, which gate, and does it ever launch?
- Where is "forever" kept, and what carries the first-finisher achievement?
- Does a region rule turn the bomb off by a new `RegionWarRules` flag (default on or off?), and what does a built bomb do when it flips?
