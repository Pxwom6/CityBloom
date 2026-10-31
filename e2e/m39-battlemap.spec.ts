import { expect, test, type Page } from '@playwright/test';
import type { BattleMapPoints } from '../src/client/testApi';
import { openGame, watchErrors } from './helpers';
import { settings } from './ui';
import { armTown, servedTown } from './war';

/**
 * M39 step 4: the battle map through the real UI, on the one-page stand-in (test API `stageLive`: the
 * region room's part is played in the page, a battle held still at a step so nothing waits on the clock).
 * Commanding as the attacker (choose by click, box and All; Focus a building; Hold and Free; the room's
 * stamp on each order; a hand-over and taking command again; withdrawing; the end), as the defender (the
 * city's own sim hosts the battle; units still mobilising can be ordered; Guard and Focus), watching two
 * other cities from the Region panel (read-only), and the phone-width sheet by touch.
 */
test.use({ hasTouch: true });

/** A serviced town with an HQ, barracks, a depot, a bunker and a shelter, and trained units. */
async function warTown(page: Page): Promise<void> {
  await servedTown(page);
  await armTown(page, ['militaryhq', 'barracks', 'vehicledepot', 'bunker', 'shelter'], {
    infantry: 4,
    vehicles: ['tank', 'transport', 'tank'],
  });
}

const map = (page: Page) => page.evaluate(() => window.__game!.battleMap());

/**
 * The map's points as they are once `ready` holds. The picture is laid out (its size measured, the battle's
 * layout drawn) a moment after the panel opens or the battle's first frames arrive, and a point is "visible"
 * only inside a measured picture: points read before that hold no building to click, so every read that
 * feeds a click or a count waits for what it needs rather than hoping it is there.
 */
async function pointsWhen(
  page: Page,
  what: string,
  ready: (p: BattleMapPoints) => boolean,
): Promise<BattleMapPoints> {
  let last: BattleMapPoints | null = null;
  await expect
    .poll(
      async () => {
        last = await page.evaluate(() => window.__game!.battleMapPoints());
        return last !== null && ready(last);
      },
      { message: `the map shows ${what}`, timeout: 60_000, intervals: [250] },
    )
    .toBe(true);
  return last!;
}

/** A building that still stands and is on the picture (the battle's target if it has one on show). */
const standing = (p: BattleMapPoints) => p.structs.some((s) => s.visible && s.state !== 2);
/** The same, picked: an objective first. */
const pickStanding = (p: BattleMapPoints) =>
  p.structs.find((s) => s.objective && s.visible && s.state !== 2) ??
  p.structs.find((s) => s.visible && s.state !== 2)!;

async function stage(
  page: Page,
  role: 'attacker' | 'defender' | 'watcher',
  hold: number,
  units?: ('tank' | 'infantry' | 'helicopter')[],
) {
  const why = await page.evaluate(
    ([r, h, u]) => window.__game!.stageLive(r, { hold: h, ...(u ? { units: u } : {}) }),
    [role, hold, units] as const,
  );
  expect(why, `stageLive ${role}`).toBeNull();
}

/** The battle has run to (about) a step: a battle held at a step is there within a few seconds. */
async function reach(page: Page, step: number) {
  await expect
    .poll(async () => (await map(page)).step, { timeout: 180_000, intervals: [500] })
    .toBeGreaterThanOrEqual(step);
}

/** The buildings still standing within `r` pixels of a point (where a click there may have landed). */
function standingNear(
  pts: { structs: { k: number; x: number; y: number; state: number }[] },
  at: { x: number; y: number },
  r: number,
): number[] {
  return pts.structs.filter((s) => s.state !== 2 && Math.hypot(s.x - at.x, s.y - at.y) <= r).map((s) => s.k);
}

/** The newest order in the map's list has the room's stamp on it. */
async function stamped(page: Page, kind: string) {
  await expect
    .poll(async () => (await map(page)).log.at(-1), { timeout: 60_000, intervals: [300] })
    .toMatchObject({ kind, state: 'stamped' });
  return (await map(page)).log.at(-1)!;
}

/** Buttons in `scope` that are off the window or covered where a finger would tap them (as m33-narrow). */
async function unreachable(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((scope) => {
    const bad: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const b of document.querySelectorAll<HTMLElement>(`[data-testid="${scope}"] button`)) {
      const r = b.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const name = b.dataset.testid ?? b.getAttribute('aria-label') ?? (b.textContent ?? '').trim();
      const at = `${Math.round(r.left)}..${Math.round(r.right)} x ${Math.round(r.top)}..${Math.round(r.bottom)}`;
      if (r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh) {
        bad.push(`${name} is outside the ${vw}x${vh} window (${at})`);
        continue;
      }
      if (r.height < 24 || r.width < 24)
        bad.push(`${name} is only ${Math.round(r.width)}x${Math.round(r.height)} px to tap`);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === b || b.contains(hit))) bad.push(`${name} is covered by ${hit?.tagName} (${at})`);
    }
    return bad;
  }, scope);
}

test('M39: commanding a live battle on the map: choose, focus, hold and free, the room’s stamp, a hand-over, withdrawing, the end', async ({
  page,
}) => {
  test.setTimeout(1_500_000);
  const errs = watchErrors(page);
  await settings(page, { quality: 'low' });
  await openGame(page, '&rivals=1&seed=port&preset=coast');
  await warTown(page);
  // A battle with a friend, held still at step 140 (the stand-in plays the room).
  await stage(page, 'attacker', 140);
  await expect(page.getByTestId('live-bar')).toBeVisible();
  // O opens the map, O again closes it, and the bar's Command opens it.
  await page.keyboard.press('KeyO');
  await expect(page.getByTestId('battle-map')).toBeVisible();
  expect(await map(page)).toMatchObject({ open: true, role: 'attacker', side: 0 });
  await expect(page.getByTestId('map-title')).toContainText('Samford');
  await page.keyboard.press('KeyO');
  await expect(page.getByTestId('battle-map')).toBeHidden();
  await page.getByTestId('live-command').click();
  await expect(page.getByTestId('battle-map')).toBeVisible();
  await reach(page, 138);
  // The page is held at the room's frontier: the status says so, after a moment.
  await expect(page.getByTestId('map-waiting')).toContainText('Samford');
  await expect(page.getByTestId('map-clock')).toContainText('of 12:00');
  const m0 = await map(page);
  expect(m0.units.own).toBeGreaterThan(3);
  expect(m0.units.enemy).toBeGreaterThanOrEqual(0);
  expect(m0.structs.total).toBeGreaterThan(20);

  // --- Choosing: All and None, a click, and a dragged box. With nothing chosen, no orders. ---
  await expect(page.getByTestId('map-order-hold')).toBeDisabled();
  await page.getByTestId('map-select-all').click();
  await expect(page.getByTestId('map-selected')).toContainText('All');
  expect((await map(page)).selected.length).toBe(m0.units.own);
  await expect(page.getByTestId('map-order-hold')).toBeEnabled();
  await page.getByTestId('map-select-none').click();
  expect((await map(page)).selected).toEqual([]);
  let pts = await pointsWhen(
    page,
    'units of its own and a building',
    (p) => p.own.some((u) => u.visible) && standing(p),
  );
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const alone = pts.own.filter((u) => u.visible && pts.own.every((o) => o.id === u.id || near(o, u) > 3));
  expect(alone.length).toBeGreaterThan(1);
  await page.mouse.click(alone[0]!.x, alone[0]!.y);
  expect((await map(page)).selected).toEqual([alone[0]!.id]);
  // Shift adds another.
  await page.keyboard.down('Shift');
  await page.mouse.click(alone[1]!.x, alone[1]!.y);
  await page.keyboard.up('Shift');
  expect((await map(page)).selected.sort()).toEqual([alone[0]!.id, alone[1]!.id].sort());
  // A box nearly from corner to corner of the picture (inside its rounded corners) chooses every unit in it.
  const c = pts.canvas;
  const edge = 8;
  const inside = pts.own.filter(
    (u) => u.x >= c.x + edge && u.x <= c.x + c.w - edge && u.y >= c.y + edge && u.y <= c.y + c.h - edge,
  );
  await page.mouse.move(c.x + edge, c.y + edge);
  await page.mouse.down();
  await page.mouse.move(c.x + c.w - edge, c.y + c.h - edge, { steps: 8 });
  await page.mouse.up();
  const boxed = (await map(page)).selected;
  expect(inside.length).toBeGreaterThan(3);
  expect(boxed.sort()).toEqual(inside.map((u) => u.id).sort());
  // Empty ground clears the choice.
  await page.mouse.click(c.x + 4, c.y + c.h - 4);
  expect((await map(page)).selected).toEqual([]);

  // --- Focus: armed, a click on empty ground is not an order, Escape lets go, a building is. ---
  await page.getByTestId('map-select-all').click();
  await page.getByTestId('map-order-focus').click();
  expect((await map(page)).armed).toBe('focus');
  await expect(page.getByTestId('map-hint')).toContainText('click a building');
  await page.mouse.click(c.x + 4, c.y + c.h - 4);
  expect(await map(page)).toMatchObject({ armed: 'focus', note: 'Click a building that still stands' });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('battle-map')).toBeVisible();
  expect(await map(page)).toMatchObject({ armed: null });
  expect((await map(page)).selected.length).toBeGreaterThan(0);
  await page.getByTestId('map-order-focus').click();
  pts = await pointsWhen(page, 'a building that still stands', standing);
  const goal = pickStanding(pts);
  await page.mouse.click(goal.x, goal.y);
  const focus = await stamped(page, 'focus');
  expect(focus.units).toBe('all');
  expect(standingNear(pts, goal, 6)).toContain(focus.target);
  expect(focus.seq).toBeGreaterThan(0);
  expect(focus.step).toBeGreaterThanOrEqual(138);
  expect((await map(page)).armed).toBeNull();
  await expect(page.getByTestId(`map-log-${focus.n}`)).toContainText('heard');

  // --- Hold some, free them: each is stamped, in order. ---
  await page.mouse.click(alone[0]!.x, alone[0]!.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(alone[1]!.x, alone[1]!.y);
  await page.keyboard.up('Shift');
  await page.getByTestId('map-order-hold').click();
  const hold = await stamped(page, 'hold');
  expect(hold.units).toBe(2);
  await page.getByTestId('map-order-free').click();
  const free = await stamped(page, 'free');
  expect(free.seq!).toBeGreaterThan(hold.seq!);
  expect((await map(page)).stamped).toBe(3);

  // --- Zoom: in on the chosen, out again, the whole battle in one press. ---
  await page.getByTestId('map-zoom-in').click();
  expect((await map(page)).zoom).toBeGreaterThan(1);
  await page.getByTestId('map-zoom-fit').click();
  expect(await map(page)).toMatchObject({ zoom: 1, centre: null });

  // --- Handed over: the forces fight on their own until the player takes command again. ---
  expect(await page.evaluate(() => window.__game!.liveHandOver(1))).toBe(true);
  await expect(page.getByTestId('map-handed')).toBeVisible();
  await expect(page.getByTestId('map-order-hold')).toBeDisabled();
  expect((await map(page)).handed).toBe(true);
  await page.getByTestId('map-rejoin').click();
  await expect(page.getByTestId('map-handed')).toBeHidden();
  expect((await map(page)).handed).toBe(false);

  // --- Withdraw everyone, let the battle go on: it ends, and both runs agree. ---
  // (The room takes four orders a side at a step, and the held battle has used them all at step 140.)
  await page.evaluate(() => window.__game!.liveRelease());
  await expect.poll(async () => (await map(page)).allow, { timeout: 60_000 }).toBeGreaterThan(150);
  await page.getByTestId('map-select-all').click();
  await page.getByTestId('map-order-withdraw').click();
  const out = await stamped(page, 'withdraw');
  expect(out.units).toBe('all');
  await expect(page.getByTestId('map-over')).toBeVisible({ timeout: 300_000 });
  await expect(page.getByTestId('map-order-hold')).toBeDisabled();
  const end = await page.evaluate(() => window.__game!.getLive());
  expect(end!.ended).toBe(true);
  expect(end!.hashes.room).toMatchObject({ agree: true });
  expect(end!.hashes.mine).toMatchObject({ hash: end!.hashes.room!.hash });
  errs.check();
});

test('M39: as the defender the city’s own sim hosts the battle; a friend’s battle is watched from the Region panel', async ({
  page,
}) => {
  test.setTimeout(1_500_000);
  const errs = watchErrors(page);
  await settings(page, { quality: 'low' });
  await openGame(page, '&rivals=1&seed=port&preset=coast');
  await warTown(page);

  // --- The defender: the battle bar's Command opens the map over the city. ---
  // A small force: the town's few defenders last long enough to be ordered.
  await stage(page, 'defender', 130, ['tank', 'tank', 'infantry', 'infantry', 'infantry', 'helicopter']);
  await expect(page.getByTestId('battle-bar')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('battle-command').click();
  await expect(page.getByTestId('battle-map')).toHaveAttribute('data-role', 'defender');
  await expect(page.getByTestId('map-title')).toContainText('against');
  await reach(page, 128);
  // The city's sim is running the very battle the map draws.
  const hosted = await page.evaluate(() => window.__game!.getBattle().frame);
  expect(hosted).not.toBeNull();
  expect(Math.abs(hosted!.step - (await map(page)).step)).toBeLessThan(40);
  // The defenders are still mobilising at their bases: they are on the map, and can be ordered.
  let pts = await pointsWhen(page, 'the defenders', (p) => p.own.length > 0);
  await page.getByTestId('map-select-all').click();
  expect((await map(page)).selected.length).toBe(pts.own.length);
  // Guard a building: the click on it is the order.
  await page.getByTestId('map-order-guard').click();
  expect((await map(page)).armed).toBe('guard');
  // (Read now, not before: the picture may have been laid out since, and the choice is of what stands.)
  pts = await pointsWhen(page, 'a building that still stands', standing);
  const hq = pickStanding(pts);
  await page.mouse.click(hq.x, hq.y);
  const guard = await stamped(page, 'guard');
  expect(guard.units).toBe('all');
  expect(standingNear(pts, hq, 6)).toContain(guard.target);
  // Focus is on an attacker: a click on a building is not one.
  await page.getByTestId('map-order-focus').click();
  await expect(page.getByTestId('map-hint')).toContainText('click an attacker');
  await page.mouse.click(hq.x, hq.y);
  expect((await map(page)).note).toBe('Click an attacker');
  pts = await pointsWhen(page, 'an attacker', (p) => p.enemy.some((u) => u.visible));
  const raider = pts.enemy.find((u) => u.visible)!;
  await page.mouse.click(raider.x, raider.y);
  expect(await stamped(page, 'focus')).toMatchObject({ target: raider.id });
  // The other player gives up: the battle ends, in the city's report.
  await page.evaluate(() => {
    const g = window.__game!;
    g.liveSay(0, { kind: 'withdraw' });
    g.liveRelease();
  });
  await expect(page.getByTestId('map-over')).toBeVisible({ timeout: 300_000 });
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getBattle())).reports.length, {
      timeout: 120_000,
    })
    .toBeGreaterThan(0);
  await page.getByTestId('map-close').click();
  await expect(page.getByTestId('battle-map')).toBeHidden();
  await page.evaluate(() => window.__game!.advance(120));

  // --- A spectator: two other cities fight; the live bar and the Region panel offer a seat. ---
  await stage(page, 'watcher', 200);
  await expect(page.getByTestId('live-spectacle')).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Shift+KeyN');
  await expect(page.getByTestId('region-panel')).toBeVisible();
  await page.getByTestId('watch-live-2').click();
  await expect(page.getByTestId('battle-map')).toHaveAttribute('data-role', 'watcher', { timeout: 60_000 });
  await expect(page.getByTestId('map-readonly')).toBeVisible();
  // Nothing to order or choose: it is read-only.
  await expect(page.getByTestId('map-order-hold')).toHaveCount(0);
  await expect(page.getByTestId('map-select-all')).toHaveCount(0);
  await reach(page, 198);
  expect(await map(page)).toMatchObject({ role: 'watcher', side: null, selected: [] });
  // The players' orders show in the watcher's battle.
  await pointsWhen(page, 'units of the two sides', (p) => p.own.length + p.enemy.length > 0);
  expect(await page.evaluate(() => window.__game!.liveSay(0, { kind: 'hold' }))).toBe(true);
  await expect(page.getByTestId('map-detail')).toContainText('1 order');
  await page.evaluate(() => {
    const g = window.__game!;
    g.liveSay(0, { kind: 'withdraw' });
    g.liveRelease();
  });
  await expect(page.getByTestId('map-over')).toBeVisible({ timeout: 300_000 });
  // Closing the map stops watching.
  await page.getByTestId('map-close').click();
  expect((await map(page)).watching).toBeNull();
  await expect.poll(() => page.evaluate(() => window.__game!.getLiveRunning().length)).toBe(0);
  errs.check();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('M39: the battle map is a sheet across the width, and works by touch', async ({ page }) => {
    test.setTimeout(1_500_000);
    const errs = watchErrors(page);
    await settings(page, { quality: 'low' });
    await openGame(page, '&rivals=1&seed=port&preset=coast');
    await warTown(page);
    await stage(page, 'attacker', 140);
    await expect(page.getByTestId('live-bar')).toBeVisible();
    await page.getByTestId('live-command').tap();
    const sheet = page.getByTestId('battle-map');
    await expect(sheet).toBeVisible();
    // Across the width and nothing off its sides; every button can be tapped.
    const box = (await sheet.boundingBox())!;
    expect(box.x).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(388);
    await reach(page, 138);
    // (A notice toast over the sheet's corner would cover a button for a few seconds.)
    await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 30_000 });
    expect(await unreachable(page, 'battle-map')).toEqual([]);
    const m0 = await map(page);
    expect(m0.canvas.w).toBeGreaterThan(300);
    expect(m0.canvas.h).toBeGreaterThan(150);

    // Taps choose: All, then a unit toggles off; None; two taps choose two.
    await page.getByTestId('map-select-all').tap();
    expect((await map(page)).selected.length).toBe(m0.units.own);
    let pts = await pointsWhen(
      page,
      'units of its own and a building',
      (p) => p.own.some((u) => u.visible) && standing(p),
    );
    const lone = pts.own.filter(
      (u) => u.visible && pts.own.every((o) => o.id === u.id || Math.hypot(o.x - u.x, o.y - u.y) > 3),
    );
    expect(lone.length).toBeGreaterThan(1);
    await page.touchscreen.tap(lone[0]!.x, lone[0]!.y);
    expect((await map(page)).selected.length).toBe(m0.units.own - 1);
    await page.getByTestId('map-select-none').tap();
    await page.touchscreen.tap(lone[0]!.x, lone[0]!.y);
    await page.touchscreen.tap(lone[1]!.x, lone[1]!.y);
    expect((await map(page)).selected.sort()).toEqual([lone[0]!.id, lone[1]!.id].sort());
    // Hold by tap: sent and heard.
    await page.getByTestId('map-order-hold').tap();
    expect(await stamped(page, 'hold')).toMatchObject({ units: 2 });
    // Focus by tap, a tap on a building as the target.
    await page.getByTestId('map-select-all').tap();
    await page.getByTestId('map-order-focus').tap();
    expect((await map(page)).armed).toBe('focus');
    pts = await pointsWhen(page, 'a building that still stands', standing);
    const goal = pickStanding(pts);
    await page.touchscreen.tap(goal.x, goal.y);
    // The finger lands on whichever standing building is nearest (guns first, where marks overlap).
    expect(standingNear(pts, goal, 14)).toContain((await stamped(page, 'focus')).target);

    // Zoom in, then a finger drags the picture to look elsewhere (it doesn't choose or order anything).
    await page.getByTestId('map-zoom-in').tap();
    await page.getByTestId('map-zoom-in').tap();
    const z = await map(page);
    expect(z.zoom).toBeGreaterThan(2);
    const before = z.selected.length;
    const log = z.log.length;
    const cdp = await page.context().newCDPSession(page);
    const at = { x: z.canvas.w / 2, y: z.canvas.h / 2 };
    const r = (await page.getByTestId('map-canvas').boundingBox())!;
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
      });
    await send('touchStart', r.x + at.x, r.y + at.y);
    for (let k = 1; k <= 6; k++) await send('touchMove', r.x + at.x - 12 * k, r.y + at.y + 6 * k);
    await send('touchEnd', 0, 0);
    await expect.poll(async () => (await map(page)).centre).not.toBeNull();
    const after = await map(page);
    expect(after.selected.length).toBe(before);
    expect(after.log.length).toBe(log);
    await page.getByTestId('map-zoom-fit').tap();
    expect((await map(page)).zoom).toBe(1);

    // End it: withdraw everyone, and it is over.
    await page.getByTestId('map-select-all').tap();
    await page.getByTestId('map-order-withdraw').tap();
    await stamped(page, 'withdraw');
    await page.evaluate(() => window.__game!.liveRelease());
    await expect(page.getByTestId('map-over')).toBeVisible({ timeout: 300_000 });
    errs.check();
  });
});
