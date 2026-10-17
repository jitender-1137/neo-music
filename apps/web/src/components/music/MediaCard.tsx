"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ShelfItem, Track } from "@zuno/core";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { usePlayer, usePlayerEngine } from "@/lib/player";
import { Artwork } from "../ui/Artwork";
import { PauseIcon, PlayIcon } from "../icons";
import { albumHref, artistHref, playlistHref, trackHref } from "./links";
import { TrackMenu } from "./TrackMenu";
import type { AlbumPage, PlaylistPage } from "@zuno/core";

/** Fetch a collection's tracks and play it — used by card play buttons. */
export function usePlayCollection() {
  const engine = usePlayerEngine();
  return async (item: ShelfItem, shuffle = false) => {
    if (!engine) return;
    if (item.kind === "track") return engine.playTrack(item.track, { type: "home" });
    if (item.kind === "album") {
      const a = await api.get<AlbumPage>(`/api/v1/albums/${encodeURIComponent(item.album.id)}`);
      engine.playList(a.tracks, 0, { type: "album", id: a.album.id, title: a.album.title }, { shuffle });
    } else if (item.kind === "playlist") {
      const p = await api.get<PlaylistPage>(`/api/v1/playlists/${encodeURIComponent(item.playlist.id)}`);
      engine.playList(p.tracks, 0, { type: "playlist", id: p.playlist.id, title: p.playlist.title }, { shuffle });
    }
  };
}

function hrefFor(item: ShelfItem): string {
  switch (item.kind) {
    case "track": return trackHref(item.track);
    case "album": return albumHref(item.album);
    case "playlist": return playlistHref(item.playlist);
    case "artist": return artistHref(item.artist);
    case "link": return `/explore/${encodeURIComponent(item.link.browseId)}${item.link.params ? `?params=${encodeURIComponent(item.link.params)}&title=${encodeURIComponent(item.link.title)}` : `?title=${encodeURIComponent(item.link.title)}`}`;
  }
}

export function MediaCard({ item, size = 180, priority }: { item: Exclude<ShelfItem, { kind: "link" }>; size?: number; priority?: boolean }) {
  const engine = usePlayerEngine();
  const router = useRouter();
  const play = usePlayCollection();
  const isTrack = item.kind === "track";
  const contextId = usePlayer((s) => s.context?.id);
  const currentId = usePlayer((s) => s.queue.entries[s.queue.index]?.track.id);
  const playing = usePlayer((s) => s.status === "playing" || s.status === "buffering");
  const id = item.kind === "track" ? item.track.id : item.kind === "album" ? item.album.id : item.kind === "playlist" ? item.playlist.id : item.artist.id;
  const isActive = isTrack ? currentId === id : contextId === id;
  const title = item.kind === "track" ? item.track.title : item.kind === "album" ? item.album.title : item.kind === "playlist" ? item.playlist.title : item.artist.name;
  const subtitle = item.kind === "track" ? item.track.artist
    : item.kind === "album" ? [item.album.releaseType === "ep" ? "EP" : item.album.releaseType === "single" ? "Single" : "Album", item.album.artist, item.album.year].filter(Boolean).join(" • ")
    : item.kind === "playlist" ? ["Playlist", item.playlist.owner, item.playlist.trackCountText].filter(Boolean).join(" • ")
    : item.artist.subscriberCount ?? "Artist";
  const art = item.kind === "track" ? item.track.artworkUrl : item.kind === "album" ? item.album.artworkUrl : item.kind === "playlist" ? item.playlist.artworkUrl : item.artist.artworkUrl;
  const round = item.kind === "artist";
  const href = hrefFor(item);

  return (
    <div className="group relative flex shrink-0 flex-col gap-2" style={{ width: size || "100%" }}>
      <div className="relative">
        <Link href={href} aria-label={title} prefetch={false} className="block" onClick={(e) => { if (isTrack) { e.preventDefault(); engine?.playTrack(item.track, { type: "home" }); } }}>
          <Artwork src={art} alt="" size={size || 220} rounded={round ? "full" : "md"} priority={priority} className="w-full" />
        </Link>
        {item.kind !== "artist" && (
          <button
            aria-label={isActive && playing ? `Pause ${title}` : `Play ${title}`}
            onClick={() => (isActive ? engine?.togglePlay() : void play(item))}
            className={cn("absolute bottom-2 right-2 grid h-11 w-11 place-items-center rounded-full bg-black/70 text-white shadow-lg backdrop-blur transition-all [&_svg]:h-5 [&_svg]:w-5",
              isActive ? "opacity-100" : "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:hidden")}
          >
            {isActive && playing ? <PauseIcon /> : <PlayIcon />}
          </button>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-start gap-1">
          <Link href={href} prefetch={false} className={cn("line-clamp-2 flex-1 text-sm font-medium hover:underline", round && "text-center", isActive && "text-accent")}
            onClick={(e) => { if (isTrack) { e.preventDefault(); router.push(href); } }}>{title}</Link>
          {isTrack && <span className="opacity-0 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"><TrackMenu track={item.track as Track} /></span>}
        </div>
        <div className={cn("line-clamp-2 text-sm text-muted", round && "text-center")}>{subtitle}</div>
      </div>
    </div>
  );
}

export function LinkChip({ item }: { item: Extract<ShelfItem, { kind: "link" }> }) {
  return (
    <Link href={hrefFor(item)} prefetch={false} className="flex h-12 items-center overflow-hidden rounded-lg bg-surface-2 pl-0 pr-4 text-sm font-medium transition-colors hover:glass-strong" style={{ minWidth: 160 }}>
      <span className="mr-3 h-full w-1.5 shrink-0" style={{ background: item.link.color ?? "var(--color-accent)" }} aria-hidden />
      <span className="line-clamp-1">{item.link.title}</span>
    </Link>
  );
}

export function CardSkeleton({ size = 180, round }: { size?: number; round?: boolean }) {
  return (
    <div className="flex shrink-0 flex-col gap-2" style={{ width: size }} aria-hidden>
      <div className={cn("skeleton aspect-square w-full", round ? "rounded-full" : "rounded-[var(--radius-card)]")} />
      <div className="skeleton h-3.5 w-4/5 rounded" />
      <div className="skeleton h-3 w-3/5 rounded" />
    </div>
  );
}
