"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useLyrics } from "@/lib/queries";
import { selectCurrent, usePlayer, usePlayerEngine } from "@/lib/player";
import { ErrorState } from "../ui/States";
import { describeOffset } from "@/lib/lyricsTiming";
import { DoneIcon, MinusIcon, PlusIcon, ResetIcon, TimingIcon } from "../icons";

/** Lines highlight slightly early so they appear as the word is sung, not after the render. */
const LEAD_MS = 150;
const OFFSET_KEY = "zuno.lyricsOffset.v1";
/** One tap of − / + (press and hold repeats). */
const STEP_MS = 250;


function RoundButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-hover active:bg-press disabled:opacity-35 [&_svg]:h-[18px] [&_svg]:w-[18px]">
      {children}
    </button>
  );
}

/** A step button that repeats while held (after a short delay); a plain tap or Enter steps once. */
function HoldButton({ label, onStep, children }: { label: string; onStep: () => void; children: React.ReactNode }) {
  const timer = useRef(0);
  const repeated = useRef(false);
  const stop = () => { window.clearTimeout(timer.current); window.clearInterval(timer.current); };
  useEffect(() => stop, []);
  return (
    <button type="button" aria-label={label} title={label}
      onPointerDown={() => { repeated.current = false; stop(); timer.current = window.setTimeout(() => { repeated.current = true; onStep(); timer.current = window.setInterval(onStep, 110); }, 380); }}
      onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onClick={() => { if (repeated.current) { repeated.current = false; return; } onStep(); }}
      onContextMenu={(e) => e.preventDefault()}
      className="grid h-9 w-9 select-none place-items-center rounded-full bg-press transition-colors hover:bg-hover active:scale-95 [&_svg]:h-[18px] [&_svg]:w-[18px]">
      {children}
    </button>
  );
}

function readOffsets(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(OFFSET_KEY) ?? "{}") as Record<string, number>; } catch { return {}; }
}

/**
 * Synced lyrics. Position is read from the <audio> element every animation frame while playing
 * (timeupdate only fires ~4×/s, which made lines trail the vocals). Per-song offset can be nudged
 * when a lyric file was timed to a different edit of the track.
 */
export function LyricsView() {
  const track = usePlayer(selectCurrent);
  const engine = usePlayerEngine();
  const playing = usePlayer((s) => s.status === "playing" || s.status === "buffering");
  const coarsePos = usePlayer((s) => s.positionSec);
  const q = useLyrics(track?.id);
  const lines = q.data?.lyrics?.lines ?? [];
  const synced = q.data?.lyrics?.timing === "synced";
  const [offsetMs, setOffsetMs] = useState(0);
  useEffect(() => { setOffsetMs(track ? readOffsets()[track.id] ?? 0 : 0); }, [track]);
  const offsetRef = useRef(0);
  offsetRef.current = offsetMs;
  const [timingOpen, setTimingOpen] = useState(false);
  useEffect(() => { setTimingOpen(false); }, [track?.id]);
  /** Shift the lyrics by `d` ms (negative = earlier). Reads a ref so press-and-hold repeats accumulate. */
  const nudge = (d: number) => {
    if (!track) return;
    const next = Math.max(-10_000, Math.min(10_000, offsetRef.current + d));
    offsetRef.current = next;
    setOffsetMs(next);
    try { const all = readOffsets(); if (next) all[track.id] = next; else delete all[track.id]; localStorage.setItem(OFFSET_KEY, JSON.stringify(all)); } catch { /* ignore */ }
  };

  // Frame-accurate active line: only re-renders when the line index actually changes.
  const [activeIdx, setActiveIdx] = useState(-1);
  const starts = useMemo(() => lines.map((l) => l.startMs ?? Infinity), [lines]);
  useEffect(() => {
    if (!synced || !engine) { setActiveIdx(-1); return; }
    const compute = () => {
      const ms = engine.currentTime() * 1000 + LEAD_MS + offsetMs;
      let lo = 0, hi = starts.length - 1, idx = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid]! <= ms) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
      setActiveIdx((cur) => (cur === idx ? cur : idx));
    };
    compute();
    if (!playing) return; // paused: the coarsePos dependency recomputes after seeks
    let raf = 0;
    const loop = () => { compute(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [synced, engine, starts, playing, offsetMs, coarsePos]);

  const container = useRef<HTMLDivElement>(null);
  // Manual scrolling detaches auto-follow (never fight the user's finger); it re-attaches after a
  // pause or straight away via the "Back to current line" button.
  const [detached, setDetached] = useState(false);
  const detachTimer = useRef(0);
  const detach = () => {
    setDetached(true);
    window.clearTimeout(detachTimer.current);
    detachTimer.current = window.setTimeout(() => setDetached(false), 6000);
  };
  useEffect(() => () => window.clearTimeout(detachTimer.current), []);
  // A new song always starts attached.
  useEffect(() => { setDetached(false); }, [track?.id]);
  // Scroll ONLY the lyrics' own scroll box. scrollIntoView() also scrolls every ancestor — including
  // overflow-hidden ones like the player sheet — which shifted the whole phone player off-screen.
  const follow = (behavior: ScrollBehavior) => {
    if (activeIdx < 0) return;
    const line = container.current?.querySelector<HTMLElement>(`[data-line="${activeIdx}"]`);
    let box = container.current?.parentElement ?? null;
    while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) box = box.parentElement;
    if (!line || !box) return;
    const l = line.getBoundingClientRect(), b = box.getBoundingClientRect();
    box.scrollBy({ top: l.top - b.top - box.clientHeight / 2 + l.height / 2, behavior });
  };
  useEffect(() => {
    if (!detached) follow("smooth");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, detached]);

  if (!track) return null;
  if (q.isPending) return <div className="space-y-4 p-4" aria-busy>{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-6 rounded" style={{ width: `${50 + ((i * 37) % 45)}%` }} />)}</div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />;
  if (!q.data?.lyrics || !lines.length) return <p className="p-8 text-center text-muted">Lyrics aren't available for this song.</p>;
  return (
    <div ref={container} className="flex flex-col gap-1 px-2 pb-10" onWheel={detach} onTouchMove={detach}>
      {synced && (
        // Floating timing control: a quiet pill until tapped, then one capsule — earlier · status · later.
        <div className="pointer-events-none sticky top-1 z-10 mb-2 flex justify-end [&>*]:pointer-events-auto">
          {timingOpen ? (
            <div role="group" aria-label="Lyrics timing" className="flex items-center gap-0.5 rounded-full glass-strong p-1 shadow-[0_10px_28px_-12px_rgb(0_0_0/0.55)]">
              <HoldButton label={`Show lyrics earlier by ${STEP_MS / 1000} seconds`} onStep={() => nudge(-STEP_MS)}><MinusIcon /></HoldButton>
              <div className="w-[6.75rem] px-1 text-center leading-tight">
                <div className={cn("text-[13px] font-semibold tabular", offsetMs !== 0 && "text-[var(--song-accent)]")} aria-live="polite">{describeOffset(offsetMs)}</div>
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted">Lyrics timing</div>
              </div>
              <HoldButton label={`Show lyrics later by ${STEP_MS / 1000} seconds`} onStep={() => nudge(STEP_MS)}><PlusIcon /></HoldButton>
              <span aria-hidden className="mx-1 h-5 w-px bg-divider" />
              <RoundButton label="Reset lyrics timing" disabled={offsetMs === 0} onClick={() => nudge(-offsetRef.current)}><ResetIcon /></RoundButton>
              <RoundButton label="Done" onClick={() => setTimingOpen(false)}><DoneIcon /></RoundButton>
            </div>
          ) : (
            <button type="button" onClick={() => setTimingOpen(true)} aria-expanded={false} aria-label={`Lyrics timing: ${describeOffset(offsetMs)}`}
              className={cn("flex h-8 items-center gap-1.5 rounded-full glass px-3 text-xs font-semibold shadow-sm transition-colors hover:glass-strong [&_svg]:h-4 [&_svg]:w-4", offsetMs !== 0 ? "text-[var(--song-accent)]" : "text-muted")}>
              <TimingIcon />{offsetMs === 0 ? "Timing" : describeOffset(offsetMs)}
            </button>
          )}
        </div>
      )}
      {lines.map((l, i) => synced ? (
        <button key={i} data-line={i} onClick={() => l.startMs != null && engine?.seek(Math.max(0, (l.startMs - offsetMs) / 1000))}
          className={cn("rounded-lg px-2 py-1.5 text-left text-xl font-bold leading-snug transition-colors duration-150 md:text-2xl", i === activeIdx ? "text-foreground" : i < activeIdx ? "text-muted/45" : "text-muted/35 hover:text-muted")}
          aria-current={i === activeIdx ? "true" : undefined}>
          {l.text || "♪"}
        </button>
      ) : (
        <p key={i} className="min-h-[1.5em] px-2 text-lg leading-relaxed">{l.text}</p>
      ))}
      {synced && detached && activeIdx >= 0 && (
        <button type="button" onClick={() => { window.clearTimeout(detachTimer.current); setDetached(false); }}
          className="sticky bottom-3 z-10 mx-auto mt-2 h-9 rounded-full glass-strong px-4 text-sm font-medium shadow-lg">Back to current line</button>
      )}
      <p className="mt-6 px-2 text-xs text-muted">{q.data.lyrics.attribution ?? `Source: ${q.data.lyrics.source}`}</p>
    </div>
  );
}
