"use client";
import { selectCurrent, usePlayer } from "@/lib/player";
import { useRelated } from "@/lib/queries";
import { ErrorState } from "../ui/States";
import { ShelfView } from "../music/Shelf";

/** Songs and artists related to the current track (Now Playing → Related). */
export function Related() {
  const t = usePlayer(selectCurrent);
  const q = useRelated(t?.id);
  if (q.isPending) return <p className="p-4 text-sm text-muted">Loading…</p>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />;
  if (!q.data.shelves.length) return <p className="p-6 text-center text-sm text-muted">No related music found.</p>;
  return <div className="flex flex-col gap-8 pb-8">{q.data.shelves.map((s) => <ShelfView key={s.id} shelf={s} />)}</div>;
}
