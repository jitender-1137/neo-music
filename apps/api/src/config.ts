import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default("127.0.0.1"),
  WEB_ORIGINS: z.string().default("http://localhost:3000").transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  STREAM_SIGNING_SECRET: z.string().min(32, "STREAM_SIGNING_SECRET must be at least 32 chars"),
  MUSIC_PROVIDER: z.enum(["youtube", "dev"]).default("youtube"),
  YT_LOCATION: z.string().length(2).default("US"),
  YT_LANGUAGE: z.string().default("en"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Trust X-Forwarded-* from the reverse proxy (nginx) in production. */
  TRUST_PROXY: z.coerce.boolean().default(false),
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
  return parsed.data;
}
