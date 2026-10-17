/**
 * youtubei.js node → @zuno/core model mappers.
 *
 * Logic adapted from Zuno `YouTubeMusicDataSource.ts` (toTrack/toAlbum/toPlaylist/toArtist,
 * getArtists, getTrackAlbum, findBrowseId; Apache-2.0). youtubei.js node types are deep unions,
 * so nodes are read structurally as `YtNode`.
 */
import type { Album, Artist, ArtistRef, BrowseLink, Playlist, Shelf, ShelfItem, Track } from "@zuno/core";
import { normalizeKey, parseDuration } from "@zuno/core";
import { bestArtwork, videoArtworkFallback } from "./artwork";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type YtNode = any;

export const isVideoId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{11}$/.test(v);

export function text(v: YtNode): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v.trim() || undefined;
  const s = typeof v.toString === "function" ? v.toString() : undefined;
  if (s && s !== "[object Object]") return s.trim() || undefined;
  if (typeof v.text === "string") return v.text.trim() || undefined;
  return undefined;
}

function walk<T>(root: unknown, pick: (node: Record<string, unknown>) => T | undefined): T | undefined {
  const seen = new WeakSet<object>();
  const visit = (v: unknown): T | undefined => {
    if (!v || typeof v !== "object" || seen.has(v)) return undefined;
    seen.add(v);
    const hit = pick(v as Record<string, unknown>);
    if (hit !== undefined) return hit;
    for (const child of Object.values(v)) {
      const r = visit(child);
      if (r !== undefined) return r;
    }
    return undefined;
  };
  return visit(root);
}

export const findBrowseId = (root: unknown) =>
  walk(root, (n) => (typeof n.browseId === "string" ? n.browseId : undefined));

export const findBrowseParams = (root: unknown) =>
  walk(root, (n) => (typeof n.browseId === "string" && typeof n.params === "string" ? n.params : undefined));

export const findVideoId = (root: unknown) =>
  walk(root, (n) => (isVideoId(n.videoId) ? (n.videoId as string) : undefined));

export const findPlaylistId = (root: unknown, prefix?: string) =>
  walk(root, (n) => {
    const id = n.playlistId;
    return typeof id === "string" && id && (!prefix || id.startsWith(prefix)) ? id : undefined;
  });

/** Library rows address artists as MPLA+channel; everything else uses the bare channel id. */
const normArtistId = (id?: string) => (id?.startsWith("MPLA") ? id.slice(4) : id);

/** "VLPL…" (browse form) → "PL…" (playlist form). */
export const normPlaylistId = (id: string) => (id.startsWith("VL") ? id.slice(2) : id);

export function artistsOf(item: YtNode): ArtistRef[] | undefined {
  const toRef = (c: YtNode): ArtistRef => ({
    id: normArtistId(c?.channel_id ?? findBrowseId(c?.endpoint) ?? findBrowseId(c?.navigationEndpoint)) ?? "",
    name: c?.name ?? c?.text ?? "",
  });
  const candidates: YtNode[] = item?.artists?.length ? item.artists : item?.authors?.length ? item.authors : item?.author ? [item.author] : [];
  const linked = candidates.map(toRef).filter((a) => a.id.startsWith("UC") && a.name);
  if (linked.length) return linked;
  const named = candidates.map(toRef).filter((a) => a.name);
  if (named.length) return named;
  // Mixed search rows carry artists only as linked runs in the subtitle or second flex column.
  const runs: YtNode[] = [
    ...(item?.subtitle?.runs ?? []),
    ...(item?.flex_columns ?? []).slice(1).flatMap((c: YtNode) => c?.title?.runs ?? []),
  ];
  const fromRuns = runs.map(toRef).filter((a) => a.id.startsWith("UC") && a.name);
  const unique = fromRuns.filter((a, i) => fromRuns.findIndex((b) => b.id === a.id) === i);
  return unique.length ? unique : undefined;
}

export function artistLine(item: YtNode, refs = artistsOf(item)): string {
  if (refs?.length) return refs.map((a) => a.name).join(", ");
  return text(item?.subtitle)?.split(" • ")[0] ?? "Unknown artist";
}

function albumOf(item: YtNode): { name?: string; id?: string } {
  if (item?.album?.id || item?.album?.name) {
    const id = item.album.id ?? findBrowseId(item.album.endpoint);
    return { name: item.album.name, id: id?.startsWith("MPRE") ? id : undefined };
  }
  for (const col of (item?.flex_columns ?? []).slice(1)) {
    for (const run of col?.title?.runs ?? []) {
      const id = findBrowseId(run?.endpoint);
      if (id?.startsWith("MPRE")) return { name: run.text, id };
    }
  }
  return {};
}

const isExplicit = (item: YtNode): boolean | undefined =>
  Array.isArray(item?.badges) ? item.badges.some((b: YtNode) => b?.icon_type === "MUSIC_EXPLICIT_BADGE") : undefined;

function durationOf(item: YtNode): number | undefined {
  if (typeof item?.duration?.seconds === "number" && item.duration.seconds > 0) return item.duration.seconds;
  if (typeof item?.duration === "string") return parseDuration(item.duration);
  const fixed = text(item?.fixed_columns?.[0]?.title);
  return parseDuration(fixed) ?? parseDuration(text(item?.duration));
}

function viewsOf(item: YtNode): string | undefined {
  if (typeof item?.views === "string") return item.views;
  const texts = [
    ...(item?.flex_columns ?? []).map((c: YtNode) => text(c?.title)),
    text(item?.subtitle),
  ].filter(Boolean) as string[];
  for (const t of texts) {
    const m = t.split(" • ").find((p) => /\b(views?|plays?)\b/i.test(p));
    if (m) return m.trim();
  }
  return undefined;
}

export function toTrack(item: YtNode, fallback?: Partial<Track>): Track | null {
  const id = item?.endpoint?.payload?.videoId ?? item?.video_id ?? (isVideoId(item?.id) ? item.id : findVideoId(item?.endpoint ?? item?.overlay));
  const title = text(item?.title) ?? text(item?.name);
  if (!isVideoId(id) || !title) return null;
  const refs = artistsOf(item);
  const album = albumOf(item);
  const isVideo = item?.item_type === "video"
    || item?.endpoint?.payload?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType === "MUSIC_VIDEO_TYPE_OMV"
    || item?.endpoint?.payload?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType === "MUSIC_VIDEO_TYPE_UGC";
  const artistText = refs?.length ? artistLine(item, refs) : fallback?.artist ?? artistLine(item, refs);
  return {
    id,
    provider: "youtube",
    title,
    artist: artistText,
    artists: refs?.length ? refs : fallback?.artists,
    album: album.name ?? fallback?.album,
    albumId: album.id ?? fallback?.albumId,
    durationSec: durationOf(item),
    artworkUrl: bestArtwork(item?.thumbnail, item?.thumbnails) ?? fallback?.artworkUrl ?? videoArtworkFallback(id),
    isExplicit: isExplicit(item),
    viewCountText: viewsOf(item),
    isVideo: isVideo || undefined,
  };
}

export function toAlbum(item: YtNode): Album | null {
  const id = (typeof item?.id === "string" && item.id.startsWith("MPRE") ? item.id : undefined) ?? findBrowseId(item?.endpoint);
  const title = text(item?.title);
  if (!id?.startsWith("MPRE") || !title) return null;
  const sub = text(item?.subtitle) ?? "";
  const parts = sub.split(" • ");
  const kind = parts[0]?.toLowerCase();
  const releaseType = kind === "single" ? "single" : kind === "ep" ? "ep" : kind === "album" ? "album" : undefined;
  const refs = artistsOf(item);
  const year = typeof item?.year === "string" ? item.year : parts.find((p) => /^\d{4}$/.test(p.trim()));
  return {
    id,
    provider: "youtube",
    title,
    artist: refs?.length ? artistLine(item, refs) : parts.filter((p) => !/^\d{4}$/.test(p.trim()) && !["album", "single", "ep"].includes(p.toLowerCase())).join(", ") || "",
    artists: refs,
    artworkUrl: bestArtwork(item?.thumbnail, item?.thumbnails),
    year: year?.trim(),
    releaseType,
    playlistId: findPlaylistId(item, "OLAK5uy_"),
  };
}

export function toPlaylist(item: YtNode): Playlist | null {
  const raw = (typeof item?.id === "string" ? item.id : undefined) ?? findBrowseId(item?.endpoint);
  const title = text(item?.title);
  if (!raw || !title || raw.startsWith("MPRE") || raw.startsWith("UC")) return null;
  const sub = text(item?.subtitle) ?? "";
  const parts = sub.split(" • ").map((s) => s.trim());
  const owner = parts.find((p) => p && !/^playlist$/i.test(p) && !/\b(views?|songs?|tracks?)\b/i.test(p)) ?? "YouTube Music";
  return {
    id: normPlaylistId(raw),
    provider: "youtube",
    title,
    owner,
    artworkUrl: bestArtwork(item?.thumbnail, item?.thumbnails),
    trackCountText: parts.find((p) => /\b(songs?|tracks?)\b/i.test(p)),
  };
}

export function toArtist(item: YtNode): Artist | null {
  const id = normArtistId(
    (typeof item?.id === "string" ? item.id : undefined) ?? findBrowseId(item?.endpoint) ?? findBrowseId(item?.on_tap),
  );
  const name = text(item?.title) ?? text(item?.name) ?? item?.author?.name;
  if (!id?.startsWith("UC") || !name) return null;
  const sub = text(item?.subtitle);
  return {
    id,
    provider: "youtube",
    name,
    artworkUrl: bestArtwork(item?.thumbnail, item?.thumbnails),
    subscriberCount: item?.subscribers ?? sub?.split(" • ").find((p) => /subscribers|audience|listeners/i.test(p)),
  };
}

export function toLink(button: YtNode): BrowseLink | null {
  const title = text(button?.button_text) ?? text(button?.title) ?? text(button?.text);
  const browseId = findBrowseId(button?.endpoint ?? button?.on_tap);
  if (!title || !browseId) return null;
  const color = typeof button?.color === "number" ? `#${(button.color & 0xffffff).toString(16).padStart(6, "0")}` : undefined;
  return { title, browseId, params: findBrowseParams(button?.endpoint ?? button?.on_tap), color };
}

/** Maps any shelf child to a typed shelf item, or null for things we don't render (podcasts, episodes). */
export function toShelfItem(item: YtNode): ShelfItem | null {
  if (item?.type === "MusicNavigationButton") {
    const link = toLink(item);
    return link ? { kind: "link", link } : null;
  }
  switch (item?.item_type) {
    case "song":
    case "video": {
      const t = toTrack(item);
      return t ? { kind: "track", track: t } : null;
    }
    case "album": {
      const a = toAlbum(item);
      return a ? { kind: "album", album: a } : null;
    }
    case "playlist": {
      const p = toPlaylist(item);
      return p ? { kind: "playlist", playlist: p } : null;
    }
    case "artist": {
      const a = toArtist(item);
      return a ? { kind: "artist", artist: a } : null;
    }
    default:
      if (item?.type === "PlaylistPanelVideo") {
        const t = toTrack(item);
        return t ? { kind: "track", track: t } : null;
      }
      return null;
  }
}

function itemKey(i: ShelfItem): string {
  switch (i.kind) {
    case "track": return `t:${i.track.id}`;
    case "album": return `a:${i.album.id}`;
    case "playlist": return `p:${i.playlist.id}`;
    case "artist": return `r:${i.artist.id}`;
    case "link": return `l:${i.link.browseId}:${i.link.params ?? ""}`;
  }
}

/**
 * Drops a music video when the same title+artist exists as a song in the same list (Zuno #107:
 * a video's audio is often a different recording), and removes exact duplicates.
 */
export function dedupeItems(items: ShelfItem[]): ShelfItem[] {
  const songKeys = new Set(
    items.filter((i) => i.kind === "track" && !i.track.isVideo).map((i) => i.kind === "track" ? `${normalizeKey(i.track.title)}::${normalizeKey(i.track.artist)}` : ""),
  );
  const seen = new Set<string>();
  return items.filter((i) => {
    if (i.kind === "track" && i.track.isVideo && songKeys.has(`${normalizeKey(i.track.title)}::${normalizeKey(i.track.artist)}`)) return false;
    const k = itemKey(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

let shelfCounter = 0;
export function toShelf(section: YtNode, fallbackTitle?: string): Shelf | null {
  const title = text(section?.header?.title) ?? text(section?.title) ?? fallbackTitle;
  const contents: YtNode[] = section?.contents ?? section?.items ?? [];
  const items = dedupeItems(contents.map(toShelfItem).filter((x): x is ShelfItem => x !== null));
  if (!items.length) return null;
  const allLinks = items.every((i) => i.kind === "link");
  const rowish = contents[0]?.type === "MusicResponsiveListItem" && items.every((i) => i.kind === "track");
  const moreEndpoint = section?.header?.more_content?.endpoint ?? section?.bottom_endpoint ?? section?.header?.end_icons?.[0]?.endpoint;
  const moreId = findBrowseId(moreEndpoint);
  return {
    id: `${normalizeKey(title ?? "shelf") || "shelf"}-${++shelfCounter}`,
    title: title ?? "",
    subtitle: text(section?.header?.strapline),
    layout: allLinks ? "chips" : rowish ? "list" : "carousel",
    items,
    more: moreId ? { title: title ?? "More", browseId: moreId, params: findBrowseParams(moreEndpoint) } : undefined,
  };
}

/** Every shelf in a parsed browse response, via the parser memo (Zuno collectBrowseSections). */
export function shelvesFromMemo(response: YtNode, types: string[]): Shelf[] {
  const shelves: Shelf[] = [];
  for (const memo of [response?.contents_memo, response?.continuation_contents_memo]) {
    if (!memo) continue;
    for (const type of types) {
      for (const node of memo.get(type) ?? []) {
        const s = toShelf(node);
        if (s) shelves.push(s);
      }
    }
  }
  return shelves;
}
