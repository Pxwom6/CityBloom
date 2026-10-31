# War models (phase 5)

Hand-made models for the war phase, made by the owner in Claude Design from `docs/models/PROMPTS-WAR.md`
(the building spec v6 and the unit spec v1 are in it). Since M34 the build checks and converts them
into a file of their own (`war-models-<hash>.bin`), which only a city with war on downloads; the
main models file (`assets/models/*.glb`) stays as it was. See "The war import" below.

**Here: all 39**, unchanged from the owner's downloads.

- W1, military buildings: barracks, vehicledepot, airfield, navalyard, militaryhq, shelter, bunker.
- W2, defences and support: radar, antiair, coastalgun, interceptor, shieldgen, armsfactory,
  militarylab, provingground, spyagency.
- W3, land and air units: unit-infantry, unit-tank, unit-heavytank, unit-artillery, unit-transport,
  unit-repair, unit-fighter, unit-bomber, unit-helicopter, unit-drone.
- W4, sea units: unit-patrolboat, unit-gunboat, unit-submarine, unit-landingcraft.
- W5, superweapons: unit-windupbot, unit-skyfortress, unit-clockworkwhale, domeshield,
  blackouttower, expressgate.
- W6, the final thing: enrichment, atomsilo, unit-atombomb.

## Checked on arrival (26 October 2026)

- **Format and budgets.** All 39 are valid glTF 2.0 (Khronos's validator found no errors, warnings or
  hints) and within their triangle budgets. None has textures, cameras, lights, animations or bad
  scales.
- **Buildings** fill their sites exactly (every edge within 5 cm) and face the road.
- **Units** are within 5 % of their prompts' sizes, their origins sit under their middles (ships'
  waterlines at 0), and they face -Z. Every moving part the prompts name is there and turns about
  its own centre. Each barrel is a child of its turret, with a 0.3 m muzzle at the tip.
- **Materials** follow the specs, with one exception: the atom silo (below).
- **The superweapons (W5)** came later the same day and passed the same checks. The robot's arms
  turn at its shoulders and its legs at its hips, the whale's tail turns at its root and its jaw
  hinges at the back, the wind-up keys turn on their axles, and the sky fortress's 12 drone-bay
  hatches hinge along the gondola's sides. The blackout tower's three dish clusters turn on upright
  axes, and the express gate's ring lights are in pieces of 3.4 m at most.

## Faults in the models

The owner may send remade files under the same names.

- **barracks**: three tyre stacks each have their +X face wound inside out.
- **navalyard**:
  - the crane's trolley, cab and counterweight have no top faces, so they show holes from above;
  - the seven quay bollards each have their +X face wound inside out.
- **militaryhq**: the radar dome's base drum has its +X face wound inside out (a see-through gap).
- **airfield, militaryhq**: two hair-thin rim faces of the helipad are reversed (cosmetic).
- **domeshield**: two of its tree spots are 2.9 m from the base, not 3 m (no matter in practice).

## The war import (M34)

What the import needed, and what was done (`npm run models:check` now checks this folder with
`assets/models`; all 39 pass, with notes for the faults above):

- **In the game's data.** The twelve war buildings M34 brings are in `CIVIC` (`src/data/war.ts`)
  and are checked on their sites there, smoke included (the arms factory smokes). The other nine
  (interceptor, shieldgen, militarylab, spyagency, domeshield, blackouttower, expressgate,
  enrichment, atomsilo; M37 and M40) are checked and packed now on their prompts' sites ("Site W x
  D m" in `PROMPTS-WAR.md`), and never smoke. `PROMPTS-WAR.md`'s budgets count as a batch after
  batch 5. Units are checked on the unit spec (v1): roles, budget, size within 10 % of their
  prompts' (`UNIT_DEFS`), origin under the middle, resting on 0 or a waterline at 0, the moving
  parts and muzzles each prompt names, 0.3 m muzzle cubes, and each moving part's origin on it.
  The superweapons and the atom bomb, which the game doesn't have as kinds yet, are packed too.
- **Facing check false alarms.** airfield, bunker and enrichment are let through by name, with a
  note.
- **`light` on a building.** Accepted on war buildings only (the last role in the list, so the
  main models file's role numbers don't move); it glows at night like a lit window and is never
  repainted.
- **Parts below ground.** Allowed at the naval yard (8 m), coastal gun (3 m, its quay) and spy
  agency (2.9 m). What a war building builds below ground is recorded as boxes across its site
  (`pits`); the lot base leaves its top out over them, and where one meets an edge its stone side
  stops at the pit's foot, so the quays' own walls show and the dock's mouth is open. The lift for
  lawns ignores ground lower than 5 cm below 0, so the naval yard's lawns and paving stay where
  they are.
- **The ground itself** still lies at the site's level over a pit: where the dock and the ramp are on
  land, the game's graded terrain fills them to the top (see the screenshots of the M34 import).
  Cutting the terrain under a pit is left for the milestone that places these buildings in play.
- **The whale's mouth** is left as it is (never turned round).
- **Winding faults.** In war models, an open part whose faces disagree has the smaller side turned
  round (the tyre stacks, bollards, the HQ's radar drum, the helipad rims); the crane's open-topped
  trolley, cab and counterweight are noted but not closed.
- **Merged parts.** Fine as they are: every part the game moves is its own mesh.
