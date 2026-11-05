# M40 The final race: the atom bomb: design

The brief (SPEC-5.md, M40): one last prize cities race for, very hard to get and terrible to use. It unlocks only with every
research branch maxed, and needs a running nuclear plant, a slow, dear and public enrichment plant, a silo and a bomb priced at
several years of a big city's income. The region sees each city's progress; spies and war can stop it; the first to finish gets
an alert and an achievement. The region's rules can turn it off; it needs a declared total war and a long preparation. A missile
crosses the region with sirens and a countdown; a charged dome stops one; a hit levels a wide radius. After it: fallout (a
radiation map, nothing built for decades, drift into neighbours, costly clean-up), a nuclear winter on every city, a reputation
that never recovers, ended pacts, a protest at home, and a record that stays. Toy look, no gore, no casualty counts.

Done when scripted tests show: the unlock and the race across the region; a spy delaying the plant; a dome stopping one bomb; a
hit levelling the radius; fallout that blocks building, drifts downwind into a neighbour and fades; the winter reaching every
city; reputation, pacts and approval turning. Also an e2e through the real UI with four screenshots (countdown, cloud, radiation
map, winter) and a cross-browser section covering the strike and the fallout's spread.

Code map: `docs/plans/M40-codemap.md`; reasons as made: DECISIONS "M40". Time: a tick is a game minute, a "month" a game day
(3 min at 1x), a game hour 7.5 s, a game year 12 months (36 min). "War hours" are the war clock's (the fair clock holds it to 1x).

## What the code check changed (these corrected the earlier drafts)

- **Fallout cannot be one drifting raster.** `updateAirPollution` shifts the whole field each 3 h update along `windAngle`, a
  near-constant bearing: at 0.35 to 0.6 cells it empties the 128-cell map in 2 to 4 game years (a ban needs 18), at the
  smoke's 2.5 in days. Two layers (call 11).
- **The impact is not a meteor `Disaster`:** meteors have consumers (`impactTick`, the fireball in `DisasterRenderer`, advisors,
  `maxActive` 3, a 'disaster' chronicle line) and `collapse()` raises an ambulance and a casualty per home. `applyWarDamage`
  already calls `toRubble`, `ignite` and `damageCivic` with no Disaster; so does the bomb (call 10).
- **The bomb is not a `Unit`:** `UnitKind` is closed (`BUILDERS: Record<UnitKind, …>`, every `UNIT_DEFS` loop, `trainingFactor`,
  `militaryStaffing`'s training rank, `baseRemoved`). Own state, with `unitBill`'s materials code shared as `materialBill`
  (call 6); `handmade.unit` takes any string.
- **`civicLock` is reached only from `checkPlacement`; the Toolbar decides from `project.requires`; `projectBlocked` is skipped
  in sandbox.** So a hard gate in `civicLock` plus two requirement kinds for the tooltip (call 2).
- **No `rwelcome.v`:** `RegionRoom.hello` refuses `m.v > PROTOCOL_VERSION`, so a page on 7 never meets a room on 6. The only gate
  is the room's: refuse anything aimed at a city whose connection has `st.v < 7` (calls 16 to 18).
- **`nextSpell`:** a clear spell skips the strength draw (3 draws, otherwise 4) and lengths differ per kind, so draw totals at a
  tick differ in a winter. Weights stay. **Dome downtime** is a new field (`checkDossier` rejects a negative `hours`). **Speed:**
  `LiveBattles.keepRunning` only lifts a pause; a bomb drops the game to 1x once and leaves the buttons alone (call 8). **Reputation** is raised only by
  `diplomacyMonth`'s mend (the other writers lower it). **`shelterCount`** is private and keyed to a `BattleTarget`. The v31
  fixture goes in `tests/fixtures/war/` beside v29 and v30.

## Calls

1. **State: `WarState.atom?`, made on first use; the stage is derived.** Facts: `fuel` (war hours, 0 to 1,152), `bomb {done, paid}`
   (the build), `have?` (the finished bomb), `prep {done}`, `fired {tick, to, name, slot?}`, `inbound {from, name, slot?, warn,
   arrive, x, z}`, `impact {done, fled, x, z}`, `first?`, `boom`, `stopped`. `atomStage(sim)` is the first unmet step: none, plant
   (placed), enriching (plant online, fuel above 0), silo (placed), bomb (being built), ready, preparing, flying (`fired`, not
   landed), spent. One bomb ever: `fired` blocks every later plant, silo and bomb. Losses: a plant removed (destroyed, never
   bulldozed) halves the fuel; a silo removed loses the bomb and the preparation; war damage only closes a building, which
   pauses fuel, bomb and preparation and restarts the preparation. Bulldozing a silo holding a bomb or a build is refused (as
   `baseKeepsSuper`). Not a Unit, not a Battle, so `stampBattle` and the battle goldens cannot move. Code: `src/data/atom.ts`
   (`ATOM`), `src/sim/systems/atom.ts`.
2. **The unlock: one hard gate, one display row.** `allTiersDone(sim) = TIER_KEYS.every(k => researched(sim, k))` (never
   `tierCounts`: the `research` cheat gives 4 for `['land4']` alone); "all six superweapons" means their tier 4 research, which
   M37 kept allowed with superweapons off. `atomLock(sim, id)` is called from `civicLock` (sandbox cannot skip it) and refuses
   with the first missing step in words ("Needs every research branch maxed (21 of 24 done)"): the rules allow the bomb (call 3);
   no scenario (it refuses whenever `sim.state.scenario` exists, so the three war scenarios and their goldens stay); not already
   spent; for the plant, a nuclear plant with `civicOnline` and `civicOutput(…'power') > 0` (`nuclearRunning`); for the silo, the
   plant online; for the bomb, fuel 1 and a working silo. For the Toolbar tooltip `ProjectRequirement` gains `researchAll` and
   `civicOnline` kinds built from the same two functions through the one `requirementStatus`. Co-op: `defence` and `projects`.
3. **Region rule `bomb`** (copy `supers`: stored only when true; `cleanWarRules`, `sameWarRules`, `warRulesText`, `parseRegionMsg`
   for `rhello`/`rrules`, `RegionMeta`/`RegionView`/`RegionUpdate.rules`, `applyRegionUpdate`, checkbox `region-war-bomb`). It
   stands only with `scale: 'total'` **and** `supers`: the dome is the one counter, and a bomb nothing can stop is not the design.
   The host's UI ticks both by default when total war is chosen and may untick. `bombAllowed(sim)` = the region's `rules.bomb`, or
   `options.rivals` in a city of its own. Flipped off mid-race, stages idle (as an idle dome), `launchBomb` is refused in plain
   words, a strike the room kept stands. Old regions have no flag and read "off".
4. **Plant and silo are war projects.** `MILITARY_DEFS` `enrichment` (48 x 40 m) and `atomsilo` (40 x 40 m, the models' sites):
   military, dept defence, `unique`, `requires: 'militaryhq'`, `unlockPopulation` 40,000, `military.atom: 'plant' | 'silo'` (a
   separate field: the `'dome'|'tower'|'gate'` unions stay), `warProject` widened so stages wait for the war clock. Plant: 3
   stages of 5, 6, 4 months, $1.1M, $1.5M, $1.0M; 120 jobs, 1,500 power, $12,000 upkeep. Silo: 4, 5, 3 months, $0.9M, $1.3M,
   $0.9M; 80 jobs, 500 power, $8,000. Staffing: the superweapon buildings' last rank. A short treasury sets `waiting`. New
   `CivicDef.refundShare: 0`, read by `bulldozeCivic` (a 25 % refund of millions would be a bank). The plant shows on every
   region map the day it is placed (call 16). The Military toolbar shows both when `bombAllowed`.
5. **Fuel.** `atomHour(sim)` in `warClockHour` after `supersHour`. With the plant `superWorking`, `nuclearRunning`, `bombAllowed` and
   no blackout: `fuel += staff x powered x min(1.25, fundingEff('defence'))` a war hour, to 1,152 (4 game years, 144 min of
   play), at $2,000 a war hour on ledger line `enrichment` (charged only while it works). Down for any reason it waits and the
   Bomb tab says why. Fuel already made is kept.
6. **The bomb build.** `buildBomb` (role `defence`) needs fuel 1, a working silo, `bombAllowed`, no bomb yet. It runs 720 war hours at
   the silo's rate (staff x powered x funding) and is paid in **12 instalments** (at 0, 60, 120 … war hours): $650,000, goods 50,
   ore 200, oil 167 each, from `WarState.stock` first and the rest imported at `importPrice` (ledger `warImports`, through the
   shared `materialBill`). So mines and wells (M10) cut the bill, the stores refilling between instalments, and the treasury need
   not hold the sum at once. A missed instalment waits (as a project). `cancelBomb` stops it: instalments paid stay spent.
   Completion sets `have`, event `bombReady`, a chronicle line and the first-finisher check (call 16). Sandbox skips money, not
   the gate. `trainUnit` and `UNIT_DEFS` are untouched.
7. **Launch.** `launchBomb {to}` (role `war`; in a shared city the host alone, one line in `roomRefusal`, no fourth permission,
   because it cannot be undone) needs `have`, a working silo, `bombAllowed`, a neighbour as target, `fightingWith(sim, to)?.scale
   === 'total'` (a ceasefire pauses it; for a friend the mirrored `war.friend` open and total) and the city neither vassal nor
   neutral. It pays $1.2M and starts `prep`: 288 war hours at the silo's rate, restarting if damage closes the silo.
   `cancelLaunch` refunds half. A prepared bomb waits as long as it likes (the deterrent). At the end of `prep` the sim fires: a
   computer target gets `fired` and `inbound` at once (call 8); a friend needs the room (call 17), the bomb leaves only when it
   keeps the strike, and a refusal leaves it prepared (`launchBomb` sends it again). A shared city fires only at computer
   neighbours (it cannot stand in a region). The log and the card name who fired.
8. **Flight, warning, countdown (the target's sim owns its city).** `inbound` lands 24 game hours (1,440 ticks, the city's
   own clock, not the war clock) after it is accepted (3 min at 1x), ground zero fixed then (call 10). `atomInboundTick`, beside `raidsTick`, warns at once: event `bombWarning`, the
   `siren`, `sheltersWithin(sim, x, z, r)` (a radius variant of `shelterCount`) and `raidMood`. `incomingSummary` returns the
   bomb before any raid (`kind: 'bomb'`); no raid or battle starts while one is inbound. The warning drops the game to 1x once
   (as a big alert would), but the speed buttons stay the player's: the flight is the target's own clock, so pausing only holds
   it, and the sim runs only while a page does, so nobody comes back to a flattened city (no cap, unlike a live battle, where a
   pause would hold up another player). The card `atom-countdown`: who, ETA, "aimed at your densest district", the
   dome in plain words ("charged: it will stop it, then it is down about 3 hours of play"), the shelter count, **Raise the dome
   now** (when its mode is off), **Look at the missile** (camera follow), **Open the war room**. A two-tone siren every 6 s
   from the audio layer on the display clock, a tick each second in the last 10 s. A treaty does not call a flight off (left out).
9. **The dome stops one bomb whole.** `bombStopped(sim)`: dome built, `superWorking`, `superweaponsAllowed`, mode `all` or
   `super` (the bomb is the superweapon `super` was written for), not `down`, and `hours >= chargeHours` or `raised` (a dome up
   for a battle counts as charged; the battle keeps its own fixed pool). Then no blast, winter or fallout; `dome.hours = 0` and
   the new optional `dome.down = DOME.bombRecharge - DOME.chargeHours` (1,200); `supersHour` counts `down` to 0 (blackout or not)
   and then charges 240: 1,440 in all, as `bombRecharge` always meant. `domePool` returns 0 while `down`; `lowerDome` leaves it.
   Events `bombStopped`; achievement `underTheDome`. A second bomb inside the window lands, as does one meeting mode `off`, an
   uncharged, blacked-out or unstaffed dome. `SupersSummary.dome` and the inspector say "down for N more hours".
10. **Impact: `atomImpact`, its own module, in hourly slices.** Ground zero is the densest 520 m window by population (64 m
    buckets, ties to the lowest cell), chosen by the target's sim on acceptance, never read from a message (`cityCentre` can sit
    in a park). Radius `ATOM.level` 450 m (0.64 km², 15 % of the 2,048 m map). Slice 0: civics inside are removed
    (`removeCivic`, so `baseRemoved` takes a base's units and orders: the one way to lose a superweapon), civics to 1.5x closed
    72 h, roads inside closed 240 h, trees cleared to 1.6x, the `Crater` (r 90 m), fires to 1.5x (nearest first, at most 400, dice
    `Rng.fromSeed(`${seed}:atom:${id}`)`). Each slice after: the first 400 non-rubble buildings inside, by (distance, id), go to
    `toRubble`, adding homes' `pop` to `impact.fled`. Idempotent and resumable from a save (rubble is skipped); no `Disaster`,
    no `rng.*`, no ambulance, no casualty count: the card says "N residents have left the city; M buildings were levelled". An
    open hosted battle makes it wait (at most 12 war hours, then `abandonBattle`, exported, ends it as 'withdrew'; a live
    battle's page takes its existing no-battle path). Afterwards: fallout (11), winter (13), `boom++`, a chronicle line, event
    `atomImpact`. A computer target is a record: population and forces and defences x 0.4, relation -100, `rival.fallout` set,
    `scoreIntel(+60)`, and a region-map flash and cloud mark.
11. **Fallout: a ground layer that stays and an air layer that moves.** `SimState.fallout?: {ground, air: Float32Array (128²), out:
    {north, south, west}, seen, jobs}`, made at the first impact or inflow, hashed only when present. Every 3 h (the
    `HOURLY_AT.pollution + 1` slot, only if it exists): **air** moves `windCells` 4 along the city's `windAngle` (semi-Lagrangian,
    as smoke), diffuses 0.2, loses 0.05 to the ground and decays 0.97; **ground** takes that deposit, diffuses 0.02 and decays
    `DMath.pow(0.5, 3 / 2304)` (half-life 8 game years); below 1e-4 snaps to 0. At impact: ground `min(1, 1.3 (1 - d/720)^1.2)`
    (0.2 at about 570 m) and a plume of 0.3 of that mass in the air over the downwind side. The core reopens after about 18.6
    years (11 h of play at 1x), a 0.3 rim after about 5. **Bans** (ground at or above 0.2) at three choke points: `zone()`,
    `checkPlacement` (roads, bulldozing and clean-up exempt), `growthPass` lots and `lifecycle` upgrades; not `cellStaticValid`
    or `revalidate`. Refusal: "Fallout lies on this ground. Nothing can be built here for about 13 more game years."
    **Effects**, one reader each, 1 or 0 without fallout: `sicknessRate` (+0.04 x dose), `happinessFactors` "Fallout nearby"
    (move-outs follow), `radiationWork(sim, b)` = 1 - min(0.6, 1.2 dose) at `buildingTax`, `runFreight`, `specialisationIncome`,
    `landValue` -0.6 dose. **Map** `OverlayMap 'radiation'` (a `hazard` ramp: `OverlayResult`, `rampColor`, `MapLegend`;
    `lockstep.test.ts` lists maps; air drawn lighter), three legend bands, closed ground outlined, tooltip "Fallout 0.34. Closed
    for about 13 more game years (8 hours of play)". **Clean-up** `cleanFallout {x, z}` (role `defence`): logistics 2 (a struck
    city without it hires **relief crews** at twice the price), $350,000, 96 hours, three at once, radius 128 m, ground x 0.5,
    ledger `cleanup`. Fallout runs on the city's own hours (it is the world, not the war economy).
12. **Fallout between cities: counters, not events.** After each update the outermost two rows or columns of **air** on the north,
    south and west sides are cleared into `out[side]` (cumulative, rounded to 1e-3; the east edge is a sink). A computer
    neighbour on that side gets `rival.fallout = min(1, rival.fallout + delta x 0.6 / FALLOUT.townScale)` (halving each 8 game
    years) and `regionMonth` adds a growth drag (`FALLOUT.townDrag` 0.01 x level: a value, not a draw). A friend: the report
    carries `atom.plume: [{slot, total}]` (the friend on that side, from the sender's `Neighbour.side`); `regionUpdateFor` gives
    each receiver its entries; its page issues page-only `friendFallout {from, total}`; the sim keeps `seen[from]`, deposits
    `(total - seen) x 0.6` as **air** along the edge strip that faces that friend and sets `seen = total`. First sight of a
    sender sets `seen = total` and deposits nothing (a newcomer, or a friend away for the whole drift, is spared); a lower total
    sets `seen` down (the sender went back to a save). Idempotent and restart-safe. The receiver's own wind decides.
    *(Step 10 review, DECISIONS: `seen` only rises, the page gives the first-sight baseline as `base`, and the receiver's
    wind no longer decides.)*
13. **Nuclear winter changes values, never draws.** `WeatherState.winters?: {id, from, depth}[]`. `winterDepth(w, tick)` per
    entry: rise 144 h, hold 576 h, fall 1,008 h (6 game years, 3.6 h of play); entries add, capped at 1.5; a later boom's depth
    is 0.5. Readers: `monthMean` (minus 18 C x depth, **before** the seasons-off early return, so a seasons-off city and a
    weather-off one (intensity 0, no spells) are chilled and dimmed too, with no snow spells); `solarShare` x (1 - 0.55 depth)
    and `WINTER_SKY`'s solar; `nextSpell`'s snow line (`WEATHER.snowBelow` + 6 C x depth, so July rain falls as snow); a heat
    spell drawn in a winter turns cloudy after its draws. `weatherSummary` gains `winter` (0 to 1) for `worldLook` (grey sky, snow
    cover in any month). Step 5 checks every climate with a probe (the highlands' and alpine winters must stay playable:
    heating's extra use is capped so a deep winter cannot ask more power than twice a city's January peak). Reach: a city of
    its own, or the firing city against a computer neighbour: its sim at landing (`startWinter`, id `self:n`). Computer
    neighbours: `regionMonth` drag 0.008 x depth. Friends: call 16. Top-bar badge `winter-badge` ("Nuclear winter, year 2 of
    6, -7 C") and an energy-advisor line ("Solar is down 40 %; heating is up").
14. **The world turns on the firer** (`atomFired(sim)`, when the bomb leaves, stopped or not; a refusal never triggers it).
    `Diplomacy.pariah?: {tick}` and `reputation = 0`; `reputationChange` and `diplomacyMonth` ignore rises while set (a grep test:
    no `src/sim` code adds to `reputation` elsewhere). `SanctionCause` gains `'bomb'`: `sanctionCause` returns it first,
    `sanctionsPass` imposes it on every computer neighbour without `hasTies`, and it never lifts (the cause always holds).
    `endPactsWith` ends every pact and alliance (no -30: the city broke nothing); relation -100, the target's allies -40. A
    computer neighbour declares total war on a pariah with no `ended` cooldown, the forces ratio waived to 0.5x and the
    aggression floor waived (chance `0.15 x max(aggression, 0.5)`), placed so no other path draws differently; the room does the
    same for friends (call 17). **Protest:** a city cheer `bombMood` in `totals.ts` (-0.30 easing to -0.05 over 720 h) for
    approval **and** a per-home factor "Ashamed of the bomb" in `happinessFactors` (-0.25 easing to -0.06): only a home's
    happiness empties it (`growthPass`). **Forever:** `ChronicleEvent.kind` gains `'atom'` and `chronicleEvent` evicts the oldest
    non-atom event, never an atom one (`eventLabel`, `TimeMarker.kind`); the region keeps `RegionMeta.atoms` (call 16).
15. **Deterrent.** While the stage is ready or preparing, `computerMoves` picks scale 'war' instead of 'total' (a value, not a draw)
    and `weigh()` adds `ATOM.deter` to peace and pact terms. A friend is asked, never refused: a pure client `declareWarning
    (neighbour)` ("Brookline has the atom bomb ready. In a total war it may use it. Declare anyway?") in the Diplomacy tab and the
    declare dialog; a computer neighbour nearing its launch line raises "Gravelford is desperate and has the bomb. Offer peace."
16. **The race is public, in the report, with no new message.** `RegionReport.atom?: {stage 1..8, fuel? 0..100, fired?, boom?,
    stopped?, plume?}` through `regionReport` → `cleanReport` → `City.report` → `RegionView` → `regionUpdateFor` →
    `PlayerNeighbour.atom` → `RegionMap`/`NeighbourCard` (pips, a fuel bar, a framed marker once ready). `cleanReport` **drops** a
    malformed `atom` (null would close the sender); `plume` has at most 4 entries. A stage change calls `reportNow`. The room diffs
    stage forward only (a drop, as a silo lost, re-arms it) into a `notice` and a history line, once, at most 8 notices a city a
    day: "Ashford has begun building an enrichment plant", "…has begun enriching fuel" (plant online, fuel above 0), "…has begun a
    silo", "…is building the bomb", "…has the atom bomb" (red alert), "…is preparing a launch". New `WarEventKind`s `race` and
    `bomb` go only to connections on protocol 7 (welcome history filtered by `st.v`). A report with `fired` flags its sender pariah
    in the room too, for a launch at a computer neighbour (a lying report only harms its own city). **First finisher:** the first stage-5 report
    the room sees (arrival order breaks a tie) is the first `RegionMeta.atoms` mark (at most 16: `{slot, name, kind: ready | fired
    | boom | stopped, at, to?}`, outside the 100-event ring, shown first in "Region at war"); that page issues page-only
    `atomFirst`, which sets `atom.first` for the achievement `firstBomb`; a city of its own sets it unless a computer neighbour
    finished first. `PROTOCOL_VERSION` 7, `ATOM_PROTOCOL` 7, `MIN_REGION_PROTOCOL` stays 5. **Winter reach:** a report whose `boom`
    rises makes the room append `RegionMeta.winters {id: slot-n, at, slots}` (every other city present: the reporter started its
    own; a newcomer is spared, a returning slot keeps its place) and each page issues page-only `friendWinter {id}` once, in its
    own game time (idempotent by id).
17. **A strike on a friend rides `op: 'atom'`, the tower's path** (`FRIEND_OPS`, `REGION_OPS`, the `op` parse, `checkOpInput`,
    `opKey`, `friendOpsWaiting`, `spySettling`/`missionResult`). `opRefusal` refuses: rule off; the sender's report below stage 6
    **or the room's own clock** not having seen stage 6 for `REGION_LIMITS.atomPrep` (20 real minutes, shrinkable in tests); no
    total war open (a public `FriendsWar.totalWarOpen`); the target offline ("its player is not here: the bomb waits"), neutral,
    new (unless it struck first) or on protocol below 7 ("Ashford's game is older than this room"); `City.atom.used` (one per slot
    ever, in the record). Kept: the verdict stored for a resent id, the strike kept in the target's `ops`, `opOn` sent, the sender
    flagged pariah in `FriendsState` (pacts dropped by a public `dropPactsOf(slot)`, cooldown and shield skipped against it, new
    pacts refused), a history line and an `atoms` mark. The target's page applies `opResolve` `op: 'atom'` once (`w.taken`, and one strike from a city, ever: `Atom.struck`; a
    launch reported and a total war on the books, or kept for later) → `atomInbound`; a strike that waited for a returning player starts a **fresh full countdown** when its sim takes it (no
    real-time deadline: each city stays the authority over itself). Its sim decides dome and damage; its report carries the
    verdict and the room's mark, notice and winter follow. The attacker's sim marks `fired` on `opKept` and returns the bomb to
    prepared after `FIGHT_TIMEOUT_HOURS` with no answer, but never once the page has put it to the room (the tower's rule,
    less its hole: Step 10 review).
18. **Spies: a target of its own.** `SabotageTarget` gains `'plant'` (the plant, else the silo while the bomb builds): the
    shared `spyOdds`/`spyOutcome`, $45,000, 16 h. On success: a plant or silo still building gets `build.clock += 120` war
    hours; an online one loses 120 hours of work (fuel or bomb) and is closed 12 h. Sites: `relay/region.ts`
    `op` parse and `opRefusal` (a `plant` against a report with no `atom`, or a target on protocol below 7, is refused, no
    close), `commandCheck.ts`, `intel.ts` (`missionRefusal`, `TARGET_NAME`, `resolveMission`, `sabotageTarget`), `regionOps.ts`
    (`checkOpInput`, `opResolve`), `Intel.tsx`, `regionLink.ts`. The `intelMonth` pick of a computer spy (`rng.chance(0.5)`) is
    unchanged, so no stream moves. The report's `counter` folds in +150 while a plant stands. A computer neighbour's race takes
    a mission's effect as `rival.bomb.delay` (call 19). Plain Intel line: "about 7 in 10 to work, 1 in 6 to be caught".
19. **Computer neighbours race on Hard only.** `warDifficulty(sim).bomb` true only on Hard (Easy and Normal have no lever, so
    Normal stays M37's war to the bit). `RivalNeighbour.bomb?: {stage, at, delay}`. Start: `bombAllowed`, the city 20 game
    years old, `r.tech` 4, 40,000 residents, one at a time, chance 1.5 % a month x character on `Rng.fromSeed(`${seed}:bomb:${month}`)`
    (never `intelMonth`'s stream). Stages on the war clock: fuel 1,500 h, silo 500 h, bomb 800 h, each announced as a sim event
    and a notice, each delayed by a sabotage (call 18); a won expedition adds 240 h. It launches once, at the city, only in an
    open total war with its score at or below -45 for it, after a 10-day preparation the city sees; a dome stops it as any bomb.
    Its launch makes the other neighbours' relation to it -40. It is the single-player fallback for the target-side screenshots.
20. **UI, sound, effects, pacing.** An 11th war room tab "Bomb" (`src/ui/Atom.tsx`): the ladder (research 21 of 24, plant, fuel,
    silo, bomb, preparation), the region race list, and the launch card listing the **consequences** (reputation 0 for good,
    every neighbour embargoes, pacts end, anyone may declare total war at once, people protest, a nuclear winter on every city
    including yours) behind a **3 s hold-to-confirm** `launch-hold` that works by touch. Also `atom-chip`, `raid-chip` carrying
    the countdown, `winter-badge`, and a setting `reduceFlashes` (default from `prefers-reduced-motion`: the flash becomes a 0.8 s
    fade, no shake). `src/render/atom.ts`, a cost switch per effect (`QUALITY_PARAMS.units.atom*`): the missile on a trail
    (`handmade.unit('atombomb')`, a generated rocket if the model is missing), the flash, a toy mushroom (instanced stem, cap,
    ring; 500 puffs High, 120 Low, 6 draw calls), the radiation tint, July snow, the silo hatch as an overlay mesh (building
    models are static), and for a strike on a computer neighbour a region-map arc, flash and cloud mark (the firer sees no 3D
    cloud). Sounds `atomWarn`, `atomTick`, `atomBlast`, `atomWind` (rendered offline by `audioprobe.mjs`); tips `atomRace`,
    `atomReady`, `atomLaunch`, `atomInbound`, `atomFallout`, `atomWinter` (57 in all). A test forbids "casualt", "killed", "dead",
    "victim" in `src/data/atom.ts` and the new UI strings. Test-mode cheats: `atom {stage}` (sets the facts, skips the waits),
    `bombIn {hours, from}` (the city under test becomes a target: a Hard rival fires).

## Numbers (initial: step 0 sets them from `monthlyTaxes x 12` on the bench city; tests assert ratios)

| What | Money | Time (war hours; play at 1x) |
|---|---|---|
| Research, all 24 tiers (given) | about $4.3M | about 6 h |
| Enrichment plant, 3 stages | $3.6M, $12k a month | 360 h; 45 min |
| Fuel, plant online and staffed | $2,000 a war hour, $2.3M | 1,152 h; 144 min |
| Silo, 3 stages, built beside the fuel | $3.1M, $8k a month | 288 h; 36 min |
| Bomb, 12 instalments | $7.8M, goods 600, ore 2,400, oil 2,000 | 720 h; 90 min |
| Launch preparation | $1.2M | 288 h; 36 min |
| Flight and warning | none | 24 h; 3 min |
| Dome after a stopped bomb | none | 1,440 h; 180 min |

From the first stone: about $20M with upkeep, 315 min (5.25 h) on the critical path, about 11 h with the research. A 57k careful
city takes about $3.6M a year in taxes (DECISIONS, late-game retune): 5.5 years of it; the 100k bench city about 3 (`atomprice.ts`
prints days of income per step; the target is 3 to 6 game years). A built-out city nets about nothing at 6 %: the money is saved,
or raised with 9 % taxes, stakes and bonds.

The blast, fallout, clean-up, winter, protest and race numbers are in calls 10 to 14 and 19 (`ATOM`, `FALLOUT`, `WINTER`
data); tests assert their relations, not the values.

## Determinism, saves and goldens

- **Maths** is `DMath` (lint); the rasters are `Float32Array`s updated in index order; every loop is in sorted id order; `out`
  counters are rounded to 1e-3 before they cross into a neighbour or a report. No atom code touches a `sim.rng.*` stream: fires
  use `Rng.fromSeed(seed:atom:id)`, rivals `seed:bomb:month`, the room's sabotage dice are its own `env.roll`.
- **Save v32** (`SAVE_VERSION` 32, `migrations[31]` identity). Every new field is optional and made on first use:
  `WarState.atom`, `SimState.fallout`, `WeatherState.winters`, `Diplomacy.pariah`, `Supers.dome.down`, `RivalNeighbour.bomb`
  and `.fallout`, `RegionWarRules.bomb`, `CivicDef.refundShare`. Reads never create one. `stateParts` iterates
  `Object.keys(state)`, so a stray `fallout: undefined` would move the peace golden: nothing is assigned undefined, and a test
  walks a peace town's encoded keys. `checksum` and `partHashes` add `fallout`, `atom`, `winters` only when present;
  `checkInvariants`: finite, ground in [0, 1], one bomb, a flight has a target.
- **Goldens that must not move:** `peace-main.json`; `m36-war.json` and `v30-war.json` (Normal, no bomb); `battle-v2.json`,
  `stampBattle` and the v2 replays (the bomb is not a battle); `tests/legacy/names`; peace `balance.ts 20 careful` line for
  line; `--rivals` at Normal and Hard for 20 years against M39 (the race starts after year 20). A moved hash is found and
  removed, not rewritten, unless DECISIONS names why. Every `sim.rng` state is asserted equal across a strike, fallout and winter.
- **Fixture:** `tests/fixtures/war/v31-war.citybloom`, saved from the M39 tip in step 0. `saveV32.test.ts`: it loads and plays a
  month with none of the new keys; a round-trip at eleven states (no atom, plant building, enriching, silo, bomb, ready,
  preparing, flying, mid-impact, spent with fallout, winter) gives equal `partHashes`, and 3 more game days equal again.
- **Protocol 7.** Co-op (`relay/room.ts`, `v === PROTOCOL_VERSION`) locks v6 pages out, as every sim change since M34 did; the
  region room takes 5 to 7. A page on 5 or 6 can neither race nor be struck, and the refusals say so.
- **Budgets.** Tick: the raster update is a few ms every 3 h, only after a hit; a slice is at most 400 buildings (a test asserts
  the cap, `atombench.ts` the time; 25 ms a slice on the 100k city). Frame: the cloud at most 6 draw calls and 4,000 triangles
  (asserted in e2e); real frame times go under **To check on the Mac**. Network: the report grows under 100 bytes (about 12
  idle), `atoms` and `winters` stay under 2 KB; `netbudget.ts` and the free-plan row test (a race advancing in four cities, at
  most 130 rows an honest hour) are rerun and logged.

## Tests that prove the done criteria

1. **Unlock** (`atomGate`): each of the 24 keys withheld refuses naming that tier; `['land4']` alone refuses; all 24 opens plant,
   silo, bomb in order; sandbox cannot skip; no nuclear plant, rules off, a scenario or a spent bomb refuses.
2. **Race** (`relay/tests/regionAtom`): stages 1 to 8 give one notice and one history line per forward step, none for a resend
   or a drop; the first finisher once; a garbage `atom` is dropped and the connection stays; a v6 page gets no `race` event.
3. **Spy** (`atomSpy`, `regionAtomOps`): a `plant` sabotage adds 120 h to a stage, takes 120 h of fuel, closes the plant; a v6
   target is refused without a close; a Hard rival's `delay` moves its date.
4. **Dome** (`atomStrike`): no building lost, `dome.down` 1,200, a second bomb lands, charged 1,440 h later; mode off,
   uncharged, blacked out, unstaffed and supers off all land; `raised` for a battle stops it.
5. **Level:** every non-rubble building within 450 m is rubble after the slices, none beyond 675 m changes, some between burn;
   `fled` equals the levelled homes' `pop`; no incident or casualty; 400 buildings a tick at most; a save mid-impact resumes.
6. **Fallout** (`atomFallout`, raster-only): the ground's centre of mass is still after day 3; the air moves along `windAngle`
   (four seeds); a hit near the downwind edge raises `rival.fallout` on that side only; a friend's `plume` total applied twice
   adds once; zoning, placing, growth and upgrades are refused at 0.2 or more and roads are not; the core falls below 0.2 in 17
   to 20 years; a clean-up job costs its price and halves the dose.
7. **Winter** (`atomWinter`; `friendsAtom`, three headless cities in a real `RegionRoom`): firer, target and bystander all get it
   (colder, weaker solar, July snow); a newcomer is spared; a city away gets it once on return; `rng.weather` is bit-identical
   with no winter and each spell draws the same count at any depth; a weather-off city is chilled.
8. **World** (`atomWorld`): `reputation` stays 0 after five years and a +30 call; every computer neighbour sanctions with no
   deals; pacts end with no -30; total war is declared with no cooldown (the room skips cooldown and shield); approval falls 25
   points or more against a control and the population ends 8 % lower after 3 months; the chronicle keeps the launch.
9. **Guards:** launch refusals (no total war, ceasefire, vassal, neutral, rules off, supers off, scenario, a guest in co-op); the
   hosted-battle wait; Normal leaves no trace over 600 months; Hard never starts before year 20; the tone test; the fair clock
   holds stages and preparation but not the flight.

## Steps (each built and tested on its own, in order)

0. This plan, the code map, DECISIONS "M40" (every call, with the overturns and the left-out list: a second bomb, other
   anti-missile defences, a hand-aimed ground zero, a strike replay in a cached town), `tests/fixtures/war/v31-war.citybloom` from
   the M39 tip before any change, the golden baselines and the peace `balance` baseline, the peace-key-walk test, `atomprice.ts`
   on the bench city to fix the prices. Existing suites pass.
1. Data, gates, state: `src/data/atom.ts`, the `bomb` rule everywhere, `WarState.atom`/`atomStage`, `allTiersDone`,
   `nuclearRunning`, `atomLock`, the two defs, `warProject`, `refundShare`, save v32. Tests `atomGate`, `saveV32`.
2. Fuel, bomb, preparation: `atomHour`, `materialBill`, instalments, `buildBomb`/`cancelBomb`/`launchBomb`/`cancelLaunch`, loss
   rules, the bulldoze guard, host-only launch, cheat `atom {stage}`. Tests: the chain, waits, the fair clock.
3. Flight, dome, impact: `atomInbound`, warning and the drop to 1x, `bombStopped`/`dome.down`, `atomImpact`, the hosted-battle wait,
   the computer record, `atombench.ts`. Tests 4, 5 and the stream-purity check.
4. Fallout: both layers, the three bans, effects, the `radiation` map and ramp, edge counters, clean-up and relief crews,
   `scripts/dev/fallout.ts` to tune. Test 6.
5. Nuclear winter: `winters`, the readers, the look, `winter-badge`, the sim-side start. Test 7 (sim half).
6. The world reacts: pariah, `'bomb'` sanction, pacts, declarations, protest, chronicle rule, deterrent. Test 8 (sim half).
7. Computer race and spies: `RivalNeighbour.bomb`, the Hard lever, `'plant'` and its sites. Tests 3 (sim half), 9.
8. Cross-browser `atomSim` **before any room work**: a war town at 24 tiers (`labTown(0, {length: 800, streets: 7})`), a launch at a
   computer neighbour, the dome both ways, 300 hours of fallout (the rasters' bytes hashed, `out` totals), a winter, the pariah,
   every new command used (`ALL_KINDS`, `CHECKS`, `SAMPLES`, `NEED`). Chromium, WebKit, SpiderMonkey.
9. Room and protocol 7: `bomb` rule, report `atom`, diffs to notices and history, `atoms`, `winters`, `op: 'atom'`, the
   preparation clock, `FriendsState` pariah, version filters. Relay tests 2, 3, 7, 8 (room halves), the free-plan rows.
10. Pages: `friendFallout`, `friendWinter`, `atomFirst`, `opResolve` for the strike, `RegionOps`; three-city tests
    (`friendsHarness`). Test 6 (neighbour half).
11. UI and effects: Bomb tab, cards, chip, siren, map and legend, clean-up tool, declare warnings, tips, touch and narrow
    coverage; `render/atom.ts`, sounds, cost switches, `atomshot.mjs`; the region-map arc for a computer target.
12. E2E: `m40-atom` (one page, Low graphics: cheats finish the stages, total war, the real Bomb tab launch and arc, then `bombIn`
    for the four shots; reputation 0, the refusal on contaminated ground, the draw-call cap) and `m40-friends` (two players: race,
    launch, strike; run alone, about 15 min). Screenshots looked at.
13. Wrap-up: full tests and e2e, `balance` (peace diff; rivals at three levels; a 35-year Hard probe), `bench`, `atombench`, the
    cross-browser run, `netbudget`, a virtual `regionsoak` with a race; DECISIONS, DESIGN §3.34, README War section, SPEC_REVIEW,
    PROGRESS (tick M40; Mac: cloud, flash and ring frame times, siren loudness); `M40 complete:` commit joining the open PR.
