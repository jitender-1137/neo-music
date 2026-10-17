"use client";
import { ArtistSkeleton, CollectionSkeleton } from "../ui/PageSkeletons";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AlbumPage, ArtistPage, PlaylistPage, Track, TrackDetail } from "@zuno/core";
import { formatDuration } from "@zuno/core";
import { useAlbum, useArtist, useLyrics, usePlaylist, useRelated, useTrackDetail } from "@/lib/queries";
import { usePlayer, usePlayerEngine, selectIsPlaying } from "@/lib/player";
import { useLibrary, useSaved } from "@/lib/library";
import { MediaHeader } from "../music/MediaHeader";
import { TrackRow, TrackListSkeleton } from "../music/TrackRow";
import { ShelfView, ShelfSkeleton } from "../music/Shelf";
import { ArtistLinks } from "../music/ArtistLinks";
import { AddToPlaylistDialog } from "../music/AddToPlaylist";
import { TrackMenu } from "../music/TrackMenu";
import { Artwork } from "../ui/Artwork";
import { Button, IconButton } from "../ui/Button";
import { EmptyState, ErrorState } from "../ui/States";
import { AddCircleIcon, CheckCircleIcon, HeartActiveIcon, HeartIcon, PauseIcon, PlayIcon, PlaylistIcon, RadioIcon, ShareIcon, ShuffleIcon, PlayNextIcon } from "../icons";
import { toast } from "sonner";

function totalTime(sec?: number) {
  if (!sec) return "";
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h} hr ${m} min` : `${m} min`;
}

async function share(title: string) {
  try {
    if (navigator.share) await navigator.share({ title, url: location.href });
    else { await navigator.clipboard.writeText(location.href); toast("Link copied"); }
  } catch { /* cancelled */ }
}

/** Play/Pause for a whole collection: resumes if this collection is already the context. */
function PlayAllButtons({ tracks, ctx }: { tracks: Track[]; ctx: { type: "album" | "playlist" | "artist"; id: string; title: string } }) {
  const engine = usePlayerEngine();
  const isCtx = usePlayer((s) => s.context?.id === ctx.id);
  const playing = usePlayer(selectIsPlaying);
  const empty = tracks.length === 0;
  return (
    <>
      <Button variant="primary" size="lg" disabled={empty} icon={isCtx && playing ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
        onClick={() => (isCtx ? engine?.togglePlay() : engine?.playList(tracks, 0, ctx, { shuffle: false }))}>
        {isCtx && playing ? "Pause" : "Play"}
      </Button>
      <Button variant="outline" size="lg" disabled={empty} icon={<ShuffleIcon />} onClick={() => engine?.playList(tracks, 0, ctx, { shuffle: true })}>Shuffle</Button>
    </>
  );
}

function TrackList({ tracks, ctx, showArtwork, showAlbum, showIndex }: { tracks: Track[]; ctx: { type: "album" | "playlist" | "artist"; id: string; title: string }; showArtwork?: boolean; showAlbum?: boolean; showIndex?: boolean }) {
  const hideAlbum = ctx.type === "album";
  const engine = usePlayerEngine();
  const lib = useLibrary();
  useEffect(() => { lib.ensureStatus(tracks.map((t) => t.id)); }, [tracks, lib]);
  if (!tracks.length) return <EmptyState title="No songs here" body="This collection has no playable songs right now." />;
  return (
    <div role="list" aria-label={`${ctx.title} songs`} className="flex flex-col px-2 md:px-0">
      {tracks.map((t, i) => (
        <TrackRow key={`${t.id}-${i}`} track={t} index={i} showArtwork={showArtwork} showAlbum={showAlbum} showIndex={showIndex} hideAlbum={hideAlbum}
          onPlay={() => engine?.playList(tracks, i, ctx)} />
      ))}
    </div>
  );
}

// ---------------- Album ----------------
export function AlbumView({ id, initial }: { id: string; initial?: AlbumPage }) {
  const q = useAlbum(id, initial);
  const saved = useSaved("albums", id);
  const lib = useLibrary();
  const [dialog, setDialog] = useState(false);
  const engine = usePlayerEngine();
  if (q.isPending) return <CollectionSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { album, tracks } = q.data;
  const ctx = { type: "album" as const, id: album.id, title: album.title };
  return (
    <div>
      <MediaHeader art={album.artworkUrl} title={album.title}
        kicker={[album.releaseType === "single" ? "Single" : album.releaseType === "ep" ? "EP" : "Album", album.year].filter(Boolean).join(" • ")}
        meta={<><ArtistLinks item={album} className="font-medium text-foreground" /> • {tracks.length} song{tracks.length === 1 ? "" : "s"}{q.data.totalDurationSec ? ` • ${totalTime(q.data.totalDurationSec)}` : ""}</>}
        description={q.data.description}
        actions={<>
          <PlayAllButtons tracks={tracks} ctx={ctx} />
          <IconButton label={saved ? "Remove from library" : "Save to library"} active={saved} className="glass hover:glass-strong" onClick={() => void lib.toggle("albums", album)}>{saved ? <CheckCircleIcon /> : <AddCircleIcon />}</IconButton>
          <IconButton label="Save all to playlist" className="glass hover:glass-strong" onClick={() => setDialog(true)}><PlaylistIcon /></IconButton>
          <IconButton label="Add album to queue" className="glass hover:glass-strong" onClick={() => { engine?.addToQueue(tracks); toast("Album added to queue"); }}><PlayNextIcon /></IconButton>
          <IconButton label="Share" className="glass hover:glass-strong" onClick={() => void share(album.title)}><ShareIcon /></IconButton>
        </>} />
      <TrackList tracks={tracks} ctx={ctx} showArtwork={false} showIndex />
      {q.data.otherVersions.length > 0 && (
        <div className="mt-10"><ShelfView shelf={{ id: "versions", title: "Other versions", layout: "carousel", items: q.data.otherVersions.map((a) => ({ kind: "album", album: a })) }} /></div>
      )}
      {dialog && <AddToPlaylistDialog tracks={tracks} open={dialog} onOpenChange={setDialog} />}
    </div>
  );
}

// ---------------- Artist ----------------
export function ArtistView({ id, initial }: { id: string; initial?: ArtistPage }) {
  const q = useArtist(id, initial);
  const followed = useSaved("artists", id);
  const lib = useLibrary();
  const engine = usePlayerEngine();
  if (q.isPending) return <ArtistSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const a = q.data;
  const ctx = { type: "artist" as const, id: a.artist.id, title: a.artist.name };
  return (
    <div className="flex flex-col gap-10">
      <header className="relative -mx-0 overflow-hidden md:-mx-6">
        <div className="relative h-[42vh] min-h-[280px] max-h-[460px]">
          {a.bannerUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={a.bannerUrl.replace(/=w\d+-h\d+[^/]*$/, "=w720-h720-l90-rj")}
              srcSet={[480, 720, 1080, 1440].map((w) => `${a.bannerUrl!.replace(/=w\d+-h\d+[^/]*$/, `=w${w}-h${w}-l90-rj`)} ${w}w`).join(", ")}
              // Phones: the banner is a cropped 42vh hero, ~720px source is plenty even at 3x.
              sizes="(max-width: 768px) 60vw, 100vw" alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_25%]" referrerPolicy="no-referrer" fetchPriority="high" decoding="async" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 px-4 pb-6 md:px-12">
            <h1 className="text-4xl font-bold md:text-6xl">{a.artist.name}</h1>
            {a.artist.subscriberCount && <p className="text-sm text-muted">{a.artist.subscriberCount}</p>}
            {a.description && <p className="line-clamp-2 max-w-2xl text-sm text-muted">{a.description}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={<ShuffleIcon />} disabled={!a.topTracks.length} onClick={() => engine?.playList(a.topTracks, 0, ctx, { shuffle: true })}>Shuffle</Button>
              <Button variant="outline" icon={<RadioIcon />} disabled={!a.topTracks[0]} onClick={() => a.topTracks[0] && engine?.startRadio(a.topTracks[0])}>Radio</Button>
              <Button variant={followed ? "secondary" : "outline"} onClick={() => void lib.toggle("artists", a.artist)} aria-pressed={followed}>{followed ? "Following" : "Follow"}</Button>
            </div>
          </div>
        </div>
      </header>
      {a.topTracks.length > 0 && (
        <section aria-label="Top songs"><h2 className="mb-3 px-4 text-2xl font-bold md:px-0">Top songs</h2><TrackList tracks={a.topTracks} ctx={ctx} showAlbum /></section>
      )}
      {a.shelves.map((s) => <ShelfView key={s.id} shelf={s} contextType="artist" />)}
    </div>
  );
}

// ---------------- Playlist (provider) ----------------
export function PlaylistView({ id, initial }: { id: string; initial?: PlaylistPage }) {
  const q = usePlaylist(id, initial);
  const saved = useSaved("playlists", id);
  const lib = useLibrary();
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [q]);
  if (q.isPending) return <TrackListSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const first = q.data.pages[0]!;
  const tracks = q.data.pages.flatMap((p) => p.tracks);
  const p = first.playlist;
  const ctx = { type: "playlist" as const, id: p.id, title: p.title };
  const isMix = p.id.startsWith("RDAMVM");
  return (
    <div>
      <MediaHeader art={p.artworkUrl} title={p.title} kicker={isMix ? "Mix" : "Playlist"}
        meta={<>{p.owner} • {p.trackCountText ?? `${tracks.length} songs`}{first.totalDurationSec ? ` • ${totalTime(first.totalDurationSec)}` : ""}</>}
        description={p.description}
        actions={<>
          <PlayAllButtons tracks={tracks} ctx={ctx} />
          {!isMix && <IconButton label={saved ? "Remove from library" : "Save to library"} active={saved} className="glass hover:glass-strong" onClick={() => void lib.toggle("playlists", p)}>{saved ? <CheckCircleIcon /> : <AddCircleIcon />}</IconButton>}
          <IconButton label="Share" className="glass hover:glass-strong" onClick={() => void share(p.title)}><ShareIcon /></IconButton>
        </>} />
      <TrackList tracks={tracks} ctx={ctx} showAlbum />
      {q.isFetchingNextPage && <TrackListSkeleton rows={4} />}
      <div ref={sentinel} aria-hidden />
    </div>
  );
}

// ---------------- Song ----------------
export function SongView({ id, initial }: { id: string; initial?: TrackDetail }) {
  const q = useTrackDetail(id, initial);
  const related = useRelated(id);
  const lyrics = useLyrics(id);
  const engine = usePlayerEngine();
  const liked = useSaved("likes", id);
  const lib = useLibrary();
  const isCurrent = usePlayer((s) => s.queue.entries[s.queue.index]?.track.id === id);
  const playing = usePlayer(selectIsPlaying);
  if (q.isPending) return <TrackListSkeleton rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const t = q.data.track;
  return (
    <div className="flex flex-col gap-10">
      <MediaHeader art={t.artworkUrl} title={t.title} kicker={t.isVideo ? "Video" : "Song"}
        meta={<><ArtistLinks item={t} className="font-medium text-foreground" />{t.album && <> • {t.albumId ? <Link className="hover:underline" href={`/album/${t.albumId}`}>{t.album}</Link> : t.album}</>}{t.durationSec ? ` • ${formatDuration(t.durationSec)}` : ""}{t.isExplicit ? " • Explicit" : ""}</>}
        actions={<>
          <Button variant="primary" size="lg" icon={isCurrent && playing ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />} onClick={() => (isCurrent ? engine?.togglePlay() : engine?.playTrack(t))}>{isCurrent && playing ? "Pause" : "Play"}</Button>
          <Button variant="outline" size="lg" icon={<RadioIcon />} onClick={() => engine?.startRadio(t)}>Start radio</Button>
          <IconButton label={liked ? "Unlike" : "Like"} active={liked} className="glass hover:glass-strong" onClick={() => void lib.toggle("likes", t)}>{liked ? <HeartActiveIcon /> : <HeartIcon />}</IconButton>
          <TrackMenu track={t} />
        </>} />
      {lyrics.data?.lyrics && (
        <section aria-label="Lyrics" className="px-4 md:px-0">
          <h2 className="mb-3 text-xl font-bold">Lyrics</h2>
          <div className="max-h-80 overflow-y-auto rounded-xl bg-surface p-5 text-base leading-relaxed">
            {lyrics.data.lyrics.lines.map((l, i) => <p key={i} className="min-h-[1.4em]">{l.text}</p>)}
            <p className="mt-4 text-xs text-muted">{lyrics.data.lyrics.attribution ?? `Source: ${lyrics.data.lyrics.source}`}</p>
          </div>
        </section>
      )}
      {related.isPending && <ShelfSkeleton />}
      {related.data?.shelves.map((s) => <ShelfView key={s.id} shelf={s} />)}
      {q.data.description && <section className="px-4 md:px-0"><h2 className="mb-2 text-xl font-bold">About</h2><p className="whitespace-pre-line text-sm text-muted">{q.data.description.slice(0, 1200)}</p></section>}
    </div>
  );
}
