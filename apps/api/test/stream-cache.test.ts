import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { client, makeApp } from "./helpers";

describe("stream resolution cache (Redis)", () => {
  let t: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { t = await makeApp(); });
  afterAll(async () => { await t.close(); });

  it("resolves a song once; repeat plays (even after an API restart) come from Redis", async () => {
    const resolve = vi.fn(async () => ({
      kind: "http" as const, url: "https://example.invalid/audio", mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      contentLength: 1000, headers: {}, durationSec: 200, expiresAt: Date.now() + 6 * 3600_000,
    }));
    t.ctx.provider.resolveStream = resolve;
    const c = client(t.app);
    const a = await c.post("/api/v1/playback/sessions", { trackId: "dev-02", quality: "normal", preferMp4: true });
    expect(a.statusCode).toBe(200);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(await t.ctx.redis!.get("stream:v2:dev-02:normal:mp4")).toContain("example.invalid");
    const b = await c.post("/api/v1/playback/sessions", { trackId: "dev-02", quality: "normal", preferMp4: true });
    expect(b.statusCode).toBe(200);
    expect(resolve).toHaveBeenCalledTimes(1); // second play: no new lookup
    const ttl = await t.ctx.redis!.ttl("stream:v2:dev-02:normal:mp4");
    expect(ttl).toBeGreaterThan(3600); // expires a few minutes before the upstream URL
  });
});
