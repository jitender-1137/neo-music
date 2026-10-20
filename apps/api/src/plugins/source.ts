/**
 * Music source per request. The web app sends the user's choice (Settings → Music source) as the
 * X-Music-Source header; server-rendered pages pass ?src=. Unknown or disabled values fall back to
 * DEFAULT_MUSIC_SOURCE, so older clients keep working. Catalogue responses vary by source, so every
 * response says so (Vary) — browser and service-worker caches keep the sources apart.
 */
import type { FastifyInstance } from "fastify";
import { MusicSource } from "@zuno/core";
import type { MusicProvider } from "@zuno/provider";

declare module "fastify" {
  interface FastifyRequest {
    /** The music source chosen for this request. */
    source: MusicSource;
    /** Provider for catalogue reads (search, albums, artists…) in this request's source. */
    catalog: MusicProvider;
  }
}

export const SOURCE_HEADER = "x-music-source";

export async function registerSource(app: FastifyInstance) {
  const { sources, config, provider } = app.ctx;
  app.decorateRequest("source", null as never);
  app.decorateRequest("catalog", null as never);
  app.addHook("onRequest", async (req) => {
    const header = req.headers[SOURCE_HEADER];
    const query = (req.query as Record<string, unknown> | undefined)?.src;
    const wanted = MusicSource.safeParse(typeof header === "string" ? header : query);
    const id = wanted.success && sources[wanted.data] ? wanted.data : config.DEFAULT_MUSIC_SOURCE;
    req.source = id;
    req.catalog = sources[id] ?? provider;
  });
  app.addHook("onSend", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    const vary = String(reply.getHeader("vary") ?? "");
    if (!/x-music-source/i.test(vary)) reply.header("Vary", vary ? `${vary}, X-Music-Source` : "X-Music-Source");
  });
}
