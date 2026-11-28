# M42 Learning to play: the plan

SPEC-6.md M42. A guided first city to about 1,000 residents, short lessons on small prepared towns, a
first-time card in a friend's room, and earlier, plainer warnings before homes empty or a town without
services shrinks.

## 1. The first-city tutorial (`src/client/tutorial.ts`)

Today: eight steps, the last "keep the city happy". The step model grows:

- `pause?: true`: the game holds still while the step is read (the speed before it comes back when the
  step is done or "Next" is pressed). Only steps that teach something in a panel or on a map pause; a
  step that asks the player to build leaves time alone (the player may need the city running).
- `camera?(g)`: a pose to fly to when the step starts (the highway's end, the town's middle, the fire).
- `target`: the button to point at (existing), plus `panelTarget` for a control inside a panel (the
  tax slider, a data-map button), and `panel` naming a panel the card stays visible beside (today the
  card hides while any panel is open).
- `when?(g)`: an interrupting lesson (the first problem): it doesn't wait its turn; when its moment
  comes it is shown next, then the tutorial carries on where it was. Kept in `TUTORIAL_EVENTS`, each
  shown once.
- `done?(g)` (existing): steps already done finish themselves, so a player who knows what to do
  isn't held up, and a resumed tutorial skips what's built.

Steps (about 18), short sentences:
1. Welcome (camera at the highway's end): moving the view.
2. Lay a road from the highway.
3. Zone homes.
4. Jobs: shops and industry.
5. Power.
6. Water and sewage.
7. Let time run (population ≥ 40).
8. Demand bars (pause; point at the RCI bars): what R, C and I mean; done on Next.
9. Grow to 150: zone more where the bars ask.
10. The budget (pause; open the budget, M): income, costs, the tax sliders; done once opened.
11. Taxes (with the budget open): what a point does; Next.
12. First services: a fire station, then a clinic or a police station (done when both built), with
    the coverage map shown (point at the data maps button; done once a coverage map has been opened).
13. Advisors (J): open them; done once opened.
14. Grow to 500.
15. Save your city (point at the pause menu's Save or Ctrl+S; done when a save is made).
16. Grow to 1,000 (keeping an eye on the advisors).
17. Done: what next (scenarios, Learn, friends).

Interrupting lessons (`TUTORIAL_EVENTS`), each once, any time after step 7:
- A fire: the camera flies to it; fire stations put fires out; one nearby saves the street.
- A power cut (demand over supply, or homes without power): a bigger plant or a second one; homes
  without power for two days start to empty.
- A traffic jam (a road over capacity in the busy hours): a second road out, avenues, buses.

Leaving and coming back: "Leave tutorial" keeps the step (`tutorialStep` stays, `tutorialHidden`
true); Settings → Game and the pause menu offer "Continue the tutorial" while one is under way; "Skip
this step" on every step; "Skip tutorial" ends it.

## 2. Learn (main menu)

A screen of lessons, each two to four minutes on a small prepared town shipped as a save
(`public/lessons/<id>.citybloom`, made by `scripts/lessons.ts` with the balance mayor and scripted
moves, like scenarios). A lesson is steps in the tutorial's model (`src/data/lessons.ts`), run by the
same card; the town opens paused at the place the lesson is about.
- Traffic and transit (a jammed junction: a roundabout, a bus line).
- Money and loans (a town in the red: the budget, a loan, taxes).
- Happiness and services (a town without services: coverage maps, a clinic and school, parks).
- Disasters (a fire and a flood: fire stations, rebuilding).
- Districts and policies (paint a district, set a policy).
- Playing with friends (no town of its own: the friends screen's parts, room codes, co-op roles,
  regions; pointing at the lobby's controls).
- War (a rivals town with an HQ: the war room, a raid's warning, defences; marked opt-in).
- Making your own buildings (M47 adds it; shown as "coming soon" until then).
Progress (lessons finished) kept in settings.

## 3. A friend's room, the first time

A card the first time a player joins someone else's room (`roomIntro` seen in settings): what's
shared (the map, the money), who can build what (the host's permissions, shown for this player), how to
chat and ping (Shift+G), and how to leave. Also reachable from the room panel ("How rooms work").

## 4. Earlier, plainer warnings (advisors)

- Homes without power or water: the advisor says how long until they start to empty ("Homes on
  Elm Street have had no power for 20 hours: in about a day they'll start to empty") from the hours
  they've been without (`noPowerH`, the water equivalent) against `GROWTH.abandonAt`, severity rising
  as it nears; a notice once when the first homes pass half of it.
- Towns without services shrinking: when a town past a few hundred residents has no fire, health,
  police or school cover and homes' happiness is falling on that account, the planning advisor says
  plainly that the town will shrink until it has them, and which one to build first.
- Pure reads of the state in `advise()` (no change to the hashed state, so goldens hold).

## 5. Tests

- Unit: step logic (done/skip/resume, interrupts once, pause and speed back), lesson data valid (every
  lesson's save opens and its first step's target exists), advisor warnings (a town cut off from power
  gets the warning before abandonment starts).
- e2e `m42-tutorial.spec.ts`: the whole tutorial from the main menu (New city with the tutorial ticked)
  to 1,000 residents through the real UI; skip a step and leave/resume; screenshots of every step at
  100 % and 140 % and on a phone (`docs/screenshots/m42-*`). `m42-learn.spec.ts`: every lesson played.
