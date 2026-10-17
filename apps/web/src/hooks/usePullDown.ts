"use client";
import { useEffect, useRef } from "react";
import { velocityOf } from "@/lib/gesture";

/**
 * iOS sheet behaviour for a scrolling list inside a sheet: when the list is already at the top,
 * pulling down anywhere on it moves the sheet instead (no more scrolling to do). Otherwise the
 * list scrolls natively. Uses touch events because only a non-passive touchmove can stop the
 * browser's own scroll at the moment we take over.
 */
export function usePullDown(el: HTMLElement | null, h: {
  enabled: boolean;
  onMove: (dy: number) => void;
  /** dy = how far it was pulled (px), v = release speed (px/ms, positive = downward). */
  onEnd: (dy: number, v: number) => void;
}) {
  const hr = useRef(h);
  hr.current = h;
  // Takes the element itself (from a callback ref), so it attaches the moment the list exists — it
  // often doesn't on first mount (no song loaded yet, or a sheet that renders its content later).
  useEffect(() => {
    if (!el || !h.enabled) return;
    let x0 = 0, y0 = 0, dy = 0, decided = false, pulling = false;
    let samples: { t: number; v: number }[] = [];
    const start = (e: TouchEvent) => {
      // Things that drag themselves (queue reorder handles, sliders) keep their own gesture.
      decided = !hr.current.enabled || e.touches.length !== 1 || !!(e.target as Element | null)?.closest?.('[data-swipe-ignore], input, textarea, select');
      pulling = false; dy = 0; samples = [];
      if (decided) return;
      x0 = e.touches[0]!.clientX; y0 = e.touches[0]!.clientY;
    };
    const move = (e: TouchEvent) => {
      if (decided && !pulling) return;
      const t = e.touches[0]!;
      const ddy = t.clientY - y0, ddx = t.clientX - x0;
      if (!decided) {
        if (Math.abs(ddy) < 8 && Math.abs(ddx) < 8) return;
        decided = true;
        // Take over only for a downward, mostly-vertical pull while the list sits at its top.
        pulling = ddy > 0 && Math.abs(ddy) > Math.abs(ddx) * 1.2 && el.scrollTop <= 0;
        if (!pulling) return;
        y0 = t.clientY; // start from here so the sheet doesn't jump by the slop distance
      }
      e.preventDefault(); // stop the browser's scroll / rubber-band; the sheet moves instead
      dy = Math.max(0, t.clientY - y0);
      samples.push({ t: e.timeStamp, v: dy });
      if (samples.length > 12) samples.shift();
      hr.current.onMove(dy);
    };
    const end = (e: TouchEvent) => {
      if (pulling) { samples.push({ t: e.timeStamp, v: dy }); hr.current.onEnd(dy, velocityOf(samples)); }
      decided = false; pulling = false;
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [el, h.enabled]);
}
