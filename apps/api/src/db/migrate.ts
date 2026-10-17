import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, migrationsFolder } from "./client";

/** Apply the SQL migrations to a PostgreSQL server (the in-memory database migrates itself at startup). */
export async function runMigrations(url: string): Promise<string> {
  const folder = migrationsFolder();
  const { db, pool } = createDb(url, 1);
  try {
    await migrate(db as never, { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
  return folder;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.env.DB_DRIVER === "memory") {
    console.log("DB_DRIVER=memory: nothing to migrate here (the API applies migrations to its in-memory database at startup)");
  } else {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    const folder = await runMigrations(url);
    console.log("migrations applied from", folder);
  }
}
