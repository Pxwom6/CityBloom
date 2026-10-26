# SPEC-4.md: Citybloom phase 4, multiplayer

Phases 1–3 are complete, and so are the playthrough fix round (`PLAYTHROUGH-FIXES.md`, PR #14) and the install button (PR #15). SPEC.md, SPEC-2.md and SPEC-3.md still apply. This phase makes Citybloom multiplayer. It starts with friends building one city together (co-op). Then comes a shared region, where each player runs their own city beside the others and trades with them, as in SimCity (2013). Players connect two ways: through online rooms on Cloudflare's free plan, and peer-to-peer from one player's browser. Where this brief is silent, use your judgment as a game designer and network programmer, and log the call in `docs/DECISIONS.md`.

## Before you start

1. Make a `multiplayer` branch from the latest `main` and work there. In a cloud session, use the session's own working branch instead, and say which one in PROGRESS.md. Leave the open `local-model-test` pull request alone.
2. If this brief was pasted into the session rather than given as a file, save it at the repo root as `SPEC-4.md`, word for word, and commit it first.
3. Update CLAUDE.md:
   - The current brief is SPEC-4.md (phase 4, M29–M33) on the `multiplayer` branch.
   - Replace the lines about `PLAYTHROUGH-FIXES.md`, which is finished.
   - Add SPEC-4.md and its rules to the start-of-session steps.
   - Make the branch notes for local and cloud sessions match.
4. Add M29–M33 to the checklist at the top of PROGRESS.md, unticked. Add a phase 4 section to `docs/SPEC_REVIEW.md` and to `docs/DECISIONS.md`.

## What this builds on

The simulation is pure and deterministic and runs in a Web Worker (`src/sim`, `src/sim/worker.ts`). The page sends it commands (`src/sim/commands.ts`, about 40 kinds, `undo` and `redo` among them) and mirrors its state from compact frames (`ClientWorld`). The same seed and commands give the same state hash (`sim.hash()`).

That makes **lockstep** the natural model. Every player runs the same simulation, and only commands travel over the network, each stamped with the tick it applies at. A city's whole state only needs sending when someone joins.

I found these obstacles reading the code on `main` (6f049d3). Check each one, because there may be more:

- **Maths that differs between browsers.** `src/sim` uses `Math.hypot` about 60 times, `Math.sin` 25, `Math.cos` 17, `Math.pow` 6, `Math.atan2` 6 and `Math.exp` once. JavaScript promises exact results only for arithmetic, `Math.sqrt` and a few others (`floor`, `round`, `abs`, `min`, `max`, `fround`, `imul`). The functions above may differ in the last bit between Chrome, Safari and Firefox, so a shared city would drift apart.
- **Sorting.** `src/sim` has 119 sorts. Every comparator must be a total order, with ties broken by an id: a comparison that can return NaN sorts differently in different engines. Keep locale and `Intl` out of anything that lands in the state.
- **The worker's own clock.** `worker.ts` advances ticks from `performance.now()` at 8, 16 or 24 a second. It drops ticks past 60 a loop and applies a command the moment it arrives. In a shared city, the room's clock decides the tick, a command applies at the tick it carries, and no tick is ever dropped.
- **Saving may change the city.** `save()` calls `finishMatching()`, which ends the current matching round early. A city that saves at tick T can therefore carry on differently from one that doesn't. Autosaves at different moments on different machines would then split a shared city apart.
- **Undo history isn't saved.** A player who joins late would hold a different history from everyone else.
- **The full hash is slow.** `hash()` turns the whole state into canonical JSON, which is too costly to run often on a 100k city.
- **Previews.** Some previews run a trial and put it back (P2's road-upgrade preview). They must never change a city's future.

## Where this runs

- Either on my Mac (CLAUDE.md, local sessions) or in a cloud session.
- Test multiplayer on one machine, needing no internet:
  - several players against a local relay;
  - peer-to-peer between browser contexts;
  - cross-browser checks in Playwright's Chromium, WebKit and Firefox (`npx playwright install webkit firefox`).
- Several 3D pages at once are slow on SwiftShader, especially in a cloud VM. A headless test player (the sim and the network code with no rendering, run in Node) keeps most multiplayer tests cheap. Keep the browser e2e for what only a real page shows.
- Deploying the online relay needs my Cloudflare account. When you get there, put exactly what I need to do at the top of PROGRESS.md: the account, an API token with the permissions you need, and the repository secrets the deploy workflow reads. Carry on with the local relay meanwhile. Never commit a token, and never ask me to paste one into the session.

## Rules for all of phase 4

- **Single player doesn't change.**
  - Same seed and commands, same state hash, now in every browser.
  - No network traffic unless the player opens multiplayer.
  - Offline play, saves and the install button keep working.
- **The sim stays pure.** Networking lives outside `src/sim`: the client side in its own folder, and the relay in its own folder with its own tests. The sim learns only what a shared city has to agree on, such as who issued a command.
- **Determinism is a contract.** New sim code uses the deterministic maths, and lint enforces it. Rerun the cross-browser test at the end of every milestone.
- **Stay on Cloudflare's free plan.**
  - The limits as of October 2026 ([pricing page](https://developers.cloudflare.com/durable-objects/platform/pricing); check they haven't changed):
    - The Workers Free plan includes Durable Objects with SQLite storage.
    - Daily limits: 100,000 requests, 13,000 GB-s of duration, 5 million rows read and 100,000 rows written.
    - Total storage: 5 GB.
    - Incoming WebSocket messages count as requests at 20 to 1.
    - A Durable Object idle under the Hibernation API isn't billed for duration.
  - Design to these limits: batch messages, let rooms sleep when nothing happens, and write snapshots rarely.
  - Log in PROGRESS.md what an hour of 4-player play costs against each limit.
- **Safe for friends.**
  - No accounts and no public room list: a room is found only by its code.
  - Players choose a display name, and nothing else personal is collected.
  - The host can lock a room, remove a player and turn chat off.
  - The relay checks every message's shape and size, and rate-limits.
- **Budgets.**
  - Keep the performance budget: at about 100k residents, the sim tick averages under 1 ms, worst under 15 ms.
  - Keep the frame budget.
  - Add a network budget: messages and bytes per player per minute in a busy co-op city, logged at every milestone.
- **Saves.** New saved state bumps the save version, with a migration and a test, as before.
- **Balance stays as it is.** The balance round comes later. A shared city keeps the difficulty it was founded with.
- **Milestones.**
  - Every milestone ends playable and tested through the real UI with at least two players, with screenshots reviewed.
  - It finishes with a commit starting `M<n> complete:` and a pull request into `main` with the same title.
  - Keep working on the branch after it; if I've merged, the next pull request picks up from there.
- **Keep players informed.**
  - Tooltips and tutorial tips for the new screens.
  - Plain messages for everything network-related, for example "Waiting for Sam…", "Reconnecting…", "Sam's game fell out of step; catching up".
- **Real devices.** Anything that needs them goes under "To check on the Mac" in PROGRESS.md: a Mac and a Windows PC in one city, Chrome with Safari, and a phone.

## Milestones

**M29 Same city everywhere.** The lockstep core, with no network yet.

- **Deterministic maths.**
  - Replace the engine-dependent calls in `src/sim` with versions that give the same bits everywhere. `Math.sqrt` and arithmetic are exact, so hypot is easy; sin, cos, atan2, pow and exp need careful ports or tables.
  - Add a lint rule that forbids the originals in `src/sim`.
  - Fix any sort that isn't a total order.
  - Single player may change only in the last bits. Rerun `balance`, `bench` and the scenario tests, and explain any difference.
- **Cross-browser test.** Grow a town from a seed with a script that uses every command kind, for at least two game years. Chromium, WebKit and Firefox must give the same state hash at every month's end.
- **Stamped commands.**
  - The worker can be told to run to a given tick.
  - It applies commands at the ticks they carry, never drops a tick, and reports how far behind it is.
  - Single player keeps its own clock.
- **Futures left alone.**
  - Taking a snapshot doesn't change the city that takes it; or, in a room, every player takes it at the same tick.
  - No preview or query changes a city's future. Test this by running them between ticks on one of two identical sims and comparing the two a year later.
- **Out-of-step detection.**
  - A cheap checksum every game hour, from key totals and arrays rather than the whole state.
  - The full hash at each month's end.
  - A desync report that names the first part of the state that differs.
- **Undo.** Choose a rule that every machine agrees on and that a late joiner can follow, and log it in DECISIONS. One possibility: you can undo your own last edits while nothing newer touches them, with the history carried in snapshots.
- **Cheats.** Test-mode cheats are refused in a shared city.

*Done when:*
- the cross-browser test passes;
- two sims in one page, fed the same stamped commands, stay in step for a game year;
- a third sim, given one command a tick late, is caught within a game hour, and the report names what differs;
- single player's tests, `balance` and `bench` are unchanged apart from documented last-bit drift.

**M30 Rooms, online and peer-to-peer.**

- **One room protocol over two transports.**
  - **Online rooms on Cloudflare.** A Worker runs one Durable Object per room, using the WebSocket Hibernation API and SQLite storage. The room keeps its city between sessions (the latest snapshot and the commands since), so friends can come back after everyone has left.
  - **Peer-to-peer.** The host's browser is the room and keeps the city in the host's saves. Friends connect over WebRTC data channels.
    - Signal through the Cloudflare Worker when online rooms are set up.
    - Also offer a way to connect with no server of ours at all, for example a library such as Trystero over public relays, or two short codes swapped in a chat. Research the options and log the choice.
    - Use public STUN servers.
    - When two players can't connect directly, say so plainly and offer an online room instead. A TURN relay is an option if my account can use one; Cloudflare's TURN gives 1,000 GB a month free.
- **A clock that suits both.**
  - One possible design: one player's game sets the pace (the host's, handed over if they leave). That keeps an online room event-driven and asleep between messages. If the room keeping time itself works better within the free plan, do that instead, and log it.
  - The room waits for anyone too far behind ("Waiting for Sam…").
  - A host whose tab is in the background must not stall everyone, because browsers slow background tabs down.
- **Joining.**
  - A lobby from the main menu: Host online, Host on this computer, and Join with a code.
  - Short codes without look-alike characters, and invite links (`?join=CODE`) that open the game straight into the room.
  - A name and a colour for each player, and up to 8 players.
  - Joining midway loads a snapshot and catches up.
  - A dropped connection reconnects without a reload.
  - A player who falls out of step is resynced from a snapshot, with a short message.
- **Development and deployment.**
  - A local relay that speaks the same protocol, so tests and e2e need no internet.
  - A GitHub Actions workflow that deploys the Worker from `main` once the secrets exist, and gives the relay's address to the site's build.
  - With no relay configured, the online option says it isn't set up yet, and peer-to-peer still works.

*Done when:*
- two players build one city together, in step for a game year, both through the local relay and peer-to-peer;
- a third player joins halfway and catches up;
- a dropped connection comes back;
- a deliberately desynced player is caught and resynced;
- the free-plan cost of an hour of play is logged.

**M31 Building together.** Co-op in one city.

- **Seeing each other.**
  - Every player's cursor and tool ghost show on the map in their colour, with their name.
  - A player list sits in the top bar.
  - "Follow" rides along with someone's camera.
  - Players can ping a spot on the map ("look here").
- **Acting together.**
  - One treasury, budget, tax rates and policies.
  - Your own commands show at once as pending, and settle when the room orders them.
  - A refusal goes back to the player who acted.
  - When two players build on the same spot, the room's order decides, and whoever lost is told why.
- **Roles.**
  - The host decides who can bulldoze others' work, change taxes and policies, take out loans, start big projects, or spend above a set amount.
  - The room checks roles before it orders a command.
  - The inspector shows who built what.
- **Talking.** A short chat, notices when players join and leave, and the host can mute a player or turn chat off.
- **Speed, pause and saving.** Decide who can pause, change the speed or save, and log the rule. Everyone sees who did it.
- **Cities and saves.**
  - "Invite friends" in the pause menu turns the city you're playing into a room.
  - Any player can export a copy.
  - Online rooms autosave in the room, and peer-to-peer cities in the host's browser, at a moment every player agrees on.
- **The rest of the game.** Elections, approval, scenarios and achievements all work in a shared city: one mayor's office, and the goals are shared.

*Done when:*
- a scripted e2e with two players grows a town through the real UI, each laying roads, zones and a service;
- each sees the other's cursor and chat;
- a tax change by one player shows for the other;
- the room's city reopens later with everything in it;
- the frame and tick budgets hold with 4 players.

**M32 Shared regions.** Each player runs their own city, side by side.

- **The region.**
  - Up to 4 player cities share a region, in an online room, or peer-to-peer while the host is online.
  - Each city is played on its owner's machine at its own speed.
  - Players take the place of M23's simulated neighbours; empty spots keep simulated ones.
- **Across the borders.**
  - M23's deals (power, water, sewage and garbage) between player cities.
  - Commuters and shoppers along the highway and rail links, and visitors.
  - Deals settle every game month on each city's own clock.
  - A city keeps playing when its neighbours are offline: their last offer stands, capped by what they last reported.
  - Nobody gains by pausing or by running at 3×.
- **The region view.**
  - Each city's name, mayor, population and a small picture.
  - The deals you have with each city.
  - Visiting a neighbour's latest city, read-only.
- **A region project.** Several cities pay into it and one city hosts it: an original idea in the spirit of SimCity's great works, with a reward every contributor feels.

*Done when:*
- three players in one region trade power and commuters;
- one goes offline and the others keep playing on the last deals;
- a scripted test shows each deal settling the same in both cities;
- the region project completes with money from all three.

**M33 Ready for friends.**

- **A soak test.** Four players for two hours of real time at mixed speeds, with joins, leaves, reconnects and a resync, and no unexplained desync.
- **Polish.**
  - The lobby, invites and messages on narrow windows and touch screens.
  - Tutorial tips for the multiplayer screens.
  - A "Play with friends" section in the README.
- **Troubleshooting.** A short note in the game and the README: what to do when peer-to-peer can't connect, when a room is full, and when someone falls out of step.
- **Free-plan check.** Compare the free-plan usage with real play, and tune batching and snapshot writes to fit.

*Done when:*
- the soak test passes;
- the cross-browser test passes;
- I could send a link to a friend and we could play together without either of us reading instructions first.

## When every milestone is done

Update the summary at the top of PROGRESS.md, this brief's section in `docs/SPEC_REVIEW.md`, and the README. Then play a co-op city and a region through the real UI with at least two players, and fix whatever feels off.
