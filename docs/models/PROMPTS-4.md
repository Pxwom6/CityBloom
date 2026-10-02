# Citybloom model prompts, batch 4: every building on every lot

After batch 3, about 98 % of the buildings in the test cities wear a hand-made model. This batch covers the rest, and goes further: every building type gets at least two designs for every lot size it can stand on in any city, worked out from the game's own growth rules, not just from the test cities. With two designs or more on a lot, the game never mixes in a generated look there.

It's 121 models in eight batches, in order of how much they change:

- **Batches 22-25 (54): ordinary buildings.** Second designs where only one fits a lot, and designs for the lots with none. After these, every low- and medium-wealth building, and all heavy industry and manufacturing, is hand-made on every lot.
- **Batch 26 (10): third designs** for the ten building types that stand on hundreds of lots each, so streets repeat less.
- **Batches 27-29 (57): rich homes, rich shops and offices, and high-tech industry.** The test cities barely grow these (9 of 15,450 buildings), but a wealthy, well-educated city will, and the first batch's models for them only fit their type's full lot.

Every one is an extra design (`-2` to `-5`), so no file is replaced, and every file name, size and budget has been checked against the game's own model rules.

## How to use

1. Same as before: in Claude Design, start a canvas for a batch, attach `style-reference.png` and paste the model spec below once. It's version 5: version 4 plus one rule, that something reaches each edge of the site exactly (batch 3's market shop stopped 10 cm short and the game left it out).
2. Paste one building prompt at a time, and download each model as a GLB with the file name in its prompt.
3. Put the files somewhere I can see them, as before, and I'll check them before they go into `assets/models/`.

You can stop after any batch: each one is complete on its own.

## The model spec

```text
Citybloom model spec (v5). Follow it for every model, and match the attached style reference sheet.

Style
- Bright, warm and toy-like: chunky, simple shapes with clean edges, like a well-made board-game piece.
- Use the palette on the reference sheet: pastel, brick or white walls; terracotta, slate or green roofs; big simple windows (dark blue-grey glass in white frames); white trim. The game repaints walls, roofs, awnings and signs for each copy, but only parts whose colour is close to one on the sheet: a grey roof or a navy sign stays the same on every copy.
- Towers have solid walls with separate windows set into them, not all-glass walls: the city already has several dark glass towers.
- No fiddly detail: nothing thinner than about 0.3 m (no railings, balusters, cables, thin pipes or poles). Make what reads from above bold: roofs, chimneys, awnings, signs, rooftop units.
- No lettering, logos or real brand names: signs are plain colour panels in a colour that stands out from the wall behind them. Doors, garage doors and roller doors stand out from their walls too. Original designs only, nothing copied from a real landmark or another game.
- No trees, vehicles or people; the game adds its own. Where a tree should stand, put a 1 m cube named "tree_spot" on the ground, at least 3 m from any wall, and the game swaps it for one of its seasonal trees.

Format
- One GLB file per model, with every part as its own named mesh (don't merge them). Use the file name given in the prompt.
- Metres, y up. Origin at ground level in the centre of the site. The front, facing the road, points along -Z; x runs along the road.
- Fill exactly the site size in the prompt, and put nothing outside it: no pavement, kerb, street lamps or road.
- Something (a wall, a lawn or paving) reaches each of the four edges of the site exactly. The game measures a model from its outermost parts, and leaves out one that stops even 10 cm short of its site.
- Ground inside the site (lawns, paths, paving, car parks, yards) is flat surfaces 5-10 cm above 0, but no raised slab or plinth under the whole site.
- Storeys about 3 m for homes, 3.6 m for shops and offices (4 m for a shop's ground floor), and 5-6 m for industrial halls. Each storey shows its own row of windows.
- On lots 16 m or wider, buildings cover about half the site or more; the rest is garden, yard or plaza.
- Build each part where it belongs. An extruded shape starts at 0, so centre it on its building before placing it. Nothing hangs in the air, and no part overlaps another (benches beside planters, not inside them).
- Roofs are closed: where glazing meets a roof plane they share an edge, with no gap to see through. Dormers sit below the main ridge.

Materials: plain colours, no textures, named exactly by role
- wall, wall_alt, trim, roof, glass, shop_glass, frame, door, awning, sign, metal, wood, accent, grass, paving, asphalt, water, hedge.
- Only roof surfaces use roof; gable ends, end caps and parapets use wall, wall_alt or trim.

Parts: named by what they are
- Each window is a group named "window" containing "window_glass" (plus a frame or sill if you like): one window per group, never a whole floor of windows in one group. A continuous strip of glass along a floor is "window_band", split into runs about 3-4 m long. The game lights windows one by one at night, so a long run glows as one bright stripe.
- Set glass 5-10 cm in front of its wall or into a recess, never in the wall's own plane, or it flickers from a distance.
- Use names like "door", "garage_door", "storefront", "roof", "chimney", "ac_unit", "water_tank", "awning" and "sign".
- Anything that gives off smoke has a chimney named "smoke_stack"; the smoke comes from its top.

Narrow lots
- A detached house stays narrower than its lot, with a path or drive down one side and a gap on the other, so neighbouring houses don't touch. Hedges and fences stay low, 1.2 m at most.
- A row building (the prompt says the game stands copies side by side) fills its whole width, and its side walls are plain party walls with no windows, balconies, trim or recesses, because the next copy stands against them.

Keep to the triangle budget in each prompt.
```

## Batch 22: Second designs for shops and offices (14)

Shops and offices whose lot has only one design, so the game mixes in generated looks; a second design makes every one of them hand-made.

### Shopfront, medium wealth, hipped roof (`C012-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Shopfront (shops and offices, low density, medium wealth). Save as C012-3.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 600 triangles.
A third shop for an 8 x 8 m lot, unlike the others (flat-roofed boxes with awnings): a one-storey shop under a shallow hipped roof with deep eaves all round, a shop window (shop_glass) across the front with a recessed door in the middle, a sign panel on the fascia, window boxes, and two square planters with clipped shrubs (hedge) by the door. Medium wealth: tidy and smart, with better materials and planters.
```

### Shopfront, low wealth, gable front (`C002-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Shopfront (shops and offices, low density, low wealth). Save as C002-3.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 600 triangles.
A second shop for an 8 x 8 m lot, unlike the first (a flat-roofed box with an awning): a one-storey shop under a steep pitched roof with its gable to the street, a big sign panel in the gable, a shop window (shop_glass) and a door under a deep canopy on chunky brackets, and a bench and a planter by the door. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

### Corner shop, medium wealth, cafe (`C011-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Corner shop (shops and offices, low density, medium wealth). Save as C011-2.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 500 triangles.
A second corner shop, unlike the first (a box with a striped awning): a cafe with two tall arched windows (shop_glass) either side of the door, a flat canopy in a bold colour, two small tables with chunky benches outside, a sign panel on a raised parapet, and a planter at each side of the door. Medium wealth: tidy and smart, with better materials and planters.
```

### Office block, medium wealth, stone portico (`C112-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Office block (shops and offices, medium density, medium wealth). Save as C112-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 15 m to the roof. Budget 1,400 triangles.
A third office block, unlike the others (boxes wrapped in bands of glass): a four-storey office in pale stone with tall separate windows in a regular grid, a two-storey entrance portico on chunky square columns, a cornice, a roof terrace with planters behind a parapet, and bike racks as chunky blocks by the door. Medium wealth: tidy and smart, with better materials and planters.
```

### Office block, low wealth, brick (`C102-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Office block (shops and offices, medium density, low wealth). Save as C102-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 15 m to the roof. Budget 1,400 triangles.
A third office block, unlike the others (boxes wrapped in bands of glass): a four-storey brick office with rows of separate square windows, two small shops under one long awning on the ground floor, an entrance in the middle under a sign panel, and a stair tower rising above the flat roof beside chunky ac_units. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

### Shopping row, medium wealth, cafe and dormers (`C111-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Shopping row (shops and offices, medium density, medium wealth). Save as C111-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 11 m to the roof. Budget 1,400 triangles.
A second shopping row, unlike the first (three shops under two plain floors): two shops with tall display windows (shop_glass) and a cafe between them under a deep awning with chunky outdoor tables, two floors of flats above with bay windows, and a pitched roof with dormers and chimneys. Medium wealth: tidy and smart, with better materials and planters.
```

### Office tower, low wealth, concrete grid (`C201-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Office tower (shops and offices, high density, low wealth). Save as C201-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 10 storeys, about 36 m to the roof. Budget 1,800 triangles.
A second office tower, unlike the first (a glass tower on a lobby podium): a ten-storey tower in light concrete with deep-set separate windows in a regular grid, a slim stair core on one side rising above the roof with a sign panel near its top, a recessed ground floor behind chunky columns, and ac_units on the roof. Low wealth: a plainer, economical tower with simpler shapes and fewer flourishes.
```

### Office tower, medium wealth, stone and terraces (`C211-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Office tower (shops and offices, high density, medium wealth). Save as C211-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 10 storeys, about 36 m to the roof. Budget 1,800 triangles.
A second office tower, unlike the first (a dark glass tower on a podium): a ten-storey tower in warm stone with tall windows in pairs, a narrow terrace with planters set into the front every third floor, a hipped roof cap over the plant room, and a two-storey lobby with a canopy and planters. Medium wealth: a smart tower in stone and glass.
```

### Headquarters, medium wealth, wedge crown (`C213-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Headquarters (shops and offices, high density, medium wealth). Save as C213-4.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 2,500 triangles.
A second headquarters tower for lots 16 m wide, unlike the first (a slim dark glass tower): a tower faced in brick-coloured panels with separate windows in white frames, a wedge-shaped crown that rises toward the back with the plant room behind it, a sign panel high on the front, and a lobby of shop_glass behind a deep canopy. Medium wealth: a smart tower in stone and glass.
```

### Headquarters, medium wealth, notched corners (`C213-5.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Headquarters (shops and offices, high density, medium wealth). Save as C213-5.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 2,800 triangles.
A second headquarters tower for 24 x 24 m lots, unlike the first (stone fins and an open frame on top): a tower whose plan is a square with deep notches cut into its four corners, small terraces with planters in the notches every four floors, separate windows in pale walls, a smaller glazed lantern room as its crown, and a plaza with planters and tree_spots. Medium wealth: a smart tower in stone and glass.
```

### Commercial tower, medium wealth, L-shaped (`C212-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Commercial tower (shops and offices, high density, medium wealth). Save as C212-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 16 storeys, about 58 m to the roof. Budget 2,500 triangles.
A second commercial tower for 24 x 24 m lots, unlike the first (a stepped glass tower): an L-shaped sixteen-storey tower wrapped around a small plaza at the front corner, a three-storey podium of shops (shop_glass) with canopies along the rest of the front, separate windows in stone walls, and a roof garden on the podium. Medium wealth: a smart tower in stone and glass.
```

### Commercial tower, low wealth, cross-shaped (`C202-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Commercial tower (shops and offices, high density, low wealth). Save as C202-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 16 storeys, about 58 m to the roof. Budget 2,500 triangles.
A second commercial tower for 24 x 24 m lots, unlike the first (a stepped glass tower): a cross-shaped sixteen-storey tower (a plus-shaped plan) rising from a four-storey shopping podium across the front of the lot, separate windows in light walls, a roof garden on the podium, and big sign panels on the podium's front. Low wealth: a plainer, economical tower with simpler shapes and fewer flourishes.
```

### Department store, medium wealth, atrium (`C113-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Department store (shops and offices, medium density, medium wealth). Save as C113-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 6 storeys, about 22 m to the roof. Budget 2,000 triangles.
A second department store for 24 x 24 m lots, unlike the first (a box wrapped in bands of glass): two six-storey wings in stone-coloured walls with separate windows, either side of a full-height glazed atrium in the middle of the front (window_band runs about 3-4 m), display windows (shop_glass) along the ground floor, a grand entrance canopy, and a roof garden with planters on the wings. Medium wealth: tidy and smart, with better materials and planters.
```

### Department store, low wealth, stepped (`C103-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Department store (shops and offices, medium density, low wealth). Save as C103-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 6 storeys, about 22 m to the roof. Budget 2,000 triangles.
A second department store for 24 x 24 m lots, unlike the first (a box wrapped in bands of glass): a store that steps down from six storeys at the front to four at the back, display windows (shop_glass) along the ground floor, separate windows in bold coloured panels above, a two-storey glazed entrance bay in the middle under a deep canopy, and big sign panels on the roof edge and on the lower step. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

## Batch 23: Second designs for homes and industry (12)

Homes and industry whose lot has only one design.

### High-rise, medium wealth, Y-shaped (`R212-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: High-rise (homes, high density, medium wealth). Save as R212-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 16 storeys, about 48 m to the roof. Budget 2,500 triangles.
A second high-rise for 24 x 24 m lots, unlike the first (a single slab): a Y-shaped sixteen-storey tower, three short wings around a central core, on a broad two-storey base with a landscaped roof garden, separate windows, and balconies with solid parapets at the ends of the wings. Medium wealth: a smart tower with generous balconies and a landscaped entrance.
```

### High-rise, low wealth, two balcony columns (`R202-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: High-rise (homes, high density, low wealth). Save as R202-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 16 storeys, about 48 m to the roof. Budget 2,200 triangles.
A second high-rise for lots 16 m wide, unlike the first (a dark glass slab): a plain sixteen-storey tower with separate windows in pastel panels, small balconies with solid parapets stacked up the front in two columns, a water_tank and a lift room on the roof, and an entrance canopy with a bench. Low wealth: a plain, economical tower with simple balconies and pastel panels.
```

### Apartment block, low wealth, gabled (`R102-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Apartment block (homes, medium density, low wealth). Save as R102-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 12 m to the roof. Budget 1,400 triangles.
A third apartment block, unlike the others (flat-roofed boxes with slab balconies): four storeys of brick-coloured walls under a gabled roof running along the street, two front entrances each under a small porch, stacked balconies with solid parapets between them, and a front garden with a low hedge. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

### High-rise, low wealth, cross-shaped (`R202-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: High-rise (homes, high density, low wealth). Save as R202-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 16 storeys, about 48 m to the roof. Budget 2,500 triangles.
A second high-rise for 24 x 24 m lots, unlike the first (a single slab): a cross-shaped sixteen-storey tower (a plus-shaped plan) with simple separate windows, balconies with solid parapets tucked into its inside corners, a water_tank on the roof, and a small paved court with benches and tree_spots at its foot. Low wealth: a plain, economical tower with simple balconies and pastel panels.
```

### Industrial park, manufacturing, U of halls (`I213-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Industrial park (industry, high density, manufacturing). Save as I213-3.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 5 storeys, about 23 m to the roof. Budget 2,500 triangles.
A second industrial park for 24 x 24 m lots, unlike the first (an office tower beside two halls): three mid-sized sheet-metal halls in a U around a central yard, each with roller doors facing the yard, a two-storey office bridging the front of the U over the yard entrance, and lawns with tree_spots along the street. Manufacturing: clean and modern, in greys, white and blue, with roller doors and a small office. No smoke.
```

### Industrial park, manufacturing, business units (`I213-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Industrial park (industry, high density, manufacturing). Save as I213-4.glb.
Lot 32 x 32 m (4 x 4 cells of 8 m, 32 m along the road); the front is on the road, facing -Z. 5 storeys, about 23 m to the roof. Budget 3,500 triangles.
A second industrial park for 32 x 32 m lots, unlike the first (halls and an office around a car park): two rows of two-storey business units facing each other across a shared lane, each unit with a roller door (garage_door) and an office window above it, a gatehouse at the lane's entrance, a five-storey office block at one front corner, and lawns with tree_spots along the street. Manufacturing: clean and modern, in greys, white and blue, with roller doors and a small office. No smoke.
```

### Plant, heavy industry, boiler house (`I003-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Plant (industry, low density, heavy industry). Save as I003-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,200 triangles.
A second compact plant for lots 16 m wide, unlike the first (a hall with an office at the corner): a brick boiler house with a tall square chimney (smoke_stack) at one corner, two squat round tanks on chunky legs, a lean-to coal shed with heaps of coal, and a roller door (garage_door) in a bright colour. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Plant, manufacturing, bottling plant (`I013-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Plant (industry, low density, manufacturing). Save as I013-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A second plant for 24 x 24 m lots, unlike the first (sawtooth halls with an office): a bottling plant, a long hall under a shallow gabled roof with a row of roof lights, a glazed corridor linking it to a three-storey office at the front, four tall white tanks in a row, and a truck bay under a canopy. Manufacturing: clean and modern, in greys, white and blue, with roller doors and a small office. No smoke.
```

### Plant, heavy industry, cement works (`I003-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Plant (industry, low density, heavy industry). Save as I003-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A second plant for 24 x 24 m lots, unlike the first (a brick hall with an office): a cement works with a tall cylindrical kiln building, two tall silos, a covered conveyor between them on chunky legs, a smoke_stack, and grey heaps of aggregate in the yard. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Assembly works, heavy industry, crane runway (`I102-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Assembly works (industry, medium density, heavy industry). Save as I102-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 2,000 triangles.
A second assembly works for 24 x 24 m lots, unlike the first (two connected brick halls): one big brick hall with two huge doors (garage_door), an overhead crane runway on chunky legs running out of its end into the yard, a lean-to office, and stacked steel beams as chunky blocks in the yard. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Assembly works, manufacturing, L-shaped hall (`I112-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Assembly works (industry, medium density, manufacturing). Save as I112-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 2,000 triangles.
A second assembly works for 24 x 24 m lots, unlike the first (two connected sawtooth halls): an L-shaped hall wrapped around a loading yard, a flat roof with rows of roof lights, four loading bays with roller doors facing the yard, and a two-storey office with a canopy at the front. Manufacturing: clean and modern, in greys, white and blue, with roller doors and a small office. No smoke.
```

### Industrial park, heavy industry, refinery (`I203-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Industrial park (industry, high density, heavy industry). Save as I203-4.glb.
Lot 32 x 32 m (4 x 4 cells of 8 m, 32 m along the road); the front is on the road, facing -Z. 5 storeys, about 23 m to the roof. Budget 3,500 triangles.
A second industrial park for 32 x 32 m lots, unlike the first (brick halls, an office tower and a chimney): a refinery, with a tall process tower wrapped in chunky pipework (at least 0.5 m thick), four big round tanks, a brick control building, a tall flare stack (smoke_stack), and pipe racks on chunky legs between them. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

## Batch 24: Towers on lots with no design yet (10)

Commercial towers and headquarters on lots 16 m wide, low-wealth headquarters on 24 m lots, and plain skyline towers on 24 x 24 m lots: no design fits these yet, so they are always generated.

### Commercial tower, low wealth, slab on shops (`C202-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Commercial tower (shops and offices, high density, low wealth). Save as C202-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 16 storeys, about 58 m to the roof. Budget 2,200 triangles.
A commercial tower for lots 16 m wide: a sixteen-storey slab on a two-storey shopping podium with shopfronts (shop_glass) and awnings along the front, separate windows in light walls, a sign panel at the top of the front, and a plant room on the roof. Low wealth: a plainer, economical tower with simpler shapes and fewer flourishes.
```

### Commercial tower, low wealth, two blocks (`C202-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Commercial tower (shops and offices, high density, low wealth). Save as C202-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 16 storeys, about 58 m to the roof. Budget 2,200 triangles.
A second commercial tower for lots 16 m wide, unlike the other (a slab on a shopping podium): two blocks, a twelve-storey one at the front and a sixteen-storey one behind it, with bold horizontal stripes in two wall colours (wall and wall_alt), an arcade of shops behind chunky columns on the ground floor, and a sign panel on top of each block. Low wealth: a plainer, economical tower with simpler shapes and fewer flourishes.
```

### Commercial tower, medium wealth, stone on shops (`C212-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Commercial tower (shops and offices, high density, medium wealth). Save as C212-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 16 storeys, about 58 m to the roof. Budget 2,200 triangles.
A commercial tower for lots 16 m wide: a sixteen-storey tower in stone with separate windows, a three-storey shopping podium with display windows (shop_glass) and a deep canopy, a setback with planters at the eleventh floor, and a crown in two tiers with the plant room inside. Medium wealth: a smart tower in stone and glass.
```

### Commercial tower, medium wealth, chamfered (`C212-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Commercial tower (shops and offices, high density, medium wealth). Save as C212-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 16 storeys, about 58 m to the roof. Budget 2,200 triangles.
A second commercial tower for lots 16 m wide, unlike the other (stone on a shopping podium): a slim tower with its front corners cut off at an angle, alternating bands of stone (wall) and rows of separate windows, a two-storey arcade of shops behind chunky columns, and a roof terrace with a pavilion. Medium wealth: a smart tower in stone and glass.
```

### Headquarters, low wealth, plain grid (`C203-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Headquarters (shops and offices, high density, low wealth). Save as C203-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 2,500 triangles.
A headquarters tower for lots 16 m wide: a plain, slim 26-storey tower in light concrete with separate windows in a regular grid, its top six floors a little narrower with a sign panel on the front, a two-storey lobby with a deep canopy, and a little forecourt with planters. Low wealth: a plainer, economical tower with simpler shapes and fewer flourishes.
```

### Headquarters, low wealth, stacked blocks (`C203-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Headquarters (shops and offices, high density, low wealth). Save as C203-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 2,500 triangles.
A second headquarters tower for lots 16 m wide, unlike the other (a plain slim tower): three stacked blocks, each a little smaller than the one below and shifted to one side, separate windows in two wall colours (wall and wall_alt), a plant room and a big sign panel on the top block, and an entrance canopy. Low wealth: a plainer, economical tower with simpler shapes and fewer flourishes.
```

### Headquarters, low wealth, broad on a podium (`C203-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Headquarters (shops and offices, high density, low wealth). Save as C203-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 2,800 triangles.
A headquarters tower for 24 x 24 m lots: a broad 26-storey tower with cut-off corners on a four-storey podium that covers most of the lot, simple separate windows in light walls, a sign panel near the top of the front, and a plant room on the roof. Low wealth: a plainer, economical tower with simpler shapes and fewer flourishes.
```

### Headquarters, low wealth, sky lobby (`C203-5.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Headquarters (shops and offices, high density, low wealth). Save as C203-5.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 2,800 triangles.
A second headquarters tower for 24 x 24 m lots, unlike the other (a broad tower on a podium): a 26-storey tower with a two-storey open sky lobby cut through it halfway up (the floors above stand on four chunky corner columns), separate windows in light panels, a sign panel near the top, and a plaza with planters and tree_spots in front. Low wealth: a plainer, economical tower with simpler shapes and fewer flourishes.
```

### Skyline residences, low wealth, broad slab (`R203-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Skyline residences (homes, high density, low wealth). Save as R203-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 24 storeys, about 72 m to the roof. Budget 2,800 triangles.
A plain, economical tower for 24 x 24 m lots, unlike the slender towers already in the game: a broad 24-storey slab across the lot with simple separate windows in pastel panels, rows of small balconies with solid parapets on the front and back, three lift and water_tank rooms on the roof, and a forecourt with benches. Low wealth: a plain, economical tower with simple balconies and pastel panels.
```

### Skyline residences, low wealth, square with a spine (`R203-5.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Skyline residences (homes, high density, low wealth). Save as R203-5.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 24 storeys, about 72 m to the roof. Budget 2,800 triangles.
A second plain tower for 24 x 24 m lots, unlike the broad slab: a square 24-storey tower with a stair tower running up one side like a spine, its top four floors in a contrasting colour (wall_alt), balconies with solid parapets in staggered pairs, a big water_tank on the roof, and a small paved court with planters. Low wealth: a plain, economical tower with simple balconies and pastel panels.
```

## Batch 25: Industry on lots with no design yet (18)

Warehouses on 16 x 16 m lots, assembly works on lots 16 m wide, and complexes, processing works and parks on 24 x 24 m lots: no design fits these yet.

### Warehouse, manufacturing, loading dock (`I012-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Warehouse (industry, low density, manufacturing). Save as I012-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 900 triangles.
A compact warehouse for a 16 x 16 m lot: a sheet-metal shed with a shallow gabled roof, a long loading dock with three roller doors (garage_door) under a canopy along the front, a small glazed office at one corner, and pallets stacked as chunky blocks. Manufacturing: clean and modern, in greys, white and blue, with roller doors and a small office. No smoke.
```

### Warehouse, manufacturing, high bay (`I012-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Warehouse (industry, low density, manufacturing). Save as I012-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 900 triangles.
A second compact warehouse for 16 x 16 m lots, unlike the other (a gabled shed with a loading dock): a tall high-bay storage block with a flat roof and a stepped parapet, one huge roller door, a truck bay with a canopy at the side, ribbed walls in two greys (wall and wall_alt), and a row of roof vents. Manufacturing: clean and modern, in greys, white and blue, with roller doors and a small office. No smoke.
```

### Assembly works, manufacturing, two halls (`I112-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Assembly works (industry, medium density, manufacturing). Save as I112-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,800 triangles.
Assembly works for lots 16 m wide: two sheet-metal halls one behind the other, the front one lower with a sawtooth roof and the back one taller with a flat roof, a loading dock with two roller doors down one side, and a small office with a canopy at the front. Manufacturing: clean and modern, in greys, white and blue, with roller doors and a small office. No smoke.
```

### Assembly works, manufacturing, glass front (`I112-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Assembly works (industry, medium density, manufacturing). Save as I112-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,800 triangles.
A second assembly works for lots 16 m wide, unlike the other (two halls one behind the other): one long hall under a shallow gabled roof with a strip of roof lights, a two-storey office with big windows across its whole front, two loading bays at the back, and a strip of car parking with painted bays (asphalt and paving). Manufacturing: clean and modern, in greys, white and blue, with roller doors and a small office. No smoke.
```

### Industrial complex, heavy industry, halls and silos (`I103-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Industrial complex (industry, medium density, heavy industry). Save as I103-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,200 triangles.
An industrial complex for 24 x 24 m lots: three brick halls of different heights around a small yard, two tall silos joined to the tallest hall by a covered bridge, a smoke_stack, and a heap of material in the yard. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Industrial complex, heavy industry, sawmill (`I103-5.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Industrial complex (industry, medium density, heavy industry). Save as I103-5.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,200 triangles.
A second complex for 24 x 24 m lots, unlike the other (brick halls around a yard): a sawmill, with a long open-sided saw shed, piles of logs as chunky cylinders, a drying kiln with a smoke_stack, and stacks of planks as chunky blocks in a timber yard. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Industrial park, heavy industry, works yard (`I203-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Industrial park (industry, high density, heavy industry). Save as I203-2.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 5 storeys, about 23 m to the roof. Budget 3,000 triangles.
An industrial park for 24 x 24 m lots: three brick buildings around a shared yard, a tall five-storey works block, a long shed and a boiler house with a smoke_stack, plus a heap of coal and a weighbridge office at the entrance. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Industrial park, heavy industry, scrapyard (`I203-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Industrial park (industry, high density, heavy industry). Save as I203-3.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 5 storeys, about 23 m to the roof. Budget 3,000 triangles.
A second industrial park for 24 x 24 m lots, unlike the other (brick buildings around a yard): a recycling works, with a big open-sided shed, a crane gantry on chunky legs over heaps of scrap, two shredder buildings, and stacks of crushed scrap bales as chunky blocks. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Warehouse, heavy industry, brick storehouse (`I002-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Warehouse (industry, low density, heavy industry). Save as I002-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 900 triangles.
A compact warehouse for a 16 x 16 m lot: a brick storehouse with a gabled roof, two big garage_doors on a loading dock along the front, a small lean-to office, and stacked crates and sacks as chunky blocks in a corner yard. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Warehouse, heavy industry, lean-to shed (`I002-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Warehouse (industry, low density, heavy industry). Save as I002-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 900 triangles.
A second compact warehouse for 16 x 16 m lots, unlike the other (a gabled brick storehouse): a rusty corrugated-metal shed with a single-slope roof rising to a tall front, three roller doors (garage_door), a loading canopy along the front, and a yard with a heap of scrap metal and drums as chunky cylinders. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Assembly works, heavy industry, brick halls (`I102-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Assembly works (industry, medium density, heavy industry). Save as I102-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,800 triangles.
Assembly works for lots 16 m wide: a long brick hall with a gabled roof running back from the street, a lower hall alongside it with three loading docks under a canopy, a short smoke_stack, and a yard with stacked steel beams as chunky blocks. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Assembly works, heavy industry, monitor roof (`I102-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Assembly works (industry, medium density, heavy industry). Save as I102-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,800 triangles.
A second assembly works for lots 16 m wide, unlike the other (brick halls side by side): a tall hall with a raised monitor roof (a strip of high windows along the ridge under its own little roof), a crane runway on chunky legs running out of its end door into the back yard, a two-storey office at the front, and drums and pallets in the yard. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Industrial complex, manufacturing, sawtooth and office (`I113-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Industrial complex (industry, medium density, manufacturing). Save as I113-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,200 triangles.
An industrial complex for 24 x 24 m lots: a big sawtooth hall at the back, a three-storey office block and a smaller workshop at the front either side of the yard entrance, two tanks, and a covered loading bay. Manufacturing: clean and modern, in greys, white and blue, with roller doors and a small office. No smoke.
```

### Industrial complex, manufacturing, food factory (`I113-5.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Industrial complex (industry, medium density, manufacturing). Save as I113-5.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,200 triangles.
A second complex for 24 x 24 m lots, unlike the other (a sawtooth hall with an office): a food factory, with a tall flat-roofed production block, a row of six slim silos, a covered conveyor bridge between them, a one-storey canteen with a canopy, and a truck yard. Manufacturing: clean and modern, in greys, white and blue, with roller doors and a small office. No smoke.
```

### Processing works, manufacturing, tanks and packing hall (`I212-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Processing works (industry, high density, manufacturing). Save as I212-2.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 4 storeys, about 19 m to the roof. Budget 2,600 triangles.
Processing works for 24 x 24 m lots: a tall, clean process building in grey and blue, four white tanks in a row, a covered bridge to a lower packing hall with two roller doors, and a strip of car parking. Manufacturing: clean and modern, in greys, white and blue, with roller doors and a small office. No smoke.
```

### Processing works, manufacturing, tank platform (`I212-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Processing works (industry, high density, manufacturing). Save as I212-3.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 4 storeys, about 19 m to the roof. Budget 2,600 triangles.
Second processing works for 24 x 24 m lots, unlike the other (a process building with a row of tanks): a cluster of tall metal tanks on a raised platform, a control room with big windows, a long low hall with loading bays, and chunky pipework (at least 0.5 m thick) between them. Manufacturing: clean and modern, in greys, white and blue, with roller doors and a small office. No smoke.
```

### Processing works, heavy industry, process tower (`I202-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Processing works (industry, high density, heavy industry). Save as I202-2.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 4 storeys, about 19 m to the roof. Budget 2,600 triangles.
Processing works for 24 x 24 m lots: a tall brick process tower, two big round tanks, chunky pipework (at least 0.5 m thick) on pipe racks linking them, a lower boiler house with a smoke_stack, and a yard with drums. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Processing works, heavy industry, ore crusher (`I202-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Processing works (industry, high density, heavy industry). Save as I202-3.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 4 storeys, about 19 m to the roof. Budget 2,600 triangles.
Second processing works for 24 x 24 m lots, unlike the other (a process tower with tanks): an ore-crushing plant, with a covered conveyor sloping up to the top of a tall crusher house, a big heap of ore at its foot, a row of three hoppers on chunky legs, and a smoke_stack. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

## Batch 26: Third designs for the most common buildings (10)

Not needed for coverage, but these ten building types stand on hundreds of lots each (cottages alone on more than 3,000 in the test cities), so a third design means far fewer repeats along a street.

### Cottage, low wealth, A-frame (`R001-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Cottage (homes, low density, low wealth). Save as R001-3.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 3 m to the roof. Budget 600 triangles.
A third cottage, unlike the others (a pitched roof with a chimney, and a hipped roof with a veranda): an A-frame cottage whose steep roof comes down almost to the ground on both sides, the front gable filled with separate windows above a door, a deck across the front, a chimney at the back, a front garden with a path, a low hedge along the sides, and a back garden with a tree_spot. Detached: keep it narrower than the lot. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

### Villa, low wealth, long with a garage (`R003-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Villa (homes, low density, low wealth). Save as R003-4.glb.
Lot 8 x 24 m (1 x 3 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 1,100 triangles.
A long, narrow villa for an 8 x 24 m lot, detached, unlike the others (8 x 16 m houses with gardens behind): a two-storey house about 6.5 m wide at the front, joined by a one-storey link to a garage at the back, a narrow drive down one side to the garage_door, a front garden with a path, and a garden between house and garage with a tree_spot. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

### Townhouses, low wealth, mansard terrace (`R101-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Townhouses (homes, medium density, low wealth). Save as R101-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 9 m to the roof. Budget 1,400 triangles.
A third terrace, unlike the others (one long pitched roof, and two gabled houses): three townhouses under a mansard roof with dormers, a bay window on each ground floor, front doors under small shared porch roofs, walls in alternating colours (wall and wall_alt), and small back yards, one with a tree_spot. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

### Courtyard apartments, medium wealth, stepped gable (`R113-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Courtyard apartments (homes, medium density, medium wealth). Save as R113-4.glb.
Site 8 x 16 m: one narrow building; the game stands two or three copies side by side on lots 16 or 24 m wide. The front is on the road, facing -Z. 6 storeys, about 18 m to the roof. Budget 1,500 triangles.
A third narrow six-storey apartment house, a row building, unlike the others (one with a cornice, one with a mansard and a turret): it fills the whole 8 m width with plain party walls on both sides. A stepped gable rising above the roof at the front, tall windows in pairs, a front door up three steps under a canopy, and a small balcony with a solid parapet on the second floor. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### Courtyard apartments, low wealth, shop below (`R103-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Courtyard apartments (homes, medium density, low wealth). Save as R103-4.glb.
Site 8 x 16 m: one narrow building; the game stands two or three copies side by side on lots 16 or 24 m wide. The front is on the road, facing -Z. 6 storeys, about 18 m to the roof. Budget 1,500 triangles.
A third narrow six-storey apartment house, a row building, unlike the others (a brick tenement, and a rendered block with a stair window): it fills the whole 8 m width with plain party walls on both sides. A small shop at street level with a big window and an awning beside the entrance, stacked bay windows in a contrasting colour above, and a flat roof with a water_tank. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

### Villa, medium wealth, flat roof terrace (`R013-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Villa (homes, low density, medium wealth). Save as R013-4.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 900 triangles.
A third narrow villa for an 8 m wide lot, detached, unlike the others (one with a dormer, one with its gable to the street): a two-storey house about 6.5 m wide with a flat roof and a roof terrace behind a solid parapet, a full-height bay of stacked windows at the front, a carport on chunky posts at the side, a front garden with a path, and a back garden with a tree_spot. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### Factory, heavy industry, textile mill (`I101-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Factory (industry, medium density, heavy industry). Save as I101-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A third factory, unlike the others (halls with an office at the front): a textile mill, a three-storey brick mill building with rows of tall windows, a square stair tower with a pitched cap, a tall round smoke_stack beside a boiler house, and a yard with bales as chunky blocks. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Workshop, manufacturing, two-storey unit (`I011-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Workshop (industry, low density, manufacturing). Save as I011-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 800 triangles.
A third workshop, unlike the others (sheds with roller doors): a two-storey light-industrial unit with a flat roof, two roller doors (garage_door) in bright colours, an office with a big window above them, a parking bay at the front, and a row of ac_units on the roof. Manufacturing: clean and modern, in greys, white and blue, with roller doors and a small office. No smoke.
```

### Workshop, heavy industry, forge (`I001-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Workshop (industry, low density, heavy industry). Save as I001-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 800 triangles.
A third workshop, unlike the others (a brick shed with a chimney, and two sheds side by side): a forge, a brick shed with a big open-fronted bay under a deep canopy, a squat smoke_stack, stacks of metal bars as chunky blocks, and a small yard with drums. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Factory, manufacturing, single-slope hall (`I111-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Factory (industry, medium density, manufacturing). Save as I111-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A third factory, unlike the others (sawtooth halls): a modern hall under a single-slope roof rising toward the back with a band of high windows, a two-storey office cube with big windows at the front corner, two loading bays with canopies on the side, and a strip of lawn with tree_spots along the street. Manufacturing: clean and modern, in greys, white and blue, with roller doors and a small office. No smoke.
```

## Batch 27: Rich homes (18)

High-wealth homes sized for the lots they stand on: cottages, family houses and villas on 8 m lots, apartments on 16 m lots and in narrow rows, and towers on 16 and 24 m lots. The first batch's rich homes only fit their type's own full lot.

### Cottage, high wealth, modern (`R021-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Cottage (homes, low density, high wealth). Save as R021-2.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 3 m to the roof. Budget 600 triangles.
A second cottage, unlike the first (a pitched roof and a pool): a one-storey modern cottage with a flat roof and deep overhangs, tall windows facing the garden, a stone chimney, a front garden with clipped hedges and a paved path, and a back garden with a small pool (water) and a tree_spot. Detached: keep it narrower than the lot. High wealth: grand and generous, white or pale stone walls, bigger windows, columns or deep porches, clipped hedges, and a pool (water) where there's room.
```

### Villa, high wealth, loggia (`R023-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Villa (homes, low density, high wealth). Save as R023-2.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 1,000 triangles.
A narrow villa for an 8 m wide lot, detached: a two-storey house about 6.5 m wide with white walls, a low terracotta roof with deep eaves, an arched loggia across the front on chunky pillars with a balcony with a solid parapet above it, a narrow drive, and a back garden with a small pool (water) and a tree_spot. High wealth: grand and generous, white or pale stone walls, bigger windows, columns or deep porches, clipped hedges, and a pool (water) where there's room.
```

### Villa, high wealth, brick and chimneys (`R023-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Villa (homes, low density, high wealth). Save as R023-3.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 1,000 triangles.
A second narrow villa for an 8 m wide lot, detached, unlike the other (white walls and an arched loggia): a brick villa about 6.5 m wide with a steep slate-coloured roof, two tall chimneys, a gabled two-storey bay at the front, a porch with a stone surround, a narrow drive to a garage_door at the back, and clipped hedges along the front. High wealth: grand and generous, white or pale stone walls, bigger windows, columns or deep porches, clipped hedges, and a pool (water) where there's room.
```

### Family house, high wealth, stone porch (`R022-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Family house (homes, low density, high wealth). Save as R022-2.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 900 triangles.
A narrow family house for an 8 m wide lot, detached: a two-storey house in pale stone about 6 m wide under a hipped roof, a porch on two chunky columns, tall windows, a narrow drive to a garage_door at the side, clipped hedges along the front, and a back garden with a tree_spot. High wealth: grand and generous, white or pale stone walls, bigger windows, columns or deep porches, clipped hedges, and a pool (water) where there's room.
```

### Family house, high wealth, modern overhang (`R022-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Family house (homes, low density, high wealth). Save as R022-3.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 900 triangles.
A second narrow family house for an 8 m wide lot, detached, unlike the other (pale stone with a columned porch): a white modern house with a flat roof, its upper floor jutting out over the ground floor at the front to shelter the door, big windows, a roof terrace with planters, a narrow drive, and a back garden with a small pool (water). High wealth: grand and generous, white or pale stone walls, bigger windows, columns or deep porches, clipped hedges, and a pool (water) where there's room.
```

### Courtyard apartments, high wealth, stone and mansard (`R123-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Courtyard apartments (homes, medium density, high wealth). Save as R123-2.glb.
Site 8 x 16 m: one narrow building; the game stands two or three copies side by side on lots 16 or 24 m wide. The front is on the road, facing -Z. 6 storeys, about 18 m to the roof. Budget 1,600 triangles.
A narrow six-storey apartment house, a row building: it fills the whole 8 m width with plain party walls on both sides. A pale stone front with tall windows, small balconies with solid stone parapets, a grand front door with steps and a canopy, a deep cornice, and a mansard top floor with dormers. High wealth: grand and generous, white or pale stone walls, bigger windows, columns or deep porches, clipped hedges, and a pool (water) where there's room.
```

### Courtyard apartments, high wealth, deep terraces (`R123-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Courtyard apartments (homes, medium density, high wealth). Save as R123-3.glb.
Site 8 x 16 m: one narrow building; the game stands two or three copies side by side on lots 16 or 24 m wide. The front is on the road, facing -Z. 6 storeys, about 18 m to the roof. Budget 1,600 triangles.
A second narrow apartment house, a row building, unlike the other (stone with a mansard): it fills the whole 8 m width with plain party walls on both sides. A white modern front with deep terraces on every floor behind solid parapets, big windows set back from the terraces, a roof garden with a pavilion, and an entrance with a canopy. High wealth: grand and generous, white or pale stone walls, bigger windows, columns or deep porches, clipped hedges, and a pool (water) where there's room.
```

### Apartment block, high wealth, stone terraces (`R122-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Apartment block (homes, medium density, high wealth). Save as R122-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 12 m to the roof. Budget 1,400 triangles.
A compact apartment block for a 16 x 16 m lot: four storeys in pale stone with deep terraces behind solid parapets across the front, a set-back top floor with a roof garden, a grand entrance with a canopy, and a front garden with clipped hedges. High wealth: grand and generous, white or pale stone walls, bigger windows, columns or deep porches, clipped hedges, and a pool (water) where there's room.
```

### Apartment block, high wealth, stepped corners (`R122-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Apartment block (homes, medium density, high wealth). Save as R122-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 12 m to the roof. Budget 1,400 triangles.
A second compact apartment block for 16 x 16 m lots, unlike the other (pale stone with deep terraces): a block with stepped corners, horizontal bands in two colours (wall and wall_alt), corner windows, a tall entrance bay with a canopy, and a front garden with a small pool (water). High wealth: grand and generous, white or pale stone walls, bigger windows, columns or deep porches, clipped hedges, and a pool (water) where there's room.
```

### Townhouses, high wealth, white with porches (`R121-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Townhouses (homes, medium density, high wealth). Save as R121-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 9 m to the roof. Budget 1,400 triangles.
A second terrace, unlike the first (houses under one long roof): three tall white townhouses with flat roofs and roof terraces, each with a columned porch at the top of wide front steps, tall first-floor windows with balconies with solid parapets, and small back gardens with clipped hedges. High wealth: grand and generous, white or pale stone walls, bigger windows, columns or deep porches, clipped hedges, and a pool (water) where there's room.
```

### Residential tower, high wealth, zigzag terraces (`R221-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Residential tower (homes, high density, high wealth). Save as R221-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 10 storeys, about 30 m to the roof. Budget 2,000 triangles.
A second residential tower, unlike the first (a tower on a wide podium): a straight ten-storey tower in white with deep terraces behind solid parapets that switch sides from floor to floor so the tower zigzags, a roof garden with a pavilion, and a landscaped entrance with a small pool (water). High wealth: an elegant tower in white and pale stone, with deep terraces behind solid parapets and a rooftop garden.
```

### High-rise, high wealth, corner terraces (`R222-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: High-rise (homes, high density, high wealth). Save as R222-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 16 storeys, about 48 m to the roof. Budget 2,200 triangles.
A high-rise for lots 16 m wide: an elegant sixteen-storey tower in white and pale stone, deep corner terraces behind solid parapets, tall lobby windows, a set-back top floor with a roof garden, and a forecourt with a small pool (water) and planters. High wealth: an elegant tower in white and pale stone, with deep terraces behind solid parapets and a rooftop garden.
```

### High-rise, high wealth, stepped crown (`R222-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: High-rise (homes, high density, high wealth). Save as R222-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 16 storeys, about 48 m to the roof. Budget 2,200 triangles.
A second high-rise for lots 16 m wide, unlike the other (white with corner terraces): a slender tower in pale stone with balconies with solid parapets in a vertical stripe up the front, tall arched windows on its top two floors under a stepped crown, and a grand entrance with a canopy. High wealth: an elegant tower in white and pale stone, with deep terraces behind solid parapets and a rooftop garden.
```

### High-rise, high wealth, L around a garden (`R222-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: High-rise (homes, high density, high wealth). Save as R222-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 16 storeys, about 48 m to the roof. Budget 2,500 triangles.
A second high-rise for 24 x 24 m lots, unlike the first (a single slim tower): two sixteen-storey slabs at right angles, making an L around a landscaped garden with a pool (water) and tree_spots, terraces behind solid parapets, and a pavilion on the roof. High wealth: an elegant tower in white and pale stone, with deep terraces behind solid parapets and a rooftop garden.
```

### Skyline residences, high wealth, wrapped terraces (`R223-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Skyline residences (homes, high density, high wealth). Save as R223-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 24 storeys, about 72 m to the roof. Budget 2,500 triangles.
A skyline tower for lots 16 m wide: an elegant 24-storey tower in white with deep terraces behind solid parapets wrapping its corners, a set-back crown of two floors with a roof garden and a pavilion, and a forecourt with a small pool (water). High wealth: an elegant tower in white and pale stone, with deep terraces behind solid parapets and a rooftop garden.
```

### Skyline residences, high wealth, three tiers (`R223-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Skyline residences (homes, high density, high wealth). Save as R223-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 24 storeys, about 72 m to the roof. Budget 2,500 triangles.
A second skyline tower for lots 16 m wide, unlike the other (white with wrapped terraces): a slim tower in pale stone with a stepped top in three tiers like an old skyscraper, tall separate windows, a sky garden halfway up, and a grand two-storey entrance with a canopy. High wealth: an elegant tower in white and pale stone, with deep terraces behind solid parapets and a rooftop garden.
```

### Skyline residences, high wealth, podium and pool (`R223-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Skyline residences (homes, high density, high wealth). Save as R223-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 24 storeys, about 72 m to the roof. Budget 2,800 triangles.
A skyline tower for 24 x 24 m lots: a 24-storey tower on a three-storey podium with a roof garden and a pool (water), the tower's corners cut back into stacked terraces with planters, white walls with separate windows, and a pavilion on top. High wealth: an elegant tower in white and pale stone, with deep terraces behind solid parapets and a rooftop garden.
```

### Skyline residences, high wealth, sky window (`R223-5.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Skyline residences (homes, high density, high wealth). Save as R223-5.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 24 storeys, about 72 m to the roof. Budget 2,800 triangles.
A second skyline tower for 24 x 24 m lots, unlike the other (a tower on a podium with a roof pool): a tower with a big square opening through its top four floors (a sky window held by the tower's sides), a roof garden at the bottom of the opening, tall separate windows, and a grand lobby with a canopy. High wealth: an elegant tower in white and pale stone, with deep terraces behind solid parapets and a rooftop garden.
```

## Batch 28: Rich shops and offices (19)

High-wealth shops on 8 m lots, offices, stores and shopping rows on 16 m lots, and towers on 16 and 24 m lots.

### Market hall, high wealth, stone arch (`C023-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Market hall (shops and offices, low density, high wealth). Save as C023-2.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. On a 16 m lot the game stands two copies side by side, so it fills its whole 8 m width with plain side walls. 2 storeys, about 8 m to the roof. Budget 700 triangles.
A small upmarket food hall: two storeys with a glass front (shop_glass) under a pale stone arch, an elegant canopy, baskets of produce as chunky blocks, and a sign panel above the arch. High wealth: upmarket, with big shop windows (shop_glass), pale stone and elegant canopies.
```

### Market hall, high wealth, flower market (`C023-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Market hall (shops and offices, low density, high wealth). Save as C023-3.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. On a 16 m lot the game stands two copies side by side, so it fills its whole 8 m width with plain side walls. 2 storeys, about 8 m to the roof. Budget 700 triangles.
A second small upmarket market, unlike the other (a glass front under a stone arch): a flower market with a pitched roof with long roof lights (glass) along both slopes, a glass front (shop_glass), and flower stalls as chunky blocks under a canopy. High wealth: upmarket, with big shop windows (shop_glass), pale stone and elegant canopies.
```

### Corner shop, high wealth, arched boutique (`C021-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Corner shop (shops and offices, low density, high wealth). Save as C021-2.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 500 triangles.
A second corner shop, unlike the first (a white box with a glass front): a boutique in pale stone with a tall arched shop window (shop_glass) and a matching arched door, an elegant canopy, a cornice with a sign panel, and two planters with clipped shrubs (hedge) by the door. High wealth: upmarket, with big shop windows (shop_glass), pale stone and elegant canopies.
```

### Shopfront, high wealth, glass in stone (`C022-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Shopfront (shops and offices, low density, high wealth). Save as C022-2.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 600 triangles.
An upmarket shop for an 8 x 8 m lot: a glass front (shop_glass) in a pale stone frame, a deep flat canopy, a sign panel on the parapet, and planters with clipped shrubs (hedge). High wealth: upmarket, with big shop windows (shop_glass), pale stone and elegant canopies.
```

### Shopfront, high wealth, mansard (`C022-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Shopfront (shops and offices, low density, high wealth). Save as C022-3.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 600 triangles.
A second upmarket shop for 8 x 8 m lots, unlike the other (a glass front in a stone frame): a one-storey shop under a tall slate-coloured mansard roof, two tall display windows (shop_glass) either side of a recessed door, and a sign panel on the fascia. High wealth: upmarket, with big shop windows (shop_glass), pale stone and elegant canopies.
```

### Department store, high wealth, arched stone (`C123-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Department store (shops and offices, medium density, high wealth). Save as C123-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 6 storeys, about 22 m to the roof. Budget 1,600 triangles.
A compact department store for a 16 x 16 m lot: six storeys in pale stone with tall arched display windows (shop_glass) on the ground floor, separate tall windows above, a grand central entrance with a canopy, and a rooftop cafe pavilion with planters. High wealth: upmarket, with big shop windows (shop_glass), pale stone and elegant canopies.
```

### Department store, high wealth, glass bay (`C123-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Department store (shops and offices, medium density, high wealth). Save as C123-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 6 storeys, about 22 m to the roof. Budget 1,600 triangles.
A second compact department store for 16 x 16 m lots, unlike the other (arched stone): a big full-height glass bay (window_band runs about 3-4 m) framed in white stone on the front, display windows (shop_glass) along the ground floor, a deep elegant canopy, and a roof terrace with a pavilion. High wealth: upmarket, with big shop windows (shop_glass), pale stone and elegant canopies.
```

### Department store, high wealth, cupola (`C123-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Department store (shops and offices, medium density, high wealth). Save as C123-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 6 storeys, about 22 m to the roof. Budget 2,000 triangles.
A second department store for 24 x 24 m lots, unlike the first (a glass box with a sign band): a grand store in pale stone with a chunky square cupola over the centre of the roof, arched display windows (shop_glass), a columned entrance, and a roof terrace with planters. High wealth: upmarket, with big shop windows (shop_glass), pale stone and elegant canopies.
```

### Shopping row, high wealth, stone arcade (`C121-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Shopping row (shops and offices, medium density, high wealth). Save as C121-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 11 m to the roof. Budget 1,400 triangles.
A second shopping row, unlike the first (three shops under two plain floors): an arcade of four upmarket shops behind a row of stone arches, offices above behind tall windows, a slate-coloured mansard roof with dormers, and planters along the front. High wealth: upmarket, with big shop windows (shop_glass), pale stone and elegant canopies.
```

### Office block, high wealth, glazed hall (`C122-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Office block (shops and offices, medium density, high wealth). Save as C122-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 15 m to the roof. Budget 1,400 triangles.
A compact office block for a 16 x 16 m lot: four storeys in pale stone with tall separate windows, a two-storey glazed entrance hall with an elegant canopy, a roof garden with planters, and clipped hedges along the front. High wealth: upmarket, with big shop windows (shop_glass), pale stone and elegant canopies.
```

### Office block, high wealth, white fins (`C122-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Office block (shops and offices, medium density, high wealth). Save as C122-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 15 m to the roof. Budget 1,400 triangles.
A second compact office for 16 x 16 m lots, unlike the other (pale stone with a glazed hall): a modern office with white vertical fins between tall windows, a top floor set back behind a roof terrace, a deep entrance canopy, and a small water garden (water) at the front. High wealth: upmarket, with big shop windows (shop_glass), pale stone and elegant canopies.
```

### Office tower, high wealth, stone piers (`C221-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Office tower (shops and offices, high density, high wealth). Save as C221-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 10 storeys, about 36 m to the roof. Budget 1,800 triangles.
A second office tower, unlike the first (a dark glass tower with a frame on top): a ten-storey tower in pale stone with tall windows between vertical piers, a stepped top with a roof garden, and a grand two-storey lobby with an elegant canopy. High wealth: a landmark tower in pale stone with tall windows, an elegant crown and a grand canopy.
```

### Commercial tower, high wealth, shop podium (`C222-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Commercial tower (shops and offices, high density, high wealth). Save as C222-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 16 storeys, about 58 m to the roof. Budget 2,200 triangles.
A commercial tower for lots 16 m wide: a sixteen-storey tower in pale stone on a three-storey podium of upmarket shops (shop_glass) with elegant canopies, a set-back crown with a roof garden, and planters at its foot. High wealth: a landmark tower in pale stone with tall windows, an elegant crown and a grand canopy.
```

### Commercial tower, high wealth, lantern (`C222-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Commercial tower (shops and offices, high density, high wealth). Save as C222-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 16 storeys, about 58 m to the roof. Budget 2,200 triangles.
A second commercial tower for lots 16 m wide, unlike the other (stone on a shop podium): a slim tower whose corners are cut back every four floors into terraces with planters, tall separate windows in white walls, and a lantern room (a smaller box with tall windows) as its crown. High wealth: a landmark tower in pale stone with tall windows, an elegant crown and a grand canopy.
```

### Commercial tower, high wealth, slotted (`C222-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Commercial tower (shops and offices, high density, high wealth). Save as C222-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 16 storeys, about 58 m to the roof. Budget 2,500 triangles.
A second commercial tower for 24 x 24 m lots, unlike the first (a glass tower with a stepped crown): a tower with a deep vertical slot of terraces down the middle of each face, on a four-storey podium with an arcade of shops and a roof garden, and an elegant crown. High wealth: a landmark tower in pale stone with tall windows, an elegant crown and a grand canopy.
```

### Headquarters, high wealth, pyramid crown (`C223-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Headquarters (shops and offices, high density, high wealth). Save as C223-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 2,500 triangles.
A landmark headquarters tower for lots 16 m wide: a slim 26-storey tower in pale stone with tall windows, a crown that tapers to a pointed top (a chunky pyramid), a sign panel near the top, and a two-storey entrance with a colonnade. High wealth: a landmark tower in pale stone with tall windows, an elegant crown and a grand canopy.
```

### Headquarters, high wealth, slim lantern (`C223-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Headquarters (shops and offices, high density, high wealth). Save as C223-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 2,500 triangles.
A second landmark headquarters for lots 16 m wide, unlike the other (stone with a pyramid crown): a white tower that narrows at the top into a slim lantern with a flat roof, a sky garden halfway up, tall windows, and a grand canopy over the entrance. High wealth: a landmark tower in pale stone with tall windows, an elegant crown and a grand canopy.
```

### Headquarters, high wealth, stacked crown (`C223-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Headquarters (shops and offices, high density, high wealth). Save as C223-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 2,800 triangles.
A landmark headquarters for 24 x 24 m lots: a 26-storey tower on a four-storey podium with a roof garden, the top six floors stepping back into a crown of stacked, shrinking boxes, tall windows in pale stone, and a plaza with a fountain (water) and tree_spots. High wealth: a landmark tower in pale stone with tall windows, an elegant crown and a grand canopy.
```

### Headquarters, high wealth, gateway (`C223-5.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Headquarters (shops and offices, high density, high wealth). Save as C223-5.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 2,800 triangles.
A second landmark headquarters for 24 x 24 m lots, unlike the other (a tower on a podium with a stacked crown): a broad tower with a tall open archway through its base (a gateway to a garden behind), tall windows, a flat crown with a roof garden, and a sign panel near the top. High wealth: a landmark tower in pale stone with tall windows, an elegant crown and a grand canopy.
```

## Batch 29: High-tech industry (20)

High-tech industry sized for the lots it stands on. The first batch's high-tech models only fit their type's own full lot, and they are all white boxes with solar panels, so these vary the shapes too.

### Factory, high-tech, arched solar roof (`I121-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Factory (industry, medium density, high-tech). Save as I121-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A second high-tech factory, unlike the first (a white hall with an office): an electronics works with a long hall under a shallow arched roof covered in solar panels, a two-storey office with big windows across its front, and a landscaped entrance with a pond (water). High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Workshop, high-tech, prototype lab (`I021-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Workshop (industry, low density, high-tech). Save as I021-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 800 triangles.
A second small high-tech workshop, unlike the first (a white shed with solar panels and a dish): a prototype lab with a green roof (grass), a big glass front (shop_glass) showing the workshop, a white roller door, a small test dome (a chunky half-sphere), and a landscaped yard with tree_spots. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Industrial complex, high-tech, lab and atrium (`I123-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Industrial complex (industry, medium density, high-tech). Save as I123-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,000 triangles.
A high-tech complex for lots 16 m wide: a three-storey research lab in white with rows of windows, a glazed atrium linking it to a lower clean-room hall at the back, rooftop air units, a satellite dish, and lawns with tree_spots. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Industrial complex, high-tech, battery plant (`I123-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Industrial complex (industry, medium density, high-tech). Save as I123-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,000 triangles.
A second high-tech complex for lots 16 m wide, unlike the other (a lab joined to a hall by an atrium): a battery plant with a long hall, a row of white tanks, a tall glazed stair tower, and a green roof (grass) on the office wing. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Plant, high-tech, clean room (`I023-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Plant (industry, low density, high-tech). Save as I023-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,200 triangles.
A compact high-tech plant for a 16 x 16 m lot: a white clean-room block with a band of windows, a row of rooftop air units, a tall gas tank on chunky legs, a glazed entrance, and lawns with tree_spots. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Plant, high-tech, round reception (`I023-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Plant (industry, low density, high-tech). Save as I023-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,200 triangles.
A second compact high-tech plant for 16 x 16 m lots, unlike the other (a white clean-room block): a biotech lab with a sawtooth roof of solar panels, a round two-storey reception building with big windows at the front, and a small pond (water) with a tree_spot. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Plant, high-tech, data centre (`I023-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Plant (industry, low density, high-tech). Save as I023-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A second high-tech plant for 24 x 24 m lots, unlike the first (white blocks with solar panels): a data centre, a long windowless white hall with rows of big cooling units on its roof, a glazed office at the front, a backup generator building, and a hedge along the street. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Big factory, high-tech, barrel vault (`I221-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Big factory (industry, high density, high-tech). Save as I221-2.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,500 triangles.
A second high-tech big factory, unlike the first (a white hall with solar panels): one huge hall under a barrel-vaulted roof (a half-cylinder) with glazed ends, a three-storey office block at the front with a satellite dish, and lawns with tree_spots. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Assembly works, high-tech, visitor gallery (`I122-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Assembly works (industry, medium density, high-tech). Save as I122-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,800 triangles.
High-tech assembly works for lots 16 m wide: a robot assembly hall in white with a band of high windows, a glazed visitor gallery along the front, rows of solar panels on the roof, two loading bays, and lawns with tree_spots. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Assembly works, high-tech, green slope (`I122-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Assembly works (industry, medium density, high-tech). Save as I122-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,800 triangles.
A second high-tech assembly works for lots 16 m wide, unlike the other (a white hall with a visitor gallery): a hall with a green roof (grass) sloping down toward the back, a tall glass front, a satellite dish, and a landscaped strip of car parking. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Assembly works, high-tech, test drum (`I122-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Assembly works (industry, medium density, high-tech). Save as I122-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 2,000 triangles.
A second high-tech assembly works for 24 x 24 m lots, unlike the first (two white halls with solar panels): one big hall with a sawtooth roof of solar panels, a drum-shaped (cylindrical) test building beside it, a glazed office, and landscaped grounds with tree_spots. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Industrial complex, high-tech, courtyard campus (`I123-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Industrial complex (industry, medium density, high-tech). Save as I123-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,200 triangles.
A high-tech complex for 24 x 24 m lots: three white buildings around a landscaped courtyard with a pond (water), linked by glazed bridges, with solar panels on the roofs and a satellite dish. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Industrial complex, high-tech, assembly tower (`I123-5.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Industrial complex (industry, medium density, high-tech). Save as I123-5.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,200 triangles.
A second high-tech complex for 24 x 24 m lots, unlike the other (three buildings around a courtyard): a tall white assembly building with a huge door, a test dome (a chunky half-sphere), a lower office with a green roof (grass), and a landscaped forecourt. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Warehouse, high-tech, automated store (`I022-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Warehouse (industry, low density, high-tech). Save as I022-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 900 triangles.
A compact high-tech warehouse for a 16 x 16 m lot: a tall white automated store with a band of windows at the top, two loading bays with canopies, rows of solar panels on the roof, and a landscaped strip with tree_spots. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Warehouse, high-tech, green-roof shed (`I022-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Warehouse (industry, low density, high-tech). Save as I022-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 900 triangles.
A second compact high-tech warehouse for 16 x 16 m lots, unlike the other (a tall white store): a low distribution shed with a green roof (grass), a long office with big windows along its front, four loading bays at the side, and a row of charging posts as chunky blocks. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Processing works, high-tech, tanks and bridges (`I222-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Processing works (industry, high density, high-tech). Save as I222-2.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 4 storeys, about 19 m to the roof. Budget 2,600 triangles.
High-tech processing works for 24 x 24 m lots: a white process building with rows of rooftop air units, three tall white tanks linked by chunky pipe bridges (at least 0.5 m thick), a control room with big windows, and lawns with tree_spots. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Processing works, high-tech, clean-room tower (`I222-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Processing works (industry, high density, high-tech). Save as I222-3.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 4 storeys, about 19 m to the roof. Budget 2,600 triangles.
Second high-tech processing works for 24 x 24 m lots, unlike the other (tanks linked by pipe bridges): a pharmaceutical plant with a tall white clean-room tower with a band of windows at the top, a low lab wing with a green roof (grass), a small cooling pond (water), and a satellite dish. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Industrial park, high-tech, research tower (`I223-2.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Industrial park (industry, high density, high-tech). Save as I223-2.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 5 storeys, about 23 m to the roof. Budget 3,000 triangles.
A high-tech park for 24 x 24 m lots: a five-storey research building in white with big windows, a lower lab with a green roof (grass), a satellite dish, and a landscaped plaza with a pond (water) and tree_spots. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Industrial park, high-tech, ring lab (`I223-3.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Industrial park (industry, high density, high-tech). Save as I223-3.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 5 storeys, about 23 m to the roof. Budget 3,000 triangles.
A second high-tech park for 24 x 24 m lots, unlike the other (a research tower beside a lab): a two-storey lab in a square ring around a garden courtyard with tree_spots, a five-storey tower at one corner, and solar panels on the roofs. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```

### Industrial park, high-tech, pavilion campus (`I223-4.glb`)

```text
Citybloom model, following the model spec (v5) and style reference: Industrial park (industry, high density, high-tech). Save as I223-4.glb.
Lot 32 x 32 m (4 x 4 cells of 8 m, 32 m along the road); the front is on the road, facing -Z. 5 storeys, about 23 m to the roof. Budget 3,500 triangles.
A second high-tech park for 32 x 32 m lots, unlike the first (white blocks around a car park): a campus of four pavilions with green roofs (grass) around a central lawn with a pond (water) and tree_spots, joined by covered walkways, with a five-storey headquarters block at the front and a satellite dish. High-tech: sleek white buildings with big windows, solar panels on the roofs, and landscaped grounds with tree_spots. No smoke.
```
