import type { WeatherLook } from '../render/weather';
import type { ClientWorld } from '../client/world';
import type { GameRenderer } from '../render/renderer';
import { GRID_CELL, GRID_RES } from '../data/world';
import { listenRadius, type AmbientScene } from './mix';
import { floodLevel, tornadoAt } from '../sim/systems/disasters';

const STATE_CONSTRUCTION = 0;
const EMERGENCY = new Set(['fire', 'police', 'ambulance']);

/** Summarise what's around the view centre for the ambient bed. */
export function ambientScene(world: ClientWorld, renderer: GameRenderer, paused: boolean): AmbientScene {
  const cam = renderer.controller.current;
  const cx = cam.x;
  const cz = cam.z;
  const r = listenRadius(cam.distance);
  const r2 = r * r;
  const near = (x: number, z: number) => (x - cx) ** 2 + (z - cz) ** 2 <= r2;
  let cars = 0;
  for (const c of renderer.traffic.cars) if (near(c.x, c.z)) cars++;
  let buildings = 0;
  let construction = 0;
  let fires = 0;
  for (const b of world.buildings.values()) {
    if (!near(b.x, b.z)) continue;
    buildings++;
    if (b.state === STATE_CONSTRUCTION) construction++;
    if (b.fire > 0) fires++;
  }
  let sirens = 0;
  for (const v of renderer.vehicles.positions.values())
    if (v.phase === 'out' && EMERGENCY.has(v.kind) && near(v.x, v.z)) sirens++;
  // Mean tree density over the raster cells in the circle (sampled on a coarse lattice).
  let sum = 0;
  let n = 0;
  const step = Math.max(GRID_CELL, r / 6);
  for (let x = cx - r; x <= cx + r; x += step)
    for (let z = cz - r; z <= cz + r; z += step) {
      if (!near(x, z)) continue;
      const i = Math.floor(x / GRID_CELL);
      const j = Math.floor(z / GRID_CELL);
      n++;
      if (i >= 0 && j >= 0 && i < GRID_RES && j < GRID_RES) sum += world.trees[j * GRID_RES + i]! / 255;
    }
  // Disasters: how close the nearest tornado is, and whether flood water is in view.
  let tornado = Infinity;
  let flood = 0;
  const tick = world.displayTick;
  for (const d of world.disasters.active) {
    if (d.kind === 'tornado' && tick >= d.start && tick <= d.end) {
      const p = tornadoAt(d, tick);
      tornado = Math.min(tornado, Math.hypot(p.x - cx, p.z - cz));
    } else if (d.kind === 'flood' && floodLevel(d, tick) > 0.5) {
      const dist = Math.hypot(d.x - cx, d.z - cz);
      flood = Math.max(flood, Math.min(1, Math.max(0, 1 - (dist - 300) / 900)));
    }
  }
  return {
    tornado,
    flood,
    distance: cam.distance,
    cars,
    buildings,
    construction,
    fires,
    sirens,
    trees: n ? sum / n : 0,
    night: renderer.lighting.night,
    paused,
    // Weather as it looks on screen (M22).
    ...weatherSounds(renderer.weather.look),
  };
}

function weatherSounds(l: WeatherLook): { rain: number; gale: number; snow: number } {
  const st = l.kind === 'clear' ? 0 : l.strength;
  return {
    rain: l.kind === 'rain' || l.kind === 'storm' ? st : 0,
    gale: l.kind === 'storm' ? st : 0,
    snow: l.kind === 'snow' ? st : 0,
  };
}
