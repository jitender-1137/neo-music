"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { SearchFilter, SearchResults, ShelfItem } from "@zuno/core";
import { cn } from "@/lib/cn";
import { useSearch } from "@/lib/queries";
import { usePlayerEngine } from "@/lib/player";
import { useLibrary } from "@/lib/library";
import { useRecentSearches } from "@/hooks/useRecentSearches";
import { TrackRow, TrackListSkeleton } from "../music/TrackRow";
import { Carousel } from "../music/Shelf";
import { MediaCard, usePlayCollection } from "../music/MediaCard";
import { Artwork } from "../ui/Artwork";
import { Button } from "../ui/Button";
import { EmptyState, ErrorState } from "../ui/States";
import { SearchBox } from "../shell/SearchBox";
import { HistoryIcon, PlayIcon, SearchIcon, CloseIcon, UserCircleIcon } from "../icons";
import { albumHref, artistHref, playlistHref, trackHref } from "../music/links";

const FILTERS: { id: SearchFilter; label: string }[] = [
  { id: "all", label: "All" }, { id: "song", label: "Songs" }, { id: "video", label: "Videos" }, { id: "album", label: "Albums" }, { id: "artist", label: "Artists" }, { id: "playlist", label: "Playlists" },
];

function TopResult({ item }: { item: ShelfItem }) {
  const engine = usePlayerEngine();
  const play = usePlayCollection();
  const info = item.kind === "artist" ? { title: item.artist.name, sub: `Artist • ${item.artist.subscriberCount ?? ""}`, art: item.artist.artworkUrl, href: artistHref(item.artist), round: true }
    : item.kind === "album" ? { title: item.album.title, sub: `Album • ${item.album.artist}`, art: item.album.artworkUrl, href: albumHref(item.album), round: false }
    : item.kind === "track" ? { title: item.track.title, sub: `Song • ${item.track.artist}`, art: item.track.artworkUrl, href: trackHref(item.track), round: false }
    : item.kind === "playlist" ? { title: item.playlist.title, sub: `Playlist • ${item.playlist.owner}`, art: item.playlist.artworkUrl, href: playlistHref(item.playlist), round: false } : null;
  if (!info) return null;
  return (
    <section aria-label="Top result" className="mx-4 flex items-center gap-5 rounded-xl bg-surface p-4 md:mx-0">
      <Link href={info.href}><Artwork src={info.art} alt="" size={112} rounded={info.round ? "full" : "md"} priority className="w-24 md:w-28" /></Link>
      <div className="min-w-0 flex-1">
        <Link href={info.href} className="line-clamp-2 text-2xl font-bold hover:underline">{info.title}</Link>
        <p className="mt-1 text-sm text-muted">{info.sub}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {item.kind === "track" && <Button variant="primary" size="sm" icon={<PlayIcon />} onClick={() => engine?.playTrack(item.track, { type: "search" })}>Play</Button>}
          {(item.kind === "album" || item.kind === "playlist") && <Button variant="primary" size="sm" icon={<PlayIcon />} onClick={() => void play(item)}>Play</Button>}
          {item.kind === "artist" && <Link href={info.href} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground px-3 text-xs font-medium text-background [&_svg]:h-4 [&_svg]:w-4"><UserCircleIcon />View artist</Link>}
        </div>
      </div>
    </section>
  );
}

function Results({ r, filter, onFilter }: { r: SearchResults; filter: SearchFilter; onFilter: (f: SearchFilter) => void }) {
  const engine = usePlayerEngine();
  const lib = useLibrary();
  useEffect(() => { lib.ensureStatus([...r.tracks, ...r.videos].map((t) => t.id)); }, [r, lib]);
  const playIn = (list: typeof r.tracks, i: number) => engine?.playTrack(list[i]!, { type: "search", title: `Search: ${r.query}` });
  const section = (title: string, f: SearchFilter, children: React.ReactNode, n: number) => n > 0 && (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-4 md:px-0"><h2 className="text-xl font-bold">{title}</h2>{filter === "all" && <button className="text-sm text-muted hover:text-foreground" onClick={() => onFilter(f)}>Show all</button>}</div>
      {children}
    </section>
  );
  const none = !r.top && !r.tracks.length && !r.videos.length && !r.albums.length && !r.artists.length && !r.playlists.length;
  if (none) return <EmptyState icon={<SearchIcon />} title={`No results for “${r.query}”`} body="Check the spelling or try different keywords." />;
  return (
    <div className="flex flex-col gap-8">
      {filter === "all" && r.top && <TopResult item={r.top} />}
      {section("Songs", "song", <div role="list" className="flex flex-col px-2 md:px-0">{(filter === "all" ? r.tracks.slice(0, 5) : r.tracks).map((t, i) => <TrackRow key={t.id} track={t} onPlay={() => playIn(r.tracks, i)} />)}</div>, r.tracks.length)}
      {filter !== "song" && section("Videos", "video", <div role="list" className="flex flex-col px-2 md:px-0">{(filter === "all" ? r.videos.slice(0, 3) : r.videos).map((t, i) => <TrackRow key={t.id} track={t} onPlay={() => playIn(r.videos, i)} />)}</div>, r.videos.length)}
      {filter === "all" ? (
        <>
          {r.albums.length > 0 && <Carousel title="Albums">{r.albums.map((a) => <MediaCard key={a.id} item={{ kind: "album", album: a }} />)}</Carousel>}
          {r.artists.length > 0 && <Carousel title="Artists">{r.artists.map((a) => <MediaCard key={a.id} item={{ kind: "artist", artist: a }} />)}</Carousel>}
          {r.playlists.length > 0 && <Carousel title="Playlists">{r.playlists.map((p) => <MediaCard key={p.id} item={{ kind: "playlist", playlist: p }} />)}</Carousel>}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 px-4 sm:grid-cols-3 md:px-0 lg:grid-cols-5">
          {filter === "album" && r.albums.map((a) => <MediaCard key={a.id} item={{ kind: "album", album: a }} size={0} />)}
          {filter === "artist" && r.artists.map((a) => <MediaCard key={a.id} item={{ kind: "artist", artist: a }} size={0} />)}
          {filter === "playlist" && r.playlists.map((p) => <MediaCard key={p.id} item={{ kind: "playlist", playlist: p }} size={0} />)}
        </div>
      )}
    </div>
  );
}

export function SearchView() {
  const params = useSearchParams();
  const router = useRouter();
  const q = (params.get("q") ?? "").trim();
  const filter = (FILTERS.find((f) => f.id === params.get("filter"))?.id ?? "all") as SearchFilter;
  const res = useSearch(q, filter);
  const { recent, remove } = useRecentSearches();
  const sentinel = useRef<HTMLDivElement>(null);
  const setFilter = (f: SearchFilter) => router.replace(`/search?q=${encodeURIComponent(q)}${f !== "all" ? `&filter=${f}` : ""}`, { scroll: true });

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting && res.hasNextPage && !res.isFetchingNextPage) void res.fetchNextPage(); }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [res]);

  // Merge pages (filtered searches paginate).
  const merged: SearchResults | undefined = res.data && {
    ...res.data.pages[0]!,
    tracks: res.data.pages.flatMap((p) => p.tracks), videos: res.data.pages.flatMap((p) => p.videos), albums: res.data.pages.flatMap((p) => p.albums),
    artists: res.data.pages.flatMap((p) => p.artists), playlists: res.data.pages.flatMap((p) => p.playlists),
  };

  return (
    <div className="flex flex-col gap-6 pt-2">
      <div className="px-4 md:hidden"><SearchBox /></div>
      {!q ? (
        <div className="px-4 md:px-0">
          <h1 className="mb-4 text-2xl font-bold">Search</h1>
          {recent.length ? (
            <ul className="flex flex-col">
              {recent.map((r) => (
                <li key={r} className="flex items-center gap-3 rounded-lg px-2 hover:bg-hover">
                  <HistoryIcon className="h-5 w-5 text-muted" />
                  <Link href={`/search?q=${encodeURIComponent(r)}`} className="flex-1 py-3">{r}</Link>
                  <button aria-label={`Remove ${r}`} onClick={() => void remove(r)} className="p-2 text-muted [&_svg]:h-4 [&_svg]:w-4"><CloseIcon /></button>
                </li>
              ))}
            </ul>
          ) : <p className="text-muted">Find songs, albums, artists and playlists.</p>}
        </div>
      ) : (
        <>
          <div className="scroller flex gap-2 overflow-x-auto px-4 md:px-0" role="tablist" aria-label="Filter results">
            {FILTERS.map((f) => (
              <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
                className={cn("h-9 shrink-0 rounded-lg px-4 text-sm font-medium", filter === f.id ? "bg-foreground text-background" : "glass hover:glass-strong")}>{f.label}</button>
            ))}
          </div>
          {res.isPending && <div className="px-2 md:px-0"><TrackListSkeleton /></div>}
          {res.isError && <ErrorState error={res.error} onRetry={() => void res.refetch()} />}
          {merged && <div className={cn(res.isPlaceholderData && "opacity-60 transition-opacity")}><Results r={merged} filter={filter} onFilter={setFilter} /></div>}
          {res.isFetchingNextPage && <TrackListSkeleton rows={4} />}
          <div ref={sentinel} aria-hidden />
        </>
      )}
    </div>
  );
}
