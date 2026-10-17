"use client";
import Link from "next/link";
import type { BrowsePage } from "@zuno/core";
import { useBrowse, useExplore } from "@/lib/queries";
import { ShelfSkeleton, ShelfView } from "../music/Shelf";
import { EmptyState, ErrorState } from "../ui/States";
import { ChartIcon, StarsIcon, MusicNoteIcon, HeadphonesIcon } from "../icons";

const CHIP_ICONS: Record<string, typeof ChartIcon> = { FEmusic_new_releases: StarsIcon, FEmusic_charts: ChartIcon, FEmusic_moods_and_genres: MusicNoteIcon };

export function ExploreView({ initial }: { initial?: BrowsePage }) {
  const q = useExplore(initial);
  return (
    <div className="flex flex-col gap-10 pt-2 max-md:gap-8">
      {/* Large title on phones only (iOS convention); larger screens are unchanged. */}
      <h1 className="-mb-4 px-4 text-[32px] font-bold leading-tight md:hidden">Explore</h1>
      <div className="grid grid-cols-3 gap-2 px-4 sm:gap-3 md:px-0">
        {(q.data?.chips ?? []).filter((c) => c.browseId !== "FEmusic_non_music_audio").map((c) => {
          const Icon = CHIP_ICONS[c.browseId] ?? HeadphonesIcon;
          return (
            <Link key={c.browseId} href={`/explore/${encodeURIComponent(c.browseId)}?title=${encodeURIComponent(c.title)}${c.params ? `&params=${encodeURIComponent(c.params)}` : ""}`}
              className="m-press flex h-20 flex-col items-center justify-center gap-1.5 rounded-2xl glass px-2 text-center text-[13px] font-semibold leading-tight transition-colors hover:glass-strong sm:h-16 sm:flex-row sm:justify-start sm:gap-4 sm:rounded-lg sm:px-5 sm:text-left sm:text-lg [&_svg]:h-5 [&_svg]:w-5 [&_svg]:shrink-0 [&_svg]:text-accent">
              <Icon />{c.title}
            </Link>
          );
        })}
      </div>
      {q.isPending && <><ShelfSkeleton /><ShelfSkeleton /></>}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data?.shelves.map((s, i) => <ShelfView key={`${s.id}-${i}`} shelf={s} priority={i === 0} />)}
    </div>
  );
}

export function BrowseView({ browseId, params, title, initial }: { browseId: string; params?: string; title?: string; initial?: BrowsePage }) {
  const q = useBrowse(browseId, params, initial);
  return (
    <div className="flex flex-col gap-10 pt-2">
      <h1 className="px-4 text-3xl font-bold md:px-0">{q.data?.title || title || "Explore"}</h1>
      {q.isPending && <><ShelfSkeleton /><ShelfSkeleton /></>}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && !q.data.shelves.length && <EmptyState title="Nothing here yet" body="This collection is empty in your region right now." />}
      {q.data?.shelves.map((s, i) => <ShelfView key={`${s.id}-${i}`} shelf={s} priority={i === 0} />)}
    </div>
  );
}
