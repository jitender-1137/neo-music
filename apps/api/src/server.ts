import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import underPressure from "@fastify/under-pressure";
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import type { AppContext } from "./context";
import { registerErrorHandling } from "./plugins/errors";
import { registerAuth } from "./plugins/auth";
import { catalogRoutes } from "./routes/catalog";
import { playbackRoutes } from "./routes/playback";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { libraryRoutes } from "./routes/library";
import { playlistRoutes } from "./routes/playlists";
import { eventRoutes } from "./routes/events";
import { recommendationRoutes } from "./routes/recommendations";
import { importRoutes } from "./routes/import";
import { originMatcher } from "./lib/origins";

export async function buildServer(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: ctx.config.NODE_ENV === "test" ? false : {
      level: ctx.config.LOG_LEVEL,
      redact: { paths: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]', "*.password", "*.passwordHash"], censor: "[redacted]" },
      serializers: {
        // Strip query strings: stream signatures and search text don't belong in logs.
        req: (req) => ({ method: req.method, url: req.url.split("?")[0], id: req.id }),
      },
    },
    genReqId: (req) => (typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"].length <= 64 ? req.headers["x-request-id"] : randomUUID()),
    trustProxy: ctx.config.TRUST_PROXY,
    bodyLimit: 256 * 1024,
    requestTimeout: 30_000,
    // Long audio responses must not be cut by the request timeout; connections idle out instead.
    connectionTimeout: 0,
    keepAliveTimeout: 65_000,
  });

  app.decorate("ctx", ctx);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  app.addHook("onSend", async (req, reply) => { reply.header("X-Request-Id", req.id); });

  // Load shedding: answer 503 (Retry-After) instead of degrading everyone when the event loop or heap is saturated.
  await app.register(underPressure, {
    maxEventLoopDelay: 1000,
    maxHeapUsedBytes: 1.5 * 1024 ** 3,
    maxRssBytes: 2 * 1024 ** 3,
    retryAfter: 10,
    pressureHandler: (_req, reply, type, value) => {
      void reply.status(503).header("Retry-After", "10").send({ error: { code: "provider_unavailable", message: "Server is busy, try again shortly" } });
      app.log.warn({ type, value }, "under pressure: shedding load");
    },
  });
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } });
  const allowOrigin = originMatcher(ctx.config.WEB_ORIGINS);
  await app.register(cors, { origin: (o, cb) => cb(null, !o || allowOrigin(o)), credentials: true, methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: ctx.config.RATE_LIMIT_PER_MIN,
    timeWindow: "1 minute",
    redis: ctx.redis ?? undefined,
    skipOnError: true, // a Redis outage must not block every request
    nameSpace: "zuno-rl:",
  });
  await app.register(swagger, {
    openapi: { info: { title: "Neo Music API", version: "1.0.0" }, servers: [] },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  await registerAuth(app);
  await app.register(healthRoutes);
  await app.register(catalogRoutes);
  await app.register(playbackRoutes);
  await app.register(authRoutes);
  await app.register(libraryRoutes);
  await app.register(playlistRoutes);
  await app.register(eventRoutes);
  await app.register(recommendationRoutes);
  await app.register(importRoutes);
  return app;
}
