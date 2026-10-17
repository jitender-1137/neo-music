import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import * as schema from "./schema";

/** The Drizzle database, whichever driver is behind it (node-postgres or PGlite). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** A database plus what the process needs to manage it. */
export interface Database {
  db: Db;
  driver: "postgres" | "memory";
  /** Throws if the database can't answer (readiness checks). */
  ping(): Promise<void>;
  /** Raw SQL with $1… parameters (maintenance and tests; app code uses `db`). */
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

export function createDb(url: string, max = 10): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    application_name: "zuno-api",
  });
  return { db: drizzle(pool, { schema }) as unknown as Db, pool };
}

/** The SQL migrations folder (src/db under tsx → ../../drizzle; bundled dist → ../drizzle). */
export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const folder = [path.resolve(here, "../../drizzle"), path.resolve(here, "../drizzle")].find(existsSync);
  if (!folder) throw new Error("migrations folder not found");
  return folder;
}

/** PostgreSQL server at `url` (migrations are a separate step: `db:migrate`). */
export function openPostgres(url: string, max = 10): Database {
  const { db, pool } = createDb(url, max);
  return {
    db,
    driver: "postgres",
    ping: async () => { await pool.query("select 1"); },
    query: async <T,>(text: string, params?: unknown[]) => ({ rows: (await pool.query(text, params)).rows as T[] }),
    close: () => pool.end(),
  };
}

/**
 * PostgreSQL inside this process (PGlite): in RAM, or in `dir` when given so it survives restarts.
 * Migrations are applied here, at startup, because no other process can reach this database.
 * Loaded on demand so a Postgres-only deployment never loads it.
 */
export async function openMemory(dir?: string): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzleLite } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(dir ?? "memory://");
  await client.waitReady;
  const db = drizzleLite(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: migrationsFolder() });
  return {
    db,
    driver: "memory",
    ping: async () => { await client.query("select 1"); },
    query: async <T,>(text: string, params?: unknown[]) => ({ rows: (await client.query<T>(text, params)).rows }),
    close: () => client.close(),
  };
}

export function openDatabase(config: { DB_DRIVER: "postgres" | "memory"; DATABASE_URL?: string; MEMORY_DB_DIR?: string }): Promise<Database> {
  if (config.DB_DRIVER === "memory") return openMemory(config.MEMORY_DB_DIR);
  return Promise.resolve(openPostgres(config.DATABASE_URL!));
}
