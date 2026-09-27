import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, openGame, serveTownViaApi, shot, watchErrors } from './helpers';

const state = (page: Page) => page.evaluate(() => window.__game!.getState());
const screen = (page: Page, x: number, z: number) =>
  page.evaluate(([x, z]) => window.__game!.worldToScreen(x!, z!), [x, z]);
const civic = (page: Page, def: string) =>
  page.evaluate((d) => window.__game!.getCivics().find((c) => c.def === d) ?? null, def);

/** Run past the next month's close to midday (months close at midnight), for daylight shots. */
async function nextMonth(page: Page) {
  await page.evaluate(async () => {
    const g = window.__game!;
    const t = (await g.getState()).tick;
    await g.advance(1440 - ((t + 420) % 1440) + 720);
  });
}

/** Scroll the city panel back to its top before a screenshot. */
const panelTop = (page: Page) =>
  page.evaluate(() => document.querySelector('[data-testid="city-panel"] .advisors-list')?.scrollTo(0, 0));

test('M17: a big project is placed from the toolbar and built stage by stage; an election is fought on promises', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errs = watchErrors(page);
  await openGame(page);
  await buildTownViaApi(page);
  await serveTownViaApi(page);
  const cz = (await state(page)).highwayZ;
  // Services too, so the town lives through the months the stadium takes.
  await page.evaluate(async (cz) => {
    const g = window.__game!;
    for (const def of ['firestation', 'police', 'clinic', 'primary', 'park_small'])
      await g.placeCivic(def, { x: 200, z: cz - 60 });
  }, cz);
  // An avenue north of the town for the stadium, joined to its first side street.
  const dz = await page.evaluate(async (cz) => {
    const g = window.__game!;
    await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 1_500_000 });
    for (const dz of [-330, -360, -300, -390]) {
      const r = await g.dispatch({
        type: 'buildRoad',
        road: 'avenue',
        points: [
          { x: 60, z: cz + dz },
          { x: 720, z: cz + dz },
        ],
      });
      if (!r.ok) continue;
      await g.dispatch({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: 120, z: cz + dz },
          { x: 120, z: cz - 160 },
        ],
      });
      return dz;
    }
    return null;
  }, cz);
  expect(dz).not.toBeNull();
  const az = cz + dz!;

  // --- The Big projects category: requirements, cost and perk in each button's tooltip. ---
  await page.evaluate(
    ([az]) => window.__game!.setCamera({ x: 380, z: az!, distance: 620, yaw: 0.3, tilt: 0.15 }),
    [az],
  );
  await page.getByTestId('tool-project').click();
  await page.getByTestId('place-stadium').hover();
  await expect(page.getByRole('tooltip')).toContainText('$600,000 over 10 months');
  await expect(page.getByRole('tooltip')).toContainText('Perk:');
  await page.getByTestId('place-stadium').click();
  // The placement hint names the first stage's price and the total.
  for (const [x, z] of [
    [420, az - 70],
    [560, az - 70],
    [300, az - 70],
    [420, az + 70],
  ] as [number, number][]) {
    const p = await screen(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForTimeout(300);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(300);
    if (await civic(page, 'stadium')) break;
  }
  await page.getByTestId('tool-select').click();
  const st = (await civic(page, 'stadium'))!;
  expect(st).not.toBeNull();

  // --- The inspector follows construction, and the site changes with each stage. ---
  await page.evaluate(
    ([x, z]) => window.__game!.setCamera({ x: x!, z: z!, distance: 230, yaw: 0.5, tilt: 0.25 }),
    [st.x, st.z],
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
  const at = await screen(page, st.x, st.z);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('project-progress')).toBeVisible();
  await expect(page.getByTestId('project-status')).toContainText(/Groundworks/i);
  await shot(page, 'm17-stadium-0');
  const stages: number[] = [];
  for (let m = 0; m < 10; m++) {
    await nextMonth(page);
    const s = await page.evaluate(
      (id) => window.__game!.getCivics().find((c) => c.id === id)?.stage ?? -1,
      st.id,
    );
    stages.push(s);
    if (m === 2) {
      await expect(page.getByTestId('project-status')).toContainText(/Stands/i);
      await shot(page, 'm17-stadium-1');
    }
    if (m === 6) await shot(page, 'm17-stadium-2');
  }
  expect(stages).toEqual([0, 0, 1, 1, 1, 1, 2, 2, 2, -1]);
  await expect(page.getByTestId('project-status')).toContainText(/Open/i);
  await shot(page, 'm17-stadium-open');
  await page.keyboard.press('Escape');

  // --- An election: the campaign opens, two promises, a third refused, the vote held. ---
  expect(
    (await page.evaluate(() => window.__game!.dispatch({ type: 'cheat', cheat: 'electionIn', months: 3 })))
      .ok,
  ).toBe(true);
  await page.evaluate(() => window.__game!.advance(60));
  await page.getByTestId('open-city').click();
  await page.getByTestId('city-tab-election').click();
  await expect(page.getByTestId('election-card')).toContainText('in 3 months');
  await expect(page.getByTestId('election-projected')).toContainText(/%/);
  await page.getByTestId('promise-taxes').check();
  await page.getByTestId('promise-jobs').check();
  await expect(page.getByTestId('promise-state-taxes')).toContainText('On track');
  await expect(page.getByTestId('promise-crime')).toBeDisabled();
  await panelTop(page);
  await shot(page, 'm17-election-campaign');
  // Voting day.
  for (let m = 0; m < 3; m++) await nextMonth(page);
  await expect(page.getByTestId('election-last')).toBeVisible();
  await expect(page.getByTestId('election-last')).toContainText(/(won|lost) with \d+ %/);
  await expect(page.getByTestId('election-last')).toContainText('No tax rises (kept)');
  await expect(page.getByTestId('election-card')).toContainText('in 48 months');
  await panelTop(page);
  await shot(page, 'm17-election-result');
  errs.check();
});
