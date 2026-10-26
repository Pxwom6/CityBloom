/**
 * The other players on the map (M31): each one's cursor as a ring in their colour with their name,
 * the ghost of the tool in their hand, this player's own commands while they wait for the room, and
 * "look here" pings. Name tags are DOM labels placed over the canvas each frame.
 */
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import type { Shape } from '../../relay/protocol';

export interface PresenceMark {
  /** Player id (or a negative key for pending commands). */
  key: number;
  color: string;
  name: string | null;
  at: [number, number] | null;
  ghost?: Shape;
  /** Pending (this player's own command waiting for the room): drawn fainter. */
  pending?: boolean;
}

interface Slot {
  ring: Mesh;
  lines: LineSegments;
  ghostKey: string;
  label: HTMLDivElement | null;
}

const RING = new RingGeometry(3, 4.6, 32).rotateX(-Math.PI / 2);
const v = new Vector3();

export class PresenceLayer {
  readonly group = new Group();
  private slots = new Map<number, Slot>();
  private pings: { mesh: Mesh; label: HTMLDivElement; until: number; at: [number, number] }[] = [];
  private readonly layer: HTMLDivElement;

  constructor(
    private readonly heightAt: (x: number, z: number) => number,
    canvas: HTMLCanvasElement,
  ) {
    const host = canvas.parentElement ?? document.body;
    this.layer = document.createElement('div');
    this.layer.className = 'presence-layer';
    // Just above the map and below the interface.
    host.insertBefore(this.layer, canvas.nextSibling);
    this.group.renderOrder = 25;
  }

  private y(x: number, z: number): number {
    return Math.max(0, this.heightAt(x, z)) + 1.2;
  }

  private slot(m: PresenceMark): Slot {
    let s = this.slots.get(m.key);
    if (!s) {
      const mat = (o: number) =>
        new MeshBasicMaterial({
          color: m.color,
          transparent: true,
          opacity: o,
          depthTest: false,
          depthWrite: false,
          side: DoubleSide,
        });
      const ring = new Mesh(RING, mat(0.95));
      ring.renderOrder = 26;
      const lines = new LineSegments(
        new BufferGeometry(),
        new LineBasicMaterial({
          color: m.color,
          transparent: true,
          opacity: m.pending ? 0.55 : 0.9,
          depthTest: false,
        }),
      );
      lines.renderOrder = 26;
      this.group.add(ring, lines);
      let label: HTMLDivElement | null = null;
      if (m.name) {
        label = document.createElement('div');
        label.className = 'presence-name';
        label.style.setProperty('--player', m.color);
        label.textContent = m.name;
        this.layer.appendChild(label);
      }
      s = { ring, lines, ghostKey: '', label };
      this.slots.set(m.key, s);
    }
    return s;
  }

  /** Build line segments for a ghost outline. */
  private ghostGeometry(g: Shape | undefined): BufferGeometry {
    const pos: number[] = [];
    const seg = (ax: number, az: number, bx: number, bz: number) =>
      pos.push(ax, this.y(ax, az), az, bx, this.y(bx, bz), bz);
    for (const l of g?.lines ?? [])
      for (let i = 2; i + 1 < l.length; i += 2) seg(l[i - 2]!, l[i - 1]!, l[i]!, l[i + 1]!);
    for (const [x, z, r] of g?.circles ?? []) {
      const n = 32;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        seg(x! + Math.cos(a0) * r!, z! + Math.sin(a0) * r!, x! + Math.cos(a1) * r!, z! + Math.sin(a1) * r!);
      }
    }
    for (const [x, z, hw, hd, ang] of g?.rects ?? []) {
      const c = Math.cos(ang!);
      const s = Math.sin(ang!);
      const corner = (u: number, w: number): [number, number] => [x! + c * u - s * w, z! + s * u + c * w];
      const k = [corner(-hw!, -hd!), corner(hw!, -hd!), corner(hw!, hd!), corner(-hw!, hd!)];
      for (let i = 0; i < 4; i++) seg(k[i]![0], k[i]![1], k[(i + 1) % 4]![0], k[(i + 1) % 4]![1]);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    return geo;
  }

  /** Show these marks (anything not listed goes) and place the name tags for this camera. */
  update(marks: PresenceMark[], camera: PerspectiveCamera, width: number, height: number, now: number): void {
    const seen = new Set<number>();
    for (const m of marks) {
      seen.add(m.key);
      const s = this.slot(m);
      s.ring.visible = !!m.at && !m.pending;
      if (m.at) s.ring.position.set(m.at[0], this.y(m.at[0], m.at[1]), m.at[1]);
      const key = JSON.stringify(m.ghost ?? null);
      if (key !== s.ghostKey) {
        s.ghostKey = key;
        s.lines.geometry.dispose();
        s.lines.geometry = this.ghostGeometry(m.ghost);
      }
      if (s.label) this.place(s.label, m.at, camera, width, height);
    }
    for (const [k, s] of this.slots)
      if (!seen.has(k)) {
        this.group.remove(s.ring, s.lines);
        s.lines.geometry.dispose();
        s.label?.remove();
        this.slots.delete(k);
      }
    // Pings grow and fade over three seconds.
    this.pings = this.pings.filter((p) => {
      const left = p.until - now;
      if (left <= 0) {
        this.group.remove(p.mesh);
        p.label.remove();
        return false;
      }
      const t = 1 - left / 3000;
      p.mesh.scale.setScalar(1 + 4 * ((t * 2) % 1));
      (p.mesh.material as MeshBasicMaterial).opacity = 0.9 * (1 - ((t * 2) % 1));
      this.place(p.label, p.at, camera, width, height);
      return true;
    });
  }

  /** "Look here": a growing ring where the player pointed, with their name. */
  ping(at: [number, number], color: string, name: string, now: number): void {
    const mesh = new Mesh(
      RING,
      new MeshBasicMaterial({
        color: new Color(color),
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    mesh.position.set(at[0], this.y(at[0], at[1]), at[1]);
    mesh.renderOrder = 27;
    this.group.add(mesh);
    const label = document.createElement('div');
    label.className = 'presence-name ping';
    label.style.setProperty('--player', color);
    label.textContent = `${name}: look here`;
    this.layer.appendChild(label);
    this.pings.push({ mesh, label, until: now + 3000, at });
  }

  private place(
    el: HTMLDivElement,
    at: [number, number] | null,
    camera: PerspectiveCamera,
    w: number,
    h: number,
  ): void {
    if (!at) {
      el.style.display = 'none';
      return;
    }
    v.set(at[0], this.y(at[0], at[1]), at[1]).project(camera);
    if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
  }
}
