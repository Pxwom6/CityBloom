import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { CIVIC } from '../data/civic';
import type { Season } from '../data/climate';
import { CELL, ZONE_C, ZONE_R } from '../data/zones';
import { zonedDef } from '../data/buildings';
import { buildZonedModel } from '../render/assets/models';
import { assets } from '../render/assets/registry';
import { ModelPreview, type PreviewLook } from '../render/modelPreview';
import {
  PLAYER_ROLES,
  buildingPrompt,
  workshopPrompt,
  workshopTarget,
  workshopTargets,
  type WorkshopTarget,
} from '../models/workshop';
import { buildingFile } from '../client/myBuildings';
import { shareOrDownload } from '../client/shareFile';
import { WORKSHOP_STEPS, type WorkshopStep } from '../client/workshopState';
import type { Game } from '../game';
import { placeOwn } from './MyBuildings';
import { useGameUpdates } from './hooks';

/** The written guide (the repository is public: GitHub shows the Markdown with its pictures). */
export const GUIDE_URL = 'https://github.com/Pxwom6/CityBloom/blob/main/docs/making-buildings.md';
const STYLE_SHEET = `${import.meta.env.BASE_URL}workshop/style-reference.png`;

const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

/**
 * The Workshop (M47): from nothing to a building in the city, in five steps: pick what to make, make
 * it (with an AI 3D tool, the prompt written for you, or in Blender), check it (the check's problems as
 * a teacher's notes), see it on its lot in a street, then use it.
 */
export function WorkshopTab() {
  const game = useGameUpdates(300);
  const w = game.workshop;
  const t = workshopTarget(w.target);
  const canNext = w.step === 2 ? !!w.check?.ok : w.step < 4;
  return (
    <section class="workshop" data-testid="workshop">
      <ol class="workshop-steps" aria-label="Workshop steps">
        {WORKSHOP_STEPS.map((name, i) => (
          <li key={name}>
            <button
              class={`workshop-step ${w.step === i ? 'active' : ''} ${i < w.step ? 'done' : ''}`}
              aria-current={w.step === i ? 'step' : undefined}
              data-testid={`workshop-step-${i}`}
              // See and Use open once a model has passed; Pick, Make and Check are always open.
              disabled={i > 2 && i > w.step && !w.check?.ok}
              onClick={() => w.go(i as WorkshopStep)}
            >
              <span class="workshop-step-n">{i + 1}</span> {name}
            </button>
          </li>
        ))}
      </ol>
      <div class="workshop-body">
        {w.step === 0 && <PickStep game={game} t={t} />}
        {w.step === 1 && <MakeStep game={game} t={t} />}
        {w.step === 2 && <CheckStep game={game} t={t} />}
        {w.step === 3 && <SeeStep game={game} t={t} />}
        {w.step === 4 && <UseStep game={game} t={t} />}
      </div>
      <footer class="workshop-nav">
        <button
          class="btn"
          data-testid="workshop-back"
          disabled={w.step === 0}
          onClick={() => w.go((w.step - 1) as WorkshopStep)}
        >
          Back
        </button>
        <a
          class="muted workshop-guide"
          href={GUIDE_URL}
          target="_blank"
          rel="noopener"
          data-testid="workshop-guide"
        >
          The written guide
        </a>
        <button
          class="btn primary"
          data-testid="workshop-next"
          disabled={!canNext}
          onClick={() => w.go((w.step + 1) as WorkshopStep)}
        >
          Next
        </button>
      </footer>
    </section>
  );
}

/** Step 1: what to make, with its site, height and budget, and a picture. */
function PickStep({ game, t }: { game: Game; t: WorkshopTarget }) {
  const w = game.workshop;
  const all = workshopTargets();
  const looks = all.filter((x) => x.target.kind === 'look');
  return (
    <div class="workshop-pick">
      <p>What would you like to make?</p>
      <div class="workshop-choices" role="group" aria-label="A landmark of your own">
        {all
          .filter((x) => x.target.kind === 'landmark')
          .map((x) => (
            <button
              key={x.id}
              class={`btn ${t.id === x.id ? 'active' : ''}`}
              aria-pressed={t.id === x.id}
              data-testid={`workshop-pick-${x.id}`}
              onClick={() => w.pick(x.target)}
            >
              {x.name}
            </button>
          ))}
      </div>
      <label class="buildings-field">
        <span class="muted">Or a new look for one of the city's buildings</span>
        <select
          data-testid="workshop-pick-look"
          value={t.target.kind === 'look' ? t.id : ''}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v) w.pick({ kind: 'look', def: v });
          }}
        >
          <option value="">Choose a building…</option>
          {looks.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <SitePicture t={t} />
      <dl class="workshop-facts" data-testid="workshop-facts">
        <dt>Footprint</dt>
        <dd>
          {t.site.w} × {t.site.d} m ({t.site.w} m along the road)
        </dd>
        <dt>Height</dt>
        <dd>
          {t.height[0]}–{t.height[1]} m
        </dd>
        <dt>Budget</dt>
        <dd>{t.budget.toLocaleString('en-US')} triangles</dd>
      </dl>
      <p class="muted">{t.blurb}</p>
    </div>
  );
}

/** The site from above (the road along its front) and from the side (its height range), with a person for scale. */
function SitePicture({ t }: { t: WorkshopTarget }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const W = (c.width = 640);
    const H = (c.height = 300);
    ctx.fillStyle = '#eef3e6';
    ctx.fillRect(0, 0, W, H);
    // From above (left half): the site, the road below it.
    const span = Math.max(t.site.w, t.site.d) + 16;
    const k = Math.min(260 / span, 230 / (t.site.d + 12));
    const cx = 160;
    const top = 30;
    const sw = t.site.w * k;
    const sd = t.site.d * k;
    ctx.fillStyle = '#6b7178';
    ctx.fillRect(10, top + sd + 4, 300, 9 * k);
    ctx.fillStyle = '#fff';
    for (let x = 14; x < 306; x += 18) ctx.fillRect(x, top + sd + 4 + 4.5 * k - 1, 9, 2);
    ctx.fillStyle = '#b9e0a5';
    ctx.fillRect(cx - sw / 2, top, sw, sd);
    ctx.strokeStyle = '#1f8a4c';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(cx - sw / 2, top, sw, sd);
    ctx.setLineDash([]);
    ctx.fillStyle = '#c4553d';
    ctx.fillRect(cx - (4.5 * k) / 2, top + sd + 4 + 1.5 * k, 4.5 * k, 1.8 * k);
    ctx.fillStyle = '#24303c';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText('From above', 10, 18);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(`${t.site.w} m`, cx - 14, top + sd / 2);
    ctx.fillText('front ↓ the road', cx - 46, top + sd + 9 * k + 22);
    // From the side (right half): the height range, and a person 1.8 m tall.
    const gx = 350;
    const ground = H - 40;
    const kh = Math.min(200 / t.height[1], 260 / t.site.w);
    ctx.fillStyle = '#7aa651';
    ctx.fillRect(gx, ground, 270, 6);
    ctx.fillStyle = 'rgba(31, 138, 76, 0.18)';
    ctx.fillRect(gx + 20, ground - t.height[1] * kh, t.site.w * kh, (t.height[1] - t.height[0]) * kh);
    ctx.strokeStyle = '#1f8a4c';
    ctx.strokeRect(gx + 20, ground - t.height[0] * kh, t.site.w * kh, t.height[0] * kh);
    ctx.fillStyle = '#24303c';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText('From the side', gx, 18);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(`${t.height[0]}–${t.height[1]} m tall`, gx + 24, ground - t.height[1] * kh - 6);
    const px = gx + 30 + t.site.w * kh;
    ctx.fillStyle = '#4a7fd0';
    ctx.fillRect(px, ground - 1.8 * kh, Math.max(2, 0.5 * kh), 1.8 * kh);
    ctx.fillText('1.8 m', px + 6, ground - 4);
  }, [t.id]);
  return (
    <canvas
      ref={ref}
      class="workshop-site"
      data-testid="workshop-site"
      aria-label={`The site from above and the side: ${t.site.w} by ${t.site.d} metres, ${t.height[0]} to ${t.height[1]} metres tall`}
    />
  );
}

/** Copy text: the clipboard where allowed, else select it for the player to copy. */
async function copyText(game: Game, text: string, el: HTMLTextAreaElement | null): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    game.toast('Copied: paste it into your AI 3D tool', 'ok', 2500);
  } catch {
    el?.select();
    game.toast('Select all and copy it from the box', 'info', 3500);
  }
}

/** Step 2: make the model, with an AI 3D tool (the prompt written for them) or in Blender. */
function MakeStep({ game, t }: { game: Game; t: WorkshopTarget }) {
  const w = game.workshop;
  const box = useRef<HTMLTextAreaElement>(null);
  const prompt = workshopPrompt(t, w.idea, w.name);
  return (
    <div class="workshop-make">
      <div class="workshop-tabs" role="tablist">
        <button
          role="tab"
          class={`btn ${w.makeTab === 'ai' ? 'active' : ''}`}
          aria-selected={w.makeTab === 'ai'}
          data-testid="workshop-make-ai"
          onClick={() => {
            w.makeTab = 'ai';
            game.notify();
          }}
        >
          With an AI 3D tool
        </button>
        <button
          role="tab"
          class={`btn ${w.makeTab === 'blender' ? 'active' : ''}`}
          aria-selected={w.makeTab === 'blender'}
          data-testid="workshop-make-blender"
          onClick={() => {
            w.makeTab = 'blender';
            game.notify();
          }}
        >
          In Blender
        </button>
      </div>
      {w.makeTab === 'ai' ? (
        <>
          <ol class="workshop-howto">
            <li>
              Open your AI 3D tool (Claude Design makes the game's own) and attach the{' '}
              <a href={STYLE_SHEET} download="style-reference.png" data-testid="workshop-style">
                style reference sheet
              </a>
              .
            </li>
            <li>Say what you'd like below: the prompt fills itself in for your {t.name.toLowerCase()}.</li>
            <li>Copy the whole prompt, paste it in, and download the model as a GLB file.</li>
          </ol>
          <label class="buildings-field">
            <span class="muted">Its name</span>
            <input
              type="text"
              maxLength={40}
              value={w.name}
              placeholder={t.name}
              data-testid="workshop-name"
              onKeyDown={(e) => e.stopPropagation()}
              onInput={(e) => {
                w.name = e.currentTarget.value;
                game.notify();
              }}
            />
          </label>
          <label class="buildings-field">
            <span class="muted">What it looks like (a sentence or two)</span>
            <textarea
              rows={3}
              maxLength={600}
              value={w.idea}
              placeholder="A round bandstand with a striped roof, white columns and steps up to it"
              data-testid="workshop-idea"
              onKeyDown={(e) => e.stopPropagation()}
              onInput={(e) => {
                w.idea = e.currentTarget.value;
                game.notify();
              }}
            />
          </label>
          <label class="buildings-field">
            <span class="muted">
              The whole prompt: the game's model spec, your building, its site, budget and colours
            </span>
            <textarea
              ref={box}
              rows={6}
              readOnly
              value={prompt}
              data-testid="workshop-prompt"
              class="workshop-prompt"
            />
          </label>
          <div class="buildings-actions">
            <button
              class="btn primary"
              data-testid="workshop-copy"
              onClick={() => void copyText(game, prompt, box.current)}
            >
              Copy the prompt
            </button>
            <button
              class="btn"
              data-testid="workshop-copy-building"
              title="Making another building in the same chat: just this one's part (the spec is already there)"
              onClick={() => void copyText(game, buildingPrompt(t, w.idea, w.name), box.current)}
            >
              Copy just this building
            </button>
          </div>
        </>
      ) : (
        <BlenderSteps t={t} />
      )}
    </div>
  );
}

/** A small labelled picture for a Blender step. */
function Pic(props: { label: string; children: JSX.Element | JSX.Element[] }) {
  return (
    <svg class="workshop-pic" viewBox="0 0 200 110" role="img" aria-label={props.label}>
      <rect x="0" y="0" width="200" height="110" rx="8" fill="#f2f0ea" />
      {props.children}
    </svg>
  );
}

/** The basics the spec needs, in Blender, each with a picture. */
function BlenderSteps({ t }: { t: WorkshopTarget }) {
  return (
    <ol class="workshop-blender">
      <li>
        <Pic label="Scene properties: units metric, unit scale 1, length metres">
          <text x="14" y="28" font-size="12" fill="#24303c">
            Units
          </text>
          <text x="14" y="52" font-size="11" fill="#66727f">
            Unit System
          </text>
          <rect x="100" y="40" width="86" height="18" rx="4" fill="#fff" />
          <text x="108" y="53" font-size="11" fill="#24303c">
            Metric
          </text>
          <text x="14" y="78" font-size="11" fill="#66727f">
            Unit Scale
          </text>
          <rect x="100" y="66" width="86" height="18" rx="4" fill="#fff" />
          <text x="108" y="79" font-size="11" fill="#24303c">
            1.000
          </text>
        </Pic>
        <b>Metres.</b> Scene Properties → Units: Metric, Unit Scale 1.0. One Blender unit is one metre; your
        site is {t.site.w} × {t.site.d} m.
      </li>
      <li>
        <Pic label="Top view: the front of the building is the minus Y side, towards the road">
          <rect x="60" y="18" width="80" height="56" fill="#b9e0a5" stroke="#1f8a4c" />
          <rect x="88" y="66" width="24" height="8" fill="#6b4a33" />
          <rect x="20" y="84" width="160" height="14" fill="#6b7178" />
          <text x="66" y="50" font-size="11" fill="#24303c">
            top view
          </text>
          <text x="150" y="80" font-size="11" fill="#24303c">
            −Y
          </text>
        </Pic>
        <b>The front faces −Y.</b> In the top view, put the doors on the bottom (−Y) side: Blender's GLB
        export turns −Y into the game's −Z, the road.
      </li>
      <li>
        <Pic label="Side view: the model rests on the ground line at height zero, centred on the origin">
          <line x1="10" y1="80" x2="190" y2="80" stroke="#7aa651" stroke-width="4" />
          <rect x="70" y="36" width="60" height="44" fill="#e6d8bb" stroke="#24303c" />
          <circle cx="100" cy="80" r="4" fill="#d2493b" />
          <text x="108" y="98" font-size="11" fill="#24303c">
            origin at 0, 0, 0
          </text>
        </Pic>
        <b>On the ground, centred.</b> The bottom of the model is at height 0 and the middle of the site at
        the origin. Apply everything at the end: Object → Apply → All Transforms (Ctrl+A).
      </li>
      <li>
        <Pic label="Outliner: parts named door, roof, wall and a window group with window_glass">
          <text x="14" y="24" font-size="11" fill="#24303c">
            ▾ window
          </text>
          <text x="30" y="40" font-size="11" fill="#24303c">
            window_glass
          </text>
          <text x="14" y="58" font-size="11" fill="#24303c">
            door
          </text>
          <text x="14" y="76" font-size="11" fill="#24303c">
            roof
          </text>
          <text x="14" y="94" font-size="11" fill="#24303c">
            wall
          </text>
          <text x="110" y="58" font-size="11" fill="#66727f">
            material: door
          </text>
          <text x="110" y="76" font-size="11" fill="#66727f">
            material: roof
          </text>
        </Pic>
        <b>Name everything.</b> Each part its own object, named by what it is (door, roof, a "window" group
        holding "window_glass"); each material named by its job, with a plain Base Color:{' '}
        {PLAYER_ROLES.join(', ')}.
      </li>
      <li>
        <Pic label="Export: glTF Binary (.glb), apply modifiers, plus Y up">
          <text x="14" y="26" font-size="12" fill="#24303c">
            Export glTF 2.0
          </text>
          <rect x="14" y="36" width="172" height="18" rx="4" fill="#fff" />
          <text x="22" y="49" font-size="11" fill="#24303c">
            Format: glTF Binary (.glb)
          </text>
          <text x="14" y="74" font-size="11" fill="#24303c">
            ☑ Apply Modifiers
          </text>
          <text x="14" y="92" font-size="11" fill="#24303c">
            ☑ +Y Up
          </text>
        </Pic>
        <b>Export a GLB.</b> File → Export → glTF 2.0, Format "glTF Binary (.glb)", Apply Modifiers and +Y Up
        on, then name it {t.file}.
      </li>
    </ol>
  );
}

/** Step 3: drop the file in; the check's problems as a teacher's notes, with a picture of where. */
function CheckStep({ game, t }: { game: Game; t: WorkshopTarget }) {
  const w = game.workshop;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = async (f: File) => {
    const r = await w.checkFile(new Uint8Array(await f.arrayBuffer()), f.name);
    if (r?.ok) game.toast('It passes: on to see it', 'ok', 2500);
  };
  return (
    <div
      class={`workshop-check ${over ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer?.files?.[0];
        if (f) void take(f);
      }}
    >
      <p>
        Drop your {t.file.replace(/\.glb$/, '')} model here, or{' '}
        <button class="btn" data-testid="workshop-pick-file" onClick={() => input.current?.click()}>
          choose the file…
        </button>
      </p>
      <input
        ref={input}
        type="file"
        hidden
        accept=".glb,model/gltf-binary"
        data-testid="workshop-file"
        onChange={(e) => {
          const el = e.currentTarget;
          const f = el.files?.[0];
          if (f) void take(f);
          el.value = '';
        }}
      />
      {w.checking && (
        <p class="muted" data-testid="workshop-checking">
          Checking {w.file?.name}…
        </p>
      )}
      {w.check?.ok && !w.checking && (
        <p class="workshop-ok" data-testid="workshop-ok">
          ✓ {w.file?.name} passes every check for {t.name.toLowerCase()}. Next, see it in a street.
        </p>
      )}
      {w.check && !w.check.ok && !w.checking && (
        <>
          <p class="buildings-refused">
            Nearly there!{' '}
            {w.check.notes.length === 1 ? 'One thing to fix' : `${w.check.notes.length} things to fix`}:
          </p>
          <ul class="workshop-notes">
            {w.check.notes.map((n, i) => (
              <li key={i} class="workshop-note" data-testid="workshop-note" data-kind={n.kind}>
                <h4>{n.title}</h4>
                {n.why && <p>{n.why}</p>}
                <ul>
                  {n.fix.map((f, j) => (
                    <li key={j}>{f}</li>
                  ))}
                </ul>
                {n.kind !== 'other' && <small class="muted">The check said: {n.words}</small>}
              </li>
            ))}
          </ul>
          {w.check.picture && (
            <img
              class="buildings-picture"
              src={w.check.picture}
              data-testid="workshop-picture"
              alt="The model from above and the front: its site in green, the parts at fault in red"
            />
          )}
        </>
      )}
    </div>
  );
}

/** Two of the game's own buildings to stand either side of it. */
function neighbours(): { model: ReturnType<typeof buildZonedModel>; w: number; d: number }[] {
  // Low ones on 2×2-cell lots, so what's made stands out beside them (a town's ordinary homes and shops).
  return [zonedDef(ZONE_R, 0, 1, 1), zonedDef(ZONE_C, 0, 1, 1)].map((d, i) => ({
    model: buildZonedModel(d, 2, 2, i),
    w: 2 * CELL,
    d: 2 * CELL,
  }));
}

/** Step 4: on its lot in a street, by day and night, in each season. */
function SeeStep({ game, t }: { game: Game; t: WorkshopTarget }) {
  const w = game.workshop;
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<ModelPreview | null>(null);
  const [look, setLook] = useState<PreviewLook>({ night: false, season: 'summer' });
  const [failed, setFailed] = useState(false);
  const check = w.check;
  useEffect(() => {
    if (!canvas.current || !check?.baked) return;
    try {
      preview.current = new ModelPreview(canvas.current);
      preview.current.showStreet(assets.civicLook(t.id, 0, check.hash, check.baked), t.site, neighbours());
      preview.current.start();
    } catch {
      setFailed(true);
    }
    return () => {
      preview.current?.dispose();
      preview.current = null;
    };
  }, [check?.hash, t.id]);
  useEffect(() => {
    preview.current?.setLook(look);
  }, [look.night, look.season]);
  if (!check?.baked) return <p class="muted">Check a model first (step 3).</p>;
  return (
    <section class="buildings-preview" data-testid="workshop-see">
      {failed ? (
        <p class="muted">This device can't draw the preview.</p>
      ) : (
        <canvas ref={canvas} data-testid="workshop-canvas" aria-label="Your model on its lot, in a street" />
      )}
      <div class="buildings-looks" role="group" aria-label="Light and season">
        <button
          class={`btn ${look.night ? '' : 'active'}`}
          aria-pressed={!look.night}
          data-testid="workshop-day"
          onClick={() => setLook({ ...look, night: false })}
        >
          Day
        </button>
        <button
          class={`btn ${look.night ? 'active' : ''}`}
          aria-pressed={look.night}
          data-testid="workshop-night"
          onClick={() => setLook({ ...look, night: true })}
        >
          Night
        </button>
        <span class="sep" />
        {SEASONS.map((s) => (
          <button
            key={s}
            class={`btn ${look.season === s ? 'active' : ''}`}
            aria-pressed={look.season === s}
            data-testid={`workshop-season-${s}`}
            onClick={() => setLook({ ...look, season: s })}
          >
            {s[0]!.toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <p class="muted">
        Beside two of the game's own buildings, on the road it faces. Its windows light up at night and its
        lawns follow the seasons.
      </p>
    </section>
  );
}

/** Step 5: into My buildings, then place it, share it, or (M48) send it in. */
function UseStep({ game, t }: { game: Game; t: WorkshopTarget }) {
  const w = game.workshop;
  const [busy, setBusy] = useState(false);
  const stored = w.added ? game.buildings.get(w.added) : undefined;
  if (!w.check?.ok || !w.file) return <p class="muted">Check a model first (step 3).</p>;
  const add = async () => {
    if (!w.file) return;
    setBusy(true);
    const r = await game.buildings.add(w.file.bytes, w.name || t.name, w.target);
    setBusy(false);
    if (!r.ok) {
      game.toast(r.problems[0]?.words ?? 'It couldn’t be added', 'bad');
      return;
    }
    w.added = r.model.hash;
    game.notify();
    game.toast(`${r.model.name} is in My buildings`, 'ok', 2500);
  };
  return (
    <div class="workshop-use">
      {!stored ? (
        <>
          <p>It's ready. Put it in My buildings to use it in your cities, share it or send it in.</p>
          <button class="btn primary" data-testid="workshop-add" disabled={busy} onClick={() => void add()}>
            {busy ? 'Adding…' : 'Add to My buildings'}
          </button>
        </>
      ) : (
        <>
          <p data-testid="workshop-added">✓ {stored.name} is in My buildings.</p>
          <div class="buildings-actions">
            <button class="btn primary" data-testid="workshop-place" onClick={() => placeOwn(game, stored)}>
              {t.target.kind === 'landmark'
                ? 'Place it in the city'
                : `Place a new ${CIVIC.get(t.id)?.name.toLowerCase()}`}
            </button>
            <button
              class="btn"
              data-testid="workshop-share"
              onClick={() =>
                void shareOrDownload(
                  buildingFile(stored),
                  `${stored.name.replace(/[^a-z0-9-_]+/gi, '_') || 'building'}.citybloom-building`,
                  stored.name,
                )
              }
            >
              Share with a friend
            </button>
            <button class="btn" data-testid="workshop-send" disabled title="Coming in a later update">
              Send it in
            </button>
          </div>
          {t.target.kind === 'look' && (
            <p class="muted">
              To give a {CIVIC.get(t.id)?.name.toLowerCase()} that's already standing this look, pick it on
              the map and choose it under Look in its panel.
            </p>
          )}
          <p class="muted">Sending your building in for everyone's game is coming in a later update.</p>
          <button class="btn" data-testid="workshop-again" onClick={() => w.again()}>
            Make another
          </button>
        </>
      )}
    </div>
  );
}
