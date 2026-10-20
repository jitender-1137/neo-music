import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DevToneProvider } from "@zuno/provider/dev";
import type { MusicProvider } from "@zuno/provider";
import { makeApp } from "./helpers";

/** Per-request music source (Settings → Music source → X-Music-Source header). */
describe("music sources", () => {
  let h: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => {
    h = await makeApp();
    // A second source whose search results are recognisable.
    const other: MusicProvider = Object.assign(Object.create(new DevToneProvider()), {
      source: "ytmusicapi",
      search: async (q: string) => ({ query: q, filter: "all", tracks: [{ id: "otherSource1", provider: "youtube", title: "From ytmusicapi", artist: "X" }], videos: [], albums: [], artists: [], playlists: [] }),
    });
    h.ctx.sources.ytmusicapi = other;
  });
  afterAll(async () => { await h.close(); });

  const search = (headers: Record<string, string> = {}, url = "/api/v1/search?q=tone") => h.app.inject({ url, headers });

  it("uses the default source without a header, and the chosen one with it", async () => {
    expect((await search()).json().tracks[0].title).not.toBe("From ytmusicapi");
    const r = await search({ "x-music-source": "ytmusicapi" });
    expect(r.json().tracks[0].title).toBe("From ytmusicapi");
    expect(r.headers.vary).toMatch(/X-Music-Source/);
  });

  it("server-rendered pages can pass ?src=; unknown or disabled sources fall back to the default", async () => {
    expect((await search({}, "/api/v1/search?q=tone&src=ytmusicapi")).json().tracks[0].title).toBe("From ytmusicapi");
    expect((await search({ "x-music-source": "bogus" })).json().tracks[0].title).not.toBe("From ytmusicapi");
    expect((await search({ "x-music-source": "official" })).json().tracks[0].title).not.toBe("From ytmusicapi"); // not enabled here
  });

  it("sources never share cached results", async () => {
    const a = (await search({ "x-music-source": "ytmusicapi" }, "/api/v1/search?q=shared")).json();
    const b = (await search({}, "/api/v1/search?q=shared")).json();
    expect(a.tracks[0].title).toBe("From ytmusicapi");
    expect(b.tracks[0]?.title).not.toBe("From ytmusicapi");
  });

  it("lists the enabled sources with what each can do", async () => {
    const r = (await h.app.inject({ url: "/api/v1/sources", headers: { "x-music-source": "ytmusicapi" } })).json();
    expect(r.default).toBe("youtubei");
    expect(r.current).toBe("ytmusicapi");
    expect(r.sources.find((s: { id: string }) => s.id === "youtubei")).toMatchObject({ playback: "stream", features: { backgroundPlayback: true } });
  });
});
