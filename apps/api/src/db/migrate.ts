import { migrate } from "drizzle-orm/node-postgres/migrator";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createDb } from "./client";

export async function runMigrations(url: string): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/db (tsx) → ../../drizzle ; dist (bundled) → ../drizzle
  const folder = [path.resolve(here, "../../drizzle"), path.resolve(here, "../drizzle")].find(existsSync);
  if (!folder) throw new Error("migrations folder not found");
  const { db, pool } = createDb(url, 1);
  try {
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
  return folder;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const folder = await runMigrations(url);
  console.log("migrations applied from", folder);
}
