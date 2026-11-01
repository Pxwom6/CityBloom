/**
 * Operations between friends, the page's part (M37, `docs/plans/M37-design.md`, key call 14). An
 * agent the city sent to a friend's city waits there, and the blackout tower aimed at a friend
 * charges, until the region room has decided: this page pins each (`spySettling`), puts it to the
 * region with the id the city's sim gives it, and hands the verdict back to the city
 * (`missionResult`). A look round that worked brings a dossier, made here from the friend's latest
 * save in the region. With no word, it asks again later with the same id, and the region, which
 * remembers its verdicts, gives the same answer. The atom bomb aimed at a friend (M40 step 10) goes
 * this way too: the city's sim lists it among the operations waiting, and the region's `opKept`
 * is its `missionResult`; the city is saved right after it has applied that (the region holds the bomb
 * as used for good, so a crash must not take the firing back). The other end, an operation against this
 * city, is `resolveOp`.
 */
import type { Command, CommandResult } from '../sim/commands';
import type { BattleAnswer, OpOn, OpOut, OpSent } from '../net/regionLink';
import { readSaveFile, type SaveFile } from '../sim/save';
import { strikeLater } from '../sim/systems/atom';
import { OP_TAKEN, dossierOf, type Dossier, type FriendOpWaiting } from '../sim/systems/regionOps';

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
  /**
   * Save the city now (the game's autosave): whether it did (a save already under way says no). Called right after
   * the city has applied the region's word that a strike of its own atom bomb was kept: the region has the bomb as
   * used for good, so a page that crashed and came back from an older save would be a city that never fired, and
   * could not send it again.
   */
  keep?(): Promise<boolean>;
  changed?(): void;
}

/** How long to wait before asking the region again when it didn't answer (ms). */
const RETRY = 20_000;

/** The city saved after a kept strike is tried this many times, this far apart (ms): a save already under way says no. */
export const KEEP_TRIES = 5;
export const KEEP_GAP = 1_000;

export class RegionOps {
  private busy = new Set<string>();
  private waitUntil = new Map<string, number>();

  constructor(private readonly host: OpsHost) {}

  /** The city saved, tried again a few times when a save was already under way; a save that still fails is the autosave's to make good. */
  private async keepCity(): Promise<void> {
    if (!this.host.keep) return;
    for (let k = 0; k < KEEP_TRIES; k++) {
      if (k) await new Promise((r) => setTimeout(r, KEEP_GAP));
      try {
        if (await this.host.keep()) return;
      } catch {
        /* tried again */
      }
    }
  }

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
      const r = await this.host.command({
        type: 'missionResult',
        mission: o.mission,
        outcome: answer.outcome,
        ...(answer.stole ? { stole: answer.stole } : {}),
        ...(dossier ? { dossier } : {}),
      });
      // The bomb has left (the city fired, a pariah): saved now, as a city that takes a strike is saved before the
      // region is told. (A failed save is the autosave's to make good in a few minutes; the room has the strike.)
      if (r.ok && o.op === 'atom') await this.keepCity();
    } catch {
      this.waitUntil.set(o.key, performance.now() + RETRY);
    } finally {
      this.busy.delete(o.key);
      this.host.changed?.();
    }
  }
}

/**
 * An operation another city made against this one, as the region decided it (M37), handed to the
 * city's own sim, which takes it once (M40: an atom bomb among them). `taken`: the sim has it (or had
 * it already), so the page keeps the city and the region can forget the operation; `refused`: it never
 * will, and the region forgets it; `later`: not now (a bomb is in the air already, or the news that goes with a
 * strike has not reached this city): it is offered again.
 */
export async function resolveOp(host: Pick<OpsHost, 'command'>, o: OpOn): Promise<BattleAnswer> {
  const r = await host.command({
    type: 'opResolve',
    from: o.from,
    id: o.id,
    op: o.op,
    outcome: o.outcome,
    ...(o.target ? { target: o.target } : {}),
    late: o.late,
  });
  if (r.ok || r.reason === OP_TAKEN) return 'taken';
  return strikeLater(r.reason) ? 'later' : 'refused';
}
