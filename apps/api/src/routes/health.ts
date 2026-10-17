import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  const { database, redis, provider } = app.ctx;
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
