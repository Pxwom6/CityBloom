import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, openGame, serveTownViaApi, shot, watchErrors } from './helpers';
import { frames, openScenario, placeFromToolbar, screen, state } from './ui';

/** A road segment near (x, z) and its type (test API). */
const segAt = (page: Page, x: number, z: number) =>
  page.evaluate(([x, z]) => window.__game!.segmentAt(x!, z!), [x, z]);

test('M23: Harbour Lights through the UI: a power deal from the Region panel and a seaport from the toolbar', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errs = watchErrors(page);
  await openScenario(page, 'harbour', 'Harbourside');
  const hz = (await state(page)).highwayZ;
  const start = await state(page);
  expect(start.utilities.power.unserved).toBeGreaterThan(0);

  // --- The Region panel: three neighbours, one of which sells power. ---
  await page.getByTestId('open-region').click();
  const panel = page.getByTestId('region-panel');
  await expect(panel).toBeVisible();
  const towns = start.region.neighbours;
  expect(towns).toHaveLength(3);
  for (const n of towns) await expect(panel).toContainText(n.name);
  const seller = towns.find((n) => n.offers.buy.power > 0)!;
  // Supply and demand (P20): the city is short of power, and the panel says so before any deal.
  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  const supplyPower = page.getByTestId('region-supply-power');
  await expect(supplyPower).toContainText('short');
  const before = await page.evaluate(() => window.__game!.getSupply());
  await expect(supplyPower).toContainText(
    `You make ${fmt(before.power.make)} MW and use ${fmt(before.power.use)} MW`,
  );
  await expect(page.getByTestId('region-supply-garbage')).toContainText('a day');
  const row = page.getByTestId(`deal-${seller.id}-buy-power`);
  await row.scrollIntoViewIfNeeded();
  await expect(row).toContainText('Buy power');
  // Enough for the shortfall with a margin, as far as the slider goes.
  const u = start.utilities.power;
  const want = Math.min(seller.offers.buy.power, Math.ceil((u.demand - u.supply) * 1.3 + 50));
  await page.getByTestId(`deal-${seller.id}-buy-power-amount`).fill(String(want));
  await page.getByTestId(`deal-${seller.id}-buy-power-sign`).click();
  await expect(page.getByTestId(`deal-${seller.id}-buy-power-now`)).toContainText('Buying');
  await expect.poll(async () => (await state(page)).region.deals.length).toBe(1);
  await page.evaluate(() => window.__game!.advance(120));
  await expect(page.getByTestId(`deal-${seller.id}-buy-power-now`)).toContainText('went through');
  await expect(page.getByTestId(`deal-${seller.id}-buy-power-now`)).toContainText('in the last hour');
  await shot(page, 'm23-panel');
  // The supply lines now show what was bought, and still add up: make + bought = supply, use + sold = demand.
  await expect(supplyPower).toContainText('Bought');
  const after = await page.evaluate(() => window.__game!.getSupply());
  expect(after.power.bought).toBeGreaterThan(0);
  const stats = (await state(page)).utilities.power;
  expect(after.power.make + after.power.bought).toBe(stats.supply);
  expect(after.power.use + after.power.sold).toBe(stats.demand);
  await expect(supplyPower).toContainText(
    `You make ${fmt(after.power.make)} MW and use ${fmt(after.power.use)} MW`,
  );
  if (after.winter) await expect(page.getByTestId('region-supply-winter')).toContainText('heating');
  await panel.evaluate((el) => el.querySelector('.advisors-list')?.scrollTo(0, 0));
  await shot(page, 'p20-region-supply');
  await expect.poll(async () => (await state(page)).utilities.power.unserved, { timeout: 30_000 }).toBe(0);
  await page.getByTestId('open-region').click();
  await expect(panel).toHaveCount(0);

  // --- The seaport, on the shore street at the end of the avenue. ---
  let shoreX = 0;
  for (let x = 1560; x > 1150 && !shoreX; x -= 10) {
    // Off the avenue, where the street along the shore is the nearest road.
    const s = await segAt(page, x, hz + 150);
    if (s?.type === 'street') shoreX = x;
  }
  expect(shoreX).toBeGreaterThan(0);
  await page.evaluate((p) => window.__game!.setCamera(p), {
    x: shoreX + 40,
    z: hz,
    distance: 700,
    yaw: 0,
    tilt: 0.8,
  });
  await frames(page);
  // The seaward side of the street, either side of the avenue.
  await placeFromToolbar(page, 'special', 'seaport', [
    [shoreX + 50, hz - 180],
    [shoreX + 50, hz + 180],
    [shoreX + 50, hz - 240],
    [shoreX + 50, hz + 240],
    [shoreX + 50, hz - 120],
    [shoreX + 50, hz + 120],
  ]);

  // --- Play on: ships take the goods, and the town stays lit. ---
  for (let m = 0; m < 6; m++) {
    if ((await page.evaluate(() => window.__game!.getScenario())).summary?.status !== 'playing') break;
    await page.evaluate(() => window.__game!.advance(1440));
  }
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getScenario())).summary?.status, {
      timeout: 60_000,
    })
    .toBe('won');
  const sum = (await page.evaluate(() => window.__game!.getScenario())).summary!;
  console.log(`[m23] Harbour Lights won in ${sum.monthsTaken.toFixed(1)} months, ${sum.stars} stars`);
  await page.getByTestId('scenario-end').getByRole('button', { name: 'Keep playing' }).click();
  // A ship in port.
  const port = await page.evaluate(() => window.__game!.getCivics().find((c) => c.def === 'seaport')!);
  let ship = null as null | { x: number; z: number };
  for (let k = 0; k < 40 && !ship; k++) {
    await page.evaluate(() => window.__game!.advance(5));
    await frames(page, 1);
    ship =
      (await page.evaluate(() => window.__game!.getPorts().shown)).find(
        (x) => x.kind === 'ship' && Math.hypot(x.x - 0, x.z - 0) > 0 && x.x < 1990,
      ) ?? null;
  }
  expect(ship).not.toBeNull();
  await page.evaluate(
    (p) => window.__game!.setCamera({ x: p.x, z: p.z, yaw: 2.2, distance: 380, tilt: 0.45 }),
    port,
  );
  await shot(page, 'm23-seaport');
  // Its inspector.
  const pp = await screen(page, port.x, port.z);
  await page.mouse.click(pp.x, pp.y);
  await expect(page.getByTestId('port-loads')).toContainText('truckloads/day');
  await page.keyboard.press('Escape');
  errs.check();
});

test('M23: an airport from the toolbar: planes, the noise map and the region traffic map', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errs = watchErrors(page);
  await openGame(page);
  await buildTownViaApi(page);
  await serveTownViaApi(page);
  // A long avenue north of town for the airport, joined to the first side street.
  const at = await page.evaluate(async () => {
    const g = window.__game!;
    await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 400_000 });
    const c = { x: 24, z: (await g.getState()).highwayZ };
    for (const dz of [-420, -480, -540, -360]) {
      const pts = [
        { x: c.x + 40, z: c.z + dz },
        { x: c.x + 800, z: c.z + dz },
      ];
      if (!(await g.dispatch({ type: 'buildRoad', road: 'avenue', points: pts })).ok) continue;
      // Joined to the end of one of the town's side streets.
      for (const sx of [96, 192, 288, 384]) {
        const link = await g.dispatch({
          type: 'buildRoad',
          road: 'street',
          points: [
            { x: c.x + sx, z: c.z + dz },
            { x: c.x + sx, z: c.z - 160 },
          ],
        });
        if (link.ok) return { x: c.x, z: c.z + dz };
      }
    }
    return null;
  });
  expect(at).not.toBeNull();
  await page.evaluate((p) => window.__game!.setCamera(p), {
    x: at!.x + 420,
    z: at!.z,
    distance: 900,
    yaw: 0,
    tilt: 0.8,
  });
  await frames(page);
  await page.getByTestId('tool-special').hover();
  await expect(page.getByRole('tooltip')).toContainText('airport');
  await placeFromToolbar(page, 'special', 'airport', [
    [at!.x + 420, at!.z - 90],
    [at!.x + 300, at!.z - 90],
    [at!.x + 540, at!.z - 90],
    [at!.x + 420, at!.z + 90],
    [at!.x + 300, at!.z + 90],
  ]);
  const airport = await page.evaluate(() => window.__game!.getCivics().find((c) => c.def === 'airport')!);
  // A clock tower in town for the visitors to drive to.
  const tower = await page.evaluate(async () =>
    window.__game!.placeCivic('clocktower', { x: 200, z: (await window.__game!.getState()).highwayZ + 60 }),
  );
  expect(tower).not.toBeNull();
  // Planes come and go on the city's clock.
  await page.evaluate(() => window.__game!.advance(240));
  let plane = null as null | { x: number; z: number; y: number };
  for (let k = 0; k < 60 && !plane; k++) {
    await page.evaluate(() => window.__game!.advance(1));
    await frames(page, 1);
    plane =
      (await page.evaluate(() => window.__game!.getPorts().shown)).find(
        (x) => x.kind === 'plane' && x.y < 60,
      ) ?? null;
  }
  expect(plane).not.toBeNull();
  // The plane on the runway (or just above it), the airport behind.
  await page.evaluate(
    (p) => window.__game!.setCamera({ x: p.x, z: p.z, yaw: 0.8, distance: 260, tilt: 0.35 }),
    plane!,
  );
  await shot(page, 'm23-airport');
  // Visitors fly in.
  expect((await state(page)).region.flows.visitors.air).toBeGreaterThan(0);
  const ap = await screen(page, airport.x, airport.z);
  await page.mouse.click(ap.x, ap.y);
  await expect(page.getByTestId('port-visitors')).toContainText('visitors a day');
  await page.keyboard.press('Escape');

  // --- The noise map, and the roads the region uses. ---
  await page.getByTestId('tool-maps').click();
  await page.getByTestId('map-noise').click();
  await expect(page.getByTestId('map-legend')).toContainText('Noise');
  await page.evaluate(
    (p) => window.__game!.setCamera({ x: p.x, z: p.z + 200, yaw: 0, distance: 1500, tilt: 0.9 }),
    airport,
  );
  await shot(page, 'm23-noise');
  await page.getByTestId('tool-maps').click();
  await page.getByTestId('map-region').click();
  await expect(page.getByTestId('map-legend')).toContainText('Region traffic');
  await shot(page, 'm23-region-map');
  await page.getByTestId('map-legend').getByRole('button', { name: 'Hide data map' }).click();
  errs.check();
});
