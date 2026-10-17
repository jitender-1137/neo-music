import { describe, expect, it } from "vitest";
import pino from "pino";
import { JsonCache } from "../src/lib/cache";

/** Without Redis (single-container mode) the cache keeps entries in process memory. */
describe("JsonCache without Redis", () => {
  const log = pino({ level: "silent" });

  it("serves repeat lookups from memory instead of calling the loader again", async () => {
    const cache = new JsonCache(null, log);
    let calls = 0;
    const load = async () => { calls++; return { n: calls }; };
    expect(await cache.get("a", { ttlSec: 60 }, load)).toEqual({ n: 1 });
    expect(await cache.get("a", { ttlSec: 60 }, load)).toEqual({ n: 1 });
    expect(calls).toBe(1);
    await cache.del("a");
    expect(await cache.get("a", { ttlSec: 60 }, load)).toEqual({ n: 2 });
  });

  it("expires entries after their lifetime", async () => {
    const cache = new JsonCache(null, log);
    let calls = 0;
    await cache.get("b", { ttlSec: 0.001 }, async () => ++calls);
    await new Promise((r) => setTimeout(r, 1100)); // write rounds the lifetime up to ≥ 1 s
    await cache.get("b", { ttlSec: 0.001 }, async () => ++calls);
    expect(calls).toBe(2);
  });

  it("stays bounded: the least recently used entries are dropped first", async () => {
    const cache = new JsonCache(null, log);
    for (let i = 0; i < 2005; i++) await cache.get(`k${i}`, { ttlSec: 60 }, async () => i);
    let reloaded = false;
    await cache.get("k0", { ttlSec: 60 }, async () => { reloaded = true; return 0; });
    expect(reloaded).toBe(true); // k0 was evicted
    let kept = true;
    await cache.get("k2004", { ttlSec: 60 }, async () => { kept = false; return 0; });
    expect(kept).toBe(true);
  });
});
