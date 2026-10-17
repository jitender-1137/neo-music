import { Redis } from "ioredis";
import pino from "pino";
import { sql } from "drizzle-orm";
import { DevToneProvider } from "@zuno/provider/dev";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { JsonCache } from "../src/lib/cache";
import { buildServer } from "../src/server";
import type { AppContext } from "../src/context";

export const ORIGIN = "http://localhost:3000";
const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://zuno:zuno_dev_password@127.0.0.1:5433/zuno_test";
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/15";

/** Real Postgres + Redis (db 15), dev tone provider. Tables are truncated per test file. */
export async function makeApp() {
  await runMigrations(DB_URL);
  const config = loadConfig({
    NODE_ENV: "test", DATABASE_URL: DB_URL, REDIS_URL, STREAM_SIGNING_SECRET: "test-secret-test-secret-test-secret-123",
    MUSIC_PROVIDER: "dev", WEB_ORIGINS: ORIGIN, LOG_LEVEL: "silent", WORKER_INLINE: "false", AUTH_RATE_LIMIT_PER_MIN: "10000",
  } as NodeJS.ProcessEnv);
  const { db, pool } = createDb(DB_URL, 5);
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  await redis.flushdb();
  await db.execute(sql`truncate users, catalog_items, listening_events, outbox_events, track_cooccurrences, recommendation_configs, audit_events restart identity cascade`);
  const ctx: AppContext = { config, provider: new DevToneProvider(), db, pool, redis, cache: new JsonCache(redis, pino({ level: "silent" })) };
  const app = await buildServer(ctx);
  await app.ready();
  return {
    app, ctx,
    async close() { await app.close(); await pool.end(); redis.disconnect(); },
  };
}

type Inject = Awaited<ReturnType<typeof makeApp>>["app"];

/** A cookie-carrying client for one user. */
export function client(app: Inject) {
  let cookie = "";
  const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({
      method: method as never, url, payload: body as never,
      headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...headers },
    });
    const set = res.headers["set-cookie"];
    if (set) cookie = (Array.isArray(set) ? set : [set]).map((c) => c.split(";")[0]).join("; ");
    return res;
  };
  return {
    get: (u: string, h?: Record<string, string>) => call("GET", u, undefined, h),
    post: (u: string, b?: unknown, h?: Record<string, string>) => call("POST", u, b ?? {}, h),
    put: (u: string, b?: unknown) => call("PUT", u, b),
    patch: (u: string, b?: unknown) => call("PATCH", u, b),
    del: (u: string, b?: unknown) => call("DELETE", u, b),
    async register(email = `u${Math.random().toString(36).slice(2)}@example.com`) {
      const r = await call("POST", "/api/v1/auth/register", { email, password: "correct-horse-battery", displayName: "Test" });
      if (r.statusCode !== 200) throw new Error(r.body);
      return r.json().user as { id: string; email: string };
    },
  };
}
