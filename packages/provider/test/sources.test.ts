import { describe, expect, it, vi } from "vitest";
import { AppError } from "@zuno/core";
import { YouTubeOfficialProvider, decodeEntities, isoSeconds } from "../src/official";
import { YtMusicApiProvider } from "../src/ytmusicapi";
import type { MusicProvider } from "../src/types";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("official (YouTube Data API v3)", () => {
  const video = (id: string, title: string, channel = "Arijit Singh - Topic", dur = "PT4M22S") => ({
    id, snippet: { title, channelId: "UCabc", channelTitle: channel, thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } } },
    contentDetails: { duration: dur }, statistics: { viewCount: "1234567" },
  });

  it("parses durations and HTML entities", () => {
    expect(isoSeconds("PT4M22S")).toBe(262);
    expect(isoSeconds("PT1H2M3S")).toBe(3723);
    expect(isoSeconds("P0D")).toBeUndefined();
    expect(decodeEntities("Rock &amp; Roll &#39;n&#39; &quot;Blues&quot;")).toBe(`Rock & Roll 'n' "Blues"`);
  });

  it("search: one search call, then details for durations; music category; Topic channels become artists", async () => {
    const calls: URL[] = [];
    const f = vi.fn(async (u: string | URL | Request) => {
      const url = new URL(String(u)); calls.push(url);
      if (url.pathname.endsWith("/search")) return json({ items: [{ id: { kind: "youtube#video", videoId: "aaaaaaaaaaa" }, snippet: { title: "Tum Hi Ho", channelId: "UCabc", channelTitle: "x" } }], nextPageToken: "NEXT" });
      return json({ items: [video("aaaaaaaaaaa", "Tum Hi Ho")] });
    });
    const p = new YouTubeOfficialProvider({ apiKey: "k".repeat(30), region: "IN", fetch: f as never });
    const r = await p.search("tum hi ho", "all");
    expect(calls.map((c) => c.pathname.split("/").pop())).toEqual(["search", "videos"]);
    expect(calls[0]!.searchParams.get("videoCategoryId")).toBe("10");
    expect(calls[0]!.searchParams.get("regionCode")).toBe("IN");
    expect(r.top).toMatchObject({ kind: "track" });
    expect(r.tracks[0]).toMatchObject({ id: "aaaaaaaaaaa", provider: "youtube", title: "Tum Hi Ho", artist: "Arijit Singh", durationSec: 262 });
    expect(r.tracks[0]!.isVideo).toBeUndefined(); // a Topic (audio) upload
    expect(r.continuation).toBe("NEXT");
  });

  it("albums and moods are reported as unsupported, not faked", async () => {
    const p = new YouTubeOfficialProvider({ apiKey: "k".repeat(30), fetch: vi.fn() as never });
    await expect(p.getAlbum()).rejects.toMatchObject({ code: "not_supported" });
    await expect(p.getBrowse()).rejects.toMatchObject({ code: "not_supported" });
    expect((await p.search("x", "album")).albums).toEqual([]);
    await expect(p.resolveStream()).rejects.toMatchObject({ code: "not_supported" });
  });

  it("quota exhaustion and bad keys become clear errors; the key never appears in them", async () => {
    const key = "SECRET-KEY-1234567890abcdef";
    const quota = new YouTubeOfficialProvider({ apiKey: key, fetch: vi.fn(async () => json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403)) as never });
    const err = await quota.search("x", "song").catch((e: AppError) => e);
    expect(err).toMatchObject({ code: "rate_limited", status: 429 });
    expect(String((err as Error).message)).not.toContain(key);
    const bad = new YouTubeOfficialProvider({ apiKey: key, fetch: vi.fn(async () => json({ error: { message: "API key not valid. Please pass a valid API key.", errors: [{ reason: "badRequest" }] } }, 400)) as never });
    await expect(bad.search("x", "song")).rejects.toMatchObject({ code: "provider_unavailable", message: expect.stringContaining("YOUTUBE_API_KEY") });
  });

  it("radio: seed first, then more from the same channel (labelled honestly elsewhere as 'More from')", async () => {
    const f = vi.fn(async (u: string | URL | Request) => {
      const url = new URL(String(u));
      if (url.pathname.endsWith("/playlistItems")) return json({ items: [{ contentDetails: { videoId: "bbbbbbbbbbb" } }, { contentDetails: { videoId: "aaaaaaaaaaa" } }], nextPageToken: "P2" });
      const ids = url.searchParams.get("id")!.split(",");
      return json({ items: ids.map((id) => video(id, `Song ${id[0]}`)) });
    });
    const p = new YouTubeOfficialProvider({ apiKey: "k".repeat(30), fetch: f as never });
    const r = await p.getRadio({ trackId: "aaaaaaaaaaa" });
    expect(r.tracks.map((t) => t.id)).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
    expect(r.continuation).toBe("P2");
  });
});

describe("ytmusicapi (helper service)", () => {
  const streams = { resolveStream: vi.fn(async () => ({ kind: "buffer" as const, data: new Uint8Array(1), mimeType: "audio/mp4", durationSec: 1, expiresAt: 0 })) } as unknown as MusicProvider;
  const at = (handler: (url: URL) => Response) => {
    const real = globalThis.fetch;
    globalThis.fetch = vi.fn(async (u: string | URL | Request) => handler(new URL(String(u)))) as never;
    return () => { globalThis.fetch = real; };
  };

  it("passes validated results through and streams via the youtubei.js provider", async () => {
    const restore = at((url) => url.pathname === "/search"
      ? json({ query: "q", filter: "all", tracks: [{ id: "aaaaaaaaaaa", provider: "youtube", title: "T", artist: "A" }], videos: [], albums: [], artists: [], playlists: [] })
      : json({}, 404));
    try {
      const p = new YtMusicApiProvider({ baseUrl: "http://helper", streams });
      expect((await p.search("q", "all")).tracks[0]!.title).toBe("T");
      await p.resolveStream("aaaaaaaaaaa", { quality: "auto", preferMp4: true });
      expect(streams.resolveStream).toHaveBeenCalledWith("aaaaaaaaaaa", { quality: "auto", preferMp4: true });
      expect(p.source).toBe("ytmusicapi");
    } finally { restore(); }
  });

  it("maps helper errors and malformed replies to clear errors (never fake data)", async () => {
    let restore = at(() => json({ error: { code: "not_found" } }, 404));
    try { await expect(new YtMusicApiProvider({ baseUrl: "http://helper", streams }).getAlbum("MPREb_x")).rejects.toMatchObject({ code: "not_found", status: 404 }); } finally { restore(); }
    restore = at(() => json({ tracks: "not-a-list" }));
    try { await expect(new YtMusicApiProvider({ baseUrl: "http://helper", streams }).getRadio({ trackId: "aaaaaaaaaaa" })).rejects.toMatchObject({ code: "provider_unavailable" }); } finally { restore(); }
    restore = at(() => { throw new TypeError("fetch failed"); });
    try { await expect(new YtMusicApiProvider({ baseUrl: "http://helper", streams }).getHome()).rejects.toMatchObject({ code: "provider_unavailable", status: 503 }); } finally { restore(); }
  });
});
