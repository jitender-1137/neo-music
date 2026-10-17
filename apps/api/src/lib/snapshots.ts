/**
 * Metadata snapshots for library items, fetched server-side from the provider (never trusted
 * from the client: snapshots are shared across users).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Album, Artist, Playlist, Track } from "@zuno/core";
import { catalogItems } from "../db/schema";
import type { AppContext } from "../context";

export type Kind = "track" | "album" | "artist" | "playlist";
type Snap = { track: Track; album: Album; artist: Artist; playlist: Playlist };

const REFRESH_AFTER_MS = 7 * 24 * 3600 * 1000;

async function fetchFromProvider<K extends Kind>(ctx: AppContext, kind: K, id: string): Promise<Snap[K]> {
  const p = ctx.provider;
  const ttl = { ttlSec: 6 * 3600, staleSec: 24 * 3600 };
  switch (kind) {
    case "track": return (await ctx.cache.get(`snap:track:${p.id}:${id}`, ttl, async () => (await p.getTrack(id)).track)) as Snap[K];
    case "album": return (await ctx.cache.get(`snap:album:${p.id}:${id}`, ttl, async () => (await p.getAlbum(id)).album)) as Snap[K];
    case "artist": return (await ctx.cache.get(`snap:artist:${p.id}:${id}`, ttl, async () => (await p.getArtist(id)).artist)) as Snap[K];
    default: return (await ctx.cache.get(`snap:playlist:${p.id}:${id}`, ttl, async () => (await p.getPlaylist(id)).playlist)) as Snap[K];
  }
}

/** Ensures snapshots exist for every id (fetching missing ones with bounded concurrency). */
export async function ensureSnapshots<K extends Kind>(ctx: AppContext, kind: K, ids: string[]): Promise<Map<string, Snap[K]>> {
  const out = new Map<string, Snap[K]>();
  const unique = [...new Set(ids)];
  if (!unique.length) return out;
  const rows = await ctx.db.select().from(catalogItems)
    .where(and(eq(catalogItems.provider, ctx.provider.id), eq(catalogItems.kind, kind), inArray(catalogItems.itemId, unique)));
  for (const r of rows) out.set(r.itemId, r.data as Snap[K]);
  const missing = unique.filter((id) => !out.has(id));
  const stale = rows.filter((r) => Date.now() - r.updatedAt.getTime() > REFRESH_AFTER_MS).map((r) => r.itemId);
  const work = [...missing, ...stale.slice(0, 5)];
  let i = 0;
  const workers = Array.from({ length: Math.min(4, work.length) }, async () => {
    while (i < work.length) {
      const id = work[i++]!;
      try {
        const data = await fetchFromProvider(ctx, kind, id);
        out.set(id, data);
        await ctx.db.insert(catalogItems).values({ provider: ctx.provider.id, kind, itemId: id, data })
          .onConflictDoUpdate({ target: [catalogItems.provider, catalogItems.kind, catalogItems.itemId], set: { data, updatedAt: sql`now()` } });
      } catch {
        // Unavailable upstream: keep the stale snapshot if we have one; otherwise the item is skipped.
      }
    }
  });
  await Promise.all(workers);
  return out;
}

/** Store a snapshot we already hold from a trusted server-side provider response. */
export async function saveSnapshot(ctx: AppContext, kind: Kind, id: string, data: unknown) {
  await ctx.db.insert(catalogItems).values({ provider: ctx.provider.id, kind, itemId: id, data })
    .onConflictDoUpdate({ target: [catalogItems.provider, catalogItems.kind, catalogItems.itemId], set: { data, updatedAt: sql`now()` } });
}
