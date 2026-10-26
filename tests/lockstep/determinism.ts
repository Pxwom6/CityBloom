/**
 * The cross-browser determinism run (M29): the scripted town for two game years with the state
 * hash at every month's end, the map editor's commands, and a scenario started on its city. The
 * same function runs in Node (the expected values) and, bundled, in Chromium, WebKit and Firefox.
 */
import { Sim } from '../../src/sim/sim';
import type { Command, CommandResult, CommandType } from '../../src/sim/commands';
import type { SaveFile } from '../../src/sim/save';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { checkInvariants } from '../../src/sim/invariants';
import { mapFromGenerator } from '../../src/sim/terrain/customMap';
import { editorScript, growTown } from './scriptedTown';

export interface DeterminismResult {
  months: string[];
  population: number;
  editor: string;
  scenario: string[];
  /** A town with rival neighbours (M34): its state hash at each month's end. */
  war: string[];
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
  growTown(
    Math.min(months, 12),
    (s) => {
      checkInvariants(s);
      warHashes.push(s.hash());
    },
    (s, cmd) => note(cmd, s.dispatch(cmd)),
    false,
    true,
  );

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
    used: [...used].sort(),
    refused,
  };
}
