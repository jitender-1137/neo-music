"use client";
/**
 * Guest data in IndexedDB. Stays on this device only — it does not sync across devices until the
 * user creates an account (then it's imported once, idempotently).
 *
 * Retention: history keeps the newest 500 plays; the analytics queue drops events older than
 * 30 days or after 8 failed sends. "Clear local data" in Settings wipes everything here.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Album, Artist, Playlist, Track } from "@zuno/core";
import type { SavedSession } from "@zuno/player";

export interface LocalPlaylist { id: string; title: string; description: string; tracks: Track[]; createdAt: number; updatedAt: number }
export interface QueuedEvent { eventId: string; body: Record<string, unknown>; attempts: number; createdAt: number; nextAttemptAt: number }

interface ZunoDB extends DBSchema {
  likes: { key: string; value: { id: string; track: Track; at: number }; indexes: { at: number } };
  albums: { key: string; value: { id: string; album: Album; at: number }; indexes: { at: number } };
  artists: { key: string; value: { id: string; artist: Artist; at: number }; indexes: { at: number } };
  savedPlaylists: { key: string; value: { id: string; playlist: Playlist; at: number }; indexes: { at: number } };
  playlists: { key: string; value: LocalPlaylist; indexes: { updatedAt: number } };
  history: { key: string; value: { eventId: string; track: Track; at: number }; indexes: { at: number } };
  searches: { key: string; value: { q: string; at: number }; indexes: { at: number } };
  events: { key: string; value: QueuedEvent; indexes: { nextAttemptAt: number } };
  kv: { key: string; value: unknown };
}

const HISTORY_MAX = 500;
let dbp: Promise<IDBPDatabase<ZunoDB>> | null = null;

export function db(): Promise<IDBPDatabase<ZunoDB>> {
  if (!dbp) {
    dbp = openDB<ZunoDB>("zuno", 1, {
      upgrade(d) {
        for (const s of ["likes", "albums", "artists", "savedPlaylists"] as const) d.createObjectStore(s, { keyPath: "id" }).createIndex("at", "at");
        d.createObjectStore("playlists", { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
        d.createObjectStore("history", { keyPath: "eventId" }).createIndex("at", "at");
        d.createObjectStore("searches", { keyPath: "q" }).createIndex("at", "at");
        d.createObjectStore("events", { keyPath: "eventId" }).createIndex("nextAttemptAt", "nextAttemptAt");
        d.createObjectStore("kv");
      },
    }).catch((err) => { dbp = null; throw err; });
  }
  return dbp;
}

export async function newestFirst<S extends "likes" | "albums" | "artists" | "savedPlaylists" | "history" | "searches">(store: S, limit = 500) {
  const d = await db();
  const out: ZunoDB[S]["value"][] = [];
  let cur = await d.transaction(store).store.index("at").openCursor(null, "prev");
  while (cur && out.length < limit) { out.push(cur.value); cur = await cur.continue(); }
  return out;
}

export async function addHistory(track: Track, eventId: string) {
  const d = await db();
  await d.put("history", { eventId, track, at: Date.now() });
  const count = await d.count("history");
  if (count > HISTORY_MAX) {
    const tx = d.transaction("history", "readwrite");
    let cur = await tx.store.index("at").openCursor();
    let excess = count - HISTORY_MAX;
    while (cur && excess-- > 0) { await cur.delete(); cur = await cur.continue(); }
    await tx.done;
  }
}

export async function addSearch(q: string) {
  const d = await db();
  await d.put("searches", { q, at: Date.now() });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try { return (await (await db()).get("kv", key)) as T | undefined; } catch { return undefined; }
}
export async function kvSet(key: string, value: unknown) {
  try { await (await db()).put("kv", value, key); } catch { /* storage unavailable */ }
}

export const loadSession = () => kvGet<SavedSession>("player.session");
export const saveSession = (s: SavedSession) => kvSet("player.session", s);

export async function clearAllLocal() {
  const d = await db();
  await Promise.all((["likes", "albums", "artists", "savedPlaylists", "playlists", "history", "searches", "events", "kv"] as const).map((s) => d.clear(s)));
}
