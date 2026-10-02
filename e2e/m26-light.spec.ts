import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, openGame, shot, watchErrors } from './helpers';
import { untilHour } from './ui';

/**
 * M26: light and sky in a real town. The frame as the player sees it: soft shading where things
 * meet by day, a glow round lit windows at night, a golden hour that glows rather than dims, and
 * every effect switched by the graphics quality chosen in Settings.
 */
const frame = (page: Page) => page.evaluate(() => window.__game!.frameStats());
const applied = (page: Page) => page.evaluate(() => window.__game!.getShell().applied);

test('M26: occlusion by day, glow at night, a bright golden hour, and the effects follow the graphics quality', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errs = watchErrors(page);
  await openGame(page, '&seed=light&preset=river&sandbox=1&disasters=0');
  await buildTownViaApi(page);
  // Let the town grow a little, then look down a street at noon in clear summer weather.
  await page.evaluate(async () => {
    const g = window.__game!;
    await g.advance(60 * 24 * 20);
    g.setWeatherLook({ season: [0, 1, 0, 0], kind: 'clear', strength: 0, snow: 0, wet: 0 });
    const b = g.getBuildings();
    const at = b[Math.floor(b.length / 2)]!;
    g.setCamera({ x: at.x, z: at.z, distance: 130, yaw: 0.7, tilt: 0.1 });
  });
  await untilHour(page, 13);
  await page.evaluate(() => window.__game!.waitFrames(6));

  // High quality: every effect on, two shadow cascades.
  expect(await applied(page)).toMatchObject({ ao: 12, aoBlur: true, glow: true, cascades: 2 });
  const noon = await frame(page);
  expect(noon.lum).toBeGreaterThan(0.25);
  // Occlusion darkens corners a little, not the frame.
  await page.evaluate(() => window.__game!.setPost({ aoSamples: 0 }));
  const flat = await frame(page);
  await page.evaluate(() => window.__game!.setPost({ aoSamples: 12 }));
  expect(noon.lum).toBeLessThan(flat.lum);
  expect(noon.lum).toBeGreaterThan(flat.lum * 0.9);
  await shot(page, 'm26-street-noon');

  // Golden hour: warm and low, but bright.
  await untilHour(page, 18.6);
  await page.evaluate(() => window.__game!.waitFrames(6));
  const golden = await frame(page);
  expect(golden.lum).toBeGreaterThan(noon.lum * 0.55);
  await shot(page, 'm26-street-golden');

  // Night: lit windows glow.
  await untilHour(page, 22);
  await page.evaluate(() => window.__game!.waitFrames(6));
  const night = await frame(page);
  expect(night.warm).toBeGreaterThan(0);
  // The glow brightens the pixels round lit windows and lamps, and only those.
  const glow = await page.evaluate(() => {
    const g = window.__game!;
    g.setSpeed(0);
    g.setPost({ glow: false });
    const off = g.framePixels();
    g.setPost({ glow: true });
    const on = g.framePixels();
    let brighter = 0;
    let darker = 0;
    for (let i = 0; i < on.length; i += 4) {
      const d = on[i]! + on[i + 1]! + on[i + 2]! - off[i]! - off[i + 1]! - off[i + 2]!;
      if (d > 12) brighter++;
      else if (d < -12) darker++;
    }
    return { brighter: brighter / (on.length / 4), darker: darker / (on.length / 4) };
  });
  expect(glow.brighter).toBeGreaterThan(0.002);
  expect(glow.darker).toBeLessThan(glow.brighter / 10);
  const dull = night;
  // Back to what the graphics settings say.
  await page.evaluate(() => window.__game!.setPost(null));
  await shot(page, 'm26-street-night');

  // Through Settings: Low turns the effects off and the frame still draws; High brings them back.
  await page.getByTestId('menu-button').click();
  await page.getByTestId('pause-settings').click();
  await page.getByTestId('quality-low').click();
  await page.getByTestId('shell-back').click();
  await page.getByTestId('pause-resume').click();
  await page.evaluate(() => window.__game!.waitFrames(4));
  expect(await applied(page)).toMatchObject({ ao: 0, glow: false, cascades: 1 });
  expect((await frame(page)).lum).toBeGreaterThan(0.03);
  await page.getByTestId('menu-button').click();
  await page.getByTestId('pause-settings').click();
  await page.getByTestId('quality-medium').click();
  await page.getByTestId('shell-back').click();
  await page.getByTestId('pause-resume').click();
  expect(await applied(page)).toMatchObject({ ao: 4, aoBlur: false, glow: true, cascades: 1 });
  await page.getByTestId('menu-button').click();
  await page.getByTestId('pause-settings').click();
  await page.getByTestId('quality-high').click();
  await page.getByTestId('shell-back').click();
  await page.getByTestId('pause-resume').click();
  await page.evaluate(() => window.__game!.waitFrames(4));
  expect(await applied(page)).toMatchObject({ ao: 12, glow: true, cascades: 2 });
  expect((await frame(page)).lum).toBeGreaterThan(dull.lum * 0.8);
  errs.check();
});
