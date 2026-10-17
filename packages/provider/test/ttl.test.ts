import { describe, expect, it, vi } from "vitest";
import { Mutex, SingleFlight, TtlCache } from "../src/ttlCache";

describe("TtlCache", () => {
  it("evicts least recently used beyond max", () => {
    const c = new TtlCache<number>(2, 1000);
    c.set("a", 1); c.set("b", 2); c.get("a"); c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
  });
  it("expires entries", () => {
    vi.useFakeTimers();
    const c = new TtlCache<number>(10, 100);
    c.set("a", 1);
    vi.advanceTimersByTime(101);
    expect(c.get("a")).toBeUndefined();
    vi.useRealTimers();
  });
});

describe("SingleFlight / Mutex", () => {
  it("shares one in-flight promise", async () => {
    const sf = new SingleFlight<number>();
    let calls = 0;
    const fn = () => new Promise<number>((r) => setTimeout(() => r(++calls), 5));
    const [a, b] = await Promise.all([sf.run("k", fn), sf.run("k", fn)]);
    expect(a).toBe(1); expect(b).toBe(1); expect(calls).toBe(1);
  });
  it("serialises and survives rejection", async () => {
    const m = new Mutex();
    const order: number[] = [];
    const p1 = m.run(async () => { await new Promise((r) => setTimeout(r, 10)); order.push(1); throw new Error("x"); });
    const p2 = m.run(async () => { order.push(2); return 2; });
    await expect(p1).rejects.toThrow("x");
    expect(await p2).toBe(2);
    expect(order).toEqual([1, 2]);
  });
});
