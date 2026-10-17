import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { listeningEvents, outboxEvents } from "../db/schema";

const EventType = z.enum([
  "impression", "start", "qualified", "complete", "skip", "like", "unlike", "playlist_add", "playlist_remove",
  "queue_add", "search", "follow", "unfollow", "album_save", "not_interested", "rec_select",
]);
const Id = z.string().min(1).max(200).regex(/^[\w-]+$/);

export const IngestEvent = z.object({
  eventId: z.string().uuid(),
  type: EventType,
  trackId: Id.optional(),
  artistIds: z.array(Id).max(10).default([]),
  msPlayed: z.number().int().min(0).max(24 * 3600_000).optional(),
  durationMs: z.number().int().min(0).max(24 * 3600_000).optional(),
  context: z.record(z.string().max(40), z.string().max(300)).default({}),
  occurredAt: z.string().datetime(),
  schemaVersion: z.literal(1).default(1),
});

/**
 * Batched, idempotent ingestion. Playback never waits on this: the client queues events locally
 * (IndexedDB) and flushes opportunistically. Duplicate eventIds are ignored, so retries are safe.
 */
export async function eventRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, provider } = app.ctx;

  r.post("/api/v1/events", {
    schema: { tags: ["events"], body: z.object({ events: z.array(IngestEvent).min(1).max(100) }), response: { 200: z.object({ accepted: z.number(), duplicates: z.number() }) } },
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
  }, async (req) => {
    const now = Date.now();
    // Clock-skewed or far-future events are clamped; ancient ones (> 30 days) are dropped.
    const events = req.body.events
      .map((e) => ({ ...e, at: Math.min(new Date(e.occurredAt).getTime(), now) }))
      .filter((e) => now - e.at < 30 * 86_400_000);
    if (!events.length) return { accepted: 0, duplicates: req.body.events.length };
    const inserted = await db.transaction(async (tx) => {
      const rows = await tx.insert(listeningEvents).values(events.map((e) => ({
        eventId: e.eventId, userId: req.userId, type: e.type, provider: provider.id, trackId: e.trackId ?? null,
        artistIds: e.artistIds, msPlayed: e.msPlayed ?? null, durationMs: e.durationMs ?? null,
        // Search text is only kept for signed-in users (their own history); never for guests.
        context: req.userId ? e.context : Object.fromEntries(Object.entries(e.context).filter(([k]) => k !== "query")),
        occurredAt: new Date(e.at), schemaVersion: e.schemaVersion,
      }))).onConflictDoNothing().returning({ eventId: listeningEvents.eventId });
      if (rows.length) {
        await tx.insert(outboxEvents).values({ topic: "listening_events", payload: { eventIds: rows.map((x) => x.eventId) } });
      }
      return rows.length;
    });
    return { accepted: inserted, duplicates: req.body.events.length - inserted };
  });
}
