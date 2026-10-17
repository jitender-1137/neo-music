"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Album, Artist, Playlist, Track } from "@zuno/core";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { newestFirst } from "@/lib/guestDb";
import { usePlayerEngine } from "@/lib/player";
import { useLibrary } from "@/lib/library";
import { TrackRow, TrackListSkeleton } from "../music/TrackRow";
import { MediaCard, CardSkeleton } from "../music/MediaCard";
import { AddToPlaylistDialog, useMyPlaylists } from "../music/AddToPlaylist";
import { userPlaylistHref } from "../music/links";
import { Artwork } from "../ui/Artwork";
import { Button } from "../ui/Button";
import { EmptyState, ErrorState } from "../ui/States";
import { AddIcon, DownloadIcon, HeartIcon, HistoryIcon, LibraryIcon, PlayIcon, PlaylistIcon, ShuffleIcon } from "../icons";

import { LIBRARY_TABS, type LibraryTab as Tab } from "@/lib/libraryTabs";

/** Signed in → paginated API; guest → IndexedDB. Same shape out. */
function useCollection<T>(kind: "likes" | "albums" | "artists" | "playlists", pick: (row: any) => T) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { user } = useAuth();
  const api$ = useInfiniteQuery({
    queryKey: ["library", kind, user?.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api.get<{ items: T[]; nextCursor?: string }>(`/api/v1/library/${kind}${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`, { signal }),
    getNextPageParam: (l) => l.nextCursor,
    enabled: !!user,
  });
  const store = kind === "playlists" ? "savedPlaylists" : kind;
  const guest = useQuery({ queryKey: ["guest", kind], queryFn: async () => (await newestFirst(store, 5000)).map(pick), enabled: !user });
  if (user) return { items: api$.data?.pages.flatMap((p) => p.items) ?? [], isPending: api$.isPending, error: api$.error, refetch: api$.refetch, more: api$.hasNextPage ? () => void api$.fetchNextPage() : undefined };
  return { items: guest.data ?? [], isPending: guest.isPending, error: guest.error, refetch: guest.refetch, more: undefined };
}

function GuestNote() {
  const { user } = useAuth();
  if (user) return null;
  return (
    <div className="mx-4 mb-6 flex flex-col gap-3 rounded-xl bg-surface p-4 sm:flex-row sm:items-center md:mx-0">
      <p className="flex-1 text-sm text-muted">Your library is saved on this device. <span className="text-foreground">Sign in</span> to keep it across devices — we'll move everything over.</p>
      <Link href="/login" className="self-start rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background sm:self-auto">Sign in</Link>
    </div>
  );
}

function Liked() {
  const engine = usePlayerEngine();
  const c = useCollection<Track>("likes", (r) => r.track);
  if (c.isPending) return <TrackListSkeleton />;
  if (c.error) return <ErrorState error={c.error} onRetry={() => void c.refetch()} />;
  if (!c.items.length) return <EmptyState icon={<HeartIcon />} title="Songs you like will appear here" body="Tap the heart on any song to save it." />;
  const ctx = { type: "playlist" as const, id: "liked", title: "Liked music" };
  return (
    <>
      <div className="mb-4 flex gap-2 px-4 md:px-0">
        <Button variant="primary" icon={<PlayIcon />} onClick={() => engine?.playList(c.items, 0, ctx, { shuffle: false })}>Play</Button>
        <Button variant="outline" icon={<ShuffleIcon />} onClick={() => engine?.playList(c.items, 0, ctx, { shuffle: true })}>Shuffle</Button>
      </div>
      <div role="list" aria-label="Liked music" className="flex flex-col px-2 md:px-0">{c.items.map((t, i) => <TrackRow key={t.id} track={t} showAlbum onPlay={() => engine?.playList(c.items, i, ctx)} />)}</div>
      {c.more && <Button variant="ghost" className="mt-4" onClick={c.more}>Load more</Button>}
    </>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-6 px-4 sm:grid-cols-3 md:px-0 lg:grid-cols-4 xl:grid-cols-6">{children}</div>;
}

function Albums() {
  const c = useCollection<Album>("albums", (r) => r.album);
  if (c.isPending) return <Grid>{Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} size={0} />)}</Grid>;
  if (c.error) return <ErrorState error={c.error} onRetry={() => void c.refetch()} />;
  if (!c.items.length) return <EmptyState icon={<LibraryIcon />} title="No saved albums" body="Save albums to find them here." />;
  return <Grid>{c.items.map((a) => <MediaCard key={a.id} item={{ kind: "album", album: a }} size={0} />)}</Grid>;
}

function Artists() {
  const c = useCollection<Artist>("artists", (r) => r.artist);
  if (c.isPending) return <Grid>{Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} size={0} round />)}</Grid>;
  if (c.error) return <ErrorState error={c.error} onRetry={() => void c.refetch()} />;
  if (!c.items.length) return <EmptyState icon={<LibraryIcon />} title="No artists followed" body="Follow artists to see them here." />;
  return <Grid>{c.items.map((a) => <MediaCard key={a.id} item={{ kind: "artist", artist: a }} size={0} />)}</Grid>;
}

function Playlists() {
  const mine = useMyPlaylists();
  const saved = useCollection<Playlist>("playlists", (r) => r.playlist);
  const params = useSearchParams();
  const router = useRouter();
  const [creating, setCreating] = useState(params.get("new") === "1");
  useEffect(() => { if (params.get("new") === "1") setCreating(true); }, [params]);
  return (
    <div className="flex flex-col gap-8">
      <Grid>
        <button onClick={() => setCreating(true)} className="flex flex-col gap-2 text-left">
          <div className="grid aspect-square w-full place-items-center rounded-[var(--radius-card)] glass text-muted transition-colors hover:glass-strong [&_svg]:h-12 [&_svg]:w-12"><AddIcon /></div>
          <span className="text-sm font-medium">New playlist</span>
        </button>
        {mine.data?.map((p) => (
          <Link key={p.id} href={userPlaylistHref(p.id)} className="flex flex-col gap-2">
            {p.artworkUrls.length >= 4 ? (
              <div className="grid aspect-square grid-cols-2 overflow-hidden rounded-[var(--radius-card)]">{p.artworkUrls.slice(0, 4).map((u, i) => <Artwork key={i} src={u} alt="" size={110} rounded="none" />)}</div>
            ) : p.artworkUrls[0] ? <Artwork src={p.artworkUrls[0]} alt="" size={220} className="w-full" /> : <div className="grid aspect-square place-items-center rounded-[var(--radius-card)] glass text-subtle [&_svg]:h-12 [&_svg]:w-12"><PlaylistIcon /></div>}
            <div><div className="line-clamp-1 text-sm font-medium">{p.title}</div><div className="text-sm text-muted">{p.trackCount} song{p.trackCount === 1 ? "" : "s"}</div></div>
          </Link>
        ))}
        {saved.items.map((p) => <MediaCard key={p.id} item={{ kind: "playlist", playlist: p }} size={0} />)}
      </Grid>
      {mine.isError && <ErrorState error={mine.error} onRetry={() => void mine.refetch()} compact />}
      {creating && <AddToPlaylistDialog tracks={[]} open={creating} onOpenChange={(o) => { setCreating(o); if (!o && params.get("new")) router.replace("/library/playlists"); }} />}
    </div>
  );
}

export function LibraryView({ tab }: { tab: Tab }) {
  return (
    <div className="pt-2">
      <h1 className="mb-4 px-4 text-3xl font-bold md:px-0">Library</h1>
      {/* Phones: one-tap shortcuts (History lived only in the desktop sidebar before). Works for guests too. */}
      <div className="mb-5 grid grid-cols-2 gap-2 px-4 md:hidden">
        {([["/library/liked", "Liked music", HeartIcon], ["/history", "History", HistoryIcon], ["/import", "Import music", DownloadIcon], ["/library/playlists?new=1", "New playlist", AddIcon]] as const).map(([href, label, Icon]) => (
          <Link key={href} href={href} className="m-press flex h-14 items-center gap-3 rounded-2xl glass px-4 text-[15px] font-semibold [&_svg]:h-5 [&_svg]:w-5 [&_svg]:shrink-0 [&_svg]:text-accent">
            <Icon />{label}
          </Link>
        ))}
      </div>
      <nav aria-label="Library sections" className="scroller mb-6 flex gap-2 overflow-x-auto px-4 md:px-0">
        {LIBRARY_TABS.map((t) => (
          <Link key={t.id} href={`/library/${t.id}`} aria-current={tab === t.id ? "page" : undefined}
            className={cn("h-9 shrink-0 rounded-lg px-4 py-2 text-sm font-medium", tab === t.id ? "bg-foreground text-background" : "glass hover:glass-strong")}>{t.label}</Link>
        ))}
        <Link href="/history" className="h-9 shrink-0 rounded-lg glass px-4 py-2 text-sm font-medium hover:glass-strong">History</Link>
        <Link href="/import" className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg glass px-4 text-sm font-medium hover:glass-strong [&_svg]:h-4 [&_svg]:w-4"><DownloadIcon />Import</Link>
      </nav>
      <GuestNote />
      {tab === "liked" && <Liked />}
      {tab === "albums" && <Albums />}
      {tab === "artists" && <Artists />}
      {tab === "playlists" && <Playlists />}
    </div>
  );
}

export function HistoryView() {
  const { user } = useAuth();
  const engine = usePlayerEngine();
  const qc = useQueryClient();
  const lib = useLibrary();
  const remote = useInfiniteQuery({
    queryKey: ["history", user?.id],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) => api.get<{ items: { playedAt: string; track: Track }[]; nextCursor?: number }>(`/api/v1/history${pageParam ? `?cursor=${pageParam}` : ""}`, { signal }),
    getNextPageParam: (l) => l.nextCursor,
    enabled: !!user,
  });
  const local = useQuery({ queryKey: ["guest", "history"], queryFn: async () => (await newestFirst("history", 500)).map((h) => ({ playedAt: new Date(h.at).toISOString(), track: h.track })), enabled: !user });
  const items = user ? remote.data?.pages.flatMap((p) => p.items) ?? [] : local.data ?? [];
  const pending = user ? remote.isPending : local.isPending;
  useEffect(() => { lib.ensureStatus(items.map((i) => i.track.id)); }, [items, lib]);
  const groups = new Map<string, typeof items>();
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
  const today = new Date().toDateString();
  for (const it of items) {
    const d = new Date(it.playedAt);
    const label = d.toDateString() === today ? "Today" : fmt.format(d);
    groups.set(label, [...(groups.get(label) ?? []), it]);
  }
  async function clear() {
    if (!confirm("Clear your listening history? This can't be undone.")) return;
    if (user) await api.del("/api/v1/history");
    else { const { db } = await import("@/lib/guestDb"); await (await db()).clear("history"); }
    await qc.invalidateQueries({ queryKey: user ? ["history"] : ["guest", "history"] });
  }
  return (
    <div className="pt-2">
      <div className="mb-6 flex items-center justify-between px-4 md:px-0">
        <h1 className="text-3xl font-bold">History</h1>
        {items.length > 0 && <Button variant="outline" size="sm" onClick={() => void clear()}>Clear history</Button>}
      </div>
      {pending && <TrackListSkeleton />}
      {(remote.error || local.error) && <ErrorState error={remote.error ?? local.error} onRetry={() => void (user ? remote.refetch() : local.refetch())} />}
      {!pending && !items.length && <EmptyState icon={<HistoryIcon />} title="Nothing played yet" body="Songs you play will show up here." />}
      {[...groups].map(([label, list]) => (
        <section key={label} aria-label={label} className="mb-6">
          <h2 className="mb-2 px-4 text-lg font-semibold md:px-0">{label}</h2>
          <div role="list" aria-label={label} className="flex flex-col px-2 md:px-0">
            {list.map((it, i) => <TrackRow key={`${it.track.id}-${it.playedAt}-${i}`} track={it.track} onPlay={() => engine?.playTrack(it.track, { type: "queue", title: "History" })} />)}
          </div>
        </section>
      ))}
      {user && remote.hasNextPage && <div className="flex justify-center"><Button variant="ghost" loading={remote.isFetchingNextPage} onClick={() => void remote.fetchNextPage()}>Load more</Button></div>}
    </div>
  );
}
