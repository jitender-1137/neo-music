"use client";
/**
 * Listening-event queue: persisted in IndexedDB first, flushed in bounded batches with
 * exponential backoff + jitter, a max attempt count, and a 30-day age limit. Flushes are
 * opportunistic (interval, online, visibilitychange→hidden) — iOS may suspend the page at any
 * time, and nothing here assumes JS keeps running in the background.
 */
import { db, type QueuedEvent } from "./guestDb";
import { getPrefs } from "./prefs";

const BATCH = 50;
const MAX_ATTEMPTS = 8;
const MAX_AGE_MS = 30 * 86_400_000;
let flushing = false;
let started = false;

export type EventInput = {
  type: string;
  trackId?: string;
  artistIds?: string[];
  msPlayed?: number;
  durationMs?: number;
  context?: Record<string, string>;
};

const uuid = () => crypto.randomUUID();

export async function track(e: EventInput): Promise<string> {
  const eventId = uuid();
  const body = { eventId, ...e, context: { ...(e.context ?? {}), anon: getPrefs().anonId }, occurredAt: new Date().toISOString() };
  try {
    await (await db()).put("events", { eventId, body, attempts: 0, createdAt: Date.now(), nextAttemptAt: 0 });
  } catch {
    return eventId; // storage unavailable: drop silently — analytics never affect playback
  }
  return eventId;
}

export async function flush(): Promise<void> {
  if (flushing || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  flushing = true;
  try {
    const d = await db();
    const now = Date.now();
    const due: QueuedEvent[] = [];
    let cur = await d.transaction("events").store.index("nextAttemptAt").openCursor(IDBKeyRange.upperBound(now));
    while (cur && due.length < BATCH) { due.push(cur.value); cur = await cur.continue(); }
    const stale = due.filter((e) => now - e.createdAt > MAX_AGE_MS || e.attempts >= MAX_ATTEMPTS);
    for (const s of stale) await d.delete("events", s.eventId);
    const send = due.filter((e) => !stale.includes(e));
    if (!send.length) return;
    const res = await fetch("/api/v1/events", {
      method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: send.map((e) => e.body) }),
    }).catch(() => null);
    if (res?.ok || res?.status === 400) {
      // 400 = permanently invalid payload: retrying can't help, so drop instead of looping forever.
      const tx = d.transaction("events", "readwrite");
      await Promise.all(send.map((e) => tx.store.delete(e.eventId)));
      await tx.done;
    } else {
      const tx = d.transaction("events", "readwrite");
      await Promise.all(send.map((e) => {
        const attempts = e.attempts + 1;
        const backoff = Math.min(2 ** attempts * 2000, 30 * 60_000) * (0.5 + Math.random());
        return tx.store.put({ ...e, attempts, nextAttemptAt: now + backoff });
      }));
      await tx.done;
    }
  } catch {
    /* next opportunity */
  } finally {
    flushing = false;
  }
}

export function startEventFlusher() {
  if (started || typeof window === "undefined") return;
  started = true;
  setInterval(() => void flush(), 30_000);
  window.addEventListener("online", () => void flush());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flush(); });
  setTimeout(() => void flush(), 3000);
}
