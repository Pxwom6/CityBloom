import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { CIVIC, CIVIC_DEFS } from '../data/civic';
import type { Season } from '../data/climate';
import {
  CUSTOM,
  canHaveLook,
  fitsTarget,
  targetOfDef,
  targetsFor,
  suggestTargets,
  targetId,
  targetLabel,
  type CustomProblem,
  type CustomTarget,
  type ModelSize,
} from '../models/customCheck';
import { assets } from '../render/assets/registry';
import { ModelPreview, type PreviewLook } from '../render/modelPreview';
import { buildingFile, cleanModelName, readBuildingFile, type StoredModel } from '../client/myBuildings';
import { probeModelFile } from '../client/modelCheck';
import { shareOrDownload } from '../client/shareFile';
import { NO_CUSTOM } from '../sim/rules';
import type { Game } from '../game';
import { useGameUpdates } from './hooks';
import { WorkshopTab } from './Workshop';

const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_WORDS: Record<Season, string> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
};

/** A target as a select's value, and back. */
const keyOf = (t: CustomTarget) => (t.kind === 'landmark' ? `landmark:${t.size}` : `look:${t.def}`);
function targetOf(key: string): CustomTarget | null {
  const [kind, v] = key.split(':');
  if (kind === 'landmark' && ['1', '2', '3', '4'].includes(v!))
    return { kind: 'landmark', size: Number(v) as 1 | 2 | 3 | 4 };
  if (kind === 'look' && v && canHaveLook(v)) return { kind: 'look', def: v };
  return null;
}

/** A target in a few words, for a list. */
function shortTarget(t: CustomTarget): string {
  if (t.kind === 'landmark') return `Landmark ${t.size}×${t.size}`;
  return `${CIVIC.get(t.def)?.name ?? 'Building'} look`;
}

/** Whether the room's host has turned players' own buildings off (M46). */
export function customOff(game: Game): boolean {
  return game.net?.session.room?.rules.customBuildings === false;
}

/**
 * Arm the place tool with one of the player's models: a landmark, or a new building wearing it (as
 * its own target, or `as` another it fits).
 */
export function placeOwn(game: Game, m: StoredModel, as: CustomTarget = m.target): void {
  if (customOff(game)) {
    game.toast(NO_CUSTOM, 'bad');
    return;
  }
  const def = CIVIC.get(targetId(as));
  if (!def) return;
  if (game.panel === 'buildings') game.openPanel('buildings');
  game.tools.place.setOwn(def.id, m.hash);
  game.tools.use('place');
}

interface Importing {
  bytes: Uint8Array;
  name: string;
  size: ModelSize | null;
  why: string | null;
  suggested: CustomTarget[];
  target: CustomTarget;
  busy: boolean;
  problems: CustomProblem[] | null;
  picture: string | null;
}

/**
 * My Buildings (M46): the player's own models. Add one (a GLB, or a building file a friend sent),
 * checked in a worker and refused with plain words and a picture when it isn't right; see each on a
 * turntable by day and night in every season; place it, rename it, share it, delete it.
 */
export function MyBuildingsPanel() {
  const game = useGameUpdates(300);
  const open = game.panel === 'buildings';
  const [importing, setImporting] = useState<Importing | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [look, setLook] = useState<PreviewLook>({ night: false, season: 'summer' });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // A picture's address is let go when it's replaced or the card closes.
  useEffect(() => {
    const url = importing?.picture;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [importing?.picture]);
  if (!open) return null;
  const list = game.buildings.list();
  const shown = list.find((m) => m.hash === picked) ?? list[0] ?? null;
  const off = customOff(game);

  const readFile = async (file: File) => {
    setDeleting(null);
    if (file.size > CUSTOM.maxParse) {
      setImporting({
        bytes: new Uint8Array(),
        name: cleanModelName(file.name),
        size: null,
        why: `It is ${(file.size / 1_048_576).toFixed(0)} MB: the game takes models up to 1 MB`,
        suggested: [],
        target: { kind: 'landmark', size: 2 },
        busy: false,
        problems: null,
        picture: null,
      });
      return;
    }
    let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
    let name = cleanModelName(file.name);
    let given: CustomTarget | null = null;
    // A building file a friend sent: the model inside it, its name and what it's for.
    if (/\.citybloom-building$/i.test(file.name) || bytes[0] === 0x7b) {
      const r = readBuildingFile(new TextDecoder().decode(bytes));
      if ('why' in r) {
        setImporting({
          bytes: new Uint8Array(),
          name,
          size: null,
          why: r.why,
          suggested: [],
          target: { kind: 'landmark', size: 2 },
          busy: false,
          problems: null,
          picture: null,
        });
        return;
      }
      bytes = r.bytes;
      name = r.name;
      given = r.target;
    }
    const base: Importing = {
      bytes,
      name,
      size: null,
      why: null,
      suggested: [],
      target: given ?? { kind: 'landmark', size: 2 },
      busy: true,
      problems: null,
      picture: null,
    };
    setImporting(base);
    const probe = await probeModelFile(bytes);
    if ('why' in probe) {
      setImporting({ ...base, busy: false, why: probe.why });
      return;
    }
    const suggested = suggestTargets(probe);
    setImporting({ ...base, busy: false, size: probe, suggested, target: given ?? suggested[0]! });
  };

  const add = async () => {
    if (!importing || importing.busy) return;
    setImporting({ ...importing, busy: true, problems: null, picture: null });
    const r = await game.buildings.add(importing.bytes, importing.name, importing.target);
    if (!r.ok) {
      setImporting({
        ...importing,
        busy: false,
        problems: r.problems,
        picture: r.picture ? URL.createObjectURL(r.picture) : null,
      });
      return;
    }
    setImporting(null);
    setPicked(r.model.hash);
    game.toast(
      r.existed ? `${r.model.name} is already in My buildings` : `${r.model.name} added to My buildings`,
      'ok',
      2500,
    );
  };

  const share = async (m: StoredModel, as: 'glb' | 'building') => {
    const base = m.name.replace(/[^a-z0-9-_]+/gi, '_') || 'building';
    const blob =
      as === 'glb' ? new Blob([m.bytes.slice().buffer], { type: 'model/gltf-binary' }) : buildingFile(m);
    const how = await shareOrDownload(blob, `${base}.${as === 'glb' ? 'glb' : 'citybloom-building'}`, m.name);
    if (how === 'downloaded') game.toast(`${m.name} saved to your downloads`, 'ok', 2500);
  };

  const onDrop = (e: JSX.TargetedDragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) void readFile(f);
  };

  return (
    <aside
      class={`advisors buildings-panel panel ${dragging ? 'dragging' : ''}`}
      data-testid="buildings-panel"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header>
        <h2>My buildings</h2>
        <button class="btn icon" aria-label="Close" onClick={() => game.openPanel('buildings')}>
          ×
        </button>
      </header>
      <div class="workshop-tabs buildings-tabs" role="tablist">
        {(
          [
            ['mine', 'My buildings'],
            ['workshop', 'Workshop'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            class={`btn ${game.buildingsTab === id ? 'active' : ''}`}
            aria-selected={game.buildingsTab === id}
            data-testid={`buildings-tab-${id}`}
            onClick={() => {
              game.buildingsTab = id;
              game.notify();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {game.buildingsTab === 'workshop' ? (
        <div class="advisors-list">
          <WorkshopTab />
        </div>
      ) : (
        <div class="advisors-list">
          {off && (
            <div class="warn" data-testid="buildings-off">
              {NO_CUSTOM}: buildings of your own show as the game's while you play here.
            </div>
          )}
          <div class="buildings-add">
            <button
              class="btn primary"
              data-testid="buildings-pick"
              onClick={() => fileInput.current?.click()}
            >
              Add a model…
            </button>
            <span class="muted">
              A GLB file up to 1 MB, or a building a friend sent. You can drop it here too.
            </span>
            <input
              ref={fileInput}
              type="file"
              accept=".glb,.citybloom-building,model/gltf-binary"
              hidden
              data-testid="buildings-file"
              onChange={(e) => {
                const input = e.currentTarget;
                const f = input.files?.[0];
                if (f) void readFile(f);
                input.value = '';
              }}
            />
          </div>
          {importing && (
            <ImportCard
              importing={importing}
              set={setImporting}
              onAdd={() => void add()}
              onCancel={() => setImporting(null)}
            />
          )}
          {!importing && !list.length && (
            <p class="muted" data-testid="buildings-empty">
              Make a building in any 3D program that saves GLB files (Blender is free), following the game's
              model guide: plain colours, the front facing the road, sized to its site. Add it here to see it
              on a turntable, then place it as a landmark of your own, or as a new look for one of the city's
              buildings.
            </p>
          )}
          {!importing && !list.length && (
            <button
              class="btn primary"
              data-testid="buildings-open-workshop"
              onClick={() => game.openWorkshop()}
            >
              New to this? Open the Workshop
            </button>
          )}
          {shown && !importing && <PreviewBox model={shown} look={look} setLook={setLook} />}
          {list.length > 0 && (
            <ul class="buildings-list" data-testid="buildings-list">
              {list.map((m) => (
                <li key={m.hash} class={`buildings-row ${shown?.hash === m.hash ? 'active' : ''}`}>
                  <button
                    class="buildings-row-main"
                    data-testid={`buildings-row-${m.hash}`}
                    aria-pressed={shown?.hash === m.hash}
                    onClick={() => {
                      setPicked(m.hash);
                      setImporting(null);
                    }}
                  >
                    {renaming === m.hash ? null : <span class="buildings-name">{m.name}</span>}
                    <span class="muted">
                      {shortTarget(m.target)} · {m.size.w} × {m.size.d} m
                    </span>
                    {(() => {
                      const also = targetsFor(m).slice(1);
                      if (!also.length) return null;
                      const names = also.slice(0, 3).map(shortTarget);
                      return (
                        <span class="muted" data-testid={`buildings-also-${m.hash}`}>
                          Also fits: {names.join(', ')}
                          {also.length > 3 ? ` and ${also.length - 3} more` : ''}
                        </span>
                      );
                    })()}
                  </button>
                  {renaming === m.hash && (
                    <input
                      type="text"
                      class="buildings-rename"
                      maxLength={CUSTOM.nameChars}
                      defaultValue={m.name}
                      data-testid="buildings-rename-input"
                      ref={(el) => el?.focus()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      onBlur={(e) => {
                        const v = (e.target as HTMLInputElement).value;
                        setRenaming(null);
                        if (v.trim() && v !== m.name) void game.buildings.rename(m.hash, v);
                      }}
                    />
                  )}
                  <div class="buildings-actions">
                    <button
                      class="btn primary"
                      data-testid={`buildings-place-${m.hash}`}
                      disabled={off}
                      title={
                        m.target.kind === 'landmark'
                          ? 'Place it as a landmark: it works like a park of its size'
                          : `Place a new ${CIVIC.get(m.target.def)?.name.toLowerCase() ?? 'building'} wearing it (pick one on the map to change its look)`
                      }
                      onClick={() => placeOwn(game, m)}
                    >
                      Place
                    </button>
                    <button
                      class="btn"
                      data-testid={`buildings-renamebtn-${m.hash}`}
                      onClick={() => setRenaming(m.hash)}
                    >
                      Rename
                    </button>
                    <button
                      class="btn"
                      data-testid={`buildings-share-glb-${m.hash}`}
                      title="Save the model as a GLB file"
                      onClick={() => void share(m, 'glb')}
                    >
                      .glb
                    </button>
                    <button
                      class="btn"
                      data-testid={`buildings-share-${m.hash}`}
                      title="Share it as a building file: the model and its name, for a friend to add"
                      onClick={() => void share(m, 'building')}
                    >
                      Share
                    </button>
                    <button
                      class="btn"
                      data-testid={`buildings-send-${m.hash}`}
                      title="Send it to the game's maker: if it's picked, it goes in the game with your name"
                      onClick={() => game.openSubmit({ building: m.hash })}
                    >
                      Send it in
                    </button>
                    {deleting === m.hash ? (
                      <button
                        class="btn danger"
                        data-testid={`buildings-delete-yes-${m.hash}`}
                        onClick={() => {
                          setDeleting(null);
                          void game.buildings.remove(m.hash, game.looksInCity().includes(m.hash));
                        }}
                      >
                        Delete it
                      </button>
                    ) : (
                      <button
                        class="btn"
                        data-testid={`buildings-delete-${m.hash}`}
                        onClick={() => setDeleting(m.hash)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  {deleting === m.hash && (
                    <p class="muted buildings-note">
                      It goes from My buildings.
                      {game.looksInCity().includes(m.hash)
                        ? ' Buildings in this city still wear it, and its save keeps it.'
                        : ' Cities already saved with it keep it.'}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <label class="buildings-setting">
            <input
              type="checkbox"
              checked={game.settings.showFriendsBuildings}
              data-testid="buildings-friends"
              onChange={(e) => game.updateSettings({ showFriendsBuildings: e.currentTarget.checked })}
            />
            <span>Show friends' custom buildings (off: theirs show as the game's own)</span>
          </label>
        </div>
      )}
    </aside>
  );
}

/** Adding a model: its name, what it's for, then the check; problems in words with a picture. */
function ImportCard(props: {
  importing: Importing;
  set: (i: Importing) => void;
  onAdd: () => void;
  onCancel: () => void;
}) {
  const { importing: im, set } = props;
  const cantRead = !!im.why;
  const others = CIVIC_DEFS.filter(
    (d) => canHaveLook(d.id) && !im.suggested.some((t) => t.kind === 'look' && t.def === d.id),
  ).sort((a, b) => a.name.localeCompare(b.name));
  const landmarks = ([1, 2, 3, 4] as const).filter(
    (n) => !im.suggested.some((t) => t.kind === 'landmark' && t.size === n),
  );
  return (
    <section class="buildings-import" data-testid="buildings-import">
      <h3>Add a model</h3>
      {cantRead ? (
        <ul class="buildings-problems" data-testid="buildings-problems">
          <li data-testid="buildings-problem">{im.why}</li>
        </ul>
      ) : (
        <>
          <label class="buildings-field">
            <span class="muted">Name</span>
            <input
              type="text"
              maxLength={CUSTOM.nameChars}
              value={im.name}
              data-testid="buildings-name"
              onKeyDown={(e) => e.stopPropagation()}
              onInput={(e) => set({ ...im, name: e.currentTarget.value })}
            />
          </label>
          {im.size && (
            <p class="muted" data-testid="buildings-size">
              It is {im.size.w} m wide, {im.size.d} m deep and {im.size.h} m tall.
            </p>
          )}
          <label class="buildings-field">
            <span class="muted">What it's for</span>
            <select
              value={keyOf(im.target)}
              data-testid="buildings-target"
              disabled={im.busy}
              onChange={(e) => {
                const t = targetOf(e.currentTarget.value);
                if (t) set({ ...im, target: t, problems: null, picture: null });
              }}
            >
              {im.suggested.length > 0 && (
                <optgroup label="Its size fits">
                  {im.suggested.map((t) => (
                    <option key={keyOf(t)} value={keyOf(t)}>
                      {shortTarget(t)}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="A landmark of your own">
                {landmarks.map((n) => (
                  <option key={n} value={`landmark:${n}`}>
                    {`Landmark ${n}×${n} (${n * 8} × ${n * 8} m)`}
                  </option>
                ))}
              </optgroup>
              <optgroup label="A new look for">
                {others.map((d) => (
                  <option key={d.id} value={`look:${d.id}`}>
                    {`${d.name} (${d.w} × ${d.d} m)`}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <p class="muted">Checked as {targetLabel(im.target)}.</p>
          {im.problems && (
            <>
              <p class="buildings-refused" data-testid="buildings-refused">
                It can't go in the game yet:
              </p>
              <ul class="buildings-problems" data-testid="buildings-problems">
                {im.problems.map((p, i) => (
                  <li key={i} data-testid="buildings-problem">
                    {p.words}
                  </li>
                ))}
              </ul>
              {im.picture && (
                <img
                  class="buildings-picture"
                  src={im.picture}
                  alt="The model from above and from the front, its site outlined in green, the problem parts in red"
                  data-testid="buildings-picture"
                />
              )}
            </>
          )}
        </>
      )}
      <div class="buildings-actions">
        {!cantRead && (
          <button class="btn primary" data-testid="buildings-add" disabled={im.busy} onClick={props.onAdd}>
            {im.busy ? 'Checking…' : im.problems ? 'Check again' : 'Check and add'}
          </button>
        )}
        <button class="btn" data-testid="buildings-cancel" onClick={props.onCancel}>
          {cantRead ? 'Close' : 'Cancel'}
        </button>
      </div>
    </section>
  );
}

/** The model on a turntable, by day or night, in a season. */
function PreviewBox(props: { model: StoredModel; look: PreviewLook; setLook: (l: PreviewLook) => void }) {
  const { model, look, setLook } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<ModelPreview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!canvas.current) return;
    try {
      preview.current = new ModelPreview(canvas.current);
      preview.current.start();
    } catch {
      setFailed(true);
    }
    return () => {
      preview.current?.dispose();
      preview.current = null;
    };
  }, []);
  useEffect(() => {
    const p = preview.current;
    if (!p) return;
    p.show(assets.civicLook(targetId(model.target), 0, model.hash, model.baked));
  }, [model.hash]);
  useEffect(() => {
    preview.current?.setLook(look);
  }, [look.night, look.season]);
  return (
    <section class="buildings-preview" data-testid="buildings-preview">
      {failed ? (
        <p class="muted">This device can't draw the preview.</p>
      ) : (
        <canvas ref={canvas} data-testid="buildings-canvas" aria-label={`${model.name} on a turntable`} />
      )}
      <div class="buildings-looks" role="group" aria-label="Preview light and season">
        <button
          class={`btn ${look.night ? '' : 'active'}`}
          aria-pressed={!look.night}
          data-testid="buildings-day"
          onClick={() => setLook({ ...look, night: false })}
        >
          Day
        </button>
        <button
          class={`btn ${look.night ? 'active' : ''}`}
          aria-pressed={look.night}
          data-testid="buildings-night"
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
            data-testid={`buildings-season-${s}`}
            onClick={() => setLook({ ...look, season: s })}
          >
            {SEASON_WORDS[s]}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * A civic building's look (the inspector, M46): the game's own, or one of the player's models made
 * for that kind of building (or the one it wears, a friend's included).
 */
export function LookChooser(props: { civicId: number; def: string }) {
  const game = useGameUpdates(500);
  const c = game.world.civics.get(props.civicId);
  // A landmark of the player's own (M46) may wear any of their landmarks of its size.
  if (!c || !(canHaveLook(props.def) || CIVIC.get(props.def)?.category === 'custom')) return null;
  const mine = game.buildings.list().filter((m) => fitsTarget(m, targetOfDef(props.def)));
  const wearing = c.look ? game.buildings.get(c.look) : undefined;
  if (!mine.length && !c.look) return null;
  const off = customOff(game);
  const options = [...mine];
  if (wearing && !options.some((m) => m.hash === wearing.hash)) options.push(wearing);
  const hidden = !!c.look && !game.customModel(c.look, c.def);
  return (
    <div class="inspector-look">
      <label>
        <span class="muted">Look</span>
        <select
          value={c.look ?? ''}
          data-testid="inspector-look"
          disabled={off && !c.look}
          onChange={(e) => {
            const v = e.currentTarget.value || null;
            void game.dispatch({ type: 'setLook', civic: c.id, look: v }).then((r) => {
              if (!r.ok) game.toast(r.reason, 'bad');
            });
          }}
        >
          <option value="">The game's own</option>
          {options.map((m) => (
            <option key={m.hash} value={m.hash} disabled={off}>
              {m.mine ? m.name : `${m.name} (a friend's)`}
            </option>
          ))}
          {c.look && !wearing && <option value={c.look}>A friend's model (not here yet)</option>}
        </select>
      </label>
      {hidden && wearing && !wearing.mine && (
        <p class="muted">Friends' buildings are hidden in My buildings: it shows as the game's own.</p>
      )}
    </div>
  );
}
