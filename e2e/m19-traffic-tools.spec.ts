import { expect, test, type Page } from '@playwright/test';
import { openGame, shot, watchErrors } from './helpers';

const screen = (page: Page, x: number, z: number) =>
  page.evaluate(([x, z]) => window.__game!.worldToScreen(x!, z!), [x, z]);

/** Click a world point with the active tool. */
async function clickAt(page: Page, x: number, z: number): Promise<void> {
  const p = await screen(page, x, z);
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.click(p.x, p.y);
}

/** Draw a straight road with the road tool: click the start, then the end. */
async function draw(page: Page, a: [number, number], b: [number, number]): Promise<void> {
  await clickAt(page, a[0], a[1]);
  const q = await screen(page, b[0], b[1]);
  await page.mouse.move(q.x, q.y, { steps: 4 });
  await expect(page.getByTestId('tool-hint')).toContainText('$', { timeout: 20_000 });
  await page.mouse.click(q.x, q.y);
}

test('M19: roundabouts, one-way roads, a city highway over a street with a ramp, and the traffic map', async ({
  page,
}) => {
  test.setTimeout(360_000);
  const errs = watchErrors(page);
  await openGame(page);
  const c = await page.evaluate(async () => {
    const g = window.__game!;
    const s = await g.getState();
    const c = { x: 24, z: s.highwayZ };
    await g.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 900_000 });
    const at = (x: number, z: number) => ({ x: c.x + x, z: c.z + z });
    for (const [road, a, b] of [
      ['avenue', [0, 0], [760, 0]],
      ['street', [250, -200], [250, 420]],
      ['street', [380, 200], [520, 200]],
    ] as const) {
      const r = await g.dispatch({ type: 'buildRoad', road, points: [at(a[0], a[1]), at(b[0], b[1])] });
      if (!r.ok) throw new Error(r.reason);
    }
    return c;
  });
  const X = (dx: number) => c.x + dx;
  const Z = (dz: number) => c.z + dz;

  // --- A roundabout on the crossroads, from the road tool's Roundabout mode. ---
  await page.evaluate((p) => window.__game!.setCamera(p), {
    x: X(250),
    z: Z(0),
    distance: 220,
    yaw: 0.6,
    tilt: 0.15,
  });
  await page.getByTestId('tool-road').click();
  await page.getByTestId('mode-roundabout').click();
  await expect(page.getByTestId('mode-roundabout')).toHaveClass(/active/);
  await clickAt(page, X(250), Z(0));
  await expect
    .poll(
      () => page.evaluate(([x, z]) => window.__game!.junctionAt(x!, z!)?.roundabout ?? 0, [X(250), Z(0)]),
      {
        timeout: 20_000,
      },
    )
    .toBeGreaterThan(10);
  expect((await page.evaluate(([x, z]) => window.__game!.junctionAt(x!, z!), [X(250), Z(0)]))!.kind).toBe(
    'roundabout',
  );
  await shot(page, 'm19-roundabout');

  // --- A one-way street drawn with O held on: it runs the way it was drawn. ---
  await page.evaluate((p) => window.__game!.setCamera(p), {
    x: X(450),
    z: Z(-100),
    distance: 300,
    yaw: 0.3,
    tilt: 0.3,
  });
  await page.getByTestId('mode-straight').click();
  await page.getByTestId('road-street').click();
  await page.keyboard.press('o');
  await expect(page.getByTestId('draw-oneway')).toHaveClass(/active/);
  await draw(page, [X(450), Z(-200)], [X(450), Z(0)]);
  await expect(page.getByTestId('tool-hint')).toContainText(/one-way/);
  await expect
    .poll(() => page.evaluate(([x, z]) => window.__game!.segmentAt(x!, z!)?.oneway ?? 0, [X(450), Z(-100)]), {
      timeout: 20_000,
    })
    .not.toBe(0);
  await page.keyboard.press('o');

  // --- The road inspector: click a street, switch it one-way, then back. ---
  await page.getByTestId('tool-select').click();
  await clickAt(page, X(250), Z(-120));
  await expect(page.getByTestId('road-oneway')).toBeVisible();
  await expect(page.getByTestId('road-traffic')).toContainText('cars a day');
  await expect(page.getByTestId('road-junctions')).toContainText('roundabout');
  await page.getByTestId('oneway-1').click();
  await expect
    .poll(() => page.evaluate(([x, z]) => window.__game!.segmentAt(x!, z!)?.oneway ?? 0, [X(250), Z(-120)]))
    .toBe(1);
  await expect(page.getByTestId('inspector')).toContainText('one-way');
  await shot(page, 'm19-inspector');
  await page.getByTestId('oneway-0').click();
  await expect
    .poll(() => page.evaluate(([x, z]) => window.__game!.segmentAt(x!, z!)?.oneway ?? 0, [X(250), Z(-120)]))
    .toBe(0);
  // Its end is the roundabout: take it out from here, then put it back.
  await page.getByTestId('remove-roundabout').click();
  await expect
    .poll(() =>
      page.evaluate(([x, z]) => window.__game!.junctionAt(x!, z!)?.roundabout ?? -1, [X(250), Z(0)]),
    )
    .toBe(0);
  await expect(page.getByTestId('road-junctions')).toContainText('junction of 4 roads');
  await page.getByTestId('add-roundabout').click();
  await expect
    .poll(() => page.evaluate(([x, z]) => window.__game!.junctionAt(x!, z!)?.roundabout ?? 0, [X(250), Z(0)]))
    .toBeGreaterThan(10);
  await page.keyboard.press('Escape');

  // --- A city highway across the street: it passes over on a deck, with no junction. ---
  await page.evaluate((p) => window.__game!.setCamera(p), {
    x: X(430),
    z: Z(300),
    distance: 700,
    yaw: 0,
    tilt: 0.6,
  });
  const segs = (await page.evaluate(() => window.__game!.getState())).segments;
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-motorway').click();
  await draw(page, [X(100), Z(300)], [X(760), Z(300)]);
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getState())).segments, { timeout: 20_000 })
    .toBeGreaterThan(segs);
  // Stop drawing on from the highway's end before picking the ramp.
  await page.keyboard.press('Escape');
  const over = await page.evaluate(([x, z]) => window.__game!.segmentAt(x!, z!), [X(262), Z(305)]);
  expect(over).toMatchObject({ type: 'motorway', deck: true });
  // The street beneath wasn't split where the highway crosses it.
  const under = await page.evaluate(([x, z]) => window.__game!.segmentAt(x!, z!), [X(250), Z(330)]);
  expect(under).toMatchObject({ type: 'street' });
  expect(await page.evaluate(([x, z]) => window.__game!.junctionAt(x!, z!), [X(250), Z(300)])).toBeNull();
  // A ramp off it onto the street beside it, one-way as drawn.
  await page.getByTestId('road-ramp').click();
  await draw(page, [X(430), Z(300)], [X(490), Z(200)]);
  await expect
    .poll(() => page.evaluate(([x, z]) => window.__game!.segmentAt(x!, z!)?.type, [X(460), Z(250)]), {
      timeout: 20_000,
    })
    .toBe('ramp');
  expect((await page.evaluate(([x, z]) => window.__game!.segmentAt(x!, z!), [X(460), Z(250)]))!.oneway).toBe(
    1,
  );
  await page.getByTestId('tool-select').click();
  await page.evaluate((p) => window.__game!.setCamera(p), {
    x: X(300),
    z: Z(300),
    distance: 150,
    yaw: 1.1,
    tilt: 0,
  });
  await shot(page, 'm19-highway');

  // --- The traffic map shows junctions and which way one-way roads run. ---
  await page.getByTestId('tool-maps').click();
  await page.getByTestId('map-traffic').click();
  await expect(page.getByTestId('map-legend')).toContainText('Traffic');
  await expect(page.getByTestId('traffic-legend-note')).toContainText('one-way');
  // The shortcut card lists the new keys.
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts')).toContainText('Draw one-way');
  await page.getByTestId('shortcuts-close').click();
  errs.check();
});

test('M19: the Crossroads scenario: a roundabout on the jammed junction, and cars queueing and going round it', async ({
  page,
}) => {
  test.setTimeout(420_000);
  const errs = watchErrors(page);
  await page.addInitScript(() => {
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...s, tips: false, graphicsChecked: true }));
  });
  await page.goto('./?scenario=crossroads');
  await page.waitForFunction(
    () => window.__game?.ready === true && window.__game.getShell().mode === 'play',
    null,
    {
      timeout: 120_000,
    },
  );
  await expect(page.getByTestId('scenario-brief')).toContainText('Four Ways');
  await page.getByTestId('scenario-begin').click();
  await page.evaluate(() => window.__game!.setSpeed(0));
  const j = await page.evaluate(async () => {
    const s = await window.__game!.getState();
    return { x: 24 + 460, z: s.highwayZ };
  });
  await page.evaluate((p) => window.__game!.setCamera(p), { ...j, distance: 160, yaw: 0.5, tilt: 0.6 });
  await page.evaluate(() => window.__game!.waitFrames(2));
  // The crossroads is jammed: the traffic map's disc there is past capacity.
  const before = await page.evaluate(([x, z]) => window.__game!.junctionAt(x!, z!), [j.x, j.z]);
  expect(before).toMatchObject({ kind: 'plain', arms: 4 });
  // A roundabout on it from the road tool (the first test covers the inspector's buttons).
  await page.getByTestId('tool-road').click();
  await page.getByTestId('mode-roundabout').click();
  await clickAt(page, j.x, j.z);
  await expect
    .poll(() => page.evaluate(([x, z]) => window.__game!.junctionAt(x!, z!)?.kind, [j.x, j.z]), {
      timeout: 20_000,
    })
    .toBe('roundabout');
  await page.getByTestId('tool-select').click();
  // Rush hour, then let the cars run: some go round the ring, and some wait their turn.
  await page.evaluate(async () => {
    const g = window.__game!;
    const s = await g.getState();
    const hour = ((s.tick + 420) % 1440) / 60;
    await g.advance(Math.round(((8 - hour + 24) % 24) * 60));
  });
  await page.evaluate(() => window.__game!.setSpeed(1));
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          await window.__game!.waitFrames(5);
          const cars = window.__game!.getCars();
          return cars.some((c) => c.ring !== null) && cars.some((c) => c.waited > 0);
        }),
      { timeout: 120_000 },
    )
    .toBe(true);
  await page.evaluate(() => window.__game!.setSpeed(0));
  await page.evaluate((p) => window.__game!.setCamera(p), { ...j, distance: 150, yaw: 0.5, tilt: 0.05 });
  await shot(page, 'm19-crossroads');
  errs.check();
});
