import type { Redis } from "ioredis";
import type { MusicProvider } from "@zuno/provider";
import type { MusicSource } from "@zuno/core";
import type { Config } from "./config";
import type { Database, Db } from "./db/client";
import type { JsonCache } from "./lib/cache";

/** Everything routes need, built once in `buildServer` and injectable in tests. */
export interface AppContext {
  config: Config;
  /**
   * The default source's provider: stored-data namespace, audio streaming, imports and background
   * jobs. Catalogue routes use the per-request `req.catalog` instead (see plugins/source).
   */
  provider: MusicProvider;
  /** Every enabled music source (users pick one in Settings). */
  sources: Partial<Record<MusicSource, MusicProvider>>;
  db: Db;
  /** The database behind `db` (driver, readiness ping, shutdown). */
  database: Database;
  redis: Redis | null;
  cache: JsonCache;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
}
