# SPEC-6.md: Citybloom phase 6, playing with friends

Phase 5 (war between cities, SPEC-5.md) is complete and merged into `main` (PR #23). SPEC.md through SPEC-5.md still apply.

Online rooms are now live on Cloudflare, and the first real co-op game between two players on two machines went really well. Now I'm sharing Citybloom with mates from school, so this phase is about them. It makes the game easy to learn, gives them short games to play against each other and a reason to come back every week, and gives them a way to make their own buildings and send me ideas. It also tells me when something breaks on someone else's computer.

Where this brief is silent, use your judgment as a game designer, and log the call in `docs/DECISIONS.md`.

## Before you start

1. Start from the latest `main`. Make a `friends` branch from it and work there. In a cloud session, use the session's own working branch instead, and say which one in PROGRESS.md. A branch can have only one open pull request into `main`: if the last milestone's pull request is still open when the next milestone is done, add the new milestone to it, and say in its title and description which milestones it holds.
2. If this brief was pasted into the session rather than given as a file, save it at the repo root as `SPEC-6.md`, word for word, and commit it first.
3. Online rooms are set up on Cloudflare: the GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist, and pushes to `main` deploy the relay. Remove "Needed from the owner: Cloudflare for online rooms" from the top of PROGRESS.md, and update the README and CLAUDE.md wherever they say online rooms aren't set up.
4. Some pages in this phase are for me alone (the bug reports, and approving submissions). They need a key that only I know. Add to the top of PROGRESS.md a short "Needed from the owner" section that says how to make one and store it as a GitHub secret named `OWNER_KEY`. The deploy workflow passes it to the Worker as a Worker secret. Until it exists, the owner pages say they aren't set up, and everything players see works as normal. Never ask me to paste the key into a session, and never commit it.
5. Update CLAUDE.md:
   * The current brief is SPEC-6.md (phase 6, M41–M48) on the `friends` branch. In a cloud session, the session's working branch stands in for `friends`.
   * Add SPEC-6.md and its rules to the start-of-session steps.
   * PROGRESS.md's checklist now runs from M0 to M48.
6. Add M41–M48 to the checklist at the top of PROGRESS.md, unticked. Add a phase 6 section to `docs/SPEC_REVIEW.md` and to `docs/DECISIONS.md`.

## The game this phase is aiming for

* A new player is building a working town in their first ten minutes, without anyone explaining it to them, and knows where to look when something goes wrong.
* Two to four mates can play a whole quick match in a school lunch break. That means joining, playing, a winner and a rematch button, in 20–30 minutes.
* Every week there's something new to try: the same challenge for everyone, a leaderboard, and a reason to talk about it at school.
* A city's story is easy to show off. A timelapse video of it growing from the first road takes a couple of clicks.
* Players can make the city their own. They can bring in buildings they've made themselves, learn how to make one from inside the game, and send their best ones and their ideas to me.
* I hear about problems without anyone having to tell me. That covers crashes, errors and desyncs, plus a "Report a problem" button for everything else.

## Rules for all of phase 6

* What's there doesn't change.
   * Single player, co-op, shared regions and war play exactly as before.
   * Existing saves load and play on unchanged. Save version bumps get migrations and tests, as always (saves are at v32 now).
   * Relay protocol bumps keep older clients from joining with a plain message, as before (the relay is at protocol 7).
* Phase 4's and 5's rules still apply:
   * the deterministic maths, with the cross-browser test rerun at the end of every milestone;
   * the sim stays pure, and networking lives outside `src/sim`;
   * the free Cloudflare plan, with nothing that needs a payment card;
   * the performance, frame and network budgets;
   * plain reasons for every refusal, and tips for every new screen.
* Safe for friends, a bit stricter now. Most players will be school students. Everything players can write or upload follows these rules:
   * No accounts. A display name is the only thing that identifies a player, and it's cleaned the way names are today. Nothing else personal is collected: no emails, ages, schools or locations. Don't store IP addresses beyond what rate limiting needs in the moment.
   * Nothing a player writes or uploads is shown to other players until I've approved it. That covers idea text, submitted buildings and their names. The exceptions: a player's own custom buildings in their own city, and in rooms they host or join (M46), and leaderboard names, which are display names, cleaned, length-capped and run through a simple word filter that I can add to from the owner page.
   * Every upload and message is checked for shape and size, and rate-limited, as the relay does today.
   * I can remove anything from the owner pages: a leaderboard entry, a submission, an idea.
* Owner pages. M41 makes a small owner area on the site (`#/owner`, or a separate page the build includes). It's unlocked with `OWNER_KEY` and checked by the Worker on every request, never in the page alone. It's linked from nowhere in the game. M41's bug reports and M48's submissions both live there. Make it usable on my phone.
* Storage. Use Durable Objects with their SQLite storage, as the relay's rooms already do, and keep within the free plan's limits. Log what each feature stores, how big it can get, and how long it's kept. Old data is deleted on a schedule: bug reports after 60 days, rejected submissions after 30. If something can't fit the free plan, stop and say so in PROGRESS.md rather than switching plans.
* Milestones.
   * Every milestone ends playable and tested through the real UI, with screenshots reviewed. Multiplayer milestones are tested with at least two players.
   * It finishes with a commit starting `M<n> complete:` and a pull request into `main` with the same title.
   * Rerun `balance` and `bench` and log them.
* Real devices. Anything that needs them goes under "To check on the Mac". Anything that needs a real new player goes under a new heading, "To try with a mate".

## Milestones

### M41 Hearing about problems

Error reports, desync reports and the owner area. This comes first so the rest of the phase's playtests feed it.

* Automatic reports.
   * Uncaught errors and rejected promises on the page.
   * Errors in the sim worker and the battle workers.
   * A failed save or load.
   * A model that fails its check at start-up.
   * Desyncs: two players' state hashes disagreeing in a shared city or a battle.
   * Each report carries the game version (commit), the browser and OS, the graphics quality, the save version, whether the city is shared, and the error and its stack.
   * A desync report also carries the tick and the hashes on each side. Where it fits the size cap, it carries the commands since the last agreed snapshot too, so I can replay it.
* What is never sent: names, chat, city names, saves, or anything typed into a text box. The only exception is the player's own message in a report they write.
* "Report a problem".
   * Find it in the pause menu and the main menu.
   * It has an optional short message, and an optional screenshot of the game (not the whole screen). The player sees what will be sent before sending.
* Settings. "Send crash reports" is on by default, and players can turn it off. The first time the game opens after this update, one sentence says what is sent and where the switch is.
* Keeping it sane.
   * The same error from the same version folds into one entry with a count.
   * Each browser sends at most a few reports a minute.
   * The Worker rejects anything over its size cap.
   * Nothing breaks if the network is down: reports wait in IndexedDB and send later, up to a small limit.
* The owner area.
   * Sign in with `OWNER_KEY`.
   * Reports are grouped by error, newest first, with counts, versions, browsers and a first-seen date.
   * Mark a report fixed. If it comes back on a newer version, it reopens.
   * Download a desync's replay.
   * A "copy for Claude Code" button copies an entry as plain text, ready to paste into a session.
* A script to replay a desync. `scripts/` gets a script that replays a downloaded desync in Node and says where the hashes split.

Done when:

* a deliberate error, a forced desync between two pages and a written report each reach the owner area through the real UI, against the local relay;
* duplicates fold together;
* turning the setting off sends nothing;
* a modified client can't fill storage past its cap;
* the desync replay script finds the split tick for a forced desync.

### M42 Learning to play

A proper first-city tutorial, built on the one in `src/client/tutorial.ts`.

* The first city. Today's eight steps stop at "keep the city happy". Grow them into a guided first city that reaches about 1,000 residents, with the game pausing to teach at the moment each thing matters:
   * roads and zoning;
   * power, water and sewage;
   * reading demand bars;
   * the budget and taxes;
   * the first service buildings, and coverage maps;
   * the advisors;
   * what to do when the first problem arrives (a fire, a power cut or a traffic jam);
   * saving.
* How it feels.
   * Short sentences.
   * A pointer at the button to press.
   * The camera moves to where it matters.
   * Every step can be skipped, and the whole tutorial can be left and picked up again.
   * It's never in the way of a player who already knows what to do. Steps that are already done finish themselves, as they do today.
* A "Learn" section on the main menu, with short lessons a player can open any time, each two to four minutes on a small prepared town:
   * traffic and transit;
   * money and loans;
   * happiness and services;
   * disasters;
   * districts and policies;
   * playing with friends (rooms, codes, co-op, regions);
   * war (opt-in, for cities with rivals on);
   * making your own buildings (M47 adds it).
* New players in a friend's room. A short first-time card covers what's shared, who can build what, and how to chat and ping.
* Clearer first problems. Two known issues trip new players: homes emptying after about two days without power or water, and towns without services slowly shrinking. Warn earlier and plainly before either happens, using the advisors, not a wall of text.

Done when:

* an e2e plays the whole first-city tutorial through the real UI from the main menu to 1,000 residents, and plays every lesson;
* skipping and resuming work;
* each step has a screenshot reviewed at 100 % and 140 % interface size and on a phone.

### M43 Quick match

Short games against each other.

* Setting up a match.
   * From the main menu: "Quick match" opens a room, online or peer-to-peer, for 2–4 players.
   * Join by code or invite link, as rooms work today.
   * Each player gets their own small city in a shared mini-region, side by side, all on the same seed. Reuse M32's shared regions.
* Modes, chosen by the host:
   * Race: first to a population (10,000 by default).
   * Rich list: the most money in the treasury plus assets when the timer ends.
   * Happy town: the highest approval, with a minimum population, when the timer ends.
   * Mixed: a score from population, approval and money.
* The rules of a match.
   * A timer: 15, 20 or 30 real minutes.
   * One game speed for everyone, set by the match, with no pausing that stops the clock. Use the fair clock from M37.
   * A faster start: more starting money, quicker growth and a short unlock path, so a city gets somewhere in 20 minutes.
   * Log every number in DECISIONS, and tune them by having the balance mayor play matches against itself.
   * War is off in matches.
* During a match.
   * A live scoreboard along the top.
   * A peek at a rival's city from the region view.
   * A countdown for the last minute.
   * Quick reactions (a few fixed emotes, no free text unless the host allows chat, as rooms do today).
* At the end.
   * A results screen: the winner, each city's numbers and a small chart over the match.
   * Rematch, with the same players, a new seed and one click.
   * Back to menu.
   * A match city can be kept as a normal save afterwards.
* Leaving early. A player who leaves is out, and the match goes on. A host who leaves hands over, as rooms do.

Done when:

* a match of each mode plays through the real UI with two and with four players, online against the local relay and over peer-to-peer, all ending on the same result and hashes;
* rematch works;
* a match fits the network budget;
* a balance run shows each mode can be won in its time on Normal.

### M44 Weekly challenge

The same challenge for everyone, every week.

* The challenge.
   * A new one every Monday, Adelaide time.
   * It's a fixed map and starting city, goals, limits and a time limit, the way scenarios (M18) work, with a score rather than just stars, so there's something to beat.
   * Challenges come from a deterministic generator seeded by the week: a map, one of a set of goal templates and a twist (a tight budget, no highways, an early disaster, rail only, a small map), so I never have to make one.
   * I can pin a hand-made challenge for a week from the owner area instead.
* Playing it.
   * "This week's challenge" on the main menu, with the time left and the current top score.
   * Play solo, as many tries as wanted; the best counts.
   * The city is saved like any other, marked as a challenge city.
* The leaderboard.
   * Top scores for the week, with display names.
   * A friends board: players in a group (made with a code, like a room) see each other's scores among everyone else's, so mates can compete without being lost in the global list.
   * Last week's results stay visible until the next change.
* Honest scores.
   * A score is sent with the run's command log and final hash.
   * The Worker checks what it can cheaply: shape, size, the week, plausible bounds, and one score per player per few minutes.
   * Anyone can watch a top run as a replay in the game, which replays the log and must reach the same hash. A run that doesn't is dropped from the board.
   * Log what a modified client could still get away with, and what would close it, in DECISIONS.
* I can remove an entry from the owner area.

Done when:

* the generator makes 52 weeks of challenges that the balance mayor can finish, none impossible, logged with their scores;
* an e2e plays a challenge through the real UI, posts a score, sees it on the board and the friends board, and watches another run's replay;
* a forged score with the wrong hash doesn't stay on the board;
* the week rolls over correctly at the boundary.

### M45 Timelapse

A video of a city growing.

* Recording.
   * While a city plays, the game quietly keeps small frames from a few fixed camera views at regular game-time steps: a wide view of the whole map and an orbit of the busiest district.
   * The frames go to IndexedDB, within a size limit, thinning out older frames so a long city still fits.
   * It's on by default for new cities, can be turned off, and costs nothing noticeable on the frame budget. Measure it and log it.
* Making the video.
   * In City history (Y), "Make timelapse" offers a length (15, 30 or 60 seconds), a view, and a choice of overlays: the city name, the date, population, and milestones and disasters from the history timeline.
   * Optional music from the game's own audio.
   * Export a video file that plays on phones and in group chats. Pick the format that works across Chrome, Edge and Safari, and log why.
   * Save the first and last frames as pictures too.
* Cities that are already running start their timelapse from when this update arrives. Say so plainly rather than pretending.
* Shared cities record on each player's own machine. Nothing extra is sent.

Done when:

* an e2e grows a city for several game years, makes each length of timelapse through the real UI, and checks that the file plays and shows growth;
* recording stays inside the frame budget on the bench city (measured on the Mac's GPU too);
* storage stays under its limit on a long city.

### M46 Your own buildings

Bringing in models players make themselves.

* What a custom building can be:
   * A new look for a building the player placed, such as their city hall, a school, a stadium or a power plant. The sim still sees the original building, and only its look changes.
   * A custom landmark: a decorative building on a lot of 1×1 up to 4×4. It works like a plaza or park of that size in the sim, so nothing in the economy changes.
   * Zoned buildings (homes, shops, industry) stay as they are in this phase.
* Checking a model.
   * The player drops a GLB on the game or picks one from their files.
   * It's checked in the browser by the same check `npm run models:check` uses (`src/models/check.ts`), against the same model spec (v6 for buildings) and the footprint and budget of the building it's for.
   * A model that fails is refused with each problem in plain words, and with a picture showing where the problem is.
   * On top of the check: a size cap (about 1 MB), no external files or links inside the GLB, and the file parsed in a worker so a broken file can't freeze the page.
* My Buildings. A panel holds the player's models with a preview: a turntable, by day and night, and in each season. From there they can place a model, rename it or delete it.
* In shared cities and regions.
   * A custom building's model travels to the other players in the room within the network budget and the snapshot cap, sent once and cached by its hash.
   * Settings get "Show friends' custom buildings" (on by default). With it off, a friend's custom building shows as the original building, or as a plain generated landmark.
   * The host can turn custom buildings off for the room.
   * The model stays the player's: nothing goes to the server except the copy passed through the room.
* Saves. A save keeps the models its city uses, so a city opens anywhere with its custom buildings. This is a save version bump.
* Sharing a model. "Share" makes a file the player can send a mate, a `.glb`, or a small `.citybloom-building` with the model and its name. The mate imports it the same way, and it goes through the same check.

Done when:

* an e2e imports a good model (made for the test, in the game's style) and three bad ones through the real UI, sees each bad one refused with the right reasons, places the good one as a new look and as a landmark, saves and reloads;
* a second player in a shared city sees it, and doesn't see it with the setting off;
* the frame budget holds with a city full of custom landmarks.

### M47 Making buildings

A proper tutorial for making your own.

* "Workshop". A section in My Buildings and the main menu's Learn page that walks a player from nothing to a building in their city:
   1. Pick what to make. A building to give a new look, or a landmark size. The Workshop shows its footprint, height range and budget, with a picture.
   2. Make the model. Two ways, each with steps and pictures:
      * With an AI 3D tool (I make mine in Claude Design). The Workshop writes the whole prompt for them, filled in for their building: the model spec, the footprint, the material roles and the file name, ready to copy. The style reference sheet (`docs/models/style-reference.png`) can be downloaded from the same page. Write it the way I write my prompts in `docs/models/PROMPTS-WAR.md`, so it gives the same kind of result.
      * In Blender, for players who want to build by hand. Cover the basics the spec needs: scale in metres, which way is the front, the ground at zero, naming parts with the material roles, and exporting as GLB.
   3. Check it. Drop it in. The check's results read like a teacher's notes: what's wrong, why the game cares, and how to fix it, with a picture. Include the common mistakes: wrong scale, facing backwards, floating above the ground, too many triangles, unnamed parts and wrong colours.
   4. See it. On its lot, by day and night, in each season, next to the buildings around it.
   5. Use it, share it or send it in (M48).
* The written guide. The same content as a page on the site, `docs/making-buildings.md` linked from the README and from the Workshop, with a worked example from start to finish and screenshots. Keep it short and friendly. It's for a 14-year-old who has never made a 3D model.
* The model spec, readable. A plain-words version of the parts of the model spec (v6) a player needs, generated from the same source the check uses, so the two can't drift apart.

Done when:

* an e2e follows the Workshop through the real UI from picking a landmark to placing a model, copies the generated prompt and checks it names the right footprint, budget and roles;
* each common mistake gets its own plain-words fix (tested with a bad model for each);
* the guide's screenshots are reviewed;
* a mate who has never made a model tries it (under "To try with a mate").

### M48 Send it in

A submissions page for ideas and buildings.

* For players. "Send an idea" on the main menu and in the pause menu, and "Send it in" from My Buildings. A submission is one of these:
   * An idea: a short title, a description (capped at a sensible length) and a kind (a building, a feature, a fix, a scenario or challenge, something else). An optional screenshot from the game.
   * A building: a custom model that passes the check, with its name, what it's for (a new look for a building, or a landmark size) and a line about it.
   * Every submission has an optional "credit me as" display name. Nothing else about the player is asked for or stored.
* Before sending. The player sees exactly what will be sent, and that only I will see it unless I pick it.
* After sending. Their submissions are listed in the game with their status: sent, seen, accepted ("coming in an update") or not this time. The status is kept in their browser with a private token, not an account.
* For me, in the owner area.
   * All submissions, newest first, with filters by kind and status.
   * Ideas show their text and screenshot. Buildings show a 3D preview with the turntable and day and night, and the check's results.
   * Mark one seen, accepted or declined, with an optional short reply the player sees.
   * Delete anything.
   * Add words to the filter.
* Getting accepted things into the game.
   * An accepted building can be downloaded as a GLB with its credit.
   * A "copy for Claude Code" button gives the text a session needs: what it is, where it goes in `assets/models/`, its credit for `CREDITS.md`, and for an idea, the idea in full.
   * I bring accepted buildings into the game through the normal pipeline and a pull request. Nothing goes into the game automatically.
* An "Accepted ideas" list in the game shows the ideas and buildings I've accepted, with their credit names. It only ever shows what I've accepted, never anything waiting or declined.
* Limits.
   * A few submissions per browser per day, capped sizes, and the free plan's storage.
   * Declined submissions are deleted after 30 days.
   * Accepted ones are kept until I delete them.

Done when:

* an e2e sends an idea with a screenshot and a building through the real UI against the local relay, sees them in the owner area, accepts one with a reply and declines the other, and the player sees both statuses;
* the accepted list shows only the accepted one;
* nothing submitted is reachable without `OWNER_KEY` unless accepted;
* a modified client can't push past the caps or read another player's submissions.

## When every milestone is done

Update the summary at the top of PROGRESS.md, this brief's section in `docs/SPEC_REVIEW.md`, and the README (a new "Play with friends" overview covering quick match, the weekly challenge, timelapses and custom buildings, with pictures).

Then play the phase through the real UI and fix whatever feels off:

* a brand-new player's first city with the tutorial;
* a four-player quick match;
* a week's challenge;
* a timelapse of a grown city;
* a custom building made through the Workshop, shared with a friend and sent in;
* the owner area handling all of it.

Keep the playthroughs as a spec tagged `@playthrough`, as phase 5 did.

Put the real-world checks under "To check on the Mac" and "To try with a mate":

* a quick match between real friends on real machines at school or at home;
* a first-time player with no help;
* a mate making their first building with the Workshop.
