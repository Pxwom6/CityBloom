/**
 * The atom bomb across browsers (M40, step 8): the `atom` section of the determinism run. A war town of
 * its own (the lab town the bomb's tests use: big enough to crew the enrichment plant, the silo, the dome
 * and the agency) is played through the whole of the race, the strikes and what follows them, and every
 * browser must give the hashes Node does. The race goes through the real commands and the real clock
 * wherever that is cheap; the cheat `atom {stage}` skips the long waits (a full load of fuel is 1,152
 * game hours, a launch's preparation 288), and `atomHour` and `supersHour` are called by hand for the
 * hours of those waits the cheat leaves (the preparation's second half, the dome's charge), exactly as
 * the sim's own war clock calls them (a real race is two thousand game hours and more; the section
 * plays a few hundred, in about nine seconds of Node). Every part of the bomb's code still runs in every
 * engine: the unit tests (tests/war/atom*) check the numbers, this checks that no engine disagrees with
 * another about them.
 *
 * What it covers, in order: the plant, fuel, the silo and the bomb (built in instalments, called off,
 * built again); a saboteur sent against a computer neighbour's race (Hard); a bomb the dome stops whole,
 * the dome then down for 1,200 hours; a launch prepared, called off and prepared again and fired at a
 * computer neighbour in a total war; the world's turn on the firer (the pariah, the sanctions, the
 * pacts); the landing on the neighbour's record and the nuclear winter the firer's own sky takes; a bomb
 * that finds the dome down and levels the town in slices; the clean-up of the ground; a computer
 * neighbour's launch at the town (Hard: it is losing a total war badly), which lands while the fallout of
 * the first still lies; and three hundred game hours of fallout, its two rasters hashed by their bits
 * with the totals the air has carried off the map. (Everything the city's own crews do comes before it
 * fires: the protest that follows empties its homes, and with them the crews of the dome and the agency.
 * A neighbour's declaration on the pariah, and a battle holding a bomb back, are left to the unit tests:
 * the town is under the bar of residents raids and declarations need, and none comes.)
 */
import type { Command, CommandResult } from '../../src/sim/commands';
import { checkInvariants } from '../../src/sim/invariants';
import { checksum, Mixer } from '../../src/sim/sync';
import { RIVAL_BOMB } from '../../src/data/atom';
import { DOME, TIER_KEYS } from '../../src/data/research';
import { MAP_SIZE } from '../../src/data/world';
import { atomHour, atomStage } from '../../src/sim/systems/atom';
import { fightingWith, isPariah, reputationOf, warWith } from '../../src/sim/systems/diplomacy';
import { falloutBanned, falloutDose, falloutGround } from '../../src/sim/systems/fallout';
import { computeOverlay } from '../../src/sim/systems/overlays';
import { sanctionCause } from '../../src/sim/systems/warEconomy';
import { supersHour } from '../../src/sim/systems/supers';
import { solarShare, winterDepth } from '../../src/sim/systems/weather';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { labTown } from '../war/researchTown';

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;

/** A raster's bits, mixed: the exact float32 of every cell, so one changed last bit shows. */
function bits(a: Float32Array): string {
  const m = new Mixer();
  const words = new Uint32Array(a.buffer, a.byteOffset, a.length);
  for (let i = 0; i < words.length; i++) m.int(words[i]!);
  return m.hex();
}

/** The values of an array (plain numbers), mixed by their bits. */
function numbers(a: ArrayLike<number>): string {
  const m = new Mixer();
  for (let i = 0; i < a.length; i++) m.num(a[i]!);
  return m.hex();
}

/**
 * Plays the atom section; `note` records each command's outcome as the determinism run does (the kinds
 * it used, the reasons it was refused). Returns the section's entries, in order.
 */
export function runAtomSection(note: (cmd: Command, r: CommandResult) => CommandResult): string[] {
  const out: string[] = [];
  const { sim, place } = labTown(0, { length: 800, streets: 7 });
  // Hard, the difficulty the computer neighbours' race belongs to (nothing in it starts before game
  // year 20, so the section's cheats stand in for the start).
  sim.state.options.difficulty = 'hard';
  const go = (cmd: Command): CommandResult => note(cmd, sim.dispatch(cmd));
  const hours = (n: number): void => sim.advance(n * H);
  const w = () => sim.state.war!;
  const atom = () => w().atom;
  const rivals = sim.state.region.neighbours.filter((n) => n.rival && !n.player);
  const [foe, other, third] = [rivals[0]!, rivals[1] ?? rivals[0]!, rivals[2] ?? rivals[0]!];
  for (const n of rivals) n.rival!.allies = [];

  /** An entry: a label and the hash of the whole city. */
  const full = (label: string): void => void out.push(`${label} ${sim.hash()}`);
  /** A cheaper entry for the hours in between: the exact checksum and the race's own facts. */
  const mark = (label: string): void => {
    out.push(`${label} ${checksum(sim)} ${JSON.stringify(atom() ?? null)}`);
  };
  /** The rasters of the fallout, by their bits, and what the air has carried off the map. */
  const rasters = (label: string): void => {
    const f = sim.state.fallout;
    out.push(
      f
        ? `${label} ${checksum(sim)} ground ${bits(f.ground)} air ${bits(f.air)} out ${JSON.stringify(f.out)} jobs ${JSON.stringify(f.jobs)}`
        : `${label} ${checksum(sim)} no fallout`,
    );
  };

  // The town: a nuclear plant running, every tier researched, money, the plant, the silo, the dome and
  // an agency up (the plan's three buildings finish at once), and a few days for their crews.
  place('nuclear');
  sim.advance(M);
  go({ type: 'cheat', cheat: 'research', tiers: [...TIER_KEYS] });
  go({ type: 'cheat', cheat: 'addMoney', amount: 60_000_000 });
  for (const def of ['enrichment', 'atomsilo', 'domeshield'])
    go({ type: 'cheat', cheat: 'finishStages', civic: place(def) });
  place('spyagency');
  sim.advance(3 * M);
  checkInvariants(sim);
  full('town');

  // Total wars with two computer neighbours: the one the bomb is for, and the one that will lose its war
  // to the city and fire at it. Asked for too early (no bomb, no fuel), the race says no.
  go({ type: 'launchBomb', to: foe.id });
  go({ type: 'buildBomb' });
  for (const n of new Set([foe, other]))
    go({ type: 'declareWar', neighbour: n.id, scale: 'total', reason: 'The race' });
  const opens = Math.max(...[foe, other].map((n) => warWith(sim, n.id)?.opens ?? 0));
  sim.advance(Math.max(0, opens - sim.state.tick) + 1);
  mark(`wars ${fightingWith(sim, foe.id)?.scale ?? '-'} ${fightingWith(sim, other.id)?.scale ?? '-'}`);

  // Saboteurs sent against the third neighbour's race (Hard), a few hours apart, so that their dice (each
  // mission's own, by its number) differ: while the fuel is made they go out, do their work and come home.
  go({ type: 'cheat', cheat: 'rivalBomb', neighbour: third.id, stage: 'enriching', hours: 10 });
  const spy = (): CommandResult =>
    go({ type: 'spyMission', neighbour: third.id, op: 'sabotage', target: 'plant' });
  spy();

  // Fuel, a few hours of the real clock (the plant is crewed and the nuclear plant gives power), then a
  // full load by the cheat; the bomb: the first instalment, called off, started again, finished by the cheat.
  hours(6);
  mark('fuel');
  spy();
  go({ type: 'cheat', cheat: 'atom', stage: 'silo' });
  go({ type: 'buildBomb' });
  hours(3);
  mark('building');
  spy();
  go({ type: 'cancelBomb' });
  go({ type: 'buildBomb' });
  hours(2);
  full('bomb');
  go({ type: 'cheat', cheat: 'atom', stage: 'ready' });
  for (let k = 0; k < 40 && (w().intel?.missions.length ?? 0) > 0; k++) hours(1);
  out.push(`spy ${JSON.stringify([third.rival!.bomb ?? null, w().intel?.results.slice(-3) ?? null])}`);
  // (One race at a time among the neighbours: this one is over, so the other can have its own.)
  go({ type: 'cheat', cheat: 'rivalBomb', neighbour: third.id, stage: 'none' });

  // The dome charged (the hours the clock has not given it yet), and a bomb stopped whole: the dome is
  // down for 1,200 hours, nothing falls, and no winter or fallout follows.
  for (let k = 0; k < 300 && (w().supers?.dome?.hours ?? 0) < DOME.chargeHours; k++) supersHour(sim);
  mark(`dome ${JSON.stringify(w().supers?.dome ?? null)}`);
  go({ type: 'cheat', cheat: 'bombIn', hours: 2, from: other.id });
  hours(1);
  mark('warned');
  hours(2);
  full('stopped');
  out.push(`dome ${JSON.stringify(w().supers?.dome ?? null)}`);

  // A launch at the neighbour: prepared, called off (half back), prepared again; half of its 288 hours
  // by the cheat and the rest an hour at a time as the war clock would.
  go({ type: 'launchBomb', to: foe.id });
  hours(2);
  go({ type: 'cancelLaunch' });
  go({ type: 'launchBomb', to: foe.id });
  hours(1);
  mark('prepared');
  go({ type: 'cheat', cheat: 'atom', stage: 'preparing', to: foe.id });
  for (let k = 0; k < 400 && !atom()?.fired; k++) atomHour(sim);
  mark(`fired ${atomStage(sim)}`);
  // The world's turn on the firer, at once: nothing to be trusted with, the neighbours' sanctions.
  const world = (label: string): void => {
    const d = w().diplomacy;
    out.push(
      `${label} ${JSON.stringify([
        reputationOf(sim),
        isPariah(sim),
        d?.pariah ?? null,
        d?.pacts.length ?? 0,
        d?.wars.map((x) => [x.with, x.scale, x.score, x.capitulated ?? null]) ?? [],
        rivals.map((n) => [n.id, n.rival!.relation, sanctionCause(sim, n)]),
        w().economy?.sanctionedBy ?? null,
        sim.state.chronicle.events.filter((e) => e.kind === 'atom'),
      ])}`,
    );
  };
  world('pariah');
  full('launch');

  // The flight (a game day of the city's own clock) and the landing on the neighbour's record; the firer's
  // own sky darkens (the nuclear winter `self:0`).
  hours(25);
  world('landed');
  out.push(
    `record ${JSON.stringify(
      rivals.map((n) => [
        n.id,
        n.population,
        n.rival!.forces,
        n.rival!.defences,
        n.rival!.relation,
        n.rival!.fallout,
      ]),
    )} ${JSON.stringify(sim.state.weather.winters ?? null)}`,
  );
  full('flown');

  // A second bomb finds the dome down: it falls, and the town is levelled in slices.
  go({ type: 'cheat', cheat: 'bombIn', hours: 1, from: other.id });
  // (A battle in the city would hold it back, up to twelve hours; none is fought here.)
  for (let t = 0; t < 800 && !atom()?.impact; t++) sim.step();
  // The landing, tick by tick through the fires and the first civic buildings, then an hour at a time.
  for (let t = 0; t < 8; t++) {
    sim.step();
    mark(`blast+${t}`);
  }
  for (let k = 0; k < 14 && !atom()?.impact?.over; k++) {
    hours(1);
    mark(`slice ${k}`);
  }
  full('levelled');
  checkInvariants(sim);
  const im = atom()?.impact;
  const at = im ? { x: im.x, z: im.z } : { x: MAP_SIZE / 2, z: MAP_SIZE / 2 };
  out.push(`impact ${JSON.stringify(im ?? null)}`);

  // The ground afterwards: nothing may be zoned on it, a crew is hired, and the real clock plays three
  // hundred game hours of drift, decay and clean-up. Meanwhile the other neighbour, losing its war badly,
  // prepares and fires its own bomb at the town: the dome is down, so it lands on ground already bare.
  go({ type: 'zone', zone: 'I', area: { kind: 'brush', points: [at], radius: 60 } });
  go({ type: 'cleanFallout', x: at.x, z: at.z });
  const war = warWith(sim, other.id);
  if (war) war.score = RIVAL_BOMB.desperate + 5;
  go({
    type: 'cheat',
    cheat: 'rivalBomb',
    neighbour: other.id,
    stage: 'preparing',
    hours: RIVAL_BOMB.prep - 2,
  });
  rasters('fallout 0');
  for (let h = 12; h <= 300; h += 12) {
    hours(12);
    rasters(`fallout ${h}`);
    if (h === 48 || h === 156 || h === 300) checkInvariants(sim);
  }
  full('afterwards');
  world('end');

  // What the fallout leaves for the readers: the dose where the bomb fell, the ban, the radiation map.
  out.push(
    `ground ${JSON.stringify([
      falloutGround(sim, at.x, at.z),
      falloutDose(sim, at.x, at.z),
      falloutBanned(sim, at.x, at.z),
      falloutDose(sim, at.x + 300, at.z),
    ])} map ${numbers(computeOverlay(sim, 'radiation').values)}`,
  );
  // The winters and the sun under them, at the ticks of the rise, the hold and the long fall.
  const wx = sim.state.weather;
  const t0 = sim.state.tick;
  out.push(
    `winter ${JSON.stringify([
      wx.winters ?? null,
      wx.mean,
      wx.temp,
      [0, 72, 144, 400, 720, 1_200, 1_728].map((h) => [
        h,
        winterDepth(wx, t0 + h * H),
        solarShare(wx, t0 + h * H),
      ]),
    ])}`,
  );
  // The events of the whole run that tell its story, the chronicle's lines, and the race as it ended.
  const story = new Set([
    'bombFired',
    'bombWarning',
    'bombStopped',
    'bombLanded',
    'atomImpact',
    'atomLost',
    'falloutCleaned',
    'nuclearWinter',
    'rivalBomb',
    'launchHeld',
    'sabotaged',
  ]);
  out.push(
    `events ${JSON.stringify(sim.events.filter((e) => story.has(e.kind)).map((e) => [e.kind, e.id, e.info ?? null]))}`,
  );
  out.push(
    `ended ${JSON.stringify([
      atom() ?? null,
      other.rival!.bomb ?? null,
      sim.state.chronicle.events.filter((e) => e.kind === 'atom'),
      sim.state.fallout?.seen ?? null,
      rivals.map((n) => [n.id, n.side, n.population, n.rival!.fallout ?? null, n.rival!.relation]),
    ])}`,
  );
  return out;
}
