/**
 * The battle map (M39, design call 6): a live battle from above, for the player commanding one and for
 * anyone watching. A canvas draws the roads, the buildings and their state, the ways in and the units
 * of both sides (`battleMapDraw.ts`); above it the status (time, strength, whether the room is waiting
 * for the other player, a side handed over); below it the orders. Units are chosen by a click, a dragged
 * box or "All", then an order button, and a click on a building or an attacker for Focus and Guard. The
 * arithmetic is in `battleMapView.ts`, the state in `Game.battleMap`, the battle in `Game.live`.
 */
import { useEffect, useRef } from 'preact/hooks';
import type { Game } from '../game';
import type { LiveView, OrderLogEntry } from '../client/liveBattles';
import { UNIT } from '../data/war';
import type { BattleFrame, Side } from '../sim/battle/types';
import { MapCache, drawBattleMap, readPalette, type DrawModel } from './battleMapDraw';
import {
  ORDER_NAMES,
  armedHint,
  battleClock,
  buildOrders,
  clickSelect,
  fitView,
  mapBounds,
  needsTarget,
  orderHelp,
  ordersFor,
  mapUnits,
  ownUnits,
  pictureOf,
  pruneSelection,
  sideOfView,
  standingUnit,
  STRUCT_WORDS,
  structAt,
  structStates,
  structsOf,
  targetOf,
  unitAt,
  unitsInBox,
  viewCentre,
  zoomBy,
  UNIT_PX,
  type MapView,
  type OrderChoice,
} from './battleMapView';
import { HelpSection } from './Help';
import { useGameUpdates } from './hooks';

/** A pointer moves this far (CSS pixels) before a press is a drag and not a click. */
const SLOP = { mouse: 5, touch: 10 } as const;

const colour = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** The panel, when it is open. */
export function BattleMapPanel() {
  const game = useGameUpdates(200);
  if (game.panel !== 'battleMap') return null;
  return <BattleMap game={game} />;
}

function BattleMap({ game }: { game: Game }) {
  const m = game.battleMap;
  const view = game.live.view();
  const pending = !view ? game.live.watchingId() : null;
  const frame = pictureOf(game, view);
  const side = sideOfView(view);
  const own = ownUnits(frame, side ?? 0);
  const ownIds = side === null ? [] : own.map((u) => u.id);
  if (side !== null) m.selected = m.all ? [...ownIds] : pruneSelection(m.selected, frame, side);
  const alive = side === null ? 0 : (frame?.sides[side]?.alive ?? 0);
  const chosen = m.all || m.selected.length > 0;
  const stepNow = frame?.step ?? view?.step ?? 0;
  const held = m.heldSince !== null && performance.now() - m.heldSince >= 1500;
  const locked =
    side === null
      ? 'Watching: no orders from here'
      : view?.handed
        ? 'Your forces are fighting on their own'
        : view?.over
          ? 'The battle is over'
          : null;
  const log = game.live.orderLog().slice(-3);
  const them = view ? (view.role === 'attacker' ? view.input.defender.name : view.input.attacker.name) : '';
  // How it ended: the last picture says so; for the city that hosted it, so does its report of the battle.
  const reported = view
    ? game.world.stats.war?.reports.find(
        (r) => r.replay === view.id || r.replay === `def-${view.id}`.slice(0, 60),
      )?.outcome
    : undefined;
  const outcome = frame?.outcome ?? reported ?? null;

  const refresh = () => game.notify();

  const press = (choice: OrderChoice) => {
    if (locked || side === null) return;
    if (!chosen) {
      m.note = 'Choose some units first';
      return refresh();
    }
    if (needsTarget(choice)) {
      m.armed = m.armed === choice ? null : choice;
      m.note = m.armed ? armedHint(choice, side) : null;
      return refresh();
    }
    sendOrder(game, choice, side, ownIds);
  };

  return (
    <aside
      class={`battle-map panel ${side === null ? 'watching' : ''}`}
      data-testid="battle-map"
      data-role={view?.role ?? 'pending'}
      role="dialog"
      aria-label="Battle map"
    >
      <header>
        <h2 data-testid="map-title">
          {!view
            ? 'Battle map'
            : view.role === 'attacker'
              ? `Your force in ${view.input.defender.name}`
              : `${view.input.attacker.name} against ${view.input.defender.name}`}
        </h2>
        {view && (
          <span class="battle-map-clock muted" data-testid="map-clock">
            {battleClock(stepNow)} of {battleClock(frame?.maxSteps ?? 1440)}
          </span>
        )}
        <button
          class="btn icon"
          aria-label="Close the battle map"
          data-testid="map-close"
          onClick={() => game.openPanel('battleMap')}
        >
          ×
        </button>
      </header>
      {!view ? (
        <p class="battle-map-wait" data-testid="map-joining">
          {pending ? 'Joining the battle…' : 'There is no live battle.'}
        </p>
      ) : (
        <>
          <Status
            game={game}
            view={view}
            frame={frame}
            side={side}
            held={held}
            them={them}
            outcome={outcome}
          />
          <Stage game={game} />
          <div class="battle-map-orders" data-testid="map-orders">
            {side !== null ? (
              <>
                <div class="battle-map-select">
                  <button
                    class="btn small"
                    data-testid="map-select-all"
                    disabled={!!view.over || !alive}
                    onClick={() => {
                      m.selected = [...ownIds];
                      m.all = true;
                      m.armed = null;
                      m.note = null;
                      refresh();
                    }}
                  >
                    All
                  </button>
                  <button
                    class="btn small"
                    data-testid="map-select-none"
                    disabled={!chosen}
                    onClick={() => {
                      m.selected = [];
                      m.all = false;
                      m.armed = null;
                      m.note = null;
                      refresh();
                    }}
                  >
                    None
                  </button>
                  <span class="muted" data-testid="map-selected">
                    {m.all
                      ? `All ${alive} unit${alive === 1 ? '' : 's'} selected`
                      : `${m.selected.length} of ${ownIds.length} selected`}
                  </span>
                </div>
                <div class="battle-map-buttons" role="group" aria-label="Orders">
                  {ordersFor(side).map((choice) => (
                    <button
                      key={choice}
                      class={`btn ${m.armed === choice ? 'active' : ''}`}
                      data-testid={`map-order-${choice}`}
                      disabled={!!locked || !chosen}
                      title={locked ?? (chosen ? orderHelp(choice, side) : 'Choose some units first')}
                      onClick={() => press(choice)}
                    >
                      {ORDER_NAMES[choice]}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p class="muted" data-testid="map-readonly">
                  You are watching. The two players give the orders; nothing here can be changed.
                </p>
                <HelpSection
                  game={game}
                  battle={view.id}
                  from={view.attacker}
                  to={view.defender}
                  over={view.over}
                />
              </>
            )}
            <p class="battle-map-hint" data-testid="map-hint" role="status">
              {m.armed && side !== null
                ? armedHint(m.armed, side)
                : (m.note ??
                  (side === null
                    ? ''
                    : 'Click a unit, drag a box round some, or press All; then give an order.'))}
            </p>
            {view.handed && side !== null && !view.over && (
              <div class="battle-map-handed" data-testid="map-handed" role="alert">
                <span>Your forces are fighting on their own: your page fell quiet for too long.</span>
                <button class="btn primary small" data-testid="map-rejoin" onClick={() => game.live.rejoin()}>
                  Take command again
                </button>
              </div>
            )}
            {side !== null && (
              <ul class="battle-map-log" data-testid="map-log">
                {log.map((e) => (
                  <li key={e.n} data-testid={`map-log-${e.n}`} data-state={e.state}>
                    <strong>{ORDER_NAMES[e.kind as OrderChoice] ?? e.kind}</strong>{' '}
                    {e.units === 'all' ? 'all units' : `${e.units} unit${e.units === 1 ? '' : 's'}`}
                    {targetText(view, frame, side, e)}
                    {' · '}
                    <span class="battle-map-ack">
                      {e.state === 'stamped'
                        ? `heard: order ${e.seq}, from step ${e.step}`
                        : e.state === 'unheard'
                          ? 'not heard by the room'
                          : e.state === 'sent'
                            ? 'sent…'
                            : 'on its way…'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

/** Where an order in the list was aimed, in words: a building by its name, an attacker by its sort. */
function targetText(view: LiveView, frame: BattleFrame | null, side: Side | null, e: OrderLogEntry): string {
  if (e.target === undefined) return '';
  if (e.kind === 'focus' && side === 1) {
    const u = mapUnits(frame ?? null).find((x) => x.id === e.target);
    return ` on ${u ? (UNIT.get(u.kind)?.name ?? u.kind).toLowerCase() : 'an attacker'}`;
  }
  const s = structsOf(view.input.layout)[e.target];
  if (!s) return ' at a building';
  const name = view.input.layout.names.find(([id]) => id === s.id)?.[1];
  return ` at ${name ?? STRUCT_WORDS[s.kind]}`;
}

/** Send the orders a button means for the chosen units, and say what happened. */
function sendOrder(game: Game, choice: OrderChoice, side: Side, ownIds: number[], target?: number): void {
  const m = game.battleMap;
  const r = buildOrders(choice, side, m.selected, ownIds, target, m.all);
  if ('problem' in r) {
    m.note = r.problem;
    return game.notify();
  }
  let sent = true;
  for (const o of r.orders) sent = game.live.order(o) && sent;
  m.armed = null;
  const n = m.selected.length;
  m.note = sent
    ? `${ORDER_NAMES[choice]} sent to ${m.all || n === ownIds.length ? 'all' : n} unit${n === 1 && !m.all ? '' : 's'}.`
    : 'The battle is over: no more orders.';
  game.notify();
}

// ----------------------------------------------------------------------------- the status

function Status(p: {
  game: Game;
  view: LiveView;
  frame: BattleFrame | null;
  side: Side | null;
  held: boolean;
  them: string;
  outcome: BattleFrame['outcome'];
}) {
  const { view, frame, side } = p;
  const sides = frame?.sides ?? [
    { name: view.input.attacker.name, color: view.input.attacker.color, alive: 0, total: 0 },
    { name: view.input.defender.name, color: view.input.defender.color, alive: 0, total: 0 },
  ];
  return (
    <div class="battle-map-status" data-testid="map-status">
      <div class="battle-map-sides" data-testid="map-sides">
        {sides.map((s, i) => (
          <span key={i} class={`battle-map-side ${i === 0 ? 'att' : 'def'}`} data-testid={`map-side-${i}`}>
            <i aria-hidden="true" />
            <strong>{s.name}</strong>
            {side === i ? ' (you)' : ''}: {s.alive} of {s.total}
          </span>
        ))}
        {(frame?.helpers ?? []).map((h) => (
          <span key={h.owner} class="battle-map-side ally" data-testid={`map-helper-${h.owner}`}>
            <i style={{ background: colour(h.color) }} aria-hidden="true" />
            {h.name} helps {h.side === 0 ? 'the attack' : 'the defence'}: {h.alive} of {h.total}
            {frame && frame.step < h.arrive ? ` (arrives at ${battleClock(h.arrive)})` : ''}
          </span>
        ))}
      </div>
      <div class="battle-map-detail muted" data-testid="map-detail">
        <span title="The step this page has run to, and the step the room lets both pages run to">
          step {frame?.step ?? view.step} · frontier {view.allow}
        </span>{' '}
        · {view.orders} order{view.orders === 1 ? '' : 's'} so far
      </div>
      <div class="battle-map-flagrow">
        {view.over || p.outcome ? (
          <p class="battle-map-flag over" data-testid="map-over" role="status">
            The battle is over:{' '}
            {p.outcome === 'raided'
              ? 'the attackers hit their targets.'
              : p.outcome === 'repelled'
                ? 'the defenders held.'
                : p.outcome === 'withdrew'
                  ? 'the attackers pulled out.'
                  : 'it ended.'}
          </p>
        ) : p.held && side !== null && !view.handed ? (
          <p class="battle-map-flag" data-testid="map-waiting" role="status">
            Waiting for {p.them}’s page to catch up…
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- the canvas

/** What the pointer is doing on the canvas. */
interface Pointer {
  id: number;
  type: string;
  x0: number;
  y0: number;
  x: number;
  y: number;
  button: number;
  shift: boolean;
  moved: boolean;
  /** `box` (a left drag with a mouse), `pan` (a touch or a middle/right drag). */
  mode: 'box' | 'pan';
  centre: { x: number; z: number };
}

function Stage({ game }: { game: Game }) {
  const m = game.battleMap;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ui = useRef<{
    pointer: Pointer | null;
    hover: { x: number; y: number } | null;
    view: MapView | null;
  }>({ pointer: null, hover: null, view: null });
  const cache = useRef(new MapCache());

  /** Everything a frame or a click needs, from the live battle as it stands now. */
  const current = (w: number, h: number) => {
    const v = game.live.view();
    const frame = pictureOf(game, v);
    if (!v) return null;
    cache.current.prepare(v.input.layout);
    const bounds = mapBounds(v.input.layout);
    const mv = fitView(bounds, w, h, m.zoom, m.centre);
    ui.current.view = mv;
    return { v, frame, side: sideOfView(v), mv };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const palette = readPalette(canvas);
    let raf = 0;
    let waiting = false;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(canvas.clientWidth));
      const h = Math.max(1, Math.round(canvas.clientHeight));
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      m.canvas = { w, h };
      const c = current(w, h);
      if (!c) return;
      const { v, frame, side, mv } = c;
      // Held at the room's frontier: it shows after a moment, as "waiting for …".
      const held = !v.over && !v.handed && side !== null && v.step >= v.allow - 1 && v.allow > 0;
      if (held && m.heldSince === null) m.heldSince = performance.now();
      else if (!held) m.heldSince = null;
      const nowWaiting = m.heldSince !== null && performance.now() - m.heldSince >= 1500;
      if (nowWaiting !== waiting) {
        waiting = nowWaiting;
        game.notify();
      }
      // Over: nobody is left to order, and the rings come off.
      if (v.over && (m.selected.length || m.all || m.armed)) {
        m.selected = [];
        m.all = false;
        m.armed = null;
        game.notify();
      }
      if (side !== null)
        m.selected = m.all ? ownUnits(frame, side).map((u) => u.id) : pruneSelection(m.selected, frame, side);
      const layout = v.input.layout;
      const states = structStates(frame, cache.current.structs.length);
      const hover = hoverOf(c, ui.current.hover);
      const p = ui.current.pointer;
      const model: DrawModel = {
        layout,
        frame,
        states,
        view: mv,
        side,
        selected: new Set(m.selected),
        hover: m.armed ? hover : null,
        box: p && p.mode === 'box' && p.moved ? { x0: p.x0, y0: p.y0, x1: p.x, y1: p.y } : null,
        time: t / 1000,
        dpr,
      };
      drawBattleMap(g, cache.current, model, palette);
    };
    /** What an armed order's target would be under the pointer (lit on the map). */
    const hoverOf = (c: NonNullable<ReturnType<typeof current>>, at: { x: number; y: number } | null) => {
      if (!at || !m.armed || c.side === null) return null;
      const kind = targetOf(m.armed, c.side);
      if (kind === 'structure') {
        const states = structStates(c.frame, cache.current.structs.length);
        const s = structAt(c.mv, cache.current.structs, states, at.x, at.y, 4, true);
        return s ? ({ kind: 'structure', k: s.k } as const) : null;
      }
      const u = unitAt(c.mv, mapUnits(c.frame), at.x, at.y, (x) => x.side === 0 && standingUnit(x));
      return u ? ({ kind: 'unit', id: u.id } as const) : null;
    };
    raf = requestAnimationFrame(loop);
    // Escape lets go of what is under way before it closes the map: the order waiting for its target,
    // then the chosen units.
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      if (m.armed) m.armed = null;
      else if (m.selected.length || m.all) {
        m.selected = [];
        m.all = false;
      } else return;
      m.note = null;
      e.preventDefault();
      e.stopImmediatePropagation();
      game.notify();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey, { capture: true });
    };
  }, [game]);

  const at = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: PointerEvent) => {
    const canvas = e.currentTarget as HTMLCanvasElement;
    const mv = ui.current.view;
    if (!mv || ui.current.pointer) return;
    const p = at(e);
    const touch = e.pointerType !== 'mouse';
    ui.current.pointer = {
      id: e.pointerId,
      type: e.pointerType,
      x0: p.x,
      y0: p.y,
      x: p.x,
      y: p.y,
      button: e.button,
      shift: e.shiftKey || e.ctrlKey || e.metaKey,
      moved: false,
      mode: touch || e.button !== 0 ? 'pan' : 'box',
      centre: viewCentre(mv),
    };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const move = (e: PointerEvent) => {
    const p = at(e);
    ui.current.hover = p;
    const d = ui.current.pointer;
    if (!d || d.id !== e.pointerId) return;
    d.x = p.x;
    d.y = p.y;
    const slop = d.type === 'mouse' ? SLOP.mouse : SLOP.touch;
    if (!d.moved && Math.hypot(d.x - d.x0, d.y - d.y0) >= slop) d.moved = true;
    const mv = ui.current.view;
    if (d.moved && d.mode === 'pan' && mv && m.zoom > 1) {
      m.centre = { x: d.centre.x - (d.x - d.x0) / mv.scale, z: d.centre.z - (d.y - d.y0) / mv.scale };
    }
  };

  const up = (e: PointerEvent) => {
    const d = ui.current.pointer;
    if (!d || d.id !== e.pointerId) return;
    ui.current.pointer = null;
    const canvas = canvasRef.current;
    const c = canvas ? current(Math.round(canvas.clientWidth), Math.round(canvas.clientHeight)) : null;
    if (!c) return;
    const { v, frame, side, mv } = c;
    if (d.moved) {
      if (d.mode === 'box' && side !== null && !v.over && !v.handed) {
        const picked = unitsInBox(
          mv,
          mapUnits(frame),
          d.x0,
          d.y0,
          d.x,
          d.y,
          (u) => u.side === side && standingUnit(u),
        );
        const ids = picked.map((u) => u.id);
        m.selected = d.shift ? [...new Set([...m.selected, ...ids])] : ids;
        m.all = false;
        m.note = ids.length ? null : 'No units in that box';
        game.notify();
      }
      return;
    }
    if (d.button !== 0 && d.type === 'mouse') return;
    click(c, d);
  };

  const click = (c: NonNullable<ReturnType<typeof current>>, d: Pointer) => {
    const { v, frame, side, mv } = c;
    if (side === null || v.over || v.handed) return;
    const ownIds = ownUnits(frame, side).map((u) => u.id);
    const touch = d.type !== 'mouse';
    if (m.armed) {
      const kind = targetOf(m.armed, side);
      if (kind === 'structure') {
        const states = structStates(frame, cache.current.structs.length);
        const s = structAt(mv, cache.current.structs, states, d.x, d.y, touch ? 12 : 4, true);
        if (!s) {
          m.note = 'Click a building that still stands';
          return game.notify();
        }
        return sendOrder(game, m.armed, side, ownIds, s.k);
      }
      const u = unitAt(
        mv,
        mapUnits(frame),
        d.x,
        d.y,
        (x) => x.side === 0 && standingUnit(x),
        UNIT_PX,
        touch ? 14 : 5,
      );
      if (!u) {
        m.note = 'Click an attacker';
        return game.notify();
      }
      return sendOrder(game, m.armed, side, ownIds, u.id);
    }
    const u = unitAt(
      mv,
      mapUnits(frame),
      d.x,
      d.y,
      (x) => x.side === side && standingUnit(x),
      UNIT_PX,
      touch ? 14 : 5,
    );
    m.all = false;
    if (u) m.selected = clickSelect(m.selected, u.id, d.shift || touch);
    else if (!touch) m.selected = [];
    m.note = null;
    game.notify();
  };

  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1 : -1);
  };

  const zoom = (dir: 1 | -1) => {
    const canvas = canvasRef.current;
    const mv = ui.current.view;
    if (!canvas || !mv) return;
    const here = m.centre ?? viewCentre(mv);
    m.zoom = zoomBy(m.zoom, dir);
    // Zooming in goes to what is chosen, if anything is; out comes back to the whole.
    const c = current(Math.round(canvas.clientWidth), Math.round(canvas.clientHeight));
    const chosen = mapUnits(c?.frame ?? null).filter((u) => m.selected.includes(u.id));
    if (dir > 0 && chosen.length)
      m.centre = {
        x: chosen.reduce((a, u) => a + u.x, 0) / chosen.length,
        z: chosen.reduce((a, u) => a + u.z, 0) / chosen.length,
      };
    else m.centre = here;
    if (m.zoom <= 1) m.centre = null;
    game.notify();
  };

  return (
    <div class="battle-map-stage">
      <canvas
        ref={canvasRef}
        class={`battle-map-canvas ${m.armed ? 'armed' : ''}`}
        data-testid="map-canvas"
        role="img"
        aria-label="The battle from above: roads, buildings, and the units of both sides"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => (ui.current.pointer = null)}
        onPointerLeave={() => (ui.current.hover = null)}
        onWheel={wheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div class="battle-map-zoom" role="group" aria-label="Zoom">
        <button class="btn icon" data-testid="map-zoom-in" aria-label="Zoom in" onClick={() => zoom(1)}>
          +
        </button>
        <button class="btn icon" data-testid="map-zoom-out" aria-label="Zoom out" onClick={() => zoom(-1)}>
          −
        </button>
        <button
          class="btn icon"
          data-testid="map-zoom-fit"
          aria-label="Show the whole battle"
          title="Show the whole battle"
          onClick={() => {
            m.zoom = 1;
            m.centre = null;
            game.notify();
          }}
        >
          ⤢
        </button>
      </div>
      <p class="battle-map-legend muted" data-testid="map-legend">
        Red arrows: attackers · blue squares: defenders · a ring: what the attackers are after
      </p>
    </div>
  );
}
