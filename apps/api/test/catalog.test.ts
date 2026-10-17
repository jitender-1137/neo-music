import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, client } from "./helpers";

let h: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => { h = await makeApp(); });
afterAll(async () => { await h.close(); });

describe("health", () => {
  it("liveness and readiness", async () => {
    expect((await h.app.inject({ url: "/healthz" })).json()).toEqual({ ok: true });
    const ready = (await h.app.inject({ url: "/readyz" })).json();
    expect(ready).toMatchObject({ ok: true, checks: { database: true, redis: true }, database: process.env.TEST_DB_DRIVER === "memory" ? "memory" : "postgres", provider: { id: "dev", developmentOnly: true } });
  });
});

describe("catalog", () => {
  const c = () => client(h.app);
  it("home / search / album / artist / track", async () => {
    const home = (await c().get("/api/v1/home")).json();
    expect(home.shelves[0].items.length).toBeGreaterThan(0);
    const s = (await c().get("/api/v1/search?q=echo")).json();
    expect(s.tracks[0].title).toBe("E4 Echo");
    expect((await c().get("/api/v1/albums/dev-album-1")).json().tracks).toHaveLength(4);
    expect((await c().get("/api/v1/artists/dev-artist-1")).json().topTracks.length).toBeGreaterThan(0);
    expect((await c().get("/api/v1/tracks/dev-01")).json().track.id).toBe("dev-01");
  });
  it("404 with a stable error shape", async () => {
    const r = await c().get("/api/v1/albums/nope");
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: { code: "not_found" } });
  });
  it("rejects invalid ids and queries", async () => {
    expect((await c().get("/api/v1/albums/%3Cx%3E")).statusCode).toBe(400);
    expect((await c().get("/api/v1/search?q=")).statusCode).toBe(400);
  });
  it("lyrics", async () => {
    const r = (await c().get("/api/v1/tracks/dev-01/lyrics")).json();
    expect(r.lyrics.timing).toBe("synced");
  });
});

describe("playback + stream proxy", () => {
  it("issues a signed stream URL and serves byte ranges", async () => {
    const c = client(h.app);
    const s = (await c.post("/api/v1/playback/sessions", { trackId: "dev-01" })).json();
    expect(s.streamUrl).toMatch(/^\/api\/v1\/stream\/dev-01\?/);
    expect(s.mimeType).toBe("audio/wav");
    const full = await c.get(s.streamUrl);
    expect(full.statusCode).toBe(200);
    expect(Number(full.headers["content-length"])).toBe(s.contentLength);
    const part = await c.get(s.streamUrl, { range: "bytes=0-1" });
    expect(part.headers.etag).toMatch(/^"dev-01-[a-z]+-[am]-\d+"$/); // stable validator
    expect((await c.get(s.streamUrl, { range: "bytes=2-3" })).headers.etag).toBe(part.headers.etag);
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-range"]).toBe(`bytes 0-1/${s.contentLength}`);
    expect(part.rawPayload.toString("latin1")).toBe("RI");
    const tail = await c.get(s.streamUrl, { range: "bytes=-10" });
    expect(tail.rawPayload.length).toBe(10);
    expect((await c.get(s.streamUrl, { range: `bytes=${s.contentLength}-` })).statusCode).toBe(416);
  });
  it("refuses forged or expired signatures", async () => {
    const c = client(h.app);
    const s = (await c.post("/api/v1/playback/sessions", { trackId: "dev-01" })).json();
    expect((await c.get(s.streamUrl.replace(/sig=[^&]+/, "sig=forged"))).statusCode).toBe(403);
    expect((await c.get(s.streamUrl.replace("dev-01", "dev-02"))).statusCode).toBe(403);
    expect((await c.get(s.streamUrl.replace(/exp=\d+/, "exp=1"))).statusCode).toBe(403);
  });
  it("accepts a device playback token instead of a per-URL signature", async () => {
    const c = client(h.app);
    const { token } = (await c.post("/api/v1/playback/token")).json();
    const ok = await c.get(`/api/v1/stream/dev-02?q=auto&f=mp4&t=${encodeURIComponent(token)}`, { range: "bytes=0-3" });
    expect(ok.statusCode).toBe(206);
    expect((await c.get(`/api/v1/stream/dev-02?q=auto&f=mp4&t=${encodeURIComponent(token)}x`)).statusCode).toBe(403);
    expect((await c.get(`/api/v1/stream/dev-02?q=auto&f=mp4&t=a.1.b`)).statusCode).toBe(403);
  });
  it("blocks cross-site state changes (CSRF)", async () => {
    const r = await h.app.inject({ method: "POST", url: "/api/v1/playback/sessions", payload: { trackId: "dev-01" }, headers: { origin: "https://evil.example" } });
    expect(r.statusCode).toBe(403);
    const none = await h.app.inject({ method: "POST", url: "/api/v1/playback/sessions", payload: { trackId: "dev-01" } });
    expect(none.statusCode).toBe(403);
  });
});
