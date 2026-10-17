/**
 * Redis JSON cache with stale-while-revalidate and per-key single flight.
 *
 * Redis is an optimisation, not a dependency: every Redis error degrades to calling the loader
 * directly, so a Redis outage slows the catalog down rather than taking it offline.
 */
import type { Redis } from "ioredis";
import type { FastifyBaseLogger } from "fastify";

export interface CacheOptions {
  /** Served as fresh for this long. */
  ttlSec: number;
  /** After `ttlSec`, served stale (with a background refresh) for this much longer. */
  staleSec?: number;
}

type Envelope<T> = { v: T; at: number };

export class JsonCache {
  private inflight = new Map<string, Promise<unknown>>();
  constructor(private readonly redis: Redis | null, private readonly log: FastifyBaseLogger, private readonly prefix = "zc:v1:") {}

  async get<T>(key: string, opts: CacheOptions, loader: () => Promise<T>): Promise<T> {
    const k = this.prefix + key;
    const env = await this.read<T>(k);
    const age = env ? (Date.now() - env.at) / 1000 : Infinity;
    if (env && age < opts.ttlSec) return env.v;
    if (env && age < opts.ttlSec + (opts.staleSec ?? 0)) {
      void this.load(k, opts, loader).catch((err) => this.log.warn({ err, key }, "background refresh failed"));
      return env.v;
    }
    return this.load(k, opts, loader);
  }

  async del(key: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.del(this.prefix + key).catch(() => undefined);
  }

  private load<T>(k: string, opts: CacheOptions, loader: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(k);
    if (existing) return existing as Promise<T>;
    const p = (async () => {
      const value = await loader();
      await this.write(k, value, opts.ttlSec + (opts.staleSec ?? 0));
      return value;
    })().finally(() => this.inflight.delete(k));
    this.inflight.set(k, p);
    return p;
  }

  private async read<T>(k: string): Promise<Envelope<T> | null> {
    if (!this.redis || this.redis.status !== "ready") return null;
    try {
      const raw = await this.redis.get(k);
      return raw ? (JSON.parse(raw) as Envelope<T>) : null;
    } catch (err) {
      this.log.warn({ err }, "cache read failed");
      return null;
    }
  }

  private async write<T>(k: string, v: T, ttlSec: number): Promise<void> {
    if (!this.redis || this.redis.status !== "ready") return;
    try {
      await this.redis.set(k, JSON.stringify({ v, at: Date.now() } satisfies Envelope<T>), "EX", Math.max(1, Math.ceil(ttlSec)));
    } catch (err) {
      this.log.warn({ err }, "cache write failed");
    }
  }
}
