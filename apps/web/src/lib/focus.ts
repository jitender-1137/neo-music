"use client";

/**
 * Programmatic focus without stray focus rings on touch devices.
 *
 * iOS Safari draws its square focus outline for focus() calls even after a tap, so moving focus to a
 * button when a sheet opens left a visible box around it. We remember how the user last interacted:
 * keyboard users still get focus moved to the right control (with its ring); touch/mouse users get
 * focus parked on the container (tabIndex=-1, no outline), so screen readers still land inside it.
 */
let keyboard = false;
if (typeof document !== "undefined") {
  document.addEventListener("keydown", (e) => { if (!e.metaKey && !e.ctrlKey && !e.altKey) keyboard = true; }, true);
  document.addEventListener("pointerdown", () => { keyboard = false; }, true);
}

export const usingKeyboard = () => keyboard;

/** Focus `target` for keyboard users, otherwise `fallback` (a tabIndex=-1 container) — never showing a ring after touch. */
export function focusFor(target: HTMLElement | null | undefined, fallback?: HTMLElement | null) {
  const el = keyboard ? target : fallback ?? target;
  if (!el) return;
  el.focus({ preventScroll: true, focusVisible: keyboard } as FocusOptions);
}

/** On close: return focus for keyboard users; for touch just drop it so nothing shows a ring. */
export function restoreFocus(target: HTMLElement | null | undefined) {
  if (keyboard) target?.focus({ preventScroll: true });
  else (document.activeElement as HTMLElement | null)?.blur?.();
}
