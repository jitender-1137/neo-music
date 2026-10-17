"use client";
import { useEffect } from "react";

/**
 * Blocks pinch-zoom in iOS Safari, which ignores `user-scalable=no` in the browser (the installed
 * PWA honours it). WebKit fires non-standard `gesture*` events for pinches; cancelling them, and any
 * two-finger touchmove, keeps the page at 1×. Single-finger scrolling and our swipes are untouched.
 */
export function ZoomLock() {
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    const twoFinger = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault(); };
    for (const t of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(t, stop, { passive: false });
    document.addEventListener("touchmove", twoFinger, { passive: false });
    return () => {
      for (const t of ["gesturestart", "gesturechange", "gestureend"]) document.removeEventListener(t, stop);
      document.removeEventListener("touchmove", twoFinger);
    };
  }, []);
  return null;
}
