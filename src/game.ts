import type { SimClient } from './client/simClient';
import type { ClientWorld } from './client/world';
import type { GameRenderer } from './render/renderer';
import type { CameraPresetName, CameraPose } from './render/camera';
import type { Command, CommandResult } from './sim/commands';
import type { WorkerPerf } from './sim/protocol';
import { SPEED_TICKS_PER_SECOND, type Speed } from './sim/time';
import { ToolManager } from './tools/manager';
import { CIVIC } from './data/civic';
import { MILESTONES } from './data/progression';
import { ACHIEVEMENTS } from './data/achievements';
import type { Advice } from './sim/systems/advisors';
import { OverlayController } from './client/overlay';
import { StreetNames } from './client/names';
import { StreetLabels } from './client/labels';
import type { ToolHint } from './tools/tool';
import type { AudioEngine } from './audio/engine';
import { ambientScene } from './audio/scene';
import { writeSlot } from './client/saves';
import { AppUpdates } from './client/pwa';
import { GRAPHICS_PRESETS, GraphicsCheck, gpuName, type CheckResult } from './client/graphicsCheck';
import { TIPS, TUTORIAL, type Tip } from './client/tutorial';
import {
  DRAW_DISTANCE_PARAMS,
  QUALITY_PARAMS,
  loadSettings,
  saveSettings,
  type Settings,
} from './client/settings';

type Listener = () => void;

let uiScale = 1;

/**
 * Size class of the interface, in scaled rem, for layouts that tighten on narrow screens or at large
 * interface sizes (see `#ui[data-width]` in main.css).
 */
function layoutUi(): void {
  const ui = document.getElementById('ui');
  if (!ui) return;
  const rem = window.innerWidth / (16 * uiScale);
  ui.dataset.width = rem < 60 ? 'xs' : rem < 68 ? 's' : rem < 78 ? 'm' : 'l';
}
if (typeof window !== 'undefined') window.addEventListener('resize', layoutUi);

/** Interface size: the UI root scales with a CSS variable (see main.css). */
export function applyUiScale(scale: number): void {
  uiScale = scale;
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  layoutUi();
}

/** Full-screen menus: the main menu and new-game screen, the pause menu and the screens inside it. */
export type Screen = 'main' | 'newGame' | 'pause' | 'save' | 'load' | 'settings';

/** Something the player has clicked on and is inspecting. */
export interface Selection {
  kind: 'building' | 'civic' | 'car' | 'walker';
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
  debugOpen = false;
  hint: ToolHint | null = null;
  /** Open side panel (budget, and later data maps, advisors...). */
  panel: 'budget' | 'advisors' | 'notifications' | 'city' | null = null;
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
  /** 'menu': the main menu over a backdrop map; 'play': a city. */
  mode: 'menu' | 'play' = 'play';
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
  /** New versions of the app (the service worker, M15). */
  readonly updates = new AppUpdates(() => this.notify());
  /** Saving the city before switching to a new version. */
  updating = false;
  /** The graphics check in progress (first launch, or Settings → Check again), and its last answer. */
  graphicsCheck: GraphicsCheck | null = null;
  graphicsResult: CheckResult | null = null;
  private listeners = new Set<Listener>();
  private lastFrameAt = 0;

  constructor(
    readonly client: SimClient,
    readonly world: ClientWorld,
    readonly renderer: GameRenderer,
  ) {
    client.onFrame((diff, perf, speed) => {
      this.world.applyFrame(diff);
      // The main menu's demo town runs quietly.
      if (diff.events && !this.inMenu()) this.onEvents(diff.events);
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
    this.names = new StreetNames(world);
    this.labels = new StreetLabels(this);
    this.tools = new ToolManager(this);
    this.overlay = new OverlayController(this);
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
    return this.client.command(cmd);
  }

  openPanel(p: Game['panel']): void {
    this.panel = this.panel === p ? null : p;
    this.notify();
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
    const line = sel?.kind === 'civic' ? this.world.lines.find((l) => l.depot === sel.id) : undefined;
    const legs = car?.legs ?? line?.legs;
    const net = this.world.net;
    this.renderer.routeTint.show(
      legs
        ? [...new Set(legs.map((l) => l.seg))]
            .filter((id) => this.world.netState.segments.has(id))
            .map((id) => ({ curve: net.curve(id), v: [1, 1], half: 2.5 }))
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
      else if (e.kind === 'roadRepaired')
        this.notice('roadRepaired', 'A damaged road reopened.', 'ok', undefined, false);
      else if (e.kind === 'decayed')
        this.notice(
          'decayed',
          'An abandoned building fell into ruin; the lot will clear.',
          'info',
          at,
          false,
        );
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
    if (this.mode === 'play' && this.screens.length === 0) {
      this.speedBeforeMenu = this.speed;
      this.setSpeed(0);
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
    if (this.saving) return false;
    this.saving = true;
    this.notify();
    try {
      const s = await this.client.save();
      await writeSlot(slot, s, label);
      this.lastSavedAt = performance.now();
      if (slot !== 'auto') this.slot = slot;
      if (!quiet) this.toast(`Saved “${s.meta.cityName}”`, 'ok');
      return true;
    } catch (e) {
      this.toast(`Save failed: ${e instanceof Error ? e.message : String(e)}`, 'bad');
      return false;
    } finally {
      this.saving = false;
      this.notify();
    }
  }

  /** Autosave now and then (settings), unless the city has gone bankrupt. */
  private autosave(now: number): void {
    const every = this.settings.autosaveMinutes * 60_000;
    if (this.mode !== 'play' || every <= 0 || this.saving || this.world.stats.bankrupt) return;
    if (!this.lastSavedAt) this.lastSavedAt = now;
    if (now - this.lastSavedAt < every) return;
    void this.saveTo('auto', 'Autosave', true);
  }

  private quitUnsaved = false;

  /** Autosave, then go back to the main menu (if saving fails, a second try leaves without it). */
  async quitToMenu(): Promise<void> {
    if (!this.world.stats.bankrupt && !this.quitUnsaved && !(await this.saveTo('auto', 'Autosave', true))) {
      this.quitUnsaved = true;
      this.toast('The city could not be saved. Choose Quit again to leave without saving.', 'bad', 8000);
      return;
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
    if (this.tip || !this.settings.tips || this.settings.tutorialStep >= 0) return;
    const seen = new Set(this.settings.seenTips);
    const tip = TIPS.find((t) => !seen.has(t.id) && t.when(this));
    if (tip) {
      this.tip = tip;
      this.updateSettings({ seenTips: [...this.settings.seenTips, tip.id] });
    }
  }

  dismissTip(turnOff = false): void {
    this.tip = null;
    if (turnOff) this.updateSettings({ tips: false });
    else this.notify();
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
    this.speed = speed;
    this.client.setSpeed(speed);
    this.notify();
  }

  /** Fly the camera to a spot (advisors, notifications), optionally opening a data map. */
  flyTo(at: { x: number; z: number }, map?: string): void {
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

  /** Called every animation frame. */
  frame(now: number): void {
    const dt = this.lastFrameAt ? Math.min(0.1, (now - this.lastFrameAt) / 1000) : 1 / 60;
    this.lastFrameAt = now;
    this.fps = this.fps * 0.9 + (1 / Math.max(dt, 1e-4)) * 0.1;
    const t0 = performance.now();
    const w = this.world;
    if (this.speed > 0) {
      const next = w.displayTick + dt * SPEED_TICKS_PER_SECOND[this.speed];
      w.displayTick = Math.min(next, w.stats.tick + 8);
    }
    const check = this.graphicsCheck?.frame(now, document.visibilityState === 'visible');
    if (check) this.finishGraphicsCheck(check);
    // The main menu slowly circles the backdrop map.
    if (this.mode === 'menu') this.renderer.controller.goal.yaw += dt * 0.025;
    else this.autosave(now);
    this.renderer.frame(dt);
    this.labels.update();
    if (this.audio && now - this.ambientAt > 250) {
      this.ambientAt = now;
      this.audio.update(ambientScene(w, this.renderer, this.speed === 0));
    }
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  }
}
