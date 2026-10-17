/**
 * Fetches track lists from music services using their *official* APIs only:
 *  - YouTube / YouTube Music → our provider (ids are catalog ids — no matching needed)
 *  - Deezer → public API (no key)
 *  - Spotify → Web API, client-credentials flow (needs SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET)
 * Only fixed API hosts are contacted; user-supplied URLs are parsed, never fetched (except
 * allow-listed short-link hosts, whose redirect target is re-validated).
 */
import { AppError, ErrorCode, type ImportCollection, type ImportItem } from "@zuno/core";
import type { MusicProvider } from "@zuno/provider";
import { parseImportLink, SHORT_LINK_HOSTS, type LinkTarget } from "./links";

const MAX_ITEMS = 5000;
const UA = "NeoMusic/1.0 (+playlist import)";

async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) throw new AppError(ErrorCode.NotFound, "That playlist or album wasn't found (is it public?)", 404);
  if (!res.ok) throw new AppError(ErrorCode.ProviderUnavailable, `The music service answered ${res.status}`, 502);
  return (await res.json()) as T;
}

/** Follow one redirect hop of an allow-listed short link and re-parse the destination. */
async function resolveShort(t: Extract<LinkTarget, { platform: "short" }>, hops = 0): Promise<LinkTarget> {
  if (hops > 3) throw new AppError(ErrorCode.BadRequest, "Couldn't follow that short link", 400);
  const res = await fetch(t.url, { method: "GET", redirect: "manual", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) });
  const loc = res.headers.get("location");
  await res.body?.cancel().catch(() => undefined);
  if (!loc) throw new AppError(ErrorCode.BadRequest, "That short link doesn't point to a playlist", 400);
  const next = parseImportLink(new URL(loc, t.url).toString());
  if (!next) throw new AppError(ErrorCode.BadRequest, "That link isn't a supported playlist or album", 400);
  if (next.platform === "short") {
    if (!SHORT_LINK_HOSTS.has(next.host)) throw new AppError(ErrorCode.BadRequest, "Unsupported link", 400);
    return resolveShort(next, hops + 1);
  }
  return next;
}

// ---------- YouTube / YouTube Music ----------
async function fromYouTube(provider: MusicProvider, t: Extract<LinkTarget, { platform: "youtube" }>): Promise<ImportCollection> {
  if (provider.id !== "youtube" && provider.id !== "dev") throw new AppError(ErrorCode.BadRequest, "YouTube import isn't available with this catalog", 400);
  if (t.kind === "track") {
    const d = await provider.getTrack(t.id);
    return { name: d.track.title, kind: "playlist", source: "youtube", items: [{ title: d.track.title, artist: d.track.artist, durationSec: d.track.durationSec, catalogId: d.track.id }] };
  }
  if (t.kind === "album") {
    const a = await provider.getAlbum(t.id);
    return { name: a.album.title, kind: "album", source: "youtube_music", items: a.tracks.map((x) => ({ title: x.title, artist: x.artist, album: a.album.title, durationSec: x.durationSec, catalogId: x.id })) };
  }
  let page = await provider.getPlaylist(t.id);
  const name = page.playlist.title;
  const items: ImportItem[] = [];
  for (let guard = 0; guard < 60; guard++) {
    items.push(...page.tracks.map((x) => ({ title: x.title, artist: x.artist, album: x.album, durationSec: x.durationSec, catalogId: x.id })));
    if (!page.continuation || items.length >= MAX_ITEMS) break;
    page = await provider.getPlaylist(t.id, page.continuation);
  }
  return { name, kind: "playlist", source: "youtube_music", items: items.slice(0, MAX_ITEMS) };
}

// ---------- Deezer (public API, no key) ----------
type DzTrack = { title: string; duration: number; artist: { name: string }; album?: { title: string } };
async function fromDeezer(t: Extract<LinkTarget, { platform: "deezer" }>): Promise<ImportCollection> {
  const head = await getJson<{ title: string; error?: { code: number }; tracks?: { data: DzTrack[]; next?: string }; artist?: { name: string } }>(`https://api.deezer.com/${t.kind}/${t.id}`);
  if (head.error) throw new AppError(ErrorCode.NotFound, "That Deezer playlist/album wasn't found or isn't public", 404);
  const all: DzTrack[] = [...(head.tracks?.data ?? [])];
  let next = head.tracks?.next;
  while (next && all.length < MAX_ITEMS) {
    const n = new URL(next);
    if (n.hostname !== "api.deezer.com") break; // never follow off-host
    const page = await getJson<{ data: DzTrack[]; next?: string }>(n.toString());
    all.push(...page.data);
    next = page.next;
  }
  return {
    name: head.title, kind: t.kind, source: "deezer",
    items: all.slice(0, MAX_ITEMS).map((x) => ({ title: x.title, artist: x.artist.name, album: x.album?.title ?? (t.kind === "album" ? head.title : undefined), durationSec: x.duration || undefined })),
  };
}

// ---------- Spotify (Web API, client credentials) ----------
let spToken: { value: string; exp: number } | null = null;
async function spotifyToken(id: string, secret: string): Promise<string> {
  if (spToken && spToken.exp > Date.now() + 60_000) return spToken.value;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new AppError(ErrorCode.ProviderUnavailable, "Spotify rejected the app credentials", 502);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  spToken = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return spToken.value;
}
type SpTrack = { name: string; duration_ms: number; artists: { name: string }[]; album?: { name: string }; external_ids?: { isrc?: string } } | null;
async function fromSpotify(t: Extract<LinkTarget, { platform: "spotify" }>, creds?: { id: string; secret: string }): Promise<ImportCollection> {
  if (!creds) {
    throw new AppError(ErrorCode.Forbidden, "Spotify links need Spotify API keys on this server. Export the playlist with Exportify (exportify.app) and upload the CSV instead.", 422);
  }
  const auth = { Authorization: `Bearer ${await spotifyToken(creds.id, creds.secret)}` };
  const base = "https://api.spotify.com/v1";
  if (t.kind === "album") {
    const a = await getJson<{ name: string; tracks: { items: (SpTrack & object)[]; next?: string } }>(`${base}/albums/${t.id}`, { headers: auth });
    const items = [...a.tracks.items];
    let next = a.tracks.next;
    while (next && items.length < MAX_ITEMS && new URL(next).hostname === "api.spotify.com") { const p = await getJson<{ items: (SpTrack & object)[]; next?: string }>(next, { headers: auth }); items.push(...p.items); next = p.next; }
    return { name: a.name, kind: "album", source: "spotify", items: items.map((x) => ({ title: x.name, artist: x.artists.map((r) => r.name).join(", "), album: a.name, durationSec: Math.round(x.duration_ms / 1000) })) };
  }
  const fields = "name,tracks.items(track(name,duration_ms,artists(name),album(name),external_ids(isrc))),tracks.next";
  const p = await getJson<{ name: string; tracks: { items: { track: SpTrack }[]; next?: string } }>(`${base}/playlists/${t.id}?fields=${encodeURIComponent(fields)}`, { headers: auth });
  const rows = [...p.tracks.items];
  let next = p.tracks.next;
  while (next && rows.length < MAX_ITEMS && new URL(next).hostname === "api.spotify.com") { const pg = await getJson<{ items: { track: SpTrack }[]; next?: string }>(next, { headers: auth }); rows.push(...pg.items); next = pg.next; }
  return {
    name: p.name, kind: "playlist", source: "spotify",
    items: rows.map((r) => r.track).filter((x): x is NonNullable<SpTrack> => !!x && !!x.name)
      .map((x) => ({ title: x.name, artist: x.artists.map((r) => r.name).join(", "), album: x.album?.name, durationSec: Math.round(x.duration_ms / 1000), isrc: x.external_ids?.isrc })),
  };
}

export async function importFromLink(url: string, deps: { provider: MusicProvider; spotify?: { id: string; secret: string } }): Promise<ImportCollection> {
  let t = parseImportLink(url);
  if (!t) throw new AppError(ErrorCode.BadRequest, "That doesn't look like a playlist or album link from a supported service", 400);
  if (t.platform === "short") t = await resolveShort(t);
  switch (t.platform) {
    case "youtube": return fromYouTube(deps.provider, t);
    case "deezer": return fromDeezer(t);
    case "spotify": return fromSpotify(t, deps.spotify);
    case "apple_music": throw new AppError(ErrorCode.BadRequest, "Apple Music has no public API for links. In the Music app choose File → Library → Export Playlist…, then upload the file.", 422);
    default: throw new AppError(ErrorCode.BadRequest, "Unsupported link", 400);
  }
}
