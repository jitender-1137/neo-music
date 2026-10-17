/** Bounded LRU with per-entry TTL. Used for continuation handles and resolved streams. */
export class TtlCache<V> {
  private map = new Map<string, { value: V; expires: number }>();
  constructor(private readonly max: number, private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, hit); // refresh LRU position
    return hit.value;
  }

  set(key: string, value: V, ttlMs = this.ttlMs): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + ttlMs });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}

/** Single-flight: concurrent callers for the same key share one in-flight promise. */
export class SingleFlight<V> {
  private inflight = new Map<string, Promise<V>>();
  run(key: string, fn: () => Promise<V>): Promise<V> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}

/** Serialises async work — youtubei.js keeps po_token in one mutable session field. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
