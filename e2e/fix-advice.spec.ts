import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, openGame, serveTownViaApi, shot, watchErrors } from './helpers';
import { MAP_SIZE } from '../src/data/world';
import { untilHour } from './ui';

/**
 * Playthrough fixes round: advice and labels that said something the numbers did not (P15, P25), and
 * the city limit, which was a line a metre wide and so invisible from any distance (P21).
 */

const state = (page: Page) => page.evaluate(() => window.__game!.getState());

test('P25: a home beside a primary school is told which school places it lacks', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = watchErrors(page);
  await openGame(page);
  await buildTownViaApi(page);
  await serveTownViaApi(page);
  const cz = (await state(page)).highwayZ;
  // A primary school a street from the northern homes, placed before they grow.
  const school = await page.evaluate(async (cz) => {
    const g = window.__game!;
    const id = await g.placeCivic('primary', { x: 260, z: cz - 90 });
    return g.getCivics().find((c) => c.id === id) ?? null;
  }, cz);
  expect(school).not.toBeNull();
  await page.evaluate(() => window.__game!.advance(1440 * 3));

  // Homes nearest the school first: they have every primary seat and no high school place.
  const homes = await page.evaluate((s) => {
    return window
      .__game!.getBuildings()
      .filter((b) => b.state === 1 && b.zone === 1)
      .sort((a, b) => Math.hypot(a.x - s!.x, a.z - s!.z) - Math.hypot(b.x - s!.x, b.z - s!.z))
      .slice(0, 60)
      .filter((_, i) => i % 5 === 0);
  }, school);
  expect(homes.length).toBeGreaterThan(4);

  const seen: string[] = [];
  let last = '';
  let shown = false;
  for (const h of homes) {
    await page.evaluate(
      (h) => window.__game!.setCamera({ x: h.x, z: h.z, distance: 110, yaw: 0.3, tilt: 0.3 }),
      h,
    );
    await page.evaluate(() => window.__game!.waitFrames(2));
    const p = await page.evaluate((h) => window.__game!.worldToScreen(h.x, h.z), h);
    await page.mouse.click(p.x, p.y);
    const inspector = page.getByTestId('inspector');
    // Wait for this click to reach the panel (the last home's card stays up until it does).
    const address = page.getByTestId('inspector-address');
    await expect(address)
      .not.toHaveText(last, { timeout: 8000 })
      .catch(() => undefined);
    last = (await address.isVisible()) ? await address.innerText() : '';
    // (A click beside the school may land on the school itself.)
    if (!(await page.getByTestId('inspector-health').isVisible())) continue;
    // The residents' own level is called what the data map calls it.
    await expect(inspector).toContainText('Education level');
    const lines = (await page.getByTestId('inspector-factors').innerText()).split('\n');
    seen.push(...lines);
    const at = lines.findIndex((l) => /places nearby|is full/.test(l));
    if (at < 0) continue;
    if (!shown) {
      shown = true;
      await shot(page, 'fix-advice-p25-inspector');
    }
    // If the penalty is big enough to be listed under "Would help" (low-wealth homes rarely reach it), it
    // names the same missing level.
    if (/high school/.test(lines[at]!) && Number.parseFloat(lines[at + 1]!) <= -2) {
      await expect(page.getByTestId('inspector-needs')).toContainText(
        'A high school with free places within reach',
      );
    }
  }
  const text = seen.join('\n');
  // Never "no school" beside a school; say what is missing.
  expect(text).not.toMatch(/No school nearby/);
  expect(text).toMatch(/No high school places nearby/);
  errs.check();
});

test('P15: with a building on partial power the advisor says so instead of "All supplied"', async ({
  page,
}) => {
  test.setTimeout(420_000);
  const errs = watchErrors(page);
  await openGame(page);
  await buildTownViaApi(page);
  // Two wind turbines are about what a small town needs, so growth keeps crossing the limit.
  await page.evaluate(async () => {
    const g = window.__game!;
    await g.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 80_000 });
    const s = await g.getState();
    const near = { x: 300, z: s.highwayZ + 170 };
    for (const def of ['wind', 'wind', 'pump', 'pump', 'treatment', 'landfill'])
      if ((await g.placeCivic(def, near)) === null) throw new Error(`could not place ${def}`);
  });
  await page.evaluate(() => window.__game!.advance(1440 * 2));
  await page.getByTestId('open-advisors').click();
  const panel = page.getByTestId('advisor-utilities');
  await expect(panel).toBeVisible();

  // Step the clock until exactly one building is short and the shortfall is under a building's use.
  let found = false;
  for (let k = 0; k < 1500 && !found; k++) {
    await page.evaluate(() => window.__game!.advance(10));
    const p = (await state(page)).utilities.power;
    if (p.unserved !== 1 || p.demand - p.supply > 1) continue;
    // The panel refreshes every two seconds of real time: wait for it to catch up with this state.
    await expect(panel).toContainText(/1 building (short of|without) power/, { timeout: 20_000 });
    const text = await panel.innerText();
    expect(text).not.toMatch(/All supplied/);
    if (/short of power/.test(text)) {
      found = true;
      expect(text).toMatch(/only part of the power needed/);
      await shot(page, 'fix-advice-p15-partial-power');
    }
  }
  expect(found, 'the town never sat exactly at its power limit').toBe(true);
  errs.check();
});

/**
 * The city limit as drawn along the east edge near world point (MAP_SIZE, z), read from the frame as the
 * player sees it: the rows of pixels round it are lined up on the line (it slants on screen) and
 * averaged, so a tree standing on it cannot break it; then how wide it is (the area under it over its
 * height, in device pixels) and how far it stands above the ground beside it (0-255 luminance).
 */
async function limitLine(
  page: Page,
  z: number,
): Promise<{ width: number; contrast: number; profile: string }> {
  return page.evaluate(
    ([z, MAP]) => {
      const g = window.__game!;
      const px = g.framePixels();
      const canvas = document.querySelector('canvas')!;
      const rect = canvas.getBoundingClientRect();
      const scale = canvas.width / rect.width;
      const W = canvas.width;
      const H = canvas.height;
      const proj = (zz: number) => {
        const p = g.worldToScreen(MAP, zz);
        return { x: (p.x - rect.left) * scale, y: H - 1 - (p.y - rect.top) * scale };
      };
      const a = proj(z! - 20);
      const b = proj(z! + 20);
      const slope = (b.x - a.x) / (b.y - a.y);
      const c = proj(z!);
      const lum = (x: number, y: number) => {
        const i = (y * W + x) * 4;
        return 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
      };
      const K = 40;
      const prof = new Array<number>(2 * K + 1).fill(0);
      const ROWS = 12;
      for (let dy = -ROWS; dy <= ROWS; dy++) {
        const y = Math.round(c.y) + dy;
        const xc = Math.round(c.x + slope * (y - c.y));
        for (let k = -K; k <= K; k++) prof[k + K]! += lum(xc + k, y) / (2 * ROWS + 1);
      }
      const median = (lo: number, hi: number) =>
        prof.slice(K + lo, K + hi + 1).sort((p, q) => p - q)[(hi - lo) >> 1]!;
      // (Ground on either side, near enough that the road beside the edge does not count.)
      const base = Math.max(median(-20, -9), median(9, 20));
      let peak = base;
      let at = 0;
      for (let k = -8; k <= 8; k++) {
        if (prof[k + K]! <= peak) continue;
        peak = prof[k + K]!;
        at = k;
      }
      let area = 0;
      for (let k = at - 8; k <= at + 8; k++) area += Math.max(0, prof[k + K]! - base);
      return {
        width: peak > base ? area / (peak - base) : 0,
        contrast: peak - base,
        profile: prof
          .slice(K - 10, K + 11)
          .map((v) => Math.round(v))
          .join(','),
      };
    },
    [z, MAP_SIZE],
  );
}

test('P21: the city limit is a line a few pixels wide from the whole-city view to close up, and stronger with a build tool out', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errs = watchErrors(page);
  await openGame(page, '&seed=ground&preset=river&sandbox=1&disasters=0');
  await page.evaluate(() => {
    window.__game!.setWeatherLook({ season: [0, 1, 0, 0], kind: 'clear', strength: 0, snow: 0, wet: 0 });
  });
  await untilHour(page, 13);
  // A stretch of the east edge on open ground, clear of the water (the highway runs along the west).
  const zc = await page.evaluate(async (edge) => {
    const g = window.__game!;
    const hw = (await g.getState()).highwayZ;
    for (let z = 700; z < 1500; z += 25) {
      if (Math.abs(z - hw) < 120) continue;
      let ok = true;
      for (let x = edge - 80; x <= edge + 80; x += 10)
        for (let dz = -60; dz <= 60; dz += 20) ok &&= g.heightAt(x, z + dz) > 1.2;
      if (ok) return z;
    }
    return -1;
  }, MAP_SIZE);
  expect(zc).toBeGreaterThan(0);
  const look = async (distance: number, x: number) => {
    await page.evaluate(
      ([x, z, distance]) => window.__game!.setCamera({ x: x!, z: z!, distance: distance!, yaw: 0, tilt: 0 }),
      [x, zc, distance],
    );
    await page.evaluate(() => window.__game!.waitFrames(4));
    return limitLine(page, zc);
  };

  // Whole city, city zoom and close up: a line of a few pixels, plainly brighter than the ground.
  const poses: [string, number, number][] = [
    ['overview', 2750, 1024],
    ['city', 620, MAP_SIZE - 200],
    ['street', 150, MAP_SIZE - 30],
  ];
  for (const [name, distance, x] of poses) {
    const m = await look(distance, x);
    console.log(
      `[p21] ${name} ${distance} m: width ${m.width.toFixed(1)} px, contrast ${m.contrast.toFixed(1)} [${m.profile}]`,
    );
    await shot(page, `fix-limits-${name}`);
    expect(m.width, `${name} width`).toBeGreaterThanOrEqual(3);
    expect(m.width, `${name} width`).toBeLessThanOrEqual(12);
    expect(m.contrast, `${name} contrast`).toBeGreaterThanOrEqual(12);
  }

  // A road or building tool in hand: stronger still. Back to select: back to normal.
  const calm = await look(2750, 1024);
  await page.getByTestId('tool-road').click();
  const road = await look(2750, 1024);
  console.log(`[p21] road tool: width ${road.width.toFixed(1)} px, contrast ${road.contrast.toFixed(1)}`);
  await shot(page, 'fix-limits-road-tool');
  expect(road.width).toBeGreaterThan(calm.width);
  expect(road.contrast).toBeGreaterThan(calm.contrast);
  await page.getByTestId('tool-select').click();
  const back = await look(2750, 1024);
  expect(back.width).toBeLessThanOrEqual(calm.width);
  await page.getByTestId('tool-education').click();
  await page.getByTestId('place-highschool').click();
  const place = await look(2750, 1024);
  console.log(`[p21] place tool: width ${place.width.toFixed(1)} px, contrast ${place.contrast.toFixed(1)}`);
  expect(place.width).toBeGreaterThan(calm.width);
  await page.keyboard.press('Escape');
  errs.check();
});
