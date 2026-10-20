import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { MusicProvider } from "@zuno/provider";
import {
  AlbumPage, ArtistPage, BrowsePage, Lyrics, PlaylistPage, SearchFilter, SearchResults, ShelfItem, Shelf, TrackDetail,
  AppError, ErrorCode,
} from "@zuno/core";

const Id = z.string().min(1).max(200).regex(/^[\w-]+$/, "invalid id");
const Cont = z.string().min(1).max(4000).optional();

/** Cache TTLs (seconds). Catalog pages change slowly; feeds faster. */
const TTL = {
  home: { ttlSec: 600, staleSec: 1800 },
  explore: { ttlSec: 1800, staleSec: 3600 },
  browse: { ttlSec: 3600, staleSec: 3600 * 6 },
  search: { ttlSec: 600, staleSec: 1800 },
  suggest: { ttlSec: 3600, staleSec: 3600 },
  track: { ttlSec: 6 * 3600, staleSec: 24 * 3600 },
  album: { ttlSec: 24 * 3600, staleSec: 7 * 24 * 3600 },
  artist: { ttlSec: 6 * 3600, staleSec: 24 * 3600 },
  playlist: { ttlSec: 1800, staleSec: 6 * 3600 },
  related: { ttlSec: 6 * 3600, staleSec: 24 * 3600 },
  lyrics: { ttlSec: 7 * 24 * 3600, staleSec: 7 * 24 * 3600 },
} as const;

export async function catalogRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { cache, config } = app.ctx;
  /** Cache namespace: the request's music source + region (sources never share cached pages). */
  const regionOf = (p: MusicProvider) => `${p.source ?? p.id}:${config.YT_LOCATION}:${config.YT_LANGUAGE}`;
  const publicCache = (seconds: number) => `public, max-age=${seconds}, stale-while-revalidate=${seconds * 4}`;

  r.get("/api/v1/home", {
    schema: { tags: ["catalog"], querystring: z.object({ continuation: Cont, chip: z.string().max(80).optional() }), response: { 200: BrowsePage } },
  }, async (req, reply) => {
    const provider = req.catalog; const region = regionOf(provider);
    const { continuation, chip } = req.query;
    // Continuations reference live provider state; never cache them.
    if (continuation) return provider.getHome({ continuation });
    reply.header("Cache-Control", publicCache(120));
    return cache.get(`home:${region}:${chip ?? ""}`, TTL.home, () => provider.getHome({ params: chip }));
  });

  r.get("/api/v1/explore", { schema: { tags: ["catalog"], response: { 200: BrowsePage } } }, async (req, reply) => {
    const provider = req.catalog; const region = regionOf(provider);
    reply.header("Cache-Control", publicCache(300));
    return cache.get(`explore:${region}`, TTL.explore, () => provider.getExplore());
  });

  r.get("/api/v1/browse/:browseId", {
    schema: { tags: ["catalog"], params: z.object({ browseId: Id }), querystring: z.object({ params: z.string().max(500).regex(/^[\w%=-]*$/).optional() }), response: { 200: BrowsePage } },
  }, async (req, reply) => {
    const provider = req.catalog; const region = regionOf(provider);
    reply.header("Cache-Control", publicCache(300));
    const { browseId } = req.params;
    if (!browseId.startsWith("FEmusic_") && provider.id === "youtube") throw new AppError(ErrorCode.BadRequest, "Unsupported browse id", 400);
    return cache.get(`browse:${region}:${browseId}:${req.query.params ?? ""}`, TTL.browse, () => provider.getBrowse(browseId, req.query.params));
  });

  r.get("/api/v1/search", {
    schema: {
      tags: ["catalog"],
      querystring: z.object({ q: z.string().trim().min(1).max(200), filter: SearchFilter.default("all"), continuation: Cont }),
      response: { 200: SearchResults },
    },
  }, async (req) => {
    const provider = req.catalog; const region = regionOf(provider);
    const { q, filter, continuation } = req.query;
    if (continuation) return provider.search(q, filter, continuation);
    const key = q.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");
    return cache.get(`search:${region}:${filter}:${key}`, TTL.search, () => provider.search(q, filter));
  });

  r.get("/api/v1/search/suggestions", {
    schema: { tags: ["catalog"], querystring: z.object({ q: z.string().trim().min(1).max(100) }), response: { 200: z.object({ queries: z.array(z.string()), items: z.array(ShelfItem) }) } },
  }, async (req, reply) => {
    const provider = req.catalog; const region = regionOf(provider);
    reply.header("Cache-Control", publicCache(600));
    const key = req.query.q.normalize("NFKC").toLocaleLowerCase();
    return cache.get(`suggest:${region}:${key}`, TTL.suggest, () => provider.suggestions(req.query.q));
  });

  r.get("/api/v1/tracks/:id", { schema: { tags: ["catalog"], params: z.object({ id: Id }), response: { 200: TrackDetail } } }, async (req, reply) => {
    const provider = req.catalog; const region = regionOf(provider);
    reply.header("Cache-Control", publicCache(3600));
    return cache.get(`track:${region}:${req.params.id}`, TTL.track, () => provider.getTrack(req.params.id));
  });

  r.get("/api/v1/tracks/:id/related", { schema: { tags: ["catalog"], params: z.object({ id: Id }), response: { 200: z.object({ shelves: z.array(Shelf) }) } } }, async (req) => ({
    shelves: await cache.get(`related:${regionOf(req.catalog)}:${req.params.id}`, TTL.related, () => req.catalog.getRelated(req.params.id)),
  }));

  r.get("/api/v1/tracks/:id/lyrics", { schema: { tags: ["catalog"], params: z.object({ id: Id }), response: { 200: z.object({ lyrics: Lyrics.nullable() }) } } }, async (req, reply) => {
    const provider = req.catalog; const region = regionOf(provider);
    if (!provider.getLyrics) return { lyrics: null };
    reply.header("Cache-Control", publicCache(86400));
    const lyrics = await cache.get(`lyrics:${region}:${req.params.id}`, TTL.lyrics, async () => {
      const { track } = await cache.get(`track:${region}:${req.params.id}`, TTL.track, () => provider.getTrack(req.params.id));
      return provider.getLyrics!(track);
    });
    return { lyrics };
  });

  r.get("/api/v1/albums/:id", { schema: { tags: ["catalog"], params: z.object({ id: Id }), response: { 200: AlbumPage } } }, async (req, reply) => {
    const provider = req.catalog; const region = regionOf(provider);
    reply.header("Cache-Control", publicCache(3600));
    return cache.get(`album:${region}:${req.params.id}`, TTL.album, () => provider.getAlbum(req.params.id));
  });

  r.get("/api/v1/artists/:id", { schema: { tags: ["catalog"], params: z.object({ id: Id }), response: { 200: ArtistPage } } }, async (req, reply) => {
    const provider = req.catalog; const region = regionOf(provider);
    reply.header("Cache-Control", publicCache(1800));
    return cache.get(`artist:${region}:${req.params.id}`, TTL.artist, () => provider.getArtist(req.params.id));
  });

  r.get("/api/v1/playlists/:id", {
    schema: { tags: ["catalog"], params: z.object({ id: Id }), querystring: z.object({ continuation: Cont }), response: { 200: PlaylistPage } },
  }, async (req) => {
    const provider = req.catalog; const region = regionOf(provider);
    // Generated mixes ("<Artist> Mix") are radio playlists: RDAMVM + seed video id.
    const mix = /^RDAMVM([\w-]{11})$/.exec(req.params.id);
    if (mix) {
      const radio = await cache.get(`radio:${region}:${mix[1]}`, TTL.playlist, () => provider.getRadio({ trackId: mix[1] }));
      const seed = radio.tracks[0];
      return {
        playlist: { id: req.params.id, provider: provider.id, title: seed ? `${seed.artist} Mix` : "Mix", owner: "Made for you", artworkUrl: seed?.artworkUrl },
        tracks: radio.tracks,
        totalDurationSec: radio.tracks.reduce((s, t) => s + (t.durationSec ?? 0), 0) || undefined,
      };
    }
    if (req.query.continuation) return provider.getPlaylist(req.params.id, req.query.continuation);
    return cache.get(`playlist:${region}:${req.params.id}`, TTL.playlist, () => provider.getPlaylist(req.params.id));
  });

  r.get("/api/v1/radio", {
    schema: {
      tags: ["catalog"],
      querystring: z.object({ trackId: Id.optional(), playlistId: Id.optional(), params: z.string().max(200).optional(), continuation: Cont })
        .refine((q) => q.trackId || q.playlistId || q.continuation, "trackId, playlistId or continuation required"),
      response: { 200: z.object({ tracks: z.array(z.any()), continuation: z.string().optional(), playlistId: z.string().optional() }) },
    },
  }, async (req) => {
    const provider = req.catalog; const region = regionOf(provider);
    const { trackId, playlistId, params, continuation } = req.query;
    return provider.getRadio({ trackId, playlistId, params }, continuation);
  });
}
