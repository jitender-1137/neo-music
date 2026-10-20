import { z } from "zod";

/**
 * A yes/no setting from the environment. `z.coerce.boolean()` would read any non-empty string —
 * including "false" and "0" — as true, so the words are parsed explicitly; anything else is a
 * configuration error rather than a silent guess.
 */
const envBool = (fallback: boolean) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.union([z.boolean(), z.enum(["true", "false", "1", "0", "yes", "no", "on", "off", ""])]).optional(),
  ).transform((v) => (v === undefined || v === "" ? fallback : v === true || v === "true" || v === "1" || v === "yes" || v === "on"));

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default("127.0.0.1"),
  WEB_ORIGINS: z.string().default("http://localhost:3000").transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  /**
   * Which database to use:
   *   postgres — a real PostgreSQL server at DATABASE_URL (multi-process, durable).
   *   memory   — PostgreSQL running inside the API process (PGlite), same schema and queries, no
   *              server needed. Data lives in RAM and is lost on restart unless MEMORY_DB_DIR is set.
   *              Single process only: the background worker always runs inside the API.
   */
  DB_DRIVER: z.enum(["postgres", "memory"]).default("postgres"),
  /** postgres only (required there). Empty is treated as unset. */
  DATABASE_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
  /** memory only, optional: a folder to keep the in-process database in, so it survives restarts. */
  MEMORY_DB_DIR: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  /**
   * Optional cache (stream lookups, catalog, shared rate limits). Without it everything still works:
   * caching and rate limiting fall back to this process's memory. Empty is treated as unset.
   */
  REDIS_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
  STREAM_SIGNING_SECRET: z.string().min(32, "STREAM_SIGNING_SECRET must be at least 32 chars"),
  MUSIC_PROVIDER: z.enum(["youtube", "dev"]).default("youtube"),
  /**
   * Music sources users can pick in Settings (comma-separated): youtubei, ytmusicapi, official.
   * youtubei.js is always available; the others need their own settings below.
   */
  MUSIC_SOURCES: z.string().default("youtubei")
    .transform((s) => [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))])
    .pipe(z.array(z.enum(["youtubei", "ytmusicapi", "official"])).min(1)),
  /** The source used when a request doesn't name one (must be in MUSIC_SOURCES). */
  DEFAULT_MUSIC_SOURCE: z.enum(["youtubei", "ytmusicapi", "official"]).default("youtubei"),
  /** ytmusicapi helper service (Python, see services/ytmusicapi). */
  YTMUSICAPI_URL: z.string().url().default("http://127.0.0.1:4200"),
  /** YouTube Data API v3 key for the "official" source. Server-only; never sent to browsers. */
  YOUTUBE_API_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(20).optional()),
  YT_LOCATION: z.string().length(2).default("US"),
  YT_LANGUAGE: z.string().default("en"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Trust X-Forwarded-* from the reverse proxy (nginx) in production. */
  TRUST_PROXY: envBool(false),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Max simultaneous upstream audio fetches per API instance (backpressure). */
  /** Run the outbox worker inside the API process (handy for dev / single-node deploys). */
  WORKER_INLINE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  /** Per-IP attempts/min on login, register, password routes. */
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  /** Per-IP playback-token requests/min. One per page load; generous for shared NAT (offices, campuses). */
  PLAYBACK_TOKEN_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(120),
  /** Per-IP requests/min across the API (stream route has its own higher limit). */
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(600),
  STREAM_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(1500),
  /** Optional: enables importing Spotify links (Web API client-credentials). Without it, users upload an Exportify CSV. */
  SPOTIFY_CLIENT_ID: z.string().min(1).optional(),
  SPOTIFY_CLIENT_SECRET: z.string().min(1).optional(),
  STREAM_MAX_CONCURRENCY: z.coerce.number().int().positive().default(64),
});
export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && /change-me/.test(parsed.data.STREAM_SIGNING_SECRET)) {
    throw new Error("STREAM_SIGNING_SECRET still has the example value");
  }
  if (parsed.data.DB_DRIVER === "postgres" && !parsed.data.DATABASE_URL) {
    throw new Error("Invalid configuration: DATABASE_URL is required when DB_DRIVER=postgres (or set DB_DRIVER=memory)");
  }
  const sources = parsed.data.MUSIC_SOURCES;
  if (!sources.includes(parsed.data.DEFAULT_MUSIC_SOURCE)) {
    throw new Error(`Invalid configuration: DEFAULT_MUSIC_SOURCE=${parsed.data.DEFAULT_MUSIC_SOURCE} isn't in MUSIC_SOURCES (${sources.join(",")})`);
  }
  if (sources.includes("official") && !parsed.data.YOUTUBE_API_KEY && parsed.data.MUSIC_PROVIDER !== "dev") {
    throw new Error("Invalid configuration: MUSIC_SOURCES includes official, which needs YOUTUBE_API_KEY");
  }
  // The in-memory database exists only inside the API process, so its worker must run there too.
  if (parsed.data.DB_DRIVER === "memory") return { ...parsed.data, WORKER_INLINE: true };
  return parsed.data;
}
