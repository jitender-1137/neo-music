/**
 * Native playback for the Capacitor app (iOS AVPlayer, Android Media3) behind the engine's two
 * seams: `NativeAudioElement` stands in for the <audio> element, `NativeMediaSession` for the
 * Media Session API. The engine is unchanged; see docs/native-apps.md.
 *
 * Contract with the native side (ZunoAudioPlugin.swift / ZunoAudioPlugin.java):
 * - Native owns the system controls and handles play, pause, seek, ⏭ (when a next item is
 *   queued) and ⏮-restart itself, so they work while this page's JavaScript is suspended.
 *   It then reports them as `remote` events; the engine catches up when it runs.
 * - `setNext` hands native the upcoming track, so a song ending advances natively too.
 * - `load` of the track native is already playing (it ran ahead) does not reload: native replays
 *   the state events instead, so the engine's catch-up never restarts or skips audio. A failed
 *   item is always reloaded (that's the engine's retry). Identity = URL without its `t` token.
 * - Every command carries a `seq`; every event echoes the last `seq` native handled, so an event
 *   that was in flight before a newer command can't flip `paused` back.
 */
import type { Track } from "@zuno/core";
import type { AudioLike, MediaSessionAdapter } from "./types";

export interface NowPlaying { title: string; artist: string; album?: string; artworkUrl?: string }

export type NativeMediaEventType =
  | "loadedmetadata" | "durationchange" | "play" | "playing" | "pause" | "waiting" | "stalled" | "seeked"
  | "timeupdate" | "ended" | "error"
  /** Native moved to the queued next item on its own (track ended, or ⏭ from the lock screen). */
  | "advanced";

export interface NativeMediaEvent {
  type: NativeMediaEventType;
  seq: number;
  time: number;
  /** Seconds; 0 when unknown. */
  duration: number;
  paused: boolean;
  /** End of the buffered range, seconds. */
  buffered?: number;
  /** MediaError-style: 2 network, 3 decode, 4 unsupported. */
  code?: number;
  message?: string;
}

export type NativeRemoteCommand = "play" | "pause" | "toggle" | "stop" | "next" | "previous" | "seekto";
export interface NativeRemoteEvent { command: NativeRemoteCommand; handled: boolean; seekTime?: number }

export interface NativeAudioBridge {
  load(o: { seq: number; url: string | null; autoplay: boolean }): Promise<void>;
  play(o: { seq: number }): Promise<void>;
  pause(o: { seq: number }): Promise<void>;
  seek(o: { sec: number }): Promise<void>;
  setVolume(o: { volume: number; muted: boolean }): Promise<void>;
  setNext(o: { url: string | null; meta: NowPlaying | null }): Promise<void>;
  setNowPlaying(o: { meta: NowPlaying | null }): Promise<void>;
  onMedia(fn: (e: NativeMediaEvent) => void): () => void;
  onRemote(fn: (e: NativeRemoteEvent) => void): () => void;
}

export function nowPlaying(t: Track | null): NowPlaying | null {
  if (!t) return null;
  return { title: t.title, artist: t.artist, ...(t.album ? { album: t.album } : {}), ...(t.artworkUrl ? { artworkUrl: t.artworkUrl } : {}) };
}

type Fn = (e?: unknown) => void;
const swallow = () => undefined;

export class NativeAudioElement implements AudioLike {
  preload = "auto";
  private _src = "";
  private _time = 0;
  /** When `_time` was last set (ms, `now()`), for smooth interpolation between native ticks. */
  private _timeAt = 0;
  /** The clock is really moving (between "playing"/"timeupdate" and a stop). */
  private _running = false;
  private _duration = NaN;
  private _paused = true;
  private _buffered = 0;
  private _error: { code: number; message?: string } | null = null;
  private _volume = 1;
  private _muted = false;
  private seq = 0;
  /** A load waiting for this tick, so a play() right after it travels in the same call. */
  private pending: { url: string | null; autoplay: boolean; waiters: (() => void)[] } | null = null;
  private handlers = new Map<string, Set<Fn>>();

  constructor(
    private readonly bridge: NativeAudioBridge,
    private readonly opts: { resolveUrl?: (u: string) => string; now?: () => number } = {},
  ) {
    bridge.onMedia((e) => this.onEvent(e));
  }

  private now() { return this.opts.now?.() ?? performance.now(); }

  get src() { return this._src; }
  set src(v: string) { this._src = v; }

  get currentTime() {
    if (!this._running || this._paused) return this._time;
    const t = this._time + (this.now() - this._timeAt) / 1000;
    return Number.isFinite(this._duration) && this._duration > 0 ? Math.min(t, this._duration) : t;
  }
  set currentTime(v: number) {
    this.setTime(v);
    if (!this.silent() && this._src) void this.bridge.seek({ sec: v }).catch(swallow);
  }

  get duration() { return this._duration; }
  get paused() { return this._paused; }
  get error() { return this._error; }
  get buffered() { const b = this._buffered; return { length: b > 0 ? 1 : 0, end: () => b }; }

  get volume() { return this._volume; }
  set volume(v: number) { this._volume = v; this.pushVolume(); }
  get muted() { return this._muted; }
  set muted(v: boolean) { this._muted = v; this.pushVolume(); }

  load() {
    this._error = null;
    this._duration = NaN;
    this._buffered = 0;
    this._running = false;
    this._paused = true; // as for <audio>: load() leaves the element paused until play()
    this.setTime(0);
    if (this.silent()) return; // the engine's gesture-unlock silence: native needs no unlock
    const prev = this.pending;
    this.pending = { url: this._src ? this.resolve(this._src) : null, autoplay: false, waiters: prev?.waiters ?? [] };
    if (!prev) queueMicrotask(() => this.flush());
  }

  play(): Promise<void> {
    if (this.silent()) return Promise.resolve();
    this._paused = false;
    if (this.pending) {
      this.pending.autoplay = true;
      return new Promise((r) => this.pending!.waiters.push(r));
    }
    return this.bridge.play({ seq: ++this.seq }).catch(swallow);
  }

  pause() {
    this._paused = true;
    this._running = false;
    if (this.pending) { this.pending.autoplay = false; return; }
    if (!this.silent()) void this.bridge.pause({ seq: ++this.seq }).catch(swallow);
  }

  removeAttribute(name: string) {
    if (name !== "src") return;
    this._src = "";
    this.load();
  }

  addEventListener(type: string, fn: Fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Fn) { this.handlers.get(type)?.delete(fn); }

  // ---------------- internals ----------------
  private silent() { return this._src.startsWith("data:"); }
  private resolve(u: string) { return this.opts.resolveUrl ? this.opts.resolveUrl(u) : u; }
  private setTime(v: number) { this._time = v; this._timeAt = this.now(); }
  private pushVolume() { void this.bridge.setVolume({ volume: this._volume, muted: this._muted }).catch(swallow); }

  private flush() {
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    const done = () => p.waiters.forEach((w) => w());
    void this.bridge.load({ seq: ++this.seq, url: p.url, autoplay: p.autoplay }).then(done, done);
  }

  private onEvent(e: NativeMediaEvent) {
    // A command sent after this event was produced wins over the event's idea of paused/time.
    const current = e.seq >= this.seq && !this.pending;
    if (current) {
      this._paused = e.paused;
      this.setTime(e.time);
    }
    if (e.duration > 0) this._duration = e.duration;
    if (e.buffered != null) this._buffered = e.buffered;
    switch (e.type) {
      case "playing": case "timeupdate": this._running = current ? !e.paused : this._running; break;
      case "waiting": case "stalled": case "pause": case "ended": this._running = false; break;
      case "error": this._running = false; this._paused = true; this._error = { code: e.code ?? 2, ...(e.message ? { message: e.message } : {}) }; break;
      case "advanced": return; // internal: the engine learns from "ended" / remote events
    }
    for (const fn of this.handlers.get(e.type) ?? []) fn();
  }
}

type Handlers = Parameters<MediaSessionAdapter["setHandlers"]>[0];

/**
 * Lock screen / notification / headset via the native player. Metadata goes to native; play state
 * and position don't need to, because native reports its own. Remote commands native already
 * carried out are only passed on where the engine has to catch up (track changes).
 */
export class NativeMediaSession implements MediaSessionAdapter {
  private handlers: Handlers = {};

  constructor(private readonly bridge: NativeAudioBridge) {
    bridge.onRemote((e) => this.onRemote(e));
  }

  setMetadata(track: Track | null) { void this.bridge.setNowPlaying({ meta: nowPlaying(track) }).catch(swallow); }
  setPlaybackState(state: "playing" | "paused" | "none") { if (state === "none") this.setMetadata(null); }
  setPosition() { /* native knows its own position */ }
  setHandlers(h: Handlers) { this.handlers = { ...this.handlers, ...h }; }

  private onRemote(e: NativeRemoteEvent) {
    const h = this.handlers;
    switch (e.command) {
      case "next": return h.nexttrack?.();
      case "previous": return h.previoustrack?.();
      case "seekto": return e.handled ? undefined : h.seekto?.({ seekTime: e.seekTime ?? 0 });
      case "play": return e.handled ? undefined : h.play?.();
      case "pause": case "stop": return e.handled ? undefined : (h[e.command] ?? h.pause)?.();
      case "toggle": return undefined; // always carried out natively
    }
  }
}
