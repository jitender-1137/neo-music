import { describe, expect, it } from "vitest";
import { parseRange } from "../src/lib/range";
import { signStream, verifyStream } from "../src/lib/streamSign";
import { Semaphore } from "../src/lib/semaphore";

describe("parseRange", () => {
  it("handles standard forms", () => {
    expect(parseRange("bytes=0-1", 100)).toEqual({ start: 0, end: 1 });
    expect(parseRange("bytes=10-", 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=0-999", 100)).toEqual({ start: 0, end: 99 });
  });
  it("rejects bad ranges", () => {
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=5-1", 100)).toBe("unsatisfiable");
    expect(parseRange("items=0-1", 100)).toBeNull();
    expect(parseRange(undefined, 100)).toBeNull();
  });
});

describe("stream signing", () => {
  const c = { trackId: "x", quality: "auto" as const, mp4: true, exp: Math.floor(Date.now() / 1000) + 60 };
  it("verifies its own signature only", () => {
    const sig = signStream("s".repeat(32), c);
    expect(verifyStream("s".repeat(32), c, sig)).toBe(true);
    expect(verifyStream("t".repeat(32), c, sig)).toBe(false);
    expect(verifyStream("s".repeat(32), { ...c, mp4: false }, sig)).toBe(false);
    expect(verifyStream("s".repeat(32), { ...c, exp: 1 }, signStream("s".repeat(32), { ...c, exp: 1 }))).toBe(false);
  });
});

describe("Semaphore", () => {
  it("bounds concurrency and releases once", () => {
    const s = new Semaphore(1);
    const r = s.tryAcquire()!;
    expect(s.tryAcquire()).toBeNull();
    r(); r();
    expect(s.inUse).toBe(0);
  });
});

describe("originMatcher (WEB_ORIGINS)", () => {
  it("accepts exact origins and subdomain wildcards, nothing else", async () => {
    const { originMatcher } = await import("../src/lib/origins");
    const ok = originMatcher(["http://localhost:3000", "https://*.trycloudflare.com"]);
    expect(ok("http://localhost:3000")).toBe(true);
    expect(ok("https://naples-reid-cage-helmet.trycloudflare.com")).toBe(true);
    expect(ok("https://a.b.trycloudflare.com")).toBe(true);
    for (const bad of [undefined, "", "http://localhost:3001", "https://trycloudflare.com", "http://x.trycloudflare.com",
      "https://x.trycloudflare.com.evil.com", "https://eviltrycloudflare.com", "https://x.trycloudflare.com:8443", "https://x.trycloudflare.com/path", "null"]) {
      expect(ok(bad), String(bad)).toBe(false);
    }
  });
});
