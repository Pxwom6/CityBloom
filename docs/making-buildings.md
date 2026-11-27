# Making your own buildings

_The guide is being written (M47)._

## The model spec, in plain words

<!-- model-spec:start (written by scripts/docs/modelSpec.ts; edit src/models/playerSpec.ts) -->

### Size and units

- Every number is in metres, with y pointing up. A storey is about 3 m (3.6 m for shops and offices).
- The model fills its site exactly, measured to within 5 cm: something (a wall, a lawn or paving) reaches each of the four edges, and nothing goes past them.
- Landmarks: 1×1: 8 × 8 m, 800 triangles; 2×2: 16 × 16 m, 1,500 triangles; 3×3: 24 × 24 m, 2,500 triangles; 4×4: 32 × 32 m, 3,500 triangles. A new look for a building takes that building's site (the Workshop shows it).

### Which way it faces

- The front faces the road, which is along −Z (in Blender, the −Y side before export: the "Front" view looks at it).
- Doors, entrances, shop windows, canopies and signs go on the front: the game works out which way a building faces from them.
- The model's origin (0, 0, 0) is the middle of the site, on the ground.

### On the ground

- The lowest point is at height 0, within 5 cm: nothing floats above the ground or sinks below it.
- Lawns, paths and paving lie flat, 5 cm to 10 cm above 0 (the game draws its own base under every building, just below them). No raised slab under the whole site.
- Nothing hangs in the air: every part stands on the ground or on another part.

### Parts and their names

- Every part is its own named object (don’t join them all into one): door, roof, wall, awning, sign, ac_unit, solar_panel…
- Each window is a group named "window" holding a pane named "window_glass" (the game lights each one at night); a strip of glass along a floor is "window_band", in pieces 3–4 m long.
- Set glass and frames 5–10 cm in front of their wall, never in it.
- Where a tree should stand, put a 1 m cube named "tree_spot" on the ground: the game puts one of its own trees there. No trees, cars or people of your own.
- Parts left with a 3D program’s own names (Cube, Cube.001) are refused: the game can’t tell a door from a roof.

### Colours

- Plain colours only: no pictures (textures), no lettering or logos.
- Each colour (material) is named by its job: **wall** (walls (the game repaints them for each copy)); **wall_alt** (a second wall colour: bands, panels, a lower storey); **trim** (white trim: cornices, sills, edges, columns); **roof** (roof surfaces only (repainted for each copy; snow settles on flat ones)); **glass** (window panes, which light up at night); **shop_glass** (shop windows, lit brighter at night); **frame** (window and door frames); **door** (doors and gates); **awning** (awnings and canopies (repainted)); **sign** (plain sign panels, no lettering (repainted)); **metal** (metal: rooftop units, posts, machinery); **wood** (wood: benches, decks, fences); **accent** (a bright detail: a clock face, a flag, a sculpture); **grass** (lawns and green roofs (they follow the seasons)); **paving** (paths, squares and steps); **asphalt** (car parks and yards); **water** (pools and fountains); **hedge** (hedges and planters (they follow the seasons)).
- Use the colours on the style reference sheet: pastel, brick or white walls, terracotta, slate or green roofs, white trim.

### Style

- Bright, warm and toy-like: chunky, simple shapes with clean edges, like a board-game piece.
- Nothing thinner than about 30 cm (no railings, cables or thin poles): it reads from above.
- Your own design: nothing copied from a real landmark, a brand or another game.

### The file

- One GLB file ("glTF Binary"), with everything inside it: nothing in other files.
- At most 1 MB, and within the triangle budget of what it is (above for landmarks; the Workshop shows a building's).

<!-- model-spec:end -->
