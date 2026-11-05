# M36 Diplomacy and the stakes of war: design (plan)

Written before M36 started, from SPEC-5.md and the M34–M35 code. A plan, not a record: DECISIONS
holds what was actually chosen, and this file is updated or deleted as M36 lands.

## Key calls
1. **State only where it's used**: `WarState.diplomacy` appears with the first declaration, proposal
   or stance change, so war cities that never use it, and peace, are unchanged. It holds
   `reputation` (0–100, starts 60), `wars`, `treaties`, `proposals`, `vassal` (this city's
   overlord), `neutral`, `lastWarEnd` (per neighbour). A conquered computer neighbour carries
   `rival.vassal`. Computer neighbours get `rival.allies` (each other's ids) when war starts, by
   character (honourable and cautious ally readily, treacherous rarely); a v29 migration adds them
   to v28 war saves from the same dice.
2. **Scales**: skirmishes stay as M35 (no declaration, no land or money changes hands). **War** is
   declared (`declareWar {neighbour, scale, reason}`), opens after a warning (12 game hours, the
   reason and the time shown to the other side), lets forces strike the city hall, scores, and
   ends in a treaty or a capitulation. **Total war** adds conquest. The largest scale is the
   region's rule; a single-player rivals city allows total war.
3. **War score** (−100 to 100, from this city's side, per war): a battle won +8 to +15 by objectives
   down, lost −8 to −15; economic damage +1 per $25k of buildings knocked down or wrecked on the
   other side (−1 on ours); holding the city hall +2 a game hour. A side at −60 or below
   capitulates: the winner's terms are imposed without its consent.
4. **Treaties** are sets of terms; both sides accept (`propose`, `answer {accept | reject |
   counter}`), except imposed terms after a capitulation. Terms: ceasefire (hours), peace,
   reparations (once), tribute (an amount a month for a number of years, a ledger line, in or out),
   a demilitarised zone (military buildings within 800 m of the border on that side stand down and
   none can be built), an occupied district (its taxes go to the occupier until returned in a later
   treaty or bought back for 24 months of them), non-aggression, alliance, defensive pact, embargo
   (M23 deals with that neighbour stop and none can be signed). Proposals expire after two game days.
5. **Breaking a pact** (a raid or declaration during non-aggression or a ceasefire, or leaving an
   alliance at war) asks first, then: reputation −30, the treaty ends, the victim's allies like
   the city 40 points less, cancel their pacts with it, and those with a defensive pact declare war.
6. **Conquest** (total war): knocking down the city hall starts a hold of 48 game hours; a won
   battle by the defender breaks it; at its end the city falls. A computer neighbour becomes a
   vassal (tribute of its taxes, no raids, forces cut). The player's city: a choice, play on as a
   vassal (20 % of taxes to the overlord, no wars but rebellion, forces capped at the overlord's)
   or start again (the city's save stays loadable). A vassal may rebel when its strength reaches
   1.2× its overlord's: total war against it, vassalage ends with a won war or a treaty.
7. **Fairness**: newcomer protection (a city under 3,000 residents or a year old can't be declared
   on or raided by a friend unless it struck first, as M35's computer rule); attack limits per real
   day (the region room counts battles each city takes per UTC day, at most 3, and the view tells
   attackers' sims before they send); a damage cap while away (an absent defender's battles use
   half the skirmish caps and never advance a hold); cooldowns (3 game months between wars with the
   same neighbour; a real day between friends); a neutral stance (`setNeutral`: no wars, no
   expeditions, friends can't attack, computer neighbours raid a quarter as often, treacherous ones
   as before; leaving neutrality takes a game month to count).
8. **Computer neighbours' diplomacy** (`diplomacyHour`, the war dice): they weigh a proposal's value
   to them (money, safety, land) against their character, relation, the city's reputation, the war
   score and the strength ratio; accept, counter (scaled terms) or refuse. They propose too: losing
   sides offer a ceasefire or peace with reparations, winning ones demand tribute, honourable ones
   offer non-aggression to a city they like, mercantile ones avoid embargoes. Aggressive and
   treacherous ones declare war when they outgun the city and dislike it.
9. **UI**: a Diplomacy tab in the war room (each neighbour: relation, stance, pacts, the war and its
   score; Declare war with scale and reason; a terms builder for proposals; incoming proposals with
   accept, refuse and counter; treaties with tribute paid so far; buy back a district; neutral
   stance), notices for declarations, proposals, signings and capitulation, the vassal choice, and
   plain refusals. Friends' diplomacy goes through the region room (M39 brings war with friends in
   full; M36 carries declarations, proposals and limits).

## Steps
1. Data (`src/data/diplomacy.ts`), state, `declareWar`, war score from M35's battles; tests.
2. Treaties and proposals, computer answers and proposals, tribute and reparations in the ledger;
   test: a war ends in a treaty with tribute paid month by month.
3. Pacts, breaking them, allies; test: a broken pact turns the victim's allies.
4. Total war, conquest, vassals, rebellion; test: a city conquered plays on as a vassal and rebels.
5. Fairness: protection, neutral stance, cooldowns, the room's daily limit and away caps; relay
   test: an attacker raiding an offline friend all night is held to the limits.
6. UI and e2e; tips.
7. Wrap-up: save v29, the cross-browser run with diplomacy commands, balance, bench, docs, PR.
