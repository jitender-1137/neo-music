import type {
  AlbumPage, ArtistPage, AudioQuality, BrowsePage, MusicSource, PlaylistPage, ProviderId, SearchFilter,
  SearchResults, Shelf, Track, TrackDetail, Lyrics,
} from "@zuno/core";

/** Where the API should read a track's bytes from. Never handed to the browser as-is. */
export type StreamSource =
  | {
      kind: "http";
      url: string;
      mimeType: string;
      contentLength: number;
      bitrate?: number;
      durationSec?: number;
      /** Headers the origin requires on every media request. */
      headers: Record<string, string>;
      /** Upstream URLs are signed and expire; re-resolve after this. */
      expiresAt: number;
      /** Max bytes per upstream range request the origin tolerates. */
      maxChunkBytes?: number;
    }
  | { kind: "buffer"; data: Uint8Array; mimeType: string; durationSec: number; expiresAt: number };

export interface StreamOptions {
  quality: AudioQuality;
  /** Ask for AAC/MP4 — Safari on iOS cannot reliably play Opus-in-WebM. */
  preferMp4: boolean;
}

export interface RadioResult {
  tracks: Track[];
  /** Opaque cursor to fetch more of the same radio. */
  continuation?: string;
  playlistId?: string;
}

/**
 * A music catalog. YouTube today; a licensed catalog can implement the same contract.
 * Every method throws `AppError` with a stable code on failure — never returns fake data.
 */
export interface MusicProvider {
  /** Catalogue namespace for stored data (likes, history…): "youtube" for every YouTube-backed source. */
  readonly id: ProviderId;
  /** Which library this is (cache keys and diagnostics). Absent for single-library providers. */
  readonly source?: MusicSource;
  readonly displayName: string;
  /** Shown in the UI so dev audio can't be mistaken for the real catalog. */
  readonly isDevelopmentOnly: boolean;

  getHome(opts?: { continuation?: string; params?: string }): Promise<BrowsePage>;
  getExplore(): Promise<BrowsePage>;
  getBrowse(browseId: string, params?: string): Promise<BrowsePage>;
  search(query: string, filter: SearchFilter, continuation?: string): Promise<SearchResults>;
  suggestions(query: string): Promise<{ queries: string[]; items: Shelf["items"] }>;
  getTrack(id: string): Promise<TrackDetail>;
  getAlbum(id: string): Promise<AlbumPage>;
  getArtist(id: string): Promise<ArtistPage>;
  getPlaylist(id: string, continuation?: string): Promise<PlaylistPage>;
  getRadio(seed: { trackId?: string; playlistId?: string; params?: string }, continuation?: string): Promise<RadioResult>;
  getRelated(trackId: string): Promise<Shelf[]>;
  getLyrics?(track: Track): Promise<Lyrics | null>;
  resolveStream(trackId: string, opts: StreamOptions): Promise<StreamSource>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}
