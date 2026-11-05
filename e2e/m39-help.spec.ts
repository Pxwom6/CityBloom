import { expect, test, type Page } from '@playwright/test';
import { UNIT } from '../src/data/war';
import { openGame, shot, watchErrors } from './helpers';
import { settings } from './ui';
import { armTown, servedTown } from './war';

/**
 * M39 step 6 (review): allies sending help into a friend's live battle, through the real page on the
 * one-page stand-in (test API `stageLive`: the region room's part is played in the page, the battle held
 * still at a step). The button is offered exactly where the pacts allow (an alliance with a combatant, a
 * defensive pact only with the one attacked, nothing with no pact or pacts on both sides), the picker offers
 * only the units at home that may go (land and air, no superweapons) and never more than a force takes,
 * Send puts the force on its way, and the war room tells how it is getting on (it is no raid: nothing to
 * call back, no front drawn toward the friend it helps).
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

/**
 * The region as this city's sim mirrors it (the stand-in has no room): friends by place, and the pacts the
 * room keeps with them. The staged battle is Samford (slot 2) against Riverton (slot 4); this city is 3.
 */
let roomNumber = 0;
async function mirror(
  page: Page,
  friends: { slot: number; name: string }[],
  pacts: { slot: number; kind: string }[],
): Promise<void> {
  // (The sim keeps a pact by the region's number for it and skips one it has: each pact stated here is a
  // new one, as the room would number a pact signed after another was ended.)
  const numbered = pacts.map((p) => ({ ...p, room: ++roomNumber }));
  const out = await page.evaluate(
    async ([friends, pacts]) => {
      const g = window.__game!;
      const none = { power: 0, water: 0, garbage: 0 };
      const a = await g.dispatch({
        type: 'regionUpdate',
        update: {
          cities: friends.map((f) => ({
            slot: f.slot,
            name: f.name,
            mayor: f.name,
            color: f.slot,
            population: 4_000,
            kind: 'suburb' as const,
            offers: { buy: { ...none }, sell: { ...none } },
            workers: 0,
            jobs: 0,
            shoppers: 0,
            online: true,
            raid: 'open' as const,
          })),
          contracts: [],
          project: null,
          rules: { war: true, scale: 'skirmish' as const },
        },
      });
      const b = await g.dispatch({
        type: 'friendPacts',
        me: 3,
        pacts: pacts.map((p) => ({ room: p.room, slot: p.slot, kind: p.kind as never })),
        vassals: [],
      });
      return [a.ok ? 'ok' : a.reason, b.ok ? 'ok' : b.reason];
    },
    [friends, numbered] as const,
  );
  expect(out).toEqual(['ok', 'ok']);
}

const FRIENDS = [
  { slot: 2, name: 'Samford' },
  { slot: 4, name: 'Riverton' },
];

/** The "Send help" buttons on show (in the invitation to watch the battle). */
const helpButtons = (page: Page) => page.locator('[data-testid^="help-stage"]');

/** The invitation is up (so a missing button is a button left out, not a bar not drawn yet), with no help button. */
async function noHelpOffered(page: Page): Promise<void> {
  await expect(page.getByTestId('live-watch')).toBeVisible();
  // (The bar redraws twice a second: give it time to take the pacts just mirrored.)
  await page.evaluate(() => window.__game!.waitFrames(12));
  await page.waitForTimeout(1_200);
  await expect(helpButtons(page)).toHaveCount(0);
}

test('M39 step 6: Send help is offered where the pacts allow, the picker holds the units that may go, and the force is on its way', async ({
  page,
}) => {
  test.setTimeout(1_500_000);
  const errs = watchErrors(page);
  await settings(page, { quality: 'low' });
  await openGame(page, '&rivals=1&seed=port&preset=coast');
  await warTown(page);
  // Samford (the attacker) and Riverton are fighting a live battle, held at step 120; a force sent in
  // arrives 64 steps (4 s) on, on the attacker's side (the stand-in plays the room that puts it there).
  const why = await page.evaluate(() =>
    window.__game!.stageLive('watcher', {
      hold: 120,
      units: ['tank', 'tank', 'infantry', 'infantry', 'infantry', 'helicopter'],
      helpSide: 0,
      helpTravel: 64,
    }),
  );
  expect(why, 'stageLive').toBeNull();
  // (The milestone card the town's growth brought is not what these shots are about.)
  const banner = page.getByTestId('milestone-banner');
  if (await banner.isVisible().catch(() => false)) await banner.click();
  await expect(banner).toBeHidden();
  await expect(page.getByTestId('live-spectacle')).toBeVisible({ timeout: 60_000 });

  // --- The button is there only where the pacts allow it. ---
  // No pact with either: no button, but the battle can still be watched.
  await mirror(page, FRIENDS, []);
  await noHelpOffered(page);
  // A defensive pact with the attacker (Samford) is for a friend who is attacked: no.
  await mirror(page, FRIENDS, [{ slot: 2, kind: 'defensivePact' }]);
  await noHelpOffered(page);
  // Pacts on both sides: it can't take sides.
  await mirror(page, FRIENDS, [
    { slot: 2, kind: 'alliance' },
    { slot: 4, kind: 'alliance' },
  ]);
  await noHelpOffered(page);
  // A pact with the other combatant that binds (non-aggression with Riverton) stands in the way of
  // helping Samford: it would break it.
  await mirror(page, FRIENDS, [
    { slot: 2, kind: 'alliance' },
    { slot: 4, kind: 'nonAggression' },
  ]);
  await noHelpOffered(page);
  // A defensive pact with the one attacked (Riverton, the defender): the button, for Riverton.
  await mirror(page, FRIENDS, [{ slot: 4, kind: 'defensivePact' }]);
  await expect(helpButtons(page)).toHaveCount(1);
  await expect(helpButtons(page)).toHaveText('Send help to Riverton');
  // An alliance with Samford (the attacker) alone: the button, for Samford.
  await mirror(page, FRIENDS, [{ slot: 2, kind: 'alliance' }]);
  await expect(helpButtons(page)).toHaveCount(1);
  await expect(helpButtons(page)).toHaveText('Send help to Samford');
  await page.evaluate(() => window.__game!.waitFrames(2));
  await shot(page, 'm39-help-1-bar');

  // --- The picker: the units at home that may go, never more than a force takes. ---
  await helpButtons(page).click();
  await expect(page.getByTestId('help-picker')).toBeVisible();
  const forces = (await page.evaluate(() => window.__game!.getForces()))!;
  const mayGo = (kind: string) => {
    const d = UNIT.get(kind as never);
    return !!d && !d.super && (d.domain === 'land' || d.domain === 'air');
  };
  const home = forces.units.filter((u) => mayGo(u.kind));
  expect(home.length).toBeGreaterThanOrEqual(5);
  const boxes = page.locator('input[data-testid^="help-"]');
  const kinds = (
    await boxes.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).dataset.testid!.slice(5)))
  ).sort();
  expect(kinds).toEqual([...new Set(home.map((u) => u.kind))].sort());
  for (const k of kinds)
    await expect(page.getByTestId(`help-${k}`)).toHaveAttribute(
      'max',
      String(home.filter((u) => u.kind === k).length),
    );
  // Asking for more than a force takes is held to what it takes (24), and the button reads what is sent.
  await expect(page.getByTestId('help-send')).toBeDisabled();
  await page.getByTestId('help-infantry').fill('2');
  await page.getByTestId('help-tank').fill('1');
  await expect(page.getByTestId('help-count')).toContainText('3 of at most 24 units');
  await expect(page.getByTestId('help-send')).toHaveText('Send 3 units');
  await shot(page, 'm39-help-2-picker');

  // --- Send: the force is on its way, and the war room says so (it is no raid). ---
  await page.getByTestId('help-send').click();
  await expect
    .poll(() => page.evaluate(() => window.__game!.getHelp()?.state), { timeout: 60_000 })
    .toBe('on');
  expect(await page.evaluate(() => window.__game!.getHelp())).toMatchObject({
    side: 0,
    units: 3,
    lost: null,
  });
  await page.keyboard.press('Shift+KeyM');
  await page.getByTestId('war-tab-send').click();
  const exp = page.locator('[data-testid^="expedition-"]');
  await expect(exp).toHaveCount(1);
  await expect(exp).toContainText('3 units on the way to help Samford');
  await expect(exp).not.toContainText('fought in');
  await expect(exp).not.toContainText('waiting for the region');
  // Nothing to call back: the units are in a battle that is not theirs to leave.
  await expect(page.locator('[data-testid^="recall-"]')).toHaveCount(0);
  await page.keyboard.press('Shift+KeyM');
  await expect(page.getByTestId('war-room')).toBeHidden();

  // --- It arrives and fights, and the battle ends: the force's line says how it came out. ---
  // (Back to the battle the force is in: the war room took the map's place, and the page followed the
  // battle out of sight meanwhile; the invitation to watch it is there again.)
  await page.getByTestId('live-watch').click();
  await expect(page.getByTestId('battle-map')).toBeVisible();
  await page.evaluate(() => window.__game!.liveRelease(204));
  await expect
    .poll(() => page.evaluate(() => window.__game!.battleMap()?.step ?? 0), {
      timeout: 240_000,
      intervals: [500],
    })
    .toBeGreaterThanOrEqual(200);
  await page.evaluate(() => window.__game!.waitFrames(2));
  await shot(page, 'm39-help-3-arrived');
  await page.evaluate(() => window.__game!.liveRelease());
  await expect
    .poll(() => page.evaluate(() => window.__game!.battleMap()?.over ?? false), {
      timeout: 600_000,
      intervals: [1_000],
    })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__game!.getHelp()?.state), { timeout: 120_000, intervals: [500] })
    .toBe('done');
  const done = (await page.evaluate(() => window.__game!.getHelp()))!;
  // (However it came out, it is said as it was: no "unharmed" for a force that came through hurt.)
  const status = page.getByTestId('help-status');
  await expect(status).toBeVisible();
  if (done.lost) await expect(status).toContainText('knocked out');
  else if (done.hurt) await expect(status).toContainText('repairs');
  else await expect(status).toContainText('unharmed');
  if (done.hurt || done.lost) await expect(status).not.toContainText('unharmed');
  await page.getByTestId('battle-map').screenshot({ path: 'docs/screenshots/m39-help-4-over.png' });

  // --- The war room after it: coming home, and no front on the road to the friend it helped. ---
  await page.keyboard.press('Shift+KeyM');
  await page.getByTestId('war-tab-send').click();
  await expect(page.locator('[data-testid^="expedition-"]')).toContainText('helping Samford');
  await page.getByTestId('war-tab-map').click();
  // (It did fight, so its report is there: the road to Samford would show a front were it taken for a raid.)
  expect(done.late ?? false).toBe(false);
  const reports = (await page.evaluate(() => window.__game!.getBattle())).reports;
  expect(reports.length).toBeGreaterThan(0);
  const samford = await page.evaluate(
    async () => (await window.__game!.getState()).region.neighbours.find((n) => n.name === 'Samford')?.id,
  );
  await expect(page.getByTestId(`map-${samford}`).locator('line.war-map-route')).not.toHaveClass(/front/);
  errs.check();
});
