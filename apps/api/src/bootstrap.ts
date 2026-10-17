import { Redis } from "ioredis";
import pino from "pino";
import { YouTubeMusicProvider } from "@zuno/provider/youtube";
import { DevToneProvider } from "@zuno/provider/dev";
import type { MusicProvider } from "@zuno/provider";
import type { Config } from "./config";
import { openDatabase } from "./db/client";
import { JsonCache } from "./lib/cache";
import type { AppContext } from "./context";

export function createProvider(config: Config, log: pino.Logger): MusicProvider {
  if (config.MUSIC_PROVIDER === "dev") return new DevToneProvider();
  return new YouTubeMusicProvider({ location: config.YT_LOCATION, language: config.YT_LANGUAGE, logger: log });
}

export async function createContext(config: Config): Promise<AppContext> {
  const log = pino({ level: config.LOG_LEVEL });
  const database = await openDatabase(config);
  log.info({ driver: database.driver, persisted: database.driver === "memory" ? !!config.MEMORY_DB_DIR : true }, "database ready");
  // Redis is optional: without REDIS_URL the cache and rate limits live in this process's memory.
  const redis = config.REDIS_URL ? new Redis(config.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (n) => Math.min(n * 500, 10_000),
  }) : null;
  redis?.on("error", (err) => log.warn({ err: err.message }, "redis error"));
  if (!redis) log.info("no REDIS_URL: caching and rate limits use process memory");
  return { config, provider: createProvider(config, log), db: database.db, database, redis, cache: new JsonCache(redis, log) };
}
