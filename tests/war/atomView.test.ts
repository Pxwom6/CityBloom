import { beforeAll, describe, expect, it } from 'vitest';
import type { RegionAtomMark } from '../../relay/region';
import { ATOM, ATOM_STAGES, WINTER_YEARS, atomStageNo, type AtomStage } from '../../src/data/atom';
import { DOME, TIER_KEYS } from '../../src/data/research';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import type { Sim } from '../../src/sim/sim';
import { atomSummary, type AtomSummary } from '../../src/sim/systems/atom';
import { falloutSummary, falloutYears } from '../../src/sim/systems/fallout';
import { bombStopped, supersSummary, type SupersSummary } from '../../src/sim/systems/supers';
import {
  HOLD_MS,
  PIPS,
  aftermath,
  bombTabShown,
  buildTerms,
  cloudOnMap,
  consequences,
  countdown,
  defaultTarget,
  domeLine,
  etaClock,
  falloutLines,
  headline,
  holdFraction,
  holdKey,
  holdSeconds,
  ladderRows,
  launchGuestWhy,
  launchTerms,
  launchWords,
  markLines,
  moneyWords,
  playWords,
  pointerInside,
  raceRows,
  shelterLine,
  stopTerms,
  targetRows,
  warTime,
} from '../../src/ui/atomView';
import { HOST_ONLY_LAUNCH, roomRefusal, type SharedRules } from '../../src/sim/rules';
import { openScenario } from '../scenarios/harness';
import { clone, dip, rivals } from './economyHelpers';
import { labTown, ok } from './researchTown';

/**
 * M40 step 11: the war room's Bomb tab in plain arithmetic. The ladder, the launch's targets and
 * consequences, the countdown and the dome in a sentence, the region's race and the fallout block are
 * all pure (`src/ui/atomView.ts`); each is held to the sim's own summary here, on a real war town at
 * each stage of the race. The tone (no word of anyone hurt) is held over every string they make.
 */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;
const NOT_SAID = /casualt|killed|dead|victim|death/i;

let base: Sim;
let rivalId: number;

const civic = (sim: Sim, def: string) => [...sim.state.civics.values()].find((c) => c.def === def)!;

beforeAll(() => {
  const { sim, place } = labTown(0, { length: 800, streets: 7 });
  place('nuclear');
  sim.advance(M);
  ok(sim, { type: 'cheat', cheat: 'research', tiers: [...TIER_KEYS] });
  ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 60_000_000 });
  ok(sim, { type: 'cheat', cheat: 'finishStages', civic: place('enrichment') });
  ok(sim, { type: 'cheat', cheat: 'finishStages', civic: place('atomsilo') });
  // (The dome last, so nothing else in the town moves for it.)
  ok(sim, { type: 'cheat', cheat: 'finishStages', civic: place('domeshield') });
  for (const n of sim.state.region.neighbours) if (n.rival) n.rival.blackout = { from: 0, until: 1e9 };
  sim.advance(3 * M);
  base = sim;
  rivalId = rivals(sim)[0]!.id;
}, 180_000);

/** A copy of the base town at a stage of the race, crews at full strength. */
function at(stage: AtomStage, war = false): Sim {
  const sim = clone(base);
  // (The stage follows the buildings: before the silo the city has none, and before the plant neither.)
  if (stage === 'none' || stage === 'plant' || stage === 'enriching')
    sim.removeCivic(civic(sim, 'atomsilo').id);
  if (stage === 'none') sim.removeCivic(civic(sim, 'enrichment').id);
  ok(sim, { type: 'cheat', cheat: 'atom', stage, to: rivalId });
  for (const def of ['enrichment', 'atomsilo']) {
    const c = civic(sim, def);
    if (c) {
      c.staff = 1;
      c.powered = 1;
    }
  }
  if (war) {
    ok(sim, { type: 'declareWar', neighbour: rivalId, scale: 'total', reason: 'The race' });
    const w = dip(sim).wars.find((x) => x.with === rivalId)!;
    sim.advance(Math.max(0, w.opens - sim.state.tick) + 1);
  }
  return sim;
}

/** A bomb in the air as the summary reports it, for the pure cases. */
const inbound = (
  over: Partial<NonNullable<AtomSummary['inbound']>> = {},
): NonNullable<AtomSummary['inbound']> => ({
  from: 'Calhaven',
  arrive: 1_000,
  x: 0,
  z: 0,
  near: 0,
  sheltered: 0,
  stops: false,
  raisable: false,
  ...over,
});

/** Every string a value holds, at any depth. */
function strings(v: unknown, into: string[] = []): string[] {
  if (typeof v === 'string') into.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, into);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, into);
  return into;
}

describe('M40 step 11: the ladder', () => {
  const rows = (sim: Sim) => ladderRows(atomSummary(sim)!);
  const row = (sim: Sim, id: string) => rows(sim).find((r) => r.id === id)!;

  it('has the eight rungs in order, and always points at the first one not done', () => {
    for (const stage of ATOM_STAGES) {
      if (stage === 'flying') continue;
      const sim = at(stage);
      const r = rows(sim);
      expect(
        r.map((x) => x.id),
        stage,
      ).toEqual(['research', 'plant', 'fuel', 'silo', 'bomb', 'ready', 'launch', 'fired']);
      const next = r.find((x) => x.state !== 'done');
      // The rung to work on is never a bare "todo", and it is the first that isn't done.
      if (next) expect(next.state, `${stage}: ${next.id}`).not.toBe('todo');
      for (const x of r.slice(0, r.indexOf(next ?? r[r.length - 1]!)))
        expect(x.state, `${stage}: ${x.id} comes before the rung in hand`).toBe('done');
    }
  });

  it('counts the research and names the tier still to do', () => {
    const sim = clone(base);
    const full = row(sim, 'research');
    expect(full).toMatchObject({ state: 'done', text: '24 of 24 tiers done', reason: null, bar: 1 });
    sim.state.war!.research!.done = TIER_KEYS.filter((k) => k !== 'sea3');
    const s = atomSummary(sim)!;
    const part = ladderRows(s).find((x) => x.id === 'research')!;
    expect(part.state).toBe('now');
    expect(part.text).toBe('23 of 24 tiers done');
    expect(part.reason).toBe(`Every branch must be maxed. Next: ${s.research.next}`);
    expect(part.bar).toBeCloseTo(23 / 24);
    // The rules' words come first when the bomb is off.
    sim.state.region.rules = { war: true, scale: 'total', supers: true };
    expect(row(sim, 'research').reason).toBe('Your region’s rules turn the atom bomb off');
  });

  it('follows the plant, the fuel and the silo with the sim’s own waits', () => {
    // No plant yet: it says what is needed (the nuclear plant stands and runs).
    const none = at('none');
    expect(row(none, 'plant')).toMatchObject({
      state: 'now',
      text: 'Not built',
      reason: 'Place it from the Military bar',
    });
    expect(row(none, 'fuel')).toMatchObject({ state: 'todo', reason: 'Needs the plant' });
    // A plant that is built and making fuel.
    const making = at('enriching');
    atomSummary(making);
    expect(row(making, 'plant')).toMatchObject({ state: 'done', text: 'Built and working' });
    expect(row(making, 'fuel').state).toBe('now');
    expect(row(making, 'fuel').text).toMatch(/ % of a full load$/);
    expect(row(making, 'silo')).toMatchObject({ state: 'todo', text: 'Not built' });
    // Short of workers: the wait is the sim's.
    civic(making, 'enrichment').staff = 0.1;
    const waiting = row(making, 'fuel');
    expect(waiting.state).toBe('wait');
    expect(waiting.reason).toBe(atomSummary(making)!.fuelWait);
    expect(waiting.reason).toMatch(/needs workers/);
    // A full load.
    const full = at('silo');
    expect(row(full, 'fuel')).toMatchObject({ state: 'done', text: 'A full load', reason: null, bar: 1 });
    expect(row(full, 'silo')).toMatchObject({ state: 'done', text: 'Built' });
  });

  it('shows the bomb’s build with its instalments and why it waits', () => {
    const building = at('bomb');
    const s = atomSummary(building)!;
    const bomb = row(building, 'bomb');
    expect(bomb.state).toBe('now');
    expect(bomb.text).toBe(
      `${Math.round(s.bomb!.done * 100)} % built, instalment ${s.bomb!.paid} of ${s.bomb!.of}`,
    );
    expect(bomb.bar).toBe(s.bomb!.done);
    civic(building, 'atomsilo').powered = 0.2;
    const waiting = row(building, 'bomb');
    expect(waiting.state).toBe('wait');
    expect(waiting.reason).toBe(atomSummary(building)!.bomb!.wait);
    expect(waiting.reason).toMatch(/silo needs power/);
    // Before it starts: the bomb's own gate says why not.
    const silo = at('silo');
    delete silo.state.war!.atom!.bomb;
    silo.state.war!.atom!.fuel = ATOM.fuel.hours / 2;
    // (The fuel is the rung in hand; the bomb's own gate says why it can't start yet.)
    expect(row(silo, 'bomb')).toMatchObject({ state: 'todo', text: 'Not started' });
    expect(row(silo, 'bomb').reason).toMatch(/full load of fuel \(50 % made\)/);
    expect(row(silo, 'fuel').state).toBe('now');
    // A full load and the gates open: the bomb is the rung in hand.
    silo.state.war!.atom!.fuel = ATOM.fuel.hours;
    expect(row(silo, 'bomb')).toMatchObject({ state: 'now', text: 'Not started', reason: null });
  });

  it('shows the bomb ready, the launch preparing, prepared and held, and the bomb used', () => {
    const ready = at('ready');
    expect(row(ready, 'bomb')).toMatchObject({ state: 'done', text: 'Built' });
    expect(row(ready, 'ready')).toMatchObject({ state: 'done', text: 'The bomb is in the silo' });
    expect(row(ready, 'launch')).toMatchObject({ state: 'now', text: 'Not aimed yet' });

    const preparing = at('preparing');
    const s = atomSummary(preparing)!;
    expect(row(preparing, 'launch').text).toBe(
      `Preparing for ${s.launch!.name}, ${Math.round(s.launch!.done * 100)} %`,
    );
    expect(row(preparing, 'launch').bar).toBe(s.launch!.done);

    // Prepared, and the war is not open: held, with the sim's words.
    preparing.state.war!.atom!.prep!.done = ATOM.launch.prepHours;
    const held = row(preparing, 'launch');
    expect(held.state).toBe('wait');
    expect(held.text).toBe(`Prepared for ${s.launch!.name}`);
    expect(held.reason).toBe(atomSummary(preparing)!.launch!.held);
    expect(held.reason).toMatch(/total war/);

    const spent = at('spent');
    expect(row(spent, 'launch')).toMatchObject({ state: 'done', text: 'Left the silo' });
    expect(row(spent, 'fired').state).toBe('done');
    expect(row(spent, 'fired').text).toMatch(/^Fired at /);
    // Every rung of a used bomb is done.
    expect(rows(spent).every((r) => r.state === 'done' || r.id === 'launch' || r.id === 'fired')).toBe(true);
  });

  it('names the rung in hand in a line, whatever the region would call the stage', () => {
    // The silo stands and the fuel is half made: the region says "Silo going up", the city knows better.
    const racing = at('silo');
    racing.state.war!.atom!.fuel = ATOM.fuel.hours / 2;
    expect(headline(atomSummary(racing)!)).toBe('Fuel: 50 % of a full load');
    expect(headline(atomSummary(at('bomb'))!)).toMatch(/^The bomb: \d+ % built, instalment \d+ of 12$/);
    expect(headline(atomSummary(at('ready'))!)).toBe('Launch: Not aimed yet');
    expect(headline(atomSummary(at('spent'))!)).toBe('The atom bomb has been used');
    expect(headline(atomSummary(at('none'))!)).toBe('Enrichment plant: Not built');
    const flying = atomSummary(at('flying'))!;
    expect(headline(flying)).toBe('The atom bomb is on its way');
    // The race list says the same of the city.
    const rows = raceRows('Ashton', atomSummary(racing)!, [], []);
    expect(rows[0]!.stageName).toBe('Fuel: 50 % of a full load');
  });

  it('says nothing of anyone hurt, at any stage', () => {
    for (const stage of ATOM_STAGES) {
      const words = strings(rows(at(stage)));
      expect(words.length).toBeGreaterThan(10);
      for (const w of words) expect(w, `${stage}: ${w}`).not.toMatch(NOT_SAID);
    }
  });
});

describe('M40 step 11: the launch card', () => {
  it('lists the neighbours the city is in a total war with first, the others greyed with the sim’s reason', () => {
    const sim = at('ready', true);
    const s = atomSummary(sim)!;
    const rows = targetRows(s);
    expect(rows).toHaveLength(s.targets.length);
    expect(rows[0]).toMatchObject({ id: rivalId, why: null });
    for (const r of rows.slice(1)) {
      expect(r.why, r.name).toMatch(/total war/);
      expect(r.why).toBe(s.targets.find((t) => t.id === r.id)!.why);
    }
    // The first target is the default; a chosen one that can be aimed at is kept; one that can't isn't.
    expect(defaultTarget(s, null)).toBe(rivalId);
    expect(defaultTarget(s, rows[1]!.id)).toBe(rivalId);
    expect(defaultTarget(s, rivalId)).toBe(rivalId);
    // No war: nothing to pick.
    const peace = atomSummary(at('ready'))!;
    expect(targetRows(peace).every((r) => r.why)).toBe(true);
    expect(defaultTarget(peace, null)).toBeNull();
  });

  it('marks a friend’s city as one', () => {
    const s = atomSummary(at('ready'))!;
    const withFriend: AtomSummary = {
      ...s,
      targets: [...s.targets, { id: 99, name: 'Brookline', friend: true, why: null }],
    };
    const rows = targetRows(withFriend);
    expect(rows[0]).toMatchObject({ id: 99, label: 'Brookline (a friend’s city)' });
  });

  it('lists the consequences from the sim’s numbers, in plain words', () => {
    const list = consequences();
    const text = list.join(' ');
    for (const part of [
      /reputation falls to nothing, for good/i,
      /Every computer neighbour embargoes the city/,
      /pact and alliance/,
      /declare a total war on the city at once/,
      /protest/,
      new RegExp(
        `nuclear winter .* every city in the region, yours included.* about ${WINTER_YEARS} game years`,
      ),
      /Fallout lies/,
    ])
      expect(text).toMatch(part);
    expect(launchTerms()).toBe(
      `Holding the button pays $1.2M and starts the preparation, about ${playWords(ATOM.launch.prepHours)} of play. Until the bomb leaves you can call it off, and $600,000 comes back.`,
    );
    expect(buildTerms()).toBe(
      `12 instalments of $650,000, each with 50 goods, 200 ore and 167 oil, taken from the war stores first and bought in for the rest. About ${playWords(ATOM.bomb.hours)} of play. If it is stopped, everything built so far is lost, what was paid stays spent, and starting again begins from nothing.`,
    );
    for (const w of [...list, launchTerms(), buildTerms()]) expect(w).not.toMatch(NOT_SAID);
  });

  it('counts the hold in thirds of a second and seconds', () => {
    expect(HOLD_MS).toBe(3000);
    expect(holdFraction(-5)).toBe(0);
    expect(holdFraction(0)).toBe(0);
    expect(holdFraction(1500)).toBe(0.5);
    expect(holdFraction(3000)).toBe(1);
    expect(holdFraction(9000)).toBe(1);
    expect([0, 1, 1000, 1001, 2999, 3000].map(holdSeconds)).toEqual([3, 3, 2, 2, 1, 0]);
  });

  it('says money and play time the way the war room does', () => {
    expect(moneyWords(1_200_000)).toBe('$1.2M');
    expect(moneyWords(600_000)).toBe('$600,000');
    expect(moneyWords(350_000)).toBe('$350,000');
    expect(moneyWords(2_000_000)).toBe('$2M');
    expect(playWords(4)).toBe('30 seconds');
    // Never "1 seconds", and never "0 seconds" in the card's last moments.
    for (const h of [0, 0.05, 0.1, 0.15]) expect(playWords(h), `${h} h`).toBe('1 second');
    expect(playWords(0.2)).toBe('2 seconds');
    expect(playWords(24)).toBe('3 minutes');
    expect(playWords(ATOM.launch.prepHours)).toBe('36 minutes');
    expect(playWords(1_440)).toBe('3 hours');
    expect(playWords(1_152)).toBe('2.5 hours');
  });
});

describe('M40 step 11: the countdown', () => {
  it('reads the clock as the raid chip does', () => {
    expect(etaClock(24 * H)).toBe('24:00');
    expect(etaClock(90)).toBe('1:30');
    expect(etaClock(61)).toBe('1:01');
    expect(etaClock(0)).toBe('0:00');
    expect(etaClock(-20)).toBe('0:00');
  });

  it('is made from a bomb in the air: who, the clock, the aim, the shelters and the dome', () => {
    const sim = at('none');
    ok(sim, { type: 'cheat', cheat: 'bombIn', hours: 24 });
    sim.advance(2);
    const s = atomSummary(sim)!;
    expect(s.inbound).not.toBeNull();
    const dome = supersSummary(sim)!.dome;
    const c = countdown(s.inbound!, sim.state.tick, dome, false);
    expect(c.from).toBe(s.inbound!.from);
    expect(c.eta).toBe(etaClock(s.inbound!.arrive - sim.state.tick));
    expect(c.hoursLeft).toBeCloseTo((s.inbound!.arrive - sim.state.tick) / H, 6);
    expect(c.playLeft).toBe('3 minutes');
    expect(c.aim).toBe('Aimed at your densest district');
    expect(c.shelter === null || /residents in its path can reach a shelter\.$/.test(c.shelter)).toBe(true);
    // The display clock ticks it down; it never goes below nothing.
    const later = countdown(s.inbound!, s.inbound!.arrive + 50, dome, false);
    expect(later.eta).toBe('0:00');
    expect(later.hoursLeft).toBe(0);
    for (const w of strings(c)) expect(w).not.toMatch(NOT_SAID);
  });

  it('tells the shelters in a line, or nothing without anyone near', () => {
    expect(shelterLine(0, 0)).toBeNull();
    expect(shelterLine(1200, 450)).toBe('450 of the 1,200 residents in its path can reach a shelter.');
  });

  it('puts the dome in a sentence that agrees with the sim’s answer', () => {
    const d = (over: Partial<NonNullable<SupersSummary['dome']>> = {}) => ({
      civic: 1,
      charge: 1,
      mode: 'all' as const,
      raised: false,
      down: 0,
      ...over,
    });
    // Charged: it will stop the bomb, then is down for about 3 hours of play (DOME.bombRecharge).
    const stops = domeLine(d(), true, false);
    expect(stops).toEqual({
      text: `The dome shield is charged: it will stop the bomb, then it is down for about ${playWords(DOME.bombRecharge)} of play.`,
      tone: 'good',
      kind: 'stops',
      raise: false,
    });
    expect(stops.text).toContain('about 3 hours of play');
    expect(domeLine(null, false, false)).toMatchObject({
      text: 'The city has no dome shield: nothing will stop it.',
      tone: 'bad',
      raise: false,
    });
    expect(domeLine(d({ down: 600 }), false, false).text).toBe(
      `The dome shield is down for ${playWords(600)} more: it can’t stop this bomb.`,
    );
    expect(domeLine(d(), false, true).text).toBe(
      'A blackout has the dome shield dark: it can’t stop this bomb.',
    );
    expect(domeLine(d({ charge: 0.4 }), false, false).text).toBe(
      'The dome shield is still charging (40 %): it can’t stop this bomb yet.',
    );
    // Charged but switched off, and the sim says raising it would stop the bomb: it can be raised.
    const off = domeLine(d({ mode: 'off' }), false, false, true);
    expect(off).toMatchObject({ tone: 'warn', raise: true, kind: 'off' });
    expect(off.text).toMatch(/switched off/);
    // Charged and switched off but not working (no crew, no power): raising it would not help, so it is not offered.
    const dark = domeLine(d({ mode: 'off' }), false, false, false);
    expect(dark).toMatchObject({ tone: 'bad', raise: false, kind: 'idle' });
    expect(dark.text).toMatch(/needs workers and power/);
    // A charged dome in a mode that stops it, but not working: no raise button.
    expect(domeLine(d(), false, false)).toMatchObject({ tone: 'bad', raise: false });
    expect(domeLine(d(), false, false).text).toMatch(/needs workers and power/);
    // The words a screen reader gets hold no figure that moves while the card counts down.
    expect(countdown(inbound({ raisable: false }), 0, d({ charge: 0.4 }), false).announce).not.toMatch(/\d/);
    expect(countdown(inbound({ raisable: false }), 0, d({ down: 600 }), false).announce).not.toMatch(/\d/);
  });

  describe('the dome on the card is the real dome', () => {
    const dome = (sim: Sim) => sim.state.war!.supers!.dome!;
    /** The dome at full strength: crewed, powered, charged, in the mode that stops a bomb. */
    function charged(sim: Sim): void {
      const c = civic(sim, 'domeshield');
      c.staff = 1;
      c.powered = 1;
      const d = dome(sim);
      d.hours = DOME.chargeHours;
      d.mode = 'all';
      delete d.down;
      delete d.reserve;
      delete d.raised;
    }
    /** What the card makes of the bomb in the air over this town (`fire`: first send one), with the sim's own answer beside it. */
    function card(sim: Sim, fire = true) {
      if (fire) {
        ok(sim, { type: 'cheat', cheat: 'bombIn', hours: 24 });
        sim.advance(2);
      }
      const sum = atomSummary(sim)!;
      const sup = supersSummary(sim)!;
      const c = countdown(sum.inbound!, sim.state.tick, sup.dome, !!sup.blackout);
      return { sum, c, stops: bombStopped(sim), raised: bombStopped(sim, true) };
    }
    const town = () => {
      const sim = clone(base);
      charged(sim);
      return sim;
    };

    it('a charged, working dome stops the bomb, and the card says it will', () => {
      const sim = town();
      const { sum, c, stops } = card(sim);
      expect(stops).toBe(true);
      expect(sum.inbound!.stops).toBe(true);
      expect(c.dome).toMatchObject({ kind: 'stops', tone: 'good', raise: false });
      expect(c.dome.text).toContain('it will stop the bomb');
    });

    it('a charged, working dome that is switched off is offered for raising, and raising it does what the card says', () => {
      const sim = town();
      dome(sim).mode = 'off';
      const before = card(sim);
      expect(before.stops).toBe(false);
      expect(before.raised, 'the sim says raising it would stop the bomb').toBe(true);
      expect(before.sum.inbound).toMatchObject({ stops: false, raisable: true });
      expect(before.c.dome).toMatchObject({ kind: 'off', tone: 'warn', raise: true });
      // The button's own command, then the card again.
      ok(sim, { type: 'setDome', mode: 'super' });
      const after = card(sim, false);
      expect(after.stops).toBe(true);
      expect(after.sum.inbound!.stops).toBe(true);
      expect(after.c.dome).toMatchObject({ kind: 'stops', raise: false });
    });

    it('a switched-off dome that is not working is not offered for raising: raising it would not stop the bomb', () => {
      for (const [name, cause] of [
        ['no crew', (sim: Sim) => (civic(sim, 'domeshield').staff = 0.1)],
        ['no power', (sim: Sim) => (civic(sim, 'domeshield').powered = 0.2)],
      ] as const) {
        const sim = town();
        dome(sim).mode = 'off';
        cause(sim);
        const { sum, c, stops, raised } = card(sim);
        expect(stops, name).toBe(false);
        expect(raised, `${name}: the sim agrees raising it would not help`).toBe(false);
        expect(sum.inbound!.raisable, name).toBe(false);
        expect(c.dome.raise, `${name}: no button`).toBe(false);
        expect(c.dome, name).toMatchObject({ kind: 'idle', tone: 'bad' });
        expect(c.dome.text, name).toMatch(/needs workers and power/);
      }
    });

    it('every state of the dome has the card say what the sim says', () => {
      const cases: { name: string; kind: string; cause: (sim: Sim) => void }[] = [
        {
          name: 'working but unstaffed',
          kind: 'idle',
          cause: (sim) => (civic(sim, 'domeshield').staff = 0.1),
        },
        {
          name: 'still charging',
          kind: 'charging',
          cause: (sim) => (dome(sim).hours = DOME.chargeHours / 2),
        },
        { name: 'down from stopping a bomb', kind: 'down', cause: (sim) => (dome(sim).down = 600) },
        {
          name: 'dark in a blackout',
          kind: 'blackout',
          cause: (sim) => {
            const w = sim.state.war!;
            w.blackout = { by: 1, from: w.clock - 1, until: w.clock + 10 };
          },
        },
        { name: 'gone', kind: 'none', cause: (sim) => sim.removeCivic(civic(sim, 'domeshield').id) },
      ];
      for (const { name, kind, cause } of cases) {
        const sim = town();
        cause(sim);
        const { sum, c, stops } = card(sim);
        expect(stops, name).toBe(false);
        expect(sum.inbound!.stops, name).toBe(false);
        expect(c.dome.kind, name).toBe(kind);
        expect(c.dome.raise, `${name}: nothing to raise`).toBe(false);
      }
    });
  });

  it('tells what a bomb left behind: the count that left and the buildings levelled, or the dome’s save', () => {
    expect(aftermath('hit', { from: 'Calhaven', fled: 1234, levelled: 56 })).toEqual({
      title: 'The atom bomb landed',
      text: '1,234 residents have left the city; 56 buildings were levelled. Fallout lies on the ground, and a nuclear winter is coming.',
    });
    const saved = aftermath('stopped', { from: 'Calhaven' });
    expect(saved.title).toBe('The dome shield stopped the bomb');
    expect(saved.text).toContain('did no harm');
    expect(saved.text).toContain(`about ${playWords(DOME.bombRecharge)} of play`);
    for (const w of [...strings(aftermath('hit', {})), ...strings(saved)]) expect(w).not.toMatch(NOT_SAID);
  });
});

describe('M40 step 11: the region’s race', () => {
  const friend = (slot: number, name: string, atom?: { stage: number; fuel?: number; fired?: true }) => ({
    id: 10 + slot,
    name,
    player: { slot, ...(atom ? { atom } : {}) },
  });

  it('lists the city, the friends that have begun and the computer neighbours that race, furthest first', () => {
    const sim = at('bomb');
    ok(sim, {
      type: 'cheat',
      cheat: 'rivalBomb',
      neighbour: rivals(sim)[1]!.id,
      stage: 'enriching',
      hours: 750,
    });
    const s = atomSummary(sim)!;
    const marks: RegionAtomMark[] = [{ slot: 2, name: 'Brookline', kind: 'ready', at: 5, first: true }];
    const rows = raceRows(
      'Ashton',
      s,
      [
        friend(2, 'Brookline', { stage: 5 }),
        friend(3, 'Cedarvale', { stage: 2, fuel: 40 }),
        friend(4, 'Dunmore'),
        friend(5, 'Elmford', { stage: 0 }),
      ],
      marks,
    );
    expect(rows.map((r) => `${r.name}:${r.stage}`)).toEqual(
      ['Brookline:5', 'Ashton:4', `${s.rivals[0]!.name}:2`, 'Cedarvale:2'].sort(
        (a, b) => Number(b.split(':')[1]) - Number(a.split(':')[1]) || a.localeCompare(b),
      ),
    );
    const brook = rows.find((r) => r.name === 'Brookline')!;
    expect(brook).toMatchObject({
      who: 'friend',
      ready: true,
      first: true,
      pips: 5,
      fuel: null,
      stageName: 'Atom bomb ready',
    });
    const me = rows.find((r) => r.who === 'city')!;
    expect(me).toMatchObject({ stage: 4, pips: 4, first: false, fuel: 100 });
    const cedar = rows.find((r) => r.name === 'Cedarvale')!;
    expect(cedar).toMatchObject({ fuel: 40, pips: 2, ready: false });
    // The computer neighbour's fuel, halfway through its 1,500 hours.
    const comp = rows.find((r) => r.who === 'computer')!;
    expect(comp.fuel).toBe(50);
    expect(comp.pips).toBe(2);
    // Nobody racing: no rows.
    expect(raceRows('Ashton', atomSummary(at('none'))!, [friend(2, 'Brookline')], [])).toEqual([]);
  });

  it('marks the city first when the sim says so, and shows a fired bomb', () => {
    const sim = at('spent');
    const s = atomSummary(sim)!;
    const rows = raceRows('Ashton', { ...s, first: true }, [], []);
    expect(rows[0]).toMatchObject({
      who: 'city',
      first: true,
      fired: true,
      stage: atomStageNo('spent'),
      pips: PIPS,
    });
  });

  it('puts the region’s record in lines, newest first', () => {
    const marks: RegionAtomMark[] = [
      { slot: 2, name: 'Brookline', kind: 'ready', at: 1, first: true },
      { slot: 2, name: 'Brookline', kind: 'fired', at: 2, to: 3 },
      { slot: 3, name: 'Cedarvale', kind: 'boom', at: 3 },
      { slot: 3, name: 'Cedarvale', kind: 'stopped', at: 4 },
    ];
    const names = (slot: number) => ({ 2: 'Brookline', 3: 'Cedarvale' })[slot] ?? `City ${slot}`;
    expect(markLines(marks, names)).toEqual([
      'Cedarvale’s dome has stopped an atom bomb',
      'An atom bomb has fallen on Cedarvale',
      'Brookline has fired the atom bomb at Cedarvale',
      'Brookline has the atom bomb, the first in the region',
    ]);
  });

  it('shows the tab when the bomb is allowed or something of it exists, and not otherwise', () => {
    const s = atomSummary(at('none'))!;
    expect(bombTabShown(null, [], 0)).toBe(false);
    expect(bombTabShown(s, [], 0)).toBe(true);
    const off: AtomSummary = { ...s, allowed: false, rules: 'off' };
    expect(bombTabShown(off, [], 0)).toBe(false);
    expect(bombTabShown({ ...off, stage: 'enriching' }, [], 0)).toBe(true);
    expect(bombTabShown({ ...off, fallout: true }, [], 0)).toBe(true);
    expect(bombTabShown({ ...off, impact: { x: 0, z: 0, fled: 0, levelled: 0, over: true } }, [], 0)).toBe(
      true,
    );
    expect(
      bombTabShown({ ...off, rivals: [{ id: 1, name: 'X', stage: 2, fuel: 5, launchIn: null }] }, [], 0),
    ).toBe(true);
    expect(bombTabShown(off, [{ player: { atom: { stage: 3 } } }], 0)).toBe(true);
    expect(bombTabShown(off, [{ player: { atom: { stage: 0 } } }], 0)).toBe(false);
    expect(bombTabShown(off, [], 2)).toBe(true);
  });
});

describe('M40 step 11: the fallout block', () => {
  it('puts the closed ground, the years left, the crews and the price in words', () => {
    const sim = at('spent');
    ok(sim, { type: 'cheat', cheat: 'bombIn', hours: 0 });
    sim.advance(3);
    // Let the blast be dealt out so the ground is laid.
    sim.advance(6 * H);
    const f = falloutSummary(sim);
    expect(f, 'the bomb laid fallout').not.toBeNull();
    const lines = falloutLines(f!, falloutYears(f!.peak));
    expect(lines.closed).toMatch(/^\d+\.\d\d km² of ground is closed to building$/);
    expect(lines.years).toMatch(/^The worst of it reopens in about \d+ game years$/);
    expect(lines.crews).toBe('No crews are out');
    expect(lines.price).toBe(
      `$350,000 a crew${f!.relief ? ' (relief crews cost twice as much until Repair crews are researched)' : ''}`,
    );
    // A crew out.
    const out = falloutLines(
      {
        ...f!,
        jobs: [
          { x: 1, z: 1, left: 40 },
          { x: 2, z: 2, left: 10 },
        ],
      },
      10,
    );
    expect(out.crews).toBe('2 of 3 crews out');
    // Clean ground.
    const clean = falloutLines({ ...f!, closedArea: 0 }, 0);
    expect(clean).toMatchObject({ closed: 'No ground is closed to building', years: null });
    for (const w of [...strings(lines), ...strings(out), ...strings(clean)]) expect(w).not.toMatch(NOT_SAID);
  });
});

describe('M40 step 11 review: words, guards and the places they stand', () => {
  it('counts a rival’s wait in the game’s own months, one of them in the singular', () => {
    expect(warTime(0)).toBe('0 h');
    expect(warTime(12)).toBe('12 h');
    expect(warTime(24)).toBe('1 month');
    expect(warTime(36)).toBe('1.5 months');
    expect(warTime(240)).toBe('10 months');
    expect(launchWords(240)).toBe('leaves in about 10 months');
    expect(launchWords(24)).toBe('leaves in about 1 month');
    expect(launchWords(5)).toBe('leaves in about 5 h');
    expect(launchWords(1)).toBe('leaves in about 1 h');
    // Never "0 days", never "1 days": the last hour is the last hour.
    expect(launchWords(0.4)).toBe('leaves within the hour');
    expect(launchWords(0)).toBe('leaves within the hour');
    for (const h of [0, 0.4, 1, 5, 24, 48, 240])
      expect(launchWords(h), `${h} h`).not.toMatch(/\b0 |1 [a-z]+s\b|days/);
  });

  it('tells what stopping the build throws away: all of it, with the money paid staying spent', () => {
    const text = stopTerms({ done: 0.5, paid: 7, of: 12 });
    expect(text).toContain('50 % built');
    expect(text).toContain('7 of 12 instalments paid');
    expect(text).toContain(`${moneyWords(7 * ATOM.bomb.instalment.money)} and the materials) stays spent`);
    expect(text).toMatch(/all of that is lost/);
    expect(text).toMatch(/starting again begins from nothing and pays the first instalment again/);
    expect(text).not.toMatch(NOT_SAID);
    // The button's own caption cannot be read as "picked up again later" either.
    expect(buildTerms()).toMatch(/everything built so far is lost/);
    expect(buildTerms()).toMatch(/starting again begins from nothing/);
  });

  it('the consequences name computer neighbours only for the embargo, which is all the sim imposes', () => {
    const text = consequences().join(' ');
    expect(text).toMatch(/Every computer neighbour embargoes the city/);
    expect(text).not.toMatch(/Every neighbour/);
  });

  it('keeps the keys of a held button to the hold: the repeats are swallowed, and only the first press begins', () => {
    expect(holdKey({ key: ' ', repeat: false })).toEqual({ swallow: true, begin: true });
    expect(holdKey({ key: ' ', repeat: true })).toEqual({ swallow: true, begin: false });
    expect(holdKey({ key: 'Enter', repeat: false })).toEqual({ swallow: true, begin: true });
    expect(holdKey({ key: 'Enter', repeat: true })).toEqual({ swallow: true, begin: false });
    // A browser that reports the key as "Spacebar" or "Unidentified" still has a code.
    expect(holdKey({ key: 'Unidentified', code: 'Space', repeat: true })).toEqual({
      swallow: true,
      begin: false,
    });
    // Any other key is the game's own.
    for (const key of ['1', 'Escape', 'm', 'Tab'])
      expect(holdKey({ key, code: `Key${key}`, repeat: false }), key).toEqual({
        swallow: false,
        begin: false,
      });
  });

  it('knows when a finger has slid off the button (a touch never fires a leave)', () => {
    const box = { left: 100, right: 300, top: 400, bottom: 440 };
    expect(pointerInside(box, 200, 420)).toBe(true);
    expect(pointerInside(box, 100, 400)).toBe(true);
    expect(pointerInside(box, 300, 440)).toBe(true);
    expect(pointerInside(box, 200, 160)).toBe(false);
    expect(pointerInside(box, 99, 420)).toBe(false);
    expect(pointerInside(box, 301, 420)).toBe(false);
    expect(pointerInside(box, 200, 441)).toBe(false);
  });

  it('greys the launch for a guest in a shared city, in the room’s own words', () => {
    expect(launchGuestWhy(false)).toBeNull();
    expect(launchGuestWhy(true)).toBe(HOST_ONLY_LAUNCH);
    // The words are the room's: it refuses a guest with exactly this, and lets the host through.
    const rules: SharedRules = { perms: { 2: [] }, host: 1, spendLimit: null };
    const launch = { type: 'launchBomb', to: 1 } as const;
    expect(roomRefusal(rules, 2, launch)).toBe(launchGuestWhy(true));
    expect(roomRefusal(rules, 1, launch)).toBeNull();
  });

  it('draws a cloud on a computer neighbour by its fallout or the flight, and on a friend only by the friend’s own report', () => {
    const flight = 100;
    const fired = { to: 7, tick: 1_000 };
    const rival = (fallout?: number) => ({ id: 7, rival: { fallout } });
    const friend = (hit?: number) => ({ id: 7, player: { atom: hit === undefined ? {} : { hit } } });
    // A computer neighbour: after the flight, or when its fallout says so; not before.
    expect(cloudOnMap(rival(0), fired, 1_099, flight)).toBe(false);
    expect(cloudOnMap(rival(0), fired, 1_100, flight)).toBe(true);
    expect(cloudOnMap(rival(0.5), null, 0, flight)).toBe(true);
    expect(cloudOnMap(rival(0.2), null, 0, flight)).toBe(false);
    expect(cloudOnMap({ id: 8, rival: { fallout: 0 } }, fired, 5_000, flight)).toBe(false);
    // A friend: the flight's time proves nothing (its dome may have stopped the bomb, its page may not
    // have taken the strike), only its own report does.
    expect(cloudOnMap(friend(), fired, 5_000, flight)).toBe(false);
    expect(cloudOnMap(friend(0), fired, 5_000, flight)).toBe(false);
    expect(cloudOnMap(friend(1), null, 0, flight)).toBe(true);
  });

  it('puts the atom bomb out of reach in a scenario, and says so first rather than at the bottom of the ladder', () => {
    for (const id of ['holdline', 'cleanwar', 'liberation']) {
      const sim = openScenario(id);
      const s = atomSummary(sim)!;
      expect(s, id).not.toBeNull();
      expect(s.allowed, id).toBe(false);
      expect(s.rules, id).toBe('The atom bomb is not part of a scenario');
      expect(bombTabShown(s, [], 0), `${id}: no tab inviting a race that cannot finish`).toBe(false);
      const research = ladderRows(s).find((r) => r.id === 'research')!;
      expect(research.reason, id).toBe('The atom bomb is not part of a scenario');
    }
  });
});
