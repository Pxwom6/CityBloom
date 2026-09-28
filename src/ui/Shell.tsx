import { CLIMATES, INTENSITY_NAMES, PRESET_CLIMATE, type WeatherIntensity } from '../data/climate';
import { ScenarioScreen } from './Scenario';
import { SCENARIOS } from '../data/scenarios';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BUILD_ID, GAME_TITLE, GAME_VERSION } from '../config';
import { MAP_PRESETS, type MapPreset } from '../data/world';
import { DIFFICULTY, type Difficulty } from '../data/economy';
import { dateOf, formatDate } from '../sim/time';
import {
  deleteSlot,
  exportSave,
  importSaveFile,
  listSlots,
  newSlotId,
  readSlot,
  writeSlot,
  type SlotInfo,
} from '../client/saves';
import {
  AUTOSAVE_CHOICES,
  DRAW_DISTANCES,
  POINTER_DEVICES,
  QUALITIES,
  UI_SCALE,
  type Settings,
} from '../client/settings';
import { useGame, useGameUpdates } from './hooks';
import { drawMapPreview } from './mapPreview';

const NAME_A = ['Ash', 'Bram', 'Clover', 'Elm', 'Fern', 'Glen', 'Hazel', 'Juniper', 'Kestrel', 'Linden'];
const NAME_B = ['Marsh', 'Oak', 'Pine', 'Rowan', 'Sorrel', 'Thistle', 'Willow', 'Yarrow', 'Alder', 'Birch'];
const NAME_END = ['ford', 'brook', 'field', 'vale', 'bury', 'haven', 'wick', 'ton', 'mere', 'dale'];

function randomName(): string {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
  return `${pick(Math.random() < 0.5 ? NAME_A : NAME_B)}${pick(NAME_END)}`;
}

function randomSeed(): string {
  return Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
}

function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

const openSlot = (slot: string) => (location.href = `${location.pathname}?load=${encodeURIComponent(slot)}`);

/** Saved cities, newest first (null while loading). */
function useSlots(): [SlotInfo[] | null, () => void] {
  const [slots, setSlots] = useState<SlotInfo[] | null>(null);
  const refresh = () =>
    void listSlots()
      .then(setSlots)
      .catch(() => setSlots([]));
  useEffect(refresh, []);
  return [slots, refresh];
}

function SlotLine({ s, city = true }: { s: SlotInfo; city?: boolean }) {
  return (
    <span class="slot-meta">
      {city && `${s.cityName} · `}
      {s.population.toLocaleString('en-US')} residents · {formatDate(dateOf(s.tick))} · {ago(s.savedAt)}
    </span>
  );
}

/** A picker for one of a few values. */
export function Segmented<T extends string | number>(props: {
  value: T;
  options: readonly T[];
  label: (v: T) => string;
  testid: string;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div class="segmented" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={String(o)}
          role="radio"
          aria-checked={props.value === o}
          class={props.value === o ? 'active' : ''}
          disabled={props.disabled}
          data-testid={`${props.testid}-${o}`}
          onClick={() => props.onChange(o)}
        >
          {props.label(o)}
        </button>
      ))}
    </div>
  );
}

function MainMenu() {
  const game = useGameUpdates(500);
  const [slots] = useSlots();
  const latest = slots?.[0];
  return (
    <div class="shell-main" data-testid="main-menu">
      <div class="shell-brand">
        <h1 class="shell-title">{GAME_TITLE}</h1>
        <p class="shell-tagline">Grow a living city from an empty valley.</p>
      </div>
      <nav class="shell-nav">
        {latest && (
          <button class="shell-btn primary" data-testid="main-continue" onClick={() => openSlot(latest.slot)}>
            <span>Continue</span>
            <small>
              {latest.label !== latest.cityName && `${latest.label} · `}
              <SlotLine s={latest} />
            </small>
          </button>
        )}
        <button
          class={`shell-btn ${latest || slots === null ? '' : 'primary'}`}
          data-testid="main-new"
          onClick={() => game.openScreen('newGame')}
        >
          <span>New city</span>
        </button>
        <button class="shell-btn" data-testid="main-scenarios" onClick={() => game.openScreen('scenarios')}>
          <span>Scenarios</span>
          <small>{SCENARIOS.length} challenges</small>
        </button>
        <button class="shell-btn" data-testid="main-load" onClick={() => game.openScreen('load')}>
          <span>Load city</span>
          {slots && slots.length > 0 && <small>{slots.length} saved</small>}
        </button>
        <button class="shell-btn" data-testid="main-settings" onClick={() => game.openScreen('settings')}>
          <span>Settings</span>
        </button>
      </nav>
      <footer class="shell-foot" data-testid="shell-foot">
        Version {GAME_VERSION} · build {BUILD_ID}
        {game.updates.offlineReady && ' · works offline'}
      </footer>
    </div>
  );
}

function NewGame() {
  const game = useGame();
  const [slots] = useSlots();
  const [name, setName] = useState(randomName);
  const [preset, setPreset] = useState<MapPreset>('river');
  const [seed, setSeed] = useState(randomSeed);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [sandbox, setSandbox] = useState(false);
  const [disasters, setDisasters] = useState(game.settings.disasters);
  const [elections, setElections] = useState(game.settings.elections);
  const [tutorial, setTutorial] = useState<boolean | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // The tutorial is on by default for a first city.
  const tut = tutorial ?? slots?.length === 0;
  useEffect(() => {
    if (canvas.current) drawMapPreview(canvas.current, seed.trim() || 'citybloom', preset);
  }, [seed, preset]);
  const start = () => {
    const q = new URLSearchParams({
      new: '1',
      name: name.trim() || randomName(),
      seed: seed.trim() || randomSeed(),
      preset,
      difficulty,
      sandbox: sandbox ? '1' : '0',
      disasters: disasters ? '1' : '0',
      elections: elections && !sandbox ? '1' : '0',
    });
    if (tut && !sandbox) q.set('tutorial', '1');
    game.updateSettings({ disasters, elections });
    location.href = `${location.pathname}?${q.toString()}`;
  };
  return (
    <div class="shell-card panel new-game" data-testid="new-game">
      <header>
        <h2>New city</h2>
      </header>
      <div class="new-game-body">
        <div class="new-game-map">
          <canvas ref={canvas} width={128} height={128} class="map-preview" data-testid="map-preview" />
          <div class="preset-list">
            {MAP_PRESETS.map((p) => (
              <button
                key={p.id}
                class={`preset ${preset === p.id ? 'active' : ''}`}
                data-testid={`preset-${p.id}`}
                onClick={() => setPreset(p.id)}
              >
                <strong>{p.name}</strong>
                <span>{p.blurb}</span>
              </button>
            ))}
          </div>
          <p class="muted climate-note" data-testid="new-climate">
            {CLIMATES[PRESET_CLIMATE[preset]].name} climate: {CLIMATES[PRESET_CLIMATE[preset]].blurb}
          </p>
        </div>
        <div class="new-game-form">
          <label class="field">
            <span>City name</span>
            <input
              type="text"
              maxLength={40}
              value={name}
              data-testid="new-name"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </label>
          <label class="field">
            <span>Map seed</span>
            <div class="field-row">
              <input
                type="text"
                maxLength={24}
                value={seed}
                data-testid="new-seed"
                onInput={(e) => setSeed((e.target as HTMLInputElement).value)}
              />
              <button class="btn" title="Another map" onClick={() => setSeed(randomSeed())}>
                Shuffle
              </button>
            </div>
          </label>
          <div class="field">
            <span>Difficulty</span>
            <Segmented
              value={difficulty}
              options={['easy', 'normal', 'hard'] as Difficulty[]}
              label={(d) => DIFFICULTY[d].name}
              testid="difficulty"
              onChange={setDifficulty}
            />
            <small class="muted">
              {DIFFICULTY[difficulty].blurb} Starts with $
              {DIFFICULTY[difficulty].funds.toLocaleString('en-US')}.
            </small>
          </div>
          <label class="check">
            <input
              type="checkbox"
              checked={sandbox}
              data-testid="new-sandbox"
              onChange={(e) => setSandbox((e.target as HTMLInputElement).checked)}
            />
            <span>
              Sandbox <small class="muted">unlimited money, everything unlocked, no achievements</small>
            </span>
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={disasters}
              data-testid="new-disasters"
              onChange={(e) => setDisasters((e.target as HTMLInputElement).checked)}
            />
            <span>
              Random disasters <small class="muted">rare earthquakes, tornadoes, floods and meteors</small>
            </span>
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={elections && !sandbox}
              disabled={sandbox}
              data-testid="new-elections"
              onChange={(e) => setElections((e.target as HTMLInputElement).checked)}
            />
            <span>
              Elections <small class="muted">every four years, won mostly on approval</small>
            </span>
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={tut && !sandbox}
              disabled={sandbox}
              data-testid="new-tutorial"
              onChange={(e) => setTutorial((e.target as HTMLInputElement).checked)}
            />
            <span>
              Tutorial <small class="muted">a few steps to a working town</small>
            </span>
          </label>
        </div>
      </div>
      <footer class="shell-actions">
        <button class="btn" data-testid="shell-back" onClick={() => game.closeScreen()}>
          Back
        </button>
        <button class="btn active" data-testid="new-start" onClick={start}>
          Found the city
        </button>
      </footer>
    </div>
  );
}

function PauseMenu() {
  const game = useGame();
  const file = useRef<HTMLInputElement>(null);
  const st = game.world.stats;
  return (
    <div class="shell-card panel pause-menu" data-testid="pause-menu">
      <header>
        <h2>Paused</h2>
        <span class="muted">
          {st.cityName} · {formatDate(dateOf(st.tick))}
        </span>
      </header>
      <nav class="shell-nav compact">
        <button class="shell-btn primary" data-testid="pause-resume" onClick={() => game.resume()}>
          <span>Resume</span>
        </button>
        <button class="shell-btn" data-testid="pause-save" onClick={() => game.openScreen('save')}>
          <span>Save city…</span>
        </button>
        <button
          class="shell-btn"
          data-testid="menu-save"
          disabled={game.saving}
          onClick={() => void game.saveTo('quick', 'Quick save')}
        >
          <span>Quick save</span>
        </button>
        <button class="shell-btn" data-testid="pause-load" onClick={() => game.openScreen('load')}>
          <span>Load city…</span>
        </button>
        <button class="shell-btn" data-testid="pause-settings" onClick={() => game.openScreen('settings')}>
          <span>Settings</span>
        </button>
        <div class="shell-row">
          <button
            class="shell-btn"
            data-testid="pause-export"
            onClick={async () => exportSave(await game.client.save())}
          >
            <span>Export to file</span>
          </button>
          <button class="shell-btn" data-testid="pause-import" onClick={() => file.current?.click()}>
            <span>Import file</span>
          </button>
        </div>
        <button class="shell-btn quiet" data-testid="pause-quit" onClick={() => void game.quitToMenu()}>
          <span>Quit to main menu</span>
          <small>Your city is autosaved first.</small>
        </button>
      </nav>
      <ImportInput inputRef={file} />
    </div>
  );
}

/** Hidden file input: imports a save into its own slot and opens it. */
function ImportInput({ inputRef }: { inputRef: { current: HTMLInputElement | null } }) {
  const game = useGame();
  return (
    <input
      ref={inputRef}
      type="file"
      accept=".citybloom,application/octet-stream,application/json"
      style={{ display: 'none' }}
      data-testid="import-file"
      onChange={async (e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (!f) return;
        try {
          const s = await importSaveFile(f);
          if (!s?.meta || !s.state) throw new Error('no city in it');
          const slot = newSlotId();
          await writeSlot(slot, s, `${s.meta.cityName} (imported)`);
          openSlot(slot);
        } catch (err) {
          game.toast(
            `That file isn't a readable save (${err instanceof Error ? err.message : String(err)})`,
            'bad',
            6000,
          );
        }
      }}
    />
  );
}

function SaveScreen() {
  const game = useGame();
  const [slots, refresh] = useSlots();
  const [label, setLabel] = useState(game.world.stats.cityName);
  const [confirm, setConfirm] = useState<string | null>(null);
  const save = async (slot: string, name: string) => {
    if (await game.saveTo(slot, name)) {
      refresh();
      game.closeScreen();
    }
  };
  return (
    <div class="shell-card panel slots-screen" data-testid="save-screen">
      <header>
        <h2>Save city</h2>
      </header>
      <div class="save-new">
        <input
          type="text"
          maxLength={40}
          value={label}
          data-testid="save-name"
          aria-label="Save name"
          onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && void save(newSlotId(), label)}
        />
        <button
          class="btn active"
          data-testid="save-new"
          disabled={game.saving}
          onClick={() => void save(newSlotId(), label)}
        >
          Save as new
        </button>
      </div>
      <SlotList
        slots={slots?.filter((s) => s.slot !== 'auto') ?? null}
        empty="No saves yet."
        actions={(s) =>
          confirm === s.slot ? (
            <>
              <span class="muted">Replace it?</span>
              <button
                class="btn active"
                data-testid={`overwrite-yes-${s.slot}`}
                onClick={() => void save(s.slot, s.label)}
              >
                Overwrite
              </button>
              <button class="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </>
          ) : (
            <button class="btn" data-testid={`overwrite-${s.slot}`} onClick={() => setConfirm(s.slot)}>
              Overwrite
            </button>
          )
        }
      />
      <footer class="shell-actions">
        <button class="btn" data-testid="shell-back" onClick={() => game.closeScreen()}>
          Back
        </button>
      </footer>
    </div>
  );
}

function SlotList(props: {
  slots: SlotInfo[] | null;
  empty: string;
  actions: (s: SlotInfo) => preact.ComponentChildren;
}) {
  if (props.slots === null) return <div class="slot-list muted">Loading…</div>;
  if (!props.slots.length) return <div class="slot-list empty muted">{props.empty}</div>;
  return (
    <ul class="slot-list" data-testid="slot-list">
      {props.slots.map((s) => (
        <li key={s.slot} class="slot" data-testid={`slot-${s.slot}`}>
          <div class="slot-text">
            <strong>{s.label}</strong>
            <SlotLine s={s} city={s.label !== s.cityName} />
          </div>
          <div class="slot-actions">{props.actions(s)}</div>
        </li>
      ))}
    </ul>
  );
}

function LoadScreen() {
  const game = useGame();
  const [slots, refresh] = useSlots();
  const [confirm, setConfirm] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  return (
    <div class="shell-card panel slots-screen" data-testid="load-screen">
      <header>
        <h2>Load city</h2>
        {game.mode === 'play' && (
          <span class="muted">The city you're playing closes: save it first to keep it.</span>
        )}
      </header>
      <SlotList
        slots={slots}
        empty="No saved cities yet. Start a new one, or import a .citybloom file."
        actions={(s) =>
          confirm === s.slot ? (
            <>
              <span class="muted">Delete it?</span>
              <button
                class="btn danger"
                data-testid={`delete-yes-${s.slot}`}
                onClick={async () => {
                  await deleteSlot(s.slot);
                  setConfirm(null);
                  refresh();
                }}
              >
                Delete
              </button>
              <button class="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button class="btn active" data-testid={`load-${s.slot}`} onClick={() => openSlot(s.slot)}>
                Load
              </button>
              <button
                class="btn"
                data-testid={`export-${s.slot}`}
                title="Download as a .citybloom file"
                onClick={async () => {
                  const save = await readSlot(s.slot);
                  if (save) exportSave(save);
                }}
              >
                Export
              </button>
              <button class="btn" data-testid={`delete-${s.slot}`} onClick={() => setConfirm(s.slot)}>
                Delete
              </button>
            </>
          )
        }
      />
      <footer class="shell-actions">
        <button class="btn" data-testid="shell-back" onClick={() => game.closeScreen()}>
          Back
        </button>
        <button class="btn" data-testid="load-import" onClick={() => file.current?.click()}>
          Import from file…
        </button>
      </footer>
      <ImportInput inputRef={file} />
    </div>
  );
}

const VOLUMES: [keyof Settings, string][] = [
  ['masterVolume', 'Master'],
  ['effectsVolume', 'Effects'],
  ['ambientVolume', 'Ambience'],
];

export function Check(props: {
  on: boolean;
  testid: string;
  label: string;
  hint?: string;
  set: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label class="check">
      <input
        type="checkbox"
        checked={props.on}
        disabled={props.disabled}
        data-testid={props.testid}
        onChange={(e) => props.set((e.target as HTMLInputElement).checked)}
      />
      <span>
        {props.label} {props.hint && <small class="muted">{props.hint}</small>}
      </span>
    </label>
  );
}

function SettingsScreen() {
  const game = useGameUpdates(100);
  const s = game.settings;
  const set = (patch: Partial<Settings>) => game.updateSettings(patch);
  // This city's seasons and weather as just chosen, shown until the sim's stats agree (a click would
  // otherwise flick back for a moment while the change goes through the worker).
  const [pending, setPending] = useState<{ seasons?: boolean; intensity?: WeatherIntensity }>({});
  const cityWeather = game.world.stats.weather;
  useEffect(() => {
    if (
      (pending.seasons === undefined || pending.seasons === cityWeather.seasons) &&
      (pending.intensity === undefined || pending.intensity === cityWeather.intensity) &&
      (pending.seasons !== undefined || pending.intensity !== undefined)
    )
      setPending({});
  });
  return (
    <div class="shell-card panel settings-screen" data-testid="settings-screen">
      <header>
        <h2>Settings</h2>
      </header>
      <div class="settings-grid">
        <section>
          <h3>Graphics</h3>
          <p class="settings-note" data-testid="graphics-auto">
            {game.graphicsCheck
              ? 'Checking what this device can draw smoothly…'
              : s.autoGraphics
                ? `Picked for this device: ${s.autoGraphics[0]!.toUpperCase()}${s.autoGraphics.slice(1)}.`
                : 'Chosen by hand.'}{' '}
            <button
              class="btn small"
              data-testid="graphics-recheck"
              disabled={!!game.graphicsCheck}
              title="Time a few seconds of drawing and pick the quality this device can hold"
              onClick={() => game.startGraphicsCheck()}
            >
              Check again
            </button>
          </p>
          <div class="field">
            <span>Quality</span>
            <Segmented
              value={s.quality}
              options={QUALITIES}
              label={(q) => q[0]!.toUpperCase() + q.slice(1)}
              testid="quality"
              onChange={(quality) => set({ quality })}
            />
            <small class="muted">Resolution, shadow detail and crowd sizes.</small>
          </div>
          <div class="field">
            <span>Draw distance</span>
            <Segmented
              value={s.drawDistance}
              options={DRAW_DISTANCES}
              label={(d) => d[0]!.toUpperCase() + d.slice(1)}
              testid="draw"
              onChange={(drawDistance) => set({ drawDistance })}
            />
          </div>
          <Check on={s.shadows} testid="set-shadows" label="Shadows" set={(shadows) => set({ shadows })} />
          <Check
            on={s.tiltShift}
            testid="tilt-shift"
            label="Tilt-shift blur"
            hint="when zoomed in"
            set={(tiltShift) => set({ tiltShift })}
          />
        </section>
        <section>
          <h3>Interface</h3>
          <label class="field">
            <span>
              Interface size <strong>{Math.round(s.uiScale * 100)}%</strong>
            </span>
            <input
              type="range"
              min={UI_SCALE.min * 100}
              max={UI_SCALE.max * 100}
              step={10}
              value={Math.round(s.uiScale * 100)}
              data-testid="ui-scale"
              onInput={(e) => set({ uiScale: Number((e.target as HTMLInputElement).value) / 100 })}
            />
          </label>
          <div class="field">
            <span>Pointing device</span>
            <Segmented
              value={s.pointer}
              options={POINTER_DEVICES}
              label={(d) => (d === 'auto' ? 'Automatic' : d === 'mouse' ? 'Mouse' : 'Trackpad')}
              testid="pointer"
              onChange={(pointer) => set({ pointer })}
            />
            <small class="muted">
              Trackpad: swipe with two fingers to pan, pinch to zoom, hold Option (Alt) or Shift while swiping
              to turn and tilt. A mouse wheel zooms.
            </small>
          </div>
          <Check
            on={s.edgeScroll}
            testid="edge-scroll"
            label="Edge scrolling"
            hint="pan when the pointer touches the screen edge"
            set={(edgeScroll) => set({ edgeScroll })}
          />
          <Check on={s.tips} testid="set-tips" label="Tips for new mayors" set={(tips) => set({ tips })} />
          {s.seenTips.length > 0 && (
            <button
              class="btn small"
              data-testid="reset-tips"
              onClick={() => set({ seenTips: [], tips: true })}
            >
              Show all tips again
            </button>
          )}
        </section>
        <section data-testid="sound-settings">
          <h3>Sound</h3>
          {VOLUMES.map(([key, name]) => (
            <label key={key} class="volume-row">
              <span>{name}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round((s[key] as number) * 100)}
                disabled={s.muted}
                data-testid={`vol-${key}`}
                onInput={(e) => set({ [key]: Number((e.target as HTMLInputElement).value) / 100 })}
              />
              <span class="val">{Math.round((s[key] as number) * 100)}</span>
            </label>
          ))}
          <Check on={s.muted} testid="mute" label="Mute all sound" set={(muted) => set({ muted })} />
        </section>
        <section>
          <h3>Game</h3>
          <Check
            on={game.mode === 'play' ? game.randomDisasters : s.disasters}
            testid="set-disasters"
            label="Random disasters"
            hint={game.mode === 'play' ? 'in this city, and new ones' : 'in new cities'}
            set={(disasters) => {
              set({ disasters });
              if (game.mode === 'play') game.setRandomDisasters(disasters);
            }}
          />
          <Check
            on={game.mode === 'play' ? game.world.stats.election !== null : s.elections}
            testid="set-elections"
            label="Elections"
            hint={
              game.mode === 'play'
                ? game.world.options.sandbox
                  ? 'never in sandbox cities; on for new ones'
                  : 'in this city, and new ones'
                : 'in new cities'
            }
            set={(elections) => {
              set({ elections });
              if (game.mode === 'play' && !game.world.options.sandbox)
                void game.dispatch({ type: 'setElections', on: elections });
            }}
          />
          {(() => {
            // Seasons and weather (M22): this city's (unless a scenario sets them), and new ones'.
            const w = { ...cityWeather, ...pending };
            const inCity = game.mode === 'play';
            const locked = inCity && game.world.stats.scenario?.status === 'playing';
            const apply = (patch: { seasons?: boolean; intensity?: WeatherIntensity }) => {
              set({
                ...(patch.seasons !== undefined ? { seasons: patch.seasons } : {}),
                ...(patch.intensity !== undefined ? { weather: patch.intensity } : {}),
              });
              if (inCity && !locked) {
                setPending((p) => ({ ...p, ...patch }));
                void game.dispatch({ type: 'setWeather', ...patch }).then((r) => {
                  if (!r.ok) setPending({});
                });
              }
            };
            const hint = locked
              ? 'this scenario sets its own'
              : inCity
                ? 'in this city, and new ones'
                : 'in new cities';
            return (
              <>
                <Check
                  on={inCity ? w.seasons : s.seasons}
                  testid="set-seasons"
                  label="Seasons"
                  hint={`${hint}: winter snow, summer heat`}
                  disabled={locked}
                  set={(seasons) => apply({ seasons })}
                />
                <div class="field" title={`Weather ${hint}`}>
                  <span>Weather</span>
                  <Segmented
                    value={(inCity ? w.intensity : s.weather) as WeatherIntensity}
                    options={[0, 1, 2, 3] as WeatherIntensity[]}
                    label={(i) => INTENSITY_NAMES[i]}
                    testid="weather-intensity"
                    disabled={locked}
                    onChange={(intensity) => apply({ intensity })}
                  />
                </div>
              </>
            );
          })()}
          <div class="field">
            <span>Autosave</span>
            <Segmented
              value={s.autosaveMinutes}
              options={AUTOSAVE_CHOICES}
              label={(m) => (m ? `${m} min` : 'Off')}
              testid="autosave"
              onChange={(autosaveMinutes) => set({ autosaveMinutes })}
            />
          </div>
          {game.mode === 'play' && (
            <button
              class="btn small"
              data-testid="restart-tutorial"
              onClick={() => {
                game.startTutorial();
                game.resume();
              }}
            >
              Start the tutorial
            </button>
          )}
        </section>
      </div>
      <footer class="shell-actions">
        <button class="btn active" data-testid="shell-back" onClick={() => game.closeScreen()}>
          Done
        </button>
      </footer>
    </div>
  );
}

/** Main menu, new-game screen, pause menu, save/load screens and settings. */
export function Shell() {
  const game = useGameUpdates(100);
  const screen = game.screen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || !game.screen || e.defaultPrevented) return;
      e.preventDefault();
      game.closeScreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);
  if (!screen) return null;
  return (
    <div class={`shell ${game.mode}`} data-testid="shell">
      {screen === 'main' && <MainMenu />}
      {screen === 'newGame' && <NewGame />}
      {screen === 'scenarios' && <ScenarioScreen />}
      {screen === 'pause' && <PauseMenu />}
      {screen === 'save' && <SaveScreen />}
      {screen === 'load' && <LoadScreen />}
      {screen === 'settings' && <SettingsScreen />}
    </div>
  );
}
