"use client";
import { useMemo, useRef } from "react";
import { directionOf, lockAxis, shouldCommit, velocityOf, type Axis, type Direction } from "@/lib/gesture";

export interface SwipeHandlers {
  /** Axes this surface reacts to. A drag that locks to another axis is left to the browser (e.g. scrolling). */
  axes: readonly Axis[];
  /** Surface length on an axis, for the commit threshold. */
  size?: (axis: Axis) => number;
  onStart?: (axis: Axis) => void;
  onMove?: (axis: Axis, delta: number) => void;
  /** Called once per gesture; `commit` says whether it crossed the threshold or was flicked.
   *  `velocity` is the finger's speed at release (px/ms, signed like delta) — feed it to a spring. */
  onEnd?: (axis: Axis, delta: number, commit: boolean, dir: Direction, velocity: number) => void;
  /** A finger touched down on the surface (lets callers catch a surface that is still springing). */
  onTouchDown?: () => void;
  onCancel?: (axis: Axis) => void;
  enabled?: boolean;
}

/** Starting a drag on these never begins a swipe (sliders, text, things that drag themselves). */
const IGNORE = 'input, textarea, select, [contenteditable="true"], [data-swipe-ignore]';
/** Leave the screen edges to the OS (Safari back/forward swipe). */
const EDGE_PX = 18;

/**
 * Pointer-event swipe recogniser for iOS Safari and other browsers. Pair it with a CSS `touch-action`
 * on the element: `none` where the surface owns every drag, `pan-y` where content must still scroll
 * vertically (horizontal swipes then still reach us). Movement under the slop stays a tap; once a
 * gesture is recognised the click that follows the pointerup is swallowed, so a swipe can never also
 * press the button it started on.
 */
export function useSwipe(h: SwipeHandlers) {
  const ref = useRef(h);
  ref.current = h;
  const g = useRef<{ id: number; x0: number; y0: number; axis: Axis | null; dead: boolean; samples: { t: number; v: number }[]; edge: boolean } | null>(null);
  const swallowClick = useRef(false);

  return useMemo(() => {
    const finish = (e: React.PointerEvent, cancelled: boolean) => {
      const s = g.current;
      if (!s || s.id !== e.pointerId) return;
      g.current = null;
      if (!s.axis || s.dead) return;
      swallowClick.current = true;
      // A click only follows a real pointerup; make sure a stale flag can't eat a later tap.
      setTimeout(() => (swallowClick.current = false), 400);
      const delta = s.axis === "x" ? e.clientX - s.x0 : e.clientY - s.y0;
      if (cancelled) { ref.current.onCancel?.(s.axis); return; }
      s.samples.push({ t: e.timeStamp, v: delta });
      const size = ref.current.size?.(s.axis) ?? (s.axis === "x" ? window.innerWidth : window.innerHeight);
      const v = velocityOf(s.samples);
      ref.current.onEnd?.(s.axis, delta, shouldCommit(delta, size, v), directionOf(s.axis, delta), v);
    };
    return {
      onPointerDown(e: React.PointerEvent) {
        // A new touch starts a new gesture: a stale "swallow" flag must never eat this tap.
        swallowClick.current = false;
        if (ref.current.enabled === false || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
        if ((e.target as Element).closest?.(IGNORE)) return;
        const edge = e.clientX < EDGE_PX || e.clientX > window.innerWidth - EDGE_PX;
        ref.current.onTouchDown?.();
        g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null, dead: false, samples: [], edge };
      },
      onPointerMove(e: React.PointerEvent) {
        const s = g.current;
        if (!s || s.id !== e.pointerId || s.dead) return;
        const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
        if (!s.axis) {
          const axis = lockAxis(dx, dy);
          if (!axis) return;
          if (!ref.current.axes.includes(axis) || (axis === "x" && s.edge)) { s.dead = true; return; }
          s.axis = axis;
          // Keep receiving moves even if the finger leaves the element.
          try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
          ref.current.onStart?.(axis);
        }
        const delta = s.axis === "x" ? dx : dy;
        s.samples.push({ t: e.timeStamp, v: delta });
        if (s.samples.length > 12) s.samples.shift();
        ref.current.onMove?.(s.axis, delta);
      },
      onPointerUp(e: React.PointerEvent) { finish(e, false); },
      onPointerCancel(e: React.PointerEvent) { finish(e, true); },
      onClickCapture(e: React.MouseEvent) {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    };
  }, []);
}
