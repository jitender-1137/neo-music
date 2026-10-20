/**
 * Provider-neutral catalog models.
 *
 * Adapted from Zuno's `src/datasource/types.ts` (Apache-2.0, © Zuno contributors). Every id is the
 * provider's own id, namespaced by `provider` so a licensed catalog can sit beside YouTube later.
 */
import { z } from "zod";

export const ProviderId = z.enum(["youtube", "dev"]);
export type ProviderId = z.infer<typeof ProviderId>;

/**
 * Which library fetches the catalogue. All three read YouTube / YouTube Music, so ids (and therefore
 * likes, history and playlists, stored under provider "youtube") are shared between them.
 *   youtubei   youtubei.js (Innertube) — audio streamed through the server.
 *   ytmusicapi ytmusicapi (Python) — YouTube Music metadata; audio streamed through the server.
 *   official   YouTube Data API v3 + YouTube's embedded player — audio played by YouTube in the
 *              browser (never through the server); no albums or lyrics; quota-limited.
 */
export const MusicSource = z.enum(["youtubei", "ytmusicapi", "official"]);
export type MusicSource = z.infer<typeof MusicSource>;

export const SourceInfo = z.object({
  id: MusicSource,
  name: z.string(),
  description: z.string(),
  /** stream = the server streams the audio; embed = YouTube's embedded player plays it in the browser. */
  playback: z.enum(["stream", "embed"]),
  features: z.object({
    albums: z.boolean(),
    lyrics: z.boolean(),
    suggestions: z.boolean(),
    moods: z.boolean(),
    /** Keeps playing with the screen locked / app in the background (lock-screen controls). */
    backgroundPlayback: z.boolean(),
  }),
});
export type SourceInfo = z.infer<typeof SourceInfo>;

export const ArtistRef = z.object({ id: z.string(), name: z.string() });
export type ArtistRef = z.infer<typeof ArtistRef>;

export const Track = z.object({
  id: z.string(),
  provider: ProviderId,
  title: z.string(),
  /** Display string, e.g. "A, B & C". */
  artist: z.string(),
  artists: z.array(ArtistRef).optional(),
  album: z.string().optional(),
  albumId: z.string().optional(),
  durationSec: z.number().optional(),
  artworkUrl: z.string().optional(),
  isExplicit: z.boolean().optional(),
  viewCountText: z.string().optional(),
  /** Set when the row is a music video rather than an audio track. */
  isVideo: z.boolean().optional(),
});
export type Track = z.infer<typeof Track>;

export const Album = z.object({
  id: z.string(),
  provider: ProviderId,
  title: z.string(),
  artist: z.string(),
  artists: z.array(ArtistRef).optional(),
  artworkUrl: z.string().optional(),
  year: z.string().optional(),
  releaseType: z.enum(["album", "single", "ep"]).optional(),
  /** Playlist id that plays the whole album in order. */
  playlistId: z.string().optional(),
});
export type Album = z.infer<typeof Album>;

export const Playlist = z.object({
  id: z.string(),
  provider: z.union([ProviderId, z.literal("user")]),
  title: z.string(),
  owner: z.string(),
  description: z.string().optional(),
  artworkUrl: z.string().optional(),
  trackCountText: z.string().optional(),
});
export type Playlist = z.infer<typeof Playlist>;

export const Artist = z.object({
  id: z.string(),
  provider: ProviderId,
  name: z.string(),
  artworkUrl: z.string().optional(),
  subscriberCount: z.string().optional(),
});
export type Artist = z.infer<typeof Artist>;

/** A chip leading to another browse feed (moods, genres). `params` is load-bearing for moods. */
export const BrowseLink = z.object({
  title: z.string(),
  browseId: z.string(),
  params: z.string().optional(),
  color: z.string().optional(),
});
export type BrowseLink = z.infer<typeof BrowseLink>;

export const ShelfItem = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("track"), track: Track }),
  z.object({ kind: z.literal("album"), album: Album }),
  z.object({ kind: z.literal("playlist"), playlist: Playlist }),
  z.object({ kind: z.literal("artist"), artist: Artist }),
  z.object({ kind: z.literal("link"), link: BrowseLink }),
]);
export type ShelfItem = z.infer<typeof ShelfItem>;

export const Shelf = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  /** "list" renders as a quick-picks style grid of rows; "carousel" as cards. */
  layout: z.enum(["carousel", "list", "chips"]),
  items: z.array(ShelfItem),
  /** Opaque "more" target, if the provider has one. */
  more: BrowseLink.optional(),
});
export type Shelf = z.infer<typeof Shelf>;

export const BrowsePage = z.object({
  title: z.string(),
  chips: z.array(BrowseLink).default([]),
  shelves: z.array(Shelf),
  continuation: z.string().optional(),
});
export type BrowsePage = z.infer<typeof BrowsePage>;

export const SearchFilter = z.enum(["all", "song", "video", "album", "artist", "playlist"]);
export type SearchFilter = z.infer<typeof SearchFilter>;

export const SearchResults = z.object({
  query: z.string(),
  filter: SearchFilter,
  top: ShelfItem.optional(),
  tracks: z.array(Track),
  videos: z.array(Track),
  albums: z.array(Album),
  artists: z.array(Artist),
  playlists: z.array(Playlist),
  continuation: z.string().optional(),
});
export type SearchResults = z.infer<typeof SearchResults>;

export const AlbumPage = z.object({
  album: Album,
  description: z.string().optional(),
  subtitle: z.string().optional(),
  tracks: z.array(Track),
  totalDurationSec: z.number().optional(),
  otherVersions: z.array(Album).default([]),
});
export type AlbumPage = z.infer<typeof AlbumPage>;

export const ArtistPage = z.object({
  artist: Artist,
  description: z.string().optional(),
  bannerUrl: z.string().optional(),
  topTracks: z.array(Track),
  shelves: z.array(Shelf),
  radioPlaylistId: z.string().optional(),
  shufflePlaylistId: z.string().optional(),
});
export type ArtistPage = z.infer<typeof ArtistPage>;

export const PlaylistPage = z.object({
  playlist: Playlist,
  tracks: z.array(Track),
  totalDurationSec: z.number().optional(),
  continuation: z.string().optional(),
});
export type PlaylistPage = z.infer<typeof PlaylistPage>;

export const TrackDetail = z.object({
  track: Track,
  description: z.string().optional(),
  related: z.array(Shelf).default([]),
});
export type TrackDetail = z.infer<typeof TrackDetail>;

export const LyricLine = z.object({
  text: z.string(),
  startMs: z.number().optional(),
  endMs: z.number().optional(),
});
export type LyricLine = z.infer<typeof LyricLine>;

export const Lyrics = z.object({
  lines: z.array(LyricLine),
  timing: z.enum(["synced", "none"]),
  source: z.string(),
  attribution: z.string().optional(),
});
export type Lyrics = z.infer<typeof Lyrics>;

export const AudioQuality = z.enum(["auto", "low", "normal", "high"]);
export type AudioQuality = z.infer<typeof AudioQuality>;

/** What the client receives when it asks to play something. Never contains a raw provider URL. */
export const PlaybackSession = z.object({
  sessionId: z.string(),
  trackId: z.string(),
  streamUrl: z.string(),
  mimeType: z.string(),
  bitrate: z.number().optional(),
  contentLength: z.number().optional(),
  durationSec: z.number().optional(),
  expiresAt: z.string(),
});
export type PlaybackSession = z.infer<typeof PlaybackSession>;
