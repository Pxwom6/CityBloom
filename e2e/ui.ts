import { expect, type Page } from '@playwright/test';

/** Shared steps for driving the game through its interface (M22 onwards). */

export const screen = (page: Page, x: number, z: number) =>
  page.evaluate(([x, z]) => window.__game!.worldToScreen(x!, z!), [x, z]);
export const frames = (page: Page, n = 2) => page.evaluate((n) => window.__game!.waitFrames(n), n);
export const state = (page: Page) => page.evaluate(() => window.__game!.getState());

/** Tips off and the graphics check done (plus any other settings), before every navigation. */
export async function settings(page: Page, extra: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((extra) => {
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...s, tips: false, graphicsChecked: true, ...extra }));
  }, extra);
}

/** Open a scenario from its URL, begin it and hold the clock (time moves only through `advance`). */
export async function openScenario(page: Page, id: string, town: string): Promise<void> {
  await settings(page);
  await page.goto(`./?scenario=${id}`);
  await page.waitForFunction(
    () => window.__game?.ready === true && window.__game.getShell().mode === 'play',
    null,
    { timeout: 120_000 },
  );
  await expect(page.getByTestId('scenario-brief')).toContainText(town);
  await page.getByTestId('scenario-begin').click();
  await page.evaluate(() => window.__game!.setSpeed(0));
}

/** Play on to the next time the clock reads `hour`:00. */
export async function untilHour(page: Page, hour: number): Promise<void> {
  await page.evaluate(async (hour) => {
    const g = window.__game!;
    const now = (((await g.getState()).tick + 420) % 1440) / 60;
    await g.advance(Math.round(((((hour - now) % 24) + 24) % 24) * 60));
  }, hour);
}

/** The placement hint once the sim's preview for the pointer's spot has come back and settled. */
export async function settledHint(page: Page): Promise<{ tone: string; text: string }> {
  const read = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-testid="tool-hint"]');
      return { tone: el?.className ?? '', text: el?.textContent ?? '' };
    });
  let last = await read();
  for (let k = 0; k < 20; k++) {
    await page.waitForTimeout(250);
    await frames(page);
    const now = await read();
    if (now.text === last.text && now.tone === last.tone && /\b(ok|bad)\b/.test(now.tone)) return now;
    last = now;
  }
  return last;
}

/**
 * Pick a building from a toolbar category and place it at the first spot the sim accepts on open
 * ground (or, failing that, the first it accepts at all), as a player would by hovering and reading
 * the hint.
 */
export async function placeFromToolbar(
  page: Page,
  category: string,
  def: string,
  spots: [number, number][],
): Promise<void> {
  await page.getByTestId(`tool-${category}`).click();
  await expect(page.getByTestId('place-options')).toBeVisible();
  await page.getByTestId(`place-${def}`).click();
  const count = () =>
    page.evaluate((def) => window.__game!.getCivics().filter((c) => c.def === def).length, def);
  const before = await count();
  let pick: [number, number] | null = null;
  const seen: string[] = [];
  for (const [x, z] of spots) {
    const p = await screen(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForTimeout(400);
    const h = await settledHint(page);
    seen.push(`${Math.round(x)},${Math.round(z)}: ${h.text}`);
    if (!/\bok\b/.test(h.tone)) continue;
    pick ??= [x, z];
    if (!h.text.includes('replaces')) {
      pick = [x, z];
      break;
    }
  }
  expect(pick, `nowhere for the ${def}:\n${seen.join('\n')}`).not.toBeNull();
  const p = await screen(page, pick![0], pick![1]);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.waitForTimeout(300);
  await page.mouse.click(p.x, p.y);
  await expect.poll(count, { timeout: 20_000 }).toBe(before + 1);
  await page.getByTestId('tool-select').click();
}

/** Escape until the pause menu is up (a first press may only deselect something). */
export async function pauseMenu(page: Page): Promise<void> {
  for (let k = 0; k < 3 && !(await page.getByTestId('pause-settings').isVisible()); k++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  await expect(page.getByTestId('pause-settings')).toBeVisible();
}
