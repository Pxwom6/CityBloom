import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, openGame, serveTownViaApi, shot, watchErrors } from './helpers';

async function state(page: Page) {
  return page.evaluate(() => window.__game!.getState());
}

async function screen(page: Page, x: number, z: number) {
  return page.evaluate(([x, z]) => window.__game!.worldToScreen(x!, z!), [x, z]);
}

const camera = (page: Page) => page.evaluate(() => window.__game!.getCamera());
const hash = (page: Page) => page.evaluate(() => window.__game!.hash());
const detected = (page: Page) => page.evaluate(() => window.__game!.getShell().applied.detected);

test('M14: trackpad pan, pinch and rotate; undo and redo a bulldoze and a zoning stroke exactly; move a building; shortcut sheet', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errs = watchErrors(page);
  await openGame(page);
  const cz = (await state(page)).highwayZ;
  await buildTownViaApi(page);
  await serveTownViaApi(page);
  await page.evaluate(async () => {
    const g = window.__game!;
    for (const def of ['firestation', 'police'])
      await g.placeCivic(def, { x: 300, z: (await g.getState()).highwayZ + 170 });
    await g.advance(1440);
  });
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 260, z: cz, distance: 520, yaw: 0, tilt: 0.55 }),
    cz,
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
  const mid = { x: 640, y: 400 };
  await page.mouse.move(mid.x, mid.y);

  // --- Trackpad (synthesized through the browser's input pipeline). ---
  // Two-finger swipe: small fractional deltas on both axes pan the map, and the device is detected.
  let c0 = await camera(page);
  for (let k = 0; k < 6; k++) await page.mouse.wheel(14.5, 9.25);
  await expect.poll(() => detected(page)).toBe('trackpad');
  let c1 = await camera(page);
  expect(Math.hypot(c1.x - c0.x, c1.z - c0.z)).toBeGreaterThan(20);
  expect(c1.distance).toBeCloseTo(c0.distance, 3);
  // Pinch (a wheel with Ctrl held, as Chrome reports it) zooms towards the cursor.
  c0 = c1;
  await page.keyboard.down('Control');
  for (let k = 0; k < 5; k++) await page.mouse.wheel(0, -12);
  await page.keyboard.up('Control');
  c1 = await camera(page);
  expect(c1.distance).toBeLessThan(c0.distance * 0.8);
  // Option/Alt + swipe turns and tilts.
  c0 = c1;
  await page.keyboard.down('Alt');
  for (let k = 0; k < 5; k++) await page.mouse.wheel(20.5, 6.5);
  await page.keyboard.up('Alt');
  c1 = await camera(page);
  expect(Math.abs(c1.yaw - c0.yaw)).toBeGreaterThan(0.2);
  expect(c1.tilt).not.toBeCloseTo(c0.tilt, 3);
  // Safari's rotate-and-pinch gesture.
  c0 = c1;
  await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('canvas')!;
    const fire = (type: string, scale: number, rotation: number) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(e, { scale, rotation, clientX: x, clientY: y });
      canvas.dispatchEvent(e);
    };
    fire('gesturestart', 1, 0);
    fire('gesturechange', 1.1, 15);
    fire('gesturechange', 1.25, 30);
    fire('gestureend', 1.25, 30);
  }, mid);
  c1 = await camera(page);
  expect(Math.abs(c1.yaw - c0.yaw)).toBeGreaterThan(0.4);
  expect(c1.distance).toBeLessThan(c0.distance);
  // A mouse wheel still zooms (and is recognised as a mouse).
  c0 = c1;
  await page.mouse.wheel(0, 200);
  await expect.poll(() => detected(page)).toBe('mouse');
  c1 = await camera(page);
  expect(c1.distance).toBeGreaterThan(c0.distance);
  expect(Math.hypot(c1.x - c0.x, c1.z - c0.z)).toBeLessThan(1);
  // The setting can fix the device: as "trackpad", even a mouse-like wheel pans.
  await page.evaluate(() => window.__game!.setSettings({ pointer: 'trackpad' }));
  c0 = await camera(page);
  await page.mouse.wheel(0, 120);
  c1 = await camera(page);
  expect(c1.distance).toBeCloseTo(c0.distance, 3);
  expect(Math.hypot(c1.x - c0.x, c1.z - c0.z)).toBeGreaterThan(20);
  await page.evaluate(() => window.__game!.setSettings({ pointer: 'auto' }));

  // --- Undo and redo a zoning stroke, exactly. ---
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 260, z: cz, distance: 520, yaw: 0, tilt: 0.55 }),
    cz,
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
  const h0 = await hash(page);
  await page.getByTestId('tool-zone').click();
  await page.getByTestId('zone-C').click();
  const a = await screen(page, 60, cz - 140);
  const b = await screen(page, 460, cz - 140);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => hash(page)).not.toBe(h0);
  await page.getByTestId('tool-select').click();
  const h1 = await hash(page);
  await page.keyboard.press('Control+z');
  await expect.poll(() => hash(page)).toBe(h0);
  await expect(page.locator('.toast').filter({ hasText: 'Undone: zoning' })).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => hash(page)).toBe(h1);

  // --- Undo and redo a bulldoze from the inspector, exactly. ---
  const police = await page.evaluate(() => window.__game!.getCivics().find((c) => c.def === 'police')!);
  await page.evaluate(
    (c) => window.__game!.setCamera({ x: c.x, z: c.z, distance: 110, yaw: 0.3, tilt: 0.3 }),
    police,
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
  let p = await screen(page, police.x, police.z);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('inspector')).toBeVisible();
  await expect(page.getByTestId('bulldoze')).toBeVisible();
  const h2 = await hash(page);
  await page.getByTestId('bulldoze').click();
  await page.getByTestId('bulldoze-yes').click();
  await expect.poll(() => hash(page)).not.toBe(h2);
  const h3 = await hash(page);
  await page.getByTestId('tool-undo').click();
  await expect.poll(() => hash(page)).toBe(h2);
  await expect(page.locator('.toast').filter({ hasText: 'Undone: bulldozing' })).toBeVisible();
  await shot(page, 'm14-undo');
  await page.getByTestId('tool-redo').click();
  await expect.poll(() => hash(page)).toBe(h3);
  await page.getByTestId('tool-undo').click();
  await expect.poll(() => hash(page)).toBe(h2);

  // --- Move a building: the police station, from its inspector to another street. ---
  await page.evaluate(
    (c) => window.__game!.setCamera({ x: c.x, z: c.z, distance: 110, yaw: 0.3, tilt: 0.3 }),
    police,
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
  p = await screen(page, police.x, police.z);
  await page.mouse.click(p.x, p.y);
  await page.getByTestId('move-civic').click();
  await expect(page.getByTestId('inspector')).toBeHidden();
  // Put it down beside the first side street's north end.
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 120, z: cz - 110, distance: 300, yaw: 0, tilt: 0.55 }),
    cz,
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
  const hint = page.getByTestId('tool-hint');
  let placed = false;
  for (const [x, z] of [
    [118, cz - 120],
    [74, cz - 120],
    [118, cz - 80],
    [74, cz - 80],
    [118, cz - 140],
  ] as const) {
    p = await screen(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await expect(hint).toContainText(/Move the police station|Must|Overlaps|steep|Not enough/, {
      timeout: 15_000,
    });
    await page.waitForTimeout(300);
    if (/here · \$/.test((await hint.textContent()) ?? '')) {
      await shot(page, 'm14-move');
      await page.mouse.click(p.x, p.y);
      placed = true;
      break;
    }
  }
  expect(placed).toBe(true);
  await expect
    .poll(async () => {
      const f = await page.evaluate((id) => window.__game!.getCivics().find((c) => c.id === id)!, police.id);
      return Math.hypot(f.x - police.x, f.z - police.z);
    })
    .toBeGreaterThan(40);
  await expect(page.locator('.toast').filter({ hasText: 'Police station moved' })).toBeVisible();

  // --- The shortcut sheet on `?`. ---
  await page.keyboard.press('Shift+Slash');
  await expect(page.getByTestId('shortcuts')).toBeVisible();
  await expect(page.getByTestId('shortcuts')).toContainText('Pinch');
  await expect(page.getByTestId('shortcuts')).toContainText(/Ctrl\+Z|⌘Z/);
  await shot(page, 'm14-shortcuts');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shortcuts')).toBeHidden();
  expect((await page.evaluate(() => window.__game!.getShell().screens)).length).toBe(0);
  errs.check();
});
