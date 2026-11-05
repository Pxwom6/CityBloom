# SPEC-5.md: Citybloom phase 5, war between cities

Phase 4 (multiplayer, SPEC-4.md) is complete and merged into `main`, together with its review follow-ups (F1–F14). SPEC.md through SPEC-4.md still apply.

This phase adds war, fought between player cities in a shared region and against computer neighbours. It covers armies, defences, a war economy, investments, weapon research, spies and diplomacy. At the very end comes one final prize that cities race each other for: the atom bomb, incredibly hard to get, with consequences that last for decades.

It's a **toy war**: bright, toy-like tanks, planes and ships; buildings knocked down and rebuilt; nobody hurt on screen. Where this brief is silent, use your judgment as a game designer, and log the call in `docs/DECISIONS.md`.

## Before you start

1. Phase 4 is merged into `main` (PRs #17–#21), and so are this phase's model prompts and models (PR #22). Start from the latest `main`.
2. Make a `war` branch from it and work there. In a cloud session, use the session's own working branch instead, and say which one in PROGRESS.md. A branch can have only one open pull request into `main`: if the last milestone's is still open when the next one is done, add the new milestone to it, and say in its title and description which milestones it holds.
3. If this brief was pasted into the session rather than given as a file, save it at the repo root as `SPEC-5.md`, word for word, and commit it first.
4. The model prompts are in `docs/models/PROMPTS-WAR.md`, and all 39 models are made: they're in `assets/models/war/`. Read that folder's README before M34. It has the check made when they arrived, their few faults, and notes for bringing them in.
5. Update CLAUDE.md:
   - The current brief is SPEC-5.md (phase 5, M34–M40) on the `war` branch. In a cloud session, the session's working branch stands in for `war`.
   - Add SPEC-5.md and its rules to the start-of-session steps.
   - PROGRESS.md's checklist now runs from M0 to M40.
6. Add M34–M40 to the checklist at the top of PROGRESS.md, unticked. Add a phase 5 section to `docs/SPEC_REVIEW.md` and to `docs/DECISIONS.md`.

## The game this phase is aiming for

- **War is optional.**
  - A city plays exactly as before unless its player chooses rivals.
  - Single player: a new-city option, "Rival neighbours", off by default.
  - A shared region: the host's rules decide whether war is on, and the largest scale allowed.
  - Even where war is allowed, a city can declare itself neutral. It can't attack or be attacked, and it gives up the military buildings in return.
- **The scale of a war decides what's at stake.**
  - **Skirmish:** a raid with a small force. It hits military and border targets, and every loss can be rebuilt. No land changes hands.
  - **War:** declared with a warning period. Peace terms can include reparations, tribute for a number of years, demilitarised zones, and occupied districts. An occupied district's taxes go to the occupier until it's handed back or bought back.
  - **Total war:** only where the region's rules allow it. A city whose city hall is held long enough can be conquered. Its player then plays on as a vassal (paying tribute, unable to declare war, and able to rebel later), or starts again.
  - Peace is a treaty both sides accept, or a capitulation once one side's war score has collapsed. Other treaties: ceasefires, non-aggression pacts with a length, alliances and defensive pacts, and trade embargoes.
- **Battles are live.**
  - Forces leave a city, cross the region by road, rail, sea or air, and fight in the target city while both players can watch.
  - When the defender is away, their defences fight on their own, and they get a replay and a damage report when they come back.
- **Computer neighbours fight too.** M23's simulated neighbours get military strength, defences and a personality (aggressive, cautious, mercantile, honourable or treacherous). They arm, declare war, ally, make offers and break pacts. To make their battles live, give each a real town to fight in. A suggested way: grow one from its seed to its population with the existing balance mayor (`scripts/lib/mayor.ts`), headlessly, cached.
- **Fair among friends.**
  - Nobody comes back to a flattened city. A city can be attacked only so often each real day, damage while its player is away is capped, and new cities are protected until they've grown.
  - Pausing must not make a city invulnerable, and running at 3× must not raise an army in minutes that others need hours to answer. War timers, training and research in a shared region need a fair clock.
  - Log the numbers you choose in DECISIONS.
- **The tone.**
  - Units are toys. They're knocked out with a puff of smoke and a wreck, not killed.
  - Residents go to shelters during a raid, and move out or come back like they do after a disaster.
  - No blood, no casualty counts of people.
  - No real-world nations, armies, weapons or insignia.
  - No chemical or biological weapons.
  - The one nuclear weapon is the atom bomb at the very end (M40), kept in the game's toy look: a bright flash and a towering cartoon mushroom cloud, no gore. Its consequences are real in the simulation: fallout, a nuclear winter, people leaving, and a reputation that never recovers.
  - Every name, design and sound is original.

## Rules for all of phase 5

- **Peaceful play doesn't change.** With war off, single player and co-op play exactly as before. Existing saves load and play on unchanged (save version bumps with migrations and tests, as always).
- **Phase 4's rules still apply:**
  - the deterministic maths, with the cross-browser test rerun at the end of every milestone;
  - the sim stays pure, and networking lives outside `src/sim`;
  - the free Cloudflare plan;
  - safe for friends;
  - the performance, frame and network budgets.
- **Online rooms aren't set up on Cloudflare yet,** so the live site offers peer-to-peer rooms only. Test online rooms against the local relay, as phase 4 did.
- **Battles are deterministic.** A battle is a simulation of its own, fed by the forces, the defending city's layout and the players' orders. The same inputs give the same result on every machine and in every browser. Its result reaches the defending city as commands to that city's own simulation (damage, fires, evacuations, occupation), so each city stays the authority over itself.
- **Reuse what's there:**
  - disasters' damage, fire and rebuilding (M9);
  - the airport and seaport (M23);
  - the research park and the ore and oil deposits (M10);
  - districts (M21) for occupation;
  - the region, its deals and its room (M23, M32);
  - lockstep and rooms (M29, M30);
  - scenarios (M18);
  - sirens and alerts (M8).
- **Models.** `docs/models/PROMPTS-WAR.md` has a prompt for every military building, unit, superweapon and the atom bomb. All 39 models are made in Claude Design and wait in `assets/models/war/`, which the build doesn't read yet.
  - Use the prompts' sites as the buildings' footprints and their sizes as the units' sizes, so the models fit.
  - Bring each model in when its milestone needs it. Teach `npm run models:check` and the conversion three things:
    - PROMPTS-WAR.md's budgets (the pipeline reads only `PROMPTS.md` and `PROMPTS-<number>.md` today);
    - its building spec (v6) for the war buildings;
    - its unit spec (v1) for units: player colours on `body` and `body_alt`, named moving parts (turret, barrel, rotor, propeller, wheel, tracks, hatch, ramp, limbs, wind-up key, tail, jaw) turning about their own centres, `muzzle` cubes to fire from, and waterlines for ships.
  - The folder's README lists what the check must allow:
    - three false alarms from the facing check;
    - `light` on the atom silo;
    - parts below ground at the naval yard, coastal gun and spy agency, which the lot base and the lift for lawns must leave alone;
    - the whale's mouth, drawn from the inside on purpose.
  - Three models have small faults that I may remake (the barracks, naval yard and military HQ). A remade file arrives under the same name, so check the folder at the start of each session.
  - Keep a generated look in the game's own style for every unit and building, used wherever a model is missing or fails its check, as phase 3 does.
  - Anything the game needs that has no prompt (wrecks, rubble, effects) is generated.
- **Budgets for big battles.** Many units and effects on screen keep within the frame budget (instancing, distant versions). A battle's simulation stays inside the tick budget.
- **Keep players informed.**
  - Warnings with a countdown when a force is coming, and sirens.
  - A war room that shows forces, research, treaties and war score.
  - Plain reasons for every refusal ("Your region's rules allow skirmishes only").
  - Tutorial tips for every new screen.
- **Milestones.**
  - Every milestone ends playable and tested through the real UI, with screenshots reviewed.
  - It finishes with a commit starting `M<n> complete:` and a pull request into `main` with the same title.
  - Rerun `balance` and `bench` and log them.
- **Real devices.** Anything that needs them goes under "To check on the Mac".

## Milestones

**M34 Armed forces.** A city's military, with no war yet.

- **Military buildings,** each with upkeep, jobs and power needs, and an effect on approval (some residents like feeling safe; others don't like the noise):
  - a barracks;
  - a vehicle depot;
  - an airfield;
  - a naval yard on deep water;
  - a radar station;
  - anti-air batteries, coastal guns and bunkers;
  - shelters;
  - a military HQ that opens the war room;
  - a proving ground.
- **Units.**
  - Kinds: infantry, tanks, artillery, planes, helicopters, drones, boats and transport.
  - Their cost is drawn from the city's money, goods from its industry, ore and oil, and power.
  - They have upkeep and train over time.
  - Visible in the city: parked, on drills, patrolling.
- **The war economy.**
  - A defence line in the budget.
  - War bonds: borrowing from residents at interest, with an approval cost.
  - An arms industry: factories that make munitions and vehicles, give jobs, and can sell to allies later.
- **The war room panel.** Forces, upkeep, readiness and research.
- **"Rival neighbours".** The new-city option, and the region rules (war on or off, and the largest scale) in the region's settings.

*Done when:*
- a city with rivals on builds every military building and trains every kind of unit through the real UI;
- upkeep and approval show in the budget and the inspector;
- a city with war off plays and saves exactly as before;
- `balance` with rivals off is unchanged.

**M35 Into battle.** The strategic layer, and live battles.

- **A region map.** The cities, the routes between them (highway, rail, sea lanes and air) with travel times, forces in transit as tokens, and fronts.
- **Sending forces.** Choose units, a route and a target (military, industry, power, city hall). They leave by the city's edge and arrive after the travel time, with a warning to the defender.
- **The battle.**
  - A deterministic battle simulation in the defender's city: units move along roads and over terrain, fire, take cover, and hit buildings.
  - The defender's defences and units respond on their own.
  - Buildings take damage, catch fire and fall into colourful rubble, through the disaster system.
  - Residents shelter, then move out or come back.
  - It's watchable from both cities, with the speed and camera under each player's control.
- **When the defender is away.** The battle runs from the latest layout the region holds. The result is applied when they next open their city, and a replay and a damage report are waiting.
- **Computer neighbours** attack and defend with simple tactics.
- **Skirmishes** are the only scale in this milestone.

*Done when:*
- a scripted test plays a skirmish against a computer neighbour and gets the same result in Chromium, WebKit and Firefox;
- an e2e sends a force through the real UI, watches the battle, and sees the damage repaired afterwards;
- a defender who was offline gets the replay and a report that matches the damage.

**M36 Diplomacy and the stakes of war.**

- **Declaring war.** At each scale, within the region's rules, with a warning period and a reason the other side sees.
- **War score.** From battles won, targets held and economic damage. Capitulation once it collapses.
- **Treaties.**
  - Proposals and counter-proposals with terms: ceasefire, peace with reparations, tribute (an amount for a number of years), demilitarised zones, occupied districts (taxes to the occupier until returned or bought back), non-aggression pacts, alliances and defensive pacts, and embargoes on M23's deals.
  - Both sides must accept, except for terms imposed after a capitulation.
  - Breaking a pact has consequences, such as reputation and allies leaving.
- **Total war and conquest.** Hold a city hall long enough and the city falls. Its player chooses to play on as a vassal or to start again. A vassal can rebel when it's strong enough.
- **Fairness.** Newcomer protection, attack limits per real day, the damage cap while away, cooldowns between wars, and a neutral stance.
- **Computer neighbours' diplomacy** follows their personality and the player's reputation.

*Done when:* scripted tests show each scale's stakes:
- a skirmish changes no land;
- a war ends in a treaty with tribute paid month by month;
- a total war conquers a city that then plays on as a vassal and later rebels;
- a pact broken with a computer neighbour turns its allies;
- the fairness limits hold, against a test that tries to raid an offline city all night.

**M37 Weapon development and intelligence.**

- **A research tree** funded by research labs and the research park, with branches:
  - land;
  - air;
  - sea;
  - defence: shields, interceptors, hardened buildings;
  - intelligence: radar, stealth, spies;
  - logistics: faster travel, repair crews, supply.
- **Prototypes.** They're tested at the proving ground in visible trials before they can be built. Some research also gives civilian spin-offs, for example better fire engines or faster construction.
- **Spies.** Reveal a rival's defences, sabotage a power plant or a depot, or steal research. Counter-intelligence catches them, and a caught spy is a diplomatic incident.
- **Superweapons.** One at the end of each branch: toy-like, very expensive, slow to build, with a long cooldown. The region's rules can turn them off.
  - Land: the **giant wind-up robot**, which walks across the region and stomps through a city.
  - Air: the **sky fortress**, an airship that launches swarms of drones.
  - Sea: the **clockwork whale**, a giant submarine that surfaces off a coast.
  - Defence: the **dome shield**, a shield over the whole city that stops one atom bomb, then is down for a long time.
  - Intelligence: the **blackout tower**, which cuts a rival's power, radar and maps for a while.
  - Logistics: the **express gate**, which sends forces anywhere in the region at once.

*Done when:*
- research unlocks every branch's units through the real UI;
- a spy mission and a counter-intelligence catch each work in a scripted test;
- a superweapon is built, used once and goes on cooldown;
- the frame budget holds in the heaviest battle you can stage.

**M38 Investments and the war economy.**

- **Arms trade.** Sell units and munitions to allies through M23's deals, and suffer embargoes.
- **Investing in other cities.** Buy stakes in a neighbour's industries for monthly dividends, which a war can freeze or seize. Lend to allies, fund an ally's war, and impose and feel sanctions.
- **War weariness.** Long wars cost approval and growth. Peace brings back trade and a recovery boost.
- **Computer neighbours trade, invest and lend** according to their personality.
- **Balance across difficulties.** On Easy, war stays forgiving. On Normal and Hard, rivals press harder: more aggressive computer neighbours, costlier upkeep, stiffer peace terms. The money that piles up in a peaceful city now has somewhere to go.

*Done when:*
- balance runs show each difficulty with rivals on: a careful mayor survives and thrives on Easy, and is pressed but holding on Hard;
- an investment pays dividends in peace and is frozen in war;
- an embargo cuts the trade it targets.

**M39 War with friends.**

- **Live battles between players.**
  - Both players command during the battle, in lockstep through the region's room. Allies can send help, and spectators can watch.
  - It works in online rooms and peer-to-peer.
  - A player who drops out mid-battle hands over to their defences.
- **Replays** that every player in the region can watch, and a region-wide war history (wars, treaties, conquests) in the City history panel.
- **Shared co-op cities at war.** The host's roles decide who can declare war, sign treaties and spend on defence.
- **Scenarios:** defend a town against an invasion, win a war without losing a district, liberate an occupied neighbour.
- **A soak test.** Four players in a region at war for two hours of real time, with raids, a war, a treaty and a conquest. No unexplained desync, and within the free plan.
- **Polish.** Tutorial tips, a "War" section in the README, and the lobby and war room on narrow windows and touch.

*Done when:*
- the soak test passes;
- an e2e with two players fights a battle through the real UI, both commanding, and ends it with a treaty both accept;
- the cross-browser test covers a battle;
- I could invite a friend, go to war, and make peace without reading anything first.

**M40 The final race: the atom bomb.** One last prize that cities race each other for, very hard to get and terrible to use.

- **Getting it.** Every step is slow, costly and visible.
  - It unlocks only once a city has maxed out every branch of the research tree, all six superweapons included.
  - The city needs a running nuclear power plant and an enrichment plant. The enrichment plant is very slow, very expensive, and shows on every rival's region map the moment it's built.
  - Then come the silo and the bomb, at an enormous price: on the order of several years of a big city's entire income, plus ore and oil. They take a long time to build.
- **The race.**
  - Everyone in the region sees each city's progress ("Ashford has begun enriching fuel"), so rivals can race their own, send spies to sabotage it, or go to war to stop it.
  - The first city to finish gets a region-wide alert and an achievement.
  - Having the bomb is a deterrent: other cities need to think hard before declaring total war on its owner.
  - Computer neighbours try it only on Hard, rarely and very late.
- **Rules.**
  - It needs total war allowed in the region, and the region's rules can turn it off entirely.
  - Its owner must declare total war before launching it.
  - Only one can be built per city, and launching it takes a long time to prepare.
- **Launching it.**
  - The missile crosses the region in plain sight, with sirens and a countdown in the target city, so residents can flee.
  - A dome shield (M37) stops one bomb, then is down for a long time.
  - On impact: a bright flash and a towering mushroom cloud in the game's toy style. Everything within a wide radius is levelled, and the residents who could flee did; the population falls as people leave and health collapses. No one is hurt on screen.
- **The repercussions are real and they last.**
  - **Fallout.**
    - A contaminated zone, shown on a new radiation data map, where nothing can be built or zoned for decades of game time.
    - It fades slowly and drifts downwind (M7's wind) across districts and into neighbouring cities.
    - Under the plume: sickness, unhappiness, and people moving away; industry and offices there produce less.
    - Clean-up crews (from the logistics branch) can shrink the zone, at a huge cost.
  - **Nuclear winter.** Colder seasons, more snow and weaker solar across the whole region for several game years (M22's weather), hitting every city, including the one that fired it.
  - **The world reacts.**
    - The firing city's reputation collapses for good.
    - Computer neighbours embargo it, and its pacts and alliances break.
    - Every other city may declare total war on it without the usual cooldowns.
    - Its own residents protest: approval crashes and many move away.
  - **No undoing it.** City history and the region's war history record it forever.

*Done when:* scripted tests show:
- the bomb unlocks only with every branch maxed out, and the race's progress shows across the region;
- a spy can delay an enrichment plant;
- a dome shield stops one bomb;
- a hit levels the radius;
- the fallout zone blocks building, drifts downwind into a neighbour, and fades over the years;
- the nuclear winter reaches every city in the region;
- reputation, pacts and approval turn as described.

Also: an e2e launches one through the real UI with screenshots of the countdown, the cloud, the radiation map and the winter; and the cross-browser test covers the strike and the fallout's spread.

## When every milestone is done

Update the summary at the top of PROGRESS.md, this brief's section in `docs/SPEC_REVIEW.md`, and the README. Then fight a war with a computer neighbour and one between two players through the real UI, race for the atom bomb, and fix whatever feels off.
