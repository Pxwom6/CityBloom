import { describe, expect, it } from 'vitest';
import { Lockstep, type Stamped } from '../../src/sim/lockstep';
import { Sim } from '../../src/sim/sim';
import { simDesync, partHashes, differingParts, checksum } from '../../src/sim/sync';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import type { Command } from '../../src/sim/commands';
import { growTown, newTown } from './scriptedTown';
import { decodeSave, encodeSave } from '../../src/client/saves';

/** Play the scripted town once (shared, so cheats are refused) and keep the stamped events. */
function recordTown(months: number): { events: Stamped[]; ref: Sim; monthHashes: Record<string, string>[] } {
  const events: Stamped[] = [];
  const monthHashes: Record<string, string>[] = [];
  let seq = 0;
  const { sim } = growTown(
    months,
    (s) => monthHashes.push(partHashes(s)),
    (s, cmd) => {
      events.push({
        tick: s.tick,
        seq: seq++,
        ev: { kind: 'cmd', cmd: JSON.parse(JSON.stringify(cmd)) as Command, by: 1 },
      });
      return s.dispatch(cmd, 1);
    },
    true,
  );
  return { events, ref: sim, monthHashes };
}

const MONTHS = 12;
const recorded = recordTown(MONTHS);

describe('lockstep (M29)', () => {
  it('two sims fed the same stamped commands stay in step for a game year, with the reference', () => {
    const a = new Lockstep(newTown(true));
    const b = new Lockstep(newTown(true));
    for (const e of recorded.events) {
      expect(a.push(e)).toBe('ok');
      expect(b.push(structuredClone(e))).toBe('ok');
    }
    for (let m = 0; m < MONTHS; m++) {
      const end = (m + 1) * TICKS_PER_MONTH;
      // The room lets them run in uneven steps; neither drops a tick.
      a.allow(end);
      b.allow(end);
      while (a.behind) a.run(97);
      while (b.behind) b.run(1000);
      for (const [t, sum] of a.checksums) expect(b.checksums.get(t), `hour ending ${t}`).toBe(sum);
      const ha = partHashes(a.sim);
      expect(differingParts(ha, partHashes(b.sim))).toEqual([]);
      expect(differingParts(ha, recorded.monthHashes[m]!)).toEqual([]);
    }
    expect(a.ticksRun).toBe(MONTHS * TICKS_PER_MONTH);
    expect(recorded.ref.state.totals.population).toBeGreaterThan(500);
    expect(a.sim.hash()).toBe(recorded.ref.hash());
  });

  it('a sim given one command a tick late is caught within a game hour, and the report names what differs', () => {
    const a = new Lockstep(newTown(true));
    const c = new Lockstep(newTown(true));
    // The first road of month 1, a tick late for c.
    const victim =
      recorded.events.find(
        (e) => e.tick >= TICKS_PER_MONTH && e.ev.kind === 'cmd' && e.ev.cmd.type === 'buildRoad',
      ) ?? recorded.events.find((e) => e.tick >= TICKS_PER_MONTH)!;
    for (const e of recorded.events) {
      a.push(e);
      c.push(e === victim ? { ...e, tick: e.tick + 1 } : e);
    }
    let caught = -1;
    for (let t = 0; t < victim.tick + 2 * TICKS_PER_MONTH && caught < 0; t += TICKS_PER_HOUR) {
      a.allow(t + TICKS_PER_HOUR);
      c.allow(t + TICKS_PER_HOUR);
      a.run();
      c.run();
      const at = a.sim.tick;
      if (a.checksums.get(at) !== c.checksums.get(at)) caught = at;
    }
    expect(caught).toBeGreaterThan(victim.tick);
    expect(caught - victim.tick).toBeLessThanOrEqual(TICKS_PER_HOUR);
    const report = simDesync(a.sim, c.sim);
    expect(report.part).not.toBeNull();
    expect(report.text).toMatch(/First difference in /);
  });

  it('a late event is refused as late, and repeats are ignored', () => {
    const r = new Lockstep(newTown(true));
    r.allow(10);
    r.run();
    expect(
      r.push({
        tick: 5,
        seq: 0,
        ev: { kind: 'cmd', cmd: { type: 'setPolicy', id: 'recycling', on: true }, by: 1 },
      }),
    ).toBe('late');
    expect(
      r.push({
        tick: 12,
        seq: 0,
        ev: { kind: 'cmd', cmd: { type: 'setPolicy', id: 'recycling', on: true }, by: 1 },
      }),
    ).toBe('repeat');
    expect(
      r.push({
        tick: 12,
        seq: 1,
        ev: { kind: 'cmd', cmd: { type: 'setPolicy', id: 'recycling', on: true }, by: 1 },
      }),
    ).toBe('ok');
    expect(r.behind).toBe(0);
    expect(r.pending).toBe(1);
  });

  it('cheats are refused in a shared city', () => {
    const sim = newTown(true);
    const r = sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 1000 });
    expect(r).toMatchObject({ ok: false, reason: 'Cheats are off in a shared city' });
    expect(sim.preview({ type: 'cheat', cheat: 'unlockAll' }).ok).toBe(false);
  });

  it('previews and queries between ticks leave the future alone', () => {
    const quiet = Sim.fromSave(recorded.ref.save());
    const busy = Sim.fromSave(recorded.ref.save());
    quiet.shared = busy.shared = true;
    // Every command the town ever issued, as previews, plus every query, between ticks.
    const cmds = recorded.events
      .map((e) => (e.ev.kind === 'cmd' ? e.ev.cmd : null))
      .filter((c): c is Command => !!c);
    const queries = poke(busy);
    for (let h = 0; h < 24 * 12; h++) {
      for (let i = 0; i < 6; i++) busy.preview(cmds[(h * 6 + i) % cmds.length]!, 1);
      for (const q of queries) busy.query(q as never);
      busy.stats();
      busy.collectFrame();
      busy.budget();
      busy.advance(TICKS_PER_HOUR);
      quiet.advance(TICKS_PER_HOUR);
      if (h % 24 === 23) expect(checksum(busy), `day ${h / 24}`).toBe(checksum(quiet));
    }
    expect(simDesync(quiet, busy).part).toBeNull();
    expect(busy.hash()).toBe(quiet.hash());
  });

  it('a settled snapshot carries on exactly like the city it was taken from, history included', () => {
    const live = Sim.fromSave(recorded.ref.save());
    live.shared = true;
    live.advance(TICKS_PER_HOUR * 2 + 2); // into a commute round: the settle finishes it
    live.finishMatching();
    const twin = Sim.fromSave(decodeSave(encodeSave(live.save())));
    twin.shared = true;
    twin.setHistoryState(live.historyState());
    for (let m = 0; m < 12; m++) {
      live.advance(TICKS_PER_MONTH);
      twin.advance(TICKS_PER_MONTH);
      expect(differingParts(partHashes(live), partHashes(twin)), `month ${m}`).toEqual([]);
    }
    expect(twin.historyState()).toEqual(live.historyState());
  });
});

describe('undo in a shared city (M29)', () => {
  it('each player undoes only their own newest action, and a late joiner can too', () => {
    const sim = newTown(true);
    const n = sim.state.net.nodes.get(sim.state.highway.connect)!;
    const road = (x: number, by: number) =>
      sim.dispatch(
        {
          type: 'buildRoad',
          road: 'street',
          points: [
            { x: n.x + x, z: n.z - 150 },
            { x: n.x + x, z: n.z + 150 },
          ],
        },
        by,
      );
    const avenue = sim.dispatch(
      {
        type: 'buildRoad',
        road: 'avenue',
        points: [
          { x: n.x, z: n.z },
          { x: n.x + 400, z: n.z },
        ],
      },
      1,
    );
    expect(avenue.ok).toBe(true);
    const mine = road(120, 1);
    // Player 2's street stands apart (touching player 1's roads would block the undo, as below).
    const theirs = sim.dispatch(
      {
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: n.x + 300, z: n.z - 320 },
          { x: n.x + 300, z: n.z - 160 },
        ],
      },
      2,
    );
    expect(mine.ok && theirs.ok).toBe(true);
    const has = (r: typeof mine) => r.ok && r.created!.some((id) => sim.state.net.segments.has(id));
    // Player 1's newest action is their street: undoing it leaves player 2's.
    expect(sim.dispatch({ type: 'undo' }, 1)).toMatchObject({ ok: true, info: { label: 'road' } });
    expect(has(mine)).toBe(false);
    expect(has(theirs)).toBe(true);
    // Player 3 has nothing to undo.
    expect(sim.dispatch({ type: 'undo' }, 3)).toMatchObject({ ok: false, reason: 'Nothing to undo' });
    // A late joiner's copy carries the histories: player 2 undoes there, the same as here.
    const joiner = Sim.fromSave(decodeSave(encodeSave(sim.save())));
    joiner.shared = true;
    joiner.setHistoryState(sim.historyState());
    expect(sim.dispatch({ type: 'undo' }, 2).ok).toBe(true);
    expect(joiner.dispatch({ type: 'undo' }, 2).ok).toBe(true);
    expect(joiner.hash()).toBe(sim.hash());
    // Player 1 redoes their street; the avenue under it is still theirs to undo afterwards.
    expect(sim.dispatch({ type: 'redo' }, 1).ok).toBe(true);
    expect(has(mine)).toBe(true);
  });

  it("an action someone else has built on since can't be undone", () => {
    const sim = newTown(true);
    const n = sim.state.net.nodes.get(sim.state.highway.connect)!;
    const av = sim.dispatch(
      {
        type: 'buildRoad',
        road: 'avenue',
        points: [
          { x: n.x, z: n.z },
          { x: n.x + 400, z: n.z },
        ],
      },
      1,
    );
    expect(av.ok).toBe(true);
    // Player 2 joins a street onto player 1's avenue (splitting it).
    const st = sim.dispatch(
      {
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: n.x + 200, z: n.z },
          { x: n.x + 200, z: n.z - 150 },
        ],
      },
      2,
    );
    expect(st.ok).toBe(true);
    const r = sim.dispatch({ type: 'undo' }, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^Can't undo the road: .* since$/);
  });
});

/** A query of every kind the client makes, with arguments from the city. */
function poke(sim: Sim): unknown[] {
  const b = [...sim.state.buildings.values()][0];
  const c = [...sim.state.civics.values()][0];
  const maps = [
    'power',
    'water',
    'sewage',
    'garbage',
    'groundwater',
    'groundPollution',
    'landValue',
    'resources',
    'fire',
    'police',
    'health',
    'education',
    'park',
    'crime',
    'happiness',
    'wealth',
    'traffic',
    'airPollution',
    'eduLevel',
    'transit',
    'noise',
    'region',
  ];
  return [
    { type: 'hash' },
    { type: 'summary' },
    { type: 'building', id: b?.id ?? 0 },
    { type: 'budget' },
    { type: 'supply' },
    { type: 'chronicle' },
    { type: 'civic', id: c?.id ?? 0 },
    ...maps.map((map) => ({ type: 'overlay', map })),
    { type: 'coveragePreview', def: 'firestation', x: c?.x ?? 0, z: (c?.z ?? 0) + 40, angle: 0, side: 1 },
    { type: 'advisors' },
    { type: 'thoughts', count: 5 },
    ...['fire', 'police', 'health', 'education', 'park'].map((kind) => ({ type: 'coverageRoads', kind })),
    { type: 'districts' },
  ];
}
