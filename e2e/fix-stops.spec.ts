import { expect, test } from '@playwright/test';
import { TRANSIT } from '../src/data/balance';
import { buildTownViaApi, openGame, shot, watchErrors } from './helpers';
import { frames, settledHint, state } from './ui';

/**
 * P12 (check first): bus stops refused on the road. Reproduced for bridges: the cursor's ground
 * point is a ray against the terrain, which lands well behind a raised deck.
 */
test('P12: a click on a bridge deck puts a bus stop on the bridge, at street, close and city zoom', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errs = watchErrors(page);
  await openGame(page);
  await buildTownViaApi(page);
  const cz = (await state(page)).highwayZ;
  const bridge = await page.evaluate(async () => {
    const g = window.__game!;
    await g.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 });
    const z = 1500;
    let wx = -1;
    for (let x = 900; x < 2000; x += 4)
      if (g.heightAt(x, z) < 0.6) {
        wx = x;
        break;
      }
    let ex = wx;
    while (g.heightAt(ex, z) < 0.6) ex += 4;
    const r = await g.dispatch({
      type: 'buildRoad',
      road: 'avenue',
      points: [
        { x: wx - 140, z },
        { x: ex + 140, z },
      ],
    });
    return { ok: r.ok, x: (wx + ex) / 2, z };
  });
  expect(bridge.ok).toBe(true);
  expect(await page.evaluate((b) => window.__game!.heightAt(b.x, b.z), bridge)).toBeLessThan(0.6);
  await page.getByTestId('tool-transit').click();
  await page.getByTestId('place-busstop').click();
  const stops = () => page.evaluate(() => window.__game!.getTransit().stops);
  const place = async (
    x: number,
    z: number,
    cam: { distance: number; yaw: number; tilt: number },
    name: string,
  ): Promise<void> => {
    await page.evaluate(
      ([x, z, c]) => window.__game!.setCamera({ x: x as number, z: z as number, ...(c as object) }),
      [x, z, cam] as const,
    );
    await frames(page, 2);
    const p = await page.evaluate(([x, z]) => window.__game!.roadToScreen(x!, z!), [x, z]);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    const h = await settledHint(page);
    expect(h.text, name).not.toContain('beside a road');
    expect(h.tone, name).toContain('ok');
    const n = await stops();
    const t = (await state(page)).treasury;
    await page.mouse.click(p.x, p.y);
    await expect.poll(stops, { message: name }).toBe(n + 1);
    expect((await state(page)).treasury, name).toBe(t - TRANSIT.stopCost);
    await shot(page, `fixes-p12-${name}`);
    await page.getByTestId('tool-undo').click();
    await expect.poll(stops).toBe(n);
  };
  // On the bridge, from the poses that failed: street level, the M6 bridge shot and city zoom.
  await place(bridge.x, bridge.z, { distance: 70, yaw: 0.85, tilt: -0.02 }, 'bridge-street');
  await place(bridge.x + 20, bridge.z, { distance: 170, yaw: 0.9, tilt: -0.1 }, 'bridge-close');
  await place(bridge.x - 20, bridge.z, { distance: 300, yaw: 0, tilt: 0 }, 'bridge-city');
  // Controls that always worked: the avenue and a street on the ground.
  await place(216, cz, { distance: 620, yaw: 0.55, tilt: 0 }, 'avenue');
  await place(216, cz - 60, { distance: 300, yaw: 0.3, tilt: 0 }, 'street');
  errs.check();
});
