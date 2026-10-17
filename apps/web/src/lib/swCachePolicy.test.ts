import { describe, expect, it } from "vitest";
// The exact file the service worker loads with importScripts (it registers itself on the global).
// @ts-expect-error plain JS without types
const mod = (await import("../../public/sw-cache-policy.js")) as { default?: unknown };
const { selectEvictions, budgetFor } = ((mod.default as object | undefined) ?? (globalThis as unknown as { NeoCachePolicy: object }).NeoCachePolicy) as {
  selectEvictions: (e: object[], now: number, budget: number) => string[];
  budgetFor: (quota: number, cap: number, fraction?: number) => number;
};
const MB = 1048576;
const e = (url: string, size: number, lastAccess: number, extra: object = {}) => ({ url, size, lastAccess, expires: 10_000, ...extra });

describe("service worker cache policy", () => {
  it("evicts expired, failed, incomplete and unauthorized entries first", () => {
    const out = selectEvictions([
      e("a", 1, 1), e("old", 1, 2, { expires: 5 }), e("bad", 1, 3, { status: "failed" }),
      e("half", 1, 4, { status: "incomplete" }), e("noauth", 1, 5, { status: "unauthorized" }),
    ], 100, 100 * MB);
    expect(out).toEqual(["old", "bad", "half", "noauth"]);
  });
  it("then least-recently-used until under budget", () => {
    const out = selectEvictions([e("new", 4 * MB, 300), e("oldest", 4 * MB, 100), e("mid", 4 * MB, 200)], 0, 6 * MB);
    expect(out).toEqual(["oldest", "mid"]);
  });
  it("never evicts current / next / pinned entries for space", () => {
    const out = selectEvictions([e("cur", 5 * MB, 1, { current: true }), e("nxt", 5 * MB, 2, { next: true }), e("pin", 5 * MB, 3, { pinned: true }), e("x", 5 * MB, 4)], 0, 1 * MB);
    expect(out).toEqual(["x"]);
  });
  it("budget = min(15% of quota, cap); unknown quota → cap", () => {
    expect(budgetFor(1000 * MB, 250 * MB)).toBe(150 * MB);
    expect(budgetFor(10_000 * MB, 250 * MB)).toBe(250 * MB);
    expect(budgetFor(NaN, 250 * MB)).toBe(250 * MB);
  });
  it("keeps separate keys for separate URLs (no cross-entry eviction)", () => {
    const out = selectEvictions([e("/api/v1/albums/1", 1, 1), e("/api/v1/albums/1?x=2", 1, 2)], 0, 10 * MB);
    expect(out).toEqual([]);
  });
});
