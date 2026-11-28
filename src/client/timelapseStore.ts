/**
 * Where timelapse frames are kept (M45): IndexedDB `citybloom-timelapse`, a database of its own (the
 * saves' and the battles' are untouched). Frames by city, view and tick, each with the city's
 * population then; a record per city (its name, when its recording started and whether the city is
 * older than timelapses, the bytes and frames it keeps, when it was last recorded). Every city's
 * frames together stay under `TIMELAPSE.totalBytes`: past it, the city recorded least recently goes.
 */
import { TIMELAPSE, type TimelapseView } from './timelapseThin';

const DB_NAME = 'citybloom-timelapse';

export interface FrameRecord {
  city: string;
  view: TimelapseView;
  tick: number;
  population: number;
  bytes: number;
  blob: Blob;
}

export interface CityRecord {
  id: string;
  name: string;
  /** The tick its recording started at, and whether the city is older than its recording. */
  startTick: number;
  late: boolean;
  /** When it was last recorded (ms since 1970), for choosing which city goes when space runs out. */
  lastAt: number;
  bytes: number;
  frames: Record<TimelapseView, number>;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

const range = (city: string, view: TimelapseView) =>
  IDBKeyRange.bound([city, view, -Infinity], [city, view, Infinity]);

export class TimelapseStore {
  private opening: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.opening)
      this.opening = new Promise((resolve, reject) => {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          db.createObjectStore('frames', { keyPath: ['city', 'view', 'tick'] });
          db.createObjectStore('cities', { keyPath: 'id' });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error ?? new Error('The timelapse store would not open'));
      });
    return this.opening;
  }

  async city(id: string): Promise<CityRecord | null> {
    const db = await this.db();
    return (await req(db.transaction('cities').objectStore('cities').get(id))) ?? null;
  }

  async putCity(rec: CityRecord): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('cities', 'readwrite');
    tx.objectStore('cities').put(rec);
    await done(tx);
  }

  async cities(): Promise<CityRecord[]> {
    const db = await this.db();
    return req(db.transaction('cities').objectStore('cities').getAll());
  }

  /** A view's frames, oldest first (their pictures are read only when used). */
  async frames(city: string, view: TimelapseView): Promise<FrameRecord[]> {
    const db = await this.db();
    return req(db.transaction('frames').objectStore('frames').getAll(range(city, view)));
  }

  /** Keep a frame and update its city's record. */
  async putFrame(f: FrameRecord, rec: CityRecord): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['frames', 'cities'], 'readwrite');
    tx.objectStore('frames').put(f);
    rec.bytes += f.bytes;
    rec.frames[f.view]++;
    rec.lastAt = Date.now();
    tx.objectStore('cities').put(rec);
    await done(tx);
  }

  /** Let frames go (the thinning's), and update the city's record. */
  async dropFrames(
    city: string,
    view: TimelapseView,
    frames: { tick: number; bytes: number }[],
    rec: CityRecord,
  ) {
    if (!frames.length) return;
    const db = await this.db();
    const tx = db.transaction(['frames', 'cities'], 'readwrite');
    const store = tx.objectStore('frames');
    for (const f of frames) {
      store.delete([city, view, f.tick]);
      rec.bytes -= f.bytes;
      rec.frames[view]--;
    }
    tx.objectStore('cities').put(rec);
    await done(tx);
  }

  /** Every frame of a city, and its record. */
  async deleteCity(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['frames', 'cities'], 'readwrite');
    tx.objectStore('frames').delete(IDBKeyRange.bound([id, '', -Infinity], [id, '￿', Infinity]));
    tx.objectStore('cities').delete(id);
    await done(tx);
  }

  /** Past the limit for every city together, the cities recorded least recently go (never `keep`). */
  async makeRoom(keep: string): Promise<string[]> {
    const all = (await this.cities()).sort((a, b) => a.lastAt - b.lastAt);
    let total = all.reduce((s, c) => s + c.bytes, 0);
    const gone: string[] = [];
    for (const c of all) {
      if (total <= TIMELAPSE.totalBytes) break;
      if (c.id === keep) continue;
      await this.deleteCity(c.id);
      total -= c.bytes;
      gone.push(c.id);
    }
    return gone;
  }
}
