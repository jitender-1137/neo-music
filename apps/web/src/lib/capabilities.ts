"use client";
import { api } from "./api";
import { isAppleMobile } from "./platform";
import { isNativeApp, nativePlatform } from "./native";

/** Ask the service worker for its cache counters (hit / miss / bypass / eviction / quota errors). */
export function cacheStats(timeoutMs = 1500): Promise<{ version: string; stats: { hit: number; miss: number; bypass: number; eviction: number; quotaError: number; bypassReasons: Record<string, number> }; entries: number; bytes: number; budget: number } | null> {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return Promise.resolve(null);
  return new Promise((resolve) => {
    const t = setTimeout(() => { navigator.serviceWorker.removeEventListener("message", on); resolve(null); }, timeoutMs);
    const on = (e: MessageEvent) => { if (e.data?.type !== "cache-stats") return; clearTimeout(t); navigator.serviceWorker.removeEventListener("message", on); resolve(e.data); };
    navigator.serviceWorker.addEventListener("message", on);
    sw.postMessage({ type: "cache-stats" });
  });
}

/** What this browser/device can do for playback — shown in Settings → Playback diagnostics. */
export async function capabilityReport(): Promise<[string, string][]> {
  const ms = typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null;
  const apple = isAppleMobile();
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const mb = (b?: number) => (b == null ? "?" : `${Math.round(b / 1048576)} MB`);
  const provider = await api.get<{ id: string; developmentOnly: boolean; audioCaching: string }>("/api/v1/provider").catch(() => null);
  const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const cs = await cacheStats();
  const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession?.type;
  const native = isNativeApp();
  return [
    ["Playback engine", native ? `native app (${nativePlatform()}: ${nativePlatform() === "android" ? "Media3 / ExoPlayer" : "AVPlayer"})` : "browser <audio>"],
    ["Secure context (HTTPS)", String(isSecureContext)],
    ["Installed app (standalone)", String(standalone)],
    ["Media Session API", ms ? "yes" : "no"],
    ["MediaMetadata", typeof MediaMetadata !== "undefined" ? "yes" : "no"],
    ["setPositionState", ms && "setPositionState" in ms ? "yes" : "no"],
    ["System controls registered", native ? "play, pause, stop, previous, next, seekto (carried out natively; ±10 s withheld)" : `play, pause, stop, previous, next, seekto${apple ? "" : ", seek ±10 s"}${apple ? " (±10 s withheld on iOS: it would replace ⏮ ⏭)" : ""}`],
    ["Audio session type", audioSession ?? "n/a (not iOS 17+ Safari)"],
    ["Volume level settable", apple ? "no — iOS hardware buttons only" : "yes (app level)"],
    ["Service worker", navigator.serviceWorker?.controller ? "active" : "not controlling (dev build or first load)"],
    ["Storage", est ? `${mb(est.usage)} used of ${mb(est.quota)}` : "unknown"],
    ["Music provider", provider ? `${provider.id}${provider.developmentOnly ? " (development tones)" : ""}` : "unreachable"],
    ["Audio caching", provider ? `${provider.audioCaching} — provider terms` : "?"],
    ["Cache (artwork + catalog)", cs ? `${cs.entries} items, ${mb(cs.bytes)} of ${mb(cs.budget)} budget · hit ${cs.stats.hit} · miss ${cs.stats.miss} · bypass ${cs.stats.bypass} · evicted ${cs.stats.eviction} · quota errors ${cs.stats.quotaError}` : "service worker not active"],
  ];
}
