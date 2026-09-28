import { expect, test, type Page } from '@playwright/test';
import { shot, watchErrors } from './helpers';

const screen = (page: Page, x: number, z: number) =>
  page.evaluate(([x, z]) => window.__game!.worldToScreen(x!, z!), [x, z]);
const frames = (page: Page, n = 2) => page.evaluate((n) => window.__game!.waitFrames(n), n);
const state = (page: Page) => page.evaluate(() => window.__game!.getState());

/** Tips off and the graphics check done (plus any other settings), before every navigation. */
async function settings(page: Page, extra: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((extra) => {
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...s, tips: false, graphicsChecked: true, ...extra }));
  }, extra);
}

/** Open a scenario from its URL, begin it and hold the clock (time moves only through `advance`). */
async function openScenario(page: Page, id: string, town: string): Promise<void> {
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
async function untilHour(page: Page, hour: number): Promise<void> {
  await page.evaluate(async (hour) => {
    const g = window.__game!;
    const now = (((await g.getState()).tick + 420) % 1440) / 60;
    await g.advance(Math.round(((((hour - now) % 24) + 24) % 24) * 60));
  }, hour);
}

/** The placement hint once the sim's preview for the pointer's spot has come back and settled. */
async function settledHint(page: Page): Promise<{ tone: string; text: string }> {
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
async function placeFromToolbar(
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
async function pauseMenu(page: Page): Promise<void> {
  for (let k = 0; k < 3 && !(await page.getByTestId('pause-settings').isVisible()); k++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  await expect(page.getByTestId('pause-settings')).toBeVisible();
}

test('M22: Long Winter through the UI: the weather panel, locked settings, a coal plant and a depot from the toolbar, snow and ploughs', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errs = watchErrors(page);
  await openScenario(page, 'winter', 'Frostvale');
  const c = await page.evaluate(async () => ({ x: 24, z: (await window.__game!.getState()).highwayZ }));
  const X = (dx: number) => c.x + dx;
  const Z = (dz: number) => c.z + dz;
  const start = await state(page);
  expect(start.weather).toMatchObject({ climate: 'alpine', seasons: true, intensity: 2, season: 'autumn' });

  // --- The date in the top bar says the season and temperature, and opens the weather panel. ---
  await expect(page.getByTestId('weather')).toContainText('Autumn');
  await expect(page.getByTestId('weather')).toContainText('°C');
  await page.getByTestId('weather').click();
  await expect(page.getByTestId('weather-panel')).toContainText('Alpine climate');
  await page.getByTestId('weather').click();
  await expect(page.getByTestId('weather-panel')).toHaveCount(0);

  // --- The advisors warn that winter will need more power than the town has. ---
  await page.keyboard.press('j');
  await expect(page.getByTestId('advisors')).toContainText('Winter will need more power');
  await page.keyboard.press('j');
  await expect(page.getByTestId('advisors')).toHaveCount(0);

  // --- Settings: the scenario sets its own seasons and weather, so they're locked. ---
  await pauseMenu(page);
  await page.getByTestId('pause-settings').click();
  await expect(page.getByTestId('set-seasons')).toBeDisabled();
  await expect(page.getByTestId('weather-intensity-2')).toBeDisabled();
  await expect(page.getByTestId('settings-screen')).toContainText('this scenario sets its own');
  await page.getByTestId('shell-back').click();
  await page.getByTestId('pause-resume').click();
  await page.evaluate(() => window.__game!.setSpeed(0));

  // --- A coal plant by the industry and a public works depot, from the toolbar. ---
  await page.evaluate((p) => window.__game!.setCamera(p), {
    x: X(480),
    z: Z(0),
    distance: 1000,
    yaw: 0,
    tilt: 0.8,
  });
  await frames(page);
  await placeFromToolbar(page, 'power', 'coal', [
    [X(780), Z(-270)],
    [X(660), Z(-270)],
    [X(540), Z(-270)],
    [X(420), Z(-270)],
    [X(895), Z(-120)],
    [X(780), Z(270)],
    [X(660), Z(270)],
    [X(540), Z(270)],
    [X(895), Z(120)],
  ]);
  // The depot lives on the Garbage and snow button.
  await page.getByTestId('tool-garbage').hover();
  await expect(page.getByRole('tooltip')).toContainText('ploughs to clear snow');
  await placeFromToolbar(page, 'garbage', 'works', [
    [X(360), Z(-262)],
    [X(300), Z(-262)],
    [X(420), Z(-262)],
    [X(240), Z(-262)],
    [X(360), Z(262)],
    [X(300), Z(262)],
    [X(420), Z(262)],
    [X(180), Z(262)],
  ]);

  // --- Play the winter out, six hours at a time: heating lifts demand; snow falls and is ploughed. ---
  const rows: string[] = [];
  let peak = 0;
  let snowiest = 0;
  for (let m = 0; m < 6; m++) {
    if ((await page.evaluate(() => window.__game!.getScenario())).summary?.status !== 'playing') break;
    let demand = 0;
    let snowy = 0;
    let temp = 0;
    for (let q = 0; q < 4; q++) {
      await page.evaluate(() => window.__game!.advance(360));
      const s = await state(page);
      demand += s.utilities.power.demand / 4;
      snowy = Math.max(snowy, s.weather.roadsSnowy);
      temp += s.weather.mean / 4;
    }
    const s = await state(page);
    rows.push(
      `${s.weather.season} ${temp.toFixed(0)} °C ${Math.round(demand)} MW, up to ${Math.round(snowy * 100)} % of roads snowy`,
    );
    peak = Math.max(peak, demand);
    snowiest = Math.max(snowiest, snowy);
  }
  console.log(`[m22] Frostvale from ${Math.round(start.utilities.power.demand)} MW: ${rows.join(' | ')}`);
  expect(peak).toBeGreaterThan(start.utilities.power.demand * 1.03);
  expect(snowiest).toBeGreaterThan(0.05);
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getScenario())).summary?.status, {
      timeout: 60_000,
    })
    .toBe('won');
  const sum = (await page.evaluate(() => window.__game!.getScenario())).summary!;
  console.log(`[m22] Long Winter won in ${sum.monthsTaken.toFixed(1)} months, ${sum.stars} stars`);
  await expect(page.getByTestId('scenario-end')).toContainText('Scenario won!');
  await page.getByTestId('scenario-end').getByRole('button', { name: 'Keep playing' }).click();
  await expect(page.getByTestId('scenario-end')).toHaveCount(0);

  // --- A snowstorm in the morning: the roads fill, the inspector says how much it slows them. ---
  await untilHour(page, 9);
  await page.evaluate(() =>
    window.__game!.dispatch({ type: 'cheat', cheat: 'weather', kind: 'snow', strength: 0.9, hours: 8 }),
  );
  await page.evaluate(() => window.__game!.advance(120));
  await page.evaluate((p) => window.__game!.setCamera(p), {
    x: X(420),
    z: Z(-40),
    distance: 520,
    yaw: 0.35,
    tilt: 0.6,
  });
  await frames(page);
  let snowLine = '';
  for (const [x, z] of [
    [X(120), Z(-110)],
    [X(240), Z(110)],
    [X(480), Z(-110)],
    [X(600), Z(110)],
    [X(720), Z(-110)],
  ] as const) {
    const p = await screen(page, x, z);
    await page.mouse.click(p.x, p.y);
    await frames(page);
    if (await page.getByTestId('road-snow').isVisible()) {
      snowLine = (await page.getByTestId('road-snow').textContent()) ?? '';
      break;
    }
  }
  expect(snowLine).toMatch(/slower/);
  expect(snowLine).toContain('Ploughs clear roads');
  await page.keyboard.press('Escape');

  // Two more hours: the ploughs are out.
  await page.evaluate(() => window.__game!.advance(120));
  await frames(page);
  await page.getByTestId('weather').click();
  await expect(page.getByTestId('weather-panel')).toContainText('Snow on');
  await expect(page.getByTestId('weather-panel')).toContainText('Heating');
  await shot(page, 'm22-panel');
  await page.getByTestId('weather').click();

  // --- The depot's inspector: ploughs out and road cleared; the camera on one of them. ---
  const depot = await page.evaluate(() => window.__game!.getCivics().find((c) => c.def === 'works')!);
  await page.evaluate(
    (d) => window.__game!.setCamera({ x: d.x, z: d.z, yaw: 2.2, distance: 170, tilt: 0.5 }),
    depot,
  );
  await frames(page);
  const dp = await screen(page, depot.x, depot.z);
  await page.mouse.click(dp.x, dp.y);
  await expect(page.getByTestId('plough-details')).toContainText('Ploughs out');
  await expect(page.getByTestId('plough-details')).toContainText('of 3');
  const cleared = Number(
    (await page.getByTestId('plough-details').innerText()).match(/([\d.]+) km today/)?.[1] ?? 0,
  );
  expect(cleared).toBeGreaterThan(0);
  const ploughs = await page.evaluate(() => window.__game!.getVehicles().filter((v) => v.kind === 'plough'));
  console.log(`[m22] ${ploughs.length} ploughs out: ${await page.getByTestId('plough-details').innerText()}`);
  expect(ploughs.length).toBeGreaterThan(0);
  await page.evaluate(
    (v) => window.__game!.setCamera({ x: v.x, z: v.z, yaw: 0.6, distance: 110, tilt: 0.45 }),
    ploughs[0]!,
  );
  await shot(page, 'm22-plough');

  // --- With the scenario won, Settings change this city's weather. ---
  await pauseMenu(page);
  await page.getByTestId('pause-settings').click();
  await expect(page.getByTestId('set-seasons')).toBeEnabled();
  await page.getByTestId('set-seasons').uncheck();
  await expect.poll(async () => (await state(page)).weather.seasons).toBe(false);
  await page.getByTestId('weather-intensity-3').click();
  await expect.poll(async () => (await state(page)).weather.intensity).toBe(3);
  await page.getByTestId('set-seasons').scrollIntoViewIfNeeded();
  await shot(page, 'm22-settings');
  await page.getByTestId('set-seasons').check();
  await page.getByTestId('weather-intensity-2').click();
  await expect.poll(async () => (await state(page)).weather).toMatchObject({ seasons: true, intensity: 2 });
  await page.getByTestId('shell-back').click();
  await page.getByTestId('pause-resume').click();
  errs.check();
});

test('M22: every season and kind of weather, set from photo mode', async ({ page }) => {
  test.setTimeout(900_000);
  const errs = watchErrors(page);
  await openScenario(page, 'market', 'Kingsmere');
  await untilHour(page, 13);
  const view = { x: 330, z: 905, yaw: 0.55, distance: 460, tilt: 0.22 };
  await page.getByTestId('tool-photo').click();
  await expect(page.getByTestId('photo-panel')).toBeVisible();

  /** Pick a season and weather in the panel, hide it and photograph the city. */
  const look = async (name: string, season: string, weather: string) => {
    if (!(await page.getByTestId('photo-panel').isVisible())) await page.keyboard.press('h');
    await page.getByTestId(`photo-season-${season}`).click();
    await page.getByTestId(`photo-weather-${weather}`).click();
    await expect(page.getByTestId(`photo-season-${season}`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId(`photo-weather-${weather}`)).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('photo-hide').click();
    await expect(page.getByTestId('photo-panel')).toHaveCount(0);
    // The "H shows the controls" hint stays up for 2.5 s.
    await page.waitForTimeout(2800);
    await expect(page.getByTestId('photo-hint')).toHaveCount(0, { timeout: 10_000 });
    await page.evaluate((v) => window.__game!.setCamera(v), view);
    await frames(page, 3);
    const w = await page.evaluate(() => window.__game!.getWeather());
    expect(w.look.kind).toBe(weather);
    const s = { spring: 0, summer: 1, autumn: 2, winter: 3 }[season]!;
    expect(w.look.season[s]).toBeCloseTo(1, 1);
    if (weather === 'rain' || weather === 'snow') expect(w.particles).toBeGreaterThan(0);
    if (weather === 'fog') expect(w.fog).toBeGreaterThan(0.3);
    if (weather === 'cloudy' || weather === 'storm') expect(w.overcast).toBeGreaterThan(0.3);
    await shot(page, `m22-${name}`);
  };
  for (const [name, season, weather] of [
    ['spring', 'spring', 'clear'],
    ['summer', 'summer', 'clear'],
    ['autumn', 'autumn', 'clear'],
    ['cloudy', 'summer', 'cloudy'],
    ['rain', 'spring', 'rain'],
    ['storm', 'summer', 'storm'],
    ['heat', 'summer', 'heat'],
    ['fog', 'autumn', 'fog'],
  ] as const)
    await look(name, season, weather);

  // The panel itself, on an autumn fog.
  await page.keyboard.press('h');
  await expect(page.getByTestId('photo-panel')).toBeVisible();
  await page.getByTestId('photo-weather-fog').scrollIntoViewIfNeeded();
  await shot(page, 'm22-photo');

  // --- Winter: real snow in the sim first, so it lies on the roads as well as the fields. ---
  await page.getByTestId('photo-exit').click();
  await expect(page.getByTestId('photo-panel')).toHaveCount(0);
  await page.evaluate(() =>
    window.__game!.dispatch({ type: 'cheat', cheat: 'weather', kind: 'snow', strength: 1, hours: 12 }),
  );
  await page.evaluate(() => window.__game!.advance(600));
  await untilHour(page, 13);
  expect((await state(page)).weather.roadsSnowy).toBeGreaterThan(0.3);
  await page.getByTestId('tool-photo').click();
  await look('winter', 'winter', 'clear');
  await look('snow', 'winter', 'snow');
  await page.keyboard.press('h');
  await page.getByTestId('photo-exit').click();
  errs.check();
});

test('M22: a new city takes its climate from the map, and seasons and weather from Settings', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errs = watchErrors(page);
  await settings(page, { seasons: false, weather: 1 });
  await page.goto('./');
  await page.getByTestId('main-new').click();
  await expect(page.getByTestId('new-climate')).toContainText('Temperate climate');
  await page.getByTestId('preset-highlands').click();
  await expect(page.getByTestId('new-climate')).toContainText('Alpine climate');
  await page.getByTestId('new-start').click();
  await page.waitForFunction(
    () => window.__game?.ready === true && window.__game.getShell().mode === 'play',
    null,
    { timeout: 120_000 },
  );
  await expect
    .poll(async () => (await state(page)).weather)
    .toMatchObject({ climate: 'alpine', seasons: false, intensity: 1 });
  await expect(page.getByTestId('weather')).toContainText('No seasons');
  errs.check();
});
