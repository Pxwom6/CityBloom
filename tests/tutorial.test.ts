/**
 * The first-city tutorial (M42): steps tick themselves off, a card pauses once and gives time back,
 * the camera flies once per card, first problems interrupt once each, and the tutorial can be left,
 * continued, skipped a step at a time and ended. A stand-in game holds just what the runner reads.
 */
import { describe, expect, it } from 'vitest';
import { TIPS, TUTORIAL, TUTORIAL_EVENTS, TUTORIAL_IDS, wordsFor } from '../src/client/tutorial';
import { LESSONS } from '../src/client/lessons';
import { TutorialRunner } from '../src/client/tutorialRunner';
import type { Game } from '../src/game';
import { ZONE_C, ZONE_I, ZONE_R } from '../src/data/zones';

interface Fake {
  settings: { tutorialStep: number; tutorialAway: boolean; tutorialSeen: string[] };
  speed: number;
  net: null;
  panel: string | null;
  overlay: { active: string | null };
  camera: unknown[];
  advice: { advisor: string; severity: number }[];
  manualSaves: number;
  tutorialSaw: Set<string>;
  world: {
    stats: { population: number; utilities: { power: { supply: number; demand: number; unserved: number } } };
    netState: {
      segments: Map<number, { type: string }>;
      blocks: Map<number, { zone: number[] }>;
      nodes: Map<number, { x: number; z: number }>;
    };
    highway: { connect: number };
    civics: Map<number, { def: string }>;
    buildings: Map<number, { x: number; z: number; flags: number }>;
  };
}

function setup() {
  const f: Fake = {
    settings: { tutorialStep: -1, tutorialAway: false, tutorialSeen: [] },
    speed: 1,
    net: null,
    panel: null,
    overlay: { active: null },
    camera: [],
    advice: [],
    manualSaves: 0,
    tutorialSaw: new Set(),
    world: {
      stats: { population: 0, utilities: { power: { supply: 0, demand: 0, unserved: 0 } } },
      netState: { segments: new Map(), blocks: new Map(), nodes: new Map([[1, { x: 0, z: 0 }]]) },
      highway: { connect: 1 },
      civics: new Map(),
      buildings: new Map(),
    },
  };
  const game = {
    ...f,
    get settings() {
      return f.settings;
    },
    get speed() {
      return f.speed;
    },
    get panel() {
      return f.panel;
    },
    get advice() {
      return f.advice;
    },
    get manualSaves() {
      return f.manualSaves;
    },
    updateSettings: (p: Partial<Fake['settings']>) => Object.assign(f.settings, p),
    setSpeed: (s: number) => (f.speed = s),
    setCamera: (p: unknown) => f.camera.push(p),
    notify: () => undefined,
    audio: null,
  };
  const runner = new TutorialRunner(game as unknown as Game);
  Object.defineProperty(game, 'tutorialSaw', { get: () => runner.saw });
  const at = () => runner.card()?.step.id ?? null;
  const build = {
    road: () => f.world.netState.segments.set(9, { type: 'street' }),
    zones: () => f.world.netState.blocks.set(1, { zone: [ZONE_R, ZONE_C, ZONE_I] }),
    civic: (def: string) => f.world.civics.set(f.world.civics.size + 1, { def }),
  };
  return { f, runner, at, build };
}

describe('the first-city tutorial', () => {
  it('has short steps with unique names, ending at a thousand residents', () => {
    expect(new Set(TUTORIAL_IDS).size).toBe(TUTORIAL_IDS.length);
    expect(TUTORIAL.length).toBeGreaterThanOrEqual(15);
    expect(TUTORIAL.some((t) => t.id === 'grow1000')).toBe(true);
    for (const t of [...TUTORIAL, ...TUTORIAL_EVENTS]) {
      // Short sentences: none over 25 words, three sentences at most... four for the longest.
      const sentences = t.text.split(/(?<=[.!?:])\s+/);
      expect(sentences.length, t.id).toBeLessThanOrEqual(4);
      for (const x of sentences) expect(x.split(/\s+/).length, `${t.id}: ${x}`).toBeLessThanOrEqual(25);
    }
  });

  it('ticks off what the player has already done, so a builder is never held up', () => {
    const { f, runner, at, build } = setup();
    runner.start();
    runner.check();
    expect(at()).toBe('welcome');
    runner.next();
    expect(at()).toBe('road');
    // Everything up to water built before the card was read: straight to "Let time run".
    build.road();
    build.zones();
    build.civic('wind');
    build.civic('pump');
    build.civic('septic');
    runner.check();
    expect(at()).toBe('time');
    f.world.stats.population = 60;
    runner.check();
    expect(at()).toBe('demand');
  });

  it('holds the game still while a card is read, once, and gives time back when it is passed', () => {
    const { f, runner, at } = setup();
    runner.start();
    f.settings.tutorialStep = TUTORIAL.findIndex((t) => t.id === 'demand');
    f.speed = 2;
    runner.check();
    expect(at()).toBe('demand');
    expect(f.speed).toBe(0);
    // The player sets time going again while reading: the card doesn't stop it a second time.
    f.speed = 1;
    runner.check();
    expect(f.speed).toBe(1);
    f.speed = 0;
    runner.next();
    expect(at()).toBe('grow150');
    expect(f.speed).toBe(2);
  });

  it('flies the camera once per card', () => {
    const { f, runner } = setup();
    runner.start();
    runner.check();
    runner.check();
    expect(f.camera).toHaveLength(1);
    runner.next();
    expect(f.camera).toHaveLength(2);
  });

  it('counts the advisors opened and closed between two checks (phase 6 end)', () => {
    const { f, runner, at } = setup();
    runner.start();
    f.settings.tutorialStep = TUTORIAL.findIndex((t) => t.id === 'advisors');
    runner.check();
    expect(at()).toBe('advisors');
    // Opened (the game notes it as the panel opens) and closed again before the next check.
    f.panel = 'advisors';
    runner.noteSeen();
    f.panel = null;
    runner.check();
    expect(at()).toBe('grow500');
  });

  it('waits for the budget and a coverage map to be opened, and stays beside the budget for taxes', () => {
    const { f, runner, at } = setup();
    runner.start();
    f.settings.tutorialStep = TUTORIAL.findIndex((t) => t.id === 'budget');
    runner.check();
    expect(at()).toBe('budget');
    f.panel = 'budget';
    runner.check();
    expect(at()).toBe('taxes');
    expect(runner.card()!.step.panel).toBe('budget');
    f.settings.tutorialStep = TUTORIAL.findIndex((t) => t.id === 'coverage');
    runner.check();
    expect(at()).toBe('coverage');
    f.overlay.active = 'fire';
    runner.check();
    expect(at()).toBe('advisors');
  });

  it('teaches each first problem once, when it comes, ahead of the step it interrupts', () => {
    const { f, runner, at, build } = setup();
    runner.start();
    // Before the city runs, a fire waits.
    f.world.buildings.set(1, { x: 50, z: 60, flags: 128 });
    runner.check();
    expect(at()).toBe('welcome');
    f.settings.tutorialStep = TUTORIAL.findIndex((t) => t.id === 'grow150');
    runner.check();
    expect(at()).toBe('firstFire');
    expect(f.camera.at(-1)).toMatchObject({ x: 50, z: 60 });
    // Put out: the lesson goes by itself, and doesn't come back for the next fire.
    f.world.buildings.set(1, { x: 50, z: 60, flags: 0 });
    runner.check();
    expect(at()).toBe('grow150');
    f.world.buildings.set(2, { x: 1, z: 1, flags: 128 });
    runner.check();
    expect(at()).toBe('grow150');
    // A power cut, then a jam, each once; "Got it" puts a lesson away.
    build.civic('wind');
    f.world.stats.utilities.power = { supply: 10, demand: 20, unserved: 8 };
    runner.check();
    expect(at()).toBe('firstPowerCut');
    runner.next();
    f.advice = [{ advisor: 'transport', severity: 2 }];
    runner.check();
    expect(at()).toBe('firstJam');
    runner.next();
    runner.check();
    expect(at()).toBe('grow150');
    expect(f.settings.tutorialSeen).toEqual(['firstFire', 'firstPowerCut', 'firstJam']);
  });

  it('explains a fire that comes while the first families are still arriving (phase 6 end)', () => {
    const { f, runner, at } = setup();
    runner.start();
    f.settings.tutorialStep = TUTORIAL.findIndex((t) => t.id === 'water');
    f.world.buildings.set(1, { x: 50, z: 60, flags: 128 });
    runner.check();
    // Still building: the fire waits.
    expect(at()).toBe('water');
    // Time runs: the card waits for 40 residents, and the fire is explained.
    f.settings.tutorialStep = TUTORIAL.findIndex((t) => t.id === 'time');
    runner.check();
    expect(at()).toBe('firstFire');
  });

  it('can be left and continued at the same step, skipped a step at a time, and ended', () => {
    const { f, runner, at } = setup();
    runner.start();
    f.settings.tutorialStep = TUTORIAL.findIndex((t) => t.id === 'services');
    runner.check();
    runner.leave();
    expect(at()).toBeNull();
    expect(f.settings.tutorialStep).toBe(TUTORIAL.findIndex((t) => t.id === 'services'));
    runner.resume();
    expect(at()).toBe('services');
    runner.next();
    expect(at()).toBe('coverage');
    runner.end();
    expect(at()).toBeNull();
    expect(f.settings.tutorialStep).toBe(-1);
  });

  it('finishes at a thousand residents, after a save', () => {
    const { f, runner, at } = setup();
    runner.start();
    f.settings.tutorialStep = TUTORIAL.findIndex((t) => t.id === 'save');
    runner.check();
    expect(at()).toBe('save');
    f.manualSaves = 1;
    runner.check();
    expect(at()).toBe('grow1000');
    f.world.stats.population = 1000;
    runner.check();
    expect(at()).toBe('finish');
    runner.next();
    expect(f.settings.tutorialStep).toBe(-1);
  });
});

describe('the words on a touch screen (phase 6 end)', () => {
  // A mouse's or a keyboard's words: a phone's first city was told to right-drag, scroll and press Esc.
  const MOUSE =
    /\b(click|clicks|clicking|right-drag|scroll|hover|space bar|Esc|Escape|Shift\+\w)\b|\([A-Z0-9]\)/i;
  const everything = [
    ...TUTORIAL.map((t) => ({ where: `tutorial ${t.id}`, ...t })),
    ...TUTORIAL_EVENTS.map((t) => ({ where: `lesson ${t.id}`, ...t })),
    ...LESSONS.flatMap((l) => l.steps.map((t) => ({ where: `${l.id} ${t.id}`, ...t }))),
    ...TIPS.map((t) => ({ where: `tip ${t.id}`, ...t })),
  ];

  it('every card, lesson and tip reads without a mouse or keys on a touch screen', () => {
    for (const c of everything) expect(wordsFor(c, true), c.where).not.toMatch(MOUSE);
  });

  it('leaves out the keys and makes clicks taps where a card has no touch words of its own', () => {
    const t = (text: string) => wordsFor({ text }, true);
    expect(t('Pause (Escape) → Report a problem sends a note.')).toBe(
      'Pause → Report a problem sends a note.',
    );
    expect(t('City history (Y) → Make timelapse.')).toBe('City history → Make timelapse.');
    expect(t('Open the war room (Shift+M, or its button in the top bar).')).toBe(
      'Open the war room (its button in the top bar).',
    );
    expect(t('Click a barracks; or click one.')).toBe('Tap a barracks; or tap one.');
    expect(wordsFor({ text: 'Click it (Y).' }, false)).toBe('Click it (Y).');
  });

  it('touch words never speak of a mouse or keys, and keep the cards short', () => {
    for (const c of everything) {
      if (!c.touch) continue;
      expect(c.touch, c.where).not.toMatch(MOUSE);
      const sentences = c.touch.split(/(?<=[.!?:])\s+/);
      expect(sentences.length, c.where).toBeLessThanOrEqual(4);
      for (const x of sentences) expect(x.split(/\s+/).length, `${c.where}: ${x}`).toBeLessThanOrEqual(25);
    }
  });

  it('a card shows its touch words on a touch screen and its own words otherwise', () => {
    const welcome = TUTORIAL.find((t) => t.id === 'welcome')!;
    expect(wordsFor(welcome, false)).toContain('right-drag');
    expect(wordsFor(welcome, true)).toContain('pinch to zoom');
    const homes = TUTORIAL.find((t) => t.id === 'homes')!;
    expect(wordsFor(homes, true)).toBe(homes.text);
  });
});
