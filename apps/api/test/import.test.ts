import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeApp, client } from "./helpers";
import { artistSimilarity, confidenceFor, normalizeTitle, scoreCandidate, searchTitle, titleSimilarity } from "../src/lib/matcher";
import { parseImportLink } from "../src/lib/importers/links";

describe("matcher", () => {
  const tr = (title: string, artist: string, durationSec?: number, extra = {}) => ({ id: "x", provider: "youtube" as const, title, artist, durationSec, ...extra });
  it("normalises noise but keeps meaning", () => {
    expect(normalizeTitle("Hey Jude (Remastered 2015)")).toBe("hey jude");
    expect(normalizeTitle("Blinding Lights - 2020 Remaster")).toBe("blinding lights");
    expect(normalizeTitle("Señorita (feat. Camila Cabello)")).toBe("senorita");
    expect(normalizeTitle("Stay (Live)")).toContain("live");
  });
  it("scores the right recording above versions", () => {
    const item = { title: "Hey Jude - Remastered 2015", artist: "The Beatles", durationSec: 429 };
    const good = scoreCandidate(item, tr("Hey Jude", "The Beatles", 431));
    const live = scoreCandidate(item, tr("Hey Jude (Live)", "The Beatles", 470));
    const cover = scoreCandidate(item, tr("Hey Jude (Karaoke Version)", "Sing King", 429));
    expect(confidenceFor(good)).toBe("high");
    expect(good).toBeGreaterThan(live);
    expect(good).toBeGreaterThan(cover);
  });
  it("cleans the search query but keeps case", () => {
    expect(searchTitle("D4 Drive (Remastered 2015)")).toBe("D4 Drive");
    expect(searchTitle("Bad Habits - Radio Edit")).toBe("Bad Habits");
  });
  it("handles multiple and featured artists", () => {
    expect(artistSimilarity("Calvin Harris, Dua Lipa", tr("One Kiss", "Calvin Harris & Dua Lipa"))).toBe(1);
    expect(titleSimilarity("One Kiss (with Dua Lipa)", "One Kiss")).toBe(1);
  });
});

describe("link parsing", () => {
  it("recognises supported services", () => {
    expect(parseImportLink("https://music.youtube.com/playlist?list=PLabcdefghij")).toMatchObject({ platform: "youtube", kind: "playlist", id: "PLabcdefghij" });
    expect(parseImportLink("https://music.youtube.com/browse/MPREb_4pL8gzRtw1p")).toMatchObject({ platform: "youtube", kind: "album" });
    expect(parseImportLink("https://youtu.be/fsiPzT50ZiM")).toMatchObject({ kind: "track", id: "fsiPzT50ZiM" });
    expect(parseImportLink("https://www.deezer.com/en/playlist/908622995")).toMatchObject({ platform: "deezer", kind: "playlist", id: "908622995" });
    expect(parseImportLink("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc")).toMatchObject({ platform: "spotify", id: "37i9dQZF1DXcBWIGoYBM5M" });
    expect(parseImportLink("spotify:album:4aawyAB9vmqN3uQ7FjRGTy")).toMatchObject({ platform: "spotify", kind: "album" });
    expect(parseImportLink("https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb")).toMatchObject({ platform: "apple_music" });
    expect(parseImportLink("https://deezer.page.link/abc")).toMatchObject({ platform: "short" });
    expect(parseImportLink("https://evil.example/playlist/1")).toBeNull();
    expect(parseImportLink("not a url at all")).toBeNull();
  });
});

describe("import routes (dev catalog)", () => {
  let h: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { h = await makeApp(); });
  afterAll(async () => { await h.close(); });

  it("matches songs described by another service", async () => {
    const c = client(h.app);
    const r = await c.post("/api/v1/import/match", { items: [
      { title: "E4 Echo", artist: "Test Tone Ensemble", durationSec: 24 },
      { title: "Totally Unknown Song", artist: "Nobody" },
      { title: "anything", artist: "", catalogId: "dev-02" },
    ] });
    expect(r.statusCode).toBe(200);
    const [a, b, d] = r.json().results;
    expect(a.track.id).toBe("dev-03");
    expect(["high", "medium"]).toContain(a.confidence);
    expect(b.confidence).toBe("none");
    expect(d).toMatchObject({ confidence: "exact", track: { id: "dev-02" } });
  });

  it("rejects oversize batches and bad links", async () => {
    const c = client(h.app);
    const many = Array.from({ length: 26 }, (_, i) => ({ title: `t${i}`, artist: "a" }));
    expect((await c.post("/api/v1/import/match", { items: many })).statusCode).toBe(400);
    expect((await c.post("/api/v1/import/link", { url: "https://evil.example/x" })).statusCode).toBe(400);
    const sp = await c.post("/api/v1/import/link", { url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M" });
    expect(sp.statusCode).toBe(422); // no Spotify keys configured → clear guidance
    expect(sp.json().error.message).toMatch(/Exportify/);
  });

  it("imports a Deezer playlist through the public API (mocked)", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (u: string | URL | Request) => {
      const url = String(u);
      if (url.startsWith("https://api.deezer.com/playlist/123")) {
        return new Response(JSON.stringify({ title: "Road trip", tracks: { data: [{ title: "Hey Jude (Remastered 2015)", duration: 429, artist: { name: "The Beatles" }, album: { title: "1" } }] } }), { status: 200 });
      }
      return realFetch(u as never);
    }) as typeof fetch;
    try {
      const r = await client(h.app).post("/api/v1/import/link", { url: "https://www.deezer.com/en/playlist/123" });
      expect(r.json()).toMatchObject({ name: "Road trip", source: "deezer", items: [{ title: "Hey Jude (Remastered 2015)", artist: "The Beatles", durationSec: 429 }] });
    } finally { globalThis.fetch = realFetch; }
  });

  it("imports a (dev) catalog playlist link with ids", async () => {
    const r = await client(h.app).post("/api/v1/import/link", { url: "https://music.youtube.com/playlist?list=dev-playlist-all" });
    expect(r.statusCode).toBe(200);
    expect(r.json().items[0].catalogId).toBe("dev-01");
  });
});
