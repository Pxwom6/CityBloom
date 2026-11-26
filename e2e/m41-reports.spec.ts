import { test, expect, type Browser, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { closeContextsAfterEach, newContext, openGame } from './helpers';

/**
 * M41, hearing about problems, through the real interface against the local relay (started by the
 * e2e config with the owner key `e2e-owner-key`): a deliberate error from two pages folds into one
 * entry, a page with crash reports switched off sends nothing, a written report with a picture goes
 * from the pause menu to the owner area, and a forced desync between two players reaches it too,
 * whose downloaded replay the script finds the split in.
 */
closeContextsAfterEach();
test.describe.configure({ mode: 'serial' });

const RELAY = 'http://127.0.0.1:8787';
const KEY = 'e2e-owner-key';
const OUT = 'test-results/m41';
mkdirSync(OUT, { recursive: true });

interface Group {
  key: string;
  kind: string;
  message: string;
  count: number;
  items: { id: number; at: number; note: string | null; shot: boolean; replay: boolean }[];
}

async function groups(): Promise<Group[]> {
  const r = await fetch(`${RELAY}/owner/reports?status=all`, { headers: { authorization: `Bearer ${KEY}` } });
  return ((await r.json()) as { groups: Group[] }).groups;
}

async function player(
  browser: Browser,
  name: string,
  color: number,
  size = { width: 1000, height: 700 },
): Promise<Page> {
  const ctx = await newContext(browser, { viewport: size, acceptDownloads: true });
  await ctx.addInitScript(
    ([n, c]) => {
      localStorage.setItem('citybloom.player', JSON.stringify({ name: n, color: c }));
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
    },
    [name, color] as const,
  );
  return ctx.newPage();
}

const reports = (page: Page) =>
  page.evaluate(
    () => window.__game!.getReports() as { captured: number; folded: number; sent: number; skipped: number },
  );

/** The owner area, signed in (a wrong key first: it's refused). */
async function ownerArea(browser: Browser, size = { width: 390, height: 844 }): Promise<Page> {
  const page = await (await newContext(browser, { viewport: size, acceptDownloads: true })).newPage();
  await page.goto('./owner.html');
  await expect(page.getByTestId('owner-signin')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('owner-key').fill('not-the-key');
  await page.getByTestId('owner-signin-go').click();
  await expect(page.getByTestId('owner-error')).toHaveText('That isn’t the owner key.');
  await page.getByTestId('owner-key').fill(KEY);
  await page.getByTestId('owner-signin-go').click();
  await expect(page.getByTestId('owner-reports')).toBeVisible();
  await page.getByTestId('owner-filter-all').click();
  return page;
}

test('a deliberate error folds across two pages; with crash reports off nothing is sent', async ({
  browser,
}) => {
  test.setTimeout(400_000);
  const stamp = Date.now().toString(36);
  const ada = await player(browser, 'Ada', 0);
  await openGame(ada, `&seed=m41a&name=Adaford`);
  const sam = await player(browser, 'Sam', 1);
  await openGame(sam, `&seed=m41b`);
  const message = `M41 deliberate error ${stamp}`;
  await ada.evaluate((m) => window.__game!.throwError(m), message);
  await sam.evaluate((m) => window.__game!.throwError(m), message);
  await expect
    .poll(async () => (await groups()).find((g) => g.message === message)?.count, { timeout: 30_000 })
    .toBe(2);
  // The same error again on a page within ten minutes is only counted there (it goes with the next).
  await ada.evaluate((m) => window.__game!.throwError(m), message);
  await expect.poll(async () => (await reports(ada)).folded).toBe(1);
  expect((await groups()).find((g) => g.message === message)!.count).toBe(2);
  // Nothing on the page names the player or the city.
  const g = (await groups()).find((x) => x.message === message)!;
  expect(JSON.stringify(g)).not.toMatch(/Ada|Adaford|Sam/);

  // Sam switches crash reports off in Settings → Game: an error then sends nothing at all.
  await sam.keyboard.press('Escape');
  await sam.getByTestId('pause-settings').click();
  await expect(sam.getByTestId('set-crash-reports')).toBeChecked();
  await sam.getByTestId('set-crash-reports').uncheck();
  await sam.screenshot({ path: `${OUT}/settings-crash-reports.png` });
  await sam.getByTestId('shell-back').click();
  await sam.getByTestId('pause-resume').click();
  const quiet = `M41 never sent ${stamp}`;
  await sam.evaluate((m) => window.__game!.throwError(m), quiet);
  await sam.evaluate((m) => window.__game!.rejectPromise(m), `${quiet} (rejected)`);
  await expect.poll(async () => (await reports(sam)).skipped).toBe(2);
  await sam.waitForTimeout(3000);
  await sam.evaluate(() => window.__game!.flushReports());
  expect((await groups()).some((x) => x.message.includes(quiet))).toBe(false);
  expect((await reports(sam)).sent).toBe(1);

  // The owner area shows the entry folded, with its count, versions and browser.
  const owner = await ownerArea(browser);
  const entry = owner.getByTestId('owner-group').filter({ hasText: message });
  await expect(entry.getByTestId('owner-group-count')).toHaveText('×2');
  await entry.locator('.owner-group-head').click();
  await expect(entry.getByTestId('owner-group-body')).toContainText('Chrome');
  await owner.screenshot({ path: `${OUT}/owner-error.png`, fullPage: true });
  // Marked fixed, it leaves the open list.
  await entry.getByTestId('owner-fixed').click();
  await expect(owner.getByTestId('owner-toast')).toHaveText('Marked fixed.');
  await owner.getByTestId('owner-filter-open').click();
  await expect(owner.getByTestId('owner-group').filter({ hasText: message })).toHaveCount(0);
});

test('Report a problem from the pause menu reaches the owner area with its message and picture', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const stamp = Date.now().toString(36);
  const kit = await player(browser, 'Kit', 2, { width: 1280, height: 800 });
  await openGame(kit, `&seed=m41c&name=Kitbury`);
  await kit.keyboard.press('Escape');
  await kit.getByTestId('pause-report').click();
  const note = `The tram stopped at the junction (${stamp})`;
  await kit.getByTestId('report-note').fill(note);
  await kit.getByTestId('report-shot').check();
  await expect(kit.getByTestId('report-shot-preview')).toBeVisible();
  await kit.getByTestId('report-what').click();
  const lines = kit.getByTestId('report-lines');
  await expect(lines).toContainText(note);
  await expect(lines).toContainText('low');
  await expect(lines).not.toContainText('Kitbury');
  await kit.screenshot({ path: `${OUT}/report-screen.png` });
  await kit.getByTestId('report-send').click();
  await expect(kit.getByText('Thanks: your report is on its way.')).toBeVisible();

  const owner = await ownerArea(browser);
  const entry = owner.getByTestId('owner-group').filter({ hasText: note });
  await expect(entry).toHaveAttribute('data-kind', 'user');
  await entry.locator('.owner-group-head').click();
  await entry.getByTestId('owner-show-shot').click();
  await expect(entry.getByTestId('owner-shot')).toBeVisible();
  await owner.screenshot({ path: `${OUT}/owner-written.png`, fullPage: true });
});

test('a forced desync between two pages reaches the owner area, and its replay finds the split', async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const started = Date.now();
  const ada = await player(browser, 'Ada', 0, { width: 900, height: 640 });
  await openGame(ada, '&seed=m41d&preset=river&name=Desyncford');
  await ada.keyboard.press('Escape');
  await ada.getByTestId('pause-invite').click();
  const net = (p: Page) => p.evaluate(() => window.__game!.getNet());
  await expect.poll(async () => (await net(ada))?.state, { timeout: 30_000 }).toBe('playing');
  const code = (await net(ada))!.code;
  await ada.getByTestId('speed-0').click();
  await ada.getByTestId('room-panel').getByRole('button', { name: 'Close' }).click();

  const sam = await player(browser, 'Sam', 1, { width: 900, height: 640 });
  await sam.goto(`./?join=${code}`);
  await sam.waitForFunction(() => window.__game?.ready === true && !!window.__game.getNet(), null, {
    timeout: 120_000,
  });
  await expect.poll(async () => (await net(sam))?.state, { timeout: 120_000 }).toBe('playing');

  // Sam's game goes wrong on purpose (an id skipped), with the city running: the room catches it at the
  // next hourly checksum, and both pages file a report.
  await sam.evaluate(() => window.__game!.netPerturb('id'));
  await ada.getByTestId('speed-3').click();
  const fresh = (g: Group | undefined) => (g?.items ?? []).filter((i) => i.at >= started);
  await expect
    .poll(async () => fresh((await groups()).find((g) => g.kind === 'desync')).length, { timeout: 240_000 })
    .toBe(2);
  await ada.getByTestId('speed-0').click();

  // The owner area: the desync entry, and a replay downloaded through it.
  const owner = await ownerArea(browser, { width: 1100, height: 800 });
  const entry = owner.locator('[data-testid=owner-group][data-kind=desync]');
  await entry.locator('.owner-group-head').click();
  // Each side's report says which it is and what its replay needs.
  const summaries = entry.getByTestId('owner-item-summary');
  await expect(summaries.filter({ hasText: 'the pacer’s side' })).toContainText('replays from nothing more');
  await expect(summaries.filter({ hasText: 'on this machine' })).toContainText('replays from the city saved at tick');
  await owner.screenshot({ path: `${OUT}/owner-desync.png`, fullPage: true });
  const outputs: string[] = [];
  const items = entry.getByTestId('owner-item');
  for (let i = 0; i < 2; i++) {
    const [download] = await Promise.all([
      owner.waitForEvent('download'),
      items.nth(i).getByTestId('owner-download').click(),
    ]);
    const file = `${OUT}/desync-${i}.json`;
    await download.saveAs(file);
    let out = '';
    try {
      out = execFileSync('npx', ['tsx', 'scripts/desync.ts', file], { encoding: 'utf8', timeout: 120_000 });
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? e);
    }
    writeFileSync(`${OUT}/desync-${i}.txt`, out);
    outputs.push(out);
  }
  // The pacer's (Ada's: the city was founded on her machine) replays from nothing more and finds the
  // split, with Sam's side the one that left; Sam's own needs the city saved where he joined.
  const pacer = outputs.find((o) => /The hashes split at tick \d+/.test(o));
  expect(pacer, outputs.join('\n---\n')).toBeTruthy();
  expect(pacer).toContain('This page agrees with the replay all the way.');
  expect(pacer).toMatch(/The other side left the replay at tick \d+/);
  expect(outputs.some((o) => /--save/.test(o))).toBe(true);
});
