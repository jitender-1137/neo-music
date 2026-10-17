"use client";
import { useNotInterested } from "@/lib/notInterested";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Shelf as ShelfT, Track } from "@zuno/core";
import { usePlayerEngine } from "@/lib/player";
import { IconButton } from "../ui/Button";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { CardSkeleton, LinkChip, MediaCard } from "./MediaCard";
import { TrackRow } from "./TrackRow";

export function ShelfHeader({ title, subtitle, moreHref, controls }: { title: string; subtitle?: string; moreHref?: string; controls?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4 px-4 md:px-0">
      <div className="min-w-0">
        {subtitle && <p className="text-sm uppercase tracking-wide text-muted">{subtitle}</p>}
        <h2 className="line-clamp-1 text-xl font-bold md:text-2xl">{title}</h2>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {moreHref && <Link href={moreHref} prefetch={false} className="flex h-8 items-center rounded-full glass px-3 text-xs font-medium hover:glass-strong">More</Link>}
        {controls}
      </div>
    </div>
  );
}

/** Horizontal carousel with keyboard/scroll-button navigation and native touch scrolling. */
export function Carousel({ title, subtitle, moreHref, children, label }: { title: string; subtitle?: string; moreHref?: string; children: ReactNode; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, []);
  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: "smooth" });
  return (
    <section aria-label={label ?? title} className="min-w-0">
      <ShelfHeader title={title} subtitle={subtitle} moreHref={moreHref} controls={
        <div className="hidden gap-1 md:flex">
          <IconButton label="Scroll left" size="sm" disabled={edges.start} onClick={() => page(-1)} className="glass hover:glass-strong"><ChevronLeftIcon /></IconButton>
          <IconButton label="Scroll right" size="sm" disabled={edges.end} onClick={() => page(1)} className="glass hover:glass-strong"><ChevronRightIcon /></IconButton>
        </div>
      } />
      <div
        ref={ref}
        className="scroller flex gap-4 overflow-x-auto px-4 pb-2 md:px-0 md:gap-6"
        // Arrow keys page the shelf while focus is inside it (instead of seeking the song).
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          e.preventDefault();
          page(e.key === "ArrowRight" ? 1 : -1);
        }}
      >{children}</div>
    </section>
  );
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Renders any provider shelf with the right layout (quick-picks grid, cards, chips). */
export function ShelfView({ shelf: raw, priority, contextType = "home" }: { shelf: ShelfT; priority?: boolean; contextType?: "home" | "artist" | "search" }) {
  const engine = usePlayerEngine();
  // Songs marked "Not interested" (guests: on this device) disappear from recommendation shelves.
  const hidden = useNotInterested();
  const shelf = hidden.size ? { ...raw, items: raw.items.filter((i) => !(i.kind === "track" && hidden.has(i.track.id))) } : raw;
  const more = shelf.more ? `/explore/${encodeURIComponent(shelf.more.browseId)}?title=${encodeURIComponent(shelf.title)}${shelf.more.params ? `&params=${encodeURIComponent(shelf.more.params)}` : ""}` : undefined;

  if (shelf.layout === "list") {
    const tracks = shelf.items.flatMap((i) => (i.kind === "track" ? [i.track] : []));
    // Quick-picks: columns of 4 rows that scroll horizontally, like YouTube Music.
    return (
      <Carousel title={shelf.title} subtitle={shelf.subtitle} moreHref={more}>
        {chunk(tracks, 4).map((col, ci) => (
          <div key={ci} role="list" aria-label={`${shelf.title}, part ${ci + 1}`} className="flex w-[min(85vw,360px)] shrink-0 flex-col md:w-[400px]">
            {col.map((t, ri) => (
              <TrackRow key={t.id} track={t} compact onPlay={() => playFromShelf(engine, tracks, ci * 4 + ri, shelf.title, contextType)} />
            ))}
          </div>
        ))}
      </Carousel>
    );
  }
  if (shelf.layout === "chips") {
    const links = shelf.items.filter((i) => i.kind === "link");
    return (
      <section aria-label={shelf.title}>
        <ShelfHeader title={shelf.title} />
        <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 md:px-0 lg:grid-cols-4 xl:grid-cols-5">
          {links.map((i, k) => i.kind === "link" && <LinkChip key={`${i.link.browseId}${i.link.params}${k}`} item={i} />)}
        </div>
      </section>
    );
  }
  return (
    <Carousel title={shelf.title} subtitle={shelf.subtitle} moreHref={more}>
      {shelf.items.map((i, k) => i.kind === "link" ? <LinkChip key={k} item={i} /> : <MediaCard key={`${i.kind}-${k}`} item={i} priority={priority && k < 4} />)}
    </Carousel>
  );
}

function playFromShelf(engine: ReturnType<typeof usePlayerEngine>, tracks: Track[], i: number, title: string, type: "home" | "artist" | "search") {
  const t = tracks[i];
  if (!engine || !t) return;
  // Single song from a feed → radio from it (YouTube Music behaviour).
  if (type === "home") engine.playTrack(t, { type: "home", title });
  else engine.playList(tracks, i, { type, title });
}

export function ShelfSkeleton({ round }: { round?: boolean }) {
  return (
    <div aria-hidden>
      <div className="mb-3 px-4 md:px-0"><div className="skeleton h-6 w-48 rounded" /></div>
      <div className="flex gap-4 overflow-hidden px-4 md:gap-6 md:px-0">{Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} round={round} />)}</div>
    </div>
  );
}
