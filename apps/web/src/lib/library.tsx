"use client";
/**
 * One library API for both modes:
 *  - guest  → IndexedDB on this device;
 *  - signed in → server, with optimistic local sets and per-view status lookups.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Album, Artist, Playlist, Track } from "@zuno/core";
import { api, ApiError } from "./api";
import { db, kvGet, kvSet, newestFirst, type LocalPlaylist } from "./guestDb";
import { track as trackEvent } from "./events";

export type Kind = "likes" | "albums" | "artists" | "playlists";
type Sets = Record<Kind, Set<string>>;

class LibraryStore {
  sets: Sets = { likes: new Set(), albums: new Set(), artists: new Set(), playlists: new Set() };
  version = 0;
  private listeners = new Set<() => void>();
  subscribe = (l: () => void) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  getVersion = () => this.version;
  apply(kind: Kind, ids: string[], on: boolean) {
    for (const id of ids) on ? this.sets[kind].add(id) : this.sets[kind].delete(id);
    this.version++;
    for (const l of this.listeners) l();
  }
  reset() {
    this.sets = { likes: new Set(), albums: new Set(), artists: new Set(), playlists: new Set() };
    this.version++;
    for (const l of this.listeners) l();
  }
}

const GUEST_STORE: Record<Kind, "likes" | "albums" | "artists" | "savedPlaylists"> = { likes: "likes", albums: "albums", artists: "artists", playlists: "savedPlaylists" };

interface LibraryCtx {
  signedIn: boolean;
  has(kind: Kind, id: string): boolean;
  toggle(kind: Kind, item: Track | Album | Artist | Playlist): Promise<void>;
  /** Ask the server which of these ids are saved (signed-in only; batched). */
  ensureStatus(ids: string[]): void;
  store: LibraryStore;
}

const Ctx = createContext<LibraryCtx | null>(null);

export function LibraryProvider({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  const store = useRef(new LibraryStore()).current;
  const qc = useQueryClient();
  const known = useRef(new Set<string>());
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    store.reset();
    known.current.clear();
    if (signedIn) return;
    // Guest: load everything (small) into memory.
    void (async () => {
      try {
        for (const k of Object.keys(GUEST_STORE) as Kind[]) {
          const rows = await newestFirst(GUEST_STORE[k], 5000);
          store.apply(k, rows.map((r) => r.id), true);
        }
      } catch { /* IndexedDB unavailable (private mode): library works in-memory for this session */ }
    })();
  }, [signedIn, store]);

  const ensureStatus = useCallback((ids: string[]) => {
    if (!signedIn) return;
    for (const id of ids) if (!known.current.has(id)) pending.current.add(id);
    if (!pending.current.size || timer.current) return;
    timer.current = setTimeout(async () => {
      timer.current = null;
      const batch = [...pending.current].slice(0, 200);
      batch.forEach((id) => { pending.current.delete(id); known.current.add(id); });
      try {
        const r = await api.get<Record<Kind, string[]>>(`/api/v1/library/status?ids=${batch.map(encodeURIComponent).join(",")}`);
        for (const k of Object.keys(r) as Kind[]) store.apply(k, r[k], true);
      } catch { batch.forEach((id) => known.current.delete(id)); }
      if (pending.current.size) ensureStatus([]);
    }, 50);
  }, [signedIn, store]);

  const toggle = useCallback(async (kind: Kind, item: Track | Album | Artist | Playlist) => {
    const id = item.id;
    const on = !store.sets[kind].has(id);
    store.apply(kind, [id], on); // optimistic
    try {
      if (signedIn) {
        if (on) await api.put(`/api/v1/library/${kind}/${encodeURIComponent(id)}`);
        else await api.del(`/api/v1/library/${kind}/${encodeURIComponent(id)}`);
        void qc.invalidateQueries({ queryKey: ["library", kind] });
      } else {
        const d = await db();
        const s = GUEST_STORE[kind];
        if (on) {
          const value = kind === "likes" ? { id, track: item as Track, at: Date.now() }
            : kind === "albums" ? { id, album: item as Album, at: Date.now() }
            : kind === "artists" ? { id, artist: item as Artist, at: Date.now() }
            : { id, playlist: item as Playlist, at: Date.now() };
          await d.put(s, value as never);
        } else {
          await d.delete(s, id);
        }
        void qc.invalidateQueries({ queryKey: ["guest", kind] });
      }
      const t = item as Track;
      const evt = kind === "likes" ? (on ? "like" : "unlike") : kind === "artists" ? (on ? "follow" : "unfollow") : kind === "albums" && on ? "album_save" : null;
      if (evt) void trackEvent({ type: evt, trackId: kind === "likes" ? id : undefined, artistIds: kind === "artists" ? [id] : (t.artists?.map((a) => a.id) ?? []).filter((x) => /^[\w-]+$/.test(x)).slice(0, 10) });
      const label = kind === "likes" ? (on ? "Added to Liked music" : "Removed from Liked music") : on ? "Saved to library" : "Removed from library";
      toast(label);
    } catch (e) {
      store.apply(kind, [id], !on); // roll back
      toast.error(e instanceof ApiError ? e.message : "Couldn't update your library");
    }
  }, [signedIn, store, qc]);

  const value = useMemo<LibraryCtx>(() => ({ signedIn, has: (k, id) => store.sets[k].has(id), toggle, ensureStatus, store }), [signedIn, toggle, ensureStatus, store]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLibrary() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLibrary outside LibraryProvider");
  useSyncExternalStore(c.store.subscribe, c.store.getVersion, c.store.getVersion);
  return c;
}

/** Re-renders only when this id's saved state flips. */
export function useSaved(kind: Kind, id: string | undefined): boolean {
  const c = useContext(Ctx);
  const get = () => (id && c ? c.store.sets[kind].has(id) : false);
  useEffect(() => { if (id) c?.ensureStatus([id]); }, [c, id]);
  return useSyncExternalStore(c?.store.subscribe ?? (() => () => {}), get, () => false);
}

// ---------- guest local playlists ----------
export async function listLocalPlaylists(): Promise<LocalPlaylist[]> {
  const d = await db();
  return (await d.getAll("playlists")).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function saveLocalPlaylist(p: LocalPlaylist) {
  await (await db()).put("playlists", { ...p, updatedAt: Date.now() });
}
export async function deleteLocalPlaylist(id: string) {
  await (await db()).delete("playlists", id);
}

// ---------- guest → account migration ----------
type ImportResult = { imported: { likes: number; albums: number; artists: number; savedPlaylists: number; playlists: number; history: number }; playlistIds: Record<string, string> };

/**
 * Policy: everything saved on this device as a guest (likes, saved albums/artists/playlists,
 * local playlists in order, recent history) is copied into the account once. The request carries
 * a persisted idempotency key, so a retry after a network failure cannot duplicate anything.
 * After success the guest library is cleared from this device (it now lives in the account);
 * on failure nothing is deleted and the next sign-in retries with the same key.
 */
export async function migrateGuestData(userId: string): Promise<ImportResult["imported"] | null> {
  if (await kvGet<boolean>(`migrated:${userId}`)) return null;
  const [likes, albums, artists, saved, playlists, history] = await Promise.all([
    newestFirst("likes", 5000), newestFirst("albums", 2000), newestFirst("artists", 2000), newestFirst("savedPlaylists", 2000),
    listLocalPlaylists(), newestFirst("history", 500),
  ]).catch(() => [[], [], [], [], [], []] as never);
  const empty = !likes.length && !albums.length && !artists.length && !saved.length && !playlists.length && !history.length;
  if (empty) { await kvSet(`migrated:${userId}`, true); return null; }
  let key = await kvGet<string>("migration.key");
  if (!key) { key = crypto.randomUUID(); await kvSet("migration.key", key); }
  const valid = (id: string) => /^[\w-]{1,200}$/.test(id);
  const res = await api.post<ImportResult>("/api/v1/library/import", {
    idempotencyKey: key,
    likes: likes.map((x) => x.id).filter(valid),
    albums: albums.map((x) => x.id).filter(valid),
    artists: artists.map((x) => x.id).filter(valid),
    savedPlaylists: saved.map((x) => x.id).filter(valid),
    playlists: playlists.map((p) => ({ localId: p.id, title: p.title.slice(0, 150) || "Playlist", description: p.description.slice(0, 5000), trackIds: p.tracks.map((t) => t.id).filter(valid) })),
    history: history.map((h) => ({ trackId: h.track.id, playedAt: new Date(h.at).toISOString(), eventId: h.eventId })).filter((h) => valid(h.trackId)),
  });
  const d = await db();
  await Promise.all((["likes", "albums", "artists", "savedPlaylists", "playlists", "history"] as const).map((s) => d.clear(s)));
  await kvSet(`migrated:${userId}`, true);
  await kvSet("migration.key", null);
  return res.imported;
}
