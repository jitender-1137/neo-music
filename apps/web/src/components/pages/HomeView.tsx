"use client";
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { BrowsePage, Shelf } from "@zuno/core";
import { cn } from "@/lib/cn";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { newestFirst } from "@/lib/guestDb";
import { useHome, useHomeChip } from "@/lib/queries";
import { ShelfSkeleton, ShelfView } from "../music/Shelf";
import { ErrorState } from "../ui/States";

function useGuestSeeds(enabled: boolean) {
  const [seeds, setSeeds] = useState<string[] | null>(enabled ? null : []);
  useEffect(() => {
    if (!enabled) { setSeeds([]); return; }
    newestFirst("history", 30)
      .then((h) => setSeeds([...new Set(h.map((x) => x.track.id))].filter((id) => /^[\w-]{11}$/.test(id)).slice(0, 10)))
      .catch(() => setSeeds([]));
  }, [enabled]);
  return seeds;
}

function MoreShelves({ continuation }: { continuation?: string }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const q = useInfiniteQuery({
    queryKey: ["home-more", continuation],
    initialPageParam: continuation,
    queryFn: ({ pageParam, signal }) => api.get<BrowsePage>(`/api/v1/home${qs({ continuation: pageParam })}`, { signal }),
    getNextPageParam: (last) => last.continuation,
    enabled: false,
  });
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !continuation) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || q.isFetching) return;
      if (!q.data) void q.refetch();
      else if (q.hasNextPage) void q.fetchNextPage();
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [continuation, q]);
  const shelves = q.data?.pages.flatMap((p) => p.shelves) ?? [];
  return (
    <>
      {shelves.map((s, i) => <ShelfView key={`${s.id}-${i}`} shelf={s} />)}
      {q.isFetching && <ShelfSkeleton />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />}
      {(q.hasNextPage || !q.data) && continuation && <div ref={sentinel} aria-hidden className="h-4" />}
    </>
  );
}

export function HomeView({ initial }: { initial?: BrowsePage }) {
  const { user, loading } = useAuth();
  const seeds = useGuestSeeds(!loading && !user);
  const home = useHome(seeds ?? [], !loading && seeds !== null);
  const [chip, setChip] = useState<string | null>(null);
  const chipFeed = useHomeChip(chip);
  // Time-of-day greeting uses the visitor's clock, so it's computed after mount (server time
  // zone ≠ visitor's would mismatch during hydration).
  const [greeting, setGreeting] = useState("Welcome");
  useEffect(() => { const h = new Date().getHours(); setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"); }, []);
  // Until personalized results arrive, show the server-rendered public feed (no blank skeleton).
  const homeData = home.data ?? (initial ? { ...initial, personalized: false, configVersion: "ssr" } : undefined);
  const shelves: Shelf[] = chip ? chipFeed.data?.shelves ?? [] : homeData?.shelves ?? [];
  const pending = chip ? chipFeed.isPending : !homeData && home.isPending;
  const error = chip ? chipFeed.error : home.error;

  return (
    <div className="flex flex-col gap-8 pt-2 md:gap-10">
      <div className="px-4 md:px-0">
        <h1 className="text-2xl font-bold md:text-3xl">{user ? `${greeting}, ${user.displayName.split(" ")[0]}` : greeting}</h1>
      </div>
      {homeData?.chips && homeData.chips.length > 0 && (
        <div className="scroller -mt-4 flex gap-2 overflow-x-auto px-4 md:px-0" role="toolbar" aria-label="Moods">
          {homeData.chips.map((c) => (
            <button key={c.title} onClick={() => setChip((cur) => (cur === c.params ? null : c.params ?? null))} aria-pressed={chip === c.params}
              className={cn("h-9 shrink-0 rounded-lg px-4 text-sm font-medium transition-colors", chip === c.params ? "bg-foreground text-background" : "glass hover:glass-strong")}>
              {c.title}
            </button>
          ))}
        </div>
      )}
      {pending && <><ShelfSkeleton /><ShelfSkeleton /><ShelfSkeleton round /></>}
      {error && <ErrorState error={error} onRetry={() => void (chip ? chipFeed.refetch() : home.refetch())} />}
      {shelves.map((s, i) => <ShelfView key={`${s.id}-${i}`} shelf={s} priority={i <= 1} contextType="home" />)}
      {!chip && home.data && <MoreShelves continuation={home.data.continuation} />}
    </div>
  );
}
