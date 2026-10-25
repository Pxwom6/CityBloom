import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave, encodeSave } from '../../src/client/saves';
import { SAVE_VERSION } from '../../src/sim/save';
import { Sim } from '../../src/sim/sim';
import { Lockstep } from '../../src/sim/lockstep';
import { checkInvariants } from '../../src/sim/invariants';
import { applyRegionUpdate, type RegionUpdate } from '../../src/sim/systems/region';
import { TICKS_PER_MONTH } from '../../src/sim/time';

/**
 * F13: a real save from the live site before multiplayer (save v24, grown by `main`'s own balance
 * mayor at 6f049d3; `scripts/dev/legacy-corpus.mjs 24 --presets river`). Players will bring cities
 * like it into rooms and regions, so beyond the corpus's two years of play (corpus-c): it loads with
 * its street names as saved, nothing in it belongs to another player, it saves back to the same city,
 * a shared copy keeps step with one played alone, and it can join a shared region.
 */
const FILE = 'Saves/legacy/v24-river.citybloom';
const load = () => decodeSave(readFileSync(FILE));

type RawSegments = { net: { segments: { $m: [number, { name?: string }][] } } };

const UPDATE: RegionUpdate = {
  cities: [
    {
      slot: 1,
      name: 'Upstream',
      mayor: 'Ada',
      color: 0x4a90d9,
      population: 5200,
      kind: 'industrial',
      offers: { buy: { power: 20, water: 0, garbage: 0 }, sell: { power: 0, water: 30, garbage: 10 } },
      workers: 400,
      jobs: 250,
      shoppers: 120,
      online: true,
    },
  ],
  contracts: [{ slot: 1, resource: 'water', direction: 'buy', amount: 10 }],
  project: { total: 50_000, goal: 400_000, funded: false, host: false, built: false, power: 0 },
};

describe('a v24 save from the live site', () => {
  it('is a v24 save, older than this build', () => {
    expect(load().version).toBe(24);
    expect(SAVE_VERSION).toBeGreaterThan(24);
  });

  it('keeps every street name it was saved with', () => {
    const save = load();
    const raw = (save.state as RawSegments).net.segments.$m;
    expect(raw.length).toBeGreaterThan(10);
    const sim = Sim.fromSave(save);
    expect(sim.state.net.segments.size).toBe(raw.length);
    for (const [id, seg] of raw) {
      expect(seg.name, `segment ${id} saved without a name`).toBeTruthy();
      expect(sim.state.net.segments.get(id)?.name, `segment ${id}`).toBe(seg.name);
    }
  });

  it('loads as a city of one: nobody else built anything, no region project, no other players', () => {
    const sim = Sim.fromSave(load());
    const r = sim.state.region;
    expect(sim.state.builtBy.size).toBe(0);
    expect(r.project).toBeNull();
    expect(r.neighbours).toHaveLength(3);
    expect(r.neighbours.filter((n) => n.player)).toEqual([]);
    expect(r.deals.filter((d) => d.remote)).toEqual([]);
    sim.testMode = true;
    checkInvariants(sim);
  });

  it('saves and loads back to the same city', () => {
    const sim = Sim.fromSave(load());
    const file = sim.save('');
    expect(file.version).toBe(SAVE_VERSION);
    const back = Sim.fromSave(decodeSave(encodeSave(file)));
    expect(back.hash()).toBe(sim.hash());
  });

  it('shared in a room, it keeps step with the same city played alone for a month', () => {
    const save = load();
    const room = new Lockstep(Sim.fromSave(save));
    const alone = Sim.fromSave(save);
    room.allow(room.sim.tick + TICKS_PER_MONTH);
    expect(room.run()).toBe(TICKS_PER_MONTH);
    alone.advance(TICKS_PER_MONTH);
    expect(room.sim.hash()).toBe(alone.hash());
  });

  it('joins a shared region: another city takes a neighbour’s place and it pays into the project', () => {
    const sim = Sim.fromSave(load());
    sim.testMode = true;
    applyRegionUpdate(sim, UPDATE);
    const r = sim.state.region;
    expect(r.neighbours.filter((n) => n.player).map((n) => n.name)).toEqual(['Upstream']);
    expect(r.deals.filter((d) => d.remote)).toHaveLength(1);
    expect(r.project).toMatchObject({ total: 50_000, goal: 400_000, mine: 0 });
    const before = sim.state.treasury;
    const paid = sim.dispatch({ type: 'contributeProject', amount: 5_000 });
    expect(paid).toMatchObject({ ok: true, cost: 5_000 });
    expect(sim.state.treasury).toBe(before - 5_000);
    expect(r.project).toMatchObject({ total: 55_000, mine: 5_000 });
    sim.advance(TICKS_PER_MONTH);
    checkInvariants(sim);
    // And it saves as a city in a region.
    const back = Sim.fromSave(decodeSave(encodeSave(sim.save(''))));
    expect(back.state.region.project).toEqual(sim.state.region.project);
    expect(back.hash()).toBe(sim.hash());
  });
});
