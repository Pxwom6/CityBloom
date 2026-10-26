import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { checksum } from '../../src/sim/sync';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { warningHours } from '../../src/sim/systems/raids';
import { RAIDS, WARNING } from '../../src/data/battle';
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
    // A raid big enough to be fought a while (every neighbour well armed).
    for (const n of sim.state.region.neighbours)
      if (n.rival) sim.dispatch({ type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 40, defences: 5 });
    sim.dispatch({ type: 'cheat', cheat: 'raidIn', hours: 0 });
    expect(sim.state.war!.battle).toBeDefined();
    // Saved after the fighting has begun to tell (a building hit, a unit lost), not before.
    const told = () => {
      const r = sim.state.war!.battle?.report;
      return (
        !r ||
        r.collapsed.length +
          r.burning.length +
          r.civics.length +
          r.craters +
          r.theirLost +
          Object.keys(r.lost).length >
          0
      );
    };
    for (let t = 0; t < 600 && !told(); t++) sim.step();
    expect(sim.state.war!.battle).toBeDefined();
    sim.advance(7);
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

  it('neighbours raid a city past the bar on their own, at most one raid at a time', () => {
    const { sim } = raidTown();
    // The test town tops out under the bar of RAIDS.minPopulation residents: lowered for this run.
    const bar = RAIDS.minPopulation;
    (RAIDS as { minPopulation: number }).minPopulation = 1_000;
    try {
      const raids: string[] = [];
      for (let t = 0; t < 30 * TICKS_PER_MONTH && raids.length < 2; t++) {
        sim.step();
        const w = sim.state.war!;
        expect(w.incoming?.length ?? 0).toBeLessThanOrEqual(1);
        for (const e of sim.events.splice(0))
          if (e.kind === 'raidWarning') {
            raids.push(String(e.info?.name ?? ''));
            // Not before the city is a year old.
            expect(sim.state.tick).toBeGreaterThanOrEqual(RAIDS.minMonths * TICKS_PER_MONTH);
          }
      }
      expect(raids.length).toBeGreaterThan(0);
      const w = sim.state.war!;
      // Each neighbour waits its months between raids; any two are a few months apart.
      const by = Object.values(w.raided!.by);
      expect(by.length).toBeGreaterThan(0);
    } finally {
      (RAIDS as { minPopulation: number }).minPopulation = bar;
    }
  }, 300_000);

  it('a neighbour the city struck may answer, even while the city is small', () => {
    const { sim } = raidTown();
    const w = sim.state.war!;
    const rival = sim.state.region.neighbours.find((n) => n.rival)!;
    expect(
      sim.dispatch({ type: 'cheat', cheat: 'rival', neighbour: rival.id, forces: 60, defences: 0 }).ok,
    ).toBe(true);
    const units = [...w.units.values()].map((u) => u.id);
    const sent = sim.dispatch({
      type: 'sendForce',
      units,
      to: rival.id,
      route: 'highway',
      target: 'military',
      stance: 'bold',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) throw new Error(sent.reason);
    const id = sent.created![0]!;
    for (
      let t = 0;
      t < 24 * TICKS_PER_HOUR && w.expeditions!.find((e) => e.id === id)!.state !== 'fighting';
      t++
    )
      sim.step();
    const r = sim.dispatch({
      type: 'battleReport',
      expedition: id,
      result: {
        outcome: 'raided',
        units: units.map((u) => ({ id: u, hp: 0.8, out: false })),
        theirLost: 2,
        theirStrength: 6,
        defencesLost: 0,
        destroyed: 3,
        damaged: 2,
        objectives: { aimed: 2, down: 1 },
        hash: 'x',
      },
    });
    expect(r.ok).toBe(true);
    expect(w.struck![rival.id]).toBe(sim.state.tick);
    // The city is small and young, but the neighbour it struck sets off within the months it remembers.
    expect(sim.state.totals.population).toBeLessThan(RAIDS.minPopulation);
    let raid: string | undefined;
    for (let t = 0; t < RAIDS.retaliate * TICKS_PER_MONTH && !raid; t++) {
      sim.step();
      raid = w.incoming?.[0]?.name;
    }
    expect(raid).toBe(rival.name);
  }, 300_000);

  it('working radars give earlier warning', () => {
    const { sim, place } = raidTown();
    expect(warningHours(sim)).toBe(WARNING.base);
    place('radar');
    sim.advance(6 * TICKS_PER_HOUR);
    expect(warningHours(sim)).toBe(WARNING.base + WARNING.perRadar);
  });
});
