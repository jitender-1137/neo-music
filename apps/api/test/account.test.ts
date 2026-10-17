import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { makeApp, client } from "./helpers";
import { processOutboxOnce } from "../src/lib/outbox";

let h: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => { h = await makeApp(); });
afterAll(async () => { await h.close(); });
const silent = { info() {}, warn() {}, error() {} };

describe("auth", () => {
  it("register → me → logout → me", async () => {
    const c = client(h.app);
    const u = await c.register();
    expect((await c.get("/api/v1/auth/me")).json().user.id).toBe(u.id);
    await c.post("/api/v1/auth/logout");
    expect((await c.get("/api/v1/auth/me")).json().user).toBeNull();
  });
  it("login rejects bad passwords with a generic message", async () => {
    const c = client(h.app);
    const u = await c.register();
    const bad = await client(h.app).post("/api/v1/auth/login", { email: u.email, password: "wrong-password!" });
    expect(bad.statusCode).toBe(401);
    const unknown = await client(h.app).post("/api/v1/auth/login", { email: "nobody@example.com", password: "wrong-password!" });
    expect(unknown.json().error.message).toBe(bad.json().error.message);
    const ok = await client(h.app).post("/api/v1/auth/login", { email: u.email.toUpperCase(), password: "correct-horse-battery" });
    expect(ok.statusCode).toBe(200);
  });
  it("rejects weak passwords and duplicate emails", async () => {
    expect((await client(h.app).post("/api/v1/auth/register", { email: "a@b.co", password: "short", displayName: "x" })).statusCode).toBe(400);
    const c = client(h.app); const u = await c.register();
    expect((await client(h.app).post("/api/v1/auth/register", { email: u.email, password: "correct-horse-battery", displayName: "x" })).statusCode).toBe(409);
  });
  it("protects library routes", async () => {
    expect((await client(h.app).get("/api/v1/library/likes")).statusCode).toBe(401);
  });
  it("password change revokes other sessions", async () => {
    const a = client(h.app); const u = await a.register();
    const b = client(h.app); await b.post("/api/v1/auth/login", { email: u.email, password: "correct-horse-battery" });
    expect((await a.post("/api/v1/account/password", { currentPassword: "correct-horse-battery", newPassword: "another-long-password" })).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    // b's cached session entry may survive ≤30s in-process; a fresh app instance would reject it. Verify at the DB level instead:
    const rows = await h.query<any>("select count(*)::int as n from user_sessions where user_id = $1", [u.id]);
    expect(rows.rows[0].n).toBe(1);
  });
});

describe("library", () => {
  it("likes are idempotent and listed newest first", async () => {
    const c = client(h.app); await c.register();
    expect((await c.put("/api/v1/library/likes/dev-01")).statusCode).toBe(200);
    expect((await c.put("/api/v1/library/likes/dev-01")).statusCode).toBe(200);
    await c.put("/api/v1/library/likes/dev-02");
    const list = (await c.get("/api/v1/library/likes")).json();
    expect(list.items.map((t: { id: string }) => t.id)).toEqual(["dev-02", "dev-01"]);
    const st = (await c.get("/api/v1/library/status?ids=dev-01,dev-03")).json();
    expect(st.likes).toEqual(["dev-01"]);
    await c.del("/api/v1/library/likes/dev-01");
    expect((await c.get("/api/v1/library/likes")).json().items).toHaveLength(1);
  });
  it("refuses to like unknown tracks", async () => {
    const c = client(h.app); await c.register();
    expect((await c.put("/api/v1/library/likes/not-real")).statusCode).toBe(404);
  });
});

describe("playlists", () => {
  it("CRUD, duplicates, reorder, optimistic concurrency, privacy", async () => {
    const owner = client(h.app); await owner.register();
    const p = (await owner.post("/api/v1/me/playlists", { title: "Mix", trackIds: ["dev-01"] })).json();
    const add = (await owner.post(`/api/v1/user-playlists/${p.id}/tracks`, { trackIds: ["dev-01", "dev-02", "dev-03"] })).json();
    expect(add).toMatchObject({ added: 2, skippedDuplicates: ["dev-01"] });
    let d = (await owner.get(`/api/v1/user-playlists/${p.id}`)).json();
    expect(d.entries.map((e: { track: { id: string } }) => e.track.id)).toEqual(["dev-01", "dev-02", "dev-03"]);
    const last = d.entries[2].entryId;
    expect((await owner.post(`/api/v1/user-playlists/${p.id}/reorder`, { entryId: last, toPosition: 0, version: d.playlist.version })).statusCode).toBe(200);
    expect((await owner.post(`/api/v1/user-playlists/${p.id}/reorder`, { entryId: last, toPosition: 1, version: d.playlist.version })).statusCode).toBe(409);
    d = (await owner.get(`/api/v1/user-playlists/${p.id}`)).json();
    expect(d.entries.map((e: { track: { id: string }; position: number }) => `${e.position}:${e.track.id}`)).toEqual(["0:dev-03", "1:dev-01", "2:dev-02"]);
    await owner.del(`/api/v1/user-playlists/${p.id}/tracks/${d.entries[1].entryId}`);
    d = (await owner.get(`/api/v1/user-playlists/${p.id}`)).json();
    expect(d.entries.map((e: { position: number }) => e.position)).toEqual([0, 1]);

    const stranger = client(h.app); await stranger.register();
    expect((await stranger.get(`/api/v1/user-playlists/${p.id}`)).statusCode).toBe(404);
    expect((await stranger.patch(`/api/v1/user-playlists/${p.id}`, { title: "pwned" })).statusCode).toBe(404);
    expect((await stranger.del(`/api/v1/user-playlists/${p.id}`)).statusCode).toBe(404);
    await owner.patch(`/api/v1/user-playlists/${p.id}`, { visibility: "unlisted" });
    expect((await stranger.get(`/api/v1/user-playlists/${p.id}`)).statusCode).toBe(200);
    expect((await stranger.post(`/api/v1/user-playlists/${p.id}/tracks`, { trackIds: ["dev-04"] })).statusCode).toBe(404);
  });
  it("concurrent adds keep positions dense and unique", async () => {
    const c = client(h.app); await c.register();
    const p = (await c.post("/api/v1/me/playlists", { title: "Race" })).json();
    await Promise.all(["dev-01", "dev-02", "dev-03", "dev-04", "dev-05"].map((id) => c.post(`/api/v1/user-playlists/${p.id}/tracks`, { trackIds: [id] })));
    const d = (await c.get(`/api/v1/user-playlists/${p.id}`)).json();
    expect(d.entries.map((e: { position: number }) => e.position)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("guest import", () => {
  it("is idempotent on retry", async () => {
    const c = client(h.app); await c.register();
    const body = {
      idempotencyKey: randomUUID(), likes: ["dev-01", "dev-02", "bogus"], albums: ["dev-album-1"],
      playlists: [{ localId: "local-1", title: "Guest list", trackIds: ["dev-03", "dev-04"] }],
      history: [{ trackId: "dev-05", playedAt: new Date().toISOString(), eventId: randomUUID() }],
    };
    const first = (await c.post("/api/v1/library/import", body)).json();
    expect(first.imported).toMatchObject({ likes: 2, albums: 1, playlists: 1, history: 1 });
    const again = (await c.post("/api/v1/library/import", body)).json();
    expect(again).toEqual(first);
    expect((await c.get("/api/v1/me/playlists")).json().items).toHaveLength(1);
    expect((await c.get("/api/v1/library/likes")).json().items).toHaveLength(2);
  });
});

describe("events → outbox → profile", () => {
  it("dedupes events and builds history + affinity", async () => {
    const c = client(h.app); await c.register();
    const now = new Date().toISOString();
    const events = [
      { eventId: randomUUID(), type: "start", trackId: "dev-01", artistIds: ["dev-artist-1"], occurredAt: now },
      { eventId: randomUUID(), type: "qualified", trackId: "dev-01", artistIds: ["dev-artist-1"], msPlayed: 30000, durationMs: 40000, occurredAt: now },
      { eventId: randomUUID(), type: "search", context: { query: "tones" }, occurredAt: now },
    ];
    expect((await c.post("/api/v1/events", { events })).json()).toEqual({ accepted: 3, duplicates: 0 });
    expect((await c.post("/api/v1/events", { events })).json()).toEqual({ accepted: 0, duplicates: 3 });
    while ((await processOutboxOnce(h.ctx.db, silent)) > 0) { /* drain */ }
    expect((await c.get("/api/v1/history")).json().items[0].track.id).toBe("dev-01");
    expect((await c.get("/api/v1/search/history")).json().queries).toEqual(["tones"]);
    const recs = (await c.get("/api/v1/recommendations/home")).json();
    expect(recs.personalized).toBe(true);
    expect(recs.shelves[0].id).toBe("quick-picks");
  });
  it("dead-letters a poison job after max attempts", async () => {
    await h.query<any>("insert into outbox_events (topic, payload, attempts) values ('bogus', '{}', 7)");
    await processOutboxOnce(h.ctx.db, silent);
    const r = await h.query<any>("select failed_at is not null as dead from outbox_events where topic='bogus'");
    expect(r.rows[0].dead).toBe(true);
  });
  it("account deletion cascades", async () => {
    const c = client(h.app); const u = await c.register();
    await c.put("/api/v1/library/likes/dev-01");
    expect((await c.del("/api/v1/account", { password: "correct-horse-battery" })).statusCode).toBe(200);
    const r = await h.query<any>("select count(*)::int n from user_likes where user_id=$1", [u.id]);
    expect(r.rows[0].n).toBe(0);
  });
});
