import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { battleLayout } from '../../src/sim/battle/layout';
import { Battle } from '../../src/sim/battle/battle';
import { E, S, TAG, BATTLE_VERSION, type BattleInput } from '../../src/sim/battle/types';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { BATTLE } from '../../src/data/battle';
import { buildTown, newSim, placeAlong, serveTown } from '../helpers';

/** M35: a battle's picture of a real city. */
function warTown(): { sim: Sim; hq: number; barracks: number } {
  const sim = newSim({ rivals: true, disasters: false });
  const { streets } = buildTown(sim);
  serveTown(sim);
  sim.advance(3 * TICKS_PER_MONTH);
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 500_000 });
  const segs = [...streets].reverse();
  const place = (def: string) => {
    for (const seg of segs)
      try {
        return placeAlong(sim, def, seg);
      } catch {
        /* next */
      }
    throw new Error(def);
  };
  const hq = place('militaryhq');
  const barracks = place('barracks');
  place('bunker');
  sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
  sim.advance(2 * TICKS_PER_MONTH);
  return { sim, hq, barracks };
}

describe('battle layouts (M35)', () => {
  const { sim, hq, barracks } = warTown();
  const layout = battleLayout(sim, { target: 'military', from: 'west' });
  const structs = (f: (row: number[]) => boolean) => {
    const out: number[][] = [];
    for (let k = 0; k < layout.structs.length / S.stride; k++) {
      const row = layout.structs.slice(k * S.stride, (k + 1) * S.stride);
      if (f(row)) out.push(row);
    }
    return out;
  };

  it('keeps the military buildings, tagged, by a road', () => {
    const mil = structs((r) => (r[S.tags]! & TAG.military) !== 0);
    expect(mil.map((r) => r[S.id])).toEqual(expect.arrayContaining([hq, barracks]));
    for (const r of mil) expect(r[S.edge]).toBeGreaterThanOrEqual(0);
    const bunker = structs((r) => r[S.gun]! > 0);
    expect(bunker).toHaveLength(1);
    expect(bunker[0]![S.manned]).toBeGreaterThan(0);
    expect(structs((r) => (r[S.tags]! & TAG.hq) !== 0)[0]![S.id]).toBe(hq);
    expect(structs((r) => (r[S.tags]! & TAG.home) !== 0).length).toBeGreaterThan(10);
  });

  it('has the highway as a way in, the roads joined up, and the defenders at their bases', () => {
    const hw = layout.entries.find((e) => e.route === 'highway')!;
    expect(hw.edge).toBeGreaterThanOrEqual(0);
    expect(layout.entries.some((e) => e.route === 'air')).toBe(true);
    expect(layout.edges.length / E.stride).toBeGreaterThan(5);
    expect(layout.defenders.length).toBeGreaterThan(0);
    expect(layout.defenders[0]!.kind).toBe('infantry');
    expect(layout.readiness).toBeGreaterThan(0);
    expect(layout.structs.length / S.stride).toBeLessThanOrEqual(BATTLE.maxStructs);
  });

  it('is the same from the city as from its save', () => {
    const copy = Sim.fromSave(sim.save());
    const again = battleLayout(copy, { target: 'military', from: 'west' });
    expect(again).toEqual(layout);
  });

  it('a raid on it plays out, and the same twice', () => {
    const inp: BattleInput = {
      v: BATTLE_VERSION,
      id: 'raid',
      seed: 'raid',
      scale: 'skirmish',
      layout,
      attacker: {
        name: 'Ashford',
        color: 0xc03030,
        units: Array.from({ length: 6 }, (_, k) => ({
          id: 1e6 + k,
          kind: k < 3 ? 'tank' : 'infantry',
          hp: 1,
          x: 0,
          z: 0,
          base: -1,
        })),
        route: 'highway',
        target: 'military',
        stance: 'bold',
        readiness: 0.8,
      },
      defender: { name: sim.state.options.cityName, color: 0x3060c0 },
      orders: [],
      caps: { maxCollapse: 12, maxWreck: 3 },
    };
    const t0 = performance.now();
    const a = Battle.run(structuredClone(inp)).result();
    const ms = performance.now() - t0;
    const b = Battle.run(structuredClone(inp)).result();
    expect(a).toEqual(b);
    expect(a.objectives.aimed).toBeGreaterThan(0);
    expect(a.steps).toBeGreaterThan(20);
    expect(ms).toBeLessThan(2_000);
  });
});
