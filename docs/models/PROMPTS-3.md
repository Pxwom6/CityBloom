# Citybloom model prompts, batch 3

Batch 2 put hand-made models on most buildings. Across the test cities (your two cities, the four careful-mayor cities, the menu's demo town, the fourteen scenario cities and the 110k bench city: 15,450 buildings), 92 % now wear one, but only 75 % in the bench city. The rest are generated for one of two reasons: no design fits their lot (most of those are skyline towers on 24 m lots in the bench city), or only one design fits it, and the game alternates a lone design with generated looks so a street isn't one building over and over.

These 13 models fill the biggest gaps. With them, about 97 % of the buildings in the test cities wear a hand-made model, and about 92 % in the bench city. Six extras at the end, if you have time, bring the bench city to about 94 %. Every one is an extra design (`-2` to `-5`) for a type that already has a model, so no file is replaced. High-wealth and high-tech buildings are still left out: only 9 of the 15,450 buildings are high-wealth or high-tech.

## How to use

1. Same as before: in Claude Design, start a canvas for a batch, attach `style-reference.png` and paste the model spec below once. It's version 4, with what batch 2 taught: lawns and paths 5 cm up, window bands in short runs, closed roofs, doors and signs that stand out from their walls, and towers with solid walls rather than all glass.
2. Paste one building prompt at a time, and download each model as a GLB with the file name in its prompt.
3. Add the files to `assets/models/`, next to the others. Claude Code checks them and brings them in.

The batches are in order of how many buildings they reach, so the first two matter most.

## The model spec

```text
Citybloom model spec (v4). Follow it for every model, and match the attached style reference sheet.

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

## Batch 17: Skyline towers (5)

Skyline residences on 24 x 24 m lots (105 in the bench city) have no design that fits, because the first `R213` is 32 m deep. The two 24 x 24 m towers fit those lots, and 24 x 32 m lots too (with a yard behind). The two 16 m towers give the 16 m lots a second design, so those stop alternating with generated towers. Headquarters on 24 x 24 m lots have no design either.

### Skyline residences, medium wealth, stepped (`R213-3.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Skyline residences (homes, high density, medium wealth). Save as R213-3.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 24 storeys, about 72 m to the roof. Budget 2,800 triangles.
A stepped tower, unlike the slender towers already in the game: a broad eight-storey base covering most of the lot, a narrower middle section set back from the ninth floor, and a slimmer top set back again from the seventeenth, like a wedding cake. Each setback is a roof terrace with planters (hedge boxes) behind a solid parapet. Warm walls with separate windows in pairs, corner balconies with solid parapets, a pyramid roof over a plant room at the top, and an entrance canopy over a small forecourt with a tree_spot. Medium wealth: a smart tower with generous balconies and a landscaped entrance.
```

### Skyline residences, medium wealth, twin towers (`R213-4.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Skyline residences (homes, high density, medium wealth). Save as R213-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 24 storeys, about 72 m to the roof. Budget 2,800 triangles.
Twin towers: two slim towers, each about 9 m square, side by side on a shared three-storey podium, joined near the top by a sky bridge two floors high. A roof garden on the podium between the towers (grass, paving and planters), a stripe of balconies with solid parapets in a bold colour (accent) up the front of each tower, a plant room on each flat roof, and an entrance canopy in the middle of the podium's front. Medium wealth: a smart tower with generous balconies and a landscaped entrance.
```

### Skyline residences, medium wealth, octagonal (`R213-5.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Skyline residences (homes, high density, medium wealth). Save as R213-5.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 24 storeys, about 72 m to the roof. Budget 2,500 triangles.
A second tower for lots 16 m wide, unlike the first (a dark glass tower with setbacks): an octagonal tower, a square about 14 m across with its corners cut off, in light walls with separate windows. Balconies with solid parapets on the four cut corners, a solid ring around the top floor as its crown with a plant room inside it, and a two-storey entrance pavilion with a canopy at the front. Medium wealth: a smart tower with generous balconies and a landscaped entrance.
```

### Skyline residences, low wealth, two slabs (`R203-3.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Skyline residences (homes, high density, low wealth). Save as R203-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 24 storeys, about 72 m to the roof. Budget 2,500 triangles.
A second tower for lots 16 m wide, plain and economical, unlike the first (a dark glass tower): two slabs 8 m wide side by side, one 24 storeys and one 20, the taller one standing a few metres further back. Simple separate windows in rows, small balconies with solid parapets, a lift room and a water_tank on each roof, and an entrance with a canopy. Low wealth: a plain, economical tower with simple balconies and pastel panels.
```

### Headquarters, medium wealth, stone and fins (`C213-3.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Headquarters (shops and offices, high density, medium wealth). Save as C213-3.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 2,800 triangles.
A headquarters tower, unlike the dark glass towers already in the game: pale stone walls with tall vertical fins (trim) between columns of separate windows, the top six floors stepping in twice, and a big open square frame on the roof as its crown (solid and chunky, hollow in the middle). A two-storey colonnade of chunky square columns across the lobby front, a sign panel above the entrance, and a small plaza with planters and tree_spots. Medium wealth: a smart tower in stone and glass.
```

## Batch 18: Small shops and houses (2)

Market halls on 8 m lots and narrow family houses have one design each, so half of them are generated: most in the scenario cities and the careful-mayor cities.

### Market hall, low wealth, false front (`C003-3.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Market hall (shops and offices, low density, low wealth). Save as C003-3.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. On a 16 m lot the game stands two copies side by side, so it fills its whole 8 m width with plain side walls. 2 storeys, about 8 m to the roof. Budget 600 triangles.
A small market shop, unlike the gabled market already in the game: a flat-roofed two-storey shop behind a tall stepped false front (a parapet that rises above the roof at the front, with a sign panel on it), a deep veranda roof across the front on chunky posts, produce stands and crates as chunky blocks under the veranda, a big shop window (shop_glass) and a door. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

### Family house, low wealth, gable to the street (`R002-3.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Family house (homes, low density, low wealth). Save as R002-3.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 800 triangles.
A third family house, unlike the first two (whose roof ridges run along the street): a two-storey house about 6 m wide with its gable end facing the street and a small window high in the gable, a flat-roofed one-storey entry porch across the front, a narrow drive down one side to a garage_door in a lean-to at the back corner, a front lawn with a path, and a back garden with a tree_spot. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

## Batch 19: Industry (3)

Second designs for the industrial complexes on 16 m lots and the big factories: about 130 buildings between them.

### Industrial complex, manufacturing, works block (`I113-3.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Industrial complex (industry, medium density, manufacturing). Save as I113-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,000 triangles.
A second complex for lots 16 m wide, unlike the first (sawtooth sheds and silos): a three-storey production building with long rows of separate windows, a glazed stair tower at the front corner, big chunky extraction ducts and ac_units on its flat roof, a covered loading bay with two garage_doors along one side, and a small car park at the front. Manufacturing: clean and modern, in greys, white and blue, with roller doors and a small office. No smoke.
```

### Big factory, manufacturing, clerestory hall (`I211-2.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Big factory (industry, high density, manufacturing). Save as I211-2.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,500 triangles.
A second big factory, unlike the first (one long sawtooth hall with an office wing): a large hall under a shallow gabled roof with a raised clerestory along its ridge (a strip of high windows under its own little roof), a row of chunky roof ventilators, three loading bays with canopies at the front, a two-storey office along one side, and a strip of car parking. Manufacturing: clean and modern, in greys, white and blue, with roller doors and a small office. No smoke.
```

### Industrial complex, heavy industry, foundry (`I103-3.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Industrial complex (industry, medium density, heavy industry). Save as I103-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,000 triangles.
A second complex for lots 16 m wide, unlike the first (brick sheds and tall chimneys): a foundry, with a tall brick hall under a raised clerestory roof, a squat round furnace stack (smoke_stack) beside it, a chunky enclosed conveyor on two sturdy legs rising from a heap of ore to the top of a square hopper tower, and a yard with stacked ingots as chunky blocks. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

## Batch 20: Shops and flats on 16 m lots (3)

Second designs for department stores, shopping rows and apartment blocks on 16 x 16 m lots: about 125 buildings.

### Department store, medium wealth, classic (`C113-3.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Department store (shops and offices, medium density, medium wealth). Save as C113-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 6 storeys, about 22 m to the roof. Budget 1,600 triangles.
A third department store, unlike the glass-banded stores already in the game: a classic building with a stone ground floor of tall arched display windows (shop_glass), upper floors in brick-coloured walls with separate tall windows in pairs, a deep cornice, and a raised central bay at the front under a small mansard roof. A canopy over the entrance, and rooftop plant set back from the edge. Medium wealth: tidy and smart, with better materials and planters.
```

### Shopping row, low wealth, colonnade (`C101-2.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Shopping row (shops and offices, medium density, low wealth). Save as C101-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 11 m to the roof. Budget 1,400 triangles.
A second shopping row, unlike the first (three shops with awnings under two plain floors): the ground floor is set back behind a row of chunky square columns, making a covered walkway along the front with four small shops, each a shop window and a door. Two floors of flats above with balconies with solid parapets, and a stepped parapet along the roof with a sign panel for each shop. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

### Apartment block, medium wealth, hipped roof (`R112-3.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Apartment block (homes, medium density, medium wealth). Save as R112-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 12 m to the roof. Budget 1,400 triangles.
A third apartment block, unlike the flat-roofed blocks already in the game: four storeys under a hipped roof with deep eaves, bay windows stacked up the front, recessed corner balconies, walls in two tones (wall and wall_alt), an entrance porch, and a front garden with a low hedge and a path. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

## Batch 21: Extras, if you have time (6)

Six more second designs, each for about 20 buildings across the test cities. With them the bench city reaches about 94 % hand-made.

### Townhouses, medium wealth, front steps (`R111-2.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Townhouses (homes, medium density, medium wealth). Save as R111-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 9 m to the roof. Budget 1,400 triangles.
A second terrace, unlike the first (houses under one long pitched roof with chimneys): four narrow flat-roofed three-storey townhouses in alternating colours (wall and wall_alt), each with tall front steps with solid sides up to its door, a bay window, and a deep cornice along the roofline; small back yards, one with a tree_spot. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### Big factory, heavy industry, brickworks (`I201-2.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Big factory (industry, high density, heavy industry). Save as I201-2.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,500 triangles.
A second big factory, unlike the first (one big brick hall and a tall round chimney): a brickworks, with a long kiln shed whose ridge carries a row of three short smoke_stacks, a tall square brick chimney (smoke_stack) at one end, a drying shed open on one side, heaps of clay, and stacks of bricks on pallets as chunky blocks. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Department store, low wealth, discount store (`C103-3.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Department store (shops and offices, medium density, low wealth). Save as C103-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 6 storeys, about 22 m to the roof. Budget 1,600 triangles.
A third department store, unlike the others (boxes with bands of glass): a cheap and cheerful discount store, a six-storey box clad in big panels of two bold colours (wall and wall_alt) in a chequered or striped pattern, separate square windows, a huge sign panel across the top two floors at the front, a deep entrance canopy, and display windows (shop_glass) along the ground floor. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

### Cottage, medium wealth, L-shaped (`R011-2.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Cottage (homes, low density, medium wealth). Save as R011-2.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 3 m to the roof. Budget 600 triangles.
A second cottage, unlike the first (a steep pitched roof with a chimney): an L-shaped one-storey cottage with a front wing whose gable faces the street, a bay window in it, a porch tucked into the corner of the L, a chimney, a front garden with a path, a low hedge along the sides, and a back garden with a tree_spot. Detached: keep it narrower than the lot. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### High-rise, medium wealth, loggias (`R212-3.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: High-rise (homes, high density, medium wealth). Save as R212-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 16 storeys, about 48 m to the roof. Budget 2,200 triangles.
A second high-rise for lots 16 m wide, unlike the first (a dark glass slab with balconies): a tower in light walls with terracotta panels (wall_alt) and deep recessed balconies (loggias) in vertical stripes up the front and back, the top two floors set back behind a roof terrace with a plant room, an entrance canopy, and a little plaza with a tree_spot. Medium wealth: a smart tower with generous balconies and a landscaped entrance.
```

### Residential tower, medium wealth, corner balconies (`R211-2.glb`)

```text
Citybloom model, following the model spec (v4) and style reference: Residential tower (homes, high density, medium wealth). Save as R211-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 10 storeys, about 30 m to the roof. Budget 2,000 triangles.
A second residential tower, unlike the first (a tower on a wide podium): a straight tower with a brick base for its first two floors, wrap-around corner balconies with solid parapets on every floor above, a garden pavilion on the roof, and a landscaped entrance with planters. Medium wealth: a smart tower with generous balconies and a landscaped entrance.
```
