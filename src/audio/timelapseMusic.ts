/**
 * The timelapse's music (M45): a light, hopeful loop made from the game's own synthesiser (the same
 * `tone` the sound effects use), rendered offline to a video's length. Four chords (C, G, Am, F) at
 * 100 beats a minute: a soft pad, a walking bass and a music-box tune on top, fading in and out.
 */
import { tone } from './synth';

const BPM = 100;
const BEAT = 60 / BPM;
/** C major, G major, A minor, F major (Hz), a bar each. */
const CHORDS = [
  [261.63, 329.63, 392.0],
  [196.0, 246.94, 293.66],
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
];
/** The tune over each chord: steps of the chord (0–2) or a passing note, an eighth each (null: rest). */
const TUNE: (number | null)[][] = [
  [2, null, 1, 2, 0, null, 1, null],
  [2, 1, null, 0, 1, null, 2, null],
  [0, null, 1, 2, 2, 1, 0, null],
  [1, null, 2, null, 1, 0, null, 0],
];

/** The loop for `seconds`, as a stereo buffer at `sampleRate`. */
export async function renderTimelapseMusic(seconds: number, sampleRate = 48_000): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  // Loud enough for a phone's speaker (peaks about −5 dB), a compressor keeping it from clipping.
  const squash = ctx.createDynamicsCompressor();
  squash.threshold.value = -10;
  squash.ratio.value = 4;
  squash.connect(ctx.destination);
  const master = ctx.createGain();
  master.connect(squash);
  const level = 5;
  // Fade in over a second, out over the last two.
  master.gain.setValueAtTime(0.0001, 0);
  master.gain.exponentialRampToValueAtTime(level, 1);
  master.gain.setValueAtTime(level, Math.max(1, seconds - 2));
  master.gain.exponentialRampToValueAtTime(0.0001, seconds);
  // The tune a little to one side, the bass to the other.
  const left = ctx.createStereoPanner();
  left.pan.value = -0.25;
  left.connect(master);
  const right = ctx.createStereoPanner();
  right.pan.value = 0.3;
  right.connect(master);
  const bar = BEAT * 4;
  for (let b = 0; b * bar < seconds; b++) {
    const t = b * bar;
    const chord = CHORDS[b % CHORDS.length]!;
    // The pad: the chord held for the bar.
    for (const f of chord)
      tone(ctx, master, t, { type: 'triangle', f0: f, gain: 0.035, attack: 0.3, dur: bar - 0.35, lp: 1400 });
    // The bass: the root, then the fifth, on the beats.
    for (let k = 0; k < 4; k++)
      tone(ctx, left, t + k * BEAT, {
        f0: (k % 2 ? chord[2]! : chord[0]!) / 2,
        gain: 0.09,
        dur: BEAT * 0.8,
        lp: 600,
      });
    // The music box: eighths an octave up.
    TUNE[b % TUNE.length]!.forEach((step, k) => {
      if (step === null) return;
      tone(ctx, right, t + (k * BEAT) / 2, {
        type: 'sine',
        f0: chord[step]! * 2,
        gain: 0.05,
        dur: BEAT * 0.45,
      });
    });
  }
  return ctx.startRendering();
}
