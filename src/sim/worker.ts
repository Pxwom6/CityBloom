/**
 * Worker entry: owns the Sim, runs the fixed-timestep loop at the chosen speed and posts compact
 * frames to the main thread. This is the only sim file allowed to touch worker globals and timers.
 *
 * In a shared city (M29) the room keeps time instead: the worker applies the room's stamped events
 * at their ticks, runs as far as the room allows, as fast as its time budget lets it, and never
 * drops a tick; it reports how far behind it is, an hourly checksum, and snapshots it's asked for.
 */
import { Sim } from './sim';
import { isMonthStart, SPEED_TICKS_PER_SECOND, type Speed } from './time';
import { partHashes } from './sync';
import { Lockstep, type Applied } from './lockstep';
import type { MainToWorker, SharedSnapshot, WorkerPerf, WorkerToMain } from './protocol';

interface WorkerScope {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<MainToWorker>) => void) | null;
}
const ctx = self as unknown as WorkerScope;

let sim: Sim | null = null;
let speed: Speed = 0;
let due = 0;
let last = performance.now();
const MAX_TICKS_PER_LOOP = 60;
/** Shared city: milliseconds of ticks per loop when catching up (the loop runs every 50 ms). */
const SHARED_BUDGET_MS = 35;
const perf: WorkerPerf = { tickMsAvg: 0, tickMsMax: 0, ticksPerSecond: 0, droppedTicks: 0 };
let perfWindowStart = performance.now();
let perfWindowTicks = 0;
let perfWindowMax = 0;

/** The room's runner while the city is shared, and who this machine is. */
let lockstep: Lockstep | null = null;
let player = 0;
let applied: Applied[] = [];
let lastChecksum = 0;

function post(msg: WorkerToMain, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function timeTick(fn: () => void): void {
  const t0 = performance.now();
  fn();
  const dt = performance.now() - t0;
  perf.tickMsAvg = perf.tickMsAvg * 0.98 + dt * 0.02;
  if (dt > perfWindowMax) perfWindowMax = dt;
  perfWindowTicks++;
}

function runTicks(n: number): void {
  if (!sim) return;
  for (let i = 0; i < n; i++) timeTick(() => sim!.step());
}

/** Shared city: run towards the allowed tick within the time budget. */
/**
 * Shared city: run at the room's speed up to the tick it allows, so the city moves smoothly between
 * the pacer's clock messages; far behind (joining, a slow spell, a background tab), as fast as the
 * time budget lets it until caught up.
 */
function runShared(elapsed: number): void {
  const ls = lockstep!;
  const t0 = performance.now();
  if (ls.behind === 0 && ls.pending) ls.run(0);
  const tps = SPEED_TICKS_PER_SECOND[speed];
  due += (elapsed / 1000) * tps;
  // Paused (the room stopped where it is) or far behind: straight there.
  const catchUp = tps === 0 || ls.behind > Math.max(48, tps * 2);
  let n = catchUp ? Infinity : Math.floor(due);
  while (n > 0 && ls.behind > 0 && performance.now() - t0 < SHARED_BUDGET_MS) {
    n--;
    if (!catchUp) due--;
    timeTick(() => ls.run(1));
    // The full check at each month's end (about 40 ms at 100k residents, outside the tick).
    if (isMonthStart(ls.sim.tick))
      post({ type: 'monthHashes', tick: ls.sim.tick, parts: partHashes(ls.sim) });
  }
  // Time not run because the room hasn't allowed it yet isn't banked (or the city would race after).
  if (ls.behind === 0) due = Math.min(due, 1);
  for (const [tick, sum] of ls.checksums)
    if (tick > lastChecksum) {
      post({ type: 'checksum', tick, sum });
      lastChecksum = tick;
    }
}

function flush(): void {
  if (!sim) return;
  const now = performance.now();
  if (now - perfWindowStart >= 1000) {
    perf.ticksPerSecond = (perfWindowTicks * 1000) / (now - perfWindowStart);
    perf.tickMsMax = perfWindowMax;
    perfWindowStart = now;
    perfWindowTicks = 0;
    perfWindowMax = 0;
  }
  if (applied.length) {
    post({ type: 'applied', list: applied });
    applied = [];
  }
  if (lockstep) perf.behind = lockstep.behind;
  else delete perf.behind;
  post({ type: 'frame', diff: sim.collectFrame(), perf: { ...perf }, speed });
}

function loop(): void {
  const now = performance.now();
  const elapsed = Math.min(250, now - last);
  last = now;
  if (lockstep) runShared(elapsed);
  else if (sim && speed > 0) {
    due += (elapsed / 1000) * SPEED_TICKS_PER_SECOND[speed];
    let n = Math.floor(due);
    if (n > MAX_TICKS_PER_LOOP) {
      perf.droppedTicks += n - MAX_TICKS_PER_LOOP;
      n = MAX_TICKS_PER_LOOP;
      due = 0;
    } else {
      due -= n;
    }
    if (n > 0) runTicks(n);
  }
  if (sim) flush();
}

setInterval(loop, 50);

function share(s: Sim, lastSeq: number, eventHash?: number): void {
  lockstep = new Lockstep(s, lastSeq);
  if (eventHash !== undefined) lockstep.eventHash = eventHash;
  s.viewer = player;
  lastChecksum = s.tick;
  // At a settle every machine carries on from a fresh copy of the saved city (Lockstep.rebirth):
  // the page's mirror is brought up to date from the old one.
  lockstep.onRebirth = (old) => {
    sim = lockstep!.sim;
    sim.takeOverFrom(old);
  };
  lockstep.onApplied = (a) => {
    if (a.ev.kind === 'cmd') applied.push(a);
    else if (a.ev.kind === 'settle' && a.ev.taker === player && a.save) {
      const snapshot: SharedSnapshot = {
        save: a.save,
        rules: lockstep!.sim.rules,
        history: lockstep!.sim.historyState(),
        seq: a.seq,
        eventHash: lockstep!.eventHash,
      };
      post({ type: 'snapshot', tick: a.tick, reason: a.ev.reason, snapshot });
    }
  };
}

function handle(msg: MainToWorker): void {
  switch (msg.type) {
    case 'init':
      lockstep = null;
      sim = Sim.create(msg.options, msg.map ?? null);
      sim.testMode = !!msg.testMode;
      post({ type: 'ready', snapshot: sim.snapshot() });
      break;
    case 'load':
      lockstep = null;
      // A save that can't be read leaves the worker empty; the page falls back to a fresh map.
      try {
        sim = Sim.fromSave(msg.save);
      } catch (err) {
        sim = null;
        post({ type: 'loadFailed', message: err instanceof Error ? err.message : String(err) });
        return;
      }
      sim.testMode = !!msg.testMode;
      post({ type: 'ready', snapshot: sim.snapshot() });
      break;
    case 'loadShared': {
      const old = sim;
      try {
        sim = Sim.fromSave(msg.snapshot.save);
      } catch (err) {
        sim = null;
        lockstep = null;
        post({ type: 'loadFailed', message: err instanceof Error ? err.message : String(err) });
        return;
      }
      sim.testMode = !!msg.testMode;
      sim.setHistoryState(msg.snapshot.history);
      sim.rules = msg.snapshot.rules ?? null;
      // A resync keeps the page's city and brings it up to date in the next frame.
      if (msg.resync && old) sim.takeOverFrom(old);
      player = msg.player;
      share(sim, msg.snapshot.seq, msg.snapshot.eventHash);
      applied = [];
      post({ type: 'ready', snapshot: sim.snapshot() });
      break;
    }
    case 'share':
      if (!sim) return;
      player = msg.player;
      // Single player's undo history belongs to the city before it was shared.
      sim.setHistoryState([]);
      share(sim, msg.lastSeq);
      {
        // The city the room is made from: this machine carries on from it as the others will.
        const save = lockstep!.rebirth();
        post({
          type: 'snapshot',
          tick: sim.tick,
          reason: 'upload',
          snapshot: { save, history: [], seq: msg.lastSeq, eventHash: lockstep!.eventHash },
        });
      }
      break;
    case 'perturb':
      // One draw from a random stream: nothing visible changes, but the next checksum differs.
      if (sim?.testMode) sim.rng.growth.next();
      break;
    case 'unshare':
      if (sim) sim.shared = false;
      lockstep = null;
      delete perf.behind;
      break;
    case 'stamped': {
      if (!lockstep) return;
      for (const e of msg.events) {
        if (lockstep.push(e) === 'late') post({ type: 'late', tick: e.tick, seq: e.seq });
      }
      lockstep.allow(msg.allow);
      break;
    }
    case 'command': {
      if (!sim) return;
      // In a shared city every command goes through the room, so all machines apply it at once.
      if (lockstep) {
        post({
          type: 'reply',
          id: msg.id,
          result: { ok: false, reason: 'In a shared city, commands go through the room' },
        });
        return;
      }
      const result = sim.dispatch(msg.cmd);
      flush();
      post({ type: 'reply', id: msg.id, result });
      break;
    }
    case 'preview':
      if (!sim) return;
      post({ type: 'reply', id: msg.id, result: sim.preview(msg.cmd, player) });
      break;
    case 'query':
      if (!sim) return;
      post({ type: 'reply', id: msg.id, result: sim.query(msg.q) });
      break;
    case 'setSpeed':
      speed = msg.speed;
      due = 0;
      break;
    case 'advance':
      if (!sim) return;
      // A shared city's time is the room's: advancing on one machine would split it.
      if (!lockstep) runTicks(msg.ticks);
      flush();
      post({ type: 'reply', id: msg.id, result: sim.tick });
      break;
    case 'save':
      if (!sim) return;
      post({ type: 'reply', id: msg.id, result: sim.save(new Date().toISOString(), !lockstep) });
      break;
  }
}

ctx.onmessage = (e: MessageEvent<MainToWorker>) => {
  try {
    handle(e.data);
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
    });
  }
};
