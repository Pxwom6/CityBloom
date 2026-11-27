# M46 Your own buildings: the plan

SPEC-6.md M46: players bring in models they make (GLB), as a new look for a civic building they placed
or as a decorative landmark of 1×1 to 4×4 cells; checked in the browser by the game's own model check;
kept in My Buildings; carried in saves and passed to friends in a room; shared as a file.

## 1. Checking a model (in a worker)
- `src/models/customCheck.ts` (pure, tested in Node): the file's size (at most 1 MB), no external files
  or links inside it (buffers or images with a `uri`), then `inspectModel` (the same check
  `npm run models:check` runs, spec v6) against the target's site and budget: a look is checked as the
  civic building it's for (`<def>.glb`: its site from `CIVIC`, its budget from the prompts); a landmark
  as `landmark<n>` (a civic def of n×n cells, budget by size). Passing models are baked
  (`bakeModel`) as the build does.
- Every problem in plain words, and a picture: the model from above and from the front, its site drawn
  over it, the parts a problem names (or what lies outside the site) in red. Drawn in the worker on an
  OffscreenCanvas and handed back as a PNG.
- The prompts' budgets in the browser: `src/models/budgets.ts`, made by `scripts/modelBudgets.ts` from
  every `docs/models/PROMPTS*.md` (a later batch winning, as the check does); a test keeps it in step.

## 2. In the sim
- Landmarks: civic defs `landmark1`–`landmark4` (8–32 m square, category parks), each a park of its
  size: the same kind of service, land value and costs as the plaza and parks scale them. Placed like
  any building; nothing new in the economy.
- Looks: `SimState.looks` (civic id → model hash; save v34, migration to an empty map), set by
  `setLook { civic, look | null }` and by `placeBuilding`'s optional `look`; dropped when the building
  goes. The sim never sees the model, only its hash (16 hex). Room rules gain `customBuildings`
  (the host can turn them off: commands with a look are refused in plain words).

## 3. On the page
- My Buildings (`IndexedDB citybloom-buildings`): each model's bytes, name, target, hash, whose it is
  (mine, or a friend's that came with a city or a room). The panel lists mine with a preview: a
  turntable, by day and by night, in each season (a small three.js view of the baked model); Place
  (a landmark: the place tool; a look: the inspector of a civic building of that kind), Rename, Delete,
  Share (`.glb`, or `.citybloom-building`: the model and its name).
- Import: drop a `.glb`/`.citybloom-building` on the game or pick one; choose what it's for (a look for
  one of the civic buildings, or a landmark of a size); the worker checks it; refused with the reasons
  and the picture, or kept.
- Drawn: the civic renderer draws a civic with a look from the baked model (through the hand-made
  path, so the lot base, palettes, lights and LODs are the game's); without the model (or with friends'
  hidden) the original building, a landmark the plaza's generated look.
- Saves: the page writes the models the city's looks use beside it (`SaveMeta.models`), and takes them
  back into the store when a city opens (as a friend's, unless it is already mine).

## 4. Friends
- In a shared city a page that lacks a look's model asks the room for it; any page that has it answers
  once (the bytes, ≤ 1 MB, relayed; cached by hash). Nothing is kept by the relay.
- Settings: "Show friends' custom buildings" (on by default): off, a friend's model isn't drawn.
- The host's room panel: custom buildings on or off for the room (the rule).
- Regions: a visited friend's city carries its models in its save.

## 5. Tests
- Unit: the custom check (good, too big, external link, too wide, textures), budgets in step, the sim's
  looks and landmarks (save v34, migration, refusals), the share file.
- E2E: a good model made for the test (`scripts/dev/makeglb.ts`: a small building in the game's style,
  to spec) and three bad ones imported through the UI, refused with the right reasons; the good one as
  a new look and as a landmark; save and reload; a second player in a shared city sees it, and doesn't
  with the setting off. Phones.
- Budget: a city full of custom landmarks (draw calls and triangles; the Mac's frame times).
