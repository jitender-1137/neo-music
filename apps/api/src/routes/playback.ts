import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { AppError, AudioQuality, ErrorCode, PlaybackSession } from "@zuno/core";
import type { StreamSource } from "@zuno/provider";
import { issuePlaybackToken, streamPath, verifyPlaybackToken, verifyStream } from "../lib/streamSign";
import { parseRange } from "../lib/range";
import { Semaphore } from "../lib/semaphore";

const SIGNED_URL_TTL_S = 12 * 3600;
const DEFAULT_CHUNK = 2 * 1024 * 1024;

const baseMime = (m: string) => m.split(";")[0]!.trim();

export async function playbackRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { provider, config } = app.ctx;
  const upstreamSlots = new Semaphore(config.STREAM_MAX_CONCURRENCY);
  const { redis } = app.ctx;
  /**
   * Stream resolution (the slow step: asking YouTube where a song's audio lives) is cached in the
   * provider's memory and in Redis, so it survives API restarts and is shared across instances.
   * Entries expire a few minutes before the signed upstream URL does. v2: drops pre-fix entries that
   * may point Safari at HE-AAC (wrong duration).
   */
  const STREAM_KEY = (id: string, q: string, mp4: boolean) => `stream:v2:${id}:${q}:${mp4 ? "mp4" : "any"}`;
  async function resolveCached(trackId: string, opts: { quality: AudioQuality; preferMp4: boolean }): Promise<StreamSource> {
    const key = STREAM_KEY(trackId, opts.quality, opts.preferMp4);
    if (redis) {
      try {
        const hit = await redis.get(key);
        if (hit) { const s = JSON.parse(hit) as StreamSource; if (s.kind === "http" && s.expiresAt - Date.now() > 10 * 60_000) return s; }
      } catch { /* cache is best-effort */ }
    }
    const src = await provider.resolveStream(trackId, opts);
    if (redis && src.kind === "http") {
      const ttl = Math.floor((src.expiresAt - Date.now()) / 1000) - 300;
      if (ttl > 60) redis.set(key, JSON.stringify(src), "EX", ttl).catch(() => undefined);
    }
    return src;
  }
  const invalidate = (id: string) => {
    (provider as { invalidateStream?: (id: string) => void }).invalidateStream?.(id);
    if (redis) for (const q of ["auto", "low", "normal", "high"]) for (const m of [true, false]) redis.del(STREAM_KEY(id, q, m)).catch(() => undefined);
  };

  r.post("/api/v1/playback/token", {
    schema: { tags: ["playback"], response: { 200: z.object({ token: z.string(), expiresAt: z.string() }) } },
    config: { rateLimit: { max: config.PLAYBACK_TOKEN_RATE_LIMIT_PER_MIN, timeWindow: "1 minute" } },
  }, async (_req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const { token, exp } = issuePlaybackToken(config.STREAM_SIGNING_SECRET, 24 * 3600);
    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  });

  r.post("/api/v1/playback/sessions", {
    schema: {
      tags: ["playback"],
      body: z.object({ trackId: z.string().min(1).max(64).regex(/^[\w-]+$/), quality: AudioQuality.default("auto"), preferMp4: z.boolean().default(true) }),
      response: { 200: PlaybackSession },
    },
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
  }, async (req) => {
    const { trackId, quality, preferMp4 } = req.body;
    // Resolve now so an unavailable track fails here with a clear error, not as a broken <audio>.
    const src = await resolveCached(trackId, { quality, preferMp4 });
    const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_S;
    return {
      sessionId: randomUUID(),
      trackId,
      streamUrl: streamPath(config.STREAM_SIGNING_SECRET, { trackId, quality, mp4: preferMp4, exp }),
      mimeType: baseMime(src.mimeType),
      bitrate: src.kind === "http" ? src.bitrate : undefined,
      contentLength: src.kind === "http" ? src.contentLength : src.data.byteLength,
      durationSec: src.durationSec,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  });

  r.get("/api/v1/stream/:trackId", {
    schema: {
      tags: ["playback"],
      params: z.object({ trackId: z.string().min(1).max(64).regex(/^[\w-]+$/) }),
      querystring: z.object({
        q: AudioQuality, f: z.enum(["mp4", "any"]),
        // Either a per-URL signature (exp+sig) or a device playback token (t).
        exp: z.coerce.number().int().optional(), sig: z.string().max(100).optional(), t: z.string().max(200).optional(),
      }),
    },
    // Safari issues many small range requests while seeking; allow far more than catalog routes.
    config: { rateLimit: { max: config.STREAM_RATE_LIMIT_PER_MIN, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const { trackId } = req.params;
    const { q, f, exp, sig, t } = req.query;
    const claims = { trackId, quality: q, mp4: f === "mp4", exp: exp ?? 0 };
    const authorized = t ? verifyPlaybackToken(config.STREAM_SIGNING_SECRET, t) : verifyStream(config.STREAM_SIGNING_SECRET, claims, sig ?? "");
    if (!authorized) {
      throw new AppError(ErrorCode.Forbidden, "Stream link is invalid or expired", 403);
    }
    let src = await resolveCached(trackId, { quality: q, preferMp4: claims.mp4 });
    const size = src.kind === "http" ? src.contentLength : src.data.byteLength;
    const range = parseRange(req.headers.range, size);
    if (range === "unsatisfiable") {
      return reply.status(416).header("Content-Range", `bytes */${size}`).send();
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    reply
      .status(range ? 206 : 200)
      .header("Content-Type", baseMime(src.mimeType))
      .header("Accept-Ranges", "bytes")
      .header("Content-Length", String(end - start + 1))
      // Signed URL → per-user private cache only; never in shared caches or the service worker.
      .header("Cache-Control", "private, max-age=3600, no-transform")
      // Stable validator: same track + quality + format + exact byte length ⇒ same bytes.
      .header("ETag", `"${trackId}-${q}-${claims.mp4 ? "m" : "a"}-${size}"`)
      .header("X-Content-Type-Options", "nosniff");
    if (range) reply.header("Content-Range", `bytes ${start}-${end}/${size}`);
    if (req.method === "HEAD") return reply.send();

    if (src.kind === "buffer") return reply.send(Buffer.from(src.data.subarray(start, end + 1)));

    const release = upstreamSlots.tryAcquire();
    if (!release) throw new AppError(ErrorCode.ProviderUnavailable, "Server busy, retry shortly", 503);
    const abort = new AbortController();
    req.raw.on("close", () => abort.abort());

    const chunkSize = src.maxChunkBytes ?? DEFAULT_CHUNK;
    const log = req.log;
    async function* body(): AsyncGenerator<Buffer> {
      let pos = start;
      let retried = false;
      try {
        while (pos <= end) {
          const to = Math.min(pos + chunkSize - 1, end);
          const http = src as Extract<StreamSource, { kind: "http" }>;
          const res = await fetch(http.url, {
            headers: { ...http.headers, Range: `bytes=${pos}-${to}` },
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]),
          });
          if ((res.status === 403 || res.status === 410) && !retried) {
            // Signed upstream URL expired or was revoked: re-resolve once and continue.
            retried = true;
            await res.body?.cancel();
            invalidate(trackId);
            src = await resolveCached(trackId, { quality: q, preferMp4: claims.mp4 });
            continue;
          }
          if (res.status !== 206 && res.status !== 200) {
            await res.body?.cancel();
            throw new Error(`upstream HTTP ${res.status}`);
          }
          for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
            pos += part.byteLength;
            yield Buffer.from(part);
          }
        }
      } catch (err) {
        if (!abort.signal.aborted) log.warn({ err: (err as Error).message, trackId }, "stream proxy aborted");
        throw err;
      } finally {
        release!();
      }
    }
    return reply.send(Readable.from(body()));
  });
}

export type { FastifyReply };
