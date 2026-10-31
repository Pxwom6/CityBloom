import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { Battle } from '../../src/sim/battle/battle';
import { battleLayout } from '../../src/sim/battle/layout';
import { BATTLE_VERSION, S, TAG, type BattleInput } from '../../src/sim/battle/types';
import { BATTLE_TAKEN, travelHours } from '../../src/sim/systems/raids';
import { FIGHT_TIMEOUT_HOURS, SKIRMISH } from '../../src/data/battle';
import { BState } from '../../src/sim/world/buildings';
import { ZONE_R } from '../../src/data/zones';
import { buildTown, newSim, placeAlong, serveTown } from '../helpers';

/**
 * M35, after review: a battle from outside the city (a friend's page) is checked and brought home
 * so it can't break or flatten the city; units away neither defend nor mend; forces never get stuck
 * away; undo can't bring back what a battle took.
 */

/** A war town with an HQ, barracks, a bunker and three squads at home. */
function warTown(): { sim: Sim; barracks: number } {
  const sim = newSim({ rivals: true, disasters: false });
  const { streets } = buildTown(sim);
  serveTown(sim);
  sim.advance(2 * TICKS_PER_MONTH);
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
  expect(sim.state.war!.units.size).toBe(3);
  return { sim, barracks };
}

/** A battle against the town as its own picture shows it: 24 tanks by road at its military. */
function honest(sim: Sim, id = 'exp-test-1'): BattleInput {
  return {
    v: BATTLE_VERSION,
    id,
    seed: `seed-${id}`,
    scale: 'skirmish',
    layout: battleLayout(sim, { target: 'military', from: 'west' }),
    attacker: {
      name: 'Raiders',
      color: 0xd04040,
      units: Array.from({ length: 24 }, (_, k) => ({
        id: 90_000 + k,
        kind: 'tank' as const,
        hp: 1,
        x: 0,
        z: 0,
        base: -1,
      })),
      route: 'highway',
      target: 'military',
      stance: 'bold',
      readiness: 1,
    },
    defender: { name: sim.state.cityName, color: 0x4060d0 },
    orders: [],
    caps: { maxCollapse: SKIRMISH.maxCollapse, maxWreck: SKIRMISH.maxWreck },
  };
}

const rubble = (sim: Sim) =>
  [...sim.state.buildings.values()].filter((b) => b.state === BState.Rubble).length;

describe('battles from outside the city (M35 review)', () => {
  it('a battle that can’t be read is turned away and changes nothing', () => {
    const { sim } = warTown();
    const bad = honest(sim);
    bad.layout.edges = [...bad.layout.edges];
    bad.layout.edges[0] = 999_999; // a road to a node that isn't there
    const hash = sim.hash();
    for (const mode of ['watch', 'instant'] as const) {
      const r = sim.dispatch({ type: 'battleResolve', input: bad, mode });
      expect(r.ok).toBe(false);
      expect(sim.state.war!.battle).toBeUndefined();
    }
    expect(sim.hash()).toBe(hash);
    for (const junk of [
      {},
      { ...honest(sim), caps: { maxCollapse: -1, maxWreck: 0 } },
      { ...honest(sim), scale: 'atomic' },
    ])
      expect(sim.dispatch({ type: 'battleResolve', input: junk as BattleInput, mode: 'instant' }).ok).toBe(
        false,
      );
    sim.advance(60);
  });

  it('a hosted battle that can’t play ends, and the city plays on', () => {
    const { sim } = warTown();
    expect(sim.dispatch({ type: 'battleResolve', input: honest(sim), mode: 'watch' }).ok).toBe(true);
    // As if an older, broken save held it: the battle's roads point nowhere.
    const hb = sim.state.war!.battle!;
    hb.input = {
      ...hb.input,
      layout: { ...hb.input.layout, edges: hb.input.layout.edges.map(() => 999_999) },
    };
    const copy = Sim.fromSave(sim.save());
    for (const s of [sim, copy]) {
      s.battleRun = null;
      expect(() => s.advance(10)).not.toThrow();
      expect(s.state.war!.battle).toBeUndefined();
    }
  });

  it('a forged picture of the city damages nothing that isn’t there as it says', () => {
    const { sim } = warTown();
    const forged = honest(sim);
    const L = forged.layout;
    const st = [...L.structs];
    const n = st.length / S.stride;
    // The city's homes, moved beside the HQ and made of paper; every unit at the way in, nearly dead.
    let obj = -1;
    for (let k = 0; k < n; k++) if (st[k * S.stride + S.tags]! & TAG.military) obj = k;
    const ox = st[obj * S.stride + S.x]!;
    const oz = st[obj * S.stride + S.z]!;
    for (let k = 0; k < n; k++)
      if (st[k * S.stride + S.tags]! & TAG.home) {
        st[k * S.stride + S.x] = ox + (k % 5) * 8;
        st[k * S.stride + S.z] = oz + 12;
        st[k * S.stride + S.hp] = 1;
      }
    L.structs = st;
    const way = L.entries.find((e) => e.route === 'highway')!;
    L.defenders = L.defenders.map((u) => ({ ...u, hp: 0.05, x: way.x, z: way.z, base: -1 }));
    forged.caps = { maxCollapse: 10_000, maxWreck: 10_000 };
    // On its own, the forgery would knock homes down.
    const raw = Battle.run(structuredClone(forged)).result();
    expect(raw.destroyed.length).toBeGreaterThan(0);
    const units = sim.state.war!.units.size;
    expect(sim.dispatch({ type: 'battleResolve', input: forged, mode: 'instant' }).ok).toBe(true);
    const report = sim.state.war!.reports!.at(-1)!;
    // No home falls (none stands where it says), no unit is lost (none is as it says).
    for (const id of report.collapsed) expect(sim.state.buildings.get(id)?.zone).not.toBe(ZONE_R);
    expect(sim.state.war!.units.size).toBe(units);
    expect(report.collapsed.length).toBeLessThanOrEqual(SKIRMISH.maxCollapse);
  });

  it('each battle from outside is taken once, with the city’s own caps', () => {
    const { sim } = warTown();
    const input = honest(sim, 'exp-twice-7');
    input.caps = { maxCollapse: 10_000, maxWreck: 10_000 };
    const before = rubble(sim);
    expect(sim.dispatch({ type: 'battleResolve', input, mode: 'instant' }).ok).toBe(true);
    expect(rubble(sim) - before).toBeLessThanOrEqual(SKIRMISH.maxCollapse);
    const wrecked = [...sim.state.civics.values()].filter((c) => c.wrecked).length;
    expect(wrecked).toBeLessThanOrEqual(SKIRMISH.maxWreck);
    const again = sim.dispatch({ type: 'battleResolve', input, mode: 'instant' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe(BATTLE_TAKEN);
    // Kept with the city: a reload still knows it.
    const copy = Sim.fromSave(sim.save());
    expect(copy.dispatch({ type: 'battleResolve', input, mode: 'instant' }).ok).toBe(false);
  });
});

describe('forces away (M35 review)', () => {
  const send = (sim: Sim) => {
    const rival = sim.state.region.neighbours.find((n) => n.rival)!;
    const units = [...sim.state.war!.units.keys()];
    const r = sim.dispatch({
      type: 'sendForce',
      units,
      to: rival.id,
      route: 'highway',
      target: 'military',
      stance: 'bold',
    });
    if (!r.ok) throw new Error(r.reason);
    return { id: r.created![0]!, units };
  };

  it('units away neither defend the city nor mend at their base', () => {
    const { sim } = warTown();
    for (const u of sim.state.war!.units.values()) u.hp = 0.5;
    const { units } = send(sim);
    expect(battleLayout(sim, { target: 'military' }).defenders).toHaveLength(0);
    sim.advance(3 * TICKS_PER_HOUR);
    for (const id of units) expect(sim.state.war!.units.get(id)!.hp).toBe(0.5);
  });

  it('a force arriving while the city is shared turns back, and comes home', () => {
    const { sim } = warTown();
    const { id, units } = send(sim);
    sim.shared = true;
    sim.advance(16 * TICKS_PER_HOUR);
    const e = sim.state.war!.expeditions?.find((x) => x.id === id);
    expect(e === undefined || e.state === 'back').toBe(true);
    sim.advance(16 * TICKS_PER_HOUR);
    expect(sim.state.war!.expeditions).toBeUndefined();
    for (const u of units) expect(sim.state.war!.units.get(u)!.away).toBeUndefined();
  });

  it('a force that hears nothing of its battle comes home; one can be called back at its target', () => {
    const { sim } = warTown();
    const { id, units } = send(sim);
    const e = () => sim.state.war!.expeditions?.find((x) => x.id === id);
    for (let t = 0; t < 24 * TICKS_PER_HOUR && e()?.state !== 'fighting'; t++) sim.step();
    expect(e()!.state).toBe('fighting');
    sim.advance((FIGHT_TIMEOUT_HOURS + 1) * TICKS_PER_HOUR);
    expect(e()?.state ?? 'home').not.toBe('fighting');
    sim.advance(24 * TICKS_PER_HOUR);
    for (const u of units) expect(sim.state.war!.units.get(u)!.away).toBeUndefined();
    // Again, called back from its target.
    const again = send(sim);
    for (let t = 0; t < 24 * TICKS_PER_HOUR && sim.state.war!.expeditions![0]!.state !== 'fighting'; t++)
      sim.step();
    expect(sim.dispatch({ type: 'recallForce', expedition: again.id }).ok).toBe(true);
    expect(sim.state.war!.expeditions![0]!.state).toBe('back');
  });

  it('a unit lost in a battle isn’t brought back by redo and undo', () => {
    const { sim, barracks } = warTown();
    const unit = [...sim.state.war!.units.keys()][0]!;
    expect(sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: barracks } }).ok).toBe(true);
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.state.war!.units.has(unit)).toBe(true);
    sim.state.war!.units.delete(unit); // knocked out in a battle
    sim.dispatch({ type: 'redo' });
    sim.dispatch({ type: 'undo' });
    expect(sim.state.war!.units.has(unit)).toBe(false);
  });

  it('travel times go to the half hour', () => {
    expect(travelHours('air', 'west', [])).toBe(1.5);
    expect(travelHours('rail', 'west', [{ kind: 'infantry' }, { kind: 'transport' }])).toBe(3.5);
    expect(travelHours('highway', 'west', [{ kind: 'infantry' }])).toBe(8.5);
  });
});
