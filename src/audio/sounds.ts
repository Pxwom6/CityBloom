import { burst, tone } from './synth';

export type SoundName =
  | 'click'
  | 'build'
  | 'place'
  | 'zone'
  | 'bulldoze'
  | 'error'
  | 'alert'
  | 'good'
  | 'siren'
  | 'quake'
  | 'whoosh'
  | 'boom'
  | 'fanfare'
  | 'thunder'
  | 'earth';

/**
 * Sound-effect recipes, all synthesised. `v` (0–1) varies pitch a little so repeats don't grate.
 * Each returns the time the sound ends.
 */
export const SOUNDS: Record<
  SoundName,
  (ctx: BaseAudioContext, out: AudioNode, t: number, v: number) => number
> = {
  /** A soft tick for UI buttons. */
  click: (ctx, out, t, v) => {
    burst(ctx, out, t, { f0: 3800, q: 2, gain: 0.05, dur: 0.02 });
    return tone(ctx, out, t, { type: 'triangle', f0: 1500 + v * 200, f1: 1000, gain: 0.09, dur: 0.05 });
  },

  /** Laying a road: a thump, a gravel crunch and a settling clack. */
  build: (ctx, out, t, v) => {
    tone(ctx, out, t, { f0: 120 + v * 20, f1: 50, gain: 0.5, dur: 0.16 });
    burst(ctx, out, t + 0.01, {
      colour: 'brown',
      filter: 'lowpass',
      f0: 1400,
      f1: 300,
      gain: 0.35,
      dur: 0.22,
    });
    burst(ctx, out, t + 0.02, { f0: 1100 + v * 300, q: 0.8, gain: 0.12, dur: 0.18 });
    return burst(ctx, out, t + 0.09, { f0: 2400, q: 4, gain: 0.08, dur: 0.05 });
  },

  /** Placing a building: a solid clunk and a two-note chime. */
  place: (ctx, out, t, v) => {
    tone(ctx, out, t, { f0: 95 + v * 10, f1: 45, gain: 0.55, dur: 0.2 });
    burst(ctx, out, t, { colour: 'brown', filter: 'lowpass', f0: 900, f1: 200, gain: 0.3, dur: 0.25 });
    tone(ctx, out, t + 0.06, { type: 'triangle', f0: 523.25, gain: 0.08, dur: 0.25 });
    return tone(ctx, out, t + 0.14, { type: 'triangle', f0: 783.99, gain: 0.07, dur: 0.35 });
  },

  /** Painting a zone: a brushed swish with a soft chime. */
  zone: (ctx, out, t, v) => {
    burst(ctx, out, t, { f0: 1800, f1: 5200, q: 1.2, gain: 0.2, attack: 0.03, dur: 0.16 });
    return tone(ctx, out, t + 0.03, {
      f0: 660 + v * 40,
      f1: 700 + v * 40,
      gain: 0.11,
      attack: 0.02,
      dur: 0.22,
    });
  },

  /** Moving earth (M24): a soft scrape of soil and a low, rounded push. */
  earth: (ctx, out, t, v) => {
    burst(ctx, out, t, {
      colour: 'brown',
      filter: 'lowpass',
      f0: 500 + v * 120,
      f1: 180,
      gain: 0.32,
      attack: 0.04,
      dur: 0.32,
    });
    tone(ctx, out, t + 0.02, { f0: 58 + v * 6, f1: 44, gain: 0.3, attack: 0.03, dur: 0.24 });
    return burst(ctx, out, t + 0.08, { f0: 1500 + v * 400, q: 0.9, gain: 0.05, attack: 0.02, dur: 0.14 });
  },

  /** Bulldozing: rumble, crunches and a low thud. */
  bulldoze: (ctx, out, t, v) => {
    burst(ctx, out, t, { colour: 'brown', filter: 'lowpass', f0: 700, f1: 120, gain: 0.55, dur: 0.55 });
    tone(ctx, out, t, { f0: 70, f1: 38, gain: 0.45, dur: 0.3 });
    let end = t;
    for (const [dt, f] of [
      [0.04, 900],
      [0.14, 650],
      [0.27, 1200],
    ] as const)
      end = burst(ctx, out, t + dt + v * 0.02, { f0: f, q: 1.5, gain: 0.22, dur: 0.07 });
    return Math.max(end, t + 0.55);
  },

  /** Not allowed: two short, dull buzzes. */
  error: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'square', f0: 170, gain: 0.07, dur: 0.07, lp: 900 });
    tone(ctx, out, t, { type: 'square', f0: 178, gain: 0.05, dur: 0.07, lp: 900 });
    return tone(ctx, out, t + 0.11, { type: 'square', f0: 150, gain: 0.07, dur: 0.1, lp: 800 });
  },

  /** Something needs attention: a descending two-tone chime. */
  alert: (ctx, out, t) => {
    tone(ctx, out, t, { f0: 880, gain: 0.14, dur: 0.22 });
    tone(ctx, out, t, { type: 'triangle', f0: 1760, gain: 0.03, dur: 0.12 });
    tone(ctx, out, t + 0.2, { f0: 659.25, gain: 0.14, dur: 0.35 });
    return tone(ctx, out, t + 0.2, { type: 'triangle', f0: 1318.5, gain: 0.03, dur: 0.18 });
  },

  /** Good news: a rising three-note arpeggio. */
  good: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'triangle', f0: 523.25, gain: 0.1, dur: 0.18 });
    tone(ctx, out, t + 0.09, { type: 'triangle', f0: 659.25, gain: 0.1, dur: 0.18 });
    return tone(ctx, out, t + 0.18, { type: 'triangle', f0: 783.99, gain: 0.1, dur: 0.35 });
  },

  /** Earthquake: a deep, swelling rumble with cracks and falling debris. */
  quake: (ctx, out, t, v) => {
    burst(ctx, out, t, {
      colour: 'brown',
      filter: 'lowpass',
      f0: 180,
      f1: 90,
      gain: 0.7,
      attack: 0.5,
      dur: 2.6,
    });
    tone(ctx, out, t, { f0: 42 + v * 6, f1: 30, gain: 0.35, attack: 0.4, dur: 2.4 });
    let end = t + 3;
    for (let k = 0; k < 6; k++)
      end = Math.max(
        end,
        burst(ctx, out, t + 0.4 + k * 0.37 + v * 0.1, { f0: 700 + k * 180, q: 2, gain: 0.12, dur: 0.08 }),
      );
    return end;
  },

  /** A meteor tearing through the air, dropping in pitch. */
  whoosh: (ctx, out, t) =>
    burst(ctx, out, t, { colour: 'pink', f0: 2600, f1: 260, q: 1.4, gain: 0.3, attack: 0.9, dur: 1.6 }),

  /** Impact: a hard crack and a long low boom. */
  boom: (ctx, out, t, v) => {
    burst(ctx, out, t, { f0: 2400, f1: 600, q: 0.7, gain: 0.45, dur: 0.12 });
    burst(ctx, out, t, { colour: 'brown', filter: 'lowpass', f0: 900, f1: 60, gain: 0.8, dur: 2.2 });
    return tone(ctx, out, t, { f0: 70 + v * 10, f1: 28, gain: 0.55, dur: 1.8 });
  },

  /** Thunder (M22): a crack for a near strike, then a long rolling rumble that fades out. */
  thunder: (ctx, out, t, v) => {
    const near = v < 0.35;
    if (near) burst(ctx, out, t, { f0: 1800, f1: 400, q: 0.6, gain: 0.35, dur: 0.18 });
    const start = t + (near ? 0.05 : 0.2 + v * 0.6);
    burst(ctx, out, start, {
      colour: 'brown',
      filter: 'lowpass',
      f0: near ? 700 : 380,
      f1: 70,
      gain: near ? 0.75 : 0.5,
      attack: 0.15 + v * 0.4,
      dur: 2.8 + v * 1.4,
    });
    return tone(ctx, out, start, { f0: 55 + v * 12, f1: 32, gain: 0.3, attack: 0.3, dur: 2.6 });
  },

  /** A milestone: a bright rising fanfare ending on a chord. */
  fanfare: (ctx, out, t) => {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, k) => tone(ctx, out, t + k * 0.12, { type: 'triangle', f0: f, gain: 0.09, dur: 0.22 }));
    let end = t;
    for (const f of [523.25, 659.25, 783.99])
      end = tone(ctx, out, t + 0.5, { type: 'triangle', f0: f, gain: 0.07, attack: 0.02, dur: 1.1 });
    return end;
  },

  /** A distant emergency wail: two rising-and-falling sweeps. */
  siren: (ctx, out, t, v) => {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = 620 + v * 60;
    const f = osc.frequency;
    f.setValueAtTime(base, t);
    for (let k = 0; k < 2; k++) {
      f.linearRampToValueAtTime(base * 1.6, t + k * 1.1 + 0.55);
      f.linearRampToValueAtTime(base, t + k * 1.1 + 1.1);
    }
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.3);
    g.gain.setValueAtTime(0.08, t + 1.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    osc.connect(lp).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 2.25);
    return t + 2.2;
  },
};

export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[];
