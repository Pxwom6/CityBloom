import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../src/client/saves';
import { Sim } from '../src/sim/sim';
import {
  CHRONICLE,
  CHRONICLE_SERIES,
  emptyChronicle,
  recordMonth,
  type Chronicle,
} from '../src/sim/systems/chronicle';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { buildTown, connectPoint, newSim, serveTown } from './helpers';

const col = (c: Chronicle, key: (typeof CHRONICLE_SERIES)[number]) =>
  c.series[CHRONICLE_SERIES.indexOf(key)]!;

describe('city history (M16)', () => {
  it('keeps a whole life in a bounded number of points by doubling the bucket', () => {
    const c = emptyChronicle(0);
    const months = 70 * 12;
    for (let d = 0; d < months; d++)
      recordMonth(
        c,
        CHRONICLE_SERIES.map((_, i) => d * (i + 1)),
      );
    for (const s of c.series) expect(s.length).toBeLessThanOrEqual(CHRONICLE.maxPoints);
    // Every month is in a closed bucket or the open one; past 40 years a point covers 4 months.
    expect(c.series[0]!.length * c.step + c.months).toBe(months);
    expect(c.step).toBe(4);
    // A straight ramp averages to each bucket's middle month.
    const s0 = c.series[0]!;
    for (let k = 0; k < s0.length; k++) expect(s0[k]).toBeCloseTo(k * c.step + (c.step - 1) / 2, 6);
    expect(c.series[3]![10]).toBeCloseTo(4 * (10 * c.step + (c.step - 1) / 2), 6);
  });

  it('records the figures each month, with milestones and disasters on the timeline', () => {
    const sim = newSim({ seed: 'chron' });
    buildTown(sim);
    serveTown(sim);
    const months = 20;
    sim.advance(months * TICKS_PER_MONTH);
    const c = sim.state.chronicle;
    expect(c.step).toBe(1);
    expect(col(c, 'population').length).toBe(months);
    // Each point is the population as the month closed; the town has grown since the start.
    const pop = col(c, 'population');
    expect(pop[pop.length - 1]).toBeGreaterThan(pop[0]!);
    expect(pop[pop.length - 1]).toBeGreaterThan(0);
    for (const k of CHRONICLE_SERIES) for (const v of col(c, k)) expect(Number.isFinite(v)).toBe(true);
    expect(col(c, 'approval').every((v) => v >= 0 && v <= 100)).toBe(true);
    expect(col(c, 'spending').some((v) => v > 0)).toBe(true);
    // The first milestone came as the town grew.
    expect(c.events.some((e) => e.kind === 'milestone' && e.ref === 1)).toBe(true);
    const at = { x: connectPoint(sim).x + 200, z: connectPoint(sim).z };
    expect(sim.dispatch({ type: 'disaster', kind: 'meteor', at }).ok).toBe(true);
    expect(c.events[c.events.length - 1]).toMatchObject({
      kind: 'disaster',
      ref: 'meteor',
      tick: sim.state.tick,
    });
    // The panel's query hands over a copy.
    const q = sim.query({ type: 'chronicle' }) as Chronicle;
    expect(q).toEqual(c);
    expect(q.series).not.toBe(c.series);
  });

  it('survives save and load exactly, and carries on the same', () => {
    const sim = newSim({ seed: 'chron2' });
    buildTown(sim);
    serveTown(sim);
    sim.advance(9 * TICKS_PER_MONTH + 300);
    const loaded = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    expect(loaded.state.chronicle).toEqual(sim.state.chronicle);
    expect(loaded.hash()).toBe(sim.hash());
    sim.advance(3 * TICKS_PER_MONTH);
    loaded.advance(3 * TICKS_PER_MONTH);
    expect(loaded.state.chronicle).toEqual(sim.state.chronicle);
    expect(loaded.hash()).toBe(sim.hash());
  });

  it('older saves start their history when loaded, and play on', () => {
    const save = decodeSave(readFileSync('Saves/Ashton.citybloom'));
    expect(save.version).toBeLessThan(14);
    const sim = Sim.fromSave(save);
    sim.testMode = true;
    const c = sim.state.chronicle;
    expect(c.start).toBe(sim.state.tick);
    expect(col(c, 'population')).toEqual([]);
    sim.advance(2 * TICKS_PER_MONTH);
    expect(col(c, 'population').length).toBe(2);
    expect(col(c, 'population')[1]).toBeGreaterThan(1000);
  });
});
