/** Background worker process: outbox processing + periodic housekeeping. */
import pino from "pino";
import { lt } from "drizzle-orm";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { startOutboxLoop } from "./lib/outbox";
import { userSessions } from "./db/schema";

const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL, name: "worker" });
const { db, pool } = createDb(config.DATABASE_URL, 4);
const stop = startOutboxLoop(db, log);

const housekeeping = setInterval(async () => {
  try {
    const gone = await db.delete(userSessions).where(lt(userSessions.expiresAt, new Date())).returning({ h: userSessions.tokenHash });
    if (gone.length) log.info({ count: gone.length }, "expired sessions removed");
  } catch (err) {
    log.warn({ err: (err as Error).message }, "housekeeping failed");
  }
}, 3600_000);

async function shutdown() {
  clearInterval(housekeeping);
  await stop();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
log.info("worker started");
