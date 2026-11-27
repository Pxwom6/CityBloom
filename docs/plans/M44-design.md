# M44 Weekly challenge: the plan

SPEC-6.md M44. The same challenge for everyone each week (a new one every Monday, Adelaide time),
played solo as often as wanted, scored, with a leaderboard (everyone, a friends board by group code,
last week's results), honest scores checked by replaying the run, and owner controls.

## 1. The week
- `src/data/challengeWeek.ts`: `challengeWeek(nowMs)` is the number of whole weeks since an epoch
  Monday 00:00 in Adelaide (Australia/Adelaide, +9:30 or +10:30 in daylight saving), worked out with
  `Intl.DateTimeFormat` (browsers and Workers both have it), and `weekBounds(week)` the start and end
  instants. Monday 00:00 is never inside a daylight-saving change (those are Sunday 2–3 am).
  Unit tests at instants either side of the boundary in both seasons.

## 2. The generator (deterministic, seeded by the week)
- `src/data/challenges.ts`: `challengeFor(week)` builds a `ChallengeDef`: a `ScenarioDef` (goals,
  limits, months, no starting save: the city is founded fresh on the challenge's seed and map), a
  template, a twist and the score rule. Integer hashing of the week only (no engine maths), so the
  page, Node and the Worker agree.
- Templates (goal sets, scaled by the months): Boom town (population), Happy town (approval with a
  population), Balanced books (treasury and net income with a population), Clean air (pollution at
  most, with a population), Full employment (unemployment at most, jobs at least), Tourist town
  (visitors), Green power (powered share with no coal or oil).
- Twists: a tight budget (half the money), no highways (the city highway road type refused), an early
  disaster (a quake or a tornado at a set month), rail only (no buses: bus stops and depots refused),
  a small map (building only inside a box around the highway's end).
- A pinned challenge (the owner's, for one week) replaces the generated one: the page fetches the
  week's pin from the board and checks it with `cleanChallengeDef`.

## 3. In the sim
- `ScenarioState.def` (save v33): a challenge's definition travels with its city, so
  `scenarioDef(sim)` reads it before the registry; `ScenarioState.challenge` keeps the week, and the
  score once finished. New limit kinds `noRoad` and `area`; a scripted disaster month
  (`ScenarioDef.disaster`). Commands: `startChallenge { def, week }` (page-only; applies the twist's
  money and founds the scenario).
- Score (`challengeScore(sim)`, pure): each goal's progress (capped at its target) counts up to
  1,000; a win adds 5,000 and 250 per month left; the template's extra measure adds a little (e.g. a
  thousandth of the population). Worked out at the end (won or time up) and kept in the state.

## 4. Runs and replays
- A run is the challenge's founding (week, def and the options) plus every command and save point
  with its tick (the worker's log since founding, as M41's desync replay uses: `pre` entries and
  `settle` markers), the final tick and `sim.hash()` there, and the score.
- `src/sim/runReplay.ts` (pure): found the city, apply the entries at their ticks, run to the final
  tick, return the hash and the score. Used by the worker (verifying the board's top runs off the main
  thread), the replay viewer, and Node tests.
- The log is gzip-compressed and capped (256 kB packed); a run whose log is cut can't be posted.

## 5. The board (relay)
- `relay/challengeBoard.ts` (logic over SQLite, testable in Node as `reportDesk` is) behind HTTP
  (`relay/challengeHttp.ts`), a `ChallengeObject` Durable Object in the Worker and the same in the local
  relay. Endpoints: `GET /challenge/current` (the week, its end, the pin, the top score),
  `GET /challenge/board?week&group`, `POST /challenge/score`, `GET /challenge/run?id`,
  `POST /challenge/verdict`; owner (`Authorization: Bearer OWNER_KEY`): entries by week, remove one,
  pin a challenge for a week, the name filter's words.
- Cheap checks on a score: shape and size, the week (this one, or the last within an hour of the
  change), plausible bounds for the template, the log's tick count against the challenge's months,
  one score per address per 3 minutes (in memory only), a name cleaned (`cleanName`) and filtered.
- Verdicts: pages replay the top runs they show (in the worker) and say whether the hash and score came
  out the same; a mismatch drops the entry (it stays for the owner to see and restore); a match marks it
  checked. Verdicts are rate-limited per address. What a modified client could still do, and what would
  close it, goes in DECISIONS.
- Storage: per week at most 500 entries (the lowest go first), logs kept for the top 100; weeks older
  than last week deleted (an alarm, or on each write); a day's rows capped.

## 6. On the page
- Main menu: "This week's challenge" (its name, time left, top score). The Challenge screen: the
  map, goals, twist and time limit; Play; the board (this week, friends, last week); groups (make one,
  join by code, leave; kept in local storage); Watch beside each run.
- A challenge city opens like a scenario (goals panel, brief), saved like any city and marked as a
  challenge city (its save meta). At the end: the score, Post score (with the display name), Try
  again, the board.
- The replay viewer: `?challengeRun=<id>` plays the run's log in a read-only city at speed and says
  at the end whether it reached the same hash.
- Phones upright and sideways from the start; tips for the new screens.

## 7. Tests
- Unit: the week clock across boundaries; the generator (52 weeks, every def valid, deterministic);
  the sim's challenge (score, limits, twists, save v33 migration); run replay (same hash; a forged
  hash or score is caught); the board (checks, caps, verdicts, owner, sweep).
- Balance: `scripts/challenges.ts` has the balance mayor play 52 weeks; none impossible; scores logged.
- E2E: play a challenge through the UI, post a score, see it on the board and the friends board,
  watch another run's replay; a forged score dropped; the week rolling over (Playwright's clock).
