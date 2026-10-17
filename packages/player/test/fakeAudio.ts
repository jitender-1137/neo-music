import type { AudioLike } from "../src";

/** Deterministic stand-in for HTMLAudioElement. Tests fire media events explicitly. */
export class FakeAudio implements AudioLike {
  src = "";
  private t = 0;
  /** Seeks the code made (assignments to currentTime) — a re-seek re-opens the stream. */
  seeks = 0;
  get currentTime() { return this.t; }
  set currentTime(v: number) { this.t = v; this.seeks++; }
  duration = NaN;
  paused = true;
  volume = 1;
  muted = false;
  preload = "auto";
  error: { code: number } | null = null;
  buffered = { length: 0, end: () => 0 };
  playCalls = 0;
  rejectNextPlay: string | null = null;
  private handlers = new Map<string, Set<(e?: unknown) => void>>();

  play(): Promise<void> {
    this.playCalls++;
    if (this.rejectNextPlay) {
      const name = this.rejectNextPlay;
      this.rejectNextPlay = null;
      return Promise.reject(Object.assign(new Error(name), { name }));
    }
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.fire("pause");
  }
  load() { this.t = 0; this.error = null; }
  removeAttribute(n: string) { if (n === "src") this.src = ""; }
  addEventListener(t: string, fn: (e?: unknown) => void) {
    if (!this.handlers.has(t)) this.handlers.set(t, new Set());
    this.handlers.get(t)!.add(fn);
  }
  removeEventListener(t: string, fn: (e?: unknown) => void) { this.handlers.get(t)?.delete(fn); }
  fire(t: string) { for (const fn of this.handlers.get(t) ?? []) fn(); }
  listenerCount() { return [...this.handlers.values()].reduce((s, x) => s + x.size, 0); }

  /** Simulate the browser loading metadata and starting playback. */
  start(duration = 200) {
    this.duration = duration;
    this.fire("loadedmetadata");
    this.paused = false;
    this.fire("playing");
  }
  advance(sec: number) {
    this.t += sec;
    this.fire("timeupdate");
  }
  end() {
    this.t = this.duration;
    this.paused = true;
    this.fire("ended");
  }
  failWith(code: number) {
    this.error = { code };
    this.fire("error");
  }
}
