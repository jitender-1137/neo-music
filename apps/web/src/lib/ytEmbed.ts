"use client";
/**
 * Playback for the "official" music source: YouTube's own embedded player (IFrame Player API), shown
 * as a small visible video, as YouTube's terms require (at least 200×200 px). Audio comes straight
 * from YouTube to the browser — never through our server.
 *
 * `EmbedAudio` speaks the same small interface as an <audio> element (AudioLike), firing the same
 * events, so the player engine (queue, next/previous, autoplay, history) works unchanged.
 * `HybridAudio` switches between the real <audio> element and the embed by source URL:
 * "yt-embed:<videoId>" plays in the embed, anything else in <audio>.
 *
 * Limits (YouTube's, not ours): playback stops when the page is hidden or the phone locks (no
 * lock-screen controls), some videos refuse embedding (error 101/150 → skipped), and the first play
 * on iOS can require tapping the video itself.
 */
import type { AudioLike } from "@zuno/player";

export const EMBED_PREFIX = "yt-embed:";

type Listener = (e?: unknown) => void;
interface YTPlayer {
  loadVideoById(id: string, start?: number): void;
  cueVideoById(id: string, start?: number): void;
  playVideo(): void; pauseVideo(): void; seekTo(s: number, allow: boolean): void;
  getCurrentTime(): number; getDuration(): number; getPlayerState(): number; getVideoLoadedFraction(): number;
  setVolume(v: number): void; mute(): void; unMute(): void;
}
declare global {
  interface Window { YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer }; onYouTubeIframeAPIReady?: () => void }
}

let apiPromise: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  apiPromise ??= new Promise<void>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => { apiPromise = null; reject(new Error("YouTube player failed to load")); };
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** The visible box the embedded player lives in (shown only while the embed is in use). */
function hostElement(): HTMLElement {
  let host = document.getElementById("neo-yt-embed");
  if (!host) {
    host = document.createElement("div");
    host.id = "neo-yt-embed";
    host.setAttribute("aria-label", "YouTube player");
    host.innerHTML = '<div id="neo-yt-embed-frame"></div>';
    document.body.appendChild(host);
  }
  return host;
}

const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

export class EmbedAudio implements AudioLike {
  private player: YTPlayer | null = null;
  private ready: Promise<void> | null = null;
  private videoId = "";
  private listeners = new Map<string, Set<Listener>>();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private pendingStart = 0;
  private metaSent = false;
  private lastTime = 0;
  private wantPlay = false;
  private vol = 1;
  private isMuted = false;
  src = "";
  preload = "auto";
  paused = true;
  error: { code: number; message?: string } | null = null;

  addEventListener(t: string, fn: Listener) { (this.listeners.get(t) ?? this.listeners.set(t, new Set()).get(t)!).add(fn); }
  removeEventListener(t: string, fn: Listener) { this.listeners.get(t)?.delete(fn); }
  private fire(t: string) { for (const fn of this.listeners.get(t) ?? []) fn(); }

  get duration() { const d = this.player?.getDuration?.() ?? 0; return d > 0 ? d : NaN; }
  get currentTime() { return this.player ? this.player.getCurrentTime() || this.pendingStart : this.pendingStart; }
  set currentTime(v: number) {
    if (!this.player || !this.metaSent) { this.pendingStart = v; return; }
    this.fire("seeking");
    this.player.seekTo(v, true);
    this.lastTime = v;
    setTimeout(() => this.fire("seeked"), 0);
  }
  get volume() { return this.vol; }
  set volume(v: number) { this.vol = v; this.player?.setVolume(Math.round(v * 100)); }
  get muted() { return this.isMuted; }
  set muted(m: boolean) { this.isMuted = m; if (m) this.player?.mute(); else this.player?.unMute(); }
  get buffered() {
    const d = this.duration;
    const end = this.player && d > 0 ? this.player.getVideoLoadedFraction() * d : 0;
    return { length: end > 0 ? 1 : 0, end: () => end };
  }

  /** Show / hide the visible player box. */
  setVisible(on: boolean) { if (typeof document !== "undefined") hostElement().dataset.active = on ? "1" : "0"; }

  private ensurePlayer(): Promise<void> {
    this.ready ??= loadApi().then(() => new Promise<void>((resolve) => {
      const host = hostElement();
      this.player = new window.YT!.Player(host.querySelector("#neo-yt-embed-frame") as HTMLElement, {
        host: "https://www.youtube-nocookie.com",
        width: "100%", height: "100%",
        playerVars: { playsinline: 1, controls: 1, rel: 0, modestbranding: 1, origin: location.origin },
        events: {
          onReady: () => { this.player!.setVolume(Math.round(this.vol * 100)); if (this.isMuted) this.player!.mute(); resolve(); },
          onStateChange: (e: { data: number }) => this.onState(e.data),
          onError: (e: { data: number }) => this.onError(e.data),
        },
      });
    }));
    return this.ready;
  }

  private onState(s: number) {
    if (s === STATE.PLAYING) {
      if (!this.metaSent) { this.metaSent = true; this.fire("loadedmetadata"); this.fire("durationchange"); }
      this.paused = false;
      this.fire("play");
      this.fire("playing");
      this.startTicker();
    } else if (s === STATE.PAUSED) {
      if (!this.paused) { this.paused = true; this.fire("pause"); }
      this.stopTicker();
    } else if (s === STATE.BUFFERING) {
      this.fire("waiting");
    } else if (s === STATE.ENDED) {
      this.paused = true;
      this.stopTicker();
      this.fire("ended");
    }
  }

  private onError(code: number) {
    // 2 bad id · 5 HTML5 error · 100 removed/private · 101/150 the owner doesn't allow embedding.
    this.error = { code: code === 5 ? 3 : 4, message: `YouTube player error ${code}` };
    this.paused = true;
    this.stopTicker();
    this.fire("error");
  }

  private startTicker() {
    this.stopTicker();
    this.ticker = setInterval(() => {
      const t = this.currentTime;
      if (t !== this.lastTime) { this.lastTime = t; this.fire("timeupdate"); }
    }, 250);
  }
  private stopTicker() { if (this.ticker) clearInterval(this.ticker); this.ticker = null; }

  load() {
    const id = this.src.startsWith(EMBED_PREFIX) ? this.src.slice(EMBED_PREFIX.length) : "";
    this.error = null;
    this.metaSent = false;
    this.lastTime = 0;
    this.paused = true;
    this.videoId = id;
    this.fire("emptied");
    if (!id) return;
    this.fire("loadstart");
    void this.ensurePlayer().then(() => {
      if (this.videoId !== id) return;
      const start = this.pendingStart;
      // load = start playing; cue = just prepare. Which one depends on whether play() was asked.
      if (this.wantPlay) this.player!.loadVideoById(id, start); else this.player!.cueVideoById(id, start);
    }, () => { this.error = { code: 2, message: "YouTube player failed to load" }; this.fire("error"); });
  }

  play(): Promise<void> {
    this.wantPlay = true;
    if (!this.videoId) return Promise.reject(Object.assign(new Error("No video"), { name: "NotSupportedError" }));
    const id = this.videoId;
    return this.ensurePlayer().then(() => new Promise<void>((resolve, reject) => {
      if (this.videoId !== id) return reject(Object.assign(new Error("Superseded"), { name: "AbortError" }));
      const st = this.player!.getPlayerState();
      if (st === STATE.CUED || st === STATE.PAUSED || st === STATE.ENDED || st === STATE.UNSTARTED) this.player!.playVideo();
      // Resolve once it really plays; if the browser blocks it (no gesture, iOS first play), say so.
      const started = Date.now();
      const check = () => {
        if (this.videoId !== id) return reject(Object.assign(new Error("Superseded"), { name: "AbortError" }));
        if (this.player!.getPlayerState() === STATE.PLAYING) return resolve();
        if (this.error) return reject(Object.assign(new Error(this.error.message), { name: "NotSupportedError" }));
        if (Date.now() - started > 6000) return reject(Object.assign(new Error("Tap the video to start"), { name: "NotAllowedError" }));
        setTimeout(check, 150);
      };
      check();
    }));
  }

  pause() {
    this.wantPlay = false;
    if (this.player && this.player.getPlayerState() === STATE.PLAYING) this.player.pauseVideo();
    if (!this.paused) { this.paused = true; this.fire("pause"); }
  }

  removeAttribute(name: string) {
    if (name !== "src") return;
    this.pause();
    this.src = "";
    this.videoId = "";
  }
}

/**
 * One AudioLike for the engine: the base player (the <audio> element, or the native app's player)
 * for streamed sources, the embed for "yt-embed:" sources.
 */
export class HybridAudio implements AudioLike {
  private embed: EmbedAudio | null = null;
  private mode: "audio" | "embed" = "audio";
  private listeners = new Map<string, Set<Listener>>();
  private static readonly EVENTS = ["loadstart", "loadedmetadata", "durationchange", "canplay", "play", "playing", "pause", "waiting", "stalled", "seeking", "seeked", "timeupdate", "ended", "error", "emptied", "abort", "suspend"];

  constructor(private readonly audio: AudioLike) {
    for (const t of HybridAudio.EVENTS) audio.addEventListener(t, () => { if (this.mode === "audio") this.fire(t); });
  }
  private get active(): AudioLike { return this.mode === "embed" ? this.embed! : this.audio; }
  private fire(t: string) { for (const fn of this.listeners.get(t) ?? []) fn(); }
  addEventListener(t: string, fn: Listener) { (this.listeners.get(t) ?? this.listeners.set(t, new Set()).get(t)!).add(fn); }
  removeEventListener(t: string, fn: Listener) { this.listeners.get(t)?.delete(fn); }

  private ensureEmbed(): EmbedAudio {
    if (!this.embed) {
      this.embed = new EmbedAudio();
      this.embed.volume = this.audio.volume;
      this.embed.muted = this.audio.muted;
      for (const t of HybridAudio.EVENTS) this.embed.addEventListener(t, () => { if (this.mode === "embed") this.fire(t); });
    }
    return this.embed;
  }

  get src() { return this.active.src; }
  set src(v: string) {
    if (v.startsWith(EMBED_PREFIX)) {
      if (this.mode === "audio") { this.audio.pause(); this.audio.removeAttribute("src"); this.audio.load(); }
      this.mode = "embed";
      const e = this.ensureEmbed();
      e.setVisible(true);
      e.src = v;
    } else {
      if (this.mode === "embed") { this.embed?.removeAttribute("src"); this.embed?.setVisible(false); }
      this.mode = "audio";
      this.audio.src = v;
    }
  }
  get currentTime() { return this.active.currentTime; }
  set currentTime(v: number) { this.active.currentTime = v; }
  get duration() { return this.active.duration; }
  get paused() { return this.active.paused; }
  get volume() { return this.audio.volume; }
  set volume(v: number) { this.audio.volume = v; if (this.embed) this.embed.volume = v; }
  get muted() { return this.audio.muted; }
  set muted(m: boolean) { this.audio.muted = m; if (this.embed) this.embed.muted = m; }
  get preload() { return this.audio.preload; }
  set preload(v: string) { this.audio.preload = v; }
  get buffered() { return this.active.buffered; }
  get error() { return this.active.error; }
  play() { return this.active.play(); }
  pause() { this.active.pause(); }
  load() { this.active.load(); }
  removeAttribute(n: string) { this.active.removeAttribute(n); }
  /** Whether the YouTube embed is the active player (the UI shows its box). */
  get usingEmbed() { return this.mode === "embed"; }
}
