# M38 balance: the careful mayor at war

`npx tsx scripts/balance.ts 20 careful --rivals --difficulty easy|normal|hard` (seed `balance`, the river map; the careful mayor with the war plan of `src/sim/ai/warMayor.ts`, at the step 9 commit). Each run takes 6 to 9 minutes. Raids are cumulative; "wars" are wars declared on the city (all three runs: none, and none open); a war's score and weariness barely move: peak weariness 0.01 to 0.02.

| | year 5 | year 10 | year 20 |
|---|---|---|---|
| **Easy** population | 72,175 | 72,841 | 80,988 |
| treasury | $228,293 | $1,217,358 | $1,622,752 |
| approval | 70 % | 68 % | 72 % |
| raids so far (wars) | 3 (0) | 9 (0) | 16 (0) |
| **Normal** population | 40,821 | 67,077 | 64,666 |
| treasury | $25,060 | $456,632 | $718,774 |
| approval | 68 % | 70 % | 71 % |
| raids so far (wars) | 6 (0) | 13 (0) | 29 (0) |
| **Hard** population | 2,628 | 77,052 | 72,301 |
| treasury | $12,925 | $299,848 | $1,155,434 |
| approval | 64 % | 70 % | 65 % |
| raids so far (wars) | 0 (0) | 13 (0) | 35 (0) |

The military's share of spending over the run: Easy 2.3 %, Normal 3.1 %, Hard 3.7 %. Raids that got through ("raided" outcomes): Easy 10 of 16, Normal 8 of 29, Hard 7 of 35; buildings lost: 2, 7, 6; homes lost: none.

## Reading them

- **Easy thrives**: 81,000 residents, a bank of $1.6 million, approval above 67 % throughout, 16 raids in twenty years and two buildings lost.
- **Hard is pressed and holds on**: it starts as poor as ever (35,000 dollars and dearer upkeep: 592, 764, 1,252 and 2,456 residents in its first four years with rivals off as well), the raids then delay its takeoff by about three years (8,647 residents at year 6; 28,229 with rivals off), it meets 35 raids (2.2 times Easy's) and spends the most on the military, a power raid in year 13 drops approval to 55 % for a year; yet it is never bankrupt, ends with 72,000 residents and a bank of $1.2 million.
- **Normal sits between**: a slow start (12,402 residents at year 4; 21,323 at peace) and 65,000 at the end.
- With rivals off the same mayor reaches 67,373 residents and $1.84 million at year 20 on Normal; the war costs a careful mayor three to five years of growth in the early game and a little of the late.

## What was tuned, and why

Nothing in `WAR_DIFFICULTY`: Easy and Hard behave as the plan has them. The mayor and the offers were tuned (DECISIONS "M38", step 9):

1. Raids went for the power plants near the highway's way in; a small city lost half its people in three days and went bankrupt. New plants go out of reach, a coal plant is insured beyond it, a reserve is kept.
2. Neighbours' loans were a debt trap (seed `war2`: three loans and an investment, bankrupt in year 2) and a town of 250 could borrow $100,000 in its first month: lenders now lend against the city's means, and the mayor borrows only within a fifth of its taxes and sells no share of its industry unless overdrawn.
3. No wars were declared on the careful mayor in any run. A neighbour declares only on a city it outguns and feels −25 or worse about; a careful mayor's neighbours start at 3 to 14 and nothing it does lowers them. The war economy's weariness, peace recovery and treaties therefore show only in the tests, not in these runs; the mayor's proposal rules are tested on staged wars (`tests/war/warMayor.test.ts`). Likewise no stake was bought: no neighbour's feelings reach 20 (the rule asks for 20 or more), because only signed treaties raise them.

## The peace run

`npx tsx scripts/balance.ts 20 careful` (rivals off) prints, after the changes of this step, exactly what it printed at the step 8 tip (`diff` of the two outputs: only the header's seconds differ, 246 s and 334 s).
