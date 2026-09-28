import type { AmbientMix } from './mix';
import { burst, noise, tone } from './synth';

const LOOKAHEAD = 0.35;

/** A looping noise layer through a filter, with a gain we can ride. */
class NoiseLayer {
  readonly gain: GainNode;
  readonly filter: BiquadFilterNode;
  constructor(
    ctx: BaseAudioContext,
    out: AudioNode,
    colour: 'white' | 'pink' | 'brown',
    type: BiquadFilterType,
    freq: number,
    q: number,
  ) {
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx, colour);
    src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = type;
    this.filter.frequency.value = freq;
    this.filter.Q.value = q;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    src.connect(this.filter).connect(this.gain).connect(out);
    src.start();
  }
}

/**
 * The ambient bed: continuous traffic, wind and fire layers, plus scheduled events (bird song,
 * crickets, hammering, sirens, crackles) whose rate follows the mix. Positional detail is not
 * needed at city scale; the mix already follows what's on screen.
 */
export class AmbientBed {
  private traffic: NoiseLayer;
  private hiss: NoiseLayer;
  private wind: NoiseLayer;
  private roar: NoiseLayer;
  private storm: NoiseLayer;
  private water: NoiseLayer;
  private rain: NoiseLayer;
  private patter: NoiseLayer;
  private mix: AmbientMix = {
    traffic: 0,
    wind: 0,
    birds: 0,
    crickets: 0,
    construction: 0,
    sirens: 0,
    fire: 0,
    storm: 0,
    water: 0,
    rain: 0,
  };
  /** Next time (ctx seconds) each kind of event may start. */
  private next = { birds: 0, crickets: 0, construction: 0, sirens: 0, fire: 0 };
  /** Scheduled events so far, by kind (tests and the debug panel read this). */
  readonly events = { birds: 0, crickets: 0, construction: 0, sirens: 0, fire: 0 };
  private windPhase = 0;

  constructor(
    private ctx: BaseAudioContext,
    private out: AudioNode,
    private rand: () => number = Math.random,
  ) {
    this.traffic = new NoiseLayer(ctx, out, 'brown', 'lowpass', 420, 0.6);
    this.hiss = new NoiseLayer(ctx, out, 'pink', 'bandpass', 1300, 0.7);
    this.wind = new NoiseLayer(ctx, out, 'pink', 'bandpass', 420, 0.8);
    this.roar = new NoiseLayer(ctx, out, 'brown', 'lowpass', 260, 0.7);
    this.storm = new NoiseLayer(ctx, out, 'pink', 'bandpass', 320, 1.6);
    this.water = new NoiseLayer(ctx, out, 'white', 'lowpass', 900, 0.5);
    // Rain (M22): a bright hiss of drops over a softer patter on roofs and leaves.
    this.rain = new NoiseLayer(ctx, out, 'white', 'bandpass', 3200, 0.45);
    this.patter = new NoiseLayer(ctx, out, 'pink', 'bandpass', 900, 0.9);
  }

  get levels(): AmbientMix {
    return this.mix;
  }

  /** Set the target mix; layers glide there over about a second. */
  setMix(m: AmbientMix): void {
    this.mix = m;
    const t = this.ctx.currentTime;
    const ride = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.6);
    ride(this.traffic.gain.gain, m.traffic * 0.5);
    ride(this.hiss.gain.gain, m.traffic * 0.12);
    ride(this.wind.gain.gain, m.wind * 0.22);
    ride(this.roar.gain.gain, m.fire * 0.5);
    ride(this.storm.gain.gain, m.storm * 0.9);
    ride(this.water.gain.gain, m.water * 0.18);
    ride(this.rain.gain.gain, m.rain * 0.16);
    ride(this.patter.gain.gain, m.rain * 0.12);
  }

  /** Schedule upcoming events; call a few times a second. */
  tick(): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const until = now + LOOKAHEAD;
    const r = this.rand;
    const m = this.mix;
    // Wind and traffic wander a little.
    this.windPhase += 0.25;
    this.wind.filter.frequency.setTargetAtTime(
      380 + 160 * Math.sin(this.windPhase * 0.37) + 60 * r(),
      now,
      0.8,
    );
    this.traffic.filter.frequency.setTargetAtTime(360 + 120 * r(), now, 0.5);
    // A tornado howls: its band sweeps up and down.
    if (m.storm > 0.01)
      this.storm.filter.frequency.setTargetAtTime(
        260 + 260 * (0.5 + 0.5 * Math.sin(this.windPhase * 1.7)) + 80 * r(),
        now,
        0.3,
      );

    // Bird song: short trills of rising chirps.
    if (m.birds > 0.03 && this.next.birds < until) {
      const t = Math.max(now, this.next.birds);
      const base = 2400 + r() * 1800;
      const notes = 2 + Math.floor(r() * 4);
      for (let k = 0; k < notes; k++)
        tone(ctx, this.out, t + k * (0.09 + r() * 0.04), {
          f0: base * (1 + r() * 0.1),
          f1: base * (1.35 + r() * 0.3),
          gain: 0.035 * m.birds,
          attack: 0.01,
          dur: 0.06 + r() * 0.04,
        });
      this.events.birds++;
      this.next.birds = t + (0.6 + r() * 2.4) / (0.3 + m.birds);
    }

    // Crickets: bursts of three or four fast pulses.
    if (m.crickets > 0.03 && this.next.crickets < until) {
      const t = Math.max(now, this.next.crickets);
      const f = 4200 + r() * 500;
      const pulses = 3 + Math.floor(r() * 2);
      for (let k = 0; k < pulses; k++)
        tone(ctx, this.out, t + k * 0.045, { f0: f, gain: 0.02 * m.crickets, attack: 0.004, dur: 0.025 });
      this.events.crickets++;
      this.next.crickets = t + (0.25 + r() * 0.5) / (0.3 + m.crickets);
    }

    // Building work: hammer knocks in twos and threes, now and then a drill.
    if (m.construction > 0.03 && this.next.construction < until) {
      const t = Math.max(now, this.next.construction);
      if (r() < 0.15) {
        const d = ctx.createOscillator();
        d.type = 'sawtooth';
        d.frequency.setValueAtTime(160 + r() * 40, t);
        d.frequency.linearRampToValueAtTime(210 + r() * 40, t + 0.5);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.03 * m.construction, t + 0.05);
        g.gain.setValueAtTime(0.03 * m.construction, t + 0.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1200;
        d.connect(lp).connect(g).connect(this.out);
        d.start(t);
        d.stop(t + 0.7);
      } else {
        const hits = 2 + Math.floor(r() * 3);
        for (let k = 0; k < hits; k++) {
          const at = t + k * (0.3 + r() * 0.08);
          burst(ctx, this.out, at, { f0: 1400 + r() * 500, q: 3, gain: 0.09 * m.construction, dur: 0.035 });
          tone(ctx, this.out, at, { f0: 320 + r() * 60, f1: 180, gain: 0.07 * m.construction, dur: 0.05 });
        }
      }
      this.events.construction++;
      this.next.construction = t + (1.2 + r() * 2) / (0.4 + m.construction);
    }

    // Sirens: a wail every few seconds while emergency vehicles are out nearby.
    if (m.sirens > 0.03 && this.next.sirens < until) {
      const t = Math.max(now, this.next.sirens);
      const g = ctx.createGain();
      g.gain.value = 0.5 + 0.5 * m.sirens;
      g.connect(this.out);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const base = 600 + r() * 80;
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.linearRampToValueAtTime(base * 1.55, t + 0.6);
      osc.frequency.linearRampToValueAtTime(base, t + 1.2);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      const e = ctx.createGain();
      e.gain.setValueAtTime(0.0001, t);
      e.gain.exponentialRampToValueAtTime(0.035, t + 0.2);
      e.gain.setValueAtTime(0.035, t + 1.0);
      e.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      osc.connect(lp).connect(e).connect(g);
      osc.start(t);
      osc.stop(t + 1.25);
      this.events.sirens++;
      this.next.sirens = t + 1.25 + r() * 0.3;
    }

    // Fire: crackles over the roar.
    if (m.fire > 0.03 && this.next.fire < until) {
      const t = Math.max(now, this.next.fire);
      const pops = 2 + Math.floor(r() * 4);
      for (let k = 0; k < pops; k++)
        burst(ctx, this.out, t + r() * 0.25, { f0: 1800 + r() * 2500, q: 2, gain: 0.08 * m.fire, dur: 0.02 });
      this.events.fire++;
      this.next.fire = t + 0.15 + r() * 0.3;
    }
  }
}
