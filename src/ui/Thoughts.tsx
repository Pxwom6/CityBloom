import { useEffect, useRef, useState } from 'preact/hooks';
import type { Thought } from '../sim/systems/thoughts';
import { useGameUpdates } from './hooks';
import { IconChat } from './icons';

/** A small feed of what residents and businesses are saying; click one to see where. */
export function ThoughtsFeed() {
  const game = useGameUpdates(200);
  const [list, setList] = useState<Thought[]>([]);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () =>
      void game.client.query<Thought[]>({ type: 'thoughts', count: 6 }).then((r) => live && setList(r));
    load();
    const t = setInterval(load, 8000);
    const r = setInterval(() => setShown((n) => n + 1), 4500);
    return () => {
      live = false;
      clearInterval(t);
      clearInterval(r);
    };
  }, [game]);
  // A press on the feed that turns into a drag pans the map, as it would anywhere else on it.
  const stopWatching = useRef<(() => void) | null>(null);
  useEffect(() => () => stopWatching.current?.(), []);
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    stopWatching.current?.();
    const { clientX: sx, clientY: sy, pointerId } = e;
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      stopWatching.current = null;
    };
    const move = (m: PointerEvent) => {
      if (Math.hypot(m.clientX - sx, m.clientY - sy) < 6) return;
      stop();
      game.renderer.controller.beginDrag('pan', sx, sy, pointerId);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    stopWatching.current = stop;
  };
  // Side panels and the data-map legend sit where the feed does, and while building the map needs
  // every pixel: the feed steps aside for all of them.
  if (!list.length || game.world.stats.population === 0 || game.panel) return null;
  if (game.tools.activeId !== 'select' || game.overlay.active) return null;
  const items = [list[shown % list.length]!, list[(shown + 1) % list.length]!].filter(
    (x, i, a) => a.findIndex((y) => y.id === x.id) === i,
  );
  return (
    <div class="thoughts panel" data-testid="thoughts" onPointerDown={onPointerDown}>
      {items.map((t) => (
        <button
          key={`${t.id}:${t.text}`}
          class={`thought ${t.mood < 0 ? 'sad' : t.mood > 0 ? 'glad' : ''}`}
          onClick={() => {
            game.flyTo({ x: t.x, z: t.z });
            if (game.world.buildings.has(t.id)) game.select({ kind: 'building', id: t.id });
          }}
        >
          <IconChat />
          <span class="thought-text">“{t.text}”</span>
          <span class="thought-who">{game.names.address(t.x, t.z)}</span>
        </button>
      ))}
    </div>
  );
}
