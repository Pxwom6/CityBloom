# M37 Weapon development and intelligence: design (plan)

Written before M37 started, from SPEC-5.md (M37 and "Rules for all of phase 5"), the M34–M36 code and `docs/models/PROMPTS-WAR.md`. A plan, not a record: DECISIONS holds what was actually chosen, and this file is updated or deleted as M37 lands.

Time words used below:
- A game month is a game day: 24 war-clock hours, 3 minutes at 1×.
- A game hour takes 7.5 s at 1×.

The approach reuses what exists and keeps the new surface small:
- Research is a counter on the war clock that `warHour` already runs.
- Trials work like training orders at the proving ground.
- Superweapon units are `UNIT_DEFS` entries, trained at the existing bases and sent by `sendForce`.
- Superweapon buildings are `MILITARY_DEFS` entries with M17 `project` stages.
- Damage reaches a city only through `applyWarDamage` or `damageCivic`.
- Incidents are M36 `note()`s that change reputation and relations.
- Operations between friends are decided by the region room, as M36 decides battles.

## Key calls

1. **State appears only where it's used.** Every new key is optional, so a peaceful city plays and saves byte for byte as before (the golden `tests/fixtures/war/peace-main.json` still matches). A war city that never builds a weapons lab also plays as on M36 (see the war golden in step 0).
   - `WarState.research?: Research` is created by the first `queueResearch`.
   - `WarState.intel?: Intel` is created by the first spy mission, or by the first enemy spy. Enemy spies only come once the city has a weapons lab or a spy agency (call 11).
   - `WarState.supers?: { dome?, tower?, gate? }` is created when the first superweapon building is finished.
   - `WarState.blackout?: { from: number; until: number; by: string }` exists only while the city is blacked out or being warned of a blackout (ticks).
   - `WarState.clockCap?: number` exists only in a city bound to a region with war on (call 15).
   - `Unit.ready?: number` is a superweapon's cooldown, in war-clock hours. Absent means ready.
   - `ProjectBuild.clock?: number` is set on war projects only.
   - `CivicDef.max?: number` is used by the weapons lab only.
   - `RivalNeighbour` gains `tech?`, `techAt?`, `blackout?`, `intel?: { revealed?; sabotage?: { what: 'power' | 'depot'; until }; knows?; caught? }`. All are ticks, apart from `tech`.
   - `RegionWarRules.supers?: true` is stored only when the host turns superweapons on. Absent means off, so old region records keep their meaning.
   - Dice:
     - Spy outcomes against computer neighbours use `Rng.fromSeed(`${seed}:spy:${missionId}`)`.
     - Computer spies use `${seed}:spies:${month}` and computer tech uses `${seed}:tech:${month}`.
     - The war, battle and diplomacy streams get no new draws.
   - **Save v30** has an identity migration (`29: (s) => s`). An older build refuses a v30 war save rather than dropping its research.

2. **The tree: six branches of four tiers, keyed `land1` to `logistics4`.**
   - The existing `UNIT_DEFS.research` keys keep their meaning: `land2`, `air2`, `sea2`, `sea3`, `logistics2`.
   - Tier n needs tier n−1 of the same branch. There are no links across branches.
   - Tier 4 of each branch is its superweapon, and it needs a research park in service.
   - The data lives in `src/data/research.ts`: `BRANCHES`, `TIERS` (`key`, `branch`, `tier`, `name`, `blurb`, `points`, `cost`, `unlocks {units?, civics?, ops?}`, `mods?`, `spinoff?`, `park?`), `SPINOFFS`, `TRIAL`, `SUPER`, `DOME`, `BLACKOUT`, `GATE`. `TIERS`' order is the iteration order everywhere.

   | Tier | Points | Money (paid when it starts) |
   |---|---|---|
   | 1 | 300 | $40k |
   | 2 | 700 | $90k |
   | 3 | 1,500 | $180k |
   | 4 (superweapon, park) | 6,000 | $400k |

   One branch is 8,500 points and $710k. The whole tree is 51,000 points and $4.26M.

   | Key | Name | Gives | Civilian spin-off |
   |---|---|---|---|
   | land1 | Field workshops | Vehicles train ×1.25 as fast; land units mend ×2 at base | **Prefab panels:** ×1.3 buildings under construction at once (`GROWTH.baseConstructions` + `constructionsPerPopulation`) |
   | land2 | Heavy armour | **Heavy tank** (prototype) | |
   | land3 | Composite armour | In battle, land units hp ×1.25 and armour +0.05 | |
   | land4 | Giant wind-up robot | **windupbot** (prototype, superweapon) | |
   | air1 | Jet engines | Air attack ×1.15; aircraft train ×1.25 as fast | **Quiet jets:** airport and airfield noise reaches ×0.75 as far (`noise.ts`) |
   | air2 | Heavy bombers | **Bomber** (prototype) | |
   | air3 | Swarm control | Airfields keep 18 units (was 12); drones train in half the time; air hp ×1.15 | |
   | air4 | Sky fortress | **skyfortress** (prototype, superweapon) | |
   | sea1 | Hull design | Sea hp ×1.2; boats train ×1.25 as fast | **Better hulls:** seaport trade ×1.15 (`specialisationIncome`) |
   | sea2 | Naval guns | **Gunboat** and **landing craft** (a prototype each) | |
   | sea3 | Submarines | **Submarine** (prototype); sea armour +0.05 | |
   | sea4 | Clockwork whale | **clockworkwhale** (prototype, superweapon) | |
   | defence1 | Hardened buildings | In battle, military and city buildings ×1.3 strength, homes and businesses ×1.15 | **Fire-safe building:** `fireSpreadChance` ×0.6 |
   | defence2 | Interceptors | **Interceptor battery** (building) | |
   | defence3 | Shield generators | **Shield generator** (building) | |
   | defence4 | Dome shield | **Dome shield** (superweapon building) | |
   | intel1 | Long-range radar | 5 h of warning per working radar (was 3), up to 9 (was 6); a raid's warning names its make-up ("6 light tanks, 2 artillery") | **Signal processing:** research park licence fees ×1.15 |
   | intel2 | Spy agency | **Spy agency** (building); reveal and sabotage missions | |
   | intel3 | Stealth | Steal missions; a third agent; the city's spies are caught ×0.7 as often; air units evade 25 % of hits | |
   | intel4 | Blackout tower | **Blackout tower** (superweapon building) | |
   | logistics1 | Supply lines | Travel ×0.75 on every route (`travelHours`, then rounded) | **Better fire engines:** `extinguishRate` ×1.3 |
   | logistics2 | Repair crews | **Repair truck** (prototype). At home each truck adds ×0.5 to mending at every base (×3 at most), and war-damaged city buildings reopen 25 % sooner. Away, trucks mend the survivors by 0.1 on the way home | |
   | logistics3 | Forward supply | Forces away fight at +0.1 readiness (1 at most); the stores hold ×1.5 | |
   | logistics4 | Express gate | **Express gate** (superweapon building) | |

   - Every effect is one factor, read through `researched(sim, key)` or `spinoff(sim, id)`. With no `war.research` the factor is 1, so peace and M36 war cities are unchanged.
   - The factors are read in: `trainingRate`, `mendUnits`, `travelHours`, `warningHours`, `storeCapacity`, a new `holdsOf(sim, c)` (used by `trainUnit`, `militaryDetails` and the UI), `incidents.ts` (extinguishing and fire spread), growth's construction count, `noise.ts`, `specialisationIncome` and the war-damage repair hours.

3. **Funding and pace.**
   - **Weapons lab** (`militarylab`). Points per war-clock hour = 4 × min(1, staff) × powered × min(1.25, `fundingEff('defence')`). A lab under 25 % staff gives nothing (`WAR.minStaffed`). A city runs at most 3 labs (`CivicDef.max: 3`).
   - **Research park (M10).** With one in service (`hasResearchPark`), the labs' total ×1.5. With the launch complex running (`openProject('launchsite')`) it is ×1.75. Its licence fees are unchanged apart from intel1's spin-off.
   - **Queue.** The labs work on the head of a queue of at most 4 tiers. A queued tier may follow a queued prerequisite.
     - A tier's money is paid when it reaches the head, on the ledger line `weaponsResearch`.
     - If the treasury can't pay, the labs wait with a notice: "Not enough money to start Heavy armour: $90,000". This is checked again each hour, and sandbox cities aren't checked.
     - Taking a tier out of the queue keeps its points and its payment. Queuing it again costs nothing.
     - Nothing is charged unless the player queued it.
   - **Tier 4** works only while a research park is in service. Otherwise the labs pause it: "The giant wind-up robot needs a research park in service".
   - Points accrue in `researchHour`, called from `warHour` after training. They therefore run on the war clock, and the fair clock bounds them in shared regions (call 15).
   - **Pace:**
     - One lab without a park does 96 points a day: tier 1 in about 3 days (9 minutes at 1×), tier 2 in about 7.
     - Three labs and a park do 432 a day, so the whole tree takes about 118 game days (6 hours at 1×, 2 at 3×). With the launch complex it takes 101.
     - This makes M40's "every branch maxed" a long race. The numbers are logged in DECISIONS for M38 to tune.

4. **Prototypes and visible trials.** Research that unlocks a unit kind puts it in `research.prototypes`.
   - `startTrial {ground, kind}` runs a trial:
     - It costs half the unit's money (10 % for a superweapon), on the ledger line `trials`.
     - It lasts `max(12, ceil(hours / 2))` war-clock hours: heavy tank 36, repair truck 18, bomber 48, gunboat 60, landing craft 30, submarine 48. Superweapons take 72.
     - It advances at the ground's staff × power × funding, with the same 25 % floor as training.
     - Each proving ground runs one trial; a second ground runs a second. Sea trials also need a working naval yard (the boat sails off its loop, crewed by the ground).
     - Calling a trial off refunds the share of its money not yet used.
   - Trials can't fail, and the prototype isn't kept (it's tested to bits). A passed trial moves the kind to `research.proven`, with the event `trialPassed`.
   - Each trial is shown as three runs. A notice comes at each third, with a toy line chosen by domain and run number (no dice), for example "Run 2: the heavy tank's turret spun round twice. The engineers fetch a spanner."
   - `unitLock(sim, kind)` replaces the two `def.research` checks in `trainUnit` and `militaryDetails`. It returns null, or one of:
     - "Heavy tanks need Heavy armour research"
     - "Heavy tanks need a trial at the proving ground first"
     - "Your region's rules turn superweapons off"
     - "The city has a giant wind-up robot already" (this counts units and orders)
   - **Trials are visible.** `ForceData.trials` feeds `trialPoses` in `unitPoses.ts`, which are pure functions of the display clock:
     - Land prototypes lap the ground's track: a `Loop` on an inset `roundedRect`, like the depot's pad.
     - Aircraft fly circuits 80 m over the range (the fortress at 120 m, launching 4 drones that circle back).
     - Boats sail the naval yard's `seaLoop`, and the whale surfaces and dives off its quay.
     - The robot walks laps of the track.
     - Prototypes wear test livery: `body` hazard yellow, `body_alt` black.
     - The ground's inspector and the Research tab have **Watch**, which follows the prototype.
   - Buildings have no trials. The superweapon buildings' last project stage is their test ("Emitter and test", "Dishes and test", "First jump").

5. **New buildings** (`MILITARY_DEFS`, on PROMPTS-WAR.md's sites).
   - Their generated looks already exist in `militaryModels.ts`. M37 only wires the defs to them.
   - `MilitaryInfo.research?: TierKey` gates placement in `checkPlacement`, next to the M34 war-on check ("Needs Interceptors research").

   | id | Site | Cost / upkeep a month | Jobs / power | Unlock | Research | Does |
   |---|---|---|---|---|---|---|
   | `militarylab` Weapons lab | 32×32 | $60k / $1,500 | 50 / 60 | 5,000 | — | `lab {points: 4}`; needs the HQ; at most 3 |
   | `spyagency` Spy agency | 24×24 | $50k / $900 | 30 / 20 | 5,000 | intel2 | `agency {agents: 2}`; unique; "the dullest office in town" |
   | `interceptor` Interceptor battery | 24×24 | $30k / $500 | 12 / 30 | 10,000 | defence2 | `defends {air, strength 3, range 360}` plus `intercept`; noise 0.4 over 60 m; safety 160 m / 0.012 |
   | `shieldgen` Shield generator | 24×24 | $80k / $1,800 | 20 / 200 | 10,000 | defence3 | `shield {radius 300, factor 2}`; safety 300 m / 0.02 |
   | `domeshield` Dome shield | 40×40 | project $2.0M / $6,000 | 60 / 600 | 20,000 | defence4 | unique; call 9 |
   | `blackouttower` Blackout tower | 24×24 | project $1.6M / $6,000 | 50 / 500 | 20,000 | intel4 | unique; land value −0.05 within 160 m; call 9 |
   | `expressgate` Express gate | 48×32 | project $2.0M / $6,000 | 60 / 800 | 20,000 | logistics4 | unique; noise 0.5 over 120 m; call 9 |

   - **Project stages** (months, cost):
     - Dome: Foundations 3, $500k / Conduits and spire 4, $900k / Emitter and test 3, $600k.
     - Tower: Base 3, $400k / Tower 4, $700k / Dishes and test 3, $500k.
     - Gate: Platform 3, $500k / Ring 4, $900k / First jump 3, $600k.
   - Projects keep their machinery: payment by stage, offline until finished, `ProjectButton`, the inspector's stage list and stage looks.
     - `ProjectRequirement` gains `{kind: 'research', key, label}`, and `RequirementContext` gains `researched(key)`.
     - **A war project's stage ends** only when its months are done *and* `w.clock − build.clock ≥ 24 × months`. In a city of its own the two are the same, and in a shared region the fair clock bounds it. `projectsMonth` sets `build.clock` at each stage start, for war projects only.
     - The mayor's explicit `GOALS` list means it builds none of these, so `balance` is unchanged.
   - No safety radius is above 300 m, so `MAX_SAFETY` and the cost of `safetyAt` per home don't change.
   - **Fix (found while reading `readinessTarget`):** it counts the jobs of military civics under construction (`civicOnline` is false while `c.build` is set), so a dome being built would drag readiness down for 10 months. `readinessTarget` and `warSummary.staff` skip civics with `c.build`. `militaryStaffing` already passes them by. This needs a test.
   - **The spy agency's 2.9 m ramp pit** is cut into the terrain at placement, with the M24 terraform edit (held ground, war cities only), and raised back when the agency is bulldozed. If this fights the held-ground rules, the ground stays at the site's level, as M34 left it, and DECISIONS says so.

6. **Battles, version 3.** `BATTLE_VERSION` becomes 3. `checkBattleInput` still accepts v2, with none of the new fields, so kept replays and battles waiting in the room play exactly as on M36. Every v3 field is optional, and its code runs only when it's present.

   | Where | Field | What it does |
   |---|---|---|
   | `ForceIn`, `BattleLayout` | `mods?: Partial<Record<UnitDomain, {hp?, attack?, armour?, evade?}>>` | Clamped in the check: hp and attack 1–2, armour 0–0.3, evade 0–0.5. `makeUnit` applies hp, attack and armour (armour at most 0.8) |
   | `BattleLayout` | `dome?: number` | The dome's pool (call 9) |
   | `structs` tags | `TAG.intercept = 1024` (v3 tags 0–2047) | Marks an interceptor battery |
   | `BattleUnitIn` | `from?: number` | The attacker that carries this unit (drones) |
   | `UnitStats` | `stomp?`, `carries?`, `dives?` | The superweapons' behaviours below |

   - **Evade folds into the one existing draw:** a hit is `rng.next() < accuracy × (1 − evade(target))`. That is still one draw per shot, so with no mods the arithmetic and the order of draws are identical.
   - **Attacker mods come from the city's research** (passed in `awayCity`). Defender mods come from the defending city's research, read in `battleLayout`. A computer neighbour's come from its tech (call 12).
   - **Building strength comes only from the layout.** `civicCand` and `buildingCand` multiply hp by the hardened factor (defence1) × the shield factor.
     - The shield factor is 2 within 300 m of a working shield generator (online, staff ≥ 0.25, power ≥ 0.5).
     - `structureAsSeen` computes the same factors, so `adoptBattle` still matches structures.
     - A defender that gained a shield since its save simply takes nothing at those structures, as M35 intends.
   - **Interceptors really intercept.**
     - The shots they can stop: siege ≥ 1, fired from 150 m or more (shells, bombs and torpedo pods), aimed at a structure.
     - Before the hit draw, the battle looks for interceptor structures within 450 m of the target that are ready (their own cooldown, 4 s = 8 steps) and manned, lowest index first.
     - If one is found, one extra draw `rng.next() < 0.5 × manned` decides whether the shot is stopped. A stopped shot is shot kind 3: a puff in the air, no damage, no stray and no crater. The interceptor then cools down.
     - The draw happens only when an interceptor is in range, so a battle without them draws exactly as before.
     - Interceptors also shoot at aircraft as anti-air guns.
   - **Dome pool.** `damage(k, dmg)` on a structure takes from `dome` first while it lasts. When the pool empties there is an event `{k: 'dome', left: 0}` (the dome pops). Frames carry `dome` (the share left). There are no draws.
   - **Stomp** (robot). It drives the roads as now, and switches to `Mode.Free` once within 500 m in a straight line of its objective. Every `every` steps it calls `damage(k, damage)` on structures whose footprint lies within `radius` (`nearStructs`). There are no draws, and the battle's caps still bound it.
   - **Carried drones** (fortress). Units with `from` wait (`Mode.Wait`) until their carrier is within 600 m of its objective, then appear at the carrier, one every 20 steps. If the carrier is knocked out first, the rest leave (`left`).
     - `awayInput` adds 16 drones per fortress, with ids −(1000 + k). `battleReport` ignores them, as it ignores anything not in `e.units`.
     - A v3 input may carry 24 + 16 attackers, and the constructor's `slice` changes to match.
   - **Dives** (whale). The whale can't be targeted while sailing (frame state 3, "dived").
     - It surfaces when within 600 m of its objective's shore, fires for at most 600 steps, then dives and leaves.
     - Target choice skips dived units. It is a nearest-first search with no dice, so other units' draws are unchanged.
   - **Superweapon caps.** A superweapon battle in a computer neighbour's town has `SUPER.caps = {maxCollapse: 24, maxWreck: 5}` (only the score and its forces carry over to the city).
     - Against a friend the skirmish caps stand: 12 and 3 present. Superweapons never strike an absent friend (call 10).
     - `adoptBattle` keeps them whatever the input says.
     - Craters stay capped at `SKIRMISH.maxCraters` in `applyWarDamage`. The caps type needs no new field.

7. **Superweapon units.**
   - The three are `UNIT_DEFS` entries. `UnitKind` is extended, and a new `UnitClass` 'superweapons' ("Superweapons") is added.
   - Each has a `super` block: `{ cooldown: 240, route, travel? }`.
   - They are taken out of `LATER_UNITS`, so the war models file carries their models.

   | | Robot `windupbot` | Sky fortress `skyfortress` | Clockwork whale `clockworkwhale` |
   |---|---|---|---|
   | Base | vehicle depot | airfield | naval yard |
   | Cost | $1.5M | $1.6M | $1.5M |
   | Goods / ore / oil | 600 / 1,200 / 600 | 800 / 800 / 1,200 | 600 / 1,500 / 900 |
   | Training | 360 h, power 300 | 360 h, power 350 | 360 h, power 300 |
   | Upkeep a month | $5,000 | $6,000 | $5,500 |
   | Size (PROMPTS-WAR) | [10, 14, 30] | [80, 24, 26] | [60, 14, 16] |
   | hp / attack / reload | 6,000 / 150 / 4 | 5,000 / 12 / 2 | 7,000 / 220 / 8 |
   | Range / speed / armour | 50 / 4 / 0.6 | 250 / 15 / 0.4 | 450 / 8 / 0.55 |
   | Targets / siege | land, sea / 4 | air / 0 | sea, land / 3 |
   | Special | `stomp {radius 16, damage 300, every 4}` | `carries {kind: drone, n: 16, every: 20}` | `dives {surface: 600, fire: 600}` |
   | Strength (war room) | 60 | 55 | 60 |
   | Route | highway only, travel ×2 (12 h; 14.5 h to north and south) | air only, travel ×2 (3 h) | sea only (10 h), a coastal target |

   - The whale's range of 450 m lets coastal guns (480 m) answer it.
   - **Rules:**
     - One of each per city, counting orders.
     - One superweapon per force: "A force takes one superweapon".
     - Each takes one place at its base, and a superweapon order holds its base's queue for 15 days.
     - They don't defend at home: `battleLayout` leaves them out of `defenders`.
   - **They are never lost.** Knocked out (in `battleReport`), a superweapon winds down to hp 0.05 and is towed home with its force.
     - Its cooldown starts when it is home: `expeditionsTick` sets `u.ready = w.clock + 240`, or 480 if it was knocked out.
     - Sending it before then is refused: "The giant wind-up robot is winding up again: ready in 120 hours".
     - A battle the region refused, or one never fought, spends no cooldown.
   - **The sea route needs a coast.** That means a computer neighbour of kind `resort` (its town grows on the coast map), or a friend whose report has `coast: true`. Otherwise: "The clockwork whale needs a coast: Ashford has none it can reach". The same check now also refuses boats to landlocked towns, which M35 allowed (see Risks).

8. **Superweapons in play, and when they're allowed.**
   - **Region rule.** `RegionWarRules.supers` is off unless the host ticks "Superweapons allowed" in the Region panel or the new-region form.
     - It is allowed at any scale while war is on. `cleanWarRules` keeps the field optional, the `rrules` equality check compares it too, and `warRulesText` adds ", superweapons allowed".
     - A single-player city with rival neighbours always allows superweapons.
   - **With the rule off:**
     - Tier-4 research is still allowed, since M40 needs every branch maxed.
     - Trials, training, placing and using superweapons are refused: "Your region's rules turn superweapons off".
     - What was built before stands idle: units stay parked, the dome stays lowered, and the tower and gate don't fire.
   - **Against computer neighbours,** strikes need no declaration, just as raids don't. They go through M36's `strikeRefusal` (neutral, vassal, a pact asked about first with `info.breaks`).
     - A superweapon strike costs that neighbour's relation −40 (a raid costs −20) and its allies −10.
     - It is fought in their town by the page, like any expedition, and scores in a declared war.
   - **Against friends,** the region room decides (call 14):
     - superweapons must be on;
     - the friend's player must be there;
     - at most one superweapon a UTC day per target, which also counts as one of its three raids;
     - the skirmish caps apply.

9. **Superweapon buildings.**
   - **Dome shield** (`supers.dome = {charge, mode, reserve?}`).
     - It charges from 0 to 1 over 240 war-clock hours while online, staffed ≥ 0.25 and powered ≥ 0.5.
     - `setDome {mode}`, where mode is one of:
       - `all` (the default): raised for every battle in the city;
       - `super`: raised only for battles that bring a superweapon, which the defender reads from the input itself (and for M40's bomb);
       - `off`.
     - At a battle's start in the city, a fully charged dome in the right mode is raised with a pool of 40,000, about a hundred houses' strength, so `layout.dome = 40000`.
     - When that battle ends the dome is down (charge 0) however much of the pool is left: used once, then 240 h to charge. `DOME.bombRecharge` (1,440 h) is reserved for M40.
     - In a blackout it stops charging. A full dome holds 4 h on its reserve, then falls to 0. That is a combination to plan for, and a timing to defend.
     - **A friend's battle:**
       - The attacker's page sets `layout.dome` from the friend's save.
       - The defender's sim is the authority. If its own raised pool is larger than the layout's, `applyWarDamage` takes `ownPool − layout.dome` as an extra pool: it skips damaged and destroyed events while the extra pool covers the structure's strength (`structureAsSeen.hp`).
       - So a stale save never makes the dome weaker. The defender's dome then goes down either way.
     - A friend's charged dome is a warning, not a refusal, before a force is sent: "Ashford's dome shield is up: your robot's blows would land on the dome".
   - **Blackout tower** (`supers.tower = {ready, charging?}`). `useBlackout {neighbour, breakPact?}` charges for 1 h (the dishes spin and the ring glows), and the target is warned for that hour. The effect lasts 12 h, and the tower recharges for 240 h from use.
     - **Against a computer neighbour** (`rival.blackout = {from, until}`):
       - no raids and no spies from it;
       - in battles in its town, its guns are manned ×0.3 (`rivalDefence` reads it through `AwayCity`);
       - its counter-intelligence is 0;
       - relation −15 (an incident through `note()`).
       - It is a strike, so it goes through `strikeRefusal`.
     - **Against a friend,** through the room (call 14). The friend's own sim sets `w.blackout = {from: +1 h, until: +13 h}`:
       - city power plants give ×0.4 (`blackoutFactor` in `utilities.ts`);
       - radars give no extra warning (`warningHours` returns the base hour);
       - the dome stops charging (reserve 4 h);
       - the page darkens lit windows, the data maps ("Maps are out") and the war room's region map;
       - the top bar shows "Blacked out by Ashford: 5 h left".
   - **Express gate** (`supers.gate = {ready}`). `sendForce {…, gate: true}` sends any land or air force (refused for ships: "Ships can't go through the gate").
     - It arrives in 1 h whatever its route. The domains still choose the entry, and the target gets exactly 1 h of warning: "A gate swirls open on your border".
     - The force comes home 1 h after its battle.
     - The gate recharges for 120 h from departure, a departure the room turned away included.
     - Against a friend it needs the friend's player present.

10. **Fairness between friends** (graft from the risk design). Superweapon strikes, blackouts and sabotage are refused against a friend whose player isn't there: "Brookside's player isn't here: superweapons wait for them".
    - A superweapon battle whose target leaves before the room keeps it is refused with no half-strength `again`. The force comes home and no cooldown is spent.
    - Reveal and steal are allowed while the friend is away, since they do no harm.
    - **The superweapon flag can't be dodged.** The room can't read battle data, so the honest page sets `super: true` from the input (`battleHasSuper(input)`), and the room passes it on to the target.
      - A target whose battle brings a superweapon without the room's flag takes nothing from it: "That battle brought a superweapon the region didn't count".
      - A forged page can at worst land an ordinary raid, which is already counted against the day's three.

11. **Intelligence.**
    ```ts
    type SpyOp = 'reveal' | 'sabotage' | 'steal';
    interface Mission { id: number; to: number; name: string; slot?: number; op: SpyOp;
      target?: 'power' | 'depot'; branch?: Branch; depart: number; arrive: number; home: number;
      state: 'out' | 'settling' | 'back'; outcome?: 'success' | 'failed' | 'caught'; paid: number }
    interface Intel {
      missions: Mission[];
      results: { tick: number; with: number; text: string }[];          // newest 12
      lost?: number[];                                                   // ticks a lost agent's replacement arrives
      seen?: Record<number, Dossier & { until: number }>;                // friends revealed, by slot
      theirs?: { id: number; from: number; op: SpyOp; target?: 'power' | 'depot'; arrive: number }[];
      incidents?: Record<number, number>;                                // our spy caught there (tick)
      grievance?: Record<number, number>;                                // their spy caught here (tick)
    }
    ```
    - **The agency** keeps 2 agents (3 with intel3). Each mission takes one agent for its whole length.
      - A caught agent is lost, and a replacement arrives 48 h later.
      - Agents get names from a fixed list by mission id ("Agent Plum").
    - **Missions** (`spyMission {neighbour, op, target?, branch?, breakPact?}`). The agent is out for half the hours, the mission resolves at arrival, and the agent is home after the other half.

      | Op | Research | Cost | Hours | Base success ‰ | Caught share ‰ |
      |---|---|---|---|---|---|
      | reveal | intel2 | $20k | 8 | 850 | 300 |
      | sabotage (power or depot) | intel2 | $45k | 16 | 600 | 500 |
      | steal (a branch) | intel3 | $60k | 24 | 500 | 500 |

    - **Odds in integers per mille** (graft from the player design). `spyOdds` in `src/data/intel.ts` is shared by the sim and the region room:
      ```ts
      success = clamp(base + 50 × (intelTier − 2) − ⌊2 × counter / 5⌋ + (revealed && op ≠ 'reveal' ? 100 : 0), 100, 950)
      caught  = ⌊(1000 − success) × share / 1000⌋ + ⌊counter / 4⌋;  if stealth: caught = ⌊7 × caught / 10⌋
      caught  = clamp(caught, 50, 1000 − success)
      roll r ∈ [0, 1000): r < success → success; r ≥ 1000 − caught → caught; otherwise it fails quietly
      ```
      Worked examples:
      - reveal at intel tier 2 against counter 250: 750 succeed, 137 are caught;
      - sabotage at tier 2 against counter 300: 480 succeed, 335 are caught;
      - steal at tier 3 with Stealth against counter 400: 390 succeed, 283 are caught.
    - **Counter-intelligence (‰).**
      - **The city's:** `counterIntel(sim, from)` = 50 + ⌊300 × agency staff × power⌋ + 50 (intel1) + 100 (intel2) + 100 (intel3), plus 100 against a neighbour at war with it, at most 750. The report's `counter` leaves out the war term.
      - **A computer neighbour's:** cautious 400, honourable 300, treacherous 300, mercantile 250, aggressive 200. Add 200 at war with the city, 150 if it caught a spy of the city within 72 h, and 50 × tech. It is 0 while blacked out, and 850 at most.
    - **Effects on a computer neighbour** (resolved in the city's own sim at arrival, with one draw from `${seed}:spy:${id}`):
      - **Reveal:** `rival.intel.revealed = +240 h`. The war room shows its exact forces, defences by kind and where they stand (from the page's town), its tech, and its raid plans ("Planning a raid: likely within a day"). Battles there get +0.1 attacker readiness, and its raids give the city 2 h more warning.
      - **Sabotage power:** for 72 h its guns are manned ×0.5 in battles there, and it doesn't raid.
      - **Sabotage depot:** its forces ×0.9 at once, and no arming for 6 months.
      - **Steal:** 25 % of the next tier's points in the chosen branch, banked without paying for the tier. This needs `rival.tech` greater than the city's tier in that branch, and works once per neighbour per tier. Otherwise it is refused before the agent leaves: "Gravelford is no further than you in Air research".
    - **Computer spies.** `intelMonth` runs after `diplomacyMonth`, and only once the city has a weapons lab or a spy agency.
      - **Who comes:**
        - Each neighbour's monthly chance is 0.05, or 0.12 if it is aggressive or treacherous. It is ×2 at war, ×0.5 under a pact (treacherous ones ignore pacts) and ×0.25 against a neutral city.
        - Never from a vassal, a blacked-out neighbour, or one whose power was sabotaged.
        - At most one spy a month in all.
      - **The op:** sabotage at war; steal when the city's best tier is above the neighbour's tech; otherwise reveal. The spy arrives 8–24 h later (`intel.theirs`) and is rolled with `spyOdds` against `counterIntel(sim, from)`.
      - **Not caught:**
        - Sabotage closes the city's largest working power plant, or the vehicle depot, for 24 h through `damageCivic` (now exported): "Saboteurs from Gravelford closed the coal plant for a day".
        - A reveal sets `rival.intel.knows = +240 h`, so its raids get +0.1 readiness.
        - A steal brings the neighbour's next tech step 6 months sooner.
        - The city hears of a quiet reveal or steal only with counter ≥ 400.
    - **A caught spy is a diplomatic incident** (through M36's `note()`).
      - **The city's spy caught:**
        - Reputation −5. The neighbour's relation −15 (−25 under a pact), and its allies −5.
        - Honourable and cautious neighbours end any non-aggression pact or alliance with the city. That is not a breach by the city, so it carries no −30.
        - `incidents[n]` is set. While it is fresh (24 h), `computerMoves` lets that neighbour declare at 1.0× the city's strength instead of 1.5×, at twice the chance, with the reason "We caught your spies in our town".
        - A caught sabotage also sets `w.struck[n]`, so the neighbour may answer even a young city.
      - **Their spy caught:**
        - The notice: "Your agents caught a spy from Gravelford at the vehicle depot".
        - Their relation −10, and `grievance[n]` is set. Declaring war on them within 72 h costs no reputation (alongside `struckUs`), with the reason filled in.
        - At war, the score gains +3.
    - **Rules reused from M36:**
      - Sabotage is a strike (`strikeRefusal`); reveal and steal are not.
      - A neutral city sends only reveals.
      - A successful sabotage in a declared war is +3 to the score (−3 for the city that suffers it).

12. **Computer neighbours' tech: a small arms race, only where the city researches.**
    - `rival.tech` runs from 0 to 4. It advances at month close only once `w.research` exists ("Your weapons lab has your neighbours worried"), using the dice `${seed}:tech:${month}`.
      - The chance is 0.06 × character (aggressive 1.3, treacherous 1.2, cautious 1, honourable 1, mercantile 0.8) × min(1.5, population / 10,000).
      - At most one step per 12 months (`techAt`).
    - **What their tech brings:**
      - tech ≥ 1: their units get the land1, air1 and sea1 battle mods;
      - tech ≥ 2: heavy tanks and bombers join the aggressive, honourable and treacherous raid mixes (`RIVAL_MIX_TECH`);
      - tech ≥ 3: land3, air3 and sea3 mods, and hardened structures in their towns (in `rivalDefence`, so there's no `TOWN.version` bump).
    - Computer neighbours build no superweapons in M37 (left to M38).

13. **Fog of war (page only).** Computer neighbours' forces and defences show as bands, rounded to 5 and ±30 % ("forces 15–25"), and their tech as "?", unless a reveal is fresh.
    - The sim keeps the exact numbers, and `warSummary.intel.revealed` tells the page which neighbours are revealed.
    - Tests read numbers through `getWarRoom()`.
    - A friend's military shows only in a reveal's dossier. A read-only visit still loads a friend's whole save, which is accepted among friends.

14. **Between friends: the region room decides** (protocol 5). Each city's sim takes the verdict as a command to itself.
    - **Ops are their own messages,** so spies never crowd out battles:
      - client → room: `{t:'op', to, id, op: 'reveal'|'sabotage'|'steal'|'blackout', target?, branch?}` (under 1 KB) and `{t:'opSeen', id, from}`;
      - room → sender: `{t:'opKept', id, outcome, stole?}` and `{t:'opRefused', id, reason, later?}`;
      - room → target: `{t:'opOn', from, id, op, outcome, target?, late}`.
    - **The room checks, in plain words:**
      - war is on, and superweapons are on for a blackout;
      - a neutral sender or target allows reveal only;
      - a newcomer target allows reveal and steal only, unless it raided the sender (`raidedBy`);
      - the target's player is online, for sabotage and blackout;
      - `opsPerDay: 4` per target per UTC day, `sabotagePerDay: 1`;
      - a blackout counts in `supersPerDay: 1` and in `raidsPerDay: 3`;
      - at most 8 ops pending per city (separate from battles);
      - each sender gets one op every 2 minutes, in bursts of 3;
      - a steal needs the target's `tiers[branch]` above the sender's.
    - **The verdict.** The room rolls `r` with `crypto.getRandomValues` and decides with `spyOdds(op, sender.tiers.intel, target.counter, false, sender.tiers.intel ≥ 3)`.
      - It remembers the verdict of each sender's last 24 op ids, so an op sent again gets the same answer and grinding ids gains nothing: each new id costs one of the day's ops.
      - A caught spy sets `target.raidedBy[sender]` and sends a region-wide notice: "A spy from Ashford was caught in Brookside".
    - **The sender's side.**
      - At arrival the sim emits `spyArrived` and pins the mission (`spySettling`, as with `battleSettling`).
      - `src/client/ops.ts` posts the op. On `opKept` it dispatches the page-only `missionResult {mission, outcome, stole?, dossier?}`. For a reveal, the page builds the dossier from the friend's latest region save (`fetchCitySave`): forces and defences by kind, `tiers`, superweapons, and the dome's charge.
      - On `opRefused` the agent comes home and the money is refunded in full (nothing happened).
      - The blackout tower's recharge starts only on `opKept`.
    - **The target's side:** the page-only `opResolve {from, id, op, outcome, target?, late}`.
      - `checkOpInput` checks the shape.
      - Each op is taken once (`w.taken` key `${slot}:op:${id}`).
      - The target's own sim picks what a sabotage closes: its largest working plant, or its vehicle depot, for 24 h through `damageCivic`.
      - A blackout sets `w.blackout`; a late one (its player left before seeing it) brings only a notice.
      - A caught spy is logged as an incident on both sides.
    - **Battles:**
      - The client's `battle` gains `super?: true`. The room refuses it if superweapons are off, the target is offline, or the day's superweapon is spent, and it delivers the flag.
      - `forceOut` and `incoming` gain `super?: UnitKind` and `gate?: true`, so the target's banner can name what's coming.
    - **`RegionReport`** gains `tiers?: number[]` (six tier counts, also the start of M40's race), `counter?: number` and `coast?: true` (cached per terrain version), for war cities only.
    - **A shared co-op city** may research and build. Its spies and blackouts against friends are refused until M39 ("Spies from a shared city come with war among friends"). Against computer neighbours they're allowed, since they are resolved in its own sim.

15. **The fair clock** (pulled forward from M39 for research, trials, training, cooldowns and war project stages; SPEC-5 asks for it).
    - **In the room:**
      - Each city has `fair = {hours, at}`, started at the war clock in its first report (the report gains `clock?`).
      - Each report adds `min(now − at, 120 s) / 7,500 ms` while that city has a connection. That is 1× pace, and only while its player is here.
      - It is written with the existing 5-minute keep, so there are no extra rows, and the view carries `fair` per city.
    - **On the page:** it dispatches the page-only `warClock {cap: fair + 48}` whenever the cap moves by an hour or more, and `{cap: null}` when the city leaves its region. A shared co-op city's host sends it as a stamped command.
    - **In the sim:** while `w.clock ≥ clockCap`, `warHour` holds the clock and everything that runs on it. Readiness, the stores and upkeep go on.
    - So a city at 3× gets a 48 h bank and then runs at the region's 1× pace: "Your city is ahead of the region's clock: research waits about 6 minutes".
    - A city of its own never has a cap.

16. **Commands, permissions, refusals.**
    - **New commands:**
      - `queueResearch {key}` and `unqueueResearch {key}`;
      - `startTrial {ground, kind}` and `stopTrial {ground}`;
      - `spyMission {…}`;
      - `useBlackout {neighbour, breakPact?}`;
      - `setDome {mode}`;
      - `sendForce` gains `gate?`.
    - **Page-only:** `missionResult`, `spySettling`, `opResolve`, `warClock`.
    - **Test-mode cheats:**
      - `researchPoints {points}`: poured into the queue in order; every order is still a click;
      - `research {tiers}`: scripted tests only;
      - `spyIn {neighbour, op, target?}`: a computer spy arrives now;
      - `rivalTech {neighbour, tech}`;
      - `superReady`: clears cooldowns;
      - `finishStages {civic}`;
      - `raidIn` gains `units?`.
    - **Permissions in `rules.ts`:** `spend` for research, trials, spies, blackout and sending; `policies` for the dome's mode. Validators go in `commandCheck.ts`, and none of these commands is undoable.
    - **Refusals, beyond those above:**
      - "Weapons research needs a weapons lab"
      - "The city runs three weapons labs: the most it can use"
      - "Land research is finished"
      - "Heavy armour comes first"
      - "The research queue holds four"
      - "Prototypes are tested at a proving ground"
      - "The proving ground is busy with the bomber's trial"
      - "Sea trials need a naval yard"
      - "The proving ground is short of staff (20 %)"
      - "Heavy tanks have passed their trial already"
      - "Spy missions are run from a spy agency"
      - "Both agents are out: one is back in 5 hours"
      - "A neutral city only sends spies to look"
      - "The giant wind-up robot walks: it goes by road"
      - "The express gate is recharging: ready in 40 hours"
      - "The express gate is still being built"
      - "The blackout tower is recharging: ready in 200 hours"
      - "Ashford has had four spies today: no more until midnight (UTC)"
      - "Ashford has taken a superweapon today: no more until midnight (UTC)"

17. **The page: what the player sees, decides and is told.**
    - **War room tabs:** Forces, Send, Map, **Research**, **Intelligence** (`war-tab-intel`), Diplomacy, Upkeep, Readiness, Reports.
    - **Research tab** (`src/ui/Research.tsx`, replacing the stub):
      - A header: "2 labs · 8 points an hour · research park ×1.5". It names the fair-clock hold when there is one.
      - The queue strip with an estimate in days.
      - Six branch columns of four tiers. Each tier shows its effect in numbers and a chip ("Unlocks: Heavy tank, after a trial", "Spin-off: Better fire engines", "Superweapon").
      - Each tier's state: done; queued #n; a bar with hours left; Research and its price (`research-start-<key>`); or locked with its reason.
      - Prototypes, each with "Trial ($X, N h)" (`trial-start-<kind>`), run marks and Watch.
      - On narrow windows (`data-width=s|xs`) it becomes branch chips over a list.
    - **Intelligence tab** (`src/ui/Intel.tsx`):
      - the agency: agents and counter-intelligence;
      - a send form: neighbour, op, target or branch, cost, hours, and the odds in words and numbers ("About 3 in 4 to succeed, 1 in 7 to be caught: Gravelford's counter-intelligence is weak"). The refusal stands in place of the button, and M36's break-pact question appears when needed;
      - missions with countdowns, dossier cards ("Revealed 2 days ago, good for 8 more"), how to raise counter-intelligence, and the incident log.
    - **Forces tab:** a superweapons strip, six slots (`super-<id>`): research it / trial / train at the depot / building, stage N / ready / away / winding up N h / down N h / off by the region's rules.
    - **Inspectors** (`militaryDetails` extended):
      - lab: points an hour;
      - proving ground: the trial, prototypes waiting, Start, Watch;
      - agency: agents and counter-intelligence;
      - shield generator: reach and buildings covered;
      - dome: charge, mode buttons (`dome-mode-<mode>`) and "Holds about 100 houses' worth of hits";
      - tower: a neighbour picker and Black out (`blackout-use`);
      - gate: its recharge;
      - superweapon units: "Wound up" or "Winding up: 120 h", and Send.
    - **Send tab:** superweapons in their own group; routes with a reason when barred; the gate checkbox (`send-gate`) "Through the express gate: arrives in an hour"; the dome warning for a friend.
    - **Region map:**
      - a robot token striding along the highway line, a drifting fortress, and a dotted, submerged whale;
      - a sparkle arc for a gate jump;
      - an eye on revealed neighbours, and blacked-out cities hatched dark;
      - tier dots per friend.
    - **The target's side** (graft from the player design):
      - instead of the raid chip, a full-width banner with the superweapon's silhouette and a countdown ("A GIANT WIND-UP ROBOT is walking here from Ashford: 9 h. It comes from the west.");
      - its own siren as a `sounds.ts` recipe: a music-box tick-tock for the robot, a deep drone hum for the fortress, a foghorn and whale song for the whale, a power-down whine for a blackout, a whoosh for the gate;
      - Follow on arrival, the superweapon's health bar in the battle bar, and a stamp on the report ("Stomped by a giant wind-up robot").
    - **Notices** for `researchDone`, `researchWaiting`, `prototypeReady`, `trialRun`, `trialPassed`, `spinoff`, `spyResult`, `spyCaught`, `enemySpyCaught`, `sabotaged`, `superReady`, `domeRaised`, `domePopped`, `blackout`, `gateJump` and `clockHeld`. The M8 alert sound plays on a blackout and on sabotage.
    - **Tutorial tips:**
      - `research`: the first Research tab with a lab;
      - `trial`: the first prototype waiting;
      - `spinoff`: the first spin-off;
      - `intelligence`: the first Intelligence tab with an agency;
      - `superweapon`: the first tier 4 open;
      - `dome`: the first dome finished;
      - `blackout`: the first blackout suffered;
      - `incident`: the first spy caught, either way;
      - `fairClock`: the first time the clock is held.

18. **Rendering, each effect with a cost switch per quality.**
    - **Generated looks:**
      - The three superweapons get `unitModels.ts` `BUILDERS` entries, which the `Record<UnitKind>` type forces.
      - The seven buildings use their existing `militaryModels.ts` looks.
    - **Motion codes:** two new ones in the unit shader, with no new per-instance attributes:
      - `limb` swings `arm_*` and `leg_*` from the existing `rolled` attribute, left and right in opposite phase;
      - `sweep` turns `tail` from `spin`.
      - `windup_key` uses `spinZ`, `jaw` uses the hatch code, and the tower's `radar_dish` turns like the radar station's dish.
    - **Poses:**
      - the robot's gait;
      - the fortress's propellers, and its hatches open while it launches;
      - the whale surfacing (rising through spray), opening its jaw to fire, and diving.
      - At home they park in a robot bay at the depot, a mast slot on the airfield and a whale berth at the naval yard's quay.
    - **Effects** (`src/render/shields.ts` and `battle.ts`):
      - shield bubbles and the dome as a fresnel-rim shell, one draw call each, with a flash when hit, and a soap-bubble pop when the pool empties;
      - interceptor puffs (shot kind 3);
      - stomp dust (the smoke puffs);
      - drone launches;
      - the gate's swirl disc;
      - the blackout ring's glow and the target's darkened windows (the night-glow uniform).
    - **Quality switches:**
      - `shields`: full at High, rim at Medium, a ground ring at Low;
      - the swirl stays on at Low;
      - spray and dust are halved at Medium and off at Low;
      - drones past far range are drawn as dots.
    - **Test API:** `getResearch()`, `getIntel()`, `getSupers()`, `stageBattle('max' | 'robot')`.

## Steps

0. **Goldens at the M36 tip, before any change** (graft from the player design):
   - a war golden of the scripted war town's part hashes over 8 months with no lab (`tests/fixtures/war/m36-war.json`);
   - the M35 and M36 battle hashes, and a kept v2 replay fixture for `tests/war/battleSafety.test.ts`;
   - a v29 war save added to `Saves/legacy/` (`legacy-corpus.mjs 29`).
1. **Data:**
   - `src/data/research.ts` and `src/data/intel.ts` (`INTEL`, `spyOdds`);
   - the three superweapon `UNIT_DEFS`, the class and the `UnitStats` specials;
   - the seven `MILITARY_DEFS` with projects and `research` gates, and `CivicDef.max`;
   - the `research` requirement kind;
   - `RegionWarRules.supers` with `cleanWarRules`, `warRulesText` and the `rrules` check;
   - the DIPLOMACY incident numbers;
   - `LATER_UNITS` trimmed.

   Tests:
   - every `UNIT_DEFS.research` key is a tier, every locked unit and gated building is unlocked by exactly one tier, and each branch ends in its superweapon;
   - sites match PROMPTS-WAR (`readWarSites`);
   - `spyOdds` against the worked examples;
   - the peace golden, and toolbar and unlock lists unchanged in peace.
2. **Research core** (`src/sim/systems/research.ts`):
   - the queue, points, money, park and launch complex, the tier-4 pause;
   - `unitLock`, the `checkPlacement` gate and `CivicDef.max`;
   - war-project stages on the war clock;
   - the readiness and staff fix;
   - `WarSummary.research`;
   - save v30.

   Tests (`tests/war/research.test.ts`):
   - exact points with 1, 2 and 3 labs, with and without a park, the launch complex and funding;
   - queue order, waiting for money, keeping points;
   - every refusal's text;
   - a dome under construction doesn't lower readiness;
   - v29 war and peace saves load unchanged apart from `version`.
3. **Trials:** `startTrial`/`stopTrial`, progress, `proven`, `ForceData.trials`, the lock in `trainUnit` and `militaryDetails`. Tests:
   - a heavy tank can't be trained before its trial and can after;
   - one trial per ground;
   - sea trials need a naval yard;
   - the refund on calling one off.
4. **Upgrade and spin-off hooks,** one factor each. Tests:
   - each factor is exactly 1 without research and exactly its value with it: training, mending, travel, warning, stores, holds, constructions, extinguishing, fire spread, noise reach, seaport, licence fees, repair hours;
   - the war golden from step 0 still matches.
5. **Battle v3:**
   - mods and evade;
   - the layout factors (hardened, shield) in `civicCand`, `buildingCand` and `structureAsSeen`;
   - the interceptor;
   - the dome pool and `applyWarDamage`'s extra pool;
   - stomp, carried drones, dives;
   - 24 + 16 attackers;
   - `SUPER.caps`;
   - `checkBattleInput` for v2 and v3.

   Tests (`tests/battle/battle3.test.ts`):
   - v2 inputs and v3 inputs with no new fields replay to the step-0 hashes;
   - mods move a fixed battle the same way twice;
   - an interceptor stops shells only within 450 m, and a battle without one draws as before;
   - a dome pool soaks hits and pops;
   - stomp fells structures along its path and stops at the caps;
   - a fortress launches 16 drones, fewer when downed first;
   - the whale can't be hit until it surfaces;
   - `adoptBattle` still matches with each factor;
   - `battlebench --super` measured before the UI is built.
6. **Superweapon units in expeditions:**
   - uniqueness, one per force, routes and robot travel ×2, the coast check;
   - never lost, `Unit.ready`, cooldown ×2 when knocked out;
   - out of home defence.
7. **Superweapon buildings and rules:**
   - the dome (charge, modes, raising in home battles, reserve);
   - the blackout against computer neighbours (charge hour, `raidsHour` skips, layout manning);
   - the gate;
   - `rules.supers`;
   - `tests/war/superweapons.test.ts`.
8. **Intelligence against computer neighbours** (`src/sim/systems/intel.ts`):
   - missions, `spyOutcome`, effects, `counterIntel`;
   - `intelMonth` (gated on a lab or agency);
   - incidents in `computerMoves` and `declareWar`, the score;
   - rival tech in `rivalDefence` and the mixes;
   - the cheats.

   `tests/war/intel.test.ts`.
9. **Between friends:**
   - protocol 5: ops, the `super` flag, the room's limits, verdicts and memory, `fair`;
   - report `tiers`, `counter`, `coast`, `clock`;
   - `src/client/ops.ts`, `missionResult`, `opResolve`, the `battleResolve` super check.

   Tests:
   - `relay/tests/regionOps.test.ts`;
   - `relay/tests/fairClock.test.ts`;
   - sim tests for `opResolve` (forged and stale inputs harm nothing; each is taken once);
   - a two-player headless harness test (`relay/tests/harness.ts`).
10. **Fair clock in the sim:** `warClock`, the `warHour` hold, project stages. Test: a city at 3× holds training and research at the cap and catches up when it moves.
11. **Rendering:**
    - the looks, motion codes, trial and superweapon poses and parking, the effects, the quality switches, the spy agency's ramp;
    - scenes `node scripts/dev/supershot.mjs <out>` (`ONLY=buildings,trials,robot,fortress,whale,dome,shield,interceptor,gate,blackout`), `warshot.mjs` with the new buildings as real ones, and `unitshot.mjs ONLY=trial,supers`;
    - screenshots reviewed.
12. **UI:**
    - the Research and Intelligence tabs, the superweapons strip, the inspectors, the Send tab, the region map, fog bands, banners, sirens, notices, refusals, tips, the Region panel's rule;
    - grep the M34–M36 e2e for text checks the bands change;
    - the e2e specs below.
13. **Wrap-up:**
    - the measurements below;
    - the cross-browser additions;
    - `netbudget` and the soak with a spy and a blackout;
    - DESIGN §3.31, DECISIONS "M37" (including the fair clock moving from M39), the CLAUDE.md note "Research and intelligence (M37)", SPEC_REVIEW, PROGRESS (To check on the Mac: the battle frame times);
    - an `M37 complete:` commit and its PR (it joins the open one if there is one).

## Tests

- **Research unlocks every branch's units through the real UI** (`e2e/m37-research.spec.ts`, one page, Low graphics).
  - **Set-up:**
    - A sandbox city with rival neighbours on a coastal seed (`servedTown`, `armTown`, everything unlocked).
    - Through the toolbar, place an HQ, a vehicle depot, an airfield, a naval yard, a proving ground, three weapons labs, a university and a research park.
    - The only shortcut is `researchPoints` for points.
  - **Research.** In the Research tab, click Research on all 24 tiers in order. The trials run in game time (`advance()`), started from the proving ground's inspector, for all nine prototypes.
  - **Training.** At each base's inspector, train each of the nine formerly locked kinds: heavy tank, repair truck, bomber, gunboat, landing craft, submarine, robot, fortress, whale. `getForces().orders` holds an order for each.
  - **Every kind.** In `militaryDetails().trains`, every `UNIT_DEFS` kind either has `why: null` or has an order.
  - **Buildings.** The interceptor, shield generator and spy agency place from the Military bar, and the dome, tower and gate show as placeable projects.
  - **Screenshots, reviewed:** the Research tab, a heavy tank in test livery on the track, the robot in its bay.
  - **Backed by** the closure test of step 1.
- **A spy mission and a counter-intelligence catch each work in a scripted test** (`tests/war/intel.test.ts`).
  - Outcomes are never hardcoded: each case finds the first mission id whose `spyOdds` roll gives the wanted outcome, then checks that the sim did exactly that.
  - (a) The city's reveal, sabotage and steal against a computer neighbour, with their effects:
    - `revealed` until +240 h, and +0.1 readiness in `awayInput`;
    - its guns manned ×0.5 in the next `awayInput`, and no raids for 72 h;
    - 25 % of the tier banked, and a steal refused when the neighbour's tech is no further ahead.
  - (b) `spyIn` sends a rival's sabotage at a city with a staffed agency and intel tiers bringing counter to 750.
    - A caught spy: an incident notice and log entry, the rival's relation −10, a grievance, and `declareWar` within 72 h costs no reputation.
    - An uncaught spy closes the largest plant for 24 h through `damageCivic`, and the disasters' repair reopens it.
  - (c) The city's spy caught by a cautious neighbour at war: reputation −5, relation −15, allies −5, its non-aggression pact ended without a breach, and a fresh incident lets it declare at 1.0× strength.
  - (d) 400 missions at known odds succeed and are caught within ±5 % of `spyOdds`.
  - **Friends:**
    - `relay/tests/regionOps.test.ts`: verdicts kept, delivered and seen; the same verdict for a resent id; the daily, newcomer, neutral and absent refusals; a caught spy → `raidedBy` and the region notice; superweapons off.
    - The harness test: a sabotage closes the target's plant in its own sim, and both logs agree.
    - `e2e/m37-friends.spec.ts` (two pages, Low, small windows; run alone, on the Mac if the VM's joins fail): a sabotage on a present friend and a blackout with its 1 h warning, the darkened maps and the cooldown, with screenshots.
- **A superweapon is built, used once and goes on cooldown** (`tests/war/superweapons.test.ts`).
  - **The robot, start to finish:**
    - Cheat land 1–3, then research land4 with points.
    - The 72 h trial and the 360 h training run in game time.
    - `sendForce` by highway (12 h), fought headless (`awayInput` and `Battle.run`) on a `TOWN.testCap` town: buildings fall along its path, no more than `SUPER.caps`.
    - `battleReport` brings it home even when knocked out, with `u.ready = clock + 240` (480 if knocked out).
    - A second send is refused with the hours left, and accepted after `advance(240 h)`.
  - **The same file also checks:**
    - the dome, built through its three stages in game time: raised once in a `raidIn` raid, soaking it, down 240 h, recharged;
    - the dome's extra pool on a friend's input made without it;
    - the blackout: a computer neighbour doesn't raid for 12 h after the 1 h charge, and the tower recharges;
    - the gate: 1 h out, home 1 h after, recharge 120 h;
    - the fortress and the whale each fight once, with the same hash twice;
    - `rules.supers` off refuses each step.
  - `e2e/m37-super.spec.ts` through the UI:
    - send the robot from the Send tab, watch it stomp, and see "winding up" in the strip;
    - place a blackout tower (`finishStages`), black out a rival through its inspector and see the recharge;
    - screenshots of the stomp, the charge and the region map.
- **The frame budget holds in the heaviest battle you can stage.** `stageBattle` (page only) on the 100k bench city, at night, at 3×:
  - `max`: a fortress with 16 drones and 23 bombers and fighters, against 64 defenders and 48 defences (8 interceptors firing), 4 shield bubbles, the dome raised and popping, and buildings on fire;
  - `robot`: the robot and 23 heavy tanks, with stomp dust.

  Thresholds:
  - **On the Mac:** `framebench.mjs bench-results/city.gz --views battle-max,battle-robot,heavy --quality high,medium,low`: High ≤ 12 ms on average; Medium and Low no slower than the phase-3 start ("To check on the Mac").
  - **In the VM**, against the same view without the battle: draw calls at most +60, triangles at most +450k, `recordFrames` game work at most +2 ms. The effect pools stay within their caps (puffs 400, drones 16, shots 64 a tick).
  - **Ticks** (`battlebench.ts bench-results/city.gz --super robot|fortress|whale --dome --guards`): the battle averages ≤ 0.5 ms a tick, worst ≤ 8 ms, the whole battle at once ≤ 250 ms (M35: 0.28, 4.6, 103), and the message size is logged. A blackout day's tick average is at most 1.1× a normal day's.
- **Phase rules:**
  - **Peace and balance:**
    - the peace golden is unchanged;
    - the M36 war golden reproduces;
    - `balance.ts 20` with rivals off is line for line as on `main`, and with rivals on matches M36 (the mayor builds no lab).
  - **Saves:**
    - the v29 war save loads, gains no keys, and plays two years;
    - a v30 save made mid-trial, with a mission out, a superweapon on cooldown, the dome down and `clockCap` set, plays on identically to an unsaved run (graft from the risk design);
    - the kept v2 replay plays to its hash.
  - **Cross-browser** (`e2e-xb/determinism.spec.ts` and `tests/lockstep/determinism.ts`) gains, in Chromium, WebKit and Firefox (or SpiderMonkey), with two lockstep copies agreeing on every new command:
    - research points over 30 days and a trial;
    - ten computer missions and five rival spies;
    - the robot and fortress battles;
    - a dome raid, a blackout and a gate trip;
    - the v2 replay.
  - **Network budget:** `netbudget.ts` and the soak include ops (under 1 KB each) and the view's `fair`.
  - **Refusals and tips:** a table test sends each refused command and compares its text. A guide test checks that each new tip fires once, on its trigger.

## Risks

- **Scope.** There are 24 tiers, 7 buildings, 3 units, battle v3, an op channel and the fair clock. The steps put the e2e path (research, trials, units) first and superweapons and friends later, and `battlebench` is measured before the UI.
- **Battle v3 changing old battles.** Every new field is optional and guarded, evade folds into the existing draw, and interceptors draw only in range. The step-0 hashes catch any drift.
- **Matching in `adoptBattle` with strength factors.** Both sides compute them from the same save; a defender that changed takes less, never more. Each factor gets a test.
- **New hooks shifting M34–M36.** Rival spies and rival tech are gated on a lab or agency, and spin-offs on research. The war golden and the full war suite run at step 4.
- **The fair clock changes training in region cities at war.** That is intended by SPEC-5, and DECISIONS moves it from M39.
  - It may frustrate a 3× player. The 48 h bank and the plain wait message soften that.
  - If it slips, ship with the room's daily limits, superweapons off by default, and a note in PROGRESS.
- **Trust between friends.** The room rolls spy verdicts and remembers them per id. Honest pages flag superweapon battles, and an unflagged one is taken as nothing. Effects are bounded by the target's own sim and its daily limits.
- **Stale saves.** As with M35 battles, the attacker fights on the latest save. The dome's extra pool and sabotage chosen by the target keep the defender authoritative.
- **Fog of war breaks M34–M36 e2e text checks.** Grep the specs and read numbers through the test API.
- **The coast check changes M35 behaviour** (sea raids on landlocked towns are now refused). Check the M35 specs for sea sends. Rarely, a resort town falls back from the coast map to a river map; that fight ends `withdrew` with no score and the cooldown spent.
- **Dome overdraw** when the camera is inside it. Only the fresnel rim is drawn at low alpha, only while raised or for 6 s after a change, and Low draws a ring. Check on the Mac.
- **Project machinery for military buildings.** The chronicle's openings and `balance`'s goal lists must read sensibly.
- **The spy agency's terrain cut.** It touches `terrainDelta`, war cities only, and has the fallback above.
- **E2e time on SwiftShader.** One page per spec except friends, `advance()`, Low graphics. The friends spec runs alone.
- **Nine tabs on narrow windows.** The tabs scroll, and the Research grid has its list fallback; M39 polishes touch.

## Decided questions

- **Research runs on the war clock, the head of a queue of four, with points kept per tier:** one clock for every war timer, and the queue saves babysitting.
- **Money is paid when a tier starts, with no refund on switching:** cost stays legible, and switching loses nothing.
- **At most three weapons labs:** a predictable pace for M40's race.
- **Only tier 4 needs a research park:** the submarine and the defences stay within reach of a Small city, and superweapons stay late-game.
- **Trials can't fail, run as three visible marks, and the prototype isn't kept:** toy drama without dead ends, and no free unit.
- **Only units have prototypes; the superweapon buildings' last stage is their test:** a trial needs a moving model on the track.
- **Upgrades are per domain, through generic battle mods:** one small mechanism instead of many bespoke ones.
- **Interceptors stop shells and bombs, not just aircraft:** that's what an interceptor is, and it costs a draw only in range.
- **The dome is a pool for one battle, then down 240 h, with a mode:** it is useful against computer raids in single player now, and it lands M40's "stops one bomb".
- **A blackout halts the dome's charge, with a 4 h reserve:** a combination worth planning.
- **Superweapons never die: knocked out, they're towed home on double cooldown:** losing $1.5M to dice isn't fun, and the cooldown keeps the cost.
- **One of each per city, one per force, never defending at home:** they're singular prizes, and the heaviest battle stays bounded.
- **Superweapons are off in regions until the host opts in, and on for single-player rivals:** safe for friends by default, and old regions keep their meaning.
- **Tier-4 research stays allowed when superweapons are off:** M40 needs every branch maxed.
- **Friends take skirmish caps, never superweapon caps:** a superweapon is sure to do a raid's worth of damage, never more.
- **Superweapons, blackouts and sabotage are refused against an absent friend; reveal and steal are not:** nobody comes back to a stomped city, and looking does no harm.
- **Superweapon strikes on computer neighbours need no declaration, but go through `strikeRefusal`:** consistent with raids and M36's pacts.
- **The room rolls friends' spy outcomes with its own randomness and remembers them per id:** one authority, and no grinding.
- **The integer `spyOdds` is shared by the sim and the room:** both sides compute the same odds in every browser.
- **Ops have their own messages and pending list:** spies never crowd out battles.
- **Sabotage is a strike; reveal and steal are not:** matches M36, and espionage short of damage isn't aggression.
- **A neutral city only sends spies to look:** neutrality is a defensive stance.
- **Computer spies and computer tech start only once the city has a lab or agency:** they come for its secrets, and M34–M36 cities stay as they were.
- **Computer neighbours research, but build no superweapons in M37:** their threat stays readable, and M38 tunes them per difficulty.
- **Computer neighbours' numbers show as bands unless revealed:** otherwise a reveal shows nothing new.
- **The fair clock lands in M37:** research and cooldowns are the first long timers where 3× matters between friends.
- **`BATTLE_VERSION` 3 still reads v2:** kept replays and waiting battles keep playing.
- **The whale's range is 450 m:** coastal guns (480 m) can answer it.

## Left to M38–M40

- **M38** (difficulty and economy levers, tuned with balance runs on every difficulty):
  - research and trial prices, spy odds and computer tech pace per difficulty;
  - computer superweapons on Hard;
  - selling researched units and munitions to allies;
  - sanctions that slow research;
  - superweapon upkeep in war weariness;
  - the balance mayor researching.
- **M39** (needs lockstep battles and roles between players):
  - live orders for superweapons (steer the robot, call drone waves, dive);
  - spies, blackouts and strikes from shared co-op cities, by role;
  - incidents as reasons for declarations between friends;
  - superweapon strikes and incidents in the region's war history;
  - narrow and touch polish for the Research and Intelligence tabs.
- **M40:**
  - the bomb unlocking with all 24 tiers (the race reads the report's `tiers`);
  - the enrichment plant as a sabotage target (reusing the sabotage path);
  - the dome stopping one bomb (`DOME.bombRecharge`);
  - clean-up crews from the logistics branch, outside the tier count, so "maxed" never moves.
