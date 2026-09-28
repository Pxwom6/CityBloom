/**
 * Population milestones (M10). Every unlockable thing in `src/data` sets its `unlockPopulation` to one
 * of these thresholds, so each milestone arrives with a batch of new things to build. Unlocks keep
 * once reached, even if the population dips. DESIGN.md §3.13.
 */
export interface Milestone {
  population: number;
  name: string;
  blurb: string;
}

export const MILESTONES: Milestone[] = [
  { population: 0, name: 'Hamlet', blurb: 'A few homes by the highway.' },
  {
    population: 800,
    name: 'Village',
    blurb: 'Enough people for a bus route, a town square and snow ploughs.',
  },
  { population: 2_000, name: 'Town', blurb: 'A proper town: high schools, sewage treatment and recycling.' },
  {
    population: 5_000,
    name: 'Large town',
    blurb: 'Tall buildings, hospitals, trams and trains, and the first city policies.',
  },
  { population: 10_000, name: 'Small city', blurb: 'Tourism and trade open up, with landmarks to match.' },
  {
    population: 20_000,
    name: 'City',
    blurb: 'Boulevards, a university, a research park and the first big projects.',
  },
  {
    population: 40_000,
    name: 'Large city',
    blurb: 'Nuclear power, grand landmarks, a launch complex and a garden expo.',
  },
  { population: 70_000, name: 'Major city', blurb: 'A skyline to be proud of.' },
  { population: 100_000, name: 'Metropolis', blurb: 'One hundred thousand people call it home.' },
];

/** Index of the highest milestone at or below `population`. */
export function milestoneIndex(population: number): number {
  let k = 0;
  for (let i = 0; i < MILESTONES.length; i++) if (population >= MILESTONES[i]!.population) k = i;
  return k;
}
