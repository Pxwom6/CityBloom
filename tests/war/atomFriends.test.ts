import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FRIENDS } from '../../relay/protocol';
import type { RegionAtomMark, RegionWinter } from '../../relay/region';
import { ATOM, ATOM_WIRE, FALLOUT, atomStageNo } from '../../src/data/atom';
import { cleanAtomMarks, cleanWinters } from '../../src/client/atomRegion';
import { Sim } from '../../src/sim/sim';
import { atomHour, atomStage, atomOf, atomSummary } from '../../src/sim/systems/atom';
import { FIGHT_TIMEOUT_HOURS, SETTLE_TIMEOUT_HOURS } from '../../src/data/battle';
import { fightingWith, isPariah, reputationOf } from '../../src/sim/systems/diplomacy';
import { falloutOf, updateFallout } from '../../src/sim/systems/fallout';
import { friendDeclareProblem, friendsSummary } from '../../src/sim/systems/friendsWar';
import { friendOpsWaiting } from '../../src/sim/systems/regionOps';
import { resolveOp } from '../../src/client/ops';
import { STRIKE_STRUCK, STRIKE_UNSEEN } from '../../src/sim/systems/atom';
import { windAngle } from '../../src/sim/systems/pollution';
import { winterDepth } from '../../src/sim/systems/weather';
import { GRID_RES } from '../../src/data/world';
import { TICKS_PER_HOUR } from '../../src/sim/time';
import { ok } from './researchTown';
import { closePages } from './liveHarness';
import { friendOf, mirrorWar, settle } from './friendsHarness';
import {
  baseTown,
  buildAtomSaves,
  chargeDome,
  finishPrep,
  olderPage,
  openAtomWorld,
  prepare,
  returnPage,
  tick3,
  totalWar,
  type AtomPage,
  type AtomSaves,
  type AtomWorld,
} from './atomFriendsHarness';

/**
 * M40 step 10: the atom bomb among friends, each city's side, through a real region room (design
 * calls 12, 16 and 17). Three cities' pages with everything a game has for it (`atomFriendsHarness`);
 * the room's own rules are `relay/tests/regionAtom.test.ts`, the sim's own are `atomStrike`, `atomFallout`
 * and `atomWinter`. Here is what the pages do with the room's words.
 */
vi.setConfig({ testTimeout: 240_000 });
afterEach(() => closePages());

const H = TICKS_PER_HOUR;
let saves: AtomSaves;
beforeAll(() => {
  saves = buildAtomSaves(baseTown());
}, 600_000);

type Meta = {
  friends?: { pariahs?: Record<number, number>; pacts: unknown[] };
  atoms?: RegionAtomMark[];
  winters?: RegionWinter[];
};
const meta = (w: AtomWorld) => (w.room as unknown as { meta: Meta }).meta;

const events = (p: AtomPage, kind: string) => p.sim.events.filter((e) => e.kind === kind);
const marks = (p: AtomPage) => p.atom.atoms.map((m) => `${m.slot}:${m.kind}`);
const stageOf = (p: AtomPage, of: AtomPage) => friendOf(p, of.link.slot).player?.atom?.stage;
const winters = (p: AtomPage) => p.sim.state.weather.winters ?? [];

/** The page's frame and what it sets going settle (a report, a strike put to the room). */
async function look(p: AtomPage): Promise<void> {
  p.frames();
  await settle(8);
}

/** `a` and `b` make peace with a pact of non-aggression (a war between them first, as the region has it). */
async function pact(w: AtomWorld, a: AtomPage, b: AtomPage): Promise<void> {
  expect(a.fw.declare(b.link.slot, 'war', 'Your border')).toBe(true);
  await settle();
  w.clock.advance(FRIENDS.warning + 1_000);
  await tick3(w);
  expect(a.fw.propose(b.link.slot, [{ k: 'peace' }, { k: 'nonAggression', months: 24 }]).sent).toBe(true);
  await settle();
  const waiting = b.fw.view().incoming;
  expect(waiting).toHaveLength(1);
  expect(await b.fw.answer(waiting[0]!.id, true)).toBeNull();
  await settle();
}

const pactsOf = (p: AtomPage, with_: AtomPage) =>
  p.sim.state.war!.diplomacy!.pacts.filter(
    (x) => x.with === friendOf(p, with_.link.slot).id && x.term.k === 'nonAggression',
  );

/**
 * `from`'s bomb is made ready to fire at `at`, the war between them being open: the preparation is
 * half done when the room sees the launch, waits out its `atomPrep`, and the rest is played out.
 */
async function ready(w: AtomWorld, from: AtomPage, at: AtomPage): Promise<void> {
  prepare(from, at);
  await look(from);
  w.clock.advance(61_000);
  await tick3(w);
  finishPrep(from);
}

describe('M40 step 10: the race among friends', () => {
  it('is announced to the other two as it goes, and the first to finish is told so (and only the first)', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { ada, sam, cal } = w;
    // (The towns have their plant and silo standing, which is the race at its third step for each: that is
    // where the others see Ada from the start. The room said so when she first reported, to those then there.)
    for (const p of [sam, cal]) expect(stageOf(p, ada)).toBe(atomStageNo('silo'));
    expect(ada.toasts.some((t) => /has begun a silo/.test(t))).toBe(true);
    const steps = [
      ['bomb', /Adaville is building the bomb/],
      ['ready', /Adaville has the atom bomb/],
    ] as const;
    for (const [stage, line] of steps) {
      w.clock.advance(6_000);
      ok(ada.sim, { type: 'cheat', cheat: 'atom', stage });
      await look(ada);
      for (const p of [sam, cal]) {
        expect(stageOf(p, ada), `${p.name} sees ${stage}`).toBe(atomStageNo(stage));
        expect(
          p.toasts.some((t) => line.test(t)),
          `${p.name} was told: ${stage}`,
        ).toBe(true);
      }
    }
    // Ada has the bomb first: the record has her mark as the first finisher, every page has the record,
    // and her own city holds the word (the achievement is the city's fact).
    for (const p of w.pages) expect(marks(p)).toEqual([`${ada.link.slot}:ready`]);
    expect(ada.atom.atoms[0]!.first).toBe(true);
    expect(ada.atom.first).toBe(true);
    expect(sam.atom.first).toBe(false);
    expect(atomOf(ada.sim).first).toBe(true);
    expect(sam.sim.state.war!.atom?.first).toBeUndefined();
    ada.sim.advance(H);
    expect(ada.sim.state.progress.achievements.firstBomb).toBeDefined();
    // Cal finishes later: a mark of its own, and nothing for the achievement.
    ok(cal.sim, { type: 'cheat', cheat: 'atom', stage: 'ready' });
    await look(cal);
    expect(marks(sam)).toEqual([`${ada.link.slot}:ready`, `${cal.link.slot}:ready`]);
    expect(sam.atom.atoms[1]!.first).toBeUndefined();
    expect(cal.atom.first).toBe(false);
    expect(cal.sim.state.war!.atom!.first).toBeUndefined();
    cal.sim.advance(H);
    expect(cal.sim.state.progress.achievements.firstBomb).toBeUndefined();
  });

  it('is told again when the first finisher returns, and the word changes nothing the second time', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { ada } = w;
    ok(ada.sim, { type: 'cheat', cheat: 'atom', stage: 'ready' });
    await look(ada);
    expect(atomOf(ada.sim).first).toBe(true);
    // Her page drops and comes back: the welcome carries the record and the mark again.
    const before = ada.sim.hash();
    ada.link.dropForTest();
    await new Promise((r) => setTimeout(r, 1_200));
    await settle(12);
    expect(ada.link.state).toBe('in');
    expect(ada.atom.first).toBe(true);
    expect(marks(ada)).toEqual([`${ada.link.slot}:ready`]);
    expect(atomOf(ada.sim).first).toBe(true);
    ada.sim.advance(H);
    ada.sim.advance(H);
    expect(ada.sim.state.progress.achievements.firstBomb).toBeDefined();
    expect(before).not.toBe('');
  });

  it('is told to the room as the city’s stage changes, not at the next report', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { ada, sam } = w;
    // No report is sent by the test: the page's frame sees the stage change and asks for one.
    ok(ada.sim, { type: 'cheat', cheat: 'atom', stage: 'bomb' });
    ada.frames();
    await settle(8);
    expect(stageOf(sam, ada)).toBe(atomStageNo('bomb'));
    // A second stage change inside the gap waits for the first frame after it.
    ok(ada.sim, { type: 'cheat', cheat: 'atom', stage: 'ready' });
    ada.frames();
    await settle(8);
    expect(stageOf(sam, ada)).toBe(atomStageNo('bomb'));
    w.clock.advance(6_000);
    ada.frames();
    await settle(8);
    expect(stageOf(sam, ada)).toBe(atomStageNo('ready'));
  });
});

describe('M40 step 10: a strike between friends', () => {
  it('is put to the room when the launch is prepared, kept, taken by the target with a full countdown, stopped by its dome; then a second lands, levels, and chills the others', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { ada, sam, cal, clock } = w;
    const [A, S, C] = [ada.link.slot, sam.link.slot, cal.link.slot];
    // Ada and Cal are friends in a pact; Samford's dome is up.
    await pact(w, ada, cal);
    expect(pactsOf(ada, cal)).toHaveLength(1);
    expect(pactsOf(cal, ada)).toHaveLength(1);
    chargeDome(sam.sim);
    await totalWar(w, ada, sam);
    expect(fightingWith(ada.sim, friendOf(ada, S).id)?.scale).toBe('total');
    expect(fightingWith(sam.sim, friendOf(sam, A).id)?.scale).toBe('total');

    // ---- Ada's launch: the room waits out its own clock; the page gets the refusal in words first.
    prepare(ada, sam);
    finishPrep(ada);
    const aAtom = atomOf(ada.sim);
    expect(aAtom.prep!.send).toMatchObject({ slot: S });
    await look(ada);
    // (The room has seen the launch prepared for no time at all: it turns the bomb away, and the bomb stays.)
    expect(aAtom.fired).toBeUndefined();
    expect(aAtom.prep!.send).toBeUndefined();
    expect(aAtom.prep!.refused).toMatch(/still being prepared|no launch prepared/);
    expect(aAtom.have).toBe(true);
    expect(atomStage(ada.sim)).toBe('preparing');
    expect(sam.sim.state.war!.atom?.inbound).toBeUndefined();
    // A day of the room's time on, with the room having seen the launch for it, the city sends it again.
    await tick3(w);
    clock.advance(61_000);
    await tick3(w);
    ok(ada.sim, { type: 'launchBomb', to: friendOf(ada, S).id });
    expect(aAtom.prep!.refused).toBeUndefined();
    expect(aAtom.prep!.send).toBeDefined();
    expect(events(ada, 'strikeSent').length).toBeGreaterThan(0);
    await look(ada);

    // ---- Kept: the bomb has left Ada's silo, the world turns on her, and Samford has a bomb coming.
    expect(aAtom.fired).toMatchObject({ to: friendOf(ada, S).id, name: 'Samford', slot: S });
    expect(aAtom.have).toBeUndefined();
    expect(aAtom.prep).toBeUndefined();
    expect(atomStage(ada.sim)).toBe('flying');
    expect(isPariah(ada.sim)).toBe(true);
    expect(reputationOf(ada.sim)).toBe(0);
    expect(meta(w).friends!.pariahs![A]).toBeDefined();
    expect(meta(w).atoms!.some((m) => m.slot === A && m.kind === 'fired' && m.to === S)).toBe(true);
    // Her pact of friendship is gone from the room and from both cities' sims.
    expect(pactsOf(ada, cal)).toHaveLength(0);
    expect(pactsOf(cal, ada)).toHaveLength(0);
    // Samford's sim took it once, and it starts its countdown from the moment it took it.
    expect(sam.strikes).toBe(1);
    const inbound = atomOf(sam.sim).inbound!;
    expect(inbound).toMatchObject({ name: 'Adaville', slot: A });
    expect(inbound.warn).toBe(sam.sim.state.tick);
    expect(inbound.arrive - inbound.warn).toBeGreaterThanOrEqual(ATOM.flight.hours * H);
    expect(inbound.arrive - inbound.warn).toBeLessThanOrEqual(ATOM.flight.hours * H + 1);
    // Told again (the word was lost), it is only acknowledged: nothing changes and the bomb isn't taken twice.
    const hash = sam.sim.hash();
    await sam.link.reportNow(true);
    await settle();
    expect(sam.strikes).toBe(1);
    expect(sam.sim.hash()).toBe(hash);

    // ---- The dome stops it: no building lost, no winter anywhere, the dome down for long.
    sam.sim.advance(H);
    expect(events(sam, 'bombWarning')).toHaveLength(1);
    const homes = sam.sim.state.buildings.size;
    sam.sim.advance(ATOM.flight.hours * H);
    expect(atomOf(sam.sim)).toMatchObject({ stopped: 1, boom: 0 });
    expect(atomOf(sam.sim).inbound).toBeUndefined();
    expect(sam.sim.state.buildings.size).toBe(homes);
    // (An hour of its downtime has run since it stopped the bomb.)
    expect(sam.sim.state.war!.supers!.dome!.down).toBeGreaterThan(ATOM.dome.down - 3);
    expect(sam.sim.state.war!.supers!.dome!.down).toBeLessThanOrEqual(ATOM.dome.down);
    ada.sim.advance(ATOM.flight.hours * H + H);
    expect(atomStage(ada.sim)).toBe('spent');
    await tick3(w);
    expect(meta(w).atoms!.some((m) => m.slot === S && m.kind === 'stopped')).toBe(true);
    for (const p of w.pages) expect(winters(p), `${p.name} has no winter`).toHaveLength(0);

    // ---- Calbury's strike lands (the dome is down): the town is levelled, the others are chilled.
    await totalWar(w, cal, sam);
    prepare(cal, sam);
    await look(cal);
    clock.advance(61_000);
    await tick3(w);
    finishPrep(cal);
    await look(cal);
    expect(atomOf(cal.sim).fired).toMatchObject({ name: 'Samford', slot: S });
    expect(isPariah(cal.sim)).toBe(true);
    expect(meta(w).friends!.pariahs![C]).toBeDefined();
    expect(sam.strikes).toBe(2);
    expect(atomOf(sam.sim).inbound).toMatchObject({ name: 'Calbury', slot: C });
    sam.sim.advance(ATOM.flight.hours * H + 40 * H);
    const im = atomOf(sam.sim).impact!;
    expect(atomOf(sam.sim).boom).toBe(1);
    expect(im.levelled!).toBeGreaterThan(0);
    expect(im.over).toBe(true);
    expect(winters(sam).map((x) => x.id)).toEqual(['self:1']);
    // Samford's report says so; the room begins a winter for the other two, whose pages apply it once.
    await sam.link.reportNow(true);
    await settle();
    const id = `${S}-1`;
    expect(meta(w).winters!.map((x) => x.id)).toEqual([id]);
    for (const p of [ada, cal]) {
      expect(
        winters(p).map((x) => x.id),
        `${p.name}'s winter`,
      ).toEqual([id]);
      p.sim.advance(1);
      expect(winterDepth(p.sim.state.weather, p.sim.state.tick)).toBeGreaterThanOrEqual(0);
    }
    expect(mirrorWar(cal, S)).toBeDefined();
    expect(marks(ada)).toContain(`${S}:boom`);
    // (Heard again, the winter is the same one.)
    await tick3(w);
    expect(winters(ada)).toHaveLength(1);
    expect(winters(cal)).toHaveLength(1);
  });
});

describe('M40 step 10: a strike the room turns away', () => {
  it('stays prepared with the room’s words when the target’s player is not here, and goes when it is back', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { ada, sam, clock } = w;
    const S = sam.link.slot;
    await totalWar(w, ada, sam);
    // Samford's player leaves the region (its city is kept there, away).
    await sam.link.leave();
    await settle();
    await ready(w, ada, sam);
    await look(ada);
    const a = atomOf(ada.sim);
    expect(a.fired).toBeUndefined();
    expect(a.have).toBe(true);
    expect(a.prep!.send).toBeUndefined();
    expect(a.prep!.refused).toBe('Samford’s player is not here: the bomb waits');
    expect(atomStage(ada.sim)).toBe('preparing');
    expect(isPariah(ada.sim)).toBe(false);
    // The summary shows the reason beside the launch; no event of a bomb having left, only of its being held.
    expect(atomSummary(ada.sim)!.launch).toMatchObject({ ready: true, held: a.prep!.refused });
    expect(events(ada, 'launchHeld').at(-1)).toMatchObject({ info: { why: a.prep!.refused } });
    expect(events(ada, 'bombFired')).toHaveLength(0);
    expect(meta(w).friends?.pariahs?.[ada.link.slot]).toBeUndefined();
    // The page does not ask again by itself (the room would only say no again): the city sends it when it likes.
    await look(ada);
    expect(a.prep!.send).toBeUndefined();
    // Samford's player comes back; the city sends the bomb again and the room keeps it.
    const back = await returnPage(w, sam, 'Sam', 1);
    clock.advance(1_000);
    await tick3(w);
    ok(ada.sim, { type: 'launchBomb', to: friendOf(ada, S).id });
    await look(ada);
    expect(a.fired).toMatchObject({ name: 'Samford', slot: S });
    expect(a.prep).toBeUndefined();
    expect(back.strikes).toBe(1);
    expect(isPariah(ada.sim)).toBe(true);
  });

  it('stays prepared when the target’s game is older than the room, which it can neither race for the bomb nor be struck by', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { ada, cal } = w;
    await totalWar(w, ada, cal);
    // Calbury's page is of the game before the bomb.
    await cal.link.leave();
    await settle();
    olderPage(w, cal, 'Cal', 2);
    await settle();
    await ready(w, ada, cal);
    await look(ada);
    const a = atomOf(ada.sim);
    expect(a.prep!.refused).toBe(
      'Calbury’s game is older than this room: it can neither race for the atom bomb nor be struck by it',
    );
    expect(a.fired).toBeUndefined();
    expect(a.have).toBe(true);
    expect(cal.sim.state.war!.atom?.inbound).toBeUndefined();
    expect(isPariah(ada.sim)).toBe(false);
  });

  it('is called back to the silo when the page never got to put it to the room (the tower’s rule), and sent again', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { ada, sam } = w;
    await totalWar(w, ada, sam);
    await ready(w, ada, sam);
    // The page never gets to ask (it is not looking): the strike waits in the sim, not yet pinned.
    const a = atomOf(ada.sim);
    const send = a.prep!.send!;
    expect(send).toBeDefined();
    // Calling it off or sending it again is refused while it is with the room.
    expect(ada.sim.dispatch({ type: 'cancelLaunch' })).toMatchObject({ ok: false });
    expect(ada.sim.dispatch({ type: 'launchBomb', to: send.slot })).toMatchObject({ ok: false });
    const war = ada.sim.state.war!;
    war.clock = send.at + FIGHT_TIMEOUT_HOURS - 1;
    atomHour(ada.sim);
    expect(a.prep!.send).toBeDefined();
    war.clock = send.at + FIGHT_TIMEOUT_HOURS;
    atomHour(ada.sim);
    expect(a.prep!.send).toBeUndefined();
    expect(a.prep!.refused).toMatch(/gave no answer/);
    expect(events(ada, 'launchHeld').at(-1)).toMatchObject({
      info: { why: expect.stringMatching(/no answer/) },
    });
    expect(a.have).toBe(true);
    expect(a.fired).toBeUndefined();
    // Sent again, it is put to the room anew, under a new number.
    ok(ada.sim, { type: 'launchBomb', to: friendOf(ada, sam.link.slot).id });
    expect(a.prep!.send).toBeDefined();
    expect(a.prep!.send!.op).not.toBe(send.op);
    expect(a.prep!.refused).toBeUndefined();
  });

  it('is never called back once the page has put it to the room: the room may have kept it, and its late word settles it', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { ada, sam } = w;
    const S = sam.link.slot;
    await totalWar(w, ada, sam);
    await ready(w, ada, sam);
    const a = atomOf(ada.sim);
    const send = a.prep!.send!;
    // The page puts the strike to the room, which keeps it (Samford has a bomb coming) -- and the answer
    // is lost on the way: the page never hears, and the sim has it pinned, still waiting.
    const key = friendOpsWaiting(ada.sim).find((o) => o.op === 'atom')!.key;
    ok(ada.sim, { type: 'spySettling', mission: send.op, on: true });
    const kept = await ada.link.sendOp({ to: S, id: key, op: 'atom' }, 5_000);
    expect(kept).toMatchObject({ kept: true });
    await settle(8);
    expect(sam.strikes).toBe(1);
    // A very long time of the city's own hours goes by with no word (the link was down for ninety minutes of play).
    const war = ada.sim.state.war!;
    war.clock = send.at + SETTLE_TIMEOUT_HOURS * 3;
    atomHour(ada.sim);
    expect(a.prep!.send).toMatchObject({ op: send.op, settling: true });
    expect(a.prep!.refused).toBeUndefined();
    expect(atomStage(ada.sim)).toBe('preparing');
    // Still not to be called off or sent again meanwhile: the room may have it.
    expect(ada.sim.dispatch({ type: 'cancelLaunch' })).toMatchObject({ ok: false });
    // The link is back: the page asks again with the same key, the room says the same, and the bomb has gone.
    await look(ada);
    expect(a.fired).toMatchObject({ slot: S, name: 'Samford' });
    expect(a.have).toBeUndefined();
    expect(a.prep).toBeUndefined();
    expect(isPariah(ada.sim)).toBe(true);
    expect(sam.strikes).toBe(1);
  });
});

describe('M40 step 10 review: a strike the city can match with a bomb and a war', () => {
  const strike = (from: number, id: string) => ({
    from,
    id,
    op: 'atom' as const,
    outcome: 'success' as const,
    late: false,
  });
  /** The strike as the page hands it to the sim, and the answer it gives the room. */
  const take = (p: AtomPage, o: ReturnType<typeof strike>) =>
    resolveOp({ command: async (cmd) => p.sim.dispatch(cmd) }, o);

  it('is not taken from a city with no total war and no launch behind it, but is kept for when they have', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { ada, sam } = w;
    const A = ada.link.slot;
    // A strike nobody made (a host that forges one): no war, no bomb. Not taken, nothing changes, and the
    // page keeps it offered (it may be news not heard yet).
    const before = sam.sim.hash();
    expect(sam.sim.dispatch({ type: 'opResolve', ...strike(A, 'ao-1') })).toMatchObject({
      ok: false,
      reason: STRIKE_UNSEEN,
    });
    expect(await take(sam, strike(A, 'ao-1'))).toBe('later');
    expect(sam.sim.hash()).toBe(before);
    // A total war is on, but Adaville has reported no launch: still not.
    await totalWar(w, ada, sam);
    expect(await take(sam, strike(A, 'ao-1'))).toBe('later');
    expect(sam.sim.state.war!.atom?.inbound).toBeUndefined();
    // Her launch is reported to the region, and Samford has been told: the same strike is taken.
    prepare(ada, sam);
    await look(ada);
    expect(stageOf(sam, ada)).toBe(atomStageNo('preparing'));
    expect(await take(sam, strike(A, 'ao-1'))).toBe('taken');
    expect(atomOf(sam.sim).inbound).toMatchObject({ name: 'Adaville', slot: A });
    expect(atomOf(sam.sim).struck).toEqual([A]);
  });

  it('is turned away for good when that city has struck before, whatever became of the first bomb', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { ada, sam } = w;
    const A = ada.link.slot;
    chargeDome(sam.sim);
    await totalWar(w, ada, sam);
    prepare(ada, sam);
    await look(ada);
    expect(await take(sam, strike(A, 'ao-1'))).toBe('taken');
    // While the first is in the air, a second from the same city is not "kept for later": it is no bomb that city has.
    expect(sam.sim.dispatch({ type: 'opResolve', ...strike(A, 'ao-2') })).toMatchObject({
      ok: false,
      reason: STRIKE_STRUCK,
    });
    // The dome stops the first; a forged third, with an id of its own, is still turned away, and nothing flies.
    sam.sim.advance(ATOM.flight.hours * H + 2 * H);
    expect(atomOf(sam.sim)).toMatchObject({ stopped: 1 });
    expect(atomOf(sam.sim).inbound).toBeUndefined();
    const hash = sam.sim.hash();
    expect(await take(sam, strike(A, 'ao-3'))).toBe('refused');
    expect(await take(sam, strike(A, 'ao-4'))).toBe('refused');
    expect(sam.sim.hash()).toBe(hash);
    expect(atomOf(sam.sim).inbound).toBeUndefined();
    expect(atomOf(sam.sim).struck).toEqual([A]);
  });
});

describe('M40 step 10: a friend away when the strike comes', () => {
  it('a page that cannot take it now is offered it again with each report, and the countdown starts when it takes it', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { ada, sam } = w;
    await totalWar(w, ada, sam);
    sam.hold = true;
    await ready(w, ada, sam);
    await look(ada);
    // The room kept the strike: the bomb has left Adaville's silo, and Samford has not taken it.
    expect(atomOf(ada.sim).fired).toMatchObject({ slot: sam.link.slot });
    expect(sam.strikes).toBe(0);
    expect(atomOf(sam.sim).inbound).toBeUndefined();
    // Ten hours of the city's time go by (the player is looking at something else); it is offered again and again, still not taken.
    sam.sim.advance(10 * H);
    await sam.link.reportNow(true);
    await settle();
    expect(atomOf(sam.sim).inbound).toBeUndefined();
    // The player is free: the next report takes it, with a whole countdown from then, not from when it was kept.
    sam.hold = false;
    const tick = sam.sim.state.tick;
    await sam.link.reportNow(true);
    await settle();
    const inbound = atomOf(sam.sim).inbound!;
    expect(inbound).toMatchObject({ name: 'Adaville' });
    expect(inbound.warn).toBe(tick);
    expect(inbound.arrive - inbound.warn).toBeGreaterThanOrEqual(ATOM.flight.hours * H);
    expect(sam.strikes).toBe(1);
    // And only once, however often the room offers it.
    await sam.link.reportNow(true);
    await settle();
    expect(sam.strikes).toBe(1);
  });

  it('a player who is gone takes it on their return, with a fresh full countdown', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { ada, sam } = w;
    await totalWar(w, ada, sam);
    sam.hold = true;
    await ready(w, ada, sam);
    await look(ada);
    expect(atomOf(sam.sim).inbound).toBeUndefined();
    // Samford's player leaves (the city is saved by the page as it goes) and the days pass in the room.
    await sam.link.leave();
    await settle();
    w.clock.advance(3 * 3_600_000);
    // They come back: the room tells them of what came while they were away, and the city takes it then.
    const back = await returnPage(w, sam, 'Sam', 1);
    await settle(12);
    const inbound = atomOf(back.sim).inbound!;
    expect(inbound).toMatchObject({ name: 'Adaville', slot: ada.link.slot });
    expect(inbound.warn).toBe(back.sim.state.tick);
    expect(inbound.arrive - inbound.warn).toBeGreaterThanOrEqual(ATOM.flight.hours * H);
    expect(back.strikes).toBe(1);
    // The countdown runs the city's own clock from here: nothing has landed after 23 hours, and the bomb falls after 24.
    back.sim.advance(23 * H);
    expect(atomOf(back.sim).inbound).toBeDefined();
    back.sim.advance(2 * H);
    expect(atomOf(back.sim).inbound).toBeUndefined();
  });

  it('a second bomb that comes while one is in the air waits, and is taken when the first has landed', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { ada, sam, cal } = w;
    await totalWar(w, ada, sam);
    await totalWar(w, cal, sam);
    await ready(w, ada, sam);
    await look(ada);
    expect(sam.strikes).toBe(1);
    await ready(w, cal, sam);
    await look(cal);
    // Calbury's bomb is kept too (the room has no say about Samford's sky), but Samford's sim is busy.
    expect(atomOf(cal.sim).fired).toBeDefined();
    expect(sam.strikes).toBe(1);
    expect(atomOf(sam.sim).inbound).toMatchObject({ name: 'Adaville' });
    // The first is stopped by the dome (charged for this); the next report takes the second.
    chargeDome(sam.sim);
    sam.sim.advance(ATOM.flight.hours * H + 2);
    expect(atomOf(sam.sim).stopped).toBe(1);
    await sam.link.reportNow(true);
    await settle();
    expect(sam.strikes).toBe(2);
    expect(atomOf(sam.sim).inbound).toMatchObject({ name: 'Calbury' });
  });
});

describe('M40 step 10: a friend’s cloud', () => {
  /** The side of the map this city's wind blows from, and one it does not. */
  function sides(p: AtomPage): { from: 'north' | 'south' | 'west'; notFrom: 'north' | 'south' | 'west' } {
    const a = windAngle(p.sim.state.options.seed, p.sim.state.tick);
    const from = Math.sin(a) > 0 ? 'north' : Math.sin(a) < 0 ? 'south' : 'west';
    const notFrom =
      from === 'north' ? 'south' : from === 'south' ? 'north' : Math.sin(a) > 0 ? 'south' : 'north';
    return { from: Math.cos(a) > 0 && from === 'west' ? 'west' : from, notFrom };
  }
  const airIn = (p: AtomPage) => {
    const f = p.sim.state.fallout?.air;
    let sum = 0;
    if (f) for (const v of f) sum += v;
    return sum;
  };

  /** Samford has had a bomb fall (the room can account for one) and its air has carried `total` over the border to Calbury. */
  async function cloud(w: AtomWorld, total: number): Promise<void> {
    const { sam, cal } = w;
    atomOf(sam.sim).boom = 1;
    falloutOf(sam.sim).out[friendOf(sam, cal.link.slot).side] = total;
    await sam.link.reportNow(true);
    await settle(8);
  }

  it('is taken in from the first trickle by a city that was here as it began, and then only what is new', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { sam, cal } = w;
    const S = sam.link.slot;
    // (Calbury saw Samford with no cloud for it when the region opened, so its first trickle is new.)
    await cloud(w, 12);
    expect(friendOf(cal, S).player!.atom!.plume).toBe(12);
    expect(falloutOf(cal.sim).seen[S]).toBe(12);
    const first = airIn(cal);
    expect(first).toBeGreaterThan(0);
    // More comes: the new part is deposited as air on the edge facing Samford, and the total is taken.
    await cloud(w, 40);
    expect(falloutOf(cal.sim).seen[S]).toBe(40);
    const put = airIn(cal);
    expect(put).toBeGreaterThan(first);
    const side = friendOf(cal, S).side;
    const R = GRID_RES;
    const f = cal.sim.state.fallout!;
    const rows = FALLOUT.friend.rows;
    let inStrip = 0;
    for (let j = 0; j < R; j++)
      for (let i = 0; i < R; i++) {
        const on = side === 'north' ? j < rows : side === 'south' ? j >= R - rows : i < rows;
        if (on) inStrip += f.air[j * R + i]!;
      }
    expect(inStrip).toBeCloseTo(put, 3);
    // Heard again, the same total changes nothing at all.
    const hash = cal.sim.hash();
    await cloud(w, 40);
    await tick3(w);
    expect(cal.sim.hash()).toBe(hash);
    expect(airIn(cal)).toBeCloseTo(put, 5);
    // A thin haze, never a second strike: no cell is thicker than the cap.
    expect(Math.max(...f.air)).toBeLessThanOrEqual(FALLOUT.friend.cell + 1e-6);
  });

  it('spares a city that was away for the whole drift: what it never saw is taken as known, and only what is new after it is deposited', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { sam, cal } = w;
    const S = sam.link.slot;
    // Calbury's player is away while the cloud comes; it returns to find 12 of it over the border.
    await cal.link.leave();
    await settle();
    await cloud(w, 12);
    const back = await returnPage(w, cal, 'Cal', 2);
    await settle(12);
    expect(friendOf(back, S).player!.atom!.plume).toBe(12);
    expect(falloutOf(back.sim).seen[S]).toBe(12);
    expect(airIn(back)).toBe(0);
    await cloud(w, 40);
    expect(falloutOf(back.sim).seen[S]).toBe(40);
    expect(airIn(back)).toBeGreaterThan(0);
  });

  it('comes in whatever way the city’s own wind blows: the cloud has crossed the border, and two cities’ winds are their own', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { sam, cal } = w;
    const S = sam.link.slot;
    await cloud(w, 12);
    // Calbury's wind blows from Samford's side, then (the side being the one it blows away from) not.
    let total = 12;
    for (const side of [sides(cal).from, sides(cal).notFrom]) {
      friendOf(cal, S).side = side;
      const before = airIn(cal);
      total += 80;
      await cloud(w, total);
      expect(falloutOf(cal.sim).seen[S], side).toBe(total);
      expect(airIn(cal), `the cloud came in on the ${side} side`).toBeGreaterThan(before);
    }
  });

  it('is not sent back and forth: what the wind carries back out of the city is no more than came in', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { sam, cal } = w;
    const S = sam.link.slot;
    await cloud(w, 12);
    // Calbury's wind blows away from Samford: the air put on the edge facing it is carried straight out again.
    const side = sides(cal).notFrom;
    friendOf(cal, S).side = side;
    await cloud(w, 356);
    const f = falloutOf(cal.sim);
    const put = airIn(cal);
    const out0 = f.out[side];
    expect(put).toBeGreaterThan(0);
    for (let k = 0; k < 40; k++) updateFallout(cal.sim);
    const sent = f.out[side] - out0;
    expect(sent).toBeGreaterThan(0);
    expect(sent).toBeLessThanOrEqual(put + 1e-6);
    // Samford would take 0.6 of that, and send back less than the part it sent: each trip is smaller.
    expect(sent * FALLOUT.friend.share).toBeLessThan(356 - 12);
  });

  it('adds nothing for a total it has had before, however it is told: lowering it and raising it again makes no new cloud', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { sam, cal } = w;
    const S = sam.link.slot;
    await cloud(w, 500);
    expect(falloutOf(cal.sim).seen[S]).toBe(500);
    const put = airIn(cal);
    expect(put).toBeGreaterThan(0);
    // A sender that goes back to an older save, or lies: low, high, low, high.
    for (let k = 0; k < 6; k++) {
      await cloud(w, 1);
      expect(falloutOf(cal.sim).seen[S]).toBe(500);
      await cloud(w, 500);
    }
    expect(falloutOf(cal.sim).seen[S]).toBe(500);
    expect(airIn(cal)).toBeCloseTo(put, 5);
    // And a cloud that regrows to more than it ever was adds only the part past it.
    await cloud(w, ATOM_WIRE.plumePerBomb);
    expect(falloutOf(cal.sim).seen[S]).toBe(ATOM_WIRE.plumePerBomb);
    expect(airIn(cal)).toBeGreaterThan(put);
    expect(airIn(cal) - put).toBeLessThan(put);
  });

  it('has its baseline from the page: a total it first saw is known, the cloud it saw begin is new, and nothing else is a baseline', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { sam, cal } = w;
    const S = sam.link.slot;
    const fresh = () => {
      const sim = Sim.fromSave(JSON.parse(JSON.stringify(cal.sim.save())));
      sim.testMode = true;
      return sim;
    };
    const air = (sim: Sim) => [...(sim.state.fallout?.air ?? [])].reduce((a, b) => a + b, 0);
    // Seen from nothing (base 0): all of it is new.
    const a = fresh();
    expect(a.dispatch({ type: 'friendFallout', from: S, total: 40, base: 0 })).toMatchObject({ ok: true });
    expect(a.state.fallout!.seen[S]).toBe(40);
    expect(air(a)).toBeGreaterThan(0);
    // Seen at 40 when it began to count (a newcomer): nothing is new, and the baseline is kept.
    const b = fresh();
    expect(b.dispatch({ type: 'friendFallout', from: S, total: 40, base: 40 })).toMatchObject({
      ok: true,
      info: { deposited: 0 },
    });
    expect(b.state.fallout!.seen[S]).toBe(40);
    expect(air(b)).toBe(0);
    // A baseline above what is told now (the sender went back to a save): the baseline stands.
    const c = fresh();
    expect(c.dispatch({ type: 'friendFallout', from: S, total: 10, base: 40 })).toMatchObject({ ok: true });
    expect(c.state.fallout!.seen[S]).toBe(40);
    expect(air(c)).toBe(0);
    // With no baseline the first total is taken as known (the old rule), and a baseline of nothing sets nothing.
    const d = fresh();
    expect(d.dispatch({ type: 'friendFallout', from: S, total: 40 })).toMatchObject({ ok: true });
    expect(d.state.fallout!.seen[S]).toBe(40);
    expect(air(d)).toBe(0);
    const e = fresh();
    expect(e.dispatch({ type: 'friendFallout', from: S, total: 0, base: 0 })).toMatchObject({ ok: true });
    expect(e.state.fallout).toBeUndefined();
    // Once the sim has taken a cloud in, the baseline is not read again.
    expect(a.dispatch({ type: 'friendFallout', from: S, total: 60, base: 60 })).toMatchObject({ ok: true });
    expect(a.state.fallout!.seen[S]).toBe(60);
    expect(air(a)).toBeGreaterThan(0);
    // A preview changes nothing, and a baseline that is not a cloud is refused.
    const g = fresh();
    const before = g.hash();
    expect(g.preview({ type: 'friendFallout', from: S, total: 40, base: 0 })).toMatchObject({ ok: true });
    expect(g.hash()).toBe(before);
    for (const base of [-1, Number.NaN, Number.POSITIVE_INFINITY, ATOM_WIRE.plumeMax + 1, '3' as never])
      expect(g.dispatch({ type: 'friendFallout', from: S, total: 40, base }), String(base)).toMatchObject({
        ok: false,
      });
    expect(g.hash()).toBe(before);
  });

  it('is applied once by a city that reloaded, and a page that missed the news takes it all in one bounded step', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { sam, cal } = w;
    const S = sam.link.slot;
    await cloud(w, 12);
    await cloud(w, 40);
    const put = airIn(cal);
    expect(put).toBeGreaterThan(0);
    // The city is saved and loaded again (a page reloaded): what it has taken in is kept, so the same total adds nothing.
    const again = Sim.fromSave(JSON.parse(JSON.stringify(cal.sim.save())));
    again.testMode = true;
    const before = again.hash();
    const r = again.dispatch({ type: 'friendFallout', from: S, total: 40 });
    expect(r).toMatchObject({ ok: true, info: { deposited: 0 } });
    expect(again.hash()).toBe(before);
    // A page that missed most of the news is told of a much bigger total at once: it takes the part that is
    // new, but never more than one bomb's worth, and never a cell thicker than the cap.
    const airBefore = Float32Array.from(again.state.fallout!.air);
    const big = again.dispatch({ type: 'friendFallout', from: S, total: ATOM_WIRE.plumeMax });
    expect(big.ok).toBe(true);
    const f = again.state.fallout!;
    let most = 0;
    f.air.forEach((v, k) => (most = Math.max(most, v - airBefore[k]!)));
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(FALLOUT.friend.cell + 1e-6);
    expect(f.seen[S]).toBe(ATOM_WIRE.plumeMax);
    // The sender went back to an earlier save: a lower total changes nothing (what was taken in is a high-water
    // mark), so its cloud grown again adds nothing until it is past what was already had.
    const lower = again.hash();
    expect(again.dispatch({ type: 'friendFallout', from: S, total: 5 })).toMatchObject({
      ok: true,
      info: { deposited: 0 },
    });
    expect(again.state.fallout!.seen[S]).toBe(ATOM_WIRE.plumeMax);
    expect(again.hash()).toBe(lower);
  });

  it('is not taken from a city that is not a friend, or in numbers that are not a cloud', () => {
    const w = baseSim();
    const bad = (cmd: Parameters<Sim['dispatch']>[0]) => {
      const before = w.hash();
      const r = w.dispatch(cmd);
      expect(r.ok, JSON.stringify(cmd)).toBe(false);
      expect(w.hash()).toBe(before);
    };
    bad({ type: 'friendFallout', from: 9, total: 10 });
    bad({ type: 'friendFallout', from: 0, total: 10 });
    bad({ type: 'friendFallout', from: 2.5, total: 10 });
    bad({ type: 'friendFallout', from: 2, total: -1 });
    bad({ type: 'friendFallout', from: 2, total: Number.NaN });
    bad({ type: 'friendFallout', from: 2, total: ATOM_WIRE.plumeMax + 1 });
    bad({ type: 'friendFallout', from: 2, total: 10 });
  });
});

describe('M40 step 10: the winter, and a city that is away', () => {
  it('reaches a city on its return, once, however often it returns', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { sam, cal } = w;
    const S = sam.link.slot;
    // Calbury's player is away when a bomb falls on Samford.
    await cal.link.leave();
    await settle();
    atomOf(sam.sim).boom = 1;
    await sam.link.reportNow(true);
    await settle();
    expect(winters(cal)).toHaveLength(0);
    expect(winters(w.ada).map((x) => x.id)).toEqual([`${S}-1`]);
    // They come back: it is applied, at their own tick.
    cal.sim.advance(5 * H);
    const back = await returnPage(w, cal, 'Cal', 2);
    await settle(12);
    expect(winters(back).map((x) => x.id)).toEqual([`${S}-1`]);
    expect(winters(back)[0]!.from).toBe(back.sim.state.tick);
    back.sim.advance(H);
    expect(winterDepth(back.sim.state.weather, back.sim.state.tick)).toBeGreaterThan(0);
    // They leave and return again: the room tells them again, and the sim has it already.
    const hash = back.sim.hash();
    await back.link.leave();
    const again = await returnPage(w, back, 'Cal', 2);
    await settle(12);
    expect(winters(again)).toHaveLength(1);
    expect(again.sim.hash()).toBe(hash);
  });

  it('is applied by the id the room gave it, once, and nothing else is a winter', () => {
    const sim = baseSim();
    const before = sim.hash();
    const bad = ['', 'self:0', '2', '2-', '-1', '0-1', '2-0', '2-9', '99-1', '2-1 ', '2-1-1', 'x-1', '2--1'];
    for (const id of bad) {
      expect(sim.dispatch({ type: 'friendWinter', id }), id).toMatchObject({ ok: false });
    }
    expect(sim.dispatch({ type: 'friendWinter', id: 42 as never })).toMatchObject({ ok: false });
    expect(sim.hash()).toBe(before);
    expect(sim.preview({ type: 'friendWinter', id: '2-1' })).toMatchObject({ ok: true });
    expect(sim.hash()).toBe(before);
    expect(sim.dispatch({ type: 'friendWinter', id: '2-1' })).toMatchObject({ ok: true });
    expect(winters({ sim } as AtomPage).map((x) => x.id)).toEqual(['2-1']);
    const once = sim.hash();
    expect(sim.dispatch({ type: 'friendWinter', id: '2-1' })).toMatchObject({
      ok: true,
      info: { already: 1 },
    });
    expect(sim.hash()).toBe(once);
    // A region can make no more winters than its cities have bombs: a room made to send many fills no more of the city's list.
    for (let slot = 1; slot <= 6; slot++)
      for (let n = 1; n <= ATOM_WIRE.winters; n++) sim.dispatch({ type: 'friendWinter', id: `${slot}-${n}` });
    expect((sim.state.weather.winters ?? []).length).toBeLessThanOrEqual(ATOM_WIRE.winters * 5);
  });
});

describe('M40 step 10: declaring on a friend that fired', () => {
  it('has no newcomer’s or neutral’s shield, as the room allows; one that has not fired keeps them', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { ada, sam, cal } = w;
    const A = ada.link.slot;
    const adaForCal = () => friendOf(cal, A);
    for (const shield of ['new', 'neutral'] as const) {
      adaForCal().player!.raid = shield;
      adaForCal().player!.atom = { stage: atomStageNo('ready') };
      const held = friendDeclareProblem(cal.sim, adaForCal());
      expect(held.why, shield).toMatch(shield === 'new' ? /too young or small/ : /is neutral/);
    }
    // Ada fires her bomb at Samford: her report says so, and the city's check lets a declaration through.
    await totalWar(w, ada, sam);
    await ready(w, ada, sam);
    await look(ada);
    await tick3(w);
    expect(adaForCal().player!.atom).toMatchObject({ fired: true });
    for (const shield of ['new', 'neutral'] as const) {
      adaForCal().player!.raid = shield;
      expect(friendDeclareProblem(cal.sim, adaForCal()), shield).toEqual({ why: null, breaks: false });
    }
    expect(friendsSummary(cal.sim).find((f) => f.slot === A)).toMatchObject({ pariah: true, declare: null });
    // The city's own rules still stand: a neutral city that would declare is refused.
    cal.sim.state.war!.diplomacy!.neutral = { since: 0 };
    expect(friendDeclareProblem(cal.sim, adaForCal()).why).toMatch(/neutral city doesn’t go to war/);
    // And the room does allow it: Calbury declares at once, with no cooldown and no newcomer's shield.
    delete cal.sim.state.war!.diplomacy!.neutral;
    expect(cal.fw.declare(A, 'total', 'The bomb')).toBe(true);
    await settle();
    expect(cal.fw.refusal(`war:${A}`)).toBeFalsy();
    expect(mirrorWar(cal, A)).toBeDefined();
  });
});

describe('M40 step 10: what the page keeps of the room’s lists', () => {
  const mark = (o: object = {}) => ({ slot: 2, name: 'Samford', kind: 'ready', at: 5, ...o });

  it('cleans the record: well-formed marks only, the last sixteen, one first finisher, names of forty characters', () => {
    expect(cleanAtomMarks(null)).toEqual([]);
    expect(cleanAtomMarks('x')).toEqual([]);
    expect(cleanAtomMarks([mark({ first: true }), mark({ slot: 3, first: true })])).toEqual([
      { slot: 2, name: 'Samford', kind: 'ready', at: 5, first: true },
      { slot: 3, name: 'Samford', kind: 'ready', at: 5 },
    ]);
    const bad = [
      null,
      7,
      mark({ slot: 0 }),
      mark({ slot: 65 }),
      mark({ slot: 2.5 }),
      mark({ name: 3 }),
      mark({ kind: 'bomb' }),
      mark({ at: Number.NaN }),
      mark({ at: 'now' }),
      mark({ to: 99 }),
    ];
    expect(cleanAtomMarks(bad)).toEqual([]);
    expect(cleanAtomMarks([mark({ name: 'x'.repeat(200) })])[0]!.name).toHaveLength(40);
    const many = Array.from({ length: 40 }, (_, k) => mark({ at: k, kind: 'boom' }));
    const kept = cleanAtomMarks(many);
    expect(kept).toHaveLength(ATOM_WIRE.marks);
    expect(kept.at(-1)!.at).toBe(39);
    expect(cleanAtomMarks([mark({ to: 3, kind: 'fired' })])[0]).toMatchObject({ to: 3 });
  });

  it('cleans the winters: this city’s only, never its own, an id once, eight from a city at most', () => {
    const win = (id: string, slots = [3, 2], at = 1) => ({ id, at, slots });
    expect(cleanWinters(undefined, 3)).toEqual([]);
    expect(cleanWinters([win('2-1')], 3)).toEqual([win('2-1')]);
    // Not for this city, one of its own bombs', a repeat, malformed.
    expect(cleanWinters([win('2-1', [1, 2])], 3)).toEqual([]);
    expect(cleanWinters([win('3-1', [3, 2])], 3)).toEqual([]);
    expect(cleanWinters([win('2-1'), win('2-1')], 3)).toHaveLength(1);
    expect(
      cleanWinters(
        [
          win('self:0'),
          win('2-9'),
          win('0-1'),
          { id: '2-2', at: 'x', slots: [3] },
          { id: '2-3', at: 1 },
          null,
        ],
        3,
      ),
    ).toEqual([]);
    // Eight from one city and no more, and a few more than a region holds in all.
    const flood = Array.from({ length: 20 }, (_, k) => win(`2-${(k % 8) + 1}`)).concat(
      Array.from({ length: 12 }, (_, k) => win(`${4 + (k % 6)}-${(k % 8) + 1}`)),
    );
    const kept = cleanWinters(flood, 3);
    expect(kept.filter((x) => x.id.startsWith('2-')).length).toBeLessThanOrEqual(ATOM_WIRE.winters);
    expect(kept.length).toBeLessThanOrEqual(ATOM_WIRE.winters * 4);
    // A hostile host's slots are cut down, too.
    expect(
      cleanWinters(
        [
          win(
            '2-1',
            Array.from({ length: 50 }, (_, k) => k + 1),
          ),
        ],
        3,
      )[0]!.slots,
    ).toHaveLength(8);
  });

  it('is not moved by a list that is nonsense: the page keeps the record it had, empty', async () => {
    const w = await openAtomWorld(saves, { atomPrep: 60_000 });
    const { ada } = w;
    ada.atom.message({ t: 'atoms', atoms: 'nonsense' as never });
    ada.atom.message({ t: 'winters', winters: { id: '2-1' } as never });
    await ada.atom.idle();
    expect(ada.atom.atoms).toEqual([]);
    expect(winters(ada)).toHaveLength(0);
    // A first-finisher word for a city that has no bomb is refused by the sim, and changes nothing.
    const before = ada.sim.hash();
    ada.atom.message({ t: 'atomFirst', at: 1 });
    await ada.atom.idle();
    expect(ada.sim.hash()).toBe(before);
    expect(ada.sim.state.war!.atom?.first).toBeUndefined();
  });
});

/** A war city that is not in a region: the commands that need no room, tried on it. */
function baseSim(): Sim {
  const sim = Sim.fromSave(JSON.parse(JSON.stringify(saves.ada)));
  sim.testMode = true;
  return sim;
}
