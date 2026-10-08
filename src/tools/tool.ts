import type { Vec2 } from '../sim/geom';

export interface ToolPointer {
  clientX: number;
  clientY: number;
  /** Ground point under the pointer (null when pointing at the sky). */
  ground: Vec2 | null;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** How far (px) the pointer may travel between pressing and releasing and still count as a click. */
export const CLICK_SLOP = 5;

export interface Tool {
  readonly id: string;
  /** When true, left-drag goes to the tool instead of panning the camera. */
  readonly usesLeftDrag: boolean;
  /**
   * The tool acts on a click, not a drag (P3): the manager calls `pointerDown` when the left button
   * comes up within CLICK_SLOP of where it went down, and a longer drag pans the camera. Needs
   * `usesLeftDrag = false`.
   */
  readonly clickOnly?: boolean;
  activate(): void;
  deactivate(): void;
  /** Esc / right-click: abandon the current action. Returns true if something was cancelled. */
  cancel(): boolean;
  pointerDown(p: ToolPointer): void;
  pointerMove(p: ToolPointer): void;
  pointerUp(p: ToolPointer): void;
  key?(e: KeyboardEvent): boolean;
}

export interface ToolHint {
  x: number;
  y: number;
  text: string;
  tone: 'ok' | 'bad' | 'info' | 'warn';
}

/**
 * A question a tool asks at the pointer before it acts (P2: a road or an upgrade that would
 * demolish buildings), answered with its two buttons or Escape.
 */
export interface ToolQuestion {
  x: number;
  y: number;
  text: string;
  yes: string;
  no: string;
  onYes: () => void;
  onNo: () => void;
}
