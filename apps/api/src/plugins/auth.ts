/**
 * Cookie sessions.
 *
 * - The cookie holds a random 256-bit token; the DB stores only its SHA-256, so a DB leak does
 *   not yield usable sessions.
 * - HttpOnly + SameSite=Lax + Secure (in production). No tokens in localStorage.
 * - CSRF: every state-changing request must carry an Origin (or Referer) from WEB_ORIGINS.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { AppError, ErrorCode } from "@zuno/core";
import { userSessions } from "../db/schema";
import { originMatcher } from "../lib/origins";

export const SESSION_COOKIE = "zuno_session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

declare module "fastify" {
  interface FastifyRequest {
    userId: string | null;
    sessionTokenHash: string | null;
  }
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function requireUser(req: FastifyRequest): string {
  if (!req.userId) throw new AppError(ErrorCode.Unauthorized, "Sign in to do that", 401);
  return req.userId;
}

export async function registerAuth(app: FastifyInstance) {
  const { db, config } = app.ctx;
  const allowed = originMatcher(config.WEB_ORIGINS);
  // Tiny positive cache so a burst of requests doesn't hit Postgres each time.
  const recent = new Map<string, { userId: string; until: number }>();

  app.decorateRequest("userId", null);
  app.decorateRequest("sessionTokenHash", null);

  app.addHook("onRequest", async (req) => {
    if (!SAFE_METHODS.has(req.method) && req.url.startsWith("/api/")) {
      const origin = req.headers.origin ?? (req.headers.referer ? new URL(req.headers.referer).origin : undefined);
      if (!allowed(origin)) {
        throw new AppError(ErrorCode.Forbidden, "Cross-site request blocked", 403);
      }
    }
    const token = req.cookies[SESSION_COOKIE];
    if (!token || token.length > 128) return;
    const h = hashToken(token);
    const cached = recent.get(h);
    if (cached && cached.until > Date.now()) {
      req.userId = cached.userId;
      req.sessionTokenHash = h;
      return;
    }
    const row = await db.query.userSessions.findFirst({
      columns: { userId: true },
      where: and(eq(userSessions.tokenHash, h), gt(userSessions.expiresAt, new Date())),
    });
    if (row) {
      req.userId = row.userId;
      req.sessionTokenHash = h;
      recent.set(h, { userId: row.userId, until: Date.now() + 30_000 });
      if (recent.size > 5000) recent.clear();
    }
  });

  app.decorate("forgetSession", (h: string) => recent.delete(h));
}

declare module "fastify" {
  interface FastifyInstance {
    forgetSession(hash: string): void;
  }
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
