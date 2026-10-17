"use client";
/**
 * The installed app (Capacitor shell, apps/mobile): the native ZunoAudio player behind the
 * engine's audio + media-session seams. In a browser none of this runs.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { NativeAudioBridge, NativeAudioElement, NativeMediaEvent, NativeRemoteEvent, NowPlaying } from "@zuno/player";
import { logPlayback } from "./playbackLog";

/** Running inside the iOS / Android / Mac app rather than a browser. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export function nativePlatform(): string {
  return Capacitor.getPlatform();
}

interface ZunoAudioPlugin {
  load(o: { seq: number; url: string | null; autoplay: boolean }): Promise<void>;
  play(o: { seq: number }): Promise<void>;
  pause(o: { seq: number }): Promise<void>;
  seek(o: { sec: number }): Promise<void>;
  setVolume(o: { volume: number; muted: boolean }): Promise<void>;
  setNext(o: { url: string | null; meta: NowPlaying | null }): Promise<void>;
  setNowPlaying(o: { meta: NowPlaying | null }): Promise<void>;
  addListener(event: "media", fn: (e: NativeMediaEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: "remote", fn: (e: NativeRemoteEvent) => void): Promise<PluginListenerHandle>;
}

export function nativeAudioBridge(): NativeAudioBridge {
  const p = registerPlugin<ZunoAudioPlugin>("ZunoAudio");
  const listen = <E,>(event: "media" | "remote", fn: (e: E) => void) => {
    const h = p.addListener(event as "media", fn as (e: NativeMediaEvent) => void);
    return () => { void h.then((x) => x.remove()); };
  };
  return {
    load: (o) => p.load(o),
    play: (o) => p.play(o),
    pause: (o) => p.pause(o),
    seek: (o) => p.seek(o),
    setVolume: (o) => p.setVolume(o),
    setNext: (o) => p.setNext(o),
    setNowPlaying: (o) => p.setNowPlaying(o),
    onMedia: (fn) => listen<NativeMediaEvent>("media", fn),
    onRemote: (fn) => {
      // Every system command, also those native carried out itself (Settings → Playback diagnostics).
      const off = listen<NativeRemoteEvent>("remote", (e) => logPlayback(`command:${e.command}`, `${e.handled ? "native" : "page"} ${document.visibilityState}`));
      const off2 = listen<NativeRemoteEvent>("remote", fn);
      return () => { off(); off2(); };
    },
  };
}

/** The native counterpart of attachAudioLog: one line per media event. */
export function attachNativeAudioLog(a: NativeAudioElement) {
  const fmt = () => `t=${a.currentTime.toFixed(1)}/${Number.isFinite(a.duration) ? a.duration.toFixed(1) : "?"}${a.paused ? " paused" : ""}${a.error ? ` err=${a.error.code}${a.error.message ? `:${a.error.message}` : ""}` : ""} vis=${document.visibilityState}`;
  logPlayback("app:start", `native ${nativePlatform()}`);
  for (const ev of ["loadedmetadata", "play", "playing", "pause", "waiting", "stalled", "seeked", "ended", "error"]) {
    a.addEventListener(ev, () => logPlayback(`audio:${ev}`, fmt()));
  }
}
