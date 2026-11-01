import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GRID_CELL, GRID_RES } from '../../src/data/world';
import { OverlayController } from '../../src/client/overlay';
import type { Game } from '../../src/game';
import type { Command } from '../../src/sim/commands';
import type { Sim } from '../../src/sim/sim';
import { falloutOf, falloutRefusal } from '../../src/sim/systems/fallout';
import { ZoneTool } from '../../src/tools/zoneTool';
import type { ToolPointer } from '../../src/tools/tool';
import { buildTown, connectPoint, newSim, serveTown } from '../helpers';
import { ok } from './researchTown';

/**
 * M40 step 4 review: the two places a player meets fallout through a tool, tried with a stand-in for
 * the game (the sim is the real one). The zone tool must say why a brush over closed ground painted
 * nothing; the radiation map's tooltip must be readable by a finger, which cannot hover.
 */

const R = GRID_RES;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('M40: the zone tool says why closed ground stays unpainted', () => {
  let sim: Sim;
  let c: { x: number; z: number };
  let cut: number;
  let street: number;

  beforeAll(() => {
    sim = newSim({ seed: 'citybloom', rivals: true, disasters: false });
    sim.testMode = true;
    const town = buildTown(sim, { length: 800, streets: 7, zone: false });
    serveTown(sim);
    ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
    c = connectPoint(sim);
    cut = c.x + 450;
    const f = falloutOf(sim);
    for (let j = 0; j < R; j++)
      for (let i = Math.floor(cut / GRID_CELL); i < R; i++) f.ground[j * R + i] = 0.5;
    // A street entirely on closed ground.
    street = town.streets.find((id) => sim.net.curve(id).pointAt(0).x > cut + 80)!;
    expect(street).toBeDefined();
  }, 120_000);

  /** A stand-in for the game: the real sim answers, toasts and sounds are kept. */
  function stand() {
    const toasts: { text: string; tone: string }[] = [];
    const sounds: string[] = [];
    const game = {
      renderer: { zones: { setGridVisible() {} }, ghost: { showBrush() {} } },
      dispatch: (cmd: Command) => Promise.resolve(sim.dispatch(cmd)),
      toast: (text: string, tone: string) => toasts.push({ text, tone }),
      audio: { play: (name: string) => sounds.push(name) },
      setHint() {},
      notify() {},
      world: {
        net: { nearestSegment: (p: { x: number; z: number }, r: number) => sim.net.nearestSegment(p, r) },
      },
    } as unknown as Game;
    return { tool: new ZoneTool(game), toasts, sounds };
  }

  const pointer = (x: number, z: number, extra: Partial<ToolPointer> = {}): ToolPointer => ({
    clientX: 0,
    clientY: 0,
    ground: { x, z },
    button: 0,
    shift: false,
    ctrl: false,
    alt: false,
    id: 1,
    type: 'mouse',
    ...extra,
  });

  const zoned = () => {
    let n = 0;
    for (const b of sim.state.net.blocks.values()) for (let i = 0; i < b.zone.length; i++) if (b.zone[i]) n++;
    return n;
  };

  it('a drag over closed ground says why once, with the years left, and paints nothing', async () => {
    const { tool, toasts, sounds } = stand();
    const z = c.z - 100;
    const before = zoned();
    tool.pointerDown(pointer(cut + 80, z));
    for (let k = 1; k <= 8; k++) tool.pointerMove(pointer(cut + 80 + k * 20, z));
    tool.pointerUp();
    await flush();
    expect(zoned(), 'nothing was painted').toBe(before);
    expect(toasts, 'said once for the whole drag').toHaveLength(1);
    expect(toasts[0]!.text).toBe(falloutRefusal(sim, cut + 100, z));
    expect(toasts[0]!.text).toMatch(
      /Fallout lies on this ground\. Nothing can be built here for about \d+ more game years?/,
    );
    expect(toasts[0]!.tone).toBe('bad');
    expect(sounds).toContain('error');
    // The next stroke says it again.
    tool.pointerDown(pointer(cut + 100, z));
    tool.pointerUp();
    await flush();
    expect(toasts).toHaveLength(2);
  });

  it('a drag over open ground says nothing', async () => {
    const { tool, toasts } = stand();
    const z = c.z - 100;
    tool.pointerDown(pointer(c.x + 150, z));
    for (let k = 1; k <= 4; k++) tool.pointerMove(pointer(c.x + 150 + k * 20, z));
    tool.pointerUp();
    await flush();
    expect(toasts).toEqual([]);
    expect(zoned()).toBeGreaterThan(0);
  });

  it('a brush across the line paints the open side and says part was left', async () => {
    const { tool, toasts } = stand();
    const z = c.z + 100;
    const before = zoned();
    tool.radius = 80;
    tool.pointerDown(pointer(cut - 60, z));
    tool.pointerMove(pointer(cut + 60, z));
    tool.pointerUp();
    await flush();
    expect(zoned(), 'the open side was painted').toBeGreaterThan(before);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.text).toMatch(
      /^Part of this ground is closed and was left unpainted\. Fallout lies on this ground/,
    );
  });

  it('shift-click on a road on closed ground says why, every time', async () => {
    const { tool, toasts } = stand();
    const p = sim.net.curve(street).pointAt(sim.net.curve(street).length / 2);
    tool.pointerDown(pointer(p.x, p.z, { shift: true }));
    tool.pointerDown(pointer(p.x, p.z, { shift: true }));
    await flush();
    expect(toasts).toHaveLength(2);
    expect(toasts[0]!.text).toMatch(/^Fallout lies on this ground/);
  });
});

// ---------------------------------------------------------------------------------------------

describe('M40: the radiation map’s tooltip can be read by touch', () => {
  type Listener = (e: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  const saved = (globalThis as { window?: unknown }).window;
  const canvas = { id: 'canvas' };
  let map: OverlayController | null = null;

  /** A stand-in for the game: the screen is the ground at twice the scale, and every spot reads 0.4. */
  function stand(): OverlayController {
    const N = R * R;
    (globalThis as { window?: unknown }).window = {
      addEventListener: (t: string, f: Listener) => {
        if (!listeners.has(t)) listeners.set(t, new Set());
        listeners.get(t)!.add(f);
      },
      removeEventListener: (t: string, f: Listener) => listeners.get(t)?.delete(f),
    };
    const game = {
      renderer: {
        canvas,
        controller: { screenToGround: (x: number, y: number) => ({ x: x * 2, z: y * 2 }) },
        terrain: {
          uniforms: {
            uOverlayOn: { value: 0 },
            uOverlay: { value: { image: { data: new Uint8Array(N * 4) }, needsUpdate: false } },
          },
        },
        coverageMap: { show() {} },
        zones: { group: { visible: true } },
      },
      client: {
        query: async (q: { type: string; x?: number; z?: number }) =>
          q.type === 'overlay'
            ? { map: 'radiation', values: new Float32Array(N).fill(-1), ramp: 'hazard', legend: ['a', 'b'] }
            : { reading: { dose: 0.4, text: `at ${q.x},${q.z}` }, summary: null },
      },
      world: { districtCells: new Uint8Array(N), districts: new Map() },
      notify() {},
    } as unknown as Game;
    map = new OverlayController(game);
    map.set('radiation');
    return map;
  }

  /** Send a pointer event to every listener of its kind, as the window would. */
  function send(type: string, e: Record<string, unknown>): void {
    for (const f of [...(listeners.get(type) ?? [])]) f({ type, buttons: 0, target: canvas, ...e });
  }

  afterEach(() => {
    map?.set(null);
    map = null;
    listeners.clear();
    (globalThis as { window?: unknown }).window = saved;
  });

  it('a tap reads the spot and the tip stays; a drag (a pan) reads nothing', async () => {
    const m = stand();
    await flush();
    // A tap: down and up in nearly the same place.
    send('pointerdown', { pointerType: 'touch', pointerId: 7, clientX: 100, clientY: 100 });
    send('pointerup', { pointerType: 'touch', pointerId: 7, clientX: 102, clientY: 101 });
    await flush();
    expect(m.reading).toEqual({ text: 'at 204,202', x: 102, y: 101, touch: true });
    // The next touch clears it, and a drag leaves none: the finger moved far, the camera panned.
    send('pointerdown', { pointerType: 'touch', pointerId: 8, clientX: 100, clientY: 100 });
    expect(m.reading).toBeNull();
    send('pointermove', { pointerType: 'touch', pointerId: 8, clientX: 200, clientY: 100 });
    send('pointermove', { pointerType: 'touch', pointerId: 8, clientX: 300, clientY: 100 });
    send('pointerup', { pointerType: 'touch', pointerId: 8, clientX: 300, clientY: 100 });
    await flush();
    expect(m.reading, 'a pan reads nothing').toBeNull();
  });

  it('a tap off the map clears the tip, and a mouse still reads on hover', async () => {
    const m = stand();
    await flush();
    send('pointermove', { pointerType: 'mouse', pointerId: 1, clientX: 50, clientY: 60 });
    await flush();
    expect(m.reading).toEqual({ text: 'at 100,120', x: 50, y: 60 });
    send('pointermove', { pointerType: 'mouse', pointerId: 1, clientX: 50, clientY: 60, target: {} });
    expect(m.reading).toBeNull();
    // And closing the map takes every listener away.
    m.set(null);
    expect([...listeners.values()].reduce((n, s) => n + s.size, 0)).toBe(0);
  });
});
