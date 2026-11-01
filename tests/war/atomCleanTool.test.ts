import { beforeAll, describe, expect, it } from 'vitest';
import { FALLOUT } from '../../src/data/atom';
import { GRID_CELL, GRID_RES } from '../../src/data/world';
import type { Game } from '../../src/game';
import type { Command } from '../../src/sim/commands';
import type { Sim } from '../../src/sim/sim';
import { falloutOf, falloutSummary } from '../../src/sim/systems/fallout';
import { CleanTool } from '../../src/tools/cleanTool';
import type { ToolPointer } from '../../src/tools/tool';
import { cleanupHint, moneyWords } from '../../src/ui/atomView';
import { buildTown, connectPoint, newSim, serveTown } from '../helpers';
import { ok } from './researchTown';

/**
 * M40 step 11: the clean-up tool (`src/tools/cleanTool.ts`), tried with a stand-in for the game and the
 * real sim. Arming it shows the radiation map (and puts the old map back), the ring and the hint carry
 * the sim's own price or refusal, a click hires a crew, and the tool stays out for the next.
 */

const R = GRID_RES;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let sim: Sim;
let c: { x: number; z: number };
const SPOT = { x: 0, z: 0 };

beforeAll(() => {
  sim = newSim({ seed: 'citybloom', rivals: true, disasters: false });
  sim.testMode = true;
  buildTown(sim, { length: 800, streets: 7, zone: false });
  serveTown(sim);
  ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
  c = connectPoint(sim);
  SPOT.x = c.x + 300;
  SPOT.z = c.z;
  // Fallout on the ground round the spot: 0.5 within 300 m.
  const f = falloutOf(sim);
  for (let j = 0; j < R; j++)
    for (let i = 0; i < R; i++)
      if (Math.hypot((i + 0.5) * GRID_CELL - SPOT.x, (j + 0.5) * GRID_CELL - SPOT.z) < 300)
        f.ground[j * R + i] = 0.5;
}, 120_000);

/** A stand-in for the game: the real sim previews and answers; the overlay, the ghost and the hint are recorded. */
function stand(open: { panel: string | null; map: string | null } = { panel: null, map: null }) {
  const log = {
    maps: [] as (string | null)[],
    brushes: [] as { at: { x: number; z: number } | null; radius: number; color?: string }[],
    hints: [] as ({ text: string; tone: string } | null)[],
    toasts: [] as string[],
    sounds: [] as string[],
    panels: [] as string[],
  };
  const game = {
    overlay: {
      active: open.map,
      set(m: string | null) {
        this.active = m;
        log.maps.push(m);
      },
    },
    get panel() {
      return open.panel;
    },
    openPanel(p: string) {
      log.panels.push(p);
      open.panel = open.panel === p ? null : p;
    },
    renderer: {
      ghost: {
        showBrush: (at: { x: number; z: number } | null, radius: number, color?: string) =>
          log.brushes.push({ at, radius, color }),
      },
    },
    client: { preview: (cmd: Command) => Promise.resolve(sim.preview(cmd)) },
    dispatch: (cmd: Command) => Promise.resolve(sim.dispatch(cmd)),
    setHint: (h: { text: string; tone: string } | null) => log.hints.push(h),
    toast: (text: string) => log.toasts.push(text),
    audio: { play: (name: string) => log.sounds.push(name) },
    notify() {},
  } as unknown as Game;
  return { game, tool: new CleanTool(game), log };
}

const pointer = (x: number, z: number, extra: Partial<ToolPointer> = {}): ToolPointer => ({
  clientX: 100,
  clientY: 100,
  ground: { x, z },
  button: 0,
  shift: false,
  ctrl: false,
  alt: false,
  id: 1,
  type: 'mouse',
  ...extra,
});

describe('M40 step 11: the clean-up tool', () => {
  it('shows the radiation map and the war room steps aside; putting the tool down brings the old map back', () => {
    const { tool, log } = stand({ panel: 'war', map: 'power' });
    tool.activate();
    expect(log.maps).toEqual(['radiation']);
    expect(log.panels).toEqual(['war']);
    tool.deactivate();
    expect(log.maps).toEqual(['radiation', 'power']);
    // A radiation map that was out already stays out.
    const kept = stand({ panel: null, map: 'radiation' });
    kept.tool.activate();
    kept.tool.deactivate();
    expect(kept.log.maps).toEqual([]);
    // And with no map before, none after.
    const none = stand();
    none.tool.activate();
    none.tool.deactivate();
    expect(none.log.maps).toEqual(['radiation', null]);
  });

  it('draws the 128 m ring in amber with the price in the hint where a crew would work', async () => {
    const { tool, log } = stand();
    tool.activate();
    tool.pointerMove(pointer(SPOT.x, SPOT.z));
    await flush();
    const price = falloutSummary(sim)!.price;
    expect(log.brushes.at(-1)).toEqual({
      at: { x: SPOT.x, z: SPOT.z },
      radius: FALLOUT.cleanup.radius,
      color: '#e8b43a',
    });
    expect(FALLOUT.cleanup.radius).toBe(128);
    expect(log.hints.at(-1)).toMatchObject({
      text: cleanupHint(price, falloutSummary(sim)!.relief),
      tone: 'ok',
    });
    expect(log.hints.at(-1)!.text).toContain(moneyWords(price));
  });

  it('says the sim’s words, in red, where a crew would not work', async () => {
    const { tool, log } = stand();
    tool.activate();
    // Far from the fallout: clean enough.
    tool.pointerMove(pointer(c.x + 1_400, c.z + 700));
    await flush();
    const refusal = sim.preview({ type: 'cleanFallout', x: c.x + 1_400, z: c.z + 700 });
    expect(refusal.ok).toBe(false);
    expect(log.brushes.at(-1)!.color).toBe('#d2493b');
    expect(log.hints.at(-1)).toMatchObject({ text: (refusal as { reason: string }).reason, tone: 'bad' });
    expect(log.hints.at(-1)!.text).toMatch(/clean enough/);
  });

  it('a click hires a crew for the price, and the tool stays out for the next; a second there is refused in the sim’s words', async () => {
    const { tool, log } = stand();
    tool.activate();
    const before = sim.state.treasury;
    const price = falloutSummary(sim)!.price;
    tool.pointerDown(pointer(SPOT.x, SPOT.z));
    await flush();
    await flush();
    expect(sim.state.treasury).toBe(before - price);
    expect(falloutSummary(sim)!.jobs).toHaveLength(1);
    expect(log.sounds).toContain('place');
    expect(log.toasts).toEqual(['A clean-up crew is at work there']);
    // The preview after the click is the sim's answer for a second crew on the same ground.
    expect(log.hints.at(-1)).toMatchObject({ tone: 'bad' });
    expect(log.hints.at(-1)!.text).toMatch(/already working there/);
    // The same spot again: refused, nothing paid, an error sound.
    tool.pointerDown(pointer(SPOT.x, SPOT.z));
    await flush();
    expect(sim.state.treasury).toBe(before - price);
    expect(log.sounds).toContain('error');
    expect(log.hints.at(-1)).toMatchObject({ tone: 'bad' });
    // A right click does nothing, and Escape is the manager's (the tool has nothing to cancel).
    tool.pointerDown(pointer(SPOT.x + 200, SPOT.z, { button: 2 }));
    await flush();
    expect(falloutSummary(sim)!.jobs).toHaveLength(1);
    expect(tool.cancel()).toBe(false);
  });

  it('a hint that arrives after the tool is put down is not drawn', async () => {
    const { tool, log } = stand();
    tool.activate();
    tool.pointerMove(pointer(c.x + 100, c.z));
    tool.deactivate();
    const drawn = log.brushes.length;
    await flush();
    // (Only the ring cleared by `deactivate`, none from the late preview.)
    expect(log.brushes.length).toBe(drawn);
    expect(log.brushes.at(-1)!.at).toBeNull();
  });
});
