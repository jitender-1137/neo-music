import { loadConfig } from "./config";
import { createContext } from "./bootstrap";
import { buildServer } from "./server";
import { startOutboxLoop } from "./lib/outbox";

const config = loadConfig();
const ctx = await createContext(config);
const app = await buildServer(ctx);
const stopWorker = config.WORKER_INLINE ? startOutboxLoop(ctx.db, app.log) : null;

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  const force = setTimeout(() => process.exit(1), 15_000).unref();
  try {
    await app.close(); // stops accepting, waits for in-flight requests
    await stopWorker?.();
    await ctx.database.close();
    ctx.redis?.disconnect();
  } finally {
    clearTimeout(force);
    process.exit(0);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: config.HOST });
