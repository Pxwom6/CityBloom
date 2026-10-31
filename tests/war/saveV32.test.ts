import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../../src/client/saves';
import { SAVE_VERSION, encodeState, migrations } from '../../src/sim/save';
import { Sim } from '../../src/sim/sim';
import { checksum, partHashes } from '../../src/sim/sync';
import { checkInvariants, InvariantError } from '../../src/sim/invariants';
import { atomOf } from '../../src/sim/systems/atom';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { newSim } from '../helpers';

/**
 * M40, save v32: the atom bomb's state appears when first used (`WarState.atom`, and with later steps
 * the fallout, the nuclear winters, a pariah's mark and a computer neighbour's race), so a v31 war
 * city loads as it was and plays on exactly as it did, and a city that never races carries none of it.
 *
 * The fixture is a war city saved at the M39 tip, before any M40 change (step 0): research done and
 * queued, a war ended by a treaty paying tribute, war weariness and a sanction. Its golden is what it
 * played on to in two months then. A moved hash is a bug to find, never a golden to rewrite.
 */
const V31 = 'tests/fixtures/war/v31-war.citybloom';
const GOLDEN = 'tests/fixtures/war/v31-war.json';
const M = TICKS_PER_MONTH;

/** The v31 war save, loaded and played on two months: its parts but the version. */
function v31Parts(): Record<string, string> {
  const sim = Sim.fromSave(decodeSave(new Uint8Array(readFileSync(V31))));
  sim.advance(2 * M);
  const parts = partHashes(sim);
  delete parts.version;
  return parts;
}

/** Every key at any depth of an encoded value. */
function keysOf(v: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) keysOf(x, into);
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      into.add(k);
      keysOf(x, into);
    }
  return into;
}

/** The names M40 adds to a saved state, which no city that never races may carry. */
const NEW_KEYS = ['atom', 'fallout', 'winters', 'pariah'];

describe('M40: save v32', () => {
  it('has an identity migration from v31', () => {
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(32);
    const state = { x: 1 };
    expect(migrations[31]).toBeTypeOf('function');
    expect(migrations[31]!(state)).toBe(state);
  });

  it('a v31 war save loads without a race and plays two months on to exactly the parts it was saved with', () => {
    const save = decodeSave(new Uint8Array(readFileSync(V31)));
    expect(save.version).toBe(31);
    const sim = Sim.fromSave(save);
    expect(sim.state.version).toBe(SAVE_VERSION);
    expect(sim.state.war!.atom).toBeUndefined();
    expect(sim.state.war!.research?.done.length).toBeGreaterThan(0);
    expect(v31Parts()).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  });

  it('and nothing of M40 appears in it while it plays', () => {
    const sim = Sim.fromSave(decodeSave(new Uint8Array(readFileSync(V31))));
    sim.advance(2 * M);
    const keys = keysOf(encodeState(sim.state));
    for (const k of NEW_KEYS) expect(keys.has(k), k).toBe(false);
    expect(Object.keys(sim.state)).not.toContain('fallout');
    for (const n of sim.state.region.neighbours)
      for (const k of ['bomb', 'fallout']) expect(n.rival ? Object.keys(n.rival) : [], k).not.toContain(k);
    expect(sim.state.war!.supers?.dome ? Object.keys(sim.state.war!.supers.dome) : []).not.toContain('down');
    expect(sim.state.war!.diplomacy ? Object.keys(sim.state.war!.diplomacy) : []).not.toContain('pariah');
    expect(sim.state.weather).not.toHaveProperty('winters');
  });

  it('a save relabelled as v31 loads the same', () => {
    const sim = newSim({ rivals: true, disasters: false });
    sim.advance(M);
    const file = sim.save('2026-10-31') as { version: number };
    file.version = 31;
    const old = Sim.fromSave(file as never);
    expect(old.state.version).toBe(SAVE_VERSION);
    expect(old.hash()).toBe(sim.hash());
  });

  it('a peaceful town’s saved state has none of the new keys, at the top or anywhere below', () => {
    const sim = newSim({ disasters: false });
    sim.advance(3 * M);
    expect(sim.state.war).toBeUndefined();
    const encoded = encodeState(sim.state);
    const keys = keysOf(encoded);
    for (const k of NEW_KEYS) expect(keys.has(k), k).toBe(false);
    // Its parts are the peace golden's: no part added, none dropped (the golden has no version).
    const golden = JSON.parse(readFileSync('tests/fixtures/war/peace-main.json', 'utf8')) as {
      parts: Record<string, string>;
    }[];
    const parts = Object.keys(partHashes(sim))
      .filter((k) => k !== 'version')
      .sort();
    expect(parts).toEqual(Object.keys(golden[0]!.parts).sort());
  });

  it('a war city that never races has no race, and the same save as before', () => {
    const sim = newSim({ rivals: true, disasters: false });
    sim.advance(3 * M);
    expect(sim.state.war).toBeDefined();
    expect(sim.state.war!.atom).toBeUndefined();
    const keys = keysOf(encodeState(sim.state));
    for (const k of NEW_KEYS) expect(keys.has(k), k).toBe(false);
  });
});

describe('M40: the race in the saved state', () => {
  /** A war town a month old, with a race begun. */
  function racing() {
    const sim = newSim({ rivals: true, disasters: false });
    sim.advance(M);
    const a = atomOf(sim);
    a.fuel = 300.5;
    a.bomb = { done: 12, paid: 1 };
    return sim;
  }

  it('is saved, loaded and played on identically, and counts in the hashes only once it exists', () => {
    const plain = newSim({ rivals: true, disasters: false });
    plain.advance(M);
    const sim = racing();
    // The same city, the same checksum; the race moves it.
    expect(checksum(sim)).not.toBe(checksum(plain));
    const a = partHashes(sim);
    const b = partHashes(plain);
    expect(a.war).not.toBe(b.war);
    delete sim.state.war!.atom;
    expect(partHashes(sim)).toEqual(b);
    expect(checksum(sim)).toBe(checksum(plain));
    // A saved race is loaded as it was and plays on the same.
    const again = racing();
    const loaded = Sim.fromSave(again.save('2026-10-31') as never);
    expect(loaded.state.war!.atom).toEqual(again.state.war!.atom);
    expect(partHashes(loaded)).toEqual(partHashes(again));
    again.advance(3 * M);
    loaded.advance(3 * M);
    expect(partHashes(loaded)).toEqual(partHashes(again));
    expect(loaded.state.war!.atom).toEqual(again.state.war!.atom);
  });

  it('is checked every tick in test mode: finite facts in range, one bomb, a flight with a target', () => {
    const bad: ((a: ReturnType<typeof atomOf>) => void)[] = [
      (a) => (a.fuel = Number.NaN),
      (a) => (a.fuel = -1),
      (a) => (a.fuel = 1e9),
      (a) => (a.bomb = { done: Number.POSITIVE_INFINITY, paid: 0 }),
      (a) => (a.bomb = { done: 1, paid: 99 }),
      (a) => (a.have = true),
      (a) => (a.prep = { done: 1 }),
      (a) => ((a.bomb = undefined), (a.prep = { done: 1 })),
      (a) => (a.fired = { tick: 1, to: 2, name: 'Gravelford' }),
      (a) => ((a.bomb = undefined), (a.have = true), (a.fired = { tick: 1, to: 2, name: 'Gravelford' })),
      (a) => ((a.bomb = undefined), (a.fired = { tick: 1, to: Number.NaN, name: 'Gravelford' })),
      (a) => ((a.bomb = undefined), (a.fired = { tick: 1, to: 2, name: '' })),
      (a) => (a.inbound = { from: 1, name: 'x', warn: 1, arrive: Number.NaN, x: 0, z: 0 }),
      (a) => (a.impact = { done: 0, fled: 0, x: 0, z: Number.NaN }),
      (a) => (a.boom = -1),
    ];
    for (const [i, change] of bad.entries()) {
      const sim = racing();
      checkInvariants(sim);
      change(atomOf(sim));
      expect(() => checkInvariants(sim), `case ${i}`).toThrow(InvariantError);
    }
    // And the facts of a bomb at each point of its life are fine.
    const sim = racing();
    const a = atomOf(sim);
    checkInvariants(sim);
    delete a.bomb;
    a.have = true;
    checkInvariants(sim);
    a.prep = { done: 100 };
    checkInvariants(sim);
    delete a.have;
    delete a.prep;
    a.fired = { tick: sim.state.tick, to: 2, name: 'Gravelford', slot: 3 };
    a.boom = 1;
    a.stopped = 2;
    a.inbound = { from: 4, name: 'Brookline', warn: 5, arrive: 1445, x: 10, z: 20 };
    a.impact = { done: 3, fled: 1200, x: 10, z: 20 };
    checkInvariants(sim);
  });
});
