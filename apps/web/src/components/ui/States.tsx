"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";
import { Button } from "./Button";
import { OfflineIcon, RefreshIcon, WarningIcon } from "../icons";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} aria-hidden />;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && <div className="text-subtle [&_svg]:h-12 [&_svg]:w-12">{icon}</div>}
      <h2 className="text-lg font-semibold">{title}</h2>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const offline = error instanceof ApiError && error.code === "network";
  const notFound = error instanceof ApiError && error.status === 404;
  const message = error instanceof ApiError ? error.message : "Something went wrong.";
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-3 px-6 text-center", compact ? "py-6" : "py-16")}>
      <div className="text-subtle [&_svg]:h-10 [&_svg]:w-10">{offline ? <OfflineIcon /> : <WarningIcon />}</div>
      <p className="font-medium">{notFound ? "We couldn't find that." : offline ? "You're offline" : "Couldn't load this"}</p>
      {!notFound && <p className="max-w-sm text-sm text-muted">{message}</p>}
      {onRetry && !notFound && <Button variant="outline" size="sm" icon={<RefreshIcon />} onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/** Animated equalizer bars for the now-playing row; static when paused. Not color-only: has an sr label. */
export function NowPlayingBars({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex h-4 items-end gap-[2px]", className)} role="img" aria-label={playing ? "Now playing" : "Paused"}>
      {[0, 0.2, 0.4].map((d) => (
        <span key={d} className={cn("w-[3px] origin-bottom rounded-sm bg-accent", playing ? "animate-[var(--animate-eq)]" : "")} style={{ height: "100%", animationDelay: `${d}s`, transform: playing ? undefined : "scaleY(0.4)" }} />
      ))}
    </span>
  );
}
