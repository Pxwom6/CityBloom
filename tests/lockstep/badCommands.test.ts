import { describe, expect, it } from 'vitest';
import { Lockstep, type Applied, type Stamped } from '../../src/sim/lockstep';
import { Sim } from '../../src/sim/sim';
import type { Command } from '../../src/sim/commands';
import { TICKS_PER_HOUR } from '../../src/sim/time';
import { buildTown } from '../helpers';

/**
 * F7 (multiplayer review): a command another player's game sends, however malformed, can't throw,
 * hang or quietly damage a shared city: every sim refuses it the same way, and an event that throws
 * anyway counts as refused on every machine and is reported.
 */
function town(): Sim {
  const sim = Sim.create({ seed: 'badcmd', preset: 'river', cityName: 'Badford' });
  buildTown(sim, { zone: false });
  sim.shared = true;
  return sim;
}

/** Commands a buggy or hostile game might send (each threw, hung or damaged the city before F7). */
const BAD = [
  { type: 'buildRoad', road: 'street', points: 5 },
  { type: 'buildRoad', road: 'street', points: [null, null] },
  {
    type: 'buildRoad',
    road: 'bogus',
    points: [
      { x: 100, z: 100 },
      { x: 200, z: 100 },
    ],
  },
  { type: 'bulldoze', target: null },
  { type: 'zone', zone: 'R', area: null },
  { type: 'zone', zone: 'R', area: { kind: 'brush', points: [null], radius: 30 } },
  { type: 'zone', zone: 'toString', area: { kind: 'brush', points: [{ x: 100, z: 100 }], radius: 30 } },
  { type: 'terraform', mode: 'raise', points: null, radius: 48 },
  { type: 'terraform', mode: 'raise', points: [null], radius: 48 },
  { type: 'disaster', kind: 'meteor', at: null },
  { type: 'createDistrict', name: 5 },
  { type: 'paintDistrict', district: 1, area: { kind: 'brush', points: [null], radius: 30 } },
  { type: 'renameCity', name: 5 },
  { type: 'regionUpdate', update: {} },
  { type: 'regionUpdate', update: null },
  { type: 'setTax', zone: 'R', wealth: 'length', rate: 12.5 },
  { type: 'setTax', zone: 'R', wealth: 'length', rate: 0 },
  { type: 'setTax', zone: 'X', wealth: 0, rate: 5 },
  { type: 'setDeal', neighbour: 1, resource: 'power', direction: 'steal', amount: 5 },
  { type: 'placeBuilding', def: 'firestation', x: 900, z: 900, angle: 0, side: 7 },
  { type: 'startScenario', id: 'stadium' },
] as unknown as Command[];

describe('F7: bad commands in a shared city', () => {
  it('every sim refuses a malformed command from a player without throwing or changing anything', () => {
    const sim = town();
    const before = sim.hash();
    const taxes = JSON.stringify(sim.state.economy.taxes);
    for (const cmd of BAD) {
      let r: ReturnType<Sim['dispatch']> | undefined;
      expect(() => (r = sim.dispatch(cmd, 2)), JSON.stringify(cmd)).not.toThrow();
      expect(r!.ok, JSON.stringify(cmd)).toBe(false);
    }
    expect(JSON.stringify(sim.state.economy.taxes)).toBe(taxes);
    expect(sim.hash()).toBe(before);
    // A good command from a player still goes through.
    expect(sim.dispatch({ type: 'renameCity', name: 'Goodford' }, 2)).toMatchObject({ ok: true });
  });

  it('a command that throws anyway counts as refused on every machine, and the city carries on', () => {
    const make = () => {
      const ls = new Lockstep(town());
      const applied: Applied[] = [];
      const errors: string[] = [];
      ls.onApplied = (a) => applied.push(a);
      ls.onError = (what) => errors.push(`${what.type}@${what.tick}`);
      // A handler bug: this one command throws on every machine.
      const dispatch = ls.sim.dispatch.bind(ls.sim);
      ls.sim.dispatch = (cmd, by) => {
        if (cmd.type === 'renameCity' && cmd.name === 'Boom') throw new Error('a handler bug');
        return dispatch(cmd, by);
      };
      return { ls, applied, errors };
    };
    const a = make();
    const b = make();
    const t0 = a.ls.sim.tick;
    const events: Stamped[] = [
      { tick: t0 + 2, seq: 0, ev: { kind: 'cmd', by: 2, ref: 1, cmd: { type: 'renameCity', name: 'Boom' } } },
      { tick: t0 + 2, seq: 1, ev: { kind: 'cmd', by: 2, ref: 2, cmd: BAD[0]! } },
      {
        tick: t0 + 3,
        seq: 2,
        ev: { kind: 'cmd', by: 3, ref: 3, cmd: { type: 'renameCity', name: 'Afterford' } },
      },
    ];
    for (const p of [a, b]) {
      for (const e of events) p.ls.push(structuredClone(e));
      p.ls.allow(t0 + TICKS_PER_HOUR);
      expect(() => p.ls.run()).not.toThrow();
    }
    expect(a.applied.map((x) => x.result?.ok)).toEqual([false, false, true]);
    expect(a.applied[0]!.result).toEqual({ ok: false, reason: 'The game could not carry out that command' });
    expect(a.errors).toEqual([`renameCity@${t0 + 2}`]);
    expect(a.ls.sim.state.cityName).toBe('Afterford');
    expect(a.ls.eventHash).toBe(b.ls.eventHash);
    expect(a.ls.sim.hash()).toBe(b.ls.sim.hash());
  });
});
