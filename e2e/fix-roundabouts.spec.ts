import { expect, test } from '@playwright/test';
import { openGame, shot, watchErrors } from './helpers';
import { frames, screen, state } from './ui';

/** P5: roundabouts near bends and tight junctions, through the road tool and the inspector. */
test('P5: a cramped crossroads takes a smaller ring, [ and ] size it, and a refusal names the short road', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errs = watchErrors(page);
  await openGame(page);
  const cz = (await state(page)).highwayZ;
  const jx = 324;
  // Crossroads A at (jx, cz), with a cross street 30 m east of it; crossroads B 150 m north of A,
  // with another street only 20 m north of B.
  await page.evaluate(
    async ([jx, cz]) => {
      const g = window.__game!;
      await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 300_000 });
      const roads: [number, number, number, number][] = [
        [24, cz!, jx! + 200, cz!],
        [jx!, cz! - 200, jx!, cz! + 120],
        [jx! + 30, cz! - 100, jx! + 30, cz! + 100],
        [jx! - 100, cz! - 150, jx! + 100, cz! - 150],
        [jx! - 100, cz! - 170, jx! + 100, cz! - 170],
      ];
      for (const [ax, az, bx, bz] of roads) {
        const r = await g.dispatch({
          type: 'buildRoad',
          road: 'street',
          points: [
            { x: ax, z: az },
            { x: bx, z: bz },
          ],
        });
        if (!r.ok) throw new Error(r.reason);
      }
    },
    [jx, cz],
  );
  await page.evaluate(
    ([jx, cz]) => window.__game!.setCamera({ x: jx!, z: cz! - 70, distance: 300, yaw: 0, tilt: 0.75 }),
    [jx, cz],
  );
  await frames(page, 2);
  const ring = () => page.evaluate(() => window.__game!.getRing());
  const hint = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-testid="tool-hint"]');
      return { text: el?.textContent ?? '', tone: el?.className ?? '' };
    });
  const hover = async (x: number, z: number) => {
    const p = await screen(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await expect.poll(async () => (await ring()).ok).not.toBeNull();
    return p;
  };

  await page.getByTestId('tool-road').click();
  await page.getByTestId('mode-roundabout').click();
  await expect(page.getByTestId('ring-size')).toContainText('largest that fits');
  // A: the usual 28 m ring needs 34 m to the cross street; it gets a 20 m one.
  let a = await hover(jx, cz);
  expect(await ring()).toMatchObject({ ok: true, radius: 10, size: null });
  await expect.poll(async () => (await hint()).text).toContain('20 m across');
  // ] asks for a bigger ring than fits: red, naming the road and what's in the way.
  await page.keyboard.press('BracketRight');
  await expect.poll(async () => (await ring()).ok).toBe(false);
  const big = await ring();
  expect(big.size).toBe(12);
  expect(big.short.length).toBeGreaterThan(0);
  expect((await hint()).text).toMatch(/road east runs 30 m to the next junction/);
  expect((await hint()).text).toContain('One up to 20 m across would fit');
  await expect(page.getByTestId('ring-size')).toContainText('24 m across');
  await shot(page, 'fixes-p5-too-big');
  // [ goes straight back to what fits, then down to a mini roundabout.
  await page.keyboard.press('BracketLeft');
  await expect.poll(async () => (await ring()).ok).toBe(true);
  expect((await ring()).size).toBe(10);
  await page.getByTestId('ring-smaller').click();
  await page.keyboard.press('BracketLeft');
  a = await hover(jx, cz);
  await expect.poll(async () => (await hint()).text).toContain('Mini roundabout');
  expect((await ring()).radius).toBe(6);
  // A click with a few pixels of jitter builds it at the size shown.
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 2, a.y + 1);
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(([x, z]) => window.__game!.junctionAt(x!, z!)?.roundabout ?? 0, [jx, cz]))
    .toBe(6);
  await page.getByTestId('ring-auto').click();
  await expect(page.getByTestId('ring-size')).toContainText('largest that fits');
  await page.evaluate(
    ([jx, cz]) => window.__game!.setCamera({ x: jx!, z: cz!, distance: 90, yaw: 0.5, tilt: 0.6 }),
    [jx, cz],
  );
  await frames(page, 3);
  await shot(page, 'fixes-p5-mini');

  // Hovering 20 m along a road from B puts the ring on B, not on the road.
  await page.evaluate(
    ([jx, cz]) => window.__game!.setCamera({ x: jx!, z: cz! - 150, distance: 300, yaw: 0, tilt: 0.75 }),
    [jx, cz],
  );
  await frames(page, 2);
  await hover(jx - 20, cz - 150);
  expect((await ring()).at).toEqual({ x: jx, z: cz - 150 });
  // B is refused: the road north runs 20 m to the next junction.
  const b = await hover(jx, cz - 150);
  await expect.poll(async () => (await ring()).ok).toBe(false);
  expect((await hint()).text).toMatch(/No room for even a mini roundabout: the road north runs 20 m/);
  await shot(page, 'fixes-p5-refused');
  await page.mouse.click(b.x, b.y);
  await expect(page.getByTestId('toast').filter({ hasText: 'the road north runs 20 m' })).toBeVisible();
  expect(await page.evaluate(([x, z]) => window.__game!.junctionAt(x!, z!)?.roundabout, [jx, cz - 150])).toBe(
    0,
  );
  // The inspector's button says the same.
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-select').click();
  const road = await screen(page, jx + 60, cz - 150);
  await page.mouse.click(road.x, road.y);
  await expect(page.getByTestId('inspector')).toBeVisible();
  await page.getByTestId('add-roundabout').first().click();
  await expect(page.getByTestId('toast').filter({ hasText: 'runs 20 m' })).toBeVisible();
  errs.check();
});
