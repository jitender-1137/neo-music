import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { hash, verify } from "@node-rs/argon2";
import { and, eq, ne, sql } from "drizzle-orm";
import { AppError, ErrorCode, AudioQuality } from "@zuno/core";
import {
  auditEvents, listeningHistory, playlistTracks, playlists, searchHistory, userFollowedArtists, userLikes,
  userPreferences, userSavedAlbums, userSavedPlaylists, userSessions, users,
} from "../db/schema";
import { SESSION_COOKIE, hashToken, newSessionToken, requireUser } from "../plugins/auth";

// OWASP-recommended argon2id parameters (m=19 MiB, t=2, p=1).
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const Email = z.string().trim().toLowerCase().email().max(320);
const Password = z.string().min(10, "Use at least 10 characters").max(200);
const PublicUser = z.object({ id: z.string(), email: z.string(), displayName: z.string(), createdAt: z.string() });
const Prefs = z.object({ audioQuality: AudioQuality, hideExplicit: z.boolean(), seedArtists: z.array(z.object({ id: z.string(), name: z.string() })) });

// Verify against a real hash when the user doesn't exist, so timing doesn't reveal accounts.
const DUMMY_HASH = await hash("not-a-real-password-zuno", ARGON);

export async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, config } = app.ctx;
  const authLimit = { rateLimit: { max: config.AUTH_RATE_LIMIT_PER_MIN, timeWindow: "1 minute" } };

  async function startSession(reply: FastifyReply, userId: string, userAgent?: string) {
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 86400_000);
    await db.insert(userSessions).values({ tokenHash: hashToken(token), userId, expiresAt, userAgent: userAgent?.slice(0, 300) });
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: config.NODE_ENV === "production", path: "/", expires: expiresAt,
    });
  }
  const toPublic = (u: typeof users.$inferSelect) => ({ id: u.id, email: u.email, displayName: u.displayName, createdAt: u.createdAt.toISOString() });

  r.post("/api/v1/auth/register", {
    schema: { tags: ["auth"], body: z.object({ email: Email, password: Password, displayName: z.string().trim().min(1).max(80) }), response: { 200: z.object({ user: PublicUser }) } },
    config: authLimit,
  }, async (req, reply) => {
    const { email, password, displayName } = req.body;
    const passwordHash = await hash(password, ARGON);
    const user = await db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({ email, passwordHash, displayName }).onConflictDoNothing().returning();
      if (!u) throw new AppError(ErrorCode.Conflict, "An account with this email already exists", 409);
      await tx.insert(userPreferences).values({ userId: u.id });
      await tx.insert(auditEvents).values({ userId: u.id, action: "account.register" });
      return u;
    });
    await startSession(reply, user.id, req.headers["user-agent"]);
    return { user: toPublic(user) };
  });

  r.post("/api/v1/auth/login", {
    schema: { tags: ["auth"], body: z.object({ email: Email, password: z.string().min(1).max(200) }), response: { 200: z.object({ user: PublicUser }) } },
    config: authLimit,
  }, async (req, reply) => {
    const { email, password } = req.body;
    const user = await db.query.users.findFirst({ where: sql`lower(${users.email}) = ${email}` });
    const ok = await verify(user?.passwordHash ?? DUMMY_HASH, password);
    if (!user || !ok) {
      await db.insert(auditEvents).values({ userId: user?.id ?? null, action: "auth.login_failed" });
      throw new AppError(ErrorCode.Unauthorized, "Email or password is incorrect", 401);
    }
    await startSession(reply, user.id, req.headers["user-agent"]);
    await db.insert(auditEvents).values({ userId: user.id, action: "auth.login" });
    return { user: toPublic(user) };
  });

  r.post("/api/v1/auth/logout", { schema: { tags: ["auth"] } }, async (req, reply) => {
    if (req.sessionTokenHash) {
      await db.delete(userSessions).where(eq(userSessions.tokenHash, req.sessionTokenHash));
      app.forgetSession(req.sessionTokenHash);
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  r.get("/api/v1/auth/me", { schema: { tags: ["auth"], response: { 200: z.object({ user: PublicUser.nullable(), preferences: Prefs.nullable() }) } } }, async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    if (!req.userId) return { user: null, preferences: null };
    const user = await db.query.users.findFirst({ where: eq(users.id, req.userId) });
    if (!user) return { user: null, preferences: null };
    const prefs = await db.query.userPreferences.findFirst({ where: eq(userPreferences.userId, user.id) });
    return { user: toPublic(user), preferences: prefs ? { audioQuality: prefs.audioQuality, hideExplicit: prefs.hideExplicit, seedArtists: prefs.seedArtists } : null };
  });

  r.patch("/api/v1/account", {
    schema: { tags: ["account"], body: z.object({ displayName: z.string().trim().min(1).max(80) }), response: { 200: z.object({ user: PublicUser }) } },
  }, async (req) => {
    const userId = requireUser(req);
    const [u] = await db.update(users).set({ displayName: req.body.displayName, updatedAt: new Date() }).where(eq(users.id, userId)).returning();
    return { user: toPublic(u!) };
  });

  r.put("/api/v1/account/preferences", { schema: { tags: ["account"], body: Prefs.partial(), response: { 200: Prefs } } }, async (req) => {
    const userId = requireUser(req);
    const [p] = await db.insert(userPreferences).values({ userId, ...req.body })
      .onConflictDoUpdate({ target: userPreferences.userId, set: { ...req.body, updatedAt: new Date() } }).returning();
    return { audioQuality: p!.audioQuality, hideExplicit: p!.hideExplicit, seedArtists: p!.seedArtists };
  });

  r.post("/api/v1/account/password", {
    schema: { tags: ["account"], body: z.object({ currentPassword: z.string().min(1).max(200), newPassword: Password }) },
    config: authLimit,
  }, async (req) => {
    const userId = requireUser(req);
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user || !(await verify(user.passwordHash, req.body.currentPassword))) throw new AppError(ErrorCode.Unauthorized, "Current password is incorrect", 401);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash: await hash(req.body.newPassword, ARGON), updatedAt: new Date() }).where(eq(users.id, userId));
      // Revoke every other session.
      await tx.delete(userSessions).where(and(eq(userSessions.userId, userId), ne(userSessions.tokenHash, req.sessionTokenHash ?? "")));
      await tx.insert(auditEvents).values({ userId, action: "account.password_changed" });
    });
    return { ok: true };
  });

  r.get("/api/v1/account/export", { schema: { tags: ["account"] } }, async (req, reply) => {
    const userId = requireUser(req);
    const [user, likes, albums, artists, saved, pls, history, searches] = await Promise.all([
      db.query.users.findFirst({ where: eq(users.id, userId), columns: { passwordHash: false } }),
      db.select().from(userLikes).where(eq(userLikes.userId, userId)),
      db.select().from(userSavedAlbums).where(eq(userSavedAlbums.userId, userId)),
      db.select().from(userFollowedArtists).where(eq(userFollowedArtists.userId, userId)),
      db.select().from(userSavedPlaylists).where(eq(userSavedPlaylists.userId, userId)),
      db.query.playlists.findMany({ where: eq(playlists.ownerId, userId) }),
      db.select().from(listeningHistory).where(eq(listeningHistory.userId, userId)),
      db.select().from(searchHistory).where(eq(searchHistory.userId, userId)),
    ]);
    const tracks = pls.length ? await db.select().from(playlistTracks).where(sql`${playlistTracks.playlistId} in ${pls.map((p) => p.id)}`) : [];
    reply.header("Content-Disposition", 'attachment; filename="zuno-export.json"').header("Cache-Control", "private, no-store");
    return { exportedAt: new Date().toISOString(), user, likes, albums, artists, savedPlaylists: saved, playlists: pls.map((p) => ({ ...p, tracks: tracks.filter((t) => t.playlistId === p.id) })), history, searches };
  });

  r.delete("/api/v1/account", { schema: { tags: ["account"], body: z.object({ password: z.string().min(1).max(200) }) }, config: authLimit }, async (req, reply) => {
    const userId = requireUser(req);
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user || !(await verify(user.passwordHash, req.body.password))) throw new AppError(ErrorCode.Unauthorized, "Password is incorrect", 401);
    await db.transaction(async (tx) => {
      await tx.insert(auditEvents).values({ userId: null, action: "account.deleted", detail: { userId } });
      await tx.delete(users).where(eq(users.id, userId)); // cascades to every user-owned row
    });
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
}
