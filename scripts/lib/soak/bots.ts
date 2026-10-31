import { S, TAG, type BattleInput } from '../../../src/sim/battle/types';
import type { Sim } from '../../../src/sim/sim';
import type { UnitKind } from '../../../src/data/war';
import type { Player, Soak } from './world';

/**
 * What a player's hands do while the story plays: give orders in the battle they are in, answer the
 * proposals put to them, send an ally's help into a battle, and keep the army up. Every choice
 * comes from the soak's seeded dice, so a run can be played again.
 */

/** The units of a city at home (not out on an expedition) and fit to go: those under half health are still being repaired. */
export const homeUnits = (sim: Sim): { id: number; kind: UnitKind }[] =>
  [...(sim.state.war?.units.values() ?? [])]
    .filter((u) => u.away === undefined && u.hp >= 0.5)
    .map((u) => ({ id: u.id, kind: u.kind }));

/** Indexes of the structures in a battle's picture that carry `tag`. */
const structuresWith = (input: BattleInput, tag: number): number[] => {
  const out: number[] = [];
  const n = input.layout.structs.length / S.stride;
  for (let k = 0; k < n; k++) if ((input.layout.structs[k * S.stride + S.tags]! & tag) !== 0) out.push(k);
  return out;
};

export class Bots {
  constructor(private readonly w: Soak) {}

  /** Every frame: orders. */
  frame(): void {
    for (const p of this.w.players) this.commander(p);
  }

  /** Every second: answers, help, and (each game hour) training. */
  second(sec: number): void {
    for (const p of this.w.players) {
      if (!p.page?.ticking) continue;
      this.responder(p);
      this.helper(p);
      if (sec % 8 === 0) this.quartermaster(p);
    }
  }

  // ---------------------------------------------------------------- orders

  private commander(p: Player): void {
    const pg = p.page;
    if (!pg?.ticking || this.w.draining) return;
    const st = pg.live.state();
    if (!st || st.ended || st.handed) return;
    const input = pg.live.input();
    if (!input) return;
    const rng = this.w.rng;
    if (p.commands?.id !== st.id) {
      // A plan for this battle: six orders, the first a few seconds in.
      const at: number[] = [];
      let step = 20 + rng.int(40);
      for (let k = 0; k < 6; k++) {
        at.push(step);
        step += 50 + rng.int(150);
      }
      p.commands = { id: st.id, at, given: 0 };
    }
    const c = p.commands;
    if (c.given >= c.at.length || st.step < c.at[c.given]!) return;
    const k = c.given++;
    const attacker = st.role === 'attacker';
    const mine = attacker ? input.attacker.units.map((u) => u.id) : input.layout.defenders.map((u) => u.id);
    const theirs = attacker ? input.layout.defenders.map((u) => u.id) : input.attacker.units.map((u) => u.id);
    const subset = () => {
      const ids = mine.filter(() => rng.next() < 0.6);
      return ids.length ? ids : mine.slice(0, 1);
    };
    const military = structuresWith(input, TAG.military);
    const any = military.length ? military : structuresWith(input, 0);
    const structure = () => any[rng.int(Math.max(1, any.length))] ?? 0;
    let req: Parameters<typeof pg.live.order>[0];
    if (attacker) {
      // A raider holds some units back, goes for another objective, lets them go again, and sometimes gives up.
      if (k === 5 && rng.next() < 0.15) req = { kind: 'withdraw' };
      else
        req = (
          [
            { kind: 'hold', units: subset() },
            { kind: 'focus', target: structure() },
            { kind: 'free' },
            { kind: 'focus', target: structure(), units: subset() },
            { kind: 'hold', units: subset() },
            { kind: 'free' },
          ] as const
        )[k]!;
    } else {
      req = (
        [
          { kind: 'guard', units: subset(), target: structure() },
          { kind: 'focus', target: theirs[rng.int(Math.max(1, theirs.length))] ?? 0 },
          { kind: 'hold', units: subset() },
          { kind: 'free' },
          { kind: 'guard', units: subset(), target: structure() },
          { kind: 'focus', target: theirs[rng.int(Math.max(1, theirs.length))] ?? 0, units: subset() },
        ] as const
      )[k]!;
    }
    if (!pg.live.order({ ...req, ...('units' in req && req.units ? { units: [...req.units] } : {}) })) return;
    this.w.covered('orders');
    const b = this.w.battle(st.id);
    if (b) b.orders[st.role]++;
  }

  // ---------------------------------------------------------------- answers

  private responder(p: Player): void {
    const pg = p.page!;
    if (!p.up) return;
    const now = this.w.now();
    for (const pr of pg.fw.view().incoming) {
      const due = p.thinking.get(pr.id);
      if (due === undefined) {
        p.thinking.set(pr.id, now + 1_500 + this.w.rng.int(3_500));
        continue;
      }
      if (due === Infinity || now < due) continue;
      p.thinking.set(pr.id, Infinity);
      const accept = p.declineNext > 0 ? (p.declineNext--, false) : true;
      void pg.fw.answer(pr.id, accept).then((why) => {
        if (why) {
          this.w.note(`${p.name} can't say yes to ${pr.id}: ${why}`);
          void pg.fw.answer(pr.id, false);
        } else if (!accept) {
          this.w.covered('declined');
          this.w.note(`${p.name} turns down a proposal`);
        }
      });
    }
  }

  // ---------------------------------------------------------------- an ally's help

  private helper(p: Player): void {
    const w = this.w;
    const pg = p.page!;
    if (!p.up || w.draining) return;
    const own = pg.live.state();
    if (own && !own.ended) return;
    const help = pg.live.helping();
    const word = help
      ? `${help.state}${help.late ? ' (late)' : ''}${help.reason ? `: ${help.reason}` : ''}`
      : '';
    if (word !== p.helpWord) {
      p.helpWord = word;
      if (help)
        w.note(
          `${p.name}'s force in ${help.battle} is ${word}${help.lost !== null ? `; lost ${help.lost}` : ''}`,
        );
    }
    if (help) {
      if (help.state === 'done' && !help.late && help.lost !== null && !p.helpBooked.has(help.battle)) {
        p.helpBooked.add(help.battle);
        w.covered('helpBooked');
        w.note(`${p.name}'s force came home from ${help.battle}: ${help.lost} lost, ${help.hurt ?? 0} hurt`);
      }
      return;
    }
    const pacts = pg.fw.view().pacts;
    const allyOf = (slot: number) =>
      pacts.some(
        (x) =>
          (x.kind === 'alliance' || x.kind === 'defensivePact') &&
          ((x.a === p.slot && x.b === slot) || (x.b === p.slot && x.a === slot)),
      );
    for (const b of pg.live.runningBattles()) {
      if (p.helpTried.has(b.id)) continue;
      const log = w.battle(b.id);
      // A few seconds into the battle, so it has begun for both.
      if (!log || w.now() - log.began < 8_000) continue;
      const side = allyOf(b.to) ? b.to : allyOf(b.from) ? b.from : 0;
      if (!side) continue;
      p.helpTried.add(b.id);
      const units = homeUnits(p.sim)
        .filter((u) => u.kind === 'tank' || u.kind === 'infantry' || u.kind === 'artillery')
        .slice(0, 4);
      if (!units.length) {
        w.note(`${p.name} has nothing at home to send to ${b.id}`);
        continue;
      }
      w.note(`${p.name} sends ${units.length} units to help ${w.bySlot(side)?.name ?? side} in ${b.id}`);
      void pg.live.sendHelp(b.id, side, units).then((why) => {
        if (why) w.note(`${p.name}'s help was not sent: ${why}`);
        else {
          w.covered('helpSent');
          log.helpedBy.push(p.name);
        }
      });
    }
  }

  // ---------------------------------------------------------------- the army

  /** A city keeps its money and its forces up: it trains what is missing (the test cheat pays). */
  private quartermaster(p: Player): void {
    const sim = p.sim;
    const war = sim.state.war;
    if (!war) return;
    if (sim.state.treasury < 500_000) sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 1_000_000 });
    // What each city keeps up (see `arm` in world.ts): Kit, who takes Louton's seat of power, the biggest army.
    const [inf, tank, gun] = { Ada: [6, 4, 2], Sam: [6, 4, 2], Kit: [12, 8, 4], Lou: [4, 2, 0] }[p.name]!;
    const want: [UnitKind, number, string][] = [
      ['infantry', inf, 'barracks'],
      ['tank', tank, 'vehicledepot'],
      ['artillery', gun, 'vehicledepot'],
    ];
    for (const [kind, n, def] of want) {
      const have =
        [...war.units.values()].filter((u) => u.kind === kind).length +
        [...war.orders.values()].filter((o) => o.kind === kind).length;
      if (have >= n) continue;
      const base = [...sim.state.civics.values()].find((c) => c.def === def && !c.wrecked);
      if (base) sim.dispatch({ type: 'trainUnit', base: base.id, kind });
    }
  }
}
