import { describe, expect, it } from 'vitest';
import { Color, DataTexture, PerspectiveCamera, RedFormat, Vector3 } from 'three';
import type { ClientWorld } from '../../src/client/world';
import { QUALITY_PARAMS, QUALITIES } from '../../src/client/settings';
import { AtomEffects, type AtomStage } from '../../src/render/atom';
import {
  ATOM_FX,
  HOVER_K,
  MAX_PUFFS,
  TICKS_PER_SECOND,
  atomBeats,
  atomCaps,
  blastSounds,
  cloudAt,
  cloudPuffs,
  flashAt,
  hatchOpen,
  inboundAt,
  outboundAt,
  placePuff,
  shakeAt,
} from '../../src/render/atomFx';
import type { CameraController } from '../../src/render/camera';
import type { Lighting } from '../../src/render/lighting';
import { SOUND_NAMES } from '../../src/audio/sounds';

/** M40 step 11b: the atom bomb's effects, the pure maths and the renderer's budget. */

const flight = { warn: 1000, arrive: 2440, x: 900, z: 1000, side: 'north' as const };

describe('the missile', () => {
  it('comes in from the sender’s side, arcs up and dives onto ground zero', () => {
    const start = inboundAt(flight, 5, flight.warn)!;
    expect(start.z).toBeLessThan(flight.z - 5000);
    expect(start.x).toBeCloseTo(flight.x);
    expect(start.y).toBeCloseTo(5);
    expect(start.dy).toBeGreaterThan(0);
    const mid = inboundAt(flight, 5, (flight.warn + flight.arrive) / 2)!;
    expect(mid.y).toBeCloseTo(5 + ATOM_FX.apex);
    // The dive ends just over ground zero (it bursts in the air there), steeply down.
    const late = inboundAt(flight, 5, flight.warn + HOVER_K * (flight.arrive - flight.warn) - 0.5)!;
    expect(Math.hypot(late.x - flight.x, late.z - flight.z)).toBeLessThan(60);
    expect(late.y - 5).toBeCloseTo(ATOM_FX.hover, -1);
    expect(late.dy).toBeLessThan(-0.5);
    for (const p of [start, mid, late]) expect(Math.hypot(p.dx, p.dy, p.dz)).toBeCloseTo(1);
    // Each side brings it from its own edge; none before the warning's tick is wrong, none from the landing on.
    expect(inboundAt({ ...flight, side: 'south' }, 0, flight.warn)!.z).toBeGreaterThan(flight.z + 5000);
    expect(inboundAt({ ...flight, side: 'west' }, 0, flight.warn)!.x).toBeLessThan(flight.x - 5000);
    expect(inboundAt(flight, 0, flight.warn - 1)).toBeNull();
    expect(inboundAt({ ...flight, arrive: flight.warn }, 0, flight.warn)).toBeNull();
  });

  it('ends its dive just over ground zero and circles there, never below it, until its landing is shown (step 11b review)', () => {
    // The sim may hold a landing back (a battle in the city, a blast not over) for up to 12 game hours.
    let prev = inboundAt(flight, 5, flight.arrive - 30)!;
    for (let t = flight.arrive - 30; t <= flight.arrive + 12 * 60; t += 0.5) {
      const p = inboundAt(flight, 5, t)!;
      expect(p).not.toBeNull();
      expect(p.y).toBeGreaterThan(5 + ATOM_FX.hover - 8);
      expect(Math.hypot(p.x - flight.x, p.z - flight.z)).toBeLessThan(120);
      // No jump from one half tick to the next.
      expect(Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z)).toBeLessThan(20);
      expect(Math.hypot(p.dx, p.dy, p.dz)).toBeCloseTo(1);
      prev = p;
    }
  });

  it('flies on the display clock: the same tick, the same place', () => {
    const a = inboundAt(flight, 0, 1700.25)!;
    const b = inboundAt(flight, 0, 1700.25)!;
    expect(a).toEqual(b);
    expect(inboundAt(flight, 0, 1700.5)!.k).toBeGreaterThan(a.k);
  });

  it('leaves the city’s own silo straight up, then turns away towards the target and is gone', () => {
    const silo = { x: 300, y: 10, z: 400 };
    const up = outboundAt(silo, 'south', 50, 50 + ATOM_FX.rise / 2)!;
    expect(up.x).toBe(300);
    expect(up.z).toBe(400);
    expect(up.y).toBeGreaterThan(10);
    expect(up.dy).toBe(1);
    const away = outboundAt(silo, 'south', 50, 50 + ATOM_FX.rise + ATOM_FX.away * 0.8)!;
    expect(away.z).toBeGreaterThan(400 + 1000);
    expect(away.y).toBeGreaterThan(up.y);
    expect(outboundAt(silo, 'south', 50, 49)).toBeNull();
    expect(outboundAt(silo, 'south', 50, 50 + ATOM_FX.rise + ATOM_FX.away + 1)).toBeNull();
  });

  it('opens the silo’s hatch at the end of the preparation, keeps it open while it waits, and shuts it after the bomb has gone', () => {
    expect(hatchOpen(null, null, 0)).toBe(0);
    expect(hatchOpen({ done: 0.5, ready: false }, null, 0)).toBe(0);
    expect(hatchOpen({ done: 0.93, ready: false }, null, 0)).toBeGreaterThan(0.2);
    expect(hatchOpen({ done: 1, ready: true }, null, 0)).toBe(1);
    expect(hatchOpen(null, 100, 120)).toBe(1);
    expect(hatchOpen(null, 100, 100 + ATOM_FX.hatchShut + 61)).toBe(0);
  });
});

describe('the mushroom cloud', () => {
  it('has the quality’s puffs, split into stem, cap and ring, the same every time', () => {
    for (const n of [500, 300, 120]) {
      const p = cloudPuffs(n);
      expect(p).toHaveLength(n);
      for (const part of [0, 1, 2]) expect(p.some((x) => x.part === part)).toBe(true);
      expect(p.filter((x) => x.part === 1).length).toBeGreaterThan(p.filter((x) => x.part === 0).length);
    }
    expect(cloudPuffs(500)).toEqual(cloudPuffs(500));
    expect(cloudPuffs(5000)).toHaveLength(MAX_PUFFS);
    // Fewer puffs are bigger, so a Low cloud is as full.
    const size = (n: number) => cloudPuffs(n).reduce((a, x) => a + x.size, 0) / n;
    expect(size(120)).toBeGreaterThan(size(500) * 1.6);
  });

  it('rises and spreads for its first seconds, then drifts, loses its stem and fades over game hours', () => {
    const at = (s: number) => cloudAt(s, s / 7.5)!;
    expect(at(1).height).toBeLessThan(at(10).height);
    expect(at(10).height).toBeLessThan(at(ATOM_FX.riseSeconds).height);
    expect(at(ATOM_FX.riseSeconds).height).toBeCloseTo(ATOM_FX.height);
    expect(at(1).cool).toBeLessThan(0.1);
    expect(at(ATOM_FX.riseSeconds).cool).toBe(1);
    expect(at(ATOM_FX.riseSeconds).drift).toBe(0);
    const later = cloudAt(200, 8)!;
    expect(later.drift).toBeGreaterThan(0);
    expect(later.stem).toBeLessThan(0.5);
    expect(later.capShow).toBeGreaterThan(0.5);
    expect(cloudAt(1000, ATOM_FX.capFade[1] + 0.01)).toBeNull();
    expect(cloudAt(-1, 0)).toBeNull();
  });

  it('puts the stem under the cap and the ring around the stem', () => {
    const s = cloudAt(ATOM_FX.riseSeconds * 0.6, 0.5)!;
    const puffs = cloudPuffs(500);
    const out = { x: 0, y: 0, z: 0, size: 0, show: 0, heat: 0 };
    let stemTop = 0;
    let capLow = Infinity;
    for (const p of puffs) {
      const o = placePuff(p, s, 0, out);
      if (p.part === 0) stemTop = Math.max(stemTop, o.y);
      if (p.part === 1) capLow = Math.min(capLow, o.y);
      if (p.part === 2) expect(Math.hypot(o.x, o.z)).toBeGreaterThan(s.cap * 0.6);
    }
    expect(stemTop).toBeLessThan(s.height);
    expect(capLow).toBeGreaterThan(s.height * 0.5);
  });
});

describe('the flash, the shake and the sounds', () => {
  it('is a short white bloom, or a soft fade with no shake when flashes are softened', () => {
    expect(flashAt(0.1, false)).toBe(1);
    expect(flashAt(ATOM_FX.flash * 3, false)).toBe(0);
    let most = 0;
    for (let t = 0; t < 2; t += 0.01) most = Math.max(most, flashAt(t, true));
    expect(most).toBeLessThan(0.5);
    expect(flashAt(0.4, true)).toBeGreaterThan(0);
    expect(flashAt(ATOM_FX.softFlash, true)).toBe(0);
    // A soft flash never jumps: no step of a hundredth of a second rises by more than a tenth.
    for (let t = 0; t < 1; t += 0.01) expect(flashAt(t + 0.01, true) - flashAt(t, true)).toBeLessThan(0.1);
    expect(shakeAt(0.2, false)).toBeGreaterThan(0);
    expect(shakeAt(0.2, true)).toBe(0);
    expect(shakeAt(ATOM_FX.shakeSeconds, false)).toBe(0);
  });

  /** A flight played a frame at a time at a speed, as the page does: the sirens' times (real s) and the ticks. */
  function play(speed: number) {
    const f = { warn: 0, arrive: 1440 };
    const sirens: number[] = [];
    let ticks = 0;
    let last = 0;
    let real = 0;
    const step = (TICKS_PER_SECOND * speed) / 60;
    for (let t = 0; t < 1440; t += step) {
      real += 1 / 60;
      const b = atomBeats(f, t, t + step, real - last);
      if (b.siren) {
        sirens.push(real);
        last = real;
      }
      ticks += b.ticks;
    }
    return { sirens, ticks, real };
  }

  it('sounds the siren every six seconds and ticks through the last ten seconds of play', () => {
    const one = play(1);
    expect(one.sirens).toHaveLength(Math.floor(1440 / TICKS_PER_SECOND / ATOM_FX.sirenEvery) - 1);
    expect(one.ticks).toBe(ATOM_FX.tickFrom);
    const f = { warn: 0, arrive: 1440 };
    // Paused, nothing; not at the planned landing itself; not before six seconds since the last.
    expect(atomBeats(f, 700, 700, 100)).toEqual({ siren: false, ticks: 0 });
    expect(atomBeats(f, 1439, 1441, 100)).toEqual({ siren: false, ticks: 0 });
    // Past it with the flight still there (the sim holding the landing back, the missile circling
    // overhead), the siren goes on, without ticks (step 11b review).
    expect(atomBeats(f, 1540, 1541, 7)).toEqual({ siren: true, ticks: 0 });
    expect(atomBeats(f, 1540, 1541, 5)).toEqual({ siren: false, ticks: 0 });
    expect(atomBeats(f, 700, 701, 5.9).siren).toBe(false);
    expect(atomBeats(f, 700, 701, 6).siren).toBe(true);
    // A jump (a load) plays one of each at most.
    expect(atomBeats(f, 0, 1439, 100).ticks).toBeLessThanOrEqual(1);
  });

  it('never lets a siren overlap the last at 2x or 3x: they are spaced in real time (step 11b review)', () => {
    for (const speed of [2, 3]) {
      const r = play(speed);
      expect(r.sirens.length).toBeGreaterThan(0);
      for (let i = 1; i < r.sirens.length; i++)
        expect(r.sirens[i]! - r.sirens[i - 1]!).toBeGreaterThanOrEqual(
          Math.max(ATOM_FX.sirenEvery, ATOM_FX.sirenLength) - 1e-9,
        );
      // At 3x the flight is a minute of real time: one siren every six seconds of it.
      expect(r.sirens.length).toBeLessThanOrEqual(Math.ceil(r.real / ATOM_FX.sirenEvery));
      expect(r.ticks).toBe(ATOM_FX.tickFrom);
    }
  });

  it('plays a landing’s blast then its wind, once each, and the dome’s own sound for a stop (step 11b review)', () => {
    expect(blastSounds(false)).toEqual([
      { name: 'atomBlast', delay: 0 },
      { name: 'atomWind', delay: 2200 },
    ]);
    expect(blastSounds(true)).toEqual([{ name: 'atomStopped', delay: 0 }]);
    for (const s of [...blastSounds(false), ...blastSounds(true)]) expect(SOUND_NAMES).toContain(s.name);
  });
});

describe('the quality’s switches and the cloud’s budget', () => {
  it('has a cloud of 500 puffs at High and 120 at Low, and the fallout’s tint off at Low', () => {
    expect(QUALITY_PARAMS.high.units.atomPuffs).toBe(500);
    expect(QUALITY_PARAMS.low.units.atomPuffs).toBe(120);
    expect(QUALITY_PARAMS.low.units.atomTint).toBe(0);
    expect(QUALITY_PARAMS.high.units.atomTint).toBe(1);
    for (const q of QUALITIES) {
      const c = atomCaps(QUALITY_PARAMS[q].units);
      expect(c).toEqual({
        atomPuffs: QUALITY_PARAMS[q].units.atomPuffs,
        atomTrail: QUALITY_PARAMS[q].units.atomTrail,
        atomTint: QUALITY_PARAMS[q].units.atomTint,
      });
    }
    expect(atomCaps({ atomPuffs: 10_000, atomTrail: -3, atomTint: 1 }).atomPuffs).toBe(MAX_PUFFS);
    expect(atomCaps({ atomPuffs: 10_000, atomTrail: -3, atomTint: 1 }).atomTrail).toBe(0);
  });

  function effects(quality: keyof typeof QUALITY_PARAMS) {
    const world = {
      civics: new Map(),
      heightAt: () => 4,
      stats: { war: null },
    } as unknown as ClientWorld;
    const tex = new DataTexture(new Uint8Array(128 * 128), 128, 128, RedFormat);
    const fx = new AtomEffects(world, { uniforms: { uRad: { value: tex }, uRadOn: { value: 0 } } });
    fx.quality = QUALITY_PARAMS[quality].units;
    const camera = new PerspectiveCamera();
    camera.updateMatrixWorld();
    const light = {
      sunDir: new Vector3(0, 1, 0),
      sunColor: new Color(1, 1, 1),
      light: 1,
      hemi: { color: new Color(0.8, 0.85, 1), intensity: 1 },
    } as unknown as Lighting;
    const controller = {
      userMoves: 0,
      setPose: () => {},
      pitchFor: () => 0.6,
    } as unknown as CameraController;
    const draw = (stage: AtomStage | null, now = 1) => {
      fx.stage = stage;
      fx.update(now, 0, camera, light, controller, 0);
      return fx.stats;
    };
    return { fx, draw };
  }

  it('keeps the cloud to six draw calls and 4,000 triangles at every quality and every moment', () => {
    for (const q of QUALITIES) {
      const { draw } = effects(q);
      let most = { calls: 0, triangles: 0 };
      for (const stage of [
        { flash: 0.05, ring: 0.5, cloud: { seconds: 0.5 } },
        { ring: 2, cloud: { seconds: 3 } },
        { cloud: { seconds: 12 } },
        { cloud: { seconds: 30 } },
        { cloud: { seconds: 200, hours: 10 } },
      ]) {
        const s = draw(stage);
        expect(s.calls).toBeLessThanOrEqual(ATOM_FX.maxCalls);
        expect(s.triangles).toBeLessThanOrEqual(ATOM_FX.maxTriangles);
        most = { calls: Math.max(most.calls, s.calls), triangles: Math.max(most.triangles, s.triangles) };
      }
      expect(most.calls).toBeGreaterThan(0);
      expect(draw({ cloud: { seconds: 12 } }).puffs).toBe(QUALITY_PARAMS[q].units.atomPuffs);
    }
  });

  it('draws nothing in a city with no bomb, and lights the flash and shakes only when staged so', () => {
    const { fx, draw } = effects('high');
    expect(draw(null)).toMatchObject({ calls: 0, triangles: 0, puffs: 0, missile: false, flash: 0 });
    draw({ flash: 0.05 });
    expect(fx.flash).toBe(1);
    expect(fx.shake.length()).toBeGreaterThan(0);
    draw({ flash: 0.05, soft: true });
    expect(fx.flash).toBeLessThan(0.5);
    expect(fx.shake.length()).toBe(0);
    const m = draw({ missile: 0.5, side: 'west' });
    expect(m.missile).toBe(true);
    expect(fx.canLook).toBe(true);
    draw(null);
    expect(fx.canLook).toBe(false);
  });
});
