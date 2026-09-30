# Citybloom model prompts

Prompts for every building in the game, sized from the game's own data, to make in Claude Design as GLB models. Anything without a model keeps its generated look, so there's no need to do them all at once.

## How to use

1. In Claude Design, start a canvas for a batch. Attach `style-reference.png` (in this folder) and paste the model spec below once.
2. Paste one building prompt at a time. Several buildings can share a canvas.
3. Download each model as a GLB with the file name in its prompt, and add it to `assets/models/` in the repo.
4. Claude Code checks every model with `npm run models:check` and brings the good ones into the game.

Start with the one-off buildings (batches 1 to 5): each is unique and highly visible. Homes, shops and industry come after. The game mixes hand-made models with generated ones, so each building type needs only one model to begin with. Extra designs for the same building add `-2`, `-3` to the file name (`R002-2.glb`).

## The model spec

```text
Citybloom model spec (v2). Follow it for every model, and match the attached style reference sheet.

Style
- Bright, warm and toy-like: chunky, simple shapes with clean edges, like a well-made board-game piece.
- Use the palette on the reference sheet: pastel, brick or white walls; terracotta, slate or green roofs; big simple windows (dark blue-grey glass in white frames); white trim.
- No fiddly detail: nothing thinner than about 0.3 m (no railings, balusters, cables, thin pipes or poles). Make what reads from above bold: roofs, chimneys, awnings, signs, rooftop units.
- No lettering, logos or real brand names: signs are plain colour panels. Original designs only, nothing copied from a real landmark or another game.
- No trees, vehicles or people; the game adds its own. Where a tree should stand, put a 1 m cube named "tree_spot" and the game swaps it for one of its seasonal trees.

Format
- One GLB file per model, with every part as its own named mesh (don't merge them). Use the file name given in the prompt.
- Metres, y up. Origin at ground level in the centre of the site. The front, facing the road, points along -Z; x runs along the road.
- Fill exactly the site size in the prompt, and put nothing outside it: no pavement, kerb, street lamps or road.
- Ground inside the site (lawns, paths, paving, car parks, yards) is fine as flat surfaces just above 0, but no raised slab or plinth under the whole site.
- Storeys about 3 m for homes, 3.6 m for shops and offices (4 m for a shop's ground floor), and 5-6 m for industrial halls.

Materials: plain colours, no textures, named exactly by role
- wall, wall_alt, trim, roof, glass, shop_glass, frame, door, awning, sign, metal, wood, accent, grass, paving, asphalt, water, hedge.
- The game repaints wall, wall_alt, roof, awning and sign for each copy, so any colour from the sheet is a fine default.

Parts: named by what they are
- Each window is a group named "window" containing "window_glass" (plus a frame or sill if you like). On towers, a continuous strip of glass along a floor is "window_band".
- Use names like "door", "garage_door", "storefront", "roof", "chimney", "ac_unit", "water_tank", "awning" and "sign".
- Anything that gives off smoke has a chimney named "smoke_stack"; the smoke comes from its top.
- Everything is supported: nothing floats.

Keep to the triangle budget in each prompt.
```

## Batch 1: Services (8)

### Fire station (`firestation.glb`)

```text
Citybloom model, following the model spec and style reference: Fire station. Save as firestation.glb.
Site 24 x 24 m (24 m along the road, 24 m deep); the front is on the road, facing -Z. Budget 2,000 triangles.
A friendly neighbourhood fire station. Three tall red garage doors (garage_door) facing the road, with a paved apron in front. A two-storey crew block beside the bays, a square drill tower about 15 m tall at the back, a siren and ac_units on the roof, and a small yard behind.
```

### Police station (`police.glb`)

```text
Citybloom model, following the model spec and style reference: Police station. Save as police.glb.
Site 24 x 24 m (24 m along the road, 24 m deep); the front is on the road, facing -Z. Budget 1,800 triangles.
A compact police station: a two-storey civic building in pale walls with blue trim (accent), a flat canopy over the front entrance with a chunky blue lamp above it, a small car park at one side (asphalt with painted bays as flat shapes), and a garage_door at the back for patrol cars.
```

### Clinic (`clinic.glb`)

```text
Citybloom model, following the model spec and style reference: Clinic. Save as clinic.glb.
Site 20 x 20 m (20 m along the road, 20 m deep); the front is on the road, facing -Z. Budget 1,500 triangles.
A small, welcoming clinic: a one- or two-storey white building with a green cross panel (sign) by the entrance, a covered drop-off canopy, an ambulance bay with a garage_door at the side, planters, and a little car park.
```

### Hospital (`hospital.glb`)

```text
Citybloom model, following the model spec and style reference: Hospital. Save as hospital.glb.
Site 40 x 40 m (40 m along the road, 40 m deep); the front is on the road, facing -Z. Budget 3,500 triangles.
A city hospital: a five-storey white block with a red cross panel (sign) and window_bands, an emergency entrance with a deep canopy and two ambulance bays (garage_door), a rooftop helipad with a painted H as flat geometry, a glass main lobby at the front, and a small car park.
```

### Primary school (`primary.glb`)

```text
Citybloom model, following the model spec and style reference: Primary school. Save as primary.glb.
Site 32 x 24 m (32 m along the road, 24 m deep); the front is on the road, facing -Z. Budget 2,000 triangles.
A cheerful primary school: a two-storey building with bright yellow and red accents, a covered walkway, a playground at one side with painted court markings (flat paving shapes), a sign panel over the entrance, and tree_spots in the yard.
```

### High school (`highschool.glb`)

```text
Citybloom model, following the model spec and style reference: High school. Save as highschool.glb.
Site 40 x 32 m (40 m along the road, 32 m deep); the front is on the road, facing -Z. Budget 2,500 triangles.
A high school: a three-storey teaching block with rows of windows, a gym hall with a curved or shallow-pitched roof, a sports court or running track behind it (paving and grass, lines as flat shapes), and a bike shelter.
```

### Library (`library.glb`)

```text
Citybloom model, following the model spec and style reference: Library. Save as library.glb.
Site 20 x 20 m (20 m along the road, 20 m deep); the front is on the road, facing -Z. Budget 1,500 triangles.
A public library: a small classical building in pale stone with chunky columns (at least 0.6 m thick), broad steps, a pediment and tall windows, and a reading garden behind with a tree_spot.
```

### University (`university.glb`)

```text
Citybloom model, following the model spec and style reference: University. Save as university.glb.
Site 64 x 48 m (64 m along the road, 48 m deep); the front is on the road, facing -Z. Budget 4,500 triangles.
A university campus: a grand main hall at the front with a central tower or dome and chunky columns, two wings framing a grass quad behind it with paths and tree_spots, a modern library block, and a small car park.
```

## Batch 2: Utilities (14)

### Wind turbines (`wind.glb`)

```text
Citybloom model, following the model spec and style reference: Wind turbines. Save as wind.glb.
Site 16 x 16 m (16 m along the road, 16 m deep); the front is on the road, facing -Z. Budget 800 triangles.
A single wind turbine on a gravel pad: a tall white tapered tower about 30 m to the hub, a nacelle, and a chunky three-blade rotor facing the road. Name the hub and blades together "rotor", centred on the hub. A small grey control hut at the base.
```

### Coal power plant (`coal.glb`)

```text
Citybloom model, following the model spec and style reference: Coal power plant. Save as coal.glb.
Site 40 x 48 m (40 m along the road, 48 m deep); the front is on the road, facing -Z. Budget 3,000 triangles.
A coal power plant: a big brick boiler house and a turbine hall, two tall striped chimneys (smoke_stack) at the back right reaching 50-58 m, a dark coal heap made of chunky shapes, a conveyor on thick supports, and a yard edged with solid low walls.
```

### Gas power plant (`gas.glb`)

```text
Citybloom model, following the model spec and style reference: Gas power plant. Save as gas.glb.
Site 32 x 40 m (32 m along the road, 40 m deep); the front is on the road, facing -Z. Budget 2,500 triangles.
A gas power plant: two compact turbine halls in grey cladding with coloured accent stripes, two slimmer exhaust stacks (smoke_stack) about 30 m tall towards the front, chunky pipework (at least 0.4 m), two round storage tanks, and a paved yard.
```

### Solar farm (`solar.glb`)

```text
Citybloom model, following the model spec and style reference: Solar farm. Save as solar.glb.
Site 48 x 40 m (48 m along the road, 40 m deep); the front is on the road, facing -Z. Budget 2,000 triangles.
A solar farm: neat rows of tilted solar panels (dark blue shop_glass in white frames) on low supports over grass, gravel paths between the rows, a small inverter hut, and a solid low fence along the edge.
```

### Nuclear power plant (`nuclear.glb`)

```text
Citybloom model, following the model spec and style reference: Nuclear power plant. Save as nuclear.glb.
Site 56 x 64 m (56 m along the road, 64 m deep); the front is on the road, facing -Z. Budget 4,000 triangles.
A nuclear power plant: two big smooth cooling towers about 45 m tall at the back, a white reactor dome, a flat-roofed turbine hall, bright accent stripes, and a paved forecourt with a gatehouse at the road. It makes no smoke.
```

### Groundwater pump (`pump.glb`)

```text
Citybloom model, following the model spec and style reference: Groundwater pump. Save as pump.glb.
Site 16 x 16 m (16 m along the road, 16 m deep); the front is on the road, facing -Z. Budget 800 triangles.
A groundwater pump house: a small brick or rendered house with a pitched roof, a blue manifold of chunky pipes beside it, a round water_tank on legs, and a gravel yard.
```

### River pump (`riverpump.glb`)

```text
Citybloom model, following the model spec and style reference: River pump. Save as riverpump.glb.
Site 20 x 20 m (20 m along the road, 20 m deep); the front is on the road, facing -Z. Budget 1,000 triangles.
A river pump: a concrete pump house at the front, and two chunky blue intake pipes running to the back edge of the site, where the river is. A gravel site with a solid low wall.
```

### Sewage outflow (`outflow.glb`)

```text
Citybloom model, following the model spec and style reference: Sewage outflow. Save as outflow.glb.
Site 12 x 16 m (12 m along the road, 16 m deep); the front is on the road, facing -Z. Budget 600 triangles.
A sewage outflow: a small concrete valve hut at the front, and one chunky pipe running to the back edge of the site, where it empties into the water through a concrete headwall with a grille. Gravel and a patch of grass.
```

### Septic tanks (`septic.glb`)

```text
Citybloom model, following the model spec and style reference: Septic tanks. Save as septic.glb.
Site 14 x 14 m (14 m along the road, 14 m deep); the front is on the road, facing -Z. Budget 500 triangles.
Septic tanks: two or three round concrete tank lids flush with the grass, short chunky vent stacks, a small hut, and a gravel path.
```

### Sewage treatment plant (`treatment.glb`)

```text
Citybloom model, following the model spec and style reference: Sewage treatment plant. Save as treatment.glb.
Site 32 x 32 m (32 m along the road, 32 m deep); the front is on the road, facing -Z. Budget 2,500 triangles.
A sewage treatment plant: two round settling tanks and a rectangular aeration basin (water in a muted green-blue), walkways as solid slabs, a control building, and gravel paths.
```

### Landfill (`landfill.glb`)

```text
Citybloom model, following the model spec and style reference: Landfill. Save as landfill.glb.
Site 48 x 48 m (48 m along the road, 48 m deep); the front is on the road, facing -Z. Budget 2,500 triangles.
A landfill: a site office and a weighbridge at the entrance, a truck shed with a garage_door, solid low walls round the edge, and a big rubbish heap named "mound" filling most of the site at full height (chunky colourful rubbish blocks on a brown heap). The game raises the mound as the landfill fills.
```

### Public works depot (`works.glb`)

```text
Citybloom model, following the model spec and style reference: Public works depot. Save as works.glb.
Site 36 x 32 m (36 m along the road, 32 m deep); the front is on the road, facing -Z. Budget 2,000 triangles.
A public works depot: a garage building with big orange garage_doors for ploughs and trucks, a round salt dome, a yard with chunky piles of grit, and an office with a yellow accent stripe.
```

### Recycling centre (`recycling.glb`)

```text
Citybloom model, following the model spec and style reference: Recycling centre. Save as recycling.glb.
Site 32 x 32 m (32 m along the road, 32 m deep); the front is on the road, facing -Z. Budget 2,000 triangles.
A recycling centre: a warehouse with a curved roof, rows of big coloured bins and containers (blue, green, yellow), a conveyor on thick supports, bales of sorted material as blocks, and a paved yard.
```

### Incinerator (`incinerator.glb`)

```text
Citybloom model, following the model spec and style reference: Incinerator. Save as incinerator.glb.
Site 32 x 40 m (32 m along the road, 40 m deep); the front is on the road, facing -Z. Budget 2,500 triangles.
An incinerator: a boxy plant building with a tipping hall at the front, one tall chimney (smoke_stack) about 40 m tall at the back right, a bunker, a conveyor, and a paved yard.
```

## Batch 3: Parks and transport (6)

### Pocket park (`park_small.glb`)

```text
Citybloom model, following the model spec and style reference: Pocket park. Save as park_small.glb.
Site 16 x 16 m (16 m along the road, 16 m deep); the front is on the road, facing -Z. Budget 800 triangles.
A pocket park: a lawn with curving paths, chunky benches, a small round fountain (water), flower beds as coloured blocks, and three tree_spots.
```

### Plaza (`plaza.glb`)

```text
Citybloom model, following the model spec and style reference: Plaza. Save as plaza.glb.
Site 24 x 24 m (24 m along the road, 24 m deep); the front is on the road, facing -Z. Budget 1,500 triangles.
A town plaza: patterned paving (flat coloured tiles), a central fountain or chunky abstract sculpture, benches, square planters with tree_spots, and a small cafe kiosk with an awning.
```

### City park (`park_large.glb`)

```text
Citybloom model, following the model spec and style reference: City park. Save as park_large.glb.
Site 48 x 48 m (48 m along the road, 48 m deep); the front is on the road, facing -Z. Budget 3,000 triangles.
A city park: a pond with a little bridge, a bandstand, looping paths, lawns, bright flower beds, a playground with chunky equipment, benches, and plenty of tree_spots.
```

### Bus depot (`busdepot.glb`)

```text
Citybloom model, following the model spec and style reference: Bus depot. Save as busdepot.glb.
Site 32 x 28 m (32 m along the road, 28 m deep); the front is on the road, facing -Z. Budget 2,000 triangles.
A bus depot: an open-fronted garage with four bus bays (garage_door) facing the road, a fuel island under a canopy, a small office, and a paved yard with painted bays.
```

### Tram depot (`tramdepot.glb`)

```text
Citybloom model, following the model spec and style reference: Tram depot. Save as tramdepot.glb.
Site 44 x 30 m (44 m along the road, 30 m deep); the front is on the road, facing -Z. Budget 2,500 triangles.
A tram depot: a long brick shed with three tall arched openings facing the road, where the tram tracks enter (rails as flat metal strips running from the front edge into each bay), a clock (a chunky disc) over the middle arch, and a small office at one side.
```

### Railway station (`station.glb`)

```text
Citybloom model, following the model spec and style reference: Railway station. Save as station.glb.
Site 64 x 20 m (64 m along the railway, 20 m deep); the front is on the railway, facing -Z. Budget 2,500 triangles.
A railway station. The railway runs along the front edge (-Z), so put the platform along the front under a long canopy on chunky posts, with a brick booking hall behind it and a clock over its door facing the back, the town side. A small forecourt at the back.
```

## Batch 4: Special buildings and landmarks (13)

### Rail freight terminal (`railfreight.glb`)

```text
Citybloom model, following the model spec and style reference: Rail freight terminal. Save as railfreight.glb.
Site 72 x 36 m (72 m along the road, 36 m deep); the front is on the road, facing -Z. Budget 3,500 triangles.
A rail freight terminal: a shed and gatehouse facing the road at the front, stacks of coloured shipping containers, and a loading area along the back edge, where the railway runs, under a big gantry crane made of chunky beams.
```

### Freight hub (`freighthub.glb`)

```text
Citybloom model, following the model spec and style reference: Freight hub. Save as freighthub.glb.
Site 56 x 48 m (56 m along the road, 48 m deep); the front is on the road, facing -Z. Budget 2,500 triangles.
A freight hub: a large warehouse with a row of loading docks and garage_doors along its front, a truck yard, stacks of containers, and an office block.
```

### Airport (`airport.glb`)

```text
Citybloom model, following the model spec and style reference: Airport. Save as airport.glb.
Site 300 x 130 m (300 m along the road, 130 m deep); the front is on the road, facing -Z. Budget 8,000 triangles.
An airport. At the front: a long glass terminal with a sweeping curved roof, a drop-off road and a car park. Behind it: aprons, taxiways and one runway running the whole 300 m along the back (named runway, with markings as flat white shapes), a control tower (named control_tower), and two hangars. The game adds the planes.
```

### Seaport (`seaport.glb`)

```text
Citybloom model, following the model spec and style reference: Seaport. Save as seaport.glb.
Site 200 x 90 m (200 m along the road, 90 m deep); the front is on the road, facing -Z. Budget 6,000 triangles.
A container seaport. The back edge of the site is a quay standing in deep water, with its walls going 8 m below 0 (named quay). Along the quay, two or three big container cranes of chunky beams (named crane); behind them, stacks of coloured containers, a warehouse, and an office at the road side. The game adds the ships.
```

### Ore mine (`oremine.glb`)

```text
Citybloom model, following the model spec and style reference: Ore mine. Save as oremine.glb.
Site 40 x 40 m (40 m along the road, 40 m deep); the front is on the road, facing -Z. Budget 2,500 triangles.
An ore mine: a headframe tower over the shaft built from chunky beams, a winding house, a boiler house with a chimney (smoke_stack), an ore heap made of chunky rocks, a conveyor, and a loading shed.
```

### Oil well (`oilwell.glb`)

```text
Citybloom model, following the model spec and style reference: Oil well. Save as oilwell.glb.
Site 24 x 24 m (24 m along the road, 24 m deep); the front is on the road, facing -Z. Budget 1,000 triangles.
An oil well: a chunky pumpjack (its nodding beam named "pumpjack_beam"), a round storage tank, a small control hut, and a gravel pad edged with solid low walls.
```

### Research park (`techpark.glb`)

```text
Citybloom model, following the model spec and style reference: Research park. Save as techpark.glb.
Site 56 x 40 m (56 m along the road, 40 m deep); the front is on the road, facing -Z. Budget 3,500 triangles.
A research park: sleek low white buildings with glass fronts, an observatory dome, a big chunky satellite dish, solar panels on one roof, and landscaped grounds with paths, lawns and tree_spots.
```

### Hotel (`hotel.glb`)

```text
Citybloom model, following the model spec and style reference: Hotel. Save as hotel.glb.
Site 32 x 28 m (32 m along the road, 28 m deep); the front is on the road, facing -Z. Budget 3,000 triangles.
A city hotel: a nine-storey tower with solid slab balconies, a grand entrance with a deep canopy and a turning circle at the front, a sign panel on the roof, and a pool (water) on a terrace at the back.
```

### Clock tower (`clocktower.glb`)

```text
Citybloom model, following the model spec and style reference: Clock tower. Save as clocktower.glb.
Site 24 x 24 m (24 m along the road, 24 m deep); the front is on the road, facing -Z. Budget 2,500 triangles.
A clock tower landmark, an original design rather than a copy of any real tower: a stone tower about 40 m tall with a big clock face on each side (white discs with chunky dark hands), a pointed roof with a chunky finial, on a small paved plaza with benches and planters.
```

### Observation wheel (`wheel.glb`)

```text
Citybloom model, following the model spec and style reference: Observation wheel. Save as wheel.glb.
Site 40 x 32 m (40 m along the road, 32 m deep); the front is on the road, facing -Z. Budget 4,000 triangles.
An observation wheel, an original design: a big wheel about 36 m across with chunky spokes and 12 colourful gondolas, on A-frame legs, with a ticket booth and a queue area. Name the rim and spokes "wheel_rotor" (centred on the hub) and each gondola "gondola".
```

### Glass conservatory (`conservatory.glb`)

```text
Citybloom model, following the model spec and style reference: Glass conservatory. Save as conservatory.glb.
Site 48 x 40 m (48 m along the road, 40 m deep); the front is on the road, facing -Z. Budget 4,000 triangles.
A glass conservatory, an original design: a Victorian-style glasshouse with a central dome and two arched wings, white frames and pale green glass (shop_glass), set in gardens with paths, flower beds and tree_spots.
```

### Sky needle (`skyneedle.glb`)

```text
Citybloom model, following the model spec and style reference: Sky needle. Save as skyneedle.glb.
Site 32 x 32 m (32 m along the road, 32 m deep); the front is on the road, facing -Z. Budget 4,000 triangles.
A sky needle observation tower, an original design rather than a copy of any real tower: about 130 m tall, a slender core with three splayed legs at the base, a saucer-shaped observation deck near the top, and a spire. A plaza with planters at its foot.
```

### Grand arch (`grandarch.glb`)

```text
Citybloom model, following the model spec and style reference: Grand arch. Save as grandarch.glb.
Site 48 x 32 m (48 m along the road, 32 m deep); the front is on the road, facing -Z. Budget 3,000 triangles.
A grand arch monument, an original design: a huge stone arch about 35 m high with chunky carved panels (blocks, no lettering), on a paved plaza flanked by two fountains and planters with tree_spots.
```

## Batch 5: Big projects (5)

### City stadium (`stadium.glb`)

```text
Citybloom model, following the model spec and style reference: City stadium. Save as stadium.glb.
Site 120 x 96 m (120 m along the road, 96 m deep); the front is on the road, facing -Z. Budget 6,000 triangles.
A city stadium: an oval bowl with tiered stands (seat colours in big blocks), a roof ring over the upper stands, a grass pitch with painted lines as flat shapes (named pitch), four chunky floodlight towers (named floodlight), and entrances with a plaza at the front. Only the finished stadium; the game shows its construction.
```

### Convention centre (`convention.glb`)

```text
Citybloom model, following the model spec and style reference: Convention centre. Save as convention.glb.
Site 120 x 80 m (120 m along the road, 80 m deep); the front is on the road, facing -Z. Budget 5,000 triangles.
A convention centre: a large modern hall with a sweeping wave-shaped roof, a tall glass entrance atrium, a front plaza with fountains and planters, banners as solid coloured panels, and a car park at one side. Only the finished building; the game shows its construction.
```

### Solar tower array (`helioarray.glb`)

```text
Citybloom model, following the model spec and style reference: Solar tower array. Save as helioarray.glb.
Site 128 x 128 m (128 m along the road, 128 m deep); the front is on the road, facing -Z. Budget 6,000 triangles.
A solar tower array: a tall central tower about 80 m high with a bright receiver at the top (named receiver), surrounded by rings of heliostat mirrors (flat pale-blue panels in shop_glass on chunky posts), service roads and a control building. Only the finished array; the game shows its construction.
```

### Garden expo (`gardenexpo.glb`)

```text
Citybloom model, following the model spec and style reference: Garden expo. Save as gardenexpo.glb.
Site 144 x 112 m (144 m along the road, 112 m deep); the front is on the road, facing -Z. Budget 6,000 triangles.
A garden expo: themed gardens with bold flower beds, a big glass pavilion, a lake with a bridge, an observation tower (an original design), paths, lawns and plenty of tree_spots. Only the finished expo; the game shows its construction.
```

### Launch complex (`launchsite.glb`)

```text
Citybloom model, following the model spec and style reference: Launch complex. Save as launchsite.glb.
Site 112 x 112 m (112 m along the road, 112 m deep); the front is on the road, facing -Z. Budget 6,000 triangles.
A launch complex: a launch pad with a tall white rocket with coloured bands (named rocket) beside a service tower of chunky beams, a tall assembly hall with huge doors, a control building, and spherical fuel tanks. Only the finished complex; the game shows its construction.
```

## Batch 6: Add-on annexes (8)

Small wings the game adds in a back corner of a building's site when the player buys an add-on. The game shrinks them for small sites.

### Extra garbage truck (`annex-garbageTruck.glb`)

```text
Citybloom model, following the model spec and style reference: an add-on annex, extra garbage truck, for the landfill, recycling centre and incinerator. Save as annex-garbageTruck.glb.
Site 9 x 8 m; the front faces -Z. One storey, about 5.5 m to the roof. Budget 400 triangles.
A small single-bay truck garage with a garage_door and a flat roof.
```

### Extra engine bay (`annex-engineBay.glb`)

```text
Citybloom model, following the model spec and style reference: an add-on annex, extra engine bay, for the fire station. Save as annex-engineBay.glb.
Site 9 x 8 m; the front faces -Z. One storey, about 5.5 m to the roof. Budget 400 triangles.
A one-storey garage with two red garage_doors.
```

### Patrol wing (`annex-patrolWing.glb`)

```text
Citybloom model, following the model spec and style reference: an add-on annex, patrol wing, for the police station. Save as annex-patrolWing.glb.
Site 9 x 8 m; the front faces -Z. One storey, about 5.5 m to the roof. Budget 400 triangles.
A one-storey office wing with blue trim (accent) and one garage_door.
```

### Ambulance bay (`annex-ambulanceBay.glb`)

```text
Citybloom model, following the model spec and style reference: an add-on annex, ambulance bay, for the clinic and hospital. Save as annex-ambulanceBay.glb.
Site 9 x 8 m; the front faces -Z. One storey, about 5.5 m to the roof. Budget 400 triangles.
A one-storey bay with two garage_doors under a canopy.
```

### New ward (`annex-ward.glb`)

```text
Citybloom model, following the model spec and style reference: an add-on annex, new ward, for the clinic and hospital. Save as annex-ward.glb.
Site 9 x 8 m; the front faces -Z. One storey, about 5.5 m to the roof. Budget 400 triangles.
A one-storey white ward wing with a row of windows.
```

### Extra classrooms (`annex-classrooms.glb`)

```text
Citybloom model, following the model spec and style reference: an add-on annex, extra classrooms, for the primary and high schools. Save as annex-classrooms.glb.
Site 9 x 8 m; the front faces -Z. One storey, about 5.5 m to the roof. Budget 400 triangles.
A one-storey classroom block with big windows and a bright accent band.
```

### Lecture hall (`annex-lectureHall.glb`)

```text
Citybloom model, following the model spec and style reference: an add-on annex, lecture hall, for the university. Save as annex-lectureHall.glb.
Site 9 x 8 m; the front faces -Z. One storey, about 5.5 m to the roof. Budget 400 triangles.
A one-storey lecture hall with a curved roof and tall windows.
```

### Extra bus bay (`annex-busBay.glb`)

```text
Citybloom model, following the model spec and style reference: an add-on annex, extra bus bay, for the bus depot. Save as annex-busBay.glb.
Site 9 x 8 m; the front faces -Z. One storey, about 5.5 m to the roof. Budget 400 triangles.
An open-fronted bus bay with a flat roof and one garage_door.
```

## Batch 7: Homes (27)

Each building comes in three wealth levels. File names are the game's ids: zone letter, density (0 low, 1 medium, 2 high), wealth (0 to 2) and level (1 to 3).

### Cottage, low wealth (`R001.glb`)

```text
Citybloom model, following the model spec and style reference: Cottage (homes, low density, low wealth). Save as R001.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 3 m to the roof. Budget 600 triangles.
A small one-storey cottage with a steep pitched roof and a chimney, set back behind a front garden with a path to the door, a low hedge along the sides, and a small back garden with a tree_spot. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

### Cottage, medium wealth (`R011.glb`)

```text
Citybloom model, following the model spec and style reference: Cottage (homes, low density, medium wealth). Save as R011.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 3 m to the roof. Budget 600 triangles.
A small one-storey cottage with a steep pitched roof and a chimney, set back behind a front garden with a path to the door, a low hedge along the sides, and a small back garden with a tree_spot. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### Cottage, high wealth (`R021.glb`)

```text
Citybloom model, following the model spec and style reference: Cottage (homes, low density, high wealth). Save as R021.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 3 m to the roof. Budget 600 triangles.
A small one-storey cottage with a steep pitched roof and a chimney, set back behind a front garden with a path to the door, a low hedge along the sides, and a small back garden with a tree_spot. High wealth: grand and generous, white or pale stone walls, bigger windows, columns or glass balconies, clipped hedges, and a pool (water) where there's room.
```

### Family house, low wealth (`R002.glb`)

```text
Citybloom model, following the model spec and style reference: Family house (homes, low density, low wealth). Save as R002.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 900 triangles.
A two-storey family house with a pitched or hipped roof, a porch over the front door, a driveway to a garage_door at one side, a front lawn, and a back garden with a tree_spot. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

### Family house, medium wealth (`R012.glb`)

```text
Citybloom model, following the model spec and style reference: Family house (homes, low density, medium wealth). Save as R012.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 900 triangles.
A two-storey family house with a pitched or hipped roof, a porch over the front door, a driveway to a garage_door at one side, a front lawn, and a back garden with a tree_spot. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### Family house, high wealth (`R022.glb`)

```text
Citybloom model, following the model spec and style reference: Family house (homes, low density, high wealth). Save as R022.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 900 triangles.
A two-storey family house with a pitched or hipped roof, a porch over the front door, a driveway to a garage_door at one side, a front lawn, and a back garden with a tree_spot. High wealth: grand and generous, white or pale stone walls, bigger windows, columns or glass balconies, clipped hedges, and a pool (water) where there's room.
```

### Villa, low wealth (`R003.glb`)

```text
Citybloom model, following the model spec and style reference: Villa (homes, low density, low wealth). Save as R003.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 1,100 triangles.
A roomy two-storey villa with an L-shaped plan, a big roof with dormers, a garage, a patio at the back, and a large back garden with two tree_spots. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

### Villa, medium wealth (`R013.glb`)

```text
Citybloom model, following the model spec and style reference: Villa (homes, low density, medium wealth). Save as R013.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 1,100 triangles.
A roomy two-storey villa with an L-shaped plan, a big roof with dormers, a garage, a patio at the back, and a large back garden with two tree_spots. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### Villa, high wealth (`R023.glb`)

```text
Citybloom model, following the model spec and style reference: Villa (homes, low density, high wealth). Save as R023.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 6 m to the roof. Budget 1,100 triangles.
A roomy two-storey villa with an L-shaped plan, a big roof with dormers, a garage, a patio at the back, and a large back garden with two tree_spots. High wealth: grand and generous, white or pale stone walls, bigger windows, columns or glass balconies, clipped hedges, and a pool (water) where there's room.
```

### Townhouses, low wealth (`R101.glb`)

```text
Citybloom model, following the model spec and style reference: Townhouses (homes, medium density, low wealth). Save as R101.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 9 m to the roof. Budget 1,400 triangles.
A terrace of three or four narrow three-storey townhouses sharing walls, each with its own front door, steps and small front garden, chimneys on the roofs, and small back yards. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

### Townhouses, medium wealth (`R111.glb`)

```text
Citybloom model, following the model spec and style reference: Townhouses (homes, medium density, medium wealth). Save as R111.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 9 m to the roof. Budget 1,400 triangles.
A terrace of three or four narrow three-storey townhouses sharing walls, each with its own front door, steps and small front garden, chimneys on the roofs, and small back yards. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### Townhouses, high wealth (`R121.glb`)

```text
Citybloom model, following the model spec and style reference: Townhouses (homes, medium density, high wealth). Save as R121.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 9 m to the roof. Budget 1,400 triangles.
A terrace of three or four narrow three-storey townhouses sharing walls, each with its own front door, steps and small front garden, chimneys on the roofs, and small back yards. High wealth: grand and generous, white or pale stone walls, bigger windows, columns or glass balconies, clipped hedges, and a pool (water) where there's room.
```

### Apartment block, low wealth (`R102.glb`)

```text
Citybloom model, following the model spec and style reference: Apartment block (homes, medium density, low wealth). Save as R102.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 12 m to the roof. Budget 1,500 triangles.
A four-storey apartment block with a central entrance under a canopy, solid slab balconies, a flat roof with a planted box, a bike shed, and a shared garden behind. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

### Apartment block, medium wealth (`R112.glb`)

```text
Citybloom model, following the model spec and style reference: Apartment block (homes, medium density, medium wealth). Save as R112.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 12 m to the roof. Budget 1,500 triangles.
A four-storey apartment block with a central entrance under a canopy, solid slab balconies, a flat roof with a planted box, a bike shed, and a shared garden behind. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### Apartment block, high wealth (`R122.glb`)

```text
Citybloom model, following the model spec and style reference: Apartment block (homes, medium density, high wealth). Save as R122.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 12 m to the roof. Budget 1,500 triangles.
A four-storey apartment block with a central entrance under a canopy, solid slab balconies, a flat roof with a planted box, a bike shed, and a shared garden behind. High wealth: grand and generous, white or pale stone walls, bigger windows, columns or glass balconies, clipped hedges, and a pool (water) where there's room.
```

### Courtyard apartments, low wealth (`R103.glb`)

Already made: the tenement in `assets/models/R103.glb`. It's 8 m wide, so three of them side by side fill this lot. For variety later, this prompt makes a courtyard block as a second design:

```text
Citybloom model, following the model spec and style reference: Courtyard apartments (homes, medium density, low wealth). Save as R103-2.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 6 storeys, about 18 m to the roof. Budget 1,800 triangles.
A six-storey U-shaped apartment block around a garden courtyard open to the back, an arched entrance at the front, balconies, and a roof terrace. Low wealth: modest and simple, plain pastel walls, small gardens and simple roofs; cheerful rather than shabby.
```

### Courtyard apartments, medium wealth (`R113.glb`)

```text
Citybloom model, following the model spec and style reference: Courtyard apartments (homes, medium density, medium wealth). Save as R113.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 6 storeys, about 18 m to the roof. Budget 1,800 triangles.
A six-storey U-shaped apartment block around a garden courtyard open to the back, an arched entrance at the front, balconies, and a roof terrace. Medium wealth: well kept, with bay windows or porches, neat gardens and tidy details.
```

### Courtyard apartments, high wealth (`R123.glb`)

```text
Citybloom model, following the model spec and style reference: Courtyard apartments (homes, medium density, high wealth). Save as R123.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 6 storeys, about 18 m to the roof. Budget 1,800 triangles.
A six-storey U-shaped apartment block around a garden courtyard open to the back, an arched entrance at the front, balconies, and a roof terrace. High wealth: grand and generous, white or pale stone walls, bigger windows, columns or glass balconies, clipped hedges, and a pool (water) where there's room.
```

### Residential tower, low wealth (`R201.glb`)

```text
Citybloom model, following the model spec and style reference: Residential tower (homes, high density, low wealth). Save as R201.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 10 storeys, about 30 m to the roof. Budget 2,000 triangles.
A ten-storey residential tower on a two-storey podium, balconies on every floor, a lobby canopy, and a plant room and water_tank on the roof. Low wealth: a plain, economical tower with simple balconies and pastel panels.
```

### Residential tower, medium wealth (`R211.glb`)

```text
Citybloom model, following the model spec and style reference: Residential tower (homes, high density, medium wealth). Save as R211.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 10 storeys, about 30 m to the roof. Budget 2,000 triangles.
A ten-storey residential tower on a two-storey podium, balconies on every floor, a lobby canopy, and a plant room and water_tank on the roof. Medium wealth: a smart tower with generous balconies and a landscaped entrance.
```

### Residential tower, high wealth (`R221.glb`)

```text
Citybloom model, following the model spec and style reference: Residential tower (homes, high density, high wealth). Save as R221.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 10 storeys, about 30 m to the roof. Budget 2,000 triangles.
A ten-storey residential tower on a two-storey podium, balconies on every floor, a lobby canopy, and a plant room and water_tank on the roof. High wealth: an elegant tower in white and glass, with glass balconies and a rooftop garden.
```

### High-rise, low wealth (`R202.glb`)

```text
Citybloom model, following the model spec and style reference: High-rise (homes, high density, low wealth). Save as R202.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 16 storeys, about 48 m to the roof. Budget 2,500 triangles.
A sixteen-storey high-rise, as a slab or a cross-shaped tower, with balconies, an entrance canopy, and a small plaza with tree_spots at its foot. Low wealth: a plain, economical tower with simple balconies and pastel panels.
```

### High-rise, medium wealth (`R212.glb`)

```text
Citybloom model, following the model spec and style reference: High-rise (homes, high density, medium wealth). Save as R212.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 16 storeys, about 48 m to the roof. Budget 2,500 triangles.
A sixteen-storey high-rise, as a slab or a cross-shaped tower, with balconies, an entrance canopy, and a small plaza with tree_spots at its foot. Medium wealth: a smart tower with generous balconies and a landscaped entrance.
```

### High-rise, high wealth (`R222.glb`)

```text
Citybloom model, following the model spec and style reference: High-rise (homes, high density, high wealth). Save as R222.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 16 storeys, about 48 m to the roof. Budget 2,500 triangles.
A sixteen-storey high-rise, as a slab or a cross-shaped tower, with balconies, an entrance canopy, and a small plaza with tree_spots at its foot. High wealth: an elegant tower in white and glass, with glass balconies and a rooftop garden.
```

### Skyline residences, low wealth (`R203.glb`)

```text
Citybloom model, following the model spec and style reference: Skyline residences (homes, high density, low wealth). Save as R203.glb.
Lot 24 x 32 m (3 x 4 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 24 storeys, about 72 m to the roof. Budget 3,000 triangles.
A slender 24-storey tower with setbacks near the top, a distinctive crown, sky gardens on a couple of levels, and a landscaped entrance court. Low wealth: a plain, economical tower with simple balconies and pastel panels.
```

### Skyline residences, medium wealth (`R213.glb`)

```text
Citybloom model, following the model spec and style reference: Skyline residences (homes, high density, medium wealth). Save as R213.glb.
Lot 24 x 32 m (3 x 4 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 24 storeys, about 72 m to the roof. Budget 3,000 triangles.
A slender 24-storey tower with setbacks near the top, a distinctive crown, sky gardens on a couple of levels, and a landscaped entrance court. Medium wealth: a smart tower with generous balconies and a landscaped entrance.
```

### Skyline residences, high wealth (`R223.glb`)

```text
Citybloom model, following the model spec and style reference: Skyline residences (homes, high density, high wealth). Save as R223.glb.
Lot 24 x 32 m (3 x 4 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 24 storeys, about 72 m to the roof. Budget 3,000 triangles.
A slender 24-storey tower with setbacks near the top, a distinctive crown, sky gardens on a couple of levels, and a landscaped entrance court. High wealth: an elegant tower in white and glass, with glass balconies and a rooftop garden.
```

## Batch 8: Shops and offices (27)

Each building comes in three wealth levels. File names are the game's ids: zone letter, density (0 low, 1 medium, 2 high), wealth (0 to 2) and level (1 to 3).

### Corner shop, low wealth (`C001.glb`)

```text
Citybloom model, following the model spec and style reference: Corner shop (shops and offices, low density, low wealth). Save as C001.glb.
Lot 8 x 8 m (1 x 1 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 500 triangles.
A tiny corner shop filling most of its lot: a big shop window (shop_glass), a striped awning, a sign panel over the door, and crates of produce out front as chunky blocks. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

### Corner shop, medium wealth (`C011.glb`)

```text
Citybloom model, following the model spec and style reference: Corner shop (shops and offices, low density, medium wealth). Save as C011.glb.
Lot 8 x 8 m (1 x 1 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 500 triangles.
A tiny corner shop filling most of its lot: a big shop window (shop_glass), a striped awning, a sign panel over the door, and crates of produce out front as chunky blocks. Medium wealth: tidy and smart, with better materials and planters.
```

### Corner shop, high wealth (`C021.glb`)

```text
Citybloom model, following the model spec and style reference: Corner shop (shops and offices, low density, high wealth). Save as C021.glb.
Lot 8 x 8 m (1 x 1 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 500 triangles.
A tiny corner shop filling most of its lot: a big shop window (shop_glass), a striped awning, a sign panel over the door, and crates of produce out front as chunky blocks. High wealth: upmarket, with lots of glass (shop_glass), pale stone and elegant canopies.
```

### Shopfront, low wealth (`C002.glb`)

```text
Citybloom model, following the model spec and style reference: Shopfront (shops and offices, low density, low wealth). Save as C002.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 700 triangles.
A single shop with a big display window, awning and sign at the front, a stockroom behind, and a small service yard at the back. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

### Shopfront, medium wealth (`C012.glb`)

```text
Citybloom model, following the model spec and style reference: Shopfront (shops and offices, low density, medium wealth). Save as C012.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 700 triangles.
A single shop with a big display window, awning and sign at the front, a stockroom behind, and a small service yard at the back. Medium wealth: tidy and smart, with better materials and planters.
```

### Shopfront, high wealth (`C022.glb`)

```text
Citybloom model, following the model spec and style reference: Shopfront (shops and offices, low density, high wealth). Save as C022.glb.
Lot 8 x 16 m (1 x 2 cells of 8 m, 8 m along the road); the front is on the road, facing -Z. One storey, about 4 m to the roof. Budget 700 triangles.
A single shop with a big display window, awning and sign at the front, a stockroom behind, and a small service yard at the back. High wealth: upmarket, with lots of glass (shop_glass), pale stone and elegant canopies.
```

### Market hall, low wealth (`C003.glb`)

```text
Citybloom model, following the model spec and style reference: Market hall (shops and offices, low density, low wealth). Save as C003.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 8 m to the roof. Budget 1,200 triangles.
A covered market hall with a tall arched or gabled roof, open front bays with stalls under colourful awnings, and a row of high windows. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

### Market hall, medium wealth (`C013.glb`)

```text
Citybloom model, following the model spec and style reference: Market hall (shops and offices, low density, medium wealth). Save as C013.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 8 m to the roof. Budget 1,200 triangles.
A covered market hall with a tall arched or gabled roof, open front bays with stalls under colourful awnings, and a row of high windows. Medium wealth: tidy and smart, with better materials and planters.
```

### Market hall, high wealth (`C023.glb`)

```text
Citybloom model, following the model spec and style reference: Market hall (shops and offices, low density, high wealth). Save as C023.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 8 m to the roof. Budget 1,200 triangles.
A covered market hall with a tall arched or gabled roof, open front bays with stalls under colourful awnings, and a row of high windows. High wealth: upmarket, with lots of glass (shop_glass), pale stone and elegant canopies.
```

### Shopping row, low wealth (`C101.glb`)

```text
Citybloom model, following the model spec and style reference: Shopping row (shops and offices, medium density, low wealth). Save as C101.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 11 m to the roof. Budget 1,400 triangles.
A row of three shops at street level with awnings and signs, two floors of flats or offices above, and ac_units on the flat roof. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

### Shopping row, medium wealth (`C111.glb`)

```text
Citybloom model, following the model spec and style reference: Shopping row (shops and offices, medium density, medium wealth). Save as C111.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 11 m to the roof. Budget 1,400 triangles.
A row of three shops at street level with awnings and signs, two floors of flats or offices above, and ac_units on the flat roof. Medium wealth: tidy and smart, with better materials and planters.
```

### Shopping row, high wealth (`C121.glb`)

```text
Citybloom model, following the model spec and style reference: Shopping row (shops and offices, medium density, high wealth). Save as C121.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 3 storeys, about 11 m to the roof. Budget 1,400 triangles.
A row of three shops at street level with awnings and signs, two floors of flats or offices above, and ac_units on the flat roof. High wealth: upmarket, with lots of glass (shop_glass), pale stone and elegant canopies.
```

### Office block, low wealth (`C102.glb`)

```text
Citybloom model, following the model spec and style reference: Office block (shops and offices, medium density, low wealth). Save as C102.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 15 m to the roof. Budget 1,500 triangles.
A four-storey office block with window_bands, an entrance canopy, rooftop plant, and a small car park behind. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

### Office block, medium wealth (`C112.glb`)

```text
Citybloom model, following the model spec and style reference: Office block (shops and offices, medium density, medium wealth). Save as C112.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 15 m to the roof. Budget 1,500 triangles.
A four-storey office block with window_bands, an entrance canopy, rooftop plant, and a small car park behind. Medium wealth: tidy and smart, with better materials and planters.
```

### Office block, high wealth (`C122.glb`)

```text
Citybloom model, following the model spec and style reference: Office block (shops and offices, medium density, high wealth). Save as C122.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 4 storeys, about 15 m to the roof. Budget 1,500 triangles.
A four-storey office block with window_bands, an entrance canopy, rooftop plant, and a small car park behind. High wealth: upmarket, with lots of glass (shop_glass), pale stone and elegant canopies.
```

### Department store, low wealth (`C103.glb`)

```text
Citybloom model, following the model spec and style reference: Department store (shops and offices, medium density, low wealth). Save as C103.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 6 storeys, about 22 m to the roof. Budget 2,000 triangles.
A six-storey department store with display windows all along the ground floor, a grand entrance, a big sign panel on the roof edge, and rooftop plant. Low wealth: cheap and cheerful, bold signs and simple boxy shapes.
```

### Department store, medium wealth (`C113.glb`)

```text
Citybloom model, following the model spec and style reference: Department store (shops and offices, medium density, medium wealth). Save as C113.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 6 storeys, about 22 m to the roof. Budget 2,000 triangles.
A six-storey department store with display windows all along the ground floor, a grand entrance, a big sign panel on the roof edge, and rooftop plant. Medium wealth: tidy and smart, with better materials and planters.
```

### Department store, high wealth (`C123.glb`)

```text
Citybloom model, following the model spec and style reference: Department store (shops and offices, medium density, high wealth). Save as C123.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 6 storeys, about 22 m to the roof. Budget 2,000 triangles.
A six-storey department store with display windows all along the ground floor, a grand entrance, a big sign panel on the roof edge, and rooftop plant. High wealth: upmarket, with lots of glass (shop_glass), pale stone and elegant canopies.
```

### Office tower, low wealth (`C201.glb`)

```text
Citybloom model, following the model spec and style reference: Office tower (shops and offices, high density, low wealth). Save as C201.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 10 storeys, about 36 m to the roof. Budget 2,000 triangles.
A ten-storey glass office tower (window_bands) on a lobby podium with a canopy. Low wealth: a plainer, economical tower with simpler shapes and fewer flourishes.
```

### Office tower, medium wealth (`C211.glb`)

```text
Citybloom model, following the model spec and style reference: Office tower (shops and offices, high density, medium wealth). Save as C211.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 10 storeys, about 36 m to the roof. Budget 2,000 triangles.
A ten-storey glass office tower (window_bands) on a lobby podium with a canopy. Medium wealth: a smart tower in glass and stone.
```

### Office tower, high wealth (`C221.glb`)

```text
Citybloom model, following the model spec and style reference: Office tower (shops and offices, high density, high wealth). Save as C221.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 10 storeys, about 36 m to the roof. Budget 2,000 triangles.
A ten-storey glass office tower (window_bands) on a lobby podium with a canopy. High wealth: a landmark-quality tower in glass and pale stone, with an elegant crown and canopy.
```

### Commercial tower, low wealth (`C202.glb`)

```text
Citybloom model, following the model spec and style reference: Commercial tower (shops and offices, high density, low wealth). Save as C202.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 16 storeys, about 58 m to the roof. Budget 2,500 triangles.
A sixteen-storey commercial tower with a stepped profile and a shopping podium with shopfronts and awnings. Low wealth: a plainer, economical tower with simpler shapes and fewer flourishes.
```

### Commercial tower, medium wealth (`C212.glb`)

```text
Citybloom model, following the model spec and style reference: Commercial tower (shops and offices, high density, medium wealth). Save as C212.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 16 storeys, about 58 m to the roof. Budget 2,500 triangles.
A sixteen-storey commercial tower with a stepped profile and a shopping podium with shopfronts and awnings. Medium wealth: a smart tower in glass and stone.
```

### Commercial tower, high wealth (`C222.glb`)

```text
Citybloom model, following the model spec and style reference: Commercial tower (shops and offices, high density, high wealth). Save as C222.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 16 storeys, about 58 m to the roof. Budget 2,500 triangles.
A sixteen-storey commercial tower with a stepped profile and a shopping podium with shopfronts and awnings. High wealth: a landmark-quality tower in glass and pale stone, with an elegant crown and canopy.
```

### Headquarters, low wealth (`C203.glb`)

```text
Citybloom model, following the model spec and style reference: Headquarters (shops and offices, high density, low wealth). Save as C203.glb.
Lot 24 x 32 m (3 x 4 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 3,000 triangles.
A striking 26-storey headquarters tower with a sculpted crown, a sign panel near the top, and a plaza at its foot with planters and tree_spots. Low wealth: a plainer, economical tower with simpler shapes and fewer flourishes.
```

### Headquarters, medium wealth (`C213.glb`)

```text
Citybloom model, following the model spec and style reference: Headquarters (shops and offices, high density, medium wealth). Save as C213.glb.
Lot 24 x 32 m (3 x 4 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 3,000 triangles.
A striking 26-storey headquarters tower with a sculpted crown, a sign panel near the top, and a plaza at its foot with planters and tree_spots. Medium wealth: a smart tower in glass and stone.
```

### Headquarters, high wealth (`C223.glb`)

```text
Citybloom model, following the model spec and style reference: Headquarters (shops and offices, high density, high wealth). Save as C223.glb.
Lot 24 x 32 m (3 x 4 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 26 storeys, about 94 m to the roof. Budget 3,000 triangles.
A striking 26-storey headquarters tower with a sculpted crown, a sign panel near the top, and a plaza at its foot with planters and tree_spots. High wealth: a landmark-quality tower in glass and pale stone, with an elegant crown and canopy.
```

## Batch 9: Industry (27)

For industry, the three versions of each building are its tiers (heavy industry, manufacturing and high-tech) rather than wealth levels.

### Workshop, heavy industry (`I001.glb`)

```text
Citybloom model, following the model spec and style reference: Workshop (industry, low density, heavy industry). Save as I001.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 800 triangles.
A small workshop: one shed with a big garage_door, a side office, and a yard. Heavy industry: brick and rusty metal, sawtooth or gabled roofs, one or two tall chimneys named smoke_stack, silos or storage tanks, and heaps of material in a busy yard.
```

### Workshop, manufacturing (`I011.glb`)

```text
Citybloom model, following the model spec and style reference: Workshop (industry, low density, manufacturing). Save as I011.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 800 triangles.
A small workshop: one shed with a big garage_door, a side office, and a yard. Manufacturing: clean sheet-metal halls in grey and blue with sawtooth roofs, roller doors and a small office. No smoke.
```

### Workshop, high-tech (`I021.glb`)

```text
Citybloom model, following the model spec and style reference: Workshop (industry, low density, high-tech). Save as I021.glb.
Lot 16 x 16 m (2 x 2 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 800 triangles.
A small workshop: one shed with a big garage_door, a side office, and a yard. High-tech: sleek white and glass buildings, solar panels on the roofs, landscaped grounds with tree_spots, and a satellite dish. No smoke.
```

### Warehouse, heavy industry (`I002.glb`)

```text
Citybloom model, following the model spec and style reference: Warehouse (industry, low density, heavy industry). Save as I002.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 1,000 triangles.
A warehouse with loading docks and garage_doors along one side, and a truck yard. Heavy industry: brick and rusty metal, sawtooth or gabled roofs, one or two tall chimneys named smoke_stack, silos or storage tanks, and heaps of material in a busy yard.
```

### Warehouse, manufacturing (`I012.glb`)

```text
Citybloom model, following the model spec and style reference: Warehouse (industry, low density, manufacturing). Save as I012.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 1,000 triangles.
A warehouse with loading docks and garage_doors along one side, and a truck yard. Manufacturing: clean sheet-metal halls in grey and blue with sawtooth roofs, roller doors and a small office. No smoke.
```

### Warehouse, high-tech (`I022.glb`)

```text
Citybloom model, following the model spec and style reference: Warehouse (industry, low density, high-tech). Save as I022.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. One tall storey, about 7 m to the roof. Budget 1,000 triangles.
A warehouse with loading docks and garage_doors along one side, and a truck yard. High-tech: sleek white and glass buildings, solar panels on the roofs, landscaped grounds with tree_spots, and a satellite dish. No smoke.
```

### Plant, heavy industry (`I003.glb`)

```text
Citybloom model, following the model spec and style reference: Plant (industry, low density, heavy industry). Save as I003.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A small plant: a production hall, a two-storey office, storage, and a yard. Heavy industry: brick and rusty metal, sawtooth or gabled roofs, one or two tall chimneys named smoke_stack, silos or storage tanks, and heaps of material in a busy yard.
```

### Plant, manufacturing (`I013.glb`)

```text
Citybloom model, following the model spec and style reference: Plant (industry, low density, manufacturing). Save as I013.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A small plant: a production hall, a two-storey office, storage, and a yard. Manufacturing: clean sheet-metal halls in grey and blue with sawtooth roofs, roller doors and a small office. No smoke.
```

### Plant, high-tech (`I023.glb`)

```text
Citybloom model, following the model spec and style reference: Plant (industry, low density, high-tech). Save as I023.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A small plant: a production hall, a two-storey office, storage, and a yard. High-tech: sleek white and glass buildings, solar panels on the roofs, landscaped grounds with tree_spots, and a satellite dish. No smoke.
```

### Factory, heavy industry (`I101.glb`)

```text
Citybloom model, following the model spec and style reference: Factory (industry, medium density, heavy industry). Save as I101.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A factory hall with a two-storey office at the front and a loading yard at the side. Heavy industry: brick and rusty metal, sawtooth or gabled roofs, one or two tall chimneys named smoke_stack, silos or storage tanks, and heaps of material in a busy yard.
```

### Factory, manufacturing (`I111.glb`)

```text
Citybloom model, following the model spec and style reference: Factory (industry, medium density, manufacturing). Save as I111.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A factory hall with a two-storey office at the front and a loading yard at the side. Manufacturing: clean sheet-metal halls in grey and blue with sawtooth roofs, roller doors and a small office. No smoke.
```

### Factory, high-tech (`I121.glb`)

```text
Citybloom model, following the model spec and style reference: Factory (industry, medium density, high-tech). Save as I121.glb.
Lot 16 x 24 m (2 x 3 cells of 8 m, 16 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 1,500 triangles.
A factory hall with a two-storey office at the front and a loading yard at the side. High-tech: sleek white and glass buildings, solar panels on the roofs, landscaped grounds with tree_spots, and a satellite dish. No smoke.
```

### Assembly works, heavy industry (`I102.glb`)

```text
Citybloom model, following the model spec and style reference: Assembly works (industry, medium density, heavy industry). Save as I102.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 2,000 triangles.
Assembly works: two connected halls, loading docks, and a yard. Heavy industry: brick and rusty metal, sawtooth or gabled roofs, one or two tall chimneys named smoke_stack, silos or storage tanks, and heaps of material in a busy yard.
```

### Assembly works, manufacturing (`I112.glb`)

```text
Citybloom model, following the model spec and style reference: Assembly works (industry, medium density, manufacturing). Save as I112.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 2,000 triangles.
Assembly works: two connected halls, loading docks, and a yard. Manufacturing: clean sheet-metal halls in grey and blue with sawtooth roofs, roller doors and a small office. No smoke.
```

### Assembly works, high-tech (`I122.glb`)

```text
Citybloom model, following the model spec and style reference: Assembly works (industry, medium density, high-tech). Save as I122.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 2 storeys, about 11 m to the roof. Budget 2,000 triangles.
Assembly works: two connected halls, loading docks, and a yard. High-tech: sleek white and glass buildings, solar panels on the roofs, landscaped grounds with tree_spots, and a satellite dish. No smoke.
```

### Industrial complex, heavy industry (`I103.glb`)

```text
Citybloom model, following the model spec and style reference: Industrial complex (industry, medium density, heavy industry). Save as I103.glb.
Lot 24 x 32 m (3 x 4 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,500 triangles.
An industrial complex: several halls around a yard, storage tanks or silos, and an office block. Heavy industry: brick and rusty metal, sawtooth or gabled roofs, one or two tall chimneys named smoke_stack, silos or storage tanks, and heaps of material in a busy yard.
```

### Industrial complex, manufacturing (`I113.glb`)

```text
Citybloom model, following the model spec and style reference: Industrial complex (industry, medium density, manufacturing). Save as I113.glb.
Lot 24 x 32 m (3 x 4 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,500 triangles.
An industrial complex: several halls around a yard, storage tanks or silos, and an office block. Manufacturing: clean sheet-metal halls in grey and blue with sawtooth roofs, roller doors and a small office. No smoke.
```

### Industrial complex, high-tech (`I123.glb`)

```text
Citybloom model, following the model spec and style reference: Industrial complex (industry, medium density, high-tech). Save as I123.glb.
Lot 24 x 32 m (3 x 4 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,500 triangles.
An industrial complex: several halls around a yard, storage tanks or silos, and an office block. High-tech: sleek white and glass buildings, solar panels on the roofs, landscaped grounds with tree_spots, and a satellite dish. No smoke.
```

### Big factory, heavy industry (`I201.glb`)

```text
Citybloom model, following the model spec and style reference: Big factory (industry, high density, heavy industry). Save as I201.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,500 triangles.
A big factory: one large hall, an office wing, and a loading yard. Heavy industry: brick and rusty metal, sawtooth or gabled roofs, one or two tall chimneys named smoke_stack, silos or storage tanks, and heaps of material in a busy yard.
```

### Big factory, manufacturing (`I211.glb`)

```text
Citybloom model, following the model spec and style reference: Big factory (industry, high density, manufacturing). Save as I211.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,500 triangles.
A big factory: one large hall, an office wing, and a loading yard. Manufacturing: clean sheet-metal halls in grey and blue with sawtooth roofs, roller doors and a small office. No smoke.
```

### Big factory, high-tech (`I221.glb`)

```text
Citybloom model, following the model spec and style reference: Big factory (industry, high density, high-tech). Save as I221.glb.
Lot 24 x 24 m (3 x 3 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 3 storeys, about 15 m to the roof. Budget 2,500 triangles.
A big factory: one large hall, an office wing, and a loading yard. High-tech: sleek white and glass buildings, solar panels on the roofs, landscaped grounds with tree_spots, and a satellite dish. No smoke.
```

### Processing works, heavy industry (`I202.glb`)

```text
Citybloom model, following the model spec and style reference: Processing works (industry, high density, heavy industry). Save as I202.glb.
Lot 24 x 32 m (3 x 4 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 4 storeys, about 19 m to the roof. Budget 3,000 triangles.
Processing works: tall process buildings, tanks and chunky pipework (at least 0.4 m thick), linked by covered bridges. Heavy industry: brick and rusty metal, sawtooth or gabled roofs, one or two tall chimneys named smoke_stack, silos or storage tanks, and heaps of material in a busy yard.
```

### Processing works, manufacturing (`I212.glb`)

```text
Citybloom model, following the model spec and style reference: Processing works (industry, high density, manufacturing). Save as I212.glb.
Lot 24 x 32 m (3 x 4 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 4 storeys, about 19 m to the roof. Budget 3,000 triangles.
Processing works: tall process buildings, tanks and chunky pipework (at least 0.4 m thick), linked by covered bridges. Manufacturing: clean sheet-metal halls in grey and blue with sawtooth roofs, roller doors and a small office. No smoke.
```

### Processing works, high-tech (`I222.glb`)

```text
Citybloom model, following the model spec and style reference: Processing works (industry, high density, high-tech). Save as I222.glb.
Lot 24 x 32 m (3 x 4 cells of 8 m, 24 m along the road); the front is on the road, facing -Z. 4 storeys, about 19 m to the roof. Budget 3,000 triangles.
Processing works: tall process buildings, tanks and chunky pipework (at least 0.4 m thick), linked by covered bridges. High-tech: sleek white and glass buildings, solar panels on the roofs, landscaped grounds with tree_spots, and a satellite dish. No smoke.
```

### Industrial park, heavy industry (`I203.glb`)

```text
Citybloom model, following the model spec and style reference: Industrial park (industry, high density, heavy industry). Save as I203.glb.
Lot 32 x 32 m (4 x 4 cells of 8 m, 32 m along the road); the front is on the road, facing -Z. 5 storeys, about 23 m to the roof. Budget 3,500 triangles.
An industrial park: three or four buildings of different sizes around shared roads and a car park, with landscaping. Heavy industry: brick and rusty metal, sawtooth or gabled roofs, one or two tall chimneys named smoke_stack, silos or storage tanks, and heaps of material in a busy yard.
```

### Industrial park, manufacturing (`I213.glb`)

```text
Citybloom model, following the model spec and style reference: Industrial park (industry, high density, manufacturing). Save as I213.glb.
Lot 32 x 32 m (4 x 4 cells of 8 m, 32 m along the road); the front is on the road, facing -Z. 5 storeys, about 23 m to the roof. Budget 3,500 triangles.
An industrial park: three or four buildings of different sizes around shared roads and a car park, with landscaping. Manufacturing: clean sheet-metal halls in grey and blue with sawtooth roofs, roller doors and a small office. No smoke.
```

### Industrial park, high-tech (`I223.glb`)

```text
Citybloom model, following the model spec and style reference: Industrial park (industry, high density, high-tech). Save as I223.glb.
Lot 32 x 32 m (4 x 4 cells of 8 m, 32 m along the road); the front is on the road, facing -Z. 5 storeys, about 23 m to the roof. Budget 3,500 triangles.
An industrial park: three or four buildings of different sizes around shared roads and a car park, with landscaping. High-tech: sleek white and glass buildings, solar panels on the roofs, landscaped grounds with tree_spots, and a satellite dish. No smoke.
```
