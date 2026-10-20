import { Redis } from "ioredis";
import pino from "pino";
import { YouTubeMusicProvider } from "@zuno/provider/youtube";
import { DevToneProvider } from "@zuno/provider/dev";
import type { MusicProvider } from "@zuno/provider";
import { YtMusicApiProvider } from "@zuno/provider/ytmusicapi";
import { YouTubeOfficialProvider } from "@zuno/provider/official";
import type { MusicSource } from "@zuno/core";
import type { Config } from "./config";
import { openDatabase } from "./db/client";
import { JsonCache } from "./lib/cache";
import type { AppContext } from "./context";

export function createProvider(config: Config, log: pino.Logger): MusicProvider {
  if (config.MUSIC_PROVIDER === "dev") return new DevToneProvider();
  return new YouTubeMusicProvider({ location: config.YT_LOCATION, language: config.YT_LANGUAGE, logger: log });
}

/**
 * One provider per enabled source. ytmusicapi has no audio of its own, so it streams through the
 * youtubei.js provider; "official" plays in the browser through YouTube's embedded player.
 * MUSIC_PROVIDER=dev (tests, offline work) serves every source from the dev tones.
 */
export function createSources(config: Config, base: MusicProvider, log: pino.Logger): Partial<Record<MusicSource, MusicProvider>> {
  const out: Partial<Record<MusicSource, MusicProvider>> = {};
  for (const s of config.MUSIC_SOURCES) {
    if (config.MUSIC_PROVIDER === "dev" || s === "youtubei") { out[s] = base; continue; }
    if (s === "ytmusicapi") out[s] = new YtMusicApiProvider({ baseUrl: config.YTMUSICAPI_URL, streams: base, logger: log });
    if (s === "official") out[s] = new YouTubeOfficialProvider({ apiKey: config.YOUTUBE_API_KEY!, region: config.YT_LOCATION, language: config.YT_LANGUAGE, logger: log });
  }
  return out;
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
  const base = createProvider(config, log);
  const sources = createSources(config, base, log);
  return { config, provider: base, sources, db: database.db, database, redis, cache: new JsonCache(redis, log) };
}
