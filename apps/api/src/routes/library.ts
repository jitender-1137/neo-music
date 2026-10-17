import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { Album, Artist, Playlist, Track, AppError, ErrorCode } from "@zuno/core";
import {
  idempotencyKeys, listeningHistory, playlistTracks, playlists, searchHistory, userFollowedArtists, userLikes,
  userSavedAlbums, userSavedPlaylists,
} from "../db/schema";
import { requireUser } from "../plugins/auth";
import { ensureSnapshots, type Kind } from "../lib/snapshots";

const Id = z.string().min(1).max(200).regex(/^[\w-]+$/);
const PAGE = 50;

const TABLES = {
  likes: { table: userLikes, kind: "track" },
  albums: { table: userSavedAlbums, kind: "album" },
  artists: { table: userFollowedArtists, kind: "artist" },
  playlists: { table: userSavedPlaylists, kind: "playlist" },
} as const;
type Collection = keyof typeof TABLES;

/** Opaque cursor = base64url("<iso>|<itemId>") over (createdAt desc, itemId desc). */
const encodeCursor = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
function decodeCursor(c?: string): { at: Date; id: string } | null {
  if (!c) return null;
  const [iso, id] = Buffer.from(c, "base64url").toString().split("|");
  const at = new Date(iso ?? "");
  if (!id || Number.isNaN(at.getTime())) throw new AppError(ErrorCode.BadRequest, "Bad cursor", 400);
  return { at, id };
}

export async function libraryRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const ctx = app.ctx;
  const { db, provider } = ctx;
  const noStore = { "Cache-Control": "private, no-store" };

  async function list(collection: Collection, userId: string, cursor?: string) {
    const { table, kind } = TABLES[collection];
    const c = decodeCursor(cursor);
    const rows = await db.select().from(table)
      .where(and(eq(table.userId, userId), eq(table.provider, provider.id),
        c ? or(lt(table.createdAt, c.at), and(eq(table.createdAt, c.at), lt(table.itemId, c.id))) : undefined))
      .orderBy(desc(table.createdAt), desc(table.itemId)).limit(PAGE + 1);
    const page = rows.slice(0, PAGE);
    const snaps = await ensureSnapshots(ctx, kind as Kind, page.map((x) => x.itemId));
    return {
      items: page.map((x) => snaps.get(x.itemId)).filter(Boolean),
      nextCursor: rows.length > PAGE ? encodeCursor(page.at(-1)!.createdAt, page.at(-1)!.itemId) : undefined,
    };
  }

  const ItemSchemas = { likes: Track, albums: Album, artists: Artist, playlists: Playlist } as const;
  for (const collection of Object.keys(TABLES) as Collection[]) {
    const { table } = TABLES[collection];
    r.get(`/api/v1/library/${collection}`, {
      schema: { tags: ["library"], querystring: z.object({ cursor: z.string().max(200).optional() }), response: { 200: z.object({ items: z.array(ItemSchemas[collection]), nextCursor: z.string().optional() }) } },
    }, async (req, reply) => {
      reply.headers(noStore);
      return list(collection, requireUser(req), req.query.cursor) as never;
    });
    r.put(`/api/v1/library/${collection}/:id`, { schema: { tags: ["library"], params: z.object({ id: Id }) } }, async (req) => {
      const userId = requireUser(req);
      const snaps = await ensureSnapshots(ctx, TABLES[collection].kind as Kind, [req.params.id]);
      if (!snaps.has(req.params.id)) throw new AppError(ErrorCode.NotFound, "That item isn't available", 404);
      await db.insert(table).values({ userId, provider: provider.id, itemId: req.params.id }).onConflictDoNothing();
      return { ok: true, saved: true };
    });
    r.delete(`/api/v1/library/${collection}/:id`, { schema: { tags: ["library"], params: z.object({ id: Id }) } }, async (req) => {
      const userId = requireUser(req);
      await db.delete(table).where(and(eq(table.userId, userId), eq(table.provider, provider.id), eq(table.itemId, req.params.id)));
      return { ok: true, saved: false };
    });
  }

  /** Which of these ids are in the user's library — drives heart/save icons in lists. */
  r.get("/api/v1/library/status", {
    schema: { tags: ["library"], querystring: z.object({ ids: z.string().max(5000) }), response: { 200: z.object({ likes: z.array(z.string()), albums: z.array(z.string()), artists: z.array(z.string()), playlists: z.array(z.string()) }) } },
  }, async (req, reply) => {
    reply.headers(noStore);
    const empty = { likes: [], albums: [], artists: [], playlists: [] };
    if (!req.userId) return empty;
    const ids = [...new Set(req.query.ids.split(",").filter((x) => /^[\w-]{1,200}$/.test(x)))].slice(0, 200);
    if (!ids.length) return empty;
    const pick = async (c: Collection) => {
      const { table } = TABLES[c];
      return (await db.select({ id: table.itemId }).from(table).where(and(eq(table.userId, req.userId!), eq(table.provider, provider.id), inArray(table.itemId, ids)))).map((x) => x.id);
    };
    const [likes, albums, artists, pls] = await Promise.all([pick("likes"), pick("albums"), pick("artists"), pick("playlists")]);
    return { likes, albums, artists, playlists: pls };
  });

  r.get("/api/v1/library", { schema: { tags: ["library"] } }, async (req, reply) => {
    reply.headers(noStore);
    const userId = requireUser(req);
    const count = async (t: typeof userLikes) => (await db.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.userId, userId)))[0]!.n;
    const [likes, albums, artists, saved, own] = await Promise.all([
      count(userLikes), count(userSavedAlbums), count(userFollowedArtists), count(userSavedPlaylists),
      db.select({ n: sql<number>`count(*)::int` }).from(playlists).where(eq(playlists.ownerId, userId)).then((x) => x[0]!.n),
    ]);
    return { counts: { likes, albums, artists, savedPlaylists: saved, playlists: own } };
  });

  // ---------- history ----------
  r.get("/api/v1/history", {
    schema: { tags: ["library"], querystring: z.object({ cursor: z.coerce.number().int().positive().optional() }), response: { 200: z.object({ items: z.array(z.object({ playedAt: z.string(), track: Track })), nextCursor: z.number().optional() }) } },
  }, async (req, reply) => {
    reply.headers(noStore);
    const userId = requireUser(req);
    const rows = await db.select().from(listeningHistory)
      .where(and(eq(listeningHistory.userId, userId), req.query.cursor ? lt(listeningHistory.id, req.query.cursor) : undefined))
      .orderBy(desc(listeningHistory.id)).limit(PAGE + 1);
    const page = rows.slice(0, PAGE);
    const snaps = await ensureSnapshots(ctx, "track", page.map((x) => x.trackId));
    return {
      items: page.filter((x) => snaps.has(x.trackId)).map((x) => ({ playedAt: x.playedAt.toISOString(), track: snaps.get(x.trackId)! })),
      nextCursor: rows.length > PAGE ? page.at(-1)!.id : undefined,
    };
  });

  r.delete("/api/v1/history", { schema: { tags: ["library"] } }, async (req) => {
    const userId = requireUser(req);
    await db.delete(listeningHistory).where(eq(listeningHistory.userId, userId));
    return { ok: true };
  });

  r.get("/api/v1/search/history", { schema: { tags: ["library"], response: { 200: z.object({ queries: z.array(z.string()) }) } } }, async (req, reply) => {
    reply.headers(noStore);
    if (!req.userId) return { queries: [] };
    const rows = await db.select().from(searchHistory).where(eq(searchHistory.userId, req.userId)).orderBy(desc(searchHistory.searchedAt)).limit(20);
    return { queries: rows.map((x) => x.query) };
  });
  r.delete("/api/v1/search/history", { schema: { tags: ["library"], querystring: z.object({ q: z.string().max(200).optional() }) } }, async (req) => {
    const userId = requireUser(req);
    await db.delete(searchHistory).where(and(eq(searchHistory.userId, userId), req.query.q ? eq(searchHistory.query, req.query.q) : undefined));
    return { ok: true };
  });

  // ---------- guest → account migration ----------
  const ImportBody = z.object({
    idempotencyKey: z.string().uuid(),
    likes: z.array(Id).max(5000).default([]),
    albums: z.array(Id).max(2000).default([]),
    artists: z.array(Id).max(2000).default([]),
    savedPlaylists: z.array(Id).max(2000).default([]),
    playlists: z.array(z.object({ localId: z.string().max(100), title: z.string().trim().min(1).max(150), description: z.string().max(5000).default(""), trackIds: z.array(Id).max(5000) })).max(200).default([]),
    history: z.array(z.object({ trackId: Id, playedAt: z.string().datetime(), eventId: z.string().uuid() })).max(2000).default([]),
  });
  const ImportResult = z.object({ imported: z.object({ likes: z.number(), albums: z.number(), artists: z.number(), savedPlaylists: z.number(), playlists: z.number(), history: z.number() }), playlistIds: z.record(z.string(), z.string()) });

  r.post("/api/v1/library/import", { schema: { tags: ["library"], body: ImportBody, response: { 200: ImportResult } }, config: { rateLimit: { max: app.ctx.config.AUTH_RATE_LIMIT_PER_MIN, timeWindow: "1 minute" } } }, async (req) => {
    const userId = requireUser(req);
    const body = req.body;
    const route = "library.import";
    const prior = await db.query.idempotencyKeys.findFirst({ where: and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, body.idempotencyKey)) });
    if (prior) return prior.response as z.infer<typeof ImportResult>; // retry-safe: same answer, no duplicates

    // Snapshots first (network), outside the transaction. Unavailable ids are dropped.
    const [t, al, ar, pl] = await Promise.all([
      ensureSnapshots(ctx, "track", [...body.likes, ...body.playlists.flatMap((p) => p.trackIds), ...body.history.map((h) => h.trackId)]),
      ensureSnapshots(ctx, "album", body.albums),
      ensureSnapshots(ctx, "artist", body.artists),
      ensureSnapshots(ctx, "playlist", body.savedPlaylists),
    ]);
    const result = await db.transaction(async (tx) => {
      const ins = async (table: typeof userLikes, ids: string[], ok: Map<string, unknown>) => {
        const rows = [...new Set(ids)].filter((id) => ok.has(id)).map((itemId) => ({ userId, provider: provider.id, itemId }));
        if (!rows.length) return 0;
        return (await tx.insert(table).values(rows).onConflictDoNothing().returning()).length;
      };
      const likes = await ins(userLikes, body.likes, t);
      const albums = await ins(userSavedAlbums, body.albums, al);
      const artists = await ins(userFollowedArtists, body.artists, ar);
      const savedPlaylists = await ins(userSavedPlaylists, body.savedPlaylists, pl);
      const playlistIds: Record<string, string> = {};
      for (const p of body.playlists) {
        const [created] = await tx.insert(playlists).values({ ownerId: userId, title: p.title, description: p.description }).returning({ id: playlists.id });
        playlistIds[p.localId] = created!.id;
        const tracks = p.trackIds.filter((id) => t.has(id));
        if (tracks.length) await tx.insert(playlistTracks).values(tracks.map((trackId, position) => ({ playlistId: created!.id, provider: provider.id, trackId, position })));
      }
      const hist = body.history.filter((h) => t.has(h.trackId));
      const history = hist.length
        ? (await tx.insert(listeningHistory).values(hist.map((h) => ({ userId, provider: provider.id, trackId: h.trackId, eventId: h.eventId, playedAt: new Date(h.playedAt) }))).onConflictDoNothing().returning()).length
        : 0;
      const response = { imported: { likes, albums, artists, savedPlaylists, playlists: body.playlists.length, history }, playlistIds };
      await tx.insert(idempotencyKeys).values({ userId, key: body.idempotencyKey, route, status: 200, response });
      return response;
    });
    return result;
  });
}
