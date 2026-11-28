import { expect, test, type Browser, type Page } from '@playwright/test';
import { closeContextsAfterEach, newContext, watchErrors } from './helpers';
import { frames, state } from './ui';

closeContextsAfterEach();

/**
 * M44, the weekly challenge, through the interface against the local relay's board. The owner pins a
 * short version of this week's challenge (six months, on a map known to have room east of the
 * highway). Two players open it from the main menu; the first makes a group and the second joins it;
 * each lays roads and zones with the mouse and places power and water from the toolbar, plays the
 * months out (game time fast-forwarded through the test API: no command), and posts a score from the
 * end card. The board shows both (each checked by a replay), so does the group's board; the first
 * watches the second's run to its end, and it replays to the same city. A forged score (a real run
 * with the wrong hash) goes up and comes off once a page checks it. Then the week rolls over at
 * Monday 00:00 in Adelaide: the screen shows the next week's challenge, and last week's results stay.
 */
const RELAY = 'http://127.0.0.1:8787';
const KEY = 'e2e-owner-key-0123456789';
const owner = (path: string, body?: unknown) =>
  fetch(`${RELAY}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${KEY}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then((r) => r.json() as Promise<Record<string, unknown>>);

interface Row {
  id: number;
  rank: number;
  name: string;
  score: number;
  checked: boolean;
  run: boolean;
}
const board = (week: number, group?: string) =>
  fetch(`${RELAY}/challenge/board?week=${week}${group ? `&group=${group}` : ''}`).then(
    (r) => r.json() as Promise<{ total: number; rows: Row[] }>,
  );

let week = 0;

async function player(browser: Browser): Promise<Page> {
  const ctx = await newContext(browser, { viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
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
      }),
    );
  });
  return ctx.newPage();
}

const ready = (page: Page, mode: 'menu' | 'play') =>
  page.waitForFunction((m) => window.__game?.ready === true && window.__game.getShell().mode === m, mode, {
    timeout: 120_000,
  });

async function at(page: Page, x: number, z: number) {
  const p = await page.evaluate(([x, z]) => window.__game!.worldToScreen(x!, z!), [x, z]);
  const hit = await page.evaluate(([sx, sy]) => document.elementFromPoint(sx!, sy!)?.id ?? '', [p.x, p.y]);
  expect(hit, `(${x}, ${z}) is under the interface`).toBe('scene');
  return p;
}

/** Drag through ground points: a road, or a zone brush's stroke. */
async function drag(page: Page, points: [number, number][]): Promise<void> {
  let p = await at(page, points[0]![0], points[0]![1]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (const [x, z] of points.slice(1)) {
    p = await at(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 6 });
  }
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** A building from the toolbar, at the first spot beside a road that takes it. */
async function place(page: Page, category: string, def: string, spots: [number, number][]): Promise<void> {
  const before = (await state(page)).civics;
  await page.getByTestId(`tool-${category}`).click();
  await page.getByTestId(`place-${def}`).click();
  for (const [x, z] of spots) {
    const p = await at(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForTimeout(150);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(250);
    if ((await state(page)).civics > before) break;
  }
  expect((await state(page)).civics, `a ${def} placed`).toBeGreaterThan(before);
  await page.getByTestId('tool-select').click();
}

/**
 * From the main menu to the end card of this week's challenge: the challenge screen (and a group: made,
 * or joined by code), Play, the brief, a town laid with the mouse, the months played out.
 */
async function playChallenge(page: Page, group: { make: true } | { join: string }, layout: number[]) {
  await page.goto('./');
  await ready(page, 'menu');
  await expect(page.getByTestId('main-challenge-line')).toContainText('Six-month town');
  await page.getByTestId('main-challenge').click();
  await expect(page.getByTestId('challenge-name')).toContainText('Six-month town');
  await expect(page.getByTestId('challenge-twist')).toContainText('No twist');
  await page.getByTestId('board-tab-friends').click();
  let code = '';
  if ('make' in group) {
    await page.getByTestId('group-make').click();
    code = (await page.getByTestId('group-made').locator('strong').textContent())!.trim();
  } else {
    await page.getByTestId('group-code').fill(group.join.toLowerCase());
    await page.getByTestId('group-join').click();
    await expect(page.getByTestId(`group-${group.join}`)).toHaveClass(/active/);
    code = group.join;
  }
  await page.getByTestId('challenge-play').click();
  await ready(page, 'play');
  await expect(page.getByTestId('scenario-brief')).toContainText('Six-month town');
  await page.getByTestId('scenario-begin').click();
  await page.evaluate(() => window.__game!.setSpeed(0));
  const s = await state(page);
  const hx = s.highwayX;
  const hz = s.highwayZ;
  expect(s.options.challenge?.week).toBe(week);
  await page.evaluate(
    ([x, z]) => window.__game!.setCamera({ x: x! + 200, z: z!, distance: 700, yaw: 0, tilt: 0.55 }),
    [hx, hz],
  );
  await frames(page);
  // Roads: a street off the highway's end, then cross streets.
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-street').click();
  await drag(page, [
    [hx, hz],
    [hx + 190, hz],
    [hx + 380, hz],
  ]);
  for (const x of layout)
    await drag(page, [
      [hx + x, hz - 150],
      [hx + x, hz],
      [hx + x, hz + 150],
    ]);
  await page.getByTestId('tool-select').click();
  expect((await state(page)).segments).toBeGreaterThanOrEqual(s.segments + 4);
  // Zones, brushed along the street.
  await page.getByTestId('tool-zone').click();
  for (const [zone, dz] of [
    ['R', -70],
    ['C', 25],
    ['I', 90],
  ] as const) {
    await page.getByTestId(`zone-${zone}`).click();
    await drag(page, [
      [hx + 30, hz + dz],
      [hx + 200, hz + dz],
      [hx + 360, hz + dz],
    ]);
  }
  await page.getByTestId('tool-select').click();
  const z = (await state(page)).zoned;
  expect(z.R > 0 && z.C > 0 && z.I > 0, JSON.stringify(z)).toBe(true);
  await place(page, 'power', 'coal', [
    [hx + 200, hz + 160],
    [hx + 300, hz + 160],
    [hx + 120, hz + 160],
  ]);
  await place(page, 'water', 'pump', [
    [hx + 200, hz - 160],
    [hx + 300, hz - 160],
    [hx + 120, hz - 160],
  ]);
  await place(page, 'water', 'septic', [
    [hx + 400, hz],
    [hx + 100, hz - 165],
    [hx + 300, hz - 165],
    [hx + 100, hz + 165],
    [hx + 300, hz + 165],
    [hx + 400, hz + 30],
  ]);
  // Two months in, the town is growing.
  await page.evaluate(() => window.__game!.advance(1440 * 2));
  expect((await state(page)).population, 'the town grows').toBeGreaterThan(0);
  // The months, played out (game time only): the end card comes up as the last one closes.
  for (let m = 0; m < 9 && !(await page.getByTestId('challenge-end').isVisible()); m++)
    await page.evaluate(() => window.__game!.advance(1440));
  await expect(page.getByTestId('challenge-end')).toBeVisible();
  const score = Number((await page.getByTestId('challenge-score').textContent())!.replace(/\D/g, ''));
  return { code, score };
}

async function postScore(page: Page, name: string): Promise<string> {
  await page.getByTestId('challenge-name-input').fill(name);
  await page.getByTestId('challenge-post').click();
  await expect(page.getByTestId('challenge-post-result')).toContainText('On the board');
  return (await page.getByTestId('challenge-post-result').textContent())!;
}

test.describe.serial('M44 the weekly challenge', () => {
  test('plays it through the interface, posts, sees both boards and watches another run', async ({
    browser,
  }) => {
    test.setTimeout(900_000);
    // The owner's short version of this week's challenge.
    const o = await owner('/owner/challenge');
    week = o.now as number;
    const def = {
      ...(o.challenge as Record<string, unknown>),
      name: 'Six-month town',
      brief: 'A quick one for the tests. You have six months.',
      seed: 'cl13',
      preset: 'lakes',
      twist: 'none',
      months: 6,
      funds: 60_000,
    };
    expect(await owner('/owner/challenge/pin', { week, def })).toEqual({ ok: true });

    const a = await player(browser);
    const errors = watchErrors(a);
    const first = await playChallenge(a, { make: true }, [100, 200, 300]);
    test.info().annotations.push({ type: 'Ada', description: `score ${first.score}` });
    await postScore(a, 'Ada');
    await a.screenshot({ path: 'docs/screenshots/m44-posted.png' });

    const b = await player(browser);
    const second = await playChallenge(b, { join: first.code }, [120, 240, 340]);
    test.info().annotations.push({ type: 'Kit', description: `score ${second.score}` });
    await postScore(b, 'Kit');
    await b.context().close();

    // Everyone's board and the group's both have the two scores.
    const all = await board(week);
    expect(all.rows.map((r) => r.name).sort()).toEqual(['Ada', 'Kit']);
    expect((await board(week, first.code)).rows.map((r) => r.name).sort()).toEqual(['Ada', 'Kit']);

    // On the challenge screen: the board, each run checked by a replay; then the friends board.
    await a.goto('./?screen=challenge');
    await ready(a, 'menu');
    await expect(a.getByTestId('board-row')).toHaveCount(2);
    await expect(a.locator('.challenge-check:not(:empty)')).toHaveCount(2, { timeout: 180_000 });
    await a.screenshot({ path: 'docs/screenshots/m44-board.png' });
    await a.getByTestId('board-tab-friends').click();
    await expect(a.getByTestId('board-row')).toHaveCount(2);
    await expect(a.getByTestId('challenge-groups')).toContainText(first.code);
    await a.screenshot({ path: 'docs/screenshots/m44-friends.png' });
    expect((await board(week)).rows.every((r) => r.checked)).toBe(true);

    // Watching Kit's run, to its end: the same city.
    await a.getByTestId('board-tab-week').click();
    await a
      .getByTestId('board-row')
      .filter({ hasText: 'Kit' })
      .getByRole('button', { name: 'Watch' })
      .click();
    await ready(a, 'play');
    await expect(a.getByTestId('run-viewer')).toContainText('Kit');
    await expect(a.getByTestId('toolbar')).toHaveCount(0);
    await frames(a, 10);
    await a.screenshot({ path: 'docs/screenshots/m44-watch.png' });
    await a.getByTestId('run-rush').click();
    await expect(a.getByTestId('run-result')).toContainText('replayed to the same city', {
      timeout: 300_000,
    });
    await expect(a.getByTestId('challenge-end')).toHaveCount(0);
    await a.screenshot({ path: 'docs/screenshots/m44-watched.png' });
    errors.check();
  });

  test('a forged score with the wrong hash comes off the board', async ({ browser }) => {
    test.setTimeout(600_000);
    const rows = (await board(week)).rows;
    const kit = rows.find((r) => r.name === 'Kit')!;
    // A real run (Kit's) posted under another name with a higher score and a hash it never reached.
    const run = (await fetch(`${RELAY}/challenge/run?id=${kit.id}`).then((r) => r.json())) as { run: string };
    const forged = await fetch(`${RELAY}/challenge/score`, {
      method: 'POST',
      body: JSON.stringify({
        week,
        player: 'forger0000000001',
        name: 'Forger',
        score: Math.max(...rows.map((r) => r.score)) + 500,
        hash: 'deadbeef',
        end: 6 * 1440,
        entries: 40,
        run: run.run,
      }),
    }).then((r) => r.json() as Promise<{ ok?: boolean; id?: number; rank?: number }>);
    expect(forged).toMatchObject({ ok: true, rank: 1 });
    expect((await board(week)).rows[0]!.name).toBe('Forger');

    // A player opens the board: the page replays the run it hasn't checked, and it doesn't match.
    const page = await player(browser);
    await page.goto('./?screen=challenge');
    await ready(page, 'menu');
    await expect(page.getByTestId('board-rows')).toBeVisible();
    await expect(page.getByTestId('board-rows')).not.toContainText('Forger', { timeout: 300_000 });
    expect((await board(week)).rows.map((r) => r.name)).not.toContain('Forger');
    // The owner still sees it, dropped, and could put it back.
    const entries = (await owner(`/owner/challenge?week=${week}`)).entries as {
      name: string;
      status: string;
    }[];
    expect(entries.find((e) => e.name === 'Forger')?.status).toBe('dropped');
  });

  test('rolls over to the next week on Monday in Adelaide, and keeps last week’s results', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const cur = (await fetch(`${RELAY}/challenge/current`).then((r) => r.json())) as {
      end: number;
      week: number;
    };
    expect(cur.week).toBe(week);
    // Monday 00:00 in Adelaide is the week's end: 20 seconds before it, on the board's clock and the page's.
    const before = cur.end - 20_000;
    await fetch(`${RELAY}/__clock`, { method: 'POST', body: JSON.stringify({ at: before }) });
    try {
      const page = await player(browser);
      await page.clock.setFixedTime(before);
      await page.goto('./?screen=challenge');
      await ready(page, 'menu');
      await expect(page.getByTestId('challenge-week')).toContainText(`Week ${week + 1}`);
      await expect(page.getByTestId('challenge-week')).toContainText('less than a minute left');
      await expect(page.getByTestId('challenge-name')).toContainText('Six-month town');
      // Monday: the board's clock and the page's go past it.
      await fetch(`${RELAY}/__clock`, { method: 'POST', body: JSON.stringify({ at: cur.end + 5_000 }) });
      await page.clock.setFixedTime(cur.end + 5_000);
      await page.waitForTimeout(6_000);
      await expect(page.getByTestId('challenge-week')).toContainText(`Week ${week + 2}`, { timeout: 30_000 });
      await expect(page.getByTestId('challenge-week')).toContainText('6 days 23 hours left');
      await expect(page.getByTestId('challenge-name')).not.toContainText('Six-month town');
      await expect(page.getByTestId('board-empty')).toBeVisible();
      // Last week's results stay: the board's top two, without the forged score.
      await expect(page.getByTestId('challenge-last')).toContainText('Last week’s winner');
      await page.getByTestId('board-tab-last').click();
      await expect(page.getByTestId('board-row')).toHaveCount(2);
      await expect(page.getByTestId('board-rows')).not.toContainText('Forger');
      await page.screenshot({ path: 'docs/screenshots/m44-rollover.png' });
      // And the main menu has the new week's challenge.
      await page.getByTestId('shell-back').click();
      await expect(page.getByTestId('main-challenge-line')).not.toContainText('Six-month town');
    } finally {
      await fetch(`${RELAY}/__clock`, { method: 'POST', body: JSON.stringify({ at: null }) });
    }
  });
});
