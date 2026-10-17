import { YouTubeMusicProvider } from "../src/youtube";
const p = new YouTubeMusicProvider({ location: "IN", language: "en" });
const log = (k: string, v: unknown) => console.log(k.padEnd(14), typeof v === "string" ? v : JSON.stringify(v).slice(0, 260));
const t = async (name: string, fn: () => Promise<unknown>) => {
  const s = Date.now();
  try { const r = await fn(); log(name, `${Date.now() - s}ms ` + JSON.stringify(r).slice(0, 300)); return r; }
  catch (e: any) { log(name, `FAIL ${e.message} ${e.cause_?.message ?? ""}`); }
};
const home: any = await t("home", async () => { const h = await p.getHome(); return { chips: h.chips.length, shelves: h.shelves.map((s) => `${s.title}(${s.layout}:${s.items.length})`), cont: !!h.continuation }; });
const h1 = await p.getHome();
await t("home+cont", async () => { const h = await p.getHome({ continuation: h1.continuation }); return h.shelves.map((s) => `${s.title}(${s.items.length})`); });
await t("home chip", async () => { const h = await p.getHome({ params: "Relax" }); return h.shelves.map((s) => `${s.title}(${s.items.length})`); });
await t("explore", async () => { const e = await p.getExplore(); return { chips: e.chips.map((c) => c.title), shelves: e.shelves.map((s) => `${s.title}(${s.layout}:${s.items.length})`) }; });
await t("moods", async () => { const e = await p.getBrowse("FEmusic_moods_and_genres"); return e.shelves.map((s) => `${s.title}(${s.layout}:${s.items.length})`); });
await t("mood cat", async () => { const e = await p.getBrowse("FEmusic_moods_and_genres_category", "ggMPOg1uX1JOQWZFeDByc2Jm"); return [e.title, e.shelves.map((s) => `${s.title}(${s.layout}:${s.items.length})`)]; });
await t("charts", async () => { const e = await p.getBrowse("FEmusic_charts"); return e.shelves.map((s) => `${s.title}(${s.layout}:${s.items.length})`); });
await t("new rel", async () => { const e = await p.getBrowse("FEmusic_new_releases"); return e.shelves.map((s) => `${s.title}(${s.layout}:${s.items.length})`); });
await t("search all", async () => { const r = await p.search("coldplay", "all"); return { top: r.top?.kind, t: r.tracks.length, v: r.videos.length, al: r.albums.length, ar: r.artists.length, pl: r.playlists.length, first: r.tracks[0] }; });
const ss: any = await t("search song", async () => { const r = await p.search("tum hi ho", "song"); return { n: r.tracks.length, cont: r.continuation, first: r.tracks[0] }; });
await t("search cont", async () => { const r = await p.search("tum hi ho", "song", ss.cont); return { n: r.tracks.length }; });
await t("suggest", () => p.suggestions("arij"));
await t("track", async () => { const d = await p.getTrack("fsiPzT50ZiM"); return { track: d.track, rel: d.related.map((s) => s.title) }; });
await t("album", async () => { const a = await p.getAlbum("MPREb_4pL8gzRtw1p"); return { album: a.album, n: a.tracks.length, dur: a.totalDurationSec, t0: a.tracks[0] }; });
await t("artist", async () => { const a = await p.getArtist("UCIwFjwMjI0y7PDBVEO9-bkQ"); return { artist: a.artist, top: a.topTracks.length, shelves: a.shelves.map((s) => `${s.title}(${s.items.length})`), radio: a.radioPlaylistId, shuf: a.shufflePlaylistId }; });
await t("playlist", async () => { const pl = await p.getPlaylist("RDCLAK5uy_kmPRjHDECIcuVwnKsx2Ng7fyNgFKWNJFs"); return { pl: pl.playlist, n: pl.tracks.length, cont: !!pl.continuation }; });
const rad: any = await t("radio", async () => { const r = await p.getRadio({ trackId: "fsiPzT50ZiM" }); return { n: r.tracks.length, cont: r.continuation, first: r.tracks[0]?.title, pid: r.playlistId }; });
await t("radio cont", async () => { const r = await p.getRadio({}, rad.cont); return { n: r.tracks.length, first: r.tracks[0]?.title }; });
await t("radio pl", async () => { const r = await p.getRadio({ playlistId: "RDCLAK5uy_kmPRjHDECIcuVwnKsx2Ng7fyNgFKWNJFs" }); return { n: r.tracks.length, first: r.tracks[0]?.title }; });
await t("lyrics", async () => { const d = await p.getTrack("fsiPzT50ZiM"); const l = await p.getLyrics(d.track); return { timing: l?.timing, src: l?.source, n: l?.lines.length, l: l?.lines.slice(3, 5) }; });
await t("stream mp4", async () => { const s: any = await p.resolveStream("fsiPzT50ZiM", { quality: "auto", preferMp4: true }); return { mime: s.mimeType, len: s.contentLength, br: s.bitrate, exp: new Date(s.expiresAt).toISOString() }; });
await t("stream high", async () => { const s: any = await p.resolveStream("fsiPzT50ZiM", { quality: "high", preferMp4: false }); return { mime: s.mimeType, len: s.contentLength, br: s.bitrate }; });
await t("stream cached", async () => { const s: any = await p.resolveStream("fsiPzT50ZiM", { quality: "auto", preferMp4: true }); return { mime: s.mimeType }; });
process.exit(0);
