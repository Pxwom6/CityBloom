# M38 code map (what the war economy builds on)

A survey of the code before M38, for whoever builds it. Line numbers drift; names don't.

## Deals (M23)
- `src/data/region.ts`: `DealResource` (power | water | garbage), `DealDirection` (buy | sell),
  `REGION.price` ($/month per unit: buy 3/3/15, sell 2/2/12), `playerPrice`, `NEIGHBOUR_KIND`
  (industrial, suburb, resort; `per` thousand residents).
- `src/sim/systems/region.ts`: `Deal` {id, neighbour, resource, direction, amount, delivered, since,
  remote?}; `capacity` (a computer town's per-kind spare × population / 1000); `setDeal` (amount 0
  ends; clamped; the embargo check); `regionImport`/`regionExport` (run from utilities) set
  `delivered`; `regionRates` → ledger lines `imports`/`exports` in `monthlyRates`.
- Adding a `DealResource` touches every `Record<DealResource, …>` map, the Region panel, `setDeal`'s
  check and the relay's `cleanReport` (and needs a protocol bump): keep arms trade apart from it.

## Diplomacy (M36)
- `src/data/diplomacy.ts`: `Term` kinds (ceasefire, peace, reparations, tribute, dmz, occupy,
  release, nonAggression, alliance, defensivePact, embargo, trade, independence), `DIPLOMATS`
  (peace, money, pacts, pride, trade, allies weights), `DIPLOMACY` numbers.
- `src/sim/systems/diplomacy.ts`: `Pact`, `pactsWith`, `bindingPacts` (ceasefire, nonAggression,
  alliance, defensivePact), `embargoed()` (checked only in `setDeal` and at `sign`, which deletes
  existing deals), `diplomacyRates` (ledger), `reputation` (0–100, start 60, mends only up to 60),
  `relation` on `RivalNeighbour` (−100..100), `warWith`, `fightingWith` (no ceasefire, not
  capitulated), `War` (with, scale, by, declared, opens, score, capitulated, …), `endWar`,
  `conquer`, `computerMoves` (daily: proposals, declarations), `answerFromComputer`/`weigh`.
- Friends can't sign treaties until M39 (`termsRefusal`, `declareRefusal`).

## Computer neighbours
- `Neighbour`/`RivalNeighbour` in `src/sim/systems/region.ts`: personality, forces, defences,
  relation, allies?, vassal?, blackout?, tech?, intel?. No economy: `neighbourTaxes` (diplomacy.ts)
  = population × 4. `PERSONALITY` (`src/data/war.ts`): forces, defences, aggression, keepsPacts,
  `trade` (0.3–0.9, unused before M38), relation.
- `rivalsMonth` (war.ts): arming closes 6 % ± 25 % of the gap a month (`RIVALS`).
- Rival towns for battles (`src/sim/ai/town.ts`) are separate sims built for a battle and never kept.

## Economy
- `src/sim/systems/economy.ts`: `book` (integer, treasury and `e.month[category]`), `accrue`
  (carries the fraction), `monthlyRates` (every ledger line), `economyHour` (rate/24 an hour),
  `closeMonth`. The money invariant (`src/sim/invariants.ts`): treasury == month start + Σ month.
- Loans (M3): `LOAN_OPTIONS`, `takeLoan`/`repayLoan`. War bonds (M34): `WAR.bonds`, `issueBond`,
  `bondMood`. Ledger labels: `LEDGER_LABELS` (`src/data/economy.ts`). `monthlyTaxes` sums lines
  starting with `tax`.
- Difficulty: `DIFFICULTY` (start funds, upkeep 0.8/1/1.25) used only at `Sim.create` and
  `upkeepScale`; nothing war-related reads it.

## Approval and growth
- `computeTotals` (`src/sim/systems/totals.ts`): approval = residents' and businesses' mood plus a
  city-wide `cheer` (match day, launch, honeymoon, `bondMood`, `raidMood`): the place for war
  weariness. `happinessFactors` (happiness.ts) moves growth and abandonment.

## Units and stores
- `WarState` (war.ts): `units` (Map of `Unit` {id, kind, base, hp, born, away?, ready?}), `stock`
  (goods, ore, oil, munitions; munitions made by arms factories and never spent), `orders`.
- `disbandUnit` ignores `away`; `cityStrength` (raids.ts) counts units at home.

## Commands, saves, goldens
- A command: `Command` union and `COMMAND_KINDS` (commands.ts), `CHECKS` in `commandCheck.ts` (and
  `PAGE_ONLY`), `dispatch`/`apply` in sim.ts (with `dryRun`), `NEED` in rules.ts, a sample in
  `tests/lockstep/commandCheck.test.ts`, and a successful use in `tests/lockstep/determinism.ts`
  (every kind must appear).
- `SAVE_VERSION` 30 (`src/sim/save.ts`); a migration and its test for every bump.
- Peace golden `tests/fixtures/war/peace-main.json` (must never move). M36 golden
  `tests/war/m36Golden.test.ts` (runs Normal with rivals on; `GOLDEN=write` rewrites it, with a
  DECISIONS entry). v2 battle replays `tests/battle/v2replay.test.ts` (must never move).
- M37 kept them still by making new state optional and appear on first use, and by giving new dice
  their own seeds.

## The balance mayor
- `src/sim/ai/mayor.ts` (`Player`): no war code at all (no military, bonds, diplomacy or defence);
  `scripts/balance.ts` has no rivals flag. `new Player('careful', Sim.create({…, rivals: true}))`
  works.
