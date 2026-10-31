# M39 War with friends: design

The brief (SPEC-5.md, M39): live battles between players, both commanding in lockstep through the
region's room, allies sending help, spectators, online and peer-to-peer, a dropped player handing over
to their defences; replays for the whole region and a region-wide war history; shared co-op cities at
war with roles; three war scenarios; a two-hour soak of four players; polish (tips, README, narrow and
touch).

Done when: the soak passes; an e2e with two players fights a battle through the real UI, both commanding,
and ends it with a treaty both accept; the cross-browser test covers a battle; a player could invite a
friend, go to war and make peace without reading anything first.

Code map: `docs/plans/M39-codemap.md`. Calls and their reasons as they're made: DECISIONS "M39".

## Calls

1. **A live battle is a battle whose orders arrive while it runs.** Nothing else changes in what a battle
   is: a `BattleInput` (now version 4 when orders or helpers are used) stepped by `Battle`. When it's
   over, the input with every order in it is the record: the defender's sim resolves it (live as it
   happens, or later from the room as today), the attacker's report comes from the same run, replays
   re-run it, and the cross-browser test runs one. So M35's async path stays the fallback and the store,
   and a live battle that loses a player simply carries on with fewer orders.
2. **Orders (battle version 4)**: `{step, side, kind, units?, target?}`, `units` the battle's unit ids
   (none: the whole side's), at most 256 a battle and 4 a step a side:
   - `focus`: attackers make `target` (a structure index) their next objective; defenders (units and
     guns) prefer `target` (an attacking unit) when they choose;
   - `guard`: defending units move to and guard `target` (a structure);
   - `hold` / `free`: stop moving and only fire / back to the battle's own judgement;
   - `withdraw`: the given attackers pull out (all of them: M35's order, unchanged).
   An order is checked when it applies (a dead unit or a fallen structure makes it a no-op), so the
   order stream can't break a battle. `stampBattle` stamps 4 only when an order other than `withdraw`
   or a helper is in the input: v2 and v3 battles, replays and goldens never move.
3. **The region room orders a live battle** (protocol 6), in memory only (no rows while it runs):
   - the attacker's page asks for a live battle (`battle` with `live: true` and its force, no layout)
     when its force arrives and the defender's player is connected; otherwise, or if the defender's page
     doesn't answer in 20 s, today's path (the attacker fights the region's save);
   - the defender's page builds the input from its live sim (`battleLayout`, as for a computer raid),
     starts hosting it, and sends it (`binput`); the room starts the session (`bstart` to both and to
     watchers) with a step frontier;
   - **pacing by progress**: each combatant's page reports its step (`bstep`, at most twice a second
     with its orders); the room sets the frontier to the slowest combatant's step plus a lead of 2 s
     (32 steps) and sends it (`ballow`) when it moves; an order from a player is stamped at the
     frontier (`bord`, with a session `seq`) and sent to every page in the session. No timers in the
     room: it notices a silent combatant (no `bstep` for 10 s) on the next message from anyone, and
     stamps a `handover` for that side at the frontier: that side's units go back to the battle's own
     judgement, and pacing follows the other player alone. A player who comes back gets the input and
     the orders so far (`bjoin`) and catches up;
   - the end: each combatant reports the battle's end step and `hash()`; the room checks they agree,
     ends the session (`bend`), keeps the final input as the battle row for a defender who wasn't there
     at the end (today's `pending`), and adds the battle to the region's history and replays;
   - limits: one live battle per city at a time, a session dropped when neither combatant has spoken
     for 60 s (the final input then goes to the defender as a kept battle, run to the end with no more
     orders), a player's orders within the connection's 2 messages a second.
4. **The defender hosts the live battle in its own sim** (as a computer raid), fed by a page-only command
   `battleLive {id, allow, orders}` that appends the stamped orders to `hb.input.orders` and raises the
   step the sim may run to (`hb.allow`). The battle advances 2 steps a city tick as now, never past
   `allow`. A saved city re-runs `hb.input` to `hb.step` as now, so a reload mid-battle replays the orders
   it had. A live battle holds the defender's speed buttons at 1× or faster while it runs (a paused city
   would hold up both players; the room's pacing still waits for it).
5. **The attacker runs the same battle in its battle worker** (a `live` job: input, then orders and
   allow as they come, frames back to the page), at the room's pace. Its losses and the report come from
   that run (`battleReport` as today). Both runs report `hash()` at the end; a mismatch is logged as a
   desync, the defender's run stands for its city and the attacker's for its force (each city's own truth,
   as M35), and the history records it.
6. **Commanding: a tactical battle map**, the same panel for both sides and for spectators
   (`src/ui/BattleMap.tsx`, a canvas drawn from the battle's frames and layout: roads, structures,
   units by side and owner). Select units (click, drag a box, or "all"), then an order button or a click
   on a structure or unit; orders are disabled for spectators and for a side that handed over. The
   defender also sees the battle in its city in 3D as now; the attacker sees it on the map (a 3D view of
   a friend's town stays the replay viewer's). Touch: tap to select, tap to order, 24 px targets.
7. **Allies send help**: a city allied with a combatant (a friend with an alliance or a defensive pact
   signed through the room, call 9) may send a force into a live battle on its ally's side while it runs
   (`bhelp`): the force arrives after its route time (at least 30 s of battle), as a helper with an owner
   (version 4: `helpers`, each with its owner, side, units and arrival step), and its losses go back to
   its own city. A computer ally's help (M36 `allies`) is unchanged.
8. **Spectators**: any city in the region may watch a live battle (`bwatch`): it gets the input, the
   orders so far and then the session's messages, and draws the battle map. Replays: every battle the
   region keeps (its final input) can be watched by any player for 7 days from the history list.
9. **Wars and treaties between friends go through the room**, which keeps their truth (protocol 6):
   - a declaration (`wdeclare`: scale, reason) opens after a warning of 2 minutes of real time; the room
     keeps the war (`RegionMeta.wars`), its score from each battle's outcome between the two (as M36's
     `scoreBattle`, from the result both pages report), and capitulation at −60;
   - a proposal (`tprop`: terms from M36's list less those that need a computer's state: occupied
     districts and independence) is put to the other player (kept until they're online), answered
     (`tans`), and a treaty signed is sent to both (`tsign`) and kept until each has applied it
     (`tseen`). Each city applies its own side once with a page-only command (`friendTreaty`), so a
     ceasefire, peace, pacts and an embargo bind both sims and the money terms are booked on each side
     (reparations at once: one pays, the other receives; tribute monthly on each city's own clock);
   - **conquest between friends**: a city that capitulates in a total war becomes the winner's vassal
     (a fifth of its taxes to the winner monthly, as M36's vassals, until it rises: a won battle against
     its overlord with a score of +30 frees it). The room keeps who is whose vassal (this plan first said a
     tenth; it is a fifth, `DIPLOMACY.vassal.taxShare`, so one rule holds for every vassal: see DECISIONS
     "M39", the entry on money terms);
   - M38's money with friends (stakes, loans, arms deals) stays with computer neighbours in M39: the
     treaty's money terms are the trade between friends (DECISIONS).
10. **A region-wide war history**: the room keeps the last 100 war events (declarations, battles with
    their outcome, treaties, capitulations, conquests, risings) in `RegionMeta.history` and sends them in
    `rwelcome` and as they happen (`history`). The City history panel gets a "Region at war" list beside
    the city's own chart (the region is on real time, the city on game months), with a "Watch" button for
    battles still kept.
11. **Shared co-op cities at war: roles.** Three new permissions the host sets per player, in the room
    panel beside today's: `war` (declare war, send and recall forces, spies, superweapons), `treaties`
    (propose, answer, end pacts, neutrality, sanctions) and `defence` (military buildings, training,
    defence funding, bonds). A stored rule without them reads as allowed (the default), so older rooms
    keep working. A co-op city still can't stand in a region (DECISIONS "M37"): its wars are with
    computer neighbours.
12. **Scenarios** (data and recipes as M18's): "Hold the line" (defend a town against a scripted
    invasion: three waves at set months, a new `script` field firing raids; goal: keep 90 % of the
    buildings and the population above a floor), "A clean war" (win a declared war against a computer
    neighbour, score +60, without a district occupied: new measures `warWon`, `districtsLost`), and
    "Liberation" (start with an ally occupied by an aggressive neighbour as its vassal; goal: free it: a
    new measure `liberated`, through a won war's terms, `release` added to the terms). Tests play each with
    scripted moves.
13. **The soak** (`scripts/dev/regionsoak.ts`): four headless region players (a harness extracted from
    the relay tests: a `RegionLink`, a `Sim`, the battle runner in-process) on the local relay, two hours
    of real time with war on: raids between them, a declared war with live battles (scripted orders), a
    treaty, a total war ending in a conquest, drops and rejoins. Passes with no unexplained hash mismatch
    in any live battle, every battle applied once on both sides, and the room's rows, requests and
    duration within the free plan (projected to a day). `SOAK_FAST=1` for a 5-minute version in tests.
14. **Cross-browser**: a `live` section in the determinism script: a version-4 battle from the war town
    with a scripted order stream (both sides, a handover and a helper), its `hash()` every 100 steps and
    its result, compared in every browser (and the M36–M38 sections, compared since 0d1d5cf).
15. **Polish**: tips (war with a friend, the battle map, a live battle, a treaty with a friend, a vassal),
    a "War" section in the README (how to turn it on, what a raid between friends is, the limits in plain
    words), the lobby, the war room and the battle map at phone and tablet widths and by touch (e2e as
    `m33-narrow`).

## Determinism, saves and goldens

New sim state stays optional and appears on first use (save v32 only if a field is added to `SimState`
or `WarState`: the live battle's `allow` lives in `HostedBattle`, the friends' treaties in the
diplomacy state with the friend's slot). Battles version 4 by `stampBattle`: v2/v3 replays and the M36
golden don't move unless the chronicle's new war events land in it (rewrite once, with a DECISIONS entry).
Protocol 6; a page on protocol 5 gets today's behaviour (no live battle, no friends' treaties).

## Steps

0. This plan, the code map, DECISIONS "M39"; the cross-browser spec compares every section (done).
1. Battle version 4: orders (focus, guard, hold, free, withdraw by units), helpers with owners and
   arrival, `checkBattleInput` limits, `stampBattle`; tests (determinism, every order, v2/v3 unchanged).
2. The region room's live sessions (protocol 6): `battle {live}`, `binput`, `bstart`, `bstep`, `ballow`,
   `bord`, `handover`, `bjoin`, `bwatch`, `bend`, the fallback, limits; relay tests with scripted pages
   (pacing, a handover, a rejoin, both online and p2p hosts).
3. The pages: the defender hosts (`battleLive`), the attacker's worker `live` job, `RegionLink` and the
   game glue; a headless test of two pages through the local relay agreeing on the hash.
4. The battle map (command and watch), the war room's and the battle bar's ways into it; spectators.
5. Wars and treaties between friends through the room (declare, score, terms, capitulation, vassals),
   friends' diplomacy in the Diplomacy tab; tests.
6. Allies' help in a live battle.
7. The region's war history and replays in the City history panel.
8. Co-op roles.
9. The three scenarios.
10. The region harness and the soak.
11. Cross-browser live section; polish (tips, README, narrow and touch); the two-player e2e (both
    commanding, a treaty both accept).
12. Wrap-up: full tests, e2e, balance, bench, cross-browser, network budget, docs, `M39 complete:`, PR.
