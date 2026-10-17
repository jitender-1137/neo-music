import type { Redis } from "ioredis";
import type { MusicProvider } from "@zuno/provider";
import type { Config } from "./config";
import type { Database, Db } from "./db/client";
import type { JsonCache } from "./lib/cache";

/** Everything routes need, built once in `buildServer` and injectable in tests. */
export interface AppContext {
  config: Config;
  provider: MusicProvider;
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
