import { expect, test } from '@playwright/test';
import { buildTownViaApi, openGame, serveTownViaApi, shot, watchErrors } from './helpers';
import { frames, untilHour } from './ui';

/**
 * M25: hand-made models in a real city. Homes zoned along an avenue grow, through the sim's own
 * growth, into medium-density, low-wealth, level-3 buildings (R103): the tenement model, 8 m
 * wide, stands three abreast on their 24 m lots.
 */
test('M25: the tenement grows through normal zoning: three abreast, lit at night, snowed on, and its far version takes over unseen', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errs = watchErrors(page);
  await openGame(page, '&seed=tenement&preset=river&sandbox=1&disasters=0');
  await buildTownViaApi(page);
  await serveTownViaApi(page);
  // A second avenue north of the town with homes both sides: avenues take medium density.
  await page.evaluate(async () => {
    const g = window.__game!;
    const c = { x: 24, z: (await g.getState()).highwayZ };
    const z = c.z - 230;
    const ok = async (cmd: Parameters<typeof g.dispatch>[0]) => {
      const r = await g.dispatch(cmd);
      if (!r.ok) throw new Error(`${cmd.type} failed: ${r.reason}`);
    };
    for (const x of [c.x + 96, c.x + 384])
      await ok({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x, z: c.z - 160 },
          { x, z },
        ],
      });
    await ok({
      type: 'buildRoad',
      road: 'avenue',
      points: [
        { x: c.x + 40, z },
        { x: c.x + 440, z },
      ],
    });
    await ok({
      type: 'zone',
      zone: 'R',
      area: {
        kind: 'brush',
        points: [
          { x: c.x + 40, z },
          { x: c.x + 440, z },
        ],
        radius: 40,
      },
    });
    // Fire, police, a clinic, a school and a park: happy homes are the ones that grow.
    await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 140_000 });
    for (const def of ['firestation', 'police', 'clinic', 'primary', 'park_small'])
      if ((await g.placeCivic(def, { x: c.x + 240, z: c.z - 60 })) === null)
        throw new Error(`no room for ${def}`);
    // Month by month until a tenement stands on a lot of its type's own size.
    for (let month = 0; month < 8; month++) {
      await g.advance(1440);
      if (g.getModels().some((m) => m.hand === 'R103' && m.w === 3 && m.d === 3)) break;
    }
    await g.waitFrames(4);
  });

  // --- The models arrived with the game, and buildings wear them. ---
  const models = await page.evaluate(() => window.__game!.getModels());
  const hand = models.filter((m) => m.hand);
  const census = new Map<string, number>();
  for (const m of models.filter((m) => m.def.startsWith('R1')))
    census.set(
      `${m.def}@${m.w}x${m.d}${m.hand ? '*' : ''}`,
      (census.get(`${m.def}@${m.w}x${m.d}${m.hand ? '*' : ''}`) ?? 0) + 1,
    );
  console.log(
    `[m25] ${models.length} buildings, ${hand.length} hand-made; medium-density homes (* hand-made): ${[
      ...census,
    ]
      .sort()
      .map(([k, n]) => `${k}×${n}`)
      .join(' ')}`,
  );
  expect(hand.length).toBeGreaterThan(20);
  // Generated looks only where fewer than two designs fit the lot (model batch 2: two designs or
  // more, every look hand-made).
  const designs = await page.evaluate(() =>
    window.__game!.getHandDesigns().filter((d) => d.kind === 'zoned'),
  );
  const fitting = (m: { def: string; w: number; d: number }) =>
    designs.filter((d) => {
      const k = Math.round((m.w * 8) / d.w);
      return (
        d.def === m.def && k >= 1 && k <= 3 && Math.abs(k * d.w - m.w * 8) < 0.05 && d.d <= m.d * 8 + 0.05
      );
    }).length;
  for (const m of models.filter((m) => !m.hand)) expect(fitting(m), `${m.def}@${m.w}x${m.d}`).toBeLessThan(2);
  // Tenements on the type's own lot: 24 m wide, three 8 m copies.
  const rows = models.filter((m) => m.def === 'R103' && m.hand === 'R103');
  expect(rows.length).toBeGreaterThan(0);
  const three = rows.find((m) => m.w === 3 && m.d === 3);
  expect(three, 'an R103 tenement on a 3×3 lot').toBeTruthy();
  // Three copies less the windows their party walls hide; a far and a skyline version, each lighter
  // (the far version keeps the frames' faces and the undersides that cast shadows: about 60 %).
  expect(three!.triangles).toBeGreaterThan(2500);
  expect(three!.triangles).toBeLessThan(3 * 1474);
  expect(three!.far).toBeLessThan(three!.triangles * 0.7);
  expect(three!.sky).toBeLessThan(three!.far);
  // On a 16 m lot there are two.
  const two = rows.find((m) => m.w === 2);
  if (two) expect(two.triangles).toBeLessThan(three!.triangles);
  // No two buildings of one type and size side by side wear the same look.
  const where = await page.evaluate(() => window.__game!.getBuildings());
  const at = new Map(where.map((b) => [b.id, b]));
  let alike = 0;
  for (const a of models)
    for (const b of models) {
      if (a.id >= b.id || a.def !== b.def || a.w !== b.w || a.d !== b.d || a.look !== b.look) continue;
      const [p, q] = [at.get(a.id)!, at.get(b.id)!];
      if (Math.hypot(p.x - q.x, p.z - q.z) <= Math.max(a.w, a.d) * 8 + 1.5) alike++;
    }
  expect(alike).toBe(0);

  // --- By day, close up: drawn, and clicking it says what it is. ---
  const t = at.get(three!.id)!;
  // Milestone banners go after a few seconds, or on a click: keep them out of the pictures.
  const banner = page.getByTestId('milestone-banner');
  const clear = async () => {
    for (let k = 0; k < 4 && (await banner.isVisible()); k++) {
      await banner.click({ timeout: 3000 }).catch(() => undefined);
      await frames(page, 2);
    }
    await expect(banner).toBeHidden();
  };
  await clear();
  await untilHour(page, 13);
  await clear();
  // Look at it from the side nothing taller stands in front of: where a click finds it.
  let yaw = 0;
  for (const tryYaw of [0.5, 2.1, 3.6, 5.2, 1.3, 2.9, 4.4, 6.0]) {
    yaw = tryYaw;
    const found = await page.evaluate(
      async ({ t, yaw }) => {
        const g = window.__game!;
        g.setCamera({ x: t.x, z: t.z, distance: 75, yaw, tilt: 0.25 });
        await g.waitFrames(3);
        const p = g.worldToScreen(t.x, t.z);
        return g.pickAt(p.x, p.y);
      },
      { t, yaw },
    );
    if (found?.kind === 'building' && found.id === three!.id) break;
  }
  const view = (distance: number) => ({ x: t.x, z: t.z, distance, yaw, tilt: 0.25 });
  await frames(page, 4);
  expect(await page.evaluate(() => window.__game!.drawnPixels('buildings'))).toBeGreaterThan(2000);
  const lod = await page.evaluate(() => window.__game!.getLod());
  expect(lod.buildings.near).toBeGreaterThan(2000);
  await clear();
  await shot(page, 'm25-tenement');
  const p = await page.evaluate((t) => window.__game!.worldToScreen(t.x, t.z), t);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('inspector')).toContainText('Courtyard apartments');
  await page.getByTestId('tool-select').click();
  await page.keyboard.press('Escape');

  // --- At night its windows are lit: each copy its own mix. ---
  const day = await page.evaluate(() => window.__game!.pixelStats());
  await untilHour(page, 22);
  await frames(page, 4);
  const night = await page.evaluate(() => window.__game!.pixelStats());
  expect(night.lum).toBeLessThan(day.lum * 0.6);
  expect(night.warm).toBeGreaterThan(0.004);
  expect(night.warm).toBeGreaterThan(day.warm * 3);
  await clear();
  await shot(page, 'm25-tenement-night');

  // --- In winter there is snow on its roofs. ---
  await untilHour(page, 13);
  await page.evaluate(() =>
    window.__game!.setWeatherLook({ season: [0, 0, 0, 1], kind: 'clear', strength: 0, snow: 0.8, wet: 0 }),
  );
  await frames(page, 4);
  const winter = await page.evaluate(() => window.__game!.pixelStats());
  expect(winter.white).toBeGreaterThan(day.white + 0.15);
  await clear();
  await shot(page, 'm25-tenement-winter');
  await page.evaluate(() => window.__game!.setWeatherLook(null));
  await frames(page, 4);

  // --- Moving away, the far version takes over without showing: at the distance where the two
  // are mixed, the picture is all but the same drawn either way; likewise the skyline version. ---
  const r = lod.range;
  const step = async (distance: number) => {
    await page.evaluate((v) => window.__game!.setCamera(v), view(distance));
    await frames(page, 3);
    return page.evaluate(() => ({
      nearFar: window.__game!.compareLod('near', 'far'),
      farSky: window.__game!.compareLod('far', 'sky'),
      play: window.__game!.compareLod(null, 'near'),
      lod: window.__game!.getLod(),
    }));
  };
  const close = await step(r.nearStart * 0.5);
  const handover = await step((r.nearStart + r.nearEnd) / 2);
  const beyond = await step(r.nearEnd * 1.4);
  const skyline = await step((r.skyStart + r.skyEnd) / 2);
  const farOff = await step(r.skyEnd * 1.6);
  console.log(
    `[m25] what is seen against full detail, close / hand-over / beyond / skyline / far off: ${[close, handover, beyond, skyline, farOff].map((s) => `${(s.play.changed * 100).toFixed(2)} % (${s.play.mean.toFixed(2)})`).join(' / ')}`,
  );
  console.log(
    `[m25] hand-over ${r.nearStart.toFixed(0)}–${r.nearEnd.toFixed(0)} m and ${r.skyStart.toFixed(0)}–${r.skyEnd.toFixed(0)} m; pixels that differ, near|far: ${[close, handover, beyond].map((s) => (s.nearFar.changed * 100).toFixed(2)).join(' / ')} %; far|skyline at the skyline band ${(skyline.farSky.changed * 100).toFixed(2)} %, beyond ${(farOff.farSky.changed * 100).toFixed(2)} %`,
  );
  // For the eye: the same view at the hand-over drawn near, far, and as played.
  await step((r.nearStart + r.nearEnd) / 2);
  await clear();
  for (const level of ['near', 'far', null] as const) {
    await page.evaluate((l) => window.__game!.setLod(l), level);
    await shot(page, `m25-handover-${level ?? 'play'}`);
  }
  // Where near hands over to far, the two differ in a small part of the picture, and faintly
  // (the mean difference is a fraction of one step in 255): measured 1.5 % and 0.5 here.
  expect(handover.nearFar.changed).toBeLessThan(0.025);
  expect(handover.nearFar.mean).toBeLessThan(1);
  // What the player sees there is a mix of the two: closer still to full detail.
  expect(handover.play.changed).toBeLessThan(handover.nearFar.changed);
  // Likewise where far hands over to the skyline.
  expect(skyline.farSky.changed).toBeLessThan(0.025);
  expect(skyline.farSky.mean).toBeLessThan(1);
  // At no distance is what is drawn far from the full models.
  for (const s of [close, handover, beyond, skyline, farOff]) {
    expect(s.play.changed).toBeLessThan(0.035);
    expect(s.play.mean).toBeLessThan(1.2);
  }
  expect(close.play.changed).toBe(0);
  // Each level is on show where it should be (the far level less and less as the town recedes).
  expect(close.lod.buildings.near).toBeGreaterThan(0);
  expect(farOff.lod.buildings.near).toBe(0);
  expect(farOff.lod.buildings.far).toBeLessThan(handover.lod.buildings.far);
  expect(farOff.lod.buildings.sky).toBeGreaterThan(0);
  errs.check();
});
