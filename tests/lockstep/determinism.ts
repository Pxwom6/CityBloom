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
import { editorScript, growTown, newTown, placeAlong, roadIds } from './scriptedTown';
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
  /** The war economy (M38), in a war town of its own: stakes, loans, aid, and what a war does to them. */
  economy: string[];
  /**
   * A live battle with a friend (M39), hosted in the lab town: its picture, the town's hash as the
   * room's frontier lets it run and as the room's orders arrive, and how it ends.
   */
  live: string[];
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
  // Between friends (M37, step 9): a friend's city takes a neighbour's place in a region at war. An
  // agent waits there for the region's word (pinned, then turned back and refunded), the city takes
  // a friend's saboteur once, and the region's fair clock caps its war clock, then lets it go.
  const none = { power: 0, water: 0, garbage: 0 };
  lab({
    type: 'regionUpdate',
    update: {
      cities: [
        {
          slot: 2,
          name: 'Brookside',
          mayor: 'Sam',
          color: 1,
          population: 4_000,
          kind: 'suburb',
          offers: { buy: { ...none }, sell: { ...none } },
          workers: 0,
          jobs: 0,
          shoppers: 0,
          online: true,
          raid: 'open',
          tiers: [0, 1, 0, 0, 1, 0],
          counter: 200,
        },
      ],
      contracts: [],
      project: null,
      rules: { war: true, scale: 'skirmish', supers: true },
    },
  });
  const friend = labSim.state.region.neighbours.find((n) => n.player?.slot === 2)?.id ?? -1;
  lab({ type: 'spyMission', neighbour: friend, op: 'reveal' });
  const agent = () => labSim.state.war!.intel?.missions.find((m) => m.slot === 2);
  for (let h = 0; h < 8 && agent()?.state === 'out'; h++) labSim.advance(TICKS_PER_HOUR);
  const waiting = agent()?.id ?? -1;
  lab({ type: 'spySettling', mission: waiting, on: true });
  lab({ type: 'missionResult', mission: waiting, outcome: 'refused', reason: 'Not now' });
  lab({
    type: 'opResolve',
    from: 2,
    id: 'op-00000000-1',
    op: 'sabotage',
    outcome: 'success',
    target: 'power',
    late: false,
  });
  lab({ type: 'warClock', cap: labSim.state.war!.clock + 30 });
  for (let h = 0; h < 3; h++) {
    labSim.advance(TICKS_PER_MONTH);
    research.push(labSim.hash());
  }
  lab({ type: 'warClock', cap: null });
  labSim.advance(TICKS_PER_MONTH);
  research.push(labSim.hash(), JSON.stringify(labSim.state.war!.intel ?? null));

  // A live battle with the friend (M39), in the same town: the friend's force asks, the town makes the
  // battle of its own picture, hosts it up to the frontier the room gives it as the room's orders
  // arrive (each side's, a handover among them), and the battle's end is compared in every browser.
  const liveLog: string[] = [];
  const unit = (id: number, kind: 'infantry' | 'tank' | 'artillery') => ({
    id,
    kind,
    hp: 1,
    x: 0,
    z: 0,
    base: -1,
  });
  const asked = labSim.query({
    type: 'liveBattle',
    call: {
      id: 'exp-00000000-7',
      from: 2,
      force: {
        name: 'Brookside',
        color: 0x3a78c8,
        units: [unit(11, 'tank'), unit(12, 'tank'), unit(13, 'infantry'), unit(14, 'artillery')],
        route: 'highway',
        target: 'military',
        stance: 'bold',
        readiness: 0.8,
      },
    },
  }) as { input?: import('../../src/sim/battle/types').BattleInput; refused?: string };
  if (asked.input) {
    const input = asked.input;
    const defenders = input.layout.defenders.map((u) => u.id);
    liveLog.push(JSON.stringify([input.id, input.layout.structs.length, defenders.length]));
    lab({ type: 'battleResolve', input: structuredClone(input), mode: 'live', from: 2 });
    // As the room stamps them: at the frontier of the moment.
    const log = [
      { seq: 1, step: 32, side: 0 as const, kind: 'hold', units: [11] },
      { seq: 2, step: 64, side: 1 as const, kind: 'guard', units: defenders.slice(0, 2), target: 0 },
      { seq: 3, step: 96, side: 0 as const, kind: 'focus', target: 0 },
      { seq: 4, step: 96, side: 1 as const, kind: 'focus', target: 12 },
      { seq: 5, step: 160, side: 1 as const, kind: 'free' },
      { seq: 6, step: 224, side: 0 as const, kind: 'withdraw' },
    ];
    let allow = 0;
    for (let t = 0; t < 700 && labSim.state.war!.battle; t++) {
      const step = labSim.state.war!.battle!.step;
      if (step + 32 > allow) {
        allow = step + 32;
        lab({
          type: 'battleLive',
          id: input.id,
          allow,
          orders: log.filter((o) => o.step <= allow),
        });
      }
      labSim.step();
      if (t % 20 === 0) liveLog.push(`${step}:${labSim.hash()}`);
    }
    const ended = labSim.events.filter((e) => e.kind === 'battleEnded').at(-1);
    liveLog.push(
      JSON.stringify([ended?.info ?? null, labSim.state.war!.reports?.at(-1) ?? null, labSim.hash()]),
    );
  }

  // The war economy (M38), in a war town of its own (rivals, no buildings) so the sections above stay
  // as they were: stakes bought, sold and bought again, dividends, an alliance and a loan to the ally,
  // munitions and a tank sold to it, sanctions put on a town and lifted, aid for the war it fights at
  // the city's side, a stake frozen by that war, a capitulation that seizes one, and sanctions on the city.
  const economy: string[] = [];
  const bank = newTown(false, true);
  const eco = (cmd: Command) => note(cmd, bank.dispatch(cmd));
  bank.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
  const towns = bank.state.region.neighbours.filter((n) => n.rival && !n.player);
  for (const n of towns) {
    n.rival!.relation = 60;
    n.rival!.allies = [];
  }
  const [partner, enemy, third] = [towns[0]!, towns[1] ?? towns[0]!, towns[2] ?? towns[0]!];
  eco({ type: 'buyStake', neighbour: partner.id, share: 10 });
  eco({ type: 'buyStake', neighbour: enemy.id, share: 15 });
  eco({ type: 'buyStake', neighbour: third.id, share: 5 });
  eco({ type: 'sellStake', neighbour: third.id });
  eco({ type: 'buyStake', neighbour: third.id, share: 5 });
  for (let d = 0; d < 2; d++) {
    bank.advance(TICKS_PER_MONTH);
    checkInvariants(bank);
    economy.push(bank.hash());
  }
  // Sanctions: the city sanctions the third town (its stake freezes; it grows and arms more slowly) and lifts them.
  eco({ type: 'setSanction', neighbour: third.id, on: true });
  bank.advance(TICKS_PER_MONTH);
  economy.push(bank.hash());
  eco({ type: 'setSanction', neighbour: third.id, on: false });
  bank.dispatch({
    type: 'cheat',
    cheat: 'proposal',
    neighbour: partner.id,
    terms: [{ k: 'alliance' }],
  });
  const treaty = bank.state.war!.diplomacy?.proposals.find((p) => p.from === 'them' && p.with === partner.id);
  if (treaty) eco({ type: 'answerProposal', proposal: treaty.id, accept: true });
  eco({ type: 'lendAlly', neighbour: partner.id, amount: 150_000 });
  // Arms trade: munitions in the stores sold to the ally by the month (any town takes ten crates), and a
  // tank (planted: the town has no base) sold to it outright.
  bank.state.war!.stock.munitions = 300;
  eco({ type: 'setArmsDeal', neighbour: partner.id, crates: 10 });
  const tank = bank.state.nextId++;
  bank.state.war!.units.set(tank, { id: tank, kind: 'tank', base: 0, hp: 1, born: bank.state.tick });
  eco({ type: 'sellUnit', unit: tank, neighbour: partner.id });
  bank.advance(TICKS_PER_MONTH);
  economy.push(bank.hash());
  // Offers from computer neighbours (M38 step 7), made by the test cheat: the ally offers to buy
  // munitions (the city ends its small deal first and takes the offer up), a mercantile town offers to
  // invest (turned down, then taken), and a lender offers when the city is short of cash (taken).
  eco({ type: 'setArmsDeal', neighbour: partner.id, crates: 0 });
  const offerOf = (neighbour: number, offer: 'arms' | 'invest' | 'loan') => {
    eco({ type: 'cheat', cheat: 'offer', neighbour, offer });
    return bank.state.war!.economy!.offers!.at(-1)!;
  };
  eco({ type: 'answerOffer', offer: offerOf(partner.id, 'arms').id, accept: true });
  third.rival!.personality = 'mercantile';
  bank.state.economy.history.push({ month: 0, lines: { taxI1: 8_000 }, treasury: bank.state.treasury });
  eco({ type: 'answerOffer', offer: offerOf(third.id, 'invest').id, accept: false });
  eco({ type: 'answerOffer', offer: offerOf(third.id, 'invest').id, accept: true });
  // (The treasury is set the way the tests do, with the month's start moving with it.)
  bank.state.economy.monthStartTreasury += 10_000 - bank.state.treasury;
  bank.state.treasury = 10_000;
  eco({ type: 'answerOffer', offer: offerOf(partner.id, 'loan').id, accept: true });
  bank.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
  bank.advance(TICKS_PER_MONTH);
  checkInvariants(bank);
  economy.push(bank.hash());
  // The war with the enemy: its stake freezes when the war opens, and the ally fights at the city's side.
  eco({ type: 'declareWar', neighbour: enemy.id, scale: 'war', reason: 'Our border' });
  bank.advance(13 * TICKS_PER_HOUR);
  eco({ type: 'fundAlly', neighbour: partner.id, perMonth: 50_000 });
  for (let d = 0; d < 3; d++) {
    bank.advance(TICKS_PER_MONTH);
    checkInvariants(bank);
    economy.push(bank.hash());
  }
  eco({ type: 'fundAlly', neighbour: partner.id, perMonth: 0 });
  // The war goes against the city until it capitulates: the enemy keeps the stake it holds in its industry.
  const war = bank.state.war!.diplomacy!.wars.find((w) => w.with === enemy.id);
  if (war) war.score = -70;
  bank.advance(3 * TICKS_PER_HOUR);
  bank.advance(2 * TICKS_PER_MONTH);
  checkInvariants(bank);
  // The city's word is worth little by now: the towns it has stakes in and an arms deal with sanction it.
  bank.state.war!.diplomacy!.reputation = 20;
  bank.advance(TICKS_PER_MONTH);
  checkInvariants(bank);
  economy.push(bank.hash(), JSON.stringify([bank.state.war!.economy, bank.state.economy.history.at(-1)]));

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
    economy,
    live: liveLog,
    used: [...used].sort(),
    refused,
  };
}
