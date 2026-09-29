import { useEffect, useRef, useState } from 'preact/hooks';
import { MAP_PRESETS, type MapPreset } from '../data/world';
import {
  decodeMapFile,
  deleteMap,
  downloadMap,
  listMaps,
  newMapId,
  readMap,
  writeMap,
  type MapInfo,
} from '../client/maps';
import { checkMap } from '../sim/terrain/customMap';
import { useGame } from './hooks';
import { drawMapPreview } from './mapPreview';

const randomSeed = () => Math.random().toString(36).slice(2, 8);

const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
};

/**
 * The map editor's front door (M24), from the main menu: start a new map (from a generated one,
 * or flat ground), carry on with one of your maps, share one as a file, or open a file.
 */
export function MapsScreen() {
  const game = useGame();
  const [maps, setMaps] = useState<MapInfo[] | null>(null);
  const [name, setName] = useState('My map');
  const [base, setBase] = useState<MapPreset | 'flat'>('river');
  const [seed, setSeed] = useState(randomSeed);
  const canvas = useRef<HTMLCanvasElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const refresh = () =>
    void listMaps()
      .then(setMaps)
      .catch(() => setMaps([]));
  useEffect(refresh, []);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    if (base === 'flat') {
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#8ab266';
        ctx.fillRect(0, 0, c.width, c.height);
      }
    } else drawMapPreview(c, seed.trim() || 'citybloom', base);
  }, [base, seed]);
  const open = (q: Record<string, string>) => {
    location.href = `${location.pathname}?${new URLSearchParams(q).toString()}`;
  };
  const start = () =>
    open({
      editor: 'new',
      name: name.trim() || 'My map',
      seed: seed.trim() || randomSeed(),
      preset: base === 'flat' ? 'lakes' : base,
      ...(base === 'flat' ? { flat: '1' } : {}),
    });
  const importFile = async (f: File) => {
    try {
      const map = decodeMapFile(new Uint8Array(await f.arrayBuffer()));
      await writeMap(newMapId(), map, checkMap(map).ok);
      game.toast(`Opened “${map.name}”.`, 'ok');
      refresh();
    } catch (err) {
      game.toast(err instanceof Error ? err.message : 'That file could not be read', 'bad', 5000);
    }
  };
  return (
    <div class="shell-card panel new-game maps-screen" data-testid="maps-screen">
      <header>
        <h2>Map editor</h2>
        <span class="muted">Sculpt the land, paint rivers, lakes and sea, lay forests, ore and oil.</span>
      </header>
      <div class="new-game-body">
        <div class="new-game-map">
          <canvas ref={canvas} width={128} height={128} class="map-preview" data-testid="maps-preview" />
          <div class="preset-list">
            {MAP_PRESETS.map((p) => (
              <button
                key={p.id}
                class={`preset ${base === p.id ? 'active' : ''}`}
                data-testid={`maps-base-${p.id}`}
                onClick={() => setBase(p.id)}
              >
                <strong>{p.name}</strong>
                <span>Start from this generated map</span>
              </button>
            ))}
            <button
              class={`preset ${base === 'flat' ? 'active' : ''}`}
              data-testid="maps-base-flat"
              onClick={() => setBase('flat')}
            >
              <strong>Flat meadow</strong>
              <span>A blank canvas: no hills, water or woods</span>
            </button>
          </div>
        </div>
        <div class="new-game-form">
          <label class="field">
            <span>Map name</span>
            <input
              type="text"
              maxLength={40}
              value={name}
              data-testid="maps-name"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </label>
          {base !== 'flat' && (
            <label class="field">
              <span>Seed</span>
              <div class="field-row">
                <input
                  type="text"
                  maxLength={24}
                  value={seed}
                  data-testid="maps-seed"
                  onInput={(e) => setSeed((e.target as HTMLInputElement).value)}
                />
                <button class="btn" title="Another map" onClick={() => setSeed(randomSeed())}>
                  Shuffle
                </button>
              </div>
            </label>
          )}
          <button class="btn active" data-testid="maps-new" onClick={start}>
            Start a new map
          </button>
          <div class="field">
            <span>Your maps</span>
            {maps === null ? (
              <p class="muted">Loading…</p>
            ) : maps.length === 0 ? (
              <p class="muted" data-testid="maps-empty">
                None yet. Maps you save here also appear on the new-city screen once they’re playable.
              </p>
            ) : (
              <ul class="slot-list" data-testid="maps-list">
                {maps.map((m) => (
                  <li key={m.id} class="slot" data-testid={`maps-item-${m.id}`}>
                    <span class="slot-name">
                      {m.name}{' '}
                      <small class={m.playable ? 'good' : 'muted'}>{m.playable ? 'playable' : 'draft'}</small>
                    </span>
                    <span class="slot-meta">
                      {ago(m.savedAt)} · {Math.max(1, Math.round(m.bytes / 1024))} KB
                    </span>
                    <span class="slot-actions">
                      <button
                        class="btn small active"
                        data-testid={`maps-edit-${m.id}`}
                        onClick={() => open({ editor: m.id })}
                      >
                        Edit
                      </button>
                      <button
                        class="btn small"
                        data-testid={`maps-export-${m.id}`}
                        onClick={() => void readMap(m.id).then((map) => map && downloadMap(map))}
                      >
                        Export
                      </button>
                      <button
                        class="btn small"
                        data-testid={`maps-delete-${m.id}`}
                        onClick={() => {
                          if (
                            confirm(`Delete the map “${m.name}”? Cities founded on it keep their own copy.`)
                          )
                            void deleteMap(m.id).then(refresh);
                        }}
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <footer class="shell-actions">
        <button class="btn" data-testid="shell-back" onClick={() => game.closeScreen()}>
          Back
        </button>
        <button class="btn" data-testid="maps-import" onClick={() => file.current?.click()}>
          Open a map file…
        </button>
        <input
          ref={file}
          type="file"
          accept=".citymap"
          hidden
          data-testid="maps-file"
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) void importFile(f);
          }}
        />
      </footer>
    </div>
  );
}
