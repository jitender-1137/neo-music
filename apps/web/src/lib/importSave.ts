"use client";
/**
 * Saving an import: guests → IndexedDB (instant, we already hold full Track objects);
 * signed-in → server, in small batches so each request stays fast and progress is visible.
 * The server re-fetches metadata for every id (snapshots are never taken from the client).
 */
import type { Track } from "@zuno/core";
import { api } from "./api";
import { db } from "./guestDb";
import { listLocalPlaylists, saveLocalPlaylist } from "./library";

export type Destination = { kind: "new"; title: string } | { kind: "existing"; id: string } | { kind: "liked" };
const BATCH = 100;

export async function saveImport(tracks: Track[], dest: Destination, signedIn: boolean, onProgress: (done: number) => void): Promise<{ playlistId?: string; saved: number }> {
  const unique = tracks.filter((t, i) => tracks.findIndex((x) => x.id === t.id) === i);
  if (!signedIn) {
    if (dest.kind === "liked") {
      const d = await db();
      const tx = d.transaction("likes", "readwrite");
      const now = Date.now();
      await Promise.all(unique.map((t, i) => tx.store.put({ id: t.id, track: t, at: now - i })));
      await tx.done;
      onProgress(unique.length);
      return { saved: unique.length };
    }
    if (dest.kind === "new") {
      const id = `local-${crypto.randomUUID()}`;
      await saveLocalPlaylist({ id, title: dest.title.slice(0, 150), description: "", tracks: unique, createdAt: Date.now(), updatedAt: Date.now() });
      onProgress(unique.length);
      return { playlistId: id, saved: unique.length };
    }
    const p = (await listLocalPlaylists()).find((x) => x.id === dest.id);
    if (!p) throw new Error("Playlist not found");
    const have = new Set(p.tracks.map((t) => t.id));
    const add = unique.filter((t) => !have.has(t.id));
    await saveLocalPlaylist({ ...p, tracks: [...p.tracks, ...add] });
    onProgress(unique.length);
    return { playlistId: p.id, saved: add.length };
  }

  const ids = unique.map((t) => t.id);
  let done = 0;
  if (dest.kind === "liked") {
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      await api.post("/api/v1/library/import", { idempotencyKey: crypto.randomUUID(), likes: chunk });
      done += chunk.length; onProgress(done);
    }
    return { saved: done };
  }
  let playlistId: string;
  if (dest.kind === "new") {
    const first = ids.slice(0, BATCH);
    const p = await api.post<{ id: string }>("/api/v1/me/playlists", { title: dest.title.slice(0, 150), trackIds: first });
    playlistId = p.id; done = first.length; onProgress(done);
  } else {
    playlistId = dest.id;
  }
  for (let i = done; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    await api.post(`/api/v1/user-playlists/${playlistId}/tracks`, { trackIds: chunk, allowDuplicates: false });
    done += chunk.length; onProgress(done);
  }
  return { playlistId, saved: done };
}
