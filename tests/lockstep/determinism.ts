/**
 * The cross-browser determinism run (M29): the scripted town for two game years with the state
 * hash at every month's end, the map editor's commands, and a scenario started on its city. The
 * same function runs in Node (the expected values) and, bundled, in Chromium, WebKit and Firefox.
 */
import { Sim } from '../../src/sim/sim';
import type { Command, CommandResult, CommandType } from '../../src/sim/commands';
import type { SaveFile } from '../../src/sim/save';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { checkInvariants } from '../../src/sim/invariants';
import { mapFromGenerator } from '../../src/sim/terrain/customMap';
import { editorScript, growTown, placeAlong, roadIds } from './scriptedTown';
import { growRivalTown } from '../../src/sim/ai/town';
import { awayCity, awayInput, awayResult } from '../../src/sim/battle/away';
import { Battle } from '../../src/sim/battle/battle';

export interface DeterminismResult {
  months: string[];
  population: number;
  editor: string;
  scenario: string[];
  /** A town with rival neighbours (M34): its state hash at each month's end. */
  war: string[];
  /**
   * Battles (M35): a neighbour's raid fought in the war town (its hash every game hour and how it
   * ended), and a skirmish against a computer neighbour's town grown by the mayor (the town's hash,
   * and the battle's result).
   */
  battle: { home: string[]; homeEnd: string; town: string; away: string };
  /** The war town's diplomacy after its scripted declarations and treaties (M36). */
  diplomacy: string;
  /** Weapons research (M37), in a war town of its own: its hash each game day while its lab works. */
  research: string[];
  used: CommandType[];
  refused: string[];
}

export function runDeterminism(
  months: number,
  scenario: { id: string; save: SaveFile } | null,
): DeterminismResult {
  const refused: string[] = [];
  const used = new Set<CommandType>();
  const note = (cmd: Command, r: CommandResult) => {
    if (r.ok) used.add(cmd.type);
    else refused.push(`${cmd.type}: ${r.reason}`);
    return r;
  };
  const hashes: string[] = [];
  const { sim } = growTown(
    months,
    (s) => {
      checkInvariants(s);
      hashes.push(s.hash());
    },
    (s, cmd) => note(cmd, s.dispatch(cmd)),
  );

  // The same town with rival neighbours (M34): military buildings, training, bonds.
  const warHashes: string[] = [];
  const { sim: warSim } = growTown(
    Math.min(months, 12),
    (s) => {
      checkInvariants(s);
      warHashes.push(s.hash());
    },
    (s, cmd) => note(cmd, s.dispatch(cmd)),
    false,
    true,
  );

  // Battles (M35).
  // An expedition against a computer neighbour: sent, called back, sent again; fought in its town,
  // grown by the balance mayor, and reported back; the battle then resolved in the town itself.
  const rival = warSim.state.region.neighbours.find((n) => n.rival)!;
  const force = () =>
    [...warSim.state.war!.units.values()]
      .filter((u) => !u.away && u.hp >= 0.5)
      .sort((a, b) => a.id - b.id)
      .map((u) => u.id);
  const send: Command = {
    type: 'sendForce',
    units: force(),
    to: rival.id,
    route: 'highway',
    target: 'military',
    stance: 'bold',
  };
  const first = note(send, warSim.dispatch(send));
  const firstId = first.ok ? first.created![0]! : -1;
  note(
    { type: 'recallForce', expedition: firstId },
    warSim.dispatch({ type: 'recallForce', expedition: firstId }),
  );
  warSim.advance(3 * TICKS_PER_HOUR);
  const again: Command = { ...send, units: force() } as Command;
  note(again, warSim.dispatch(again));
  for (let t = 0; t < 16 * 60 && !warSim.state.war!.expeditions?.some((e) => e.state === 'fighting'); t++)
    warSim.step();
  const e = warSim.state.war!.expeditions!.find((x) => x.state === 'fighting')!;
  const town = growRivalTown({
    citySeed: warSim.state.options.seed,
    neighbour: rival.id,
    name: rival.name,
    kind: rival.kind,
    personality: rival.rival!.personality,
    population: rival.population,
    cap: 1_500,
  });
  const input = awayInput(awayCity(warSim, e), town);
  const result = awayResult(input, Battle.run(structuredClone(input)));
  // Pinned while a region would decide on it (M36), then reported.
  note(
    { type: 'battleSettling', expedition: e.id, on: true },
    warSim.dispatch({ type: 'battleSettling', expedition: e.id, on: true }),
  );
  note(
    { type: 'battleReport', expedition: e.id, result },
    warSim.dispatch({ type: 'battleReport', expedition: e.id, result }),
  );
  note(
    { type: 'battleResolve', input, mode: 'instant' },
    town.dispatch({ type: 'battleResolve', input, mode: 'instant' }),
  );
  const away = JSON.stringify([result, town.hash(), warSim.hash()]);
  // Home again, then a neighbour's raid on the city, fought in its own sim to its end.
  warSim.advance(12 * TICKS_PER_HOUR);
  const home: string[] = [];
  note(
    { type: 'cheat', cheat: 'raidIn', hours: 0 },
    warSim.dispatch({ type: 'cheat', cheat: 'raidIn', hours: 0 }),
  );
  for (let t = 1; t <= 24 * 60 && warSim.state.war?.battle; t++) {
    warSim.step();
    if (t % 60 === 0) home.push(warSim.hash());
  }
  const report = warSim.state.war?.reports?.at(-1);
  const homeEnd = JSON.stringify([
    warSim.hash(),
    report?.outcome,
    report?.collapsed,
    report?.civics,
    report?.lost,
  ]);

  // Diplomacy (M36): a proposal taken back, neutrality on and off, a declared war, a treaty the
  // neighbour puts to the city and its terms in force, a pact broken, a district bought back.
  const act = (cmd: Command) => note(cmd, warSim.dispatch(cmd));
  const rivals = warSim.state.region.neighbours.filter((n) => n.rival && !n.player);
  const foe = rivals[0]!;
  const other = rivals[1] ?? foe;
  warSim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
  const offer = act({ type: 'propose', neighbour: other.id, terms: [{ k: 'nonAggression', months: 12 }] });
  if (offer.ok) act({ type: 'withdrawProposal', proposal: offer.created![0]! });
  warSim.advance(3 * TICKS_PER_MONTH);
  act({ type: 'setNeutral', on: true });
  act({ type: 'setNeutral', on: false });
  warSim.advance(TICKS_PER_MONTH + 60);
  act({ type: 'declareWar', neighbour: foe.id, scale: 'war', reason: 'Our border' });
  warSim.advance(13 * TICKS_PER_HOUR);
  // A district for the neighbour to occupy, round the town's first building.
  const made = act({ type: 'createDistrict', name: 'Border Ward' });
  const homes = [...warSim.state.buildings.values()].sort((a, b) => a.id - b.id);
  if (made.ok && homes[0])
    act({
      type: 'paintDistrict',
      district: made.created![0]!,
      area: { kind: 'brush', points: [{ x: homes[0].x, z: homes[0].z }], radius: 120 },
    });
  const district = made.ok ? made.created![0]! : undefined;
  warSim.dispatch({
    type: 'cheat',
    cheat: 'proposal',
    neighbour: foe.id,
    terms: [
      { k: 'peace' },
      { k: 'tribute', payer: 'us', amount: 500, months: 3 },
      ...(district !== undefined ? [{ k: 'occupy' as const, side: 'us' as const, district }] : []),
    ],
  });
  const theirs = warSim.state.war!.diplomacy?.proposals.find((p) => p.from === 'them' && p.with === foe.id);
  if (theirs) act({ type: 'answerProposal', proposal: theirs.id, accept: true });
  const pacts = warSim.state.war!.diplomacy?.pacts ?? [];
  const tribute = pacts.find((p) => p.term.k === 'tribute');
  if (tribute) act({ type: 'endPact', pact: tribute.id, breakPact: true });
  const occupied = pacts.find((p) => p.term.k === 'occupy');
  if (occupied) act({ type: 'buyBack', pact: occupied.id });
  warSim.advance(2 * TICKS_PER_MONTH);
  const diplomacy = JSON.stringify([warSim.hash(), warSim.state.war!.diplomacy]);

  // Weapons research (M37), in a war town of its own so the sections above stay as at the M36 tip:
  // a lab, tiers queued and one taken back, and the labs' days.
  const research: string[] = [];
  const { sim: labSim } = growTown(
    Math.min(months, 6),
    (s) => checkInvariants(s),
    (s, cmd) => note(cmd, s.dispatch(cmd)),
    false,
    true,
  );
  const lab = (cmd: Command) => note(cmd, labSim.dispatch(cmd));
  labSim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 3_000_000 });
  labSim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  placeAlong(labSim, lab, 'militarylab', roadIds(labSim).reverse());
  lab({ type: 'queueResearch', key: 'logistics1' });
  lab({ type: 'queueResearch', key: 'land1' });
  lab({ type: 'queueResearch', key: 'land2' });
  lab({ type: 'unqueueResearch', key: 'land2' });
  for (let d = 0; d < 3; d++) {
    labSim.advance(TICKS_PER_MONTH);
    checkInvariants(labSim);
    research.push(labSim.hash());
  }
  // Heavy armour done (points poured in), and its prototype on trial at a proving ground: started,
  // called off, started again and run to its end.
  lab({ type: 'queueResearch', key: 'land2' });
  labSim.dispatch({ type: 'cheat', cheat: 'researchPoints', points: 2_000 });
  const ground = placeAlong(labSim, lab, 'provingground', roadIds(labSim).reverse()) ?? -1;
  labSim.advance(TICKS_PER_MONTH);
  lab({ type: 'startTrial', ground, kind: 'heavytank' });
  labSim.advance(3 * TICKS_PER_HOUR);
  lab({ type: 'stopTrial', ground });
  lab({ type: 'startTrial', ground, kind: 'heavytank' });
  for (let d = 0; d < 3; d++) {
    labSim.advance(TICKS_PER_MONTH);
    checkInvariants(labSim);
    research.push(labSim.hash());
  }
  research.push(JSON.stringify(labSim.state.war!.research));
  // The superweapon buildings (M37): a blackout tower and a dome, their stages cheated done; the
  // dome's mode, and the tower aimed at a computer neighbour.
  labSim.dispatch({
    type: 'cheat',
    cheat: 'research',
    tiers: ['defence1', 'defence2', 'defence3', 'defence4'],
  });
  labSim.dispatch({ type: 'cheat', cheat: 'research', tiers: ['intel1', 'intel2', 'intel3', 'intel4'] });
  for (const def of ['blackouttower', 'domeshield']) {
    const c = placeAlong(labSim, lab, def, roadIds(labSim).reverse());
    if (c !== null) labSim.dispatch({ type: 'cheat', cheat: 'finishStages', civic: c });
  }
  // Training called off, so the few workers this small town spares for its forces go to the tower.
  for (const o of [...labSim.state.war!.orders.values()].sort((x, y) => x.id - y.id))
    lab({ type: 'cancelTraining', order: o.id });
  labSim.advance(TICKS_PER_MONTH);
  lab({ type: 'setDome', mode: 'super' });
  const target = labSim.state.region.neighbours.find((n) => n.rival)?.id ?? -1;
  lab({ type: 'useBlackout', neighbour: target, breakPact: true });
  for (let h = 0; h < 3; h++) {
    labSim.advance(TICKS_PER_HOUR);
    research.push(labSim.hash());
  }
  research.push(JSON.stringify([labSim.state.war!.supers ?? null, labSim.state.region.neighbours]));
  // Spies (M37): the superweapon buildings knocked down (their posts to an agency), and an agent
  // sent to look round a computer neighbour (its own dice).
  for (const c of [...labSim.state.civics.values()].sort((a, b) => a.id - b.id))
    if (c.def === 'blackouttower' || c.def === 'domeshield')
      lab({ type: 'bulldoze', target: { kind: 'civic', id: c.id } });
  placeAlong(labSim, lab, 'spyagency', roadIds(labSim).reverse());
  labSim.advance(TICKS_PER_MONTH);
  lab({ type: 'spyMission', neighbour: target, op: 'reveal' });
  for (let h = 0; h < 10; h++) labSim.advance(TICKS_PER_HOUR);
  research.push(labSim.hash(), JSON.stringify(labSim.state.war!.intel ?? null));

  const editor = Sim.create({ editor: true }, mapFromGenerator('lockstep-map', 'lakes', 'Even Ground', true));
  editorScript((cmd) => note(cmd, editor.dispatch(cmd)));
  JSON.stringify(editor.query({ type: 'exportMap' }));

  const scenarioHashes: string[] = [];
  if (scenario) {
    const s = Sim.fromSave(scenario.save);
    note({ type: 'startScenario', id: scenario.id }, s.dispatch({ type: 'startScenario', id: scenario.id }));
    for (let m = 0; m < 3; m++) {
      s.advance(TICKS_PER_MONTH);
      scenarioHashes.push(s.hash());
    }
  }
  return {
    months: hashes,
    population: sim.state.totals.population,
    editor: editor.hash(),
    scenario: scenarioHashes,
    war: warHashes,
    battle: { home, homeEnd, town: town.hash(), away },
    diplomacy,
    research,
    used: [...used].sort(),
    refused,
  };
}
