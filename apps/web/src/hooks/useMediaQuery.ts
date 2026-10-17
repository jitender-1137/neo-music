"use client";
import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** The phone layout (tab bar, mini-player, sheets). Matches Tailwind's `max-md`. */
export const PHONE_QUERY = "(max-width: 767.98px)";
