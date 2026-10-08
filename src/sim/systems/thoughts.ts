import { ZONE_C, ZONE_I, ZONE_R } from '../../data/zones';
import type { Sim } from '../sim';
import { BState, type Building } from '../world/buildings';
import { happinessFactors } from './happiness';
import { hash2 } from '../rng';
import { TICKS_PER_HOUR } from '../time';

/** A short line from a resident or business, reflecting real conditions where they are. */
export interface Thought {
  id: number;
  text: string;
  /** −1 unhappy, 0 neutral, 1 happy. */
  mood: -1 | 0 | 1;
  x: number;
  z: number;
}

type Line = (b: Building) => string;

/** Lines by mood factor (matched on the factor's label). Several variants each. */
const LINES: [RegExp, Line[]][] = [
  [
    /no water|water shortage/i,
    [
      (b) =>
        b.noWaterH >= 48
          ? `Day ${Math.floor(b.noWaterH / 24) + 1} without water. We're moving out.`
          : 'No water again. How do they expect us to live?',
      () => 'Nothing comes out of the tap.',
    ],
  ],
  [
    /no power|power shortage/i,
    [
      (b) =>
        b.noPowerH > 6
          ? `The lights have been out for ${b.noPowerH} hours.`
          : 'Another blackout. Candles again.',
      () => 'The fridge is warm and the lights are dead.',
    ],
  ],
  [/sewage/i, [() => 'The drains are backing up. The smell!', () => 'Who do we call about the sewers?']],
  [/polluted tap water/i, [() => 'The tap water tastes of metal.', () => 'We only drink bottled water now.']],
  [
    /garbage/i,
    [() => "The bins haven't been emptied in weeks.", () => 'Rubbish is piling up on the pavement.'],
  ],
  [
    /polluted air/i,
    [
      () => 'You can taste the smoke from the chimneys.',
      () => 'My chest hurts when the wind blows from the plant.',
    ],
  ],
  [
    /sick residents/i,
    [
      () => "My kid's been ill for days and the clinic is full.",
      () => 'Half the street is sick. Where are the doctors?',
    ],
  ],
  [
    /no fire station/i,
    [() => 'If a fire started here, who would come?', () => 'The nearest fire station is miles away.'],
  ],
  [
    /no police|crime/i,
    [() => 'Someone broke into the shop next door.', () => "I don't walk home alone after dark any more."],
  ],
  [/no health care/i, [() => 'The nearest doctor is a long drive away.']],
  // What a home's school places lack (P25): the label names the level.
  [/primary school/i, [() => 'No school place for our youngest.', () => 'The kids have nowhere to learn.']],
  [
    /high school/i,
    [
      () => 'The teenagers have no high school to go to.',
      () => 'Our eldest has to leave town for high school.',
    ],
  ],
  [
    /university/i,
    [() => 'Nobody here can study past high school.', () => 'No university for our school-leavers.'],
  ],
  [/without jobs/i, [() => 'Still looking for work.', () => 'Another rejection letter today.']],
  [
    /long commute/i,
    [() => 'Over an hour in traffic every morning.', () => 'I spend more time in the car than at home.'],
  ],
  [/few shops/i, [() => 'Nowhere to buy milk around here.']],
  [/taxes are high/i, [() => 'Taxes went up again?', () => 'The tax bill is more than the mortgage.']],
  [/highway/i, [() => 'We feel cut off from the rest of the world.']],
  [/too few customers/i, [() => 'The shop is empty all day.', () => 'Business is dead around here.']],
  [/not enough workers/i, [() => "Can't find anyone to hire.", () => 'We could grow if we had the staff.']],
  [/flooded/i, [() => 'The water is up to the windows.', () => 'Everything downstairs is ruined.']],
  [/closed/i, [() => "We've had to shut until the power's back."]],
  [/on fire/i, [() => 'FIRE! Call the fire brigade!']],
  // Good news.
  [/park nearby/i, [() => 'Love the park round the corner.', () => 'Picnic in the park this weekend!']],
  [/short commute/i, [() => 'Ten minutes to work. Perfect.', () => 'I can walk to work!']],
  [/school nearby/i, [() => 'The kids love their new school.']],
  [/shops nearby/i, [() => 'Everything we need is a short walk away.']],
  [/plenty of customers/i, [() => 'Business is booming!', () => 'Busiest week we’ve ever had.']],
  [/fully staffed/i, [() => 'Great team this year.']],
  [/taxes are low/i, [() => 'Low taxes. Nice.']],
  [/fire station nearby/i, [() => 'Good to have the fire station close.']],
];

/**
 * A handful of thoughts for the feed: buildings are chosen by a hash of the hour, so the feed
 * changes every game hour without touching the RNG; each speaks to its strongest mood factor.
 */
export function thoughts(sim: Sim, count = 6): Thought[] {
  const s = sim.state;
  const hour = Math.floor(s.tick / TICKS_PER_HOUR);
  const list = [...s.buildings.values()]
    .filter(
      (b) =>
        b.state === BState.Active &&
        b.pop > 0 &&
        (b.zone === ZONE_R || b.zone === ZONE_C || b.zone === ZONE_I),
    )
    .sort((a, b) => hash2(a.id, hour, 7) - hash2(b.id, hour, 7));
  const out: Thought[] = [];
  for (const b of list) {
    if (out.length >= count) break;
    const factors = happinessFactors(sim, b).filter((f) => Math.abs(f.value) >= 0.02);
    if (!factors.length) continue;
    // Complaints win over praise when they're comparable.
    factors.sort(
      (a, c) => Math.abs(c.value) * (c.value < 0 ? 1.5 : 1) - Math.abs(a.value) * (a.value < 0 ? 1.5 : 1),
    );
    // Mostly the strongest factor, sometimes the runner-up, so the feed isn't one note.
    const second =
      factors.length > 1 &&
      Math.abs(factors[1]!.value) >= Math.abs(factors[0]!.value) * 0.5 &&
      hash2(b.id, hour, 5) < 0.4;
    const f = factors[second ? 1 : 0]!;
    const entry = LINES.find(([re]) => re.test(f.label));
    if (!entry) continue;
    const variants = entry[1];
    const text = variants[Math.floor(hash2(b.id, hour, 11) * variants.length)]!(b);
    if (out.some((t) => t.text === text)) continue;
    out.push({ id: b.id, text, mood: f.value < -0.02 ? -1 : f.value > 0.02 ? 1 : 0, x: b.x, z: b.z });
  }
  return out;
}
