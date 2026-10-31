# M38 Investments and the war economy: design

The brief (SPEC-5.md, M38): arms trade with allies through M23's deals, and embargoes; stakes in a
neighbour's industries paying monthly dividends, frozen or seized by war; lending to allies, funding
an ally's war, sanctions both ways; war weariness and a peace recovery; computer neighbours that
trade, invest and lend by personality; balance across difficulties with rivals on.

Done when: balance runs show each difficulty with rivals on (a careful mayor thrives on Easy and is
pressed but holding on Hard); an investment pays dividends in peace and is frozen in war; an
embargo cuts the trade it targets.

## Calls

1. **Computer neighbours only in M38.** Friends can't sign treaties (so can't be allies) until M39,
   and every M38 item but war weariness is about allies, stakes or sanctions between parties with a
   diplomatic standing. Friends' arms trade, stakes and loans arrive with M39's treaties between
   friends. War weariness counts every open war, friends' raids included.
2. **A neighbour's industry, from what the sim already knows.** Computer neighbours have no economy
   of their own (only kind, population and `neighbourTaxes`). Their industry is worth
   `population × INVEST.perResident[kind]` (industrial 120, suburb 40, resort 60 dollars a
   resident) and earns `INVEST.yield` a month (1.2 %, about 15 % a year), scaled by its tech
   (+5 % a step) and down a quarter while it's blacked out or its power is sabotaged. It rises and
   falls with the town's population, so a stake's value moves.
3. **Stakes** (`WarState.economy.stakes`, by neighbour): bought in 5 % steps up to 25 % of a town's
   industry, at its value × (1 + premium by relation, 0–20 %); sold back at 90 % of its value. Any
   neighbour that isn't hostile (relation above −25, not at war with the city, not sanctioning it)
   sells. Dividends are a monthly ledger line (`dividends`), accrued by the hour like every rate.
   - **Frozen** while the city is fighting that neighbour (`fightingWith`) or either side
     sanctions the other: no dividends, no sale. They resume at peace (the recovery: call 7).
   - **Seized** when the city capitulates to that neighbour, or when a treacherous neighbour
     declares war (its character: `seizes`). A neighbour the city conquers pays its dividends as
     a vassal's (unchanged), and the city's stake there is kept.
4. **Loans to allies** (alliance or defensive pact): $50k, $150k or $400k, repaid with interest by
   the month over 24 months, at a rate by its character (`DIPLOMATS` money weight: 4–9 %); ledger
   lines `allyInterest`, `allyRepaid`. Frozen like stakes; written off if the ally is conquered by
   the city (it's the city's own then) or the pact is broken by either side.
5. **Funding an ally's war**: while the city is at war, an ally at its side (M36 `allies`) can be
   funded monthly ($10k–$100k a month, ledger `warAid`). It arms faster (its forces close the gap
   twice as fast at full funding) and its daily share of the war score doubles. Stopping is free.
6. **Arms trade through the deals**: munitions are a deal resource with computer allies and
   neighbours with a trade pact (`trade` term), sold from the war stores (munitions are made by
   arms factories and are otherwise unused) at `ARMS.price` ($38 a crate, about twice their local
   value). A deal's amount is crates a month, delivered by the hour from the stores. Units are sold
   once (`sellUnit`: an ally pays 60 % of the unit's cost; the unit leaves, the ally's forces rise
   by its strength). An embargo or a sanction on either side ends arms deals and refuses new ones;
   M36's embargo check moves into the deals' hourly delivery too (it only checked at signing and on
   new deals, so a deal made before an imposed embargo could have run on).
7. **War weariness** (`WarState.economy.weariness`, 0–1): grows each war hour a war is open (total
   war ×1.5, losing by the score ×1.5, each raid on the city +0.02), falls after peace. It costs
   approval (`cheer`: up to −0.12) and, past 0.5, growth (a home happiness factor, "Tired of war",
   up to −0.05). **Peace** (a peace treaty or a war's end) starts a recovery for ten days: +0.05
   cheer and demand easing back, frozen stakes and loans thawed, sanctions that came with the war
   lifted, deals with that neighbour allowed again.
8. **Sanctions** (`Diplomacy.sanctions`): a city may sanction a neighbour (unilateral, unlike the
   embargo term): its deals with it end, its stakes there freeze, the neighbour grows more slowly
   (−0.5 % a month) and arms more slowly (×0.8), and minds (relation −15). Computer neighbours
   sanction the city: an honourable or cautious one when the city breaks a pact with anyone, any
   neighbour allied to a city the city is at war with (the ally's side), and any neighbour when the
   city's reputation falls below 35. Lifted at peace or after 30 days if the cause has passed.
9. **Computer neighbours trade, invest and lend by character** (`PERSONALITY.trade`, unused until
   now, and `DIPLOMATS.money`): each month, perhaps one offer to the city, answered in the
   Diplomacy tab like a proposal, open for three days:
   - to buy munitions (an arms deal), from allies and trade partners;
   - to invest in the city: a lump sum now for a share of its industrial tax for 24 months
     (mercantile and cautious neighbours; never at war);
   - to lend the city money at its rate (mercantile cheapest), when the city is short of cash.
10. **Difficulty with rivals on** (`WAR_DIFFICULTY`): Normal is exactly today's numbers (the M36
    golden runs Normal). Easy: rivals arm at 0.7×, raid at 0.6×, demand milder terms (tribute
    ×0.7), weariness at 0.7×. Hard: rivals arm at 1.3×, raid at 1.4×, are more aggressive
    (+0.1), demand stiffer terms (tribute ×1.4), forces' upkeep ×1.25 (it already scales roads and
    services), weariness at 1.3×.
11. **The balance mayor learns war** (`src/sim/ai`): with rivals on it builds an HQ, a barracks and
    defences sized to its neighbours' forces once raids threaten (3,000 residents), keeps a small
    force, accepts peace offers and ceasefires when the score is against it, and puts money that
    piles up (over two years' upkeep in the bank) into stakes in friendly neighbours.
    `balance.ts --rivals` runs each mayor with rivals on; the done criterion is read from
    `balance.ts 20 careful --rivals --difficulty easy|normal|hard`.

## Determinism, saves and goldens

All new state is optional and inside `WarState` or `Diplomacy` (absent in peace), so the peace
golden can't move. Save v31 (identity migration and a test). New dice come from their own seeds
(`${seed}:econ:${month}`). War weariness and offers change war cities' play, so the M36 golden
moves: rewrite it once (`GOLDEN=write`) after the weariness step, with a DECISIONS entry, and keep
the v2 replays identical. New commands (`buyStake`, `sellStake`, `lendAlly`, `fundAlly`,
`sellUnit`, `setSanction`, `answerOffer`) go into `commandCheck`, its samples and the determinism
script's new M38 section.

## Steps

0. This plan; DECISIONS "M38".
1. Data (`src/data/warEconomy.ts`: `INVEST`, `LENDING`, `ARMS`, `SANCTION`, `WEARINESS`,
   `WAR_DIFFICULTY`); `WarState.economy`; save v31.
2. Stakes: value, buy and sell, dividends, freeze and seizure. Tests (the done item "an
   investment pays dividends in peace and is frozen in war").
3. Loans to allies and funding an ally's war. Tests.
4. Arms trade: munitions deals and unit sales; embargo and sanctions cut it (the done item "an
   embargo cuts the trade it targets"). Tests.
5. Sanctions both ways. Tests.
6. War weariness and the peace recovery; the M36 golden rewritten. Tests.
7. Computer neighbours' offers by character. Tests.
8. Difficulty levers. Tests.
9. The mayor at war, `balance.ts --rivals`, runs per difficulty, tuning.
10. UI: the war room's Trade tab (stakes, loans, aid, arms, sanctions, offers), munitions in the
    Region panel's deals, notices and tips; e2e `m38-economy`.
11. Wrap-up: determinism section, cross-browser, full tests, e2e, balance, bench, docs, `M38
    complete:`.
