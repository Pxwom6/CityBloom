// Dev (M39 step 4): the battle map, as the attacker and as the defender mid-battle, with units chosen
// and Focus armed, the handed-over state, a spectator's view, and a phone-width sheet. Builds the test
// town (as battleshot.mjs), then stages live battles in the one page with the test API's stageLive (a
// stand-in plays the region room) and shoots the map. Prints what the map reports at each moment.
// Usage: npm run build:test && node scripts/dev/battlemapshot.mjs outDir
// Env: QUALITY=low (low|medium|high), PORT=4393, SEED=port, ONLY=attacker,armed,sent,defender,handed,watcher,phone,touch
// (a scene's earlier ones run first when it needs them)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'battlemap-shots';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4393);
const quality = process.env.QUALITY ?? 'low';
const only = process.env.ONLY?.split(',');
const want = (n) => !only || only.includes(n);
const server = spawn(
  'npx',
  ['vite', 'preview', '--outDir', 'dist-test', '--port', String(port), '--strictPort'],
  { stdio: 'ignore', detached: true },
);
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
});
const t0 = Date.now();
const log = (...a) => console.log(`[battlemapshot ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
let code = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(
    `http://localhost:${port}/?paused=1&rivals=1&preset=coast&seed=${process.env.SEED ?? 'port'}`,
  );
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 90000 });
  await page.evaluate(
    (q) => window.__game.setSettings({ quality: q, graphicsChecked: true, tips: false }),
    quality,
  );
  const town = await page.evaluate(async () => {
    const g = window.__game;
    const fails = [];
    const d = async (cmd) => {
      const r = await g.dispatch(cmd);
      if (!r.ok) fails.push(`${cmd.type} ${cmd.road ?? cmd.def ?? cmd.kind ?? ''}: ${r.reason}`);
      return r;
    };
    await d({ type: 'cheat', cheat: 'unlockAll' });
    await d({ type: 'cheat', cheat: 'addMoney', amount: 8_000_000 });
    const s = await g.getState();
    const hw = { x: 24, z: s.highwayZ };
    const at = (dx, dz) => ({ x: hw.x + dx, z: hw.z + dz });
    await d({ type: 'buildRoad', road: 'avenue', points: [hw, at(480, 0)] });
    for (const x of [96, 192, 288, 384])
      await d({ type: 'buildRoad', road: 'street', points: [at(x, -160), at(x, 160)] });
    const brush = (zone, a, b, radius) =>
      d({ type: 'zone', zone, area: { kind: 'brush', points: [a, b], radius } });
    await brush('R', at(20, -100), at(480, -100), 70);
    await brush('C', at(20, 20), at(480, 20), 22);
    await brush('R', at(20, 90), at(240, 90), 50);
    await brush('I', at(260, 110), at(480, 110), 50);
    let util = null;
    for (const dz of [230, 250, 270, 210, 290]) {
      const pts = [at(30, dz), at(470, dz)];
      if ((await g.preview({ type: 'buildRoad', road: 'street', points: pts })).ok) {
        await d({ type: 'buildRoad', road: 'street', points: pts });
        util = dz;
        break;
      }
    }
    for (const x of [96, 192, 288, 384])
      await d({ type: 'buildRoad', road: 'street', points: [at(x, 160), at(x, util)] });
    for (const def of ['coal', 'coal', 'pump', 'pump', 'treatment', 'landfill', 'pump'])
      await g.placeCivic(def, at(240, util));
    for (const def of ['firestation', 'police', 'clinic', 'primary']) await g.placeCivic(def, at(240, 0));
    await g.advance(1440 * 3);
    const bases = {};
    for (const [def, near] of [
      ['militaryhq', at(300, -160)],
      ['barracks', at(380, -160)],
      ['vehicledepot', at(200, 160)],
      ['bunker', at(100, -160)],
      ['bunker', at(140, 0)],
      ['shelter', at(200, -160)],
      ['antiair', at(100, 160)],
    ]) {
      const id = await g.placeCivic(def, near);
      if (id === null) fails.push(`place ${def}`);
      else bases[def] = id;
    }
    for (const kind of ['infantry', 'infantry', 'infantry', 'infantry'])
      await d({ type: 'trainUnit', base: bases.barracks, kind });
    for (const kind of ['tank', 'tank', 'artillery'])
      await d({ type: 'trainUnit', base: bases.vehicledepot, kind });
    for (let k = 0; k < 8; k++) await g.advance(1440);
    return { fails, bases };
  });
  log('town', JSON.stringify(town));

  // A force the town's defenders can meet (the stage's own is every sort, and wipes them out).
  const SMALL = ['tank', 'tank', 'infantry', 'infantry', 'infantry', 'helicopter'];
  const api = (fn, arg) => page.evaluate(fn, arg);
  const report = () => api(() => window.__game.battleMap());
  const waitFor = async (what, test, arg, ms = 120000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      if (await api(test, arg)) return true;
      await page.waitForTimeout(400);
    }
    log('timed out waiting for', what);
    return false;
  };
  const panel = page.getByTestId('battle-map');
  const snap = async (name, opts = {}) => {
    await page.evaluate(() => window.__game.waitFrames(2));
    await page.screenshot({ path: `${out}/${name}.png`, timeout: 240000 });
    if (opts.panel !== false)
      await panel.screenshot({ path: `${out}/${name}-panel.png`, timeout: 240000 }).catch(() => undefined);
    const r = await report();
    log(
      name,
      JSON.stringify({
        role: r.role,
        step: r.step,
        allow: r.allow,
        units: r.units,
        structs: r.structs,
        selected: r.selected.length,
        armed: r.armed,
        handed: r.handed,
        over: r.over,
        canvas: r.canvas,
        log: r.log.map((e) => `${e.kind}:${e.state}`),
      }),
    );
  };
  const begin = async (role, hold, units) => {
    const why = await api(
      ([r, h, u]) => window.__game.stageLive(r, { hold: h, units: u }),
      [role, hold, units],
    );
    if (why) throw new Error(`stageLive ${role}: ${why}`);
  };
  /** Until the battle has run a while and units are on the field. */
  const running = (min) =>
    waitFor(
      'the battle to get going',
      (m) => {
        const r = window.__game.battleMap();
        return r.step >= m && (r.units.own + r.units.enemy > 0 || r.role === 'watcher');
      },
      min,
    );
  const endBattle = async () => {
    // The side that is not the player's walks away, or the player's force withdraws: over in seconds.
    await api(() => {
      const g = window.__game;
      const r = g.battleMap();
      if (r.role === 'attacker') g.liveOrder({ kind: 'withdraw' });
      else g.liveSay(0, { kind: 'withdraw' });
      g.liveRelease();
    });
    await waitFor('the battle to end', () => window.__game.battleMap().over, undefined, 90000);
  };

  // ---------------------------------------------------------------- the attacker
  if (want('attacker') || want('armed') || want('sent') || want('phone') || want('touch')) {
    await begin('attacker', 200);
    await waitFor('the live bar', () => !!document.querySelector('[data-testid="live-command"]'));
    await page.evaluate(() => window.__game.waitFrames(2));
    if (want('attacker')) await page.screenshot({ path: `${out}/attacker-bar.png`, timeout: 240000 });
    await page.getByTestId('live-command').click();
    await running(195);
    if (want('attacker')) await snap('attacker');
    // Everything chosen, Focus armed, the pointer over an objective.
    await page.getByTestId('map-select-all').click();
    await page.getByTestId('map-order-focus').click();
    const pts = await api(() => window.__game.battleMapPoints());
    const goal =
      pts.structs.find((s) => s.objective && s.state !== 2 && s.visible) ??
      pts.structs.find((s) => s.visible);
    await page.mouse.move(goal.x, goal.y);
    if (want('armed')) await snap('attacker-armed');
    await page.mouse.click(goal.x, goal.y);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__game.waitFrames(2));
    // A box round some units, Hold: sent and heard.
    const p2 = await api(() => window.__game.battleMapPoints());
    const some = p2.own.filter((u) => u.visible).slice(0, 3);
    if (some.length) {
      const xs = some.map((u) => u.x);
      const ys = some.map((u) => u.y);
      await page.mouse.move(Math.min(...xs) - 14, Math.min(...ys) - 14);
      await page.mouse.down();
      await page.mouse.move(Math.max(...xs) + 14, Math.max(...ys) + 14, { steps: 6 });
      if (want('sent')) await snap('attacker-box', { panel: false });
      await page.mouse.up();
      await page.getByTestId('map-order-hold').click();
      await waitFor(
        'the room to answer',
        () => window.__game.battleMap().log.every((e) => e.state === 'stamped'),
        undefined,
        20000,
      );
    }
    if (want('sent')) await snap('attacker-sent');
    if (want('phone') || want('touch')) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(800);
      await page.evaluate(() => window.__game.waitFrames(3));
      await snap('phone-attacker');
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(500);
    }
    await endBattle();
    if (want('sent')) await snap('attacker-over');
    await page.getByTestId('map-close').click();
  }

  // ---------------------------------------------------------------- the defender
  if (want('defender') || want('handed')) {
    await begin('defender', 130, SMALL);
    await waitFor(
      'the battle bar',
      () => !!document.querySelector('[data-testid="battle-command"]'),
      undefined,
      90000,
    );
    await page.evaluate(() => window.__game.waitFrames(2));
    if (want('defender')) await page.screenshot({ path: `${out}/defender-bar.png`, timeout: 240000 });
    await page.getByTestId('battle-command').click();
    await running(125);
    if (process.env.PROBE) {
      log('probe', JSON.stringify(await report()));
      log(
        'probe frame',
        JSON.stringify(
          await api(() => {
            const g = window.__game;
            const b = g.getBattle();
            return {
              sim: b.frame,
              live: g.getLive(),
              btn: document.querySelector('[data-testid="map-select-all"]')?.outerHTML,
            };
          }),
        ),
      );
      throw new Error('probe done');
    }
    await page.getByTestId('map-select-all').click();
    const pts = await api(() => window.__game.battleMapPoints());
    // Guard the military building that is aimed at.
    await page.getByTestId('map-order-guard').click();
    const goal = pts.structs.find((s) => s.objective && s.state !== 2 && s.visible);
    if (goal) await page.mouse.move(goal.x, goal.y);
    if (want('defender')) await snap('defender-guard-armed');
    if (goal) await page.mouse.click(goal.x, goal.y);
    await page.waitForTimeout(1500);
    if (want('defender')) await snap('defender');
    if (want('handed')) {
      await api(() => window.__game.liveHandOver());
      await waitFor('the hand-over', () => window.__game.battleMap().handed, undefined, 20000);
      await snap('defender-handed');
      await page.getByTestId('map-rejoin').click();
      await waitFor('command back', () => !window.__game.battleMap().handed, undefined, 20000);
      await snap('defender-back');
    }
    await endBattle();
    if (want('defender')) await snap('defender-over');
    await page.getByTestId('map-close').click();
  }

  // ---------------------------------------------------------------- a spectator
  if (want('watcher')) {
    // The city's own sim has to be done with the defender's battle first.
    await page.evaluate(() => window.__game.advance(120));
    await begin('watcher', 130, SMALL);
    await waitFor(
      'the invitation',
      () => !!document.querySelector('[data-testid="live-watch"]'),
      undefined,
      30000,
    );
    await page.evaluate(() => window.__game.waitFrames(2));
    await page.screenshot({ path: `${out}/watcher-bar.png`, timeout: 240000 });
    await page.getByTestId('live-watch').click();
    await running(125);
    await snap('watcher');
    // The phone sheet of a watcher.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__game.waitFrames(3));
    await snap('phone-watcher');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('map-close').click();
  }
  if (errors.length) {
    log('console errors:', errors.slice(0, 8).join(' | '));
  }
} catch (err) {
  console.error(err);
  code = 1;
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {
    /* already gone */
  }
}
process.exit(code);
