"use client";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { QueueEntry } from "@zuno/player";
import { formatDuration } from "@zuno/core";
import { cn } from "@/lib/cn";
import { usePlayer, usePlayerEngine } from "@/lib/player";
import { Artwork } from "../ui/Artwork";
import { IconButton } from "../ui/Button";
import { NowPlayingBars } from "../ui/States";
import { CloseIcon, DragIcon, TrashIcon } from "../icons";
import { useRef } from "react";
import { useSwipe } from "@/hooks/useSwipe";
import { springTo, stopSpring } from "@/lib/spring";
import { PHONE_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";

function Row({ e, index, current, playing, sortable }: { e: QueueEntry; index: number; current: boolean; playing: boolean; sortable: boolean }) {
  const engine = usePlayerEngine();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: e.uid, disabled: !sortable });
  // Phones: swipe a row left to remove it (Apple Music queue). The row content follows the finger.
  const phone = useMediaQuery(PHONE_QUERY);
  const content = useRef<HTMLDivElement>(null);
  const reveal = useRef<HTMLDivElement>(null);
  const slide = (x: number | null) => {
    const el = content.current;
    if (!el) return;
    if (reveal.current) reveal.current.style.opacity = x != null && x < 0 ? "1" : "0";
    // Opaque only while sliding, so the red layer shows beside the row, not through it.
    el.style.backgroundColor = x != null ? "var(--color-surface-2)" : "";
    if (x == null) { el.removeAttribute("data-dragging"); el.style.transform = ""; return; }
    el.setAttribute("data-dragging", "");
    el.style.transform = `translate3d(${Math.min(0, x)}px, 0, 0)`;
  };
  const swipe = useSwipe({
    axes: ["x"],
    enabled: phone && sortable && !current,
    onStart: () => stopSpring(content.current),
    onMove: (_, d) => slide(d),
    // Release with the finger's speed: swiped away → springs off and is removed; otherwise springs back.
    onEnd: (_, d, commit, _dir, v) => {
      if (commit && d < 0) springTo(content.current, "x", -(content.current?.offsetWidth ?? 400), Math.min(v, -0.6), () => engine?.removeFromQueue(e.uid));
      else springTo(content.current, "x", 0, v, () => slide(null), (x) => { if (reveal.current) reveal.current.style.opacity = x < -1 ? "1" : "0"; });
    },
    onCancel: () => springTo(content.current, "x", 0, 0, () => slide(null)),
  });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative overflow-hidden rounded-lg", isDragging && "z-10 glass shadow-lg")}>
      {phone && sortable && !current && (
        <div ref={reveal} aria-hidden className="absolute inset-0 flex items-center justify-end gap-1.5 rounded-lg bg-danger opacity-0 transition-opacity pr-4 text-sm font-semibold text-white [&_svg]:h-5 [&_svg]:w-5"><TrashIcon />Remove</div>
      )}
      <div ref={content} {...swipe}
        className={cn("m-drag group relative flex touch-pan-y items-center gap-3 rounded-lg px-2 py-1.5", current ? "bg-hover" : "hover:bg-hover")}>
      <button className="relative" aria-label={`Play ${e.track.title}`} onClick={() => engine?.jumpTo(e.uid)}>
        <Artwork src={e.track.artworkUrl} alt="" size={40} className="w-10" />
        {current && <span className="absolute inset-0 grid place-items-center rounded-md bg-black/50"><NowPlayingBars playing={playing} /></span>}
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={() => engine?.jumpTo(e.uid)} tabIndex={-1}>
        <div className={cn("line-clamp-1 text-sm font-medium", current && "text-accent")}>{e.track.title}</div>
        <div className="line-clamp-1 text-xs text-muted">{e.track.artist}</div>
      </button>
      <span className="text-xs text-muted tabular">{formatDuration(e.track.durationSec)}</span>
      {!current && sortable && (
        <>
          <IconButton label={`Remove ${e.track.title} from queue`} size="sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100" onClick={() => engine?.removeFromQueue(e.uid)}><CloseIcon /></IconButton>
          <button aria-label={`Reorder ${e.track.title}, position ${index + 1}`} data-swipe-ignore className="grid h-10 w-8 cursor-grab touch-none place-items-center text-muted active:cursor-grabbing [&_svg]:h-5 [&_svg]:w-5" {...attributes} {...listeners}><DragIcon /></button>
        </>
      )}
      </div>
    </li>
  );
}

/** Up next: drag (mouse, touch long-press, keyboard) to reorder; history stays above, not draggable. */
export function QueueList() {
  const engine = usePlayerEngine();
  const queue = usePlayer((s) => s.queue);
  const playing = usePlayer((s) => s.status === "playing" || s.status === "buffering");
  const context = usePlayer((s) => s.context);
  const replenishing = usePlayer((s) => s.replenishing);
  const autoplay = usePlayer((s) => s.autoplay);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const upcoming = queue.entries.slice(queue.index + 1);
  const current = queue.entries[queue.index];
  const manual = upcoming.filter((e) => e.source === "manual");
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const to = queue.entries.findIndex((e) => e.uid === over.id);
    engine?.moveInQueue(String(active.id), to);
  };
  if (!current) return <p className="p-6 text-center text-sm text-muted">Nothing in the queue. Play something to get started.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted">Playing from</p>
          <p className="line-clamp-1 font-medium">{context?.title ?? "Your queue"}</p>
        </div>
        {upcoming.length > 0 && <button className="h-8 rounded-full glass px-3 text-xs font-medium hover:glass-strong" onClick={() => engine?.clearUpcoming()}>Clear</button>}
      </div>
      <ul aria-label="Now playing"><Row e={current} index={queue.index} current playing={playing} sortable={false} /></ul>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={upcoming.map((e) => e.uid)} strategy={verticalListSortingStrategy}>
          {manual.length > 0 && <p className="px-2 text-xs uppercase tracking-wide text-muted">Next in queue (added by you)</p>}
          <ul aria-label="Up next" className="flex flex-col">
            {upcoming.map((e, i) => (
              <div key={e.uid}>
                {/* Section labels where the entry source changes: manual → context → autoplay. */}
                {i > 0 && e.source !== upcoming[i - 1]!.source && (
                  <p className="mt-3 px-2 pb-1 text-xs uppercase tracking-wide text-muted">{e.source === "auto" ? "Autoplay" : `Next from ${context?.title ?? "list"}`}</p>
                )}
                {i === 0 && e.source === "auto" && <p className="px-2 pb-1 text-xs uppercase tracking-wide text-muted">Autoplay</p>}
                <Row e={e} index={queue.index + 1 + i} current={false} playing={false} sortable />
              </div>
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {replenishing && <p className="px-2 text-sm text-muted" role="status">Finding more songs…</p>}
      {!upcoming.length && !replenishing && <p className="px-2 text-sm text-muted">{autoplay ? "Autoplay will continue with similar songs." : "End of queue."}</p>}
      <label className="flex items-center justify-between rounded-lg px-2 py-2 text-sm">
        <span>Autoplay similar songs</span>
        <input type="checkbox" checked={autoplay} onChange={(e) => engine?.setAutoplay(e.target.checked)} className="h-5 w-5 accent-[var(--color-accent)]" />
      </label>
    </div>
  );
}
