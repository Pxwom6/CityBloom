import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { SAVE_VERSION, type SaveFile } from '../../src/sim/save';
import { decodeSave, encodeSave } from '../../src/client/saves';
import { roomRefusal } from '../../src/sim/rules';
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
    expect(SAVE_VERSION).toBe(25);
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
    const seg = road.created!.find((id) => sim.state.net.segments.has(id))!;
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
