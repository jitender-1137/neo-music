"use client";
/**
 * PWA install state. Chromium (Android, desktop Chrome/Edge) fires `beforeinstallprompt`, which
 * we hold until the user taps "Install". iOS Safari has no prompt API — we show "Share → Add to
 * Home Screen" instructions instead. Installed (standalone) sessions show nothing.
 */
import { useSyncExternalStore } from "react";

type BIPEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
export type InstallState = { kind: "installed" } | { kind: "prompt" } | { kind: "ios" } | { kind: "unavailable" };

let deferred: BIPEvent | null = null;
let installed = false;
const UNAVAILABLE: InstallState = { kind: "unavailable" };
let snapshot: InstallState = UNAVAILABLE;
const listeners = new Set<() => void>();

function compute(): InstallState {
  if (typeof window === "undefined") return UNAVAILABLE;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone || installed) return { kind: "installed" };
  if (deferred) return { kind: "prompt" };
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  if (ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)) return { kind: "ios" };
  return UNAVAILABLE;
}
function emit() {
  const next = compute();
  if (next.kind !== snapshot.kind) { snapshot = next; for (const l of listeners) l(); }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as BIPEvent; emit(); });
  window.addEventListener("appinstalled", () => { installed = true; deferred = null; emit(); });
  snapshot = compute();
}

export function useInstallState(): InstallState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => snapshot, () => UNAVAILABLE);
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  if (outcome === "accepted") installed = true;
  emit();
  return outcome === "accepted";
}
