import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ShelfSkeleton } from "../music/Shelf";
import { TrackListSkeleton } from "../music/TrackRow";

/**
 * YouTube-style loading placeholders: grey shimmer blocks in the exact shape of each page, shown
 * instantly while a route loads (Next `loading.tsx`) so navigation never looks frozen and nothing
 * jumps when the content arrives. Same paddings as the real pages (px-4 on phones, none on desktop).
 */
const Bone = ({ className }: { className?: string }) => <div aria-hidden className={cn("skeleton rounded-md", className)} />;

function Frame({ children, label = "Loading" }: { children: ReactNode; label?: string }) {
  return (
    <div role="status" aria-busy aria-label={label} className="flex flex-col gap-8 pt-2 md:gap-10">
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

const Title = ({ className }: { className?: string }) => <div className="px-4 md:px-0"><Bone className={cn("h-8 w-52 rounded-lg md:h-9", className)} /></div>;

function Chips({ n = 5 }: { n?: number }) {
  return (
    <div className="-mt-4 flex gap-2 overflow-hidden px-4 md:px-0">
      {Array.from({ length: n }, (_, i) => <div key={i} className="shrink-0" style={{ width: 64 + ((i * 29) % 40) }}><Bone className="h-9 w-full rounded-lg" /></div>)}
    </div>
  );
}

/** Quick picks: a grid of song rows (4 per column), like the real shelf. */
function QuickPicks() {
  return (
    <div aria-hidden>
      <div className="mb-3 px-4 md:px-0"><Bone className="h-6 w-40 rounded" /></div>
      <div className="grid grid-flow-col grid-rows-4 gap-x-6 gap-y-3 overflow-hidden px-4 [grid-auto-columns:85%] md:px-0 md:[grid-auto-columns:minmax(300px,1fr)]">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Bone className="h-12 w-12 shrink-0" />
            <div className="flex-1 space-y-2"><Bone className="h-3.5 w-3/4 rounded" /><Bone className="h-3 w-1/2 rounded" /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HomeSkeleton() {
  return <Frame label="Loading home"><Title /><Chips /><QuickPicks /><ShelfSkeleton /><ShelfSkeleton round /></Frame>;
}

export function ExploreSkeleton() {
  return (
    <Frame label="Loading explore">
      <div className="px-4 md:hidden"><Bone className="h-9 w-36 rounded-lg" /></div>
      <div className="grid grid-cols-3 gap-2 px-4 sm:gap-3 md:px-0">{Array.from({ length: 3 }, (_, i) => <Bone key={i} className="h-20 rounded-2xl sm:h-16 sm:rounded-lg" />)}</div>
      <QuickPicks /><ShelfSkeleton />
    </Frame>
  );
}

export function BrowseSkeleton() {
  return <Frame><Title className="w-64" /><ShelfSkeleton /><ShelfSkeleton /><ShelfSkeleton round /></Frame>;
}

export function SearchSkeleton() {
  return (
    <Frame label="Loading search">
      <div className="px-4 md:hidden"><Bone className="h-11 w-full rounded-lg" /></div>
      <Chips n={6} />
      <div className="px-2 md:px-0"><TrackListSkeleton rows={6} /></div>
      <ShelfSkeleton />
    </Frame>
  );
}

export function LibrarySkeleton() {
  return (
    <Frame label="Loading library">
      <div className="-mb-4 px-4 md:px-0"><Bone className="h-9 w-36 rounded-lg" /></div>
      <Chips n={4} />
      <div className="grid grid-cols-2 gap-4 px-4 sm:grid-cols-3 md:grid-cols-4 md:px-0 lg:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="space-y-2"><Bone className="aspect-square w-full rounded-[var(--radius-card)]" /><Bone className="h-3.5 w-4/5 rounded" /><Bone className="h-3 w-3/5 rounded" /></div>
        ))}
      </div>
    </Frame>
  );
}

/** Album / playlist / song: cover + title block (centered on phones, side by side on desktop) + tracks. */
export function CollectionSkeleton() {
  return (
    <Frame label="Loading">
      <div className="flex flex-col items-center gap-5 px-4 md:flex-row md:items-end md:gap-8 md:px-0">
        <Bone className="aspect-square w-48 rounded-lg md:w-64" />
        <div className="flex w-full flex-col items-center gap-3 md:items-start md:pb-2">
          <Bone className="h-3 w-24 rounded" />
          <Bone className="h-8 w-3/4 max-w-sm rounded-lg md:h-10" />
          <Bone className="h-3.5 w-1/2 max-w-xs rounded" />
          <div className="mt-2 flex gap-2"><Bone className="h-9 w-24 rounded-full" /><Bone className="h-9 w-24 rounded-full" /><Bone className="h-9 w-9 rounded-full" /></div>
        </div>
      </div>
      <div className="px-2 md:px-0"><TrackListSkeleton rows={8} /></div>
    </Frame>
  );
}

export function ArtistSkeleton() {
  return (
    <Frame label="Loading artist">
      <div className="relative">
        <Bone className="h-64 w-full rounded-none md:h-80 md:rounded-xl" />
        <div className="absolute inset-x-4 bottom-5 space-y-3 md:inset-x-8">
          <div className="h-10 w-2/3 max-w-md rounded-lg bg-surface-3/80" />
          <div className="flex gap-2"><div className="h-9 w-24 rounded-full bg-surface-3/80" /><div className="h-9 w-20 rounded-full bg-surface-3/80" /></div>
        </div>
      </div>
      <div className="px-4 md:px-0"><Bone className="h-6 w-36 rounded" /></div>
      <div className="-mt-6 px-2 md:px-0"><TrackListSkeleton rows={5} /></div>
      <ShelfSkeleton />
    </Frame>
  );
}

export function ListPageSkeleton() {
  return <Frame><Title className="w-40" /><div className="px-2 md:px-0"><TrackListSkeleton rows={10} /></div></Frame>;
}
