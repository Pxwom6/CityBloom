/**
 * Replaying a desync report in Node (M41): the city at the report's start (founded again from its
 * options and the commands before sharing, or a save given by hand and checked against the start's
 * checksum), then the room's events through the same `Lockstep` the worker runs, hour by hour. Each
 * hour's checksum is set beside the two sides' as the report carries them: where the sides first
 * disagree is the split, and whichever side Node agrees with past it ran the city right.
 */
import { Lockstep, type Stamped } from '../../src/sim/lockstep';
import { Sim } from '../../src/sim/sim';
import { checksum } from '../../src/sim/sync';
import { TICKS_PER_HOUR } from '../../src/sim/time';
import type { CommandLogEntry } from '../../src/sim/commands';
import type { SaveFile } from '../../src/sim/save';
import type { SharedRules } from '../../src/sim/rules';
import type { GameOptions } from '../../src/sim/state';
import type { Report, ReportDesync } from '../../relay/reports';

export interface ReplayHour {
  tick: number;
  node: string;
  mine?: string;
  theirs?: string;
}

export interface ReplayResult {
  ok: boolean;
  /** Why it couldn't be replayed. */
  why?: string;
  /** Was the start checked against the report (a save given by hand, or a founding made again)? */
  start: 'founded' | 'save' | 'unchecked';
  hours: ReplayHour[];
  /** The first hour the two sides' sums disagree, as reported. */
  split: number | null;
  /** The first hour Node disagrees with this page's sums, and with the other side's. */
  mineFrom: number | null;
  theirsFrom: number | null;
  /** What it found, in a few lines. */
  text: string;
}

/** A report, or the owner area's download of one (an item wraps it as `report`). */
export function desyncOf(json: unknown): ReportDesync | null {
  const o = json as { report?: Report; desync?: ReportDesync } | null;
  return o?.desync ?? o?.report?.desync ?? null;
}

const norm = (s: string | undefined) => (s ?? '').replace(/[^0-9a-f:]/gi, '').slice(0, 40);
const hasCheat = (list: readonly unknown[]) => JSON.stringify(list).includes('"type":"cheat"');

const fail = (why: string): ReplayResult => ({
  ok: false,
  why,
  start: 'unchecked',
  hours: [],
  split: null,
  mineFrom: null,
  theirsFrom: null,
  text: why,
});

function hourOf(tick: number): string {
  const h = Math.floor(tick / TICKS_PER_HOUR);
  return `tick ${tick} (day ${Math.floor(h / 24) + 1}, ${String(h % 24).padStart(2, '0')}:00)`;
}

/**
 * Replay a desync. `save` is the city at the report's start, for a start that wasn't founded on the
 * reporting machine (a save is never sent with a report).
 */
export function replayDesync(d: ReportDesync, save: SaveFile | null = null): ReplayResult {
  if (d.where !== 'city')
    return fail('Only a shared city’s desync can be replayed (a battle’s report carries its hashes only).');
  const s = d.start;
  if (!s) return fail('The report has no start to replay from.');
  if (d.cut || !d.events) return fail('The report’s events were too many to send, so it can’t be replayed.');
  const events = d.events as Stamped[];
  const cheats = hasCheat(events) || hasCheat(s.pre ?? []);
  let sim: Sim;
  let start: ReplayResult['start'];
  if (s.founded && s.pre) {
    const options = { ...(s.founded as Partial<GameOptions>), cityName: 'Replay' };
    const founded = Sim.create(options);
    founded.testMode = cheats;
    // The single-player commands before sharing, each at its tick (as Sim.replay, with test mode for cheats).
    const pre = s.pre as (CommandLogEntry | { tick: number; settle: true })[];
    let i = 0;
    for (;;) {
      while (i < pre.length && pre[i]!.tick === founded.tick) {
        const e = pre[i++]!;
        // A save in single player settled the city (finished the commute round under way).
        if ('settle' in e) founded.save('', true);
        else founded.dispatch(e.cmd, e.by ?? 0);
      }
      if (founded.tick >= s.tick) break;
      founded.step();
    }
    // Sharing saves the city and carries on from a fresh copy (Lockstep.rebirth).
    sim = Sim.fromSave(founded.save(''));
    start = 'founded';
  } else if (save) {
    sim = Sim.fromSave(save);
    start = 'save';
  } else
    return fail(
      `This start (tick ${s.tick}) is a snapshot the reporting machine loaded, and saves are never sent: give the city as it stood then with --save.`,
    );
  if (sim.tick !== s.tick)
    return fail(`The start is at tick ${s.tick}, but the city given stands at tick ${sim.tick}.`);
  const startSum = checksum(sim);
  if (s.sum && norm(startSum) !== norm(s.sum))
    return fail(
      `The city given isn’t the report’s start: its checksum is ${startSum}, the report’s ${s.sum}.`,
    );
  sim.testMode = cheats;
  sim.rules = (s.rules as SharedRules | undefined) ?? null;
  const ls = new Lockstep(sim, s.seq);
  if (s.eventHash !== undefined) ls.eventHash = s.eventHash;
  for (const e of events) ls.push(e);
  const mine = new Map((d.sums ?? []).map(([t, v]) => [t, norm(v)]));
  const theirs = new Map((d.theirSums ?? []).map(([t, v]) => [t, norm(v)]));
  const last = Math.max(d.tick, ...mine.keys(), ...theirs.keys());
  ls.allow(last + 1);
  const hours: ReplayHour[] = [];
  while (ls.sim.tick < last) {
    const before = ls.sim.tick;
    ls.run(TICKS_PER_HOUR - (ls.sim.tick % TICKS_PER_HOUR) || TICKS_PER_HOUR);
    if (ls.sim.tick === before) break;
    const t = ls.sim.tick;
    const node = ls.checksums.get(t);
    if (node === undefined) continue;
    if (!mine.has(t) && !theirs.has(t)) continue;
    hours.push({
      tick: t,
      node: norm(node),
      ...(mine.has(t) ? { mine: mine.get(t)! } : {}),
      ...(theirs.has(t) ? { theirs: theirs.get(t)! } : {}),
    });
  }
  const split =
    hours.find((h) => h.mine !== undefined && h.theirs !== undefined && h.mine !== h.theirs)?.tick ?? null;
  const mineFrom = hours.find((h) => h.mine !== undefined && h.mine !== h.node)?.tick ?? null;
  const theirsFrom = hours.find((h) => h.theirs !== undefined && h.theirs !== h.node)?.tick ?? null;
  const lines = [
    `Replayed from ${hourOf(s.tick)} (${start === 'founded' ? 'founded again from its options' : 'the save given'}), ${events.length} events, to ${hourOf(ls.sim.tick)}.`,
    split !== null
      ? `The hashes split at ${hourOf(split)}.`
      : 'The two sides’ sums never disagree in what the report carries.',
    mineFrom !== null
      ? `This page (the reporter) left the replay at ${hourOf(mineFrom)}.`
      : 'This page agrees with the replay all the way.',
    theirsFrom !== null
      ? `The other side left the replay at ${hourOf(theirsFrom)}.`
      : 'The other side agrees with the replay all the way.',
  ];
  return { ok: true, start, hours, split, mineFrom, theirsFrom, text: lines.join('\n') };
}
