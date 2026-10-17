"use client";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";
import { selectCurrent, usePlayer } from "@/lib/player";
import { Artwork } from "../ui/Artwork";
import { IconButton } from "../ui/Button";
import { ChevronDownIcon, WarningIcon } from "../icons";
import { ArtistLinks } from "../music/ArtistLinks";
import { TrackMenu } from "../music/TrackMenu";
import { Related } from "./Related";
import { RepeatButton, ShuffleButton, TransportControls } from "./Controls";
import { SeekBar } from "./SeekBar";
import { QueueList } from "./QueueList";
import { LyricsView } from "./LyricsView";
import { useLibrary, useSaved } from "@/lib/library";
import { HeartActiveIcon, HeartIcon } from "../icons";
import { useArtworkPalette } from "@/hooks/useArtworkPalette";

type Tab = "next" | "lyrics" | "related";

/**
 * Full Now Playing view. A dialog (focus trap, Esc to close, focus restore) that never touches
 * playback: opening/closing only changes what's visible.
 */
export function NowPlaying({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const track = usePlayer(selectCurrent);
  const err = usePlayer((s) => s.error);
  const [tab, setTab] = useState<Tab>("next");
  // Phones show one pane at a time; they open on the song itself (artwork + controls).
  const [mobileTab, setMobileTab] = useState<"song" | "next" | "lyrics">("song");
  const liked = useSaved("likes", track?.id);
  const lib = useLibrary();
  const touchY = useRef<number | null>(null);
  const palette = useArtworkPalette(track?.artworkUrl);
  useEffect(() => { if (!track && open) onOpenChange(false); }, [track, open, onOpenChange]);
  if (!track) return null;

  const tabs: { id: Tab; label: string }[] = [{ id: "next", label: "Up next" }, { id: "lyrics", label: "Lyrics" }, { id: "related", label: "Related" }];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          // Non-modal on purpose: on desktop the player bar below stays usable (YouTube Music layout).
          onInteractOutside={(e) => e.preventDefault()}
          // Phones: full screen. Desktop/tablet: the content area only — sidebar, top bar and player bar stay visible.
          style={palette ? ({ "--np-c1": `rgb(${palette[0]!.join(" ")})`, "--np-c2": `rgb(${(palette[1] ?? palette[0])!.join(" ")})`, "--np-c3": `rgb(${(palette[2] ?? palette[1] ?? palette[0])!.join(" ")})` } as React.CSSProperties) : undefined}
          className="np-backdrop fixed inset-x-0 bottom-0 top-0 z-50 flex flex-col overflow-hidden pb-[var(--safe-bottom)] pt-[var(--safe-top)] md:bottom-[var(--spacing-player)] md:left-[var(--sidebar-w,var(--spacing-sidebar))] md:top-[calc(var(--spacing-topbar)+var(--safe-top))] md:z-30 md:pb-0 md:pt-0"
          onTouchStart={(e) => { touchY.current = (e.target as HTMLElement).closest("[data-scroll]") ? null : e.touches[0]!.clientY; }}
          onTouchEnd={(e) => { if (touchY.current != null && e.changedTouches[0]!.clientY - touchY.current > 90) onOpenChange(false); touchY.current = null; }}
        >
          <Dialog.Title className="sr-only">Now playing: {track.title}</Dialog.Title>
          <div className="flex h-14 shrink-0 items-center justify-between px-3 md:h-12">
            <Dialog.Close asChild><IconButton label="Minimize player"><ChevronDownIcon /></IconButton></Dialog.Close>
            <div className="flex gap-1 rounded-full glass p-1 lg:hidden" role="tablist" aria-label="Now playing views">
              {([["song", "Song"], ["next", "Up next"], ["lyrics", "Lyrics"]] as const).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={mobileTab === id} onClick={() => setMobileTab(id)}
                  className={cn("rounded-full px-3 py-1 text-sm", mobileTab === id ? "bg-surface-3 font-medium" : "text-muted")}>{label}</button>
              ))}
            </div>
            <TrackMenu track={track} />
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 px-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] xl:grid-cols-[minmax(0,1fr)_minmax(340px,440px)] lg:gap-10 md:px-8 md:pb-6 lg:px-12">
            {/* Artwork + controls (mobile: shown on "Song" tab) */}
            <div className={cn("flex min-h-0 min-w-0 flex-col items-center justify-center gap-6", mobileTab !== "song" && "max-lg:hidden")}>
              {/* Sized to its own column (and the viewport height), never the whole window. */}
              <div className="w-full max-w-[min(86vw,46dvh)] md:max-w-[min(70%,calc(100dvh-22rem),480px)] lg:max-w-[min(100%,calc(100dvh-16rem),560px)]">
                <Artwork src={track.artworkUrl} alt={`${track.title} artwork`} size={560} priority rounded="lg" className="w-full shadow-2xl" />
              </div>
              <div className="w-full max-w-[560px] lg:hidden">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-1 text-xl font-bold">{track.title}</div>
                    <div className="line-clamp-1 text-muted"><ArtistLinks item={track} /></div>
                  </div>
                  <IconButton label={liked ? "Unlike" : "Like"} active={liked} onClick={() => void lib.toggle("likes", track)}>{liked ? <HeartActiveIcon /> : <HeartIcon />}</IconButton>
                </div>
                {err && <p role="status" className="mt-2 flex items-center gap-2 text-sm text-warning [&_svg]:h-4 [&_svg]:w-4"><WarningIcon />{err.message}</p>}
                <SeekBar className="mt-4" />
                <div className="mt-2 flex items-center justify-between">
                  <ShuffleButton /><TransportControls big /><RepeatButton />
                </div>
              </div>
            </div>

            {/* Tabs: queue / lyrics / related */}
            <div className={cn("flex min-h-0 flex-col", mobileTab === "song" && "max-lg:hidden")}>
              <div role="tablist" aria-label="Now playing panels" className="hidden shrink-0 lg:flex">
                {tabs.map((t) => (
                  <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                    className={cn("flex-1 py-3 text-sm font-medium uppercase tracking-wide", tab === t.id ? "text-foreground shadow-[inset_0_-2px_0_var(--color-foreground)]" : "text-muted hover:text-foreground")}>{t.label}</button>
                ))}
              </div>
              <div data-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-3" role="tabpanel">
                {/* Desktop follows `tab`; phones follow `mobileTab`. */}
                <div className="max-lg:hidden">
                  {tab === "next" && <QueueList />}
                  {tab === "lyrics" && <LyricsView />}
                  {tab === "related" && <Related />}
                </div>
                <div className="lg:hidden">
                  {mobileTab === "next" && <QueueList />}
                  {mobileTab === "lyrics" && <LyricsView />}
                </div>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
