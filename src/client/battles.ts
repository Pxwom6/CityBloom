/**
 * Battles away from the city, the page's part (M35), DESIGN.md §3.29. When a force the city sent
 * arrives, the page fights its battle in the neighbour's town: it asks the city what the battle needs
 * (`awayCity`), takes the town from its store or has the battle worker grow it (once; it's kept), has
 * the worker fight, keeps the battle for watching later, and hands the result to the city as a
 * `battleReport` command. Watching a battle in a neighbour's town opens it read-only in its own
 * page (`?battle=`), where the battle plays out again in the town's own sim.
 */
import { TOWN } from '../data/battle';
import { townKey, type TownSpec } from '../sim/ai/town';
import type { AwayCity } from '../sim/battle/away';
import type { BattleInput } from '../sim/battle/types';
import type { SaveFile } from '../sim/save';
import { IS_TEST_BUILD } from '../config';
import type { BattleJob, BattleJobReply } from './battleWorker';
import { decodeSave, encodeSave } from './saves';

/**
 * The page's own database for battles (M35): the towns they were fought in and the battles to
 * watch again. Apart from the saves' database, so its versions never trouble a tab of another build.
 */
const WAR_DB = 'citybloom-war';
const TOWN_STORE = 'towns';
const BATTLE_STORE = 'battles';

function openWarDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(WAR_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(TOWN_STORE))
        req.result.createObjectStore(TOWN_STORE, { keyPath: 'key' });
      if (!req.result.objectStoreNames.contains(BATTLE_STORE))
        req.result.createObjectStore(BATTLE_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
  store: string,
): Promise<T> {
  const db = await openWarDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

/** A battle kept for watching again. */
export interface BattleRecord {
  id: string;
  /** The city that fought it, the other side, and the tick it was fought at. */
  city: string;
  other: string;
  tick: number;
  input: BattleInput;
  /** The town it was fought in (a key into the towns store), or null for the city itself. */
  townKey: string | null;
  savedAt: string;
  /** A battle fought against a friend's city: its place in the region, until the region has it. */
  postTo?: number;
  posted?: boolean;
}

export async function loadTown(key: string): Promise<SaveFile | null> {
  const r = await tx<{ key: string; data: Uint8Array } | undefined>(
    'readonly',
    (s) => s.get(key),
    TOWN_STORE,
  ).catch(() => undefined);
  return r ? decodeSave(r.data) : null;
}

export async function keepTown(key: string, save: SaveFile): Promise<void> {
  await tx('readwrite', (s) => s.put({ key, data: encodeSave(save) }), TOWN_STORE).catch(() => undefined);
}

export async function keepBattle(r: BattleRecord): Promise<void> {
  await tx('readwrite', (s) => s.put(r), BATTLE_STORE).catch(() => undefined);
  await pruneBattles(r.city).catch(() => undefined);
}

export async function loadBattle(id: string): Promise<BattleRecord | null> {
  return (
    (await tx<BattleRecord | undefined>('readonly', (s) => s.get(id), BATTLE_STORE).catch(() => undefined)) ??
    null
  );
}

async function allBattles(): Promise<BattleRecord[]> {
  return (await tx<BattleRecord[]>('readonly', (s) => s.getAll(), BATTLE_STORE).catch(() => [])) ?? [];
}

/** Battles against friends' cities the region hasn't confirmed it keeps yet (sent again till it has). */
export async function unpostedBattles(): Promise<BattleRecord[]> {
  return (await allBattles()).filter((r) => r.postTo !== undefined && !r.posted);
}

/** The region keeps a battle now: it needn't be sent again. */
export async function battlePosted(id: string): Promise<void> {
  const r = await loadBattle(id);
  if (r && !r.posted)
    await tx('readwrite', (s) => s.put({ ...r, posted: true }), BATTLE_STORE).catch(() => undefined);
}

/** A city keeps its newest battles to watch again; older ones, and the towns kept only for them, go. */
export const KEEP_BATTLES = 24;

async function pruneBattles(city: string): Promise<void> {
  const mine = (await allBattles())
    .filter((r) => r.city === city && (r.postTo === undefined || r.posted))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt) || b.id.localeCompare(a.id));
  for (const r of mine.slice(KEEP_BATTLES)) {
    await tx('readwrite', (s) => s.delete(r.id), BATTLE_STORE);
    // Computer neighbours' towns are kept for their next battle; a replay's own copy goes with it.
    if (r.townKey && (r.townKey.startsWith('replay:') || r.townKey.startsWith('player:')))
      await tx('readwrite', (s) => s.delete(r.townKey!), TOWN_STORE);
  }
}

/** What the city's game offers this helper. */
export interface AwayHost {
  query<T>(q: { type: 'awayCity'; expedition: number }): Promise<T>;
  report(expedition: number, result: Extract<BattleJobReply, { type: 'away' }>['result']): Promise<boolean>;
  tick(): number;
  changed(): void;
  /** In a shared region (M35): the latest save it keeps of a friend's city, and passing a battle on. */
  fetchSave?(slot: number): Promise<SaveFile>;
  postBattle?(slot: number, input: BattleInput): void;
}

/** How long a battle job may take before it's given up (growing a big town on a slow phone). */
const JOB_TIMEOUT = 10 * 60_000;

export class AwayBattles {
  private worker: Worker | null = null;
  private busy = new Set<number>();
  private failed = new Map<number, number>();
  private seq = 1;
  private waiting = new Map<number, (r: BattleJobReply) => void>();
  /** Towns being grown for battles, by job: name and how far each has got. */
  private scoutingJobs = new Map<number, { name: string; population: number; target: number }>();

  constructor(private host: AwayHost) {}

  /** A town being grown for a battle (the war room shows the first). */
  get scouting(): { name: string; population: number; target: number } | null {
    return this.scoutingJobs.values().next().value ?? null;
  }

  private run(job: BattleJob): Promise<BattleJobReply> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./battleWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<BattleJobReply>) => {
        const m = ev.data;
        if (m.type === 'progress') {
          const s = this.scoutingJobs.get(m.id);
          if (s) s.population = m.population;
          this.host.changed();
          return;
        }
        const done = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        done?.(m);
      };
      // A worker that fails or dies: every job waiting on it is told, and the next starts afresh.
      this.worker.onerror = () => {
        for (const [id, done] of [...this.waiting])
          done({ type: 'error', id, message: 'The battle worker stopped' });
        this.waiting.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.waiting.delete(job.id)) return;
        resolve({ type: 'error', id: job.id, message: 'The battle took too long' });
      }, JOB_TIMEOUT);
      this.waiting.set(job.id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.worker!.postMessage(job);
    });
  }

  /** Fight every arrived expedition not fought yet (call with the war summary's expeditions). */
  check(expeditions: { id: number; state: string }[]): void {
    for (const e of expeditions)
      if (e.state === 'fighting' && !this.busy.has(e.id) && (this.failed.get(e.id) ?? 0) < 3)
        void this.fight(e.id);
  }

  async fight(expedition: number): Promise<void> {
    this.busy.add(expedition);
    const id = this.seq++;
    try {
      const city = await this.host.query<AwayCity | null>({ type: 'awayCity', expedition });
      if (!city) return;
      const n = city.neighbour;
      if (n.slot !== null) {
        // A friend's city: fought in the latest save the region keeps of it, then passed on to it.
        if (!this.host.fetchSave || !this.host.postBattle) throw new Error('Not in the region');
        const save = await this.host.fetchSave(n.slot);
        const reply = await this.run({ type: 'awayCity', id, city, save });
        if (reply.type !== 'away') throw new Error(reply.type === 'error' ? reply.message : 'No battle');
        const key = `player:${reply.input.id}`;
        await keepTown(key, reply.town ?? save);
        // Kept as not yet sent until the region says it has it (sent again at each welcome till then).
        await keepBattle({
          id: reply.input.id,
          city: city.cityName,
          other: n.name,
          tick: this.host.tick(),
          input: reply.input,
          townKey: key,
          savedAt: new Date().toISOString(),
          postTo: n.slot,
          posted: false,
        });
        if (await this.host.report(expedition, { ...reply.result, replay: reply.input.id }))
          this.host.postBattle(n.slot, reply.input);
        else this.failed.set(expedition, (this.failed.get(expedition) ?? 0) + 1);
        return;
      }
      if (!n.rival) return;
      const spec: TownSpec = {
        citySeed: city.seed,
        neighbour: n.id,
        name: n.name,
        kind: n.kind,
        personality: n.rival!.personality,
        population: n.population,
        cap: IS_TEST_BUILD ? TOWN.testCap : TOWN.cap,
      };
      const key = townKey(spec);
      const kept = await loadTown(key);
      if (!kept)
        this.scoutingJobs.set(id, { name: n.name, population: 0, target: Math.min(n.population, spec.cap!) });
      this.host.changed();
      const reply = await this.run({ type: 'away', id, spec, city, town: kept });
      if (reply.type !== 'away') throw new Error(reply.type === 'error' ? reply.message : 'No battle');
      if (reply.town) await keepTown(key, reply.town);
      await keepBattle({
        id: reply.input.id,
        city: city.cityName,
        other: n.name,
        tick: this.host.tick(),
        input: reply.input,
        townKey: key,
        savedAt: new Date().toISOString(),
      });
      if (!(await this.host.report(expedition, { ...reply.result, replay: reply.input.id })))
        this.failed.set(expedition, (this.failed.get(expedition) ?? 0) + 1);
    } catch {
      this.failed.set(expedition, (this.failed.get(expedition) ?? 0) + 1);
    } finally {
      this.scoutingJobs.delete(id);
      this.busy.delete(expedition);
      this.host.changed();
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
