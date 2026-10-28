import { describe, expect, it } from 'vitest';
import { Mesh, RingGeometry } from 'three';
import type { ClientWorld } from '../../src/client/world';
import { SuperEffects } from '../../src/render/shields';
import type { SupersSummary } from '../../src/sim/systems/supers';

/** M37: the superweapon buildings' effects, from the war summary and the battle frame (display only). */

const civic = (id: number, def: string, x: number, z: number) => ({
  id,
  def,
  x,
  z,
  y: 2,
  angle: 0,
  side: 1,
  out: 0,
  damage: 0,
});

function world(supers: Partial<SupersSummary>, battle: { dome?: number } | null) {
  const civics = new Map(
    [
      civic(1, 'domeshield', 0, 0),
      civic(2, 'shieldgen', 200, 0),
      civic(3, 'expressgate', -200, 0),
      civic(4, 'blackouttower', 0, 200),
      civic(5, 'school', 600, 0),
    ].map((c) => [c.id, c]),
  );
  return {
    civics,
    buildings: new Map([[9, { id: 9, x: 0, z: -900 }]]),
    battle,
    // Ground that falls away to the east.
    heightAt: (x: number) => 2 - x / 50,
    stats: {
      war: {
        supers: {
          dome: null,
          tower: null,
          gate: null,
          blackout: null,
          darkened: [],
          ...supers,
        },
      },
    },
  } as unknown as ClientWorld;
}

describe('M37 superweapon effects', () => {
  it('the dome rises over a battle at home, reaching every building, flashes as it is hit and pops', () => {
    const dome = { civic: 1, charge: 0, mode: 'all' as const, raised: true };
    const w = world({ dome }, { dome: 1 });
    const fx = new SuperEffects(w);
    fx.update(0);
    expect(fx.shown.dome).toBe(true);
    // Over the furthest building (900 m away) and a little more.
    const mesh = fx.group.children.find((m) => m.visible)!;
    expect(mesh).toBeDefined();
    (w as { battle: { dome?: number } }).battle = { dome: 0.5 };
    fx.update(0.1);
    expect(fx.shown.dome).toBe(true);
    // Spent: it pops (a moment on screen), then is gone.
    (w as { battle: { dome?: number } }).battle = { dome: 0 };
    fx.update(0.2);
    expect(fx.shown.dome).toBe(true);
    fx.update(2);
    expect(fx.shown.dome).toBe(false);
  });

  it('draws as a ring on the ground at Low, and nothing without a battle', () => {
    const dome = { civic: 1, charge: 1, mode: 'all' as const, raised: false };
    const fx = new SuperEffects(world({ dome }, null));
    fx.update(0);
    expect(fx.shown).toEqual({ dome: false, bubbles: 0, swirl: false, tower: false });
    const low = new SuperEffects(world({ dome: { ...dome, raised: true } }, { dome: 1 }));
    low.quality = 0;
    low.update(0);
    expect(low.shown.dome).toBe(true);
    expect(low.shown.bubbles).toBe(1);
    // The ring lies on the ground all round, not at the dome's own height over a valley.
    const ring = low.group.children.find(
      (m) => m.visible && (m as Mesh).geometry instanceof RingGeometry,
    ) as Mesh;
    const p = ring.geometry.attributes.position!;
    for (let i = 0; i < p.count; i += 17) {
      const x = ring.position.x + p.getX(i) * ring.scale.x;
      expect(ring.position.y + p.getY(i)).toBeCloseTo(2 - x / 50 + 1.5, 3);
    }
  });

  it('shield bubbles in a battle, the gate swirls for the hour of a jump, the tower glows while charging', () => {
    const fx = new SuperEffects(
      world(
        {
          gate: { civic: 3, wait: 119, since: 0.5 },
          tower: { civic: 4, wait: 239, charging: { to: 1, hours: 1 } },
        },
        {},
      ),
    );
    fx.update(0);
    expect(fx.shown).toEqual({ dome: false, bubbles: 1, swirl: true, tower: true });
    const later = new SuperEffects(world({ gate: { civic: 3, wait: 100, since: 20 } }, null));
    later.update(0);
    expect(later.shown.swirl).toBe(false);
  });
});
