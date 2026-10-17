import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { users } from "../src/db/schema";
import { openMemory } from "../src/db/client";

/** The in-process database (DB_DRIVER=memory) on its own: migrations, data, persistence. */
describe("in-memory database", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-memdb-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("starts with the full schema applied and answers queries", async () => {
    const d = await openMemory();
    await d.ping();
    const { rows } = await d.query<{ n: number }>("select count(*)::int as n from information_schema.tables where table_schema = 'public'");
    expect(rows[0]!.n).toBeGreaterThan(10);
    await d.close();
  });

  it("pure memory: data is gone after a restart", async () => {
    const a = await openMemory();
    await a.db.insert(users).values({ email: "a@example.com", passwordHash: "x", displayName: "A" });
    await a.close();
    const b = await openMemory();
    expect(await b.db.select().from(users)).toHaveLength(0);
    await b.close();
  });

  it("with MEMORY_DB_DIR: data survives a restart, and migrations aren't re-applied", async () => {
    const a = await openMemory(dir);
    await a.db.insert(users).values({ email: "keep@example.com", passwordHash: "x", displayName: "Keep" });
    await a.close();
    const b = await openMemory(dir);
    const rows = await b.db.select().from(users);
    expect(rows.map((r) => r.email)).toEqual(["keep@example.com"]);
    await b.close();
  });
});
