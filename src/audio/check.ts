import { AmbientBed } from './ambient';
import { SOUND_NAMES, SOUNDS } from './sounds';

export interface SoundCheck {
  name: string;
  peak: number;
  rms: number;
  finite: boolean;
  seconds: number;
}

function measure(name: string, buf: AudioBuffer): SoundCheck {
  const d = buf.getChannelData(0);
  let peak = 0;
  let sum = 0;
  let finite = true;
  for (let i = 0; i < d.length; i++) {
    const v = d[i]!;
    if (!Number.isFinite(v)) finite = false;
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  return { name, peak, rms: Math.sqrt(sum / d.length), finite, seconds: buf.duration };
}

/**
 * Render every effect, and the ambient bed at full mix, offline and measure them: tests check each
 * one makes a sound, doesn't clip and produces no NaNs.
 */
export async function renderSounds(): Promise<SoundCheck[]> {
  const rate = 22050;
  const out: SoundCheck[] = [];
  for (const name of SOUND_NAMES) {
    const ctx = new OfflineAudioContext(1, rate * 2.5, rate);
    const end = SOUNDS[name](ctx, ctx.destination, 0.01, 0.5);
    const check = measure(name, await ctx.startRendering());
    out.push({ ...check, seconds: end });
  }
  const ctx = new OfflineAudioContext(1, rate * 2, rate);
  let k = 0;
  const bed = new AmbientBed(ctx, ctx.destination, () => (k = (k * 9301 + 49297) % 233280) / 233280);
  bed.setMix({
    traffic: 1,
    wind: 1,
    birds: 1,
    crickets: 1,
    construction: 1,
    sirens: 1,
    fire: 1,
    storm: 1,
    water: 1,
    rain: 1,
  });
  bed.tick();
  out.push(measure('ambient', await ctx.startRendering()));
  return out;
}
