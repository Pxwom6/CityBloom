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
import { BATTLE_STORE, TOWN_STORE, decodeSave, encodeSave, tx } from './saves';

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
}

export async function loadBattle(id: string): Promise<BattleRecord | null> {
  return (
    (await tx<BattleRecord | undefined>('readonly', (s) => s.get(id), BATTLE_STORE).catch(() => undefined)) ??
    null
  );
}

/** What the city's game offers this helper. */
export interface AwayHost {
  query<T>(q: { type: 'awayCity'; expedition: number }): Promise<T>;
  report(expedition: number, result: Extract<BattleJobReply, { type: 'away' }>['result']): Promise<boolean>;
  tick(): number;
  changed(): void;
}

export class AwayBattles {
  private worker: Worker | null = null;
  private busy = new Set<number>();
  private failed = new Map<number, number>();
  private seq = 1;
  private waiting = new Map<number, (r: BattleJobReply) => void>();
  /** A town being grown for a battle: its name and how far it's got (the war room shows it). */
  scouting: { name: string; population: number; target: number } | null = null;

  constructor(private host: AwayHost) {}

  private run(job: BattleJob): Promise<BattleJobReply> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./battleWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<BattleJobReply>) => {
        const m = ev.data;
        if (m.type === 'progress') {
          if (this.scouting) this.scouting.population = m.population;
          this.host.changed();
          return;
        }
        const done = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        done?.(m);
      };
    }
    return new Promise((resolve) => {
      this.waiting.set(job.id, resolve);
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
    try {
      const city = await this.host.query<AwayCity | null>({ type: 'awayCity', expedition });
      if (!city?.neighbour.rival) return;
      const n = city.neighbour;
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
      if (!kept) this.scouting = { name: n.name, population: 0, target: Math.min(n.population, spec.cap!) };
      this.host.changed();
      const reply = await this.run({ type: 'away', id: this.seq++, spec, city, town: kept });
      this.scouting = null;
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
      if (!(await this.host.report(expedition, reply.result)))
        this.failed.set(expedition, (this.failed.get(expedition) ?? 0) + 1);
    } catch {
      this.scouting = null;
      this.failed.set(expedition, (this.failed.get(expedition) ?? 0) + 1);
    } finally {
      this.busy.delete(expedition);
      this.host.changed();
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
