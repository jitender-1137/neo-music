/**
 * Outbox worker: turns raw listening events into profile updates (stats, affinity, history,
 * search history, co-listening). Bounded batches, SKIP LOCKED for multi-worker safety,
 * exponential backoff with jitter, and a dead-letter state after MAX_ATTEMPTS.
 */
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { accumulate, isQualified, SIGNAL_WEIGHTS, type EventType } from "@zuno/recs";
import type { Db } from "../db/client";
import {
  catalogItems, listeningEvents, listeningHistory, outboxEvents, searchHistory, trackCooccurrences,
  userArtistAffinity, userTrackStats,
} from "../db/schema";

export const MAX_ATTEMPTS = 8;
const BATCH = 50;
const COLISTEN_WINDOW_MS = 30 * 60_000;

export interface OutboxLogger { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void; error: (o: object, m?: string) => void }

export async function processOutboxOnce(db: Db, log: OutboxLogger): Promise<number> {
  return db.transaction(async (tx) => {
    const batch = await tx.select().from(outboxEvents)
      .where(and(isNull(outboxEvents.processedAt), isNull(outboxEvents.failedAt), lte(outboxEvents.availableAt, new Date())))
      .orderBy(asc(outboxEvents.id)).limit(BATCH).for("update", { skipLocked: true });
    for (const job of batch) {
      try {
        await tx.transaction(async (sp) => {
          if (job.topic === "listening_events") await applyEvents(sp as unknown as Db, (job.payload as { eventIds: string[] }).eventIds);
          else throw new Error(`unknown topic ${job.topic}`);
        });
        await tx.update(outboxEvents).set({ processedAt: new Date() }).where(eq(outboxEvents.id, job.id));
      } catch (err) {
        const attempts = job.attempts + 1;
        const backoffMs = Math.min(2 ** attempts * 1000, 15 * 60_000) * (0.5 + Math.random());
        const dead = attempts >= MAX_ATTEMPTS;
        log[dead ? "error" : "warn"]({ jobId: job.id, attempts, err: (err as Error).message }, dead ? "outbox job dead-lettered" : "outbox job failed");
        await tx.update(outboxEvents).set({
          attempts, lastError: (err as Error).message.slice(0, 500),
          availableAt: new Date(Date.now() + backoffMs), failedAt: dead ? new Date() : null,
        }).where(eq(outboxEvents.id, job.id));
      }
    }
    return batch.length;
  });
}

async function applyEvents(db: Db, ids: string[]) {
  if (!ids.length) return;
  const events = await db.select().from(listeningEvents).where(inArray(listeningEvents.eventId, ids)).orderBy(asc(listeningEvents.occurredAt));
  for (const e of events) {
    const type = e.type as EventType;
    const qualified = type === "qualified" || (type === "complete");
    if (e.userId) {
      if (type === "start" && e.trackId) {
        await db.insert(listeningHistory).values({ userId: e.userId, provider: e.provider, trackId: e.trackId, eventId: e.eventId, playedAt: e.occurredAt }).onConflictDoNothing();
      }
      if (type === "search" && e.context.query) {
        await db.insert(searchHistory).values({ userId: e.userId, query: e.context.query.slice(0, 200), searchedAt: e.occurredAt })
          .onConflictDoUpdate({ target: [searchHistory.userId, searchHistory.query], set: { searchedAt: e.occurredAt } });
      }
      if (e.trackId && ["start", "qualified", "complete", "skip"].includes(type)) {
        const inc = { starts: type === "start" ? 1 : 0, qualified: type === "qualified" ? 1 : 0, completes: type === "complete" ? 1 : 0, skips: type === "skip" ? 1 : 0 };
        await db.insert(userTrackStats).values({ userId: e.userId, provider: e.provider, trackId: e.trackId, ...inc, lastPlayedAt: e.occurredAt })
          .onConflictDoUpdate({
            target: [userTrackStats.userId, userTrackStats.provider, userTrackStats.trackId],
            set: {
              starts: sql`${userTrackStats.starts} + ${inc.starts}`, qualified: sql`${userTrackStats.qualified} + ${inc.qualified}`,
              completes: sql`${userTrackStats.completes} + ${inc.completes}`, skips: sql`${userTrackStats.skips} + ${inc.skips}`,
              lastPlayedAt: sql`greatest(${userTrackStats.lastPlayedAt}, ${e.occurredAt})`,
            },
          });
      }
      const w = SIGNAL_WEIGHTS[type]?.artist ?? 0;
      if (w !== 0 && e.artistIds.length) {
        const names = await artistNames(db, e.provider, e.trackId);
        for (const artistId of e.artistIds.slice(0, 3)) {
          const [cur] = await db.select().from(userArtistAffinity).where(and(eq(userArtistAffinity.userId, e.userId), eq(userArtistAffinity.provider, e.provider), eq(userArtistAffinity.artistId, artistId))).for("update");
          const next = cur ? accumulate(cur.score, cur.updatedAt, w, e.occurredAt) : w;
          await db.insert(userArtistAffinity).values({ userId: e.userId, provider: e.provider, artistId, artistName: names.get(artistId) ?? "", score: next, updatedAt: e.occurredAt })
            .onConflictDoUpdate({ target: [userArtistAffinity.userId, userArtistAffinity.provider, userArtistAffinity.artistId], set: { score: next, updatedAt: e.occurredAt, ...(names.get(artistId) ? { artistName: names.get(artistId)! } : {}) } });
        }
      }
    }
    // Co-listening (users and anonymous devices alike): pair with the actor's previous qualified play.
    const actor = e.userId ?? e.context.anon;
    if (qualified && e.trackId && actor && isQualified(e.msPlayed ?? 30_000, e.durationMs)) {
      const [prev] = await db.select({ trackId: listeningEvents.trackId, at: listeningEvents.occurredAt }).from(listeningEvents)
        .where(and(
          e.userId ? eq(listeningEvents.userId, e.userId) : sql`${listeningEvents.context}->>'anon' = ${actor}`,
          eq(listeningEvents.type, "qualified"), sql`${listeningEvents.occurredAt} < ${e.occurredAt}`,
          sql`${listeningEvents.occurredAt} > ${new Date(e.occurredAt.getTime() - COLISTEN_WINDOW_MS)}`,
        )).orderBy(sql`${listeningEvents.occurredAt} desc`).limit(1);
      if (prev?.trackId && prev.trackId !== e.trackId) {
        const [a, b] = prev.trackId < e.trackId ? [prev.trackId, e.trackId] : [e.trackId, prev.trackId];
        await db.insert(trackCooccurrences).values({ provider: e.provider, trackA: a, trackB: b, weight: 1, users: 1 })
          .onConflictDoUpdate({ target: [trackCooccurrences.provider, trackCooccurrences.trackA, trackCooccurrences.trackB], set: { weight: sql`${trackCooccurrences.weight} + 1`, updatedAt: new Date() } });
      }
    }
  }
}

async function artistNames(db: Db, provider: string, trackId: string | null): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (!trackId) return m;
  const [row] = await db.select({ data: catalogItems.data }).from(catalogItems).where(and(eq(catalogItems.provider, provider), eq(catalogItems.kind, "track"), eq(catalogItems.itemId, trackId)));
  for (const a of (row?.data as { artists?: { id: string; name: string }[] } | undefined)?.artists ?? []) m.set(a.id, a.name);
  return m;
}

/** Long-running loop with idle backoff. Returns a stop function. */
export function startOutboxLoop(db: Db, log: OutboxLogger, idleMs = 2000): () => Promise<void> {
  let stopped = false;
  let running: Promise<void> = Promise.resolve();
  const loop = async () => {
    while (!stopped) {
      let n = 0;
      try {
        n = await processOutboxOnce(db, log);
      } catch (err) {
        log.error({ err: (err as Error).message }, "outbox loop error");
      }
      if (n === 0 && !stopped) await new Promise((r) => setTimeout(r, idleMs));
    }
  };
  running = loop();
  return async () => { stopped = true; await running; };
}
