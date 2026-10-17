import type { NativeAudioBridge, NativeMediaEvent, NativeMediaEventType, NativeRemoteEvent, NowPlaying } from "../src";

/**
 * Stand-in for the native player that follows the bridge contract (native.ts header), including
 * "load of the item already playing replays its state instead of reloading". Tests drive time
 * and native-side actions (track end, lock-screen commands) explicitly.
 */
export class FakeBridge implements NativeAudioBridge {
  calls: { m: string; a: unknown }[] = [];
  /** Identity of what native is playing (URL without the token), and what is queued next. */
  current: string | null = null;
  next: { url: string; meta: NowPlaying | null } | null = null;
  meta: NowPlaying | null = null;
  time = 0;
  duration = 200;
  paused = true;
  seq = 0;
  loads = 0;
  /** The current item failed: a load of it must really reload (the engine's retry). */
  failed = false;
  private media = new Set<(e: NativeMediaEvent) => void>();
  private remote = new Set<(e: NativeRemoteEvent) => void>();

  static identity(u: string) { return u.replace(/([?&])t=[^&]*&?/, "$1").replace(/[?&]$/, ""); }

  async load(o: { seq: number; url: string | null; autoplay: boolean }) {
    this.calls.push({ m: "load", a: o });
    this.seq = o.seq;
    if (o.url && this.current && !this.failed && FakeBridge.identity(o.url) === this.current) {
      // Already playing it (native ran ahead): no reload — replay state so the engine syncs.
      this.emit("loadedmetadata");
      if (o.autoplay && this.paused) this.paused = false;
      if (!this.paused) { this.emit("play"); this.emit("playing"); }
      return;
    }
    this.loads++;
    this.failed = false;
    this.current = o.url ? FakeBridge.identity(o.url) : null;
    this.time = 0;
    this.paused = !o.autoplay;
  }
  async play(o: { seq: number }) { this.calls.push({ m: "play", a: o }); this.seq = o.seq; this.paused = false; }
  async pause(o: { seq: number }) { this.calls.push({ m: "pause", a: o }); this.seq = o.seq; this.paused = true; }
  async seek(o: { sec: number }) { this.calls.push({ m: "seek", a: o }); this.time = o.sec; }
  async setVolume(o: { volume: number; muted: boolean }) { this.calls.push({ m: "setVolume", a: o }); }
  async setNext(o: { url: string | null; meta: NowPlaying | null }) { this.calls.push({ m: "setNext", a: o }); this.next = o.url ? { url: o.url, meta: o.meta } : null; }
  async setNowPlaying(o: { meta: NowPlaying | null }) { this.calls.push({ m: "setNowPlaying", a: o }); this.meta = o.meta; }
  onMedia(fn: (e: NativeMediaEvent) => void) { this.media.add(fn); return () => { this.media.delete(fn); }; }
  onRemote(fn: (e: NativeRemoteEvent) => void) { this.remote.add(fn); return () => { this.remote.delete(fn); }; }

  emit(type: NativeMediaEventType, extra: Partial<NativeMediaEvent> = {}) {
    if (type === "error") { this.failed = true; this.paused = true; }
    const e: NativeMediaEvent = { type, seq: this.seq, time: this.time, duration: this.duration, paused: this.paused, ...extra };
    for (const fn of this.media) fn(e);
  }
  sendRemote(e: NativeRemoteEvent) { for (const fn of this.remote) fn(e); }

  /** Native loads metadata and starts. */
  start() { this.emit("loadedmetadata"); this.paused = false; this.emit("play"); this.emit("playing"); }
  tick(sec: number) { this.time += sec; this.emit("timeupdate"); }
  /** The current item ends; with a queued next item native moves on by itself. */
  end() {
    this.time = this.duration;
    this.emit("ended");
    if (!this.next) { this.paused = true; this.emit("pause"); return; }
    this.current = FakeBridge.identity(this.next.url);
    this.meta = this.next.meta;
    this.next = null;
    this.time = 0;
    this.emit("advanced");
    this.emit("playing");
  }
}
