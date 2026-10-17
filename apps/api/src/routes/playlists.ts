import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, asc, desc, eq, gt, gte, lt, lte, sql } from "drizzle-orm";
import { AppError, ErrorCode, Track } from "@zuno/core";
import { playlistTracks, playlists } from "../db/schema";
import { requireUser } from "../plugins/auth";
import { ensureSnapshots } from "../lib/snapshots";

const Id = z.string().min(1).max(200).regex(/^[\w-]+$/);
const Uuid = z.string().uuid();
const Visibility = z.enum(["private", "unlisted", "public"]);
const MAX_TRACKS = 5000;

const Summary = z.object({
  id: z.string(), title: z.string(), description: z.string(), visibility: Visibility, version: z.number(),
  trackCount: z.number(), ownerId: z.string(), isOwner: z.boolean(), updatedAt: z.string(), artworkUrls: z.array(z.string()),
});
const Entry = z.object({ entryId: z.string(), position: z.number(), addedAt: z.string(), track: Track.nullable() });

export async function playlistRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const ctx = app.ctx;
  const { db, provider } = ctx;

  async function loadOwned(id: string, userId: string, tx = db) {
    const [p] = await tx.select().from(playlists).where(eq(playlists.id, id)).for("update");
    if (!p || p.ownerId !== userId) throw new AppError(ErrorCode.NotFound, "Playlist not found", 404);
    return p;
  }

  async function summarize(rows: (typeof playlists.$inferSelect)[], userId: string | null) {
    if (!rows.length) return [];
    const ids = rows.map((p) => p.id);
    const counts = await db.select({ id: playlistTracks.playlistId, n: sql<number>`count(*)::int` }).from(playlistTracks)
      .where(sql`${playlistTracks.playlistId} in ${ids}`).groupBy(playlistTracks.playlistId);
    const firsts = await db.select().from(playlistTracks).where(and(sql`${playlistTracks.playlistId} in ${ids}`, lt(playlistTracks.position, 4)));
    const snaps = await ensureSnapshots(ctx, "track", firsts.map((f) => f.trackId));
    return rows.map((p) => ({
      id: p.id, title: p.title, description: p.description, visibility: p.visibility, version: p.version,
      trackCount: counts.find((c) => c.id === p.id)?.n ?? 0, ownerId: p.ownerId, isOwner: p.ownerId === userId,
      updatedAt: p.updatedAt.toISOString(),
      artworkUrls: firsts.filter((f) => f.playlistId === p.id).sort((a, b) => a.position - b.position)
        .map((f) => snaps.get(f.trackId)?.artworkUrl).filter((u): u is string => Boolean(u)),
    }));
  }

  r.get("/api/v1/me/playlists", { schema: { tags: ["playlists"], response: { 200: z.object({ items: z.array(Summary) }) } } }, async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const userId = requireUser(req);
    const rows = await db.select().from(playlists).where(eq(playlists.ownerId, userId)).orderBy(desc(playlists.updatedAt));
    return { items: await summarize(rows, userId) };
  });

  r.post("/api/v1/me/playlists", {
    schema: { tags: ["playlists"], body: z.object({ title: z.string().trim().min(1).max(150), description: z.string().max(5000).default(""), visibility: Visibility.default("private"), trackIds: z.array(Id).max(500).default([]) }), response: { 200: Summary } },
  }, async (req) => {
    const userId = requireUser(req);
    const snaps = await ensureSnapshots(ctx, "track", req.body.trackIds);
    const p = await db.transaction(async (tx) => {
      const [created] = await tx.insert(playlists).values({ ownerId: userId, title: req.body.title, description: req.body.description, visibility: req.body.visibility }).returning();
      const ids = req.body.trackIds.filter((id) => snaps.has(id));
      if (ids.length) await tx.insert(playlistTracks).values(ids.map((trackId, position) => ({ playlistId: created!.id, provider: provider.id, trackId, position })));
      return created!;
    });
    return (await summarize([p], userId))[0]!;
  });

  r.get("/api/v1/user-playlists/:id", {
    schema: { tags: ["playlists"], params: z.object({ id: Uuid }), response: { 200: z.object({ playlist: Summary, entries: z.array(Entry), totalDurationSec: z.number() }) } },
  }, async (req, reply) => {
    const [p] = await db.select().from(playlists).where(eq(playlists.id, req.params.id));
    // Private playlists are invisible (404, not 403) to anyone but the owner.
    if (!p || (p.visibility === "private" && p.ownerId !== req.userId)) throw new AppError(ErrorCode.NotFound, "Playlist not found", 404);
    reply.header("Cache-Control", "private, no-store");
    const rows = await db.select().from(playlistTracks).where(eq(playlistTracks.playlistId, p.id)).orderBy(asc(playlistTracks.position));
    const snaps = await ensureSnapshots(ctx, "track", rows.map((x) => x.trackId));
    const entries = rows.map((x) => ({ entryId: x.id, position: x.position, addedAt: x.addedAt.toISOString(), track: snaps.get(x.trackId) ?? null }));
    return {
      playlist: (await summarize([p], req.userId))[0]!,
      entries,
      totalDurationSec: entries.reduce((s, e) => s + (e.track?.durationSec ?? 0), 0),
    };
  });

  r.patch("/api/v1/user-playlists/:id", {
    schema: { tags: ["playlists"], params: z.object({ id: Uuid }), body: z.object({ title: z.string().trim().min(1).max(150).optional(), description: z.string().max(5000).optional(), visibility: Visibility.optional() }), response: { 200: Summary } },
  }, async (req) => {
    const userId = requireUser(req);
    const p = await db.transaction(async (tx) => {
      await loadOwned(req.params.id, userId, tx as never);
      const [u] = await tx.update(playlists).set({ ...req.body, version: sql`${playlists.version} + 1`, updatedAt: new Date() }).where(eq(playlists.id, req.params.id)).returning();
      return u!;
    });
    return (await summarize([p], userId))[0]!;
  });

  r.delete("/api/v1/user-playlists/:id", { schema: { tags: ["playlists"], params: z.object({ id: Uuid }) } }, async (req) => {
    const userId = requireUser(req);
    const res = await db.delete(playlists).where(and(eq(playlists.id, req.params.id), eq(playlists.ownerId, userId))).returning({ id: playlists.id });
    if (!res.length) throw new AppError(ErrorCode.NotFound, "Playlist not found", 404);
    return { ok: true };
  });

  r.post("/api/v1/user-playlists/:id/tracks", {
    schema: {
      tags: ["playlists"], params: z.object({ id: Uuid }),
      body: z.object({ trackIds: z.array(Id).min(1).max(500), allowDuplicates: z.boolean().default(false), position: z.number().int().min(0).optional() }),
      response: { 200: z.object({ added: z.number(), skippedDuplicates: z.array(z.string()), version: z.number() }) },
    },
  }, async (req) => {
    const userId = requireUser(req);
    const snaps = await ensureSnapshots(ctx, "track", req.body.trackIds);
    const ids = req.body.trackIds.filter((id) => snaps.has(id));
    if (!ids.length) throw new AppError(ErrorCode.TrackUnavailable, "None of those tracks are available", 422);
    return db.transaction(async (tx) => {
      await loadOwned(req.params.id, userId, tx as never);
      const existing = await tx.select({ trackId: playlistTracks.trackId, position: playlistTracks.position }).from(playlistTracks).where(eq(playlistTracks.playlistId, req.params.id));
      if (existing.length + ids.length > MAX_TRACKS) throw new AppError(ErrorCode.BadRequest, `Playlists hold at most ${MAX_TRACKS} tracks`, 400);
      const have = new Set(existing.map((e) => e.trackId));
      const skippedDuplicates = req.body.allowDuplicates ? [] : ids.filter((id) => have.has(id));
      const toAdd = req.body.allowDuplicates ? ids : ids.filter((id) => !have.has(id));
      const at = Math.min(req.body.position ?? existing.length, existing.length);
      if (toAdd.length) {
        // Make room (deferred unique constraint allows the transient overlap).
        await tx.update(playlistTracks).set({ position: sql`${playlistTracks.position} + ${toAdd.length}` })
          .where(and(eq(playlistTracks.playlistId, req.params.id), gte(playlistTracks.position, at)));
        await tx.insert(playlistTracks).values(toAdd.map((trackId, i) => ({ playlistId: req.params.id, provider: provider.id, trackId, position: at + i })));
      }
      const [u] = await tx.update(playlists).set({ version: sql`${playlists.version} + 1`, updatedAt: new Date() }).where(eq(playlists.id, req.params.id)).returning();
      return { added: toAdd.length, skippedDuplicates, version: u!.version };
    });
  });

  r.delete("/api/v1/user-playlists/:id/tracks/:entryId", {
    schema: { tags: ["playlists"], params: z.object({ id: Uuid, entryId: Uuid }), response: { 200: z.object({ version: z.number() }) } },
  }, async (req) => {
    const userId = requireUser(req);
    return db.transaction(async (tx) => {
      await loadOwned(req.params.id, userId, tx as never);
      const [gone] = await tx.delete(playlistTracks).where(and(eq(playlistTracks.id, req.params.entryId), eq(playlistTracks.playlistId, req.params.id))).returning();
      if (!gone) throw new AppError(ErrorCode.NotFound, "Track is not in this playlist", 404);
      await tx.update(playlistTracks).set({ position: sql`${playlistTracks.position} - 1` })
        .where(and(eq(playlistTracks.playlistId, req.params.id), gt(playlistTracks.position, gone.position)));
      const [u] = await tx.update(playlists).set({ version: sql`${playlists.version} + 1`, updatedAt: new Date() }).where(eq(playlists.id, req.params.id)).returning();
      return { version: u!.version };
    });
  });

  r.post("/api/v1/user-playlists/:id/reorder", {
    schema: { tags: ["playlists"], params: z.object({ id: Uuid }), body: z.object({ entryId: Uuid, toPosition: z.number().int().min(0), version: z.number().int() }), response: { 200: z.object({ version: z.number() }) } },
  }, async (req) => {
    const userId = requireUser(req);
    return db.transaction(async (tx) => {
      const p = await loadOwned(req.params.id, userId, tx as never);
      if (p.version !== req.body.version) throw new AppError(ErrorCode.Conflict, "Playlist changed elsewhere; reload and try again", 409);
      const [entry] = await tx.select().from(playlistTracks).where(and(eq(playlistTracks.id, req.body.entryId), eq(playlistTracks.playlistId, p.id)));
      if (!entry) throw new AppError(ErrorCode.NotFound, "Track is not in this playlist", 404);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(playlistTracks).where(eq(playlistTracks.playlistId, p.id))) as [{ n: number }];
      const to = Math.min(req.body.toPosition, n - 1);
      const from = entry.position;
      if (to !== from) {
        if (to > from) {
          await tx.update(playlistTracks).set({ position: sql`${playlistTracks.position} - 1` })
            .where(and(eq(playlistTracks.playlistId, p.id), gt(playlistTracks.position, from), lte(playlistTracks.position, to)));
        } else {
          await tx.update(playlistTracks).set({ position: sql`${playlistTracks.position} + 1` })
            .where(and(eq(playlistTracks.playlistId, p.id), gte(playlistTracks.position, to), lt(playlistTracks.position, from)));
        }
        await tx.update(playlistTracks).set({ position: to }).where(eq(playlistTracks.id, entry.id));
      }
      const [u] = await tx.update(playlists).set({ version: sql`${playlists.version} + 1`, updatedAt: new Date() }).where(eq(playlists.id, p.id)).returning();
      return { version: u!.version };
    });
  });
}
