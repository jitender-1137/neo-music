import { describe, expect, it, vi } from "vitest";
import type { Track } from "@zuno/core";
import { PlayerEngine, type AnalyticsEvent, type SavedSession } from "../src";
import { FakeAudio } from "./fakeAudio";

const tr = (id: string, dur = 200): Track => ({ id, provider: "dev", title: id, artist: "A", durationSec: dur });
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(over: Partial<ConstructorParameters<typeof PlayerEngine>[0]> = {}) {
  const audio = new FakeAudio();
  let now = 1_000_000;
  const events: AnalyticsEvent[] = [];
  const engine = new PlayerEngine({
    audio,
    streamUrl: (t) => `/stream/${t.id}`,
    onAnalytics: (e) => events.push(e),
    now: () => now,
    rng: () => 0.42,
    ...over,
  });
  return { audio, engine, events, clock: (ms: number) => { now += ms; } };
}

describe("PlayerEngine", () => {
  it("plays a list synchronously inside the gesture", () => {
    const { audio, engine } = setup();
    engine.playList([tr("a"), tr("b")], 0);
    expect(audio.src).toBe("/stream/a");
    expect(audio.playCalls).toBe(1); // play() called before any await
    expect(engine.getState().status).toBe("loading");
    audio.start();
    expect(engine.getState().status).toBe("playing");
  });

  it("async URL: unlocks with silence inside the gesture, then swaps to the real source", async () => {
    let resolve!: (u: string) => void;
    const { audio, engine } = setup({ streamUrl: () => new Promise<string>((r) => { resolve = r; }) });
    engine.playList([tr("a")]);
    expect(audio.src.startsWith("data:audio/wav")).toBe(true);
    expect(audio.playCalls).toBe(1);
    resolve("/stream/a");
    await tick();
    expect(audio.src).toBe("/stream/a");
    expect(audio.playCalls).toBe(2);
  });

  it("async URL that resolves after the user moved on is ignored", async () => {
    const resolvers: ((u: string) => void)[] = [];
    const { audio, engine } = setup({ streamUrl: (t) => (t.id === "a" ? new Promise<string>((r) => resolvers.push(r)) : `/stream/${t.id}`) });
    engine.playList([tr("a"), tr("b")]);
    engine.next();
    resolvers[0]!("/stream/a");
    await tick();
    expect(audio.src).toBe("/stream/b");
  });

  it("advances on ended and stops at the end without repeat/autoplay", () => {
    const { audio, engine } = setup();
    engine.setAutoplay(false);
    engine.playList([tr("a"), tr("b")]);
    audio.start(); audio.end();
    expect(audio.src).toBe("/stream/b");
    audio.start(); audio.end();
    expect(engine.getState().status).toBe("ended");
  });

  it("repeat one replays, repeat all wraps", () => {
    const { audio, engine } = setup();
    engine.setAutoplay(false);
    engine.playList([tr("a"), tr("b")]);
    engine.setRepeat("one");
    audio.start(); audio.end();
    expect(audio.src).toBe("/stream/a");
    expect(audio.currentTime).toBe(0);
    engine.setRepeat("all");
    engine.next(); audio.start(); audio.end();
    expect(audio.src).toBe("/stream/a");
  });

  it("previous restarts after 3s, otherwise goes back", () => {
    const { audio, engine } = setup();
    engine.playList([tr("a"), tr("b")], 1);
    audio.start(); audio.advance(10);
    engine.previous();
    expect(audio.src).toBe("/stream/b");
    expect(audio.currentTime).toBe(0);
    audio.currentTime = 1;
    engine.previous();
    expect(audio.src).toBe("/stream/a");
  });

  it("previous({ restart: false }) always changes track (swipe gesture)", () => {
    const { audio, engine } = setup();
    engine.playList([tr("a"), tr("b")], 1);
    audio.start(); audio.advance(10);
    engine.previous({ restart: false });
    expect(audio.src).toBe("/stream/a");
  });

  it("ignores stale continuations: rapid track changes leave only the last", async () => {
    const radio = vi.fn(async (seed: Track) => { await tick(); return { tracks: [tr(`${seed.id}-r1`), tr(`${seed.id}-r2`)] }; });
    const { audio, engine } = setup({ fetchRadio: radio });
    engine.playTrack(tr("a"));
    engine.playTrack(tr("b"));
    await tick(); await tick();
    expect(audio.src).toBe("/stream/b");
    expect(engine.getState().queue.entries[0]!.track.id).toBe("b");
  });

  it("refills radio when the auto tail runs low, without duplicates", async () => {
    const radio = vi.fn(async (_seed: Track, _cont?: string) => ({ tracks: [tr("s"), tr("r1"), tr("r2")], continuation: "c1" }));
    const { audio, engine } = setup({ fetchRadio: radio });
    engine.playTrack(tr("s"));
    await tick();
    const q = engine.getState().queue.entries.map((e) => e.track.id);
    expect(q).toEqual(["s", "r1", "r2"]);
    audio.start(); audio.advance(1);
    await tick();
    expect(radio).toHaveBeenCalledTimes(2);
    expect(radio.mock.calls[1]![1]).toBe("c1");
  });

  it("emits start, qualified, complete and skip correctly", () => {
    const { audio, engine, events, clock } = setup();
    engine.setAutoplay(false);
    engine.playList([tr("a", 200), tr("b", 200), tr("c", 200)]);
    audio.start();
    for (let i = 0; i < 31; i++) { clock(1000); audio.advance(1); }
    audio.end();
    audio.start();
    clock(1000); audio.advance(1);
    engine.next();
    expect(events.map((e) => `${e.type}:${e.track.id}`)).toEqual(["start:a", "qualified:a", "complete:a", "start:b", "skip:b"]);
  });

  it("next at the end of the queue with autoplay off is a no-op", () => {
    const { audio, engine } = setup();
    engine.setAutoplay(false);
    engine.playList([tr("a")]);
    audio.start();
    engine.next();
    expect(audio.src).toBe("/stream/a");
    expect(engine.getState().status).toBe("playing");
  });

  it("does not count paused or seek gaps as listening time", () => {
    const { audio, engine, events, clock } = setup();
    engine.playList([tr("a", 600)]);
    audio.start();
    clock(5000); audio.advance(1);
    audio.pause();
    clock(60_000); audio.fire("timeupdate");
    expect(events.find((e) => e.type === "qualified")).toBeUndefined();
  });

  it("media error: one silent retry from position, then a recoverable error that skips", async () => {
    vi.useFakeTimers();
    const diagnose = vi.fn(async () => ({ message: "Unavailable", skippable: true }));
    const { audio, engine } = setup({ diagnose });
    engine.playList([tr("a"), tr("b")]);
    audio.start(); audio.advance(42);
    audio.failWith(2);
    expect(audio.src).toBe("/stream/a"); // retried
    expect(engine.getState().positionSec).toBe(42);
    audio.failWith(2);
    await vi.waitFor(() => expect(engine.getState().error?.message).toBe("Unavailable"));
    expect(engine.getState().status).toBe("error");
    await vi.advanceTimersByTimeAsync(1600);
    expect(audio.src).toBe("/stream/b");
    vi.useRealTimers();
  });

  it("stops auto-skipping after too many consecutive errors", async () => {
    const { audio, engine } = setup({ diagnose: async () => ({ message: "x", skippable: true }) });
    engine.playList([tr("a"), tr("b"), tr("c"), tr("d")]);
    for (let i = 0; i < 3; i++) {
      audio.failWith(4);
      await tick();
      if (i < 2) engine.next();
    }
    expect(engine.getState().error?.recoverable).toBe(false);
  });

  it("a stale 'playing' event after pausing during load does not flip state to playing", () => {
    const { audio, engine } = setup();
    engine.playList([tr("a")]);
    engine.togglePlay(); // pause while still loading
    expect(audio.paused).toBe(true);
    audio.fire("playing"); // late event from the original play()
    expect(engine.getState().status).toBe("paused");
    engine.togglePlay(); // must resume, not pause again
    expect(audio.paused).toBe(false);
  });

  it("two quick toggles pause then resume even before media events arrive", () => {
    const { audio, engine } = setup();
    engine.playList([tr("a")]);
    audio.start();
    // FakeAudio.pause fires "pause" synchronously; simulate a browser that dispatches it later.
    const realFire = audio.fire.bind(audio);
    const queued: string[] = [];
    audio.fire = (t: string) => { if (t === "pause") queued.push(t); else realFire(t); };
    engine.togglePlay();
    engine.togglePlay();
    queued.forEach((t) => realFire(t));
    expect(audio.paused).toBe(false);
  });

  it("syncFromMedia reflects an OS-initiated pause (e.g. phone call) missed while suspended", () => {
    const { audio, engine } = setup();
    engine.playList([tr("a")]);
    audio.start();
    audio.paused = true; // paused by the OS, no event delivered
    engine.syncFromMedia();
    expect(engine.getState().status).toBe("paused");
    engine.togglePlay();
    expect(audio.paused).toBe(false);
  });

  it("treats NotAllowedError as paused, not failed — surfaced as its own gentle 'tap play' kind", async () => {
    const { audio, engine } = setup();
    audio.rejectNextPlay = "NotAllowedError";
    engine.playList([tr("a")]);
    await tick();
    expect(engine.getState().status).toBe("paused");
    expect(engine.getState().error).toMatchObject({ kind: "not_allowed", recoverable: true });
    // The next real tap plays and clears it.
    engine.togglePlay();
    audio.start();
    expect(engine.getState().error).toBeNull();
  });

  it("seek before load is applied after metadata", () => {
    const { audio, engine } = setup();
    engine.playList([tr("a")]);
    engine.seek(30);
    audio.start(200);
    expect(audio.currentTime).toBe(30);
  });

  it("restores a saved session paused, then resumes from position on play", () => {
    const { audio, engine } = setup();
    const saved: SavedSession = {
      version: 1, queue: { entries: [{ uid: "u1", track: tr("a"), source: "context" }, { uid: "u2", track: tr("b"), source: "context" }], index: 1, unshuffled: null },
      context: null, positionSec: 77, shuffle: false, repeat: "all", volume: 0.5, muted: false, autoplay: true, radioSeed: null,
    };
    engine.restore(saved);
    expect(engine.getState()).toMatchObject({ status: "paused", positionSec: 77, repeat: "all", volume: 0.5 });
    expect(audio.playCalls).toBe(0);
    engine.play();
    expect(audio.src).toBe("/stream/b");
    audio.start();
    expect(audio.currentTime).toBe(77);
  });

  it("saves debounced, bounded sessions", async () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const { engine } = setup({ save });
    engine.playList(Array.from({ length: 600 }, (_, i) => tr(`t${i}`)), 100);
    await vi.advanceTimersByTimeAsync(600);
    const s = save.mock.calls.at(-1)![0] as SavedSession;
    expect(s.queue.entries.length).toBeLessThanOrEqual(351);
    expect(s.queue.entries[s.queue.index]!.track.id).toBe("t100");
    vi.useRealTimers();
  });

  it("wires media session actions and cleans up listeners on dispose", () => {
    const handlers: Record<string, unknown> = {};
    const ms = { setMetadata: vi.fn(), setPlaybackState: vi.fn(), setPosition: vi.fn(), setHandlers: (h: Record<string, unknown>) => Object.assign(handlers, h) };
    const { audio, engine } = setup({ mediaSession: ms });
    engine.playList([tr("a"), tr("b")]);
    expect(ms.setMetadata).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    (handlers.nexttrack as () => void)();
    expect(audio.src).toBe("/stream/b");
    // Native-app lock screen: previous/next + scrubber; no ±10 s skip buttons (iOS would show those instead).
    expect(typeof handlers.previoustrack).toBe("function");
    expect(typeof handlers.seekto).toBe("function");
    expect(handlers.seekbackward).toBeNull();
    expect(handlers.seekforward).toBeNull();
    // Handlers are re-registered whenever playback starts (iOS can drop them on source changes).
    for (const k of Object.keys(handlers)) delete handlers[k];
    audio.start();
    expect(typeof handlers.nexttrack).toBe("function");
    expect(typeof handlers.previoustrack).toBe("function");
    const before = audio.listenerCount();
    engine.dispose();
    expect(audio.listenerCount()).toBeLessThan(before);
    expect(audio.listenerCount()).toBe(0);
  });

  it("refreshMediaSession re-asserts lock-screen handlers, metadata and state after iOS drops them", () => {
    const handlers: Record<string, unknown> = {};
    const ms = { setMetadata: vi.fn(), setPlaybackState: vi.fn(), setPosition: vi.fn(), setHandlers: (h: Record<string, unknown>) => Object.assign(handlers, h) };
    const { audio, engine } = setup({ mediaSession: ms });
    engine.playList([tr("a"), tr("b")]);
    audio.start();
    for (const k of Object.keys(handlers)) delete handlers[k]; // backgrounded: iOS forgot them
    ms.setMetadata.mockClear(); ms.setPlaybackState.mockClear();
    engine.refreshMediaSession();
    expect(typeof handlers.nexttrack).toBe("function");
    expect(typeof handlers.play).toBe("function");
    expect(ms.setMetadata).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    expect(ms.setPlaybackState).toHaveBeenLastCalledWith("playing");
    (handlers.nexttrack as () => void)();
    expect(audio.src).toBe("/stream/b");
  });

  it("lock screen: a connection drop while paused doesn't reload in the background; play() resumes at the same spot", () => {
    const { audio, engine } = setup();
    engine.playList([tr("a"), tr("b")]);
    audio.start(); audio.advance(42);
    engine.pause();
    expect(engine.getState().status).toBe("paused");
    const loads = vi.spyOn(audio, "load");
    audio.failWith(2); // MEDIA_ERR_NETWORK while paused (iOS closed the idle stream)
    expect(loads).not.toHaveBeenCalled(); // nothing reloaded in the background
    expect(engine.getState().status).toBe("paused"); // still a normal pause, no error UI
    expect(engine.getState().error).toBeNull();
    const plays = audio.playCalls;
    engine.play(); // the lock-screen ▶ — reloads and plays synchronously in the same call
    expect(loads).toHaveBeenCalledTimes(1);
    expect(audio.playCalls).toBe(plays + 1);
    expect(audio.src).toBe("/stream/a");
    audio.start();
    expect(audio.currentTime).toBe(42); // resumed where it was
    expect(engine.getState().status).toBe("playing");
  });

  it("lock screen: a plain resume plays the same element without reloading", () => {
    const { audio, engine } = setup();
    engine.playList([tr("a")]);
    audio.start(); audio.advance(10);
    engine.pause();
    const loads = vi.spyOn(audio, "load");
    engine.play();
    expect(loads).not.toHaveBeenCalled();
    expect(audio.paused).toBe(false);
  });

  it("lock screen: if resuming a stale paused stream fails, it reloads once at the same position", async () => {
    const { audio, engine } = setup();
    engine.playList([tr("a")]);
    audio.start(); audio.advance(30);
    engine.pause();
    const loads = vi.spyOn(audio, "load");
    audio.rejectNextPlay = "NotSupportedError";
    engine.play();
    await tick();
    expect(loads).toHaveBeenCalledTimes(1);
    audio.start();
    expect(audio.currentTime).toBe(30);
  });

  it("after the OS pauses the audio by itself, the next play tap plays (not a second pause)", () => {
    const { audio, engine } = setup();
    engine.playList([tr("a")]);
    audio.start();
    audio.pause(); // iOS paused the element directly (no Media Session handler involved)
    expect(engine.getState().status).toBe("paused");
    engine.togglePlay();
    expect(audio.paused).toBe(false);
  });

  it("duration: Safari's doubled stream estimate never replaces the real song length (app + lock screen)", () => {
    const ms = { setMetadata: vi.fn(), setPlaybackState: vi.fn(), setPosition: vi.fn(), setHandlers: vi.fn() };
    const { audio, engine } = setup({ mediaSession: ms });
    engine.playList([{ ...tr("a"), durationSec: 295 }, { ...tr("b"), durationSec: 180 }]);
    audio.start(589); // Safari reports ~2× for an HE-AAC stream
    expect(engine.getState().durationSec).toBe(295);
    expect(ms.setPosition).toHaveBeenLastCalledWith(expect.any(Number), 295, 1);
    audio.duration = 600; audio.fire("durationchange"); // revised estimate while streaming
    expect(engine.getState().durationSec).toBe(295);
    // Next song: its own length, not a sum or the previous one.
    engine.next();
    expect(engine.getState().durationSec).toBe(180);
    audio.start(360);
    expect(engine.getState().durationSec).toBe(180);
    // When the browser's figure is right, its precision is kept.
    engine.previous({ restart: false });
    audio.start(295.4);
    expect(engine.getState().durationSec).toBeCloseTo(295.4, 1);
  });

  it("lock screen ▶ after a long pause re-opens the stream (the seek that fixed it by hand)", () => {
    const { audio, engine, clock } = setup();
    engine.playList([tr("a")]);
    audio.start(); audio.advance(94);
    engine.pause();
    clock(60_000); // paused a minute on the lock screen
    const seeks = audio.seeks;
    engine.play();
    expect(audio.seeks).toBe(seeks + 1); // re-seek to the same spot → fresh request
    expect(audio.currentTime).toBe(94);
    expect(audio.paused).toBe(false);
  });

  it("a short pause resumes without any re-seek", () => {
    const { audio, engine, clock } = setup();
    engine.playList([tr("a")]);
    audio.start(); audio.advance(10);
    engine.pause();
    clock(3_000);
    const seeks = audio.seeks;
    engine.play();
    expect(audio.seeks).toBe(seeks);
  });

  it("stall watchdog: 'playing' but the clock doesn't move → re-seek, then reload at the same spot", () => {
    vi.useFakeTimers();
    try {
      const { audio, engine, clock } = setup();
      engine.playList([tr("a")]);
      audio.start(); audio.advance(50);
      engine.pause(); clock(2_000);
      engine.play(); // resumes, but the element never makes progress (silent stall)
      const seeks = audio.seeks;
      vi.advanceTimersByTime(4_100);
      expect(audio.seeks).toBe(seeks + 1); // stage 1: re-seek
      const loads = vi.spyOn(audio, "load");
      vi.advanceTimersByTime(4_100);
      expect(loads).toHaveBeenCalledTimes(1); // stage 2: reload…
      audio.start();
      expect(audio.currentTime).toBe(50); // …at the same position
    } finally { vi.useRealTimers(); }
  });

  it("stall watchdog stays quiet when playback really progresses", () => {
    vi.useFakeTimers();
    try {
      const { audio, engine, clock } = setup();
      engine.playList([tr("a")]);
      audio.start(); audio.advance(5);
      engine.pause(); clock(1_000);
      engine.play();
      const seeks = audio.seeks;
      audio.advance(3);
      vi.advanceTimersByTime(10_000);
      expect(audio.seeks).toBe(seeks);
    } finally { vi.useRealTimers(); }
  });

  it("returning to the app heals a stuck 'playing' state", () => {
    vi.useFakeTimers();
    try {
      const { audio, engine } = setup();
      engine.playList([tr("a")]);
      audio.start(); audio.advance(20);
      const seeks = audio.seeks;
      engine.healIfStalled(); // page became visible
      vi.advanceTimersByTime(1_600); // clock didn't move meanwhile
      expect(audio.seeks).toBe(seeks + 1);
    } finally { vi.useRealTimers(); }
  });

  it("iOS resuming the element itself (app frozen) still re-opens the stream and adopts 'playing'", () => {
    const { audio, engine, clock } = setup();
    engine.playList([tr("a")]);
    audio.start(); audio.advance(70);
    engine.pause();
    clock(120_000);
    const seeks = audio.seeks;
    audio.paused = false; audio.fire("play"); // native resume, our play() never ran
    expect(audio.seeks).toBe(seeks + 1);
    audio.fire("playing");
    expect(engine.getState().status).toBe("playing");
    engine.togglePlay(); // the next tap pauses (not a second play)
    expect(audio.paused).toBe(true);
  });

  it("ended: a duplicate 'ended' advances exactly once; repeat-one still loops", () => {
    const { audio, engine } = setup();
    engine.playList([tr("a"), tr("b"), tr("c")]);
    audio.start(); audio.end();
    expect(audio.src).toBe("/stream/b");
    audio.fire("ended"); // duplicate for the same load
    expect(audio.src).toBe("/stream/b");
    audio.start();
    engine.cycleRepeat(); engine.cycleRepeat(); // off → all → one
    expect(engine.getState().repeat).toBe("one");
    audio.end(); audio.start(); audio.end();
    expect(audio.src).toBe("/stream/b"); // looped twice, still on b
  });

  it("stale load: a slow async source for an old track never replaces the newer one", async () => {
    let resolveA!: (u: string) => void;
    const { audio, engine } = setup({ streamUrl: (t) => (t.id === "a" ? new Promise<string>((r) => (resolveA = r)) : `/stream/${t.id}`) });
    engine.playList([tr("a"), tr("b")]);
    engine.next(); // user moved on before "a" resolved
    expect(audio.src).toBe("/stream/b");
    resolveA("/stream/a");
    await tick();
    expect(audio.src).toBe("/stream/b");
  });

  it("prefetch: prepares the next track only within the lead time (before the last 5 s), once, cancellable", () => {
    const calls: { id: string; signal: AbortSignal }[] = [];
    const { audio, engine } = setup({ prefetch: (t, signal) => calls.push({ id: t.id, signal }), prefetchLeadSec: 30 });
    engine.playList([tr("a", 200), tr("b")]);
    audio.start(200); audio.advance(100);
    expect(calls).toHaveLength(0); // 100 s left: too early
    audio.advance(75); // 25 s left
    expect(calls.map((c) => c.id)).toEqual(["b"]);
    audio.advance(1); audio.advance(1);
    expect(calls).toHaveLength(1); // once per track
    // A rebuffer of the current song aborts it; it may retry once.
    audio.fire("waiting");
    expect(calls[0]!.signal.aborted).toBe(true);
    audio.fire("playing"); audio.advance(1);
    expect(calls).toHaveLength(2);
    // A track change aborts the in-flight preparation.
    engine.next();
    expect(calls[1]!.signal.aborted).toBe(true);
  });

  it("prefetch lead time is clamped so preparation always starts before 5 s remain", () => {
    const calls: string[] = [];
    const { audio, engine } = setup({ prefetch: (t) => calls.push(t.id), prefetchLeadSec: 1 });
    engine.playList([tr("a", 60), tr("b")]);
    audio.start(60); audio.advance(54.5); // 5.5 s left
    expect(calls).toHaveLength(0);
    audio.advance(0.6); // 4.9 s left
    expect(calls).toEqual(["b"]);
  });

  it("expired authorization: diagnosis asks for a retry → reloads once at the same position", async () => {
    const diagnose = vi.fn(async () => ({ message: "Reconnecting…", skippable: false, kind: "auth" as const, retry: true }));
    const { audio, engine } = setup({ diagnose });
    engine.playList([tr("a")]);
    audio.start(); audio.advance(33);
    const loads = vi.spyOn(audio, "load");
    audio.failWith(2); // first error: the engine's own silent retry
    audio.start(); audio.currentTime = 33;
    audio.failWith(4); // stream refused (expired token)
    await tick(); await tick();
    expect(diagnose).toHaveBeenCalledTimes(1);
    expect(loads.mock.calls.length).toBeGreaterThanOrEqual(2); // engine retry + auth retry
    audio.failWith(4); // fails again → no endless loop
    await tick(); await tick();
    expect(engine.getState().error?.kind).toBe("auth");
  });

  it("media errors are classified (network / decode / unavailable)", async () => {
    const { audio, engine } = setup({ diagnose: undefined });
    engine.playList([tr("a")]);
    audio.failWith(3); // at position 0 → no silent retry
    expect(engine.getState().error?.kind).toBe("decode");
  });

  it("seek ±10 buttons only where they don't replace previous/next (seekButtons)", () => {
    const handlers: Record<string, unknown> = {};
    const ms = { setMetadata: vi.fn(), setPlaybackState: vi.fn(), setPosition: vi.fn(), setHandlers: (h: Record<string, unknown>) => Object.assign(handlers, h) };
    const { audio, engine } = setup({ mediaSession: ms, seekButtons: true });
    engine.playList([tr("a")]);
    audio.start(); audio.advance(30);
    expect(typeof handlers.seekforward).toBe("function");
    (handlers.seekforward as (d?: { seekOffset?: number }) => void)({ seekOffset: 10 });
    expect(audio.currentTime).toBe(40);
    expect(typeof handlers.nexttrack).toBe("function"); // previous/next stay registered too
  });

  it("shuffle toggles keep the current track playing", () => {
    const { audio, engine } = setup();
    engine.playList([tr("a"), tr("b"), tr("c"), tr("d")]);
    audio.start();
    engine.toggleShuffle();
    expect(engine.getState().shuffle).toBe(true);
    expect(audio.src).toBe("/stream/a");
    engine.toggleShuffle();
    expect(engine.getState().queue.entries.map((e) => e.track.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("PlayerEngine confirmPlayback (iOS Home Screen app)", () => {
  function setupC(hidden = true) {
    vi.useFakeTimers();
    const ms = { meta: [] as (string | undefined)[], state: [] as string[] };
    const log: string[] = [];
    const r = setup({
      confirmPlayback: true,
      isHidden: () => hidden,
      onDiagnostic: (m) => log.push(m),
      mediaSession: {
        setMetadata: (t) => ms.meta.push(t?.artist),
        setPlaybackState: (s) => ms.state.push(s),
        setPosition: () => undefined,
        setHandlers: () => undefined,
      },
    });
    return { ...r, ms, log };
  }
  const afterEach = () => vi.useRealTimers();

  it("'playing' alone isn't playing: confirmed only when the clock moves", () => {
    const { audio, engine, ms } = setupC();
    engine.playList([tr("a")]);
    audio.start();
    expect(engine.getState().status).toBe("buffering");
    expect(ms.state.at(-1)).not.toBe("playing");
    audio.advance(0.5);
    expect(engine.getState().status).toBe("playing");
    expect(ms.state.at(-1)).toBe("playing");
    afterEach();
  });

  it("lock-screen ▶ with a frozen clock: reload once at the same spot, then report honestly", () => {
    const { audio, engine, ms, log } = setupC(true);
    engine.playList([tr("a"), tr("b")]);
    audio.start();
    audio.advance(40);
    engine.pause();
    engine.play(); // ▶ from the lock screen
    audio.paused = false;
    audio.fire("playing"); // iOS says playing…
    expect(engine.getState().status).toBe("buffering"); // …but we don't believe it yet
    vi.advanceTimersByTime(2_500); // clock never moved
    expect(log.some((m) => m.startsWith("resume:frozen t=40.0"))).toBe(true);
    expect(audio.src).toBe("/stream/a"); // same song reloaded, not skipped
    audio.start(); // reload reaches "playing" — still frozen
    vi.advanceTimersByTime(2_500);
    const s = engine.getState();
    expect(s.status).toBe("paused");
    expect(s.error?.kind).toBe("background_blocked");
    expect(s.queue.index).toBe(0); // the queue is untouched
    expect(audio.paused).toBe(true);
    expect(ms.state.at(-1)).toBe("paused");
    expect(ms.meta.at(-1)).toBe("Open the app to resume");
    // Opening the app and tapping ▶ works and restores the real artist on the lock screen.
    engine.play();
    audio.paused = false;
    audio.fire("playing");
    audio.advance(1);
    expect(engine.getState().status).toBe("playing");
    expect(engine.getState().error).toBeNull();
    expect(ms.meta.at(-1)).toBe("A");
    afterEach();
  });

  it("a resume that recovers on the reload counts as playing (no error)", () => {
    const { audio, engine, log } = setupC(true);
    engine.playList([tr("a")]);
    audio.start();
    audio.advance(10);
    engine.pause();
    engine.play();
    audio.paused = false;
    audio.fire("playing");
    vi.advanceTimersByTime(2_500);
    audio.start();
    audio.advance(1);
    expect(engine.getState().status).toBe("playing");
    expect(engine.getState().error).toBeNull();
    expect(log).toContain("resume:ok t=11.0"); // reloaded at 10 s, then played on
    afterEach();
  });

  it("in the foreground the failure message asks for a tap, not to open the app", () => {
    const { audio, engine } = setupC(false);
    engine.playList([tr("a")]);
    audio.start();
    vi.advanceTimersByTime(2_500);
    audio.start();
    vi.advanceTimersByTime(2_500);
    expect(engine.getState().error?.kind).toBe("unknown");
    expect(engine.getState().error?.message).toMatch(/Tap play/);
    afterEach();
  });

  it("seeking backwards while confirming doesn't count as a frozen clock", () => {
    const { audio, engine } = setupC();
    engine.playList([tr("a")]);
    audio.start();
    audio.advance(0.5); // confirmed
    audio.advance(30);
    engine.pause();
    engine.play();
    audio.paused = false;
    audio.fire("playing");
    engine.seek(5);
    audio.fire("seeked");
    expect(engine.getState().status).toBe("buffering");
    audio.advance(0.4);
    expect(engine.getState().status).toBe("playing");
    afterEach();
  });

  it("without confirmPlayback (desktop, Android, Safari tab) 'playing' is playing at once", () => {
    const { audio, engine } = setup();
    engine.playList([tr("a")]);
    audio.start();
    expect(engine.getState().status).toBe("playing");
  });
});

describe("PlayerEngine song length for songs listed without one", () => {
  const noLen = (id: string): Track => ({ id, provider: "dev", title: id, artist: "A" });

  it("Safari's doubled estimate is replaced by the server's length (8:58 → 4:29)", async () => {
    const asked: string[] = [];
    const { audio, engine } = setup({ lookupDuration: async (t) => { asked.push(t.id); return 269; } });
    engine.playList([noLen("kalyani"), noLen("b")]);
    audio.start(538); // what Safari reported
    await tick();
    expect(engine.getState().durationSec).toBe(269);
    expect(asked).toEqual(["kalyani"]);
    // Later updates from the browser can't bring the doubled length back.
    audio.fire("durationchange");
    expect(engine.getState().durationSec).toBe(269);
  });

  it("asks only for songs without a length, once per load, and ignores bad answers", async () => {
    const asked: string[] = [];
    const { audio, engine } = setup({ lookupDuration: async (t) => { asked.push(t.id); return t.id === "x" ? NaN : 200; } });
    engine.playList([tr("has", 180), noLen("x"), noLen("y")]);
    audio.start(180);
    engine.next();
    audio.start(300);
    await tick();
    expect(engine.getState().durationSec).toBe(300); // NaN answer ignored → browser's figure
    engine.previous({ restart: false });
    engine.next();
    engine.next();
    await tick();
    // "has" is never asked; "x" gave no usable answer so it's asked again when it plays again; "y" once.
    expect(asked).toEqual(["x", "x", "y"]);
  });

  it("a late answer for an earlier song doesn't change the current song's length", async () => {
    let resolve!: (n: number) => void;
    const { audio, engine } = setup({ lookupDuration: (t) => (t.id === "slow" ? new Promise<number>((r) => { resolve = r; }) : Promise.resolve(undefined)) });
    engine.playList([noLen("slow"), tr("b", 150)]);
    engine.next();
    audio.start(150);
    resolve(999);
    await tick();
    expect(engine.getState().durationSec).toBe(150);
  });
});
