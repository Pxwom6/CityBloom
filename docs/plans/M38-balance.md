# M38 balance: the careful mayor at war

`npx tsx scripts/balance.ts 20 careful --rivals --difficulty easy|normal|hard` (seed `balance`, the river map; the careful mayor with the war plan of `src/sim/ai/warMayor.ts`, at the step 9 commit that buys stakes in any neighbour feeling 0 or more). Each run takes 6 to 9 minutes. Raids are cumulative; "wars" are wars declared on the city (all three runs: none, and none open); a war's score and weariness barely move: peak weariness 0.02 at most.

| | year 5 | year 10 | year 20 |
|---|---|---|---|
| **Easy** population | 72,175 | 72,841 | 83,179 |
| treasury | $228,293 | $1,034,501 | $1,297,452 |
| approval | 70 % | 68 % | 75 % |
| raids so far (wars) | 3 (0) | 9 (0) | 16 (0) |
| stakes worth / dividends so far | none | $217,524 / $30,627 | $2,391,860 / $2,324,056 |
| **Normal** population | 40,821 | 67,077 | 65,786 |
| treasury | $25,060 | $456,632 | $1,707,414 |
| approval | 68 % | 70 % | 70 % |
| raids so far (wars) | 6 (0) | 13 (0) | 30 (0) |
| stakes worth / dividends so far | none | none | $2,391,860 / $1,362,048 |
| **Hard** population | 2,628 | 77,052 | 75,239 |
| treasury | $12,925 | $299,848 | $1,642,747 |
| approval | 64 % | 70 % | 65 % |
| raids so far (wars) | 0 (0) | 13 (0) | 35 (0) |
| stakes worth / dividends so far | none | none | $2,391,860 / $1,568,114 |

Over the twenty years:

| | military share of spending | raids that got through | buildings lost (homes) | stakes paid for | dividends a year, on average | dividends in year 20 |
|---|---|---|---|---|---|---|
| Easy | 2.2 % | 9 of 16 raided, 1 repelled, 6 withdrew | 2 (0) | $2,057,868 | $116,203 | $336,216 |
| Normal | 3.3 % | 8 of 30 raided, 1 repelled, 21 withdrew | 7 (0) | $2,394,133 | $68,102 | $336,215 |
| Hard | 4.1 % | 7 of 35 raided, 28 withdrew | 6 (0) | $2,176,358 | $78,406 | $336,215 |

Stakes begin in year 9 on Easy ($100,218 worth at its end) and in year 13 on Normal and Hard ($271,080), and all three end holding the same $2,391,860 worth (the neighbours' industry is the same in each run), paying $336,215 a year in the last year, about 14 % of the stakes' worth. The treasury the mayor ends with is the money it keeps after buying them: the stakes are a second asset of about 1.4 to 1.8 times the bank.

## Reading them

- **Easy thrives**: 83,000 residents, a bank of $1.3 million besides $2.4 million in stakes, approval at 75 %, 16 raids in twenty years and two buildings lost. Its bank is lower at year 20 than in the first table ($1.6 million before stakes), which fits the $2.1 million the mayor put into them; the dividends are $336,000 a year at the end.
- **Hard is pressed and holds on**: it starts as poor as ever (592, 764, 1,252 and 2,456 residents in its first four years, as with rivals off, on dearer upkeep), the raids then delay its takeoff by about three years (8,647 residents at year 6; 28,229 with rivals off), it meets 35 raids (2.2 times Easy's) and spends the most on the military (4.1 % of everything spent, 6.5 % by year 6). It is never bankrupt (the bank's lowest year-end figure after year 3 is $5,108), dips to 63,315 residents and 55 % approval in year 13 (I did not trace that dip; it is in the run from before stakes too, so it is not them) and ends with 75,000 residents, a bank of $1.6 million and the stakes.
- **Normal sits between**: a slow start (12,402 residents at year 4; 21,323 at peace), 41,000 at year 5 and 66,000 at the end.
- **The war runs are not controlled comparisons with peace**: the mayor's choices follow its money, so a small difference early grows into a different city. Easy at war outgrows Easy at peace (83,179 against 62,781 at year 20; 72,175 against 62,725 at year 5); I have not traced why, and the peace Easy figures are themselves lower than Normal's. With rivals off Normal reaches 67,373 residents and $1.84 million, Hard 72,679 and $1.32 million; the war costs a careful mayor three to five years of growth in the early game on Normal and Hard, and a little of the late.
- **The first draft of the stake rule bought none**: it asked for feelings of 20 or more, and a careful mayor's neighbours sit at 3 to 14 (only signed treaties raise them). Asking for 0 or more, not at war and no sanctions either way, put $2.4 million into neighbours' industry in every run and changed nothing before the first purchase: Hard's figures at years 5 and 10 are the same as in the first table.

## What was tuned, and why

Nothing in `WAR_DIFFICULTY`: Easy and Hard behave as the plan has them. The mayor and the offers were tuned (DECISIONS "M38", step 9):

1. Raids went for the power plants near the highway's way in; a small city lost half its people in three days and went bankrupt. New plants go out of reach, a coal plant is insured beyond it, a reserve is kept.
2. Neighbours' loans were a debt trap (seed `war2`: three loans and an investment, bankrupt in year 2) and a town of 250 could borrow $100,000 in its first month: lenders now lend against the city's means, and the mayor borrows only within a fifth of its taxes and sells no share of its industry unless overdrawn.
3. No wars were declared on the careful mayor in any run. A neighbour declares only on a city it outguns and feels −25 or worse about; a careful mayor's neighbours start at 3 to 14 and nothing it does lowers them. The war economy's weariness, peace recovery and treaties therefore show only in the tests, not in these runs; the mayor's proposal rules are tested on staged wars (`tests/war/warMayor.test.ts`).
4. The stake rule (feelings 0 or more, at war with none, no sanctions) and the surplus bar: the bank must hold the smaller of two years of spending and $1 million (`SURPLUS_CAP`). A literal two years of spending (hundreds of thousands a month in a big city) never occurs because the mayor's goals keep the bank near one or two million; the cap lets it happen.

## The peace run

`npx tsx scripts/balance.ts 20 careful` (rivals off) prints, after the changes of this step, exactly what it printed at the step 8 tip (`diff` of the two outputs with the header's seconds removed: no difference; checked again after the stake rule changed).
