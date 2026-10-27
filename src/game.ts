import type { RegionWarRules } from './data/war';
import { MapEditor } from './client/editor';
import type { SimClient } from './client/simClient';
import type { ClientWorld } from './client/world';
import type { GameRenderer } from './render/renderer';
import type { CameraPresetName, CameraPose } from './render/camera';
import type { Command, CommandResult } from './sim/commands';
import type { WorkerPerf } from './sim/protocol';
import { MONTH_NAMES, SPEED_TICKS_PER_SECOND, dateOf, type Speed } from './sim/time';
import { ToolManager } from './tools/manager';
import { CIVIC } from './data/civic';
import { MILESTONES } from './data/progression';
import { ACHIEVEMENTS } from './data/achievements';
import type { Advice } from './sim/systems/advisors';
import { RegionView } from './client/regionView';
import { DistrictView } from './client/districtView';
import { OverlayController } from './client/overlay';
import { StreetNames } from './client/names';
import { StreetLabels } from './client/labels';
import type { ToolHint, ToolQuestion } from './tools/tool';
import type { AudioEngine } from './audio/engine';
import { ambientScene } from './audio/scene';
import { writeSlot } from './client/saves';
import { loadWarModels } from './client/models';
import { formatNumber } from './ui/hooks';
import {
  AwayBattles,
  battlePosted,
  keepBattle,
  keepTown,
  loadBattle,
  loadTown,
  unpostedBattles,
  type BattleRecord,
} from './client/battles';
import { awayCaps, BATTLE_BUSY, BATTLE_TAKEN } from './sim/systems/raids';
import type { BattleInput } from './sim/battle/types';
import type { BattleFrame } from './sim/battle/types';
import { recordWin } from './client/scenarioProgress';
import { AppUpdates } from './client/pwa';
import type { AppInstall } from './client/install';
import { SaveKeeper, type PersistentStorage } from './client/keepSaves';
import { GRAPHICS_PRESETS, GraphicsCheck, gpuName, type CheckResult } from './client/graphicsCheck';
import { DEFAULT_FOV, type PhotoView } from './render/renderer';
import { TUTORIAL, pickTip, type Tip } from './client/tutorial';
import { barsClassWith, widthClass } from './ui/layout';
import { Multiplayer, relayUrl, signalling } from './net/multiplayer';
import {
  RegionLink,
  raidVerdict,
  type BattleAnswer,
  type BattleMeta,
  type CityPort,
  type RegionLinkOptions,
} from './net/regionLink';
import { P2PHost, p2pConnect } from './net/p2p';
import { webSocketLink, type Link } from './net/link';
import { RegionRoom, MemoryRegionStore } from '../relay/region';
import { codeKind, formatInvite, inviteProblem, makeCode, makeKey, parseInvite } from '../relay/protocol';
import type { RegionReport } from './sim/systems/region';
import { forgetRegionSecret, keepRegionSecret } from './client/profile';
import type { RegionBinding } from './sim/save';
import { commandShape, shapesMeet } from './net/shapes';
import { PLAYER_COLORS, type Shape } from '../relay/protocol';
import type { PresenceMark } from './render/presence';
import { loadProfile, storedProfile } from './client/profile';
import {
  DRAW_DISTANCE_PARAMS,
  QUALITY_PARAMS,
  loadSettings,
  saveSettings,
  type Settings,
} from './client/settings';
import { typingIn } from './client/keys';

type Listener = () => void;

/** What photo mode's camera can ride with (M16). */
export interface FollowTarget {
  kind: 'car' | 'walker' | 'bus' | 'vehicle';
  id: number;
}

/** Photo mode (M16): the view (lens, hour, field of view) plus the panel's own state. */
export interface PhotoState extends PhotoView {
  /** The panel is showing (H hides it for a clear view). */
  panel: boolean;
  /** The city keeps running behind the camera. */
  running: boolean;
  /** Saved photos are 1× or 2× the screen's resolution. */
  scale: 1 | 2;
  follow: FollowTarget | null;
  /** Waiting for a click on something to follow. */
  picking: boolean;
  /** The last photo saved (size), or why following stopped. */
  saved: { width: number; height: number; bytes: number } | null;
  note: string | null;
}

let uiScale = 1;

/** The window's width in scaled rem (pixels over 16 times the interface scale). */
export function uiRem(): number {
  return typeof window === 'undefined' ? 120 : window.innerWidth / (16 * uiScale);
}

/**
 * Size class of the interface, in scaled rem, for layouts that tighten on narrow screens or at large
 * interface sizes (see `#ui[data-width]` in main.css).
 */
function layoutUi(): void {
  const ui = document.getElementById('ui');
  if (!ui) return;
  const rem = window.innerWidth / (16 * uiScale);
  ui.dataset.width = widthClass(rem);
  ui.dataset.bars = barsClassWith(rem, extraTools);
}

/** Toolbar buttons beyond a peaceful city's (M34: the Military category with war on). */
let extraTools = 0;

/** Lay the bars out again for a toolbar with `n` extra buttons. */
export function setExtraTools(n: number): void {
  if (n === extraTools) return;
  extraTools = n;
  layoutUi();
}
if (typeof window !== 'undefined') window.addEventListener('resize', layoutUi);

/** Interface size: the UI root scales with a CSS variable (see main.css). */
export function applyUiScale(scale: number): void {
  uiScale = scale;
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  layoutUi();
}

/** Full-screen menus: the main menu and new-game screen, the pause menu and the screens inside it. */
export type Screen =
  | 'main'
  | 'newGame'
  | 'scenarios'
  | 'pause'
  | 'save'
  | 'load'
  | 'settings'
  | 'maps'
  /** Play with friends (M30). */
  | 'friends';

/** Something the player has clicked on and is inspecting. */
export interface Selection {
  /** `stop`: a bus or tram stop (M20). */
  kind: 'building' | 'civic' | 'car' | 'walker' | 'road' | 'stop';
  id: number;
}

/** An entry in the notification log. */
export interface Notice {
  id: number;
  kind: string;
  text: string;
  tone: 'info' | 'ok' | 'bad';
  at?: { x: number; z: number };
  count: number;
  /** performance.now() of the latest occurrence, and the sim tick. */
  time: number;
  tick: number;
}

/** Main-thread game glue: owns the client, mirror and renderer; the UI and tools talk to this. */
export class Game {
  speed: Speed = 1;
  perf: WorkerPerf = { tickMsAvg: 0, tickMsMax: 0, ticksPerSecond: 0, droppedTicks: 0 };
  fps = 0;
  frameMs = 0;
  /** Frame interval and work in ms, in pairs, while a benchmark records them (test API `recordFrames`). */
  frameSamples: number[] | null = null;
  debugOpen = false;
  hint: ToolHint | null = null;
  /** A tool's question before it acts (P2), shown at the pointer with its two buttons. */
  question: ToolQuestion | null = null;
  /** Open side panel (budget, and later data maps, advisors...). */
  panel:
    | 'budget'
    | 'advisors'
    | 'notifications'
    | 'city'
    | 'history'
    | 'goals'
    | 'districts'
    | 'region'
    /** The shared city's room (M30). */
    | 'room'
    /** The map editor's playability check (M24). */
    | 'editorCheck'
    /** The war room (M34), with a military HQ. */
    | 'war'
    | null = null;
  /** A scenario's brief, shown when it begins (M18). */
  scenarioBrief = false;
  /** How the scenario ended, shown until the player carries on. */
  scenarioEnd: { won: boolean; stars: number; reason: string; months: number } | null = null;
  /** Milestone being celebrated (index into MILESTONES), if any. */
  celebration: number | null = null;
  private celebrationTimer: ReturnType<typeof setTimeout> | null = null;
  /** Street and neighbourhood names, and their labels on the map. */
  readonly names: StreetNames;
  readonly labels: StreetLabels;
  /** Latest advice from every advisor (refreshed every couple of seconds). */
  advice: Advice[] = [];
  /** Currently inspected building. */
  selected: Selection | null = null;
  toasts: { id: number; text: string; tone: 'info' | 'ok' | 'bad'; at?: { x: number; z: number } }[] = [];
  /** Notification log, newest first (prioritised when shown). */
  notifications: Notice[] = [];
  private noticeId = 1;
  private toastId = 1;
  audio: AudioEngine | null = null;
  /** Random disasters on (a per-city option; the disasters menu toggles it). */
  randomDisasters: boolean;
  /** Player settings (volumes now; graphics and controls with the game shell). */
  settings: Settings = loadSettings();
  private ambientAt = 0;
  /** When the forces' colour was last looked up (M34). */
  private ownerAt = -Infinity;
  /** 'menu': the main menu over a backdrop map; 'play': a city. */
  /** The main menu, a city, or the map editor (M24). */
  mode: 'menu' | 'play' | 'editor' = 'play';
  /** The map editor, while it's open (M24). */
  editor: MapEditor | null = null;
  /** Open menu screens, innermost last (the pause menu, then save/load/settings inside it). */
  screens: Screen[] = [];
  private speedBeforeMenu: Speed | null = null;
  /** Save slot this city was loaded from or last saved to, and when (performance.now()). */
  slot: string | null = null;
  lastSavedAt = 0;
  saving = false;
  /** Contextual tip on screen, if any. */
  tip: Tip | null = null;
  readonly tools: ToolManager;
  readonly overlay: OverlayController;
  /** Districts on the map while the district tool or panel is open (M21). */
  readonly districts: DistrictView;
  readonly regionView: RegionView;
  /** New versions of the app (the service worker, M15). */
  readonly updates = new AppUpdates(() => this.notify());
  /** Asking the browser to keep the saves (persistent storage). */
  readonly keeper = new SaveKeeper((navigator as { storage?: PersistentStorage }).storage, () =>
    this.notify(),
  );
  /** Saving the city before switching to a new version. */
  updating = false;
  /** Photo mode, while it's on (M16). */
  photo: PhotoState | null = null;
  private photoSpeed: Speed = 1;
  private followLast: { x: number; z: number; dx: number; dz: number; yaw: number } | null = null;
  /** The graphics check in progress (first launch, or Settings → Check again), and its last answer. */
  graphicsCheck: GraphicsCheck | null = null;
  graphicsResult: CheckResult | null = null;
  private listeners = new Set<Listener>();
  private lastFrameAt = 0;

  constructor(
    readonly client: SimClient,
    readonly world: ClientWorld,
    readonly renderer: GameRenderer,
    /** Installing the game as an app from the main menu (made before the game, see main.ts). */
    readonly install: AppInstall,
  ) {
    install.onChange = () => this.notify();
    client.onFrame((diff, perf, speed) => {
      this.world.applyFrame(diff);
      // A city with war on (M34) has the Military category in its toolbar, and the war models.
      const war = !!diff.stats.war && !this.inMenu();
      setExtraTools(war ? 1 : 0);
      // The main menu's demo town runs quietly.
      if (diff.events && !this.inMenu()) this.onEvents(diff.events);
      if (diff.battle && !this.inMenu()) this.battleSounds(diff.battle);
      // Forces arrived at a neighbour's town (M35): this page fights their battles. In a shared city
      // only the host's page does (a second report would be turned away anyway).
      const exps = diff.stats.war?.expeditions;
      if (exps?.length && !this.inMenu() && !this.readOnly && (!this.net || this.net.session.isHost))
        this.away.check(exps);
      const sel = this.selected;
      if (sel?.kind === 'building' && diff.buildings) {
        if (diff.buildings.removed.includes(sel.id)) this.select(null);
        else if (diff.buildings.upserts.some((b) => b.id === sel.id)) this.select(sel);
      }
      if (sel?.kind === 'civic' && diff.civics?.removed.includes(sel.id)) this.select(null);
      this.perf = perf;
      // Not `this.speed = speed`: frames queued before a speed change still carry the old one, and
      // would flip the speed buttons back for a moment. Only setSpeed() changes the speed.
      // Keep the smooth display clock close to the authoritative tick.
      if (Math.abs(this.world.displayTick - diff.tick) > 30 || speed === 0)
        this.world.displayTick = diff.tick;
      this.notify();
    });
    this.randomDisasters = world.options.disasters;
    renderer.disasters.onImpact = () => this.audio?.play('boom');
    // Thunder follows the flash by the time sound takes to cover the distance (M22).
    renderer.weather.onStrike = (distance) =>
      setTimeout(() => this.audio?.play('thunder'), Math.min(4000, (distance / 343) * 1000));
    this.names = new StreetNames(world);
    this.labels = new StreetLabels(this);
    this.tools = new ToolManager(this);
    this.overlay = new OverlayController(this);
    this.districts = new DistrictView(this);
    this.regionView = new RegionView(this);
    renderer.controller.focus = () => {
      const hw = this.world.gen.params.highway;
      return { x: 260, z: hw.connectZ };
    };
    this.applySettings();
    void this.refreshAdvice();
    setInterval(() => {
      void this.refreshAdvice();
      this.checkGuidance();
    }, 2000);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  notify(): void {
    this.listeners.forEach((l) => l());
  }

  dispatch(cmd: Command): Promise<CommandResult> {
    if (this.readOnly)
      return Promise.resolve({
        ok: false,
        reason: 'You’re visiting a neighbour’s city: nothing can be changed here',
      });
    // In a shared city the room orders every command, so all the players' games apply it alike;
    // until it comes back its outline shows as pending (M31).
    if (!this.net) return this.client.command(cmd);
    const shape = commandShape(cmd);
    const key = this.pendingKey++;
    if (shape) this.pending.set(key, shape);
    return this.net.session
      .command(cmd)
      .then((r) => {
        // Two players on the same spot: the room's order decided, so say who got there first.
        if (r.ok || !shape) return r;
        const t = performance.now();
        const rival = this.recentOthers.find((o) => t - o.at < 6000 && shapesMeet(o.shape, shape));
        const who = rival && this.net?.session.players.find((p) => p.id === rival.by)?.name;
        return who ? { ...r, reason: `${r.reason} (${who} got there first)` } : r;
      })
      .finally(() => this.pending.delete(key));
  }

  /** The others' latest commands and where they acted, to explain a clash (M31). */
  private recentOthers: { by: number; shape: Shape; at: number }[] = [];

  /** This player's commands waiting for the room, as outlines (M31). */
  private pending = new Map<number, Shape>();
  private pendingKey = 1;
  /** What this player last told the others about where they are (M31). */
  private here = {
    at: null as [number, number] | null,
    ghost: null as Shape | null,
    ghostAt: 0,
    sentAt: 0,
    camAt: 0,
    last: '',
  };

  /** The pointer moved over the map: where it is on the ground, for the others (M31). */
  pointerAt(clientX: number, clientY: number): void {
    if (!this.net) return;
    const g = this.renderer.controller.screenToGround(clientX, clientY);
    this.here.at = g ? [Math.round(g.x), Math.round(g.z)] : null;
  }

  /**
   * Ready a ping by touch (F11): the next tap on the map points the others there. The room panel
   * closes so the map can be tapped (on a phone it covers most of it).
   */
  armPing(): void {
    if (!this.net) return;
    if (this.panel === 'room') this.openPanel('room');
    if (this.tools.activeId !== 'ping') this.tools.ping.back = this.tools.activeId;
    this.tools.use('ping');
    this.toast('Tap the map where you want the others to look.', 'info', 4000);
  }

  /** Point the others at a spot ("look here"). */
  pingAt(at: { x: number; z: number }): void {
    const mp = this.net;
    if (!mp) return;
    const p: [number, number] = [Math.round(at.x), Math.round(at.z)];
    mp.session.ping(p);
    const me = mp.session.me;
    this.renderer.presence.ping(p, PLAYER_COLORS[me?.color ?? 0], 'You', performance.now());
  }

  /** Each frame in a shared city: tell the others where this player is, and show where they are. */
  private presenceFrame(now: number): void {
    const mp = this.net;
    const r = this.renderer;
    const w = r.canvas.clientWidth || window.innerWidth;
    const h = r.canvas.clientHeight || window.innerHeight;
    if (!mp) {
      r.presence.update([], r.camera, w, h, now);
      return;
    }
    const s = mp.session;
    const here = this.here;
    const tool = this.tools.activeId;
    if (now - here.sentAt > 250) {
      const ghost = tool !== 'select' && here.ghost && now - here.ghostAt < 1500 ? here.ghost : undefined;
      const g = r.controller.goal;
      const camDue = now - here.camAt > 600;
      const msg = { at: here.at, tool, ...(ghost ? { ghost } : {}) };
      const key = JSON.stringify(msg);
      if (key !== here.last || camDue) {
        const cam: [number, number, number, number, number] = [
          Math.round(g.x),
          Math.round(g.z),
          Math.round(g.distance),
          Math.round(g.yaw * 1000) / 1000,
          Math.round(g.tilt * 1000) / 1000,
        ];
        s.sendPresence(camDue ? { ...msg, cam } : msg);
        here.last = key;
        here.sentAt = now;
        if (camDue) here.camAt = now;
      }
    }
    const marks: PresenceMark[] = [];
    const t = performance.now();
    for (const p of s.players) {
      if (p.id === s.you || !p.online) continue;
      const pr = s.presence.get(p.id);
      if (!pr || t - pr.heard > 30_000) continue;
      marks.push({
        key: p.id,
        color: PLAYER_COLORS[p.color],
        name: p.name,
        at: pr.at,
        ...(pr.ghost ? { ghost: pr.ghost } : {}),
      });
    }
    const mine = PLAYER_COLORS[s.me?.color ?? 0];
    for (const [k, shape] of this.pending)
      marks.push({ key: -k, color: mine, name: null, at: null, ghost: shape, pending: true });
    r.presence.update(marks, r.camera, w, h, now);
    // Following someone: ride along with their camera, until this player moves theirs in any way (a
    // drag, the wheel, a pinch, the keys).
    if (this.following && r.controller.userMoves !== this.followMoves) this.following = 0;
    if (this.following) {
      const f = s.presence.get(this.following)?.cam;
      if (f) r.controller.setPose({ x: f[0], z: f[1], distance: f[2], yaw: f[3], tilt: f[4] }, false);
    }
  }

  private pingKey: ((e: KeyboardEvent) => void) | null = null;

  /** The room's chat, latest last (M31). */
  chatLog: { name: string; color: number; text: string }[] = [];

  /** The player whose camera this one rides along with (M31), or 0. */
  following = 0;

  /** The camera's count of the player's own moves when following began. */
  private followMoves = 0;

  follow(player: number): void {
    this.following = this.following === player ? 0 : player;
    this.followMoves = this.renderer.controller.userMoves;
    const name = this.net?.session.players.find((p) => p.id === player)?.name;
    if (this.following && name)
      this.toast(`Following ${name}'s view. Move the camera to stop.`, 'info', 3500);
    this.notify();
  }

  // ---------------------------------------------------------------- shared cities (phase 4)

  /** The room this city is shared in, if it is (M30). */
  net: Multiplayer | null = null;
  /** The speed the worker paces a shared city at (the room's), as last told. */
  private workerSpeed: Speed | -1 = -1;
  /** The shared region this city stands in, if it does (M32), and its code. */
  region: RegionLink | null = null;
  regionCode: string | null = null;
  /** A peer-to-peer region's key (F2): its invite carries it, so the code alone finds nothing. */
  regionKey: string | null = null;

  /** What friends type or follow to bring their cities in: the code, and the key for one in a browser. */
  get regionInvite(): string | null {
    return this.regionCode ? formatInvite({ code: this.regionCode, key: this.regionKey }) : null;
  }
  private regionHost: P2PHost | null = null;
  /** Looking round another player's city in the region: nothing can be changed (M32). */
  readOnly = false;
  /** Battles away from the city (M35): fought by this page when the city's forces arrive. */
  readonly away = new AwayBattles({
    query: (q) => this.client.query(q),
    report: async (expedition, result) =>
      (await this.dispatch({ type: 'battleReport', expedition, result })).ok,
    tick: () => this.world.stats.tick,
    changed: () => this.notify(),
    fetchSave: (slot) =>
      this.region ? this.region.fetchSave(slot) : Promise.reject(new Error('Not in a region')),
    // Out of touch: waits (its region may come back); in no region at all now: nothing will answer.
    postBattle: (slot, input, away) =>
      this.region
        ? this.region.sendBattle(slot, input, away)
        : Promise.resolve(
            this.boundRegion ? null : { kept: false, reason: 'the city is in no region now', again: false },
          ),
    // As the region room would decide it (it has the last word, before the city takes anything).
    mayStrike: (slot) => {
      const link = this.region;
      const c = link?.view?.cities.find((x) => x.slot === slot);
      if (!link?.view || !c) return null;
      const v = raidVerdict(link.view, link.slot, c);
      return v === 'neutral'
        ? `${c.name} is neutral`
        : v === 'new'
          ? `${c.name} is too young or small to raid, unless it strikes first`
          : v === 'spent'
            ? `${c.name} has taken the region’s raids for today`
            : v === 'absent'
              ? `${c.name}’s player isn’t here, and this region keeps nothing for them`
              : null;
    },
    recall: async (expedition, why) => {
      await this.dispatch({ type: 'recallForce', expedition });
      this.notice(`recalled:${expedition}`, `The force turns for home: ${why}.`, 'info');
    },
    settle: async (expedition, on) => (await this.dispatch({ type: 'battleSettling', expedition, on })).ok,
  });
  /** The battle viewer starts its battle this many frames after the town is first drawn (M35). */
  viewerStart = 0;
  /** Watching a battle away from the city (M35, `?battle=`): its record and the slot to go back to. */
  viewing: { record: BattleRecord; back: string | null } | null = null;
  /** The region this city stands in, kept in its saves (F6); null when it stands in none. */
  boundRegion: RegionBinding | null = null;

  /** What a region link needs from this city. */
  private cityPort(): CityPort {
    return {
      command: (cmd) => this.client.command(cmd),
      report: () => this.client.query<RegionReport>({ type: 'regionReport' }),
      save: () => this.client.save(),
      cityName: () => this.world.stats.cityName,
      thumb: () => this.thumbnail(),
      battle: (input, meta) => this.takeBattle(input, meta),
    };
  }

  /**
   * A battle a friend's city fought against this one (M35): the city as it stands is kept as the
   * replay's backdrop, then its own sim takes the battle: as it happens while the player is here,
   * all at once if it was fought while they were away (the report then waits in the war room).
   * The city is saved before the region is told it has the battle, so closing the page never
   * loses one; a battle offered again (that word was lost) is known and only acknowledged.
   */
  private async takeBattle(input: BattleInput, meta: BattleMeta): Promise<BattleAnswer> {
    if (this.readOnly) return 'later';
    // Only from a city of the region, and named as the region names it.
    const sender = this.region?.view?.cities.find((c) => c.slot === meta.from);
    if (!sender || typeof input !== 'object' || !input?.attacker) return 'refused';
    input = { ...input, attacker: { ...input.attacker, name: sender.name } };
    // Made while the player was away: half the damage, kept that way for the replay (M36).
    if (meta.away && typeof input.caps === 'object' && input.caps) input = awayCaps(input);
    const id = `def-${input.id}`.slice(0, 60);
    // Who sent it (a newcomer or a neutral city refuses friends' raids), and whether the player was
    // away when it came: then it does half the damage (M36).
    const cmd = {
      type: 'battleResolve',
      input,
      mode: meta.late ? 'instant' : 'watch',
      replay: id,
      from: meta.from,
      ...(meta.away ? { away: true } : {}),
    } as const;
    const pre = await this.client.preview(cmd);
    if (!pre.ok) {
      if (pre.reason === BATTLE_BUSY) return 'later';
      if (pre.reason === BATTLE_TAKEN)
        return (await this.saveTo('auto', 'Autosave', true)) ? 'taken' : 'later';
      return 'refused';
    }
    try {
      const backdrop = await this.client.save();
      await keepTown(`replay:${id}`, backdrop);
      await keepBattle({
        id,
        city: this.world.stats.cityName,
        other: input.attacker.name,
        tick: this.world.stats.tick,
        input,
        townKey: `replay:${id}`,
        savedAt: new Date().toISOString(),
      });
    } catch {
      /* the replay is a nicety: the battle still counts */
    }
    const r = await this.client.command(cmd);
    if (!r.ok) return r.reason === BATTLE_BUSY ? 'later' : 'refused';
    if (meta.late)
      this.notice(
        `late:${id}`,
        `While you were away, ${input.attacker.name} raided the city${meta.away ? ' (with you away, it did half the damage it could)' : ''}. The war room has the report, and you can watch it.`,
        'bad',
      );
    return (await this.saveTo('auto', 'Autosave', true)) ? 'taken' : 'later';
  }

  /** Battles against friends' cities the region hasn't confirmed it keeps: sent again (M35). */
  private async repostBattles(): Promise<void> {
    const link = this.region;
    if (!link) return;
    for (const r of await unpostedBattles()) if (r.postTo !== undefined) link.sendBattle(r.postTo, r.input);
  }

  /** A small picture of the city as the camera sees it, for the region view. */
  thumbnail(): string | null {
    try {
      this.renderer.frame(0);
      const src = this.renderer.canvas;
      const c = document.createElement('canvas');
      c.width = 192;
      c.height = 120;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      const k = Math.max(c.width / src.width, c.height / src.height);
      const w = src.width * k;
      const h = src.height * k;
      ctx.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
      return c.toDataURL('image/jpeg', 0.6);
    } catch {
      return null;
    }
  }

  /** Start a shared region with this city in it (M32), online or from this browser. */
  async startRegion(kind: 'online' | 'p2p', name: string, rules?: RegionWarRules): Promise<boolean> {
    if (this.region || this.net || this.readOnly) return false;
    const code = makeCode(kind);
    const key = kind === 'p2p' ? makeKey() : null;
    try {
      let connect: () => Promise<Link>;
      if (kind === 'online') {
        const url = relayUrl();
        if (!url) throw new Error("Online regions aren't set up yet: start one on this computer instead");
        connect = () => webSocketLink(`${url}/region/${code}?create=1`);
      } else {
        const hub = new RegionRoom(code, 'p2p', new MemoryRegionStore(), { now: () => performance.now() });
        this.regionHost = new P2PHost(code, key!, signalling(), null, hub);
        await this.regionHost.listen();
        const host = this.regionHost;
        connect = () => host.connectSelf();
      }
      await this.attachRegion(
        code,
        key,
        connect,
        { create: { name, ...(rules?.war ? { rules } : {}) } },
        kind === 'p2p',
      );
      this.toast(
        `Your region is open: code ${formatInvite({ code, key })}. Friends join it with their own cities.`,
        'ok',
        8000,
      );
      return true;
    } catch (err) {
      this.leaveRegion(false);
      this.toast(err instanceof Error ? err.message : String(err), 'bad', 8000);
      return false;
    }
  }

  /**
   * Bring this city into a shared region by its invite: the code, and the key for one in a browser
   * (M32, F2); as its old self with `rejoin` (see `regionRejoin`, F6), else as a new city.
   */
  async joinRegion(invite: string, rejoin: { slot: number; secret: string } | null = null): Promise<boolean> {
    if (this.region || this.net || this.readOnly) return false;
    const inv = parseInvite(invite);
    const why = inviteProblem(inv);
    if (why) {
      this.toast(why.replace('a room', 'a region'), 'bad', 8000);
      return false;
    }
    const { code, key } = inv!;
    const url = relayUrl();
    const connect: () => Promise<Link> =
      codeKind(code) === 'online'
        ? url
          ? () => webSocketLink(`${url}/region/${code}`)
          : () => Promise.reject(new Error("Online regions aren't set up yet"))
        : () => p2pConnect(code, key!, signalling());
    try {
      // A region in its host's browser is gone while they aren't playing: stop after a few tries (F10).
      await this.attachRegion(code, key, connect, {
        ...(rejoin ? { rejoin } : {}),
        ...(codeKind(code) === 'p2p' ? { giveUpAfter: 3 } : {}),
      });
      this.toast(`${this.world.stats.cityName} joined the region.`, 'ok', 5000);
      return true;
    } catch (err) {
      this.leaveRegion(false);
      this.toast(err instanceof Error ? err.message : String(err), 'bad', 8000);
      return false;
    }
  }

  private async attachRegion(
    code: string,
    key: string | null,
    connect: () => Promise<Link>,
    extra: Partial<RegionLinkOptions>,
    /** The region runs in this browser. */
    hosted = false,
  ): Promise<void> {
    const profile = loadProfile();
    const link = new RegionLink(this.cityPort(), connect, {
      mayor: profile.name,
      color: profile.color,
      ...extra,
    });
    this.region = link;
    this.regionCode = code;
    this.regionKey = key;
    link.onNotice = (t) => this.toast(t, 'info', 4500);
    // Battles between friends (M35): sent again until the region keeps them; a friend's force on
    // its way is announced, with the siren.
    link.onBattleKept = (id) => void battlePosted(id);
    // Turned away (M36): a battle reposted from before is not sent again; a force's own battle is
    // its page's to settle (forgotten, fought again, or asked again later).
    link.onBattleRefused = (id) =>
      void loadBattle(id).then((r) => (r && r.expedition === undefined ? battlePosted(id) : undefined));
    link.onIncoming = ({ from, units, hours }) => {
      const who = link.view?.cities.find((c) => c.slot === from)?.name ?? 'A neighbour';
      this.notice(
        `incoming:${from}`,
        `Sirens! ${who} is sending ${units} units against the city: about ${hours} hours of their time away.`,
        'bad',
      );
      this.audio?.play('raid');
    };
    let welcomed = false;
    // Until it's in, a failure is the caller's to report (one toast, not two).
    let started = false;
    link.onChange = () => {
      // The city's place in the region travels with the city, in its saves (F6).
      if (link.slot && link.secret) {
        keepRegionSecret(code, link.slot, link.secret);
        this.boundRegion = {
          invite: formatInvite({ code, key }),
          slot: link.slot,
          ...(hosted ? { hosted } : {}),
        };
      }
      // Each time it's in (again), battles the region hasn't confirmed are sent again.
      if (link.state === 'in' && !welcomed) {
        welcomed = true;
        void this.repostBattles();
      } else if (link.state !== 'in') welcomed = false;
      if (link.state === 'closed' && this.region === link) {
        if (link.error && started) this.toast(link.error, 'bad', 8000);
        // The region shut for good (its host left it): the city's saves no longer name it (F10).
        if (link.gone) this.forgetRegion();
        this.leaveRegion(false);
      }
      this.notify();
    };
    await link.start();
    started = true;
    this.notify();
  }

  /** The city no longer stands in its region: drop the binding its saves carry, and its secret (F6). */
  private forgetRegion(): void {
    const bound = this.boundRegion;
    const code = bound ? parseInvite(bound.invite)?.code : null;
    if (bound && code) forgetRegionSecret(code, bound.slot);
    this.boundRegion = null;
  }

  leaveRegion(say = true): void {
    const link = this.region;
    this.region = null;
    this.regionCode = null;
    this.regionKey = null;
    link?.leave();
    // A region in this browser closes with it, and its cities are told (F10).
    this.regionHost?.close(
      `${loadProfile().name}’s region closed: it ran in their browser. Your city keeps its neighbours as they last were.`,
    );
    this.regionHost = null;
    if (say) {
      // Left for good: the city's saves no longer name the region.
      this.forgetRegion();
      this.toast('Your city left the region: its neighbours stay as they last were.', 'info', 6000);
    }
    this.notify();
  }
  /**
   * A new city founded from the friends screen is shared at once, online or from this browser; or it
   * goes into a region (`newregion=…` or `region=CODE`). Both last only while the friends and new-city
   * screens are open (F4).
   */
  hostKind: 'online' | 'p2p' | null = null;
  regionParam: string | null = null;

  forgetFriendsChoice(): void {
    this.hostKind = null;
    this.regionParam = null;
  }
  /** A region's invite link opened on the main menu: its code, for the friends screen (M32). */
  pendingRegion: string | null = null;

  /** Share this city: make a room online or in this browser; resolves once it's open. */
  async hostRoom(kind: 'online' | 'p2p'): Promise<boolean> {
    if (this.net) return true;
    // A visit isn't this player's city to share (F5).
    if (this.readOnly) return false;
    // A city in a shared region is played alone, at its own speed (M32): not also in a room.
    if (this.region) {
      this.toast(
        'A city in a shared region can’t also be shared in a room: leave the region first.',
        'bad',
        6000,
      );
      return false;
    }
    try {
      const mp = await Multiplayer.host(kind, this.client, loadProfile(), this.world.stats.cityName);
      this.attachNet(mp);
      await mp.session.start();
      this.toast(
        `Your city is shared: room ${mp.code}. Send friends the invite link from the room button.`,
        'ok',
        8000,
      );
      return true;
    } catch (err) {
      this.leaveRoom(false);
      this.toast(err instanceof Error ? err.message : String(err), 'bad', 8000);
      return false;
    }
  }

  attachNet(mp: Multiplayer): void {
    this.net = mp;
    this.workerSpeed = -1;
    this.client.onPreview = (cmd) => {
      const shape = commandShape(cmd);
      if (shape) {
        this.here.ghost = shape;
        this.here.ghostAt = performance.now();
      }
    };
    if (!this.pingKey) {
      // Shift+G over the map: "look here" for the others.
      this.pingKey = (e: KeyboardEvent) => {
        if (e.code !== 'KeyG' || !e.shiftKey || e.metaKey || e.ctrlKey || !this.net || !this.here.at) return;
        if (typingIn(e)) return;
        this.pingAt({ x: this.here.at[0], z: this.here.at[1] });
      };
      window.addEventListener('keydown', this.pingKey);
    }
    mp.session.onApplied = (a) => {
      if (a.ev.kind !== 'cmd' || a.ev.by === mp.session.you || !a.result?.ok) return;
      let shape: Shape | null = null;
      try {
        shape = commandShape(a.ev.cmd);
      } catch {
        return;
      }
      if (shape)
        this.recentOthers = [...this.recentOthers, { by: a.ev.by, shape, at: performance.now() }].slice(-12);
    };
    mp.session.onPing = (from, at) => {
      const p = mp.session.players.find((x) => x.id === from);
      if (!p) return;
      this.renderer.presence.ping(at, PLAYER_COLORS[p.color], p.name, performance.now());
      this.audio?.play('alert');
      this.toast(`${p.name}: look here`, 'info', 4000, { x: at[0], z: at[1] });
    };
    // Menus and photo mode don't pause a shared city; it runs at the room's speed.
    this.speedBeforeMenu = null;
    mp.session.onNotice = (n) => {
      if (n.kind === 'chat') {
        const who = mp.session.players.find((p) => p.id === n.from);
        this.chatLog = [
          ...this.chatLog,
          { name: who?.name ?? 'Someone', color: who?.color ?? 0, text: n.text },
        ].slice(-40);
        if (this.panel !== 'room') this.toast(`${who?.name ?? 'Someone'}: ${n.text}`, 'info', 6000);
      } else this.toast(n.text, n.kind === 'warn' ? 'bad' : 'info', 4500);
    };
    mp.session.onChange = ((prev) => () => {
      prev?.();
      const room = mp.session.room;
      if (room && room.speed !== this.speed) this.speed = room.speed;
      // The worker paces the city at the room's speed between the pacer's clock messages.
      if (room && room.speed !== this.workerSpeed) {
        this.workerSpeed = room.speed;
        this.client.setSpeed(room.speed);
      }
      if (mp.session.state === 'closed' && this.net === mp) {
        if (mp.session.error) this.toast(mp.session.error, 'bad', 8000);
        this.leaveRoom(false);
      }
      this.notify();
    })(mp.session.onChange);
    this.notify();
  }

  /** Stop sharing (the others carry on, unless this browser was the room). */
  leaveRoom(say = true): void {
    const mp = this.net;
    if (!mp) return;
    this.net = null;
    mp.leave();
    this.client.setSpeed(0);
    this.speed = 0;
    if (say)
      this.toast('You left the room. This copy of the city is yours to play on your own.', 'info', 6000);
    this.notify();
  }

  openPanel(p: Game['panel']): void {
    this.panel = this.panel === p ? null : p;
    this.notify();
  }

  /**
   * Open the war room (M34) without closing it if it's open; on a narrow window the inspector
   * (which covers it) steps aside.
   */
  openWarRoom(): void {
    if (this.panel !== 'war') this.openPanel('war');
    const w = typeof document === 'undefined' ? undefined : document.getElementById('ui')?.dataset.width;
    if (w === 'xs' || w === 's') this.select(null);
  }

  select(sel: Selection | null): void {
    this.selected = sel;
    let rect: { x: number; z: number; hw: number; hd: number; angle: number } | null = null;
    // A selected car shows its whole route; a selected depot shows its bus loop.
    const car =
      sel?.kind === 'car'
        ? this.renderer.traffic.car(sel.id)
        : sel?.kind === 'walker'
          ? this.renderer.pedestrians.walker(sel.id)
          : undefined;
    // A depot or station, or a stop (M20), shows the line it runs or is on.
    const line =
      sel?.kind === 'civic'
        ? this.world.lines.find((l) => l.depot === sel.id || (l.mode === 'train' && l.stops.includes(sel.id)))
        : sel?.kind === 'stop'
          ? this.world.lines.find((l) => l.mode !== 'train' && l.stops.includes(sel.id))
          : undefined;
    const legs = car?.legs ?? line?.legs;
    const net = this.world.net;
    const road = sel?.kind === 'road' ? this.world.netState.segments.get(sel.id) : undefined;
    this.renderer.routeTint.show(
      legs
        ? [...new Set(legs.map((l) => l.seg))]
            .filter((id) => this.world.netState.segments.has(id))
            .map((id) => ({
              curve: net.curve(id),
              v: [1, 1],
              half: 2.5,
              surface: (s: number, x: number, z: number) => this.world.roadHeight(id, s, x, z),
            }))
        : road
          ? [
              {
                curve: net.curve(road.id),
                v: [1, 1],
                half: net.halfWidth(road.id),
                surface: (s: number, x: number, z: number) => this.world.roadHeight(road.id, s, x, z),
              },
            ]
          : null,
    );
    if (sel?.kind === 'building') {
      const b = this.world.buildings.get(sel.id);
      if (b) rect = { x: b.x, z: b.z, hw: b.w * 4, hd: b.d * 4, angle: b.angle };
    } else if (sel?.kind === 'civic') {
      const c = this.world.civics.get(sel.id);
      const d = c ? CIVIC.get(c.def) : undefined;
      if (c && d) rect = { x: c.x, z: c.z, hw: d.w / 2, hd: d.d / 2, angle: c.angle };
    }
    this.renderer.ghost.showSelection(rect);
    this.notify();
  }

  toast(text: string, tone: 'info' | 'ok' | 'bad' = 'info', ms = 3500, at?: { x: number; z: number }): void {
    const id = this.toastId++;
    this.toasts = [...this.toasts, { id, text, tone, at }].slice(-4);
    this.notify();
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.notify();
    }, ms);
  }

  private lastAlert = new Map<string, number>();

  /** Where an event happened (its building or civic building), for flying the camera there. */
  private placeOf(id: number): { x: number; z: number } | undefined {
    const b = this.world.buildings.get(id) ?? this.world.civics.get(id);
    return b ? { x: b.x, z: b.z } : undefined;
  }

  /** Log a notification (repeats of the same kind collapse) and toast it unless one just showed. */
  notice(
    kind: string,
    text: string,
    tone: 'info' | 'ok' | 'bad',
    at?: { x: number; z: number },
    toast = true,
  ): void {
    const now = performance.now();
    const head = this.notifications.find((n) => n.kind === kind && now - n.time < 60_000);
    if (head) {
      head.count++;
      head.time = now;
      head.tick = this.world.stats.tick;
      if (at) head.at = at;
    } else {
      this.notifications = [
        { id: this.noticeId++, kind, text, tone, at, count: 1, time: now, tick: this.world.stats.tick },
        ...this.notifications,
      ].slice(0, 60);
    }
    if (toast && now - (this.lastAlert.get(kind) ?? -1e9) >= 20_000) {
      this.lastAlert.set(kind, now);
      this.toast(text, tone, 5000, at);
      this.audio?.play(tone === 'bad' ? 'alert' : tone === 'ok' ? 'good' : 'click');
    }
    this.notify();
  }

  private lastAdviceKeys = new Set<string>();

  /** A disaster starting: notify, fly-to point, and a sound to match. */
  private disasterNotice(id: number): void {
    const d = this.world.disasters.active.find((x) => x.id === id);
    if (!d) return;
    const where = this.names.address(d.x, d.z);
    const at = { x: d.x, z: d.z };
    if (d.kind === 'earthquake') {
      this.notice(`disaster:${id}`, `Earthquake! Magnitude ${d.size.toFixed(1)} near ${where}.`, 'bad', at);
      this.audio?.play('quake');
    } else if (d.kind === 'tornado') {
      this.notice(`disaster:${id}`, `A tornado has touched down near ${where}!`, 'bad', at);
      this.audio?.play('siren');
    } else if (d.kind === 'flood') {
      this.notice(`disaster:${id}`, `Flood warning: the water is rising near ${where}.`, 'bad', at);
      this.audio?.play('alert');
    } else {
      this.notice(`disaster:${id}`, `Meteor incoming! It will strike near ${where}.`, 'bad', at);
      this.audio?.play('whoosh');
    }
  }

  private lastPop = 0;
  private lastBoom = 0;

  /** A battle on screen (M35): a few toy pops for its guns and a boom now and then for its shells. */
  private battleSounds(f: BattleFrame): void {
    const now = performance.now();
    if (f.shots.length && now - this.lastPop > 330) {
      this.lastPop = now;
      this.audio?.play('pop');
    }
    if (f.shots.some((s) => s.kind === 1 && s.hit) && now - this.lastBoom > 1200) {
      this.lastBoom = now;
      this.audio?.play('boom');
    }
  }

  /** What a battle in the city left behind (M35). */
  private battleReport(info: Record<string, number | string>): void {
    const n = (v: unknown) => Number(v) || 0;
    const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
    const head =
      info.outcome === 'repelled'
        ? `${String(info.from)}'s raid was beaten off`
        : info.outcome === 'withdrew'
          ? `${String(info.from)}'s force pulled back`
          : `${String(info.from)}'s raiders struck their target and left`;
    const parts: string[] = [];
    if (n(info.collapsed)) parts.push(`${plural(n(info.collapsed), 'building')} knocked down`);
    if (n(info.civics)) parts.push(`${plural(n(info.civics), 'city building')} to repair`);
    if (n(info.lost)) parts.push(`${plural(n(info.lost), 'of our units', 'of our units')} knocked out`);
    parts.push(`${plural(n(info.theirLost), 'of theirs', 'of theirs')} knocked out`);
    this.notice(
      'battleEnded',
      `${head}: ${parts.join(', ')}. Crews are repairing the damage; the war room has the report.`,
      info.outcome === 'repelled' ? 'ok' : 'info',
    );
  }

  /** What a disaster left behind, when it's over. */
  private disasterReport(info: Record<string, number | string>): void {
    const name = { earthquake: 'earthquake', tornado: 'tornado', flood: 'flood', meteor: 'meteor strike' }[
      String(info.kind)
    ];
    const parts: string[] = [];
    const n = (v: unknown) => Number(v) || 0;
    const plural = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;
    if (n(info.destroyed)) parts.push(`${plural(n(info.destroyed), 'building')} destroyed`);
    if (n(info.damaged)) parts.push(`${n(info.damaged)} damaged or flooded`);
    if (n(info.roads)) parts.push(`${plural(n(info.roads), 'road')} closed for repairs`);
    if (n(info.casualties)) parts.push(`${plural(n(info.casualties), 'home')} needing ambulances`);
    const text = parts.length
      ? `The ${name} is over: ${parts.join(', ')}. Crews are clearing up; the lots will be rebuilt.`
      : `The ${name} is over, and the city came through unharmed.`;
    this.notice(`over:${String(info.kind)}`, text, parts.length ? 'info' : 'ok', {
      x: n(info.x),
      z: n(info.z),
    });
  }

  /** Turn sim events into notifications (DESIGN §5). */
  private onEvents(events: { kind: string; id: number; info?: Record<string, number | string> }[]): void {
    for (const e of events) {
      const at = this.placeOf(e.id);
      const civicName = () => {
        const c = this.world.civics.get(e.id);
        return (c && CIVIC.get(c.def)?.name) ?? 'building';
      };
      if (e.kind === 'closed')
        this.notice('closed', 'A business closed: no power or water for half a day.', 'bad', at);
      else if (e.kind === 'abandoned')
        this.notice('abandoned', 'A building was abandoned. Click it to see why.', 'bad', at);
      else if (e.kind === 'bankrupt') this.notice('bankrupt', 'The city is bankrupt.', 'bad');
      else if (e.kind === 'moneyNegative') this.notice('money', 'The treasury is empty!', 'bad');
      else if (e.kind === 'fire') {
        this.notice('fire', 'Fire! A building is burning.', 'bad', at);
        this.audio?.play('siren');
      } else if (e.kind === 'destroyed') this.notice('destroyed', 'A building burned down.', 'bad', at);
      else if (e.kind === 'fireOut') this.notice('fireOut', 'Firefighters put out a fire.', 'ok', at);
      else if (e.kind === 'crime')
        this.notice('crime', 'A crime went unanswered. Police coverage is thin.', 'bad', at);
      else if (e.kind === 'death')
        this.notice('death', 'An ambulance could not reach a patient in time.', 'bad', at);
      else if (e.kind === 'crimeStopped')
        this.notice('crimeStopped', 'Police stopped a crime.', 'ok', at, false);
      else if (e.kind === 'patientSaved')
        this.notice('patientSaved', 'An ambulance got a patient to care.', 'ok', at, false);
      else if (e.kind === 'milestone') {
        const m = MILESTONES[e.id];
        if (m) {
          this.notice(
            `milestone:${e.id}`,
            `${m.name}! The city has ${m.population.toLocaleString('en-US')} residents.`,
            'ok',
            undefined,
            false,
          );
          this.celebrate(e.id);
        }
      } else if (e.kind === 'achievement') {
        const a = ACHIEVEMENTS[e.id];
        if (a) this.notice(`achievement:${a.id}`, `Achievement: ${a.name}. ${a.blurb}`, 'ok');
      } else if (e.kind === 'disaster') this.disasterNotice(e.id);
      else if (e.kind === 'disasterOver' && e.info) this.disasterReport(e.info);
      else if (e.kind === 'collapsed') this.notice('collapsed', 'A building collapsed.', 'bad', at, false);
      else if (e.kind === 'civicDamaged')
        this.notice(`civicDamaged`, `The ${civicName()} was damaged and is offline for repairs.`, 'bad', at);
      else if (e.kind === 'civicDestroyed') {
        const name = CIVIC.get(String(e.info?.def))?.name ?? 'building';
        const where = e.info ? { x: Number(e.info.x), z: Number(e.info.z) } : undefined;
        this.notice(
          `civicDestroyed:${e.id}`,
          `The ${name} was destroyed. It will have to be rebuilt.`,
          'bad',
          where,
        );
      } else if (e.kind === 'civicRepaired')
        this.notice('civicRepaired', `The ${civicName()} is repaired and back in service.`, 'ok', at, false);
      else if (e.kind === 'season') {
        // Seasons and weather (M22).
        const text = [
          'Spring has come.',
          'Summer is here: heatwaves raise power and water use.',
          'Autumn: winter is three months away, and heating will push up power demand.',
          'Winter has come: heating raises power demand, and snow slows traffic until it is ploughed.',
        ][e.id];
        if (text) this.notice('season', text, 'info', undefined, true);
      } else if (e.kind === 'weather') {
        // Kinds by their index in WEATHER_KINDS: 3 storm, 4 snow, 6 heat.
        const text = {
          3: 'A thunderstorm is rolling in: heavy rain, and the river will rise.',
          4: 'Heavy snow is falling: it will slow traffic until ploughs clear it or it melts.',
          6: 'A heatwave: homes and shops use more power and water.',
        }[e.id as 3 | 4 | 6];
        if (text) this.notice('weather', text, 'info', undefined, true);
      } else if (e.kind === 'roadRepaired')
        this.notice('roadRepaired', 'A damaged road reopened.', 'ok', undefined, false);
      else if (e.kind === 'unitTrained') {
        // War (M34): a unit finished training at its base.
        const base = Number(e.info?.base);
        this.notice(
          'unitTrained',
          `${String(e.info?.unit ?? 'A unit')} trained and ready.`,
          'ok',
          this.placeOf(base),
          false,
        );
      } else if (e.kind === 'bondRepaid')
        this.notice('bondRepaid', 'A war bond is repaid in full.', 'ok', undefined, false);
      // Battles (M35).
      else if (e.kind === 'raidsOpen')
        this.notice(
          'raidsOpen',
          'The city has grown enough for its rivals to take notice: from now on they may raid it. The war room’s Map tab shows who and how far.',
          'info',
        );
      else if (e.kind === 'raidWarning') {
        const i = e.info ?? {};
        const shelter = Number(i.near)
          ? ` ${formatNumber(Number(i.sheltered))} of the ${formatNumber(Number(i.near))} residents nearby head for the shelters.`
          : '';
        this.notice(
          `raid:${e.id}`,
          `Sirens! ${String(i.from)} is sending ${String(i.units)} units against the city: they arrive in ${String(i.hours)} hours.${shelter}`,
          'bad',
        );
        this.audio?.play('raid');
      } else if (e.kind === 'battleStarted') {
        this.notice(
          `battle:${e.id}`,
          `${String(e.info?.from)}'s force has reached the city, and the defences are fighting back.`,
          'bad',
        );
        this.audio?.play('raid');
      } else if (e.kind === 'battleEnded') this.battleReport(e.info ?? {});
      else if (e.kind === 'forceArrived')
        this.notice(
          `force:${e.id}`,
          `Our force has reached ${String(e.info?.to)}: the battle is on.`,
          'info',
          undefined,
          false,
        );
      else if (e.kind === 'expeditionReport') {
        const i = e.info ?? {};
        const lost = Number(i.lost) || 0;
        const head =
          i.outcome === 'raided'
            ? `Our raid on ${String(i.to)} struck home: ${String(i.down)} of their targets knocked out`
            : i.outcome === 'repelled'
              ? `Our raid on ${String(i.to)} was beaten off`
              : `Our force pulled back from ${String(i.to)}`;
        this.notice(
          `force:${e.id}`,
          `${head}${lost ? `, and ${lost} of our units were knocked out` : ''}. The war room has the report.`,
          i.outcome === 'raided' ? 'ok' : 'info',
        );
      } else if (e.kind === 'forceHome')
        this.notice('forceHome', `Our force is home from ${String(e.info?.from)}.`, 'ok', undefined, false);
      // Diplomacy (M36): declarations, treaties, pacts, capitulations and conquests.
      else if (e.kind === 'diplomacy') {
        const what = String(e.info?.what ?? '');
        const text = String(e.info?.text ?? '');
        // The sim says which way news cuts when it can go either way (a hold, terms signed).
        const tone = e.info?.tone;
        const bad =
          tone === 'bad' ||
          (!tone &&
            ['declaredOn', 'capitulated', 'fell', 'broken', 'pactsEnded', 'theyBroke'].includes(what));
        const good =
          tone === 'good' ||
          (!tone && ['theyCapitulate', 'conquered', 'tributeDone', 'boughtBack'].includes(what));
        // Keyed by its words too: two different notes of a kind (theirs and ours) never merge.
        this.notice(`dip:${what}:${e.id}:${text}`, text, bad ? 'bad' : good ? 'ok' : 'info');
        if (what === 'declaredOn' || what === 'fell' || (what === 'hold' && bad)) this.audio?.play('raid');
      } else if (e.kind === 'decayed')
        this.notice(
          'decayed',
          'An abandoned building fell into ruin; the lot will clear.',
          'info',
          at,
          false,
        );
      // Big projects and elections (M17).
      else if (e.kind === 'projectStage')
        this.notice(`project:${e.id}`, `The ${civicName()} moves on to its next stage.`, 'info', at, false);
      else if (e.kind === 'projectWaiting')
        this.notice(
          `projectWaiting:${e.id}`,
          `Work on the ${civicName()} has stopped: the treasury can't pay for the next stage yet.`,
          'bad',
          at,
        );
      else if (e.kind === 'projectDone') {
        this.notice(`projectDone:${e.id}`, `The ${civicName()} is open!`, 'ok', at);
        this.audio?.play('place');
      } else if (e.kind === 'matchDay')
        this.notice('matchDay', 'Match day at the stadium: fans are driving in from all over.', 'info', at);
      else if (e.kind === 'launch')
        this.notice('launch', 'A rocket lifted off from the launch complex.', 'ok', at, false);
      else if (e.kind === 'seasonsNew')
        this.notice(
          'seasonsNew',
          'Seasons have come to this city. Cold weather now needs power for heating (and hot weather some for cooling): this first winter the city is spared, and from spring it eases in to count in full by next winter. The utilities advisor says how much power that will take.',
          'info',
        );
      else if (e.kind === 'campaign')
        this.notice(
          'campaign',
          'The election is six months away. Make up to two promises in the city panel (P → Election).',
          'info',
        );
      else if (e.kind === 'scenarioWon' || e.kind === 'scenarioLost') {
        const sc = this.world.stats.scenario;
        const months = sc ? sc.monthsTaken : 0;
        const won = e.kind === 'scenarioWon';
        this.scenarioEnd = { won, stars: e.id, reason: String(e.info?.reason ?? ''), months };
        if (won && sc) recordWin(sc.id, e.id, months);
        this.setSpeed(0);
        this.notify();
      } else if (e.kind === 'electionWon' || e.kind === 'electionLost') {
        const share = Math.round(Number(e.info?.share ?? 0) * 100);
        this.notice(
          'election',
          e.kind === 'electionWon'
            ? `Re-elected with ${share} % of the vote! The region sends a grant, and residents are in a good mood.`
            : `Lost the election with ${share} % of the vote. For a year the council blocks tax rises and new loans.`,
          e.kind === 'electionWon' ? 'ok' : 'bad',
        );
      }
    }
  }

  /**
   * Urgent advice becomes a notification the first time it appears. Only the first new one pops
   * up as a toast; the rest go straight to the log, so a bad moment isn't a wall of red.
   */
  private adviceNotices(): void {
    const keys = new Set<string>();
    let toasted = false;
    for (const a of this.advice) {
      // Disasters announce themselves; don't repeat them as advice.
      if (a.severity < 3 || a.title.endsWith('under way')) continue;
      const key = `${a.advisor}:${a.title.replace(/[0-9,]+/g, '#')}`;
      keys.add(key);
      if (this.lastAdviceKeys.has(key)) continue;
      this.notice(key, `${a.title}. ${a.text}`, 'bad', a.at, !toasted);
      toasted = true;
    }
    this.lastAdviceKeys = keys;
  }

  /** Show the milestone banner for a while. */
  celebrate(index: number): void {
    this.celebration = index;
    if (this.celebrationTimer) clearTimeout(this.celebrationTimer);
    this.celebrationTimer = setTimeout(() => this.dismissCelebration(), 9000);
    this.audio?.play('fanfare');
    this.notify();
  }

  dismissCelebration(): void {
    this.celebration = null;
    this.notify();
  }

  setRandomDisasters(on: boolean): void {
    this.randomDisasters = on;
    void this.dispatch({ type: 'setDisasters', on });
    this.notify();
  }

  updateSettings(patch: Partial<Settings>): void {
    // Choosing graphics by hand ends a check in progress: the player has decided.
    if (this.graphicsCheck && ('quality' in patch || 'shadows' in patch || 'drawDistance' in patch)) {
      this.graphicsCheck = null;
      patch = { ...patch, graphicsChecked: true };
    }
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.applySettings();
    this.notify();
  }

  /**
   * Time the next few seconds of frames at the high preset and switch to the preset this device can
   * hold (M15): on the first launch's main menu, and from Settings.
   */
  startGraphicsCheck(): void {
    const gl = this.renderer.renderer.getContext();
    this.updateSettings(GRAPHICS_PRESETS.high);
    this.graphicsCheck = new GraphicsCheck(gpuName(gl), navigator.hardwareConcurrency || 0);
    this.notify();
  }

  private finishGraphicsCheck(r: CheckResult): void {
    this.graphicsCheck = null;
    this.graphicsResult = r;
    this.updateSettings({ ...GRAPHICS_PRESETS[r.preset], graphicsChecked: true, autoGraphics: r.preset });
    const name = r.preset[0]!.toUpperCase() + r.preset.slice(1);
    this.toast(
      `Graphics set to ${name} for this device (${r.reason}). Change them any time in Settings.`,
      'info',
      7000,
    );
  }

  /** Push the settings to the audio engine, renderer, camera and interface. */
  applySettings(): void {
    const s = this.settings;
    this.audio?.apply(s);
    const q = QUALITY_PARAMS[s.quality];
    const d = DRAW_DISTANCE_PARAMS[s.drawDistance];
    this.renderer.tiltShiftOn = s.tiltShift;
    this.renderer.applyGraphics({
      pixelRatio: q.pixelRatio,
      shadows: s.shadows,
      shadowMap: q.shadowMap,
      fogScale: d.fog,
      treeDetail: d.treeDetail,
      crowd: q.crowd,
      post: { aoSamples: q.ao, aoBlur: q.aoBlur, glow: q.glow, samples: q.samples, aoFar: q.aoFar },
      cascades: q.cascades,
      ground: q.ground,
      closeShadowHz: q.closeShadowHz,
      units: q.units,
    });
    this.renderer.controller.edgeScroll = s.edgeScroll;
    this.renderer.controller.pointerDevice = s.pointer;
    applyUiScale(s.uiScale);
  }

  inMenu(): boolean {
    return this.mode === 'menu';
  }

  get screen(): Screen | null {
    return this.screens[this.screens.length - 1] ?? null;
  }

  /** Open a menu screen on top of any others; in a city, the game pauses while menus are up. */
  openScreen(s: Screen): void {
    // A new city founded from anywhere but the friends screen is the player's own (F4).
    if (s === 'newGame' && this.screen !== 'friends') this.forgetFriendsChoice();
    if (this.mode === 'play' && this.screens.length === 0) {
      if (!this.net) {
        this.speedBeforeMenu = this.speed;
        this.setSpeed(0);
      }
      this.tools.use('select');
      this.select(null);
    }
    this.screens = [...this.screens, s];
    this.renderer.controller.inputEnabled = false;
    this.notify();
  }

  /** Back out of the top screen (the main menu itself never closes). */
  closeScreen(): void {
    if (this.mode === 'menu' && this.screens.length <= 1) return;
    // Backing out of the friends or new-city screen drops what the lobby chose (F4): a city founded
    // later must not be shared, or put in a region, without the player knowing.
    if (this.screen === 'friends' || this.screen === 'newGame') this.forgetFriendsChoice();
    this.screens = this.screens.slice(0, -1);
    if (this.screens.length === 0) this.resumeFromMenu();
    this.notify();
  }

  /** Close every menu and carry on playing. */
  resume(): void {
    if (this.mode !== 'play') return;
    this.screens = [];
    this.resumeFromMenu();
    this.notify();
  }

  private resumeFromMenu(): void {
    this.renderer.controller.inputEnabled = true;
    if (this.speedBeforeMenu !== null) this.setSpeed(this.speedBeforeMenu);
    this.speedBeforeMenu = null;
  }

  /** Save the city to a slot (with an optional label for the slot list). */
  async saveTo(slot: string, label?: string, quiet = false): Promise<boolean> {
    // A neighbour's city seen read-only is theirs: it never lands in this browser's saves (F5).
    if (this.readOnly) {
      if (!quiet) this.toast('You’re visiting a neighbour’s city: nothing here is saved.', 'info');
      return false;
    }
    if (this.saving) return false;
    this.saving = true;
    this.notify();
    try {
      const s = await this.client.save();
      // A city in a shared region rejoins it when this save is opened again (M32); the binding is the
      // city's, so another city saved over this slot later doesn't inherit it (F6).
      if (this.boundRegion) s.meta.region = { ...this.boundRegion };
      const info = await writeSlot(slot, s, label);
      this.lastSavedAt = performance.now();
      if (slot !== 'auto') this.slot = slot;
      // The slot's name, as the load list shows it, not the city's (P22).
      if (!quiet) this.toast(`Saved “${info.label}”`, 'ok');
      return true;
    } catch (e) {
      this.toast(`Save failed: ${e instanceof Error ? e.message : String(e)}`, 'bad');
      return false;
    } finally {
      this.saving = false;
      this.notify();
    }
  }

  /**
   * Autosave now and then (settings), unless the city has gone bankrupt or isn't this player's (a
   * visit, F5). `force` skips the wait (tests); resolves with whether it saved.
   */
  autosave(now: number, force = false): Promise<boolean> {
    const every = this.settings.autosaveMinutes * 60_000;
    if (
      this.mode !== 'play' ||
      this.readOnly ||
      (every <= 0 && !force) ||
      this.saving ||
      this.world.stats.bankrupt
    )
      return Promise.resolve(false);
    if (!this.lastSavedAt) this.lastSavedAt = now;
    if (now - this.lastSavedAt < every && !force) return Promise.resolve(false);
    return this.saveTo('auto', 'Autosave', true);
  }

  private quitUnsaved = false;

  /** Autosave, then go back to the main menu (if saving fails, a second try leaves without it). */
  async quitToMenu(): Promise<void> {
    if (
      !this.readOnly &&
      !this.world.stats.bankrupt &&
      !this.quitUnsaved &&
      !(await this.saveTo('auto', 'Autosave', true))
    ) {
      this.quitUnsaved = true;
      this.toast('The city could not be saved. Choose Quit again to leave without saving.', 'bad', 8000);
      return;
    }
    this.leaveRoom(false);
    // A city in a shared region leaves it as its player does, keeping its place: its last save goes
    // to the region first, so a friend's raid while it's away is fought in the city as it was left.
    const link = this.region;
    if (link) {
      this.region = null;
      await Promise.race([link.leave(), new Promise((r) => setTimeout(r, 6000))]);
    }
    location.href = location.pathname;
  }

  /** Switch to a downloaded new version: save the city first (to the autosave), then reload. */
  async applyUpdate(): Promise<void> {
    if (this.updating) return;
    this.updating = true;
    this.notify();
    if (
      this.mode === 'play' &&
      !this.readOnly &&
      !this.world.stats.bankrupt &&
      !(await this.saveTo('auto', 'Autosave', true))
    ) {
      this.updating = false;
      this.toast(
        'The city could not be saved, so the new version waits. Try again after saving.',
        'bad',
        8000,
      );
      return;
    }
    this.updates.apply();
  }

  // ------------------------------------------------------------------ photo mode (M16)

  /** Photo mode: the interface hides and the camera is free to come down to street level. */
  enterPhoto(): void {
    if (this.photo || this.mode !== 'play' || this.screen) return;
    this.tools.use('select');
    this.select(null);
    this.overlay.set(null);
    this.panel = null;
    this.shortcutsOpen = false;
    this.setHint(null);
    this.photoSpeed = this.speed || 1;
    this.photo = {
      hour: null,
      season: null,
      weather: null,
      fov: DEFAULT_FOV,
      zones: false,
      dof: 0,
      tiltShift: 0,
      focus: 100,
      grade: 'natural',
      panel: true,
      running: this.speed > 0,
      scale: 1,
      follow: null,
      picking: false,
      saved: null,
      note: null,
    };
    this.renderer.setPhoto(this.photo);
    this.notify();
  }

  exitPhoto(): void {
    if (!this.photo) return;
    this.photo = null;
    this.followLast = null;
    this.renderer.controller.follow = null;
    this.renderer.setPhoto(null);
    this.notify();
  }

  setPhoto(patch: Partial<PhotoState>): void {
    const p = this.photo;
    if (!p) return;
    // A season or weather picked for the photo shows at once (M22).
    if ('season' in patch || 'weather' in patch) this.renderer.weather.snapNext = true;
    if ('running' in patch && patch.running !== p.running && !this.net) {
      if (patch.running) this.setSpeed(this.photoSpeed);
      else {
        this.photoSpeed = this.speed || this.photoSpeed;
        this.setSpeed(0);
      }
    }
    if ('follow' in patch) {
      this.followLast = null;
      if (!patch.follow) this.renderer.controller.follow = null;
      else this.renderer.controller.setPose({ distance: 16, tilt: -0.12 });
    }
    Object.assign(p, patch);
    this.notify();
  }

  /** Where something that can be followed is this frame. */
  private followPose(f: FollowTarget): { x: number; y: number; z: number } | null {
    const r = this.renderer;
    if (f.kind === 'car') return r.traffic.car(f.id) ?? null;
    if (f.kind === 'walker') return r.pedestrians.walker(f.id) ?? null;
    if (f.kind === 'bus') return r.transit.busPoses[f.id] ?? null;
    return r.vehicles.positions.get(f.id) ?? null;
  }

  /** The car, bus, walker or service vehicle nearest a point on the ground, within `reach` metres. */
  private followableNear(
    x: number,
    z: number,
    reach: number,
    kinds?: FollowTarget['kind'][],
  ): FollowTarget | null {
    const r = this.renderer;
    let best: FollowTarget | null = null;
    let bestD = reach;
    const consider = (kind: FollowTarget['kind'], id: number, px: number, pz: number) => {
      if (kinds && !kinds.includes(kind)) return;
      const d = Math.hypot(px - x, pz - z);
      if (d < bestD) {
        bestD = d;
        best = { kind, id };
      }
    };
    const car = r.traffic.carAt(x, z, reach);
    if (car) consider('car', car.id, car.x, car.z);
    const walker = r.pedestrians.walkerAt(x, z, Math.min(reach, 6));
    if (walker) consider('walker', walker.id, walker.x, walker.z);
    r.transit.busPoses.forEach((b, i) => consider('bus', i, b.x, b.z));
    for (const [id, v] of r.vehicles.positions) consider('vehicle', id, v.x, v.z);
    return best;
  }

  /** A click in photo mode: while picking, follow what's under it. */
  photoClick(clientX: number, clientY: number): void {
    const p = this.photo;
    if (!p?.picking) return;
    const g = this.renderer.controller.screenToGround(clientX, clientY);
    const f = g ? this.followableNear(g.x, g.z, 12) : null;
    if (f) this.setPhoto({ follow: f, picking: false, note: null });
    else this.setPhoto({ note: 'Nothing to follow there: click a car, bus or person.' });
  }

  /**
   * Follow a car, bus, person or service vehicle near the middle of the view: of those within a few
   * hundred metres, one with a good stretch of its trip still ahead (a car about to park makes a
   * short ride).
   */
  followNearest(kinds?: FollowTarget['kind'][]): boolean {
    const r = this.renderer;
    const t = r.controller.current;
    const want = (k: FollowTarget['kind']) => !kinds || kinds.includes(k);
    let best: FollowTarget | null = null;
    let score = -Infinity;
    const consider = (f: FollowTarget, x: number, z: number, ahead: number) => {
      const d = Math.hypot(x - t.x, z - t.z);
      if (d > 400) return;
      // Nearer is better, but a long way still to go matters more.
      const s = Math.min(ahead, 600) - d * 0.5;
      if (s > score) {
        score = s;
        best = f;
      }
    };
    // A car held at a junction makes a dull start to a ride: prefer one on the move.
    if (want('car'))
      for (const c of r.traffic.cars)
        consider({ kind: 'car', id: c.id }, c.x, c.z, r.traffic.remaining(c) - (c.waited > 0 ? 400 : 0));
    if (want('walker'))
      for (const w of r.pedestrians.walkers)
        consider({ kind: 'walker', id: w.id }, w.x, w.z, r.pedestrians.remaining(w) * 4);
    // Buses run their loop for good; service vehicles are followed to wherever they're going.
    if (want('bus')) r.transit.busPoses.forEach((b, i) => consider({ kind: 'bus', id: i }, b.x, b.z, 600));
    if (want('vehicle'))
      for (const [id, v] of r.vehicles.positions) consider({ kind: 'vehicle', id }, v.x, v.z, 300);
    const f = best as FollowTarget | null;
    if (f) this.setPhoto({ follow: f, picking: false, note: null });
    else this.setPhoto({ note: 'Nothing like that is moving near here to follow.' });
    return !!f;
  }

  /** Each frame in photo mode: keep the follow camera on its target and focus on what it looks at. */
  private photoFrame(dt: number): void {
    const p = this.photo!;
    const c = this.renderer.controller;
    if (p.follow) {
      const pos = this.followPose(p.follow);
      if (!pos) {
        this.setPhoto({
          follow: null,
          note: `The ${p.follow.kind === 'vehicle' ? 'vehicle' : p.follow.kind} has arrived.`,
        });
      } else {
        const l = this.followLast;
        if (!l) this.followLast = { x: pos.x, z: pos.z, dx: 0, dz: 0, yaw: c.goal.yaw };
        else {
          // Heading from how it moved, smoothed; the camera sits behind it.
          const k = 1 - Math.exp(-dt * 4);
          l.dx += (pos.x - l.x - l.dx) * k;
          l.dz += (pos.z - l.z - l.dz) * k;
          l.x = pos.x;
          l.z = pos.z;
          if (Math.hypot(l.dx, l.dz) > 1e-3) l.yaw = Math.atan2(-l.dx, -l.dz);
        }
        c.follow = { x: pos.x, y: pos.y, z: pos.z, yaw: this.followLast!.yaw };
      }
    }
    // Autofocus: keep what the camera looks at sharp.
    p.focus = c.current.distance;
  }

  /** Save the view as a PNG (photo mode), downloaded to the player's computer. */
  async savePhoto(): Promise<{ width: number; height: number; bytes: number } | null> {
    const p = this.photo;
    if (!p) return null;
    const shot = this.renderer.capture(p.scale);
    const blob = await shot.blob;
    if (!blob) {
      this.setPhoto({ note: 'The photo could not be saved (the browser refused to encode it).' });
      return null;
    }
    const d = dateOf(this.world.stats.tick);
    const name = `${this.world.stats.cityName} ${MONTH_NAMES[d.month]} year ${d.year}.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    this.audio?.play('place');
    const saved = { width: shot.width, height: shot.height, bytes: blob.size };
    this.setPhoto({ saved, note: null });
    return saved;
  }

  /** Start the first-city tutorial from its first step. */
  startTutorial(): void {
    this.updateSettings({ tutorialStep: 0 });
  }

  /** Move to the next tutorial step (finishing after the last). */
  tutorialNext(): void {
    const next = this.settings.tutorialStep + 1;
    this.updateSettings({ tutorialStep: next >= TUTORIAL.length ? -1 : next });
  }

  endTutorial(): void {
    this.updateSettings({ tutorialStep: -1 });
  }

  /** Advance past tutorial steps the player has already done; show a tip whose moment has come. */
  private checkGuidance(): void {
    if (this.mode !== 'play') return;
    let step = this.settings.tutorialStep;
    while (step >= 0 && step < TUTORIAL.length && TUTORIAL[step]!.done?.(this)) step++;
    if (step !== this.settings.tutorialStep) {
      this.updateSettings({ tutorialStep: step >= TUTORIAL.length ? -1 : step });
      this.audio?.play('good');
    }
    // Tips wait for the tutorial, and come one at a time.
    if (!this.settings.tips || this.settings.tutorialStep >= 0) return;
    const tip = pickTip(this, this.tip, !!this.screen || !!this.panel, new Set(this.settings.seenTips));
    if (tip === this.tip) return;
    this.tip = tip;
    if (tip && !this.settings.seenTips.includes(tip.id))
      this.updateSettings({ seenTips: [...this.settings.seenTips, tip.id] });
    else this.notify();
  }

  dismissTip(turnOff = false): void {
    this.tip = null;
    if (turnOff) this.updateSettings({ tips: false });
    else this.notify();
  }

  /** Ask before acting (P2); a question already open is answered no. */
  ask(q: ToolQuestion): void {
    this.answer(false);
    this.question = q;
    this.notify();
  }

  /** Answer the open question, if there is one. */
  answer(yes: boolean): void {
    const q = this.question;
    if (!q) return;
    this.question = null;
    this.notify();
    (yes ? q.onYes : q.onNo)();
  }

  setHint(h: ToolHint | null): void {
    if (!h && !this.hint) return;
    this.hint = h;
    this.notify();
  }

  /** Undo or redo the last action (M14), saying what was taken back or why it can't be. */
  async undo(): Promise<CommandResult> {
    return this.history('undo');
  }

  async redo(): Promise<CommandResult> {
    return this.history('redo');
  }

  private async history(dir: 'undo' | 'redo'): Promise<CommandResult> {
    const r = await this.dispatch({ type: dir });
    const label = (r.info?.label as string | undefined) ?? '';
    if (r.ok) {
      this.audio?.play(dir === 'undo' ? 'bulldoze' : 'build');
      this.toast(`${dir === 'undo' ? 'Undone' : 'Redone'}: ${label}`, 'info', 1800);
    } else {
      this.audio?.play('error');
      this.toast(r.reason.endsWith('.') ? r.reason : `${r.reason}.`, 'bad', 4000);
    }
    return r;
  }

  setSpeed(speed: Speed): void {
    if (this.net) {
      // The room's speed: everyone's city changes together (the room says so back).
      this.net.session.setSpeed(speed);
      return;
    }
    this.speed = speed;
    this.client.setSpeed(speed);
    this.notify();
  }

  /** Fly the camera to a spot (advisors, notifications), optionally opening a data map. */
  /**
   * Watch a battle fought in a neighbour's town (M35): the city is saved, and the town opens in this
   * page, read-only, where the battle plays out again. "Back to my city" reopens the save.
   */
  async watchBattle(id: string): Promise<void> {
    // Only when this browser keeps the battle and its town: otherwise there's nothing to show.
    const rec = await loadBattle(id);
    if (!rec || (rec.townKey && !(await loadTown(rec.townKey)))) {
      this.toast('That battle’s replay isn’t kept in this browser.', 'info');
      return;
    }
    const slot = this.slot ?? 'auto';
    if (!this.readOnly && !(await this.saveTo(slot, undefined, true))) {
      this.toast('The city couldn’t be saved first, so the battle can’t be shown now.', 'bad');
      return;
    }
    location.href = `${location.pathname}?battle=${encodeURIComponent(id)}&back=${encodeURIComponent(slot)}`;
  }

  /** Leave a battle being watched for the city it came from. */
  backToCity(): void {
    const back = this.viewing?.back;
    location.href = back ? `${location.pathname}?load=${encodeURIComponent(back)}` : location.pathname;
  }

  /** Look at the battle in the city (M35): the middle of its units, from far enough to see them. */
  followBattle(): void {
    const f = this.world.battle;
    if (!f?.units.length) {
      this.openPanel('war');
      return;
    }
    // The attackers still in it (where the fighting is), else whoever is left; the toy units are
    // small, so close in on the middle of the group nearest its centre.
    const live = f.units.filter((u) => u.state !== 2);
    const attackers = live.filter((u) => u.side === 0);
    const list = attackers.length ? attackers : live.length ? live : f.units;
    let x = list.reduce((a, u) => a + u.x, 0) / list.length;
    let z = list.reduce((a, u) => a + u.z, 0) / list.length;
    const near = [...list].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    const core = near.slice(0, Math.max(1, Math.ceil(near.length * 0.6)));
    x = core.reduce((a, u) => a + u.x, 0) / core.length;
    z = core.reduce((a, u) => a + u.z, 0) / core.length;
    const spread = Math.max(...core.map((u) => Math.hypot(u.x - x, u.z - z)));
    const cur = this.renderer.controller.goal;
    this.following = 0;
    this.renderer.controller.setPose(
      { x, z, distance: Math.min(420, Math.max(120, spread * 1.8 + 80)), yaw: cur.yaw, tilt: cur.tilt },
      false,
    );
  }

  /** Fly to a building or city building by id. */
  flyToId(id: number): void {
    const at = this.placeOf(id);
    if (at) this.flyTo(at);
  }

  flyTo(at: { x: number; z: number }, map?: string): void {
    this.following = 0;
    const cur = this.renderer.controller.goal;
    this.renderer.controller.setPose(
      {
        x: at.x,
        z: at.z,
        distance: Math.min(Math.max(cur.distance, 180), 320),
        yaw: cur.yaw,
        tilt: cur.tilt,
      },
      false,
    );
    if (map) this.overlay.set(map as never);
    this.notify();
  }

  async refreshAdvice(): Promise<void> {
    // The main menu's backdrop map has nothing to advise on.
    if (this.inMenu()) return;
    const advice = await this.client.query<Advice[]>({ type: 'advisors' });
    // (The mode is set just after construction, possibly while the first query is out.)
    if (this.inMenu()) return;
    this.advice = advice;
    this.adviceNotices();
    this.notify();
  }

  setCamera(preset: CameraPresetName | Partial<CameraPose>, instant = true): void {
    this.following = 0;
    if (typeof preset === 'string') this.renderer.controller.preset(preset, instant);
    else this.renderer.controller.setPose(preset, instant);
  }

  toggleDebug(): void {
    this.debugOpen = !this.debugOpen;
    this.notify();
  }

  /** The keyboard and trackpad cheat sheet (M14), on `?`. */
  shortcutsOpen = false;

  toggleShortcuts(open = !this.shortcutsOpen): void {
    this.shortcutsOpen = open;
    this.notify();
  }

  /** The war models asked for (phase 5): once, when a city with war on is open. */
  private warAsked = false;

  /**
   * A city with war on (rival neighbours, or a region whose rules allow it, M34) fetches the war
   * models once, when it opens or when war comes on; its military buildings are drawn again with
   * them when they arrive. A peaceful city, and the main menu, never ask.
   */
  private warModels(): void {
    if (this.warAsked || !this.world.stats?.war) return;
    this.warAsked = true;
    void loadWarModels().then(({ models }) => {
      if (models) this.renderer.civics.redraw((def) => CIVIC.get(def)?.category === 'military');
    });
  }

  /** Called every animation frame. */
  frame(now: number): void {
    const interval = this.lastFrameAt ? now - this.lastFrameAt : 0;
    const dt = this.lastFrameAt ? Math.min(0.1, interval / 1000) : 1 / 60;
    this.lastFrameAt = now;
    this.fps = this.fps * 0.9 + (1 / Math.max(dt, 1e-4)) * 0.1;
    const t0 = performance.now();
    const w = this.world;
    if (this.speed > 0) {
      const next = w.displayTick + dt * SPEED_TICKS_PER_SECOND[this.speed];
      w.displayTick = Math.min(next, w.stats.tick + 8);
    }
    if (this.photo) this.photoFrame(dt);
    this.presenceFrame(now);
    const check = this.graphicsCheck?.frame(now, document.visibilityState === 'visible');
    if (check) this.finishGraphicsCheck(check);
    // The main menu slowly circles the backdrop map.
    if (this.mode === 'menu') this.renderer.controller.goal.yaw += dt * 0.025;
    else {
      void this.autosave(now);
      this.warModels();
    }
    this.renderer.icons.showIslands = this.mode === 'play';
    this.districts.update();
    this.regionView.update();
    this.editor?.update();
    // The city's forces wear its player's colour; a shared city's wear the host's, so every player
    // sees the same (M34). Looked up once a second.
    if (w.forces && now - this.ownerAt > 1000) {
      this.ownerAt = now;
      const host = this.net?.session.players.find((p) => p.host);
      this.renderer.units.owner = this.net ? (host?.color ?? 0) : (storedProfile()?.color ?? 0);
    }
    this.renderer.frame(dt);
    if (this.viewerStart > 0 && --this.viewerStart === 0) {
      this.setSpeed(1);
      setTimeout(() => this.followBattle(), 1500);
    }
    this.labels.update();
    if (this.audio && now - this.ambientAt > 250) {
      this.ambientAt = now;
      this.audio.update(ambientScene(w, this.renderer, this.speed === 0));
    }
    const work = performance.now() - t0;
    this.frameMs = this.frameMs * 0.9 + work * 0.1;
    if (this.frameSamples && interval > 0) this.frameSamples.push(interval, work);
  }
}
