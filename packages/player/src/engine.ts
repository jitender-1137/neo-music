/**
 * PlayerEngine — the single owner of the single <audio> element.
 *
 * Design (ported concepts from Zuno's PlayerController, Apache-2.0):
 * - One persistent media element; nothing else creates audio, so two sources can never play.
 * - `generation` guards every async continuation: a late answer for track A can never replace B.
 * - Stream URLs are built synchronously so `play()` runs inside the user's tap (iOS Safari).
 * - Analytics and radio refills are fire-and-forget; they can never delay or block playback.
 * - UI subscribes to immutable snapshots (useSyncExternalStore-friendly).
 */
import type { Track } from "@zuno/core";
import { Queue } from "./queue";
import type {
  AnalyticsType, EngineDeps, PlayContext, PlayerError, PlayerState, PlayerStatus, RepeatMode, SavedSession,
} from "./types";

const PREV_RESTART_THRESHOLD_SEC = 3;
const QUALIFIED_MS = 30_000;
const REFILL_WHEN_AUTO_BELOW = 5;
const MAX_CONSECUTIVE_ERRORS = 3;
/** 50 ms of silence: played synchronously in the tap to "unlock" the element when the real URL isn't ready. */
/** A pause longer than this re-opens the stream on resume (iOS drops idle media connections). */
const LONG_PAUSE_MS = 10_000;
const SEEK_STEP_SEC = 10;
const STALL_CHECK_MS = 4_000;
const HEAL_CHECK_MS = 1_500;
/** confirmPlayback: after "playing", the clock must move this much within CONFIRM_MS to count as playing. */
const CONFIRM_ADVANCE_SEC = 0.3;
const CONFIRM_MS = 2_500;
/** confirmPlayback: a resume command that never reaches "playing" is treated as failed after this. */
const CONFIRM_START_MS = 8_000;

export const SILENT_WAV = "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";

type Listener = () => void;

export class PlayerEngine {
  private state: PlayerState;
  private queue = Queue.empty();
  private listeners = new Set<Listener>();
  /** The paused source's connection failed; the next play() reloads it at the same position. */
  private staleSource = false;
  /** When playback was last paused (to spot long pauses whose connection iOS has closed). */
  private pausedAt: number | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  /** Generation whose `ended` was already handled (advance exactly once per load). */
  private endedGen = -1;
  /** Next-track preparation: which load it belongs to, attempts, and how to cancel it. */
  private prefetchGen = -1;
  private prefetchTries = 0;
  private prefetchAbort: AbortController | null = null;
  /** Load generation that already used its one authorization retry. */
  private authRetryGen = -1;
  /** Lengths learned from deps.lookupDuration for songs the catalogue gave none (by track id). */
  private durations = new Map<string, number>();
  /** confirmPlayback: the media time when "playing" fired (null = nothing to confirm). */
  private confirmFrom: number | null = null;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;
  /** Generation whose playback already failed confirmation once (the next failure gives up). */
  private confirmFailGen = -1;
  /** The lock screen currently shows the "Open the app to resume" hint instead of the artist. */
  private lockHint = false;
  private readonly deps: Required<Pick<EngineDeps, "now" | "rng">> & EngineDeps;

  private gen = 0;
  private consecutiveErrors = 0;
  private mediaRetryGen = -1;
  private pendingSeek: number | null = null;
  private resumeAfterLoad = false;

  // Analytics bookkeeping for the current entry.
  private playedMs = 0;
  private lastTick: number | null = null;
  private sentStart = false;
  private sentQualified = false;

  private radioSeed: Track | null = null;
  private radioContinuation: string | undefined;
  private refilling = false;
  private lastPositionPush = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private disposers: (() => void)[] = [];

  constructor(deps: EngineDeps) {
    this.deps = { now: () => Date.now(), rng: Math.random, ...deps };
    this.state = {
      status: "idle", generation: 0, queue: this.queue.snapshot(), context: null, positionSec: 0, durationSec: 0,
      bufferedSec: 0, volume: 1, muted: false, shuffle: false, repeat: "off", autoplay: true, error: null, replenishing: false,
    };
    this.bindAudio();
    this.bindMediaSession();
  }

  // ---------------- subscription ----------------
  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = (): PlayerState => this.state;

  private set(patch: Partial<PlayerState>, persist = false) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
    if (persist) this.scheduleSave();
  }
  private syncQueue(persist = true) {
    this.set({ queue: this.queue.snapshot(), shuffle: this.queue.isShuffled || (this.state.shuffle && this.queue.length <= 1) }, persist);
  }

  get currentTrack(): Track | null { return this.queue.current?.track ?? null; }

  /** Exact media time (seconds), read straight from the element — for frame-accurate UI like lyrics. */
  currentTime(): number {
    const a = this.deps.audio;
    return a.src && !a.src.startsWith("data:") ? a.currentTime : this.state.positionSec;
  }

  // ---------------- public commands ----------------
  /** Replace the queue with a list (album, playlist, search results) and play from `startIndex`. */
  playList(tracks: Track[], startIndex = 0, context: PlayContext | null = null, opts: { shuffle?: boolean } = {}) {
    if (!tracks.length) return;
    let q = Queue.from(tracks, startIndex);
    const shuffle = opts.shuffle ?? this.state.shuffle;
    if (shuffle) {
      // Start from a random track when shuffling a whole list (YouTube Music "Shuffle" button).
      if (opts.shuffle) q = Queue.from(tracks, Math.floor(this.deps.rng() * tracks.length));
      q = q.shuffle(this.deps.rng);
    }
    this.queue = q;
    this.radioSeed = null;
    this.radioContinuation = undefined;
    this.set({ context, shuffle });
    this.syncQueue();
    this.loadCurrent(true);
  }

  /** Play one track and fill the queue with its radio (YouTube Music "play a song" behaviour). */
  playTrack(track: Track, context: PlayContext | null = { type: "track", id: track.id }) {
    this.queue = Queue.from([track]);
    this.radioSeed = track;
    this.radioContinuation = undefined;
    this.set({ context });
    this.syncQueue();
    this.loadCurrent(true);
    void this.refill(true);
  }

  /** Start radio from a track; keeps the current song playing if it's the seed. */
  startRadio(seed: Track) {
    if (this.currentTrack?.id === seed.id) {
      this.radioSeed = seed;
      this.radioContinuation = undefined;
      this.queue = this.queue.clearUpcoming();
      this.set({ context: { type: "radio", id: seed.id, title: `${seed.title} radio` } });
      this.syncQueue();
      void this.refill(true);
      return;
    }
    this.playTrack(seed, { type: "radio", id: seed.id, title: `${seed.title} radio` });
  }

  playNext(tracks: Track[]) {
    const wasEmpty = this.queue.length === 0;
    this.queue = this.queue.playNext(tracks);
    this.syncQueue();
    tracks.forEach((t) => this.emit("queue_add", t));
    if (wasEmpty) this.loadCurrent(true);
  }

  addToQueue(tracks: Track[]) {
    const wasEmpty = this.queue.length === 0;
    this.queue = this.queue.addToQueue(tracks);
    this.syncQueue();
    tracks.forEach((t) => this.emit("queue_add", t));
    if (wasEmpty) this.loadCurrent(true);
  }

  removeFromQueue(uid: string) { this.queue = this.queue.remove(uid); this.syncQueue(); }
  moveInQueue(uid: string, toIndex: number) { this.queue = this.queue.move(uid, toIndex); this.syncQueue(); }
  clearUpcoming() { this.queue = this.queue.clearUpcoming(); this.radioSeed = null; this.syncQueue(); }

  jumpTo(uid: string) {
    const q = this.queue.jumpTo(uid);
    if (!q) return;
    this.finishCurrent("skip");
    this.queue = q;
    this.syncQueue();
    this.loadCurrent(true);
  }

  /**
   * Toggle on the user's *intent* (resumeAfterLoad), not on `status`: status follows media
   * events, which arrive a few ms later — two quick taps would otherwise both read "playing".
   */
  togglePlay() {
    const s = this.state.status;
    if (s === "idle" || s === "ended" || s === "error") return this.play();
    // Trust the element too: if it is actually paused (and not mid-load), the user wants play.
    if (this.deps.audio.paused && s !== "loading") return this.play();
    if (this.resumeAfterLoad) this.pause();
    else this.play();
  }

  play() {
    const a = this.deps.audio;
    if (!this.queue.current) return;
    // The connection dropped while paused (common when paused in the background, e.g. from the lock
    // screen): reload at the same position *inside this call*. A play command from the lock screen,
    // Control Center, headphones or a tap counts as the user's action, so iOS allows it here — it
    // would block the same reload done later on its own.
    if (this.staleSource || this.state.status === "error" || this.state.status === "ended" || this.state.status === "idle" || !a.src) {
      this.staleSource = false;
      this.loadCurrent(true, this.state.status === "ended" ? 0 : this.state.positionSec);
      return;
    }
    // After a long pause (typically paused from the lock screen), iOS has closed the stream's
    // connection and WebKit resumes the element *without* reopening it: the clock runs, no sound.
    // A seek to the current position forces a fresh request — the same thing dragging the progress
    // bar did — and doing it here, inside the play command, is allowed from the lock screen.
    const longPause = this.pausedAt != null && this.deps.now() - this.pausedAt > LONG_PAUSE_MS;
    this.pausedAt = null;
    if (longPause) this.reconnect();
    this.resumeAfterLoad = true;
    const pos = this.state.positionSec;
    if (this.deps.confirmPlayback) this.armConfirm(CONFIRM_START_MS);
    else this.watchForStall(STALL_CHECK_MS);
    this.deps.onDiagnostic?.(`resume:start t=${pos.toFixed(1)}`);
    a.play().catch((err: unknown) => {
      // The paused stream may have gone stale without an error event: reload at the same spot once.
      const name = (err as { name?: string })?.name;
      if (name !== "AbortError" && name !== "NotAllowedError" && this.resumeAfterLoad) { this.loadCurrent(true, pos, true); return; }
      this.onPlayRejected(err);
    });
  }

  pause() {
    this.resumeAfterLoad = false;
    this.pausedAt = this.deps.now();
    this.clearStallWatch();
    this.clearConfirm();
    this.deps.audio.pause();
    // Reflect the pause immediately; the media "pause" event may lag behind.
    const s = this.state.status;
    if (s === "loading" || s === "playing" || s === "buffering" || s === "seeking") this.set({ status: "paused" }, true);
  }

  next() {
    const q = this.queue.next(this.state.repeat === "all");
    if (!q) {
      void this.refill(false).then((added) => { if (added) this.next(); });
      return;
    }
    this.finishCurrent("skip");
    this.queue = this.state.repeat === "all" && q.index === 0 && this.queue.isShuffled ? this.queue.reshuffleForLap(this.deps.rng) : q;
    this.syncQueue();
    this.loadCurrent(true);
  }

  /**
   * Back one track. Buttons and media keys restart the current song once it is past a few seconds
   * (`restart`, default); swipe gestures pass `restart: false` and always change track.
   */
  previous({ restart = true }: { restart?: boolean } = {}) {
    if ((restart && this.deps.audio.currentTime > PREV_RESTART_THRESHOLD_SEC) || this.queue.index <= 0) {
      this.seek(0);
      if (this.state.status !== "playing") this.play();
      return;
    }
    const q = this.queue.prev(false);
    if (!q) return;
    this.finishCurrent("skip");
    this.queue = q;
    this.syncQueue();
    this.loadCurrent(true);
  }

  seek(sec: number) {
    const a = this.deps.audio;
    const dur = this.effectiveDuration() || this.state.durationSec;
    const target = Math.max(0, Math.min(sec, dur > 0 ? dur - 0.25 : sec));
    if (this.state.status === "loading" || !a.src) {
      this.pendingSeek = target;
      this.set({ positionSec: target });
      return;
    }
    this.lastTick = null; // seeking isn't listening time
    if (this.confirmFrom != null) this.confirmFrom = target; // measure progress from the new spot
    a.currentTime = target;
    this.set({ positionSec: target, status: this.state.status === "playing" || this.state.status === "buffering" ? "seeking" : this.state.status });
  }

  setVolume(v: number) {
    const volume = Math.max(0, Math.min(1, v));
    this.deps.audio.volume = volume;
    if (volume > 0 && this.state.muted) this.deps.audio.muted = false;
    this.set({ volume, muted: volume > 0 ? false : this.state.muted }, true);
  }

  toggleMute() {
    const muted = !this.state.muted;
    this.deps.audio.muted = muted;
    this.set({ muted }, true);
  }

  setShuffle(on: boolean) {
    if (on === this.queue.isShuffled && on === this.state.shuffle) return;
    this.queue = on ? this.queue.shuffle(this.deps.rng) : this.queue.unshuffle();
    this.set({ shuffle: on });
    this.syncQueue();
  }
  toggleShuffle() { this.setShuffle(!this.state.shuffle); }

  cycleRepeat() {
    const order: RepeatMode[] = ["off", "all", "one"];
    this.set({ repeat: order[(order.indexOf(this.state.repeat) + 1) % 3]! }, true);
  }
  setRepeat(repeat: RepeatMode) { this.set({ repeat }, true); }
  setAutoplay(autoplay: boolean) { this.set({ autoplay }, true); }

  /**
   * Reconcile UI state with the media element (call when the page becomes visible again: the OS
   * may have paused audio for a call/Siri while JS was suspended and events were coalesced).
   */
  syncFromMedia() {
    const a = this.deps.audio;
    if (!this.queue.current || !a.src || a.src.startsWith("data:")) return;
    const s = this.state.status;
    if (a.paused && (s === "playing" || s === "buffering")) {
      this.resumeAfterLoad = false;
      this.set({ status: "paused", positionSec: a.currentTime });
      this.deps.mediaSession?.setPlaybackState("paused");
    } else if (!a.paused && s === "paused") {
      this.resumeAfterLoad = true;
      this.set({ status: "playing", positionSec: a.currentTime });
      this.deps.mediaSession?.setPlaybackState("playing");
    }
  }

  /** Restore a saved session paused at its position (never auto-plays: browsers need a gesture). */
  restore(s: SavedSession) {
    if (s.version !== 1 || !s.queue.entries.length) return;
    this.queue = Queue.restore(s.queue);
    this.radioSeed = s.radioSeed;
    this.radioContinuation = s.radioContinuation;
    this.deps.audio.volume = s.volume;
    this.deps.audio.muted = s.muted;
    this.set({
      context: s.context, positionSec: s.positionSec, shuffle: s.shuffle, repeat: s.repeat, volume: s.volume, muted: s.muted,
      autoplay: s.autoplay, status: "paused", durationSec: this.queue.current?.track.durationSec ?? 0, generation: ++this.gen,
    });
    this.syncQueue(false);
    this.deps.mediaSession?.setMetadata(this.currentTrack);
    if (this.currentTrack) this.learnDuration(this.currentTrack, this.gen);
  }

  dispose() {
    this.flushAnalyticsTick();
    for (const d of this.disposers) d();
    this.disposers = [];
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.clearStallWatch();
    this.clearConfirm();
    this.deps.mediaSession?.setHandlers({ play: null, pause: null, previoustrack: null, nexttrack: null, seekto: null, seekbackward: null, seekforward: null, stop: null });
    this.listeners.clear();
  }

  // ---------------- loading ----------------
  /** `retry` reloads the same logical attempt (same generation, analytics continue). */
  private loadCurrent(autoplay: boolean, startAt = 0, retry = false) {
    const entry = this.queue.current;
    const a = this.deps.audio;
    this.staleSource = false;
    this.pausedAt = null;
    this.clearStallWatch();
    this.clearConfirm();
    if (!retry) { this.abortPrefetch("track changed", false); this.prefetchTries = 0; }
    if (!entry) {
      a.pause();
      this.set({ status: "idle" });
      return;
    }
    const gen = retry ? this.gen : ++this.gen;
    if (!retry) this.resetAnalytics();
    this.pendingSeek = startAt > 0 ? startAt : null;
    this.resumeAfterLoad = autoplay;
    this.set({
      status: "loading", generation: gen, positionSec: startAt, durationSec: entry.track.durationSec ?? 0, bufferedSec: 0, error: null,
    });
    this.deps.mediaSession?.setMetadata(entry.track);
    if (!retry) this.learnDuration(entry.track, gen);
    const url = this.deps.streamUrl(entry.track);
    if (typeof url === "string") {
      a.src = url;
      a.load();
      if (autoplay) {
        // Called synchronously from the user's tap → allowed on iOS.
        a.play().catch((err: unknown) => { if (gen === this.gen) this.onPlayRejected(err); });
      }
    } else {
      // URL not ready (e.g. first tap before the playback token arrived). Keep the gesture:
      // play silence now, then swap in the real source on the same, now-unlocked element.
      if (autoplay) {
        a.src = SILENT_WAV;
        a.play().catch(() => undefined);
      }
      void url.then((real) => {
        if (gen !== this.gen) return;
        a.src = real;
        a.load();
        if (this.resumeAfterLoad) a.play().catch((err: unknown) => { if (gen === this.gen) this.onPlayRejected(err); });
      }, () => {
        if (gen !== this.gen) return;
        this.set({ status: "error", error: { message: "Couldn't start playback. Check your connection.", recoverable: true, trackId: entry.track.id } });
      });
    }
    this.scheduleSave();
  }

  private onPlayRejected(err: unknown) {
    const name = (err as { name?: string })?.name;
    if (name === "AbortError") return; // superseded by a newer load — expected
    if (name === "NotAllowedError") {
      // Autoplay policy: the browser wants a fresh tap. Shown as a gentle prompt, not a failure.
      this.resumeAfterLoad = false;
      const t = this.currentTrack;
      this.set({ status: "paused", error: t ? { message: "Tap play to continue", recoverable: true, trackId: t.id, kind: "not_allowed" } : null });
      this.deps.onDiagnostic?.("play:not-allowed");
      return;
    }
    // NotSupportedError etc. surface through the media 'error' event handler.
  }

  // ---------------- media events ----------------
  private bindAudio() {
    const a = this.deps.audio;
    const on = (type: string, fn: () => void) => {
      a.addEventListener(type, fn);
      this.disposers.push(() => a.removeEventListener(type, fn));
    };
    // Lock screen / notification progress: pushed right away on every change, not only on the 1 s tick.
    const pushPosition = () => {
      const d = this.effectiveDuration();
      if (d > 0 && !silentSrc()) this.deps.mediaSession?.setPosition(Math.min(a.currentTime, d), d, a.paused ? 0 : 1);
    };
    const silentSrc = () => a.src.startsWith("data:audio/wav");
    on("loadedmetadata", () => {
      const d = this.effectiveDuration();
      if (d > 0) this.set({ durationSec: d });
      pushPosition();
      if (this.pendingSeek != null) {
        a.currentTime = this.pendingSeek;
        this.pendingSeek = null;
      }
    });
    const silent = () => a.src.startsWith("data:audio/wav");
    // Safari revises a stream's duration as it loads; keep the shown length correct (never summed or doubled).
    on("durationchange", () => {
      if (silent()) return;
      const d = this.effectiveDuration();
      if (d > 0 && Math.abs(d - this.state.durationSec) > 0.5) { this.set({ durationSec: d }); pushPosition(); }
    });
    on("playing", () => {
      if (silent()) return;
      // A "playing" event can arrive after the user already paused (pause during loading);
      // the element's own state is the truth — don't flip the UI back to playing.
      if (a.paused) return;
      this.consecutiveErrors = 0;
      this.lastTick = this.deps.now();
      if (!this.sentStart && this.currentTrack) {
        this.sentStart = true;
        this.emit("start", this.currentTrack);
        this.maybePrefetchNext(); // short songs (shorter than the lead time) prepare right away
      }
      if (this.deps.confirmPlayback && !this.confirmed()) {
        // "playing" alone isn't proof (iOS can report it with a frozen clock): show it as starting
        // until the time really moves (see timeupdate), and check again shortly.
        this.confirmFrom = a.currentTime;
        this.armConfirm(CONFIRM_MS);
        if (this.state.status !== "playing") this.set({ status: "buffering", error: null });
        this.bindMediaSession();
        pushPosition();
        return;
      }
      this.set({ status: "playing", error: null });
      this.deps.mediaSession?.setPlaybackState("playing");
      // Re-assert previous/next on every start: iOS can drop handlers when the source changes, and
      // without them it falls back to ±10 s buttons on the lock screen instead of ⏮ ⏭.
      this.bindMediaSession();
      pushPosition();
    });
    // The element started playing — possibly by iOS itself (a lock-screen ▶ handled natively while
    // the app was frozen), without our play() running. Apply the same long-pause re-open and stall
    // watch, and adopt the playing state so the next tap means "pause".
    on("play", () => {
      if (silent()) return;
      if (this.pausedAt != null && this.deps.now() - this.pausedAt > LONG_PAUSE_MS) this.reconnect();
      this.pausedAt = null;
      if (!this.resumeAfterLoad && this.state.status === "paused") {
        this.resumeAfterLoad = true;
        if (this.deps.confirmPlayback) this.armConfirm(CONFIRM_START_MS);
        else this.watchForStall(STALL_CHECK_MS);
      }
    });
    on("pause", () => {
      if (silent()) return;
      this.flushAnalyticsTick();
      if (this.state.status === "loading" && this.resumeAfterLoad) return; // src swap, not a user pause
      if (this.state.status === "ended" || this.state.status === "error") return;
      // A real pause — possibly by the OS itself (lock screen without our handlers, AirPods out, a
      // call, Siri). Record it, or the next play tap would be read as "pause" and do nothing.
      this.resumeAfterLoad = false;
      this.pausedAt ??= this.deps.now();
      this.clearStallWatch();
      this.clearConfirm();
      this.set({ status: "paused" }, true);
      this.deps.mediaSession?.setPlaybackState("paused");
      pushPosition();
    });
    on("stalled", () => { if (!silent() && this.resumeAfterLoad) this.abortPrefetch("current track stalled", true); });
    on("waiting", () => {
      if (!silent() && this.resumeAfterLoad && this.state.status === "playing") this.abortPrefetch("current track rebuffering", true);
      this.flushAnalyticsTick();
      if (this.state.status === "playing" || this.state.status === "seeking") this.set({ status: "buffering" });
    });
    on("seeked", () => {
      if (this.state.status === "seeking") this.set({ status: a.paused ? "paused" : this.confirmFrom != null ? "buffering" : "playing" });
      this.lastTick = a.paused ? null : this.deps.now();
      pushPosition();
    });
    on("timeupdate", () => {
      this.tickAnalytics();
      const pos = a.currentTime;
      if (this.confirmFrom != null && !a.paused && pos - this.confirmFrom >= CONFIRM_ADVANCE_SEC) this.onConfirmed();
      const patch: Partial<PlayerState> = { positionSec: pos };
      if (a.buffered.length) patch.bufferedSec = a.buffered.end(a.buffered.length - 1);
      this.set(patch);
      const now = this.deps.now();
      if (now - this.lastPositionPush > 1000) {
        this.lastPositionPush = now;
        const d = this.effectiveDuration();
        if (d > 0) this.deps.mediaSession?.setPosition(Math.min(pos, d), d, a.paused ? 0 : 1);
        this.scheduleSave();
      }
      this.maybePrefetchNext();
      if (this.state.autoplay && this.queue.remainingAuto < REFILL_WHEN_AUTO_BELOW && this.queue.upcoming.length < REFILL_WHEN_AUTO_BELOW) void this.refill(false);
    });
    on("ended", () => {
      if (silent()) return;
      // Advance exactly once per load: a duplicate "ended", or one racing a manual next, is ignored.
      // A song can't end before it has started, so an "ended" during the next load is stale too.
      if (this.endedGen === this.gen || this.state.status === "loading") return;
      this.endedGen = this.gen;
      this.clearConfirm();
      this.tickAnalytics();
      this.finishCurrent("complete");
      if (this.state.repeat === "one") {
        this.endedGen = -1; // the same load plays again, so its next "ended" counts
        this.resetAnalytics();
        a.currentTime = 0;
        a.play().catch((e: unknown) => this.onPlayRejected(e));
        return;
      }
      const q = this.queue.next(this.state.repeat === "all");
      if (q) {
        this.queue = this.state.repeat === "all" && q.index === 0 && this.queue.isShuffled ? this.queue.reshuffleForLap(this.deps.rng) : q;
        this.syncQueue();
        this.loadCurrent(true);
        return;
      }
      // End of queue: try autoplay, otherwise stop.
      this.set({ status: "ended", positionSec: this.state.durationSec });
      this.deps.mediaSession?.setPlaybackState("paused");
      if (this.state.autoplay) void this.refill(false).then((added) => { if (added) this.next(); });
    });
    on("error", () => {
      if (silent()) return;
      const gen = this.gen;
      const track = this.currentTrack;
      if (!track || !a.src || this.state.status === "idle") return;
      const code = a.error?.code;
      // Paused (often in the background, where iOS closes idle connections): don't reload now — a
      // background reload can't start later. Keep showing "paused" and reload on the next play().
      if ((this.state.status === "paused" || a.paused && !this.resumeAfterLoad) && code !== 4) {
        this.staleSource = true;
        this.deps.onDiagnostic?.(`heal:stale-while-paused code=${code}`);
        if (this.state.status !== "paused") this.set({ status: "paused" });
        return;
      }
      // One silent retry from the same position for network/decode hiccups mid-track
      // (e.g. upstream URL expiry handled server-side, a dropped connection).
      if (this.mediaRetryGen !== gen && this.state.positionSec > 0 && code !== 4) {
        this.mediaRetryGen = gen;
        const pos = this.state.positionSec;
        const resume = this.state.status !== "paused";
        this.loadCurrent(resume, pos, true);
        return;
      }
      this.consecutiveErrors++;
      const kind = navigatorOffline() ? "offline" : code === 2 ? "network" : code === 3 ? "decode" : code === 4 ? "unavailable" : "unknown";
      const fallback: PlayerError = { message: "Couldn't play this track", recoverable: true, trackId: track.id, kind };
      this.set({ status: "error", error: fallback });
      this.deps.mediaSession?.setPlaybackState("paused");
      const diagnose = this.deps.diagnose?.(track) ?? Promise.resolve({ message: fallback.message, skippable: true });
      type Diagnosis = Awaited<ReturnType<NonNullable<EngineDeps["diagnose"]>>>;
      void (diagnose as Promise<Diagnosis>).catch((): Diagnosis => ({ message: navigatorOffline() ? "You're offline" : fallback.message, skippable: !navigatorOffline(), kind: navigatorOffline() ? "offline" : kind }))
        .then((d: Diagnosis) => {
          if (gen !== this.gen) return; // user moved on
          // e.g. the playback authorization had expired and was renewed: retry once, same spot.
          if (d.retry && this.authRetryGen !== gen) {
            this.authRetryGen = gen;
            this.consecutiveErrors = Math.max(0, this.consecutiveErrors - 1);
            this.deps.onDiagnostic?.(`heal:retry kind=${d.kind ?? "?"}`);
            this.loadCurrent(this.resumeAfterLoad || this.state.status !== "paused", this.state.positionSec, true);
            return;
          }
          const fatal = this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS || !d.skippable;
          this.set({ error: { message: d.message, recoverable: !fatal, trackId: track.id, kind: d.kind ?? kind } });
          if (!fatal && this.queue.upcoming.length) setTimeout(() => { if (gen === this.gen && this.state.status === "error") this.next(); }, 1500);
        });
    });
  }

  /** Re-seek to where we are: makes the browser open a fresh request for the audio. */
  private reconnect() {
    const a = this.deps.audio;
    if (!a.src || a.src.startsWith("data:")) return;
    this.deps.onDiagnostic?.(`heal:reopen t=${a.currentTime.toFixed(1)}`);
    try { a.currentTime = a.currentTime; } catch { /* not seekable yet */ }
  }

  // ---------------- playback confirmation (deps.confirmPlayback; iPhone / iPad) ----------------
  private confirmed(): boolean {
    return this.confirmFrom == null && this.confirmTimer == null && this.state.status === "playing";
  }

  private clearConfirm() {
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
    this.confirmFrom = null;
  }

  private armConfirm(ms: number) {
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
    const gen = this.gen;
    this.confirmTimer = setTimeout(() => {
      this.confirmTimer = null;
      if (gen !== this.gen || !this.resumeAfterLoad || this.state.status === "error") return;
      this.onConfirmFailed();
    }, ms);
  }

  private onConfirmed() {
    const a = this.deps.audio;
    this.clearConfirm();
    this.confirmFailGen = -1;
    this.deps.onDiagnostic?.(`resume:ok t=${a.currentTime.toFixed(1)}`);
    this.lastTick = this.deps.now();
    this.set({ status: "playing", error: null });
    if (this.lockHint) { this.lockHint = false; this.deps.mediaSession?.setMetadata(this.currentTrack); }
    this.deps.mediaSession?.setPlaybackState("playing");
  }

  /**
   * The element was asked to play but its clock didn't move. First time for this song: reload it at
   * the same position and play again (a fresh source; the stream authorization is re-read). Second
   * time: stop honestly — paused, with a message — instead of showing "playing" with no sound. In the
   * background this is what an iOS Home Screen app hits (WebKit won't restart its audio until the app
   * is opened), so the message says so.
   */
  private onConfirmFailed() {
    const a = this.deps.audio;
    const pos = this.confirmFrom ?? (a.currentTime || this.state.positionSec);
    const hidden = !!this.deps.isHidden?.();
    this.confirmFrom = null;
    if (this.confirmFailGen !== this.gen) {
      this.confirmFailGen = this.gen;
      this.deps.onDiagnostic?.(`resume:frozen t=${pos.toFixed(1)} rs=${(a as { readyState?: number }).readyState ?? "?"} hidden=${hidden} → reload`);
      this.loadCurrent(true, pos, true);
      this.armConfirm(CONFIRM_START_MS); // loadCurrent cleared it; the next "playing" re-arms a short check
      return;
    }
    this.deps.onDiagnostic?.(`resume:failed t=${pos.toFixed(1)} hidden=${hidden}`);
    this.confirmFailGen = -1;
    this.resumeAfterLoad = false;
    this.pausedAt = this.deps.now();
    a.pause();
    const t = this.currentTrack;
    this.set({
      status: "paused",
      positionSec: pos,
      error: t ? (hidden
        ? { message: "Paused in the background. Tap play to continue.", recoverable: true, trackId: t.id, kind: "background_blocked" }
        : { message: "Couldn't resume. Tap play to try again.", recoverable: true, trackId: t.id, kind: "unknown" }) : null,
    });
    this.deps.mediaSession?.setPlaybackState("paused");
    // The lock screen can't show our message, but it shows the artist line: say what to do there.
    // Restored with the next play, track change or return to the app (refreshMediaSession).
    if (t && hidden) { this.lockHint = true; this.deps.mediaSession?.setMetadata({ ...t, artist: "Open the app to resume" }); }
  }

  /** Write the saved session now (the page is being hidden or unloaded and may not run again). */
  saveNow() {
    if (!this.deps.save) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.writeSave();
  }

  private clearStallWatch() {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }

  /**
   * Stall watchdog for resumes: if, after `ms`, we're meant to be playing but the clock hasn't
   * really moved, re-seek (fresh request); if it's still stuck after another check, reload the song
   * at the same position. Turns "playing but silent" into a short hiccup instead of a dead player.
   */
  private watchForStall(ms: number, stage = 1) {
    this.clearStallWatch();
    const a = this.deps.audio, gen = this.gen, t0 = a.currentTime;
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      if (gen !== this.gen || !this.resumeAfterLoad || this.state.status === "loading" || this.state.status === "error") return;
      if (a.currentTime - t0 >= 0.5) return; // really playing
      this.deps.onDiagnostic?.(`heal:stall stage=${stage}`);
      if (stage === 1) { this.reconnect(); if (a.paused) a.play().catch(() => undefined); this.watchForStall(ms, 2); return; }
      this.loadCurrent(true, a.currentTime || this.state.positionSec, true);
    }, ms);
  }

  /** Coming back to the app: if we say "playing" but the audio is stuck, heal it right away. */
  healIfStalled() {
    if (this.confirmTimer) return; // confirmation is already checking
    const s = this.state.status;
    if (!this.resumeAfterLoad || (s !== "playing" && s !== "buffering")) return;
    this.watchForStall(HEAL_CHECK_MS);
  }

  /**
   * The song's length. The browser's figure is precise when right, but Safari can mis-estimate
   * streamed AAC (often ~2× for HE-AAC) and revise it while streaming, so whenever it disagrees with
   * the catalogue length by more than a few seconds, the catalogue wins.
   */
  private effectiveDuration(): number {
    const a = this.deps.audio;
    const media = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0;
    const t = this.currentTrack;
    const catalog = t?.durationSec || (t ? this.durations.get(t.id) : 0) || 0;
    if (catalog > 0 && (!media || Math.abs(media - catalog) > Math.max(3, catalog * 0.03))) return catalog;
    return media || catalog;
  }

  /** Ask once for the real length of a song that came without one (see EngineDeps.lookupDuration). */
  private learnDuration(track: Track, gen: number) {
    if (track.durationSec || this.durations.has(track.id) || !this.deps.lookupDuration) return;
    void this.deps.lookupDuration(track).then((sec) => {
      if (!(typeof sec === "number" && Number.isFinite(sec) && sec > 0)) return;
      if (this.durations.size > 500) this.durations.clear(); // bounded
      this.durations.set(track.id, sec);
      if (gen !== this.gen) return;
      const d = this.effectiveDuration();
      this.set({ durationSec: d });
      const a = this.deps.audio;
      if (d > 0) this.deps.mediaSession?.setPosition(Math.min(a.currentTime, d), d, a.paused ? 0 : 1);
    }, () => undefined);
  }

  /**
   * Re-assert everything the lock screen / Control Center / notification shows: handlers, metadata,
   * play state and position. iOS can drop a page's Media Session while it is backgrounded (WebKit
   * bug 261858) and then falls back to its own ±10 s buttons — call this on visibility changes.
   */
  refreshMediaSession() {
    const ms = this.deps.mediaSession;
    if (!ms) return;
    this.bindMediaSession();
    // Hidden: keep the "Open the app to resume" hint if it's showing; visible: always the real song.
    if (this.lockHint && this.deps.isHidden?.()) return;
    this.lockHint = false;
    ms.setMetadata(this.currentTrack);
    const s = this.state.status;
    ms.setPlaybackState(s === "playing" || s === "buffering" || s === "seeking" || s === "loading" ? "playing" : this.currentTrack ? "paused" : "none");
    const a = this.deps.audio, d = this.effectiveDuration();
    if (d > 0) ms.setPosition(Math.min(a.currentTime, d), d, a.paused ? 0 : 1);
  }

  private bindMediaSession() {
    const ms = this.deps.mediaSession;
    if (!ms) return;
    ms.setHandlers({
      play: () => this.play(),
      pause: () => this.pause(),
      stop: () => this.pause(),
      previoustrack: () => this.previous(),
      nexttrack: () => this.next(),
      seekto: (d) => { if (d?.seekTime != null) this.seek(d.seekTime); },
      // Deliberately NOT registered: with seek-skip handlers, iOS replaces the lock-screen ⏮ ⏭ with
      // ±10 s buttons. Native music apps show previous/next, and headset double/triple-click map to them.
      seekbackward: this.deps.seekButtons ? (d) => this.seek(this.deps.audio.currentTime - (d?.seekOffset ?? SEEK_STEP_SEC)) : null,
      seekforward: this.deps.seekButtons ? (d) => this.seek(this.deps.audio.currentTime + (d?.seekOffset ?? SEEK_STEP_SEC)) : null,
    });
  }

  // ---------------- radio / autoplay ----------------
  /** Fetch more radio tracks. Bounded: one request in flight; returns whether anything was added. */
  private async refill(force: boolean): Promise<boolean> {
    if (this.refilling || !this.deps.fetchRadio) return false;
    if (!force && !this.state.autoplay) return false;
    const seed = this.radioSeed ?? this.queue.entries.at(-1)?.track ?? null;
    if (!seed) return false;
    const gen = this.gen;
    this.refilling = true;
    this.set({ replenishing: true });
    try {
      const sameSeed = this.radioSeed?.id === seed.id;
      const res = await this.deps.fetchRadio(seed, sameSeed ? this.radioContinuation : undefined);
      if (!this.radioSeed) this.radioSeed = seed;
      this.radioContinuation = res.continuation;
      const before = this.queue.length;
      this.queue = this.queue.appendAuto(res.tracks.filter((t) => t.id !== seed.id || gen !== this.gen));
      this.syncQueue();
      return this.queue.length > before;
    } catch {
      return false; // autoplay is best-effort; never surfaces as a playback error
    } finally {
      this.refilling = false;
      this.set({ replenishing: false });
    }
  }

  /**
   * Prepare the next track once the current one is within the lead time of its end (default 30 s,
   * clamped to ≥ 5 s so preparation always starts before the last 5 seconds). One next track only,
   * cancellable; a rebuffer of the current song or a track change aborts it (one retry later).
   */
  private maybePrefetchNext() {
    if (!this.deps.prefetch || this.prefetchGen === this.gen) return;
    const next = this.queue.upcoming[0]?.track;
    if (!next) return;
    const lead = Math.max(5, this.deps.prefetchLeadSec ?? 30);
    const dur = this.effectiveDuration(), pos = this.deps.audio.currentTime;
    if (dur > 0 && dur - pos > lead) return; // not yet
    this.prefetchGen = this.gen;
    this.prefetchTries++;
    this.prefetchAbort = new AbortController();
    this.deps.onDiagnostic?.(`prefetch:start ${next.id} remaining=${dur > 0 ? (dur - pos).toFixed(1) : "?"}`);
    this.deps.prefetch(next, this.prefetchAbort.signal);
  }

  /** Cancel next-track preparation (rebuffering current song, or a new load). */
  private abortPrefetch(reason: string, allowRetry: boolean) {
    if (!this.prefetchAbort) return;
    this.prefetchAbort.abort();
    this.prefetchAbort = null;
    this.deps.onDiagnostic?.(`prefetch:abort ${reason}`);
    if (allowRetry && this.prefetchTries < 2) this.prefetchGen = -1;
  }

  // ---------------- analytics ----------------
  private resetAnalytics() {
    this.playedMs = 0;
    this.lastTick = null;
    this.sentStart = false;
    this.sentQualified = false;
  }

  private tickAnalytics() {
    const now = this.deps.now();
    if (this.lastTick != null && !this.deps.audio.paused) {
      // Clamp: a large gap means the page was suspended or the user seeked — not listening time.
      this.playedMs += Math.min(now - this.lastTick, 1500);
    }
    this.lastTick = this.deps.audio.paused ? null : now;
    const t = this.currentTrack;
    const durMs = (this.state.durationSec || t?.durationSec || 0) * 1000;
    if (t && !this.sentQualified && (this.playedMs >= QUALIFIED_MS || (durMs > 0 && this.playedMs >= durMs / 2))) {
      this.sentQualified = true;
      this.emit("qualified", t);
    }
  }

  private flushAnalyticsTick() {
    this.tickAnalytics();
    this.lastTick = null;
  }

  /** Called when leaving the current entry. "skip" only counts if it wasn't a qualified listen. */
  private finishCurrent(kind: "skip" | "complete") {
    const t = this.currentTrack;
    if (!t || !this.sentStart) return;
    this.tickAnalytics();
    if (kind === "complete") this.emit("complete", t);
    else if (!this.sentQualified) this.emit("skip", t);
  }

  private emit(type: AnalyticsType, track: Track) {
    const durationSec = this.state.durationSec || track.durationSec;
    try {
      this.deps.onAnalytics?.({ type, track, msPlayed: Math.round(this.playedMs), durationMs: durationSec ? Math.round(durationSec * 1000) : undefined, context: this.state.context });
    } catch {
      /* analytics must never break playback */
    }
  }

  // ---------------- persistence ----------------
  private scheduleSave() {
    if (!this.deps.save || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.writeSave();
    }, 500);
  }

  private writeSave() {
    if (!this.deps.save) return;
    {
      const snap = this.queue.snapshot();
      // Keep the saved queue bounded: up to 50 history entries and 300 upcoming.
      const start = Math.max(0, snap.index - 50);
      const entries = snap.entries.slice(start, snap.index + 301);
      this.deps.save!({
        version: 1,
        queue: { entries, index: snap.index - start, unshuffled: snap.unshuffled },
        context: this.state.context, positionSec: this.state.positionSec, shuffle: this.state.shuffle, repeat: this.state.repeat,
        volume: this.state.volume, muted: this.state.muted, autoplay: this.state.autoplay, radioSeed: this.radioSeed, radioContinuation: this.radioContinuation,
      });
    }
  }
}

function navigatorOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export type { PlayerStatus };
