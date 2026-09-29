import { useState } from 'preact/hooks';
import { CLIMATES, type ClimateId } from '../data/climate';
import { MAP_BRUSHES, MAP_EDIT, type MapBrush, type MapBrushGroup } from '../data/mapEditor';
import { START_NEED } from '../sim/terrain/customMap';
import type { MapToolMode } from '../tools/mapTool';
import { useGameUpdates } from './hooks';
import {
  IconClearForest,
  IconEraser,
  IconForest,
  IconHighwayEntry,
  IconLand,
  IconLevel,
  IconLower,
  IconOil,
  IconOre,
  IconRailEntry,
  IconRaise,
  IconRedo,
  IconSea,
  IconSmooth,
  IconUndo,
  IconWater,
} from './icons';
import { MapLegend, ToolButton, ToolHintLabel } from './Toolbar';

/**
 * The map editor's screen (M24): the map's name and climate, whether it's playable, save, export
 * and play along the top; the brushes and the highway and railway entries along the bottom; and
 * the playability check beside. DESIGN.md §3.25.
 */
const BRUSH_ICON: Record<MapBrush, typeof IconRaise> = {
  raise: IconRaise,
  lower: IconLower,
  level: IconLevel,
  smooth: IconSmooth,
  water: IconWater,
  sea: IconSea,
  land: IconLand,
  forest: IconForest,
  clearForest: IconClearForest,
  ore: IconOre,
  oil: IconOil,
  clearResources: IconEraser,
};

const GROUPS: MapBrushGroup[] = ['Sculpt', 'Water', 'Forests', 'Resources'];

function EditorBar() {
  const game = useGameUpdates(250);
  const ed = game.editor!;
  const m = game.world.stats.map;
  const [name, setName] = useState(m?.name ?? '');
  const check = ed.check;
  const rename = () => {
    const n = name.trim();
    if (!n || n === m?.name) return;
    void game.dispatch({ type: 'setMapInfo', name: n }).then((r) => r.ok && ed.changed());
  };
  return (
    <div class="topbar panel editor-bar" data-testid="editor-bar">
      <span class="city">Map editor</span>
      <span class="divider" />
      <input
        class="editor-name"
        type="text"
        maxLength={40}
        value={name}
        aria-label="Map name"
        data-testid="editor-name"
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        onBlur={rename}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <label class="editor-climate" title="The climate its cities will have: seasons, snow and weather">
        <span class="label">Climate</span>
        <select
          data-testid="editor-climate"
          value={m?.climate}
          onChange={(e) => {
            const climate = (e.target as HTMLSelectElement).value as ClimateId;
            void game.dispatch({ type: 'setMapInfo', climate }).then((r) => r.ok && ed.changed());
          }}
        >
          {(Object.keys(CLIMATES) as ClimateId[]).map((c) => (
            <option key={c} value={c}>
              {CLIMATES[c].name}
            </option>
          ))}
        </select>
      </label>
      <button
        class={`editor-status ${check ? (check.ok ? 'ok' : 'bad') : ''}`}
        data-testid="editor-status"
        title="The playability check: open its details"
        onClick={() => game.openPanel('editorCheck')}
      >
        {!check
          ? 'Checking…'
          : check.ok
            ? '✓ Playable'
            : `⚠ ${check.problems.length} ${check.problems.length === 1 ? 'problem' : 'problems'}`}
      </button>
      <span class="divider" />
      <button class="btn icon" aria-label="Undo" title="Undo (Ctrl/⌘+Z)" onClick={() => void game.undo()}>
        <IconUndo />
      </button>
      <button class="btn icon" aria-label="Redo" title="Redo" onClick={() => void game.redo()}>
        <IconRedo />
      </button>
      <button class="btn" data-testid="editor-save" onClick={() => void ed.save()}>
        Save{ed.dirty ? ' •' : ''}
      </button>
      <button class="btn" data-testid="editor-export" onClick={() => void ed.exportFile()}>
        Export file
      </button>
      <button class="btn active" data-testid="editor-play" onClick={() => void ed.play()}>
        Play this map
      </button>
      <button
        class="btn"
        data-testid="editor-exit"
        onClick={() => void ed.save(true).finally(() => (location.href = location.pathname))}
      >
        Main menu
      </button>
    </div>
  );
}

function EditorTools() {
  const game = useGameUpdates(200);
  const t = game.tools.map;
  const pick = (m: MapToolMode) => {
    if (game.tools.activeId !== 'map') game.tools.use('map');
    t.setMode(m);
  };
  return (
    <div class="toolbar-wrap">
      {!t.entry && (
        <div class="subbar panel" data-testid="editor-brush">
          <label class="brush">
            Brush
            <input
              type="range"
              data-testid="editor-radius"
              min={MAP_EDIT.radius.min}
              max={MAP_EDIT.radius.max}
              step={16}
              value={t.radius}
              onInput={(e) => {
                t.radius = Number((e.target as HTMLInputElement).value);
                game.notify();
              }}
            />
            <span>{t.radius} m</span>
          </label>
          <label class="brush">
            Strength
            <input
              type="range"
              data-testid="editor-strength"
              min={MAP_EDIT.strength.min}
              max={MAP_EDIT.strength.max}
              step={0.25}
              value={t.strength}
              onInput={(e) => {
                t.strength = Number((e.target as HTMLInputElement).value);
                game.notify();
              }}
            />
            <span>{t.strength}×</span>
          </label>
          <span class="subbar-note">[ ] brush · , . strength · hold to keep going</span>
        </div>
      )}
      <div class="toolbar panel editor-tools" data-testid="editor-tools">
        {GROUPS.flatMap((g, gi) => [
          ...(gi > 0 ? [<span class="sep" key={`sep-${g}`} />] : []),
          <span class="editor-group" key={`label-${g}`}>
            {g}
          </span>,
          ...MAP_BRUSHES.filter((b) => b.group === g).map((b) => {
            const Icon = BRUSH_ICON[b.id];
            return (
              <ToolButton
                key={b.id}
                id={`brush-${b.id}`}
                active={t.mode === b.id}
                onClick={() => pick(b.id)}
                tip={{ title: b.name, lines: [b.blurb] }}
              >
                <Icon />
              </ToolButton>
            );
          }),
        ])}
        <span class="sep" />
        <span class="editor-group">Entries</span>
        <ToolButton
          id="entry-highway"
          active={t.mode === 'highway'}
          onClick={() => pick('highway')}
          tip={{
            title: 'Highway entry',
            lines: ['Click on the west edge where the regional highway comes in. Cities start beside it.'],
          }}
        >
          <IconHighwayEntry />
        </ToolButton>
        <ToolButton
          id="entry-rail"
          active={t.mode === 'rail'}
          onClick={() => pick('rail')}
          tip={{
            title: 'Railway entry',
            lines: [
              'Click on the west edge where the regional railway comes in (it needs gentle, dry land).',
            ],
          }}
        >
          <IconRailEntry />
        </ToolButton>
        {game.world.stats.map?.railZ !== null && (
          <button
            class="btn small"
            data-testid="entry-rail-none"
            title="A map without a railway"
            onClick={() =>
              void game
                .dispatch({ type: 'setMapEntry', entry: 'rail', z: null })
                .then((r) => r.ok && game.editor?.changed())
            }
          >
            No railway
          </button>
        )}
      </div>
    </div>
  );
}

function CheckPanel() {
  const game = useGameUpdates(300);
  const check = game.editor?.check;
  if (game.panel !== 'editorCheck' || !check) return null;
  const go = (at?: { x: number; z: number }) =>
    at && game.setCamera({ x: at.x + 200, z: at.z, distance: 900, yaw: 0, tilt: 0.8 });
  return (
    <aside class="advisors editor-check panel" data-testid="editor-check">
      <header>
        <h2>Playability</h2>
        <button class="btn icon" aria-label="Close" onClick={() => game.openPanel('editorCheck')}>
          ×
        </button>
      </header>
      <div class="advisors-list">
        <p class={check.ok ? 'good' : 'bad'} data-testid="editor-verdict">
          {check.ok
            ? 'Playable: a city can start by the highway. Save it and it appears on the new-city screen.'
            : 'Not playable yet. Fix these, and a city can start here:'}
        </p>
        {check.problems.map((p) => (
          <button class="editor-issue bad" key={p.text} onClick={() => go(p.at)}>
            ⚠ {p.text}
          </button>
        ))}
        {check.warnings.map((p) => (
          <button class="editor-issue warn" key={p.text} onClick={() => go(p.at)}>
            {p.text}
          </button>
        ))}
        <dl class="editor-stats">
          <dt>Buildable near the highway</dt>
          <dd data-testid="editor-start">
            {check.startArea} ha (needs {START_NEED})
          </dd>
          <dt>Water</dt>
          <dd>{Math.round(check.water * 100)} % of the map</dd>
          <dt>Forest</dt>
          <dd>{Math.round(check.forest * 100)} % of the map</dd>
          <dt>Ore and oil</dt>
          <dd>
            {check.ore ? `${(check.ore * 0.0256).toFixed(1)} ha of ore` : 'no ore'},{' '}
            {check.oil ? `${(check.oil * 0.0256).toFixed(1)} ha of oil` : 'no oil'}
          </dd>
        </dl>
      </div>
    </aside>
  );
}

export function EditorApp() {
  return (
    <>
      <EditorBar />
      <EditorTools />
      <CheckPanel />
      <MapLegend />
      <ToolHintLabel />
    </>
  );
}
