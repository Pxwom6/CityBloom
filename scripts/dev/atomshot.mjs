// Dev (M40 step 11a): the atom bomb's interface. A coast town at war with computer rivals, every tier
// researched, a nuclear plant, a military HQ, the enrichment plant, the silo and a dome shield; then
// the war room's Bomb tab at each stage of the race (racing, ready with the launch card held halfway
// and let go, prepared, used with fallout), the countdown card for a bomb on its way (the dome off,
// raised from the card, stopping the bomb), the card a bomb leaves behind, the war room's Map tab with
// the race's marks and a strike's arc and cloud, the radiation map with the clean-up tool out, and
// the phone width. Prints what the page reports (test API getAtom) at each moment.
// Usage: npm run build:test && node scripts/dev/atomshot.mjs outDir
// Env: QUALITY=low (low|medium|high), PORT=4394, SEED=port, ONLY=racing,ready,hold,prepared,map,
//   countdown,raised,stopped,hit,used,clean,phone,settings  (a scene's earlier ones run first when it needs them)
//   PW_CHROMIUM=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
//   when the Playwright revision is missing (CLAUDE.md).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'atom-shots';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4394);
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
const log = (...a) => console.log(`[atomshot ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
let code = 0;
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true });
  const page = await context.newPage();
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
  const api = (fn, arg) => page.evaluate(fn, arg);
  // NOSHOT=1: play every scene and check what the page reports, without taking the (slow) pictures.
  const pic = (target, name) =>
    process.env.NOSHOT
      ? Promise.resolve()
      : target.screenshot({ path: `${out}/${name}.png`, timeout: 240000 });

  // ---------------------------------------------------------------- the town
  const built = await api(async () => {
    const g = window.__game;
    const fails = [];
    const d = async (cmd) => {
      const r = await g.dispatch(cmd);
      if (!r.ok) fails.push(`${cmd.type} ${cmd.cheat ?? cmd.road ?? cmd.def ?? cmd.kind ?? ''}: ${r.reason}`);
      return r;
    };
    await d({ type: 'cheat', cheat: 'unlockAll' });
    await d({ type: 'cheat', cheat: 'addMoney', amount: 90_000_000 });
    const s = await g.getState();
    const hw = { x: 24, z: s.highwayZ };
    const at = (dx, dz) => ({ x: hw.x + dx, z: hw.z + dz });
    await d({ type: 'buildRoad', road: 'avenue', points: [hw, at(480, 0)] });
    for (const x of [96, 192, 288, 384])
      await d({ type: 'buildRoad', road: 'street', points: [at(x, -300), at(x, 160)] });
    const brush = (zone, a, b, radius) =>
      d({ type: 'zone', zone, area: { kind: 'brush', points: [a, b], radius } });
    await brush('R', at(20, -100), at(480, -100), 70);
    await brush('R', at(20, -230), at(480, -230), 70);
    await brush('C', at(20, 20), at(480, 20), 22);
    await brush('R', at(20, 90), at(240, 90), 50);
    await brush('I', at(260, 110), at(480, 110), 50);
    let util = 250;
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
    // Power from a nuclear plant (it is the enrichment plant's own condition).
    for (const def of [
      'coal',
      'coal',
      'nuclear',
      'pump',
      'pump',
      'pump',
      'pump',
      'treatment',
      'treatment',
      'landfill',
    ])
      if ((await g.placeCivic(def, at(240, util))) === null) fails.push(`place ${def}`);
    for (const def of ['firestation', 'police', 'clinic', 'primary']) await g.placeCivic(def, at(240, 0));
    await g.advance(1440 * 3);
    await d({
      type: 'cheat',
      cheat: 'research',
      tiers: ['land', 'air', 'sea', 'defence', 'intel', 'logistics'].flatMap((b) =>
        [1, 2, 3, 4].map((t) => `${b}${t}`),
      ),
    });
    const ids = {};
    const put = async (def, near) => {
      const id = await g.placeCivic(def, near);
      if (id === null) fails.push(`place ${def}`);
      else {
        ids[def] = id;
        const c = (await g.getCivics()).find((x) => x.id === id);
        if (c?.stage !== undefined) await d({ type: 'cheat', cheat: 'finishStages', civic: id });
      }
      return id;
    };
    await put('militaryhq', at(300, -160));
    if ((await put('enrichment', at(100, -160))) === null) await put('enrichment', at(190, -300));
    if ((await put('atomsilo', at(380, -300))) === null) await put('atomsilo', at(100, -300));
    if ((await put('domeshield', at(60, 160))) === null) await put('domeshield', at(380, 160));
    const st = await g.getState();
    for (const n of st.region.neighbours.filter((x) => x.rival))
      await d({ type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 0.5, defences: 1 });
    await g.advance(60 * 12);
    return { ids, fails, rivals: st.region.neighbours.filter((x) => x.rival).map((n) => [n.id, n.name]) };
  });
  log('town', JSON.stringify(built));
  const [r1, r2, r3] = built.rivals.map(([id]) => id);
  // (The milestone banner and the toasts would sit over every picture of the interface.)
  await page.addStyleTag({ content: '.toasts, .milestone-banner { display: none !important; }' });
  await api(() => {
    const g = window.__game;
    g.showGroup('icons', false);
    g.setWeatherLook({ season: [0, 1, 0, 0], kind: 'clear', strength: 0, snow: 0, wet: 0 });
  });

  const cheat = async (c) => {
    const r = await api((cmd) => window.__game.dispatch({ type: 'cheat', ...cmd }), c);
    if (!r.ok) log('cheat refused', JSON.stringify(c), r.reason);
    return r;
  };
  const dispatch = async (cmd) => {
    const r = await api((x) => window.__game.dispatch(x), cmd);
    if (!r.ok) log('refused', JSON.stringify(cmd), r.reason);
    return r;
  };
  const atom = () => api(() => window.__game.getAtom());
  const brief = async (name) => {
    const a = await atom();
    const s = a.summary;
    log(
      name,
      JSON.stringify({
        stage: s?.stage,
        fuel: s?.fuel,
        tab: a.tab,
        hold: a.hold,
        race: a.race.map((r) => `${r.name}:${r.stage}${r.fuel !== null ? `/${r.fuel}` : ''}`),
        countdown: a.countdown && { eta: a.countdown.eta, dome: a.countdown.dome.text },
        after: a.after?.title ?? null,
        clean: a.cleanTool,
        map: a.radiationMap,
      }),
    );
  };
  const frames = (n = 3) => api((k) => window.__game.waitFrames(k), n);
  /** The war room panel, whole page too, by name; tall panels are shot at the top and scrolled to the end. */
  const shot = async (name, opts = {}) => {
    await frames(2);
    if (opts.full !== false) await pic(page, name);
    if (opts.panel) {
      const panel = page.getByTestId('war-room');
      if (await panel.count()) {
        await pic(panel, `${name}-panel`);
        const more = await api(() => {
          const el = document.querySelector('[data-testid="war-room"] .tab-body');
          if (!el || el.scrollHeight <= el.clientHeight + 4) return false;
          el.scrollTop = el.scrollHeight;
          return true;
        });
        if (more) {
          await frames(1);
          await pic(panel, `${name}-panel-end`);
          await api(() => {
            document.querySelector('[data-testid="war-room"] .tab-body').scrollTop = 0;
          });
        }
      }
    }
    await brief(name);
  };
  const bomb = async () => {
    await api(() => window.__game.openAtomTab());
    await frames(2);
  };
  const closeRoom = () =>
    api(() => {
      const g = window.__game;
      if (g.getWarRoom().open) g.openPanel('war');
    });
  const dismissCard = async () => {
    const ok = page.getByTestId('atom-after-ok');
    if (await ok.count()) await ok.click();
    await frames(1);
  };
  const setView = (pose) => api((p) => window.__game.setCamera(p), pose);

  // ---------------------------------------------------------------- racing
  if (want('racing') || want('map')) {
    await cheat({ cheat: 'atom', stage: 'enriching' });
    await cheat({ cheat: 'rivalBomb', neighbour: r2, stage: 'enriching', hours: 750 });
    await bomb();
    await shot('racing', { panel: true });
  }

  // ---------------------------------------------------------------- the race on the war room's map
  if (want('map')) {
    await cheat({ cheat: 'rivalBomb', neighbour: r2, stage: 'preparing', hours: 100 });
    await cheat({ cheat: 'atom', stage: 'ready' });
    await page.getByTestId('war-tab-map').click();
    await frames(2);
    await shot('map-race', { panel: true, full: false });
  }

  // ---------------------------------------------------------------- the bomb ready: the launch card
  if (want('ready') || want('hold') || want('prepared') || want('phone')) {
    await cheat({ cheat: 'rivalBomb', neighbour: r2, stage: 'none' });
    await cheat({ cheat: 'atom', stage: 'ready' });
    // A total war with the first rival, open.
    await dispatch({ type: 'declareWar', neighbour: r1, scale: 'total', reason: 'The race' });
    await api(async (id) => {
      const g = window.__game;
      const d = g.getDiplomacy();
      const w = d.wars.find((x) => x.with === id);
      const s = await g.getState();
      await g.advance(Math.max(0, w.opens - s.tick) + 2);
    }, r1);
    await bomb();
    await api(() => {
      const el = document.querySelector('[data-testid="war-room"] .tab-body');
      el.scrollTop = 0;
    });
    await shot('ready', { panel: true });
  }

  // ---------------------------------------------------------------- the hold: halfway, let go, then all the way
  if (want('hold') || want('prepared') || want('phone')) {
    await api(() => {
      document.querySelector('[data-testid="launch-hold"]').scrollIntoView({ block: 'center' });
    });
    await frames(2);
    const box = await page.getByTestId('launch-hold').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    // Stand still at 1.5 seconds into the hold for the picture (the clock a hold reads is frozen).
    await api((ms) => {
      const held = window.__game.getAtom().hold;
      const since = performance.now() - (held?.ms ?? 0);
      window.__realNow = performance.now.bind(performance);
      performance.now = () => since + ms;
    }, 1500);
    await page.waitForTimeout(500);
    await shot('hold-halfway', { full: false });
    await pic(page.getByTestId('war-room'), 'hold-halfway-panel');
    await api(() => {
      performance.now = window.__realNow;
    });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await atom();
    log('let go early: launch', JSON.stringify(after.summary.launch), 'hold', JSON.stringify(after.hold));
    if (after.summary.launch) throw new Error('letting go early still launched');
  }
  if (want('prepared')) {
    const box = await page.getByTestId('launch-hold').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(3600);
    await page.mouse.up();
    await page.waitForTimeout(500);
    await bomb();
    const a = await atom();
    if (!a.summary.launch) throw new Error('holding for three seconds did not start the launch');
    await shot('prepared', { panel: true });
  }

  // ---------------------------------------------------------------- the launch card on a phone, held by touch
  if (want('phone')) {
    // Back to a bomb in the silo (half the price back), then the phone's width.
    const cancel = page.getByTestId('atom-cancel-launch');
    if (await cancel.count()) await cancel.click();
    await frames(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    await bomb();
    await api(() => {
      document.querySelector('[data-testid="atom-launch-card"]').scrollIntoView({ block: 'start' });
    });
    await frames(2);
    await shot('phone-launch', { panel: false });
    await api(() => {
      document.querySelector('[data-testid="launch-hold"]').scrollIntoView({ block: 'center' });
    });
    await frames(2);
    const hold = await page.getByTestId('launch-hold').boundingBox();
    // What the button hears, with the page's own clock: a window that draws slowly can stretch the waits
    // between two calls, so the length of each press is read from the page, not guessed.
    await api(() => {
      const b = document.querySelector('[data-testid="launch-hold"]');
      window.__heard = [];
      for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'pointerleave', 'contextmenu'])
        b.addEventListener(t, () => window.__heard.push([t, Math.round(performance.now())]));
    });
    const cdp = await context.newCDPSession(page);
    const finger = {
      x: hold.x + hold.width / 2,
      y: hold.y + hold.height / 2,
      id: 1,
      radiusX: 2,
      radiusY: 2,
      force: 1,
    };
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    /** How long the last press lasted, by the page's clock (null: it has not been let go). */
    const pressed = async () => {
      const heard = await api(() => window.__heard.slice());
      const down = heard.findLast(([t]) => t === 'pointerdown');
      const up = heard.findLast(([t]) => t === 'pointerup' || t === 'pointercancel');
      return { heard, ms: down && up && up[1] >= down[1] ? up[1] - down[1] : null };
    };
    // A finger let go early: nothing starts. (In a window that draws slowly the call that lifts the finger can
    // be handled seconds after it is sent, and a press that really lasted three seconds does start the
    // launch: that try is not an early release, so it is called off and tried again, three times at most.)
    let early = null;
    for (let tries = 0; tries < 3 && early === null; tries++) {
      await touch('touchStart', [finger]);
      await page.waitForTimeout(150);
      await touch('touchEnd', []);
      await page.waitForTimeout(500);
      const press = await pressed();
      const a = await atom();
      log('touch let go after', press.ms, 'ms: launch', JSON.stringify(!!a.summary.launch));
      if (!a.summary.launch) early = 'nothing started';
      else {
        log('(that press lasted three seconds in this window: called off, again)');
        await page.getByTestId('atom-cancel-launch').click();
        await bomb();
      }
    }
    if (early === null) log('no early release could be timed in this window: skipped');
    // A finger held on: the launch starts.
    await touch('touchStart', [finger]);
    await page.waitForTimeout(3700);
    await touch('touchEnd', []);
    await page.waitForTimeout(600);
    log('touch held for', (await pressed()).ms, 'ms');
    await bomb();
    const held = await atom();
    log(
      'touch held: launch',
      JSON.stringify(held.summary.launch && { to: held.summary.launch.name, done: held.summary.launch.done }),
    );
    if (!held.summary.launch) throw new Error('a finger held for three seconds did not start the launch');
    await shot('phone-prepared', { panel: false });
    await page.getByTestId('atom-cancel-launch').click();
    await frames(1);
    await closeRoom();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(500);
  }

  // ---------------------------------------------------------------- a bomb on its way
  if (
    want('countdown') ||
    want('raised') ||
    want('stopped') ||
    want('hit') ||
    want('used') ||
    want('clean')
  ) {
    await closeRoom();
    await cheat({ cheat: 'atom', stage: 'spent', to: r3 });
    await cheat({ cheat: 'superReady' });
    await dispatch({ type: 'setDome', mode: 'off' });
    await cheat({ cheat: 'bombIn', hours: 24, from: r2 });
    await api(() => window.__game.advance(4));
    await frames(3);
    await shot('countdown', { panel: false });
    await pic(page.getByTestId('atom-countdown'), 'countdown-card');
  }
  if (want('raised') || want('stopped') || want('hit') || want('used') || want('clean')) {
    const raise = page.getByTestId('atom-raise-dome');
    if (await raise.count()) {
      await raise.click();
      await api(() => window.__game.advance(2));
      await frames(2);
      await pic(page.getByTestId('atom-countdown'), 'countdown-raised');
      await brief('raised');
    } else log('no raise button: the dome was not charged');
    // Open the war room from the card's button.
    await page.getByTestId('atom-open-room').click();
    await frames(2);
    await shot('countdown-room', { panel: true });
    await closeRoom();
  }
  if (want('stopped') || want('hit') || want('used') || want('clean')) {
    await api(() => window.__game.advance(24 * 60 + 5));
    await frames(3);
    await shot('stopped', { panel: false });
    await dismissCard();
  }
  if (want('hit') || want('used') || want('clean')) {
    await dispatch({ type: 'setDome', mode: 'off' });
    await cheat({ cheat: 'bombIn', hours: 0, from: r2 });
    await api(async () => {
      const g = window.__game;
      for (let k = 0; k < 40; k++) {
        await g.advance(60);
        const a = g.getAtom();
        if (a.summary?.impact?.over) break;
      }
    });
    await frames(3);
    const a = await atom();
    const im = a.summary.impact;
    if (im) await setView({ x: im.x, z: im.z, distance: 900, yaw: 0.5, tilt: 0.8 });
    await shot('hit', { panel: false });
  }
  if (want('used') || want('clean')) {
    await dismissCard();
    await bomb();
    await shot('used', { panel: true });
    // The war room's map: the city's strike as an arc to the neighbour it fell on, with a cloud there.
    await page.getByTestId('war-tab-map').click();
    await frames(2);
    await shot('map-strike', { panel: true, full: false });
    await page.getByTestId('war-tab-atom').click();
    await frames(1);
  }
  if (want('clean')) {
    await closeRoom();
    const a = await atom();
    const im = a.summary.impact;
    // The tool, from the Bomb tab's button, like a player.
    await bomb();
    const btn = page.getByTestId('atom-cleanup');
    if (await btn.count()) {
      await btn.click();
      await frames(2);
      if (im) await setView({ x: im.x, z: im.z, distance: 700, yaw: 0.4, tilt: 0.9 });
      await frames(3);
      const p = await api(([x, z]) => window.__game.worldToScreen(x, z), [im.x, im.z]);
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(800);
      await frames(2);
      await shot('clean-tool', { panel: false });
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(800);
      await frames(2);
      await shot('clean-sent', { panel: false });
      await page.getByTestId('cleanup-done').click();
      await frames(1);
      await brief('clean-done');
    } else log('no clean-up button');
  }

  // ---------------------------------------------------------------- a bomb on its way, on a phone and a tablet
  if (want('phone')) {
    await closeRoom();
    await api(() => window.__game.setOverlay(null));
    await dismissCard();
    for (const [name, w, h] of [
      ['phone', 390, 844],
      ['tablet', 820, 1100],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(800);
      await cheat({ cheat: 'bombIn', hours: 24, from: r3 });
      await api(() => window.__game.advance(4));
      await frames(2);
      await shot(`${name}-countdown`, { panel: false });
      // The room on the Bomb tab: on a narrow window the card steps aside for it.
      await page.getByTestId('atom-open-room').click();
      await frames(2);
      await shot(`${name}-countdown-room`, { panel: false });
      await closeRoom();
      // (The next bomb waits for this one to land.)
      await api(() => window.__game.advance(24 * 60 + 8));
      await frames(1);
      await dismissCard();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  if (want('settings')) {
    await closeRoom();
    await page.keyboard.press('Escape');
    await frames(1);
    await page.getByTestId('pause-settings').click();
    await frames(2);
    await pic(page, 'settings');
  }
  log('errors', JSON.stringify(errors));
} catch (e) {
  console.error(e);
  console.error('page errors', JSON.stringify(errors));
  code = 1;
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {
    server.kill();
  }
  process.exit(code);
}
