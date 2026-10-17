import { describe, expect, it } from "vitest";
import { dedupeItems, normPlaylistId, toAlbum, toArtist, toPlaylist, toTrack } from "../src/youtube/mappers";
import { pickFormat } from "../src/youtube/adapter";

const songRow = (over: Record<string, unknown> = {}) => ({
  type: "MusicResponsiveListItem",
  item_type: "song",
  id: "fsiPzT50ZiM",
  title: "Tum Hi Ho",
  duration: { text: "4:22", seconds: 262 },
  artists: [{ name: "Arijit Singh", channel_id: "UCDxKh1gFWeYsqePvgVzmPoQ" }],
  album: { id: "MPREb_E4GfUXfDfhy", name: "Aashiqui 2" },
  badges: [{ icon_type: "MUSIC_EXPLICIT_BADGE" }],
  thumbnail: { contents: [{ url: "https://lh3.googleusercontent.com/x=w60-h60-l90-rj", width: 60, height: 60 }, { url: "https://lh3.googleusercontent.com/x=w120-h120-l90-rj", width: 120, height: 120 }] },
  ...over,
});

describe("toTrack", () => {
  it("maps a song row", () => {
    const t = toTrack(songRow())!;
    expect(t).toMatchObject({ id: "fsiPzT50ZiM", title: "Tum Hi Ho", artist: "Arijit Singh", album: "Aashiqui 2", albumId: "MPREb_E4GfUXfDfhy", durationSec: 262, isExplicit: true });
    expect(t.artworkUrl).toContain("w544-h544");
  });
  it("prefers the endpoint video id over a browse id", () => {
    const t = toTrack(songRow({ id: "MPEDhVXAEHETMbI", endpoint: { payload: { videoId: "abcdefghijk" } } }))!;
    expect(t.id).toBe("abcdefghijk");
  });
  it("rejects non-video ids (podcast shows)", () => {
    expect(toTrack(songRow({ id: "MPSPPLEWioYp-UrM06nByWtul_zwmfeo-5QXM5" }))).toBeNull();
  });
  it("uses fallback artist when the row has none", () => {
    const t = toTrack(songRow({ artists: [] }), { artist: "Coldplay", artists: [{ id: "UC1", name: "Coldplay" }] })!;
    expect(t.artist).toBe("Coldplay");
  });
  it("falls back to ytimg artwork", () => {
    expect(toTrack(songRow({ thumbnail: undefined }))!.artworkUrl).toBe("https://i.ytimg.com/vi/fsiPzT50ZiM/hqdefault.jpg");
  });
});

describe("toAlbum / toPlaylist / toArtist", () => {
  it("parses album subtitle", () => {
    const a = toAlbum({ item_type: "album", id: "MPREb_1", title: "Revival", subtitle: "Single • Eminem • 2017" })!;
    expect(a).toMatchObject({ releaseType: "single", year: "2017", artist: "Eminem" });
  });
  it("strips VL from playlist ids", () => {
    expect(toPlaylist({ id: "VLPL123", title: "Mix", subtitle: "Playlist • Someone • 1M views" })).toMatchObject({ id: "PL123", owner: "Someone" });
    expect(normPlaylistId("RDCLAK5")).toBe("RDCLAK5");
  });
  it("normalises MPLA artist ids and rejects non-channels", () => {
    expect(toArtist({ id: "MPLAUC123", title: "X" })!.id).toBe("UC123");
    expect(toArtist({ id: "MPRE1", title: "X" })).toBeNull();
  });
});

describe("dedupeItems", () => {
  it("drops a video when the song exists, and exact duplicates", () => {
    const song = toTrack(songRow())!;
    const video = { ...song, id: "zzzzzzzzzzz", isVideo: true };
    const out = dedupeItems([
      { kind: "track", track: song },
      { kind: "track", track: video },
      { kind: "track", track: song },
    ]);
    expect(out).toHaveLength(1);
  });
});

describe("pickFormat", () => {
  const formats = [
    { itag: 140, mime_type: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 131000 },
    { itag: 139, mime_type: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 49000 },
    { itag: 251, mime_type: 'audio/webm; codecs="opus"', bitrate: 160000 },
    { itag: 250, mime_type: 'audio/webm; codecs="opus"', bitrate: 70000 },
  ];
  it("forces MP4 for iOS", () => expect(pickFormat(formats, { quality: "high", preferMp4: true }).itag).toBe(140));
  it("allows Opus at high", () => expect(pickFormat(formats, { quality: "high", preferMp4: false }).itag).toBe(251));
  it("targets bitrate for low", () => expect(pickFormat(formats, { quality: "low", preferMp4: false }).itag).toBe(139));
  it("normal picks ~128k AAC", () => expect(pickFormat(formats, { quality: "normal", preferMp4: false }).itag).toBe(140));
  it("Safari never gets HE-AAC (it reports ~2× duration), even at low quality", () => expect(pickFormat(formats, { quality: "low", preferMp4: true }).itag).toBe(140));
    it("handles empty", () => expect(pickFormat([], { quality: "auto", preferMp4: true })).toBeUndefined());
});
