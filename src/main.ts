import { render, h } from 'preact';
import './ui/styles/main.css';
import { BUILD_ID, GAME_TITLE, IS_TEST_BUILD } from './config';
import { SimClient } from './client/simClient';
import { ClientWorld } from './client/world';
import { installTestApi } from './client/testApi';
import { GameRenderer } from './render/renderer';
import { Game } from './game';
import { App } from './ui/App';
import { MAP_PRESETS, MAP_SIZE, type MapPreset } from './data/world';
import { SCENARIO } from './data/scenarios';
import { decodeSave, readSlot } from './client/saves';
import { newMapId, readMap, writeMap } from './client/maps';
import { MapEditor } from './client/editor';
import { mapFromGenerator, type MapData } from './sim/terrain/customMap';
import { AudioEngine } from './audio/engine';
import { loadSettings } from './client/settings';
import { loadModels } from './client/models';
import { justUpdated } from './client/pwa';
import { AppInstall } from './client/install';
import type { Difficulty, GameOptions } from './sim/state';
import type { SaveFile } from './sim/save';
import type { Snapshot } from './sim/protocol';
import { Multiplayer } from './net/multiplayer';
import type { SimDriver } from './net/driver';
import { loadProfile } from './client/profile';
import { normaliseCode } from '../relay/protocol';

/** The map behind the main menu, if the demo town can't be opened. */
const BACKDROP: Partial<GameOptions> = { seed: 'citybloom', preset: 'river' };

/**
 * Listening from the start: Chrome and Edge offer to install the game (beforeinstallprompt) once the
 * page has loaded, which can be before the game has finished booting.
 */
const install = new AppInstall(window);

/**
 * A save shipped with the game as a static file: the small town growing behind the main menu (made
 * by the balance tool's careful player on the backdrop map, see CLAUDE.md), or a scenario's
 * starting city (M18).
 */
async function shippedSave(path: string): Promise<SaveFile | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
    return res.ok ? decodeSave(new Uint8Array(await res.arrayBuffer())) : null;
  } catch {
    return null;
  }
}

/**
 * New-game options from the URL (the new-game screen reloads the page with them; tests and dev
 * links use `?seed=…&preset=…&paused=1` directly).
 */
function optionsFrom(params: URLSearchParams): Partial<GameOptions> {
  const preset = params.get('preset') as MapPreset | null;
  const difficulty = params.get('difficulty') as Difficulty | null;
  const o: Partial<GameOptions> = {
    seed: params.get('seed') || 'citybloom',
    preset: preset && MAP_PRESETS.some((p) => p.id === preset) ? preset : 'river',
  };
  if (difficulty && ['easy', 'normal', 'hard'].includes(difficulty)) o.difficulty = difficulty;
  if (params.has('sandbox')) o.sandbox = params.get('sandbox') === '1';
  o.disasters = params.has('disasters') ? params.get('disasters') === '1' : loadSettings().disasters;
  o.elections = params.has('elections') ? params.get('elections') === '1' : loadSettings().elections;
  const name = params.get('name')?.trim();
  if (name) o.cityName = name.slice(0, 40);
  return o;
}

/** The main menu's view: low over the demo town, or across the valley on the bare map. */
function menuPose(world: ClientWorld) {
  let x = 0;
  let z = 0;
  let n = 0;
  for (const b of world.buildings.values()) {
    x += b.x;
    z += b.z;
    n++;
  }
  if (!n) return { x: MAP_SIZE * 0.44, z: MAP_SIZE * 0.54, distance: 1300, yaw: 2.2, tilt: -0.25 };
  return { x: x / n, z: z / n, distance: 650, yaw: 2.2, tilt: -0.2 };
}

/** A scenario's town, framed as its preview is: the middle of its buildings, most of them in view. */
function townPose(world: ClientWorld) {
  const xs: number[] = [];
  const zs: number[] = [];
  for (const b of world.buildings.values()) {
    xs.push(b.x);
    zs.push(b.z);
  }
  if (!xs.length) return 'overview' as const;
  xs.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);
  const q = (a: number[], f: number) => a[Math.floor((a.length - 1) * f)]!;
  const span = Math.max(q(xs, 0.9) - q(xs, 0.1), q(zs, 0.9) - q(zs, 0.1));
  return {
    x: (q(xs, 0.1) + q(xs, 0.9)) / 2,
    z: (q(zs, 0.1) + q(zs, 0.9)) / 2,
    distance: Math.min(1400, Math.max(260, span * 0.85)),
    yaw: 0.55,
    tilt: 0.2,
  };
}

/** Join a room and wait for its city; rejects with a message the player can read. */
async function joinRoom(code: string, client: SimClient): Promise<{ mp: Multiplayer; snap: Snapshot }> {
  let first: ((s: Snapshot) => void) | null = null;
  const loaded = new Promise<Snapshot>((r) => (first = r));
  // The first snapshot is the city this page opens with.
  const driver: SimDriver = {
    share: (p, s) => client.share(p, s),
    stamped: (e, a) => client.stamped(e, a),
    unshare: () => client.unshare(),
    save: () => client.save(),
    onShared: (l) => client.onShared(l),
    get tick() {
      return client.tick;
    },
    loadShared: async (snapshot, player, resync) => {
      const s = await client.loadShared(snapshot, player, resync);
      first?.(s);
      first = null;
      return s;
    },
  };
  const mp = Multiplayer.join(code, driver, loadProfile());
  await mp.session.start();
  return { mp, snap: await loaded };
}

async function boot(): Promise<void> {
  document.title = GAME_TITLE;
  const params = new URLSearchParams(location.search);
  // Without a city to open, show the main menu over a backdrop map.
  const joinCode = params.get('join') ? normaliseCode(params.get('join')!) : null;
  const menu = !['paused', 'seed', 'preset', 'load', 'new', 'scenario', 'editor', 'join'].some((k) =>
    params.has(k),
  );
  const client = new SimClient();
  client.testMode = IS_TEST_BUILD;
  // An invite link (M30): into the room, whose city comes as a snapshot.
  let joined: { mp: Multiplayer; snap: Snapshot } | null = null;
  let joinError: string | null = params.has('join') && !joinCode ? 'That room code isn’t one of ours.' : null;
  if (joinCode) {
    const result = await joinRoom(joinCode, client).catch((err: unknown) => {
      joinError = err instanceof Error ? err.message : String(err);
      return null;
    });
    joined = result;
  }
  // The hand-made building models download while the city is made or opened.
  const models = loadModels();
  // The map editor (M24): a new map from the generator (or flat), or one of the player's maps.
  const editorParam = params.get('editor');
  let editing: { id: string; map: MapData } | null = null;
  if (editorParam) {
    const saved = editorParam === 'new' ? null : await readMap(editorParam).catch(() => null);
    if (saved) editing = { id: editorParam, map: saved };
    else {
      const o = optionsFrom(params);
      const name = params.get('name')?.trim().slice(0, 40) || 'New map';
      editing = {
        id: newMapId(),
        map: mapFromGenerator(o.seed!, o.preset!, name, params.get('flat') === '1'),
      };
      await writeMap(editing.id, editing.map, false).catch(() => undefined);
    }
  }
  // A new city on one of the player's maps.
  const cityMap =
    params.has('new') && params.get('map') ? await readMap(params.get('map')!).catch(() => null) : null;
  const loadSlot = params.get('load');
  // A scenario (M18) opens its starting city, shipped as a save beside the game.
  const scenario = SCENARIO.get(params.get('scenario') ?? '');
  const found = loadSlot
    ? await readSlot(loadSlot).catch(() => null)
    : scenario
      ? await shippedSave(`scenarios/${scenario.save}`)
      : menu
        ? await shippedSave('demo.citybloom')
        : null;
  const opened = found && (await client.load(found, IS_TEST_BUILD).catch(() => null));
  // A player's save that opened (not the menu's demo town).
  const save = !menu && opened ? found : null;
  const snap = joined
    ? joined.snap
    : editing
      ? await client.init(
          {
            editor: true,
            seed: editing.map.seed,
            preset: editing.map.preset,
            cityName: editing.map.name,
            sandbox: true,
            disasters: false,
            elections: false,
            region: false,
          },
          IS_TEST_BUILD,
          editing.map,
        )
      : opened ||
        (await client.init(menu || joinError ? BACKDROP : optionsFrom(params), IS_TEST_BUILD, cityMap));
  const world = new ClientWorld(snap);
  await models;
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const renderer = new GameRenderer(canvas, world);
  const game = new Game(client, world, renderer, install);
  game.audio = new AudioEngine(game.settings);
  if (editing) {
    game.mode = 'editor';
    game.editor = new MapEditor(game, editing.id);
    game.setSpeed(0);
    game.tools.use('map');
    game.setCamera('overview', true);
    // A reload carries on editing this map.
    history.replaceState(null, '', `${location.pathname}?editor=${encodeURIComponent(editing.id)}`);
  } else if (joined) {
    game.attachNet(joined.mp);
    game.setCamera('overview', true);
    game.toast(`You joined ${world.stats.cityName}.`, 'ok', 5000);
    history.replaceState(null, '', location.pathname);
  } else if (menu || joinError) {
    game.mode = 'menu';
    game.openScreen('main');
    if (params.get('screen') === 'scenarios') game.openScreen('scenarios');
    // A first launch picks graphics to suit the device from the menu's first few seconds.
    if (!game.settings.graphicsChecked) game.startGraphicsCheck();
    if (joinError) {
      game.toast(joinError, 'bad', 9000);
      history.replaceState(null, '', location.pathname);
    }
    // The demo town carries on growing behind the menu (quietly: no notices in menu mode).
    game.setSpeed(opened ? 1 : 0);
    game.setCamera(menuPose(world), true);
  } else {
    // A loaded city opens paused, so the player can get their bearings; a new one starts running.
    game.setSpeed(params.get('paused') === '1' || save ? 0 : 1);
    game.setCamera(scenario && save ? townPose(world) : 'overview', true);
    if (save && loadSlot) game.slot = loadSlot === 'import' ? null : loadSlot;
    if (loadSlot && !save)
      game.toast('That save could not be opened; here is a fresh map instead.', 'bad', 6000);
    if (params.get('map') && !cityMap)
      game.toast('That map could not be opened; here is a generated one instead.', 'bad', 6000);
    if (scenario && save) {
      const r = await game.dispatch({ type: 'startScenario', id: scenario.id });
      if (r.ok) game.scenarioBrief = true;
    } else if (scenario)
      game.toast('That scenario could not be opened; here is a fresh map instead.', 'bad', 6000);
    if (params.get('tutorial') === '1') game.startTutorial();
    // A new city takes the player's seasons and weather settings (M22); saves and scenarios keep theirs.
    if (!save && !scenario) {
      const { seasons, weather } = game.settings;
      if (!seasons || weather !== 2) void game.dispatch({ type: 'setWeather', seasons, intensity: weather });
    }
    // A reload goes back to the main menu (Continue picks up the latest save) rather than
    // re-creating this city from scratch.
    if (params.has('new') || params.has('load') || scenario)
      history.replaceState(null, '', location.pathname);
    // Founded or opened to share with friends (the lobby's Host buttons, M30).
    const host = params.get('host');
    if (host === 'online' || host === 'p2p') void game.hostRoom(host);
  }
  render(h(App, { game }), document.getElementById('ui')!);
  if (IS_TEST_BUILD) installTestApi(game);
  // Built pages keep a copy of the game for offline play and offer new versions (not the dev server).
  if (import.meta.env.PROD) game.updates.start(`${import.meta.env.BASE_URL}sw.js`, import.meta.env.BASE_URL);
  if (justUpdated())
    game.toast(
      `Citybloom is up to date (build ${BUILD_ID}). Your cities are where you left them.`,
      'ok',
      6000,
    );
  // Ask the browser to keep the saves once there's a city or a map to keep (not on the main menu,
  // where Firefox would put a question to a first-time visitor). The installed app asks at once, and
  // so does this page right after installing: browsers agree to installed apps more readily.
  if (game.mode !== 'menu' || install.installed) void game.keeper.ask();
  install.onInstalled = () => {
    game.toast('Citybloom is installed: open it from its icon. Your saved cities are there too.', 'ok', 8000);
    void game.keeper.ask(true);
  };

  const loop = (now: number) => {
    game.frame(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  document.getElementById('boot')?.classList.add('hidden');
}

void boot();
