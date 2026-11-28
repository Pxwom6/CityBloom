/**
 * Touch helpers for the whole interface (M49), installed once at start-up:
 * - a long press on anything with a `title` shows that title in a bubble (desktop's tooltip), and the
 *   lifted finger doesn't also press it;
 * - on a phone, a panel opened as a sheet closes when its header is dragged down (upright) or to the
 *   right (sideways), as sheets do on phones.
 */
import { LONG_PRESS_MS } from '../tools/manager';

/** How far (px) a finger may wander and still be a long press; how far a sheet is dragged to close. */
const SLOP = 10;
const CLOSE_DRAG = 80;
/** How long a title's bubble stays (ms). */
const BUBBLE_MS = 4000;

export function installTouch(root: HTMLElement): void {
  let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number; id: number } | null = null;
  let swallowClick = 0;
  let bubble: HTMLDivElement | null = null;
  let bubbleTimer: ReturnType<typeof setTimeout> | null = null;

  const hideBubble = () => {
    bubble?.remove();
    bubble = null;
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = null;
  };
  const showBubble = (el: HTMLElement, text: string) => {
    hideBubble();
    const b = document.createElement('div');
    b.className = 'touch-tip';
    b.setAttribute('role', 'tooltip');
    b.dataset.testid = 'touch-tip';
    b.textContent = text;
    root.appendChild(b);
    const r = el.getBoundingClientRect();
    const w = b.offsetWidth;
    const h = b.offsetHeight;
    const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    // Above the finger where there's room, else below.
    const y = r.top - h - 10 > 8 ? r.top - h - 10 : Math.min(innerHeight - h - 8, r.bottom + 10);
    b.style.left = `${x}px`;
    b.style.top = `${y}px`;
    bubble = b;
    bubbleTimer = setTimeout(hideBubble, BUBBLE_MS);
  };
  const endPress = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };

  root.addEventListener(
    'pointerdown',
    (e) => {
      hideBubble();
      if (e.pointerType === 'mouse') return;
      const target = e.target as HTMLElement | null;
      // The toolbar's own tooltips open themselves (Toolbar's Tip).
      if (!target || target.closest('.tip-anchor')) return;
      const el = target.closest<HTMLElement>('[title]');
      const text = el?.getAttribute('title');
      if (!el || !text) return;
      endPress();
      press = {
        x: e.clientX,
        y: e.clientY,
        id: e.pointerId,
        timer: setTimeout(() => {
          press = null;
          swallowClick = performance.now();
          showBubble(el, text);
          navigator.vibrate?.(10);
        }, LONG_PRESS_MS),
      };
    },
    true,
  );
  root.addEventListener(
    'pointermove',
    (e) => {
      if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP)
        endPress();
    },
    true,
  );
  root.addEventListener('pointerup', endPress, true);
  root.addEventListener('pointercancel', endPress, true);
  root.addEventListener(
    'click',
    (e) => {
      // The long press showed the title: lifting the finger isn't a press of what it was on.
      if (swallowClick && performance.now() - swallowClick < 1000) {
        swallowClick = 0;
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );

  // Sheets (phones): drag a panel's header down, or right when held sideways, to close it.
  let drag: { panel: HTMLElement; x: number; y: number; id: number; side: boolean; d: number } | null = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || root.dataset.phone === undefined) return;
    const target = e.target as HTMLElement | null;
    const head = target?.closest<HTMLElement>('aside.panel > header');
    if (!head || target!.closest('button, input, select, a, [role=tab]')) return;
    const panel = head.parentElement!;
    drag = {
      panel,
      x: e.clientX,
      y: e.clientY,
      id: e.pointerId,
      side: root.dataset.orient === 'landscape',
      d: 0,
    };
    panel.style.transition = 'none';
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.d = Math.max(0, drag.side ? e.clientX - drag.x : e.clientY - drag.y);
    drag.panel.style.transform = drag.side ? `translateX(${drag.d}px)` : `translateY(${drag.d}px)`;
  });
  const dropSheet = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { panel, d } = drag;
    drag = null;
    panel.style.transition = '';
    panel.style.transform = '';
    if (d < CLOSE_DRAG) return;
    const close = panel.querySelector<HTMLElement>(':scope > header [aria-label^="Close"]');
    close?.click();
  };
  root.addEventListener('pointerup', dropSheet);
  root.addEventListener('pointercancel', dropSheet);
}
