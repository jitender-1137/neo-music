"use client";
import type { ReactNode } from "react";
import { Artwork } from "../ui/Artwork";

/** Album / playlist / song header: artwork + identity + actions, stacked on mobile. */
export function MediaHeader({ art, title, kicker, meta, description, actions, round }: {
  art?: string; title: string; kicker?: ReactNode; meta?: ReactNode; description?: string; actions?: ReactNode; round?: boolean;
}) {
  return (
    <header className="relative flex flex-col items-center gap-5 px-4 pb-6 pt-4 text-center md:flex-row md:items-end md:gap-8 md:px-0 md:pt-8 md:text-left">
      <Artwork src={art} alt="" size={264} priority rounded={round ? "full" : "lg"} className="w-[min(64vw,264px)] shadow-2xl md:w-[264px]" />
      <div className="flex min-w-0 flex-col items-center gap-2 md:items-start">
        {kicker && <div className="text-sm text-muted">{kicker}</div>}
        <h1 className="line-clamp-2 text-3xl font-bold leading-tight md:text-5xl">{title}</h1>
        {meta && <div className="text-sm text-muted">{meta}</div>}
        {description && <p className="line-clamp-3 max-w-2xl text-sm text-muted">{description}</p>}
        {actions && <div className="mt-3 flex flex-wrap items-center justify-center gap-2 md:justify-start">{actions}</div>}
      </div>
    </header>
  );
}
