"use client";
import { useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";
import { useSwipe } from "@/hooks/useSwipe";
import { rubberBand, shouldCommit } from "@/lib/gesture";
import { usePullDown } from "@/hooks/usePullDown";
import { usingKeyboard } from "@/lib/focus";
import { springTo, stopSpring } from "@/lib/spring";

/**
 * iOS-style bottom sheet for phones (Radix Dialog underneath: focus trap, Esc, focus restore,
 * screen-reader dialog semantics). Dismiss by tapping outside, the Cancel button, Esc, or dragging
 * the grabber/header down. Never touches playback.
 */
export function ActionSheet({ open, onOpenChange, title, header, children, cancelLabel = "Cancel" }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; header?: ReactNode; children: ReactNode; cancelLabel?: string | null;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const set = (y: number, dragging: boolean) => {
    const el = panel.current;
    if (!el) return;
    el.style.transform = y ? `translate3d(0, ${y}px, 0)` : "";
    if (dragging) el.setAttribute("data-dragging", ""); else el.removeAttribute("data-dragging");
  };
  const swipe = useSwipe({
    axes: ["y"],
    size: () => panel.current?.offsetHeight ?? innerHeight,
    onMove: (_, d) => set(d > 0 ? d : -rubberBand(-d, 200), true),
    onStart: () => stopSpring(panel.current),
    // Release with the finger's speed: flicked down → springs off-screen then closes; otherwise springs back.
    onEnd: (_, d, commit, _dir, v) => {
      if (commit && d > 0) springTo(panel.current, "y", (panel.current?.offsetHeight ?? 400) + 40, Math.max(v, 0.6), () => onOpenChange(false));
      else springTo(panel.current, "y", 0, v, () => set(0, false));
    },
    onCancel: () => springTo(panel.current, "y", 0, 0, () => set(0, false)),
  });
  // At the top of the list, pulling down anywhere moves the sheet too (iOS sheet behaviour).
  const [list, setList] = useState<HTMLDivElement | null>(null);
  usePullDown(list, {
    enabled: open,
    onMove: (dy) => { stopSpring(panel.current); set(dy, true); },
    onEnd: (dy, v) => {
      if (shouldCommit(dy, panel.current?.offsetHeight ?? 400, v)) springTo(panel.current, "y", (panel.current?.offsetHeight ?? 400) + 40, Math.max(v, 0.6), () => onOpenChange(false));
      else springTo(panel.current, "y", 0, v, () => set(0, false));
    },
  });
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay data-[state=open]:animate-in" />
        <Dialog.Content aria-describedby={undefined} ref={panel}
          // Touch: focus the sheet itself (no ring on the first action, which iOS would draw); keyboard: default behaviour.
          onOpenAutoFocus={(e) => { if (!usingKeyboard()) { e.preventDefault(); panel.current?.focus({ preventScroll: true }); } }}
          onCloseAutoFocus={(e) => { if (!usingKeyboard()) e.preventDefault(); }}
          onClick={(e) => e.stopPropagation()}
          className="m-drag fixed inset-x-[var(--m-side)] bottom-[max(var(--safe-bottom),var(--m-side))] z-[61] flex max-h-[min(80dvh,40rem)] flex-col outline-none data-[state=open]:animate-in">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-[var(--m-radius-sheet)] glass-panel">
            <div {...swipe} className="shrink-0 touch-none select-none pt-2">
              <div aria-hidden className="mx-auto h-1.5 w-10 rounded-full bg-foreground/25" />
              <Dialog.Title className={cn(header ? "sr-only" : "px-5 pb-1 pt-3 text-center text-sm font-semibold text-muted")}>{title}</Dialog.Title>
              {header && <div className="px-4 pb-3 pt-3">{header}</div>}
              <div className="h-px bg-divider" />
            </div>
            <div ref={setList} className="min-h-0 overflow-y-auto overscroll-contain p-1.5">{children}</div>
          </div>
          {cancelLabel && (
            <Dialog.Close className="m-press mt-2 h-14 shrink-0 rounded-[var(--m-radius-sheet)] glass-panel text-base font-semibold">{cancelLabel}</Dialog.Close>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A row in an ActionSheet: 48px tall, icon + label. */
export function SheetAction({ icon, children, onSelect, destructive, disabled }: { icon?: ReactNode; children: ReactNode; onSelect: () => void; destructive?: boolean; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onSelect}
      className={cn("m-press flex min-h-12 w-full items-center gap-4 rounded-xl px-4 text-left text-[15px] active:bg-press disabled:opacity-40 [&_svg]:h-[22px] [&_svg]:w-[22px] [&_svg]:shrink-0",
        destructive ? "text-danger" : "[&_svg]:text-muted")}>
      {icon}{children}
    </button>
  );
}
