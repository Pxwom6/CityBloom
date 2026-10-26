# Citybloom model prompts: war

These are prompts for every military building, unit and superweapon in the war phase (SPEC-5.md), and for the atom bomb at the very end. Make them in Claude Design as GLB models, as you did for the buildings. The game generates its own look for anything without a model, so you can make them in any order and stop at any point.

## How to use

1. In Claude Design, start a canvas for a batch and attach `style-reference.png` (in `docs/models/`).
2. Paste the right spec once at the start of each canvas:
   - the **model spec (v6)** for buildings (batches W1, W2 and W6, and the buildings in W5);
   - the **unit spec (v1)** for units (batches W3 and W4, and the units in W5).
3. Paste one prompt at a time, and download each model as a GLB with the file name in its prompt.
4. Keep the files together in one folder, for example `Downloads/citybloom-war`. War isn't in the game yet; the war session's brief tells Claude Code to bring these in, check them, and take each building's site and each unit's size from these prompts.

**Where to start:** batches W1 and W3. These are the barracks, depots, airfield and the tanks and planes, which you'll see most. Then W2 and W4, and the superweapons and the atom bomb last.

## The model spec (v6), for buildings

This is the same spec as `docs/models/PROMPTS-5.md`.

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

## The unit spec (v1), for units

```text
Citybloom unit spec (v1). Follow it for every unit (vehicles, aircraft, ships, soldiers and superweapon machines), and match the attached style reference sheet.

Style
- Bright, warm and toy-like, like the buildings: chunky, simple shapes with clean edges, like a well-made toy or board-game piece. Friendly and a little round, never grim.
- Original designs only: nothing copied from a real tank, plane, ship or army, or from another game. No flags, insignia, numbers, lettering or logos; markings are plain colour panels and stripes.
- No fiddly detail: nothing thinner than about 0.3 m (no aerials, rails, cables or thin guns). Make what reads from above bold: turrets, rotors, decks, stripes.
- No crew, pilots or passengers on vehicles. The infantry squad is the only unit with figures.

Format
- One GLB file per unit, with every part as its own named mesh (don't merge them). Use the file name given in the prompt.
- Metres, y up. The origin is on the ground under the middle of the unit. For aircraft, the wheels or skids touch 0 at rest; for ships and submarines, the waterline is at 0 and the hull goes below it. The front points along -Z; x runs across.
- Keep to the size in the prompt, within about 10 %.

Materials: plain colours, no textures, named exactly by role
- body, body_alt, trim, metal, rubber, glass, accent, light, wood, grass.
- The game paints body and body_alt in the owning player's colours, so any colour is a fine default. accent is for hazard stripes and bright details, light for lamps (they glow at night), and rubber for tyres and tracks.

Moving parts: separate meshes, named by what they are, each centred on the point it turns about
- turret (turns about its vertical centre) and barrel (moves with its turret).
- muzzle: a 0.3 m cube at the tip of every barrel or gun, which the game hides and fires from.
- rotor, tail_rotor, propeller and wheel (each wheel and each propeller is its own part).
- track_left and track_right.
- hatch, and ramp (hinged at its bottom edge).
- radar_dish, crane and windup_key.
- Limbs where a prompt names them: arm_left, arm_right, leg_left, leg_right, tail and jaw. Each is centred on its joint.
- exhaust: where engine smoke comes from.
- Nothing floats: every part touches the part it's fixed to.

Keep to the triangle budget in each prompt.
```

## Batch W1: Military buildings (7)

### Barracks (`barracks.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Barracks. Save as barracks.glb.
Site 40 x 32 m (40 m along the road, 32 m deep); the front is on the road, facing -Z. Budget 2,500 triangles.
A toy-like army barracks: two long two-storey bunk blocks in warm sand-coloured walls with green roofs and a row of windows on every floor, framing a paved parade square with painted lines as flat shapes. At the road, a small gatehouse with a chunky red-and-white striped barrier arm (at least 0.4 m thick) and a plain coloured sign panel. At the back, an obstacle course of chunky wooden walls, a climbing frame of thick beams and stacks of tyres, and a small mess hall.
```

### Vehicle depot (`vehicledepot.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Vehicle depot. Save as vehicledepot.glb.
Site 48 x 40 m (48 m along the road, 40 m deep); the front is on the road, facing -Z. Budget 3,000 triangles.
Where tanks and trucks are built and kept: a big workshop hall about 10 m tall with three wide roller doors (garage_door) facing the road, a smaller assembly shed beside it, a paved yard with painted parking bays as flat shapes, a fuel canopy over two chunky pumps, and a gantry crane of thick beams over a test pad at the back. The game parks the vehicles.
```

### Airfield (`airfield.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Airfield. Save as airfield.glb.
Site 200 x 80 m (200 m along the road, 80 m deep); the front is on the road, facing -Z. Budget 5,000 triangles.
A military airfield. One runway runs the whole 200 m along the back (named runway, with markings as flat white shapes), with a taxiway in front of it. Three curved-roof hangars (named hangar) open onto the apron, a control tower (named control_tower) has a glass top, and there's a fuel farm of round tanks. A small crew building and a gatehouse stand at the road. Paint a helipad with a flat H on the apron. The game adds the planes and helicopters.
```

### Naval yard (`navalyard.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Naval yard. Save as navalyard.glb.
Site 120 x 64 m (120 m along the road, 64 m deep); the front is on the road, facing -Z. Budget 4,500 triangles.
A naval yard on deep water. The back edge of the site is a quay standing in deep water, with its walls going 8 m below 0 (named quay). Along the quay stand a covered dry dock with a curved roof, open to the water (named drydock), and a big crane of chunky beams (named crane). Behind them are stacks of crates and a workshop hall, with an office at the road side. The game adds the ships.
```

### Military HQ (`militaryhq.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Military headquarters. Save as militaryhq.glb.
Site 40 x 40 m (40 m along the road, 40 m deep); the front is on the road, facing -Z. Budget 3,000 triangles.
The headquarters that opens the war room: a solid three-storey block in sand or soft olive walls with a flat roof, a bold entrance with a deep canopy on chunky columns, a big round radar dome on the roof, a rooftop helipad (flat H), and a walled courtyard behind with lawns and tree_spots. Plain coloured sign panels, no insignia.
```

### Air-raid shelter (`shelter.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Air-raid shelter. Save as shelter.glb.
Site 16 x 16 m (16 m along the road, 16 m deep); the front is on the road, facing -Z. Budget 600 triangles.
A public air-raid shelter where residents wait out a raid: a grassy mound (grass) about 3 m high over most of the site, a concrete entrance block on the road side holding a heavy door with yellow-and-black hazard stripes (door, accent), two chunky vent stacks (vent) on top of the mound, and a paved path to the door.
```

### Bunker (`bunker.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Bunker. Save as bunker.glb.
Site 16 x 16 m (16 m along the road, 16 m deep); the front is on the road, facing -Z. Budget 700 triangles.
A squat defensive bunker: a low, thick concrete block with rounded corners and narrow dark firing slots (window_band in short pieces), half sunk into a grassy earth bank. Sandbag walls are chunky rounded blocks around it, and a steel door is at the back.
```

## Batch W2: Defences and support (9)

### Radar station (`radar.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Radar station. Save as radar.glb.
Site 24 x 24 m (24 m along the road, 24 m deep); the front is on the road, facing -Z. Budget 1,500 triangles.
A radar station: a small operations building, and a tower of solid stacked blocks (no lattice) about 18 m tall carrying a big chunky radar dish. The dish is named radar_dish and centred on the point it turns about; the game spins it. A white radome ball sits on a second, lower tower, in a gravel yard.
```

### Anti-air battery (`antiair.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Anti-air battery. Save as antiair.glb.
Site 16 x 16 m (16 m along the road, 16 m deep); the front is on the road, facing -Z. Budget 1,200 triangles.
An anti-aircraft battery: a round sandbagged emplacement around a chunky twin-barrelled gun on a turning base. The base and gun body are named turret, centred on its turning axis. The barrels are named barrel, with a 0.3 m cube named muzzle at each tip. An ammunition hut stands beside it.
```

### Coastal gun (`coastalgun.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Coastal gun. Save as coastalgun.glb.
Site 16 x 16 m (16 m along the road, 16 m deep); the front is on the road, facing -Z. Budget 1,200 triangles.
A coastal gun on the shore, facing out over the water at the back of the site: a concrete gun house with a rounded front, a big chunky gun on a turning turret (turret, barrel, with a muzzle cube at the tip), and a lookout hut. The back edge of the site is a stone quay dropping 3 m into the water (named quay).
```

### Interceptor battery (`interceptor.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Interceptor battery. Save as interceptor.glb.
Site 24 x 24 m (24 m along the road, 24 m deep); the front is on the road, facing -Z. Budget 1,500 triangles.
A missile-defence battery: a launcher of eight chunky upright tubes in a box (named launcher, which the game tilts) on a turning base (turret), a control cabin and a radar block, on a paved pad. The game launches the missiles.
```

### Shield generator (`shieldgen.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Shield generator. Save as shieldgen.glb.
Site 24 x 24 m (24 m along the road, 24 m deep); the front is on the road, facing -Z. Budget 1,500 triangles.
A shield generator from defence research: a squat round power building with four chunky pylons around it, holding up a big crystal-like emitter about 14 m up (named shield_emitter, in glass). The game draws the shield bubble over the neighbourhood.
```

### Arms factory (`armsfactory.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Arms factory. Save as armsfactory.glb.
Site 48 x 40 m (48 m along the road, 40 m deep); the front is on the road, facing -Z. Budget 3,000 triangles.
An arms factory, an industrial building that gives off smoke: a big saw-tooth-roofed production hall with roof lights in 3-4 m pieces (window_band), two smoke_stacks, a loading dock with roller doors (garage_door) facing the road, crates stacked in the yard, and a high earth bank at the back where the test range is.
```

### Weapons lab (`militarylab.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Weapons lab. Save as militarylab.glb.
Site 32 x 32 m (32 m along the road, 32 m deep); the front is on the road, facing -Z. Budget 2,500 triangles.
A weapons research lab: a sleek white two-storey building with a glass front, a big wind-tunnel tube of chunky segments (at least 3 m across) along one side, a test dish on the roof, and a test yard behind with chunky blast walls. No smoke.
```

### Proving ground (`provingground.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Proving ground. Save as provingground.glb.
Site 64 x 48 m (64 m along the road, 48 m deep); the front is on the road, facing -Z. Budget 2,500 triangles.
Where prototypes are tested before they're built. A sandy dirt test track (accent) loops round the site, with chunky ramps and a water splash pool. A firing range has big round targets (sign) on earth banks at the far end. An observation bunker has a long viewing slot facing the range, and there's a small hangar. The game adds the vehicles.
```

### Spy agency (`spyagency.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Spy agency. Save as spyagency.glb.
Site 24 x 24 m (24 m along the road, 24 m deep); the front is on the road, facing -Z. Budget 1,800 triangles.
A spy agency disguised as the dullest office in town: a plain beige four-storey block with identical windows on every side and very neat hedges, but with a give-away rooftop of three chunky satellite dishes and a big antenna block (no thin masts), and a heavy garage_door at the bottom of a ramp down into a basement. It should look as boring as possible from the street.
```

## Batch W3: Land and air units (10)

### Infantry squad (`unit-infantry.glb`)

```text
Citybloom unit, following the unit spec (v1) and style reference: Infantry squad. Save as unit-infantry.glb.
About 4 m across and 2.2 m tall. Budget 400 triangles.
Four chunky toy soldiers standing on one shared round base (metal, 0.3 m thick), like a board-game piece. They have simple rounded bodies and helmets, no faces, and stubby chunky rifles held across their chests. The uniforms are body (the game paints them in the owner's colour) and the helmets body_alt.
```

### Light tank (`unit-tank.glb`)

```text
Citybloom unit, following the unit spec (v1) and style reference: Light tank. Save as unit-tank.glb.
About 7 m long, 3.6 m wide and 2.8 m tall; the front faces -Z. Budget 700 triangles.
A chunky toy tank: a rounded hull on two tracks (track_left and track_right, in rubber) with big road wheels showing, a round dome turret (turret) with a short, thick barrel (barrel, with a muzzle at its tip), a hatch on top and two headlights (light). The hull is body; the turret top is body_alt.
```

### Heavy tank (`unit-heavytank.glb`)

```text
Citybloom unit, following the unit spec (v1) and style reference: Heavy tank. Save as unit-heavytank.glb.
About 9 m long, 4.4 m wide and 3.4 m tall; the front faces -Z. Budget 900 triangles.
A big, blocky heavy tank: a wide hull with armoured skirts over its tracks (track_left and track_right), a large boxy turret (turret) with a long, thick barrel (barrel, muzzle), stowage boxes on the back, and a stubby exhaust (exhaust).
```

### Artillery (`unit-artillery.glb`)

```text
Citybloom unit, following the unit spec (v1) and style reference: Artillery. Save as unit-artillery.glb.
About 8 m long, 3.2 m wide and 3.4 m tall; the front faces -Z. Budget 800 triangles.
A self-propelled gun: a six-wheeled truck body (six wheel parts) with a big gun on a turning mount at the back (turret; the barrel raised at about 30 degrees, with a muzzle), chunky stabiliser feet folded at its sides, and a cab at the front with big windows (glass).
```

### Transport truck (`unit-transport.glb`)

```text
Citybloom unit, following the unit spec (v1) and style reference: Transport truck. Save as unit-transport.glb.
About 8 m long, 3 m wide and 3.4 m tall; the front faces -Z. Budget 600 triangles.
A troop and supply truck: a rounded cab with big windows (glass), six chunky wheels (wheel), and a cargo bed under a rounded canvas cover (body_alt) with a tailgate.
```

### Repair truck (`unit-repair.glb`)

```text
Citybloom unit, following the unit spec (v1) and style reference: Repair truck. Save as unit-repair.glb.
About 7 m long, 3 m wide and 3.6 m tall; the front faces -Z. Budget 700 triangles.
A repair crew's truck: a cab, a flatbed carrying a chunky folding crane arm (named crane) and big toolboxes, and an orange beacon light block on the cab roof (light).
```

### Fighter plane (`unit-fighter.glb`)

```text
Citybloom unit, following the unit spec (v1) and style reference: Fighter plane. Save as unit-fighter.glb.
About 13 m long with a 12 m wingspan, 4 m tall standing on its wheels; the front faces -Z. Budget 800 triangles.
A toy jet fighter: a rounded fuselage with a bubble canopy (glass), swept wings and twin tail fins, two chunky engine intakes, three landing wheels (wheel) on short, thick legs, a muzzle cube at each wing-root gun, and an exhaust at the tail. No markings.
```

### Bomber (`unit-bomber.glb`)

```text
Citybloom unit, following the unit spec (v1) and style reference: Bomber. Save as unit-bomber.glb.
About 20 m long with a 26 m wingspan, 5 m tall standing on its wheels; the front faces -Z. Budget 1,100 triangles.
A big, friendly-looking bomber: a fat, round fuselage with a glass nose, straight wings carrying four propeller engines (each propeller its own part, centred on its hub), a twin tail, a bomb-bay door underneath (named hatch), and landing wheels (wheel).
```

### Helicopter (`unit-helicopter.glb`)

```text
Citybloom unit, following the unit spec (v1) and style reference: Helicopter. Save as unit-helicopter.glb.
About 15 m long including the rotor, 4.5 m tall; the front faces -Z. Budget 900 triangles.
A chunky helicopter: a rounded cabin with big windows (glass), skids, stubby side pods with rocket racks (a muzzle cube at the front of each), a tail boom with a small tail rotor (tail_rotor), and a four-blade main rotor (rotor, centred on its hub, blades at least 0.4 m wide).
```

### Drone (`unit-drone.glb`)

```text
Citybloom unit, following the unit spec (v1) and style reference: Drone. Save as unit-drone.glb.
About 3 m across and 1 m tall. Budget 300 triangles.
A small quadcopter drone: a rounded central body with a camera ball (glass) underneath, four arms each holding a propeller (propeller, centred on its hub), and four landing feet.
```

## Batch W4: Sea units (4)

### Patrol boat (`unit-patrolboat.glb`)

```text
Citybloom unit, following the unit spec (v1) and style reference: Patrol boat. Save as unit-patrolboat.glb.
About 18 m long, 5 m wide, 6 m tall above the waterline (the hull goes 1.5 m below it); the front faces -Z. Budget 800 triangles.
A fast patrol boat: a sleek hull, a cabin with wraparound windows (glass), a small gun turret at the bow (turret, barrel, muzzle), a radar block on the cabin roof, and an exhaust at the stern.
```

### Gunboat (`unit-gunboat.glb`)

```text
Citybloom unit, following the unit spec (v1) and style reference: Gunboat. Save as unit-gunboat.glb.
About 40 m long, 9 m wide, 12 m tall above the waterline (the hull goes 3 m below it); the front faces -Z. Budget 1,400 triangles.
A toy warship: a long hull in metal with body-coloured upper works, two gun turrets fore and aft (each named turret, with barrel and muzzle), a bridge with big windows, a fat funnel (exhaust), and a helipad on the stern (flat H).
```

### Submarine (`unit-submarine.glb`)

```text
Citybloom unit, following the unit spec (v1) and style reference: Submarine. Save as unit-submarine.glb.
About 30 m long and 4 m wide; surfaced, it stands 3 m above the waterline with the rest below; the front faces -Z. Budget 700 triangles.
A friendly toy submarine: a long rounded hull, a tall conning tower with a chunky periscope block (at least 0.4 m), dive planes, and a big propeller at the tail (propeller). The game sinks it below the surface when it dives.
```

### Landing craft (`unit-landingcraft.glb`)

```text
Citybloom unit, following the unit spec (v1) and style reference: Landing craft. Save as unit-landingcraft.glb.
About 20 m long, 7 m wide and 4 m tall above the waterline; the front faces -Z. Budget 600 triangles.
A landing craft that carries vehicles over water: a flat box hull with a big front ramp (named ramp, hinged at its bottom edge; the game lowers it), a small wheelhouse at the back with windows, and twin propellers (propeller).
```

## Batch W5: Superweapons (6)

Each superweapon is the last step of one research branch. Three are units (unit spec) and three are buildings (model spec).

### Giant wind-up robot (`unit-windupbot.glb`), the land branch

```text
Citybloom unit, following the unit spec (v1) and style reference: Giant wind-up robot. Save as unit-windupbot.glb.
About 30 m tall, 14 m wide and 10 m deep; the front faces -Z. Budget 5,000 triangles.
A giant toy robot that walks across the region to its target. It has a boxy body with round porthole eyes (glass) and big chunky studs, chunky arms with claw hands (arm_left and arm_right, each centred on its shoulder), and stubby legs with big flat feet (leg_left and leg_right, each centred on its hip). On its back is a huge wind-up key (windup_key, centred on its axle), which the game turns as it walks.
```

### Sky fortress (`unit-skyfortress.glb`), the air branch

```text
Citybloom unit, following the unit spec (v1) and style reference: Sky fortress. Save as unit-skyfortress.glb.
About 80 m long, 24 m wide and 26 m tall; the front faces -Z. Budget 5,000 triangles.
A huge airship that carries a swarm of drones. It has a fat, rounded envelope (body) with bold accent stripes and tail fins. Underneath hangs a long gondola with windows and a drone launch deck at the back, and a row of drone bays (each named hatch) along its sides. Four big propeller pods (propeller) drive it. The origin is under its middle, with the gondola's lowest point at 0.
```

### Clockwork whale (`unit-clockworkwhale.glb`), the sea branch

```text
Citybloom unit, following the unit spec (v1) and style reference: Clockwork whale. Save as unit-clockworkwhale.glb.
About 60 m long, 14 m wide and 16 m tall, with 8 m below the waterline when surfaced; the front faces -Z. Budget 5,000 triangles.
A giant clockwork submarine shaped like a whale: a rounded riveted hull with portholes (glass), a big wind-up key on top (windup_key), a tail that sweeps (tail, centred on its root), a mouth that opens to launch torpedo pods (jaw, hinged at the back), and a water-spout vent on top.
```

### Dome shield (`domeshield.glb`), the defence branch

```text
Citybloom model, following the model spec (v6) and style reference: Dome shield. Save as domeshield.glb.
Site 40 x 40 m (40 m along the road, 40 m deep); the front is on the road, facing -Z. Budget 3,500 triangles.
A city-wide shield generator: a stepped round base with four transformer blocks feeding heavy power conduits (at least 0.8 m thick) into a tall central spire about 40 m high, topped by a big faceted crystal emitter (shield_emitter, in glass). The game draws the dome over the whole city.
```

### Blackout tower (`blackouttower.glb`), the intelligence branch

```text
Citybloom model, following the model spec (v6) and style reference: Blackout tower. Save as blackouttower.glb.
Site 24 x 24 m (24 m along the road, 24 m deep); the front is on the road, facing -Z. Budget 3,000 triangles.
A jamming tower that blacks out a rival city's power and radar for a while: a tall, tapering tower of stacked solid blocks about 55 m high, with three big chunky dish clusters at different heights (each named radar_dish; the game turns them) and a glowing ring near the top (glass and accent). A control building stands at its foot.
```

### Express gate (`expressgate.glb`), the logistics branch

```text
Citybloom model, following the model spec (v6) and style reference: Express gate. Save as expressgate.glb.
Site 48 x 32 m (48 m along the road, 32 m deep); the front is on the road, facing -Z. Budget 3,500 triangles.
A gate that sends forces anywhere in the region at once: a giant upright ring about 30 m across (named ring), ringed with chunky segmented lights (window_band in 3-4 m pieces). It stands on a wide ramp platform that vehicles drive up, with a control tower on each side. The game draws the swirl inside the ring.
```

## Batch W6: The final thing (3)

The atom bomb: the last thing anyone can build, after every research branch is maxed out.

### Enrichment plant (`enrichment.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Enrichment plant. Save as enrichment.glb.
Site 48 x 40 m (48 m along the road, 40 m deep); the front is on the road, facing -Z. Budget 3,000 triangles.
The first, heavily guarded step towards the atom bomb: two long, low halls with rows of chunky round vents on their roofs (vent), a tall cooling stack with hazard stripes (a vent, not a smoke_stack: it gives off no smoke), thick blast walls along the edges of the site, a guard house with a striped barrier arm at the road, and yellow-and-black hazard panels (accent) on every door. It should look like nobody is allowed in.
```

### Atom silo (`atomsilo.glb`)

```text
Citybloom model, following the model spec (v6) and style reference: Atom silo. Save as atomsilo.glb.
Site 40 x 40 m (40 m along the road, 40 m deep); the front is on the road, facing -Z. Budget 3,000 triangles.
The atom bomb's launch site: a low grassy hill (grass) with a huge round silo hatch in the middle, in two halves that slide apart (each named hatch), with bold yellow-and-black hazard stripes (accent) around it. A squat concrete control bunker has a thick blast door, chunky searchlight blocks (light) stand at the four corners, and a solid wall runs round the site.
```

### Atom bomb (`unit-atombomb.glb`)

```text
Citybloom unit, following the unit spec (v1) and style reference: Atom bomb. Save as unit-atombomb.glb.
About 18 m tall standing upright, with a 3 m wide body and fins spanning 6 m; the nose points up (+Y), and the origin is under the fins. Budget 600 triangles.
The atom bomb: a big, shiny, chunky toy rocket. It has a rounded nose cone in hazard yellow (accent) with bold black stripes, a white body with a band in the owner's colour (body), four big fins at the base, and an exhaust nozzle (exhaust). It should look comically huge and ominous at once, not realistic.
```
