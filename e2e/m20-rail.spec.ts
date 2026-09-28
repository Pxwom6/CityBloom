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

/** Draw a straight road or railway: click the start, then the end, once the hint shows a price. */
async function draw(page: Page, a: [number, number], b: [number, number]): Promise<void> {
  await clickAt(page, a[0], a[1]);
  const q = await screen(page, b[0], b[1]);
  await page.mouse.move(q.x, q.y, { steps: 4 });
  await expect(page.getByTestId('tool-hint')).toContainText('$', { timeout: 20_000 });
  await page.mouse.click(q.x, q.y);
}

/** Move the camera and let a frame draw, so clicks map through the new view. */
async function camera(page: Page, p: { x: number; z: number; distance: number; yaw: number; tilt: number }) {
  await page.evaluate((p) => window.__game!.setCamera(p), p);
  await page.evaluate(() => window.__game!.waitFrames(1));
}

const civicCount = (page: Page, def: string) =>
  page.evaluate((d) => window.__game!.getCivics().filter((c) => c.def === d).length, def);

test('M20: a railway with a level crossing and stations, trams on the avenue, rail freight and the ridership map', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errs = watchErrors(page);
  // Seed `goods`: the regional rail link comes in 300 m north of the highway's.
  await openGame(page, '&seed=goods');
  const t = await page.evaluate(async () => {
    const g = window.__game!;
    const s = await g.getState();
    const c = { x: 24, z: s.highwayZ };
    await g.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
    const at = (x: number, z: number) => ({ x: c.x + x, z: c.z + z });
    const ok = async (cmd: Parameters<typeof g.dispatch>[0]) => {
      const r = await g.dispatch(cmd);
      if (!r.ok) throw new Error(`${cmd.type}: ${r.reason}`);
    };
    // A town along an avenue: homes north and south, shops on the avenue, industry at the east end.
    await ok({ type: 'buildRoad', road: 'avenue', points: [c, at(640, 0)] });
    for (const x of [120, 220, 320, 420, 520])
      await ok({ type: 'buildRoad', road: 'street', points: [at(x, -170), at(x, 170)] });
    const brush = (
      zone: 'R' | 'C' | 'I',
      a: { x: number; z: number },
      b: { x: number; z: number },
      r: number,
    ) => ok({ type: 'zone', zone, area: { kind: 'brush', points: [a, b], radius: r } });
    await brush('R', at(40, 100), at(600, 100), 75);
    await brush('C', at(40, -20), at(600, -20), 25);
    await brush('R', at(40, -110), at(300, -110), 55);
    await brush('I', at(420, -120), at(600, -120), 55);
    for (const def of ['coal', 'pump', 'pump', 'pump', 'treatment', 'landfill'])
      await g.placeCivic(def, at(560, 170));
    for (const [def, x, z] of [
      ['firestation', 120, 60],
      ['police', 420, 60],
      ['clinic', 220, -60],
      ['primary', 520, 110],
    ] as const)
      await g.placeCivic(def, at(x, z));
    return { c, rail: s.railway! };
  });
  expect(t.rail.z).toBeLessThan(t.c.z);
  const X = (dx: number) => t.c.x + dx;
  const Z = (dz: number) => t.c.z + dz;
  const RZ = t.rail.z;

  // --- A railway from the regional link along the town's north side, from the road tool. ---
  await camera(page, { x: X(330), z: RZ, distance: 800, yaw: 0, tilt: 0.7 });
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-rail').click();
  await expect(page.getByTestId('road-rail')).toHaveClass(/active/);
  await draw(page, [t.rail.x, RZ], [X(760), RZ]);
  await expect
    .poll(() => page.evaluate(([x, z]) => window.__game!.segmentAt(x!, z!)?.type, [X(400), RZ]), {
      timeout: 20_000,
    })
    .toBe('rail');
  await page.keyboard.press('Escape');
  // A street drawn across it makes a level crossing.
  await page.getByTestId('road-street').click();
  await draw(page, [X(320), Z(-170)], [X(320), RZ - 110]);
  await expect
    .poll(() => page.evaluate(([x, z]) => window.__game!.junctionAt(x!, z!)?.kind, [X(320), RZ]), {
      timeout: 20_000,
    })
    .toBe('crossing');
  await page.keyboard.press('Escape');

  // --- Two stations beside the track, from the transit bar. ---
  await page.getByTestId('tool-transit').click();
  await page.getByTestId('place-station').click();
  for (const x of [150, 560]) {
    const n = await civicCount(page, 'station');
    await camera(page, { x: X(x), z: RZ, distance: 260, yaw: 0, tilt: 0.7 });
    await clickAt(page, X(x), RZ + 16);
    await expect.poll(() => civicCount(page, 'station'), { timeout: 20_000 }).toBe(n + 1);
  }

  // --- Tram track dragged along the avenue, a depot on it and tram stops. ---
  await camera(page, { x: X(330), z: Z(0), distance: 760, yaw: 0, tilt: 0.7 });
  await page.getByTestId('tool-road').click();
  await page.getByTestId('mode-tram').click();
  const a = await screen(page, X(30), Z(0));
  const b = await screen(page, X(630), Z(0));
  await page.mouse.move(a.x, a.y, { steps: 2 });
  await page.mouse.down();
  for (let k = 1; k <= 24; k++)
    await page.mouse.move(a.x + ((b.x - a.x) * k) / 24, a.y + ((b.y - a.y) * k) / 24);
  await page.mouse.up();
  await expect
    .poll(
      () =>
        page.evaluate(
          ([x0, x1, z]) => {
            let n = 0;
            for (let x = x0!; x <= x1!; x += 50) if (window.__game!.segmentAt(x, z!)?.tram) n++;
            return n;
          },
          [X(40), X(620), Z(0)],
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(11);
  // The whole drag is one undo step.
  await expect(page.getByTestId('tool-undo')).toHaveAttribute('aria-label', /tram track/i);
  await page.getByTestId('tool-transit').click();
  await page.getByTestId('place-tramdepot').click();
  await camera(page, { x: X(80), z: Z(0), distance: 260, yaw: 0, tilt: 0.7 });
  await clickAt(page, X(80), Z(-28));
  await expect.poll(() => civicCount(page, 'tramdepot'), { timeout: 20_000 }).toBe(1);
  await page.getByTestId('place-tramstop').click();
  for (const x of [130, 270, 370, 470, 600]) {
    await camera(page, { x: X(x), z: Z(0), distance: 220, yaw: 0, tilt: 0.7 });
    await clickAt(page, X(x), Z(9));
  }
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__game!.getTransit())).shelters.filter((s) => s.tram).length,
      {
        timeout: 20_000,
      },
    )
    .toBe(5);

  // --- A rail freight terminal between the industry and the track. ---
  await page.evaluate(
    async ([x, z0, z1]) => {
      const g = window.__game!;
      await g.dispatch({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x, z: z0! },
          { x, z: z1! },
        ],
      });
      await g.dispatch({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x, z: z1! },
          { x: x! + 280, z: z1! },
        ],
      });
    },
    [X(420), Z(-170), RZ + 56],
  );
  await page.getByTestId('tool-special').click();
  await page.getByTestId('place-railfreight').click();
  // East of the station at 560, which stands on the town side of the track.
  await camera(page, { x: X(650), z: RZ + 40, distance: 260, yaw: 0, tilt: 0.7 });
  await clickAt(page, X(650), RZ + 30);
  await expect.poll(() => civicCount(page, 'railfreight'), { timeout: 20_000 }).toBe(1);
  await page.getByTestId('tool-select').click();

  // --- Two months on: trams, trains and a freight train run, and people ride. ---
  await page.evaluate(async () => {
    const g = window.__game!;
    await g.advance(2 * 1440);
    const s = await g.getState();
    const hour = ((s.tick + 420) % 1440) / 60;
    await g.advance(Math.round(((8 - hour + 24) % 24) * 60));
  });
  await page.evaluate(() => window.__game!.setSpeed(1));
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.__game!.waitFrames(3));
        const tr = await page.evaluate(() => window.__game!.getTransit());
        return (
          tr.modes
            .map((m) => m.mode)
            .sort()
            .join(',') + (tr.freight.some((f) => f.trucks > 0) ? '+freight' : '')
        );
      },
      { timeout: 120_000 },
    )
    .toBe('train,tram+freight');
  const st = await page.evaluate(() => window.__game!.getState());
  expect(st.renderStats.rail.tram).toBeGreaterThanOrEqual(1);
  expect(st.renderStats.rail.train).toBeGreaterThanOrEqual(1);
  expect(st.renderStats.rail.freight).toBe(1);
  await page.evaluate(() => window.__game!.setSpeed(0));

  // Close-ups: a tram on the avenue, a train at a station, the level crossing, the freight yard.
  const front = (kind: string) =>
    page.evaluate((k) => window.__game!.getRailVehicles().find((v) => v.kind === k)!, kind);
  const tram = await front('tram');
  await camera(page, { x: tram.x, z: tram.z, distance: 45, yaw: 0.9, tilt: 0.05 });
  await shot(page, 'm20-trams');
  const civ = await page.evaluate(() => window.__game!.getCivics());
  const station = civ.find((c) => c.def === 'station')!;
  await camera(page, { x: station.x, z: station.z, distance: 110, yaw: 0.8, tilt: 0.05 });
  await shot(page, 'm20-station');
  await camera(page, { x: X(320), z: RZ, distance: 60, yaw: 0.6, tilt: 0.05 });
  await shot(page, 'm20-crossing');

  // --- Inspectors: a tram stop (clicked on its shelter), a station and the freight terminal. ---
  const shelter = (await page.evaluate(() => window.__game!.getTransit())).shelters.find((s) => s.tram)!;
  await camera(page, { x: shelter.x, z: shelter.z, distance: 60, yaw: 0.4, tilt: 0 });
  await clickAt(page, shelter.x, shelter.z);
  await expect(page.getByTestId('stop-line')).toContainText('Trams');
  await expect(page.getByTestId('stop-use')).toContainText('a day');
  await page.keyboard.press('Escape');
  await camera(page, { x: station.x, z: station.z, distance: 120, yaw: 0.4, tilt: 0.3 });
  await clickAt(page, station.x, station.z);
  await expect(page.getByTestId('depot-vehicles')).toContainText('every');
  await expect(page.getByTestId('station-use')).toContainText('a day');
  await page.keyboard.press('Escape');
  const yard = civ.find((c) => c.def === 'railfreight')!;
  await camera(page, { x: yard.x, z: yard.z, distance: 130, yaw: 0.6, tilt: 0.1 });
  await clickAt(page, yard.x, yard.z);
  await expect(page.getByTestId('freight-trucks')).toContainText('truckloads/day');
  await shot(page, 'm20-freight');
  await page.keyboard.press('Escape');

  // --- The ridership map. ---
  await camera(page, { x: X(330), z: (Z(0) + RZ) / 2, distance: 700, yaw: 0, tilt: 0.35 });
  await page.getByTestId('tool-maps').click();
  await page.getByTestId('map-transit').click();
  await expect(page.getByTestId('map-legend')).toContainText('Ridership');
  await page.waitForTimeout(1500);
  await shot(page, 'm20-ridership');
  // The shortcut card lists the tram track mode.
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts')).toContainText('tram track');
  await page.getByTestId('shortcuts-close').click();
  errs.check();
});
