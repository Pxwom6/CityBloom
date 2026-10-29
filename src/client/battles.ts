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
import { awayBattleId, type AwayCity } from '../sim/battle/away';
import type { AwayResult } from '../sim/systems/expeditions';
import type { BattleSent } from '../net/regionLink';
import type { BattleInput } from '../sim/battle/types';
import type { SaveFile } from '../sim/save';
import { IS_TEST_BUILD } from '../config';
import type { BattleJob, BattleJobReply } from './battleWorker';
import type { LiveAttack, LiveRunnerHandlers, LiveRunnerPort } from './liveBattles';
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
  /**
   * M36: the force that fought it, what the city takes once the region keeps it (not before: the
   * region may turn it away), and whether it was fought at half strength (the player away).
   */
  expedition?: number;
  result?: AwayResult & { replay?: string };
  away?: boolean;
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

/**
 * Battles against friends' cities the region hasn't confirmed it keeps yet, that the city has
 * already taken (M35's, sent again till the region has them). M36's wait for the region before
 * the city takes them: their forces' own pages send them again.
 */
export async function unpostedBattles(): Promise<BattleRecord[]> {
  return (await allBattles()).filter(
    (r) => r.postTo !== undefined && !r.posted && r.expedition === undefined,
  );
}

/** A battle the region turned away (M36): gone, with its copy of the town. */
export async function forgetBattle(id: string): Promise<void> {
  const r = await loadBattle(id);
  if (!r) return;
  await tx('readwrite', (st) => st.delete(id), BATTLE_STORE);
  if (r.townKey?.startsWith('player:')) await tx('readwrite', (st) => st.delete(r.townKey!), TOWN_STORE);
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
  /**
   * In a shared region (M35): the latest save it keeps of a friend's city, and passing a battle on
   * (M36: with the region's answer: kept, turned away, or no word).
   */
  fetchSave?(slot: number): Promise<SaveFile>;
  postBattle?(slot: number, input: BattleInput, away: boolean): Promise<BattleSent>;
  /** Why a friend's city can't be raided now (M36: the region's daily limit, its shield), or null. */
  mayStrike?(slot: number): string | null;
  /** Call a force home without a battle, saying why. */
  recall?(expedition: number, why: string): Promise<void>;
  /**
   * Pin a force while the region decides on its battle (M36), or free it again: false when the
   * force isn't fighting any more (called back, or it gave up waiting).
   */
  settle?(expedition: number, on: boolean): Promise<boolean>;
  /**
   * A force arrived at a friend's city (M39): fight it live, with the friend's player, if the region
   * and the friend's page allow it (the attacker's side of a live battle).
   */
  live?(city: AwayCity, expedition: number): Promise<LiveAttack>;
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

  /**
   * Live battles are run in a worker of their own (M39): a computer town being grown for another
   * force would keep one waiting, and a live battle can't wait.
   */
  private liveWorker: Worker | null = null;
  private streams = new Map<number, LiveRunnerHandlers>();

  /** Run a live battle's input in the live worker, fed the room's orders and frontier as they come. */
  liveRunner(input: BattleInput, on: LiveRunnerHandlers): LiveRunnerPort {
    if (!this.liveWorker) {
      const w = (this.liveWorker = new Worker(new URL('./battleWorker.ts', import.meta.url), {
        type: 'module',
      }));
      w.onmessage = (ev: MessageEvent<BattleJobReply>) => {
        const m = ev.data;
        if (m.type === 'liveFrame') this.streams.get(m.id)?.frame(m.step, m.frame);
        else if (m.type === 'liveDone') {
          const h = this.streams.get(m.id);
          this.streams.delete(m.id);
          h?.done(m.end);
        } else if (m.type === 'error') {
          const h = this.streams.get(m.id);
          this.streams.delete(m.id);
          h?.error(m.message);
        }
      };
      w.onerror = () => {
        for (const [id, h] of [...this.streams]) {
          this.streams.delete(id);
          h.error('The battle worker stopped');
        }
        w.terminate();
        if (this.liveWorker === w) this.liveWorker = null;
      };
    }
    const w = this.liveWorker;
    const id = this.seq++;
    this.streams.set(id, on);
    w.postMessage({ type: 'live', id, input } satisfies BattleJob);
    return {
      feed: (orders, allow, rush) =>
        w.postMessage({
          type: 'liveFeed',
          id,
          orders: [...orders],
          allow,
          ...(rush ? { rush: true } : {}),
        } satisfies BattleJob),
      stop: () => {
        this.streams.delete(id);
        w.postMessage({ type: 'liveStop', id } satisfies BattleJob);
      },
    };
  }

  /** Forces pinned while the region decides on their battle, and that battle's record. */
  private pinned = new Map<number, string>();

  /** Fight every arrived expedition not fought yet (call with the war summary's expeditions). */
  check(expeditions: { id: number; state: string }[]): void {
    const now = performance.now();
    // A pinned force that stopped fighting (it waited the longest the region may take): its battle
    // won't be reported now, so its record and its copy of the friend's city go.
    for (const [exp, rec] of [...this.pinned])
      if (!expeditions.some((e) => e.id === exp && e.state === 'fighting')) {
        this.pinned.delete(exp);
        // (One the region kept after all, and that was reported, stays to watch again.)
        void loadBattle(rec).then((r) => (r && !r.posted ? forgetBattle(rec) : undefined));
      }
    for (const e of expeditions)
      if (
        e.state === 'fighting' &&
        !this.busy.has(e.id) &&
        (this.failed.get(e.id) ?? 0) < 3 &&
        now >= (this.waitUntil.get(e.id) ?? 0)
      )
        void this.fight(e.id);
  }

  /** Forces whose battle the region hasn't answered: asked again after this (ms, page clock). */
  private waitUntil = new Map<number, number>();

  async fight(expedition: number): Promise<void> {
    this.busy.add(expedition);
    const id = this.seq++;
    try {
      const city = await this.host.query<AwayCity | null>({ type: 'awayCity', expedition });
      if (!city) return;
      const n = city.neighbour;
      if (n.slot !== null) {
        // A friend's city: fought in the latest save the region keeps of it, then passed on to it.
        // The city takes the result only once the region keeps the battle (M36: it may turn it
        // away, and then the force comes home without one); with no word, it asks again later with
        // the same battle (one of each force's: the region and the friend know it by its id).
        if (!this.host.fetchSave || !this.host.postBattle) throw new Error('Not in the region');
        let rec = await loadBattle(awayBattleId(city.seed, expedition));
        if (rec && (rec.expedition !== expedition || rec.postTo !== n.slot)) rec = null;
        if (!rec) {
          const why = this.host.mayStrike?.(n.slot);
          if (why) {
            await this.host.recall?.(expedition, why);
            return;
          }
          // M39: a friend whose player is here and whose page can fight live fights it live; any
          // other answer, and it goes the old way below.
          const live = await this.host.live?.(city, expedition);
          if (live) {
            if (live.kind === 'done') {
              if (!live.ok) this.failed.set(expedition, (this.failed.get(expedition) ?? 0) + 1);
              return;
            }
            if (live.kind === 'wait') {
              this.waitUntil.set(expedition, performance.now() + live.ms);
              return;
            }
            if (live.kind === 'refused') {
              if (live.later !== undefined) this.waitUntil.set(expedition, performance.now() + live.later);
              else await this.host.recall?.(expedition, live.reason);
              return;
            }
          }
          const save = await this.host.fetchSave(n.slot);
          const reply = await this.run({ type: 'awayCity', id, city, save });
          if (reply.type !== 'away') throw new Error(reply.type === 'error' ? reply.message : 'No battle');
          const key = `player:${reply.input.id}`;
          await keepTown(key, reply.town ?? save);
          rec = {
            id: reply.input.id,
            city: city.cityName,
            other: n.name,
            tick: this.host.tick(),
            input: reply.input,
            townKey: key,
            savedAt: new Date().toISOString(),
            postTo: n.slot,
            posted: false,
            expedition,
            result: { ...reply.result, replay: reply.input.id },
            ...(n.absent ? { away: true } : {}),
          };
          await keepBattle(rec);
        }
        // Kept after a wait ran out (its word came late): nothing pinned any more.
        if (rec.posted) this.pinned.delete(expedition);
        if (!rec.posted) {
          // Pinned while the region decides: a force called back (or given up) in the meantime has
          // no battle to put to it, and once put, it can't be called back until the region answers.
          if (this.host.settle && !(await this.host.settle(expedition, true))) {
            // Called back or given up: its battle goes. Still fighting (the city can't act now, say
            // bankrupt): kept, and tried again in a while.
            if (await this.host.query<AwayCity | null>({ type: 'awayCity', expedition })) {
              this.waitUntil.set(expedition, performance.now() + 60_000);
              return;
            }
            await forgetBattle(rec.id);
            return;
          }
          this.pinned.set(expedition, rec.id);
          const answer = await this.host.postBattle(n.slot, rec.input, !!rec.away);
          if (!answer) {
            this.waitUntil.set(expedition, performance.now() + 20_000);
            return;
          }
          if (!answer.kept) {
            // Not now (the region's pace): asked again later, the force still pinned.
            if (answer.later) {
              this.waitUntil.set(expedition, performance.now() + answer.later);
              return;
            }
            this.pinned.delete(expedition);
            await forgetBattle(rec.id);
            await this.host.settle?.(expedition, false);
            // Its player left since: fought again at half strength on the next look.
            if (!answer.again) await this.host.recall?.(expedition, answer.reason);
            return;
          }
          this.pinned.delete(expedition);
          await battlePosted(rec.id);
        }
        if (!rec.result || !(await this.host.report(expedition, rec.result)))
          this.failed.set(expedition, (this.failed.get(expedition) ?? 0) + 1);
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
    this.liveWorker?.terminate();
    this.liveWorker = null;
    this.streams.clear();
  }
}
