import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { SAVE_VERSION, type SaveFile } from '../../src/sim/save';
import { decodeSave, encodeSave } from '../../src/client/saves';
import { CIVIC } from '../../src/data/civic';
import type { Command } from '../../src/sim/commands';
import { may, permsOf, ROLES, roomRefusal, setPerms, type SharedRules } from '../../src/sim/rules';
import { newTown } from './scriptedTown';

describe('who built what, and who may do what (M31)', () => {
  it('a v24 save loads with nobody recorded as having built anything', () => {
    const sim = newTown();
    const save = JSON.parse(JSON.stringify(sim.save())) as SaveFile;
    const state = save.state as Record<string, unknown>;
    delete state.builtBy;
    state.version = 24;
    save.version = 24;
    const back = Sim.fromSave(decodeSave(encodeSave(save)));
    expect(back.state.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(25);
    expect(back.state.builtBy.size).toBe(0);
  });

  it('records the builder in a shared city and holds players to the host’s rules', () => {
    const sim = newTown(true);
    const n = sim.state.net.nodes.get(sim.state.highway.connect)!;
    const road = sim.dispatch(
      {
        type: 'buildRoad',
        road: 'avenue',
        points: [
          { x: n.x, z: n.z },
          { x: n.x + 300, z: n.z },
        ],
      },
      1,
    );
    expect(road.ok).toBe(true);
    const seg = (road.ok ? road.created! : []).find((id) => sim.state.net.segments.has(id))!;
    expect(sim.state.builtBy.get(seg)).toBe(1);
    sim.rules = { host: 1, perms: { 2: ['money'] }, spendLimit: 500 };
    // Player 2 may change taxes but not policies, may not bulldoze player 1's road, nor spend much.
    expect(sim.dispatch({ type: 'setTax', zone: 'R', wealth: 'all', rate: 0.1 }, 2).ok).toBe(true);
    expect(sim.dispatch({ type: 'setPolicy', id: 'recycling', on: true }, 2)).toMatchObject({
      ok: false,
      reason: "The host hasn't let you change policies",
    });
    expect(sim.dispatch({ type: 'bulldoze', target: { kind: 'segment', id: seg } }, 2)).toMatchObject({
      ok: false,
      reason: "The host hasn't let you bulldoze what others built",
    });
    const street = sim.dispatch(
      {
        type: 'buildRoad',
        road: 'avenue',
        points: [
          { x: n.x + 50, z: n.z - 300 },
          { x: n.x + 450, z: n.z - 300 },
        ],
      },
      2,
    );
    expect(street).toMatchObject({ ok: false, reason: "Spending over $500 at once needs the host's say-so" });
    // The host may do anything; the room turns away what it can tell from the command alone.
    expect(sim.dispatch({ type: 'setPolicy', id: 'recycling', on: true }, 1).ok).toBe(true);
    expect(roomRefusal(sim.rules, 2, { type: 'takeLoan', amount: 1000 })).toBeNull();
    expect(roomRefusal(sim.rules, 2, { type: 'promise', promise: 'jobs', on: true })).toMatch(/policies/);
  });
});

describe('the roles of war in a shared city (M39)', () => {
  const military = [...CIVIC.values()].find((d) => d.category === 'military')!;
  const cmds = {
    war: [
      { type: 'declareWar', neighbour: 1, scale: 'war', reason: 'x' },
      { type: 'sendForce', to: 1, units: [1], target: 'military', stance: 'balanced', route: 'road' },
      { type: 'spyMission', neighbour: 1, op: 'reveal' },
    ],
    treaties: [
      { type: 'propose', neighbour: 1, terms: [{ k: 'peace' }] },
      { type: 'setNeutral', on: true },
      { type: 'setSanction', neighbour: 1, on: true },
    ],
    defence: [
      { type: 'trainUnit', base: 1, kind: 'infantry' },
      { type: 'queueResearch', tier: 'land1' },
      { type: 'setFunding', dept: 'defence', pct: 120 },
      { type: 'placeBuilding', def: military.id, x: 0, z: 0, angle: 0, side: 1 },
    ],
  } as unknown as Record<'war' | 'treaties' | 'defence', Command[]>;

  it('the host decides who may wage war, make treaties and spend on defence', () => {
    const rules: SharedRules = {
      host: 1,
      spendLimit: null,
      roles: true,
      perms: { 2: ['money', 'war'], 3: ['treaties', 'defence'] },
    };
    for (const c of cmds.war) {
      expect(roomRefusal(rules, 2, c), c.type).toBeNull();
      expect(roomRefusal(rules, 3, c), c.type).toBe("The host hasn't let you wage war");
    }
    for (const c of cmds.treaties) {
      expect(roomRefusal(rules, 2, c), c.type).toBe("The host hasn't let you make or answer treaties");
      expect(roomRefusal(rules, 3, c), c.type).toBeNull();
    }
    for (const c of cmds.defence) {
      expect(roomRefusal(rules, 2, c), c.type).toBe("The host hasn't let you spend on defence");
      expect(roomRefusal(rules, 3, c), c.type).toBeNull();
    }
    // Other departments' funding is still money; the host may do everything.
    expect(roomRefusal(rules, 2, { type: 'setFunding', dept: 'health', pct: 120 })).toBeNull();
    expect(roomRefusal(rules, 3, { type: 'setFunding', dept: 'health', pct: 120 })).toMatch(/budget/);
    for (const c of Object.values(cmds).flat()) expect(roomRefusal(rules, 1, c)).toBeNull();
  });

  it('new players have every role; a list set before the roles existed reads as allowing them', () => {
    const fresh: SharedRules = { host: 1, spendLimit: null, perms: {} };
    for (const c of Object.values(cmds).flat()) expect(roomRefusal(fresh, 2, c), c.type).toBeNull();
    const old: SharedRules = { host: 1, spendLimit: null, perms: { 2: ['money'], 3: [] } };
    for (const p of ROLES) {
      expect(may(old, 2, p)).toBe(true);
      expect(may(old, 3, p)).toBe(true);
    }
    expect(may(old, 2, 'policies')).toBe(false);
  });

  it('the host setting anyone’s permissions keeps the roles older lists were read as allowing', () => {
    const rules: SharedRules = { host: 1, spendLimit: null, perms: { 2: ['money'], 3: ['speed'] } };
    // The host takes treaties away from player 3 only.
    setPerms(rules, 3, ['speed', 'war', 'defence']);
    expect(rules.roles).toBe(true);
    expect([...permsOf(rules, 2)].sort()).toEqual(['defence', 'money', 'treaties', 'war']);
    expect(may(rules, 3, 'treaties')).toBe(false);
    expect(may(rules, 3, 'war')).toBe(true);
    // From now on a list is read as it stands: none of the roles means none.
    setPerms(rules, 4, ['money']);
    for (const p of ROLES) expect(may(rules, 4, p)).toBe(false);
  });
});
