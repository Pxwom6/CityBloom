/**
 * The first-city tutorial's runner (M42): which card shows (a first-problem lesson ahead of the step
 * it interrupts), steps ticking themselves off, a card holding the game still while it's read and
 * flying the camera where it matters (once, when it first shows), leaving and coming back, and what
 * the player has opened that a step waits for. The steps themselves are `TUTORIAL` and
 * `TUTORIAL_EVENTS` in `tutorial.ts`.
 */
import type { Game } from '../game';
import { TUTORIAL, TUTORIAL_EVENTS, tutorialSaw, type TutorialStep } from './tutorial';
import { lessonBase, LESSON, type Lesson, type LessonBase } from './lessons';

export interface TutorialCardView {
  step: TutorialStep;
  /** The step's place (-1 for a first-problem lesson). */
  index: number;
  total: number;
  event: boolean;
  /** The lesson this card belongs to (Learn), if it's a lesson's. */
  lesson?: Lesson;
}

export class TutorialRunner {
  /** What the player has opened that a step waits for: the budget, the advisors, a coverage map. */
  readonly saw = new Set<string>();
  /** A first-problem lesson being shown, ahead of the step it interrupted. */
  event: TutorialStep | null = null;
  /** The card last shown (its id), so a new one pauses and moves the camera once. */
  private shownId: string | null = null;
  /** The speed a card held the game still from, given back once it's passed. */
  private held: Game['speed'] | null = null;
  /** The speed the showing card will give back when passed (null: it didn't stop time). */
  get heldSpeed(): Game['speed'] | null {
    return this.held;
  }
  /** A lesson being played (Learn), its step, and the town as it found it. */
  lesson: Lesson | null = null;
  /** Hold the card as it is (test builds' pictures of each step): nothing ticks off or interrupts. */
  frozen = false;
  lessonStep = 0;
  base: LessonBase | null = null;

  constructor(private readonly g: Game) {}

  start(): void {
    this.event = null;
    this.g.updateSettings({ tutorialStep: 0, tutorialAway: false, tutorialSeen: [] });
  }

  /** Play a lesson (Learn) from its first step, on the town it opened. */
  startLesson(id: string): boolean {
    const l = LESSON.get(id);
    if (!l || !l.steps.length) return false;
    this.lesson = l;
    this.lessonStep = 0;
    this.base = lessonBase(this.g);
    this.event = null;
    this.check();
    return true;
  }

  /** The card to show now: a lesson's step, a first-problem lesson, or the running step (null: none). */
  card(): TutorialCardView | null {
    if (this.lesson) {
      const step = this.lesson.steps[this.lessonStep];
      return step
        ? { step, index: this.lessonStep, total: this.lesson.steps.length, event: false, lesson: this.lesson }
        : null;
    }
    if (this.event) return { step: this.event, index: -1, total: TUTORIAL.length, event: true };
    const k = this.g.settings.tutorialStep;
    if (k < 0 || k >= TUTORIAL.length || this.g.settings.tutorialAway) return null;
    return { step: TUTORIAL[k]!, index: k, total: TUTORIAL.length, event: false };
  }

  /** Move on: a lesson is put away, or the step is passed (the last one finishes the tutorial). */
  next(): void {
    if (this.lesson) {
      this.lessonStep++;
      if (this.lessonStep >= this.lesson.steps.length) this.finishLesson();
      this.check();
      this.g.notify();
      return;
    }
    if (this.event) {
      this.event = null;
      this.check();
      this.g.notify();
      return;
    }
    const next = this.g.settings.tutorialStep + 1;
    this.g.updateSettings({ tutorialStep: next >= TUTORIAL.length ? -1 : next });
    this.check();
  }

  /** Leave for now: the card goes, and "Continue the tutorial" brings it back at the same step. */
  leave(): void {
    this.event = null;
    this.g.updateSettings({ tutorialAway: true });
    this.check();
  }

  resume(): void {
    this.g.updateSettings({ tutorialAway: false });
    this.check();
  }

  end(): void {
    this.event = null;
    this.g.updateSettings({ tutorialStep: -1, tutorialAway: false });
    this.check();
  }

  /** A lesson played to its end: marked done for the Learn screen. */
  private finishLesson(): void {
    const l = this.lesson;
    this.lesson = null;
    if (l && !this.g.settings.lessonsDone.includes(l.id))
      this.g.updateSettings({ lessonsDone: [...this.g.settings.lessonsDone, l.id] });
  }

  /** Leave a lesson part way (Keep playing, or the menu). */
  endLesson(): void {
    this.lesson = null;
    this.check();
  }

  /** A card held the game still: time runs again as it was (unless the player has set it going). */
  private giveBack(): void {
    if (this.held !== null && this.g.speed === 0 && !this.g.net) this.g.setSpeed(this.held);
    this.held = null;
  }

  /**
   * Remember what the player has open now: called as panels, screens and data maps open (the game's
   * `notify`), so one opened and closed between two checks still counts (phase 6 end: advisors opened
   * and closed within the check's two seconds left the card waiting for good).
   */
  noteSeen(): void {
    const g = this.g;
    for (const k of tutorialSaw(g.panel, g.overlay?.active ?? null, g.screen)) this.saw.add(k);
  }

  /**
   * Called with the game's guidance check: remember what the player opened, finish steps already
   * done, raise a first-problem lesson when its moment comes, and give each new card its pause and
   * camera once.
   */
  check(): void {
    const g = this.g;
    this.noteSeen();
    // A lesson's steps tick themselves off as the tutorial's do (no first-problem lessons in one).
    if (this.lesson) {
      while (this.lessonStep < this.lesson.steps.length && this.lesson.steps[this.lessonStep]!.done?.(g))
        this.lessonStep++;
      if (this.lessonStep >= this.lesson.steps.length) this.finishLesson();
    }
    if (this.frozen) return;
    let step = g.settings.tutorialStep;
    while (step >= 0 && step < TUTORIAL.length && TUTORIAL[step]!.done?.(g)) step++;
    if (step !== g.settings.tutorialStep) {
      g.updateSettings({ tutorialStep: step >= TUTORIAL.length ? -1 : step });
      g.audio?.play('good');
    }
    const running = g.settings.tutorialStep >= 0 && !g.settings.tutorialAway;
    if (!running) this.event = null;
    if (this.event?.done?.(g)) this.event = null;
    // First problems come once the city is running (from "Let time run": a fire in the first weeks burnt
    // a phone's small town down while that card waited for 40 residents, unexplained; phase 6 end), one
    // at a time, each once.
    const timeStep = TUTORIAL.findIndex((t) => t.id === 'time');
    if (running && !this.lesson && !this.event && g.settings.tutorialStep >= timeStep) {
      const ev = TUTORIAL_EVENTS.find((e) => !g.settings.tutorialSeen.includes(e.id) && e.when?.(g));
      if (ev) {
        this.event = ev;
        g.updateSettings({ tutorialSeen: [...g.settings.tutorialSeen, ev.id] });
      }
    }
    const card = this.card();
    const id = card?.step.id ?? null;
    if (id === this.shownId) return;
    this.shownId = id;
    this.giveBack();
    if (!card) return;
    if (card.step.pause && !g.net && g.speed > 0) {
      this.held = g.speed;
      g.setSpeed(0);
    }
    const pose = card.step.camera?.(g);
    if (pose) g.setCamera(pose, false);
    g.notify();
  }
}
