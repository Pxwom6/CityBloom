/**
 * The first-city tutorial's runner (M42): which card shows (a first-problem lesson ahead of the step
 * it interrupts), steps ticking themselves off, a card holding the game still while it's read and
 * flying the camera where it matters (once, when it first shows), leaving and coming back, and what
 * the player has opened that a step waits for. The steps themselves are `TUTORIAL` and
 * `TUTORIAL_EVENTS` in `tutorial.ts`.
 */
import type { Game } from '../game';
import { TUTORIAL, TUTORIAL_EVENTS, tutorialSaw, type TutorialStep } from './tutorial';

export interface TutorialCardView {
  step: TutorialStep;
  /** The step's place (-1 for a first-problem lesson). */
  index: number;
  total: number;
  event: boolean;
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

  constructor(private readonly g: Game) {}

  start(): void {
    this.event = null;
    this.g.updateSettings({ tutorialStep: 0, tutorialAway: false, tutorialSeen: [] });
  }

  /** The card to show now: a first-problem lesson, or the running step (null: none, or left for now). */
  card(): TutorialCardView | null {
    if (this.event) return { step: this.event, index: -1, total: TUTORIAL.length, event: true };
    const k = this.g.settings.tutorialStep;
    if (k < 0 || k >= TUTORIAL.length || this.g.settings.tutorialAway) return null;
    return { step: TUTORIAL[k]!, index: k, total: TUTORIAL.length, event: false };
  }

  /** Move on: a lesson is put away, or the step is passed (the last one finishes the tutorial). */
  next(): void {
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

  /** A card held the game still: time runs again as it was (unless the player has set it going). */
  private giveBack(): void {
    if (this.held !== null && this.g.speed === 0 && !this.g.net) this.g.setSpeed(this.held);
    this.held = null;
  }

  /**
   * Called with the game's guidance check: remember what the player opened, finish steps already
   * done, raise a first-problem lesson when its moment comes, and give each new card its pause and
   * camera once.
   */
  check(): void {
    const g = this.g;
    for (const k of tutorialSaw(g.panel, g.overlay.active)) this.saw.add(k);
    let step = g.settings.tutorialStep;
    while (step >= 0 && step < TUTORIAL.length && TUTORIAL[step]!.done?.(g)) step++;
    if (step !== g.settings.tutorialStep) {
      g.updateSettings({ tutorialStep: step >= TUTORIAL.length ? -1 : step });
      g.audio?.play('good');
    }
    const running = g.settings.tutorialStep >= 0 && !g.settings.tutorialAway;
    if (!running) this.event = null;
    if (this.event?.done?.(g)) this.event = null;
    // First problems come once the city is running (past "Let time run"), one at a time, each once.
    const timeStep = TUTORIAL.findIndex((t) => t.id === 'time');
    if (running && !this.event && g.settings.tutorialStep > timeStep) {
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
