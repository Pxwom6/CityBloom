# SPEC-3.md: Citybloom phase 3, graphics

Phases 1 and 2 are complete, and SPEC.md and SPEC-2.md still apply. Phase 3 is about how the game looks. It keeps the bright, warm, toy-like style the game already has (`docs/models/style-reference.png`) and makes it richer: better light, livelier ground and streets, hand-made building models alongside the generator, and distant versions of everything so a big city stays fast. Where this brief is silent, use your judgment as a game artist and log the call in `docs/DECISIONS.md`.

## Where this runs

This phase runs locally on my Mac (MacBook Pro, Apple M5, 32 GB), not in a cloud VM, because judging light and measuring frame times need a real GPU.

- Judge the look and measure performance in a real Chrome window on this Mac: Playwright with `channel: 'chrome'`, headed. Keep the existing e2e suite as it is for correctness.
- For true frame times, run a benchmark window with Chrome's frame cap off (`--disable-gpu-vsync --disable-frame-rate-limit`), so it draws as fast as it can, and record the average and 95th-percentile frame time per view.
- Update CLAUDE.md with a section for local sessions: the cloud notes about SwiftShader and frame times not meaning anything don't apply here.

## Rules for all of phase 3

- **Keep the style.** Bright, warm, toy-like and readable from above. Judge every change against the style reference in screenshots: before and after, at whole-city, city and street zoom, by day and night, and in summer and winter. Nothing darker, greyer or more realistic.
- **Graphics only.** The simulation doesn't change: the same seed and commands still give the same state hash, and every existing test keeps passing. The save format changes only if a milestone truly needs it, with a migration and a test as before.
- **Frame budget.** Baseline, measured by me in Chrome on this Mac at High: the ~110k bench city (`npx tsx scripts/bench.ts 6 --big --save …`) at the whole-city view and 3× speed runs at 100–118 fps on the 120 Hz screen, with 1.5–4.4 ms of frame work, 287 draw calls and 2.75M triangles; sim ticks average 0.6–0.8 ms, worst 6 ms. Every milestone ends with the heaviest view (the whole city at night, 3× speed, a tornado on screen) at 12 ms a frame or less at High, and Medium and Low no slower than at the start of this phase. Log the numbers in PROGRESS.md at each milestone.
- **Presets.** Every new effect has a cost switch: full at High, cheaper or off at Medium and Low. The first-launch graphics check keeps choosing sensibly.
- **Models arrive over time.** I'll make building models in Claude Design from `docs/models/PROMPTS.md` and add them to `assets/models/`. Whenever new ones appear, check them, bring the good ones in, and list in PROGRESS.md which models exist, which failed and why. Anything without a model keeps using the generator.
- Each milestone ends playable, with screenshots reviewed, committed and pushed with an `M<n> complete:` commit, and gets a section in `docs/SPEC_REVIEW.md`.

## Milestones

**M25 Baseline and model pipeline.**
- Measure the baseline above with the uncapped benchmark window (whole city, city and street zoom, day and night), and write it into PROGRESS.md.
- Models live in `assets/models/` as GLB files named after what they replace: a civic building's id (`firestation.glb`), a zoned building type's id (`R103.glb` is homes, medium density, low wealth, level 3), or an add-on annex (`annex-engineBay.glb`). Extra designs for the same thing add `-2`, `-3`.
- `npm run models:check` validates every file against the spec in `docs/models/PROMPTS.md` and the game's own data. It checks:
  - the footprint matches the lot or site in `src/data` exactly (narrow models may be a half or a third of a zoned lot's width; see rows);
  - the origin is at the ground centre and the front faces −Z;
  - the triangle budget;
  - material names, window groups, and `smoke_stack` parts on buildings that pollute;
  - no textures, and nothing outside the site.

  It prints a plain report; a failing model is skipped with a warning, never a crash.
- Convert models at build time into the asset registry's `ModelData` (its `override` hook exists for this), so the game ships without a glTF loader:
  - bake each part's world transform;
  - take colours by material role;
  - apply the generator's baked darkening near the ground;
  - give window glass the generator's night glow.
- Variety:
  - Every copy of a model is repainted from the game's palettes. For `wall`, `wall_alt`, `roof`, `awning` and `sign`, use the palette nearest the model's own colour, so brick stays brick and pastels stay pastel.
  - Each copy lights its own random mix of windows at night, and may be mirrored left to right.
  - While a building type has fewer than three hand-made designs, mix them with the generator's variants, and avoid identical neighbours.
- Rows: a model half or a third as wide as its lot is placed side by side to fill it, each copy painted differently. The tenement (8 m wide) fills a medium-density level-3 lot (24 m) three abreast.
- Everything the game does to buildings keeps working with models:
  - the construction reveal, fire and damage, and abandonment;
  - snow on roofs, and seasonal `grass` and `hedge`;
  - `tree_spot` markers replaced by the game's own seasonal trees;
  - smoke from the tops of `smoke_stack` parts, replacing the hard-coded stack positions for plants that have a model;
  - the landfill's `mound` rising as it fills;
  - big projects' stages: the finished model revealed stage by stage, with the generator's cranes and hoardings;
  - add-on annexes in their back corner.
- Distant versions: build a far version of every model from its named parts (walls kept, windows as flat panels or strips, small parts dropped), and switch to it with distance without a visible pop.
- Start with the tenement, already in `assets/models/R103.glb`.
- *Done when:*
  - `models:check` passes good models and catches a deliberately broken one;
  - the tenement grows in a real city through normal zoning: three abreast, painted differently, lit at night, snowed on in winter, and switching to its far version invisibly;
  - the frame budget holds.

**M26 Light and sky.**
- Soft shading where things meet: screen-space ambient occlusion at High, cheaper at Medium, off at Low. It works alongside the baked darkening at the foot of walls rather than replacing it.
- Shadows: crisper near the camera and cheaper far away, using cascaded or split shadow maps, with far buildings casting shadows from their distant versions. About half of today's overview triangles are the shadow pass; bring that down.
- A warmer, livelier day:
  - the sky and sun colour change through the day, with a golden hour and a blue hour;
  - soft bounce light from sky and ground;
  - gentle haze with distance that suits the toy look;
  - a soft glow around lit windows and street lights at night.
- *Done when:* before-and-after screenshots at dawn, noon, golden hour and night, at whole-city and street zoom, look brighter and richer while still toy-like, and the frame budget holds.

**M27 Ground, lots and streets.**
- Terrain: gentle variety in the grass (patches, tone, field edges, worn paths) and sandy shores, all still following the seasons.
- Lots:
  - empty zoned land stops looking like graph paper: zone colours become subtle (an outline or a faint tint), shown in full only while zoning or on a zone data map;
  - built lots get proper surfaces: lawns, paths, driveways, yards and car parks.
- Streets:
  - kerbs and pavements;
  - zebra crossings at busy junctions;
  - cleaner road markings;
  - a few instanced street props where they make sense: benches, bins, planters and bus shelters.
- *Done when:* a grown city at city zoom reads as a place rather than a grid, and the frame budget holds.

**M28 Buildings and variety.**
- Bring in every model I've added by then, and keep doing so as more arrive.
- Refresh the generator in the same style for everything still generated (more roof shapes, facade details and tower silhouettes), so generated and hand-made buildings sit well together.
- Give every building a distant version, generated ones included. The whole-city view should end up with fewer triangles than today's 2.75M, despite the new detail.
- *Done when:* the bench city at city zoom looks varied with no identical neighbours, the overview draws fewer triangles than at the start of this phase, and the frame budget holds.

## When every milestone is done

Update the summary in PROGRESS.md, this brief's section in SPEC_REVIEW, the README's screenshots and the social preview image. Then walk through the game at every zoom, by day and night and in each season, and fix whatever looks off.
