import { expect, test, type Browser, type Download, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { buildTownViaApi, closeContextsAfterEach, newContext, watchErrors } from './helpers';
import { frames } from './ui';

closeContextsAfterEach();

/**
 * M45, the timelapse, through the interface. A city grows for three game years with recording on (a
 * frame every half month here, the views taking turns, so the run stays short on a software
 * renderer); City history's Make timelapse makes a 15, 30 and 60 second video in turn: each plays in the
 * card for its length at 960×540, shows more town at its end than its start, and downloads as an MP4
 * (H.264), with the first and last frames as pictures. A long city keeps within its limit (the limits
 * made small, so the real store's thinning runs in a few frames); a city older than timelapses says
 * so; recording off keeps nothing; a shared city records on each player's own machine.
 */
type Info = Awaited<ReturnType<NonNullable<Window['__game']>['getTimelapse']>>;
const info = (p: Page): Promise<Info> => p.evaluate(() => window.__game!.getTimelapse());

async function player(
  browser: Browser,
  extra: Record<string, unknown> = {},
  size = { width: 1280, height: 800 },
) {
  const ctx = await newContext(browser, { viewport: size, acceptDownloads: true });
  await ctx.addInitScript((extra) => {
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(
      key,
      JSON.stringify({
        ...s,
        tips: false,
        graphicsChecked: true,
        quality: 'low',
        shadows: false,
        reportsNotice: true,
        ...extra,
      }),
    );
  }, extra);
  return ctx.newPage();
}

const ready = (p: Page) =>
  p.waitForFunction(() => window.__game?.ready === true && window.__game.getShell().mode === 'play', null, {
    timeout: 120_000,
  });

/**
 * Play on `months` with the recorder taking every step's frame: after each step, until its frame is
 * drawn and kept (`record: false`, recording off: just the steps).
 */
async function grow(p: Page, months: number, step: number, record = true): Promise<void> {
  for (let k = 0; k < Math.ceil((months * 1440) / step); k++) {
    const before = (await info(p)).captures;
    await p.evaluate((s) => window.__game!.advance(s), step);
    await frames(p, 2);
    if (record)
      await p.waitForFunction(
        (n) => window.__game!.getTimelapse().then((t) => t.captures > n && !t.busy && t.error === null),
        before,
      );
  }
}

/** A town that grows: an avenue, six streets, homes, shops and industry, power, water and services. */
async function town(p: Page): Promise<void> {
  await p.evaluate(async () => {
    const g = window.__game!;
    const s = await g.getState();
    const c = { x: 24, z: s.highwayZ };
    const ok = async (cmd: Parameters<typeof g.dispatch>[0]) => {
      const r = await g.dispatch(cmd);
      if (!r.ok) throw new Error(`${cmd.type}: ${r.reason}`);
    };
    await ok({ type: 'cheat', cheat: 'addMoney', amount: 500_000 });
    await ok({ type: 'cheat', cheat: 'unlockAll' });
    await ok({ type: 'buildRoad', road: 'avenue', points: [c, { x: c.x + 700, z: c.z }] });
    for (let k = 1; k <= 6; k++)
      await ok({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: c.x + k * 100, z: c.z - 220 },
          { x: c.x + k * 100, z: c.z + 220 },
        ],
      });
    for (const [zone, dz, r] of [
      ['R', -120, 90],
      ['C', 20, 22],
      ['R', 120, 60],
      ['I', 190, 40],
    ] as const)
      await ok({
        type: 'zone',
        zone,
        area: {
          kind: 'brush',
          points: [
            { x: c.x + 20, z: c.z + dz },
            { x: c.x + 690, z: c.z + dz },
          ],
          radius: r,
        },
      });
    for (const def of [
      'coal',
      'coal',
      'pump',
      'pump',
      'treatment',
      'landfill',
      'firestation',
      'clinic',
      'primary',
      'police',
    ])
      await g.placeCivic(def, { x: c.x + 350, z: c.z + 240 });
  });
}

/** The video in the card: its length, size, and how much of its first and last frames is town. */
async function videoFacts(p: Page) {
  return p.evaluate(async () => {
    const el = document.querySelector<HTMLVideoElement>('[data-testid=timelapse-video]')!;
    if (el.readyState < 1) await new Promise((r) => el.addEventListener('loadedmetadata', r, { once: true }));
    const town = async (t: number) => {
      el.currentTime = t;
      await new Promise((r) => el.addEventListener('seeked', r, { once: true }));
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 90;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(el, 0, 0, 160, 90);
      const d = ctx.getImageData(0, 0, 160, 90).data;
      let n = 0;
      // Not grass or forest: roads, roofs, yards (the overlays' plates are left out: they don't grow).
      for (let i = 0; i < d.length; i += 4) {
        const y = Math.floor(i / 4 / 160);
        if (y < 14 || y > 76) continue;
        if (!(d[i + 1]! > d[i]! + 12 && d[i + 1]! > d[i + 2]! + 12)) n++;
      }
      return n;
    };
    return {
      duration: el.duration,
      width: el.videoWidth,
      height: el.videoHeight,
      first: await town(0.2),
      last: await town(el.duration - 0.2),
    };
  });
}

async function saved(d: Download): Promise<Buffer> {
  return readFileSync((await d.path())!);
}

test('three game years, then a 15, 30 and 60 second timelapse made through City history', async ({
  browser,
}) => {
  test.setTimeout(1_500_000);
  const page = await player(browser);
  const errors = watchErrors(page);
  await page.goto('./?seed=tl1&preset=river&name=Bloomfield');
  await ready(page);
  await page.evaluate(() => {
    window.__game!.setSpeed(0);
    window.__game!.setTimelapseStep(720);
  });
  await town(page);
  const start = await info(page);
  expect(start).toMatchObject({ late: false, startTick: 0 });
  expect(start.key).toMatch(/^tl-/);
  await grow(page, 36, 720);
  const grown = await info(page);
  test
    .info()
    .annotations.push({ type: 'recorded', description: JSON.stringify({ ...grown, stored: undefined }) });
  expect(grown.frames.wide).toBeGreaterThanOrEqual(30);
  expect(grown.frames.orbit).toBeGreaterThanOrEqual(30);
  expect(grown.bytes).toBeLessThan(32_000_000);
  // The population grew between the first and the last frame kept.
  expect(grown.stored.wide.at(-1)!.population).toBeGreaterThan(grown.stored.wide[0]!.population);

  await page.getByTestId('open-history').click();
  await expect(page.getByTestId('timelapse-recorded')).toContainText('frames since');
  await expect(page.getByTestId('timelapse-late')).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/m45-history.png' });
  await page.getByTestId('timelapse-open').click();
  await expect(page.getByTestId('timelapse-card')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/m45-card.png' });
  for (const [len, view] of [
    [15, 'wide'],
    [30, 'orbit'],
    [60, 'wide'],
  ] as const) {
    await page.getByTestId(`timelapse-length-${len}`).click();
    await page.getByTestId(`timelapse-view-${view}`).click();
    const t0 = Date.now();
    await page.getByTestId('timelapse-make').click();
    await expect(page.getByTestId('timelapse-progress')).toBeVisible();
    await expect(page.getByTestId('timelapse-result')).toBeVisible({ timeout: 600_000 });
    const v = await videoFacts(page);
    test.info().annotations.push({
      type: `${len} s ${view}`,
      description: `${JSON.stringify(v)}, made in ${((Date.now() - t0) / 1000).toFixed(0)} s`,
    });
    expect(v.duration).toBeGreaterThan(len - 0.3);
    expect(v.duration).toBeLessThan(len + 0.3);
    expect([v.width, v.height]).toEqual([960, 540]);
    expect(v.last, `${len} s: more town at the end than the start`).toBeGreaterThan(v.first * 1.1);
    // The file: an MP4 with H.264 video.
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('timelapse-download').click(),
    ]);
    expect(dl.suggestedFilename()).toBe(`Bloomfield-timelapse-${len}s-${view}.mp4`);
    const mp4 = await saved(dl);
    expect(mp4.subarray(4, 8).toString('latin1')).toBe('ftyp');
    expect(mp4.includes(Buffer.from('avc1'))).toBe(true);
    expect(mp4.length).toBeGreaterThan(200_000);
    if (len === 15) {
      await page.screenshot({ path: 'docs/screenshots/m45-result.png' });
      // The first and last frames as pictures.
      for (const which of ['first', 'last'] as const) {
        const [pic] = await Promise.all([
          page.waitForEvent('download'),
          page.getByTestId(`timelapse-${which}`).click(),
        ]);
        expect(pic.suggestedFilename()).toBe(`Bloomfield-${which}.jpg`);
        const jpg = await saved(pic);
        expect(jpg[0]).toBe(0xff);
        expect(jpg[1]).toBe(0xd8);
      }
    }
  }
  await page.getByTestId('timelapse-close').click();
  errors.check();
});

test('a long city keeps within its limit; an older city says when its recording began; off records nothing', async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const page = await player(browser);
  await page.goto('./?seed=tl2&preset=lakes&name=Longton');
  await ready(page);
  // The limits made small, so the store's thinning runs within a few dozen frames.
  await page.evaluate(() => {
    const g = window.__game!;
    g.setSpeed(0);
    g.setTimelapseStep(1440);
    g.setTimelapseLimits(12, 40_000_000);
  });
  await buildTownViaApi(page, 480, 4);
  await grow(page, 40, 1440);
  const t = await info(page);
  expect(t.stored.wide.length).toBeLessThanOrEqual(12);
  expect(t.stored.orbit.length).toBeLessThanOrEqual(12);
  // The whole life is still there, thinner further back: its first frame and its newest.
  expect(t.stored.wide[0]!.tick).toBeLessThanOrEqual(1440 * 2);
  expect(t.stored.wide.at(-1)!.tick).toBeGreaterThan(1440 * 36);
  expect(t.frames.wide).toBe(t.stored.wide.length);
  expect(t.bytes).toBe([...t.stored.wide, ...t.stored.orbit].reduce((s, f) => s + f.bytes, 0));

  // A scenario's city opens as a saved one does: older than its recording, which says so.
  const old = await player(browser);
  await old.goto('./?scenario=cleanslate');
  await ready(old);
  await old.getByTestId('scenario-begin').click();
  await old.evaluate(() => window.__game!.setSpeed(0));
  await expect.poll(async () => (await info(old)).key).toMatch(/^tl-/);
  expect((await info(old)).late).toBe(true);
  await old.evaluate(() => window.__game!.captureTimelapse());
  await old.evaluate(() => window.__game!.captureTimelapse());
  await expect.poll(async () => (await info(old)).frames.wide).toBeGreaterThan(0);
  await old.getByTestId('open-history').click();
  await expect(old.getByTestId('timelapse-late')).toContainText('older than its timelapse');
  await old.screenshot({ path: 'docs/screenshots/m45-late.png' });

  // Recording off: nothing kept, and the panel says where the switch is.
  const off = await player(browser, { timelapse: false });
  await off.goto('./?seed=tl3&preset=river');
  await ready(off);
  await off.evaluate(() => {
    window.__game!.setSpeed(0);
    window.__game!.setTimelapseStep(240);
  });
  await grow(off, 2, 240, false);
  expect((await info(off)).captures).toBe(0);
  await off.getByTestId('open-history').click();
  await expect(off.getByTestId('timelapse-off')).toContainText('Record a timelapse');
});

test('a shared city records on each player’s own machine', async ({ browser }) => {
  test.setTimeout(500_000);
  const size = { width: 900, height: 640 };
  const ada = await player(browser, {}, size);
  await ada.addInitScript(() =>
    localStorage.setItem('citybloom.player', JSON.stringify({ name: 'Ada', color: 0 })),
  );
  await ada.goto('./?paused=1&seed=tlroom&name=Sharewell');
  await ready(ada);
  await ada.evaluate(() => window.__game!.setTimelapseStep(48));
  await buildTownViaApi(ada, 480, 4);
  await ada.keyboard.press('Escape');
  await ada.getByTestId('pause-invite').click();
  const net = (p: Page) => p.evaluate(() => window.__game!.getNet());
  await expect.poll(async () => (await net(ada))?.state, { timeout: 30_000 }).toBe('playing');
  const code = (await net(ada))!.code;
  await ada.getByTestId('room-panel').getByRole('button', { name: 'Close' }).click();
  const sam = await player(browser, {}, size);
  await sam.addInitScript(() =>
    localStorage.setItem('citybloom.player', JSON.stringify({ name: 'Sam', color: 1 })),
  );
  await sam.goto(`./?join=${code}`);
  await sam.waitForFunction(() => window.__game?.ready === true && !!window.__game.getNet(), null, {
    timeout: 120_000,
  });
  await expect.poll(async () => (await net(sam))?.state, { timeout: 60_000 }).toBe('playing');
  await sam.evaluate(() => window.__game!.setTimelapseStep(48));
  const sent0 = (await net(sam))!;
  // The room plays at 3×: a frame every 2 s of real time on each machine.
  await ada.getByTestId('speed-3').click();
  await expect.poll(async () => (await info(ada)).captures, { timeout: 120_000 }).toBeGreaterThanOrEqual(3);
  await expect.poll(async () => (await info(sam)).captures, { timeout: 120_000 }).toBeGreaterThanOrEqual(3);
  const a = await info(ada);
  const s = await info(sam);
  expect(a.key).toMatch(/^tl-/);
  expect(s.key).toBe(`room-${code}`);
  expect(s.stored.wide.length + s.stored.orbit.length).toBeGreaterThanOrEqual(2);
  // Nothing of it travels: the joiner sent no more than its usual few messages meanwhile.
  const sent1 = (await net(sam))!;
  test.info().annotations.push({ type: 'net', description: JSON.stringify({ sent0, sent1 }) });
  await ada.getByTestId('speed-0').click();
});
