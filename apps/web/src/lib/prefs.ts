"use client";
/**
 * Per-device UI preferences in localStorage (theme, sidebar, quality, autoplay). Every access is
 * guarded: private mode / blocked storage must never break the app.
 */
import { useSyncExternalStore } from "react";
import type { AudioQuality } from "@zuno/core";

export interface Prefs {
  theme: "system" | "dark" | "light";
  sidebarCollapsed: boolean;
  quality: AudioQuality;
  autoplay: boolean;
  hideExplicit: boolean;
  /** Stable random id for anonymous co-listening signals; never linked to an identity. */
  anonId: string;
}

const KEY = "zuno.prefs.v1";
const DEFAULTS: Prefs = { theme: "system", sidebarCollapsed: false, quality: "auto", autoplay: true, hideExplicit: false, anonId: "" };
let cache: Prefs | null = null;
const listeners = new Set<() => void>();

function read(): Prefs {
  if (cache) return cache;
  let stored: Partial<Prefs> = {};
  try { stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>; } catch { /* ignore */ }
  cache = { ...DEFAULTS, ...stored };
  if (!cache.anonId) {
    cache.anonId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
    write(cache);
  }
  return cache;
}
function write(p: Prefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

export function getPrefs(): Prefs {
  return typeof window === "undefined" ? DEFAULTS : read();
}
export function setPrefs(patch: Partial<Prefs>) {
  cache = { ...read(), ...patch };
  write(cache);
  for (const l of listeners) l();
}
export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => read(),
    () => DEFAULTS,
  );
}

export function applyTheme(theme: Prefs["theme"]) {
  if (typeof document === "undefined") return;
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  if (root.dataset.theme !== (dark ? "dark" : "light")) {
    // Swap instantly: suppress colour transitions for one frame so nothing fades through grey.
    root.classList.add("theme-switching");
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
  }
  root.dataset.theme = dark ? "dark" : "light";
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#0f0e17" : "#f9f8fc"));
}

/** Inline script for <head>: sets the theme before paint (no flash). */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem("${KEY}")||"{}");var t=p.theme||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){document.documentElement.dataset.theme="dark";}})();`;
