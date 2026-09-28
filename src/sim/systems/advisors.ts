import { ROAD_TYPES } from '../../data/roads';
import { GARBAGE, UTILITIES } from '../../data/civic';
import { ZONE_I, ZONE_R } from '../../data/zones';
import { GRID_CELL, GRID_RES } from '../../data/world';
import { EDUCATION, TRAM } from '../../data/balance';
import { railTerminals } from './rail';
import type { Sim } from '../sim';
import { BState, type Building } from '../world/buildings';
import { civicDef, civicOnline } from '../world/civic';
import { trucksFor } from './garbage';
import { fieldAt } from './pollution';
import { junctionKind, junctionVC, segVC } from './traffic';
import { monthlyRates } from './economy';
import { campaignOpen, councilUntil, monthsToVote, projectedShare } from './elections';
import { ELECTIONS } from '../../data/elections';
import { CIVIC } from '../../data/civic';

export type AdvisorId =
  'finance' | 'utilities' | 'safety' | 'health' | 'education' | 'transport' | 'environment' | 'planning';

/** One piece of advice: how urgent, what's wrong, what to do, and where to look. */
export interface Advice {
  advisor: AdvisorId;
  /** 0 all good, 1 worth a look, 2 needs attention, 3 urgent. */
  severity: 0 | 1 | 2 | 3;
  title: string;
  text: string;
  at?: { x: number; z: number };
  /** Data map that shows the problem, if any. */
  map?: string;
}

const money = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

function active(sim: Sim): Building[] {
  return [...sim.state.buildings.values()]
    .filter((b) => b.state === BState.Active)
    .sort((a, b) => a.id - b.id);
}

/** Centre of a group of buildings (where the camera should look). */
function centre(list: Building[]): { x: number; z: number } | undefined {
  if (!list.length) return undefined;
  return {
    x: list.reduce((s, b) => s + b.x, 0) / list.length,
    z: list.reduce((s, b) => s + b.z, 0) / list.length,
  };
}

/** Advice from every advisor, most urgent first (DESIGN §5). Pure: reads the state only. */
/** What to do about piles of garbage, from what the city has: no sites, busy trucks, or out of reach. */
function garbageAdvice(sim: Sim): string {
  const sites = [...sim.state.civics.values()].filter((c) => civicDef(c).garbage && civicOnline(c));
  if (!sites.length)
    return 'Nobody collects it yet. Build a landfill at the edge of town, on a road that reaches these streets.';
  if (sites.every((c) => c.out >= trucksFor(sim, c)))
    return 'Every truck is out and still can’t keep up. Buy extra trucks at the landfill (click it), or add a site nearer these streets.';
  return 'Our trucks don’t reach these streets. Connect them by road, or add a landfill or recycling centre nearby.';
}

export function advise(sim: Sim): Advice[] {
  const out: Advice[] = [];
  const s = sim.state;
  const list = active(sim);
  const homes = list.filter((b) => b.zone === ZONE_R && b.pop > 0);
  const pop = s.totals.population;

  // Finance.
  const e = s.economy;
  const rates = monthlyRates(sim);
  const net = Object.values(rates).reduce((a, b) => a + b, 0);
  if (e.bankrupt)
    out.push({ advisor: 'finance', severity: 3, title: 'Bankrupt', text: 'The city ran out of money.' });
  else if (s.treasury < 0)
    out.push({
      advisor: 'finance',
      severity: 3,
      title: 'The treasury is empty',
      text: `We're ${money(s.treasury)} in debt. ${48 - e.negativeHours} hours until bankruptcy: take a loan, raise taxes or cut funding now.`,
    });
  else if (net < 0) {
    const runway = s.treasury / -net;
    const costs = Object.entries(rates)
      .filter(([, v]) => v < 0)
      .sort((a, b) => a[1] - b[1]);
    const biggest = costs[0]?.[0].replace('upkeep:', '').replace('roadUpkeep', 'road upkeep') ?? 'spending';
    out.push({
      advisor: 'finance',
      severity: runway < 3 ? 2 : 1,
      title:
        runway < 3
          ? `Money runs out in ${Math.max(0, Math.floor(runway))} months`
          : 'Spending more than we earn',
      text: `We lose ${money(net)} a month; our biggest cost is ${biggest}. Raise taxes a point or two, trim funding, or grow the tax base.`,
    });
  } else
    out.push({
      advisor: 'finance',
      severity: 0,
      title: 'The books balance',
      text: `We're making ${money(net)} a month with ${money(s.treasury)} in the bank.`,
    });
  const high = (['R', 'C', 'I'] as const).filter((z) => e.taxes[z].some((t) => t >= 13));
  if (high.length)
    out.push({
      advisor: 'finance',
      severity: 1,
      title: 'Taxes are high',
      text: `High ${high.join('/')} taxes are putting people off. Every point above 9 % slows growth.`,
    });
  // Big projects waiting for money, and the council after a lost election (M17).
  for (const c of [...s.civics.values()].sort((a, b) => a.id - b.id)) {
    const def = CIVIC.get(c.def);
    const next = c.build?.waiting ? def?.project?.stages[c.build.stage + 1] : undefined;
    if (!def || !next) continue;
    out.push({
      advisor: 'finance',
      severity: 1,
      title: `The ${def.name.toLowerCase()} is waiting for money`,
      text: `Its ${next.name.toLowerCase()} needs ${money(next.cost)}. Work carries on the month the treasury can pay.`,
      at: { x: c.x, z: c.z },
    });
  }
  const council = councilUntil(sim);
  if (council)
    out.push({
      advisor: 'finance',
      severity: 1,
      title: 'The council blocks tax rises',
      text: `After the lost election the council refuses tax rises and new loans until ${council}. Rates can still come down.`,
    });
  if (campaignOpen(sim)) {
    const share = projectedShare(sim);
    const months = Math.max(1, Math.ceil(monthsToVote(sim)));
    const left = ELECTIONS.maxPromises - s.election.promises.length;
    out.push({
      advisor: 'planning',
      severity: share < 0.5 ? 2 : 1,
      title: share < 0.5 ? 'We would lose the election' : `An election in ${plural(months, 'month')}`,
      text:
        `If the vote were today we'd get ${Math.round(share * 100)} %. Voters follow approval above all.` +
        (left > 0
          ? ` You can still make ${plural(left, 'promise')} (city panel, Election); each one kept adds ${Math.round(ELECTIONS.kept * 100)} points.`
          : ''),
    });
  }

  // Utilities.
  const util = [
    ['power', 'a power plant', (b: Building) => b.power < 0.5],
    ['water', 'a water pump', (b: Building) => b.water < 0.5],
    ['sewage', 'septic tanks, an outflow or a treatment plant', (b: Building) => b.sewage < 0.5],
  ] as const;
  let utilOk = true;
  for (const [u, fix, lacking] of util) {
    const without = list.filter(lacking);
    if (!without.length) continue;
    utilOk = false;
    const share = without.length / Math.max(1, list.length);
    out.push({
      advisor: 'utilities',
      severity: share > 0.2 ? 3 : 2,
      title: `${plural(without.length, 'building')} without ${u}`,
      text: `Build ${fix} or connect these buildings to one by road. They'll close or empty within a day or two.`,
      at: centre(without.slice(0, 20)),
      map: u,
    });
  }
  const dirty = list.filter((b) => b.garbage >= GARBAGE.visible).sort((a, b) => b.garbage - a.garbage);
  if (dirty.length > 3) {
    utilOk = false;
    out.push({
      advisor: 'utilities',
      severity: dirty.length > list.length * 0.1 ? 2 : 1,
      title: `Garbage piling up at ${plural(dirty.length, 'building')}`,
      text: garbageAdvice(sim),
      at: centre(dirty.slice(0, 10)),
      map: 'garbage',
    });
  }
  for (const c of [...s.civics.values()].sort((a, b) => a.id - b.id)) {
    const out0 = civicDef(c).output;
    if (!out0?.water) continue;
    if (sim.groundPollutionAt(c.x, c.z) > UTILITIES.pollutedPumpThreshold) {
      utilOk = false;
      out.push({
        advisor: 'utilities',
        severity: 2,
        title: 'A pump is drawing polluted water',
        text: 'The ground under it is polluted. Move it away from outflows, landfills and heavy industry.',
        at: { x: c.x, z: c.z },
        map: 'groundPollution',
      });
      break;
    }
  }
  if (utilOk && list.length)
    out.push({
      advisor: 'utilities',
      severity: 0,
      title: 'All supplied',
      text: 'Power, water and sewage reach every building.',
    });

  // Safety: disasters first.
  const NAMES = { earthquake: 'Earthquake', tornado: 'Tornado', flood: 'Flood', meteor: 'Meteor strike' };
  const ADVICE = {
    earthquake:
      'Fire engines and ambulances will answer the collapses; damaged roads and services are being repaired.',
    tornado: 'It will blow itself out soon. Keep fire and health services funded so they can respond.',
    flood:
      'The water will drain in a day or so. Flooded homes and businesses are closed; roads under water are impassable.',
    meteor: 'Brace for impact. Fire engines will be needed around the crater.',
  };
  for (const d of s.disasters)
    out.push({
      advisor: 'safety',
      severity: 3,
      title: `${NAMES[d.kind]} under way`,
      text: ADVICE[d.kind],
      at: { x: d.x, z: d.z },
    });
  const rubble = [...s.buildings.values()]
    .filter((b) => b.state === BState.Rubble)
    .sort((a, b) => a.id - b.id);
  if (rubble.length >= 3)
    out.push({
      advisor: 'safety',
      severity: rubble.length > 20 ? 2 : 1,
      title: `${plural(rubble.length, 'lot')} of rubble`,
      text: 'Crews clear rubble within a day or two, faster near a fire station. Bulldoze it to clear a lot now.',
      at: centre(rubble.slice(0, 20)),
    });
  const offline = [...s.civics.values()].filter((c) => c.damage > 0 || c.flooded).sort((a, b) => a.id - b.id);
  if (offline.length) {
    const c = offline[0]!;
    out.push({
      advisor: 'utilities',
      severity: 2,
      title: `${plural(offline.length, 'city building')} out of action`,
      text: `The ${civicDef(c).name.toLowerCase()} is ${c.flooded ? 'under water' : `being repaired (${c.damage} h left)`}. Its services are down until then.`,
      at: { x: c.x, z: c.z },
    });
  }
  if (s.roadDamage.size) {
    const first = [...s.roadDamage.keys()].sort((a, b) => a - b)[0]!;
    const mid = sim.net.curve(first).pointAt(sim.net.curve(first).length / 2);
    out.push({
      advisor: 'transport',
      severity: 2,
      title: `${plural(s.roadDamage.size, 'road')} closed for repairs`,
      text: 'Traffic, services and utilities detour around them until the crews are done.',
      at: { x: mid.x, z: mid.z },
      map: 'traffic',
    });
  }
  const burning = s.burning.map((id) => s.buildings.get(id)).filter((b): b is Building => !!b);
  if (burning.length)
    out.push({
      advisor: 'safety',
      severity: 3,
      title: `${plural(burning.length, 'fire')} burning`,
      text: burning.some((b) => b.covFire > 0)
        ? 'Engines are on their way.'
        : 'No fire station can reach them quickly. Build one nearby.',
      at: { x: burning[0]!.x, z: burning[0]!.z },
      map: 'fire',
    });
  const noFire = list.filter((b) => b.covFire < 0.3);
  if (noFire.length > list.length * 0.1 && list.length > 10)
    out.push({
      advisor: 'safety',
      severity: noFire.length > list.length * 0.4 ? 2 : 1,
      title: `${plural(noFire.length, 'building')} beyond fire cover`,
      text: 'A fire there would spread before engines arrived. Place a fire station where the map shows red roads.',
      at: centre(noFire.slice(0, 20)),
      map: 'fire',
    });
  let worst = -1;
  let worstCrime = 0;
  for (let k = 0; k < s.crime.length; k++)
    if (s.crime[k]! > worstCrime) {
      worstCrime = s.crime[k]!;
      worst = k;
    }
  if (worstCrime > 0.25)
    out.push({
      advisor: 'safety',
      severity: worstCrime > 0.5 ? 2 : 1,
      title: 'Crime is rising',
      text: 'Unanswered crimes are piling up here. A police station nearby, and jobs for the unemployed, will bring it down.',
      at: { x: ((worst % GRID_RES) + 0.5) * GRID_CELL, z: (Math.floor(worst / GRID_RES) + 0.5) * GRID_CELL },
      map: 'crime',
    });
  if (!out.some((a) => a.advisor === 'safety') && list.length)
    out.push({
      advisor: 'safety',
      severity: 0,
      title: 'Safe streets',
      text: 'Fire and police cover the city.',
    });

  // Health.
  const sick = homes.reduce((a, b) => a + b.sick, 0);
  const untreated = homes.reduce((a, b) => a + b.sick * (1 - b.treated), 0);
  if (pop > 0 && untreated / pop > 0.01) {
    const worstHomes = [...homes].sort(
      (a, b) => (b.sick * (1 - b.treated)) / b.pop - (a.sick * (1 - a.treated)) / a.pop,
    );
    out.push({
      advisor: 'health',
      severity: untreated / pop > 0.03 ? 3 : 2,
      title: `${plural(Math.round(untreated), 'sick resident')} without care`,
      text: 'Build a clinic or hospital near them, or add beds. Look for what makes them sick: smog, polluted water or garbage.',
      at: centre(worstHomes.slice(0, 8)),
      map: 'health',
    });
  } else if (sick > 0 && pop > 0)
    out.push({
      advisor: 'health',
      severity: 0,
      title: 'The sick are cared for',
      text: `${plural(Math.round(sick), 'resident')} unwell and in care.`,
    });
  const noHealth = homes.filter((b) => b.covHealth < 0.3);
  if (noHealth.length > homes.length * 0.25 && homes.length > 8)
    out.push({
      advisor: 'health',
      severity: 1,
      title: `${plural(noHealth.length, 'home')} far from health care`,
      text: 'A clinic is cheap and covers a neighbourhood; hospitals come later.',
      at: centre(noHealth.slice(0, 20)),
      map: 'health',
    });
  if (!out.some((a) => a.advisor === 'health') && pop > 0)
    out.push({ advisor: 'health', severity: 0, title: 'A healthy city', text: 'Hardly anyone is sick.' });

  // Education.
  const pupils = homes.reduce((a, b) => a + b.pop * EDUCATION.pupils[0]!, 0);
  const seated = homes.reduce((a, b) => a + b.pop * EDUCATION.pupils[0]! * b.seat1, 0);
  if (pupils > 20 && seated / pupils < 0.7) {
    const unschooled = homes.filter((b) => b.seat1 < 0.5);
    out.push({
      advisor: 'education',
      severity: seated / pupils < 0.3 ? 2 : 1,
      title: `${plural(Math.round(pupils - seated), 'child', 'children')} without a school place`,
      text: 'Build a primary school near them. Educated residents earn more and bring cleaner industry.',
      at: centre(unschooled.slice(0, 20)),
      map: 'education',
    });
  }
  const [e1, e2] = s.totals.eduWorkforce;
  const ind = list.filter((b) => b.zone === ZONE_I);
  if (ind.length > 4 && ind.filter((b) => b.wealth === 0).length > ind.length * 0.5)
    out.push({
      advisor: 'education',
      severity: 1,
      title: 'Our industry is heavy and dirty',
      text:
        e1 < EDUCATION.manufacturing
          ? `Only ${Math.round(e1 * 100)} % of workers finished school (${Math.round(EDUCATION.manufacturing * 100)} % brings manufacturing). More school places will help.`
          : `Workers are ready for manufacturing; ${Math.round(e2 * 100)} % have high school (${Math.round(EDUCATION.highTech * 100)} % brings high-tech).`,
      map: 'eduLevel',
    });
  if (!out.some((a) => a.advisor === 'education') && pop > 0)
    out.push({
      advisor: 'education',
      severity: 0,
      title: 'Schools are coping',
      text: `Workforce: ${Math.round(e1 * 100)} % schooled.`,
    });

  // Transport.
  if (!s.totals.highwayConnected && s.net.segments.size > 1)
    out.push({
      advisor: 'transport',
      severity: 3,
      title: 'No road to the highway',
      text: 'Nothing can grow until a road links the town to the regional highway.',
      at: (() => {
        const n = s.net.nodes.get(s.highway.connect);
        return n ? { x: n.x, z: n.z } : undefined;
      })(),
    });
  let jam: { seg: number; vc: number } | null = null;
  for (const id of [...s.traffic.keys()].sort((a, b) => a - b)) {
    if (!s.net.segments.has(id) || id === s.highway.segment) continue;
    const vc = segVC(sim, id, 1);
    if (vc > 1.1 && (!jam || vc > jam.vc)) jam = { seg: id, vc };
  }
  // Trams and trains (M20): once unlocked, a line along a jammed corridor takes commuters off it.
  const railOpen = sim.isUnlocked(TRAM.unlockPopulation);
  const lines = sim.lines();
  if (jam) {
    const c = sim.net.curve(jam.seg);
    const seg = s.net.segments.get(jam.seg)!;
    const transit =
      railOpen && !lines.some((l) => l.mode !== 'bus')
        ? ROAD_TYPES[seg.type].tram
          ? ' Or lay tram track along it (Roads → Tram track) with a tram depot and stops, or run a train line beside it: riders leave their cars at home.'
          : ' Or run a train line beside it: stations on connected track, and riders leave their cars at home.'
        : '';
    // Big towns with a jammed main road: a city highway round it takes the through traffic (M19).
    const bypass =
      (seg.type === 'avenue' || seg.type === 'boulevard') &&
      pop >= ROAD_TYPES.motorway.unlockPopulation &&
      ![...s.net.segments.values()].some((x) => x.type === 'motorway');
    out.push({
      advisor: 'transport',
      severity: jam.vc > 1.6 ? 2 : 1,
      title: 'Rush-hour jam',
      text:
        (bypass
          ? 'This road carries more than it can. A city highway round the town, joined by ramps, would take the through traffic off it; or build a parallel route, or run buses.'
          : 'This road carries more than it can. Upgrade it, build a parallel route, or run buses past it. One-way pairs of streets carry a quarter more.') +
        transit,
      at: c.pointAt(c.length / 2),
      map: 'traffic',
    });
  }
  // Junctions (M19): the busiest plain junction over capacity wants a roundabout.
  let knot: { node: number; vc: number } | null = null;
  for (const id of [...s.net.nodes.keys()].sort((a, b) => a - b)) {
    if (junctionKind(sim, id) !== 'plain') continue;
    const vc = junctionVC(sim, id, 1);
    if (vc > 1.1 && (!knot || vc > knot.vc)) knot = { node: id, vc };
  }
  if (knot) {
    const n = s.net.nodes.get(knot.node)!;
    out.push({
      advisor: 'transport',
      severity: knot.vc > 1.6 ? 2 : 1,
      title: 'Jammed junction',
      text: 'Cars queue to get through this junction at the rush hour. A roundabout passes far more: pick Roundabout in the road tool, or click one of its roads.',
      at: { x: n.x, z: n.z },
      map: 'traffic',
    });
  }
  // Rail freight (M20): a busy highway link with industry behind it, and no terminal yet.
  const link = s.railway ? s.net.nodes.get(s.railway.connect) : undefined;
  const hwLoad = s.traffic.get(s.highway.segment) ?? 0;
  if (
    link &&
    railOpen &&
    CIVIC.get('railfreight') &&
    sim.isUnlocked(CIVIC.get('railfreight')!.unlockPopulation) &&
    s.totals.iJobs > 400 &&
    hwLoad > 1500 &&
    !railTerminals(sim).length
  )
    out.push({
      advisor: 'transport',
      severity: 1,
      title: 'Freight trucks crowd the highway link',
      text: 'Industry sends all its goods out by truck. Lay a railway from the regional rail link here to a rail freight terminal near the factories: goods go on by train instead, off the roads.',
      at: { x: link.x, z: link.z },
      map: 'traffic',
    });
  // Stations and tram depots that run nothing yet (M20).
  for (const c of [...s.civics.values()].sort((a, b) => a.id - b.id)) {
    const d = civicDef(c);
    if (!(d.rail || d.tram) || !civicOnline(c)) continue;
    const runs = lines.some((l) =>
      d.rail ? l.mode === 'train' && l.stops.includes(c.id) : l.depot === c.id,
    );
    if (runs) continue;
    out.push({
      advisor: 'transport',
      severity: 1,
      title: d.rail ? 'A station with no trains' : 'A tram depot with no line',
      text: d.rail
        ? 'Trains run between two or more stations on connected track. Build another station along this railway.'
        : 'Its trams need the road in front to have tram track, and at least two tram stops on track they can reach.',
      at: { x: c.x, z: c.z },
    });
    break;
  }
  const commute = sim.avgCommute();
  if (commute > 20 * 60)
    out.push({
      advisor: 'transport',
      severity: 1,
      title: `Commutes average ${Math.round(commute / 60)} minutes`,
      text: 'Long commutes make people unhappy. Put jobs closer to homes, or relieve the busiest roads.',
      map: 'traffic',
    });
  if (!out.some((a) => a.advisor === 'transport') && pop > 0)
    out.push({
      advisor: 'transport',
      severity: 0,
      title: 'Traffic flows',
      text: `The average commute is ${Math.max(1, Math.round(commute / 60))} minutes.`,
    });

  // Environment.
  const smoggy = homes.filter((b) => fieldAt(s.airPollution, b.x, b.z) > 0.08);
  if (smoggy.length > 3)
    out.push({
      advisor: 'environment',
      severity: smoggy.length > homes.length * 0.2 ? 2 : 1,
      title: `Smog over ${plural(smoggy.length, 'home')}`,
      text:
        'Smoke from industry and power plants drifts downwind. Move them, switch to cleaner power, or plant parks in the way.' +
        (sim.isUnlocked(5_000) && !sim.policyAnywhere('cleanIndustry')
          ? ' Clean industry grants on a district painted over the works cost only its share.'
          : ''),
      at: centre(smoggy.slice(0, 20)),
      map: 'airPollution',
    });
  else if (pop > 0)
    out.push({ advisor: 'environment', severity: 0, title: 'Clean air', text: 'Homes breathe clean air.' });

  // Planning: demand and decline.
  const abandoned = [...s.buildings.values()].filter((b) => b.state === BState.Abandoned);
  if (abandoned.length > 3)
    out.push({
      advisor: 'planning',
      severity: abandoned.length > list.length * 0.08 ? 2 : 1,
      title: `${plural(abandoned.length, 'building')} abandoned`,
      text: 'Click one to see why its people left; the happiness map shows the unhappy areas.',
      at: centre(abandoned.slice(0, 10) as Building[]),
      map: 'happiness',
    });
  // Districts (M21): a bigger town can give its parts rules of their own.
  if (pop >= 5_000 && !s.districts.size)
    out.push({
      advisor: 'planning',
      severity: 0,
      title: 'Parts of town with their own rules',
      text: 'Paint districts (I) for the old centre, the works or a quiet suburb, then give each its own policies in the Districts panel: a heavy-traffic ban round the homes, a heritage district, recycling where it pays.',
    });
  const d = s.demand;
  const names = { R: 'homes', C: 'shops and offices', I: 'industry' } as const;
  for (const z of ['R', 'C', 'I'] as const)
    if (d[z] > 0.5)
      out.push({
        advisor: 'planning',
        severity: 1,
        title: `The city wants more ${names[z]}`,
        text: `Zone more ${z === 'R' ? 'residential' : z === 'C' ? 'commercial' : 'industrial'} land along roads with access to the highway.`,
      });
  return out.sort((a, b) => b.severity - a.severity);
}
