import type { BattleTarget } from '../../../src/data/battle';
import type { FriendTerm, FriendWar } from '../../../relay/protocol';
import type { FriendsState } from '../../../relay/friendsWar';
import { homeUnits } from './bots';
import type { Player, Soak } from './world';

/**
 * The story the four players play (M39 step 10): an alliance, a war that is declared, opens after its
 * warning and is fought in live battles (with an ally's help) until a treaty ends it, a total war
 * that takes a seat of power and ends in a conquest and a vassal that pays dues, and then raids,
 * pacts and a rising for as long as there is time. Each scene waits on the world's own state (the
 * room's wars, the cities' forces) and gives up with a note rather than a failure: whether the soak
 * covered what it should is the report's business (`required` in `checks.ts`). All dice are the soak's.
 */

const MIN = 60_000;

type RoomState = { meta: { friends?: FriendsState } };
const friends = (w: Soak): FriendsState | undefined => (w.room as unknown as RoomState).meta?.friends;

/** The war open between two cities (not one that has ended), as the room keeps it. */
export function warBetween(w: Soak, a: Player, b: Player): FriendWar | undefined {
  return friends(w)?.wars.find(
    (x) => x.state !== 'ended' && ((x.a === a.slot && x.b === b.slot) || (x.a === b.slot && x.b === a.slot)),
  );
}

const pactBetween = (w: Soak, a: Player, b: Player, kind: string) =>
  friends(w)?.pacts.some(
    (x) => x.kind === kind && ((x.a === a.slot && x.b === b.slot) || (x.a === b.slot && x.b === a.slot)),
  );

const vassalOf = (w: Soak, vassal: Player) => friends(w)?.vassals.find((x) => x.vassal === vassal.slot);

/** A city's new raid counts for its target: the day's raids it can still take, by the region's own limit. */
const raidsLeft = (from: Player, target: Player): number =>
  from.page?.link.view?.cities.find((c) => c.slot === target.slot)?.raidsLeft ?? 3;

/** Wait for players to be in the region (a drop or a reload in the way), up to `ms`. */
async function whenUp(w: Soak, who: Player[], ms = 4 * MIN): Promise<boolean> {
  return w.until(
    `${who.map((p) => p.name).join(' and ')} to be in the region`,
    () => who.every((p) => p.up),
    ms,
  );
}

export interface Raid {
  ok: boolean;
  why?: string;
  expedition?: number;
}

/** A city sends its force at another city and waits until the battle has been fought and the force is on its way home. */
export async function raid(
  w: Soak,
  att: Player,
  def: Player,
  target: BattleTarget = 'military',
  tries = 1,
): Promise<Raid> {
  if (w.over) return { ok: false, why: 'time is up' };
  if (!(await whenUp(w, [att, def]))) {
    if (!w.over)
      w.miss(`${att.name} cannot raid ${def.name}: ${att.up ? def.name : att.name} is not in the region`);
    return { ok: false, why: 'a player is away' };
  }
  // A force just back from a battle is mending (an hour of game time mends a twentieth, a few seconds of
  // room time): it is waited for a little, not given up on, so one disturbed battle does not end the arc.
  if (homeUnits(att.sim).length < 2 && !w.over) {
    await w.until(`${att.name}'s units to mend`, () => homeUnits(att.sim).length >= 2, 4 * MIN);
    if (!(await whenUp(w, [att, def]))) return { ok: false, why: 'a player is away' };
  }
  const units = homeUnits(att.sim).map((u) => u.id);
  const n = att.sim.state.region.neighbours.find((x) => x.player?.slot === def.slot);
  if (units.length < 2 || !n) {
    w.miss(`${att.name} has ${units.length} units at home: no raid on ${def.name}`);
    return { ok: false, why: 'no force' };
  }
  const r = att.sim.dispatch({
    type: 'sendForce',
    units: units.slice(0, 24),
    to: n.id,
    route: 'highway',
    target,
    stance: 'bold',
  });
  if (!r.ok) {
    w.covered('raidsRefused');
    w.miss(`${att.name}'s force could not go against ${def.name}: ${r.reason}`);
    return { ok: false, why: r.reason };
  }
  const exp = r.created![0]!;
  w.covered('raids');
  w.note(
    `${att.name} sends ${Math.min(24, units.length)} units against ${def.name} (${target}), expedition ${exp}`,
  );
  w.onRaid?.(att, def);
  const done = await w.until(
    `${att.name}'s force ${exp} to be fought`,
    () => {
      const e = att.sim.state.war?.expeditions?.find((x) => x.id === exp);
      return !e || e.state === 'back';
    },
    14 * MIN,
  );
  if (!done) {
    const e = att.sim.state.war?.expeditions?.find((x) => x.id === exp);
    if (w.over) w.note(`${att.name}'s force ${exp} was still out when time ran out`);
    // A force that has arrived and fought nothing for fourteen minutes while both its cities were here is
    // stuck, not slow (a journey is under a minute of room time, the longest wait for the region a few).
    else if (e?.state === 'fighting' && att.up && def.up)
      w.fail(
        'battle',
        `${att.name}'s force ${exp} against ${def.name} was still fighting after 14 minutes with both cities in the region`,
      );
    else w.miss(`${att.name}'s force ${exp} was still out after 14 minutes`);
    return { ok: false, why: 'never came home', expedition: exp };
  }
  // The region may have turned the battle away (a limit): it is told, and the force came home as it went.
  if (tries > 1 && !w.over) return raid(w, att, def, target, tries - 1);
  return { ok: true, expedition: exp };
}

/** A war declared, and waited for until it opens. */
async function declare(
  w: Soak,
  a: Player,
  b: Player,
  scale: 'skirmish' | 'war' | 'total',
  reason: string,
): Promise<FriendWar | null> {
  if (!(await whenUp(w, [a, b]))) return null;
  if (!a.page!.fw.declare(b.slot, scale, reason)) {
    w.miss(`${a.name}'s declaration of war on ${b.name} could not be sent`);
    return null;
  }
  w.note(`${a.name} declares ${scale} war on ${b.name}: "${reason}"`);
  const made = await w.until(
    'the declaration',
    () => !!warBetween(w, a, b) || !!a.page?.fw.refusal(`war:${b.slot}`),
    20_000,
  );
  const war = warBetween(w, a, b);
  if (!made || !war) {
    w.miss(`${a.name}'s war on ${b.name} was not made: ${a.page?.fw.refusal(`war:${b.slot}`) ?? 'no word'}`);
    return null;
  }
  const opened = await w.until(`war ${war.id} to open`, () => warBetween(w, a, b)?.state === 'open', 4 * MIN);
  if (!opened) {
    w.miss(
      `war ${war.id} between ${a.name} and ${b.name} did not open (${warBetween(w, a, b)?.state ?? 'gone'})`,
    );
    return null;
  }
  w.note(`the war between ${a.name} and ${b.name} is open`);
  return warBetween(w, a, b)!;
}

/**
 * A treaty put to a friend: waits until `signed` says so, or the room has dropped the proposal (turned
 * down, refused or lapsed), or `ms` have passed. Whether it was signed.
 */
export async function propose(
  w: Soak,
  a: Player,
  b: Player,
  terms: FriendTerm[],
  signed: () => boolean,
  ms = 3 * MIN,
): Promise<boolean> {
  if (!(await whenUp(w, [a, b]))) return false;
  const { sent, id } = a.page!.fw.propose(b.slot, terms);
  if (!sent) {
    w.miss(`${a.name}'s proposal to ${b.name} could not be sent`);
    return false;
  }
  w.covered('proposals');
  w.note(`${a.name} proposes to ${b.name} (${id}): ${terms.map((t) => t.k).join(', ')}`);
  // (A page that reloads loses the list of what it proposed, and is told it again by the room's welcome.)
  const t0 = w.now();
  const gone = () => !!a.page && !a.page.fw.view().outgoing.some((x) => x.id === id) && w.now() > t0 + 5_000;
  await w.until(`${b.name} to answer ${id}`, () => signed() || gone(), ms);
  if (!signed() && !w.over) w.note(`${b.name} did not sign ${id}`);
  return signed();
}

// ---------------------------------------------------------------- the scenes

/** Kit and Sam: an alliance, so Kit can help Sam in a battle. */
async function alliance(w: Soak, a: Player, b: Player): Promise<void> {
  const ok = await propose(w, a, b, [{ k: 'alliance' }], () => !!pactBetween(w, a, b, 'alliance'), 2 * MIN);
  if (!ok) w.miss(`no alliance between ${a.name} and ${b.name}`);
  else w.note(`${a.name} and ${b.name} are allies`);
}

/** Ada declares war on Sam; they fight; a first offer of peace is turned down, a second signed. */
async function adaAndSam(w: Soak, ada: Player, sam: Player): Promise<void> {
  const war = await declare(w, ada, sam, 'war', 'Your border');
  if (!war) return;
  await raid(w, ada, sam);
  if (w.over) return;
  const score1 = warBetween(w, ada, sam)?.score;
  w.note(`the score after Ada's raid: ${score1}`);
  await raid(w, sam, ada);
  if (w.over) return;
  w.note(`the score after Sam's answer: ${warBetween(w, ada, sam)?.score}`);
  sam.declineNext = 1;
  const ended = () => !warBetween(w, ada, sam);
  const first = await propose(
    w,
    ada,
    sam,
    [{ k: 'peace' }, { k: 'reparations', payer: 'them', amount: 1_500 }],
    ended,
    3 * MIN,
  );
  if (first) return;
  if (w.over) return;
  const second = await propose(
    w,
    ada,
    sam,
    [{ k: 'peace' }, { k: 'nonAggression', months: 6 }],
    ended,
    4 * MIN,
  );
  if (!second) w.miss('Ada and Sam never signed their peace');
  else w.note('Ada and Sam are at peace');
}

/** Kit declares total war on Lou, takes his seat of power and holds it until the city falls, or wins by the score. */
async function kitAndLou(w: Soak, kit: Player, lou: Player): Promise<void> {
  // (The declaration is made at once: its warning runs while Kit helps his ally and Ada and Sam fight.)
  const war = await declare(w, kit, lou, 'total', 'Louton must fall');
  if (!war) return;
  // Kit's force is free for the total war once he has had his turn at helping.
  await w.until(
    'Kit to have helped',
    () =>
      (w.cover.helpSent > 0 && !kit.page?.live.helping()?.state.match(/asked|on|fighting/)) ||
      w.minutes() > 7,
    9 * MIN,
  );
  // Lou answers with a raid of his own now and then (it can break the hold if it wins; the region lets a
  // city take three raids a day, and Kit has only those against Louton, so Lou does not always try).
  if (w.rng.next() < 0.3) w.later(40_000, () => void raid(w, lou, kit, 'military'));
  // Kit goes for the seat of power until it is held (or the city has fallen or capitulated): a battle that
  // comes to nothing (the defender was away, the force was spent) is tried again when the force is ready.
  const give = w.now() + 40 * MIN;
  while (!w.over && w.now() < give) {
    if (vassalOf(w, lou)) break;
    const live = warBetween(w, kit, lou);
    if (!live || live.state === 'capitulated') break;
    // The seat is held: six minutes of waiting (a battle Lou wins would break the hold, and Kit tries again).
    if (live.hold?.by === kit.slot) {
      await w.wait(15_000);
      continue;
    }
    if (raidsLeft(kit, lou) <= 0) {
      w.note('Lou has taken the day’s raids: the total war waits');
      await w.wait(3 * MIN);
      continue;
    }
    const r = await raid(w, kit, lou, 'cityhall');
    await w.wait(r.ok ? 8_000 : 90_000);
  }
  // A seat of power held for 48 game hours (6 minutes) and the city falls; or a score at −60 and it capitulates.
  const fell = await w.until(
    'Louton to fall or capitulate',
    () => !!vassalOf(w, lou) || warBetween(w, kit, lou)?.state === 'capitulated' || !warBetween(w, kit, lou),
    2 * MIN,
  );
  if (!fell)
    return void w.miss(
      `Louton neither fell nor capitulated (${warBetween(w, kit, lou)?.hold ? 'the seat is held' : 'no hold'})`,
    );
  const cap = warBetween(w, kit, lou);
  if (cap?.state === 'capitulated' && cap.capitulated?.by === lou.slot) {
    w.note('Louton capitulates: Kit sets its terms');
    kit.page!.fw.propose(
      lou.slot,
      [{ k: 'reparations', payer: 'them', amount: 2_000 }, { k: 'vassal' }],
      true,
    );
    await w.until('Louton to become a vassal', () => !!vassalOf(w, lou), 2 * MIN);
  } else if (cap?.state === 'capitulated') {
    w.note('Kit capitulates to Lou (the score went the other way)');
  }
  if (vassalOf(w, lou)) {
    w.note('Louton is Kit’s vassal');
    // Its dues arrive at the overlord's month closes (a game month is 3 minutes at 1×).
    await w.until('a month of dues', () => w.cover.vassalDues > 0, 7 * MIN);
  }
}

/** Raids and treaties between whoever may, until time runs out. */
async function filler(w: Soak): Promise<void> {
  const rng = w.rng;
  while (!w.over) {
    if (!(await w.wait(60_000 + rng.int(3 * MIN)))) return;
    const up = w.players.filter((p) => p.up);
    if (up.length < 3) continue;
    const a = up[rng.int(up.length)]!;
    const others = up.filter((p) => p !== a && raidsLeft(a, p) > 0);
    if (!others.length) continue;
    const b = others[rng.int(others.length)]!;
    if (rng.next() < 0.7) await raid(w, a, b);
    else {
      const kind = (['nonAggression', 'trade', 'embargo'] as const)[rng.int(3)]!;
      const term: FriendTerm = kind === 'nonAggression' ? { k: 'nonAggression', months: 2 } : { k: kind };
      await propose(w, a, b, [term], () => false, 45_000);
    }
  }
}

/** A vassal rises against its overlord when the cooldown has passed. */
async function rising(w: Soak, kit: Player, lou: Player): Promise<void> {
  if (!(await w.until('Louton to be a vassal', () => !!vassalOf(w, lou), 40 * MIN))) return;
  // The cooldown after the war that made it a vassal: three game months, 9 minutes.
  if (!(await w.wait(10 * MIN))) return;
  const war = await declare(w, lou, kit, 'war', 'Louton will be free');
  if (!war) return;
  for (let k = 0; k < 2 && !w.over; k++) {
    if (!warBetween(w, lou, kit)) break;
    await raid(w, lou, kit);
  }
  if (!vassalOf(w, lou)) w.note('Louton is free');
  else w.note(`Louton's rising ends with the score at ${warBetween(w, lou, kit)?.score}`);
}

export async function story(w: Soak): Promise<void> {
  const [ada, sam, kit, lou] = w.players as [Player, Player, Player, Player];
  const full = w.opts.story === 'full';
  const guard = (name: string, fn: () => Promise<void>) =>
    fn().catch((e) => w.fail('story', `${name}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`));
  await w.wait(8_000);
  // Kit and Sam first: Kit can then help Sam while Ada's force is in his city.
  await guard('alliance', () => alliance(w, kit, sam));
  const arcs = [
    guard('Ada and Sam', () => adaAndSam(w, ada, sam)),
    guard('Kit and Lou', () => kitAndLou(w, kit, lou)),
  ];
  await Promise.all(arcs);
  if (!full) return;
  const rest = [guard('filler', () => filler(w)), guard('rising', () => rising(w, kit, lou))];
  await Promise.all(rest);
}

/** Drops, outages, reloads and absences, now and then, and one for a combatant soon after a live battle begins. */
export function disturbances(w: Soak): void {
  const rng = w.rng;
  const pick = (preferred?: Player[]): Player | undefined => {
    const up = w.players.filter((p) => p.up);
    if (up.length < 3) return undefined;
    const pool = preferred?.filter((p) => p.up);
    const from = pool?.length ? pool : up;
    return from[rng.int(from.length)];
  };
  // The four kinds in a shuffled round, then again: every kind turns up early, in an order the dice choose.
  let round: ('drop' | 'outage' | 'reload' | 'away' | 'crash')[] = [];
  const nextKind = () => {
    if (!round.length) {
      round = ['drop', 'outage', 'reload', 'away'];
      if (w.opts.crash) round.push('crash');
      for (let k = round.length - 1; k > 0; k--) {
        const j = rng.int(k + 1);
        [round[k], round[j]] = [round[j]!, round[k]!];
      }
    }
    return round.shift()!;
  };
  const disturb = async (p: Player) => {
    const kind = nextKind();
    if (kind === 'drop') w.drop(p);
    else if (kind === 'outage')
      w.outage(p, w.opts.mode === 'virtual' ? 12_000 + rng.int(10_000) : 20_000 + rng.int(70_000));
    else if (kind === 'reload') await w.reload(p);
    else if (kind === 'crash') await w.crash(p, 15_000 + rng.int(40_000));
    else await w.away(p, 60_000 + rng.int(150_000));
  };
  const again = (ms: number) =>
    w.later(ms, async () => {
      if (w.over) return;
      // One at a time: someone still away is waited out.
      if (w.players.every((p) => p.up)) {
        const p = pick();
        if (p) await disturb(p);
      }
      again(MIN + rng.int(4 * MIN));
    });
  again(90_000 + rng.int(MIN));
  // The old way: from its third raid on, the first whose defender is here has its player leave a little after
  // the force sets out and stay away past its arrival, so the region can only keep the battle for the defender
  // to take on its return (a long run is sure to have one).
  let raids = 0;
  let leftForIt = false;
  w.onRaid = (_att, def) => {
    if (++raids < 3 || leftForIt || !def.up) return;
    leftForIt = true;
    w.later(15_000, () => {
      if (def.up) {
        w.note(`${def.name} leaves while a force is on its way`);
        void w.away(def, 110_000);
      } else leftForIt = false;
    });
  };
  // Mid-battle: a combatant has a bad moment in four battles of ten, and always in the second (a battle
  // lasts under a minute, so it comes soon after it begins; a long run is sure to have one, and the room
  // to hand a side over). Not everyone is here at the moment: it is tried again a few times.
  let seen = 0;
  w.onBattle = (b) => {
    seen++;
    if (seen !== 2 && rng.next() >= 0.4) return;
    const bad = (tries: number) =>
      w.later(tries ? 4_000 : 5_000 + rng.int(20_000), async () => {
        if (w.over) return;
        if (!w.players.every((p) => p.up)) {
          if (tries < 5) bad(tries + 1);
          return;
        }
        const p = pick([w.bySlot(b.attacker)!, w.bySlot(b.defender)!].filter(Boolean));
        if (p && (p.slot === b.attacker || p.slot === b.defender)) {
          w.note(`${p.name} has a bad moment in ${b.id}`);
          await disturb(p);
        }
      });
    bad(0);
  };
}
