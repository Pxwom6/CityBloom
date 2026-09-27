import { useEffect, useState } from 'preact/hooks';
import type { FollowTarget } from '../game';
import { GRADES, GRADE_IDS } from '../render/photo';
import { hourOfDay } from '../sim/time';
import { useGameUpdates } from './hooks';
import { Check, Segmented } from './Shell';

const FOLLOW_NAMES: Record<FollowTarget['kind'], string> = {
  car: 'a car',
  bus: 'a bus',
  walker: 'someone walking',
  vehicle: 'a service vehicle',
};

function clock(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  show: string;
  testid: string;
  onInput: (v: number) => void;
}) {
  return (
    <label class="photo-slider">
      <span>
        {props.label} <strong>{props.show}</strong>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        data-testid={props.testid}
        onInput={(e) => props.onInput(Number((e.target as HTMLInputElement).value))}
      />
    </label>
  );
}

/**
 * Photo mode (M16): only this panel shows, and H hides it too. The picture is drawn from the 3D
 * view alone, so no panel can ever be in it.
 */
export function PhotoMode() {
  const game = useGameUpdates(120);
  const p = game.photo;
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (p?.panel) return;
    setHint(true);
    const t = setTimeout(() => setHint(false), 2500);
    return () => clearTimeout(t);
  }, [p?.panel]);
  if (!p) return null;
  if (!p.panel)
    return hint ? (
      <div class="photo-hint" data-testid="photo-hint">
        Photo mode · H shows the controls
      </div>
    ) : null;
  const liveHour = hourOfDay(game.world.displayTick);
  const canvas = game.renderer.canvas;
  const ratio = (window.devicePixelRatio || 1) * p.scale;
  const size = `${Math.round(canvas.clientWidth * ratio)} × ${Math.round(canvas.clientHeight * ratio)}`;
  return (
    <aside class="photo-panel panel" data-testid="photo-panel" aria-label="Photo mode">
      <header>
        <h2>Photo mode</h2>
        <button
          class="btn small"
          data-testid="photo-hide"
          title="Hide these controls (H)"
          onClick={() => game.setPhoto({ panel: false })}
        >
          Hide
        </button>
        <button
          class="btn small"
          data-testid="photo-exit"
          title="Back to the city (Esc or K)"
          onClick={() => game.exitPhoto()}
        >
          Done
        </button>
      </header>

      <section>
        <h3>Camera</h3>
        <Slider
          label="Field of view"
          value={p.fov}
          min={15}
          max={90}
          step={1}
          show={`${p.fov}°`}
          testid="photo-fov"
          onInput={(fov) => game.setPhoto({ fov })}
        />
        <div class="photo-follow">
          {p.follow ? (
            <>
              <span data-testid="photo-following">Riding with {FOLLOW_NAMES[p.follow.kind]}</span>
              <button
                class="btn small"
                data-testid="photo-follow-stop"
                onClick={() => game.setPhoto({ follow: null })}
              >
                Stop
              </button>
            </>
          ) : (
            <>
              <span>Follow</span>
              <button
                class={`btn small ${p.picking ? 'active' : ''}`}
                data-testid="photo-follow-pick"
                title="Then click a car, bus or person"
                onClick={() => game.setPhoto({ picking: !p.picking })}
              >
                {p.picking ? 'Click one…' : 'Pick'}
              </button>
              <button
                class="btn small"
                data-testid="photo-follow-car"
                onClick={() => game.followNearest(['car'])}
              >
                Car
              </button>
              <button
                class="btn small"
                data-testid="photo-follow-bus"
                onClick={() => game.followNearest(['bus'])}
              >
                Bus
              </button>
              <button
                class="btn small"
                data-testid="photo-follow-walker"
                onClick={() => game.followNearest(['walker'])}
              >
                Person
              </button>
            </>
          )}
        </div>
      </section>

      <section>
        <h3>Light</h3>
        <Slider
          label="Time of day"
          value={p.hour ?? liveHour}
          min={0}
          max={23.9}
          step={0.1}
          show={p.hour === null ? `${clock(liveHour)} (city clock)` : clock(p.hour)}
          testid="photo-hour"
          onInput={(hour) => game.setPhoto({ hour })}
        />
        <Check
          on={p.hour === null}
          testid="photo-live"
          label="Follow the city's clock"
          set={(live) => game.setPhoto({ hour: live ? null : liveHour })}
        />
      </section>

      <section>
        <h3>Lens</h3>
        <Slider
          label="Depth of field"
          value={p.dof}
          min={0}
          max={1}
          step={0.05}
          show={p.dof ? `${Math.round(p.dof * 100)}%` : 'off'}
          testid="photo-dof"
          onInput={(dof) => game.setPhoto({ dof })}
        />
        <Slider
          label="Tilt-shift"
          value={p.tiltShift}
          min={0}
          max={1}
          step={0.05}
          show={p.tiltShift ? `${Math.round(p.tiltShift * 100)}%` : 'off'}
          testid="photo-tilt"
          onInput={(tiltShift) => game.setPhoto({ tiltShift })}
        />
        <p class="photo-note-line">Focus follows what the camera looks at ({Math.round(p.focus)} m).</p>
      </section>

      <section>
        <h3>Colour</h3>
        <div class="photo-grades" role="radiogroup">
          {GRADE_IDS.map((g) => (
            <button
              key={g}
              role="radio"
              aria-checked={p.grade === g}
              class={`btn small ${p.grade === g ? 'active' : ''}`}
              data-testid={`photo-grade-${g}`}
              onClick={() => game.setPhoto({ grade: g })}
            >
              {GRADES[g].name}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>City</h3>
        <Check
          on={p.running}
          testid="photo-running"
          label="Keep the city running"
          hint="(Space)"
          set={(running) => game.setPhoto({ running })}
        />
        <Check
          on={p.zones}
          testid="photo-zones"
          label="Show zone markings"
          set={(zones) => game.setPhoto({ zones })}
        />
      </section>

      <section class="photo-save">
        <Segmented
          value={p.scale}
          options={[1, 2] as const}
          label={(s) => `${s}×`}
          testid="photo-scale"
          onChange={(scale) => game.setPhoto({ scale })}
        />
        <button
          class="btn active"
          data-testid="photo-save"
          title="Save a PNG (Enter)"
          onClick={() => void game.savePhoto()}
        >
          Save photo
        </button>
        <small class="muted">{size} PNG</small>
      </section>
      {p.saved && (
        <p class="photo-note-line" data-testid="photo-saved">
          Saved {p.saved.width} × {p.saved.height} ({(p.saved.bytes / 1e6).toFixed(1)} MB).
        </p>
      )}
      {p.note && (
        <p class="photo-note-line warn" data-testid="photo-note">
          {p.note}
        </p>
      )}
      <p class="photo-keys">
        Drag to pan, right-drag to turn, wheel to zoom; closer and lower than usual. WASD, Q/E, R/F · H hides
        · Enter saves · Esc leaves
      </p>
    </aside>
  );
}
