# M43 Quick match: the plan

SPEC-6.md M43. Two to four players each found their own small city on the same seed, side by side in
a shared mini-region (M32's region room, online or peer-to-peer), and race against a real-time timer.

## 1. A match is a region with a `match`
- `RegionMatch` (`src/data/match.ts`): mode (`race` | `rich` | `happy` | `mixed`), minutes (15, 20,
  30; test builds may ask for 1), target population for Race (10,000), the minimum population for
  Happy town, the seed and map preset (chosen by the host's page), the match speed (3, fixed),
  `chat` (off unless the host allows), and the room's own facts: `phase` (`lobby` | `countdown` |
  `playing` | `over`), `startAt`, `endsAt`, `round`, and at the end the `result`.
- The host's page creates the region with `create.match`; joiners first say a visitor hello (the
  region's view, with the match, comes back without taking a slot), found their city on the match's
  seed with the fast start, and then join as a city. Rooms keep their limits; a match region is
  marked `kind: 'match'` in its view and refuses war rules.
- Protocol 8 (`PROTOCOL_VERSION`): the match, `rmatch` (the host's settings in the lobby), `mstart`,
  `emote`, region `chat` in a match, `mresult`, `mnext` (rematch). A region accepts older pages for
  ordinary regions as before (`MIN_REGION_PROTOCOL`), but a match region turns a page below 8 away
  with a plain message. Rooms (co-op) take only 8 (as every bump).

## 2. The match's clock
- The room is the clock: `mstart` (host, 2–4 cities in) → a 5 s countdown → `startAt`, `endsAt =
  startAt + minutes`. Pages start their sims at `startAt` at the match speed and lock the speed
  controls; menus don't pause a match city (a player who stops loses the time, the timer doesn't
  stop). At `endsAt` pages stop their sims and send a final report with the city's state hash.
- The fair clock (M37) generalised: each report carries the city's tick; the room counts a report
  only if its tick is within the game time real time allows since `startAt` at the match speed (plus
  a small slack), so a page that runs faster than the match can't win by it.

## 3. Scores and the verdict
- Reports gain `treasury`, `approval`, `assets` (what the city's buildings and roads are worth, from
  the sim), `tick` and, at the end, `hash`; a match room asks a report every 5 s and broadcasts a
  compact score line (`mscores`), not the whole view (thumbs go every 60 s).
- `matchScore(mode, report)` is shared by the room and the pages: Race (population; the first city a
  counted report shows at the target ends the match), Rich list (treasury + assets), Happy town
  (approval, if population ≥ the minimum), Mixed (population, approval and money on one scale).
- The room decides: at the end (or the Race finish) it waits up to 10 s for final reports, then
  broadcasts one `mresult`: the winner, each city's numbers and hash, and score samples for a chart.
  Every page shows that same result.

## 4. A fast start (deterministic, in the sim)
- `GameOptions.match?: { growth, unlock, funds }`: funds at founding, growth (spawning, moving in,
  constructions under way and building speed) times `growth`, and unlocks at `unlock` × their
  population. Absent in every other city (saves unchanged); `endMatch` takes it away when a player
  keeps the city as an ordinary save. Numbers in DECISIONS, tuned by balance mayors playing matches.
- War, disasters and elections off in a match city; the region's computer neighbours stay out.

## 5. During and after
- A scoreboard bar under the top bar (each city's name, its score, the leader), the timer, a big
  countdown in the last minute, emotes (six fixed ones; chat only if the host allows), the Region
  panel's neighbour cards with their pictures for a peek (and a fresher save to look round: every 60 s
  in a match).
- Results: the winner, each city's numbers, a chart; Rematch (the host's page opens a new match region
  with a new seed and the same settings; the old room tells every page the new code and they found
  and join at once); Keep this city (an ordinary save, the match's fast start removed); Back to menu.
- Leaving early: the city is out (shown as left), the match goes on. Online, the host's role passes to
  the next player (settings, start, rematch); peer-to-peer, the region lives in the host's browser,
  so the match ends there with the scores so far.

## 6. Tests
- Unit: scoring, cleaning, the fast start (faster growth, same hashes twice), saves; the room's match
  life (lobby, start, fair counting, Race finish, timer end, leavers, host hand-over, rematch).
- Bots: balance mayors play matches against each other (Race reachable in its time on Normal; every
  mode decided), logged in DECISIONS and PROGRESS.
- E2E: each mode with two and four players, online and peer-to-peer (rematch chains change modes;
  test builds allow a 1-minute timer), every page ending on the same result and hashes; phones.
- Network budget: messages and bytes per match against the free plan.
