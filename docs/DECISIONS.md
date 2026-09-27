# Decisions

One line each: what was decided and why. Newest at the bottom of each section.

## M0
- Working title **Citybloom** (`GAME_TITLE` in `src/config.ts`): original, warm, no genre trademark.
- TypeScript 6.0 rather than 7.0: typescript-eslint supports TS < 6.1 only.
- @playwright/test pinned to 1.56.x to match the pre-installed Chromium 141 (build 1194) in the cloud VM.
- Compressed calendar: one day/night cycle is one calendar month (1440 one-minute ticks), so lighting, rush hours and the monthly budget share one clock and 20 game years stay playable.
- Speeds 1×/2×/3× = 8/16/24 ticks per second (a month takes 3 / 1.5 / 1 minute).
- Preact for the UI: tiny, JSX, hooks; panels like the budget and inspector would be painful in raw DOM.
- Buildings are chunk-merged rather than instanced, because procedural variety makes too many distinct models for instancing to pay off.
- Traffic is an aggregated assignment that also performs job/shop matching, so employment depends on the real road network.

## M1
- Roads are quadratic Béziers; free-form strokes are fitted with a chain of ~48 m quadratics.
- Roads drape over the terrain (no terrain flattening); max grade 12 % over 16 m, min curve radius 18 m, min junction angle 28°.
- Crossing an existing road splits both at the crossing; ending on a road makes a T-junction. Crossing the regional highway is not allowed.
- Water blocks roads until bridges arrive in M6.
- Zone cells are 8 m squares, 4 rows deep on both sides of every road; overlaps resolve by priority (occupied, then lower row, older road, lower column). Cells that become invalid lose their zoning.
- Zone painting only changes empty cells: existing buildings keep their cells until bulldozed, so a stray brush stroke never destroys a neighbourhood.
- A brush drag is one undo step (commands carry a stroke id and the sim merges them).
- Bulldozing a road refunds 25 %; undo refunds 100 % and re-merges roads it split. Undo covers placements only (spec).
- Removing a road removes its zone blocks; buildings on them are demolished (shown in the bulldoze preview from M2).
- Snapping (nodes, roads, 45° steps relative to world axes and existing roads, optional 8 m grid) happens on the client for responsiveness; the sim re-validates every command.
- Keyboard: T roads, Z/X/C/V zones (R/C/I/dezone), B bulldoze, H or Esc select, Tab road mode, G grid, [ ] brush size, Ctrl+Z or U undo. WASD/QE/RF/+− stay on the camera.
- Save format stays at version 1 until M2 introduces real save/load; from then on every format change bumps the version with a migration.

## M2
- Buildings are archetypes by zone × density × wealth × level (`src/data/buildings.ts`); density is set by the road type and population unlocks (medium at 800, high at 5,000), wealth by land value.
- If a bigger footprint doesn't fit when upgrading, the building rebuilds in place on its lot (capacity scales with lot area), so packed streets still upgrade.
- Employment and shopping come from one nearest-first matcher over the road graph (DESIGN §3.8), so jobs need a road connection. Residents from outside the city don't commute in (no regional commuters) to keep the loop readable.
- New residents aren't counted as unemployed until the next matching round (avoids a move-in/move-out flicker).
- Upgrades need mood ≥ 0.62, occupancy ≥ 88 % for 3 hours and positive demand for that zone. 0.62 is reachable before services exist; revisit once services add positive factors (M5/M12).
- High wealth can't move in until services exist (M5); M2 caps wealth at medium.
- Industry "wealth" is the industry tier (heavy, manufacturing, high-tech); M2 grows heavy industry only (education drives tiers in M7).
- Growth needs the lot's road to be connected to the highway; cut-off buildings gain distress twice as fast and are abandoned within about a day.
- Demolishing zoned buildings is free (no cost, no refund).
- Loading a save reloads the page into `?load=<slot>`; this keeps the renderer's setup path single and robust.
- Saves are gzip-compressed JSON in IndexedDB; exports use the same bytes with a `.citybloom` extension.

## M3
- Money is integer dollars. Hourly accruals carry their fractional remainder per ledger category, so `treasury = month-start treasury + Σ ledger lines` holds exactly every tick (checked in test mode).
- A month is one day/night cycle, so monthly rates accrue in 24 hourly steps; the budget closes at midnight and keeps 24 months of history.
- Loans are annuities paid hourly (interest first); up to 3 at once; early repayment settles the balance. Bigger loans unlock with population.
- Bankruptcy: the treasury may be negative for 48 hours (two months); then the city is bankrupt, the sim stops and every command is refused. Sandbox never goes bankrupt.
- Low-money warning when the monthly net is negative and the treasury covers less than three months of it.
- Tax changes affect demand (average rate per zone), spawn chance per wealth level, and each building's mood (weighted by wealth sensitivity).
- Department funding scales upkeep linearly; effectiveness follows `f ≤ 1 ? f : 1 + ½(f − 1)`. Road maintenance funding only scales cost until traffic (M6) uses it for road wear.
- Policies are listed under Money in the spec but built in M10 with progression; the ledger already has a `policies` line.
- Budget charts use two single-axis charts (treasury line, net-income bars in the diverging blue/red poles), never a dual axis.
- Save format v2 adds the economy; `migrations[1]` upgrades v1 saves with default taxes and funding (tested).

## M4
- Service vehicles move at a visual speed (0.2 m per tick per m/s of road speed), not at real speed in game time; incident timings are tuned in ticks to match (DESIGN §3.7).
- Civic buildings are placed beside a road, facing it, sliding along it with the cursor; the sim validates road frontage, water, slope, overlaps, unlocks and money. Zoned buildings in the way are demolished (shown in the preview).
- Utilities go to consumers in order of road distance from the nearest producer, per connected network; with too little capacity the far end goes dark first.
- Consumption follows capacity (not occupancy) so supply needs don't swing with move-ins.
- Businesses close after 12 hours without power or water and reopen when both return; homes don't close but their mood drops (-28 % each for power and water, -15 % for sewage), which leads to abandonment within about two days.
- A pump draws polluted water when ground pollution under it exceeds 0.25; its share of the network's water is "polluted" for every building on that network (sickness arrives in M7).
- Garbage accumulates per building; trucks go to the fullest buildings within reach and also empty neighbours within 48 m. Landfills fill up; recycling earns trade revenue; incinerators turn yesterday's burn into power.
- Bulldozing a civic building refunds 25 %; undo refunds 100 %.
- Data maps mute the scene and paint values with the reference data-viz ramps: diverging red–grey–blue for supply (bad→good), sequential blue for amounts. A legend names both ends.
- Problem icons are one Points draw call with a canvas-drawn atlas; one icon per building, most urgent first.

## M5
- Coverage is sampled every 24 m along each road (not only at junctions), so it fades smoothly along long streets; buildings read it at their frontage and the data maps tint the roads themselves.
- Service ranges are travel seconds at free-flow speed: a fire station fully covers ~300 m of street and fades out by ~600 m, so a mid-sized town needs several stations. Parks reach only a block or two.
- The coverage table is cached and dropped whenever roads, service buildings or funding change, keeping it a pure function of saved state (exact reloads mid-hour).
- Buildings without power or water (below half) now gain distress whatever their mood: services had made towns happy enough to shrug off a blackout, which isn't believable.
- In-place upgrades don't use up new-building construction slots; otherwise a happy town stopped spreading while it upgraded.
- Garbage trucks carry 90 units (was 60): one landfill now serves about 2,500 residents.
- Fire engines lower intensity by 0.012 per tick at the scene, so a fire caught early is out in about an hour; unanswered fires burn for ~16 hours before collapsing into rubble, which clears after 36 hours.
- Crimes and emergencies are incidents with a response window (7 h and 10 h); only unanswered ones raise the crime map or cost a life, so police and ambulances matter through response time.
- Health capacity (beds) is shown only once sickness exists (M7); in M5 clinics and hospitals provide coverage and ambulances.
- Wealth level 2 needs fire, police and health coverage ≥ 0.4 at the lot; wealthier homes weigh missing services 1.5× (low wealth 0.6×).
- The inspector lists up to three "would help" suggestions drawn from a building's worst mood factors.
- A debug/test `ignite` cheat starts a fire in a building; M9's disasters menu builds on it.
- Toasts move left of the inspector while it's open so they never cover it.
- Data maps are lit as midday whatever the clock, so they stay readable at night.

## M6
- Traffic volumes are part of the saved state (daily PCU per segment), updated every matcher round by successive averages with step 0.2: 0.35 flip-flopped between routes; 0.2 settles within a game day.
- The day is compressed: 25 % of a day's traffic falls in the rush hour, so small towns flow and towns of a few thousand jam at bottlenecks.
- BPR alone made a jammed 120 m link cost seconds; an oversaturated road also adds the average queue wait (up to 10 minutes × (1 − c/v)), which is what makes a bottleneck hurt.
- Coverage maps stay on free-flow times (stable, cacheable); real responses are slowed by traffic via the vehicles' congested speeds.
- Visible traffic is client-only and non-deterministic: it samples real sim trips but never feeds back. Trip samples aren't saved; after loading, cars reappear at the next assignment round (≤ 2 game hours).
- Freight imports and exports always succeed through a connected highway; goods shortages don't yet affect shops (possible M10 trade specialisation hook).
- Road upgrades cost the difference between the two road types (downgrades are free, no refund) and keep buildings by keeping cell indices; buildings are lost only where the new width leaves no room.
- Bridges need at least a street, span at most 360 m and need ~68 m of dry land at each end for ramps; roads can't meet on a bridge.
- Buses follow SimCity 2013: a depot plus stops, no hand-drawn lines. Each depot runs one loop through the stops it reaches first, visiting them nearest-first. Commuters choose by door-to-door time with a 300 s car-hassle allowance; shopping trips stay by car.
- Road unlocks (boulevards at 20k) are now enforced by the sim as well as the UI.

## M7
- The wind is a pure function of the seed and the tick (a prevailing direction with a seasonal wobble), so it needs no saved state and the renderer's smoke drifts the same way as the sim's pollution.
- Sickness is aggregated per home as a fractional count (no individual residents); deaths come off the population as whole residents, the fraction by chance.
- Hospital and clinic "beds" use the M5 capacity field; beds go to the nearest sick first, like school seats.
- Education is an average level per home rather than per-resident degrees; the shares at each level are read off the average. This keeps saves small and still lets schooling visibly move industry up the tiers.
- Industry retools to the tier the workforce supports without needing the usual upgrade conditions (2 % chance per building per hour): tiers track education, not mood.
- Trees and parks absorb air pollution; there's no tree-planting tool (SimCity 2013 had none either) — parks are the player's lever.
- Unprotected fires spread much less than in M5 (spread chance 0.06 → 0.02 per 30 ticks, collapse after 450 ticks instead of 700): the e2e screenshots showed whole streets burning in towns without a fire station.
- The air pollution map shows values ×2.5 so that the thin but harmful downwind plume (0.05–0.2) is visible.

## M8
- Advisors are pure queries over the sim state every 2 s rather than saved state: nothing to migrate, and they can never disagree with the data maps they point at.
- Only the first new urgent advice of a refresh pops up as a toast; the rest go straight to the notification log. The first e2e screenshot showed three red toasts about power, water and sewage at once.
- Resident thoughts are chosen by hashing building ids with the game hour, not with the sim RNG, so asking for them can't change the simulation.
- Street names live only on the client (derived from segment ids); a save doesn't need them and they come out the same on every load.
- Audio is not positional: at city scale the mix already follows the view, and panning individual sources would cost more than it adds.
- Pedestrians walk the sim's sampled short trips, but those trips are still counted as car trips on the roads; the walkers are a visible sample, not a separate travel mode. A walking mode share is a possible M12 refinement.
- Tilt-shift works on the finished frame (copy + two blur passes) instead of an EffectComposer chain, so the tone-mapped look and the custom shaders (sky, water, lamp pools, smoke) stay identical with it on or off. It's off by default.
- Player settings (volumes, mute, tilt-shift) live in localStorage, per device rather than per city; M11 adds the rest to the same record.
- Street-lamp light is faked with additive quads (with polygon offset so they survive at distance) rather than real lights, which would multiply the lighting cost per lamp.
- The variety pass adds about 45 % more triangles to a low-density home (93 → 139 on average) for gardens, trees and cars; mid and high density are almost unchanged, and those dominate big cities.

## M9
- Disasters are saved state, but their motion (tornado position, flood level, meteor fall) is a pure function of their parameters and the tick, so the client animates them smoothly and a save/load mid-disaster carries on identically.
- Floods set their peak from the local shoreline (1.8 m above the typical land near the water) rather than a fixed height: the maps' banks range from ~3 m to ~11 m, and a fixed level either did nothing or drowned everything.
- Closed roads leave the routing graph, but "linked to the highway" uses the network as built: otherwise a day's repairs marked whole streets as cut off, doubled their distress and emptied them.
- Disaster repairs take 6–24 h for roads and 8–24 h for civic buildings (the first draft had up to 72 h): longer outages pushed whole towns past the 48-hour abandonment threshold and they never recovered.
- Abandoned buildings nobody moves back into now crumble after four days. Without this, a town that lost its businesses in a disaster stayed scarred for good, since empty shops can't pass the reoccupy test with no customers around.
- Earthquake magnitudes are skewed towards the low end (5.6 + 1.8·u²): a magnitude-7 quake in the middle of a small town destroys about a third of it, which is right for a rare big one but too much as the average.
- A direct meteor hit destroys a civic building outright (the player rebuilds it); other disasters only knock civic buildings offline for repairs.
- The disasters menu works whether or not random disasters are on: the setting only stops them striking by themselves.
- Disaster collapses are their own event ('collapsed', logged but not toasted); the report when a disaster is over sums up the damage instead of a toast per building.

## M10
- Unlocks go by the highest population ever reached, not the current one: losing residents to a disaster or a bad budget shouldn't take away buildings the player has already used.
- Every unlock threshold sits exactly on a named milestone (nine, from Hamlet to Metropolis, never more than 2.5× apart), so each one arrives as a batch with a celebration instead of things trickling in unannounced. Existing thresholds moved to the nearest milestone (e.g. gas power 1,200 → 2,000, hospital 4,000 → 5,000, university 15,000 → 20,000).
- The unlock-all cheat opens up buildings, roads, policies and modules but not zone densities, which follow the city's own growth; sandbox mode unlocks both. Tests rely on the cheat to place services without changing how towns grow.
- Each policy has exactly one effect in one system, sized to be clearly measurable (−25 % to −50 %), so tests can check it and players can see it on the relevant data map or ledger line.
- Free buses have no fares to remove (the game never charged fares), so they act on the mode choice: the bus counts as five minutes quicker.
- Modules are added from the building's inspector, once each, and appear as a small annex in a back corner of the lot rather than extending the footprint, which would have to re-check roads and neighbours.
- Specialisation buildings are civic buildings with extra fields (tourism, resource, freight, research), so placement, funding, upkeep, damage, disasters and the inspector all work for them unchanged. Two new budget departments (Tourism; Trade and research) scale them.
- Visitors don't drive through the traffic model yet (they're counted, spend and shop); tourist traffic is a possible M12 addition.
- Landmarks are unique; hotels, mines, wells and freight terminals aren't (a second terminal adds half again, a third nothing).
- Achievements are checked in the sim (deterministic, saved with the city) and are off in sandbox mode.
- Growth all the way to 100,000 residents is exercised in M12's large-city benchmark; M10 checks the unlock table itself (every milestone unlocks something, nothing unlocks between them).

## M11
- Starting, loading or quitting a city reloads the page (with `?new=1&…` or `?load=<slot>`), instead of tearing down and rebuilding the worker, renderer and mirror in place: it's the simplest way to guarantee a clean slate every time. The URL is reset to `/` after boot so a browser reload lands on the main menu, not on a fresh copy of the city.
- The main menu is drawn over a real, paused map (the default seed) with the camera slowly circling, rather than a static picture, so the first thing a player sees is the game's own look.
- Continue opens the newest save of any kind (autosave, quick or named). Quitting to the menu autosaves first, so Continue always resumes exactly where the player left.
- Escape opens the pause menu only when there's nothing else for it to do (cancel a drag, leave a tool, deselect, close a panel), as in most PC games. Any menu over a city pauses it and restores the previous speed on close.
- Settings are per device (localStorage), not per city; the Random disasters switch in Settings changes both the city being played and the default for new ones.
- Graphics quality is three presets (pixel ratio, shadow map size, crowd sizes) rather than many sliders; shadows, draw distance and tilt-shift have their own switches. The shadow-map sizes top out at the size the game already used (2048), so "High" is unchanged.
- UI scale reuses the rem-based `--ui-scale` root font size the design tokens were built on, instead of CSS zoom.
- Difficulty changes starting money and upkeep only (×0.8 / ×1 / ×1.25): it makes the early budget easier or harder without changing how the city grows, which the balance work in M12 tunes.
- The new-game screen previews the map by sampling the sim's own terrain generator on the main thread (128² samples), so the preview always matches what gets built.
- The tutorial's steps check the city's state rather than counting clicks, so doing things out of order or reloading mid-tutorial works; its progress is kept in settings. Tips show once each and never during the tutorial.
- Autosave defaults to every 5 minutes of real time (not game time), into a single `auto` slot; manual saves are never overwritten without a confirm.
- A loaded or continued city opens paused (the player gets their bearings, and nothing happens behind a loading screen); a new city starts at normal speed, since nothing happens until the first road anyway.

## M12
- Balance is judged with `scripts/balance.ts`, which plays three scripted mayors headlessly for 20 years. The careful one is meant to play like a sensible person: it follows the advisors (matching on advisor and title, one fix per kind every two months, services in proportion to population), sites pumps on clean ground water, clears abandoned buildings or small homes when a service needs room, expands a district at a time and borrows only while the budget is positive, and cuts taxes when comfortably off.
- Septic tanks (new: $1,500, 120 sewage, placeable anywhere, taint the ground nearby) give a hamlet sewage without a kilometre of road to the river: water is 0.7–1.6 km from the highway on every preset, so the outflow alone was a wall rather than a trade-off.
- The tax base doubled (R 24/44/80, C 60/100/160, I 50/90/140 per month at 100 %): at the old rates a 700-resident town earned about $1,400 a month against about $2,200 for basic utilities and four services, so even careful play went broke. At 2× the careful city is tight for its first years and then grows steadily; 1.25× and 1.5× stalled for 5–8 years.
- Garbage trucks carry 400 units (was 90), landfills hold 150k (was 80k), recycling handles 1,600 a day (was 900) and incinerators 2,400 (was 1,400): with every truck always out and each stop filling a truck, collection couldn't keep up in any town past a few thousand residents, whatever the player built.
- Mature cities run a large surplus (tens of thousands a month at 15k residents). That's left in on purpose: lower taxes, landmarks, specialisations, the university and nuclear power are what it's for.
- The hourly systems now run on different minutes of the hour (utilities :00, coverage :06–07, health :12, garbage :18, pollution :24–25, matching :30–33, happiness :36, lifecycle :42, economy :48, land value :54) instead of all on the hour tick, so a 100k city's worst tick is its slowest system rather than their sum. Stored moods are therefore up to an hour old when read later in the hour, as the inspector shows.
- Commute matching is split over four ticks. A save finishes a round in progress first, so a loaded city carries on exactly like the one that was saved; the only side effect is that saving mid-round settles that round a tick or three early.
- Two tests measured noisy quantities against thresholds they only just cleared: the crime policy test now sums the hourly crime risk (as the fire-safety test does) instead of counting random crimes, and the bus test averages commutes over eight samples. The bus line's measured effect on commutes is 2.5–4 %, so its bar is now 1.5 % (the traffic cut on the jammed link, the main effect, keeps its 15 % bar).
- Render at 100k: rather than per-building LOD models, the draw-call budget is met by merging more per draw (buildings per 256 m chunk, civic buildings per 512 m chunk instead of one mesh each, roads and zone cells per 512 m) and by dropping shadows for far tree regions. Bigger chunks cost more to rebuild, so building chunks rebuild one per frame (screenshots flush them). Triangle count at the overview stays above the early 1.5M target; it's listed for the Mac check.
- Problem icons shrink (to 8 px) and fade (to 55 %) beyond ~1.5 km: at the whole-city view a big city's icons had buried the city; hotspots still show.
- The debug panel gained an "Unlock all" cheat, which the spec lists and only the command had.
- The main menu shows a pre-grown demo town rather than the bare map: a saved city (135 KB) made by the balance tool's careful player (`--demo`: disasters off, unused zoning cleared, 15:00 on the clock) and loaded like any save. It runs at normal speed so cars move and night falls, with notices silenced in menu mode. A save beats simulating a town at boot (seconds of work on every visit) and a hand-built layout (another thing to maintain); a unit test keeps it loadable as the save format moves on.
- A save that can't be read no longer hangs the page on "Loading": the worker answers `loadFailed` and the page opens a fresh map with a toast (and the menu falls back to the bare backdrop).
- The final playthrough is a Playwright spec (`npm run playthrough`, left out of the normal run like the soak): a first city through the real UI, from the main menu and tutorial to a two-year-old town, paid for from the city's own money, with screenshots at each stage. Only game time is fast-forwarded.
- Terrain generator version 2 (new cities): hills fade to about 4 m within ~450–1050 m of the highway entrance. The final playthrough found that on a third of random river seeds a plain avenue and four side streets off the highway were partly "Too steep"; now 400 of 400 sampled seeds across the presets take them. Terrain is regenerated from the seed on load, so cities keep the version they were founded with (`GameOptions.terrain`; saves from before, v9, migrate to 1 and keep their ground).
- A dragged road no longer chains: only click–click drawing keeps going from the last road's end. The playthrough showed that after dragging one road (as the tutorial says to), pressing to drag the next built a stray road from the old end to the new press point, and charged for it. A drag that can't be built starts over too, with the reason in a toast.
- A road drawn along the dead ends of several streets joins every end within 2.5 m of its centre line (T-junctions), not only the ones it crosses exactly: hand-drawn street ends land a metre or two off the line, and the playthrough's "close the grid" road was rejected as too close to them.
- Fixed (found by the playthrough): in a new city, finished buildings and civic buildings drew only their shadows. three.js keys shader programs on the `onBeforeCompile` source text, identical for the plain and the clipped (construction) building materials, so whichever compiled first served both; a player's first construction sites compile the clipped one, which discards everything above ground for meshes without its clip attribute. Each variant now has its own `customProgramCacheKey`. Test towns built through the API usually drew a civic building first, which hid it; M2 now reproduces the player's order and checks, by reading the canvas with each group hidden and shown, that buildings and civics are really drawn.
- M2 hashes the city after saving rather than before: saving settles a commute-matching round in progress, so the saved (and still running) city is the one to compare with the loaded one.
- The school test now checks primary places (`seat1`) directly, nearest quarter all seated and farthest mostly not, instead of blended education coverage against a 0.2 margin it had cleared by 0.01; the terrain change moved the town slightly and tipped it. The property is unchanged (coverage still falls with distance, asserted too).
- PROGRESS.md opens with the milestone checklist (CLAUDE.md) and puts the summary and ideas for what's next straight after it (SPEC §9 asks for them "at the top").


## Playtest fixes
- The civic inspector's red button was blank because a leftover M2 rule (`.btn.danger { color: negative }`, red text on the plain button) sat later in the stylesheet than M11's solid red danger button and won, so every danger button since M11 drew red text on red: both inspector bulldoze buttons and the load screen's "Delete". The old rule is gone.
- The bulldoze button now has the bulldozer icon and says what comes back ("Bulldoze (refund $1,250)", or "no refund" for a zoned building), and asks first: an inline confirmation names the building, repeats the refund and says it can't be undone, with "Keep it" focused. Inline rather than a modal dialog, matching the load screen's delete confirmation.
- `e2e/ui-labels.spec.ts` walks the interface (menus, every tool, panels and budget tabs, inspectors, debug panel, tip, tutorial, pause/save/load/settings) and fails if any visible button has no accessible name or shows text below 3:1 contrast against what's actually behind it (3:1 rather than 4.5:1 so muted secondary buttons pass while invisible ones can't; disabled buttons are exempt, as in WCAG). It checks each run of text against its own element (a badge on a button) and waits for colour transitions to finish, and it plants a nameless icon button and a red-on-red button first to prove it catches both.
- The audit also caught a hover bug: `.shell-btn:hover:not(:disabled)` outranked `.shell-btn.primary`, so hovering "New city" put its white label on the pale hover background. The primary hover rule now has the same specificity.
- Icons are `aria-hidden`: buttons carry their own text or aria-label.
- Garbage, measured first (`scripts/dev/garbage.ts` on the playtest save, Ashton: 1,331 residents, one landfill 317 m from the town's centre): the city made about 1,040 units a day and the trucks brought back 890–1,090, with 600 on the streets and 4–8 buildings showing piles. All four trucks were out 94 % of the time, on 7.2-hour trips (3.5 h driving each way over 411 m, 12 min loading, no traffic delay) carrying 80 of their 400. Moving the landfill to the middle of town halved the trips to 3.4 h and cleared the piles: the site's distance, not congestion, set the pace, because each truck made one stop per trip. That's also what separated the playtest from the balance tool, whose careful player dropped its landfill on a random road near the middle.
- Before the first landfill garbage piled up without a practical limit (1,000 per building): the planned test town reached 11,310 units at 66 buildings after ten days, and lost 15 % of its people.
- The cause fixed: trucks now work rounds, driving on from stop to stop until 85 % full (or 10 stops) before the long drive back, so one drive from the edge of town serves many stops. On Ashton with the same four trucks: 250 on the streets and no piles. Rounds rather than faster trucks, because vehicles move at their drawn speed, and teleporting or speeding them would break what the player sees.
- Piles stop growing at 120 per building (twice `bad`, where a pile already does all its harm), so a late landfill inherits a bounded debt: after ten days without one, 8,367 units instead of 11,310, cleared in two days.
- Extra trucks are a repeatable module (`max: 4`) bought in the garbage section of the inspector rather than the Modules list, next to the figures that call for them: $1,200 and +$45/month each (a landfill is $9,000 and $240/month), available from the start, scaled by garbage funding like the rest of the fleet. With the landfill 900 m out of town (sprawl), three extra trucks more than halve the piles the starting four leave; the balance tool's careful player buys its first at month 32, at about 8,000 residents.
- The inspector shows trucks out of total, collected yesterday against what the city makes a day, what's on the streets, and the last day's rounds (hours, stops, load), with a one-line verdict: keeping up, buy a truck, or (when rounds run over 8 hours) build a site closer. The garbage advice likewise says whether nobody collects yet, every truck is busy, or the streets are out of reach.
- The balance tool's careful player now puts landfills on the road farthest from where people live, as players do, and buys a truck for a landfill whose trucks are all out before building another. Over 20 years the greedy and neglectful runs are unchanged; the careful city ends at 22,200 residents and 69 % approval instead of 16,000 and 54 %, having no longer drowned in garbage once its landfills filled (79 % of buildings with garbage at year 20 before, 17 % after).
- SAVE_VERSION 11: vehicles note the tick they set out and their stops; older saves migrate.

## Phase 2 (SPEC-2.md)

### M13 Gentler roads
- Measured first (`scripts/dev/grades.ts`: 1,800 random straight streets, 60–300 m, on dry land, three seeds of each preset): the old rule (12 % over any 16 m of raw ground) refused 20.7 % of them as too steep, including 90 % of those whose steepest 50 m of ground was only 8–15 %. Now none are refused below 35 %, and 22 % of the 54 placements on 35 %+ ground are (0.7 % overall). A unit test repeats the sample (60 streets per preset) and fails if a too-steep refusal lands on ground under 35 %.
- Grade limits by type, near real practice for local and arterial roads: dirt 20 %, street 16 %, avenue 12 %, boulevard 8 % (the regional highway, not buildable, 6 %). They're measured on the graded profile, sampled every 4 m, not on the raw ground.
- The profile is fitted to keep the worst cut or fill as small as possible (fill weighted to 8/14 of cut, the two limits' ratio) and then to hug the smoothed ground wherever it can. An earlier draft clamped the smoothed ground with forward and backward sweeps; it piled all the error on the far end of a free road, so streets running downhill ended on tall embankments and were refused.
- A cutting deeper than 14 m is the only "too steep" on land (no tunnels). Fill taller than 8 m goes on a viaduct over dry ground, drawn and priced like a bridge, but not at a road's end, not for dirt roads, and no longer than a bridge may be. Roads can't join a viaduct mid-span yet (M19 brings grade separation); the planner says to meet it where it's back on the ground.
- Where a road is cut or filled, the level formation widens beyond the shoulder by 2 m per metre of cut or fill, up to 8 m (a bench). The terrain is 8 m height samples and the road is draped on them, so without it a road in a cutting climbed the cut face at its edges; the bench also gives the first lots a level site. A first version benched every road 8 m each side and charged for it: on gentle ground that was a median 16 % on top of a street, and the careful balance player, money-starved for its first three years, ended its 20 years at 15,190 residents instead of 22,200 (with earthworks free it tracked the old run exactly). Now a road at grade changes nothing beyond itself, and changes under 0.25 m aren't made or charged: earthworks are a median 0 % of a street's price on gentle ground and 73 % on ground of 15 % or more.
- Side slopes are 1:1 in cuttings and 1:3 on embankments. The first draft used 1:2 for both, and a cutting on a hillside steeper than 50 % never met the ground again. 1:3 fills keep lots across an embankment buildable (the cell slope check measures across the diagonal); 1:1 cuts are narrow, like real ones.
- Earthworks cost $0.40 per cubic metre moved: nothing extra on gentle ground, a median 73 % on top of a street where the ground is 15 % or steeper, a trade-off rather than a wall. Bulldozing refunds a quarter of the road but not its earthworks; undo refunds everything.
- Civic buildings on uneven ground (more than 1 m across the footprint) get a level pad at the height where they meet their road, at the same price per cubic metre; a site is too steep beyond 12 m (was 7 m, for plinths alone). Found by the garbage test: a landfill beside a new cutting was refused as too steep.
- Ground under buildings that stay is never moved; beside them the earthworks stop short, like a retaining wall. Everything else re-seats on the moved ground by the existing rule (highest ground under the corners and centre; plinths hide the rest), and zone cells on new cut faces lose their zoning like any too-steep cell.
- Trees go where the ground moved more than half a metre (the construction site), not just under the road.
- Terrain edits are saved as a full 257² Float32 delta rather than a sparse list: simplest to keep exact, gzip shrinks the zeros (about 10 KB in a six-year city, deltas being whole centimetres), and M24's terraforming reuses it. Heights are always computed as seed + delta, live and on load, so save/load and undo reproduce the ground bit for bit (an early version stored the target heights and drifted by a float ulp). SAVE_VERSION 12; older saves migrate to an all-zero delta and keep their ground.
- Upgrading a road regrades it for the new type between its two junctions (widening the formation too), or refuses with the reason; bridges and viaducts keep their decks and just check their climb.
- The road preview draws the ghost at the height the road will be built, seen through hills, coloured by how steeply it climbs against the limit (blue, amber near it, red where too steep, violet on a viaduct), with posts down or up to today's ground where it's filled or cut. The hint adds "climbs 12 % (max 16 %) · earthworks $X" and, when refused, how steep the ground is, the limit, how deep the cutting would be and what would fix it. Roads have no inspector, so the preview is where the "why" lives; road tooltips give each type's limit and a one-time tip explains earthworks the first time a preview needs a lot of them.
- The cursor hint used to run off the right edge of the screen (the too-steep explanations are long); it now wraps and moves to the other side of the cursor near an edge.
- Tests adjusted for earthworks, not weakened: road and upgrade prices are checked as the road plus the reported earthworks; the bankruptcy test sizes its avenues by preview; the landmark test tops up the treasury before placing two landmarks (roads now cost more); the far-landfill garbage test takes the cheapest road out of town (hilly routes that used to be refused are now buildable, at a price) and puts the landfill 1,100 m out, where the starting trucks clearly fall behind.
- Balance after M13 (20 years): careful 18,900 residents and 68 % approval (22,200 and 69 % before), greedy and neglectful unchanged. The careful run is path-dependent: on seeds `s1`, `s2` and `s3` the pre-M13 careful player reached 15,560, 1,050 and 700 residents by year 8 (on two of them its district roads were refused as too steep and it never grew past two districts), and now 16,900, 16,500 and 17,000. The benchmark grid builds 514 of its roads (464 before; 5 avenue links still fail, between junctions whose heights differ by more than 12 %, and 26 bridges lack land for their ramps), so its city is a little bigger (97–111k).
- The menu's demo town was regenerated for the new sim, from three years of the careful player (5,960 residents, 173 KB) rather than six: six years now makes a 15,000-resident city, heavier than the small town the menu is meant to show.

### M14 Controls and editing
- Undo is generic rather than written per command: each undoable command is bracketed by captures of what it can touch (roads, lots, buildings, civic buildings, vehicles, incidents, stops, traffic and damage entries, terrain deltas, trees, a few values such as the id counter and generators), and the difference, down to changed fields and array elements, is kept with the money booked and the order entries were in. Undo applies it backwards and redo forwards. Per-command reversal code (the old road, zoning, civic, stop and upgrade undos) covered only some cases and none exactly (undoing a road left a "refunds" line in the ledger, for one); the diff restores anything a command did, to the state hash, including bulldozed roads with their lots and buildings and civic buildings with their add-ons.
- Map iteration order is part of the city (systems visit entities in it), so edits record it where a command changed it and put it back; without that a restored building went to the end of the map and the hash differed.
- Time runs between an action and its undo. Structural state (roads, lots, which building stands where, the ground) must be as the action left it or the undo is refused with the reason ("Can't undo the road: buildings have grown or lots have changed there since"); everyday state (residents, happiness, vehicles, trees) is restored only where nothing has touched it since. Undoing zoning skips lots where a building has grown since, as before. Refusing beats quietly demolishing what the city built on top.
- Money is undone as a delta on the treasury and on the ledger lines it was booked to (the month's "roads" line goes back down), not as a refund line.
- History isn't saved (save v13 drops the old undo list): a loaded city starts with a clean slate, as in most games, and saves stay small; 30 steps (the brief's "~30"). A zoning drag stays one step.
- Capturing costs about 24 ms at 112k residents (2,200 buildings), so an undoable command takes ~55 ms there and a few ms in a town; zoning captures only lots (28 ms at 112k). Plain containers are fingerprinted with native JSON and lots as copies of their arrays, after the generic encoder took 200 ms.
- Moving costs 10 % of the building's price (at least $250) plus earthworks for its new pad; it follows the rules for a new building of that kind (except unlocks), keeps its id, add-ons and stock, and is undone like any action. Vehicles on their way back are re-routed to the new site; those still out find it when they turn for home.
- Trackpads: a pinch arrives in Chrome, Firefox and Edge as a wheel event with Ctrl held, and in Safari as gesture events; both zoom. A two-finger swipe (small, often fractional, two-axis wheel deltas) pans; with Option/Alt or Shift held it turns and tilts, and Safari's rotate gesture turns. A mouse wheel (line steps, or whole-pixel steps of 50+ straight up or down) zooms as before. Detection follows the last event, so switching devices just works; Settings → Pointing device can fix it either way for a device that's misread. Option/Alt rather than Cmd because Cmd-scroll is taken by the browser on some systems.
- Shortcuts follow the platform: ⌘ on macOS, Ctrl elsewhere, both accepted everywhere. Redo is ⇧⌘Z / Ctrl+Shift+Z, Ctrl+Y on Windows and Linux, and Shift+U beside the existing U for undo.
- The shortcut card opens with `?` and closes with Escape before anything else (a capture-phase listener), so Escape doesn't also cancel a tool or open the pause menu.
- The bulldoze confirmation no longer says it can't be undone; it names the undo shortcut.

### M15 Publish it
- The Pages workflow (`.github/workflows/deploy.yml`) runs the unit tests before building, so a push that breaks the sim doesn't go live; the e2e suite (SwiftShader, ~20 min) stays a local check. It takes the base path and site address from `actions/configure-pages`, so the same file works for a project site (`/Sim-Cities/`) or a custom domain.
- A hand-written service worker instead of a plugin (no new dependency, and every line is ours to test): the build writes `sw.js` with the list of files it produced and a hash of their contents as the version, so any change to any file is a new version and nothing is forgotten in the list. Source maps and the share image are left out of the offline copy.
- Cache first for everything, pages included: a player always runs one consistent version (index.html and the hashed scripts it names) until they choose to switch, and the game opens at once, with or without a network. New versions are looked for on every visit, hourly, and on returning to the tab.
- A new version waits ("New version of Citybloom · Reload", a notice that stays until dismissed) instead of taking over on its own, which could reload the page mid-city; Reload autosaves the city first, and the new page says it's up to date. Another tab that switched first makes this one offer the reload too.
- Saves survive updates because they never lived in the service worker's cache: slots are in IndexedDB and settings in localStorage, which a new version doesn't touch; save migrations cover format changes, as before.
- The e2e suite runs against a build made with `--mode test --base /Sim-Cities/`, the production build with one difference, the `window.__game` test API (a build without it can't be driven). A small Node server (`e2e/serve.mjs`) serves it from the subpath like Pages does and has two switches, deploy another build and drop every request, so the tests act out a deploy and a lost connection; the update test makes a real second build with another build id.
- The first-launch graphics check runs only on the main menu (where a first launch lands, over the demo town, a fair load) and only once: it skips 1.5 s of warm-up (shader compiles), times at least 2.5 s and 8 frames at the high preset, and picks high under 22 ms a frame, medium under 40 ms, low above; software renderers (SwiftShader, llvmpipe, Microsoft Basic Render Driver) go straight to low, and a dual-core machine gets medium at most, since the sim will need the other core. Time in a hidden tab doesn't count. Touching a graphics setting while it runs cancels it. Low also turns shadows off and draw distance to near.
- Dev and test pages opened with a seed or save (`?paused=1…`) don't run the check, and scripts that start at the menu (m11-shell, the playthrough, `bigshot`, `menushot`) mark it done so their screenshots and draw-call counts stay at the default graphics; m15-publish tests the check itself.
- The icon is a blossom rising over three buildings in the zone colours (homes green, shops blue, industry amber) on a road, drawn as an SVG and rendered to PNG sizes by `scripts/dev/icons.mjs`; the maskable version pulls the buildings into the safe circle.
- The share image is a real screenshot of a 12-year town from the careful balance player (the interface hidden, tilt-shift on, 17:40 light) with the game's name set over it, saved as a 190 KB JPEG (the PNG was 1 MB).
- Version 0.2.0 marks phase 2's first release; the menu shows it with the build (the commit on Pages).
