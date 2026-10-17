import type { Redis } from "ioredis";
import type pg from "pg";
import type { MusicProvider } from "@zuno/provider";
import type { Config } from "./config";
import type { Db } from "./db/client";
import type { JsonCache } from "./lib/cache";

/** Everything routes need, built once in `buildServer` and injectable in tests. */
export interface AppContext {
  config: Config;
  provider: MusicProvider;
  db: Db;
  pool: pg.Pool;
  redis: Redis | null;
  cache: JsonCache;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
}
