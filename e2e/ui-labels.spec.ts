import { expect, test, type Page } from '@playwright/test';
import { auditButtons, buildTownViaApi, openGame, serveTownViaApi, shot, watchErrors } from './helpers';

/**
 * Every visible button in the interface says what it does: it has a label or accessible name, and
 * any text on it is readable (a danger button once drew red text on red). The test walks the menus,
 * every tool, panel and inspector, and audits the buttons in each state.
 */
const CATEGORIES = [
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
];

async function menuBooted(page: Page) {
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'menu', null, {
    timeout: 90_000,
  });
}

/** Click a civic building of this kind on the map, as a player would, to open its inspector. */
async function inspectCivic(page: Page, def: string) {
  const c = await page.evaluate((def) => window.__game!.getCivics().find((c) => c.def === def)!, def);
  await page.evaluate(
    (c) => window.__game!.setCamera({ x: c.x, z: c.z, distance: 110, yaw: 0.3, tilt: 0.3 }),
    c,
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
  const p = await page.evaluate((c) => window.__game!.worldToScreen(c.x, c.z), c);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('inspector')).toBeVisible();
}

test('every visible button has a readable label or accessible name, across the interface', async ({
  page,
}) => {
  test.setTimeout(480_000);
  const errs = watchErrors(page);
  const problems: string[] = [];
  const check = async (where: string) => {
    await page.evaluate(() => window.__game!.waitFrames(1));
    // Judge the settled interface: a button just made active fades its background in while its
    // text turns white at once, so wait out any transitions still running.
    await page
      .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, {
        timeout: 5_000,
      })
      .catch(() => undefined);
    problems.push(...(await auditButtons(page, where)));
  };

  // The main menu and the screens behind it.
  await page.goto('./');
  await menuBooted(page);
  // The audit itself catches a nameless icon button and red-on-red text.
  await page.evaluate(() => {
    const ui = document.getElementById('ui')!;
    ui.insertAdjacentHTML(
      'beforeend',
      '<div id="probe" style="position:fixed;left:8px;top:300px;z-index:99;pointer-events:auto">' +
        '<button><svg aria-hidden="true" width="16" height="16"></svg></button>' +
        '<button style="background:#d2493b;color:#d2493b">Bulldoze</button></div>',
    );
  });
  const planted = await auditButtons(page, 'planted');
  expect(planted.some((p) => p.includes('no label or accessible name'))).toBe(true);
  expect(planted.some((p) => p.includes('"Bulldoze" is unreadable'))).toBe(true);
  await page.evaluate(() => document.getElementById('probe')!.remove());
  await check('main menu');
  await page.getByTestId('main-settings').click();
  await check('settings (main menu)');
  await page.getByTestId('shell-back').click();
  await page.getByTestId('main-new').click();
  await check('new city');
  await page.getByTestId('shell-back').click();
  await page.getByTestId('main-load').click();
  await check('load city (empty)');
  await page.getByTestId('shell-back').click();

  // The map editor (M24): its screen, the editor with a brush in hand, and the playability check.
  await page.getByTestId('main-editor').click();
  await check('map editor screen');
  await page.getByTestId('maps-base-flat').click();
  await page.getByTestId('maps-new').click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'editor', null, {
    timeout: 120_000,
  });
  await page.getByTestId('brush-ore').click();
  await check('map editor');
  await page.getByTestId('editor-status').click();
  await expect(page.getByTestId('editor-check')).toBeVisible();
  await check('map editor: playability');

  // A city: first without power, with tips on, so a contextual tip shows.
  await openGame(page);
  await page.evaluate(() => window.__game!.setSettings({ tips: true, seenTips: [] }));
  await buildTownViaApi(page);
  await page.evaluate(() => window.__game!.advance(700));
  await expect(page.getByTestId('tip')).toBeVisible({ timeout: 30_000 });
  await check('contextual tip');
  await page.getByTestId('tip-off').click();
  await serveTownViaApi(page);
  await page.evaluate(async () => {
    const g = window.__game!;
    // Enough for every service below (roads cost more with earthworks since M13; money isn't under test).
    await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 100_000 });
    for (const def of ['firestation', 'police', 'clinic', 'primary', 'park_small', 'busdepot'])
      await g.placeCivic(def, { x: 300, z: (await g.getState()).highwayZ + 170 });
    await g.advance(1440 * 2);
  });
  await check('city: top bar and toolbar');

  // Every tool and its options.
  for (const tool of ['road', 'zone', ...CATEGORIES, 'bulldoze']) {
    await page.getByTestId(`tool-${tool}`).click();
    await check(`tool: ${tool}`);
  }
  await page.getByTestId('tool-select').click();
  await page.getByTestId('tool-disasters').click();
  await expect(page.getByTestId('disasters-menu')).toBeVisible();
  await check('disasters menu');
  await page.getByTestId('tool-disasters').click();
  await page.getByTestId('tool-maps').click();
  await check('data maps menu');
  await page.getByTestId('map-power').click();
  await expect(page.getByTestId('map-legend')).toBeVisible();
  await check('data map legend');
  await page.getByTestId('map-legend').getByRole('button').click();

  // Panels, and every budget tab.
  await page.getByTestId('open-budget').click();
  for (const tab of ['overview', 'taxes', 'funding', 'loans', 'history']) {
    await page.getByTestId(`budget-tab-${tab}`).click();
    await check(`budget: ${tab}`);
  }
  await page.getByTestId('open-budget').click();
  for (const panel of ['advisors', 'notifications', 'city']) {
    await page.getByTestId(`open-${panel}`).click();
    await check(`panel: ${panel}`);
    await page.getByTestId(`open-${panel}`).click();
  }

  // Inspectors: a home, and service and utility buildings.
  const home = await page.evaluate(() =>
    window.__game!.getBuildings().find((b) => b.zone === 1 && b.state === 1)!,
  );
  await page.evaluate(
    (b) => window.__game!.setCamera({ x: b.x, z: b.z, distance: 140, yaw: 0.3, tilt: 0.4 }),
    home,
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
  const hp = await page.evaluate((b) => window.__game!.worldToScreen(b.x, b.z), home);
  await page.mouse.click(hp.x, hp.y);
  await expect(page.getByTestId('inspector')).toBeVisible();
  await check('inspector: home');
  await page.keyboard.press('Escape');
  for (const def of ['pump', 'landfill', 'firestation', 'busdepot']) {
    await inspectCivic(page, def);
    await check(`inspector: ${def}`);
    await page.keyboard.press('Escape');
  }

  // Bulldozing asks first, says what comes back, and "Keep it" keeps it.
  await inspectCivic(page, 'pump');
  const bulldoze = page.getByTestId('bulldoze');
  await expect(bulldoze).toHaveText(/^Bulldoze \(refund \$[\d,]+\)$/);
  await expect(bulldoze.locator('svg')).toBeVisible();
  await shot(page, 'playtest-bulldoze');
  const civics = (await page.evaluate(() => window.__game!.getCivics())).length;
  await bulldoze.click();
  await expect(page.getByTestId('bulldoze-confirm')).toContainText(/Undo \((Ctrl\+Z|⌘Z)\) brings it back/);
  await check('inspector: bulldoze confirmation');
  await shot(page, 'playtest-bulldoze-confirm');
  await page.getByTestId('bulldoze-cancel').click();
  await expect(page.getByTestId('bulldoze')).toBeVisible();
  expect((await page.evaluate(() => window.__game!.getCivics())).length).toBe(civics);
  await page.keyboard.press('Escape');

  // The debug panel.
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-panel')).toBeVisible();
  await check('debug panel');
  await page.keyboard.press('Backquote');

  // The pause menu and the screens inside it, with a save to list and delete.
  await page.getByTestId('menu-button').click();
  await check('pause menu');
  await page.getByTestId('pause-save').click();
  await check('save screen');
  await page.getByTestId('save-name').fill('Label check');
  await page.getByTestId('save-new').click();
  await expect(page.getByTestId('toast').first()).toContainText('Saved');
  await page.getByTestId('pause-load').click();
  await check('load screen');
  await page
    .getByTestId('slot-list')
    .getByRole('button', { name: /delete/i })
    .first()
    .click();
  await check('load screen: delete confirmation');
  await page.getByTestId('shell-back').click();
  await page.getByTestId('pause-settings').click();
  await check('settings (pause menu)');
  // Starting the tutorial closes the menus.
  await page.getByTestId('restart-tutorial').click();
  await expect(page.getByTestId('tutorial')).toBeVisible();
  await check('tutorial');

  expect(problems, problems.join('\n')).toEqual([]);
  errs.check();
});
