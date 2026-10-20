"use client";
/**
 * The one player for the whole app. Created once per page load, outside React rendering, so
 * route changes, re-renders and remounts can never restart or duplicate audio.
 */
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Track } from "@zuno/core";
import { NativeAudioElement, NativeMediaSession, PlayerEngine, browserMediaSession, nowPlaying, type AudioLike, type NativeAudioBridge, type PlayerState } from "@zuno/player";
import { attachAudioLog, logPlayback } from "./playbackLog";
import { attachNativeAudioLog, isNativeApp, nativeAudioBridge } from "./native";
import { isAppleMobile, isStandaloneApp } from "./platform";
import { getMusicSource, playsInEmbed } from "./musicSource";
import { EMBED_PREFIX, HybridAudio } from "./ytEmbed";
import { api, ApiError } from "./api";
import { getPrefs } from "./prefs";
import { addHistory, loadSession, saveSession } from "./guestDb";
import { track as trackEvent, startEventFlusher } from "./events";

const TOKEN_KEY = "zuno.playbackToken.v1";
let token: { token: string; expiresAt: number } | null = null;
let tokenFlight: Promise<void> | null = null;

/** Token synchronously if we have a fresh one; otherwise null (caller falls back to async). */
function readToken(): string | null {
  if (token && token.expiresAt - Date.now() > 3600_000) return token.token;
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? "null") as typeof token;
    if (t && t.expiresAt - Date.now() > 3600_000) { token = t; return t.token; }
  } catch { /* ignore */ }
  return null;
}

/** Whether the cached token stays valid for at least `ms` more. */
function tokenFreshFor(ms: number): boolean {
  return !!token && token.expiresAt - Date.now() > ms;
}

function refreshToken(): Promise<void> {
  if (!tokenFlight) {
    tokenFlight = api.post<{ token: string; expiresAt: string }>("/api/v1/playback/token")
      .then((r) => {
        token = { token: r.token, expiresAt: new Date(r.expiresAt).getTime() };
        try { localStorage.setItem(TOKEN_KEY, JSON.stringify(token)); } catch { /* ignore */ }
      })
      .catch(() => undefined)
      .finally(() => { tokenFlight = null; });
  }
  return tokenFlight;
}

/** Opus/WebM only where the browser says "probably" (Chromium/Firefox); AAC everywhere else (Safari/iOS). */
function preferMp4(audio: HTMLAudioElement) {
  return audio.canPlayType('audio/webm; codecs="opus"') !== "probably";
}

let signedIn = false;
export function setPlayerSignedIn(v: boolean) { signedIn = v; }

/** Log every lock-screen / notification / headset command as it arrives (Settings → Playback diagnostics). */
function withActionLog(ms: ReturnType<typeof browserMediaSession>): ReturnType<typeof browserMediaSession> {
  return {
    ...ms,
    setHandlers(h) {
      ms.setHandlers(Object.fromEntries(Object.entries(h).map(([k, fn]) => [k, fn ? (d?: { seekTime?: number; seekOffset?: number }) => {
        logPlayback(`command:${k}`, d?.seekTime != null ? `to=${d.seekTime.toFixed(1)}` : document.visibilityState);
        fn(d);
      } : null])) as typeof h);
    },
  };
}

/** The browser's media element: one hidden <audio> for the whole app. */
function createHtmlAudio(): HTMLAudioElement {
  const audio = new Audio();
  audio.preload = "auto";
  audio.setAttribute("playsinline", "");
  audio.setAttribute("aria-hidden", "true");
  audio.style.display = "none";
  document.body.appendChild(audio);
  attachAudioLog(audio, () => navigator.mediaSession?.playbackState ?? "n/a");
  return audio;
}

/**
 * Keep the native player told what comes next, as soon as it changes — not just near the end of
 * the song like `prefetch` — so a track ending (or ⏭ on the lock screen) moves on natively even
 * while the page is suspended.
 */
function queueNextNatively(engine: PlayerEngine, bridge: NativeAudioBridge, url: (t: Track, token: string) => string, skip: () => boolean = () => false) {
  let sent = "";
  const update = () => {
    if (skip()) return; // songs play in YouTube's embedded player, not the native one
    const s = engine.getState();
    const cur = s.queue.entries[s.queue.index];
    const next = !cur ? null
      : s.repeat === "one" ? cur
      : s.queue.entries[s.queue.index + 1] ?? (s.repeat === "all" ? s.queue.entries[0] : undefined) ?? null;
    const key = next ? `${s.generation}:${next.uid}` : `${s.generation}:none`;
    if (key === sent) return;
    const tok = readToken();
    if (next && !tok) { void refreshToken().then(update); return; }
    sent = key;
    void bridge.setNext(next && tok ? { url: url(next.track, tok), meta: nowPlaying(next.track) } : { url: null, meta: null }).catch(() => undefined);
  };
  engine.subscribe(update);
}

function createEngine(): PlayerEngine {
  // Installed app (iOS / Android / Mac): the native player plays, so audio and lock-screen controls
  // keep working while the page is in the background. Browser: the <audio> element.
  const bridge: NativeAudioBridge | null = isNativeApp() ? nativeAudioBridge() : null;
  let audio: AudioLike;
  let html: HTMLAudioElement | null = null;
  if (bridge) {
    const na = new NativeAudioElement(bridge, { resolveUrl: (u) => new URL(u, location.origin).href });
    attachNativeAudioLog(na);
    audio = na;
  } else {
    audio = html = createHtmlAudio();
  }
  // Native players (AVPlayer, ExoPlayer) all take AAC/MP4.
  const mp4 = html ? preferMp4(html) : true;

  // Keep a playback token with plenty of life left, so a lock-screen "next" can switch songs
  // synchronously (iOS blocks starting audio after an async wait while the screen is locked).
  const keepTokenFresh = () => { if (!tokenFreshFor(3 * 3600_000)) void refreshToken().catch(() => undefined); };
  const streamPath = (id: string, tok: string) => `/api/v1/stream/${encodeURIComponent(id)}?q=${getPrefs().quality}&f=${mp4 ? "mp4" : "any"}&t=${encodeURIComponent(tok)}`;

  const pwa = isAppleMobile() && isStandaloneApp();

  // Real song lengths from the server, for songs listed without one (YouTube Music search results).
  // Safari reports about twice the length of these streams (seen on iPhone: 8:58 for a 4:29 song).
  const lengths = new Map<string, number>();
  const sessionFor = (id: string, signal?: AbortSignal) =>
    api.post<{ durationSec?: number }>("/api/v1/playback/sessions", { trackId: id, quality: getPrefs().quality, preferMp4: mp4 }, signal ? { signal } : undefined)
      .then((r) => { if (r.durationSec) lengths.set(id, r.durationSec); return r; });

  // One player for both kinds of playback: <audio> for streamed sources, YouTube's embedded player
  // for the "official" source (see ytEmbed.ts).
  const media = new HybridAudio(audio);
  const embedMode = () => playsInEmbed(getMusicSource());

  const engine = new PlayerEngine({
    audio: media,
    streamUrl: (t) => {
      if (embedMode()) return `${EMBED_PREFIX}${t.id}`;
      const build = (tok: string) => streamPath(t.id, tok);
      const tok = readToken();
      if (tok) return build(tok);
      return refreshToken().then(() => {
        const fresh = readToken();
        if (!fresh) throw new Error("no playback token");
        return build(fresh);
      });
    },
    diagnose: async (t) => {
      if (!navigator.onLine) return { message: "You're offline. Reconnect to keep listening.", skippable: false, kind: "offline" };
      // Expired (or missing) playback authorization: renew it and let the engine retry once, same spot.
      if (!tokenFreshFor(0)) {
        await refreshToken();
        return { message: "Reconnecting…", skippable: false, kind: "auth", retry: tokenFreshFor(0) };
      }
      try {
        await api.post("/api/v1/playback/sessions", { trackId: t.id, quality: getPrefs().quality, preferMp4: mp4 });
        return { message: "Playback was interrupted. Skipping…", skippable: true, kind: "network" };
      } catch (e) {
        if (e instanceof ApiError && e.code === "track_unavailable") return { message: `“${t.title}” isn't available. Skipping…`, skippable: true, kind: "unavailable" };
        if (e instanceof ApiError && e.code === "network") return { message: "You're offline. Reconnect to keep listening.", skippable: false, kind: "offline" };
        return { message: "The music service isn't responding right now.", skippable: true, kind: "unknown" };
      }
    },
    // Prepare the next song near the end of this one (engine decides when; ≥5 s before the end):
    // resolve its stream on the server (cached in Redis) and pull its first 256 KB at low priority.
    // Honours `signal` — the engine aborts it if the current song rebuffers or the track changes.
    prefetch: (t, signal) => {
      if (embedMode()) return; // YouTube's player loads its own media
      const t0 = performance.now();
      void sessionFor(t.id, signal)
        .then(() => {
          const tok = readToken();
          if (!tok || signal.aborted) return;
          return fetch(streamPath(t.id, tok), { headers: { Range: "bytes=0-262143" }, priority: "low", signal } as RequestInit)
            .then((r) => r.arrayBuffer())
            .then(() => logPlayback("prefetch:done", `${t.id} ${Math.round(performance.now() - t0)}ms`));
        })
        .catch((e: unknown) => logPlayback("prefetch:fail", (e as Error)?.name ?? "error"));
    },
    fetchRadio: async (seed, continuation) => {
      const r = await api.get<{ tracks: Track[]; continuation?: string }>(`/api/v1/recommendations/radio/${encodeURIComponent(seed.id)}${continuation ? `?continuation=${encodeURIComponent(continuation)}` : ""}`);
      return r;
    },
    onAnalytics: (e) => {
      if (e.type === "start") keepTokenFresh();
      void trackEvent({
        type: e.type,
        trackId: e.track.id,
        artistIds: e.track.artists?.map((a) => a.id).filter((id) => /^[\w-]+$/.test(id)).slice(0, 10) ?? [],
        msPlayed: e.msPlayed,
        durationMs: e.durationMs,
        context: e.context ? { source: e.context.type, ...(e.context.id ? { id: e.context.id.slice(0, 200) } : {}) } : {},
      }).then((eventId) => {
        if (e.type === "start" && !signedIn) void addHistory(e.track, eventId);
      });
    },
    // Absolute URLs: the lock screen / notification fetches artwork outside the page context.
    mediaSession: bridge ? new NativeMediaSession(bridge) : withActionLog(browserMediaSession(undefined, [
      { src: `${location.origin}/icons/icon-512.png`, sizes: "512x512", type: "image/png" },
      { src: `${location.origin}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
    ])),
    seekButtons: !isAppleMobile() && !bridge,
    // Safari-family browsers only (the ones that misreport); others read the length correctly.
    lookupDuration: mp4 ? (t) => embedMode() ? Promise.resolve(undefined) : (lengths.has(t.id) ? Promise.resolve(lengths.get(t.id)) : sessionFor(t.id).then((r) => r.durationSec)) : undefined,
    // Home Screen app only: "playing" counts once the clock really moves; a frozen resume is reloaded
    // once, then shown as paused with "Open the app to resume" (iOS won't restart a Home Screen
    // app's audio from the background — device logs, WebKit report still open).
    confirmPlayback: pwa && !bridge, // the native clock is truthful
    isHidden: () => document.visibilityState === "hidden",
    save: (s) => void saveSession(s),
    onDiagnostic: (m) => logPlayback(m),
  });
  engine.setAutoplay(getPrefs().autoplay);
  if (bridge) queueNextNatively(engine, bridge, (t, tok) => new URL(streamPath(t.id, tok), location.origin).href, embedMode);
  // iOS 17+/Safari: declare this as media playback — keeps audio going with the screen locked
  // and ignores the ring/silent switch (like a music app). No-op where unsupported.
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) { try { nav.audioSession.type = "playback"; } catch { /* unsupported value */ } }
  // Lock screen / Control Center: iOS can drop the page's media controls while it is in the
  // background, so re-assert them whenever visibility changes (both ways) and on bfcache restore.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") engine.saveNow(); // the app may be suspended or killed next
    if (document.visibilityState === "visible") { engine.syncFromMedia(); engine.healIfStalled(); }
    engine.refreshMediaSession();
  });
  window.addEventListener("pagehide", () => engine.saveNow());
  window.addEventListener("pageshow", () => { engine.syncFromMedia(); engine.healIfStalled(); engine.refreshMediaSession(); });
  window.setInterval(keepTokenFresh, 10 * 60_000);
  // One playback owner across tabs: the tab that starts playing tells the others to pause.
  if (html && typeof BroadcastChannel !== "undefined") {
    const el = html;
    const tabId = Math.random().toString(36).slice(2);
    const ch = new BroadcastChannel("neo-music-player");
    el.addEventListener("play", () => { if (!el.src.startsWith("data:")) ch.postMessage({ type: "owner", tabId }); });
    ch.onmessage = (e: MessageEvent<{ type: string; tabId: string }>) => {
      if (e.data?.type === "owner" && e.data.tabId !== tabId && !el.paused) { logPlayback("tab:yield", "another tab started playing"); engine.pause(); }
    };
  }
  void loadSession().then((s) => { if (s && engine.getState().status === "idle") engine.restore(s); });
  void refreshToken();
  startEventFlusher();
  return engine;
}

const Ctx = createContext<PlayerEngine | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [engine, setEngine] = useState<PlayerEngine | null>(null);
  const created = useRef(false);
  useEffect(() => {
    if (created.current) return; // StrictMode double-invoke guard: exactly one engine/audio
    created.current = true;
    setEngine(createEngine());
  }, []);
  return <Ctx.Provider value={engine}>{children}</Ctx.Provider>;
}

const IDLE: PlayerState = {
  status: "idle", generation: 0, queue: { entries: [], index: -1, unshuffled: null }, context: null, positionSec: 0, durationSec: 0,
  bufferedSec: 0, volume: 1, muted: false, shuffle: false, repeat: "off", autoplay: true, error: null, replenishing: false,
};
const noopSub = () => () => {};

/** Subscribe to a slice. The selector must return a primitive or a stable reference. */
export function usePlayer<T>(selector: (s: PlayerState) => T): T {
  const engine = useContext(Ctx);
  return useSyncExternalStore(
    engine?.subscribe ?? noopSub,
    () => selector(engine ? engine.getState() : IDLE),
    () => selector(IDLE),
  );
}

export function usePlayerEngine(): PlayerEngine | null {
  return useContext(Ctx);
}

export const selectCurrent = (s: PlayerState) => s.queue.entries[s.queue.index]?.track ?? null;
export const selectIsPlaying = (s: PlayerState) => s.status === "playing" || s.status === "buffering" || s.status === "seeking" || (s.status === "loading");
