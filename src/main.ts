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
import { loadBattle, loadTown } from './client/battles';
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
import { loadProfile, regionRejoin, storedProfile } from './client/profile';
import { askName } from './ui/JoinPrompt';
import { relayUrl, signalling } from './net/multiplayer';
import { webSocketLink } from './net/link';
import { p2pConnect } from './net/p2p';
import { fetchCitySave } from './net/regionLink';
import { codeKind, formatInvite, inviteProblem, parseInvite, type Invite } from '../relay/protocol';
import { WAR_SCALES, type WarScale } from './data/war';

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
  // Rival neighbours (M34): war on for this city. Off unless asked for.
  if (params.get('rivals') === '1') o.rivals = true;
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

/** The boot screen's line while the game gets ready (F12: say what an invite link is waiting for). */
function bootStatus(text: string): void {
  const boot = document.getElementById('boot');
  if (boot && !boot.classList.contains('hidden') && !boot.classList.contains('asking'))
    boot.textContent = text;
}

/** How long a join may take to bring the room's city, all told (ms). */
const JOIN_DEADLINE = 120_000;

/** Join a room and wait for its city; rejects with a message the player can read. */
async function joinRoom(invite: Invite, client: SimClient): Promise<{ mp: Multiplayer; snap: Snapshot }> {
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
  const p2p = codeKind(invite.code) === 'p2p';
  bootStatus(p2p ? 'Looking for the host’s computer…' : `Connecting to room ${invite.code}…`);
  const mp = Multiplayer.join(invite, driver, loadProfile(), () => bootStatus('Connecting to the host…'));
  // Once the room has said hello, its city is on its way.
  const prev = mp.session.onChange;
  mp.session.onChange = () => {
    if (mp.session.state === 'joining') bootStatus('Loading the city…');
    prev?.();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('The room didn’t send its city in time: try the invite link again.')),
      JOIN_DEADLINE,
    );
  });
  try {
    await Promise.race([mp.session.start(), deadline]);
    return { mp, snap: await Promise.race([loaded, deadline]) };
  } catch (err) {
    mp.leave();
    throw err;
  } finally {
    clearTimeout(timer);
    mp.session.onChange = prev;
  }
}

async function boot(): Promise<void> {
  document.title = GAME_TITLE;
  const params = new URLSearchParams(location.search);
  // The hand-made building models download while the city is made, opened or fetched from a room.
  const models = loadModels();
  // Without a city to open, show the main menu over a backdrop map. An invite carries a room's code
  // and, for a room in a player's browser, its key (F2).
  const joinInvite = params.get('join') ? parseInvite(params.get('join')!) : null;
  // Looking round a neighbour's city in a shared region (M32), read-only.
  const visitInvite = params.get('visit') ? parseInvite(params.get('visit')!) : null;
  let visited: SaveFile | null = null;
  let visitError: string | null = params.has('visit') ? inviteProblem(visitInvite) : null;
  if (visitInvite && !visitError) {
    bootStatus('Fetching the city from the region…');
    const url = relayUrl();
    const { code, key } = visitInvite;
    const connect =
      codeKind(code) === 'online'
        ? () =>
            url
              ? webSocketLink(`${url}/region/${code}`)
              : Promise.reject(new Error('Online regions aren’t set up'))
        : () => p2pConnect(code, key!, signalling());
    visited = await fetchCitySave(connect, Number(params.get('city') ?? 0), loadProfile().name).catch(
      (err: unknown) => {
        visitError = `That city couldn’t be fetched from the region (${err instanceof Error ? err.message : String(err)}).`;
        return null;
      },
    );
  }
  // Watching a battle fought in a neighbour's town (M35): its record and the town it was fought in.
  const battleId = params.get('battle');
  const battleRecord = battleId ? await loadBattle(battleId).catch(() => null) : null;
  const battleTown = battleRecord?.townKey ? await loadTown(battleRecord.townKey).catch(() => null) : null;
  const menu = ![
    'paused',
    'seed',
    'preset',
    'load',
    'new',
    'scenario',
    'editor',
    'join',
    'visit',
    'battle',
  ].some((k) => params.has(k));
  const client = new SimClient();
  client.testMode = IS_TEST_BUILD;
  // An invite link (M30): into the room, whose city comes as a snapshot.
  let joined: { mp: Multiplayer; snap: Snapshot } | null = null;
  let joinError: string | null = params.has('join') ? inviteProblem(joinInvite) : visitError;
  if (joinInvite && !joinError) {
    // A friend arriving for the first time picks the name the others will see (F12).
    const boot = document.getElementById('boot');
    if (!storedProfile() && boot) await askName(boot, `Join room ${joinInvite.code}`, loadProfile());
    const result = await joinRoom(joinInvite, client).catch((err: unknown) => {
      joinError = err instanceof Error ? err.message : String(err);
      return null;
    });
    joined = result;
  }
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
  const found = visited
    ? visited
    : battleTown
      ? battleTown
      : loadSlot
        ? await readSlot(loadSlot).catch(() => null)
        : scenario
          ? await shippedSave(`scenarios/${scenario.save}`)
          : menu
            ? await shippedSave('demo.citybloom')
            : null;
  const opened = found && (await client.load(found, IS_TEST_BUILD).catch(() => null));
  // A battle this browser doesn't keep (or whose town won't open): back to the city it came from,
  // never a fresh city in its place (which would autosave over the player's).
  if (battleId && !(battleRecord && battleTown && opened)) {
    const back = params.get('back');
    location.replace(
      back ? `${location.pathname}?load=${encodeURIComponent(back)}&noreplay=1` : location.pathname,
    );
    return;
  }
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
  if (joined || visited) bootStatus('Building the scene…');
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
  } else if (battleRecord && battleTown && opened) {
    // The battle again, in the town's own sim: its fires and rubble, then its repairs.
    game.readOnly = true;
    game.viewing = { record: battleRecord, back: params.get('back') };
    const shown = await client.command({ type: 'battleResolve', input: battleRecord.input, mode: 'watch' });
    if (!shown.ok) {
      // Nothing to show here after all (another version's battle, say): say why, and go back.
      game.toast(`That battle can’t be shown: ${shown.reason}.`, 'info', 6000);
      setTimeout(() => game.backToCity(), 3000);
    }
    // It plays once the town is drawn (a big one takes a while on a slow device), not before.
    game.setSpeed(0);
    game.viewerStart = 3;
    game.setCamera('overview', true);
    history.replaceState(null, '', location.pathname);
  } else if (visited) {
    game.readOnly = true;
    game.setSpeed(0);
    game.setCamera('overview', true);
    game.toast(
      `Visiting ${world.stats.cityName}: look round as much as you like; nothing here can be changed.`,
      'info',
      8000,
    );
  } else if (joined) {
    game.attachNet(joined.mp);
    game.setCamera('overview', true);
    game.toast(`You joined ${world.stats.cityName}.`, 'ok', 5000);
    history.replaceState(null, '', location.pathname);
  } else if (menu || joinError) {
    game.mode = 'menu';
    game.openScreen('main');
    if (params.get('screen') === 'scenarios') game.openScreen('scenarios');
    // A region's invite link: the friends screen, to choose the city to bring (M32).
    const invited = params.get('region') ? parseInvite(params.get('region')!) : null;
    if (invited && !inviteProblem(invited)) {
      game.pendingRegion = formatInvite(invited);
      game.openScreen('friends');
      history.replaceState(null, '', location.pathname);
    }
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
    // Back from a battle this browser doesn't keep (M35).
    if (params.get('noreplay') === '1')
      game.toast('That battle’s replay isn’t kept in this browser.', 'info', 6000);
    // Founded or opened to share with friends (the lobby's Host buttons, M30).
    const host = params.get('host');
    if (host === 'online' || host === 'p2p') void game.hostRoom(host);
    // Shared regions (M32): start one with this city, join one, or rejoin the one it stands in.
    const newRegion = params.get('newregion');
    const regionCode = params.get('region');
    // The region a loaded city's own save names, if this browser holds its secret (F6).
    const meta = loadSlot && save ? save.meta.region : undefined;
    let mine = meta && regionRejoin(meta, null);
    if (mine) game.boundRegion = meta!;
    // A region that ran in this browser closed when the page did (F10): say so rather than look for it.
    if (mine && meta?.hosted && codeKind(parseInvite(mine.invite)?.code ?? '') === 'p2p') {
      game.toast(
        `Your region ${mine.invite} ran in this browser and closed when you left it. Start a new one from the Region panel (Shift+N).`,
        'info',
        9000,
      );
      game.boundRegion = null;
      mine = null;
    }
    // Hosting wins: a city opened to share in a room isn't also brought into its region (both at once
    // would run its region's news outside the room's order).
    if (host === 'online' || host === 'p2p') {
      if (mine) game.toast('This city stays out of its region while it’s shared in a room.', 'info', 6000);
    } else if (newRegion === 'online' || newRegion === 'p2p')
      void game.startRegion(
        newRegion,
        params.get('rname')?.trim().slice(0, 40) || `${world.stats.cityName} and friends`,
        // War in the region (M34), as its host chose on the new-city screen.
        params.get('rwar') === '1'
          ? {
              war: true,
              scale: (WAR_SCALES as readonly string[]).includes(params.get('rscale') ?? '')
                ? (params.get('rscale') as WarScale)
                : 'skirmish',
            }
          : undefined,
      );
    else if (regionCode) void game.joinRegion(regionCode, regionRejoin(meta, regionCode)?.rejoin ?? null);
    else if (mine) void game.joinRegion(mine.invite, mine.rejoin);
  }
  // A first launch picks graphics to suit the device from its first few seconds: on the main menu, and
  // in a room or a visit an invite link opened straight into (F12).
  if (!game.settings.graphicsChecked && (game.mode === 'menu' || joined || visited))
    game.startGraphicsCheck();
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
