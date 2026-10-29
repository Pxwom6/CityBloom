import { describe, expect, it } from 'vitest';
import { COMMAND_TYPES, type Command, type CommandType } from '../../src/sim/commands';
import { PAGE_ONLY, checkCommand } from '../../src/sim/commandCheck';
import { Sim } from '../../src/sim/sim';
import { buildTown } from '../helpers';

/**
 * F7: the room's check of another player's command, for every command type, and a fuzz of every
 * field with values a buggy or hostile game might send: the check never throws, and whatever it lets
 * through never throws or hangs a shared sim.
 */
const P = (x: number, z: number) => ({ x, z });

/** One well-formed command of every type (ids need not exist: a refusal is fine, a throw isn't). */
const SAMPLES: Record<CommandType, Command> = {
  cheat: { type: 'cheat', cheat: 'addMoney', amount: 5 },
  renameCity: { type: 'renameCity', name: 'Fuzzton' },
  buildRoad: { type: 'buildRoad', road: 'street', points: [P(300, 300), P(400, 300)], oneway: false },
  bulldoze: { type: 'bulldoze', target: { kind: 'segment', id: 3 } },
  placeStop: { type: 'placeStop', x: 300, z: 300, tram: false },
  upgradeRoad: { type: 'upgradeRoad', seg: 3, road: 'avenue' },
  setOneWay: { type: 'setOneWay', seg: 3, dir: 1 },
  setTram: { type: 'setTram', seg: 3, on: true, stroke: 2 },
  roundabout: { type: 'roundabout', at: P(300, 300), radius: 20 },
  removeRoundabout: { type: 'removeRoundabout', node: 4 },
  zone: {
    type: 'zone',
    zone: 'R',
    area: { kind: 'brush', points: [P(300, 280), P(400, 280)], radius: 24 },
    stroke: 1,
  },
  undo: { type: 'undo' },
  redo: { type: 'redo' },
  setTax: { type: 'setTax', zone: 'R', wealth: 'all', rate: 9 },
  setFunding: { type: 'setFunding', dept: 'fire', pct: 110 },
  takeLoan: { type: 'takeLoan', amount: 25_000 },
  promise: { type: 'promise', promise: 'crime', on: true },
  repayLoan: { type: 'repayLoan', id: 1 },
  placeBuilding: { type: 'placeBuilding', def: 'firestation', x: 300, z: 330, angle: 0, side: 1 },
  disaster: { type: 'disaster', kind: 'tornado', at: P(900, 900) },
  setDisasters: { type: 'setDisasters', on: false },
  setWeather: { type: 'setWeather', seasons: true, intensity: 2 },
  setDeal: { type: 'setDeal', neighbour: 1, resource: 'power', direction: 'buy', amount: 5 },
  setElections: { type: 'setElections', on: true },
  startScenario: { type: 'startScenario', id: 'stadium' },
  setPolicy: { type: 'setPolicy', id: 'recycling', on: true },
  moveBuilding: { type: 'moveBuilding', id: 5, x: 320, z: 330, angle: 0.5, side: -1 },
  createDistrict: { type: 'createDistrict', name: 'Old Town' },
  paintDistrict: {
    type: 'paintDistrict',
    district: 1,
    area: { kind: 'brush', points: [P(300, 300)], radius: 48 },
  },
  renameDistrict: { type: 'renameDistrict', district: 1, name: 'New Town' },
  removeDistrict: { type: 'removeDistrict', district: 1 },
  setDistrictPolicy: { type: 'setDistrictPolicy', district: 1, policy: 'heritage', on: true },
  buildRailLink: { type: 'buildRailLink', z: 900 },
  terraform: { type: 'terraform', mode: 'level', points: [P(500, 500)], radius: 48, level: 12, stroke: 3 },
  editMap: { type: 'editMap', brush: 'raise', points: [P(500, 500)], radius: 64, strength: 1 },
  setMapEntry: { type: 'setMapEntry', entry: 'rail', z: null },
  setMapInfo: { type: 'setMapInfo', name: 'Somewhere', climate: 'alpine' },
  regionUpdate: {
    type: 'regionUpdate',
    update: { cities: [], contracts: [], project: null },
  },
  contributeProject: { type: 'contributeProject', amount: 1000 },
  addModule: { type: 'addModule', civic: 5, module: 'engineBay' },
  trainUnit: { type: 'trainUnit', base: 5, kind: 'tank' },
  cancelTraining: { type: 'cancelTraining', order: 7 },
  disbandUnit: { type: 'disbandUnit', unit: 8 },
  issueBond: { type: 'issueBond', amount: 40_000 },
  repayBond: { type: 'repayBond', id: 9 },
  sendForce: {
    type: 'sendForce',
    units: [3, 4],
    to: 2,
    route: 'highway',
    target: 'military',
    stance: 'bold',
    gate: true,
  },
  recallForce: { type: 'recallForce', expedition: 6 },
  battleResolve: { type: 'battleResolve', input: {} as never, mode: 'watch' },
  battleSettling: { type: 'battleSettling', expedition: 6, on: true },
  battleReport: {
    type: 'battleReport',
    expedition: 6,
    result: {
      outcome: 'raided',
      units: [],
      theirLost: 0,
      theirStrength: 0,
      defencesLost: 0,
      destroyed: 0,
      damaged: 0,
      objectives: { aimed: 1, down: 1 },
      hash: '0',
    },
  },
  declareWar: { type: 'declareWar', neighbour: 2, scale: 'war', reason: 'Our border' },
  propose: {
    type: 'propose',
    neighbour: 2,
    terms: [{ k: 'peace' }, { k: 'tribute', payer: 'them', amount: 1_000, months: 12 }],
  },
  answerProposal: { type: 'answerProposal', proposal: 4, accept: true },
  withdrawProposal: { type: 'withdrawProposal', proposal: 4 },
  endPact: { type: 'endPact', pact: 5 },
  buyBack: { type: 'buyBack', pact: 5 },
  setNeutral: { type: 'setNeutral', on: true },
  queueResearch: { type: 'queueResearch', key: 'land1' },
  unqueueResearch: { type: 'unqueueResearch', key: 'land1' },
  startTrial: { type: 'startTrial', ground: 6, kind: 'heavytank' },
  stopTrial: { type: 'stopTrial', ground: 6 },
  setDome: { type: 'setDome', mode: 'super' },
  useBlackout: { type: 'useBlackout', neighbour: 2, breakPact: true },
  spyMission: { type: 'spyMission', neighbour: 2, op: 'steal', branch: 'air', breakPact: true },
  // M37, between friends (page only).
  spySettling: { type: 'spySettling', mission: 9, on: true },
  missionResult: { type: 'missionResult', mission: 9, outcome: 'success', stole: 'air2' },
  opResolve: {
    type: 'opResolve',
    from: 2,
    id: 'op-1a2b3c4d-9',
    op: 'sabotage',
    outcome: 'success',
    target: 'power',
    late: false,
  },
  warClock: { type: 'warClock', cap: 120 },
  // M38: the war economy.
  buyStake: { type: 'buyStake', neighbour: 2, share: 10 },
  sellStake: { type: 'sellStake', neighbour: 2 },
};

/** Values a field might carry instead of what it should. */
const WRONG: unknown[] = [
  null,
  'x',
  '',
  1e300,
  -1e300,
  1e9,
  -1,
  0.5,
  true,
  [],
  {},
  '__proto__',
  'toString',
  [null],
  { x: 1 },
];

/** Every path to a field in a command (`area.points.0.x` and so on), not the type itself. */
function paths(v: unknown, at: string[] = []): string[][] {
  if (!v || typeof v !== 'object') return at.length ? [at] : [];
  const out: string[][] = at.length ? [at] : [];
  for (const [k, x] of Object.entries(v))
    if (!(at.length === 0 && k === 'type')) out.push(...paths(x, [...at, k]));
  return out;
}

function withField(cmd: Command, path: string[], value: unknown | typeof DELETE): unknown {
  const c = structuredClone(cmd) as Record<string, unknown>;
  let o = c;
  for (const k of path.slice(0, -1)) o = o[k] as Record<string, unknown>;
  if (value === DELETE) delete o[path.at(-1)!];
  else o[path.at(-1)!] = value;
  return c;
}
const DELETE = Symbol('delete');

describe('F7: the check of another player’s command', () => {
  it('covers every command type and passes each well-formed one through unchanged', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...COMMAND_TYPES].sort());
    for (const type of COMMAND_TYPES) {
      const r = checkCommand(SAMPLES[type]);
      if (PAGE_ONLY.has(type)) expect('problem' in r, type).toBe(true);
      else expect(r, type).toEqual({ cmd: SAMPLES[type] });
    }
  });

  it('never throws, and whatever it lets through never throws or hangs a shared city', () => {
    const sim = Sim.create({ seed: 'fuzz', preset: 'river', cityName: 'Fuzzton' });
    buildTown(sim, { zone: false });
    sim.shared = true;
    let tried = 0;
    let passed = 0;
    for (const type of COMMAND_TYPES) {
      for (const path of paths(SAMPLES[type]))
        for (const value of [...WRONG, DELETE]) {
          const raw = withField(SAMPLES[type], path, value);
          let r: ReturnType<typeof checkCommand> | undefined;
          expect(() => (r = checkCommand(raw)), `${type} ${path.join('.')}`).not.toThrow();
          tried++;
          if (!r || 'problem' in r) continue;
          const cmd = r.cmd;
          passed++;
          const t0 = performance.now();
          expect(() => sim.dispatch(cmd, 2), `${type} ${path.join('.')}=${String(value)}`).not.toThrow();
          expect(performance.now() - t0, `${type} ${path.join('.')}`).toBeLessThan(2000);
        }
      // And whole commands that aren't objects at all.
      for (const raw of [null, 5, 'zone', [], { type }])
        expect(() => checkCommand(raw), `${type} ${JSON.stringify(raw)}`).not.toThrow();
    }
    expect(tried).toBeGreaterThan(1000);
    expect(passed).toBeGreaterThan(50);
  }, 120_000);
});
