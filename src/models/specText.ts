/**
 * The model spec (v6) for buildings, word for word as the owner's prompt files give it
 * (`docs/models/PROMPTS-5.md`, repeated in PROMPTS-WAR.md): the Workshop (M47) hands it to a player to
 * paste once into their AI 3D tool. A test checks the prompt files still carry exactly this text, so the
 * two can't drift apart.
 */
export const SPEC_V6 = `Citybloom model spec (v6). Follow it for every model, and match the attached style reference sheet.

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

Keep to the triangle budget in each prompt.`;
