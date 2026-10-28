import { test, expect, type Browser, type Page } from '@playwright/test';
import { closeContextsAfterEach, newContext, openGame, shot, watchErrors } from './helpers';
import { frames, screen } from './ui';
import { armTown, servedTown } from './war';

/**
 * M37 between friends, through the interface: Ada starts a region with war on and Sam brings
 * Samford in. Ada researches intelligence and builds a spy agency and a blackout tower. From the war
 * room's Intelligence tab she sends an agent to look round Samford: the region rolls the dice, and
 * both cities hear the verdict. Then from the tower's inspector she blacks Samford out: Sam's page
 * is warned an hour ahead (the siren, a notice), then Samford is dark for twelve hours, and Ada's
 * tower recharges.
 */

// A button that never turns up fails in a minute, not at the test's timeout.
test.use({ actionTimeout: 60_000 });

/** On a failure, each player's last console lines and region messages (as m35-friends). */
const watched: { name: string; page: Page; log: string[] }[] = [];
function watch(name: string, page: Page): void {
  const log: string[] = [];
  const t0 = performance.now();
  const at = () => `${((performance.now() - t0) / 1000).toFixed(0)}s`;
  const kind = (payload: string | Buffer) => {
    const t = String(payload);
    return t.startsWith('{') ? (/"t":"(\w+)"/.exec(t)?.[1] ?? '?') : t.slice(0, 20);
  };
  page.on('console', (m) => log.push(`${at()} ${m.type()}: ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => log.push(`${at()} pageerror: ${e.message}`));
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => log.push(`${at()} ws > ${kind(f.payload)}`));
    ws.on('framereceived', (f) => log.push(`${at()} ws < ${kind(f.payload)}`));
  });
  watched.push({ name, page, log });
}
test.afterEach(async ({ browserName: _ }, info) => {
  if (info.status !== info.expectedStatus)
    for (const w of watched) {
      await w.page.screenshot({ path: `test-results/m37-friends-${w.name}.png` }).catch(() => undefined);
      console.log(`--- ${w.name} at ${w.page.url()}\n${w.log.slice(-80).join('\n')}`);
    }
  watched.length = 0;
});
closeContextsAfterEach();

async function player(browser: Browser, name: string, color: number): Promise<Page> {
  // Two SwiftShader pages: Low graphics and smaller windows.
  const ctx = await newContext(browser, { viewport: { width: 1200, height: 760 } });
  await ctx.addInitScript(
    ([n, c]) => {
      localStorage.setItem('citybloom.player', JSON.stringify({ name: n, color: c }));
      // The spec builds and charges by fast-forwarding, far past the region's 1× clock.
      localStorage.setItem('citybloom.fairClock', 'off');
      const key = 'citybloom.settings';
      const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      localStorage.setItem(key, JSON.stringify({ ...s, graphicsChecked: true, tips: false, quality: 'low' }));
    },
    [name, color] as const,
  );
  return ctx.newPage();
}

const region = (page: Page) => page.evaluate(() => window.__game!.getRegion());
const intel = (page: Page) => page.evaluate(() => window.__game!.getIntel());

/** Click a civic building of this kind to open its inspector. */
async function inspect(page: Page, def: string): Promise<void> {
  const c = (await page.evaluate((d) => window.__game!.getCivics().filter((x) => x.def === d), def))[0]!;
  await page.evaluate(
    (p) => window.__game!.setCamera({ x: p.x, z: p.z, yaw: 0.6, distance: 230, tilt: 0.55 }),
    c,
  );
  await frames(page, 3);
  const p = await screen(page, c.x, c.z);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('military')).toBeVisible({ timeout: 20_000 });
}

test('M37: a spy and a blackout between friends, decided by the region, through the war room', async ({
  browser,
}) => {
  test.setTimeout(3_600_000);
  const ada = await player(browser, 'Ada', 0);
  watch('ada', ada);
  const adaErrs = watchErrors(ada);
  await openGame(ada, '&seed=regionada&preset=river&name=Adaville');
  await servedTown(ada);
  const sam = await player(browser, 'Sam', 1);
  watch('sam', sam);
  const samErrs = watchErrors(sam);
  await openGame(sam, '&seed=regionsam&preset=lakes&name=Samford');
  await servedTown(sam);

  // A region at war: Ada starts it, Sam joins with the code.
  await ada.bringToFront();
  await ada.keyboard.press('Shift+N');
  await ada.getByTestId('region-start').click();
  await expect.poll(async () => (await region(ada))?.state, { timeout: 120_000 }).toBe('in');
  await ada.getByTestId('region-war-on').check();
  await expect.poll(async () => (await region(ada))?.rules.war, { timeout: 15_000 }).toBe(true);
  const code = (await region(ada))!.code;
  await sam.bringToFront();
  await sam.keyboard.press('Shift+N');
  await sam.getByTestId('region-code').fill(code);
  await sam.getByTestId('region-join').click();
  await expect.poll(async () => (await region(sam))?.state, { timeout: 120_000 }).toBe('in');
  await expect.poll(async () => (await region(sam))?.rules.war, { timeout: 60_000 }).toBe(true);
  await ada.keyboard.press('Shift+N');
  await sam.keyboard.press('Shift+N');

  // Ada: intelligence researched (the Research tab's own spec queues it through the UI), an HQ, a
  // spy agency and a blackout tower, its stages done and charged. Sam: an HQ; Samford's newcomer's
  // shield is lifted, so a blackout (a strike, like a raid) may reach it.
  await ada.bringToFront();
  await ada.evaluate(async () => {
    const g = window.__game!;
    for (const cmd of [
      { type: 'cheat', cheat: 'addMoney', amount: 5_000_000 },
      { type: 'cheat', cheat: 'research', tiers: ['intel1', 'intel2', 'intel3', 'intel4'] },
    ] as const) {
      const r = await g.dispatch(cmd as never);
      if (!r.ok) throw new Error(r.reason);
    }
  });
  await armTown(ada, ['militaryhq']);
  const hz = (await ada.evaluate(() => window.__game!.getState())).highwayZ;
  await ada.evaluate(
    async ([hz]) => {
      const g = window.__game!;
      // The agency and the tower where there's room for them (the tower is big; Adaville has a river).
      const at = (dx: number, dz: number) => ({ x: 24 + dx, z: hz! + dz });
      const spots = [at(200, 160), at(380, -160), at(100, -160), at(440, 160), at(240, -280), at(60, 160)];
      const put = async (def: string): Promise<number> => {
        for (const p of spots) {
          const id = await g.placeCivic(def, p);
          if (id !== null) return id;
        }
        throw new Error(`no room for ${def}`);
      };
      await put('spyagency');
      const tower = await put('blackouttower');
      for (const cmd of [
        { type: 'cheat', cheat: 'finishStages', civic: tower },
        { type: 'cheat', cheat: 'superReady' },
      ] as const) {
        const r = await g.dispatch(cmd);
        if (!r.ok) throw new Error(r.reason);
      }
      await g.advance(60 * 6);
    },
    [hz] as const,
  );
  await sam.bringToFront();
  await armTown(sam, ['militaryhq']);
  await sam.evaluate(async () => {
    const r = await window.__game!.dispatch({ type: 'cheat', cheat: 'unshield' });
    if (!r.ok) throw new Error(r.reason);
    await window.__game!.regionReportNow();
  });
  await ada.bringToFront();
  await ada.evaluate(() => window.__game!.regionReportNow());
  const target = await ada.evaluate(async () => {
    const s = await window.__game!.getState();
    const n = s.region.neighbours.find((x) => x.name === 'Samford' && x.player)!;
    return { id: n.id, slot: n.player!.slot };
  });
  // The region's word on Samford reaches Ada: open to strikes, and its research (none) reported.
  await expect
    .poll(
      async () => {
        const s = await ada.evaluate(() => window.__game!.getState());
        return s.region.neighbours.find((x) => x.id === target.id)?.player?.raid;
      },
      { timeout: 120_000 },
    )
    .toBe('open');

  // --- A spy, sent from the Intelligence tab: a look round Samford. ---
  await ada.keyboard.press('Shift+KeyM');
  await ada.getByTestId('war-tab-intel').click();
  await expect(ada.getByTestId('intel-agents')).toContainText('2 of 2 free');
  await ada.getByTestId('intel-to').selectOption(String(target.id));
  await ada.getByTestId('intel-op-reveal').click();
  // The odds as the region will roll them, from Samford's reported counter-intelligence.
  await expect(ada.getByTestId('intel-odds')).toContainText('to succeed');
  await expect(ada.getByTestId('intel-odds')).toContainText('The region rolls the dice');
  await shot(ada, 'm37-friends-spy');
  await ada.getByTestId('intel-send-go').click();
  await expect(ada.getByTestId('intel-missions')).toContainText('look round in Samford');
  // There in four hours: it waits for the region's word, which comes back to both cities.
  await ada.evaluate(() => window.__game!.advance(60 * 5));
  await expect
    .poll(async () => (await intel(ada))?.results.some((r) => r.text.includes('Samford')), {
      timeout: 180_000,
      intervals: [2_000],
    })
    .toBe(true);
  const verdict = (await intel(ada))!.results.find((r) => r.text.includes('Samford'))!.text;
  expect(verdict).toMatch(/looked round Samford: \d+ units|came away from Samford|was caught in Samford/);
  if (verdict.includes('looked round')) {
    // The dossier, from the region's save of Samford: its HQ among the defences shown.
    await expect(ada.getByTestId(`seen-${target.slot}`)).toContainText('Samford');
    await expect(ada.getByTestId(`seen-${target.slot}`)).toContainText('Research: land 0/4');
  }
  if (verdict.includes('was caught')) {
    // An incident on both sides: Samford's agents caught Ada's spy.
    await sam.bringToFront();
    await expect
      .poll(
        async () => (await intel(sam))?.results.some((r) => r.text.includes('caught a spy from Adaville')),
        {
          timeout: 120_000,
        },
      )
      .toBe(true);
    await ada.bringToFront();
  }
  await shot(ada, 'm37-friends-verdict');
  await ada.keyboard.press('Shift+KeyM');

  // --- The blackout tower, from its inspector, at Samford. ---
  await inspect(ada, 'blackouttower');
  await expect(ada.getByTestId('tower')).toContainText('Ready');
  await ada.getByTestId('blackout-to').selectOption(String(target.id));
  await shot(ada, 'm37-friends-tower');
  await ada.getByTestId('blackout-use').click();
  await expect(ada.getByTestId('tower')).toContainText('Charging at Samford');
  // Sam's page hears of it with an hour to go: the siren and a notice.
  await sam.bringToFront();
  await sam.keyboard.press('KeyN');
  await expect(sam.getByTestId('notifications')).toContainText(
    'Adaville is charging a blackout tower at the city',
    {
      timeout: 180_000,
    },
  );
  await shot(sam, 'm37-friends-warning');
  await sam.keyboard.press('KeyN');
  // An hour later Samford is dark for twelve hours: its plants falter.
  await sam.evaluate(() => window.__game!.advance(60 * 2));
  await expect
    .poll(async () => (await sam.evaluate(() => window.__game!.getSupers())).buildings?.blackout?.left ?? 0, {
      timeout: 60_000,
    })
    .toBeGreaterThan(0);
  await shot(sam, 'm37-friends-dark');
  // Ada's tower: kept by the region, it fired and is recharging.
  await ada.bringToFront();
  await ada.evaluate(() => window.__game!.advance(60 * 2));
  await expect(ada.getByTestId('tower')).toContainText('Recharging', { timeout: 60_000 });
  await expect(ada.getByTestId('blackout-use')).toBeDisabled();
  adaErrs.check();
  samErrs.check();
});
