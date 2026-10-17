"use client";
import { useState } from "react";
import { formatDuration } from "@zuno/core";
import { cn } from "@/lib/cn";
import { usePlayer, usePlayerEngine } from "@/lib/player";
import { ARROW_SEEK_SEC } from "./Shortcuts";

/**
 * Seek bar: drawn layers (track → buffered → played → thumb) under a transparent native range
 * input, so visuals are exact while keyboard, screen-reader and touch behaviour stay native.
 */
export function SeekBar({ className, showTimes = true, variant = "default", layout = "inline" }: { className?: string; showTimes?: boolean; variant?: "default" | "edge"; layout?: "inline" | "stacked" }) {
  const engine = usePlayerEngine();
  const pos = usePlayer((s) => s.positionSec);
  const dur = usePlayer((s) => s.durationSec);
  const buffered = usePlayer((s) => s.bufferedSec);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? pos;
  const pct = dur > 0 ? Math.min(100, (shown / dur) * 100) : 0;
  const bufPct = dur > 0 ? Math.min(100, Math.max(pct, (buffered / dur) * 100)) : 0;
  const commit = () => { if (drag != null) { engine?.seek(drag); setDrag(null); } };
  const edge = variant === "edge";

  const stacked = layout === "stacked";
  return (
    <div className={cn("flex w-full", stacked ? "flex-col" : "items-center gap-3", className)}>
      {showTimes && !stacked && <span className="w-10 shrink-0 text-right text-xs text-muted tabular">{formatDuration(shown)}</span>}
      <div className={cn("group/seek relative", stacked ? "w-full" : "flex-1", edge ? "h-3" : "h-5")}>
        {/* track */}
        <div className={cn("pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-surface-3 transition-[height] duration-150", edge ? "h-[3px] group-hover/seek:h-[5px]" : "h-[4px] group-hover/seek:h-[6px]")}>
          <div className="absolute inset-y-0 left-0 bg-foreground/20" style={{ width: `${bufPct}%` }} />
          <div className="absolute inset-y-0 left-0 bg-[var(--song-accent)]" style={{ width: `${pct}%` }} />
        </div>
        {/* thumb */}
        <div
          className={cn("pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--song-accent)] shadow transition-transform duration-150",
            drag != null ? "scale-100" : "scale-0 group-hover/seek:scale-100 group-focus-within/seek:scale-100 [@media(pointer:coarse)]:scale-100")}
          style={{ left: `${pct}%` }}
        />
        <input
          type="range"
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
          min={0}
          max={dur || 0}
          step={0.1}
          value={shown}
          disabled={!dur}
          aria-label="Seek"
          aria-valuetext={`${formatDuration(shown)} of ${formatDuration(dur)}`}
          onKeyDown={(e) => {
            // Same 2 s step as the global arrow keys (the native step is 0.1 s).
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            e.stopPropagation();
            engine?.seek(engine.currentTime() + (e.key === "ArrowRight" ? ARROW_SEEK_SEC : -ARROW_SEEK_SEC));
          }}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
      </div>
      {showTimes && !stacked && <span className="w-10 shrink-0 text-xs text-muted tabular">{formatDuration(dur)}</span>}
      {/* Stacked (phone player): elapsed under the left end, total under the right end. */}
      {showTimes && stacked && (
        <div className="mt-0.5 flex justify-between text-xs text-muted tabular">
          <span>{formatDuration(shown)}</span><span>{formatDuration(dur)}</span>
        </div>
      )}
    </div>
  );
}

/** "1:23 / 4:22" — shown beside the transport controls on desktop. */
export function TimeReadout({ className }: { className?: string }) {
  const pos = usePlayer((s) => Math.floor(s.positionSec));
  const dur = usePlayer((s) => s.durationSec);
  if (!dur) return null;
  return <span className={cn("whitespace-nowrap text-xs text-muted tabular", className)}>{formatDuration(pos)} / {formatDuration(dur)}</span>;
}
