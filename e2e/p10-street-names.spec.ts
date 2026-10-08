import { expect, test, type Page } from '@playwright/test';
import { openGame, shot, watchErrors } from './helpers';

const screen = (page: Page, x: number, z: number) =>
  page.evaluate(([x, z]) => window.__game!.worldToScreen(x!, z!), [x, z]);
const state = (page: Page) => page.evaluate(() => window.__game!.getState());

async function clickAt(page: Page, x: number, z: number): Promise<void> {
  const p = await screen(page, x, z);
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.click(p.x, p.y);
}

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await screen(page, from[0], from[1]);
  const b = await screen(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
}

/** The name the sim holds for the road nearest this spot. */
const nameAt = (page: Page, x: number, z: number) =>
  page.evaluate(([x, z]) => window.__game!.segmentAt(x!, z!)?.name ?? null, [x, z]);

/** The title of the road inspector after clicking the road at (x, z); the road is deselected after. */
async function inspectedName(page: Page, x: number, z: number, shotName?: string): Promise<string> {
  await clickAt(page, x, z);
  const title = page.getByTestId('inspector').locator('h2');
  await expect(title).toBeVisible();
  const name = (await title.textContent())!.trim();
  if (shotName) await shot(page, shotName);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('inspector')).toBeHidden();
  return name;
}

const stem = (name: string) => name.split(' ')[0]!;

test('P10: a street keeps its name when another street cuts it, through undo, redo and a save', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errs = watchErrors(page);
  await openGame(page);
  const cz = (await state(page)).highwayZ;
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 200, z: cz, distance: 520, yaw: 0, tilt: 0.55 }),
    cz,
  );
  await page.evaluate(() => window.__game!.waitFrames(1));

  // A street from the highway, dragged out; click it for its name.
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-street').click();
  const s0 = await state(page);
  await drag(page, [24, cz], [300, cz]);
  await expect.poll(async () => (await state(page)).segments).toBe(s0.segments + 1);
  await page.getByTestId('tool-select').click();
  const N = await inspectedName(page, 150, cz, 'p10-street-before');
  expect(N).toMatch(/^[A-Z][a-z]+ (Street|Road|Way|Close|Row|Terrace)$/);
  expect(await nameAt(page, 150, cz)).toBe(N);

  // A second street drawn across its middle cuts it into two.
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-street').click();
  const s1 = await state(page);
  await drag(page, [170, cz - 160], [170, cz + 170]);
  await expect.poll(async () => (await state(page)).segments).toBe(s1.segments + 3);
  await page.getByTestId('tool-select').click();

  // Both halves still read as the street they were; the crossing street has a name of its own.
  expect(await inspectedName(page, 90, cz)).toBe(N);
  expect(await inspectedName(page, 235, cz, 'p10-street-east-half')).toBe(N);
  const M = await inspectedName(page, 170, cz - 100);
  expect(M).not.toBe(N);
  expect(stem(M)).not.toBe(stem(N));
  expect(await inspectedName(page, 170, cz + 100)).toBe(M);
  expect(await nameAt(page, 90, cz)).toBe(N);
  expect(await nameAt(page, 235, cz)).toBe(N);

  // Close up, the map labels the street once, by that name.
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 170, z: cz, distance: 200, yaw: 0.2, tilt: 0.5 }),
    cz,
  );
  await page.evaluate(() => window.__game!.waitFrames(8));
  const labels = await page.locator('.street-label:visible').allTextContents();
  expect(labels.filter((t) => t === N)).toHaveLength(1);
  expect(labels.filter((t) => t === M).length).toBeLessThanOrEqual(1);
  await shot(page, 'p10-street-after-cut');

  // Undo takes the crossing street (and the cut) away: one street again, still called N.
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 200, z: cz, distance: 520, yaw: 0, tilt: 0.55 }),
    cz,
  );
  await page.evaluate(() => window.__game!.waitFrames(1));
  await page.getByTestId('tool-undo').click();
  await expect.poll(async () => (await state(page)).segments).toBe(s1.segments);
  expect(await nameAt(page, 90, cz)).toBe(N);
  expect(await nameAt(page, 235, cz)).toBe(N);
  expect(await inspectedName(page, 150, cz)).toBe(N);

  // Redo brings the cut back with the same names, not new ones.
  await page.getByTestId('tool-redo').click();
  await expect.poll(async () => (await state(page)).segments).toBe(s1.segments + 3);
  expect(await nameAt(page, 90, cz)).toBe(N);
  expect(await nameAt(page, 235, cz)).toBe(N);
  expect(await nameAt(page, 170, cz - 100)).toBe(M);

  // Saved, the names come back with the city.
  await page.getByTestId('menu-button').click();
  await page.getByTestId('menu-save').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Saved' })).toBeVisible();
  await page.goto('./?load=quick&paused=1');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 200, z: cz, distance: 520, yaw: 0, tilt: 0.55 }),
    cz,
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
  expect(await nameAt(page, 90, cz)).toBe(N);
  expect(await nameAt(page, 235, cz)).toBe(N);
  expect(await nameAt(page, 170, cz - 100)).toBe(M);
  await page.getByTestId('tool-select').click();
  expect(await inspectedName(page, 235, cz)).toBe(N);
  errs.check();
});
