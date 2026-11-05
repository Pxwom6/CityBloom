/** A handful of goals for fun (M10). The checks live in `sim/systems/progress.ts`. */
export interface AchievementDef {
  id: string;
  name: string;
  blurb: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'firstStreet', name: 'Breaking ground', blurb: 'Build your first road off the highway.' },
  { id: 'village', name: 'On the map', blurb: 'Reach 800 residents.' },
  {
    id: 'lightsOn',
    name: 'Lights on',
    blurb: 'Power, water and sewage for every building in a town of 500 or more.',
  },
  { id: 'debtFree', name: 'Debt free', blurb: 'Pay off a loan.' },
  {
    id: 'safeStreets',
    name: 'Safe streets',
    blurb: 'Fire and police cover for 90 % of homes, with 2,000 residents.',
  },
  { id: 'greenGrid', name: 'Green grid', blurb: 'Power 2,000 residents with nothing but wind and sun.' },
  {
    id: 'scholars',
    name: 'City of scholars',
    blurb: 'An average schooling past high school, with 5,000 residents.',
  },
  {
    id: 'comeback',
    name: 'Comeback',
    blurb: 'Grow past your old peak after a disaster flattened 10 buildings.',
  },
  { id: 'touristTrap', name: 'Tourist trap', blurb: 'Welcome 1,000 visitors in a day.' },
  { id: 'skyline', name: 'Skyline', blurb: 'Build three landmarks.' },
  { id: 'nestEgg', name: 'Nest egg', blurb: 'Save up $500,000.' },
  { id: 'metropolis', name: 'Metropolis', blurb: 'Reach 100,000 residents.' },
  { id: 'underTheDome', name: 'Under the dome', blurb: 'Stop an atom bomb with the dome shield.' },
  {
    id: 'firstBomb',
    name: 'First to the bomb',
    blurb: 'Finish the atom bomb before any other city in the race.',
  },
];
