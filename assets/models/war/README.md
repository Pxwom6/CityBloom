# War models (phase 5)

Hand-made models for the war phase, made by the owner in Claude Design from `docs/models/PROMPTS-WAR.md`
(the building spec v6 and the unit spec v1 are in it). They wait here until the war phase brings
them in: the build reads only `assets/models/*.glb`, and only `PROMPTS-<number>.md` files give it
budgets, so nothing in this folder reaches the game yet.

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

## For the war import

- **Not in the game's data yet.** The war buildings aren't in `src/data`, so `npm run models:check`
  rejects each one as "not a building in the game". It also skips the site and smoke checks, and
  finds no budgets in `PROMPTS-WAR.md`.
- **Facing check false alarms.** The facing check rejects three models that follow their prompts:
  - airfield: the hangar doors face the apron;
  - bunker: its only door is at the back;
  - enrichment: the halls' roller doors are in their end walls.

  Exempt these three, or tell them apart another way.
- **`light` on a building.** atomsilo's searchlights use `light`, as its prompt asks, but `light`
  isn't a role in the building spec. Accept it on war buildings (it glows at night).
- **Parts below ground**, all asked for by their prompts:
  - the naval yard's quay goes to -8 m, and its dry dock holds water at -1 m;
  - the coastal gun's quay goes to -3 m;
  - the spy agency's basement ramp goes to -2.9 m.

  Two things in the game get in their way:
  - The lot base (a paved slab 4 cm up, with stone sides) would pave over the dock and the ramp. At
    the quays, its back side would close off the dock's mouth.
  - The lift for lawns would raise the naval yard's lawns and paving by 1.05 m, because it lifts them
    by the depth of the lowest flat water, grass or paving.

  These buildings need the base and the lift to leave them alone.
- **The whale's mouth** is drawn from the inside on purpose (its faces look into the mouth), so
  don't turn those faces round.
- **Merged parts.** The W3 units merge some static details into larger meshes (for example, the
  tank's headlights are part of its hull). Every part the game moves is still its own mesh, so they
  work as they are.
