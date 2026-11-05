import { describe, expect, it } from 'vitest';
import { Color, DataTexture, PerspectiveCamera, RedFormat, Vector3 } from 'three';
import type { ClientWorld } from '../../src/client/world';
import type { NeighbourSide } from '../../src/data/region';
import { AtomEffects } from '../../src/render/atom';
import { ATOM_FX, TICKS_PER_SECOND, inboundAt, outboundAt, outboundScale } from '../../src/render/atomFx';
import type { Lighting } from '../../src/render/lighting';

/**
 * M40 step 11b review: the atom bomb's effects driven by the summary as the sim changes it, a frame at
 * a time on the display clock (the real `AtomEffects` and a real `CameraController`, with a stand-in
 * world): a landing the sim holds back, a display clock that trails the sim, a dome's stop, both
 * missiles at once, the lift-off's scale, and "Look at the missile" (its framing, what ends it, and
 * the view it gives back).
 */

// The camera listens on the window and its element: stand-ins with nothing to send.
const listen = { addEventListener: () => {}, removeEventListener: () => {} };
(globalThis as unknown as { window: unknown }).window ??= listen;
const { CameraController } = await import('../../src/render/camera');

const GZ = { x: 1024, z: 1024 };
const GROUND = 4;

interface Summary {
  inbound: {
    from: string;
    warn: number;
    side: NeighbourSide | null;
    arrive: number;
    x: number;
    z: number;
    near: number;
    sheltered: number;
    stops: boolean;
    raisable: boolean;
  } | null;
  impact: { x: number; z: number; at: number | null; fled: number; levelled: number; over: boolean } | null;
  stopped: number;
  fired: { tick: number; to: number; name: string; side: NeighbourSide | null } | null;
  launch: { done: number; ready: boolean } | null;
  have: boolean;
}

function harness(opts: { silo?: boolean; heightAt?: (x: number, z: number) => number } = {}) {
  const heightAt = opts.heightAt ?? (() => GROUND);
  const atom: Summary = { inbound: null, impact: null, stopped: 0, fired: null, launch: null, have: false };
  const civics = new Map<number, unknown>();
  if (opts.silo) civics.set(7, { id: 7, def: 'atomsilo', x: 600, y: GROUND, z: 1500, angle: 0, side: 0 });
  const stats = { tick: 0, war: { atom } };
  const world = { civics, heightAt, stats } as unknown as ClientWorld;
  const tex = new DataTexture(new Uint8Array(128 * 128), 128, 128, RedFormat);
  const fx = new AtomEffects(world, { uniforms: { uRad: { value: tex }, uRadOn: { value: 0 } } });
  const camera = new PerspectiveCamera(45, 1.6, 1, 14000);
  const dom = { ...listen, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 1000 }) };
  const controller = new CameraController(camera, dom as unknown as HTMLElement, heightAt);
  const light = {
    sunDir: new Vector3(0.3, 0.9, 0.2).normalize(),
    sunColor: new Color(1, 1, 1),
    light: 1,
    hemi: { color: new Color(0.8, 0.85, 1), intensity: 1 },
  } as unknown as Lighting;
  const blasts: boolean[] = [];
  fx.onBlast = (stopped) => blasts.push(stopped);
  let now = 0;
  /** One frame: the sim at `sim` (the summary as set), the display clock at `tick`. */
  const frame = (tick: number, sim = tick) => {
    stats.tick = sim;
    controller.update(1 / 60);
    camera.updateMatrixWorld();
    fx.update(now, tick, camera, light, controller, 0);
    now += 1 / 60;
    return fx.stats;
  };
  /** Where a point is on the screen (-1 to 1 across and up; z under 1 in front of the camera). */
  const ndc = (p: { x: number; y: number; z: number }) => {
    camera.updateMatrixWorld();
    return new Vector3(p.x, p.y, p.z).project(camera);
  };
  return { atom, fx, controller, camera, frame, ndc, blasts, now: () => now };
}

const inbound = (side: NeighbourSide | null = 'north', arrive = 1440): NonNullable<Summary['inbound']> => ({
  from: 'Calhaven',
  warn: 0,
  side,
  arrive,
  ...GZ,
  near: 0,
  sheltered: 0,
  stops: false,
  raisable: false,
});

const landed = (at: number): NonNullable<Summary['impact']> => ({
  ...GZ,
  at,
  fled: 0,
  levelled: 0,
  over: false,
});

describe('a landing is shown at the sim’s real landing, never at its planned tick', () => {
  it('keeps the missile circling over ground zero while the sim holds the landing back, then flashes once at the real landing', () => {
    const h = harness();
    h.atom.inbound = inbound();
    h.frame(0);
    // A battle in the city holds it back past `arrive` for most of the 12 game hours it may.
    for (let t = 0; t <= 1440 + 600; t += 2) {
      const s = h.frame(t);
      expect(s.inbound).toBe(true);
      expect(s.flash).toBe(0);
      expect(s.puffs).toBe(0);
      expect(s.calls).toBe(0);
    }
    expect(h.blasts).toEqual([]);
    // Past `arrive` it is up in the air over ground zero, not on the ground or gone.
    const p = inboundAt({ ...h.atom.inbound!, side: 'north' }, GROUND, 2000)!;
    expect(p.y - GROUND).toBeGreaterThan(ATOM_FX.hover - 8);
    // The sim lets it fall at 2,100: the summary drops the flight and has the impact at that tick.
    h.atom.inbound = null;
    h.atom.impact = landed(2100);
    const s = h.frame(2100);
    expect(h.blasts).toEqual([false]);
    expect(s.flash).toBeGreaterThan(0.9);
    expect(s.puffs).toBeGreaterThan(0);
    expect(s.inbound).toBe(false);
    // Once, however long it is watched.
    for (let t = 2100; t < 2400; t += 2) h.frame(t);
    expect(h.blasts).toEqual([false]);
  });

  it('never shows the cloud before its flash when the display clock trails the sim, and keeps the missile up till then', () => {
    const h = harness();
    h.atom.inbound = inbound();
    for (let t = 0; t < 1430; t += 10) h.frame(t);
    // The sim has landed it at 1,440 and run on to 1,446; the display clock is at 1,436.
    h.atom.inbound = null;
    h.atom.impact = landed(1440);
    for (const t of [1436, 1437, 1438, 1439]) {
      const s = h.frame(t, 1446);
      expect(s.puffs).toBe(0);
      expect(s.flash).toBe(0);
      expect(s.inbound).toBe(true);
    }
    expect(h.blasts).toEqual([]);
    // The display clock reaches the landing: the flash and the first puffs in the same frame.
    const s = h.frame(1440.5, 1447);
    expect(h.blasts).toEqual([false]);
    expect(s.flash).toBeGreaterThan(0.9);
    expect(s.puffs).toBeGreaterThan(0);
  });

  it('shows an old landing (a page loaded after it, or a clock that jumped far past it) as a cloud, with no flash or sound', () => {
    const loaded = harness();
    loaded.atom.impact = landed(1000);
    const s = loaded.frame(1010);
    expect(s.puffs).toBeGreaterThan(0);
    expect(s.flash).toBe(0);
    expect(loaded.blasts).toEqual([]);

    const jumped = harness();
    jumped.atom.inbound = inbound();
    jumped.frame(1300);
    jumped.atom.inbound = null;
    jumped.atom.impact = landed(1440);
    const j = jumped.frame(1440 + ATOM_FX.flashWindow * TICKS_PER_SECOND + 5);
    expect(j.puffs).toBeGreaterThan(0);
    expect(j.flash).toBe(0);
    expect(jumped.blasts).toEqual([]);
  });

  it('gives a bomb the dome stops its own pale flash and sound, once, and no cloud', () => {
    const h = harness();
    h.atom.inbound = { ...inbound(), stops: true };
    for (let t = 0; t < 1440; t += 8) h.frame(t);
    h.atom.inbound = null;
    h.atom.stopped = 1;
    const s = h.frame(1441, 1441);
    expect(h.blasts).toEqual([true]);
    expect(s.flash).toBeGreaterThan(0);
    expect(s.flash).toBeLessThan(0.5);
    for (let t = 1441; t < 1700; t += 4) expect(h.frame(t).puffs).toBe(0);
    expect(h.blasts).toEqual([true]);
  });
});

describe('two flights, and a sim put back (step 11b review)', () => {
  it('keeps the ending flight drawn and followed when the next bomb is warned in the same moment', () => {
    for (const stop of [false, true]) {
      const h = harness();
      h.atom.inbound = { ...inbound('north'), stops: stop };
      h.frame(1200);
      h.fx.look(h.controller);
      for (let t = 1200; t < 1436; t += 2) h.frame(t);
      // The sim has A's end at 1,440 and B (aimed elsewhere) warned at 1,442; the display clock trails.
      const b = { ...inbound('south', 2882), warn: 1442, x: 700, z: 900 };
      h.atom.inbound = b;
      if (stop) h.atom.stopped = 1;
      else h.atom.impact = landed(1440);
      for (const t of [1436, 1437, 1438, 1439]) {
        const s = h.frame(t, 1444);
        expect(s.inbound, `A still drawn at ${t}`).toBe(true);
        expect(s.following).toBe(true);
      }
      h.frame(1440.5, 1445);
      expect(h.blasts).toEqual([stop]);
      // A's end, at A's ground zero: the camera stands back over it.
      expect(h.controller.goal.x).toBeCloseTo(GZ.x);
      expect(h.controller.goal.z).toBeCloseTo(GZ.z);
      // B is drawn from its own warning on.
      expect(h.frame(1450, 1450).inbound).toBe(true);
    }
  });

  it('shows each end once, even when the sim is put back before it and plays it again (a co-op resync)', () => {
    const h = harness();
    h.atom.inbound = inbound();
    for (let t = 1300; t < 1440; t += 4) h.frame(t);
    h.atom.inbound = null;
    h.atom.impact = landed(1440);
    h.frame(1441);
    // Put back to 1,430 (in the air again), then played on to the same landing.
    h.atom.inbound = inbound();
    h.atom.impact = null;
    for (let t = 1430; t < 1440; t += 1) h.frame(t);
    h.atom.inbound = null;
    h.atom.impact = landed(1440);
    for (let t = 1440; t < 1460; t += 1) h.frame(t);
    expect(h.blasts).toEqual([false]);

    const d = harness();
    d.atom.inbound = { ...inbound(), stops: true };
    for (let t = 1300; t < 1440; t += 4) d.frame(t);
    d.atom.inbound = null;
    d.atom.stopped = 1;
    d.frame(1441);
    d.atom.inbound = { ...inbound(), stops: true };
    d.atom.stopped = 0;
    for (let t = 1430; t < 1440; t += 1) d.frame(t);
    d.atom.inbound = null;
    d.atom.stopped = 1;
    for (let t = 1440; t < 1460; t += 1) d.frame(t);
    expect(d.blasts).toEqual([true]);
  });
});

describe('the city’s own bomb', () => {
  it('is drawn in its silo and as it leaves while an enemy bomb is in the air too', () => {
    const h = harness({ silo: true });
    h.atom.inbound = inbound();
    h.atom.have = true;
    h.atom.launch = { done: 1, ready: true };
    const waiting = h.frame(300);
    expect(waiting.inbound).toBe(true);
    expect(waiting.outbound).toBe(true);
    expect(waiting.hatch).toBe(1);
    h.atom.have = false;
    h.atom.launch = null;
    h.atom.fired = { tick: 320, to: 2, name: 'Gravelford', side: 'south' };
    for (const t of [330, 380, 450]) {
      const s = h.frame(t);
      expect(s.inbound).toBe(true);
      expect(s.outbound).toBe(true);
    }
  });

  it('grows from its own size to the flight’s as it turns away, with no jump between frames', () => {
    const silo = { x: 0, y: 0, z: 0 };
    let prev = 1;
    let most = 0;
    for (let t = 0; t <= ATOM_FX.rise + ATOM_FX.away; t += 0.25) {
      const p = outboundAt(silo, 'south', 0, t)!;
      const s = outboundScale(p);
      most = Math.max(most, Math.abs(s - prev));
      prev = s;
    }
    expect(outboundScale(outboundAt(silo, 'south', 0, 1)!)).toBe(1);
    expect(outboundScale(outboundAt(silo, 'south', 0, ATOM_FX.rise)!)).toBe(1);
    expect(prev).toBeCloseTo(ATOM_FX.scale);
    expect(most).toBeLessThan(0.05);
  });
});

describe('“Look at the missile”', () => {
  const sides: (NeighbourSide | null)[] = ['north', 'south', 'west', null];

  it('has the missile in the middle of the view from every side, at every stage of its flight', () => {
    for (const side of sides)
      for (const k of [0.05, 0.25, 0.5, 0.75]) {
        const h = harness();
        h.atom.inbound = inbound(side);
        const tick = k * 1440;
        h.frame(tick);
        expect(h.fx.look(h.controller)).toBe(true);
        for (let i = 0; i < 240; i++) h.frame(tick);
        const p = inboundAt({ warn: 0, arrive: 1440, ...GZ, side }, GROUND, tick)!;
        const n = h.ndc(p);
        const where = `${side ?? 'east'} at ${k}`;
        expect(Math.abs(n.x), where).toBeLessThan(0.4);
        expect(Math.abs(n.y), where).toBeLessThan(0.4);
        expect(n.z, where).toBeLessThan(1);
        expect(n.z, where).toBeGreaterThan(-1);
        // In front of the camera (the camera is above it, looking down at it).
        expect(h.camera.position.y, where).toBeGreaterThan(p.y);
      }
  });

  it('frames it as well over the hills past the map’s edge, early in its flight, from above and short of it', () => {
    // The sea under the missile, hills of 250 to 550 m wherever the camera's view meets the ground off the map.
    const hills = (x: number, z: number) =>
      x < -100 || z < -100 || x > 2148 || z > 2148
        ? 400 + 150 * Math.sin(x / 310) * Math.cos(z / 270)
        : GROUND;
    for (const side of sides)
      for (const k of [0.03, 0.06, 0.12, 0.25]) {
        const h = harness({ heightAt: hills });
        h.atom.inbound = inbound(side);
        const tick = k * 1440;
        h.frame(tick);
        h.fx.look(h.controller);
        for (let i = 0; i < 300; i++) h.frame(tick);
        const ground = GROUND;
        const p = inboundAt({ warn: 0, arrive: 1440, ...GZ, side }, ground, tick)!;
        const n = h.ndc(p);
        const where = `${side ?? 'east'} at ${k}`;
        expect(Math.abs(n.x), where).toBeLessThan(0.5);
        expect(Math.abs(n.y), where).toBeLessThan(0.5);
        expect(n.z, where).toBeLessThan(1);
        expect(h.camera.position.y, where).toBeGreaterThan(p.y + 50);
        // Not so close that the missile fills the view.
        expect(h.camera.position.distanceTo(new Vector3(p.x, p.y, p.z)), where).toBeGreaterThan(300);
      }
  });

  it('keeps it in the frame as it flies, at 1x and 3x', () => {
    for (const speed of [1, 3])
      for (const side of sides) {
        const h = harness();
        h.atom.inbound = inbound(side);
        let tick = 0.04 * 1440;
        h.frame(tick);
        h.fx.look(h.controller);
        for (let i = 0; i < 120; i++) h.frame(tick);
        for (; tick < 0.8 * 1440; tick += (TICKS_PER_SECOND * speed) / 60) {
          h.frame(tick);
          const n = h.ndc(inboundAt({ warn: 0, arrive: 1440, ...GZ, side }, GROUND, tick)!);
          expect(Math.abs(n.x), `${side} ${speed}x ${tick}`).toBeLessThan(0.9);
          expect(Math.abs(n.y), `${side} ${speed}x ${tick}`).toBeLessThan(0.9);
        }
      }
  });

  it('ends when anything else moves the camera (a fly-to such as “Show where”, a preset, the player), and never takes it back', () => {
    // A command sends the camera somewhere (which stays); the player's own move just takes it over.
    const moves: [(c: InstanceType<typeof CameraController>) => unknown, boolean][] = [
      [(c) => c.setPose({ x: 300, z: 300 }), true],
      [(c) => c.preset('city'), true],
      [(c) => c.userMoves++, false],
    ];
    for (const [move, sent] of moves) {
      const h = harness();
      h.atom.inbound = inbound();
      h.frame(500);
      h.fx.look(h.controller);
      for (let i = 0; i < 30; i++) expect(h.frame(500).following).toBe(true);
      move(h.controller);
      const asked = { x: h.controller.goal.x, z: h.controller.goal.z };
      expect(h.frame(501).following).toBe(false);
      expect(h.controller.roam).toBe(false);
      // Where it was sent stays; the follow never takes the camera back (its limits ease back in).
      for (let i = 0; i < 240; i++) {
        expect(h.frame(502 + i).following).toBe(false);
        if (sent) expect({ x: h.controller.goal.x, z: h.controller.goal.z }).toEqual(asked);
      }
      const g = h.controller.goal;
      expect(g.distance).toBeLessThanOrEqual(3400);
      expect(Math.min(g.x, g.z)).toBeGreaterThanOrEqual(-300 - 1e-6);
    }
  });

  it('gives a fly-to such as “Show where” the player’s own turn and tilt, not the follow’s low sideways look', () => {
    const h = harness();
    h.controller.setPose({ x: 900, z: 1100, distance: 1200, yaw: 0.9, tilt: 0.2 }, true);
    h.atom.inbound = inbound('north');
    h.frame(500);
    h.fx.look(h.controller);
    for (let i = 0; i < 30; i++) h.frame(500);
    // As Game.flyTo builds it: the place, a near distance, and the turn and tilt the camera has.
    const c = h.controller.goal;
    h.controller.setPose({ ...GZ, distance: 320, yaw: c.yaw, tilt: c.tilt });
    h.frame(501);
    const g = h.controller.goal;
    expect(h.fx.stats.following).toBe(false);
    expect([g.x, g.z, g.distance]).toEqual([GZ.x, GZ.z, 320]);
    expect(g.yaw).toBeCloseTo(0.9);
    expect(g.tilt).toBeCloseTo(0.2);
  });

  it('keeps the player’s own view to give back when asked again while it follows', () => {
    const h = harness();
    h.controller.setPose({ x: 900, z: 1100, distance: 1200, yaw: 0.9, tilt: 0.2 }, true);
    h.atom.inbound = inbound('west');
    h.frame(1200);
    h.fx.look(h.controller);
    for (let t = 1200; t < 1300; t += 2) h.frame(t);
    expect(h.fx.look(h.controller)).toBe(true);
    for (let t = 1300; t < 1440; t += 2) h.frame(t);
    h.atom.inbound = null;
    h.atom.impact = landed(1440);
    h.frame(1440);
    expect(h.controller.goal.yaw).toBeCloseTo(0.9);
    expect(h.controller.goal.tilt).toBeCloseTo(0.2);
    expect(h.controller.goal.distance).toBeGreaterThanOrEqual(2400);
  });

  it('lets a drag that ends it carry on smoothly, the camera easing back to the map without a jump; a wheel turn out never zooms in', () => {
    for (const side of sides) {
      const h = harness();
      h.atom.inbound = inbound(side);
      h.frame(500);
      h.fx.look(h.controller);
      for (let i = 0; i < 240; i++) h.frame(500);
      const cam = h.controller as unknown as {
        onPointerMove(e: { clientX: number; clientY: number }): void;
        onPointerUp(): void;
      };
      // The player grabs the map in the middle of the view and drags it 400 px to the right.
      h.controller.beginDrag('pan', 800, 500, 1);
      const before = h.camera.position.clone();
      let prev = before.clone();
      let most = 0;
      for (let i = 1; i <= 40; i++) {
        cam.onPointerMove({ clientX: 800 + i * 10, clientY: 500 });
        h.frame(500);
        most = Math.max(most, h.camera.position.distanceTo(prev));
        prev = h.camera.position.clone();
      }
      cam.onPointerUp();
      expect(h.fx.stats.following, `${side}`).toBe(false);
      // No jump from one frame to the next, and the drag moved the view.
      expect(most, `${side}`).toBeLessThan(250);
      expect(h.camera.position.distanceTo(before), `${side}`).toBeGreaterThan(50);
      // Back within the map's limits in a few seconds, smoothly.
      for (let i = 0; i < 360; i++) {
        h.frame(500);
        most = Math.max(most, h.camera.position.distanceTo(prev));
        prev = h.camera.position.clone();
      }
      const g = h.controller.goal;
      expect(Math.min(g.x, g.z), `${side}`).toBeGreaterThanOrEqual(-300 - 1);
      expect(Math.max(g.x, g.z), `${side}`).toBeLessThanOrEqual(2348 + 1);
      expect(g.distance).toBeLessThanOrEqual(3400 + 1);
      expect(most, `${side}`).toBeLessThan(250);
    }
    // A wheel turn out as the follow ends: the camera doesn't come in.
    const h = harness();
    h.atom.inbound = inbound('north');
    h.frame(700);
    h.fx.look(h.controller);
    for (let i = 0; i < 240; i++) h.frame(700);
    const d0 = h.controller.goal.distance;
    expect(d0).toBeGreaterThan(3400);
    h.controller.userMoves++;
    h.frame(700);
    h.controller.zoomBy(1.15);
    expect(h.controller.goal.distance).toBeGreaterThanOrEqual(d0 - 1);
  });

  it('stands back over ground zero after the blast, turned as the player had it', () => {
    const h = harness();
    h.controller.setPose({ x: 900, z: 1100, distance: 1200, yaw: 0.9, tilt: 0.2 }, true);
    h.atom.inbound = inbound('west');
    h.frame(1200);
    h.fx.look(h.controller);
    for (let t = 1200; t < 1440; t += 2) h.frame(t);
    h.atom.inbound = null;
    h.atom.impact = landed(1440);
    h.frame(1440);
    const g = h.controller.goal;
    expect(g.yaw).toBeCloseTo(0.9);
    expect(g.tilt).toBeCloseTo(0.2);
    expect(g.x).toBeCloseTo(GZ.x);
    expect(g.z).toBeCloseTo(GZ.z);
    expect(g.distance).toBeGreaterThanOrEqual(2400);
    expect(h.fx.stats.following).toBe(false);
    expect(h.controller.roam).toBe(false);
  });

  it('gives the player’s own view back when the city’s own bomb it followed has gone', () => {
    const h = harness({ silo: true });
    const own = { x: 700, z: 1400, distance: 800, yaw: -0.4, tilt: 0.1 };
    h.controller.setPose(own, true);
    h.atom.fired = { tick: 100, to: 2, name: 'Gravelford', side: 'south' };
    h.frame(110);
    expect(h.fx.look(h.controller)).toBe(true);
    for (let t = 110; t <= 100 + ATOM_FX.rise + ATOM_FX.away + 4; t += 1) h.frame(t);
    expect(h.fx.stats.following).toBe(false);
    for (const [k, v] of Object.entries(own)) expect(h.controller.goal[k as keyof typeof own]).toBeCloseTo(v);
  });
});
