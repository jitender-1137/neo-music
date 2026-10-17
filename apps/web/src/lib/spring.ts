"use client";
import { animate } from "motion";

/**
 * iOS-style spring for gesture releases. On iOS a sheet doesn't "play an animation" when you let
 * go — it continues with your finger's speed into a spring: a fast flick shoots home, a slow release
 * eases in, nothing stops abruptly. ~0.4 s response, damping just under critical (a hint of overshoot).
 */
export const IOS_SPRING = { type: "spring" as const, stiffness: 280, damping: 31, mass: 1, restDelta: 0.4, restSpeed: 4 };

type Axis = "x" | "y";
const running = new WeakMap<HTMLElement, { stop: () => void }>();

const reduceMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The element's current translate on an axis, in px (whatever set it: finger, spring, or CSS). */
export function currentTranslate(el: HTMLElement, axis: Axis): number {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  const m = new DOMMatrixReadOnly(t);
  return axis === "y" ? m.m42 : m.m41;
}

/** Stop any spring running on `el` (e.g. a new finger touch interrupts it — iOS lets you catch a moving sheet). */
export function stopSpring(el: HTMLElement | null | undefined) {
  if (!el) return;
  running.get(el)?.stop();
  running.delete(el);
}

/**
 * Spring `el`'s translate from where it is now to `to` (px), starting at `velocity` (px/ms, the
 * finger's speed at release). While it runs the element keeps `data-dragging` (CSS transitions off,
 * inline transform wins); `done` runs at rest — callers clear the inline style there so the CSS
 * state (already matching `to`) takes over without a jump.
 */
export function springTo(el: HTMLElement | null | undefined, axis: Axis, to: number, velocity: number, done?: () => void, extra?: (v: number) => void) {
  if (!el) { done?.(); return; }
  stopSpring(el);
  const from = currentTranslate(el, axis);
  const set = (v: number) => {
    el.style.transform = axis === "y" ? `translate3d(0, ${v}px, 0)` : `translate3d(${v}px, 0, 0)`;
    extra?.(v);
  };
  el.setAttribute("data-dragging", "");
  if (reduceMotion() || Math.abs(to - from) < 0.5) { set(to); done?.(); return; }
  const controls = animate(from, to, {
    ...IOS_SPRING,
    velocity: velocity * 1000, // px/ms → px/s
    onUpdate: set,
    onComplete: () => { running.delete(el); done?.(); },
  });
  running.set(el, controls);
}

/** Clear finger/spring styles so the element's CSS state applies again. */
export function release(el: HTMLElement | null | undefined) {
  if (!el) return;
  stopSpring(el);
  el.removeAttribute("data-dragging");
  el.style.transform = "";
  el.style.opacity = "";
}
