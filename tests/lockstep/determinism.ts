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
import { editorScript, growTown } from './scriptedTown';
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
    used: [...used].sort(),
    refused,
  };
}
