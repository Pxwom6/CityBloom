import { noiseMood } from './noise';
import { DEMAND, EDUCATION, HAPPINESS, HEALTH } from '../../data/balance';
import { ZONE_C, ZONE_I, ZONE_R } from '../../data/zones';
import { GARBAGE, UTILITIES } from '../../data/civic';
import type { Sim } from '../sim';
import { BState, type Building } from '../world/buildings';
import type { Factor } from './demand';
import { landValueAt } from './landValue';
import { fieldAt } from './pollution';
import { parkShare } from './weather';

const ZONE_LETTER = ['R', 'R', 'C', 'I'] as const;

const SCHOOL_LEVELS = ['primary school', 'high school', 'university'] as const;

/**
 * What a home's school places lack (P25): the level with the most pupils still unseated. 'full' when
 * it has some seats at that level, else none. Labels only: the mood value comes from the combined
 * education coverage as before. Undefined when nothing is unseated (no road link, say).
 */
function schoolLack(b: Building): string | undefined {
  const seats = [b.seat1, b.seat2, b.seat3];
  let lvl = -1;
  let most = 0;
  for (let l = 0; l < 3; l++) {
    const unmet = EDUCATION.pupils[l]! * (1 - seats[l]!);
    if (unmet > most) {
      most = unmet;
      lvl = l;
    }
  }
  if (lvl < 0) return undefined;
  const name = SCHOOL_LEVELS[lvl]!;
  return seats[lvl]! > 0 ? `${name[0]!.toUpperCase()}${name.slice(1)} is full` : `No ${name} places nearby`;
}

/**
 * Named happiness contributions for one building (DESIGN §3.9). Later milestones add utilities,
 * services, pollution, crime and sickness. The sum plus the base is the building's mood.
 */
export function happinessFactors(sim: Sim, b: Building): Factor[] {
  const f: Factor[] = [];
  const connected = sim.isBuildingConnected(b);
  if (!connected) f.push({ label: 'No road link to the highway', value: HAPPINESS.noHighwayAccess });
  // Utilities (DESIGN §3.6).
  if (b.power < 0.999)
    f.push({
      label: b.power <= 0 ? 'No power' : 'Power shortages',
      value: UTILITIES.noPower * (1 - b.power),
    });
  if (b.water < 0.999)
    f.push({
      label: b.water <= 0 ? 'No water' : 'Water shortages',
      value: UTILITIES.noWater * (1 - b.water),
    });
  if (b.sewage < 0.999) f.push({ label: 'Sewage backing up', value: UTILITIES.noSewage * (1 - b.sewage) });
  if (b.polluted > 0.01 && b.water > 0)
    f.push({ label: 'Polluted tap water', value: UTILITIES.pollutedWater * b.polluted });
  if (b.garbage > GARBAGE.visible) {
    const k = Math.min(1, (b.garbage - GARBAGE.visible) / (GARBAGE.bad - GARBAGE.visible));
    f.push({ label: 'Uncollected garbage', value: GARBAGE.moodPenalty * k });
  }
  if (b.flooded > 0) f.push({ label: 'Flooded', value: -0.5 });
  else if (b.closed) f.push({ label: 'Closed: no power or water', value: -0.2 });
  // Services (DESIGN §3.9): coverage lifts moods; missing coverage hurts more for the wealthy.
  const expect = HAPPINESS.serviceExpect[b.wealth]!;
  const svc = (label: string, cov: number, gain: number, loss: number, lacking?: string) => {
    const v = gain * cov - loss * (1 - cov) * expect;
    if (Math.abs(v) >= 0.005)
      f.push({
        label: cov >= 0.5 ? `${label} nearby` : (lacking ?? `No ${label.toLowerCase()} nearby`),
        value: v,
      });
  };
  if (b.zone === ZONE_R) {
    svc('Fire station', b.covFire, HAPPINESS.serviceGain, HAPPINESS.serviceLoss);
    svc('Police', b.covPolice, HAPPINESS.serviceGain, HAPPINESS.serviceLoss);
    svc('Health care', b.covHealth, HAPPINESS.serviceGain, HAPPINESS.serviceLoss);
    svc('School', b.covEdu, HAPPINESS.serviceGain, HAPPINESS.serviceLoss, schoolLack(b));
    if (b.covPark > 0.05) {
      // Nobody uses the park much in the rain or snow (M22).
      const k = parkShare(sim.state.weather);
      f.push({
        label: k < 1 ? 'Park nearby (wet today)' : 'Park nearby',
        value: HAPPINESS.park * b.covPark * k,
      });
    }
  } else {
    svc('Fire station', b.covFire, HAPPINESS.bizServiceGain, HAPPINESS.bizServiceLoss);
    svc('Police', b.covPolice, HAPPINESS.bizServiceGain, HAPPINESS.bizServiceLoss);
    if (b.zone === ZONE_C && b.covPark > 0.05)
      f.push({
        label: 'Park nearby',
        value: HAPPINESS.park * 0.5 * b.covPark * parkShare(sim.state.weather),
      });
  }
  const crime = sim.crimeAt(b.x, b.z);
  if (crime > 0.02)
    f.push({
      label: 'Crime in the area',
      value: (b.zone === ZONE_R ? HAPPINESS.crime : HAPPINESS.crime * 0.7) * Math.min(1, crime),
    });
  if (b.fire > 0) f.push({ label: 'On fire!', value: -0.3 });
  // Environment and health (DESIGN §3.11).
  const air = fieldAt(sim.state.airPollution, b.x, b.z);
  if (b.zone !== ZONE_I && air > 0.03)
    f.push({
      label: 'Polluted air',
      value: HEALTH.airMood * air * (b.zone === ZONE_R ? HEALTH.airSensitivity[b.wealth]! : 0.5),
    });
  // Noise (M23): an airport's flight path, a busy motorway or heavy industry next door.
  if (b.zone === ZONE_R) {
    const loud = noiseMood(fieldAt(sim.noise(), b.x, b.z));
    if (loud < 0) f.push({ label: 'Noise', value: loud });
  }
  if (b.zone === ZONE_R && b.pop > 0 && b.sick > 0.05) {
    const untreated = (b.sick * (1 - b.treated)) / b.pop;
    if (untreated > 0.002)
      f.push({ label: 'Sick residents without care', value: HEALTH.sickMood * untreated });
  }
  const tax = sim.taxRate(ZONE_LETTER[b.zone]!, b.wealth);
  const taxTerm = HAPPINESS.taxPerPoint * (tax - DEMAND.neutralTax) * HAPPINESS.taxSensitivity[b.wealth]!;
  if (b.zone === ZONE_R) {
    const workers = b.seekers;
    if (workers > 0) {
      const unemployed = Math.max(0, workers - b.employed) / workers;
      f.push({
        label: unemployed > 0.05 ? 'Residents without jobs' : 'Everyone has a job',
        value: HAPPINESS.unemployment * unemployed,
      });
      if (b.employed > 0) {
        const t = b.commute;
        let v: number;
        if (t <= HAPPINESS.commuteGoodSeconds) v = HAPPINESS.commuteGood;
        else if (t >= HAPPINESS.commuteBadSeconds) v = HAPPINESS.commuteBad;
        else {
          const k =
            (t - HAPPINESS.commuteGoodSeconds) / (HAPPINESS.commuteBadSeconds - HAPPINESS.commuteGoodSeconds);
          v = HAPPINESS.commuteGood + (HAPPINESS.commuteBad - HAPPINESS.commuteGood) * k;
        }
        f.push({ label: v >= 0 ? 'Short commute' : 'Long commute', value: v });
      }
    }
    if (b.pop > 0) {
      f.push({
        label: b.shop >= 0.6 ? 'Shops nearby' : 'Few shops nearby',
        value: HAPPINESS.shopsGood * b.shop + HAPPINESS.shopsBad * (1 - b.shop),
      });
    }
    const lv = landValueAt(sim, b.x, b.z);
    f.push({ label: 'Neighbourhood', value: HAPPINESS.landValue * (lv - 0.35) * 2 });
  } else {
    const staffed = b.cap > 0 ? Math.min(1, b.pop / b.cap) : 0;
    f.push(
      staffed >= 0.9
        ? { label: 'Fully staffed', value: HAPPINESS.staffedGood }
        : { label: 'Not enough workers', value: HAPPINESS.workersBad * (1 - staffed) },
    );
    if (b.zone === ZONE_C) {
      const c = b.shop;
      const v =
        c >= 0.6 ? HAPPINESS.customersGood * Math.min(1, c / 0.9) : HAPPINESS.customersBad * (1 - c / 0.6);
      f.push({ label: c >= 0.6 ? 'Plenty of customers' : 'Too few customers', value: v });
    }
  }
  if (Math.abs(taxTerm) > 0.001)
    f.push({ label: taxTerm < 0 ? 'Taxes are high' : 'Taxes are low', value: taxTerm });
  return f.map((x) => ({ label: x.label, value: Math.round(x.value * 1000) / 1000 }));
}

export function computeHappiness(sim: Sim, b: Building): number {
  const sum = happinessFactors(sim, b).reduce((s, x) => s + x.value, 0);
  return Math.round(Math.max(0, Math.min(1, HAPPINESS.base + sum)) * 1000) / 1000;
}

export function updateHappiness(sim: Sim): void {
  for (const b of sim.state.buildings.values()) {
    if (b.state === BState.Active || (b.state === BState.Construction && b.pop > 0))
      b.happiness = computeHappiness(sim, b);
  }
}
