/**
 * "official" source: Google's YouTube Data API v3 for the catalogue, with playback by YouTube's own
 * embedded player in the browser (the server never streams these songs).
 *
 * What it can and can't do (Data API v3 as of 2026):
 * - search (100 quota units per call), video / channel / playlist details (1 unit each), the music
 *   chart (mostPopular, category 10), paging via pageToken.
 * - no albums, lyrics, search suggestions, moods or related videos (relatedToVideoId was removed in
 *   2023): "related" and "radio" use more songs from the same channel instead, and say so.
 * - default quota is 10,000 units/day, i.e. about 100 searches; cached responses don't count.
 * The API key stays on the server: it is never logged (URLs are not logged) or sent to browsers.
 */
import {
  AppError, ErrorCode,
  type AlbumPage, type ArtistPage, type BrowsePage, type Playlist, type PlaylistPage, type SearchFilter,
  type SearchResults, type Shelf, type Track, type TrackDetail, type Artist,
} from "@zuno/core";
import type { MusicProvider, RadioResult, StreamSource } from "../types";

export interface OfficialOptions {
  apiKey: string;
  /** ISO country code for charts and search ranking, e.g. IN. */
  region?: string;
  language?: string;
  timeoutMs?: number;
  logger?: { warn: (o: object, m?: string) => void };
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

const API = "https://www.googleapis.com/youtube/v3";
const MUSIC_CATEGORY = "10";

type Thumbs = Record<string, { url: string; width?: number; height?: number } | undefined>;
interface VideoRes { id: string; snippet?: { title: string; channelId: string; channelTitle: string; description?: string; thumbnails?: Thumbs }; contentDetails?: { duration?: string }; statistics?: { viewCount?: string } }
interface SearchRes { id: { kind: string; videoId?: string; channelId?: string; playlistId?: string }; snippet: { title: string; channelId: string; channelTitle: string; description?: string; thumbnails?: Thumbs } }
interface ChannelRes { id: string; snippet: { title: string; description?: string; thumbnails?: Thumbs }; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean }; contentDetails?: { relatedPlaylists?: { uploads?: string } }; brandingSettings?: { image?: { bannerExternalUrl?: string } } }
interface PlaylistRes { id: string; snippet: { title: string; description?: string; channelTitle: string; thumbnails?: Thumbs }; contentDetails?: { itemCount?: number } }
interface PlaylistItemRes { contentDetails?: { videoId?: string }; snippet?: { title?: string } }
interface ListRes<T> { items?: T[]; nextPageToken?: string }

/** Search snippets come HTML-escaped ("Rock &amp; Roll"); details don't. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos|#39);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos" || k === "#39") return "'";
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return m;
  });
}

/** ISO-8601 duration (PT1H2M3S) → seconds. */
export function isoSeconds(d?: string): number | undefined {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(d ?? "");
  if (!m) return undefined;
  const s = (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0));
  return s > 0 ? s : undefined;
}

const best = (t?: Thumbs) => (t?.maxres ?? t?.standard ?? t?.high ?? t?.medium ?? t?.default)?.url;
/** "Arijit Singh - Topic" (auto-generated music channels) → "Arijit Singh". */
const artistName = (channelTitle: string) => channelTitle.replace(/\s+-\s+Topic$/i, "");
const compact = (n?: string) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return undefined;
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);
};

export class YouTubeOfficialProvider implements MusicProvider {
  readonly id = "youtube" as const;
  readonly source = "official" as const;
  readonly displayName = "YouTube (official API)";
  readonly isDevelopmentOnly = false;
  private readonly http: typeof fetch;

  constructor(private readonly opts: OfficialOptions) {
    this.http = opts.fetch ?? fetch;
  }

  private async get<T>(endpoint: string, params: Record<string, string | number | undefined>): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    qs.set("key", this.opts.apiKey);
    let res: Response;
    try {
      res = await this.http(`${API}/${endpoint}?${qs}`, { signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000), headers: { accept: "application/json" } });
    } catch (err) {
      throw new AppError(ErrorCode.ProviderUnavailable, "YouTube's API isn't responding", 503, err);
    }
    if (res.ok) return (await res.json()) as T;
    const body = (await res.json().catch(() => null)) as { error?: { errors?: { reason?: string }[]; message?: string } } | null;
    const reason = body?.error?.errors?.[0]?.reason ?? "";
    // Log the reason only — never the URL (it carries the key).
    this.opts.logger?.warn({ endpoint, status: res.status, reason }, "YouTube Data API error");
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded") {
      throw new AppError(ErrorCode.RateLimited, "Today's YouTube API limit is used up. It resets at midnight Pacific time — or switch the music source in Settings.", 429);
    }
    if (res.status === 404 || reason === "playlistNotFound" || reason === "channelNotFound" || reason === "videoNotFound") throw new AppError(ErrorCode.NotFound, "Not found", 404);
    const keyProblem = /api key/i.test(body?.error?.message ?? "");
    if (reason === "keyInvalid" || reason === "accessNotConfigured" || keyProblem || res.status === 403) {
      throw new AppError(ErrorCode.ProviderUnavailable, "The YouTube API key isn't working (check YOUTUBE_API_KEY and that YouTube Data API v3 is enabled)", 502);
    }
    throw new AppError(ErrorCode.ProviderUnavailable, "YouTube's API returned an error", 502);
  }

  private toTrack(v: VideoRes): Track | null {
    if (!v.snippet) return null;
    const topic = /\s+-\s+Topic$/i.test(v.snippet.channelTitle);
    return {
      id: v.id, provider: "youtube", title: decodeEntities(v.snippet.title),
      artist: artistName(v.snippet.channelTitle), artists: [{ id: v.snippet.channelId, name: artistName(v.snippet.channelTitle) }],
      durationSec: isoSeconds(v.contentDetails?.duration),
      artworkUrl: best(v.snippet.thumbnails) ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      viewCountText: compact(v.statistics?.viewCount) ? `${compact(v.statistics?.viewCount)} views` : undefined,
      isVideo: topic ? undefined : true,
    };
  }

  /** Full details (durations) for up to 50 ids per call, in the given order. 1 unit per call. */
  private async videos(ids: string[]): Promise<Track[]> {
    const out: Track[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const r = await this.get<ListRes<VideoRes>>("videos", { part: "snippet,contentDetails,statistics", id: chunk.join(","), maxResults: 50 });
      const byId = new Map((r.items ?? []).map((v) => [v.id, v]));
      for (const id of chunk) { const t = byId.get(id) && this.toTrack(byId.get(id)!); if (t) out.push(t); }
    }
    return out;
  }

  private async chart(pageToken?: string) {
    const r = await this.get<ListRes<VideoRes>>("videos", {
      part: "snippet,contentDetails,statistics", chart: "mostPopular", videoCategoryId: MUSIC_CATEGORY,
      regionCode: this.opts.region, hl: this.opts.language, maxResults: 50, pageToken,
    });
    return { tracks: (r.items ?? []).map((v) => this.toTrack(v)).filter((t): t is Track => !!t), next: r.nextPageToken };
  }

  async getHome(o?: { continuation?: string }): Promise<BrowsePage> {
    const { tracks, next } = await this.chart(o?.continuation);
    return {
      title: "Home", chips: [], continuation: next,
      shelves: tracks.length ? [{ id: "official-trending", title: o?.continuation ? "More trending music" : "Trending music", layout: "list", items: tracks.map((track) => ({ kind: "track" as const, track })) }] : [],
    };
  }

  async getExplore(): Promise<BrowsePage> {
    const { tracks } = await this.chart();
    return { title: "Explore", chips: [], shelves: tracks.length ? [{ id: "official-chart", title: `Top music videos${this.opts.region ? ` · ${this.opts.region}` : ""}`, layout: "carousel", items: tracks.map((track) => ({ kind: "track" as const, track })) }] : [] };
  }

  getBrowse(): Promise<BrowsePage> {
    return Promise.reject(new AppError(ErrorCode.NotSupported, "Moods and genres aren't available with the official YouTube API", 400));
  }

  async search(query: string, filter: SearchFilter, continuation?: string): Promise<SearchResults> {
    const empty: SearchResults = { query, filter, tracks: [], videos: [], albums: [], artists: [], playlists: [] };
    if (filter === "album") return empty; // the Data API has no albums
    const type = filter === "artist" ? "channel" : filter === "playlist" ? "playlist" : "video";
    const r = await this.get<ListRes<SearchRes>>("search", {
      part: "snippet", q: query, type, maxResults: 25, pageToken: continuation,
      videoCategoryId: type === "video" && filter !== "video" ? MUSIC_CATEGORY : undefined,
      regionCode: this.opts.region, relevanceLanguage: this.opts.language, safeSearch: "none",
    });
    const items = r.items ?? [];
    const out: SearchResults = { ...empty, continuation: r.nextPageToken };
    if (type === "video") {
      const tracks = await this.videos(items.map((i) => i.id.videoId).filter((x): x is string => !!x));
      if (filter === "video") out.videos = tracks; else out.tracks = tracks;
      if (filter === "all" && tracks[0] && !continuation) out.top = { kind: "track", track: tracks[0] };
    } else if (type === "channel") {
      out.artists = items.filter((i) => i.id.channelId).map((i): Artist => ({ id: i.id.channelId!, provider: "youtube", name: artistName(decodeEntities(i.snippet.title)), artworkUrl: best(i.snippet.thumbnails) }));
    } else {
      out.playlists = items.filter((i) => i.id.playlistId).map((i): Playlist => ({ id: i.id.playlistId!, provider: "youtube", title: decodeEntities(i.snippet.title), owner: artistName(i.snippet.channelTitle), artworkUrl: best(i.snippet.thumbnails) }));
    }
    return out;
  }

  async suggestions() {
    return { queries: [] as string[], items: [] }; // no suggestions endpoint in the Data API
  }

  /** Songs from a channel's uploads (newest first). 1 unit + 1 per 50 for durations. */
  private async uploads(channelId: string, max = 25, pageToken?: string) {
    const uploadsId = channelId.startsWith("UC") ? `UU${channelId.slice(2)}` : undefined;
    if (!uploadsId) return { tracks: [] as Track[], next: undefined as string | undefined };
    const r = await this.get<ListRes<PlaylistItemRes>>("playlistItems", { part: "contentDetails", playlistId: uploadsId, maxResults: max, pageToken }).catch(() => ({ items: [] }) as ListRes<PlaylistItemRes>);
    const ids = (r.items ?? []).map((i) => i.contentDetails?.videoId).filter((x): x is string => !!x);
    return { tracks: await this.videos(ids), next: r.nextPageToken };
  }

  async getTrack(id: string): Promise<TrackDetail> {
    const [t] = await this.videos([id]);
    if (!t) throw new AppError(ErrorCode.NotFound, "This video isn't available", 404);
    return { track: t, related: await this.getRelated(id, t) };
  }

  async getRelated(trackId: string, known?: Track): Promise<Shelf[]> {
    const t = known ?? (await this.videos([trackId]))[0];
    const channelId = t?.artists?.[0]?.id;
    if (!t || !channelId) return [];
    const { tracks } = await this.uploads(channelId, 20);
    const more = tracks.filter((x) => x.id !== trackId);
    // The Data API has no "related videos"; this is honestly labelled as the same artist's uploads.
    return more.length ? [{ id: "official-more-from-artist", title: `More from ${t.artist}`, layout: "list", items: more.map((track) => ({ kind: "track" as const, track })) }] : [];
  }

  getAlbum(): Promise<AlbumPage> {
    return Promise.reject(new AppError(ErrorCode.NotSupported, "Albums aren't available with the official YouTube API — switch the music source in Settings", 400));
  }

  async getArtist(id: string): Promise<ArtistPage> {
    const r = await this.get<ListRes<ChannelRes>>("channels", { part: "snippet,statistics,contentDetails,brandingSettings", id });
    const c = r.items?.[0];
    if (!c) throw new AppError(ErrorCode.NotFound, "Artist not found", 404);
    const { tracks } = await this.uploads(id, 25);
    const subs = c.statistics?.hiddenSubscriberCount ? undefined : compact(c.statistics?.subscriberCount);
    return {
      artist: { id, provider: "youtube", name: artistName(c.snippet.title), artworkUrl: best(c.snippet.thumbnails), subscriberCount: subs ? `${subs} subscribers` : undefined },
      description: c.snippet.description || undefined,
      bannerUrl: c.brandingSettings?.image?.bannerExternalUrl,
      topTracks: tracks, shelves: [],
    };
  }

  async getPlaylist(id: string, continuation?: string): Promise<PlaylistPage> {
    const [meta, page] = await Promise.all([
      this.get<ListRes<PlaylistRes>>("playlists", { part: "snippet,contentDetails", id }),
      this.get<ListRes<PlaylistItemRes>>("playlistItems", { part: "contentDetails", playlistId: id, maxResults: 50, pageToken: continuation }),
    ]);
    const p = meta.items?.[0];
    if (!p) throw new AppError(ErrorCode.NotFound, "Playlist not found", 404);
    const tracks = await this.videos((page.items ?? []).map((i) => i.contentDetails?.videoId).filter((x): x is string => !!x));
    return {
      playlist: { id, provider: "youtube", title: decodeEntities(p.snippet.title), owner: artistName(p.snippet.channelTitle), description: p.snippet.description || undefined, artworkUrl: best(p.snippet.thumbnails), trackCountText: p.contentDetails?.itemCount ? `${p.contentDetails.itemCount} videos` : undefined },
      tracks, continuation: page.nextPageToken,
      totalDurationSec: tracks.reduce((s, t) => s + (t.durationSec ?? 0), 0) || undefined,
    };
  }

  /** No radio in the Data API: the seed, then more from the same channel (paged), then the chart. */
  async getRadio(seed: { trackId?: string; playlistId?: string }, continuation?: string): Promise<RadioResult> {
    if (seed.playlistId && !seed.trackId) {
      const p = await this.getPlaylist(seed.playlistId, continuation);
      return { tracks: p.tracks, continuation: p.continuation, playlistId: seed.playlistId };
    }
    if (!seed.trackId) return { tracks: [] };
    const [t] = await this.videos([seed.trackId]);
    if (!t) throw new AppError(ErrorCode.NotFound, "This video isn't available", 404);
    const channelId = t.artists?.[0]?.id;
    const { tracks, next } = channelId ? await this.uploads(channelId, 25, continuation) : { tracks: [], next: undefined };
    const more = tracks.filter((x) => x.id !== t.id);
    if (!next && !continuation) more.push(...(await this.chart()).tracks.filter((x) => x.id !== t.id && !more.some((m) => m.id === x.id)).slice(0, 25));
    return { tracks: continuation ? more : [t, ...more], continuation: next };
  }

  resolveStream(): Promise<StreamSource> {
    return Promise.reject(new AppError(ErrorCode.NotSupported, "With the official YouTube source, songs play in YouTube's player in your browser", 400));
  }

  async health() {
    // Don't spend quota on health checks; a bad key shows up on the first real request.
    return { ok: !!this.opts.apiKey };
  }
}
