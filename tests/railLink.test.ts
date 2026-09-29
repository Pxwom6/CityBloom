import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../src/client/saves';
import type { SaveFile } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { advise } from '../src/sim/systems/advisors';
import { linkedToRegion, railTerminals } from '../src/sim/systems/rail';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { freightTown } from './freightTown';
import { buildTown, newSim, placeAlong, road, serveTown } from './helpers';

/** Take a city's rail link away, as if it had been founded before M20 and none had fitted. */
function stripLink(sim: Sim): number {
  const r = sim.state.railway!;
  const z = sim.state.net.nodes.get(r.connect)!.z;
  sim.net.removeSegment(r.segment);
  sim.net.removeNodeIfOrphan(r.outside);
  sim.net.removeNodeIfOrphan(r.connect);
  sim.state.railway = null;
  sim.markNetworkChanged();
  return z;
}

/** Save and load a city as a pre-M20 save: no railway recorded, so loading tries to lay one. */
function asPreRail(sim: Sim): Sim {
  const save = JSON.parse(JSON.stringify(sim.save())) as SaveFile;
  delete (save.state as Record<string, unknown>).railway;
  return Sim.fromSave(save);
}

describe('a regional rail link for older cities (Phase 2 review)', () => {
  it("on the user's save: offered once its link is gone, placed on the west edge, and undone exactly", () => {
    const sim = Sim.fromSave(decodeSave(readFileSync('Saves/Legacy-no-rail.citybloom')));
    // The uploaded save already has its link (laid when it was first loaded after M20).
    expect(sim.state.railway).not.toBeNull();
    expect(sim.stats().railLinkOffered).toBe(false);
    expect(sim.preview({ type: 'buildRailLink', z: 1000 })).toMatchObject({
      ok: false,
      reason: 'The city already has its regional rail link',
    });
    const was = stripLink(sim);
    expect(was).toBe(1790);
    expect(sim.stats().railLinkOffered).toBe(true);
    const hz = sim.terrain.gen.params.highway.connectZ;
    // Too near the highway; a dirt road along the edge; a slope; and where the old link was, the
    // city's $22,533 won't pay for it.
    const refused = (z: number) => {
      const r = sim.preview({ type: 'buildRailLink', z });
      return r.ok ? 'ok' : r.reason;
    };
    expect(refused(hz + 100)).toMatch(/160 m from the highway/);
    expect(refused(1860)).toMatch(/road is in the way/);
    expect(refused(400)).toMatch(/Too steep/);
    expect(refused(1790)).toBe('Not enough money');
    sim.testMode = true;
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 50_000 });
    expect(refused(1790)).toBe('ok');
    const before = sim.hash();
    const money = sim.state.treasury;
    const r = sim.dispatch({ type: 'buildRailLink', z: 1790 });
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    expect(sim.state.treasury).toBe(money - 40_000);
    const link = sim.state.railway!;
    expect(sim.state.net.nodes.get(link.connect)).toMatchObject({ x: 24, z: 1790 });
    expect(sim.state.net.segments.get(link.segment)!.type).toBe('mainline');
    const box = [...sim.state.civics.values()].find((c) => c.def === 'raillink')!;
    expect(box.access?.seg).toBe(link.segment);
    expect(sim.stats().railLinkOffered).toBe(false);
    // The junction building stays put.
    expect(sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: box.id } }).ok).toBe(false);
    expect(sim.dispatch({ type: 'bulldoze', target: { kind: 'segment', id: link.segment } })).toMatchObject({
      ok: false,
      reason: "The regional railway can't be bulldozed",
    });
    // Undo takes it all back; redo lays it again.
    const after = sim.hash();
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.state.railway).toBeNull();
    expect(sim.hash()).toBe(before);
    expect(sim.dispatch({ type: 'redo' }).ok).toBe(true);
    expect(sim.hash()).toBe(after);
    sim.advance(TICKS_PER_MONTH);
    const back = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())) as SaveFile);
    expect(back.state.railway).toEqual(sim.state.railway);
    expect(back.hash()).toBe(sim.hash());
  });

  it('on a city whose whole west edge is built up: none fits on loading, the placed one clears its way', () => {
    const sim = newSim({ seed: 'goods' });
    stripLink(sim);
    buildTown(sim);
    serveTown(sim);
    const hz = sim.terrain.gen.params.highway.connectZ;
    // Homes all along the west edge, on a street 46 m in.
    for (const [z0, z1] of [
      [140, hz - 100],
      [hz + 320, 1908],
    ])
      road(sim, [
        { x: 46, z: z0 },
        { x: 46, z: z1 },
      ]);
    // Joined to the town: to a side street in the north, and to the utility street in the south.
    road(sim, [
      { x: 46, z: hz - 100 },
      { x: 120, z: hz - 100 },
    ]);
    const util = sim.net.nearestSegment({ x: 300, z: hz + 260 }, 60)!;
    road(sim, [
      { x: 46, z: hz + 320 },
      { x: 250, z: hz + 320 },
    ]);
    road(sim, [
      { x: 250, z: hz + 320 },
      { x: 250, z: util.z },
    ]);
    sim.dispatch({
      type: 'zone',
      zone: 'R',
      area: {
        kind: 'brush',
        points: [
          { x: 24, z: 140 },
          { x: 24, z: 1908 },
        ],
        radius: 24,
      },
    });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 400_000 });
    sim.advance(4 * TICKS_PER_MONTH);
    const edge = [...sim.state.buildings.values()].filter((b) => b.x < 40);
    console.log(`[railLink] ${edge.length} buildings along the west edge`);
    expect(edge.length).toBeGreaterThan(100);
    // A fire station by the edge street: civic buildings aren't cleared.
    const street = sim.net.nearestSegment({ x: 46, z: hz + 700 }, 10)!.seg;
    const station = sim.state.civics.get(placeAlong(sim, 'firestation', street))!;
    const old = asPreRail(sim);
    expect(old.state.railway).toBeNull();
    expect(old.stats().railLinkOffered).toBe(true);
    const noLink = (x: Sim) => advise(x).some((a) => a.title === 'No regional rail link');
    expect(noLink(old)).toBe(true);
    if (station.x < 40)
      expect(old.preview({ type: 'buildRailLink', z: Math.round(station.z) })).toMatchObject({
        ok: false,
        reason: 'The fire station is in the way',
      });
    // The preview says what it clears; the link clears it. Every stretch free of the fire station
    // that the ground allows has homes to clear.
    let z = 0;
    let clear = 0;
    let ok = 0;
    for (let at = 140; at <= 1908; at += 16) {
      const pre = old.preview({ type: 'buildRailLink', z: at });
      if (!pre.ok) continue;
      ok++;
      const n = pre.info?.demolish as number;
      if (n > clear) [z, clear] = [at, n];
    }
    console.log(`[railLink] a link fits at ${ok} places along the edge; the best clears ${clear} buildings`);
    expect(clear).toBeGreaterThan(0);
    const n = old.state.buildings.size;
    const r = old.dispatch({ type: 'buildRailLink', z });
    expect(r.ok).toBe(true);
    expect(noLink(old)).toBe(false);
    expect(old.state.buildings.size).toBe(n - clear);
    // Track laid from it across the street reaches the region.
    const connect = old.state.net.nodes.get(old.state.railway!.connect)!;
    const rail = road(
      old,
      [
        { x: connect.x, z: connect.z },
        { x: 200, z: connect.z },
      ],
      'rail',
    ).created!;
    expect(linkedToRegion(old, rail[rail.length - 1]!)).toBe(true);
  });

  it('freight terminals, freight trains and the neighbours’ train commuters all work from a placed link', () => {
    const sim = newSim({ seed: 'goods' });
    const z = stripLink(sim);
    expect(sim.dispatch({ type: 'cheat', cheat: 'unlockAll' }).ok).toBe(true);
    const r = sim.dispatch({ type: 'buildRailLink', z });
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    const t = freightTown(sim);
    sim.advance(5 * TICKS_PER_MONTH);
    const term = t.railway();
    expect(railTerminals(sim).map((c) => c.id)).toEqual([term]);
    // Two stations on the track from the link: a train line, and commuters from the west by train.
    const track = [...sim.state.net.segments.values()]
      .filter((s) => s.type === 'rail')
      .sort((a, b) => sim.net.curve(b.id).length - sim.net.curve(a.id).length)
      .slice(0, 2)
      .map((s) => s.id);
    for (const id of track) placeAlong(sim, 'station', id);
    sim.advance(2 * TICKS_PER_MONTH);
    sim.finishMatching();
    expect(sim.railFreight.get(term) ?? 0).toBeGreaterThan(50);
    expect(sim.transitData().freight.length).toBe(1);
    expect(sim.transitData().lines.some((l) => l.mode === 'train')).toBe(true);
    console.log(
      `[railLink] placed link: ${sim.railFreight.get(term)} truckloads a day by rail, ${sim.regionFlows.byRail} regional trips by train`,
    );
    expect(sim.regionFlows.byRail).toBeGreaterThan(0);
  });
});
