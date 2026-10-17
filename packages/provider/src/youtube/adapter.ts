import { Innertube, Platform, ClientType, UniversalCache, YTNodes, Parser, Log } from "youtubei.js";
import {
  AppError, ErrorCode,
  type AlbumPage, type ArtistPage, type BrowsePage, type PlaylistPage, type SearchFilter,
  type SearchResults, type Shelf, type ShelfItem, type Track, type TrackDetail, type Lyrics,
} from "@zuno/core";
import type { MusicProvider, RadioResult, StreamOptions, StreamSource } from "../types";
import { TtlCache, Mutex, SingleFlight } from "../ttlCache";
import { mintPoToken, warmPoToken } from "./botguard";
import { bestArtwork } from "./artwork";
import { lrclibLyrics } from "../lyrics/lrclib";
import {
  type YtNode, artistsOf, artistLine, dedupeItems, findBrowseId, findPlaylistId, normPlaylistId,
  shelvesFromMemo, text, toAlbum, toArtist, toLink, toPlaylist, toShelf, toShelfItem, toTrack, isVideoId,
} from "./mappers";

/** Opaque, stateless continuation: YouTube's own token, base64url-wrapped. Works on any API instance. */
const encodeCont = (token: string | undefined) => (token ? Buffer.from(token).toString("base64url") : undefined);
const decodeCont = (c: string) => {
  const t = Buffer.from(c, "base64url").toString();
  if (!t || t.length > 3000 || !/^[\w%=\-]+$/.test(t)) throw new AppError(ErrorCode.BadRequest, "Invalid continuation", 400);
  return t;
};

/** Finds the next-page token in a parsed response (section lists, shelves, or ContinuationItem). */
function findContinuationToken(root: YtNode): string | undefined {
  const seen = new WeakSet<object>();
  const visit = (v: YtNode, depth: number): string | undefined => {
    if (!v || typeof v !== "object" || seen.has(v) || depth > 12) return undefined;
    seen.add(v);
    if (v.type === "ContinuationItem") {
      const tok = v.endpoint?.payload?.token ?? v.endpoint?.payload?.continuation;
      if (typeof tok === "string") return tok;
    }
    if (typeof v.continuation === "string" && v.continuation.length > 20) return v.continuation;
    for (const k of Object.keys(v)) {
      if (k === "contents_memo" || k === "continuation_contents_memo") continue;
      const r = visit(v[k], depth + 1);
      if (r) return r;
    }
    return undefined;
  };
  return visit(root, 0);
}

// youtubei.js deciphers signatures by evaluating YouTube's player script (as Zuno does).
Platform.shim.eval = async (data: { output: string }) => new Function(data.output)();

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const CLIENT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MEDIA_HEADERS = { "User-Agent": BROWSER_UA, Origin: "https://music.youtube.com", Referer: "https://music.youtube.com/" };

export interface YouTubeProviderOptions {
  /** gl/hl for region + language of feeds. */
  location?: string;
  language?: string;
  logger?: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void };
}

type Client = { yt: Innertube; createdAt: number };

function wrap(err: unknown, what: string): never {
  if (err instanceof AppError) throw err;
  const message = err instanceof Error ? err.message : String(err);
  if (/not found|404|does not exist|unavailable|no contents found/i.test(message)) {
    throw new AppError(ErrorCode.NotFound, `${what} not found`, 404, err);
  }
  throw new AppError(ErrorCode.ProviderUnavailable, `YouTube Music request failed: ${what}`, 502, err);
}

export class YouTubeMusicProvider implements MusicProvider {
  readonly id = "youtube" as const;
  readonly displayName = "YouTube Music";
  readonly isDevelopmentOnly = false;

  private browse?: Promise<Client>;
  private stream?: Promise<Client>;
  private readonly streamLock = new Mutex();
  private readonly flights = new SingleFlight<StreamSource>();
  private readonly streams = new TtlCache<StreamSource>(500, 60 * 60 * 1000);

  constructor(private readonly opts: YouTubeProviderOptions = {}) {
    // youtubei.js prints parser notices (new renderer types YouTube rolls out) to the console;
    // they're harmless for us — route them to debug logs instead of stderr noise.
    Log.setLevel(Log.Level.ERROR);
    Parser.setParserErrorHandler((ctx: { error_type?: string; classname?: string }) => {
      this.opts.logger?.info({ parser: ctx.error_type, node: ctx.classname }, "youtubei.js parser notice");
    });
  }

  // ---------- clients ----------
  private async createBrowseClient(): Promise<Client> {
    const yt = await Innertube.create({
      client_type: ClientType.MUSIC,
      retrieve_player: false,
      generate_session_locally: true,
      retrieve_innertube_config: false,
      location: this.opts.location,
      lang: this.opts.language,
      user_agent: BROWSER_UA,
      cache: new UniversalCache(false),
    });
    return { yt, createdAt: Date.now() };
  }

  /** Mirrors Zuno's "download" client: real visitorData from a bootstrap, then an attested MUSIC client. */
  private async createStreamClient(): Promise<Client> {
    const boot = await Innertube.create({ generate_session_locally: false, retrieve_player: false, user_agent: BROWSER_UA });
    const visitorData = boot.session.context.client.visitorData;
    const yt = await Innertube.create({
      client_type: ClientType.MUSIC,
      visitor_data: visitorData,
      retrieve_player: true,
      generate_session_locally: true,
      retrieve_innertube_config: false,
      location: this.opts.location,
      lang: this.opts.language,
      user_agent: BROWSER_UA,
      cache: new UniversalCache(false),
    });
    void warmPoToken(BROWSER_UA).catch((e) => this.opts.logger?.warn({ err: String(e) }, "potoken warm failed"));
    return { yt, createdAt: Date.now() };
  }

  private async client(kind: "browse" | "stream"): Promise<Innertube> {
    const slot = kind === "browse" ? "browse" : "stream";
    let p = this[slot];
    if (p) {
      const c = await p.catch(() => null);
      if (c && Date.now() - c.createdAt < CLIENT_MAX_AGE_MS) return c.yt;
    }
    p = (kind === "browse" ? this.createBrowseClient() : this.createStreamClient()).catch((e) => {
      this[slot] = undefined; // don't cache a failed client
      throw e;
    });
    this[slot] = p;
    return (await p).yt;
  }

  // ---------- catalog ----------
  async getHome(opts: { continuation?: string; params?: string } = {}): Promise<BrowsePage> {
    try {
      const yt = await this.client("browse");
      if (opts.continuation) {
        const res: YtNode = await yt.actions.execute("/browse", { client: "YTMUSIC", continuation: decodeCont(opts.continuation), parse: true });
        const cc = res.continuation_contents;
        const shelves = ((cc?.contents ?? []) as YtNode[]).map((x) => toShelf(x)).filter(Boolean) as Shelf[];
        return { title: "Home", chips: [], shelves, continuation: encodeCont(typeof cc?.continuation === "string" ? cc.continuation : undefined) };
      }
      let feed: YtNode = await yt.music.getHomeFeed();
      if (opts.params) {
        const chip = (feed.filters ?? []).find((f: string) => f === opts.params);
        if (chip) feed = await feed.applyFilter(chip);
      }
      const shelves = (feed.sections ?? []).map((sec: YtNode) => toShelf(sec)).filter(Boolean) as Shelf[];
      const page = feed.page;
      const token = page?.continuation_contents?.continuation
        ?? page?.contents_memo?.getType(YTNodes.SectionList)?.find((x: YtNode) => typeof x.continuation === "string")?.continuation;
      return {
        title: "Home",
        chips: (feed.filters ?? []).map((f: string) => ({ title: f, browseId: "FEmusic_home", params: f })),
        shelves,
        continuation: encodeCont(token),
      };
    } catch (e) {
      wrap(e, "home feed");
    }
  }

  async getExplore(): Promise<BrowsePage> {
    try {
      const yt = await this.client("browse");
      const ex: YtNode = await yt.music.getExplore();
      const chips = (ex.top_buttons ?? []).map(toLink).filter(Boolean);
      const shelves = (ex.sections ?? []).map((s: YtNode) => toShelf(s)).filter(Boolean) as Shelf[];
      return { title: "Explore", chips, shelves };
    } catch (e) {
      wrap(e, "explore");
    }
  }

  async getBrowse(browseId: string, params?: string): Promise<BrowsePage> {
    try {
      const yt = await this.client("browse");
      const res: YtNode = await yt.actions.execute("/browse", { browseId, params, client: "YTMUSIC", parse: true });
      const title = text(res?.header?.title) ?? text(res?.header?.header?.title) ?? "";
      const shelves = shelvesFromMemo(res, ["MusicCarouselShelf", "MusicShelf", "Grid", "MusicPlaylistShelf"]);
      // Chip-only feeds (Moods & genres) — Zuno collectBrowseLinksFromMemo.
      if (!shelves.length) {
        const links = (res?.contents_memo?.get("MusicNavigationButton") ?? []).map(toLink).filter(Boolean);
        if (links.length) shelves.push({ id: "chips", title, layout: "chips", items: links.map((link: YtNode) => ({ kind: "link", link })) });
      }
      return { title, chips: [], shelves };
    } catch (e) {
      wrap(e, "browse feed");
    }
  }

  async search(query: string, filter: SearchFilter, continuation?: string): Promise<SearchResults> {
    const empty: SearchResults = { query, filter, tracks: [], videos: [], albums: [], artists: [], playlists: [] };
    try {
      const yt = await this.client("browse");
      let res: YtNode;
      let nextToken: string | undefined;
      if (continuation) {
        const raw: YtNode = await yt.actions.execute("/search", { client: "YTMUSIC", continuation: decodeCont(continuation), parse: true });
        const cc = raw.continuation_contents;
        res = { contents: [{ contents: cc?.contents ?? [] }] };
        nextToken = typeof cc?.continuation === "string" ? cc.continuation : undefined;
      } else {
        res = filter === "all" ? await yt.music.search(query) : await yt.music.search(query, { type: filter });
        if (filter !== "all") nextToken = findContinuationToken(res.contents);
      }
      const out: SearchResults = { ...empty };
      const sections: YtNode[] = Array.isArray(res.contents) ? res.contents : res.contents ? [res.contents] : [];
      const rows: YtNode[] = [];
      for (const s of sections) {
        if (s.type === "MusicCardShelf") {
          const target = findBrowseId(s.on_tap);
          const top = target?.startsWith("UC")
            ? toShelfItem({ ...s, item_type: "artist", id: target })
            : target?.startsWith("MPRE")
              ? toShelfItem({ ...s, item_type: "album", id: target })
              : toShelfItem({ ...s, item_type: "song", endpoint: s.on_tap });
          if (top) out.top = top;
          // Songs inside an artist card omit the artist — it's the card's own.
          const cardArtist = top?.kind === "artist" ? top.artist : undefined;
          for (const c of s.contents ?? []) {
            const tr = cardArtist && (c.item_type === "song" || c.item_type === "video")
              ? toTrack(c, { artist: cardArtist.name, artists: [{ id: cardArtist.id, name: cardArtist.name }] })
              : null;
            if (tr) (tr.isVideo ? out.videos : out.tracks).push(tr);
            else rows.push(c);
          }
        } else {
          rows.push(...(s.contents ?? []));
        }
      }
      for (const it of dedupeItems(rows.map(toShelfItem).filter((x): x is ShelfItem => x !== null))) {
        if (it.kind === "track") (it.track.isVideo ? out.videos : out.tracks).push(it.track);
        else if (it.kind === "album") out.albums.push(it.album);
        else if (it.kind === "artist") out.artists.push(it.artist);
        else if (it.kind === "playlist") out.playlists.push(it.playlist);
      }
      const uniq = <T extends { id: string }>(xs: T[]) => xs.filter((x, i) => xs.findIndex((y) => y.id === x.id) === i);
      out.tracks = uniq(out.tracks); out.videos = uniq(out.videos); out.albums = uniq(out.albums);
      out.artists = uniq(out.artists); out.playlists = uniq(out.playlists);
      out.continuation = filter === "all" ? undefined : encodeCont(nextToken);
      return out;
    } catch (e) {
      wrap(e, "search");
    }
  }

  async suggestions(query: string): Promise<{ queries: string[]; items: ShelfItem[] }> {
    try {
      const yt = await this.client("browse");
      const sections: YtNode[] = await yt.music.getSearchSuggestions(query);
      const queries: string[] = [];
      const items: ShelfItem[] = [];
      for (const s of sections) {
        for (const c of s.contents ?? []) {
          if (c.type === "SearchSuggestion") { const q = text(c.suggestion); if (q) queries.push(q); }
          else { const it = toShelfItem(c); if (it) items.push(it); }
        }
      }
      return { queries: queries.slice(0, 8), items: items.slice(0, 6) };
    } catch (e) {
      wrap(e, "search suggestions");
    }
  }

  async getTrack(id: string): Promise<TrackDetail> {
    if (!isVideoId(id)) throw new AppError(ErrorCode.BadRequest, "Invalid track id", 400);
    try {
      const yt = await this.client("browse");
      const [info, upNext] = await Promise.all([
        yt.music.getInfo(id) as Promise<YtNode>,
        (yt.music.getUpNext(id, false) as Promise<YtNode>).catch(() => null),
      ]);
      const panel = upNext?.contents?.find((c: YtNode) => c?.video_id === id) ?? upNext?.contents?.[0];
      const basic = info?.basic_info ?? {};
      const fromPanel = panel ? toTrack(panel) : null;
      const track: Track = fromPanel ?? {
        id,
        provider: "youtube",
        title: basic.title ?? "Unknown title",
        artist: basic.author ?? "Unknown artist",
        durationSec: basic.duration,
        artworkUrl: bestArtwork(basic.thumbnail),
      };
      if (!track.durationSec && basic.duration) track.durationSec = basic.duration;
      return { track, description: basic.short_description, related: [] };
    } catch (e) {
      wrap(e, "track");
    }
  }

  async getAlbum(id: string): Promise<AlbumPage> {
    try {
      const yt = await this.client("browse");
      const a: YtNode = await yt.music.getAlbum(id);
      const h = a.header ?? {};
      const subtitle = text(h.subtitle) ?? "";
      const parts = subtitle.split(" • ");
      const artistRefs = artistsOf({ subtitle: h.strapline_text_one, artists: undefined }) ?? artistsOf(h);
      const artist = text(h.strapline_text_one) ?? artistLine(h, artistRefs);
      const artworkUrl = bestArtwork(h.thumbnail);
      const playlistId = findPlaylistId(a.contents?.[0]?.endpoint, "OLAK5uy_") ?? (a.url?.match(/list=([\w-]+)/)?.[1]);
      const kind = parts[0]?.toLowerCase();
      const album = {
        id, provider: "youtube" as const, title: text(h.title) ?? "Album", artist, artists: artistRefs, artworkUrl,
        year: parts.find((p: string) => /^\d{4}$/.test(p.trim()))?.trim(),
        releaseType: (kind === "single" ? "single" : kind === "ep" ? "ep" : "album") as "single" | "ep" | "album",
        playlistId,
      };
      const tracks = (a.contents ?? [])
        .map((t: YtNode) => toTrack(t, { artist, artists: artistRefs, album: album.title, albumId: id, artworkUrl }))
        .filter(Boolean)
        // Album rows carry the album's own art, not a per-video thumbnail.
        .map((t: Track) => ({ ...t, artworkUrl, album: album.title, albumId: id, isVideo: undefined }));
      const totalDurationSec = tracks.reduce((s: number, t: Track) => s + (t.durationSec ?? 0), 0) || undefined;
      const otherVersions = (a.sections ?? []).flatMap((s: YtNode) => (s.contents ?? []).map(toAlbum).filter(Boolean));
      return {
        album, tracks, totalDurationSec, otherVersions,
        subtitle: text(h.second_subtitle),
        description: text(h.description?.description) ?? text(h.description),
      };
    } catch (e) {
      wrap(e, "album");
    }
  }

  async getArtist(id: string): Promise<ArtistPage> {
    try {
      const yt = await this.client("browse");
      const a: YtNode = await yt.music.getArtist(id);
      const h = a.header ?? {};
      if (!text(h.title)) throw new AppError(ErrorCode.NotFound, "artist not found", 404);
      const artist = {
        id, provider: "youtube" as const, name: text(h.title) ?? "Artist",
        artworkUrl: bestArtwork(h.thumbnail), subscriberCount: text(h.subscription_button?.subscriber_count) ?? text(h.subtitle),
      };
      const shelves: Shelf[] = [];
      let topTracks: Track[] = [];
      for (const s of a.sections ?? []) {
        if (s.type === "MusicShelf" && !topTracks.length) {
          topTracks = (s.contents ?? []).map((t: YtNode) => toTrack(t)).filter(Boolean);
          continue;
        }
        const shelf = toShelf(s);
        if (shelf) shelves.push(shelf);
      }
      return {
        artist,
        description: text(h.description),
        bannerUrl: bestArtwork(h.thumbnail),
        topTracks,
        shelves,
        radioPlaylistId: findPlaylistId(h.start_radio_button),
        shufflePlaylistId: findPlaylistId(h.play_button),
      };
    } catch (e) {
      wrap(e, "artist");
    }
  }

  async getPlaylist(id: string, continuation?: string): Promise<PlaylistPage> {
    try {
      const yt = await this.client("browse");
      if (continuation) {
        const raw: YtNode = await yt.actions.execute("/browse", { client: "YTMUSIC", continuation: decodeCont(continuation), parse: true });
        const items: YtNode[] = raw.continuation_contents?.contents
          ?? raw.on_response_received_actions?.flatMap((a: YtNode) => a?.contents ?? []) ?? [];
        const tracks = items.map((t: YtNode) => toTrack(t)).filter(Boolean) as Track[];
        const next = raw.continuation_contents?.continuation ?? findContinuationToken(items.filter((x: YtNode) => x?.type === "ContinuationItem"));
        return {
          playlist: { id: normPlaylistId(id), provider: "youtube", title: "", owner: "" },
          tracks,
          continuation: encodeCont(typeof next === "string" ? next : undefined),
        };
      }
      const p: YtNode = await yt.music.getPlaylist(normPlaylistId(id));
      const h = p.header ?? {};
      const items: YtNode[] = p.items ?? p.contents ?? [];
      if (!text(h.title) && !items.length) throw new AppError(ErrorCode.NotFound, "playlist not found", 404);
      const tracks = items.map((t: YtNode) => toTrack(t)).filter(Boolean) as Track[];
      const sub = text(h.subtitle) ?? "";
      const strap = text(h.strapline_text_one);
      const owner = (strap && strap !== "N/A" ? strap : undefined)
        ?? sub.split(" • ").find((x) => x && !/^playlist$/i.test(x) && !/^\d{4}$/.test(x))
        ?? "YouTube Music";
      const shelf = p.page?.contents_memo?.getType(YTNodes.MusicPlaylistShelf)?.[0];
      const token = (typeof shelf?.continuation === "string" ? shelf.continuation : undefined)
        ?? findContinuationToken(items.filter((x: YtNode) => x?.type === "ContinuationItem"));
      return {
        playlist: {
          id: normPlaylistId(id), provider: "youtube", title: text(h.title) ?? "Playlist", owner,
          description: text(h.description?.description) ?? text(h.description),
          artworkUrl: bestArtwork(h.thumbnail), trackCountText: text(h.second_subtitle)?.split(" • ")[0],
        },
        tracks,
        totalDurationSec: tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0) || undefined,
        continuation: encodeCont(token),
      };
    } catch (e) {
      wrap(e, "playlist");
    }
  }

  async getRadio(seed: { trackId?: string; playlistId?: string; params?: string }, continuation?: string): Promise<RadioResult> {
    if (!continuation && !seed.trackId && !seed.playlistId) {
      throw new AppError(ErrorCode.BadRequest, "Radio needs a track or playlist seed", 400);
    }
    try {
      const yt = await this.client("browse");
      // Raw /next so playlist seeds, params (shuffle/radio) and continuations all work.
      const payload: Record<string, unknown> = continuation
        ? { continuation: Buffer.from(continuation, "base64url").toString() }
        : {
            videoId: seed.trackId,
            playlistId: seed.playlistId ? normPlaylistId(seed.playlistId) : seed.trackId ? `RDAMVM${seed.trackId}` : undefined,
            params: seed.params ?? (seed.trackId && !seed.playlistId ? "wAEB" : undefined),
            isAudioOnly: true,
          };
      const res: YtNode = await yt.actions.execute("/next", { ...payload, client: "YTMUSIC", parse: true });
      const panel: YtNode = res.contents_memo?.getType(YTNodes.PlaylistPanel)?.[0] ?? res.continuation_contents;
      const tracks = (panel?.contents ?? [])
        .map((c: YtNode) => toTrack(c?.primary ?? c))
        .filter(Boolean) as Track[];
      const next = typeof panel?.continuation === "string" ? panel.continuation : undefined;
      return {
        tracks,
        continuation: next ? Buffer.from(next).toString("base64url") : undefined,
        playlistId: panel?.playlist_id,
      };
    } catch (e) {
      wrap(e, "radio");
    }
  }

  async getRelated(trackId: string): Promise<Shelf[]> {
    try {
      const yt = await this.client("browse");
      const r: YtNode = await yt.music.getRelated(trackId);
      const sections: YtNode[] = Array.isArray(r) ? r : r?.contents ?? [];
      return sections.map((s) => toShelf(s)).filter(Boolean) as Shelf[];
    } catch (e) {
      wrap(e, "related");
    }
  }

  /** Synced lyrics from LRCLIB first, then YouTube Music's own (plain, licensed via LyricFind). */
  async getLyrics(track: Track): Promise<Lyrics | null> {
    const synced = await lrclibLyrics(track).catch(() => null);
    if (synced) return synced;
    try {
      const yt = await this.client("browse");
      const l: YtNode = await yt.music.getLyrics(track.id);
      const body = text(l?.description);
      if (!body) return null;
      return {
        lines: body.split(/\r?\n/).map((line) => ({ text: line })),
        timing: "none",
        source: "YouTube Music",
        attribution: text(l?.footer),
      };
    } catch {
      return null; // "no lyrics" is a normal outcome, not an error
    }
  }

  // ---------- playback ----------
  async resolveStream(trackId: string, opts: StreamOptions): Promise<StreamSource> {
    if (!isVideoId(trackId)) throw new AppError(ErrorCode.BadRequest, "Invalid track id", 400);
    const key = `${trackId}:${opts.quality}:${opts.preferMp4 ? "mp4" : "any"}`;
    const hit = this.streams.get(key);
    if (hit && hit.expiresAt - Date.now() > 5 * 60 * 1000) return hit;
    return this.flights.run(key, async () => {
      const src = await this.streamLock.run(() => this.resolveLocked(trackId, opts));
      this.streams.set(key, src, Math.max(src.expiresAt - Date.now() - 5 * 60 * 1000, 60_000));
      return src;
    });
  }

  /** Forget a cached stream (e.g. upstream answered 403) so the next request re-resolves. */
  invalidateStream(trackId: string): void {
    for (const q of ["auto", "low", "normal", "high"]) for (const m of ["mp4", "any"]) this.streams.delete(`${trackId}:${q}:${m}`);
  }

  private async resolveLocked(trackId: string, opts: StreamOptions): Promise<StreamSource> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const yt = await this.client("stream");
        const po = await mintPoToken(trackId, BROWSER_UA);
        // decipher() reads po_token from the session — hence the mutex around this whole block.
        (yt.session as YtNode).po_token = po;
        if (yt.session.player) (yt.session.player as YtNode).po_token = po;
        const info: YtNode = await yt.getBasicInfo(trackId, { po_token: po } as never);
        const status = info?.playability_status?.status;
        if (status && status !== "OK") {
          throw new AppError(ErrorCode.TrackUnavailable, info?.playability_status?.reason ?? "This track can't be played", 422);
        }
        const audio: YtNode[] = (info?.streaming_data?.adaptive_formats ?? []).filter((f: YtNode) => typeof f.mime_type === "string" && f.mime_type.startsWith("audio/"));
        const fmt = pickFormat(audio, opts);
        if (!fmt) throw new AppError(ErrorCode.TrackUnavailable, "No playable audio format", 422);
        const url: string = await fmt.decipher(yt.session.player);
        const expire = Number(new URL(url).searchParams.get("expire")) * 1000;
        return {
          kind: "http",
          url,
          mimeType: String(fmt.mime_type),
          contentLength: Number(fmt.content_length),
          bitrate: fmt.bitrate,
          durationSec: info?.basic_info?.duration,
          headers: MEDIA_HEADERS,
          expiresAt: Number.isFinite(expire) && expire > 0 ? expire : Date.now() + 5 * 60 * 60 * 1000,
          maxChunkBytes: 1024 * 1024 * 4,
        };
      } catch (e) {
        lastErr = e;
        if (e instanceof AppError && e.code === ErrorCode.TrackUnavailable) throw e;
        this.opts.logger?.warn({ trackId, attempt, err: e instanceof Error ? e.message : String(e) }, "stream resolve failed");
        this.stream = undefined; // rebuild the client on retry
      }
    }
    wrap(lastErr, "audio stream");
  }

  async health() {
    try {
      await this.client("browse");
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** Format choice (Zuno audioQuality.ts): AAC preferred for compatibility, Opus allowed for "high". */
export function pickFormat(audio: YtNode[], opts: StreamOptions): YtNode | undefined {
  if (!audio.length) return undefined;
  const allMp4 = audio.filter((f) => String(f.mime_type).includes("audio/mp4"));
  // Avoid HE-AAC (mp4a.40.5 / 40.29) when plain AAC-LC exists: Safari mis-reads HE-AAC streams
  // (implicit SBR) and reports about twice the real duration, in the app and on the lock screen.
  const lc = allMp4.filter((f) => !/mp4a\.40\.(5|29)/.test(String(f.mime_type)));
  const mp4 = opts.preferMp4 && lc.length ? lc : allMp4; // Safari only; HE-AAC is fine elsewhere
  const pool = opts.preferMp4 && mp4.length ? mp4 : opts.quality === "high" || !mp4.length ? audio : mp4;
  const byRate = [...pool].sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0));
  const target = opts.quality === "low" ? 64_000 : opts.quality === "normal" ? 128_000 : Infinity;
  if (target === Infinity) return byRate[byRate.length - 1];
  return byRate.reduce((best, f) => (Math.abs((f.bitrate ?? 0) - target) < Math.abs((best.bitrate ?? 0) - target) ? f : best));
}
