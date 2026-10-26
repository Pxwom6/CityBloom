import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { checksum } from '../../src/sim/sync';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { warningHours } from '../../src/sim/systems/raids';
import { WARNING } from '../../src/data/battle';
import { buildTown, newSim, placeAlong, serveTown } from '../helpers';

/** M35: raids from computer neighbours, fought in the city. */

/** A war town with an HQ, barracks, a bunker and a few trained squads. */
function raidTown(): { sim: Sim; place: (def: string) => number } {
  const sim = newSim({ rivals: true, disasters: false });
  const { streets } = buildTown(sim);
  serveTown(sim);
  sim.advance(3 * TICKS_PER_MONTH);
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 1_000_000 });
  const segs = [...streets].reverse();
  const place = (def: string) => {
    for (const seg of segs)
      try {
        return placeAlong(sim, def, seg);
      } catch {
        /* next street */
      }
    throw new Error(`no room for ${def}`);
  };
  place('militaryhq');
  const barracks = place('barracks');
  place('bunker');
  for (let k = 0; k < 3; k++) sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
  sim.advance(2 * TICKS_PER_MONTH);
  return { sim, place };
}

function events(sim: Sim, ticks: number): { kind: string; info?: Record<string, number | string> }[] {
  const out: { kind: string; info?: Record<string, number | string> }[] = [];
  for (let t = 0; t < ticks; t++) {
    sim.step();
    out.push(...sim.events.splice(0));
  }
  return out;
}

describe('raids (M35)', () => {
  it('a young, small city is left alone', () => {
    const { sim } = raidTown();
    // Five months old and a town of a couple of thousand: no neighbour sets off.
    sim.advance(2 * TICKS_PER_MONTH);
    expect(sim.state.war!.incoming).toBeUndefined();
    expect(sim.state.war!.battle).toBeUndefined();
  });

  it('a raid is announced, arrives, is fought here, and the city repairs what it broke', () => {
    const { sim } = raidTown();
    const before = sim.state.war!.units.size;
    expect(sim.dispatch({ type: 'cheat', cheat: 'raidIn', hours: 4 }).ok).toBe(true);
    const raid = sim.state.war!.incoming![0]!;
    expect(raid.arrive - raid.warn).toBeGreaterThanOrEqual(WARNING.base * TICKS_PER_HOUR);
    const evs = events(sim, 4 * TICKS_PER_HOUR + 2 * TICKS_PER_HOUR);
    expect(evs.some((e) => e.kind === 'raidWarning')).toBe(true);
    expect(evs.some((e) => e.kind === 'battleStarted')).toBe(true);
    // The battle runs to its end.
    const more = events(sim, 16 * TICKS_PER_HOUR);
    const end = [...evs, ...more].find((e) => e.kind === 'battleEnded');
    expect(end).toBeDefined();
    const w = sim.state.war!;
    expect(w.battle).toBeUndefined();
    const report = w.reports!.at(-1)!;
    expect(report.other).toBe(raid.name);
    expect(report.outcome).not.toBeNull();
    expect(report.theirTotal).toBe(raid.units.length);
    // Something was hit, or someone was lost, on one side or the other.
    const touched =
      report.collapsed.length +
      report.burning.length +
      report.civics.length +
      report.craters +
      report.theirLost;
    expect(touched).toBeGreaterThan(0);
    const lost = Object.values(report.lost).reduce((a, v) => a + (v ?? 0), 0);
    expect(w.units.size).toBe(before - lost);
    // Five days on, every city building and road is repaired.
    sim.advance(5 * 24 * TICKS_PER_HOUR);
    for (const c of sim.state.civics.values()) {
      expect(c.damage).toBe(0);
      expect(c.wrecked).toBeUndefined();
    }
    expect(sim.state.roadDamage.size).toBe(0);
  });

  it('a city saved in the middle of a battle plays on exactly as if it never stopped', () => {
    const { sim } = raidTown();
    sim.dispatch({ type: 'cheat', cheat: 'raidIn', hours: 0 });
    expect(sim.state.war!.battle).toBeDefined();
    sim.advance(90);
    const copy = Sim.fromSave(sim.save());
    copy.testMode = true;
    for (let t = 0; t < 600; t++) {
      sim.step();
      copy.step();
      if (t % 60 === 0) expect(checksum(copy), `tick ${t}`).toBe(checksum(sim));
    }
    expect(checksum(copy)).toBe(checksum(sim));
    expect(copy.state.war!.reports?.length ?? 0).toBe(sim.state.war!.reports?.length ?? 0);
  });

  it('working radars give earlier warning', () => {
    const { sim, place } = raidTown();
    expect(warningHours(sim)).toBe(WARNING.base);
    place('radar');
    sim.advance(6 * TICKS_PER_HOUR);
    expect(warningHours(sim)).toBe(WARNING.base + WARNING.perRadar);
  });
});
