/**
 * What the page keeps of the atom bomb that the sim doesn't (M40 step 11): which tab the war room is on
 * (a card opens it on the Bomb tab), the card a bomb leaves behind until the player has read it, and the
 * seam step 11b's effects fill (the missile on screen, for "Look at the missile"). All of it is the
 * page's: the sim holds the facts, and the cards read them from the summary.
 */
import { aftermath } from '../ui/atomView';

/** The war room's tabs (M34 to M40). */
export type WarTab =
  | 'forces'
  | 'send'
  | 'map'
  | 'research'
  | 'intel'
  | 'diplomacy'
  | 'trade'
  | 'atom'
  | 'economy'
  | 'readiness'
  | 'reports';

/**
 * The missile in the sky, as the effects (`src/render/atom.ts`, step 11b) offer it to the countdown
 * card: whether there is one to look at, and a camera that goes to it and follows. Until the effects
 * set it, the card hides its "Look at the missile" button.
 */
export interface MissileHook {
  available(): boolean;
  look(): void;
}

/** The card a bomb leaves behind: it landed, or the dome stopped it. */
export interface AftermathCard {
  kind: 'hit' | 'stopped';
  title: string;
  text: string;
}

/** How long after the pointer of a committed hold comes up a button that took the held one's place stays inert (ms), and the longest a press is waited for. */
const PRESS_GUARD_MS = 700;
const PRESS_LIMIT_MS = 15_000;

export class AtomUi {
  /** The card left by the last bomb to reach the city, until the player closes it. */
  after: AftermathCard | null = null;
  /** Filled by the 3D effects. */
  missile: MissileHook | null = null;
  /** The launch button is being held (the war room's `launch-hold`): which button, and when it was pressed (ms). */
  hold: { id: string; since: number } | null = null;

  constructor(private readonly host: { notify(): void }) {}

  /** A bomb landed on the city, or its dome stopped one: the card says what became of it. */
  showAfter(kind: 'hit' | 'stopped', info: { from?: string; fled?: number; levelled?: number }): void {
    this.after = { kind, ...aftermath(kind, info) };
    this.host.notify();
  }

  dismissAfter(): void {
    if (!this.after) return;
    this.after = null;
    this.host.notify();
  }

  /**
   * A held button committed (the launch started) and the pointer that held it has not come up yet: the card
   * it was on has just been replaced, so what the finger or the mouse is over is a button that wasn't there
   * when it came down, and the release (a tap synthesised on lifting a finger) must not press it.
   */
  private pressing = false;
  private pressedAt = -Infinity;
  private releasedAt = -Infinity;

  /** The held button committed: guard what takes its place until the pointer is let go (and a moment after). */
  commitPress(): void {
    if (typeof window === 'undefined') return;
    this.pressing = true;
    this.pressedAt = performance.now();
    const events = ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'mouseup', 'keyup', 'blur'];
    const up = () => {
      for (const t of events) window.removeEventListener(t, up, true);
      this.pressing = false;
      this.releasedAt = performance.now();
      this.host.notify();
    };
    for (const t of events) window.addEventListener(t, up, true);
  }

  /** True while a committed press is still down, and for `PRESS_GUARD_MS` after it (never for long if the release is lost). */
  guarded(now: number): boolean {
    if (this.pressing) return now - this.pressedAt < PRESS_LIMIT_MS;
    return now - this.releasedAt < PRESS_GUARD_MS;
  }

  /** A hold begins on a button (a press), or ends (a release, a slide off, the button going away). */
  holdBegin(id: string, now: number): void {
    this.hold = { id, since: now };
  }

  holdEnd(): void {
    this.hold = null;
  }

  /** The missile can be looked at (the effects have one in the sky). */
  get canLook(): boolean {
    return !!this.missile?.available();
  }

  /** Go to the missile; false when there is none. */
  look(): boolean {
    if (!this.canLook) return false;
    this.missile!.look();
    return true;
  }
}
