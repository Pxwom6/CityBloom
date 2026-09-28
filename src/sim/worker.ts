/**
 * Worker entry: owns the Sim, runs the fixed-timestep loop at the chosen speed and posts compact
 * frames to the main thread. This is the only sim file allowed to touch worker globals and timers.
 */
import { Sim } from './sim';
import { SPEED_TICKS_PER_SECOND, type Speed } from './time';
import type { MainToWorker, WorkerPerf, WorkerToMain } from './protocol';

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
const perf: WorkerPerf = { tickMsAvg: 0, tickMsMax: 0, ticksPerSecond: 0, droppedTicks: 0 };
let perfWindowStart = performance.now();
let perfWindowTicks = 0;
let perfWindowMax = 0;

function post(msg: WorkerToMain, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function runTicks(n: number): void {
  if (!sim) return;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    sim.step();
    const dt = performance.now() - t0;
    perf.tickMsAvg = perf.tickMsAvg * 0.98 + dt * 0.02;
    if (dt > perfWindowMax) perfWindowMax = dt;
    perfWindowTicks++;
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
  post({ type: 'frame', diff: sim.collectFrame(), perf: { ...perf }, speed });
}

function loop(): void {
  const now = performance.now();
  const elapsed = Math.min(250, now - last);
  last = now;
  if (sim && speed > 0) {
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

function handle(msg: MainToWorker): void {
  switch (msg.type) {
    case 'init':
      sim = Sim.create(msg.options, msg.map ?? null);
      sim.testMode = !!msg.testMode;
      post({ type: 'ready', snapshot: sim.snapshot() });
      break;
    case 'load':
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
    case 'command': {
      if (!sim) return;
      const result = sim.dispatch(msg.cmd);
      flush();
      post({ type: 'reply', id: msg.id, result });
      break;
    }
    case 'preview':
      if (!sim) return;
      post({ type: 'reply', id: msg.id, result: sim.preview(msg.cmd) });
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
      runTicks(msg.ticks);
      flush();
      post({ type: 'reply', id: msg.id, result: sim.tick });
      break;
    case 'save':
      if (!sim) return;
      post({ type: 'reply', id: msg.id, result: sim.save(new Date().toISOString()) });
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
