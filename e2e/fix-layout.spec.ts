import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, openGame, shot, watchErrors } from './helpers';
import { frames, openScenario, settings } from './ui';

/**
 * Playthrough fixes to layout (PLAYTHROUGH-FIXES.md): P6 narrow windows, P13 tooltips, P14 the thought
 * feed. The suite's default window is 1280x800, so each test sets its own size before it opens a city.
 */

const SIZES = [
  { w: 768, h: 1024 },
  { w: 820, h: 1180 },
  { w: 1024, h: 768 },
  { w: 1280, h: 800 },
];

/**
 * Buttons under a test id that a player could not press: off the screen, or with something else
 * above their centre. Buttons folded away (display: none, no box) are not there to press.
 */
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
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === b || b.contains(hit)))
        bad.push(`${name} is covered by ${hit?.tagName}.${hit?.className} (${at})`);
    }
    return bad;
  }, scope);
}

/** Where a bar sits: [left, right, top, bottom, width, height] in the window. */
async function boxOf(page: Page, testid: string): Promise<number[]> {
  return page.evaluate((id) => {
    const r = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
    return [r.left, r.right, r.top, r.bottom, r.width, r.height].map(Math.round);
  }, testid);
}

/** The whole bar is on screen (it may be cut off even when every button's centre is not). */
async function expectOnScreen(page: Page, testid: string): Promise<void> {
  const [l, r, t, b] = await boxOf(page, testid);
  const vp = page.viewportSize()!;
  const where = `${testid} at ${l}..${r} x ${t}..${b} in ${vp.width}x${vp.height}`;
  expect(l, where).toBeGreaterThanOrEqual(0);
  expect(r, where).toBeLessThanOrEqual(vp.width);
  expect(t, where).toBeGreaterThanOrEqual(0);
  expect(b, where).toBeLessThanOrEqual(vp.height);
}

const TOP_BUTTONS = [
  'open-budget',
  'weather',
  'speed-0',
  'speed-1',
  'speed-2',
  'speed-3',
  'menu-button',
  'open-city',
  'open-history',
  'open-region',
  'open-advisors',
  'open-notifications',
];

/**
 * Everything on the two bars can be reached at this size: all in the window and under the pointer,
 * the folded buttons too once the More button has opened them.
 */
async function expectBarsReachable(page: Page, scenario = false): Promise<void> {
  await expectOnScreen(page, 'topbar');
  await expectOnScreen(page, 'toolbar');
  expect(await unreachable(page, 'toolbar'), 'toolbar').toEqual([]);
  expect(await unreachable(page, 'topbar'), 'topbar').toEqual([]);
  const more = page.getByTestId('open-more');
  if (await more.isVisible()) {
    await more.click();
    await expect(page.getByTestId('topbar-panels')).toBeVisible();
    await expectOnScreen(page, 'topbar');
    expect(await unreachable(page, 'topbar'), 'topbar with More open').toEqual([]);
    expect(await unreachable(page, 'topbar-panels'), 'topbar-panels').toEqual([]);
    for (const id of TOP_BUTTONS.slice(7)) await expect(page.getByTestId(id)).toBeVisible();
    await more.click();
    await expect(page.getByTestId('topbar-panels')).toBeHidden();
  }
  // What stays in the bar itself.
  for (const id of [...TOP_BUTTONS.slice(0, 7), ...(scenario ? ['open-goals'] : [])])
    await expect(page.getByTestId(id)).toBeVisible();
}

test.describe('P6: narrow windows keep the toolbar and the top bar', () => {
  for (const { w, h } of SIZES) {
    test(`a new city at ${w}x${h}`, async ({ page }) => {
      const errs = watchErrors(page);
      await page.setViewportSize({ width: w, height: h });
      await openGame(page);
      await expect(page.getByTestId('toolbar').locator('button:visible')).toHaveCount(23);
      await expectBarsReachable(page);
      await shot(page, `fix-layout-p6-${w}x${h}`);

      // The folded buttons still do their job: Advisors opens its panel and closes the pop-over.
      const more = page.getByTestId('open-more');
      if (await more.isVisible()) {
        await more.click();
        await shot(page, `fix-layout-p6-more-${w}x${h}`);
        await page.getByTestId('open-advisors').click();
        await expect(page.getByTestId('topbar-panels')).toBeHidden();
      } else {
        await page.getByTestId('open-advisors').click();
      }
      await expect(page.getByTestId('advisors')).toBeVisible();
      await expectOnScreen(page, 'topbar');
      expect(await unreachable(page, 'topbar'), 'topbar with Advisors open').toEqual([]);
      errs.check();
    });
  }

  // The brief's trigger: the badge on Advisors makes the bar wider, and a fold must not hide it.
  test('the advisor badge stays visible when Advisors is folded away', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openGame(page);
    const badge = await page.evaluate(
      () => document.querySelector('[data-testid="open-advisors"] .badge')?.textContent ?? null,
    );
    expect(badge, 'a fresh city has advice to show').not.toBeNull();
    const more = page.getByTestId('open-more');
    await expect(more).toBeVisible();
    const dot = await more.evaluate((el) => getComputedStyle(el, '::after').content);
    expect(dot, 'the More button shows the badge as a dot').not.toBe('none');
    await expectOnScreen(page, 'topbar');
    expect(await unreachable(page, 'topbar')).toEqual([]);
  });

  // A scenario's Goals button holds the city name and takes more room than a plain name.
  for (const { w, h } of [
    { w: 768, h: 1024 },
    { w: 1024, h: 768 },
    { w: 1280, h: 800 },
  ]) {
    test(`a scenario city (harbour) at ${w}x${h}`, async ({ page }) => {
      const errs = watchErrors(page);
      await page.setViewportSize({ width: w, height: h });
      await openScenario(page, 'harbour', 'Harbourside');
      await frames(page);
      await expect(page.getByTestId('open-goals')).toBeVisible();
      await expect(page.locator('.modal-backdrop')).toHaveCount(0);
      const badge = await page.evaluate(
        () => document.querySelector('[data-testid="open-advisors"] .badge')?.textContent ?? 'none',
      );
      expect(badge, 'the scenario starts with advice, so the Advisors badge widens the bar').not.toBe('none');
      await expectBarsReachable(page, true);
      // At the common laptop width the scenario bar needs no More menu: every button is in the bar
      // (other specs click Region and City there), because the bar closes its gaps up instead.
      if (w >= 1280) {
        await expect(page.getByTestId('open-more')).toBeHidden();
        for (const id of TOP_BUTTONS) await expect(page.getByTestId(id)).toBeVisible();
      }
      // The goals button names the city and shows the goals: legible whole down to 1024, and at 768
      // cut short with an ellipsis, never squeezed to nothing.
      const goals = await page.evaluate(() => {
        const name = document.querySelector<HTMLElement>('[data-testid="open-goals"] .city')!;
        const text = document.querySelector<HTMLElement>('[data-testid="open-goals"] .goals-text')!;
        return {
          name: [name.scrollWidth, name.clientWidth],
          text: [text.scrollWidth, text.clientWidth],
          words: text.textContent,
        };
      });
      expect(goals.words).toContain('Goals');
      expect(goals.name[1], 'room for the city name').toBeGreaterThanOrEqual(48);
      if (w >= 1024) {
        expect(goals.name[0], 'the city name is whole').toBeLessThanOrEqual(goals.name[1]);
        expect(goals.text[0], 'the goals line is whole').toBeLessThanOrEqual(goals.text[1]);
      }
      await shot(page, `fix-layout-p6-scenario-${w}x${h}`);
      errs.check();
    });
  }

  test('a scenario city with the advisor badge showing (stadium) at 768x1024 and 1024x768', async ({
    page,
  }) => {
    await settings(page);
    for (const { w, h } of [
      { w: 768, h: 1024 },
      { w: 1024, h: 768 },
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await openScenario(page, 'stadium', 'Castlebridge');
      await expect(page.locator('.modal-backdrop')).toHaveCount(0);
      await frames(page);
      await expectBarsReachable(page, true);
    }
  });

  // A name can be 40 characters: the top bar cuts it short with an ellipsis at the right, at any width.
  const LONG = 'The Very Long Name Of A Grand Riverside!';
  for (const { w, h } of SIZES) {
    test(`a ${LONG.length}-character city name is cut short with an ellipsis at ${w}x${h}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      await settings(page);
      await page.goto(`./?paused=1&seed=long&name=${encodeURIComponent(LONG)}`);
      await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
      await frames(page);
      const city = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('.topbar .city')!;
        return {
          text: el.textContent,
          scroll: el.scrollWidth,
          client: el.clientWidth,
          overflow: getComputedStyle(el).textOverflow,
        };
      });
      expect(city.text).toBe(LONG);
      expect(city.client, 'room left for some of the name').toBeGreaterThanOrEqual(48);
      expect(city.scroll, 'the name is wider than its box (an ellipsis shows)').toBeGreaterThan(city.client);
      expect(city.overflow).toBe('ellipsis');
      await expectOnScreen(page, 'topbar');
      expect(await unreachable(page, 'topbar')).toEqual([]);
    });
  }

  test('a short city name is shown whole at 1024x768 and 1280x800', async ({ page }) => {
    for (const { w, h } of [
      { w: 1024, h: 768 },
      { w: 1280, h: 800 },
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await openGame(page);
      const [scroll, client] = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('.topbar .city')!;
        return [el.scrollWidth, el.clientWidth];
      });
      expect(scroll, `New Town whole at ${w}`).toBeLessThanOrEqual(client);
    }
  });

  // The toolbar is one row down to the width of its buttons and two rows below it; a button added
  // to it without moving the breakpoint (data-bars in layoutUi) fails here.
  test('the toolbar is one row when it fits and two rows when it does not', async ({ page }) => {
    for (const [w, rows] of [
      [1280, 1],
      [1200, 1],
      [1160, 1],
      [1100, 2],
      [1024, 2],
      [768, 2],
    ] as const) {
      await page.setViewportSize({ width: w, height: 800 });
      await openGame(page);
      const [l, r, , , width, height] = await boxOf(page, 'toolbar');
      if (rows === 1) expect(height, `toolbar height at ${w}`).toBeLessThan(80);
      else expect(height, `toolbar height at ${w}`).toBeGreaterThanOrEqual(100);
      expect(l, `toolbar left at ${w}`).toBeGreaterThanOrEqual(0);
      expect(r, `toolbar right at ${w}`).toBeLessThanOrEqual(w);
      if (rows === 2) expect(width, `toolbar width at ${w}`).toBeLessThan(700);
      expect(await unreachable(page, 'toolbar'), `toolbar at ${w}`).toEqual([]);
    }
  });

  // A larger interface (Settings) narrows the window in scaled rem the same way.
  for (const uiScale of [1.25, 1.4]) {
    test(`the bars are reachable at interface size ${uiScale} on 1280x800`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await settings(page, { uiScale });
      await page.goto('./?paused=1');
      await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
      await frames(page);
      await expectBarsReachable(page);
    });
  }
});

test.describe('P13: tooltips stay inside the window', () => {
  const TOOLS: [string, string][] = [
    ['tool-road', 'road-options'],
    ['tool-zone', 'zone-options'],
    ['tool-district', 'district-options'],
    ['tool-terrain', 'terrain-options'],
    ...[
      'power',
      'water',
      'garbage',
      'fire',
      'police',
      'health',
      'education',
      'parks',
      'transit',
      'landmark',
      'special',
      'project',
    ].map((c): [string, string] => [`tool-${c}`, 'place-options']),
  ];

  for (const { w, h } of SIZES) {
    test(`every toolbar and tool-panel tooltip fits at ${w}x${h}`, async ({ page }) => {
      const errs = watchErrors(page);
      await page.setViewportSize({ width: w, height: h });
      await openGame(page);
      // Nothing locked: a locked tool's tooltip is as long as an unlocked one's, plus the unlock line.
      await page.evaluate(() => window.__game!.dispatch({ type: 'cheat', cheat: 'unlockAll' }));
      await frames(page);

      const off: string[] = [];
      let hovered = 0;
      // Hover each button under a test id, as a player does, and look where its tooltip landed.
      // (`.tip`, not role=tooltip: the RCI pop-up is a tooltip too.)
      const hoverAll = async (scope: string) => {
        const buttons = page.getByTestId(scope).locator('.tip-anchor > button');
        const n = await buttons.count();
        expect(n, `${scope} has buttons`).toBeGreaterThan(0);
        for (let i = 0; i < n; i++) {
          const button = buttons.nth(i);
          await button.hover();
          const tip = page.locator('.tip');
          await expect(tip).toHaveCount(1);
          const box = await tip.boundingBox();
          const id = await button.getAttribute('data-testid');
          hovered++;
          if (!box || box.x < 0 || box.y < 0 || box.x + box.width > w || box.y + box.height > h)
            off.push(
              `${id}: ${box ? `${Math.round(box.x)}..${Math.round(box.x + box.width)} x ${Math.round(box.y)}..${Math.round(box.y + box.height)}` : 'no box'}`,
            );
        }
      };

      await hoverAll('toolbar');
      for (const [tool, options] of TOOLS) {
        await page.getByTestId(tool).click();
        await expect(page.getByTestId(options)).toBeVisible();
        await hoverAll(options);
        await page.getByTestId('tool-select').click();
      }
      expect(hovered, 'hovered enough buttons for the check to mean something').toBeGreaterThan(60);
      expect(off, `tooltips outside the ${w}x${h} window`).toEqual([]);
      errs.check();
    });
  }
});

test('P13: a tooltip over an end button slides in, one over a middle button stays centred', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openGame(page);
  const tipAt = async (id: string) => {
    await page.getByTestId(id).hover();
    await expect(page.locator('.tip')).toHaveCount(1);
    const tip = (await page.locator('.tip').boundingBox())!;
    const btn = (await page.getByTestId(id).boundingBox())!;
    return {
      left: tip.x,
      right: tip.x + tip.width,
      tipMid: tip.x + tip.width / 2,
      btnMid: btn.x + btn.width / 2,
    };
  };
  const select = await tipAt('tool-select');
  expect(select.left, 'Select: inside the window, with a margin').toBeGreaterThanOrEqual(7.5);
  expect(select.tipMid, 'Select: slid right of the button').toBeGreaterThan(select.btnMid + 10);
  await shot(page, 'fix-layout-p13-select');
  const photo = await tipAt('tool-photo');
  expect(photo.right, 'Photo: inside the window, with a margin').toBeLessThanOrEqual(1280 - 7.5);
  expect(photo.tipMid, 'Photo: slid left of the button').toBeLessThan(photo.btnMid - 10);
  await shot(page, 'fix-layout-p13-photo');
  const mid = await tipAt('tool-power');
  expect(Math.abs(mid.tipMid - mid.btnMid), 'Power: centred on its button').toBeLessThan(1);

  // A sub-bar button at the left edge of a narrower window.
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByTestId('tool-road').click();
  const dirt = await tipAt('road-dirt');
  expect(dirt.left, 'dirt road: inside the window').toBeGreaterThanOrEqual(7.5);
  await shot(page, 'fix-layout-p13-road-dirt');
});

test.describe('P14: the thought feed leaves the data-map menu and the map alone', () => {
  /** A grown town, so residents have something to say. */
  async function townWithThoughts(page: Page): Promise<void> {
    await openGame(page);
    await buildTownViaApi(page);
    await page.evaluate(() => window.__game!.advance(1440 * 2));
    await expect(page.getByTestId('thoughts')).toBeVisible();
  }

  for (const { w, h } of [
    { w: 1024, h: 768 },
    { w: 1280, h: 800 },
  ]) {
    test(`every data-map menu item can be clicked with the feed showing at ${w}x${h}`, async ({ page }) => {
      test.setTimeout(300_000);
      const errs = watchErrors(page);
      await page.setViewportSize({ width: w, height: h });
      await townWithThoughts(page);
      const thoughts = page.getByTestId('thoughts');

      // Every item of the menu, as the player sees them.
      await page.getByTestId('tool-maps').click();
      const ids = await page
        .getByTestId('maps-menu')
        .locator('.map-item[data-testid]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')!));
      expect(ids.length, 'the menu lists the data maps').toBeGreaterThan(15);
      await shot(page, `fix-layout-p14-menu-${w}x${h}`);
      await page.getByTestId('tool-maps').click();

      for (const id of ids) {
        await expect(thoughts, `the feed is showing before ${id}`).toBeVisible();
        await page.getByTestId('tool-maps').click();
        // The click is the test: Playwright refuses it while something else (the feed) is over the item.
        await page.getByTestId(id).click({ timeout: 5000 });
        if (id === ids[0]) await expect(thoughts, 'the feed steps aside for the menu').toBeHidden();
        await expect(page.getByTestId('map-legend')).toBeVisible();
        await page.getByTestId('map-legend').getByRole('button').click();
        await expect(page.getByTestId('map-legend')).toBeHidden();
      }
      errs.check();
    });
  }

  test('the feed steps aside for the disasters menu too (820x1180)', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await townWithThoughts(page);
    await page.getByTestId('tool-disasters').click();
    await expect(page.getByTestId('thoughts')).toBeHidden();
    await shot(page, 'fix-layout-p14-disasters-820x1180');
    await page.getByTestId('disaster-earthquake').click({ timeout: 5000 });
    await page.getByTestId('tool-select').click();
    await expect(page.getByTestId('thoughts')).toBeVisible();
  });

  test('a drag that starts on a thought pans the map; a click on one still opens the building', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const errs = watchErrors(page);
    await townWithThoughts(page);
    const card = page.getByTestId('thoughts').locator('.thought').first();
    const box = (await card.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const before = await page.evaluate(() => window.__game!.getCamera());
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 200, cy - 80, { steps: 10 });
    await page.mouse.up();
    await frames(page, 4);
    const after = await page.evaluate(() => window.__game!.getCamera());
    expect(Math.hypot(after.x - before.x, after.z - before.z), 'the camera moved').toBeGreaterThan(20);
    await expect(page.getByTestId('inspector'), 'no building was picked').toBeHidden();
    await expect(page.getByTestId('thoughts')).toBeVisible();
    await shot(page, 'fix-layout-p14-drag');

    // A plain click is not a drag: it flies to the resident's building and opens it (M8).
    await page.getByTestId('thoughts').locator('.thought').first().click();
    await expect(page.getByTestId('inspector')).toBeVisible();
    errs.check();
  });
});
