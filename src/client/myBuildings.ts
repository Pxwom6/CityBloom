/**
 * My Buildings (M46): the player's own models, kept in IndexedDB `citybloom-buildings` with their
 * bytes, the baked model the renderer draws, a name, what each was made for and its footprint, and
 * whose it is: the player's own (imported here) or a friend's (it came with a city or through a
 * room). Every model is checked in a worker before it is kept, wherever it came from.
 */
import type { BakedModel } from '../models/baked';
import { CUSTOM, type CustomProblem, type CustomTarget } from '../models/customCheck';
import { CIVIC, LOOK_HASH } from '../data/civic';
import { checkModelFile, modelHash } from './modelCheck';
import { cleanCityName } from '../../relay/protocol';

export interface StoredModel {
  hash: string;
  name: string;
  target: CustomTarget;
  /** Its footprint (m): what else it fits (a landmark of that size, a building with that site). */
  size: { w: number; d: number };
  bytes: Uint8Array;
  baked: BakedModel;
  /** Imported by this player (shown in My Buildings); otherwise a friend's. */
  mine: boolean;
  added: number;
}

/** A model as a save or a share file carries it. */
export interface SavedModel {
  hash: string;
  name: string;
  target: CustomTarget;
  glb: string;
}

export type AddResult =
  | { ok: true; model: StoredModel; existed: boolean }
  | { ok: false; problems: CustomProblem[]; picture: Blob | null };

/** A model's name, cleaned (nothing unseen, no runs of spaces), at most `CUSTOM.nameChars`. */
export function cleanModelName(raw: unknown): string {
  // As a city's name is cleaned (the same 40 characters at most), never empty.
  const base = typeof raw === 'string' ? raw.replace(/\.(glb|citybloom-building)$/i, '') : '';
  if (!/\p{L}|\p{N}/u.test(base)) return 'My building';
  return cleanCityName(base).slice(0, CUSTOM.nameChars);
}

/** A target as it travels (a share file, a save): checked as any target is, or null. */
export function cleanTarget(raw: unknown): CustomTarget | null {
  const t = raw as { kind?: unknown; def?: unknown; size?: unknown } | null;
  if (t?.kind === 'landmark' && [1, 2, 3, 4].includes(t.size as number))
    return { kind: 'landmark', size: t.size as 1 | 2 | 3 | 4 };
  if (t?.kind === 'look' && typeof t.def === 'string' && CIVIC.has(t.def))
    return { kind: 'look', def: t.def };
  return null;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The small share file: the model and its name (`.citybloom-building`). */
export function buildingFile(m: Pick<StoredModel, 'name' | 'target' | 'bytes'>): Blob {
  const body = { format: 'citybloom-building', v: 1, name: m.name, target: m.target, glb: toBase64(m.bytes) };
  return new Blob([JSON.stringify(body)], { type: 'application/json' });
}

/** A share file back: the model's bytes, name and target, or why not. */
export function readBuildingFile(
  text: string,
): { bytes: Uint8Array; name: string; target: CustomTarget } | { why: string } {
  let r: { format?: unknown; v?: unknown; name?: unknown; target?: unknown; glb?: unknown };
  try {
    r = JSON.parse(text) as typeof r;
  } catch {
    return { why: 'That isn’t a building file' };
  }
  if (r.format !== 'citybloom-building' || typeof r.glb !== 'string')
    return { why: 'That isn’t a building file' };
  if (r.glb.length > Math.ceil((CUSTOM.maxBytes * 4) / 3) + 8) return { why: 'The model in it is over 1 MB' };
  const target = cleanTarget(r.target);
  if (!target) return { why: 'It doesn’t say what the building is for' };
  try {
    return { bytes: fromBase64(r.glb), name: cleanModelName(r.name), target };
  } catch {
    return { why: 'The model in it can’t be read' };
  }
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

export class MyBuildings {
  private models = new Map<string, StoredModel>();
  private opening: Promise<IDBDatabase> | null = null;
  /** Called when a model is added, renamed or removed (the renderer draws again). */
  onChange: (() => void) | null = null;
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.loadAll().catch(() => undefined);
  }

  private db(): Promise<IDBDatabase> {
    if (!this.opening)
      this.opening = new Promise((resolve, reject) => {
        const r = indexedDB.open('citybloom-buildings', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('models', { keyPath: 'hash' });
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error ?? new Error('My Buildings would not open'));
      });
    return this.opening;
  }

  private async loadAll(): Promise<void> {
    const db = await this.db();
    const all = await req(
      db.transaction('models').objectStore('models').getAll() as IDBRequest<StoredModel[]>,
    );
    for (const m of all) this.models.set(m.hash, m);
    this.onChange?.();
  }

  private async put(m: StoredModel): Promise<void> {
    this.models.set(m.hash, m);
    const db = await this.db();
    await req(db.transaction('models', 'readwrite').objectStore('models').put(m));
    this.onChange?.();
  }

  /** The player's own models, newest first. */
  list(): StoredModel[] {
    return [...this.models.values()].filter((m) => m.mine).sort((a, b) => b.added - a.added);
  }

  /** Every model on this device: the player's own and friends'. */
  all(): StoredModel[] {
    return [...this.models.values()];
  }

  get(hash: string): StoredModel | undefined {
    return this.models.get(hash);
  }

  /**
   * Check a model and keep it. One already kept comes back as it is (a friend's becomes the player's
   * own when they import it themselves).
   */
  async add(bytes: Uint8Array, name: string, target: CustomTarget, mine = true): Promise<AddResult> {
    const hash = await modelHash(bytes);
    const had = this.models.get(hash);
    if (had && (had.mine || !mine)) return { ok: true, model: had, existed: true };
    const { result, picture } = await checkModelFile(bytes, target);
    if (!result.ok || !result.baked || !result.box) return { ok: false, problems: result.problems, picture };
    const b = result.box;
    const model: StoredModel = {
      hash,
      name: cleanModelName(name),
      target,
      size: {
        w: Math.round((b.max[0] - b.min[0]) * 100) / 100,
        d: Math.round((b.max[2] - b.min[2]) * 100) / 100,
      },
      bytes: bytes.slice(),
      baked: result.baked,
      mine: mine || !!had?.mine,
      added: Date.now(),
    };
    await this.put(model);
    return { ok: true, model, existed: false };
  }

  async rename(hash: string, name: string): Promise<void> {
    const m = this.models.get(hash);
    if (m) await this.put({ ...m, name: cleanModelName(name) });
  }

  /**
   * Take a model off the player's list. `keep`: the open city's buildings wear it, so it stays on this
   * device as a friend's would (off the list, still drawn, still saved with the city).
   */
  async remove(hash: string, keep = false): Promise<void> {
    const m = this.models.get(hash);
    if (!m) return;
    if (keep) {
      await this.put({ ...m, mine: false });
      return;
    }
    this.models.delete(hash);
    const db = await this.db();
    await req(db.transaction('models', 'readwrite').objectStore('models').delete(hash));
    this.onChange?.();
  }

  /** The models a city's buildings wear, as its save carries them. */
  forSave(hashes: Iterable<string>): SavedModel[] {
    const out: SavedModel[] = [];
    for (const h of new Set(hashes)) {
      const m = this.models.get(h);
      if (m) out.push({ hash: m.hash, name: m.name, target: m.target, glb: toBase64(m.bytes) });
    }
    return out;
  }

  /**
   * Models that came with a city or through a room: each checked as any is, kept as a friend's unless
   * it's already here. Resolves with how many were taken in.
   */
  async adopt(list: unknown): Promise<number> {
    if (!Array.isArray(list)) return 0;
    let n = 0;
    for (const raw of list.slice(0, 64) as Partial<SavedModel>[]) {
      if (typeof raw?.hash !== 'string' || !LOOK_HASH.test(raw.hash) || this.models.has(raw.hash)) continue;
      const target = cleanTarget(raw.target);
      if (!target || typeof raw.glb !== 'string' || raw.glb.length > (CUSTOM.maxBytes * 4) / 3 + 8) continue;
      let bytes: Uint8Array;
      try {
        bytes = fromBase64(raw.glb);
      } catch {
        continue;
      }
      // The bytes must be the model the hash names.
      if ((await modelHash(bytes)) !== raw.hash) continue;
      const r = await this.add(bytes, cleanModelName(raw.name), target, false);
      if (r.ok) n++;
    }
    return n;
  }
}
