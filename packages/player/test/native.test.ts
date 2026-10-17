import { describe, expect, it } from "vitest";
import type { Track } from "@zuno/core";
import { NativeAudioElement, NativeMediaSession, PlayerEngine } from "../src";
import { SILENT_WAV } from "../src/engine";
import { FakeBridge } from "./fakeBridge";

const tr = (id: string, dur = 200): Track => ({ id, provider: "dev", title: id, artist: "A", durationSec: dur });
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const bridge = new FakeBridge();
  let now = 0;
  const audio = new NativeAudioElement(bridge, { resolveUrl: (u) => `https://app.test${u}`, now: () => now });
  const engine = new PlayerEngine({
    audio,
    mediaSession: new NativeMediaSession(bridge),
    streamUrl: (t) => `/stream/${t.id}?t=tok`,
  });
  return { bridge, audio, engine, clock: (ms: number) => { now += ms; } };
}

describe("NativeAudioElement", () => {
  it("sends load and the play right after it as one native call, with an absolute URL", async () => {
    const { bridge, engine } = setup();
    engine.playList([tr("a"), tr("b")]);
    await tick();
    expect(bridge.calls.filter((c) => c.m === "load" || c.m === "play")).toEqual([
      { m: "load", a: { seq: 1, url: "https://app.test/stream/a?t=tok", autoplay: true } },
    ]);
    bridge.start();
    expect(engine.getState().status).toBe("playing");
  });

  it("interpolates the clock between native ticks, and stops when native waits", async () => {
    const { bridge, audio, engine, clock } = setup();
    engine.playList([tr("a")]);
    await tick();
    bridge.start();
    bridge.tick(10);
    clock(500);
    expect(audio.currentTime).toBeCloseTo(10.5);
    bridge.emit("waiting");
    clock(2000);
    expect(audio.currentTime).toBeCloseTo(10);
  });

  it("ignores paused/time from events that were in flight before a newer command", async () => {
    const { bridge, audio, engine } = setup();
    engine.playList([tr("a")]);
    await tick();
    bridge.start();
    engine.pause();
    expect(audio.paused).toBe(true);
    // Produced before native saw the pause (older seq): must not flip the element back to playing.
    bridge.emit("timeupdate", { seq: bridge.seq - 1, paused: false });
    expect(audio.paused).toBe(true);
  });

  it("maps native errors to MediaError codes and reaches the engine's recovery", async () => {
    const { bridge, audio, engine } = setup();
    engine.playList([tr("a"), tr("b")]);
    await tick();
    bridge.start();
    bridge.tick(30);
    bridge.emit("error", { code: 2, paused: true });
    await tick();
    // The engine's one silent retry: reload the same song at the same spot.
    expect(bridge.loads).toBe(2);
    expect(engine.getState().positionSec).toBeCloseTo(30);
    // Code 4 (unsupported) is not retried: the engine reports the track as unavailable.
    bridge.start();
    bridge.emit("error", { code: 4, paused: true });
    expect(audio.error?.code).toBe(4);
    expect(engine.getState().error?.kind).toBe("unavailable");
  });

  it("does nothing natively for the engine's silent gesture-unlock source", async () => {
    const bridge = new FakeBridge();
    const audio = new NativeAudioElement(bridge);
    audio.src = SILENT_WAV;
    audio.load();
    await audio.play();
    await tick();
    expect(bridge.calls).toEqual([]);
  });

  it("forwards volume and mute", () => {
    const { bridge, engine } = setup();
    engine.setVolume(0.5);
    engine.toggleMute();
    expect(bridge.calls.filter((c) => c.m === "setVolume").at(-1)).toEqual({ m: "setVolume", a: { volume: 0.5, muted: true } });
  });
});

describe("native running ahead of a suspended page", () => {
  it("a track that ended natively and moved on is adopted without reloading", async () => {
    const { bridge, engine } = setup();
    engine.playList([tr("a"), tr("b")]);
    await tick();
    bridge.start();
    void bridge.setNext({ url: "https://app.test/stream/b?t=tok", meta: null });
    bridge.end(); // native: ended → advanced to b → playing (page catches up on these events)
    await tick();
    expect(engine.currentTrack?.id).toBe("b");
    expect(bridge.loads).toBe(1); // b was never reloaded
    expect(engine.getState().status).toBe("playing");
  });

  it("lock-screen ⏭ carried out natively moves the engine to the next track too", async () => {
    const { bridge, engine } = setup();
    engine.playList([tr("a"), tr("b")]);
    await tick();
    bridge.start();
    bridge.current = FakeBridge.identity("https://app.test/stream/b?t=tok"); // native advanced on ⏭
    bridge.sendRemote({ command: "next", handled: true });
    await tick();
    expect(engine.currentTrack?.id).toBe("b");
    expect(bridge.loads).toBe(1);
  });

  it("commands native already carried out (pause, seek) aren't repeated by the page", async () => {
    const { bridge, engine } = setup();
    engine.playList([tr("a")]);
    await tick();
    bridge.start();
    const before = bridge.calls.length;
    bridge.paused = true;
    bridge.sendRemote({ command: "pause", handled: true });
    bridge.emit("pause");
    bridge.sendRemote({ command: "seekto", handled: true, seekTime: 50 });
    expect(bridge.calls.length).toBe(before);
    expect(engine.getState().status).toBe("paused");
  });

  it("a command native couldn't serve (⏮ near the start) goes to the engine", async () => {
    const { bridge, engine } = setup();
    engine.playList([tr("a"), tr("b")], 1);
    await tick();
    bridge.start();
    bridge.sendRemote({ command: "previous", handled: false });
    await tick();
    expect(engine.currentTrack?.id).toBe("a");
  });

  it("sends metadata to native with each track", async () => {
    const { bridge, engine } = setup();
    engine.playList([tr("a")]);
    expect(bridge.meta).toEqual({ title: "a", artist: "A" });
  });
});
