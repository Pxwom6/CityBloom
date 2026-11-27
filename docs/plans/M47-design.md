# M47 Making buildings: plan

The brief (SPEC-6.md, M47): a Workshop in My buildings and on the Learn page that takes a player from
nothing to a building in their city; a written guide (`docs/making-buildings.md`) with a worked example
and screenshots; a plain-words model spec generated from the same source the check uses.

## 1. What already exists (M46)
- The check (`src/models/customCheck.ts`: `checkCustom` = `inspectModel` + 1 MB + no outside links),
  run in `src/client/modelCheckWorker.ts` with its picture; `probeCustom`, `suggestTargets`,
  `fitsTarget`, `budgetOf`, `targetLabel`; the turntable (`src/render/modelPreview.ts`); My buildings
  (`src/ui/MyBuildings.tsx`), `placeOwn`, the store. Test models in `scripts/lib/makeGlb.ts`.
- The spec v6 text is a fenced block in `docs/models/PROMPTS-5.md` (and repeated in PROMPTS-WAR.md);
  the roles are `ROLE_INDEX`/`ROLES` in `src/models/spec.ts`; tolerances in `check.ts` (`EXACT` 0.05,
  `PIT`, the lot base 4 cm, overhangs).

## 2. Data (pure, tested)
- `src/models/workshop.ts`:
  - `WORKSHOP_TARGETS`: the four landmarks and every civic building `canHaveLook` (not military: those
    take the war allowances), each with its site, budget (`budgetOf`), a height range (landmarks: 1×1
    4–12 m, 2×2 6–18, 3×3 8–26, 4×4 10–34; a look: the game's own model's height ± 3 m, from a table
    built once by a script, `src/models/heights.ts`, so the pure module needs no renderer), a blurb.
  - `workshopPrompt(target, idea)`: the prompt in the owner's PROMPTS-WAR.md style: "Citybloom model,
    following the model spec (v6) and style reference: <Name>. Save as <file>.glb." / "Site W x D m (W m
    along the road, D m deep); the front is on the road, facing -Z. Budget N triangles." / a sentence
    from the player's idea or a starter description, plus the height. `workshopSpec()` returns the spec
    block to paste once (the same text as PROMPTS-5.md's, held in `src/models/specText.ts`; a test checks
    the markdown block still matches it, so the two can't drift).
  - `teacherNotes(problem, ctx)`: each checker problem as {title, why, fix} (what's wrong, why the game
    cares, how to fix it, Blender steps where they help): wrong scale (centimetres: 100× too big; or
    too small), facing backwards / sideways, floating / below the ground, too many triangles, unnamed
    parts (a new custom-check problem when no part has a meaningful name), wrong colours (materials not
    named by role; textures), outside links, too big a file, not filling the site, a window group
    without glass, hanging walls; anything else falls back to the checker's sentence.
- `src/models/playerSpec.ts`: the plain-words spec (sections: size and units, front, ground, filling
  the site, parts and names, colours by role, windows, budget), its numbers read from the check's own
  constants (`EXACT`, roles list, `CUSTOM`, landmark budgets, the lot base); `npx tsx
  scripts/docs/modelSpec.ts` writes it into the guide between markers; a test fails if the guide's block
  isn't what the script would write.
- Bad test models for each common mistake (`scripts/lib/makeGlb.ts`): centimetres, turned round,
  floating, too many triangles, unnamed parts, wrong colours; a test runs each through the check and
  `teacherNotes` and expects its own fix.

## 3. The Workshop (UI)
- A tab in My buildings ("Workshop") and an entry on the Learn page (the lesson marked "coming with the
  Workshop" opens it: `openPanel('buildings')` on its Workshop tab; from the menu a small town opens
  first, as a lesson's does, so step 4 has neighbours).
- Five steps, one card each, Back/Next, the step kept when the panel closes:
  1. Pick: landmark sizes and the buildings (search); a picture of the site (a top-down canvas: the
     site, the road along its front, a person and a car for scale) with footprint, height range, budget.
  2. Make: two tabs. *With an AI 3D tool*: "Paste once" (the spec, Copy) and "Your building" (an idea
     field, the prompt filled in, Copy), the style reference sheet to download (`public/workshop/
     style-reference.png`, not precached). *In Blender*: short steps with small pictures (units in metres,
     front to -Z, ground at 0, parts named by role, materials named by role, export GLB with the right
     options).
  3. Check: drop or pick the file; the check runs for the picked target; each problem as a teacher's
     note (title, why, fix) with the picture; all good: a tick and Next.
  4. See: the turntable with the model on its lot and the game's own buildings either side (the
     preview gains neighbours), by day and night, each season.
  5. Use it: Add to My buildings and Place (or choose the building in its inspector), Share; Send it in
     (M48, shown as coming).
- Phones: each step a sheet, everything 44 px, both orientations.

## 4. The guide
- `docs/making-buildings.md`: what you can make, the five steps, a worked example (a bandstand
  landmark: the prompt, the check refusing a first try that floats and faces backwards, the fixed
  model, the turntable, placed in a town), the readable spec (generated block), and help. Screenshots
  from a scene script (`scripts/dev/workshopshot.mjs`) into `docs/screenshots/workshop-*.png`; linked
  from the README and from the Workshop (the site's address for the doc on GitHub).

## 5. Tests and done
- Unit: prompts (footprint, budget, roles, file name), teacher notes for each common mistake with its
  bad model, the readable spec generated from the source, the guide block current.
- E2E (`e2e/m47-workshop.spec.ts`): the Workshop through the UI from picking a 2×2 landmark to placing a
  model: copy the prompt (clipboard permission) and check its footprint, budget and roles; check a bad
  model (its teacher's note) then the good one; see it; add and place it. Phones (`e2e/m47-phone.spec.ts`).
- The guide's screenshots reviewed; "To try with a mate": a mate who has never made a model follows it.
