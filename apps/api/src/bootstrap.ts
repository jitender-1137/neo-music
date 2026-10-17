import { Redis } from "ioredis";
import pino from "pino";
import { YouTubeMusicProvider } from "@zuno/provider/youtube";
import { DevToneProvider } from "@zuno/provider/dev";
import type { MusicProvider } from "@zuno/provider";
import type { Config } from "./config";
import { createDb } from "./db/client";
import { JsonCache } from "./lib/cache";
import type { AppContext } from "./context";

export function createProvider(config: Config, log: pino.Logger): MusicProvider {
  if (config.MUSIC_PROVIDER === "dev") return new DevToneProvider();
  return new YouTubeMusicProvider({ location: config.YT_LOCATION, language: config.YT_LANGUAGE, logger: log });
}

export function createContext(config: Config): AppContext {
  const log = pino({ level: config.LOG_LEVEL });
  const { db, pool } = createDb(config.DATABASE_URL);
  const redis = new Redis(config.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (n) => Math.min(n * 500, 10_000),
  });
  redis.on("error", (err) => log.warn({ err: err.message }, "redis error"));
  return { config, provider: createProvider(config, log), db, pool, redis, cache: new JsonCache(redis, log) };
}
