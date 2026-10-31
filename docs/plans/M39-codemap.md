# M39 code map (what war with friends builds on)

A survey of the code before M39, for whoever builds it. Names, not line numbers. State today: save v31,
relay protocol 5, battle version 3 (2 when nothing of 3 is used), 44 tips, 10 war room tabs.

## 1. Battles between friends today (M35–M37)
- **Attacker's side** (`src/client/battles.ts`, `AwayBattles.fight`): the force arrives (`Expedition` `out` →
  `fighting`; at departure `forceOut` made the room send the target `incoming`). The page asks `mayStrike`
  (the `raidVerdict` mirror), `fetchSave(slot)` (the region's latest save of the friend's city: up to 10
  min stale, or the one sent as its player left) and runs the battle worker's `awayCity` job (`awayCity` →
  `awayInput` → `Battle.run`) with no human on either side. It keeps a `BattleRecord` (IndexedDB
  `citybloom-war`, town copy `player:<id>`), pins the force (`battleSettling`, page-only), sends
  `RegionLink.sendBattle` (gzip JSON in ≤ 8 parts of 200 KB; ~10 KB for a normal town) and only on
  `battleKept` dispatches `battleReport`. `battleRefused` may say `again` (fight at half strength, the
  defender left) or `later` (ms). Id `awayBattleId(seed, expedition)`: one per force.
- **Region keeps it** (`RegionRoom` `battle` case): `raidRefusal`, superweapon check, `away`, pace
  (`battleEvery` 5 min, burst 3), then `City.pending` (≤ 8) plus a store row (`saveBattle(slot, k)`); sent at
  once to a connected defender (`late:false`), else on its `rwelcome` (`late:true`). `battleSeen {id, from}`
  deletes the row and remembers `from:id` in `City.seen` (24).
- **Defender takes it** (`RegionLink` `battle` → `CityPort.battle` = `Game.takeBattle`): checks the sender is
  in the region, renames the attacker to the region's name, `awayCaps` if `meta.away`, previews
  `battleResolve` (`BATTLE_BUSY` → `later`, `BATTLE_TAKEN` → `taken`), keeps the backdrop `replay:def-<id>`
  and a `BattleRecord` (24 kept per city), dispatches `battleResolve` (`mode` 'watch' if the player is here,
  'instant' if `late`), saves the city, then `battleSeen`.
- **Sim side** (`resolveBattle`, `src/sim/systems/raids.ts`): `checkBattleInput`; one hosted battle at a time
  (`WarState.battle: HostedBattle`, `sim.battleRun`); `w.taken` (32) against repeats; `adoptBattle` (only
  structures and units that match this city's own picture keep their ids, strangers get negative ids and
  take no damage; caps are this city's, halved when away); `coverWithDome`; `SUPER_UNCOUNTED`;
  `wearinessRaid`. `battleTick` runs 2 steps per city tick, so **the city's speed buttons are the battle's
  clock** and a paused city pauses it; events go through `applyWarDamage` (the disasters' machinery);
  `battleFrameOf` feeds the view; `endHomeBattle` closes it. After a load it re-runs `hb.input` to `hb.step`.
- **Where battles run**: a computer raid in the defender's sim (`startHomeBattle`, layout from the live sim);
  an expedition against a computer town or a friend in `battleWorker.ts` (`away`, `awayCity`, `town` jobs);
  the viewer `?battle=<id>&back=<slot>` (`Game.watchBattle`, `main.ts`) loads record and town and hosts it
  in a read-only sim by `battleResolve` 'watch' (a page reload: M35's "in-place swapping" was never built).
  M35's design had the defender host a live layout; what shipped is attacker-fights-the-save.
- **Inputs and outputs** (`src/sim/battle/types.ts`): `BattleInput` {v, id, seed, scale, `layout` (frozen
  `battleLayout(sim, {target, from})`: roads, ≤ 4,000 structs, 32 m terrain grid, entries, defenders),
  `attacker: ForceIn` (one force: name, colour, units, route, target, stance, readiness, mods),
  `defender` {name, colour}, `orders`, `caps`}. `BATTLE.dt` 0.5 s, `stepsPerTick` 2, `maxSteps` 1,440 (+1,200
  withdrawing): ~90 s at 1×. Out: `BattleEvent`s, `frame()`, `result()` (outcome, units, `hash`), `awayResult`.
- **Determinism**: `Rng.fromSeed(seed:battle)`, `DMath`, creation order, structures by id, `Mixer` hash (step,
  rng, units, struct hp, dome). Cheap: a whole battle 20–55 ms, 0.2–0.5 ms a tick on the 100k city.
- **Versions** (`version.ts`): `stampBattle` stamps 3 only when v3 fields are used, so v2 replays
  (`tests/battle/v2replay.test.ts`), the M36 golden and `tests/fixtures/war/battle-v2.json` never move. New
  order kinds, several forces or owners need 4 under the same rule, plus `checkBattleInput`/`BATTLE_LIMITS`.
- **Not there**: `BattleOrder` is `{step, side, kind: 'withdraw'}`, `Battle.orders()` obeys only side 0 and
  nothing creates one (`orders: []` everywhere, 64 allowed); side 1 is all AI (`Plan.Intercept/Guard`,
  reaction delay from readiness). Nothing scores or records a result between players.

## 2. The region room and protocol
- **One class, three hosts**: `RegionRoom` (`relay/region.ts`) in the local relay, in a Durable Object
  (`RegionObject`, hibernating sockets, `RegionSqlStore`) and in the host's browser for peer-to-peer
  (`P2PHost`, `MemoryRegionStore`; the region ends with its host). It **orders nothing**: it keeps reports,
  saves, battles and ops and passes news on. Pages use `RegionLink` (`src/net/regionLink.ts`).
- **Client → room**: `rhello`, `report` (every 30 s, thumbnail now and then), `contribute`, `save` (parts;
  `last` as the player leaves), `visit`, `rrules` (host), `battle`, `battleSeen`, `forceOut`, `op`, `opSeen`.
  **Room → client**: `rwelcome`, `region` (the whole `RegionView`, thumbnails too, broadcast on every
  report), `citysave`, `battle`, `battleKept`, `battleRefused`, `incoming`, `opKept`, `opRefused`, `opOn`,
  `notice`, `error` (`version`, `no-region`, `full`, `rate`, `limit`, `closed`…). `PROTOCOL_VERSION` 5.
- **Per city** (`City` in `RegionMeta` JSON, written throttled by `changed()`/`save()`): name, mayor, colour,
  `secret`, `report` (offers, deals, population, `shield`, `tiers`, `counter`, `coast`, `clock`), `thumb`,
  `pending`, `seen`, `raids` (UTC day count), `raidedBy` (ms of each city's last raid), `ops`, `spied`,
  `supers`, `verdicts`, `fair`. Beside it: city save parts and a row per pending battle. `RegionMeta` also has
  `rules` (`RegionWarRules`: war, scale, supers), `host`, `project`, `budget`.
- **Refusals** (`raidRefusal`, in order): no reports, sender or target neutral, p2p target offline
  (`absent`), 8 pending, a newcomer target unless it raided the sender within `RAID_ANSWER_MS` (a day),
  target raided `raidsPerDay` (3) today. The page mirrors them in `raidVerdict` → `PlayerNeighbour.raid`
  (`open|new|neutral|spent|absent`) so `strikeRefusal` agrees; the room has the last word. A target whose
  player left (online) is raided at half strength (`away`).
- **Limits** (`REGION_LIMITS`): per connection `rate` 2/s burst 60 (over: dropped; 60 below zero: closed),
  `opsPerDay` 4, `sabotagePerDay` 1, `supersPerDay` 1, `opEvery` 2 min, `saveEvery` 10 min, `visitEvery` 30 s,
  `dailyRows` 3000, `ttl` 60 d, `maxConns` 16, `MAX_CITIES` 4, `FAIR` clock (1×, bank 48 h).
- **Online vs peer-to-peer**: same messages; p2p keeps pending battles in the host's memory and refuses raids
  on absent players; online keeps SQLite rows. No online relay is deployed yet (PROGRESS), so the live site
  offers peer-to-peer only; test online on the local relay.

## 3. Lockstep, and what a live battle would need
- **Regions are not lockstepped.** Each city runs its own sim in its own worker at its own speed; the only
  coupling is reports, `regionUpdate` (page-only), deals settled monthly on each city's clock and the
  fair-clock cap (`warClock`). `Game.startRegion/joinRegion` return false when `this.net` (a room) is set,
  so a shared co-op city cannot stand in a region today (DECISIONS "M37": allowed in M39). Page-only
  commands (`regionUpdate`, `battleResolve`, `battleReport`, `opResolve`, `warClock`, `cheat`) are refused by
  `checkCommand`, so a room cannot carry them: a host-only lane would be needed.
- **Rooms** (`relay/room.ts`, `src/sim/lockstep.ts`, `sync.ts`, the worker's shared mode, `src/net/session.ts`):
  every player runs the same sim; a command is checked (`checkCommand`, `roomRefusal`), stamped by
  `Room.order` at the frontier tick `allowed` with a `seq`, sent as `ev` + `allow`. The pacer (host's page)
  moves `allowed` with `clock`, at most a 3 s lead (`leadTicks`) ahead of the slowest visible player and
  `MAX_CLOCK_STEP` (1,800 ticks) a message. `Lockstep` applies events at their tick in `(tick, seq)` order,
  runs only up to `allowed`, keeps an hourly `checksum`, month `partHashes` and an `eventHash`; a mismatch
  with the pacer, or a `'late'` event, resyncs the player from a snapshot (`settle` → `Lockstep.rebirth`).
- **Reusable**: the queue/`allow`/`seq` idea and `leadTicks` are generic, but `Lockstep` is wired to `Sim`.
  `Battle` has what a lockstep needs: pure steps, orders read by `step`, `hash()`, `frame()`, cheap
  fast-forward; a snapshot of a battle is input + order log + step (a late spectator re-runs it).
- **Seams for a live battle between two players**: (a) a battle session on the region room, in memory (no
  rows), with its own `seq`, step frontier, pacer and a silent-player timeout; (b) the defender builds the
  input from its **live** sim (`battleLayout(sim, …)` is pure, as in `startHomeBattle`) and ships it
  (`encodeBattle`); (c) `Battle` takes orders while running (appended to `input.orders` at a step ≥ the
  frontier; new kinds, side 1, `stampBattle` v4, `checkBattleInput`); (d) battle time must leave the city's
  tick: drive the hosted battle with page-only commands (`battleOrder`, `battleStepTo`, orders kept in
  `hb.input` so a save re-runs them) or run `Battle` in a worker and feed `applyWarDamage` its events;
  (e) the attacker's page runs the same `Battle` and reports with `awayResult`; `AwayBattles.fight` is where
  live and from-the-save branch; (f) both players need a town to draw; (g) `hash()` compared through the
  room at the end and every N steps (the defender's run is the truth for its city, the attacker's for its losses).
- **Pitfalls**: one hosted battle per city (`BATTLE_BUSY`); one `ForceIn` (allies' help or a second attacker
  means owner tags per unit, v4); background tabs throttle main-thread timers (the sim worker is spared), so
  pace in a worker; 2 msg/s per connection leaves room for orders and a 1–2 s clock only; in p2p the host is
  hub and player; `broadcast()` ships every thumbnail, so battle traffic must not ride on `region`.

## 4. Diplomacy between friends
- **Friends are refused in two places**: `declareRefusal` ("War with a friend is declared in a shared region
  at war (M39)") and `termsRefusal` ("Treaties with friends come with war among friends (M39)"). Friends'
  raids work without any `War`: skirmishes by `strikeRefusal` + the room's verdict; no score, cooldown,
  cityhall target, capitulation or conquest (`scoreBattle`, `conquer`, `computerMoves`, `weigh` need `n.rival`).
- **Computer treaties**: state in `WarState.diplomacy` (`wars`, `pacts`, `proposals`, `log` 40, `reputation`,
  `vassal`, `neutral`, `ended`), keyed by the local `Neighbour.id`. `propose` → `termsRefusal` → a `Proposal`
  (answered by `answerFromComputer`/`weigh` after `answerAt`); theirs come from `computerMoves` (daily);
  `answerProposal` → `sign(sim, n, terms, imposed)` applies each `Term` (peace → `endWar`, ceasefire,
  reparations booked at once, tribute by month, dmz, `occupy`, pacts, embargo deleting deals, trade,
  independence); a capitulation lets the winner `sign` with `imposed`. `bindingPacts`/`breakPacts` and
  `reputation` punish a breach; money goes through `accrue`.
- **Two sims, two truths**: each city would hold its own mirror (`mirrorTerm` exists, unused) and a friend
  has no `rival` state. Neighbour ids are local, so a treaty needs a shared id (proposer slot + proposal id).
  Precedents: room-brokered ops (`op`/`opKept`/`opOn`/`opSeen`, a `pending` list in the record, page-only
  `opResolve` applying once via `w.taken`) and M23 deals (`Deal.remote`, reports → `regionUpdate`
  contracts). A treaty would be a third message family: proposal → target page → answer → the room records
  the verdict and keeps it for **both** until each says seen → each sim applies its side with a page-only
  command. Money terms settle per side on each city's clock; a lost half must be impossible; refusal texts must
  read the same everywhere (`formatInt`).
- **Becomes possible**: `War` for a player neighbour (score, capitulation, seat of power, conquest and "play
  on as a vassal" in a player's sim), cooldowns, `helpers` (allies' help), reputation among friends,
  incidents as reasons to declare (M37 design list); `raidStance` stays for computer neighbours.

## 5. The war economy and friends (DECISIONS "M38", call 1)
- Left to M39 on purpose, each with the same `n.player` refusal string ("… come with treaties among friends
  (M39)"): stakes (`buyStake`), loans (`lendAlly`), war aid (`fundAlly`), arms trade (`setArmsDeal`, `sellUnit`:
  buyers are allies only, there is no trade pact), sanctions (`setSanction`); offers (`offers.ts`) look up
  computer neighbours only. Two-sided money needs the settlement of section 4, and `INVEST.perResident`
  prices a computer town's industry, which a friend's report would have to replace.
- Already covering friends: weariness (every open war and each friend's raid via `wearinessRaid`); the embargo
  check is where trade is delivered (`dealStopped`) and would reach friends' M23 deals once a pact exists.
  `WarEconomy.seq` has its own ids (keep new state off `nextId`: battles are seeded by it).

## 6. Co-op rules and the war commands
- `src/sim/rules.ts`: `Permission` = bulldoze | money | policies | projects | spend | speed (`PERMISSIONS` also
  drives `PlayerRules` in `Friends.tsx` and the relay's validation in `protocol.ts`); `DEFAULT_PERMS` = all;
  `may()` (the host always); `roomRefusal` (`NEED`, projects) before ordering; `simRefusal` in `Sim.dispatch`
  (bulldoze others' work, `spendLimit` without `spend`). A new permission missing from a stored `perms` list
  would deny silently: treat absence as the default.
- **`NEED` today**: `spend`: sendForce, recallForce, declareWar, queue/unqueueResearch, startTrial/stopTrial,
  useBlackout, spyMission. `policies`: setNeutral, setDome, propose, answerProposal, withdrawProposal, endPact,
  setSanction. `money`: issueBond, repayBond, buyBack, buyStake, sellStake, lendAlly, fundAlly, setArmsDeal,
  sellUnit, answerOffer. **None**: trainUnit, cancelTraining, disbandUnit, placing military buildings (only
  `spendLimit`). Page-only: battleReport, battleSettling, battleResolve, spySettling, missionResult,
  opResolve, warClock, regionUpdate, contributeProject, cheat, the editor's and startScenario.
- A new command: `COMMAND_KINDS`, `CHECKS`/`PAGE_ONLY` (`commandCheck.ts`), `apply` in `sim.ts`, `NEED`, a
  sample in `tests/lockstep/commandCheck.test.ts`, a use in `tests/lockstep/determinism.ts`.
- **A shared city at war now**: raids on it are hosted in the lockstep sim (deterministic); diplomacy with
  computer neighbours works under those permissions; `forceRefusal` and `expeditionsTick` refuse or turn back
  forces when `sim.shared`, as do friend spies and blackouts; the fair clock is ignored. Roles are new
  permissions (war, treaties, defence) or a split of `spend`/`policies`.

## 7. City history and a region-wide war history
- `SimState.chronicle` (`systems/chronicle.ts`; v14): month-close series (`CHRONICLE_SERIES`) and
  `events: ChronicleEvent {tick, kind: milestone|disaster|project|election, ref}` (300) via `chronicleEvent`;
  the panel is `src/ui/History.tsx` (`eventLabel`, chart markers; test API `getChronicle()`). No war event is
  recorded yet; war notes live in `Diplomacy.log`, `WarState.reports` (12) and `diplomacy` events.
- Feeding it: new kinds (`war`, `treaty`, `conquest`, `raid`) plus `eventLabel` are additive (no migration),
  but a war city's chronicle is in its state hash, so the M36 golden and war save fixtures may move (rewrite
  deliberately, DECISIONS). Region-wide: the room sees battles kept, ops and rule changes, and would see
  declarations, treaties and conquests as new messages; it could keep a bounded ring in `RegionMeta` (rows!)
  sent in `rwelcome` and a small `history` message, not in the broadcast `region`. Outcomes are known only to
  the cities (`battleSeen` would carry one). The panel's axis is each city's game months and a region is on wall
  clock: show the region log as its own list.

## 8. Scenarios
- A scenario is `ScenarioDef` data in `src/data/scenarios.ts` (brief, `save` in `public/scenarios/`, months,
  `stars`, `goals` (a `GoalMeasure`, min/max, `hold`), `limits`, disasters, elections, weather, `region?`,
  hints), a starting city from a recipe in `scripts/lib/scenarioCities.ts` (`npx tsx scripts/scenarios.ts
  <id>`, previews `scenarioshots.mjs`). `startScenario` (`systems/scenario.ts`) sets options, **drops all
  neighbours unless `region: true`**; goals are checked at month close (`goalValue`, `scenarioMonth`).
  Tests: `tests/scenarios/*.test.ts` (`openScenario`, `playOut`, scripted moves); `?scenario=<id>`.
- A war scenario: recipe with `Sim.create({ rivals: true, … })` (`startWar` makes `WarState` and rival
  neighbours), `region: true`, units and an HQ in the save. Missing: war measures (`raidsRepelled`, districts
  held from `occupy` pacts, `warScore`), a scripted invasion (raids are dice-driven; only the test cheat
  `raidIn` forces one: a `ScenarioDef` script field) and a loss rule. "Liberate an occupied neighbour" has no
  model (occupation exists only as `occupy` pacts between the city and a neighbour, `RivalNeighbour.vassal`):
  a start with the city's own district occupied and the goal "pact ended" fits. The mayors (`warMayor.ts`)
  only defend, so winning moves are scripted.

## 9. Soak, budgets, headless players, free plan
- `scripts/dev/soak.ts [minutes]`: four headless players in **one room** (`HeadlessDriver` + `RoomSession` on the
  local relay) building, dropping, leaving, one deliberate desync; fails on any unexplained resync.
  `netbudget.ts [min] [speed] [players]` is room-only too (msgs/bytes per player, free-plan maths on requests,
  GB-s, rows). **Neither covers a region, let alone war.**
- A region soak needs a headless region player: `RegionLink` + a `Sim` + what `Game` does around it
  (`takeBattle`, `AwayBattles`, `RegionOps`, `repostBattles`, fair-clock caps, `reportNow`). That glue lives in
  `Game` and `AwayBattles` uses `new Worker` and IndexedDB directly; tests hand-write a `CityPort` and copy
  `loopTo(room: RegionRoom)` into five files (`relay/tests/{region,regionBattles,regionSpies,fairClock,
  warRules}.test.ts`). Extract a `relay/tests/regionHarness.ts` and inject the battle runner and storage.
- Free plan (`relay/limits.ts`: `TokenBucket`, `DailyRows`, `dailyLimitText`; `relay/tests/freeplan.test.ts`,
  "an honest hour of four cities writes about a hundred rows", "raided all night"): rows are the tight budget
  (`dailyRows` 3000), messages count 1/20 of a request. A 2 h soak with raids, a war, a treaty and a conquest
  must stay inside rows and `rate`; live-battle traffic should be memory-only. The fair clock caps war time at
  1× + 48 h, so a soak is real play-time (`fairClock: false`, localStorage `citybloom.fairClock=off` in e2e,
  `FakeClock`, `FAST`, `TEST_LIMITS`, `unshield`/`raidIn` cheats are the test shortcuts).

## 10. Polish
- Tips: `TIPS` in `src/client/tutorial.ts` (`id`, `text`, `when(g)`; `seenTips` kept to 100 in `settings.ts`, 44
  used; `tests/tips.test.ts`). War tips: rivals, warRoom, raidComing, sendForce, diplomacy, research, trial,
  spinoff, intelligence, superweapon, dome, blackout, incident, trade, weariness, sanctioned. Needed: war with a
  friend, live orders, a treaty with a friend, fallen/vassal.
- README: no war section (only "Play with friends": rooms and a region, no war); add "War" and the raid
  refusals in plain words (`raidVerdict`/`raidRefusal` texts).
- Layout: `#ui[data-bars=compact|tight|full]` from `barsClassWith(rem, extra)` (`src/ui/layout.ts`; the
  Military bar adds a button, so `COMPACT_BELOW_REM`/`TOOL_REM` may need a raise) and `#ui[data-width=xs|s|m|l]`;
  the war room has 10 scrolling tabs (`Military.tsx` `TABS`). Templates: `e2e/m33-narrow.spec.ts` (phone and
  tablet by touch, `overflow()`/`unreachable()`), `fix-layout.spec.ts` (toolbar at 1100/1160/1200 px),
  `review-touch.spec.ts` (CDP touch). A battle tool must be `clickOnly`-style with `Tool.pointerCancel` and
  24 px tap targets; `Battle.tsx` has the raid chip, battle bar (`followBattle`), reports, `SendForce`, map.
- Lobby: `Friends.tsx` `FriendsScreen`, `RegionWays` (start/join a region, `parseInvite`/`formatInvite`),
  `RoomChip`/`RoomPanel`, `Troubleshooting`; the war switch is the Region panel's `RegionWar` (host only,
  `region-war-on`/`-scale`/`-supers`). The route to war is Region panel → war on → war room (Shift+M) → Send;
  nothing in the lobby mentions war.

## 11. Cross-browser determinism
- `npm run xbrowser` (`playwright.xb.config.ts`, `e2e-xb/determinism.spec.ts`, no server): esbuild bundles
  `tests/lockstep/browserEntry.ts` into a blank page; `runDeterminism(24, cleanslate)`
  (`tests/lockstep/determinism.ts`) runs in Node (expected) and in Chromium, WebKit and Firefox; a SpiderMonkey
  shell test (`JS_SHELL`, `scripts/dev/jsshell.sh`, `shellEntry.ts`) stands in for Firefox on the Mac
  (`XB_FIREFOX=0`). CI: `.github/workflows/xbrowser.yml` (ubuntu-24.04; pushes to `war`, PRs; plus the `live`
  relay tests). It runs the scripted town (hash each month), editor, scenario, a rivals town (12 months),
  battles (`home` hash per hour and `homeEnd`, `town` hash, `away` result), then diplomacy, research, economy.
- **Gap**: both browser tests compare only `months`, `editor`, `scenario`, `war`, `battle` and `refused`
  (and `used`). `diplomacy` (M36), `research` (M37) and `economy` (M38) are computed but **never compared in
  a browser**; add them to both tests before relying on the run for M39.
- Rules: every command kind must be used by the script (`ALL_KINDS`, `determinism.test.ts`) and `refused`
  reasons must match across engines.
- Adding a battle: a `live` section in `runDeterminism`: an input from the war town (`awayInput` or
  `startHomeBattle`), a scripted order log applied through the function the room's events will use,
  `Battle.hash()` every 100 steps and `result()`; add it to `DeterminismResult` and both comparisons. Seconds
  of work. Feed an attacker copy and a defender copy the same order stream and expect equal hashes.

## Biggest seams and risks
- Battle time is the city's tick; a live battle needs its own clock and an order stream through the region room.
- The region room orders nothing, allows 2 msg/s a connection and 3000 rows a day; the p2p host is hub and player.
- Treaties and wars need both sims to apply the same thing exactly once; the room must keep until both saw it.
- `Battle` knows one order kind nobody sends; live orders, allies and owners are battle version 4.
- No region harness or soak exists, the browser run skips the M36–M38 sections, and the M36 golden will move.
