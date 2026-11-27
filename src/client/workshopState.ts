/**
 * Where a player is in the Workshop (M47), kept on the game so closing My buildings doesn't lose it:
 * the step, what they're making, their words for the prompt, the file they checked and what the check
 * said, and the model once it's in My buildings.
 */
import type { BakedModel } from '../models/baked';
import { CUSTOM, type CustomTarget } from '../models/customCheck';
import { teacherNotes, workshopTarget, type TeacherNote } from '../models/workshop';
import { checkModelFile, modelHash } from './modelCheck';

export const WORKSHOP_STEPS = ['Pick', 'Make', 'Check', 'See', 'Use'] as const;
export type WorkshopStep = 0 | 1 | 2 | 3 | 4;

export interface WorkshopCheck {
  ok: boolean;
  notes: TeacherNote[];
  /** Where the problems are, as a picture's address (a refused model only). */
  picture: string | null;
  baked: BakedModel | null;
  hash: string;
}

export class WorkshopState {
  step: WorkshopStep = 0;
  target: CustomTarget = { kind: 'landmark', size: 2 };
  name = '';
  idea = '';
  makeTab: 'ai' | 'blender' = 'ai';
  file: { bytes: Uint8Array; name: string } | null = null;
  check: WorkshopCheck | null = null;
  checking = false;
  /** The model's hash once it's in My buildings. */
  added: string | null = null;
  onChange: (() => void) | null = null;

  private changed(): void {
    this.onChange?.();
  }

  go(step: WorkshopStep): void {
    this.step = step;
    this.changed();
  }

  pick(t: CustomTarget): void {
    this.target = t;
    // A check was for the old target's site and budget.
    this.dropCheck();
    this.changed();
  }

  private dropCheck(): void {
    if (this.check?.picture) URL.revokeObjectURL(this.check.picture);
    this.check = null;
    this.added = null;
  }

  /** Check a file for what's picked: the check's problems as a teacher's notes. */
  async checkFile(bytes: Uint8Array, name: string): Promise<WorkshopCheck | null> {
    this.dropCheck();
    this.file = { bytes, name };
    this.checking = true;
    this.changed();
    const target = this.target;
    const site = workshopTarget(target).site;
    let out: WorkshopCheck;
    if (bytes.length > CUSTOM.maxParse) {
      const mb = (bytes.length / 1_048_576).toFixed(0);
      out = {
        ok: false,
        notes: teacherNotes([{ words: `It is ${mb} MB: the game takes models up to 1 MB`, parts: [] }], site),
        picture: null,
        baked: null,
        hash: '',
      };
    } else {
      const [{ result, picture }, hash] = await Promise.all([checkModelFile(bytes, target), modelHash(bytes)]);
      out = {
        ok: result.ok,
        notes: teacherNotes(result.problems, site),
        picture: picture ? URL.createObjectURL(picture) : null,
        baked: result.baked,
        hash,
      };
    }
    // The player picked something else meanwhile: this answer is for nothing.
    if (this.target !== target) return null;
    this.check = out;
    this.checking = false;
    this.changed();
    return out;
  }

  /** Start again on a new building (the pick stays). */
  again(): void {
    this.dropCheck();
    this.file = null;
    this.name = '';
    this.idea = '';
    this.step = 0;
    this.changed();
  }
}
