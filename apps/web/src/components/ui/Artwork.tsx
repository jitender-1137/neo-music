"use client";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { MusicNoteIcon } from "../icons";
import { sizedArtwork } from "@/lib/artwork";

export { sizedArtwork };

/** Fixed-aspect artwork with reserved space (no layout shift), lazy loading and a graceful fallback. */
export function Artwork({ src, alt, size, className, rounded = "md", priority = false }: {
  src?: string; alt: string; size: number; className?: string; rounded?: "md" | "full" | "none" | "lg"; priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  // 1.5× the CSS size: sharp on retina, ~40% fewer bytes than 2× (YouTube Music uses 226/302px cards).
  const url = sizedArtwork(src, Math.round(size * 1.5));
  const radius = rounded === "full" ? "rounded-full" : rounded === "lg" ? "rounded-lg" : rounded === "none" ? "" : "rounded-[var(--radius-card)]";
  return (
    <div className={cn("relative aspect-square shrink-0 overflow-hidden bg-surface-2", radius, className)}>
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote artwork is already CDN-sized; no Next image proxy
        <img
          src={url}
          alt={alt}
          width={size}
          height={size}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          referrerPolicy="no-referrer"
          // Covers are never dragged as files: a native image drag would cancel swipe gestures.
          draggable={false}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        // Labelled placeholder when the artwork has a name (screen readers still hear "… artwork").
        <div className="absolute inset-0 grid place-items-center text-subtle" {...(alt ? { role: "img", "aria-label": alt } : { "aria-hidden": true })}>
          <MusicNoteIcon className="h-1/3 w-1/3" aria-hidden />
        </div>
      )}
    </div>
  );
}
