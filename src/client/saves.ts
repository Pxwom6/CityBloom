import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import type { SaveFile } from '../sim/save';

/**
 * Save storage: gzip-compressed JSON in IndexedDB (one record per slot), plus export/import as
 * `.citybloom` files. DESIGN.md §6.
 */
const DB_NAME = 'citybloom';
const STORE = 'saves';
/** Custom maps from the map editor (M24), in the same database. */
export const MAP_STORE = 'maps';

export interface SlotInfo {
  slot: string;
  /** What the player called the save (autosaves and quick saves have fixed labels). */
  label: string;
  cityName: string;
  population: number;
  tick: number;
  savedAt: string;
  bytes: number;
}

interface SlotRecord extends SlotInfo {
  data: Uint8Array;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Version 2 (M24) adds the maps store; saves are untouched.
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE, { keyPath: 'slot' });
      if (!req.result.objectStoreNames.contains(MAP_STORE))
        req.result.createObjectStore(MAP_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}

export async function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
  store = STORE,
): Promise<T> {
  const db = await openDb();
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

export function encodeSave(save: SaveFile): Uint8Array {
  return gzipSync(strToU8(JSON.stringify(save)), { level: 6 });
}

export function decodeSave(bytes: Uint8Array): SaveFile {
  const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? strFromU8(gunzipSync(bytes)) : strFromU8(bytes);
  return JSON.parse(text) as SaveFile;
}

/** A fixed label for the special slots, else the player's own. */
export function defaultLabel(slot: string, cityName: string): string {
  if (slot === 'auto') return 'Autosave';
  if (slot === 'quick') return 'Quick save';
  if (slot === 'import') return 'Imported';
  return cityName;
}

/** A fresh slot id for a new save. */
export function newSlotId(): string {
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export async function writeSlot(slot: string, save: SaveFile, label?: string): Promise<SlotInfo> {
  const data = encodeSave(save);
  const rec: SlotRecord = {
    slot,
    label: label?.trim() || defaultLabel(slot, save.meta.cityName),
    cityName: save.meta.cityName,
    population: save.meta.population,
    tick: save.meta.tick,
    savedAt: save.meta.savedAt,
    bytes: data.byteLength,
    data,
  };
  await tx('readwrite', (s) => s.put(rec));
  const { data: _data, ...info } = rec;
  return info;
}

export async function readSlot(slot: string): Promise<SaveFile | null> {
  const rec = await tx<SlotRecord | undefined>(
    'readonly',
    (s) => s.get(slot) as IDBRequest<SlotRecord | undefined>,
  );
  return rec ? decodeSave(rec.data) : null;
}

export async function listSlots(): Promise<SlotInfo[]> {
  const all = await tx<SlotRecord[]>('readonly', (s) => s.getAll() as IDBRequest<SlotRecord[]>);
  return all
    .map(({ data: _d, ...info }) => ({
      ...info,
      label: info.label || defaultLabel(info.slot, info.cityName),
    }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function deleteSlot(slot: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(slot));
}

export function exportSave(save: SaveFile): void {
  const bytes = encodeSave(save);
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = save.meta.cityName.replace(/[^a-z0-9-_]+/gi, '_') || 'city';
  a.href = url;
  a.download = `${safe}.citybloom`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importSaveFile(file: File): Promise<SaveFile> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return decodeSave(buf);
}
