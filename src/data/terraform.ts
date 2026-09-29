/** Terraforming (M24): the player's own earthworks with a round brush. DESIGN.md §3.25. */
export type TerraformMode = 'raise' | 'lower' | 'level' | 'smooth';

export const TERRAFORM_MODES: { id: TerraformMode; name: string; key: string; blurb: string }[] = [
  {
    id: 'raise',
    name: 'Raise',
    key: '1',
    blurb: 'Build the ground up under the brush. Hold to keep raising.',
  },
  { id: 'lower', name: 'Lower', key: '2', blurb: 'Dig the ground down, never below the water table.' },
  {
    id: 'level',
    name: 'Level',
    key: '3',
    blurb: 'Flatten to the height where the drag starts: terraces for lots and plazas.',
  },
  { id: 'smooth', name: 'Smooth', key: '4', blurb: 'Even out bumps and soften steep banks.' },
];

export const TERRAFORM = {
  /** Metres a raise or lower moves the ground at the brush's centre, each time it's applied. */
  step: 1,
  radius: { min: 16, max: 128, initial: 48 },
  /**
   * Ground within this many metres of a building, or of a road's edge and shoulders, is held as it
   * is: it's what they stand on (heights are interpolated between 8 m samples).
   */
  hold: 12,
  /**
   * Near held ground the new ground may rise or fall at most this steeply (rise over run, 1 in 1)
   * from it, so a lot or a road is never left on the edge of a cliff.
   */
  nearSlope: 1,
  /** How far that limit reaches from held ground, metres. */
  reach: 32,
  /** Highest ground the brush makes, and the most it moves the ground from how the map began. */
  maxHeight: 200,
  maxChange: 40,
  /** Towards the map's edge the brush fades out, so the ground meets the scenery beyond. */
  edgeFade: 48,
  /**
   * Dollars per cubic metre moved: bulk earthmoving on open ground, cheaper than a road's engineered
   * formation (0.4), so terracing a hillside for lots is a real but affordable choice.
   */
  costPerCubicMetre: 0.25,
} as const;
