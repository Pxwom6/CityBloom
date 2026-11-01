import { expect, test, type Page } from '@playwright/test';
import { TIPS } from '../src/client/tutorial';
import { openGame, shot, watchErrors } from './helpers';
import { frames, placeFromToolbar, screen, settings, state } from './ui';
import { armTown, servedTown } from './war';

/**
 * M40 through the real UI, one player in a city with computer rivals (Low graphics): the nuclear plant,
 * the enrichment plant and the silo built from the toolbar; total war declared on a neighbour from the
 * Diplomacy tab; the bomb built from the Bomb tab and launched by a real three-second hold (a hold let
 * go early sends nothing); its arc and cloud on the region map, the city's reputation gone for good and
 * every neighbour's sanctions. Then the city is a target (the `bombIn` cheat): the countdown with the
 * missile in the sky, the mushroom cloud, the radiation map with zoning refused on the contaminated
 * ground in the sim's words, and the nuclear winter's snow in a summer month (the four pictures the
 * milestone asks for), the cloud's draw calls and triangles held to their caps, and the six atom tips,
 * each when its condition first holds. Cheats only skip the long waits (research, a project's stages, the
 * fuel, the bomb's instalments, a launch's preparation).
 */

// A button that never turns up fails in a minute, not at the test's timeout.
test.use({ actionTimeout: 60_000 });

const TIERS = ['land', 'air', 'sea', 'defence', 'intel', 'logistics'].flatMap((b) =>
  [1, 2, 3, 4].map((t) => `${b}${t}`),
);
const ATOM_TIPS = ['atomRace', 'atomReady', 'atomLaunch', 'atomInbound', 'atomFallout', 'atomWinter'];

const atom = (page: Page) => page.evaluate(() => window.__game!.getAtom());
const civics = (page: Page, def: string) =>
  page.evaluate((def) => window.__game!.getCivics().filter((c) => c.def === def), def);
const cheat = (page: Page, c: Record<string, unknown>) =>
  page.evaluate(async (c) => {
    const r = await window.__game!.dispatch({ type: 'cheat', ...c } as never);
    if (!r.ok) throw new Error(`cheat ${String(c.cheat)}: ${r.reason}`);
  }, c);
const advance = (page: Page, ticks: number) => page.evaluate((n) => window.__game!.advance(n), ticks);

/** The war room shut (its shortcut toggles it), so a tip or the map underneath shows. */
async function closeRoom(page: Page): Promise<void> {
  if ((await page.evaluate(() => window.__game!.getWarRoom().open)) === true)
    await page.keyboard.press('Shift+KeyM');
  await expect.poll(() => page.evaluate(() => window.__game!.getWarRoom().open)).toBe(false);
}

/** The war room open on a tab. */
async function warTab(page: Page, tab: string): Promise<void> {
  if (!(await page.getByTestId(`war-tab-${tab}`).isVisible())) await page.keyboard.press('Shift+KeyM');
  await page.getByTestId(`war-tab-${tab}`).click();
}

/**
 * The tip `id` comes up once its condition holds (the city's own state, nothing forced): tips are turned
 * on with every other tip marked read, the war room shut (an open panel hides the card), and the card
 * must show the tip's own words; then "Got it", and the tips off again for the steps that follow.
 */
async function tipShows(page: Page, id: string): Promise<void> {
  const want = TIPS.find((t) => t.id === id)!;
  await closeRoom(page);
  const read = TIPS.map((t) => t.id).filter((t) => t !== id);
  await page.evaluate((read) => window.__game!.setSettings({ tips: true, seenTips: read }), read);
  await expect
    .poll(() => page.evaluate(() => window.__game!.getShell().tip), {
      timeout: 60_000,
      message: `the ${id} tip`,
    })
    .toBe(id);
  await expect(page.getByTestId('tip')).toBeVisible();
  await expect(page.getByTestId('tip')).toContainText(want.text);
  await page.getByTestId('tip-ok').click();
  await page.evaluate(() => window.__game!.setSettings({ tips: false }));
}

/** A camera pose that puts a point `h` m above (x, z) in the middle of the view, from `distance` m along `yaw`. */
async function aimAt(page: Page, at: { x: number; z: number }, h: number, distance: number, yaw: number) {
  await page.evaluate(
    ([x, z, h, distance, yaw]) => {
      // The camera's pitch at this distance with the lowest tilt (camera.ts pitchFor).
      const s = Math.min(1, Math.max(0, (distance - 25) / 2575));
      const pitch = 0.32 + 0.68 * s * s * (3 - 2 * s) - 0.35;
      const off = h / Math.tan(pitch);
      window.__game!.setCamera({
        x: x - Math.sin(yaw) * off,
        z: z - Math.cos(yaw) * off,
        distance,
        yaw,
        tilt: -0.35,
      });
    },
    [at.x, at.z, h, distance, yaw],
  );
  await frames(page, 30);
}

/**
 * The computer neighbours' forces back to nothing (they rebuild month by month): through the long waits
 * no battle moves the war's score (a raid lost makes the city give in, one won makes the neighbour give
 * in, and either ends the total war the launch needs), so only this test's own moves decide the war.
 */
async function calmRivals(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const g = window.__game!;
    for (const n of (await g.getState()).region.neighbours.filter((x) => x.rival && !x.player))
      await g.dispatch({ type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 0, defences: 1 });
  });
}

/** The calendar month of a tick (0 January), as the sim's date has it (a month is a game day; it starts in March). */
const monthOf = (tick: number) => (Math.floor((tick + 420) / 1440) + 2) % 12;

test('M40: the atom bomb raced for, launched from the Bomb tab and suffered, through the real UI', async ({
  page,
}) => {
  test.setTimeout(2_700_000);
  const errs = watchErrors(page);
  await settings(page, { quality: 'low' });
  await openGame(page, '&rivals=1&seed=port&preset=coast');
  await servedTown(page);
  await armTown(page, ['militaryhq']);
  const hz = (await state(page)).highwayZ!;
  // Room for the three buildings along an avenue east of the town, every research tier done (the
  // Research tab is M37's to test), money for the plant's and silo's stages and the bomb's instalments,
  // and rivals too weak to raid (only this test's own moves happen).
  const rivals = await page.evaluate(
    async ([hz, tiers]) => {
      const g = window.__game!;
      const ok = async (cmd: Parameters<typeof g.dispatch>[0]) => {
        const r = await g.dispatch(cmd);
        if (!r.ok) throw new Error(`${cmd.type}: ${r.reason}`);
      };
      await ok({
        type: 'buildRoad',
        road: 'avenue',
        points: [
          { x: 504, z: hz },
          { x: 1430, z: hz },
        ],
      });
      await ok({ type: 'cheat', cheat: 'addMoney', amount: 20_000_000 });
      await ok({ type: 'cheat', cheat: 'research', tiers: tiers as never });
      const s = await g.getState();
      const rs = s.region.neighbours.filter((n) => n.rival && !n.player);
      for (const n of rs)
        await ok({ type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 0, defences: 1 });
      await g.advance(60 * 6);
      return rs.map((n) => ({ id: n.id, name: n.name }));
    },
    [hz, TIERS] as const,
  );
  expect(rivals.length).toBeGreaterThanOrEqual(2);
  const [target, racer] = [rivals[0]!, rivals[1]!];
  expect((await atom(page)).summary!.research.done).toBe(24);

  // --- The race begins elsewhere: a computer neighbour enriching fuel (the race tip). ---
  await cheat(page, { cheat: 'rivalBomb', neighbour: racer.id, stage: 'enriching', hours: 200 });
  await tipShows(page, 'atomRace');

  // --- The three buildings, from the toolbar: the nuclear plant (Power), then the enrichment plant
  // and the silo (Military), each only when the one before it runs. ---
  const look = (x: number) =>
    page.evaluate(
      ([x, hz]) => window.__game!.setCamera({ x, z: hz + 40, yaw: 0, distance: 520, tilt: 0.75 }),
      [x, hz],
    );
  const stretch = (x0: number, dz: number): [number, number][] =>
    [0, 20, 40, 60, 80, 100].map((dx) => [x0 + dx, hz + dz]);
  await look(660);
  await frames(page);
  await placeFromToolbar(page, 'power', 'nuclear', stretch(600, -52));
  await advance(page, 60 * 4);
  await expect.poll(async () => (await atom(page)).summary!.nuclear).toBe(true);

  await expect(page.getByTestId('tool-military')).toBeVisible();
  await look(800);
  await frames(page);
  await placeFromToolbar(page, 'military', 'enrichment', stretch(740, -44));
  const plant = (await civics(page, 'enrichment'))[0]!;
  expect(plant.stage).toBeDefined();
  // A project of fifteen months: its stages done by the cheat.
  await cheat(page, { cheat: 'finishStages', civic: plant.id });
  await advance(page, 60 * 2);
  await expect.poll(async () => (await atom(page)).summary!.plant).toBe(true);

  await look(940);
  await frames(page);
  await placeFromToolbar(page, 'military', 'atomsilo', stretch(880, -44));
  const silo = (await civics(page, 'atomsilo'))[0]!;
  // Four game years of fuel, made by the cheat (it leaves the silo going up), then the silo's stages.
  await cheat(page, { cheat: 'atom', stage: 'silo' });
  await cheat(page, { cheat: 'finishStages', civic: silo.id });
  // Staff and power come at the next rounds; the fastest preparation with defence funded to the top.
  await page.evaluate(() =>
    window.__game!.dispatch({ type: 'setFunding', dept: 'defence', pct: 150 } as never),
  );
  await advance(page, 60 * 3);
  await expect
    .poll(
      async () => {
        await advance(page, 60);
        return (await atom(page)).summary!.buildWhy;
      },
      { timeout: 120_000, intervals: [1_000] },
    )
    .toBeNull();

  // --- The bomb, from the Bomb tab: the first instalment is paid; the build's two months by the cheat. ---
  await warTab(page, 'atom');
  await expect(page.getByTestId('atom')).toBeVisible();
  await expect(page.getByTestId('atom-row-research')).toHaveAttribute('data-state', 'done');
  await page.getByTestId('atom-build').click();
  await expect.poll(async () => (await atom(page)).summary!.bomb?.paid ?? 0).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('atom-stage')).toBeVisible();
  await cheat(page, { cheat: 'atom', stage: 'ready' });
  await expect.poll(async () => (await atom(page)).summary!.have).toBe(true);
  await tipShows(page, 'atomReady');

  // --- Total war on a neighbour, from the Diplomacy tab; it opens twelve hours later. ---
  await warTab(page, 'diplomacy');
  await page.getByTestId(`dip-declare-${target.id}`).click();
  await page.getByTestId('dip-scale').selectOption('total');
  await page.getByTestId('dip-reason').fill('The bomb');
  await page.getByTestId('dip-declare-go').click();
  await expect(page.getByTestId(`dip-war-${target.id}`)).toContainText('opens in');
  await advance(page, 60 * 13);
  await expect(page.getByTestId(`dip-war-${target.id}`)).toContainText('Score');

  // --- The launch card: a hold let go early sends nothing; a full three seconds starts the launch. ---
  await warTab(page, 'atom');
  await expect(page.getByTestId('atom-launch-card')).toBeVisible();
  await page.getByTestId(`atom-target-${target.id}`).click();
  const hold = page.getByTestId('launch-hold');
  await expect(hold).toBeEnabled();
  // (Scrolled into view and the pointer on it, as a player's would be.)
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(1_200);
  expect((await atom(page)).hold?.id).toBe('launch-hold');
  await page.mouse.up();
  await page.waitForTimeout(2_500);
  expect((await atom(page)).hold).toBeNull();
  expect((await atom(page)).summary!.launch).toBeNull();
  expect((await atom(page)).summary!.have).toBe(true);
  await shot(page, 'm40-e2e-launch-card');
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(3_600);
  await page.mouse.up();
  await expect.poll(async () => (await atom(page)).summary!.launch?.to).toBe(target.id);
  await expect(page.getByTestId('atom-prep-card')).toBeVisible();
  await tipShows(page, 'atomLaunch');

  // The preparation (288 war hours, about twelve game days at the top funding) by the clock: the bomb
  // leaves by itself when it is done.
  for (let day = 0; day < 20; day++) {
    if ((await atom(page)).summary!.fired) break;
    await calmRivals(page);
    await advance(page, 1440);
  }
  const after = (await atom(page)).summary!;
  const wars = (await page.evaluate(() => window.__game!.getDiplomacy()))!.wars;
  expect(
    after.fired,
    `never left: ${JSON.stringify({ launch: after.launch, launchWhy: after.launchWhy, wars })}`,
  ).not.toBeNull();
  const fired = after.fired!;
  expect(fired.to).toBe(target.id);

  // --- The world turns: reputation gone for good, every computer neighbour's sanctions; the arc on the map. ---
  const dip = (await page.evaluate(() => window.__game!.getDiplomacy()))!;
  expect(dip.reputation).toBe(0);
  expect(dip.pariah).not.toBeNull();
  await warTab(page, 'diplomacy');
  await expect(page.getByTestId('dip-reputation')).toHaveText('0');
  await expect(page.getByTestId('dip-pariah')).toContainText('firing the atom bomb');
  const sanctioned = await page.evaluate(async () => {
    const s = await window.__game!.getState();
    return (s.war?.economy?.neighbours ?? [])
      .filter((n) => n.sanctionedBy?.cause === 'bomb')
      .map((n) => n.id);
  });
  expect(sanctioned).toEqual(expect.arrayContaining(rivals.map((r) => r.id)));
  await warTab(page, 'trade');
  await expect(page.getByTestId(`trade-sanctioned-${racer.id}`)).toBeVisible();
  await warTab(page, 'map');
  await expect(page.getByTestId('strike-arc')).toBeVisible();
  await expect(page.getByTestId('strike-missile')).toBeVisible();
  await shot(page, 'm40-e2e-strike-arc');
  // A game day later it has landed: a cloud on the neighbour's town, and the winter on this city too.
  await advance(page, 1440 + 30);
  await expect(page.getByTestId(`map-cloud-${target.id}`)).toBeVisible();
  await shot(page, 'm40-e2e-strike-cloud');
  await expect.poll(async () => (await state(page)).weather.winter).toBeGreaterThan(0);
  await tipShows(page, 'atomWinter');

  // --- The city a target: a rival's bomb on its way, the countdown and the missile in the sky. ---
  await calmRivals(page);
  await cheat(page, { cheat: 'bombIn', hours: 24, from: racer.id });
  await advance(page, 4);
  await expect(page.getByTestId('atom-countdown')).toBeVisible();
  await tipShows(page, 'atomInbound');
  const inbound = (await atom(page)).summary!.inbound!;
  // Three quarters of the way: high over the city and coming down.
  await advance(page, inbound.arrive - (await state(page)).tick - 360);
  await expect(page.getByTestId('atom-look')).toBeVisible();
  await page.getByTestId('atom-look').click();
  await frames(page, 40);
  const fx1 = (await state(page)).renderStats.atom;
  expect(fx1.inbound).toBe(true);
  expect(fx1.following).toBe(true);
  await expect(page.getByTestId('atom-countdown')).toBeVisible();
  await shot(page, 'm40-e2e-countdown');

  // --- It lands: the mushroom cloud over the city, within its draw-call and triangle caps. ---
  // (A raid on the city at the landing holds the bomb back, for twelve hours at most.)
  await advance(page, 360 + 10);
  await expect
    .poll(
      async () => {
        const at = (await atom(page)).summary!.impact?.at ?? null;
        if (at === null) await advance(page, 60);
        return at;
      },
      { timeout: 180_000, intervals: [1_000] },
    )
    .not.toBeNull();
  const impact = (await atom(page)).summary!.impact!;
  await expect
    .poll(
      async () => {
        await advance(page, 30);
        return (await atom(page)).summary!.impact!.over;
      },
      { timeout: 120_000, intervals: [1_000] },
    )
    .toBe(true);
  // The card the bomb leaves behind, in the plain count (no casualties), read and closed.
  await expect(page.getByTestId('atom-after')).toBeVisible();
  await expect(page.getByTestId('atom-after-text')).toContainText('buildings were levelled');
  await expect(page.getByTestId('atom-after-text')).toContainText('residents have left the city');
  await page.getByTestId('atom-after-ok').click();
  await expect(page.getByTestId('atom-after')).toBeHidden();
  // (The cloud by its age: at its full height 200 ticks, 25 s of play, after the landing.)
  const age = 200 - ((await state(page)).tick - impact.at!);
  if (age > 0) await advance(page, age);
  await aimAt(page, impact, 450, 2600, 0.4);
  const fx2 = (await state(page)).renderStats.atom;
  expect(fx2.puffs).toBeGreaterThan(0);
  expect(fx2.calls).toBeGreaterThan(0);
  expect(fx2.calls).toBeLessThanOrEqual(6);
  expect(fx2.triangles).toBeLessThanOrEqual(4000);
  await shot(page, 'm40-e2e-cloud');
  await tipShows(page, 'atomFallout');

  // --- The radiation map, and zoning refused on the contaminated ground in the sim's own words: a game
  // day on, with the cloud drifted off and gone (it would stand over the map). ---
  await calmRivals(page);
  await advance(page, 1440);
  await frames(page, 4);
  expect((await state(page)).renderStats.atom.puffs).toBe(0);
  // A street through the closed ground north of the town (roads may be built there; nothing else can).
  const lane = await page.evaluate(
    async ([x, z]) => {
      const g = window.__game!;
      for (const dz of [-330, -360, -300, -390]) {
        const pts = [
          { x: x - 160, z: z + dz },
          { x: x + 160, z: z + dz },
        ];
        if ((await g.preview({ type: 'buildRoad', road: 'street', points: pts })).ok) {
          const r = await g.dispatch({ type: 'buildRoad', road: 'street', points: pts });
          if (r.ok) return pts;
        }
      }
      throw new Error('no room for a street through the fallout');
    },
    [impact.x, impact.z],
  );
  const mid = { x: (lane[0]!.x + lane[1]!.x) / 2, z: lane[0]!.z };
  expect(
    (await page.evaluate(([x, z]) => window.__game!.getFallout(x, z), [mid.x, mid.z])).reading!.dose,
  ).toBeGreaterThan(0.2);
  await page.evaluate(
    ([x, z]) => window.__game!.setCamera({ x, z: z + 120, yaw: 0, distance: 900, tilt: 0.6 }),
    [mid.x, mid.z],
  );
  await frames(page, 4);
  await page.getByTestId('tool-maps').click();
  await page.getByTestId('map-radiation').click();
  await expect(page.getByTestId('radiation-bands')).toBeVisible();
  expect((await atom(page)).radiationMap).toBe(true);
  await page.getByTestId('tool-zone').click();
  await page.getByTestId('zone-R').click();
  const a = await screen(page, lane[0]!.x + 60, lane[0]!.z - 14);
  const b = await screen(page, lane[1]!.x - 60, lane[0]!.z - 14);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  const refusal = page.getByTestId('toast').filter({ hasText: 'Fallout lies on this ground' });
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText(/Nothing can be built here for about \d+ more game years?\./);
  // The map's reading where the pointer stands.
  await page.mouse.move((a.x + b.x) / 2, a.y - 30, { steps: 3 });
  await expect(page.getByTestId('radiation-tip')).toContainText('Fallout');
  // The reading stands clear of the zone tool's hint, both at the pointer.
  await expect
    .poll(async () => {
      const [r, h] = [
        await page.getByTestId('radiation-tip').boundingBox(),
        await page.getByTestId('tool-hint').boundingBox(),
      ];
      if (!r || !h) return 'missing';
      const apart =
        r.y >= h.y + h.height || r.y + r.height <= h.y || r.x >= h.x + h.width || r.x + r.width <= h.x;
      return apart ? 'apart' : 'overlap';
    })
    .toBe('apart');
  await shot(page, 'm40-e2e-radiation');
  await page.getByTestId('tool-select').click();
  await page.getByTestId('tool-maps').click();
  await page.getByTestId('map-radiation').click();
  expect((await atom(page)).radiationMap).toBe(false);

  // --- The nuclear winter: on into a summer month with it deep enough to snow. ---
  for (let day = 0; day < 16; day++) {
    await calmRivals(page);
    const s = await state(page);
    if ([5, 6, 7].includes(monthOf(s.tick)) && s.weather.winterSnows && s.weather.winter >= 0.6) break;
    await advance(page, 1440);
  }
  const w = (await state(page)).weather;
  expect([5, 6, 7]).toContain(monthOf((await state(page)).tick));
  expect(w.winterSnows).toBe(true);
  await expect(page.getByTestId('winter-badge')).toContainText('Nuclear winter');
  // Midday, looking over the city from the coast.
  await page.evaluate(async () => {
    const g = window.__game!;
    const now = (((await g.getState()).tick + 420) % 1440) / 60;
    await g.advance(Math.round(((((13 - now) % 24) + 24) % 24) * 60));
  });
  await page.evaluate(
    ([x, z]) => window.__game!.setCamera({ x: x + 200, z: z + 250, yaw: 0.5, distance: 1100, tilt: 0.2 }),
    [impact.x, impact.z],
  );
  await frames(page, 30);
  expect((await page.evaluate(() => window.__game!.getWeather())).look.snow).toBeGreaterThan(0.4);
  await shot(page, 'm40-e2e-winter');

  // Every atom tip came up, each once.
  const seen = await page.evaluate(() => window.__game!.getShell().settings.seenTips as string[]);
  expect(seen).toEqual(expect.arrayContaining(ATOM_TIPS));
  errs.check();
});
