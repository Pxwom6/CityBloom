# PLAYTHROUGH-FIXES.md: fixes from a full playthrough

All three phases are complete, and SPEC.md, SPEC-2.md and SPEC-3.md still apply. This round fixes what a full playthrough turned up. It's a fix round, not a feature phase: make each fix as small as it can be while still doing the job properly. Where this brief is silent, make the call a thoughtful game designer would and log it in `docs/DECISIONS.md`.

**If you're reading this as a prompt:** save it verbatim as `PLAYTHROUGH-FIXES.md` at the repo root and commit it before anything else. Then:
- add a line to CLAUDE.md's opening paragraph saying the current brief is PLAYTHROUGH-FIXES.md;
- add a "Playthrough fixes" checklist (P1–P26) to PROGRESS.md, after the milestone list.

That way a fresh session can carry on from those files alone.

## The playthrough

Claude played one city through the real UI on the live site at build `5b261bd` (which is `main`). It played the city "Kestrel Bend" on the River Valley preset (seed `usnpp7`) at Standard difficulty, with disasters and elections on, from founding to 10,953 residents in April of Year 11. It used only the interface, with no test API and no scripts.

Its clicks came through an automated browser in a hidden pane, with coordinates scaled from screenshots. So they were less precise than a mouse, and the hidden pane slowed redraws and timers. The two items that may come from that are marked **check first**.

Causes marked *confirmed* were checked in the code (and, for P7, with a probe); the rest are leads. Line numbers are as of `5b261bd`.

## Where this runs

Cloud or local, following CLAUDE.md's notes for each.
- Work on a branch named `playthrough-fixes` (in a cloud session, your session's own branch).
- Finish with a pull request into `main` for the owner to merge. Never push to `main`.

## Rules for this round

- **Reproduce first.** Before fixing an item, reproduce it in a test that fails. Use a unit test for the sim, or a Playwright spec through the UI for anything a player does with the mouse or keyboard. Then fix it and watch the test pass.
  - Try to reproduce the *check first* items with Playwright's real mouse. If one doesn't reproduce, log that in DECISIONS and mark it "not reproduced" in PROGRESS.md.
- **Through the real UI.** Every fix a player can see ends with a check through the UI, the way a player meets it, with screenshots you actually looked at.
  - UI changes use the existing components and `tokens.css`, and keep the game's look.
- **No balance changes.** The playthrough's balance notes are parked for a later round:
  - money piles up after Year 2;
  - neglect has little bite;
  - zoned frontage leaves no room for civic buildings;
  - growth comes in bursts;
  - smog never goes away.

  The owner's direction for that round: Easy can stay as forgiving as it is now, and Normal and Hard should scale the pressure up. Don't retune anything in this round. If a fix happens to move the balance numbers, report before and after.
- **Sim changes.** Some fixes change what the sim does: P7, P8, P9's achievement, perhaps P1, P10 and P15 (c). For each one:
  - the same seed and commands must still replay identically;
  - the legacy corpus (`tests/legacy/`) must still load and play on;
  - if an existing test encoded the bug, change the test and say why in DECISIONS.

  After the last sim change, rerun `bench` and `balance` (careful, greedy and neglectful, 20 years) and log the numbers in PROGRESS.md beside the previous ones.
- **Saves.** New saved state (persistent street names in P10, say) bumps `SAVE_VERSION`, with a migration and a test that older saves load and play on, as in phase 2.
- **Performance.** No regressions in sim tick time or the frame budget that PROGRESS.md records.
- **Small commits.** One item per commit where possible. Start the message with `P<n>:` and push straight away. Tick the item in PROGRESS.md when its done criteria are met.

## Work order

1. **Roads:** P7, then P2, P1, P5 and P10. The grading bug in P7 may be what made P2's upgrade flatten a street.
2. **Input and layout:** P3, P4, P11, P6, P13, P14, P23 and P12.
3. **Economy, advice and labels:** P8, P9, P15, P25, P16, P17, P19, P20, P24, P22, P21, P18 and P26.

## The issues

**P1 Road ends that miss are silent (High, roads).**
- *What happened:* three times in one city, a road end meant to join an existing road landed short of it. The target was a dead end, a corner or the middle of a street. The ghost was blue, there was no snap ring, and nothing warned. Whole districts were cut off from the highway:
  - their zones never grew, while residential demand sat at +82 to +100 for months;
  - a $10k school and an $18k recycling centre on them did nothing.

  The only way to find out was to click the road. The street inspector said "Start (south): dead end" and "0 cars a day". The links that fixed the three islands were 21–31 m long.
- *Cause (confirmed):*
  - **Snapping is client-side only.** `snapPoint` (`src/tools/snap.ts`) takes a node within 10 m, then a road's centre line within 8 m, both scaled up by camera distance ÷ 500.
  - **The sim joins an end only within 1 m.** See `resolveAnchor` (`src/sim/world/roadPlanner.ts:94`) and `ROAD_RULES.nodeTolerance`/`segmentTolerance`. Anything further away becomes a free node.
  - **A miss is either refused or built.** A free end closer than 14 m to a street's centre line is refused with "Too close to another road" (`roadPlanner.ts:602–631`). A little further out it builds as a valid, unconnected end.
  - **The sim knows about islands but never says so.** It already tracks which roads reach the highway (`Sim.isSegmentConnected`, `src/sim/sim.ts:822`). Growth and happiness use it, and so does the building inspector's "No road link to the highway". But the advisor's "No road to the highway" (`src/sim/systems/advisors.ts:388`) only fires when no block at all is connected, and nothing ever shows an island.
- *Fix:*
  - **While drawing:** if neither end nor any crossing joins an existing road, say so in the hint ("Doesn't join any road") and tint the ghost. If the road joins only roads that can't reach the highway, say "Not connected to the highway". Still allow it, because players build ahead.
  - **Near misses:** an end within about 20 m of a road it could join, with nothing else close, snaps to that road. Tune the radius so it doesn't grab roads a player meant to keep clear of, and log the value. Make the snap ring easier to see.
  - **After building:**
    - roads that can't reach the highway get a problem icon and show red on the traffic map;
    - the street inspector says "Not connected to the highway";
    - the advisor names the island, e.g. "Ivy Row and 2 more streets can't reach the highway", with Show me, even when other blocks are connected.
- *Done when:*
  - tests draw roads ending 3, 10 and 18 m from a road's dead end, corner and middle, and each one joins or is refused with a clear reason;
  - an e2e draws an island and sees the hint, the icon, the inspector line and the advisor, then joins the island up and sees them all go.

**P2 Building and upgrading roads remove buildings without saying so (High, roads).**
- *What happened:* Cedar Street was a street lined with industry. Upgrading it to an avenue showed only "$20,322 · earthworks $17,080" in the hint, then removed every building along it. Income fell from $21k to $11k a month. Undo brought it all back.
- *Cause (confirmed):*
  - **The preview counts nothing.** `upgradeRoad` (`src/sim/actions/roads.ts:110–176`) reports length and earthworks but no buildings.
  - **Buildings go implicitly, in four steps:**
    1. `setSegmentType` re-indexes the lots at the new width.
    2. The earthworks run.
    3. `relocateBuildingsOn` moves the buildings.
    4. `revalidate` (`src/sim/world/network.ts:694–740`) drops lots that now overlap or are too steep, and their buildings with them.
  - **P7 may be behind it.** $17k of earthworks on an ordinary street points to P7: `regrade` pins both ends, which would cut the whole street down so the lots fail the slope check.
  - **Plain roads have the same gap.** The road tool computes `demolish` for a new road (`roads.ts:43`, `buildingsInTheWay`), but its hint never shows it (`src/tools/roadTool.ts:415–425`). Only roundabouts and civic buildings say "replaces N buildings".
- *Fix:* fix P7 first and check again. Then:
  - the upgrade preview counts the buildings it would remove (a dry run of the same steps) and highlights them;
  - the plain road hint shows its count too;
  - when the count is above zero, the click asks first with an inline confirmation, as bulldozing does;
  - buildings that can stay, moved back on their lots, stay.
- *Done when:*
  - a test upgrades a built-up street, and the preview's count equals what the upgrade removes;
  - an e2e sees the count, cancels with nothing lost, then confirms.

**P3 A drag with a tool out builds (High, input).**
- *What happened:*
  - With the road tool out, a left-drag meant to pan built a $5,251 road in a field.
  - With the wind turbine tool out, a left-drag placed the turbine where the drag started, among homes (its ghost said "replaces 3 buildings").
  - Undo fixed both.
  - The tool panels cover the bottom of the map, so reaching the ground behind them meant Escape, pan, then picking the tool again.
- *Cause (confirmed):*
  - With any tool except Select, a left-drag never pans (`src/tools/manager.ts:79`, `usesLeftDrag`).
  - Place and stop tools build on pointerdown (`src/tools/placeTool.ts:250–278`, `stopTool.ts:58–70`).
  - The road tool builds on pointerup after the pointer moves more than 8 px (`roadTool.ts:691–695`). That's by design: its hint says "Click or drag to draw".
  - Middle-drag, WASD and arrow keys, and a trackpad swipe already pan with a tool out (`src/render/camera.ts`).
  - The shortcut card lists Drag, WASD, arrows and a two-finger swipe for Pan, but not middle-drag (`src/ui/ShortcutSheet.tsx:14`). Nothing says that a left-drag builds rather than pans while a tool is out.
- *Fix:*
  - Place and stop tools place on a click (pointerup without moving more than a few pixels); a left-drag with them pans.
  - Keep the road tool's drag-to-draw, because the tutorial teaches it. Instead, the tool hint says how to pan with a tool out (middle-drag, WASD, a trackpad swipe), and the shortcut card adds middle-drag.
  - Consider the same for the zoning and bulldoze tools.
- *Done when:*
  - an e2e, with each place tool out, left-drags across the map: the camera moves, nothing is built and the treasury is unchanged;
  - a click still places;
  - `e2e/m1-roads.spec.ts:31–41` (a left-drag builds a street) still passes.

**P4 A category click arms its first tool (Medium, input).**
- *What happened:* clicking the Water category armed the groundwater pump at once, while the sub-panel slid in. A quick click on the map built a $5k pump.
- *Cause (confirmed):* `src/ui/Toolbar.tsx:559–569` sets the category's first building and calls `tools.use('place')`. The sub-panel only renders while the place or stop tool is active (`:346`).
- *Fix:* opening a category shows its buildings without arming any; the player picks one. If you judge arming the first worth keeping, instead ignore map clicks until the sub-panel has finished opening, and log why. Update `placeFromToolbar` in `e2e/ui.ts`.
- *Done when:* an e2e opens each category and clicks the map at once, and nothing is built.

**P5 Roundabouts are refused near bends (Medium, roads).**
- *What happened:* two junctions were jammed, one at 122 % of capacity. At both, the road tool and the inspector's Roundabout button said "Too close to the next junction for a roundabout this size".
  - There's no smaller size, and `[` and `]` don't change it.
  - Nothing shows which junction is in the way.
  - At one junction, the nearest node was a plain bend 46 m away.
- *Cause (confirmed):*
  - `placeRoundabout` (`src/sim/actions/roads.ts:425–528`) treats every segment at the node as an arm at its full length (`:457`). So a bend or a dead end counts as "the next junction".
  - It fails if any arm is shorter than r + 20 m (`:472–477`).
  - Dragging more than 8 m sets r to the drag distance, and a click more than 14 m from the node puts the ring mid-road (`roadTool.ts:199–205, 606–615`).
  - `[` and `]` do nothing in the road tool.
- *Fix:*
  - Measure arms to the next real junction, through bends, and let the ring absorb a bend inside it.
  - When the default size doesn't fit, try smaller ones, down to a mini roundabout, before refusing.
  - Make `[` and `]` step the size.
  - When refusing, highlight the arm that's too short and say how much room is missing.
  - Watch out: `network.ts:671–682` and the ring rendering assume the ring sits within each arm's first segment, and `node.roundabout` is saved.
- *Done when:*
  - tests: a crossroads with a bend 46 m along one arm takes a roundabout, a cramped one gets a smaller ring, and a refusal names the short arm;
  - `tests/junctions.test.ts` and `tests/scenarios/crossroads.test.ts` still pass.

**P6 Narrow windows lose the toolbar and top bar (Medium, layout).**
- *What happened:*
  - At 824 px wide, the bottom toolbar is about 1,131 px, centred. Roads, Zoning, Undo and Redo are off screen, and the top bar loses the treasury and Menu. An iPad in portrait (820 px) would hit this.
  - At 1,024 px, once the advisor badge shows, the top bar clips the city name from the left ("estrel Bend") and cuts off half of Menu.
- *Cause (confirmed):*
  - `.toolbar` (`src/ui/styles/main.css:235–242`) has no wrapping, no overflow handling and no width-class rules.
  - `.topbar` (`:104–117, 1317–1336`) is centred, never wraps and has no max width.
  - Playwright only runs at 1280×800.
- *Fix:* every control is reachable from 768 px wide up.
  - The toolbar wraps to two rows or scrolls; pick one and log why.
  - The top bar condenses rather than clipping: the city name truncates with an ellipsis on the right, and lower-priority items fold into a menu.
- *Done when:* an e2e at 820×1180, 1024×768 and 1280×800 checks that every toolbar and top-bar button is inside the viewport and is what `elementFromPoint` finds at its centre, and screenshots at each size look right.

**P7 Some roads are planned at height 0 (High, roads).**
- *What happened:*
  - The same 54 m street cost $5,334 drawn one way (earthworks $4,794, orange posts in the ghost) and $540 drawn the other.
  - Joining two dead ends on flat ground cost $12–16k, with the ghost sunk into the ground, while a dead end to open ground cost about $511.
- *Cause (confirmed with a probe):* `gradeProfile` (`src/sim/world/grading.ts:61`) stores sample positions in a `Float32Array`. Sometimes `fround(L)` rounds above the curve length L, and then:
  1. the far end's pinned band is empty at the last sample (`bandLo > bandHi`, `:129–139`);
  2. `fitProfile` rejects every candidate (`:284`);
  3. `fit` never writes its output;
  4. so the profile stays all zeros, and the road is planned at height 0.

  The probe pinned both ends (as when a road joins roads at both ends), on flat ground, for lengths from 40 to 120 m:

  | Ground height | Lengths planned at height 0 |
  |---|---|
  | 3 m | 82 of 217 |
  | 10 m | 16 of 217, each also refused with the false reason "No room to pass under the viaduct here" |
  | 20 m and above | none |

  At 20 m and above, float32 rounding of the band itself hides the gap. That's why this bit near the river. Direction matters only through tiny differences in the computed length. The same profile drives `regrade` for upgrades (`src/sim/actions/roads.ts:218`).
- *Fix:* keep sample positions and bands in float64, or clamp the last sample to L with a small tolerance at pinned ends. Make `fit` fail loudly rather than return zeros when it finds no profile.
- *Done when:* a test sweeps lengths (40–120 m in small steps) and ground heights from 0 to 40 m, with both ends pinned, in both directions:
  - every profile meets its pins;
  - earthworks on flat ground are near zero;
  - the two directions match.

  Old saves keep the earthworks they already made (they're terrain deltas), so no migration is needed.

**P8 Bought power is resold at a loss (Medium, region).**
- *What happened:* after signing a deal to buy 395 MW from Calgate at $3, the deals selling power to Oakley and Quar Spa rose from 547 to 712 MW, at $2.
- *Cause (confirmed):*
  - Bought power is added as a producer at the highway node (`src/sim/systems/utilities.ts:93–95`).
  - Whatever that network has left over is offered for sale (`:146`, `regionExport` in `src/sim/systems/region.ts:132–148`).
  - Imports always deliver, and charge, the full contract (`region.ts:115–125, 211–220`).
- *Fix:* sell only the city's own surplus: spare = max(0, left − bought).
- *Done when:* a test with surplus power signs a buy deal and the amount sold doesn't change, and the existing buy and sell tests in `tests/region.test.ts` still pass.

**P9 The tutorial's "Lay a road" and the "Breaking ground" achievement tick before any road exists (Medium, tutorial).**
- *What happened:* step 2 ticked itself off right after the camera step. "Breaking ground" ("Build your first road off the highway") was awarded at 07:48 on the first day.
- *Cause (confirmed):* new cities start with the highway and the regional railway's `mainline` segment (`src/sim/sim.ts:367–368, 432–446`).
  - The step checks `segments.some(s => s.type !== 'highway')` (`src/client/tutorial.ts:45`).
  - The achievement checks `segments.size > 1` (`src/sim/systems/progress.ts:11`), at minute 48 of every hour.
- *Fix:* both count only roads the player builds: not `highway`, and not rail (`isRail` in `src/data/roads.ts:219`).
- *Done when:* a test on a new city finds neither done until a street is drawn, and the tutorial e2e passes step by step.

**P10 Street names change and repeat (Low, roads).**
- *What happened:*
  - Splitting a street renames half of it. Cutting into Fern Terrace renamed its southern half "Fern Way", a name already used elsewhere. Part of Copper Way became Orchid Street, and Station Way's north half became Spring Street.
  - A straight extension of Quarry Road got a new name.
  - Stems repeat: two Spring Streets plus a Spring Terrace; Foundry Street, Road and Row; Fern Way, Street and Terrace.
- *Cause (confirmed):*
  - Names are computed from scratch on the client at every network change (`src/client/names.ts:117–192`).
  - Each name is a hash of the street's lowest segment id, from 60 stems and 6 suffixes, with no duplicate check.
  - Splitting gives the pieces new ids (`network.ts:410–470`), so the name changes when the lowest id goes.
  - A road ending on a node can take over the straight-on pairing, which renames the street it joins.
- *Fix:* a street keeps its name when it's split or extended straight on, and new names avoid stems already in use until they run out.
  - That probably means keeping names in the sim: a name per street, carried through splits and joins, and through undo.
  - That's a save version bump, with a migration that names existing streets as they're named today, so loaded cities keep their names.
- *Done when:*
  - tests split a street, extend it straight, join two streets and undo each, and the names stay as a player would expect;
  - a city of 60 streets has no duplicate names and few repeated stems.

**P11 Escape doesn't always leave the road tool (Low, input).**
- *What happened:* after a chain of roads, Escape sometimes needed three presses to leave the tool, and the third opened the pause menu.
- *Cause (likely):* the order is right. In `src/tools/manager.ts:139–166` an Escape first cancels in the tool, then leaves the tool, then closes a panel, then opens the pause menu. But:
  - `commit()` waits for the sim's reply, then always sets `start` again and redraws (`roadTool.ts:533–548`);
  - preview replies redraw the ghost and hint without checking the tool is still active (`:216–225`).

  So an Escape before a reply arrives can bring the chain back, or leave the hint on screen after the tool has gone, and the next press pauses.
- *Fix:* ignore replies that arrive after the tool was cancelled or left. Each Escape press does one visible thing, in this order: end the chain, leave the tool, close a panel, open the menu.
- *Done when:* an e2e builds a chain, presses Escape straight after the last click (before the reply), and the tool state follows that order exactly.

**P12 Bus stops are refused on the road (Low, transit, check first).**
- *What happened:* five of eight clicks on roads were refused with "Bus stops go beside a road".
- *Cause unclear:* the sim takes the nearest local road within 14 m of the click's ground point (`src/sim/systems/transit.ts:63–85`), so a click on a street should pass. The playthrough's imprecise clicks may explain it. Leads:
  - the cursor's ground point comes from a ray against the terrain only (`src/render/camera.ts:143–172`), so on a raised road it lands behind the road;
  - highways, ramps and motorways take no stops.
- *Fix:* reproduce with Playwright's mouse on a street, an avenue, a bridge and a road on an embankment. If it reproduces, snap the stop to the nearest side of the road; if not, log it and move on.

**P13 Tooltips run off the screen (Low, layout).**
- *What happened:* at 1024×768, the Roads button's tooltip runs off the left edge, and the tooltips for Upgrade, One-way and Roundabout run off the right.
- *Cause (confirmed):* `Tip` (`src/ui/Toolbar.tsx:72–90`) never measures itself. `ToolHintLabel` (`:672–701`) already keeps itself on screen and shows the way.
- *Done when:* an e2e hovers every toolbar and tool-panel button at 1024×768 and at 820 px wide, and every tooltip is inside the viewport.

**P14 The citizen-thought feed covers the data-map menu (Low, layout).**
- *What happened:* the thought cards at the bottom left cover the data-map menu's lower items (Water, Sewage, Health care, Education) and take its clicks. A click meant for the menu opened a house instead, and a drag that starts on a card doesn't pan.
- *Cause (confirmed):*
  - `src/ui/Thoughts.tsx:26–27` hides the feed for open panels, tools and data maps, but not while the data-map menu is open (`mapsOpen` is local state in `Toolbar.tsx:177`).
  - `.thoughts` sits at z-index 20, above the toolbar's 10.
- *Fix:* hide or move the feed while the data-map menu is open, and let a drag that starts on it pan the map.
- *Done when:* an e2e with thoughts showing opens the data-map menu and clicks every item.

**P15 Tips and thoughts contradict the numbers (Low, advice).**
- *(a) Money tip.*
  - *What happened:* "The city spends more than it earns" appeared while the top bar showed +$26,018 a month.
  - *Cause:* a tip is chosen once, when its condition holds (`src/game.ts:959–965`). It's shown later, once panels close (`src/ui/Guide.tsx:55`), without checking again.
  - *Fix:* check the condition again when showing a tip, and drop it if it no longer holds.
- *(b) Commute tip.*
  - *What happened:* "Commutes are getting long" fired while the transport advisor said the average commute was 1 minute.
  - *Cause (confirmed):* the tip checks `avgCommute > 28` (`src/client/tutorial.ts:141–146`), but `avgCommute` is in seconds (`Sim.avgCommute`, `src/sim/sim.ts:1680`). The advisor uses 20 minutes (`advisors.ts:500–515`).
  - *Fix:* use the advisor's threshold.
- *(c) Sewage thoughts.*
  - *What happened:* residents thought "The drains are backing up" and "Who do we call about the sewers?" while the utilities advisor said "All supplied".
  - *Cause:* the two use different thresholds.
    - Any building below full sewage gets the "Sewage backing up" mood factor (`src/sim/systems/happiness.ts:33`). Thoughts speak about factors from 0.02 up (`src/sim/systems/thoughts.ts:42, 114`), which is anything below about 87 % served.
    - The advisor only counts buildings below 50 % (`advisors.ts:162, 207–213`).
  - *Fix:* use one threshold for both, or have the advisor say "mostly supplied: N buildings short". Changing happiness is a sim change (see the rules).
- *Done when:* a unit test per trigger checks it against the advisor's figure.

**P16 Dates read backwards around New Year (Low, UI).**
- *What happened:* the year turns on the founding anniversary (March).
  - Lists read "Dec, Year 1", "Jan, Year 1", "Feb, Year 1", "Mar, Year 2".
  - The save list put "Feb, Year 10" (newer) above "Jul, Year 10".
- *Cause (confirmed):* `src/sim/time.ts:54, 64–66` works out the year as floor(months ÷ 12) + 1, counted from a March start. Nothing in the sim reads the year number itself:
  - elections fall every 48 months;
  - scenario limits count months;
  - the chronicle counts months.
- *Fix:* show calendar years. Year 1 runs from the founding month to December, and Year 2 starts in January. This is display only. Update every formatter:
  - `time.ts` (`monthLabel`, `formatDate`, `formatMonth`);
  - `src/ui/History.tsx:99–102`;
  - `src/ui/Budget.tsx:19–21`;
  - wherever elections are shown.

  Then update `tests/core.test.ts:74–83` (it asserts that Year 1 runs March to February), DESIGN.md and `e2e/m16-photo-history.spec.ts`.
- *Done when:*
  - a test formats months across several New Years and the labels sort in time order;
  - the top bar, notifications, saves, history and elections all agree.

**P17 Tax bands nobody pays (Low, budget).**
- *What happened:* in Year 1 the heavy industry tax went up to 11 %. All the city's industry was manufacturing, so it raised nothing, and nothing said so.
- *Cause (confirmed):* the tax tab (`src/ui/Budget.tsx:138–187`) lists every band the same way, though per-band revenue is already in the projection (`:154`).
- *Fix:* show each band's revenue in the tax tab, or "no one pays this yet", greyed out.
- *Leave for the balance round:* an empty band still counts against demand.
  - The demand bar's "Industrial taxes" factor averages all three bands (`avgTax`, `src/sim/sim.ts:664`; `demand.ts:33, 85`), so raising an empty band still pulls the bar down.
  - Growth takes the average back out and applies each band's own rate (`growth.ts:105–106`).
  - "Taxes are high" checks every band (`advisors.ts:113`).

  Note this in DECISIONS for that round, and don't change it now.
- *Done when:* an e2e on a new city sees the empty bands marked.

**P18 Purchases made while paused (Low, UI, check first).**
- *What happened:* three "Buy a truck" clicks while paused showed "1 of 4 bought" and one charge until the game was unpaused. Then all three had gone through.
- *Cause unclear:* commands run at once at any speed (`simClient.ts:86–88` → `worker.ts:94–99`), and the inspector polls the count every 700 ms (`src/ui/Inspector.tsx:637–650`). The playthrough's hidden pane slowed timers, which probably explains it.
- *Fix:* check in a visible window. If the count lags, show the purchase straight away and disable the button while it's pending; otherwise log it.

**P19 Two road-maintenance lines in the budget (Low, budget).**
- *Cause (confirmed):* the budget has two lines with nearly the same name (`src/data/economy.ts:29, 119, 134–141`):
  - "Road maintenance" is the road network's upkeep (`roadUpkeep`);
  - "Road maintenance upkeep" is the public works depots' department upkeep (`upkeep:roads`).
- *Fix:* label the second one "Public works depots". That's display only; merging the keys would change the ledger.

**P20 The Region panel doesn't show supply and demand (Low, region).**
- *What happened:* nothing tells you how much water or power to buy. The water deal sat at 500 units after two new pumps were built, and by the end it was at the 1,289 maximum with no way to tell whether that was needed.
- *Where:*
  - The panel is `src/ui/Region.tsx:157–205`, and it already reads `world.stats`.
  - In `stats.utilities` (`utilities.ts:68–152`), supply includes imports and demand includes exports. So what the city makes = supply − bought, and what it uses = demand − sold.
  - The deals are in `stats.region.deals`.
  - Garbage has no city-wide figure yet, only the facility inspector's `garbageDetails` (`sim.ts:2199–2234`).
- *Fix:*
  - For power, water and garbage, add a line "You make X, use Y" with the shortfall or surplus. For power, add the advisor's winter forecast too.
  - Each deal row says how much it actually delivered last month.
- *Also, the winter forecast* (`advisors.ts:595–609`) has three faults; fix them if it's simple, and give the forecast a test (it has none):
  - it scales exports by heating;
  - it uses the homes' heating factor for every zone, though shops and industry have their own in `weather.ts:258`;
  - it ignores the industrial neighbour's winter cut (`region.ts:104–105`).
- *Done when:* tests check the figures, and a screenshot shows the panel in a city with deals.

**P21 City limits are invisible (Low, map).**
- *Cause (confirmed):* the terrain shader does draw the limit (`src/render/terrain.ts:146–154`). The ground outside is greyed by 22 %, with a cream line 0.8–2.5 m wide. Because the line's width is in metres, it's under a pixel at normal zoom.
- *Fix:* draw the line a few pixels wide at any zoom, and stronger while a road or building tool is out.
- *Done when:* screenshots at whole-city and city zoom show the limit.

**P22 The save toast names the city, not the slot (Low, saves).**
- *Cause (confirmed):* `src/game.ts:679` builds the toast from `s.meta.cityName`. Quick save (`src/ui/Shell.tsx:405`) has the same problem.
- *Fix:* name the slot.
- *Done when:* `e2e/m11-shell.spec.ts` checks for the slot's name.

**P23 Clickable toasts can't be clicked (Low, UI, found by reading the code).**
- *Cause:* `.toast.clickable` (`src/ui/styles/main.css:1925`) sets `cursor: pointer` but not `pointer-events: auto`. It inherits `pointer-events: none` from `#ui` (`:31–35`), so a toast's "Show me" click (`src/ui/SystemMenu.tsx:26–44`) never fires.
- *Done when:* an e2e clicks a toast that has a place, and the camera flies there.

**P24 Loan terms appear only after borrowing (Low, budget).**
- *What happened:* the $25k loan's monthly payment ($472 for 60 months at 5 %) showed only on the loan card afterwards.
- *Cause (confirmed):* the loan buttons (`src/ui/Budget.tsx:252–281`) show the amount and rate, and one click borrows. `takeLoan` has a dry run that returns the payment.
- *Fix:* show the monthly payment and total cost on the button, or add a one-step confirmation. If the click changes, update `e2e/m3-money.spec.ts`, `finale.spec.ts` and `playthrough.spec.ts`.

**P25 "No school nearby" beside a primary school (Low, inspector).**
- *What happened:* a block of apartments a street away from a primary school showed "Schooling: Primary school", and its mood list said "No school nearby −2 %".
- *Cause (confirmed):*
  - "Schooling" is the residents' average education (`src/ui/Inspector.tsx:1147`), not whether a school is in reach.
  - The mood label shows whenever education coverage is below 0.5 (`src/sim/systems/happiness.ts:44–53`).
  - Coverage is places got ÷ places wanted across all three school levels (`src/sim/systems/services.ts:192–198`), so a home with only primary places nearby tops out around 0.5.
- *Fix:* say what's actually missing ("No high school places", "Schools are full"), and rename "Schooling" to "Education" or similar. Change the labels only; leave the coverage maths for the balance round.

**P26 Notification groups have no headings (Low, if quick).**
- The notifications list is grouped bad, neutral, good, newest first within each group. A small heading per group would make that obvious.

## When everything's done

1. Run the full check (`npm run typecheck && npm run lint && npm test && npm run e2e`) and the playthrough specs.
2. Play a short city through the UI that touches every fixed area, with screenshots you looked at.
3. Update DESIGN.md and CLAUDE.md's project notes wherever behaviour changed.
4. Add a "Playthrough fixes" section to `docs/DECISIONS.md`.
5. Open the pull request into `main` with a table: each item, what changed, the test that covers it, and anything not reproduced or left for later.
