import { describe, expect, it } from "vitest";
import type { Track } from "@zuno/core";
import { Queue } from "../src";

const tr = (id: string): Track => ({ id, provider: "dev", title: id, artist: "A" });
const ids = (q: Queue) => q.entries.map((e) => e.track.id);
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]!; };

describe("Queue", () => {
  it("plays next ahead of add-to-queue, both before the context tail", () => {
    let q = Queue.from([tr("a"), tr("b"), tr("c")]);
    q = q.addToQueue([tr("x")]).addToQueue([tr("y")]).playNext([tr("n")]);
    expect(ids(q)).toEqual(["a", "n", "x", "y", "b", "c"]);
    expect(q.entries.slice(1, 4).every((e) => e.source === "manual")).toBe(true);
  });
  it("next/prev with and without wrap", () => {
    const q = Queue.from([tr("a"), tr("b")], 1);
    expect(q.next(false)).toBeNull();
    expect(q.next(true)!.current!.track.id).toBe("a");
    expect(Queue.from([tr("a")]).prev(false)).toBeNull();
  });
  it("removes upcoming entries but never the current one", () => {
    const q = Queue.from([tr("a"), tr("b"), tr("c")], 1);
    expect(ids(q.remove(q.entries[1]!.uid))).toEqual(["a", "b", "c"]);
    const r = q.remove(q.entries[0]!.uid);
    expect(ids(r)).toEqual(["b", "c"]);
    expect(r.current!.track.id).toBe("b");
  });
  it("moves only within upcoming", () => {
    const q = Queue.from([tr("a"), tr("b"), tr("c"), tr("d")]);
    expect(ids(q.move(q.entries[3]!.uid, 1))).toEqual(["a", "d", "b", "c"]);
    expect(ids(q.move(q.entries[0]!.uid, 3))).toEqual(["a", "b", "c", "d"]);
    expect(ids(q.move(q.entries[1]!.uid, 0))).toEqual(["a", "b", "c", "d"].filter(() => true)); // clamped to index+1
  });
  it("shuffle keeps current + manual block, and unshuffle restores order", () => {
    let q = Queue.from([tr("a"), tr("b"), tr("c"), tr("d"), tr("e")]).playNext([tr("m")]);
    q = q.shuffle(seq(0, 0, 0, 0));
    expect(q.current!.track.id).toBe("a");
    expect(q.entries[1]!.track.id).toBe("m");
    expect(q.isShuffled).toBe(true);
    expect(ids(q).slice(2).sort()).toEqual(["b", "c", "d", "e"]);
    expect(ids(q.unshuffle())).toEqual(["a", "m", "b", "c", "d", "e"]);
  });
  it("shuffle is a fixed sequence (not re-randomised per next)", () => {
    const q = Queue.from([tr("a"), tr("b"), tr("c"), tr("d")]).shuffle(seq(0.3, 0.7, 0.1));
    const order = ids(q);
    expect(ids(q.next(false)!)).toEqual(order);
  });
  it("lap reshuffle never repeats the just-played song first", () => {
    const q = Queue.from([tr("a"), tr("b")], 1);
    const lap = q.reshuffleForLap(seq(0.99, 0.99));
    expect(lap.current!.track.id).not.toBe("b");
  });
  it("appendAuto dedupes upcoming and bounds history", () => {
    let q = Queue.from([tr("a"), tr("b")]);
    q = q.appendAuto([tr("b"), tr("c"), tr("a")]);
    expect(ids(q)).toEqual(["a", "b", "c"]);
    let big = Queue.from(Array.from({ length: 10 }, (_, i) => tr(`t${i}`)), 9);
    big = big.appendAuto([tr("x"), tr("y")], 5);
    expect(big.length).toBeLessThanOrEqual(5 + 2);
    expect(big.current!.track.id).toBe("t9");
  });
  it("clearUpcoming keeps current", () => {
    const q = Queue.from([tr("a"), tr("b")]).clearUpcoming();
    expect(ids(q)).toEqual(["a"]);
  });
  it("snapshot round-trips", () => {
    const q = Queue.from([tr("a"), tr("b"), tr("c")], 1).shuffle(seq(0.5));
    const r = Queue.restore(q.snapshot());
    expect(ids(r)).toEqual(ids(q));
    expect(r.isShuffled).toBe(true);
  });
});
