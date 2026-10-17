import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ImportCollection, ImportItem, MatchResult, type Track } from "@zuno/core";
import { importFromLink } from "../lib/importers/sources";
import { confidenceFor, normalizeTitle, rankCandidates, searchTitle, splitArtists } from "../lib/matcher";

const BATCH = 25;
const CONCURRENCY = 4;

export async function importRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { provider, cache, config } = app.ctx;
  const spotify = config.SPOTIFY_CLIENT_ID && config.SPOTIFY_CLIENT_SECRET ? { id: config.SPOTIFY_CLIENT_ID, secret: config.SPOTIFY_CLIENT_SECRET } : undefined;

  r.get("/api/v1/import/capabilities", { schema: { tags: ["import"], response: { 200: z.object({ spotifyLinks: z.boolean(), deezerLinks: z.boolean(), youtubeLinks: z.boolean() }) } } }, async () => ({
    spotifyLinks: !!spotify, deezerLinks: true, youtubeLinks: provider.id === "youtube" || provider.id === "dev",
  }));

  r.post("/api/v1/import/link", {
    schema: { tags: ["import"], body: z.object({ url: z.string().trim().min(5).max(2000) }), response: { 200: ImportCollection } },
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (req) => importFromLink(req.body.url, { provider, spotify }));

  /** Match up to 25 songs per call (the client sends batches so it can show progress and cancel). */
  r.post("/api/v1/import/match", {
    schema: { tags: ["import"], body: z.object({ items: z.array(ImportItem).min(1).max(BATCH) }), response: { 200: z.object({ results: z.array(MatchResult) }) } },
    config: { rateLimit: { max: 240, timeWindow: "1 minute" } },
  }, async (req) => {
    const items = req.body.items;
    const results: z.infer<typeof MatchResult>[] = new Array(items.length);
    let next = 0;
    const work = async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await matchOne(items[i]!, i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, work));
    return { results };
  });

  async function matchOne(item: ImportItem, index: number): Promise<z.infer<typeof MatchResult>> {
    if (item.catalogId) {
      // Already a catalog id (YouTube/Takeout/Neo export). Metadata is re-fetched server-side on save.
      const track: Track = {
        id: item.catalogId, provider: provider.id, title: item.title, artist: item.artist || "Unknown artist", durationSec: item.durationSec,
        artworkUrl: /^[\w-]{11}$/.test(item.catalogId) ? `https://i.ytimg.com/vi/${item.catalogId}/hqdefault.jpg` : undefined,
      };
      return { index, confidence: "exact", score: 1, track, alternatives: [] };
    }
    const key = createHash("sha1").update(`${normalizeTitle(item.title)}|${splitArtists(item.artist).join(",")}|${Math.round((item.durationSec ?? 0) / 10)}`).digest("hex");
    const cached = await cache.get(`match:v2:${provider.id}:${key}`, { ttlSec: 7 * 86400 }, async () => {
      // Search with the cleaned title + the primary artist as written by the source.
      const primary = item.artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b)\s*/i)[0]?.trim() ?? "";
      const q = `${searchTitle(item.title)} ${primary}`.slice(0, 200).trim();
      const songs = await provider.search(q, "song").catch(() => null);
      let pool = [...(songs?.tracks ?? []), ...(songs?.videos ?? [])].slice(0, 12);
      let ranked = rankCandidates(item, pool);
      if (ranked.score < 0.66) {
        // Some recordings exist only as videos (or under a different primary artist).
        const vids = await provider.search(q, "video").catch(() => null);
        pool = [...pool, ...(vids?.videos ?? []), ...(vids?.tracks ?? [])].slice(0, 20);
        ranked = rankCandidates(item, pool);
      }
      return { track: ranked.best, score: ranked.score, alternatives: ranked.alternatives };
    });
    const confidence = cached.track ? confidenceFor(cached.score) : "none";
    return { index, confidence, score: Math.round(cached.score * 1000) / 1000, track: cached.track, alternatives: cached.alternatives };
  }
}
