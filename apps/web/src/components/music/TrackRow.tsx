"use client";
import { memo, type ReactNode } from "react";
import Link from "next/link";
import type { Track } from "@zuno/core";
import { formatDuration } from "@zuno/core";
import { cn } from "@/lib/cn";
import { usePlayer, usePlayerEngine } from "@/lib/player";
import { useLibrary, useSaved } from "@/lib/library";
import { Artwork } from "../ui/Artwork";
import { IconButton } from "../ui/Button";
import { NowPlayingBars } from "../ui/States";
import { HeartActiveIcon, HeartIcon, PauseIcon, PlayIcon } from "../icons";
import { ArtistLinks } from "./ArtistLinks";
import { TrackMenu } from "./TrackMenu";
import { albumHref } from "./links";

/**
 * One song row. `onPlay` decides *what* plays (the whole list from here, or just this song);
 * the row only shows state. Re-renders only when this row's playing state flips.
 */
export const TrackRow = memo(function TrackRow({
  track, index, onPlay, showArtwork = true, showAlbum = false, showIndex = false, compact = false, hideAlbum = false, menuExtra, onRemove, removeLabel, dragHandle,
}: {
  track: Track; index?: number; onPlay: () => void; showArtwork?: boolean; showAlbum?: boolean; showIndex?: boolean; compact?: boolean; hideAlbum?: boolean;
  menuExtra?: ReactNode; onRemove?: () => void; removeLabel?: string; dragHandle?: ReactNode;
}) {
  const engine = usePlayerEngine();
  const isCurrent = usePlayer((s) => s.queue.entries[s.queue.index]?.track.id === track.id);
  const playing = usePlayer((s) => s.status === "playing" || s.status === "buffering" || s.status === "loading");
  const liked = useSaved("likes", track.id);
  const lib = useLibrary();
  const active = isCurrent && playing;
  const label = `${track.title} by ${track.artist}`;

  return (
    <div
      role="listitem"
      aria-current={isCurrent ? "true" : undefined}
      className={cn("group grid select-none items-center gap-3 rounded-lg px-2 transition-colors hover:bg-hover", compact ? "py-1.5" : "py-2", isCurrent && "bg-hover",
        showAlbum ? "grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_auto]" : "grid-cols-[auto_minmax(0,1fr)_auto]")}
      onDoubleClick={onPlay}
    >
      <div className="relative flex items-center gap-2">
        {dragHandle}
        {showIndex && !showArtwork && (
          <div className="grid w-8 place-items-center text-sm text-muted tabular">
            {isCurrent ? <NowPlayingBars playing={active} /> : <span className="group-hover:hidden">{(index ?? 0) + 1}</span>}
            {!isCurrent && <button aria-label={`Play ${label}`} onClick={onPlay} className="hidden group-hover:block [&_svg]:h-5 [&_svg]:w-5"><PlayIcon /></button>}
          </div>
        )}
        {showArtwork && (
          <button aria-label={active ? `Pause ${label}` : `Play ${label}`} onClick={() => (isCurrent ? engine?.togglePlay() : onPlay())} className="relative block">
            <Artwork src={track.artworkUrl} alt="" size={compact ? 40 : 48} className={compact ? "w-10" : "w-12"} />
            <span className={cn("absolute inset-0 grid place-items-center rounded-[var(--radius-card)] bg-black/50 text-white transition-opacity [&_svg]:h-5 [&_svg]:w-5", isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")}>
              {isCurrent && active ? <><span className="group-hover:hidden"><NowPlayingBars playing /></span><PauseIcon className="hidden group-hover:block" /></> : <PlayIcon />}
            </span>
          </button>
        )}
      </div>
      <div className="min-w-0 cursor-default" onClick={(e) => { if ((e.target as HTMLElement).closest("a,button")) return; if (window.matchMedia("(pointer: coarse)").matches) onPlay(); }}>
        <div className={cn("line-clamp-1 font-medium", isCurrent && "text-accent")}>
          {track.title}
          {track.isExplicit && <span className="ml-1.5 inline-grid h-4 w-4 place-items-center rounded-sm bg-surface-3 align-[1px] text-[10px] font-bold text-muted" aria-label="Explicit" title="Explicit">E</span>}
        </div>
        <div className="line-clamp-1 text-sm text-muted">
          <ArtistLinks item={track} />
          {!showAlbum && !hideAlbum && track.album && <> • {track.albumId ? <Link href={albumHref({ id: track.albumId })} className="hover:underline">{track.album}</Link> : track.album}</>}
          {!showAlbum && !track.album && track.viewCountText && <> • {track.viewCountText}</>}
        </div>
      </div>
      {showAlbum && (
        <div className="hidden min-w-0 text-sm text-muted md:block">
          {track.albumId ? <Link href={albumHref({ id: track.albumId })} className="line-clamp-1 hover:underline">{track.album}</Link> : <span className="line-clamp-1">{track.album}</span>}
        </div>
      )}
      <div className="flex items-center gap-1">
        <IconButton label={liked ? `Unlike ${track.title}` : `Like ${track.title}`} size="sm" active={liked}
          className={cn("hidden sm:inline-grid", !liked && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
          onClick={(e) => { e.stopPropagation(); void lib.toggle("likes", track); }}>
          {liked ? <HeartActiveIcon /> : <HeartIcon />}
        </IconButton>
        {track.durationSec ? <span className="hidden w-12 text-right text-sm text-muted tabular sm:block">{formatDuration(track.durationSec)}</span> : null}
        <TrackMenu track={track} extra={menuExtra} onRemove={onRemove} removeLabel={removeLabel} />
      </div>
    </div>
  );
});

export function TrackListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1" aria-busy aria-label="Loading songs">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <div className="skeleton h-12 w-12 rounded-md" />
          <div className="flex-1 space-y-2"><div className="skeleton h-3.5 w-1/2 rounded" /><div className="skeleton h-3 w-1/3 rounded" /></div>
        </div>
      ))}
    </div>
  );
}
