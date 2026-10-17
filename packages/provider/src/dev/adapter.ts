/**
 * Development-only catalog: a handful of self-generated sine-tone "tracks".
 *
 * Exists so tests and offline development never depend on YouTube. It is labelled
 * development-only everywhere it surfaces and is never enabled unless MUSIC_PROVIDER=dev.
 */
import { AppError, ErrorCode, type AlbumPage, type ArtistPage, type BrowsePage, type PlaylistPage, type SearchFilter, type SearchResults, type Shelf, type Track, type TrackDetail, type Lyrics, normalizeKey } from "@zuno/core";
import type { MusicProvider, RadioResult, StreamOptions, StreamSource } from "../types";
import { makeToneWav } from "./tone";

const ARTISTS = [
  { id: "dev-artist-1", provider: "dev" as const, name: "Test Tone Ensemble" },
  { id: "dev-artist-2", provider: "dev" as const, name: "The Sine Waves" },
];
const NOTES = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25];
const NAMES = ["C4 Morning", "D4 Drive", "E4 Echo", "F4 Field", "G4 Glow", "A4 Air", "B4 Blue", "C5 Climb"];

export const DEV_TRACKS: Track[] = NAMES.map((title, i) => ({
  id: `dev-${String(i + 1).padStart(2, "0")}`,
  provider: "dev",
  title,
  artist: ARTISTS[i % 2]!.name,
  artists: [{ id: ARTISTS[i % 2]!.id, name: ARTISTS[i % 2]!.name }],
  album: i < 4 ? "Tones Vol. 1" : "Tones Vol. 2",
  albumId: i < 4 ? "dev-album-1" : "dev-album-2",
  durationSec: 20 + i * 2,
}));

const albumOf = (id: string) => {
  const tracks = DEV_TRACKS.filter((t) => t.albumId === id);
  if (!tracks.length) throw new AppError(ErrorCode.NotFound, "Album not found", 404);
  const a = ARTISTS[id === "dev-album-1" ? 0 : 1]!;
  return { album: { id, provider: "dev" as const, title: tracks[0]!.album!, artist: tracks[0]!.artist, artists: [{ id: a.id, name: a.name }], year: "2026", releaseType: "album" as const }, tracks };
};

export class DevToneProvider implements MusicProvider {
  readonly id = "dev" as const;
  readonly displayName = "Development tones";
  readonly isDevelopmentOnly = true;

  private shelf(id: string, title: string, tracks: Track[]): Shelf {
    return { id, title, layout: "list", items: tracks.map((track) => ({ kind: "track", track })) };
  }

  async getHome(): Promise<BrowsePage> {
    const a1 = albumOf("dev-album-1").album, a2 = albumOf("dev-album-2").album;
    return {
      title: "Home",
      chips: [],
      shelves: [
        this.shelf("quick", "Quick picks (development tones)", DEV_TRACKS),
        { id: "albums", title: "Albums", layout: "carousel", items: [a1, a2].map((album) => ({ kind: "album", album })) },
        { id: "artists", title: "Artists", layout: "carousel", items: ARTISTS.map((artist) => ({ kind: "artist", artist })) },
      ],
    };
  }
  async getExplore(): Promise<BrowsePage> { return { ...(await this.getHome()), title: "Explore" }; }
  async getBrowse(): Promise<BrowsePage> { return this.getHome(); }

  async search(query: string, filter: SearchFilter): Promise<SearchResults> {
    const q = normalizeKey(query);
    const tracks = DEV_TRACKS.filter((t) => normalizeKey(`${t.title}${t.artist}${t.album}`).includes(q));
    const artists = ARTISTS.filter((a) => normalizeKey(a.name).includes(q));
    const albums = ["dev-album-1", "dev-album-2"].map((id) => albumOf(id).album).filter((a) => normalizeKey(`${a.title}${a.artist}`).includes(q));
    return {
      query, filter,
      tracks: filter === "all" || filter === "song" ? tracks : [],
      videos: [],
      albums: filter === "all" || filter === "album" ? albums : [],
      artists: filter === "all" || filter === "artist" ? artists : [],
      playlists: [],
    };
  }
  async suggestions(query: string) {
    const q = normalizeKey(query);
    return { queries: DEV_TRACKS.map((t) => t.title).filter((t) => normalizeKey(t).startsWith(q)).slice(0, 5), items: [] };
  }
  private find(id: string): Track {
    const t = DEV_TRACKS.find((x) => x.id === id);
    if (!t) throw new AppError(ErrorCode.NotFound, "Track not found", 404);
    return t;
  }
  async getTrack(id: string): Promise<TrackDetail> {
    return { track: this.find(id), related: [this.shelf("rel", "More tones", DEV_TRACKS.filter((t) => t.id !== id))] };
  }
  async getAlbum(id: string): Promise<AlbumPage> {
    const { album, tracks } = albumOf(id);
    return { album, tracks, totalDurationSec: tracks.reduce((s, t) => s + (t.durationSec ?? 0), 0), otherVersions: [] };
  }
  async getArtist(id: string): Promise<ArtistPage> {
    const artist = ARTISTS.find((a) => a.id === id);
    if (!artist) throw new AppError(ErrorCode.NotFound, "Artist not found", 404);
    const tracks = DEV_TRACKS.filter((t) => t.artists?.[0]?.id === id);
    return { artist, topTracks: tracks, shelves: [] };
  }
  async getPlaylist(id: string): Promise<PlaylistPage> {
    if (id !== "dev-playlist-all") throw new AppError(ErrorCode.NotFound, "Playlist not found", 404);
    return { playlist: { id, provider: "dev", title: "All tones", owner: "Neo Music dev" }, tracks: DEV_TRACKS };
  }
  async getRadio(seed: { trackId?: string }): Promise<RadioResult> {
    const start = Math.max(0, DEV_TRACKS.findIndex((t) => t.id === seed.trackId));
    return { tracks: [...DEV_TRACKS.slice(start), ...DEV_TRACKS.slice(0, start)] };
  }
  async getRelated(id: string): Promise<Shelf[]> { return (await this.getTrack(id)).related; }
  async getLyrics(track: Track): Promise<Lyrics | null> {
    const lines = Array.from({ length: Math.floor((track.durationSec ?? 20) / 4) }, (_, i) => ({ text: `${track.title} — line ${i + 1}`, startMs: i * 4000, endMs: (i + 1) * 4000 }));
    return { lines, timing: "synced", source: "Development tones" };
  }
  async resolveStream(trackId: string, _opts: StreamOptions): Promise<StreamSource> {
    const t = this.find(trackId);
    const i = DEV_TRACKS.indexOf(t);
    return { kind: "buffer", data: makeToneWav(NOTES[i]!, t.durationSec!), mimeType: "audio/wav", durationSec: t.durationSec!, expiresAt: Date.now() + 3600_000 };
  }
  async health() { return { ok: true }; }
}
