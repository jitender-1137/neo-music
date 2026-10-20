/**
 * ytmusicapi source: catalogue from the Python ytmusicapi library, through the helper service in
 * services/ytmusicapi (it already answers in Neo Music's models; this side validates them).
 * ytmusicapi has no audio, so streams come from the youtubei.js provider passed in as `streams`.
 * Pagination: ytmusicapi returns whole lists (no continuation tokens), so pages end at its limits.
 */
import { z } from "zod";
import {
  AlbumPage, AppError, ArtistPage, BrowsePage, ErrorCode, Lyrics, PlaylistPage, SearchResults, Shelf, ShelfItem, Track,
  type SearchFilter, type TrackDetail,
} from "@zuno/core";
import type { MusicProvider, RadioResult, StreamOptions, StreamSource } from "../types";

export interface YtMusicApiOptions {
  /** e.g. http://127.0.0.1:4200 */
  baseUrl: string;
  /** Provider that plays the audio (youtubei.js). */
  streams: MusicProvider;
  timeoutMs?: number;
  logger?: { warn: (o: object, m?: string) => void };
}

const TrackDetailWire = z.object({ track: Track, related: z.array(Shelf).default([]), description: z.string().optional() });
const RadioWire = z.object({ tracks: z.array(Track), playlistId: z.string().optional() });
const SuggestWire = z.object({ queries: z.array(z.string()), items: z.array(ShelfItem).default([]) });

export class YtMusicApiProvider implements MusicProvider {
  readonly id = "youtube" as const;
  readonly source = "ytmusicapi" as const;
  readonly displayName = "YouTube Music (ytmusicapi)";
  readonly isDevelopmentOnly = false;

  constructor(private readonly opts: YtMusicApiOptions) {}

  private async call<T>(path: string, params: Record<string, string | undefined>, schema: z.ZodType<T>): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
    let res: Response;
    try {
      res = await fetch(`${this.opts.baseUrl}${path}?${qs}`, { signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000) });
    } catch (err) {
      this.opts.logger?.warn({ path, err: (err as Error).message }, "ytmusicapi helper unreachable");
      throw new AppError(ErrorCode.ProviderUnavailable, "The ytmusicapi service isn't responding", 503, err);
    }
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (!res.ok) {
      const code = body?.error?.code;
      if (res.status === 404) throw new AppError(ErrorCode.NotFound, "Not found", 404);
      if (code === "not_supported") throw new AppError(ErrorCode.NotSupported, body?.error?.message ?? "Not available with ytmusicapi", 400);
      if (res.status === 400) throw new AppError(ErrorCode.BadRequest, body?.error?.message ?? "Bad request", 400);
      throw new AppError(ErrorCode.ProviderUnavailable, "ytmusicapi couldn't load this right now", 502);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      this.opts.logger?.warn({ path, issues: parsed.error.issues.slice(0, 3) }, "ytmusicapi returned an unexpected shape");
      throw new AppError(ErrorCode.ProviderUnavailable, "ytmusicapi returned something unexpected", 502);
    }
    return parsed.data;
  }

  getHome(): Promise<BrowsePage> {
    // ytmusicapi's home has no continuation or chip parameters.
    return this.call("/home", {}, BrowsePage);
  }
  getExplore(): Promise<BrowsePage> {
    return this.call("/explore", {}, BrowsePage);
  }
  getBrowse(browseId: string, params?: string): Promise<BrowsePage> {
    return this.call("/browse", { id: browseId, params }, BrowsePage);
  }
  search(query: string, filter: SearchFilter): Promise<SearchResults> {
    return this.call("/search", { q: query, filter }, SearchResults);
  }
  suggestions(query: string) {
    return this.call("/suggestions", { q: query }, SuggestWire);
  }
  async getTrack(id: string): Promise<TrackDetail> {
    return this.call("/track", { id }, TrackDetailWire);
  }
  getAlbum(id: string): Promise<AlbumPage> {
    return this.call("/album", { id }, AlbumPage);
  }
  getArtist(id: string): Promise<ArtistPage> {
    return this.call("/artist", { id }, ArtistPage);
  }
  getPlaylist(id: string): Promise<PlaylistPage> {
    return this.call("/playlist", { id }, PlaylistPage);
  }
  getRadio(seed: { trackId?: string; playlistId?: string }, continuation?: string): Promise<RadioResult> {
    // One batch of up to 50 songs; there is no continuation with ytmusicapi.
    if (continuation) return Promise.resolve({ tracks: [] });
    return this.call("/radio", { trackId: seed.trackId, playlistId: seed.playlistId }, RadioWire);
  }
  getRelated(trackId: string): Promise<Shelf[]> {
    return this.call("/related", { id: trackId }, z.array(Shelf));
  }
  getLyrics(track: Track): Promise<Lyrics | null> {
    return this.call("/lyrics", { id: track.id }, Lyrics.nullable());
  }
  resolveStream(trackId: string, opts: StreamOptions): Promise<StreamSource> {
    return this.opts.streams.resolveStream(trackId, opts);
  }
  async health() {
    try {
      await this.call("/health", {}, z.object({ ok: z.boolean() }));
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}
