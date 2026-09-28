import type { Command, CommandResult } from '../sim/commands';
import type { FrameDiff, MainToWorker, Query, Snapshot, WorkerPerf, WorkerToMain } from '../sim/protocol';
import type { SaveFile } from '../sim/save';
import type { GameOptions } from '../sim/state';
import type { MapData } from '../sim/terrain/customMap';
import type { Speed } from '../sim/time';

type FrameListener = (diff: FrameDiff, perf: WorkerPerf, speed: Speed) => void;

/** Typed wrapper around the sim worker: request/reply by id, frames to listeners. */
export class SimClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, (v: unknown) => void>();
  private frameListeners: FrameListener[] = [];
  private readyResolve: ((s: Snapshot) => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;
  onError: (message: string) => void = (m) => console.error(`[sim] ${m}`);

  constructor() {
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerToMain>) => this.receive(e.data);
    this.worker.onerror = (e) => this.onError(e.message);
  }

  private receive(msg: WorkerToMain): void {
    switch (msg.type) {
      case 'ready':
        this.readyResolve?.(msg.snapshot);
        this.readyResolve = this.readyReject = null;
        break;
      case 'loadFailed':
        this.readyReject?.(new Error(msg.message));
        this.readyResolve = this.readyReject = null;
        break;
      case 'frame':
        for (const l of this.frameListeners) l(msg.diff, msg.perf, msg.speed);
        break;
      case 'reply': {
        const r = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        r?.(msg.result);
        break;
      }
      case 'error':
        this.onError(msg.message);
        break;
    }
  }

  private post(msg: MainToWorker): void {
    this.worker.postMessage(msg);
  }

  private request<T>(make: (id: number) => MainToWorker): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve) => {
      this.pending.set(id, resolve as (v: unknown) => void);
      this.post(make(id));
    });
  }

  init(options: Partial<GameOptions>, testMode = false, map: MapData | null = null): Promise<Snapshot> {
    return new Promise((resolve) => {
      this.readyResolve = resolve;
      this.post({ type: 'init', options, testMode, map });
    });
  }

  /** Open a saved city; rejects if the save can't be read (the worker is then empty). */
  load(save: SaveFile, testMode = false): Promise<Snapshot> {
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.post({ type: 'load', save, testMode });
    });
  }

  onFrame(l: FrameListener): () => void {
    this.frameListeners.push(l);
    return () => {
      this.frameListeners = this.frameListeners.filter((x) => x !== l);
    };
  }

  command(cmd: Command): Promise<CommandResult> {
    return this.request((id) => ({ type: 'command', id, cmd }));
  }

  preview(cmd: Command): Promise<CommandResult> {
    return this.request((id) => ({ type: 'preview', id, cmd }));
  }

  query<T>(q: Query): Promise<T> {
    return this.request((id) => ({ type: 'query', id, q }));
  }

  setSpeed(speed: Speed): void {
    this.post({ type: 'setSpeed', speed });
  }

  advance(ticks: number): Promise<number> {
    return this.request((id) => ({ type: 'advance', id, ticks }));
  }

  save(): Promise<SaveFile> {
    return this.request((id) => ({ type: 'save', id }));
  }

  terminate(): void {
    this.worker.terminate();
  }
}
