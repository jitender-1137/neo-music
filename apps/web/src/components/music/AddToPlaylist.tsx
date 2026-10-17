"use client";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Track } from "@zuno/core";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { listLocalPlaylists, saveLocalPlaylist } from "@/lib/library";
import { track as trackEvent } from "@/lib/events";
import { Artwork } from "../ui/Artwork";
import { Button, IconButton } from "../ui/Button";
import { AddIcon, CloseIcon, PlaylistIcon } from "../icons";

export type PlaylistSummary = { id: string; title: string; trackCount: number; artworkUrls: string[]; version: number; visibility: string; description: string; isOwner: boolean };

export function useMyPlaylists() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-playlists", user?.id ?? "guest"],
    queryFn: async () => {
      if (user) return (await api.get<{ items: PlaylistSummary[] }>("/api/v1/me/playlists")).items;
      const local = await listLocalPlaylists().catch(() => []);
      return local.map((p): PlaylistSummary => ({ id: p.id, title: p.title, trackCount: p.tracks.length, artworkUrls: p.tracks.slice(0, 4).map((t) => t.artworkUrl ?? "").filter(Boolean), version: 1, visibility: "private", description: p.description, isOwner: true }));
    },
    staleTime: 60_000,
  });
}

export function AddToPlaylistDialog({ tracks, open, onOpenChange }: { tracks: Track[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const lists = useMyPlaylists();
  const createOnly = tracks.length === 0;
  const [creating, setCreating] = useState(createOnly);
  const [title, setTitle] = useState("");

  const add = useMutation({
    mutationFn: async ({ id, allowDuplicates }: { id: string; allowDuplicates?: boolean }) => {
      if (user) return api.post<{ added: number; skippedDuplicates: string[] }>(`/api/v1/user-playlists/${id}/tracks`, { trackIds: tracks.map((t) => t.id), allowDuplicates });
      const p = (await listLocalPlaylists()).find((x) => x.id === id);
      if (!p) throw new Error("Playlist not found");
      const have = new Set(p.tracks.map((t) => t.id));
      const fresh = allowDuplicates ? tracks : tracks.filter((t) => !have.has(t.id));
      await saveLocalPlaylist({ ...p, tracks: [...p.tracks, ...fresh] });
      return { added: fresh.length, skippedDuplicates: allowDuplicates ? [] : tracks.filter((t) => have.has(t.id)).map((t) => t.id) };
    },
    onSuccess: (r, v) => {
      void qc.invalidateQueries({ queryKey: ["my-playlists"] });
      void qc.invalidateQueries({ queryKey: ["user-playlist", v.id] });
      const name = lists.data?.find((p) => p.id === v.id)?.title ?? "playlist";
      if (r.added) {
        toast.success(`Saved to ${name}`);
        tracks.forEach((t) => void trackEvent({ type: "playlist_add", trackId: t.id, artistIds: t.artists?.map((a) => a.id).filter((x) => /^[\w-]+$/.test(x)).slice(0, 10) }));
      }
      if (r.skippedDuplicates.length) {
        toast(r.added ? `${r.skippedDuplicates.length} already in ${name}` : `Already in ${name}`, {
          action: { label: "Add anyway", onClick: () => add.mutate({ id: v.id, allowDuplicates: true }) },
        });
      }
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't add to playlist"),
  });

  const create = useMutation({
    mutationFn: async () => {
      const t = title.trim();
      if (user) return api.post<PlaylistSummary>("/api/v1/me/playlists", { title: t, trackIds: tracks.map((x) => x.id) });
      const p = { id: `local-${crypto.randomUUID()}`, title: t, description: "", tracks, createdAt: Date.now(), updatedAt: Date.now() };
      await saveLocalPlaylist(p);
      return p;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-playlists"] });
      toast.success(`Created “${title.trim()}”`);
      setTitle(""); setCreating(false); onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't create playlist"),
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(80dvh,560px)] w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl glass-panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">{createOnly ? "New playlist" : "Save to playlist"}</Dialog.Title>
            <Dialog.Close asChild><IconButton label="Close" size="sm"><CloseIcon /></IconButton></Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{createOnly ? "Name your new playlist" : `Choose a playlist for ${tracks.length === 1 ? tracks[0]?.title : `${tracks.length} songs`}`}</Dialog.Description>
          {!user && <p className="mb-2 text-xs text-muted">Guest playlists are saved on this device. Sign in to sync them everywhere.</p>}
          {!createOnly && <div className="-mx-2 min-h-0 flex-1 overflow-y-auto">
            {lists.isPending && <p className="p-3 text-sm text-muted">Loading…</p>}
            {lists.data?.length === 0 && !creating && <p className="p-3 text-sm text-muted">No playlists yet.</p>}
            {lists.data?.map((p) => (
              <button key={p.id} disabled={add.isPending} onClick={() => add.mutate({ id: p.id })} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-hover disabled:opacity-60">
                {p.artworkUrls[0] ? <Artwork src={p.artworkUrls[0]} alt="" size={48} className="w-12" /> : <div className="grid h-12 w-12 place-items-center rounded-md glass text-subtle"><PlaylistIcon className="h-6 w-6" /></div>}
                <div className="min-w-0"><div className="line-clamp-1 font-medium">{p.title}</div><div className="text-xs text-muted">{p.trackCount} song{p.trackCount === 1 ? "" : "s"}</div></div>
              </button>
            ))}
          </div>}
          {creating ? (
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) create.mutate(); }}>
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} placeholder="Playlist title" aria-label="Playlist title" className="h-10 min-w-0 flex-1 rounded-full glass px-4 outline-none focus:ring-1 focus:ring-focus" />
              <Button type="submit" variant="primary" loading={create.isPending} disabled={!title.trim()}>Create</Button>
            </form>
          ) : (
            <Button className="mt-3" variant="outline" icon={<AddIcon />} onClick={() => setCreating(true)}>New playlist</Button>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
