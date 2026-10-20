import type { FastifyInstance } from "fastify";
import type { MusicSource, SourceInfo } from "@zuno/core";

/** What each source can do — shown in Settings so people know the trade-offs before switching. */
export const SOURCE_INFO: Record<MusicSource, Omit<SourceInfo, "id">> = {
  youtubei: {
    name: "YouTube Music (youtubei.js)",
    description: "Full YouTube Music catalogue. Audio streams through this server, so it keeps playing with the screen locked.",
    playback: "stream",
    features: { albums: true, lyrics: true, suggestions: true, moods: true, backgroundPlayback: true },
  },
  ytmusicapi: {
    name: "YouTube Music (ytmusicapi)",
    description: "YouTube Music catalogue through the ytmusicapi library. Audio streams through this server, like youtubei.js.",
    playback: "stream",
    features: { albums: true, lyrics: true, suggestions: true, moods: true, backgroundPlayback: true },
  },
  official: {
    name: "YouTube (official API)",
    description: "Google's YouTube Data API with YouTube's own player. Plays straight from YouTube (shown as a small video), but stops when the screen locks. No albums or lyrics; searches are limited per day.",
    playback: "embed",
    features: { albums: false, lyrics: false, suggestions: false, moods: false, backgroundPlayback: false },
  },
};

export async function healthRoutes(app: FastifyInstance) {
  const { database, redis, provider } = app.ctx;
  /** The music sources this server offers, the default, and the one this request resolved to. */
  app.get("/api/v1/sources", async (req) => ({
    sources: (Object.keys(app.ctx.sources) as MusicSource[]).map((id) => ({ id, ...SOURCE_INFO[id] })),
    default: app.ctx.config.DEFAULT_MUSIC_SOURCE,
    current: req.source,
  }));
  /** Liveness: the process is up. Never checks dependencies (avoids restart storms). */
  app.get("/healthz", { config: { rateLimit: false } }, async () => ({ ok: true }));
  /** Which music provider is serving (for the in-app playback diagnostics). No secrets. */
  app.get("/api/v1/provider", async () => ({ id: provider.id, developmentOnly: provider.isDevelopmentOnly, audioCaching: "bypass" as const, reason: "Provider terms don't permit storing audio; only the browser's private HTTP cache applies." }));
  /** Readiness: can we serve traffic? The database is required; Redis and provider are reported. */
  app.get("/readyz", { config: { rateLimit: false } }, async (_req, reply) => {
    const [db, cache, prov] = await Promise.all([
      database.ping().then(() => true, () => false),
      redis ? redis.ping().then(() => true, () => false) : Promise.resolve(false),
      provider.health().then((h) => h.ok, () => false),
    ]);
    const ok = db;
    void reply.status(ok ? 200 : 503);
    return { ok, checks: { database: db, redis: cache, provider: prov }, database: database.driver, provider: { id: provider.id, developmentOnly: provider.isDevelopmentOnly } };
  });
}
