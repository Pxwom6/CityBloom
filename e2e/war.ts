import { expect, type Page } from '@playwright/test';
import { buildTownViaApi } from './helpers';
import { state } from './ui';

/**
 * War towns for the e2e (M35): a serviced town (as e2e/m34-forces.spec.ts), then military buildings
 * and units. Positions are offsets from the highway's end; every placement takes the nearest room.
 */

/** Streets, power, water, garbage and services, grown three months. */
export async function servedTown(page: Page): Promise<void> {
  await buildTownViaApi(page);
  const hz = (await state(page)).highwayZ;
  await page.evaluate(
    async ([hz]) => {
      const g = window.__game!;
      const ok = async (cmd: Parameters<typeof g.dispatch>[0]) => {
        const r = await g.dispatch(cmd);
        if (!r.ok) throw new Error(`${cmd.type}: ${r.reason}`);
        return r;
      };
      await ok({ type: 'cheat', cheat: 'unlockAll' });
      await ok({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
      const at = (dx: number, dz: number) => ({ x: 24 + dx, z: hz! + dz });
      let util = 0;
      for (const dz of [230, 250, 270, 210, 290]) {
        const pts = [at(30, dz), at(470, dz)];
        if ((await g.preview({ type: 'buildRoad', road: 'street', points: pts })).ok) {
          await ok({ type: 'buildRoad', road: 'street', points: pts });
          util = dz;
          break;
        }
      }
      for (const x of [96, 192, 288, 384])
        await ok({ type: 'buildRoad', road: 'street', points: [at(x, 160), at(x, util)] });
      for (const def of ['coal', 'coal', 'pump', 'pump', 'treatment', 'landfill', 'pump'])
        if ((await g.placeCivic(def, at(240, util))) === null) throw new Error(`no room for ${def}`);
      for (const def of ['firestation', 'police', 'clinic', 'primary'])
        if ((await g.placeCivic(def, at(240, 0))) === null) throw new Error(`no room for ${def}`);
      await g.advance(1440 * 3);
    },
    [hz],
  );
}

/**
 * Military buildings (by id, near the spots the m35 spec uses) and units to train at the barracks
 * and depot; grown until they're trained (ten game months at most). War must be on in the city.
 */
export async function armTown(
  page: Page,
  defs: string[],
  units: { infantry?: number; vehicles?: ('tank' | 'transport' | 'artillery')[] } = {},
): Promise<void> {
  const hz = (await state(page)).highwayZ;
  await page.evaluate(
    async ([hz, defs, units]) => {
      const g = window.__game!;
      const ok = async (cmd: Parameters<typeof g.dispatch>[0]) => {
        const r = await g.dispatch(cmd);
        if (!r.ok) throw new Error(`${cmd.type}: ${r.reason}`);
        return r;
      };
      const at = (dx: number, dz: number) => ({ x: 24 + dx, z: hz! + dz });
      const spots: Record<string, { x: number; z: number }> = {
        militaryhq: at(300, -160),
        barracks: at(380, -160),
        vehicledepot: at(200, 160),
        bunker: at(100, -160),
        shelter: at(200, -160),
      };
      const ids: Record<string, number> = {};
      for (const def of defs) {
        const id = await g.placeCivic(def, spots[def] ?? at(240, -160));
        if (id === null) throw new Error(`no room for ${def}`);
        ids[def] = id;
      }
      const want = (units.infantry ?? 0) + (units.vehicles?.length ?? 0);
      for (let k = 0; k < (units.infantry ?? 0); k++)
        await ok({ type: 'trainUnit', base: ids.barracks!, kind: 'infantry' });
      for (const kind of units.vehicles ?? []) await ok({ type: 'trainUnit', base: ids.vehicledepot!, kind });
      for (let m = 0; m < (want ? 10 : 1); m++) {
        await g.advance(1440);
        const f = g.getForces();
        if (f && f.units.length >= want && !f.orders.length) break;
      }
    },
    [hz, defs, units] as const,
  );
  const want = (units.infantry ?? 0) + (units.vehicles?.length ?? 0);
  expect((await page.evaluate(() => window.__game!.getForces()))!.units.length).toBeGreaterThanOrEqual(want);
}
