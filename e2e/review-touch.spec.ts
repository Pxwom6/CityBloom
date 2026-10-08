import { expect, test, type Page } from '@playwright/test';
import { openGame, shot, watchErrors } from './helpers';
import { findSpot, frames, screen, state } from './ui';

/**
 * PR #14 review R5: a finger or a pen wobbles more than a mouse, so a tap may travel 10 px (a mouse
 * click still 5), and a second finger makes a pinch, in which nothing is a click.
 */
test.use({ hasTouch: true });

type Pt = { x: number; y: number };

/** Real touches through Chrome's input pipeline (they arrive as pointer events of type 'touch'). */
async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: (Pt & { id: number })[]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 2, radiusY: 2, force: 1 })),
    });
  return {
    /** A tap that wanders `dx` px between touching down and lifting off. */
    async tap(p: Pt, dx: number) {
      await send('touchStart', [{ ...p, id: 1 }]);
      for (let k = 1; k <= 4; k++) await send('touchMove', [{ x: p.x + (dx * k) / 4, y: p.y, id: 1 }]);
      await send('touchEnd', []);
    },
    /**
     * Two fingers down, spread 3 px each (a small pinch: within any click's slop), and up again,
     * the second finger first.
     */
    async pinch(a: Pt, b: Pt) {
      await send('touchStart', [{ ...a, id: 1 }]);
      await send('touchStart', [
        { ...a, id: 1 },
        { ...b, id: 2 },
      ]);
      await send('touchMove', [
        { x: a.x - 3, y: a.y, id: 1 },
        { x: b.x + 3, y: b.y, id: 2 },
      ]);
      await send('touchEnd', [{ x: a.x - 3, y: a.y, id: 1 }]);
      await send('touchEnd', []);
    },
  };
}

/** A street with pocket parks to place beside it; returns the next free spot on screen each call. */
async function parkStreet(page: Page) {
  await openGame(page);
  const cz = (await state(page)).highwayZ;
  await page.evaluate(() => window.__game!.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 }));
  await page.evaluate(async (cz) => {
    const r = await window.__game!.dispatch({
      type: 'buildRoad',
      road: 'street',
      points: [
        { x: 24, z: cz },
        { x: 424, z: cz },
      ],
    });
    if (!r.ok) throw new Error(r.reason);
  }, cz);
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 220, z: cz + 30, distance: 320, yaw: 0, tilt: 0.7 }),
    cz,
  );
  await frames(page, 2);
  await page.getByTestId('tool-parks').click();
  await page.getByTestId('place-park_small').click();
  // Spots along the street, each well clear of the last one used.
  const spots: [number, number][] = [];
  for (let x = 60; x <= 400; x += 34) spots.push([x, cz + 22]);
  let from = 0;
  const nextSpot = async () => {
    const [x, z] = await findSpot(page, spots.slice(from), 'a park');
    from = spots.findIndex((s) => s[0] > x + 60);
    expect(from, 'room for another spot').toBeGreaterThan(0);
    return screen(page, x, z);
  };
  const parks = () =>
    page.evaluate(() => window.__game!.getCivics().filter((c) => c.def === 'park_small').length);
  return { nextSpot, parks };
}

test('PR #14 review R5: a tap allows a finger 10 px, a mouse click still 5', async ({ page }) => {
  test.setTimeout(240_000);
  const errs = watchErrors(page);
  const { nextSpot, parks } = await parkStreet(page);
  const touch = await fingers(page);

  // A finger that wanders 8 px is a tap: a park.
  let p = await nextSpot();
  let n = await parks();
  await touch.tap(p, 8);
  await expect.poll(parks, { message: 'a tap that wanders 8 px' }).toBe(n + 1);
  await shot(page, 'review-r5-tap');

  // A finger that wanders 30 px is a pan: no park.
  p = await nextSpot();
  n = await parks();
  await touch.tap(p, 30);
  await frames(page, 3);
  expect(await parks(), 'a 30 px swipe').toBe(n);

  // A mouse click that moves 8 px is still a pan.
  p = await nextSpot();
  n = await parks();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 8, p.y, { steps: 4 });
  await page.mouse.up();
  await frames(page, 3);
  expect(await parks(), 'a mouse click that moves 8 px').toBe(n);
  errs.check();
});

test('PR #14 review R5: a second finger makes a pinch, and nothing in a pinch is a click', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errs = watchErrors(page);
  const { nextSpot, parks } = await parkStreet(page);
  const touch = await fingers(page);

  // Both fingers on open ground with a park out: nothing placed.
  const p = await nextSpot();
  const n = await parks();
  await touch.pinch(p, { x: p.x + 40, y: p.y });
  await frames(page, 3);
  expect(await parks(), 'a pinch').toBe(n);

  // A park put down with the mouse; with the select tool a pinch over it selects nothing, a tap does.
  await page.mouse.click(p.x, p.y);
  await expect.poll(parks).toBe(n + 1);
  await page.getByTestId('tool-select').click();
  const park = await page.evaluate(() => window.__game!.getCivics().find((c) => c.def === 'park_small')!);
  const at = await screen(page, park.x, park.z);
  await touch.pinch(at, { x: at.x + 4, y: at.y + 2 });
  await frames(page, 3);
  await expect(page.getByTestId('inspector')).toHaveCount(0);
  await touch.tap(at, 3);
  await expect(page.getByTestId('inspector')).toBeVisible();
  errs.check();
});
