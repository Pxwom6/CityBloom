import { describe, expect, it } from 'vitest';
import { CIVIC } from '../src/data/civic';
import { Sim } from '../src/sim/sim';
import { NO_CUSTOM, roomRefusal, type SharedRules } from '../src/sim/rules';
import { SAVE_VERSION } from '../src/sim/save';
import { buildTown, placeAlong } from './helpers';

/**
 * M46: a player's own model in the sim is only a hash on the building (`Civic.look`): set when a
 * landmark or any civic building is placed with one, changed or cleared with `setLook`, carried in
 * saves (v34; older saves load with none), gone with the building and with an undo. A landmark works
 * as a park of its size. In a room whose host turned custom buildings off, nothing new wears one.
 */
const HASH = '0123456789abcdef';

function town() {
  const sim = Sim.create({ seed: 'looks', preset: 'river' });
  sim.testMode = true;
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 });
  const t = buildTown(sim, { zone: false });
  return { sim, street: t.streets[0]! };
}

/** A spot beside a street where a building of `def` fits (as `placeAlong` finds one, without placing). */
function spot(sim: Sim, def: string, street: number) {
  const id = placeAlong(sim, def, street);
  const c = sim.state.civics.get(id)!;
  const pose = { x: c.x, z: c.z, angle: c.angle, side: c.side };
  sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id } });
  return pose;
}

describe('M46 players’ own models in the sim', () => {
  it('places a landmark wearing a model, as a park of its size', () => {
    const { sim, street } = town();
    const at = spot(sim, 'landmark2', street);
    const r = sim.dispatch({ type: 'placeBuilding', def: 'landmark2', ...at, look: HASH });
    expect(r.ok).toBe(true);
    const c = sim.state.civics.get(r.ok ? r.created![0]! : -1)!;
    expect(c.look).toBe(HASH);
    expect(sim.civicData(c)).toMatchObject({ def: 'landmark2', look: HASH });
    expect(CIVIC.get('landmark2')).toMatchObject({
      w: 16,
      d: 16,
      category: 'custom',
      service: { kind: 'park' },
    });
    // Undone, it goes with its look.
    sim.dispatch({ type: 'undo' });
    expect(sim.state.civics.has(c.id)).toBe(false);
  });

  it('gives a civic building a model and takes it away; never a big project', () => {
    const { sim, street } = town();
    const id = placeAlong(sim, 'firestation', street);
    expect(sim.dispatch({ type: 'setLook', civic: id, look: HASH }).ok).toBe(true);
    expect(sim.state.civics.get(id)!.look).toBe(HASH);
    expect(sim.dispatch({ type: 'setLook', civic: id, look: null }).ok).toBe(true);
    expect(sim.state.civics.get(id)!.look).toBeUndefined();
    expect(sim.dispatch({ type: 'setLook', civic: 99_999, look: HASH })).toMatchObject({ ok: false });
    const project = [...CIVIC.values()].find((d) => d.project)!;
    expect(
      sim.dispatch({ type: 'placeBuilding', def: project.id, x: 300, z: 300, angle: 0, side: 1, look: HASH }),
    ).toMatchObject({ ok: false, reason: 'That building can’t take a model of your own' });
  });

  it('keeps looks in a save (v34) and opens an older save with none', () => {
    const { sim, street } = town();
    const id = placeAlong(sim, 'clinic', street);
    sim.dispatch({ type: 'setLook', civic: id, look: HASH });
    const file = sim.save('now');
    expect(file.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(34);
    const back = Sim.fromSave(file);
    expect(back.state.civics.get(id)!.look).toBe(HASH);
    expect(back.hash()).toBe(sim.hash());
    // A v33 save (no looks anywhere) opens as it was.
    const plain = town().sim.save('now');
    const old = Sim.fromSave({ ...plain, version: 33 });
    expect([...old.state.civics.values()].every((c) => c.look === undefined)).toBe(true);
  });

  it('refuses a new custom building where the host turned them off, for everyone', () => {
    const rules: SharedRules = { perms: {}, host: 1, spendLimit: null, customBuildings: false };
    const place = {
      type: 'placeBuilding',
      def: 'landmark1',
      x: 0,
      z: 0,
      angle: 0,
      side: 1,
      look: HASH,
    } as const;
    expect(roomRefusal(rules, 2, place)).toBe(NO_CUSTOM);
    expect(roomRefusal(rules, 1, { type: 'setLook', civic: 3, look: HASH })).toBe(NO_CUSTOM);
    // Taking a look away, and placing without one, are fine.
    expect(roomRefusal(rules, 2, { type: 'setLook', civic: 3, look: null })).toBeNull();
    expect(roomRefusal(rules, 2, { ...place, look: undefined })).toBeNull();
    expect(roomRefusal({ ...rules, customBuildings: undefined }, 2, place)).toBeNull();
  });

  it('drops a look that isn’t a model’s hash when a save is loaded (a hand-edited or hostile save)', () => {
    const { sim, street } = town();
    const a = placeAlong(sim, 'firestation', street);
    const b = placeAlong(sim, 'police', street);
    sim.dispatch({ type: 'setLook', civic: a, look: HASH });
    const save = JSON.parse(JSON.stringify(sim.save())) as ReturnType<Sim['save']>;
    // Edited by hand: one look a word, the other kept.
    const civics = (save.state as { civics: { $m: [number, { look?: unknown }][] } }).civics;
    const entry = civics.$m.find(([id]) => id === b)!;
    entry[1].look = 'zz<script>';
    const back = Sim.fromSave(save);
    expect(back.state.civics.get(a)!.look).toBe(HASH);
    expect(back.state.civics.get(b)!.look).toBeUndefined();
  });
});
