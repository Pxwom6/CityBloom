import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, openGame, serveTownViaApi, shot, watchErrors } from './helpers';

const state = (page: Page) => page.evaluate(() => window.__game!.getState());
const photo = (page: Page) => page.evaluate(() => window.__game!.getPhoto());
const chronicle = (page: Page) => page.evaluate(() => window.__game!.getChronicle());

/** Width and height from a PNG's header. */
function pngSize(buf: Buffer): { width: number; height: number } {
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('M16: city history charts the city and survives save and load exactly; photo mode saves a full-resolution PNG with no UI', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errs = watchErrors(page);
  await openGame(page);
  const cz = (await state(page)).highwayZ;
  await buildTownViaApi(page);
  await serveTownViaApi(page);
  // Services too, or the town burns and empties out before it's a village.
  await page.evaluate(async (cz) => {
    const g = window.__game!;
    for (const def of ['firestation', 'police', 'clinic', 'primary', 'park_small'])
      await g.placeCivic(def, { x: 200, z: cz - 60 });
  }, cz);
  // Growth until the town becomes a village, with a meteor early on for the timeline.
  const grown = await page.evaluate(async (cz) => {
    const g = window.__game!;
    let months = 0;
    while (months < 30) {
      if (months === 3) await g.dispatch({ type: 'disaster', kind: 'meteor', at: { x: 420, z: cz + 260 } });
      await g.advance(1440);
      months++;
      if (months >= 6 && (await g.getState()).milestone >= 1) break;
    }
    return { months, pop: (await g.getState()).population };
  }, cz);
  console.log(`[m16] ${grown.months} months, ${grown.pop} residents`);
  const c0 = await chronicle(page);
  expect(c0.series[0]!.length).toBe(grown.months);
  expect(c0.events.map((e) => e.kind)).toEqual(expect.arrayContaining(['milestone', 'disaster']));

  // --- City history from the top bar. ---
  await page.getByTestId('open-history').click();
  const panel = page.getByTestId('history-panel');
  await expect(panel).toBeVisible();
  for (const k of [
    'population',
    'approval',
    'jobs',
    'unemployment',
    'treasury',
    'income',
    'pollution',
    'crime',
    'traffic',
  ])
    await expect(page.getByTestId(`history-${k}`).locator('svg.chart')).toBeVisible();
  await expect(page.getByTestId('history-events')).toContainText('Meteor');
  await expect(page.getByTestId('history-events')).toContainText('Became a village');
  // Hovering a chart gives the month, the value and any event near it.
  // (Measured again on each try: the panel may still be settling when it first opens.)
  await expect(async () => {
    const box = (await page.getByTestId('history-population').locator('svg.chart').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.93, box.y + box.height * 0.5);
    await expect(page.getByTestId('history-population').locator('.chart-tip')).toContainText(/Year 1/, {
      timeout: 3000,
    });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId('history-population').locator('.chart-marker')).not.toHaveCount(0);
  await shot(page, 'm16-history');
  await page.getByTestId('open-history').click();
  await expect(panel).toBeHidden();

  // --- Saved and loaded, exactly. ---
  await page.getByTestId('menu-button').click();
  await page.getByTestId('menu-save').click();
  await expect(page.getByTestId('toast')).toContainText('Saved');
  const before = await chronicle(page);
  const hash = await page.evaluate(() => window.__game!.hash());
  await page.goto('./?load=quick&paused=1');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  expect(await chronicle(page)).toEqual(before);
  expect(await page.evaluate(() => window.__game!.hash())).toBe(hash);

  // --- Photo mode. ---
  await page.evaluate(() => window.__game!.setSpeed(1));
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 200, z: cz - 60, distance: 160, yaw: 0.4, tilt: 0.1 }),
    cz,
  );
  await page.getByTestId('tool-photo').click();
  await expect(page.getByTestId('photo-panel')).toBeVisible();
  // Only the photo panel is left of the interface; in the 3D view, the helpers are hidden.
  await expect(page.getByTestId('topbar')).toHaveCount(0);
  await expect(page.getByTestId('toolbar')).toHaveCount(0);
  let ph = await photo(page);
  expect(ph.on).toBe(true);
  expect(ph.hidden).toEqual(expect.arrayContaining(['icons', 'ghost', 'routeTint', 'coverageMap', 'zones']));
  // … and they stay hidden frame after frame (the problem icons came back on the next frame until
  // the phase 3 walk-through).
  await page.evaluate(() => window.__game!.waitFrames(3));
  for (const name of ['icons', 'ghost', 'routeTint', 'coverageMap', 'zones'])
    expect(await page.evaluate((n) => window.__game!.groupShown(n), name), name).toBe(false);
  // The camera comes down to eye level, closer than the usual 14 m.
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 150, z: cz - 40, distance: 5, yaw: 0.6, tilt: -0.3 }),
    cz,
  );
  await page.evaluate(() => window.__game!.waitFrames(3));
  ph = await photo(page);
  expect((await page.evaluate(() => window.__game!.getCamera())).distance).toBeLessThan(6);
  expect(ph.cameraY - ph.groundY).toBeLessThan(4);
  // Light, lens and colour.
  await page.getByTestId('photo-hour').fill('18.5');
  await page.getByTestId('photo-fov').fill('60');
  await page.getByTestId('photo-dof').fill('0.6');
  await page.getByTestId('photo-tilt').fill('0.3');
  await page.getByTestId('photo-grade-golden').click();
  ph = await photo(page);
  expect(ph.state).toMatchObject({ hour: 18.5, fov: 60, dof: 0.6, tiltShift: 0.3, grade: 'golden' });
  expect(ph.lens).toBe(true);
  expect(ph.fov).toBe(60);
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 200, z: cz - 40, distance: 60, yaw: 0.6, tilt: -0.1 }),
    cz,
  );
  await page.evaluate(() => window.__game!.waitFrames(3));
  await shot(page, 'm16-photo-panel');

  // Save a photo at twice the screen's resolution: a PNG straight from the 3D view.
  await page.getByTestId('photo-scale-2').click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 180_000 }),
    page.getByTestId('photo-save').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const file = await download.path();
  const png = readFileSync(file);
  const viewport = page.viewportSize()!;
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  expect(pngSize(png)).toEqual({ width: viewport.width * dpr * 2, height: viewport.height * dpr * 2 });
  await expect(page.getByTestId('photo-saved')).toContainText(
    `${viewport.width * 2} × ${viewport.height * 2}`,
  );
  await download.saveAs('test-results/m16-photo.png');
  // Not a blank frame: the picture varies across the view.
  const spread = await page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(64, 40);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, 64, 40);
    const d = ctx.getImageData(0, 0, 64, 40).data;
    let lo = 255;
    let hi = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
    }
    return hi - lo;
  }, png.toString('base64'));
  expect(spread).toBeGreaterThan(40);

  // Follow a car along its trip. The city is paused first: on this slow renderer the sim runs ahead
  // of the frames and a whole trip can pass in a few of them.
  await page.getByTestId('photo-running').uncheck();
  await page.getByTestId('photo-follow-car').click();
  await expect(page.getByTestId('photo-following')).toContainText('a car');
  await page.evaluate(() => window.__game!.waitFrames(3));
  ph = await photo(page);
  expect(ph.follow).not.toBeNull();
  let cam = await page.evaluate(() => window.__game!.getCamera());
  expect(Math.hypot(cam.x - ph.follow!.x, cam.z - ph.follow!.z)).toBeLessThan(3);
  const from = ph.follow!;
  // A few minutes on: the car has moved on and the camera with it.
  await page.evaluate(async () => {
    await window.__game!.advance(4);
    await window.__game!.waitFrames(3);
  });
  ph = await photo(page);
  expect(ph.follow).not.toBeNull();
  expect(Math.hypot(ph.follow!.x - from.x, ph.follow!.z - from.z)).toBeGreaterThan(2);
  cam = await page.evaluate(() => window.__game!.getCamera());
  expect(Math.hypot(cam.x - ph.follow!.x, cam.z - ph.follow!.z)).toBeLessThan(3);
  await shot(page, 'm16-follow');
  await page.getByTestId('photo-follow-stop').click();

  // H hides the panel too; Escape leaves photo mode and the interface comes back.
  await page.keyboard.press('h');
  await expect(page.getByTestId('photo-panel')).toBeHidden();
  await page.keyboard.press('h');
  await expect(page.getByTestId('photo-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('photo-panel')).toHaveCount(0);
  await expect(page.getByTestId('topbar')).toBeVisible();
  ph = await photo(page);
  expect(ph.on).toBe(false);
  expect(ph.fov).toBe(45);
  expect((await page.evaluate(() => window.__game!.getShell().screens)).length).toBe(0);
  errs.check();
});
