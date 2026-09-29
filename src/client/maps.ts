import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { decodeValue, encodeValue } from '../sim/serialize';
import { MAP_FILE_FORMAT, validMap, type MapData } from '../sim/terrain/customMap';
import { MAP_STORE, tx } from './saves';

/**
 * Custom maps (M24) on the player's computer: `.citymap` files (gzip JSON) to share, and a store in
 * the game's IndexedDB for the maps they've made. Maps that pass the playability check are listed
 * on the new-city screen; drafts only in the editor. DESIGN.md §3.25.
 */
export interface MapInfo {
  id: string;
  name: string;
  savedAt: string;
  /** Passed the playability check when last saved. */
  playable: boolean;
  bytes: number;
}

interface MapRecord extends MapInfo {
  data: Uint8Array;
}

interface MapFile {
  format: typeof MAP_FILE_FORMAT;
  map: unknown;
}

export function encodeMapFile(map: MapData): Uint8Array {
  const file: MapFile = { format: MAP_FILE_FORMAT, map: encodeValue(map) };
  return gzipSync(strToU8(JSON.stringify(file)), { level: 9 });
}

/** Read a map file; throws with a reason a player can act on if it isn't one. */
export function decodeMapFile(bytes: Uint8Array): MapData {
  let file: Partial<MapFile>;
  try {
    const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? strFromU8(gunzipSync(bytes)) : strFromU8(bytes);
    file = JSON.parse(text) as Partial<MapFile>;
  } catch {
    throw new Error('That file is not a Citybloom map');
  }
  if (file.format !== MAP_FILE_FORMAT) throw new Error('That file is not a Citybloom map');
  const map = decodeValue(file.map);
  if (!validMap(map)) throw new Error('That map file is damaged or from a newer version of Citybloom');
  return map;
}

export function newMapId(): string {
  return `m${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export async function writeMap(id: string, map: MapData, playable: boolean): Promise<MapInfo> {
  const data = encodeMapFile(map);
  const rec: MapRecord = {
    id,
    name: map.name,
    savedAt: new Date().toISOString(),
    playable,
    bytes: data.byteLength,
    data,
  };
  await tx('readwrite', (s) => s.put(rec), MAP_STORE);
  const { data: _data, ...info } = rec;
  return info;
}

export async function readMap(id: string): Promise<MapData | null> {
  const rec = await tx<MapRecord | undefined>(
    'readonly',
    (s) => s.get(id) as IDBRequest<MapRecord | undefined>,
    MAP_STORE,
  );
  return rec ? decodeMapFile(rec.data) : null;
}

export async function listMaps(): Promise<MapInfo[]> {
  const all = await tx<MapRecord[]>('readonly', (s) => s.getAll() as IDBRequest<MapRecord[]>, MAP_STORE);
  return all.map(({ data: _d, ...info }) => info).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function deleteMap(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id), MAP_STORE);
}

/** Download a map as a `.citymap` file. */
export function downloadMap(map: MapData): void {
  const bytes = encodeMapFile(map);
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${map.name.replace(/[^a-z0-9-_]+/gi, '_') || 'map'}.citymap`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
