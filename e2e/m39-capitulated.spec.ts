import { expect, test, type Page } from '@playwright/test';
import { openGame, shot, watchErrors } from './helpers';
import { settings } from './ui';
import { armTown, servedTown } from './war';

/**
 * M39 polish: a city that has capitulated to a friend has nothing to propose to them, whatever the
 * region would allow: the Diplomacy tab's row for the winner says "Waiting for <winner> to set the
 * terms" in place of Propose…, while the winner (and any other friend) keeps its button, and the winner
 * is offered "Set the terms". The region is played in the page (a city with rivals, told of two friends
 * and two wars as the region's pages tell their sims), so nothing waits on a clock.
 */
test.use({ hasTouch: true });

const NONE = { power: 0, water: 0, garbage: 0 };

async function mirror(page: Page): Promise<string[]> {
  return page.evaluate(
    async ([none]) => {
      const g = window.__game!;
      const city = (slot: number, name: string) => ({
        slot,
        name,
        mayor: name,
        color: slot,
        population: 4_000,
        kind: 'suburb' as const,
        offers: { buy: { ...none }, sell: { ...none } },
        workers: 0,
        jobs: 0,
        shoppers: 0,
        online: true,
        raid: 'open' as const,
      });
      const out: string[] = [];
      const run = async (cmd: Parameters<typeof g.dispatch>[0]) => {
        const r = await g.dispatch(cmd);
        out.push(r.ok ? 'ok' : r.reason);
      };
      await run({
        type: 'regionUpdate',
        update: {
          cities: [city(2, 'Samford'), city(4, 'Riverton')],
          contracts: [],
          project: null,
          rules: { war: true, scale: 'war' as const },
        },
      });
      // Samford beat the city: it capitulated (score −65), and Samford sets the terms.
      await run({
        type: 'friendWar',
        room: 1,
        slot: 2,
        by: 'them',
        scale: 'war',
        reason: 'The river is ours',
        state: 'capitulated',
        score: -65,
        battles: 3,
        capitulated: 'us',
      });
      // The city beat Riverton: Riverton capitulated, and the city sets the terms.
      await run({
        type: 'friendWar',
        room: 2,
        slot: 4,
        by: 'us',
        scale: 'war',
        reason: 'Their bridge',
        state: 'capitulated',
        score: 62,
        battles: 3,
        capitulated: 'them',
      });
      return out;
    },
    [NONE] as const,
  );
}

test('M39: a city that capitulated waits for the winner to set the terms, with no Propose', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errs = watchErrors(page);
  await settings(page, { quality: 'low' });
  await openGame(page, '&rivals=1&seed=port&preset=coast');
  await servedTown(page);
  await armTown(page, ['militaryhq']);
  expect(await mirror(page)).toEqual(['ok', 'ok', 'ok']);

  await page.keyboard.press('Shift+KeyM');
  await page.getByTestId('war-tab-diplomacy').click();
  await expect(page.getByTestId('dip-friends')).toBeVisible();

  // The capitulated side: no Propose… for the winner, and the wait said in words.
  await expect(page.getByTestId('dip-friend-2')).toContainText('Samford');
  await expect(page.getByTestId('dip-fwait-2')).toHaveText('Waiting for Samford to set the terms');
  await expect(page.getByTestId('dip-fpropose-2')).toHaveCount(0);
  await expect(page.getByTestId('dip-fwar-2')).toContainText('The city has capitulated');
  await expect(page.getByTestId('dip-fimpose-2')).toHaveCount(0);
  await expect(page.getByTestId('dip-fpeace-2')).toHaveCount(0);

  // The winner: Propose… stays (it may offer anything), the terms are its to set, nothing to wait for.
  await expect(page.getByTestId('dip-friend-4')).toContainText('Riverton');
  await expect(page.getByTestId('dip-fpropose-4')).toBeVisible();
  await expect(page.getByTestId('dip-fwait-4')).toHaveCount(0);
  await page.getByTestId('dip-fimpose-4').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('dip-fimpose-4')).toBeVisible();
  await shot(page, 'm39-capitulated');

  // Setting the terms opens the builder for the winner, as before.
  await page.getByTestId('dip-fimpose-4').click();
  await expect(page.getByTestId('dip-fbuilder')).toContainText('who has capitulated');
  errs.check();
});
