"use client";
import { useState } from "react";
import { isAppleMobile } from "@/lib/platform";
import { cn } from "@/lib/cn";
import { usePlayer, usePlayerEngine } from "@/lib/player";
import { IconButton } from "../ui/Button";
import { PauseIcon, PlayIcon, RepeatIcon, RepeatOneIcon, ShuffleIcon, SkipNextIcon, SkipPreviousIcon, VolumeLoudIcon, VolumeMutedIcon, VolumeSmallIcon } from "../icons";

export function PlayPauseButton({ size = "lg", className }: { size?: "md" | "lg" | "xl"; className?: string }) {
  const engine = usePlayerEngine();
  const status = usePlayer((s) => s.status);
  const hasTrack = usePlayer((s) => s.queue.index >= 0);
  const playing = status === "playing" || status === "buffering" || status === "seeking";
  const busy = status === "loading" || status === "buffering";
  return (
    <IconButton label={playing ? "Pause" : "Play"} size={size} disabled={!hasTrack} onClick={() => engine?.togglePlay()}
      className={cn("relative overflow-visible", className)} aria-pressed={playing} aria-busy={busy || undefined}>
      {/* Loading / buffering: a spinning ring AROUND the button in the song's colour (visible on the
          white play button too, where an inner spinner would vanish). */}
      {busy && <span data-loading-ring className="pointer-events-none absolute -inset-[4px] animate-spin rounded-full border-[2.5px] border-foreground/15 border-t-[var(--song-accent)] [animation-duration:0.9s]" aria-hidden />}
      {playing || status === "loading" ? <PauseIcon /> : <PlayIcon />}
    </IconButton>
  );
}

export function TransportControls({ big }: { big?: boolean }) {
  const engine = usePlayerEngine();
  const hasTrack = usePlayer((s) => s.queue.index >= 0);
  const hasNext = usePlayer((s) => s.queue.index < s.queue.entries.length - 1 || s.repeat === "all" || s.autoplay);
  return (
    <div className="flex items-center gap-1 md:gap-2">
      <IconButton label="Previous" size={big ? "lg" : "md"} disabled={!hasTrack} onClick={() => engine?.previous()}><SkipPreviousIcon /></IconButton>
      <PlayPauseButton size={big ? "xl" : "lg"} className={big ? "bg-foreground text-background hover:bg-foreground/90" : undefined} />
      <IconButton label="Next" size={big ? "lg" : "md"} disabled={!hasTrack || !hasNext} onClick={() => engine?.next()}><SkipNextIcon /></IconButton>
    </div>
  );
}

export function ShuffleButton({ size = "md" }: { size?: "sm" | "md" }) {
  const engine = usePlayerEngine();
  const on = usePlayer((s) => s.shuffle);
  return <IconButton label={on ? "Shuffle on" : "Shuffle off"} aria-pressed={on} size={size} active={on} onClick={() => engine?.toggleShuffle()}><ShuffleIcon /></IconButton>;
}

export function RepeatButton({ size = "md" }: { size?: "sm" | "md" }) {
  const engine = usePlayerEngine();
  const mode = usePlayer((s) => s.repeat);
  const label = mode === "off" ? "Repeat off" : mode === "all" ? "Repeat all" : "Repeat one";
  return (
    <IconButton label={label} aria-pressed={mode !== "off"} size={size} active={mode !== "off"} onClick={() => engine?.cycleRepeat()}>
      {mode === "one" ? <RepeatOneIcon /> : <RepeatIcon />}
    </IconButton>
  );
}

export function VolumeControl() {
  const engine = usePlayerEngine();
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  // iPad (tablet layout): the level is hardware-only there, so show just the mute button.
  const [apple] = useState(isAppleMobile);
  const v = muted ? 0 : apple ? 1 : volume;
  const mute = (
    <IconButton label={muted ? "Unmute" : "Mute"} size="md" onClick={() => engine?.toggleMute()}>
      {v === 0 ? <VolumeMutedIcon /> : v < 0.5 ? <VolumeSmallIcon /> : <VolumeLoudIcon />}
    </IconButton>
  );
  if (apple) return mute;
  return (
    <div className="group flex items-center gap-1">
      {mute}
      <div className="group/vol relative h-5 w-20 lg:w-24">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[4px] -translate-y-1/2 overflow-hidden rounded-full bg-surface-3">
          <div className="absolute inset-y-0 left-0 bg-foreground" style={{ width: `${v * 100}%` }} />
        </div>
        <div className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-foreground shadow transition-transform group-hover/vol:scale-100 group-focus-within/vol:scale-100" style={{ left: `${v * 100}%` }} />
        <input type="range" className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0" min={0} max={1} step={0.01} value={v} aria-label="Volume"
          aria-valuetext={`${Math.round(v * 100)}%`} onChange={(e) => engine?.setVolume(Number(e.target.value))} />
      </div>
    </div>
  );
}
