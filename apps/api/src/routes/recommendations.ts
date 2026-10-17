import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { rank, mergeCandidates } from "@zuno/recs";
import { and, eq } from "drizzle-orm";
import { BrowsePage, Shelf, Track } from "@zuno/core";
import { recommendationFeedback } from "../db/schema";
import { requireUser } from "../plugins/auth";
import { buildHome, loadSignals } from "../lib/recommender";

const Id = z.string().min(1).max(64).regex(/^[\w-]+$/);

export async function recommendationRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const ctx = app.ctx;

  r.get("/api/v1/recommendations/home", {
    schema: {
      tags: ["recommendations"],
      // Guests send recent local plays as seeds; they never leave the device otherwise.
      querystring: z.object({ seeds: z.string().max(400).optional() }),
      response: { 200: BrowsePage.extend({ personalized: z.boolean(), configVersion: z.string() }) },
    },
  }, async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const seeds = (req.query.seeds ?? "").split(",").filter((x) => /^[\w-]{11}$/.test(x)).slice(0, 10);
    try {
      return await buildHome(ctx, req.userId, seeds);
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, "personalized home failed; falling back");
      return { ...(await ctx.provider.getHome()), personalized: false, configVersion: "provider-home" };
    }
  });

  /** Radio stays coherent: provider order is relevance; we only apply eligibility and an artist cap. */
  r.get("/api/v1/recommendations/radio/:trackId", {
    schema: { tags: ["recommendations"], params: z.object({ trackId: Id }), querystring: z.object({ continuation: z.string().max(4000).optional() }), response: { 200: z.object({ tracks: z.array(Track), continuation: z.string().optional() }) } },
  }, async (req) => {
    const res = await ctx.provider.getRadio({ trackId: req.params.trackId }, req.query.continuation);
    const s = await loadSignals(ctx, req.userId, []);
    const cands = mergeCandidates([{ source: "similar", items: res.tracks.map((t, i) => ({ track: { id: t.id, title: t.title, artistIds: t.artists?.map((a) => a.id) ?? [], artistNames: [t.artist], isExplicit: t.isExplicit, payload: t }, features: { tasteMatch: 1 - i / (res.tracks.length + 1) } })) }]);
    const keepSeedFirst = !req.query.continuation;
    const ranked = rank(cands, { version: "radio-v1", weights: { tasteMatch: 1, recentContext: 0, artistAffinity: 0, collaborative: 0, freshness: 0, discovery: 0, repetitionPenalty: 0, negativePenalty: 0 }, maxPerArtist: 6, artistSpacing: 1, discoveryShare: 0 },
      { blockedTracks: s.blockedTracks, blockedArtists: s.blockedArtists, hideExplicit: s.hideExplicit }, 100);
    let tracks = ranked.map((c) => c.track.payload as Track);
    if (keepSeedFirst) {
      const seed = res.tracks.find((t) => t.id === req.params.trackId);
      tracks = seed ? [seed, ...tracks.filter((t) => t.id !== seed.id)] : tracks;
    }
    return { tracks, continuation: res.continuation };
  });

  r.get("/api/v1/recommendations/similar/:trackId", { schema: { tags: ["recommendations"], params: z.object({ trackId: Id }), response: { 200: z.object({ shelves: z.array(Shelf) }) } } }, async (req) => ({
    shelves: await ctx.cache.get(`related:${ctx.provider.id}:${req.params.trackId}`, { ttlSec: 6 * 3600 }, () => ctx.provider.getRelated(req.params.trackId)),
  }));

  r.post("/api/v1/recommendations/feedback", {
    schema: { tags: ["recommendations"], body: z.object({ kind: z.enum(["not_interested_track", "not_interested_artist"]), targetId: Id, undo: z.boolean().default(false) }) },
  }, async (req) => {
    const userId = requireUser(req);
    const { kind, targetId, undo } = req.body;
    if (undo) {
      await ctx.db.delete(recommendationFeedback).where(and(eq(recommendationFeedback.userId, userId), eq(recommendationFeedback.kind, kind), eq(recommendationFeedback.targetId, targetId)));
    } else {
      await ctx.db.insert(recommendationFeedback).values({ userId, provider: ctx.provider.id, kind, targetId }).onConflictDoNothing();
    }
    return { ok: true };
  });
}
