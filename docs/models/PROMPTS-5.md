# Citybloom model prompts, batch 5: the last ones

After batch 4, every building in the three test cities wears a hand-made model. This last batch finishes the job for every city:

- **19 new designs**: the batch-4 prompts not made yet (rich shops and offices, and high-tech industry), repeated here with what batch 4 taught, so everything left is in one place. After these, every building type has at least two hand-made designs on every lot it can stand on, in any city.
- **19 remakes**: the 15 the batch-4 review flagged (three that aren't the building their prompt asks for, and twelve that read as the wrong kind of building or miss what defines them) and four still open from batch 3. A remake keeps its file name and replaces the old file; each prompt says what went wrong the first time, so the new one doesn't repeat it.

It's 38 models in four batches. Batch 30 first: its six stand in ordinary cities. The other three are for richer cities and can go in any order.

## What's new in the model spec (v6)

Everything in version 5, plus what the batch-4 review found:

- High-tech industry has white walls from the sheet's wealthy home whites, and light roofs. The first high-tech batch used mid-grey walls, which the game repaints with ordinary industry's beiges, so they read as plain factories.
- High-tech industry has no chimneys or chimney-like tubes.
- Glass on roofs (roof lights, glass roofs) is split into 3-4 m pieces, or it glows as one bar at night. Solar panels are named `solar_panel`, which the game keeps dark.
- Roof gardens and green roofs are grass, not roof, or they take the roof's colour; heaps of material are never roof either.
- Trees stand at least 3 m from every wall, the back wall too; window frames sit off the wall like the glass; detached buildings show windows or doors on every side; heights stay within about 2 m of the prompt.
- The features a prompt names (arches, a cupola, solar panels, roller doors on the street) must be there and visible from the street.

## How to use

1. Same as before: in Claude Design, start a canvas for a batch, attach `style-reference.png` and paste the model spec below once. It's version 6.
2. Paste one building prompt at a time, and download each model as a GLB with the file name in its prompt. A remake uses the same name as the file it replaces.
3. Put the files in a folder I can see, as before, and I'll check them before they go into `assets/models/`.

## The model spec

```text
Citybloom model spec (v6). Follow it for every model, and match the attached style reference sheet.

Style
- Bright, warm and toy-like: chunky, simple shapes with clean edges, like a well-made board-game piece.
- Use the palette on the reference sheet: pastel, brick or white walls; terracotta, slate or green roofs; big simple windows (dark blue-grey glass in white frames); white trim. The game repaints walls, roofs, awnings and signs for each copy, from the part of the sheet nearest the model's own colour: a slate roof may come out terracotta or green on another copy, while a colour far from everything on the sheet (a light grey roof, a navy sign) stays the same on every copy.
- High-tech industry has white walls from the sheet's "Wealthy home walls" (#ffffff or #eef1f4), never its "Industry walls": the game repaints grey walls with industry's beiges and greys, and the building reads as a plain factory. Its roofs are white, light grey or metal.
- Towers have solid walls with separate windows set into them, not all-glass walls: the city already has several dark glass towers.
- No fiddly detail: nothing thinner than about 0.3 m (no railings, balusters, cables, thin pipes or poles). Make what reads from above bold: roofs, awnings, signs, rooftop units, solar panels.
- No lettering, logos or real brand names: signs are plain colour panels in a colour that stands out from the wall behind them. Doors, garage doors and roller doors stand out from their walls too. Original designs only, nothing copied from a real landmark or another game.
- No trees, vehicles or people; the game adds its own. Where a tree should stand, put a 1 m cube named "tree_spot" on the ground, at least 3 m from every wall (the back wall too), and the game swaps it for one of its seasonal trees.
- What the prompt names as the building's defining features (arches, a cupola, a dome, solar panels, a green roof, roller doors on the street) must be there and clearly visible from the street.

Format
- One GLB file per model, with every part as its own named mesh (don't merge them). Use the file name given in the prompt.
- Metres, y up. Origin at ground level in the centre of the site. The front, facing the road, points along -Z; x runs along the road.
- Fill exactly the site size in the prompt, and put nothing outside it: no pavement, kerb, street lamps or road.
- Something (a wall, a lawn or paving) reaches each of the four edges of the site exactly. The game measures a model from its outermost parts, and leaves out one that stops even 10 cm short of its site.
- Ground inside the site (lawns, paths, paving, car parks, yards) is flat surfaces 5-10 cm above 0, but no raised slab or plinth under the whole site.
- Storeys about 3 m for homes, 3.6 m for shops and offices (4 m for a shop's ground floor), and 5-6 m for industrial halls. Each storey shows its own row of windows. Keep to the height in the prompt, within about 2 m.
- On lots 16 m or wider, buildings cover about half the site or more; the rest is garden, yard or plaza.
- A detached building shows windows or doors on every side, the back too (a windowless hall shows doors, grilles or vents instead); only a row building's party walls are plain.
- Build each part where it belongs. An extruded shape starts at 0, so centre it on its building before placing it. Nothing hangs in the air, and no part overlaps another (benches beside planters, not inside them).
- Roofs are closed: where glazing meets a roof plane they share an edge, with no gap to see through. Dormers sit below the main ridge.

Materials: plain colours, no textures, named exactly by role
- wall, wall_alt, trim, roof, glass, shop_glass, frame, door, awning, sign, metal, wood, accent, grass, paving, asphalt, water, hedge.
- Only roof surfaces use roof; gable ends, end caps and parapets use wall, wall_alt or trim. Roof gardens and green roofs are grass, not roof (in roof they take the roof's colour and the garden disappears). Heaps of material are accent, metal or wood, never roof.

Parts: named by what they are
- Each window is a group named "window" containing "window_glass" (plus a frame or sill if you like): one window per group, never a whole floor of windows in one group. A continuous strip of glass along a floor is "window_band", split into runs about 3-4 m long. Glass on a roof (roof lights, glass roofs, glazed gable ends) is window_band too, in 3-4 m pieces. The game lights windows one by one at night, so one big piece of glass glows as a single bright bar.
- Set glass and window frames 5-10 cm in front of their wall or into a recess, never in the wall's own plane, or they flicker from a distance.
- Solar panels are parts named "solar_panel"; the game keeps them dark at night, while any other glass lights up.
- Use names like "door", "garage_door", "storefront", "roof", "ac_unit", "vent", "water_tank", "solar_panel", "awning" and "sign".
- Only a building the prompt says gives off smoke has a chimney, named "smoke_stack"; the smoke comes from its top. High-tech industry gives no smoke: no smoke_stack and no chimney-like tubes; use flat roof vents and air units instead.

Narrow lots
- A detached house stays narrower than its lot, with a path or drive down one side and a gap on the other, so neighbouring houses don't touch. Hedges and fences stay low, 1.2 m at most.
- A row building (the prompt says the game stands copies side by side) fills its whole width, and its side walls are plain party walls with no windows, balconies, trim or recesses, because the next copy stands against them.

Keep to the triangle budget in each prompt.
```

## Batch 30: Remakes for ordinary cities (6)

Six remakes. They stand in ordinary cities, so they matter most.

### Industrial complex, manufacturing, works block, remake (`I113-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Industrial complex (industry, medium density, manufacturing). Save as I113-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,000 triangles.
A second complex for lots 16 m wide, unlike the first (sawtooth sheds and silos): a works block, a three-storey factory building that reads as industry from the street. Two big roller doors (garage_door, each in a colour that stands out from the wall) on its street front under a deep loading canopy; a tall goods-lift tower with its own roller door at one front corner; wide industrial windows on every floor, as window_band runs about 3-4 m long between chunky piers, on all four sides; huge chunky extraction ducts climbing one side wall and running over the flat roof (metal, not roof) to big fan boxes and ac_units; and a loading yard with stacked crates (wood) and a small car park at the front. Walls light grey (#d9dcdf, which the game varies among its light greys) and white, with a blue accent band (accent). This replaces the first I113-3, which came out reading as an office block from the street (a grid of identical windows and one door, its roller doors round the side), and the game repainted its greys beige and its roof terracotta. Manufacturing: clean and modern, light greys and white with a blue accent, roller doors and a small office. No smoke.
```

### Industrial park, manufacturing, U of halls, remake (`I213-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Industrial park (industry, high density, manufacturing). Save as I213-3.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 5 storeys, about 23 m to the roof. Budget 2,500 triangles.
A second industrial park for 24 x 24 m lots, unlike the first (an office tower beside two halls): three sheet-metal halls in a U around a central yard. The two front halls show big roller doors (garage_door) and loading canopies to the street as well as the yard; sawtooth roofs (metal) whose glazing is window_band runs about 3-4 m long; a two-storey office bridging the yard entrance; two tanks; and lawns with tree_spots along the street. Make the two front halls different in height and length, so it reads as industry from the street, not as a symmetrical office or civic building. This replaces the first I213-3, which came out as a symmetrical office building from the street, with every roller door facing the yard and roof lights that glowed as long bars at night. Manufacturing: clean and modern, light greys and white with a blue accent, roller doors and a small office. No smoke.
```

### Industrial complex, heavy industry, foundry, remake (`I103-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Industrial complex (industry, medium density, heavy industry). Save as I103-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,000 triangles.
A second complex for lots 16 m wide, unlike the first (brick sheds and tall chimneys): a foundry, with a tall brick hall under a raised clerestory roof (its high windows in window_band runs); beside it a squat round furnace about 6 m across and only 8 m tall, well below the hall's ridge, with a short, wide smoke_stack on its top; a chunky enclosed conveyor on two sturdy legs rising from a big heap of dark ore (accent, not roof) to the top of a square hopper tower; a casting shed; and a busy yard filling the rest of the lot with rows of stacked ingots and moulds as chunky blocks at least 1 m tall. This replaces the first I103-3, which came out with a nearly bare yard, a furnace stack as tall as the hall's ridge, and an ore heap that read as a small orange roof. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Industrial park, heavy industry, recycling works, remake (`I203-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Industrial park (industry, high density, heavy industry). Save as I203-3.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 5 storeys, about 23 m to the roof. Budget 3,000 triangles.
A second industrial park for 24 x 24 m lots, unlike the other (brick buildings around a yard): a recycling works with a big open-sided shed about 14 m tall on chunky columns, a crane gantry on chunky legs over tall, jagged heaps of scrap (stacked chunky metal blocks at angles, not smooth mounds), a five-storey sorting tower about 22 m tall with windows facing the street, two shredder buildings (one with a squat smoke_stack), and stacks of crushed scrap bales as chunky blocks at least 1.5 m on a side. This replaces the first I203-3, which came out low and sparse (12 m tall), with heaps like earth mounds and no lit window facing the street. Heavy industry: brick and rusty metal, smoke_stacks, tanks and heaps of material in a busy yard.
```

### Department store, low wealth, discount store, remake (`C103-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Department store (shops and offices, medium density, low wealth). Save as C103-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 6 storeys, about 22 m to the roof. Budget 1,600 triangles.
A third department store for a 16 x 16 m lot, unlike the others (boxes with bands of glass): a cheap and cheerful discount store, a six-storey box clad in big panels of two colours from the sheet in a chequered pattern (wall in a shop-wall colour, wall_alt in a brick colour, so the game can vary both), separate square windows on every side, a huge sign panel in a sign colour from the sheet across the top two floors of the front, a deep entrance canopy, and display windows (shop_glass) along the ground floor. This replaces the first C103-3, which came out with chequer panels in a blue the game couldn't repaint, so every copy looked the same. Low wealth: cheap and cheerful, bold signs and simple boxy shapes, in colours from the reference sheet.
```

### Shopping row, low wealth, colonnade, remake (`C101-2.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Shopping row (shops and offices, medium density, low wealth). Save as C101-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 11 m to the roof. Budget 1,400 triangles.
A second shopping row, unlike the first (three shops with awnings under two plain floors): a three-storey building whose ground floor holds four small shops, each with a big, bright shop window (shop_glass), a door, and its own sign panel directly above its window, under a shallow covered walkway (about 2 m deep) on chunky square columns spaced so each shopfront shows clearly between them; two floors of flats above with balconies whose solid parapets are wall_alt or trim; windows on the sides and back. This replaces the first C101-2, which came out with shops that barely read (dark panels deep behind the columns, their signs two floors up) and orange balconies the game couldn't repaint. Low wealth: cheap and cheerful, bold signs and simple boxy shapes, in colours from the reference sheet.
```

## Batch 31: High-tech industry: workshops to assembly works (11)

Six remakes and five new designs. Every high-tech design has white walls and light roofs and no chimneys, with solar panels or a green roof and lawns, so it reads as high-tech beside the game's own white glass blocks.

### Workshop, high-tech, prototype lab, remake (`I021-2.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Workshop (industry, low density, high-tech). Save as I021-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 800 triangles.
A second small high-tech workshop, unlike the first (a white shed with solar panels and a dish): a prototype lab about 7 m tall with a green roof (grass) and no solar panels, a big glass front (shop_glass) showing the workshop, a roller door (garage_door) in a colour that stands out from the white walls, a small white test dome beside it (a chunky half-sphere in wall or trim, not glass), and a landscaped yard with tree_spots. This replaces the first I021-2, which came out 4.3 m tall with solar panels and a dish, like the first workshop. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Warehouse, high-tech, automated store, remake (`I022-2.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Warehouse (industry, low density, high-tech). Save as I022-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 900 triangles.
A compact high-tech warehouse for a 16 x 16 m lot: a tall white automated store, its roof about 9 m up (taller than an ordinary warehouse), with a band of windows (window_band runs) near the top of every face, two loading bays with canopies at the front, solar panels covering the roof, and a lawn strip with tree_spots along the street. This replaces the first I022-2, which came out as a squat windowless grey box with cooling units, like a data centre, and nothing that lit at night. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Warehouse, high-tech, green-roof shed, new (`I022-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Warehouse (industry, low density, high-tech). Save as I022-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 900 triangles.
A second compact high-tech warehouse for 16 x 16 m lots, unlike the other (a tall white store): a low white distribution shed with a green roof (grass), a long office with big windows along its front, four loading bays at the side, and a row of charging posts as chunky blocks. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Plant, high-tech, clean room, new (`I023-2.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Plant (industry, low density, high-tech). Save as I023-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,200 triangles.
A compact high-tech plant for a 16 x 16 m lot: a white clean-room block with a band of windows, a row of rooftop air units, a tall gas tank on chunky legs, a glazed entrance, solar panels on the lower roof, and lawns with tree_spots. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Plant, high-tech, round reception, remake (`I023-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Plant (industry, low density, high-tech). Save as I023-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,200 triangles.
A second compact high-tech plant for 16 x 16 m lots, unlike the other (a white clean-room block with a tall tank): a biotech lab under a sawtooth roof whose slopes are covered in solar panels, a round two-storey reception building with big windows at the front corner, and a small pond (water) with a tree_spot. This replaces the first I023-3, which came out as a plain flat-roofed block with a tank, a smoke stack and a pipe floating above the roof. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Plant, high-tech, data centre, remake (`I023-4.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Plant (industry, low density, high-tech). Save as I023-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A second high-tech plant for 24 x 24 m lots: a data centre, a long white hall whose sides and back show tall louvred grilles (chunky slats) and doors instead of windows, a glazed office at its street end, two rows of big cooling units (chunky boxes with fan grilles) along its roof, a separate backup generator building with two short exhaust boxes, solar panels on the generator's roof, and a hedge along the street. This replaces the first I023-4, which came out with windows on every face, two small roof units and a smoke stack, reading as an office. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Factory, high-tech, arched solar roof, new (`I121-2.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Factory (industry, medium density, high-tech). Save as I121-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A second high-tech factory: an electronics works with a long hall under a shallow arched roof covered in solar panels, a two-storey office with big windows across its front, and a landscaped entrance with a pond (water). High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Factory, high-tech, clean factory, remake (`I121-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Factory (industry, medium density, high-tech). Save as I121-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A third high-tech factory, unlike the others (white halls with an office, and an arched solar roof): two stepped white blocks joined by a glazed link, a tall windowless clean-room block with air units on its roof and a lower assembly hall with a green roof (grass), a full-height glass entrance hall (window_band runs) at the street end, and lawns with tree_spots. This replaces the first I121-3, which came out nearly the same as a manufacturing hall with a glass front. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Assembly works, high-tech, visitor gallery, remake (`I122-2.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Assembly works (industry, medium density, high-tech). Save as I122-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,800 triangles.
High-tech assembly works for lots 16 m wide: a white robot assembly hall with a band of high windows (window_band runs), a glazed visitor gallery along its whole front, rows of solar panels on the roof, two loading bays at the back, and lawns with tree_spots along the street. This replaces the first I122-2, which came out as a plain grey hall. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Assembly works, high-tech, green slope, new (`I122-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Assembly works (industry, medium density, high-tech). Save as I122-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,800 triangles.
A second high-tech assembly works for lots 16 m wide, unlike the other (a white hall with a visitor gallery): a white hall with a green roof (grass) sloping down toward the back, a tall glass front (window_band runs), a chunky satellite dish, and a landscaped strip of car parking. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Assembly works, high-tech, test drum, new (`I122-4.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Assembly works (industry, medium density, high-tech). Save as I122-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 2,000 triangles.
A second high-tech assembly works for 24 x 24 m lots, unlike the first (two white halls with solar panels): one big white hall with a sawtooth roof of solar panels, a drum-shaped (cylindrical) test building beside it, a glazed office, and landscaped grounds with tree_spots. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

## Batch 32: High-tech industry: complexes, big factories, processing works and parks (9)

Three remakes and six new designs. Every high-tech design has white walls and light roofs and no chimneys, with solar panels or a green roof and lawns, so it reads as high-tech beside the game's own white glass blocks.

### Industrial complex, high-tech, lab and atrium, new (`I123-2.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Industrial complex (industry, medium density, high-tech). Save as I123-2.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,000 triangles.
A high-tech complex for lots 16 m wide: a three-storey white research lab with rows of windows, a glazed atrium (window_band runs) linking it to a lower clean-room hall at the back, rooftop air units, a chunky satellite dish, and lawns with tree_spots. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Industrial complex, high-tech, battery plant, new (`I123-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Industrial complex (industry, medium density, high-tech). Save as I123-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,000 triangles.
A second high-tech complex for lots 16 m wide, unlike the other (a lab joined to a hall by an atrium): a battery plant with a long white hall, a row of white tanks, a tall glazed stair tower, and a green roof (grass) on the office wing. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Industrial complex, high-tech, courtyard campus, remake (`I123-4.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Industrial complex (industry, medium density, high-tech). Save as I123-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,200 triangles.
A high-tech complex for 24 x 24 m lots: three white buildings of two, three and four storeys around a landscaped courtyard with a pond (water), linked by glazed bridges, solar panels on every roof and a chunky satellite dish; one of them is a tall windowless clean-room hall with air units on its roof, so it reads as industry, not offices. This replaces the first I123-4, which came out as an office or school campus, with mid-grey walls and a smoke stack. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Industrial complex, high-tech, assembly tower, new (`I123-5.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Industrial complex (industry, medium density, high-tech). Save as I123-5.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,200 triangles.
A second high-tech complex for 24 x 24 m lots, unlike the other (three buildings around a courtyard): a tall white assembly building with a huge door, a white test dome (a chunky half-sphere in wall or trim, not glass), a lower office with a green roof (grass), and a landscaped forecourt. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Big factory, high-tech, barrel vault, new (`I221-2.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Big factory (industry, high density, high-tech). Save as I221-2.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,500 triangles.
A second high-tech big factory, unlike the first (a white hall with solar panels): one huge white hall under a barrel-vaulted roof (a half-cylinder) with glazed ends in window_band runs, solar panels along the vault, a three-storey office block at the front with a chunky satellite dish, and lawns with tree_spots. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Processing works, high-tech, tanks and bridges, remake (`I222-2.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Processing works (industry, high density, high-tech). Save as I222-2.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 4 storeys, about 19 m to the roof. Budget 2,600 triangles.
High-tech processing works for 24 x 24 m lots: a white process building with rows of rooftop air units, three fat round white tanks (about 5 m across and 15 m high, with domed tops) linked to it by chunky covered pipe bridges (at least 0.5 m thick), a control room with big windows, solar panels on the lower roofs, and lawns with tree_spots. This replaces the first I222-2, which came out as a beige factory with small windows, one squat tank, and white tubes that read as chimneys. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Processing works, high-tech, clean-room tower, new (`I222-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Processing works (industry, high density, high-tech). Save as I222-3.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 4 storeys, about 19 m to the roof. Budget 2,600 triangles.
Second high-tech processing works for 24 x 24 m lots, unlike the other (tanks linked by pipe bridges): a pharmaceutical plant with a tall white clean-room tower with a band of windows at the top, a low lab wing with a green roof (grass), a small cooling pond (water), and a chunky satellite dish. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Industrial park, high-tech, research tower, new (`I223-2.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Industrial park (industry, high density, high-tech). Save as I223-2.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 5 storeys, about 23 m to the roof. Budget 3,000 triangles.
A high-tech park for 24 x 24 m lots: a five-storey white research building with big windows, a lower lab with a green roof (grass), a chunky satellite dish, and a landscaped plaza with a pond (water) and tree_spots. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

### Industrial park, high-tech, pavilion campus, remake (`I223-4.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Industrial park (industry, high density, high-tech). Save as I223-4.glb.
Lot 32 x 32 m (4 x 4 cells of 8 m, 32 m along the road); the front is on the road, facing -Z. 5 storeys, about 23 m to the roof. Budget 3,500 triangles.
A second high-tech park for 32 x 32 m lots, unlike the first (white blocks around a car park): a campus of four white pavilions with green roofs (grass), each with big windows facing the street and the lawn, around a central lawn with a pond (water) and tree_spots, joined by covered walkways with solid roofs, with a five-storey headquarters block with big windows at the front and a chunky satellite dish. This replaces the first I223-4, which came out with windowless sheds facing the street, smoke stacks, and no green roofs or walkways. High-tech: white walls (#ffffff or #eef1f4) and white or light grey roofs, big windows, solar panels or green roofs, and landscaped grounds with lawns and tree_spots. No smoke and no chimneys.
```

## Batch 33: Rich shops and offices (12)

Four remakes and eight new designs. Upmarket shops, offices, department stores and towers.

### Corner shop, high wealth, arched boutique, remake (`C021-2.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Corner shop (shops and offices, low density, high wealth). Save as C021-2.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 700 triangles.
A second corner shop, unlike the first (a white box with a glass front): a boutique in pale stone with a tall shop window (shop_glass) and a door beside it, both with round-arched tops, an elegant canopy, a cornice with a sign panel, and two planters with clipped shrubs (hedge) by the door; no tree_spot unless it can stand 3 m from every wall. This replaces the first C021-2, which came out as a white bungalow with no arches, its tree_spot touching the back wall. High wealth: upmarket, with big shop windows (shop_glass), pale stone or white walls and elegant canopies.
```

### Shopfront, high wealth, glass in stone, new (`C022-2.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Shopfront (shops and offices, low density, high wealth). Save as C022-2.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 600 triangles.
An upmarket shop for an 8 x 8 m lot: a glass front (shop_glass) in a pale stone frame, a deep flat canopy, a sign panel on the parapet, and planters with clipped shrubs (hedge). High wealth: upmarket, with big shop windows (shop_glass), pale stone or white walls and elegant canopies.
```

### Shopfront, high wealth, mansard, new (`C022-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Shopfront (shops and offices, low density, high wealth). Save as C022-3.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 600 triangles.
A second upmarket shop for 8 x 8 m lots, unlike the other (a glass front in a stone frame): a one-storey shop under a tall slate-coloured mansard roof, two tall display windows (shop_glass) either side of a recessed door, and a sign panel on the fascia. High wealth: upmarket, with big shop windows (shop_glass), pale stone or white walls and elegant canopies.
```

### Market hall, high wealth, stone arch, remake (`C023-2.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Market hall (shops and offices, low density, high wealth). Save as C023-2.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. On a 16 m lot the game stands two copies side by side, so it fills its whole 8 m width with plain side walls. 2 storeys, about 8 m to the roof. Budget 800 triangles.
A small upmarket food hall: two storeys, with a big glass front (shop_glass) set into a deep pale stone arch that rises through both floors, an elegant canopy, baskets of produce as chunky blocks, and a sign panel above the arch. This replaces the first C023-2, which came out 6.6 m wide with windows in its side walls, glass roof slabs that glowed whole at night, and no arch, sign or produce. High wealth: upmarket, with big shop windows (shop_glass), pale stone or white walls and elegant canopies.
```

### Market hall, high wealth, flower market, new (`C023-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Market hall (shops and offices, low density, high wealth). Save as C023-3.glb.
Lot 8 x 8 m (1 cell of 8 m, 8 m along the road); the front is on the road, facing -Z. On a 16 m lot the game stands two copies side by side, so it fills its whole 8 m width with plain side walls. 2 storeys, about 8 m to the roof. Budget 700 triangles.
A second small upmarket market, unlike the other (a glass front under a stone arch): a flower market with a pitched roof with long roof lights along both slopes (window_band runs about 3-4 m), a glass front (shop_glass), and flower stalls as chunky blocks under a canopy. High wealth: upmarket, with big shop windows (shop_glass), pale stone or white walls and elegant canopies.
```

### Office block, high wealth, white fins, new (`C122-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Office block (shops and offices, medium density, high wealth). Save as C122-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 15 m to the roof. Budget 1,400 triangles.
A second compact office for 16 x 16 m lots, unlike the other (pale stone with a glazed hall): a modern office with white vertical fins between tall windows, a top floor set back behind a roof terrace, a deep entrance canopy, and a small water garden (water) at the front. High wealth: upmarket, with big shop windows (shop_glass), pale stone or white walls and elegant canopies.
```

### Department store, high wealth, arched stone, remake (`C123-2.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Department store (shops and offices, medium density, high wealth). Save as C123-2.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 6 storeys, about 22 m to the roof. Budget 1,800 triangles.
A compact department store for a 16 x 16 m lot: six storeys in pale stone, a ground floor of tall round-arched display windows (shop_glass), separate tall windows above, a grand central entrance with a canopy, and a rooftop cafe pavilion with planters; tree_spots, if any, at least 3 m from every wall. This replaces the first C123-2, which came out with no arched windows or rooftop pavilion, roof glass that glowed whole at night, and trees against the back wall. High wealth: upmarket, with big shop windows (shop_glass), pale stone or white walls and elegant canopies.
```

### Department store, high wealth, glass bay, new (`C123-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Department store (shops and offices, medium density, high wealth). Save as C123-3.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 6 storeys, about 22 m to the roof. Budget 1,600 triangles.
A second compact department store for 16 x 16 m lots, unlike the other (arched stone): a big full-height glass bay (window_band runs about 3-4 m) framed in white stone on the front, display windows (shop_glass) along the ground floor, a deep elegant canopy, and a roof terrace with a pavilion. High wealth: upmarket, with big shop windows (shop_glass), pale stone or white walls and elegant canopies.
```

### Department store, high wealth, cupola, remake (`C123-4.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Department store (shops and offices, medium density, high wealth). Save as C123-4.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 6 storeys, about 22 m to the roof. Budget 2,400 triangles.
A second department store for 24 x 24 m lots, unlike the first (a glass box with a sign band): a grand store in pale stone with a chunky square cupola (a raised square drum with a dome or pyramid on top) in the middle of the roof, tall round-arched display windows (shop_glass) along the ground floor, an entrance between four chunky columns, and a roof terrace with planters. This replaces the first C123-4, which came out with no cupola, arched windows or columns, and roof glass that glowed whole at night. High wealth: upmarket, with big shop windows (shop_glass), pale stone or white walls and elegant canopies.
```

### Commercial tower, high wealth, lantern, new (`C222-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Commercial tower (shops and offices, high density, high wealth). Save as C222-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 16 storeys, about 58 m to the roof. Budget 2,200 triangles.
A second commercial tower for lots 16 m wide, unlike the other (stone on a shop podium): a slim tower whose corners are cut back every four floors into terraces with planters, tall separate windows in white walls, and a lantern room (a smaller box with tall windows) as its crown. High wealth: a landmark tower in pale stone with tall windows, an elegant crown and a grand canopy.
```

### Headquarters, high wealth, slim lantern, new (`C223-3.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Headquarters (shops and offices, high density, high wealth). Save as C223-3.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 2,500 triangles.
A second landmark headquarters for lots 16 m wide, unlike the other (stone with a pyramid crown): a white tower that narrows at the top into a slim lantern with a flat roof, a sky garden (grass) halfway up, tall windows, and a grand canopy over the entrance. High wealth: a landmark tower in pale stone with tall windows, an elegant crown and a grand canopy.
```

### Headquarters, high wealth, gateway, new (`C223-5.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Headquarters (shops and offices, high density, high wealth). Save as C223-5.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 2,800 triangles.
A second landmark headquarters for 24 x 24 m lots, unlike the other (a round tower under a glass dome): a broad tower with a tall open archway through its base (a gateway to a garden behind), tall windows, a flat crown with a roof garden (grass), and a sign panel near the top. High wealth: a landmark tower in pale stone with tall windows, an elegant crown and a grand canopy.
```
