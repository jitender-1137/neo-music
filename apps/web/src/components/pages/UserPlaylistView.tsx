"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import type { Track } from "@zuno/core";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { deleteLocalPlaylist, listLocalPlaylists, saveLocalPlaylist, useLibrary } from "@/lib/library";
import { usePlayerEngine } from "@/lib/player";
import { TrackRow, TrackListSkeleton } from "../music/TrackRow";
import { Artwork } from "../ui/Artwork";
import { Button, IconButton } from "../ui/Button";
import { EmptyState, ErrorState } from "../ui/States";
import { CloseIcon, DragIcon, EditIcon, PlayIcon, PlaylistIcon, ShareIcon, ShuffleIcon, TrashIcon } from "../icons";

type Entry = { entryId: string; position: number; track: Track | null };
type Detail = { playlist: { id: string; title: string; description: string; visibility: "private" | "unlisted" | "public"; version: number; isOwner: boolean; trackCount: number; artworkUrls: string[] }; entries: Entry[]; totalDurationSec: number };

function useDetail(id: string) {
  const { user } = useAuth();
  const local = id.startsWith("local-");
  return useQuery({
    queryKey: ["user-playlist", id, user?.id],
    queryFn: async (): Promise<Detail> => {
      if (!local) return api.get<Detail>(`/api/v1/user-playlists/${encodeURIComponent(id)}`);
      const p = (await listLocalPlaylists()).find((x) => x.id === id);
      if (!p) throw new ApiError(404, "not_found", "Playlist not found");
      return {
        playlist: { id: p.id, title: p.title, description: p.description, visibility: "private", version: p.updatedAt, isOwner: true, trackCount: p.tracks.length, artworkUrls: p.tracks.slice(0, 4).map((t) => t.artworkUrl ?? "") },
        entries: p.tracks.map((t, i) => ({ entryId: `${i}:${t.id}`, position: i, track: t })),
        totalDurationSec: p.tracks.reduce((s, t) => s + (t.durationSec ?? 0), 0),
      };
    },
    enabled: local || !!user,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
}

function SortableRow({ e, i, tracks, ctx, owner, onRemove }: { e: Entry & { track: Track }; i: number; tracks: Track[]; ctx: { type: "playlist"; id: string; title: string }; owner: boolean; onRemove: () => void }) {
  const engine = usePlayerEngine();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: e.entryId, disabled: !owner });
  return (
    <div ref={setNodeRef} role="none" style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? "relative z-10 rounded-lg glass shadow-lg" : undefined}>
      <TrackRow track={e.track} index={i} showAlbum onPlay={() => engine?.playList(tracks, i, ctx)} onRemove={owner ? onRemove : undefined} removeLabel="Remove from playlist"
        dragHandle={owner ? <button aria-label={`Reorder ${e.track.title}, position ${i + 1}`} className="cursor-grab touch-none text-muted [&_svg]:h-5 [&_svg]:w-5" {...attributes} {...listeners}><DragIcon /></button> : undefined} />
    </div>
  );
}

export function UserPlaylistView({ id }: { id: string }) {
  const { user, loading } = useAuth();
  const q = useDetail(id);
  const qc = useQueryClient();
  const router = useRouter();
  const engine = usePlayerEngine();
  const lib = useLibrary();
  const local = id.startsWith("local-");
  const [edit, setEdit] = useState(false);
  const [order, setOrder] = useState<Entry[] | null>(null);
  useEffect(() => { setOrder(null); }, [q.data]);
  useEffect(() => { if (q.data) lib.ensureStatus(q.data.entries.flatMap((e) => (e.track ? [e.track.id] : []))); }, [q.data, lib]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ["user-playlist", id] }); void qc.invalidateQueries({ queryKey: ["my-playlists"] }); };

  const reorder = useMutation({
    mutationFn: async ({ entryId, to, next }: { entryId: string; to: number; next: Entry[] }) => {
      if (local) {
        const p = (await listLocalPlaylists()).find((x) => x.id === id)!;
        await saveLocalPlaylist({ ...p, tracks: next.map((e) => e.track!).filter(Boolean) });
        return;
      }
      await api.post(`/api/v1/user-playlists/${id}/reorder`, { entryId, toPosition: to, version: q.data!.playlist.version });
    },
    onSettled: invalidate,
    onError: (e) => toast.error(e instanceof ApiError && e.status === 409 ? "This playlist changed somewhere else — reloaded the latest version." : "Couldn't reorder"),
  });
  const remove = useMutation({
    mutationFn: async (entryId: string) => {
      if (local) {
        const p = (await listLocalPlaylists()).find((x) => x.id === id)!;
        const idx = Number(entryId.split(":")[0]);
        await saveLocalPlaylist({ ...p, tracks: p.tracks.filter((_, i) => i !== idx) });
      } else await api.del(`/api/v1/user-playlists/${id}/tracks/${entryId}`);
    },
    onSuccess: () => toast("Removed from playlist"),
    onSettled: invalidate,
  });
  const del = useMutation({
    mutationFn: async () => (local ? deleteLocalPlaylist(id) : api.del(`/api/v1/user-playlists/${id}`)),
    onSuccess: () => { invalidate(); toast("Playlist deleted"); router.push("/library/playlists"); },
  });

  if (!local && !loading && !user) return <EmptyState icon={<PlaylistIcon />} title="Sign in to see this playlist" action={<Button variant="primary" onClick={() => router.push("/login")}>Sign in</Button>} />;
  if (q.isPending) return <TrackListSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const entries = (order ?? d.entries).filter((e): e is Entry & { track: Track } => !!e.track);
  const tracks = entries.map((e) => e.track);
  const ctx = { type: "playlist" as const, id, title: d.playlist.title };
  const unavailable = d.entries.length - entries.length;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = entries.findIndex((e) => e.entryId === active.id);
    const to = entries.findIndex((e) => e.entryId === over.id);
    const next = arrayMove(entries, from, to);
    setOrder(next); // optimistic
    reorder.mutate({ entryId: String(active.id), to, next });
  };

  return (
    <div>
      <header className="flex flex-col items-center gap-5 px-4 pb-6 pt-4 text-center md:flex-row md:items-end md:gap-8 md:px-0 md:pt-8 md:text-left">
        {d.playlist.artworkUrls.filter(Boolean).length >= 4 ? (
          <div className="grid w-[min(64vw,264px)] grid-cols-2 overflow-hidden rounded-lg shadow-2xl md:w-[264px]">{d.playlist.artworkUrls.slice(0, 4).map((u, i) => <Artwork key={i} src={u} alt="" size={132} rounded="none" />)}</div>
        ) : <Artwork src={d.playlist.artworkUrls[0]} alt="" size={264} rounded="lg" className="w-[min(64vw,264px)] shadow-2xl md:w-[264px]" />}
        <div className="flex min-w-0 flex-col items-center gap-2 md:items-start">
          <p className="text-sm text-muted">Playlist • {local ? "On this device" : d.playlist.visibility[0]!.toUpperCase() + d.playlist.visibility.slice(1)}</p>
          <h1 className="line-clamp-2 text-3xl font-bold md:text-5xl">{d.playlist.title}</h1>
          <p className="text-sm text-muted">{tracks.length} song{tracks.length === 1 ? "" : "s"}{d.totalDurationSec ? ` • ${Math.round(d.totalDurationSec / 60)} min` : ""}{unavailable ? ` • ${unavailable} unavailable` : ""}</p>
          {d.playlist.description && <p className="max-w-2xl text-sm text-muted">{d.playlist.description}</p>}
          <div className="mt-3 flex flex-wrap justify-center gap-2 md:justify-start">
            <Button variant="primary" size="lg" disabled={!tracks.length} icon={<PlayIcon />} onClick={() => engine?.playList(tracks, 0, ctx, { shuffle: false })}>Play</Button>
            <Button variant="outline" size="lg" disabled={!tracks.length} icon={<ShuffleIcon />} onClick={() => engine?.playList(tracks, 0, ctx, { shuffle: true })}>Shuffle</Button>
            {d.playlist.isOwner && <IconButton label="Edit playlist" className="glass hover:glass-strong" onClick={() => setEdit(true)}><EditIcon /></IconButton>}
            {!local && d.playlist.visibility !== "private" && <IconButton label="Copy link" className="glass hover:glass-strong" onClick={() => void navigator.clipboard.writeText(location.href).then(() => toast("Link copied"))}><ShareIcon /></IconButton>}
            {d.playlist.isOwner && <IconButton label="Delete playlist" className="glass hover:glass-strong" onClick={() => { if (confirm(`Delete “${d.playlist.title}”? This can't be undone.`)) del.mutate(); }}><TrashIcon /></IconButton>}
          </div>
        </div>
      </header>
      {!tracks.length ? <EmptyState icon={<PlaylistIcon />} title="This playlist is empty" body="Use “Save to playlist” on any song to add it here." /> : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={entries.map((e) => e.entryId)} strategy={verticalListSortingStrategy}>
            <div role="list" aria-label={`${d.playlist.title} songs`} className="flex flex-col px-2 md:px-0">
              {entries.map((e, i) => <SortableRow key={e.entryId} e={e} i={i} tracks={tracks} ctx={ctx} owner={d.playlist.isOwner} onRemove={() => remove.mutate(e.entryId)} />)}
            </div>
          </SortableContext>
        </DndContext>
      )}
      {edit && <EditDialog id={id} local={local} detail={d} onClose={() => setEdit(false)} onSaved={invalidate} />}
    </div>
  );
}

function EditDialog({ id, local, detail, onClose, onSaved }: { id: string; local: boolean; detail: Detail; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(detail.playlist.title);
  const [description, setDescription] = useState(detail.playlist.description);
  const [visibility, setVisibility] = useState(detail.playlist.visibility);
  const save = useMutation({
    mutationFn: async () => {
      if (local) {
        const p = (await listLocalPlaylists()).find((x) => x.id === id)!;
        await saveLocalPlaylist({ ...p, title: title.trim(), description });
      } else await api.patch(`/api/v1/user-playlists/${id}`, { title: title.trim(), description, visibility });
    },
    onSuccess: () => { onSaved(); onClose(); toast("Playlist updated"); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't save"),
  });
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl glass-panel p-5">
          <div className="mb-4 flex items-center justify-between"><Dialog.Title className="text-lg font-semibold">Edit playlist</Dialog.Title><Dialog.Close asChild><IconButton label="Close" size="sm"><CloseIcon /></IconButton></Dialog.Close></div>
          <Dialog.Description className="sr-only">Change the title, description and visibility</Dialog.Description>
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (title.trim()) save.mutate(); }}>
            <label className="flex flex-col gap-1 text-sm">Title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required className="h-11 rounded-lg glass px-3 outline-none focus:ring-1 focus:ring-focus" /></label>
            <label className="flex flex-col gap-1 text-sm">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={3} className="rounded-lg glass p-3 outline-none focus:ring-1 focus:ring-focus" /></label>
            {!local && (
              <fieldset className="flex flex-col gap-2 text-sm">
                <legend className="mb-1">Visibility</legend>
                {(["private", "unlisted", "public"] as const).map((v) => (
                  <label key={v} className="flex items-center gap-2"><input type="radio" name="vis" checked={visibility === v} onChange={() => setVisibility(v)} className="accent-[var(--color-accent)]" />
                    <span className="capitalize">{v}</span><span className="text-muted">— {v === "private" ? "only you" : v === "unlisted" ? "anyone with the link" : "anyone"}</span></label>
                ))}
              </fieldset>
            )}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={save.isPending}>Save</Button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
