# Citybloom model prompts, batch 2

The first batch (`PROMPTS.md`) sized every model for its building type's own lot. In played cities most buildings stand on narrower lots than that: houses stay 8 m wide, and an upgrade widens a lot only when the cells beside it are free, which on a built-up street they aren't. So a 16 m villa or a 24 m tower never fits where those buildings actually grow, and in a big city only about one building in six wears a hand-made model (in your own cities, about one in nine).

These models are sized for the lots buildings really stand on, from a count of every building in your two cities (Ashton and Legacy-no-rail), the four careful-mayor cities, the menu's demo town, the fourteen scenario cities and the 110k bench city. Most are extra designs (`-2`, `-3`) for building types that already have a model; only `C213.glb` replaces a file. High-wealth and high-tech buildings are left out: almost none grow in those cities yet.

## How to use

1. Same as before: in Claude Design, start a canvas for a batch, attach `style-reference.png` and paste the model spec below once (it's version 3, with a few rules learned from the first batch).
2. Paste one building prompt at a time, and download each model as a GLB with the file name in its prompt.
3. Add the files to `assets/models/`, next to the first batch. Claude Code checks them and brings them in.

The batches are in order of how many buildings they reach, so the first two matter most.

## The model spec

```text
Citybloom model spec (v3). Follow it for every model, and match the attached style reference sheet.

Style
- Bright, warm and toy-like: chunky, simple shapes with clean edges, like a well-made board-game piece.
- Use the palette on the reference sheet: pastel, brick or white walls; terracotta, slate or green roofs; big simple windows (dark blue-grey glass in white frames); white trim.
- No fiddly detail: nothing thinner than about 0.3 m (no railings, balusters, cables, thin pipes or poles). Make what reads from above bold: roofs, chimneys, awnings, signs, rooftop units.
- No lettering, logos or real brand names: signs are plain colour panels. Original designs only, nothing copied from a real landmark or another game.
- No trees, vehicles or people; the game adds its own. Where a tree should stand, put a 1 m cube named "tree_spot", at least 3 m from any wall, and the game swaps it for one of its seasonal trees.

Format
- One GLB file per model, with every part as its own named mesh (don't merge them). Use the file name given in the prompt.
- Metres, y up. Origin at ground level in the centre of the site. The front, facing the road, points along -Z; x runs along the road.
- Fill exactly the site size in the prompt, and put nothing outside it: no pavement, kerb, street lamps or road.
- Ground inside the site (lawns, paths, paving, car parks, yards) is fine as flat surfaces just above 0, but no raised slab or plinth under the whole site.
- Storeys about 3 m for homes, 3.6 m for shops and offices (4 m for a shop's ground floor), and 5-6 m for industrial halls.
- Build each part where it belongs. An extruded shape starts at 0, so centre it on its building before placing it (three models in the first batch had a gable slid half its length off the roof). Nothing hangs in the air, and no part overlaps another (benches beside planters, not inside them).

Materials: plain colours, no textures, named exactly by role
- wall, wall_alt, trim, roof, glass, shop_glass, frame, door, awning, sign, metal, wood, accent, grass, paving, asphalt, water, hedge.
- The game repaints wall, wall_alt, roof, awning and sign for each copy, so any colour from the sheet is a fine default.
- Only roof surfaces use roof; gable ends, end caps and parapets use wall, wall_alt or trim.

Parts: named by what they are
- Each window is a group named "window" containing "window_glass" (plus a frame or sill if you like): one window per group, never a whole floor of windows in one group. On towers, a continuous strip of glass along a floor is "window_band", split into runs about 4-8 m long. The game lights windows one by one at night, so a floor-wide group glows as one bright stripe.
- Set glass 5-10 cm in front of its wall or into a recess, never in the wall's own plane, or it flickers from a distance.
- Use names like "door", "garage_door", "storefront", "roof", "chimney", "ac_unit", "water_tank", "awning" and "sign".
- Anything that gives off smoke has a chimney named "smoke_stack"; the smoke comes from its top.
- Everything is supported: nothing floats.

Narrow lots
- A detached house stays narrower than its lot, with a path or drive down one side and a gap on the other, so neighbouring houses don't touch.
- A row building (the prompt says the game stands copies side by side) fills its whole width, and its side walls are plain party walls with no windows, balconies or trim, because the next copy stands against them.

Keep to the triangle budget in each prompt.
```

## Batch 10: Narrow houses (8 m lots) (8)

Low-density homes stay on lots 8 m wide (16 or 24 m deep), so the first batch's 16 m family houses and villas never appear. These fit every one of them; on a 24 m deep lot the game adds a back garden.

### Villa, medium wealth, narrow (`R013-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Villa (homes, low density, medium wealth). Save as R013-2.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 900 triangles.
A narrow villa for an 8 m wide lot, detached: a roomy two-storey house about 6.5 m wide under a big roof with a dormer, a bay window and a porch at the front, a narrow drive down one side to a garage_door, a front garden with a path, and a back patio and garden with a tree_spot. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### Villa, medium wealth, narrow, second design (`R013-3.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Villa (homes, low density, medium wealth). Save as R013-3.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 900 triangles.
A second narrow villa for an 8 m wide lot, detached, unlike the first: its gable end faces the street with a big window in it, a two-storey bay beside the door, a balcony with a solid parapet over the porch, a narrow drive down one side, a front garden edged with a low hedge, and a back garden with a tree_spot. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### Villa, low wealth, narrow (`R003-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Villa (homes, low density, low wealth). Save as R003-2.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 900 triangles.
A narrow villa for an 8 m wide lot, detached: a roomy two-storey house about 6.5 m wide under a big roof with a dormer, a bay window and a porch at the front, a narrow drive down one side to a garage_door, a front garden with a path, and a back patio and garden with a tree_spot. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

### Villa, low wealth, narrow, second design (`R003-3.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Villa (homes, low density, low wealth). Save as R003-3.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 900 triangles.
A second narrow villa for an 8 m wide lot, detached, unlike the first: its gable end faces the street with a big window in it, a two-storey bay beside the door, a balcony with a solid parapet over the porch, a narrow drive down one side, a front garden edged with a low hedge, and a back garden with a tree_spot. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

### Family house, medium wealth, narrow (`R012-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Family house (homes, low density, medium wealth). Save as R012-2.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 800 triangles.
A narrow two-storey family house for an 8 m wide lot, detached: about 6 m wide with a pitched roof, a porch over the front door, a driveway down one side to a garage_door, a front lawn, and a back garden with a tree_spot. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### Family house, medium wealth, narrow, second design (`R012-3.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Family house (homes, low density, medium wealth). Save as R012-3.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 800 triangles.
A second narrow family house for an 8 m wide lot, detached, unlike the first: a hipped roof with a small gable over the front door, a carport on chunky posts beside the house instead of a garage, a front lawn, and a back garden with a tree_spot. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### Family house, low wealth, narrow (`R002-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Family house (homes, low density, low wealth). Save as R002-2.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 800 triangles.
A narrow two-storey family house for an 8 m wide lot, detached: about 6 m wide with a pitched roof, a porch over the front door, a driveway down one side to a garage_door, a front lawn, and a back garden with a tree_spot. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

### Cottage, low wealth, second design (`R001-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Cottage (homes, low density, low wealth). Save as R001-2.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 3 m to the roof. Budget 600 triangles.
A second small one-storey cottage, unlike the first design (which has a steep front gable): a low hipped roof, a veranda across the front on chunky posts, window boxes, a chimney, a front garden with a path, a low hedge along the sides, and a back garden with a tree_spot. Detached: keep it narrower than the lot. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

## Batch 11: Apartment houses and townhouses (6)

Most six-storey apartment buildings stand on lots 16 m wide. Narrow row buildings like the tenement fit lots 8, 16 and 24 m wide.

### Courtyard apartments, medium wealth, narrow row building (`R113-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Courtyard apartments (homes, medium density, medium wealth). Save as R113-2.glb.
Site 8 x 16 m: one narrow building; the game stands one, two or three copies side by side on lots 8, 16 or 24 m wide. The front is on the road, facing -Z. 6 storeys, about 18 m to the roof. Budget 1,500 triangles.
A narrow six-storey apartment house, a row building, each copy painted differently. It fills the whole 8 m width with plain party walls on both sides. At the front: a stone-coloured ground floor with an entrance under a canopy, bay windows or balconies with solid parapets on the floors above, and a cornice; small balconies at the back; a plant room or water_tank on the roof. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### Courtyard apartments, medium wealth, narrow row building, second design (`R113-3.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Courtyard apartments (homes, medium density, medium wealth). Save as R113-3.glb.
Site 8 x 16 m: one narrow building; the game stands one, two or three copies side by side on lots 8, 16 or 24 m wide. The front is on the road, facing -Z. 6 storeys, about 18 m to the roof. Budget 1,500 triangles.
A second narrow six-storey apartment house, a row building, unlike the first: it fills the whole 8 m width with plain party walls on both sides. A mansard roof with dormers, two-storey bay windows on the front, a small gable or turret at the middle of the roofline, and an entrance with steps. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### Courtyard apartments, low wealth, narrow row building, third design (`R103-3.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Courtyard apartments (homes, medium density, low wealth). Save as R103-3.glb.
Site 8 x 16 m: one narrow building; the game stands one, two or three copies side by side on lots 8, 16 or 24 m wide. The front is on the road, facing -Z. 6 storeys, about 18 m to the roof. Budget 1,500 triangles.
A narrow six-storey apartment house, a row building, unlike the brick tenement already in the game: it fills the whole 8 m width with plain party walls on both sides. Plain rendered walls, a tall stair window running up the middle of the front, small balconies with solid parapets, an entrance with a canopy, and a flat roof with a water_tank. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

### Apartment block, medium wealth, compact (`R112-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Apartment block (homes, medium density, medium wealth). Save as R112-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 12 m to the roof. Budget 1,400 triangles.
A compact four-storey apartment block filling a 16 x 16 m lot: a central entrance under a canopy, solid slab balconies, a flat roof with a planted box, bike racks, and a small shared garden behind. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### Apartment block, low wealth, compact (`R102-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Apartment block (homes, medium density, low wealth). Save as R102-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 12 m to the roof. Budget 1,400 triangles.
A compact four-storey apartment block filling a 16 x 16 m lot: a central entrance under a canopy, solid slab balconies, a flat roof with a planted box, bike racks, and a small shared garden behind. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

### Townhouses, low wealth, second design (`R101-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Townhouses (homes, medium density, low wealth). Save as R101-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 9 m to the roof. Budget 1,400 triangles.
A second terrace design, unlike the first (a row of three or four townhouses): two tall three-storey houses side by side, each 8 m wide with its own gable facing the street, bay windows, front steps and a small front garden, chimneys, and small back yards. The pair fills the lot and shares a middle wall. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

## Batch 12: Small shops (8 m lots) (6)

Market halls and shopfronts mostly stand on 8 x 8 m lots.

### Market hall, medium wealth, small (`C013-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Market hall (shops and offices, low density, medium wealth). Save as C013-2.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 8 m to the roof. Budget 600 triangles.
A small market shop for an 8 x 8 m lot: two storeys, an open front with produce stalls under a striped awning, a gabled roof with a row of high windows, a sign panel over the front, and crates of produce as chunky blocks. Medium wealth: tidy and smart, with better materials and planters.
```

### Market hall, medium wealth, small, second design (`C013-3.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Market hall (shops and offices, low density, medium wealth). Save as C013-3.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 8 m to the roof. Budget 600 triangles.
A second small market shop for an 8 x 8 m lot, unlike the first: a flat-roofed two-storey grocer with a big shop window (shop_glass) across the front, a deep canopy along the front edge of the lot, a sign panel on the parapet, and stacked boxes by the door. Medium wealth: tidy and smart, with better materials and planters.
```

### Market hall, low wealth, small (`C003-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Market hall (shops and offices, low density, low wealth). Save as C003-2.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 8 m to the roof. Budget 600 triangles.
A small market shop for an 8 x 8 m lot: two storeys, an open front with produce stalls under a striped awning, a gabled roof with a row of high windows, a sign panel over the front, and crates of produce as chunky blocks. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

### Shopfront, medium wealth, small (`C012-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Shopfront (shops and offices, low density, medium wealth). Save as C012-2.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 500 triangles.
A single shop on an 8 x 8 m lot: a big display window (shop_glass), an awning and a sign at the front, a door, and a stockroom at the back with an ac_unit on the roof. Medium wealth: tidy and smart, with better materials and planters.
```

### Shopfront, low wealth, small (`C002-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Shopfront (shops and offices, low density, low wealth). Save as C002-2.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 500 triangles.
A single shop on an 8 x 8 m lot: a big display window (shop_glass), an awning and a sign at the front, a door, and a stockroom at the back with an ac_unit on the roof. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

### Corner shop, low wealth, second design (`C001-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Corner shop (shops and offices, low density, low wealth). Save as C001-2.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 500 triangles.
A second tiny corner shop, unlike the first: a kiosk-style shop with shop windows across the front and down one side, a bold awning, a sign panel on the roof edge, and a bench and a planter by the door. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

## Batch 13: Department stores and offices (16 m lots) (4)

Department stores and office blocks mostly stand on 16 x 16 m lots.

### Department store, medium wealth, compact (`C113-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Department store (shops and offices, medium density, medium wealth). Save as C113-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 6 storeys, about 22 m to the roof. Budget 1,600 triangles.
A compact six-storey department store filling a 16 x 16 m lot: display windows (shop_glass) along the ground floor, a grand entrance with a canopy, window_bands on the floors above, a big sign panel on the roof edge, and rooftop plant. Medium wealth: tidy and smart, with better materials and planters.
```

### Department store, low wealth, compact (`C103-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Department store (shops and offices, medium density, low wealth). Save as C103-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 6 storeys, about 22 m to the roof. Budget 1,600 triangles.
A compact six-storey department store filling a 16 x 16 m lot: display windows (shop_glass) along the ground floor, a grand entrance with a canopy, window_bands on the floors above, a big sign panel on the roof edge, and rooftop plant. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

### Office block, medium wealth, compact (`C112-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Office block (shops and offices, medium density, medium wealth). Save as C112-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 15 m to the roof. Budget 1,300 triangles.
A four-storey office block filling a 16 x 16 m lot: window_bands, an entrance canopy, rooftop plant, and bike racks and a little paved yard at the back. Medium wealth: tidy and smart, with better materials and planters.
```

### Office block, low wealth, compact (`C102-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Office block (shops and offices, medium density, low wealth). Save as C102-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 15 m to the roof. Budget 1,300 triangles.
A four-storey office block filling a 16 x 16 m lot: window_bands, an entrance canopy, rooftop plant, and bike racks and a little paved yard at the back. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

## Batch 14: Industry (10)

Plants and industrial complexes mostly stand on lots 16 m wide; workshops and factories already fit, and get a second design.

### Plant, manufacturing, compact (`I013-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Plant (industry, low density, manufacturing). Save as I013-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,200 triangles.
A compact plant for a 16 x 16 m lot: a production hall with a big garage_door, a two-storey office at one front corner, a storage tank, and a small yard. Manufacturing: clean sheet-metal halls in grey and blue with sawtooth roofs, roller doors and a small office. No smoke.
```

### Plant, manufacturing, compact, second design (`I013-3.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Plant (industry, low density, manufacturing). Save as I013-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,200 triangles.
A second compact plant for a 16 x 16 m lot, unlike the first: two linked sheds with sawtooth roofs, a loading dock under a canopy, two short silos, and a yard with stacked pallets as chunky blocks. Manufacturing: clean sheet-metal halls in grey and blue with sawtooth roofs, roller doors and a small office. No smoke.
```

### Plant, heavy industry, compact (`I003-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Plant (industry, low density, heavy industry). Save as I003-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,200 triangles.
A compact plant for a 16 x 16 m lot: a production hall with a big garage_door, a two-storey office at one front corner, a storage tank, and a small yard. Heavy industry: brick and rusty metal, sawtooth or gabled roofs, one or two tall chimneys named smoke_stack, silos or storage tanks, and heaps of material in a busy yard.
```

### Workshop, manufacturing, second design (`I011-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Workshop (industry, low density, manufacturing). Save as I011-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 800 triangles.
A second small workshop, unlike the first (one shed with a side office): two small sheds side by side with roller doors (garage_door), a lean-to office along the front, and a yard with stacked crates. Manufacturing: clean sheet-metal halls in grey and blue with sawtooth roofs, roller doors and a small office. No smoke.
```

### Workshop, heavy industry, second design (`I001-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Workshop (industry, low density, heavy industry). Save as I001-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 800 triangles.
A second small workshop, unlike the first (one shed with a side office): two small sheds side by side with roller doors (garage_door), a lean-to office along the front, and a yard with stacked crates. Heavy industry: brick and rusty metal, sawtooth or gabled roofs, one or two tall chimneys named smoke_stack, silos or storage tanks, and heaps of material in a busy yard.
```

### Factory, manufacturing, second design (`I111-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Factory (industry, medium density, manufacturing). Save as I111-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A second factory, unlike the first (a hall with an office at the front): a long hall with a sawtooth roof running back from the road, a stair tower with a tall window at the front corner, loading docks along one side, and a yard at the back. Manufacturing: clean sheet-metal halls in grey and blue with sawtooth roofs, roller doors and a small office. No smoke.
```

### Factory, heavy industry, second design (`I101-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Factory (industry, medium density, heavy industry). Save as I101-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A second factory, unlike the first (a hall with an office at the front): a long hall with a sawtooth roof running back from the road, a stair tower with a tall window at the front corner, loading docks along one side, and a yard at the back. Heavy industry: brick and rusty metal, sawtooth or gabled roofs, one or two tall chimneys named smoke_stack, silos or storage tanks, and heaps of material in a busy yard.
```

### Industrial complex, manufacturing, compact (`I113-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Industrial complex (industry, medium density, manufacturing). Save as I113-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,000 triangles.
An industrial complex on a 16 x 24 m lot: a tall hall at the back, a lower hall in front of it with a loading dock, two silos or tanks, and a small office at the front. Manufacturing: clean sheet-metal halls in grey and blue with sawtooth roofs, roller doors and a small office. No smoke.
```

### Industrial complex, heavy industry, compact (`I103-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Industrial complex (industry, medium density, heavy industry). Save as I103-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,000 triangles.
An industrial complex on a 16 x 24 m lot: a tall hall at the back, a lower hall in front of it with a loading dock, two silos or tanks, and a small office at the front. Heavy industry: brick and rusty metal, sawtooth or gabled roofs, one or two tall chimneys named smoke_stack, silos or storage tanks, and heaps of material in a busy yard.
```

### Industrial park, manufacturing, compact (`I213-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Industrial park (industry, high density, manufacturing). Save as I213-2.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 5 storeys, about 23 m to the roof. Budget 2,500 triangles.
An industrial park on a 24 x 24 m lot: a five-storey office building and two lower halls of different sizes around a small car park, with lawns and tree_spots. Manufacturing: clean sheet-metal halls in grey and blue with sawtooth roofs, roller doors and a small office. No smoke.
```

## Batch 15: Towers on 16 m lots (6)

Most high-rises and skyline towers stand on lots 16 m wide, where the first batch's 24 m towers can't.

### Skyline residences, medium wealth, slender (`R213-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Skyline residences (homes, high density, medium wealth). Save as R213-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 24 storeys, about 72 m to the roof. Budget 2,500 triangles.
A slender 24-storey tower on a 16 x 24 m lot: setbacks near the top, a distinctive crown, a sky garden on one or two levels, balconies with solid parapets, and an entrance canopy over a small forecourt. Medium wealth: a smart tower with generous balconies and a landscaped entrance.
```

### Skyline residences, low wealth, slender (`R203-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Skyline residences (homes, high density, low wealth). Save as R203-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 24 storeys, about 72 m to the roof. Budget 2,500 triangles.
A slender 24-storey tower on a 16 x 24 m lot: setbacks near the top, a distinctive crown, a sky garden on one or two levels, balconies with solid parapets, and an entrance canopy over a small forecourt. Low wealth: a plain, economical tower with simple balconies and pastel panels.
```

### High-rise, medium wealth, slender (`R212-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: High-rise (homes, high density, medium wealth). Save as R212-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 16 storeys, about 48 m to the roof. Budget 2,200 triangles.
A sixteen-storey slab on a 16 x 24 m lot, with balconies on the front and back, an entrance canopy, and a little plaza with a tree_spot at its foot. Medium wealth: a smart tower with generous balconies and a landscaped entrance.
```

### High-rise, low wealth, slender (`R202-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: High-rise (homes, high density, low wealth). Save as R202-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 16 storeys, about 48 m to the roof. Budget 2,200 triangles.
A sixteen-storey slab on a 16 x 24 m lot, with balconies on the front and back, an entrance canopy, and a little plaza with a tree_spot at its foot. Low wealth: a plain, economical tower with simple balconies and pastel panels.
```

### Residential tower, low wealth, second design (`R201-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Residential tower (homes, high density, low wealth). Save as R201-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 10 storeys, about 30 m to the roof. Budget 2,000 triangles.
A second ten-storey residential tower, unlike the first (a tower on a podium): a stepped slab with corner balconies, coloured balcony panels (accent), a rooftop terrace with a plant room, and an entrance with a canopy. Low wealth: a plain, economical tower with simple balconies and pastel panels.
```

### Headquarters, medium wealth, slender (`C213-2.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Headquarters (shops and offices, high density, medium wealth). Save as C213-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 2,500 triangles.
A slender 26-storey headquarters tower on a 16 x 24 m lot: a sculpted crown, a sign panel near the top, window_bands split into runs, a two-storey glass lobby with a canopy, and planters at its foot. Medium wealth: a smart tower in glass and stone.
```

## Batch 16: Remake (1)

The first C213 lights up at night as a striped box (its window groups each run a whole floor), and it shows in the README's night shot. This replaces it.

### Headquarters, medium wealth, remake (`C213.glb`)

```text
Citybloom model, following the model spec (v3) and style reference: Headquarters (shops and offices, high density, medium wealth). Save as C213.glb.
Lot 24 x 32 m (3 x 4 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 3,000 triangles.
A striking 26-storey headquarters tower with a sculpted crown, a sign panel near the top, and a plaza at its foot with planters and tree_spots. This replaces the first C213, whose window groups each ran a whole floor and lit up at night as bright stripes: give every floor separate windows, or window_band runs 4-8 m long. Medium wealth: a smart tower in glass and stone.
```
