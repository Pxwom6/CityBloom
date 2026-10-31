/**
 * Operations between friends, the page's part (M37, `docs/plans/M37-design.md`, key call 14). An
 * agent the city sent to a friend's city waits there, and the blackout tower aimed at a friend
 * charges, until the region room has decided: this page pins each (`spySettling`), puts it to the
 * region with the id the city's sim gives it, and hands the verdict back to the city
 * (`missionResult`). A look round that worked brings a dossier, made here from the friend's latest
 * save in the region. With no word, it asks again later with the same id, and the region, which
 * remembers its verdicts, gives the same answer.
 */
import type { Command, CommandResult } from '../sim/commands';
import type { OpOut, OpSent } from '../net/regionLink';
import { readSaveFile, type SaveFile } from '../sim/save';
import { dossierOf, type Dossier, type FriendOpWaiting } from '../sim/systems/regionOps';

/** What the city's game offers this helper. */
export interface OpsHost {
  command(cmd: Command): Promise<CommandResult>;
  /**
   * Put an operation to the region: its answer, or null when none came (the region is out of reach:
   * ask again later). A city in no region at all is answered with a refusal at once.
   */
  post(op: OpOut): Promise<OpSent>;
  /** The latest save the region keeps of a friend's city. */
  fetchSave(slot: number): Promise<SaveFile>;
  changed?(): void;
}

/** How long to wait before asking the region again when it didn't answer (ms). */
const RETRY = 20_000;

export class RegionOps {
  private busy = new Set<string>();
  private waitUntil = new Map<string, number>();

  constructor(private readonly host: OpsHost) {}

  /** Put every operation waiting for the region to it (call with the war summary's list). */
  check(waiting: FriendOpWaiting[]): void {
    const now = performance.now();
    for (const o of waiting)
      if (!this.busy.has(o.key) && now >= (this.waitUntil.get(o.key) ?? 0)) void this.settle(o);
  }

  /** One operation: pinned, put to the region, and its verdict handed to the city. */
  async settle(o: FriendOpWaiting): Promise<void> {
    this.busy.add(o.key);
    try {
      // Pinned while the region decides (it then waits longer for the answer).
      if (!o.settling && !(await this.host.command({ type: 'spySettling', mission: o.mission, on: true })).ok)
        return;
      const answer = await this.host.post({
        to: o.slot,
        id: o.key,
        op: o.op,
        ...(o.target ? { target: o.target } : {}),
        ...(o.branch ? { branch: o.branch } : {}),
      });
      if (!answer) {
        this.waitUntil.set(o.key, performance.now() + RETRY);
        return;
      }
      if (!answer.kept) {
        // Not now (the region's pace): asked again then, still pinned.
        if (answer.later) {
          this.waitUntil.set(o.key, performance.now() + answer.later);
          return;
        }
        await this.host.command({
          type: 'missionResult',
          mission: o.mission,
          outcome: 'refused',
          reason: answer.reason,
        });
        return;
      }
      // A look round that worked: what the friend's latest save in the region shows.
      let dossier: Dossier | null = null;
      if (answer.outcome === 'success' && o.op === 'reveal')
        try {
          dossier = dossierOf(readSaveFile(await this.host.fetchSave(o.slot)));
        } catch {
          // The save couldn't be had: the agent still looked round, and says so.
        }
      await this.host.command({
        type: 'missionResult',
        mission: o.mission,
        outcome: answer.outcome,
        ...(answer.stole ? { stole: answer.stole } : {}),
        ...(dossier ? { dossier } : {}),
      });
    } catch {
      this.waitUntil.set(o.key, performance.now() + RETRY);
    } finally {
      this.busy.delete(o.key);
      this.host.changed?.();
    }
  }
}
