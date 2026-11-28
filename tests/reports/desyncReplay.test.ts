/**
 * Replaying a desync (M41): two machines run one shared city, one of them goes wrong on purpose, the
 * reports are built as the pages build them (the worker's DesyncLog, the room's sums) and cleaned as
 * the desk cleans them, and the replay in Node finds the tick the hashes split at and which side left.
 */
import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Lockstep, type Stamped } from '../../src/sim/lockstep';
import { DesyncLog } from '../../src/sim/desyncLog';
import { checksum } from '../../src/sim/sync';
import { TICKS_PER_HOUR } from '../../src/sim/time';
import type { Command, CommandLogEntry } from '../../src/sim/commands';
import { cleanReport, type Report, type ReportDesync } from '../../relay/reports';
import { replayDesync } from '../../scripts/lib/desyncReplay';
import { buildTown, connectPoint, serveTown } from '../helpers';

const OPTIONS = { seed: 'd3sy9c', preset: 'river' as const, cityName: 'Adatown' };
/** Where the shared run starts: the host played alone this long first. */
const T0 = TICKS_PER_HOUR * 3 + 2;

function zone(sim: Sim, kind: 'R' | 'C', dz: number): Command {
  const c = connectPoint(sim);
  return {
    type: 'zone',
    zone: kind,
    area: {
      kind: 'brush',
      points: [
        { x: c.x + 30, z: c.z + dz },
        { x: c.x + 400, z: c.z + dz },
      ],
      radius: 30,
    },
  };
}

/** Two machines: the host founded the city and shared it; the joiner loaded the snapshot it uploaded. */
function play(perturbAt: number, hours: number) {
  const founded = Sim.create(OPTIONS);
  founded.testMode = true;
  buildTown(founded, { zone: false });
  serveTown(founded);
  founded.dispatch({ type: 'renameCity', name: 'Ada’s Town' });
  // An autosave while it was played alone: a single player's save settles the city (the worker
  // records it among the commands, and the replay does the same).
  founded.advance(TICKS_PER_HOUR + 13);
  const savedAt = { tick: founded.tick, at: founded.log.length };
  founded.save('', true);
  founded.advance(T0 - founded.tick);
  const pre: (CommandLogEntry | { tick: number; settle: true })[] = [
    ...founded.log.slice(0, savedAt.at),
    { tick: savedAt.tick, settle: true },
    ...founded.log.slice(savedAt.at),
  ];
  // Sharing: the host carries on from a fresh copy of its save, as everyone will (worker 'share').
  const host = new Lockstep(founded, -1);
  const upload = host.rebirth();
  const hostLog = new DesyncLog();
  const { cityName: _n, ...founding } = OPTIONS;
  hostLog.begin({
    tick: host.sim.tick,
    seq: -1,
    sum: checksum(host.sim),
    eventHash: host.eventHash,
    rules: null,
    founded: founding,
    pre,
  });
  // The joiner loads the same save (worker 'loadShared').
  // A copy, as it reaches another machine (one save loaded twice would share its state).
  const joinSim = Sim.fromSave(structuredClone(upload));
  joinSim.testMode = true;
  const join = new Lockstep(joinSim, -1);
  const joinLog = new DesyncLog();
  joinLog.begin({
    tick: joinSim.tick,
    seq: -1,
    sum: checksum(joinSim),
    eventHash: join.eventHash,
    rules: null,
  });
  // The room's events: commands from both players, and a settle.
  const t0 = host.sim.tick;
  const events: Stamped[] = [
    { tick: t0 + 5, seq: 0, ev: { kind: 'cmd', by: 1, cmd: zone(host.sim, 'R', 60) } },
    { tick: t0 + 30, seq: 1, ev: { kind: 'cmd', by: 2, cmd: zone(host.sim, 'C', -60) } },
    {
      tick: t0 + 31,
      seq: 2,
      ev: { kind: 'cmd', by: 2, cmd: { type: 'createDistrict', name: 'Sam’s Quarter' } },
    },
    { tick: t0 + TICKS_PER_HOUR * 6, seq: 3, ev: { kind: 'settle', taker: 1, reason: 'autosave' } },
  ];
  for (const e of events) {
    host.push(e);
    join.push(e);
    hostLog.event(e);
    joinLog.event(e);
  }
  const end = t0 + hours * TICKS_PER_HOUR;
  host.allow(end);
  join.allow(end);
  const sums: [number, string, string][] = [];
  while (host.sim.tick < end) {
    // The joiner's machine goes wrong once (as `perturb` does in the e2e): one draw from a stream.
    if (join.sim.tick === perturbAt) join.sim.rng.growth.next();
    host.run(1);
    join.run(1);
    const t = host.sim.tick;
    if (t % TICKS_PER_HOUR === 0) {
      const a = host.checksums.get(t)!;
      const b = join.checksums.get(t)!;
      hostLog.sum(t, a);
      joinLog.sum(t, b);
      sums.push([t, a, b]);
      if (a !== b) break; // the room sees it at the hour and resyncs the joiner
    }
  }
  return { hostLog, joinLog, sums, upload, t0 };
}

/** A desync report as Game.reportCityDesync builds it, cleaned as the desk keeps it. */
function report(side: 'pacer' | 'joiner', log: DesyncLog, sums: [number, string, string][]): ReportDesync {
  const mine = side === 'joiner';
  const data = log.data();
  const last = sums.at(-1)!;
  const raw: Report = {
    kind: 'desync',
    env: {
      build: 'test',
      browser: 'Node',
      os: 'Linux',
      quality: 'low',
      save: 32,
      shared: 'room',
      where: 'city',
    },
    message: 'A shared city fell out of step',
    stack: '',
    at: 1,
    desync: {
      where: 'city',
      tick: last[0],
      mine: mine ? last[2] : last[1],
      theirs: mine ? last[1] : last[2],
      sums: data.sums,
      theirSums: sums.map(([t, a, b]) => [t, mine ? a : b]),
      start: data.start as unknown as ReportDesync['start'],
      events: data.events,
    },
  };
  const c = cleanReport(JSON.parse(JSON.stringify(raw)));
  if (!c.ok) throw new Error(c.why);
  expect(JSON.stringify(c.report)).not.toContain('Ada’s Town');
  expect(JSON.stringify(c.report)).not.toContain('Sam’s Quarter');
  return c.report.desync!;
}

describe('replaying a desync', () => {
  it('finds the split from the pacer’s report of a city founded on its machine, with nothing else given', () => {
    const perturbAt = T0 + TICKS_PER_HOUR * 2 + 7;
    const run = play(perturbAt, 12);
    const split = run.sums.find(([, a, b]) => a !== b)![0];
    // One draw can be absorbed for a while (a later pass draws one fewer), so the split is the first
    // hour the sums show it, at or after the next hour.
    expect(split).toBeGreaterThan(perturbAt);
    const r = replayDesync(report('pacer', run.hostLog, run.sums));
    expect(r.ok).toBe(true);
    expect(r.start).toBe('founded');
    expect(r.split).toBe(split);
    expect(r.mineFrom).toBeNull();
    expect(r.theirsFrom).toBe(split);
    expect(r.text).toContain(`split at tick ${split}`);
  });

  it('replays the joiner’s report from the save given by hand, and refuses the wrong save', () => {
    const perturbAt = T0 + TICKS_PER_HOUR * 4 + 1;
    const r2 = play(perturbAt, 12);
    const split = r2.sums.find(([, a, b]) => a !== b)![0];
    const d = report('joiner', r2.joinLog, r2.sums);
    expect(replayDesync(d).ok).toBe(false);
    expect(replayDesync(d).why).toMatch(/--save/);
    const r = replayDesync(d, r2.upload);
    expect(r.ok).toBe(true);
    expect(r.start).toBe('save');
    expect(r.split).toBe(split);
    expect(r.mineFrom).toBe(split);
    expect(r.theirsFrom).toBeNull();
    // Another city's save isn't the start.
    const other = Sim.create({ seed: 'other', preset: 'lakes' });
    other.advance(Sim.fromSave(r2.upload).tick);
    expect(replayDesync(d, other.save('')).why).toMatch(/isn’t the report’s start|stands at tick/);
  });
});
