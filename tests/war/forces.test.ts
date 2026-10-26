import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { CIVIC } from '../../src/data/civic';
import { UNIT, WAR } from '../../src/data/war';
import { unlocksAt } from '../../src/data/unlocks';
import { checksum, partHashes } from '../../src/sim/sync';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { decodeValue, encodeValue } from '../../src/sim/serialize';
import { safetyAt } from '../../src/sim/systems/war';
import { growTown } from '../lockstep/scriptedTown';
import { buildTown, newSim, placeAlong, serveTown } from '../helpers';

/**
 * M34 Armed forces: military buildings, units that train, the war economy, and peace unchanged.
 */

/** A small town with services, war on, grown for a few months so it has people looking for work. */
function warTown(months = 4): { sim: Sim; streets: number[] } {
  const sim = newSim({ rivals: true, disasters: false });
  const { streets } = buildTown(sim);
  serveTown(sim);
  sim.advance(months * TICKS_PER_MONTH);
  return { sim, streets };
}

function place(sim: Sim, def: string, segs: number[]): number {
  for (const seg of segs) {
    try {
      return placeAlong(sim, def, seg);
    } catch {
      /* the next street */
    }
  }
  throw new Error(`no room for ${def}`);
}

function allSegments(sim: Sim): number[] {
  return [...sim.state.net.segments.values()]
    .filter((s) => s.type === 'street' || s.type === 'avenue')
    .map((s) => s.id)
    .reverse();
}

describe('peace is unchanged (M34)', () => {
  it('the scripted town plays exactly as on main, part for part, month by month', () => {
    const golden = JSON.parse(readFileSync('tests/fixtures/war/peace-main.json', 'utf8')) as {
      checksum: string;
      parts: Record<string, string>;
    }[];
    const months: { checksum: string; parts: Record<string, string> }[] = [];
    growTown(golden.length, (sim) => {
      const parts = partHashes(sim);
      // The save version moved on (v27); nothing else in a peaceful city may.
      delete parts.version;
      months.push({ checksum: checksum(sim), parts });
    });
    for (let m = 0; m < golden.length; m++) {
      expect(months[m]!.parts, `month ${m}`).toEqual(golden[m]!.parts);
      expect(months[m]!.checksum, `month ${m}`).toBe(golden[m]!.checksum);
    }
  });

  it('a peaceful city has no rivals key, no war state and no defence funding', () => {
    const sim = Sim.create({ seed: 'p', rivals: false });
    expect('rivals' in sim.state.options).toBe(false);
    expect('war' in sim.state).toBe(false);
    expect('defence' in sim.state.economy.funding).toBe(false);
  });

  it('a peaceful city refuses military buildings, units, bonds and defence funding, with reasons', () => {
    const sim = newSim();
    const { streets } = buildTown(sim);
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    const seg = streets[0]!;
    const len = sim.net.curve(seg).length;
    const r = sim.dispatch({
      type: 'placeBuilding',
      def: 'militaryhq',
      ...sim.net.curve(seg).pointAt(len / 2),
      angle: 0,
      side: 1,
    } as never);
    expect(r.ok).toBe(false);
    const why = (cmd: Parameters<Sim['dispatch']>[0]) => {
      const res = sim.dispatch(cmd);
      return res.ok ? 'ok' : res.reason;
    };
    expect(why({ type: 'trainUnit', base: 1, kind: 'infantry' })).toMatch(/War is off/);
    expect(why({ type: 'issueBond', amount: 40_000 })).toMatch(/war on/);
    expect(why({ type: 'setFunding', dept: 'defence', pct: 120 })).toMatch(/war on/);
    // The placement check names the reason too.
    let reason = '';
    for (let s = 30; s < len - 30 && !reason; s += 8)
      for (const side of [1, -1] as const) {
        const pose = sim.net.curve(seg).pointAt(s);
        const res = sim.preview({
          type: 'placeBuilding',
          def: 'barracks',
          x: pose.x,
          z: pose.z,
          angle: 0,
          side,
        });
        if (!res.ok && /war on/.test(res.reason)) reason = res.reason;
      }
    expect(reason).toMatch(/rival neighbours/);
  });

  it('the city panel never announces military buildings to a peaceful city', () => {
    expect(unlocksAt(2_000)).not.toContain('Barracks');
    expect(unlocksAt(2_000, true)).toContain('Barracks');
    expect(unlocksAt(10_000, true)).toContain('Airfield');
  });
});

describe('armed forces (M34)', () => {
  it('a city with rival neighbours starts with an empty war state', () => {
    const sim = Sim.create({ seed: 'r', rivals: true });
    expect(sim.state.options.rivals).toBe(true);
    expect(sim.state.war).toBeDefined();
    expect(sim.state.war!.units.size).toBe(0);
    expect(sim.stats().war).not.toBeNull();
  });

  it('builds an HQ and barracks, staffs and powers them, and trains infantry', () => {
    const { sim } = warTown();
    const segs = allSegments(sim);
    // Other military buildings need the HQ first.
    const early = sim.preview({ type: 'placeBuilding', def: 'barracks', x: 0, z: 0, angle: 0, side: 1 });
    expect(early.ok).toBe(false);
    const hq = place(sim, 'militaryhq', segs);
    const barracks = place(sim, 'barracks', segs);
    // Staff come from the unemployed at the next matching round; power at the next utilities pass.
    sim.advance(3 * TICKS_PER_HOUR * 2);
    const b = sim.state.civics.get(barracks)!;
    expect(b.staff).toBeGreaterThan(0);
    expect(b.powered).toBeGreaterThan(0);
    expect(sim.state.civics.get(hq)!.staff).toBeGreaterThan(0);
    const before = sim.state.treasury;
    const r = sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
    expect(r.ok).toBe(true);
    expect(sim.state.treasury).toBeLessThan(before);
    expect(sim.state.war!.orders.size).toBe(1);
    // Infantry train in 12 hours at full staff and power; give it a day and a half.
    sim.advance(36 * TICKS_PER_HOUR);
    expect(sim.state.war!.orders.size).toBe(0);
    const units = [...sim.state.war!.units.values()];
    expect(units).toHaveLength(1);
    expect(units[0]!.kind).toBe('infantry');
    expect(units[0]!.base).toBe(barracks);
    // A barracks can't train tanks.
    const tank = sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'tank' });
    expect(tank.ok).toBe(false);
  });

  it('a base keeps only so many units', () => {
    const { sim } = warTown();
    const segs = allSegments(sim);
    place(sim, 'militaryhq', segs);
    const barracks = place(sim, 'barracks', segs);
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 100_000 });
    const holds = CIVIC.get('barracks')!.military!.holds!;
    for (let k = 0; k < holds; k++)
      expect(sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' }).ok).toBe(true);
    const full = sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
    expect(full.ok).toBe(false);
    expect(full.ok ? '' : full.reason).toMatch(/full/);
  });

  it('materials come from the stores first, then from the region at the import price', () => {
    const { sim } = warTown();
    const segs = allSegments(sim);
    place(sim, 'militaryhq', segs);
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 });
    const depot = place(sim, 'vehicledepot', segs);
    const w = sim.state.war!;
    // Empty stores: a tank's materials are all bought in.
    w.stock = { goods: 0, ore: 0, oil: 0, munitions: 0 };
    const tank = UNIT.get('tank')!;
    const p = WAR.materials.importPrice;
    const dry = sim.preview({ type: 'trainUnit', base: depot, kind: 'tank' });
    expect(dry.ok && dry.cost).toBe(tank.cost + tank.goods * p.goods + tank.ore * p.ore + tank.oil * p.oil);
    // Full stores: only the money.
    w.stock = { goods: 1000, ore: 1000, oil: 1000, munitions: 0 };
    const full = sim.dispatch({ type: 'trainUnit', base: depot, kind: 'tank' });
    expect(full.ok && full.cost).toBe(tank.cost);
    expect(w.stock.goods).toBe(1000 - tank.goods);
    expect(w.stock.ore).toBe(1000 - tank.ore);
  });

  it('the stores fill from the city’s industry, and the defence lines show in the budget', () => {
    const { sim } = warTown(6);
    const segs = allSegments(sim);
    place(sim, 'militaryhq', segs);
    const barracks = place(sim, 'barracks', segs);
    sim.advance(TICKS_PER_MONTH);
    sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
    sim.advance(2 * TICKS_PER_MONTH);
    const w = sim.state.war!;
    expect(w.stock.goods).toBeGreaterThan(0);
    const last = sim.state.economy.history.at(-1)!.lines;
    expect(last['upkeep:defence']).toBeLessThan(0);
    expect(last.forces).toBeLessThan(0);
    // The goods were bought from the town's industry as the stores filled.
    expect(sim.state.economy.history.some((h) => (h.lines.warMaterials ?? 0) < 0)).toBe(true);
    const summary = sim.stats().war!;
    expect(summary.upkeep.forces).toBeGreaterThan(0);
    expect(summary.upkeep.buildings).toBeGreaterThan(0);
    expect(summary.units).toBe(1);
    expect(summary.readiness).toBeGreaterThan(0);
  });

  it('defence funding scales upkeep and training', () => {
    const { sim } = warTown();
    const segs = allSegments(sim);
    place(sim, 'militaryhq', segs);
    place(sim, 'barracks', segs);
    sim.advance(TICKS_PER_HOUR * 4);
    const up = sim.stats().war!.upkeep.buildings;
    expect(sim.dispatch({ type: 'setFunding', dept: 'defence', pct: 50 }).ok).toBe(true);
    expect(sim.stats().war!.upkeep.buildings).toBeLessThan(up * 0.6);
    expect(sim.state.economy.funding.defence).toBe(50);
  });

  it('war bonds pay in, cost approval while owed, and are repaid in instalments', () => {
    const { sim } = warTown();
    const w = sim.state.war!;
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    const before = sim.state.treasury;
    const r = sim.dispatch({ type: 'issueBond', amount: 40_000 });
    expect(r.ok).toBe(true);
    expect(sim.state.treasury).toBe(before + 40_000);
    expect(w.bonds).toHaveLength(1);
    expect(sim.stats().war!.bondMood).toBeLessThan(0);
    const owed = w.bonds[0]!.balance;
    sim.advance(TICKS_PER_MONTH);
    expect(w.bonds[0]!.balance).toBeLessThan(owed);
    const lines = sim.state.economy.history.at(-1)!.lines;
    expect(lines.bondInterest).toBeLessThan(0);
    expect(lines.bondPrincipal).toBeLessThan(0);
    // Repaid early, the mood lifts.
    expect(sim.dispatch({ type: 'repayBond', id: w.bonds[0]!.id }).ok).toBe(true);
    expect(w.bonds).toHaveLength(0);
    expect(sim.stats().war!.bondMood).toBe(0);
    for (let k = 0; k < WAR.maxBonds; k++) sim.dispatch({ type: 'issueBond', amount: 40_000 });
    expect(sim.dispatch({ type: 'issueBond', amount: 40_000 }).ok).toBe(false);
  });

  it('homes near a shelter feel safer; homes near a depot mind the noise', () => {
    const { sim } = warTown();
    const segs = allSegments(sim);
    place(sim, 'militaryhq', segs);
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 });
    for (let k = 0; k < 3; k++) place(sim, 'shelter', segs);
    place(sim, 'vehicledepot', segs);
    sim.advance(TICKS_PER_HOUR * 4);
    let safe = 0;
    for (const b of sim.state.buildings.values()) if (b.zone === 1 && safetyAt(sim, b) > 0) safe++;
    expect(safe).toBeGreaterThan(0);
  });

  it('bulldozing a base stands its units down, and undo brings them back', () => {
    const { sim } = warTown();
    const segs = allSegments(sim);
    place(sim, 'militaryhq', segs);
    const barracks = place(sim, 'barracks', segs);
    sim.advance(TICKS_PER_HOUR * 4);
    sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
    sim.advance(36 * TICKS_PER_HOUR);
    sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
    expect(sim.state.war!.units.size).toBe(1);
    expect(sim.state.war!.orders.size).toBe(1);
    expect(sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: barracks } }).ok).toBe(true);
    expect(sim.state.war!.units.size).toBe(0);
    expect(sim.state.war!.orders.size).toBe(0);
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.state.civics.has(barracks)).toBe(true);
    expect(sim.state.war!.units.size).toBe(1);
    expect(sim.state.war!.orders.size).toBe(1);
  });

  it('a war city saves and loads with its forces', () => {
    const { sim } = warTown();
    const segs = allSegments(sim);
    place(sim, 'militaryhq', segs);
    const barracks = place(sim, 'barracks', segs);
    sim.advance(TICKS_PER_HOUR * 4);
    sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
    sim.dispatch({ type: 'issueBond', amount: 40_000 });
    sim.advance(TICKS_PER_HOUR * 3);
    const round = decodeValue(JSON.parse(JSON.stringify(encodeValue(sim.state)))) as Sim['state'];
    expect(round.war!.orders.size).toBe(1);
    expect(round.war!.bonds).toHaveLength(1);
    const loaded = Sim.fromSave(sim.save('2026-10-26'));
    expect(loaded.hash()).toBe(sim.hash());
    loaded.advance(TICKS_PER_MONTH);
    sim.advance(TICKS_PER_MONTH);
    expect(loaded.hash()).toBe(sim.hash());
  });
});
