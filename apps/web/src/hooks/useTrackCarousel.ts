"use client";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { rubberBand } from "@/lib/gesture";
import { springTo, stopSpring } from "@/lib/spring";

/**
 * YouTube Music–style track carousel. `strip` holds three slots side by side: previous (left),
 * current, next (right). A horizontal drag slides the strip with the finger so the neighbouring
 * song's cover/title come into view. On commit the strip finishes the slide, the track changes, and
 * the strip is reset instantly once the new current track has rendered, so the hand-off is seamless.
 * With nothing on that side it rubber-bands and springs back.
 */
export function useTrackCarousel(strip: RefObject<HTMLElement | null>, o: {
  trackId: string | undefined; hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; gap?: number;
  /** How far one slide travels (defaults to the slot width + gap). */
  travel?: () => number;
}) {
  const opts = useRef(o);
  opts.current = o;
  const awaiting = useRef(false);
  const fallback = useRef(0);

  const reset = (animate: boolean) => {
    const el = strip.current;
    if (!el) return;
    if (animate) { el.removeAttribute("data-dragging"); el.style.transform = ""; return; }
    el.setAttribute("data-dragging", "");
    el.style.transform = "";
    // Re-enable transitions after the instant reset has painted.
    requestAnimationFrame(() => requestAnimationFrame(() => el.removeAttribute("data-dragging")));
  };

  // The new current track rendered in the middle slot → snap the strip back without animation.
  useLayoutEffect(() => {
    if (!awaiting.current) return;
    awaiting.current = false;
    window.clearTimeout(fallback.current);
    reset(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.trackId]);

  const width = () => strip.current?.parentElement?.clientWidth ?? window.innerWidth;

  return {
    move(dx: number) {
      const el = strip.current;
      if (!el) return;
      stopSpring(el);
      let x = dx;
      if (dx > 0 && !opts.current.hasPrev) x = rubberBand(dx, 140);
      if (dx < 0 && !opts.current.hasNext) x = -rubberBand(-dx, 140);
      el.setAttribute("data-dragging", "");
      el.style.transform = `translate3d(${x}px, 0, 0)`;
    },
    /** Finish a swipe: the strip springs on with the finger's speed (`v`, px/ms) to the neighbour, or back. */
    end(dx: number, commit: boolean, v = 0) {
      const el = strip.current;
      const dir = dx < 0 ? 1 : -1;
      const allowed = dir > 0 ? opts.current.hasNext : opts.current.hasPrev;
      if (!el || !commit || !allowed) { springTo(el, "x", 0, v, () => reset(false)); return; }
      const go = dir > 0 ? opts.current.onNext : opts.current.onPrev;
      springTo(el, "x", -dir * (opts.current.travel?.() ?? width() + (opts.current.gap ?? 0)), v, () => {
        awaiting.current = true;
        go();
        // If the track didn't change (e.g. the next song is still being fetched), don't stay off-screen.
        fallback.current = window.setTimeout(() => { if (awaiting.current) { awaiting.current = false; springTo(el, "x", 0, 0, () => reset(false)); } }, 700);
      });
    },
    cancel() { springTo(strip.current, "x", 0, 0, () => reset(false)); },
  };
}
