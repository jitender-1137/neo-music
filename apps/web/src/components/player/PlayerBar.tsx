"use client";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { selectCurrent, usePlayer, usePlayerEngine } from "@/lib/player";
import { useLibrary, useSaved } from "@/lib/library";
import { Artwork } from "../ui/Artwork";
import { IconButton } from "../ui/Button";
import { ChevronDownIcon, ChevronUpIcon, HeartActiveIcon, HeartIcon, PauseIcon, PlayIcon, SkipNextIcon, WarningIcon } from "../icons";
import { ArtistLinks } from "../music/ArtistLinks";
import { TrackMenu } from "../music/TrackMenu";
import { trackHref } from "../music/links";
import { RepeatButton, ShuffleButton, TransportControls, VolumeControl } from "./Controls";
import { SeekBar, TimeReadout } from "./SeekBar";

function LikeButton({ size = "md" }: { size?: "sm" | "md" }) {
  const t = usePlayer(selectCurrent);
  const liked = useSaved("likes", t?.id);
  const lib = useLibrary();
  if (!t) return null;
  return <IconButton label={liked ? "Unlike" : "Like"} size={size} active={liked} onClick={() => void lib.toggle("likes", t)}>{liked ? <HeartActiveIcon /> : <HeartIcon />}</IconButton>;
}

function ErrorLine() {
  const err = usePlayer((s) => s.error);
  if (!err) return null;
  return <div role="status" className="flex items-center gap-1.5 text-xs text-warning [&_svg]:h-4 [&_svg]:w-4"><WarningIcon />{err.message}</div>;
}

/**
 * Tablet/desktop: full-width bar (YouTube Music layout). Phones use MobilePlayer instead.
 * Tapping the artwork or the chevron opens the full Now Playing view.
 */
export function PlayerBar({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const engine = usePlayerEngine();
  const track = usePlayer(selectCurrent);
  const status = usePlayer((s) => s.status);
  const pct = usePlayer((s) => (s.durationSec > 0 ? (s.positionSec / s.durationSec) * 100 : 0));
  if (!track) return null;
  const playing = status === "playing" || status === "buffering" || status === "loading";

  return (
    <>
      {/* Desktop / tablet bar — full width, progress line on its top edge (YouTube Music layout) */}
      <div className="fixed inset-x-0 bottom-0 z-40 hidden h-[var(--spacing-player)] glass-bar md:block" role="region" aria-label="Player">
        <div className="absolute inset-x-0 top-0 -translate-y-1/2"><SeekBar showTimes={false} variant="edge" /></div>
        <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] items-center gap-4 px-4">
          <div className="flex min-w-0 items-center gap-1">
            <TransportControls />
            <TimeReadout className="ml-2 hidden lg:inline" />
          </div>
          <div className="flex min-w-0 items-center justify-center gap-3">
            <button onClick={onToggle} aria-label={expanded ? "Close now playing" : "Open now playing"} className="shrink-0"><Artwork src={track.artworkUrl} alt="" size={44} className="w-11" /></button>
            <div className="min-w-0">
              <Link href={trackHref(track)} className="line-clamp-1 text-sm font-medium hover:underline">{track.title}</Link>
              <div className="line-clamp-1 text-xs text-muted"><ArtistLinks item={track} />{track.album ? ` • ${track.album}` : ""}</div>
              <ErrorLine />
            </div>
            <LikeButton size="sm" />
            <TrackMenu track={track} />
          </div>
          <div className="flex min-w-0 items-center justify-end gap-1">
            <div className="hidden md:block"><VolumeControl /></div>
            <RepeatButton /><ShuffleButton />
            <IconButton label={expanded ? "Close now playing" : "Open now playing"} aria-expanded={expanded} onClick={onToggle}>
              {expanded ? <ChevronDownIcon /> : <ChevronUpIcon />}
            </IconButton>
          </div>
        </div>
      </div>

    </>
  );
}
