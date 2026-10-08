import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, openGame, serveTownViaApi, shot, watchErrors } from './helpers';
import { frames, screen, settledHint, state } from './ui';

/** Playthrough fixes to roads (PLAYTHROUGH-FIXES.md), through the road tool. */

const buildings = (page: Page) => page.evaluate(() => window.__game!.getBuildings().length);

/** A grown town: the planned town of the other specs, served and left to grow for four months. */
async function grownTown(page: Page): Promise<number> {
  await openGame(page);
  await page.evaluate(() => window.__game!.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 400_000 }));
  await buildTownViaApi(page);
  await serveTownViaApi(page);
  await page.evaluate(() => window.__game!.advance(1440 * 4));
  return (await state(page)).highwayZ;
}

test('P2: an upgrade or a new road that demolishes buildings says how many and asks first', async ({
  page,
}) => {
  const errs = watchErrors(page);
  const cz = await grownTown(page);

  // A street whose upgrade to a boulevard can't keep every building beside it.
  const pick = await page.evaluate(async (cz) => {
    const g = window.__game!;
    for (const x of [120, 216, 312, 408])
      for (const dz of [-80, 80]) {
        const s = g.segmentAt(x, cz + dz);
        if (!s) continue;
        const r = await g.preview({ type: 'upgradeRoad', seg: s.id, road: 'boulevard' });
        const gone = r.ok ? ((r.info as { demolished?: number[] }).demolished ?? []) : [];
        if (gone.length) return { x, z: cz + dz, seg: s.id, gone: gone.length, ids: gone };
      }
    return null;
  }, cz);
  expect(pick, 'a street whose upgrade demolishes something').not.toBeNull();
  // Look between the street and what it would demolish (usually a corner lot on the avenue).
  await page.evaluate((p) => {
    const g = window.__game!;
    const b = g.getBuildings().find((x) => x.id === p.ids[0]);
    const at = b ? { x: (p.x + b.x) / 2, z: (p.z + b.z) / 2 } : p;
    g.setCamera({ ...at, distance: 260, yaw: 0, tilt: 0.75 });
  }, pick!);
  await frames(page, 2);
  await page.getByTestId('tool-road').click();
  await page.getByTestId('mode-upgrade').click();
  await page.getByTestId('road-boulevard').click();
  const p = await screen(page, pick!.x, pick!.z);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  const hint = await settledHint(page);
  // The preview counts what goes (and red boxes stand over them).
  expect(hint.text).toContain(`demolishes ${pick!.gone} building`);
  await shot(page, 'fixes-p2-upgrade-preview');

  // A click asks first; keeping them changes nothing.
  const before = { n: await buildings(page), treasury: (await state(page)).treasury };
  await page.mouse.click(p.x, p.y);
  const q = page.getByTestId('tool-question');
  await expect(q).toBeVisible();
  await expect(q).toContainText(`demolishes ${pick!.gone} building`);
  await shot(page, 'fixes-p2-upgrade-asks');
  await page.getByTestId('tool-question-no').click();
  await expect(q).toHaveCount(0);
  await frames(page, 2);
  expect(await buildings(page)).toBe(before.n);
  expect((await state(page)).treasury).toBe(before.treasury);
  expect(await page.evaluate((s) => window.__game!.segmentAt(s.x, s.z)?.type, pick!)).toBe('street');

  // Escape keeps them too, and leaves the tool out.
  await page.mouse.click(p.x, p.y);
  await expect(q).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(q).toHaveCount(0);
  await expect(page.getByTestId('tool-road')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate((s) => window.__game!.segmentAt(s.x, s.z)?.type, pick!)).toBe('street');

  // Saying yes changes the road, and exactly the buildings counted go.
  await page.mouse.move(p.x + 2, p.y, { steps: 2 });
  await settledHint(page);
  await page.mouse.click(p.x, p.y);
  await expect(q).toBeVisible();
  await page.getByTestId('tool-question-yes').click();
  await expect
    .poll(() => page.evaluate((s) => window.__game!.segmentAt(s.x, s.z)?.type, pick!))
    .toBe('boulevard');
  await expect.poll(() => buildings(page)).toBe(before.n - pick!.gone);

  // A new road through the blocks: the hint counts, a drag asks, no keeps nothing, yes builds.
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-road').click();
  await page.getByTestId('mode-straight').click();
  await page.getByTestId('road-street').click();
  // A cut along the blocks either side of the avenue that goes through some of the town.
  const cut = await page.evaluate(async (cz) => {
    const g = window.__game!;
    for (const dz of [-60, -100, -40, -130, 40, 80, 110])
      for (const [ax, bx] of [
        [40, 300],
        [160, 460],
      ]) {
        const r = await g.preview({
          type: 'buildRoad',
          road: 'street',
          points: [
            { x: ax!, z: cz + dz },
            { x: bx!, z: cz + dz },
          ],
        });
        const n = r.ok ? ((r.info as { demolished?: number[] }).demolished ?? []).length : 0;
        if (n > 0 && n < 12) return { ax: ax!, bx: bx!, rz: cz + dz, n };
      }
    return null;
  }, cz);
  expect(cut, 'a cut through the town').not.toBeNull();
  const { ax, bx, rz, n: doomed } = cut!;
  await page.evaluate(
    (c) => window.__game!.setCamera({ x: (c.ax + c.bx) / 2, z: c.rz, distance: 420, yaw: 0, tilt: 0.7 }),
    cut!,
  );
  await frames(page, 2);
  const a = await screen(page, ax, rz);
  const b = await screen(page, bx, rz);
  const drag = async () => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await expect.poll(async () => (await settledHint(page)).text).toContain(`demolishes ${doomed} building`);
    await page.mouse.up();
  };
  const seg0 = (await state(page)).segments;
  const n0 = await buildings(page);
  await drag();
  await expect(q).toBeVisible();
  await expect(q).toContainText(`This road demolishes ${doomed} building`);
  await shot(page, 'fixes-p2-road-asks');
  await page.getByTestId('tool-question-no').click();
  await frames(page, 2);
  expect((await state(page)).segments).toBe(seg0);
  expect(await buildings(page)).toBe(n0);
  await drag();
  await expect(q).toBeVisible();
  await page.getByTestId('tool-question-yes').click();
  await expect.poll(async () => (await state(page)).segments).toBeGreaterThan(seg0);
  await expect.poll(() => buildings(page)).toBe(n0 - doomed);
  errs.check();
});

test('P1: a road that joins nothing says so; a cut-off stretch is shown everywhere until it is joined', async ({
  page,
}) => {
  test.setTimeout(360_000);
  const errs = watchErrors(page);
  await openGame(page);
  const cz = (await state(page)).highwayZ;
  const cx = 24;
  await page.evaluate(() => window.__game!.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 }));
  // A street that reaches the highway, east from where it ends.
  await page.evaluate(
    async ([cx, cz]) => {
      const r = await window.__game!.dispatch({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: cx!, z: cz! },
          { x: cx! + 300, z: cz! },
        ],
      });
      if (!r.ok) throw new Error(r.reason);
    },
    [cx, cz],
  );
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 200, z: cz + 140, distance: 450, yaw: 0, tilt: 0.6 }),
    cz,
  );
  await frames(page, 2);
  const hintNow = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-testid="tool-hint"]');
      return { text: el?.textContent ?? '', tone: el?.className ?? '' };
    });
  const moveTo = async (x: number, z: number) => {
    const p = await screen(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await page.waitForTimeout(300);
    return p;
  };

  // Drawing a street out in the fields: the hint says it joins nothing.
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-street').click();
  const s0 = (await state(page)).segments;
  const a = await moveTo(cx + 150, cz + 90);
  await page.mouse.click(a.x, a.y);
  const b = await moveTo(cx + 150, cz + 250);
  await expect.poll(async () => (await hintNow()).text).toContain("Doesn't join any road");
  expect((await hintNow()).tone).toContain('warn');
  await shot(page, 'fixes-p1-joins-nothing');
  await page.mouse.click(b.x, b.y);
  await expect.poll(async () => (await state(page)).segments).toBe(s0 + 1);
  // Carrying on from it: it joins a road, but not one that reaches the highway.
  const d = await moveTo(cx + 300, cz + 250);
  await expect.poll(async () => (await hintNow()).text).toContain('Not connected to the highway');
  expect((await hintNow()).tone).toContain('warn');
  await page.mouse.click(d.x, d.y);
  await expect.poll(async () => (await state(page)).segments).toBe(s0 + 2);
  await page.keyboard.press('Escape');

  // Built: one cut-off stretch, an icon over it, a line in the street inspector, red on the
  // traffic map, and the advisor names it.
  const islands = () => page.evaluate(() => window.__game!.getRoadIslands());
  await expect.poll(async () => (await islands()).islands.length).toBe(1);
  const cut = (await islands()).islands[0]!.segs;
  expect(cut.length).toBe(2);
  await expect
    .poll(async () => (await state(page)).renderStats.icons, { message: 'island icons' })
    .toBeGreaterThanOrEqual(2);
  await page.getByTestId('tool-select').click();
  const mid = await screen(page, cx + 150, cz + 170);
  await page.mouse.click(mid.x, mid.y);
  await expect(page.getByTestId('road-island')).toContainText('Not connected to the highway');
  await shot(page, 'fixes-p1-island-inspector');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__game!.setOverlay('traffic'));
  await expect.poll(async () => [...(await islands()).painted].sort()).toEqual([...cut].sort());
  await expect(page.getByTestId('traffic-legend-note')).toContainText('no road link to the highway');
  await shot(page, 'fixes-p1-island-traffic-map');
  await page.evaluate(() => window.__game!.setOverlay(null));
  await page.evaluate(() => window.__game!.advance(120));
  await page.getByTestId('open-advisors').click();
  await expect(page.getByTestId('advice-island')).toContainText(/and 1 more street can.t reach the highway/, {
    timeout: 15_000,
  });
  await shot(page, 'fixes-p1-island-advisor');
  await page.getByTestId('advice-island').getByTestId('advice-show').click();
  await page.getByTestId('open-advisors').click();

  // Joining it up: an end 12 m from the street's dead end used to be refused as too close; now it
  // snaps onto it, and everything clears.
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 260, z: cz + 130, distance: 450, yaw: 0, tilt: 0.6 }),
    cz,
  );
  await frames(page, 2);
  await page.getByTestId('tool-road').click();
  const e = await moveTo(cx + 300, cz + 250);
  await page.mouse.click(e.x, e.y);
  const f = await moveTo(cx + 300, cz + 12);
  await expect.poll(async () => (await hintNow()).text).toMatch(/^\$/);
  const joined = await hintNow();
  expect(joined.text).not.toContain('highway');
  expect(joined.text).not.toContain('join');
  expect(joined.tone).toContain('ok');
  await shot(page, 'fixes-p1-join-snaps');
  await page.mouse.click(f.x, f.y);
  await expect.poll(async () => (await state(page)).segments).toBe(s0 + 3);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await islands()).islands.length).toBe(0);
  await expect.poll(async () => (await state(page)).renderStats.icons).toBe(0);
  await page.getByTestId('tool-select').click();
  const mid2 = await screen(page, cx + 150, cz + 170);
  await page.mouse.click(mid2.x, mid2.y);
  await expect(page.getByTestId('inspector')).toBeVisible();
  await expect(page.getByTestId('road-island')).toHaveCount(0);
  await page.evaluate(() => window.__game!.advance(120));
  await page.getByTestId('open-advisors').click();
  await expect(page.getByTestId('advice-island')).toHaveCount(0, { timeout: 15_000 });
  await shot(page, 'fixes-p1-joined');
  errs.check();
});

/** A street east from the highway, the road tool out with streets, and a reader for its hint. */
async function streetAndRoadTool(page: Page, distance: number) {
  await openGame(page);
  const cz = (await state(page)).highwayZ;
  const cx = 24;
  await page.evaluate(() => window.__game!.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 }));
  await page.evaluate(
    async ([cx, cz]) => {
      const r = await window.__game!.dispatch({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: cx!, z: cz! },
          { x: cx! + 300, z: cz! },
        ],
      });
      if (!r.ok) throw new Error(r.reason);
    },
    [cx, cz],
  );
  await page.evaluate(
    ([cz, distance]) =>
      window.__game!.setCamera({ x: 150, z: cz! + 100, distance: distance!, yaw: 0, tilt: 0.6 }),
    [cz, distance],
  );
  await frames(page, 2);
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-street').click();
  const hint = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-testid="tool-hint"]');
      return { text: el?.textContent ?? '', tone: el?.className ?? '' };
    });
  const islands = async () => (await page.evaluate(() => window.__game!.getRoadIslands())).islands.length;
  return { cx, cz, hint, islands };
}

test('PR #14 review R3: with Alt held a road end goes exactly where it is put', async ({ page }) => {
  test.setTimeout(240_000);
  const errs = watchErrors(page);
  // From 1.2 km out a near miss reaches 30 m (no further, however far out).
  const { cx, cz, hint, islands } = await streetAndRoadTool(page, 1200);
  const s0 = (await state(page)).segments;
  const a = await screen(page, cx + 100, cz + 200);
  await page.mouse.move(a.x, a.y, { steps: 2 });
  await page.mouse.click(a.x, a.y);
  // An end 26 m short of the street joins it…
  const b = await screen(page, cx + 100, cz + 26);
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await expect.poll(async () => (await hint()).text).toMatch(/^\$/);
  expect((await hint()).text).not.toContain('join');
  // …but with Alt held it stays where it's put, and says it joins nothing.
  await page.keyboard.down('Alt');
  await page.mouse.move(b.x, b.y + 0.5, { steps: 2 });
  await expect.poll(async () => (await hint()).text).toContain("Doesn't join any road");
  expect((await hint()).text).toContain('no snapping');
  await shot(page, 'review-r3-alt');
  await page.mouse.click(b.x, b.y + 0.5);
  await page.keyboard.up('Alt');
  await expect.poll(async () => (await state(page)).segments).toBe(s0 + 1);
  await page.keyboard.press('Escape');
  // Built as placed: cut off, its end short of the street.
  await expect.poll(islands).toBe(1);
  const road = await page.evaluate(([x, z]) => window.__game!.segmentAt(x!, z!), [cx + 100, cz + 60]);
  expect(road, 'the Alt road').not.toBeNull();
  expect(await page.evaluate(([x, z]) => window.__game!.segmentAt(x!, z!)?.id, [cx + 100, cz + 6])).not.toBe(
    road!.id,
  );
  errs.check();
});

test('PR #14 review R3: a free-form end shows where it joins before the button comes up', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errs = watchErrors(page);
  const { cx, cz, hint, islands } = await streetAndRoadTool(page, 450);
  await page.getByTestId('mode-free').click();
  const s0 = (await state(page)).segments;
  // Drawn down to 14 m short of the street.
  const path: [number, number][] = [
    [cx + 200, cz + 200],
    [cx + 205, cz + 140],
    [cx + 200, cz + 80],
    [cx + 200, cz + 14],
  ];
  let p = await screen(page, path[0]![0], path[0]![1]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (const [x, z] of path.slice(1)) {
    p = await screen(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  }
  // The ghost joins the street while the button is still down…
  await expect.poll(async () => (await hint()).text).toMatch(/^\$/);
  await page.waitForTimeout(400);
  const drawn = await hint();
  expect(drawn.text).not.toContain('join');
  expect(drawn.tone).toContain('ok');
  await shot(page, 'review-r3-free-end');
  // …and it's built as shown.
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).segments).toBeGreaterThan(s0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__game!.waitFrames(2));
  expect(await islands()).toBe(0);
  errs.check();
});
