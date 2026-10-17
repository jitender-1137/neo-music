"use client";
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { selectCurrent, usePlayer, usePlayerEngine } from "@/lib/player";
import { useLibrary, useSaved } from "@/lib/library";
import { playerColors } from "@/lib/palette";
import { isAppleMobile } from "@/lib/platform";
import { focusFor, restoreFocus } from "@/lib/focus";
import { useArtworkPalette } from "@/hooks/useArtworkPalette";
import { useSwipe } from "@/hooks/useSwipe";
import { useTrackCarousel } from "@/hooks/useTrackCarousel";
import { usePullDown } from "@/hooks/usePullDown";
import { rubberBand, shouldCommit } from "@/lib/gesture";
import { initialSheet, isOpen, transition, PANEL_TABS, type Detent, type PanelTab, type SheetEvent, type SheetState } from "@/lib/playerSheet";
import { release, springTo, stopSpring } from "@/lib/spring";
import { Artwork, sizedArtwork } from "../ui/Artwork";
import { trackHref } from "../music/links";
import { IconButton } from "../ui/Button";
import { ChevronDownIcon, ChevronRightIcon, HeartActiveIcon, HeartIcon, LyricsIcon, QueueIcon, VolumeLoudIcon, VolumeMutedIcon, VolumeSmallIcon, MoreVerticalIcon, RelatedIcon, ShareIcon, SkipNextIcon, WarningIcon } from "../icons";
import { ArtistLinks } from "../music/ArtistLinks";
import { TrackMenu } from "../music/TrackMenu";
import { PlayPauseButton, RepeatButton, ShuffleButton, TransportControls } from "../player/Controls";
import { SeekBar } from "../player/SeekBar";

// Panel contents load on first use (dnd-kit, lyrics, related shelves stay out of the first paint).
const QueueList = dynamic(() => import("../player/QueueList").then((m) => m.QueueList), { ssr: false });
const LyricsView = dynamic(() => import("../player/LyricsView").then((m) => m.LyricsView), { ssr: false });
const Related = dynamic(() => import("../player/Related").then((m) => m.Related), { ssr: false });

/** "half": the panel's top sits 58% down the screen, just under the player controls. */
const HALF_TOP = 0.58;

const PANEL_LABEL: Record<PanelTab, string> = { next: "Up next", lyrics: "Lyrics", related: "Related" };

/** Set a transform while a finger drives an element; clear it to let the CSS state animate. */
function drive(el: HTMLElement | null, transform: string | null, extra?: Partial<CSSStyleDeclaration>) {
  if (!el) return;
  if (transform == null) { el.removeAttribute("data-dragging"); el.style.transform = ""; el.style.opacity = ""; return; }
  el.setAttribute("data-dragging", "");
  el.style.transform = transform;
  if (extra) Object.assign(el.style, extra);
}

/** One mini-player slot: thumbnail + title + artist. */
function MiniSlot({ t, sub }: { t: { title: string; artist: string; artworkUrl?: string }; sub?: React.ReactNode }) {
  return (
    <div className="flex h-full items-center gap-3">
      <Artwork src={t.artworkUrl} alt="" size={36} className="w-9 shrink-0" />
      <div className="min-w-0">
        <div className="line-clamp-1 text-[14px] font-semibold leading-tight">{t.title}</div>
        <div className="line-clamp-1 text-[12px] leading-tight text-muted">{sub ?? t.artist}</div>
      </div>
    </div>
  );
}

function Pill({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn("m-pill m-press flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold [&_svg]:h-4 [&_svg]:w-4", active && "[&_svg]:text-accent")}>
      {icon}{label}
    </button>
  );
}

function LikePill() {
  const t = usePlayer(selectCurrent);
  const liked = useSaved("likes", t?.id);
  const lib = useLibrary();
  if (!t) return null;
  return <Pill icon={liked ? <HeartActiveIcon /> : <HeartIcon />} label={liked ? "Liked" : "Like"} active={liked} onClick={() => void lib.toggle("likes", t)} />;
}

/**
 * Volume row, Apple Music–style: [🔈 mute] ──●── 🔊.
 * - The speaker icon is a real Mute/Unmute button on every device.
 * - Android / desktop: the slider changes the app's playback level (no website can change the
 *   phone's system volume).
 * - iPhone / iPad: web pages can't change the level at all (side buttons only; iOS even accepts the
 *   value and ignores it), so instead of a slider that moves without effect we show the mute button
 *   and say where the volume lives. Routing audio through Web Audio to fake it would stop playback
 *   on the lock screen, so we don't.
 */
function MobileVolume() {
  const engine = usePlayerEngine();
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const [apple] = useState(isAppleMobile);
  const v = muted ? 0 : apple ? 1 : volume;
  const silent = v === 0;
  const muteBtn = (
    <button type="button" aria-label={silent ? "Unmute" : "Mute"} aria-pressed={silent}
      onClick={() => { if (!apple && !muted && volume === 0) engine?.setVolume(0.6); else engine?.toggleMute(); }}
      className={cn("-ml-2 grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors active:bg-press", silent && "text-foreground")}>
      {silent ? <VolumeMutedIcon /> : <VolumeSmallIcon />}
    </button>
  );
  return (
    // Apple Music spacing: a clear gap between the transport controls and the volume row.
    <div className="mt-[clamp(1.5rem,5.5dvh,3.25rem)] flex items-center gap-2 text-muted [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:shrink-0">
      {muteBtn}
      {apple ? (
        <p className="flex-1 text-[13px]" data-volume-hint>{silent ? "Muted — tap the speaker to unmute" : "Use the side buttons to change the volume"}</p>
      ) : (
        <>
          <div className="group/vol relative h-6 flex-1">
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2 overflow-hidden rounded-full bg-foreground/20 transition-[height] group-active/vol:h-2">
              <div className="absolute inset-y-0 left-0 bg-foreground/85" style={{ width: `${v * 100}%` }} />
            </div>
            <input type="range" min={0} max={1} step={0.01} value={v} aria-label="Volume" aria-valuetext={silent ? "Muted" : `${Math.round(v * 100)}%`}
              data-swipe-ignore onChange={(e) => { const n = Number(e.target.value); engine?.setVolume(n); if (n > 0 && muted) engine?.toggleMute(); }}
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0" />
          </div>
          <VolumeLoudIcon aria-hidden className="ml-1" />
        </>
      )}
    </div>
  );
}

async function shareTrack(t: { title: string; artist: string; id: string }) {
  const url = `${location.origin}${trackHref(t as Parameters<typeof trackHref>[0])}`;
  try {
    if (navigator.share) await navigator.share({ title: t.title, text: `${t.title} — ${t.artist}`, url });
    else { await navigator.clipboard.writeText(url); toast("Link copied"); }
  } catch { /* share sheet cancelled */ }
}

/**
 * Phone player (< 768px): the mini-player and the full player are two states of ONE persistent
 * surface, driven by the `playerSheet` state machine. It never owns audio — every control calls the
 * single shared engine, so opening, dragging or closing can't restart or duplicate playback.
 *
 * Gestures (each has a visible button too):
 * - Mini-player: tap or swipe up → open. Swipe left/right → next/previous track.
 * - Full player: swipe down anywhere on the song view → minimise. Swipe left/right on the artwork → next/previous.
 * - Full player: swipe up → Up next at half height; up again → full height; down steps back.
 *   Tap the cover → full-screen cover (left/right still changes song; tap or swipe down to return).
 * - Up next / Lyrics / Related panel: swipe its header down → one step lower. Swipe the header
 *   left/right → neighbouring tab. Content scrolls normally; queue rows swipe left to remove.
 */
export function MobilePlayer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const engine = usePlayerEngine();
  const track = usePlayer(selectCurrent);
  const err = usePlayer((s) => s.error);
  // Neighbours for the swipe carousels (what slides in from either side).
  const prevTrack = usePlayer((s) => s.queue.entries[s.queue.index - 1]?.track);
  const nextTrack = usePlayer((s) => s.queue.entries[s.queue.index + 1]?.track);
  const hasNext = usePlayer((s) => s.queue.index < s.queue.entries.length - 1 || s.repeat === "all" || s.autoplay);
  const pct = usePlayer((s) => (s.durationSec > 0 ? Math.min(100, (s.positionSec / s.durationSec) * 100) : 0));
  const palette = useArtworkPalette(track?.artworkUrl);
  const [st, dispatch] = useReducer(transition, initialSheet);
  const sheetOpen = isOpen(st);

  const sheet = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const mini = useRef<HTMLDivElement>(null);
  const miniStrip = useRef<HTMLDivElement>(null);
  const artStrip = useRef<HTMLDivElement>(null);
  const bleedStrip = useRef<HTMLDivElement>(null);
  // Tap the cover → it grows edge to edge BEHIND the player (fading into the song colour, never over
  // the controls); tap again or Escape → normal size. The half-height queue view uses the same look.
  const [zoom, setZoom] = useState(false);
  useEffect(() => { if (!sheetOpen) setZoom(false); }, [sheetOpen]);
  const expandBtn = useRef<HTMLButtonElement>(null);
  const minimizeBtn = useRef<HTMLButtonElement>(null);
  const miniTop = useRef(0);

  // Two-way sync with the shell's "now playing open" flag. `reported` remembers the value we last
  // pushed up, so its echo is ignored: without that, a change on both sides in the same render
  // (e.g. close, then reopen before the first update lands) made the effects flip each other forever.
  const reported = useRef<boolean | null>(null);
  // Shell → machine: only genuine outside changes (shortcut "F", route changes, closeNowPlaying()).
  useEffect(() => {
    if (reported.current === open) { reported.current = null; return; }
    dispatch({ type: open ? "open" : "close" });
  }, [open]);
  // Machine → shell, only for resting states (dragging never flips the shell's flag).
  useEffect(() => {
    if (st.mode === "expanded" && !open) { reported.current = true; onOpenChange(true); }
    if (st.mode === "collapsed" && open) { reported.current = false; onOpenChange(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.mode]);
  // Queue emptied → nothing to show.
  useEffect(() => { if (!track) dispatch({ type: "close" }); }, [track]);

  // While open: the page, header and tab bar are inert (VoiceOver and focus stay in the player).
  // Focus moves to the minimise button on open and back to the mini-player on close.
  useEffect(() => {
    document.querySelectorAll("[data-app-chrome]").forEach((el) => el.toggleAttribute("inert", sheetOpen));
    if (sheetOpen) focusFor(minimizeBtn.current, sheet.current);
    else if (sheet.current?.contains(document.activeElement)) restoreFocus(expandBtn.current);
    return () => { document.querySelectorAll("[data-app-chrome]").forEach((el) => el.removeAttribute("inert")); };
  }, [sheetOpen]);

  // Status bar / Safari toolbar take the song's colour while the player is open (theme-color).
  const statusColor = palette ? playerColors(palette)?.top : undefined;
  useEffect(() => {
    if (!sheetOpen) return;
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const before = metas.map((m) => m.content);
    metas.forEach((m) => (m.content = statusColor ?? "#2a2440"));
    return () => metas.forEach((m, i) => (m.content = before[i]!));
  }, [sheetOpen, statusColor]);

  const H = () => window.visualViewport?.height ?? window.innerHeight;

  // Swiping the playing song (mini-player or artwork) slides the neighbouring song in, then changes track.
  const carouselOpts = {
    trackId: track?.id, hasPrev: !!prevTrack, hasNext,
    onNext: () => engine?.next(), onPrev: () => engine?.previous({ restart: false }),
  };
  const miniCarousel = useTrackCarousel(miniStrip, carouselOpts);
  const artCarousel = useTrackCarousel(artStrip, { ...carouselOpts, travel: () => window.innerWidth });
  const bleedCarousel = useTrackCarousel(bleedStrip, carouselOpts);
  const compact = !!st.panel && st.detent === "half";
  const bleed = zoom || compact;
  const column = useRef<HTMLDivElement>(null);
  const meta = useRef<HTMLDivElement>(null);
  const bleedLayer = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);
  // Half-height layout, in plain pixels (iOS Safari can leave transitions between mixed units like
  // dvh/env() stuck): the panel's top rests at 58% of the screen and the title + controls lift with a
  // transform to sit just above it. Nothing animates layout, so nothing can get stranded.
  useLayoutEffect(() => {
    const measure = () => {
      const sh = sheet.current, pn = panel.current, col = column.current, m = meta.current;
      if (!sh || !pn || !col || !m) return;
      const halfTop = sh.clientHeight * HALF_TOP;
      sh.style.setProperty("--m-half-y", `${Math.round(halfTop - pn.offsetTop)}px`);
      // How much of the panel is below the screen at half height → bottom padding so its list still scrolls to the end.
      sh.style.setProperty("--m-half-pad", `${Math.max(0, Math.round(pn.offsetHeight - (sh.clientHeight - halfTop)))}px`);
      const bottom = col.offsetTop + m.offsetTop + m.offsetHeight;
      m.style.transform = compact ? `translate3d(0, ${Math.round(halfTop - 12 - bottom)}px, 0)` : "";
      // Tapped cover: from the very top of the screen down to the middle of the song title (fading out
      // behind it). The half view uses its own fixed height.
      const bl = bleedLayer.current, t = m.querySelector("h2");
      if (bl && t) bl.style.height = compact ? "" : `${Math.round(col.offsetTop + m.offsetTop + t.offsetTop + t.offsetHeight / 2)}px`;
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => { window.removeEventListener("resize", measure); window.visualViewport?.removeEventListener("resize", measure); };
  }, [compact, zoom, sheetOpen, track?.id]);

  // ── Mini-player: swipe up opens (sheet follows the finger), left/right changes track ──
  const miniSwipe = useSwipe({
    axes: ["y", "x"],
    onStart: (axis) => {
      if (axis !== "y") return;
      stopSpring(sheet.current);
      miniTop.current = mini.current?.getBoundingClientRect().top ?? H();
      dispatch({ type: "dragStart" });
    },
    onMove: (axis, d) => {
      if (axis === "y") {
        const y = Math.max(0, Math.min(H(), miniTop.current + Math.min(0, d)));
        drive(sheet.current, `translate3d(0, ${y}px, 0)`);
        drive(mini.current, "none", { opacity: String(Math.max(0, 1 + d / 160)) });
      } else {
        miniCarousel.move(d);
      }
    },
    onEnd: (axis, d, commit, _dir, v) => {
      if (axis === "y") {
        const opens = commit && d < 0;
        drive(mini.current, null);
        dispatch({ type: "dragEnd", commit: opens });
        // Carry the finger's speed into an iOS-style spring: up to fully open, or back down.
        springTo(sheet.current, "y", opens ? 0 : sheet.current?.clientHeight ?? H(), v, () => release(sheet.current));
      } else {
        miniCarousel.end(d, commit, v);
      }
    },
    onCancel: (axis) => {
      if (axis === "y") { drive(sheet.current, null); drive(mini.current, null); dispatch({ type: "dragCancel" }); }
      else miniCarousel.cancel();
    },
  });

  // ── Panel heights. The panel is as tall as the screen; "half" shows its top part only. ──
  const panelH = () => panel.current?.offsetHeight ?? H();
  const offsetOf = (d: Detent | null) => (d === null ? panelH() : d === "half" ? (sheet.current?.clientHeight ?? H()) * HALF_TOP - (panel.current?.offsetTop ?? 0) : 0);
  /** Move the panel with the finger from its resting height (rubber-bands above full). */
  const followPanel = (from: Detent | null, d: number) => {
    const y = offsetOf(from) + d;
    drive(panel.current, `translate3d(0, ${y < 0 ? -rubberBand(-y, 60) : y}px, 0)`);
  };
  /** Finish a vertical panel drag: up = one step taller, down = one step lower (a long drag skips a
   *  step). The panel springs from the finger's position to the new height with the release speed. */
  const settlePanel = (from: Detent | null, d: number, commit: boolean, v: number) => {
    let ev: SheetEvent | null = null;
    if (commit) {
      const far = Math.abs(d) > panelH() * 0.7;
      ev = d < 0 ? (from === null && far ? { type: "openPanel", tab: "next", detent: "full" } : { type: "panelUp" }) : (far ? { type: "closePanel" } : { type: "panelDown" });
    }
    const base: SheetState = from === null ? { ...st, panel: null } : st;
    const next = ev ? transition(base, ev) : base;
    if (ev) dispatch(ev);
    springTo(panel.current, "y", offsetOf(next.panel ? next.detent : null), v, () => release(panel.current));
  };

  // ── Full player (song view): down minimises; up opens Up next at half height, then full ──
  // Commit thresholds relative to one step of travel (not the whole screen), so each step needs a
  // natural, short throw: ~25% of 60% of the screen for the player, ~25% of the half-panel step.
  const stepSize = () => (sheet.current?.clientHeight ?? H()) * (1 - HALF_TOP);
  const sheetSwipe = useSwipe({
    axes: ["y"],
    enabled: st.mode === "expanded",
    size: () => (st.panel ? stepSize() : (sheet.current?.clientHeight ?? H()) * 0.6),
    // Catch a sheet/panel that is still springing (like iOS) instead of fighting it.
    onStart: () => { stopSpring(sheet.current); stopSpring(panel.current); },
    onMove: (_, d) => {
      if (st.panel) { followPanel(st.detent, d); return; }
      if (d > 0) drive(sheet.current, `translate3d(0, ${d}px, 0)`);
      else { drive(sheet.current, null); followPanel(null, d); }
    },
    onEnd: (_, d, commit, _dir, v) => {
      if (st.panel || d < 0) { release(sheet.current); settlePanel(st.panel ? st.detent : null, d, commit, v); return; }
      const closes = commit && d > 0;
      if (closes) dispatch({ type: "close" });
      springTo(sheet.current, "y", closes ? sheet.current?.clientHeight ?? H() : 0, v, () => release(sheet.current));
    },
    onCancel: () => { drive(sheet.current, null); drive(panel.current, null); },
  });

  // ── Artwork: left/right slides the neighbouring cover in and changes track (any panel height) ──
  const artSwipe = useSwipe({
    axes: ["x"],
    enabled: st.mode === "expanded",
    onMove: (_, d) => (bleed ? bleedCarousel : artCarousel).move(d),
    onEnd: (_, d, commit, _dir, v) => (bleed ? bleedCarousel : artCarousel).end(d, commit, v),
    onCancel: () => { artCarousel.cancel(); bleedCarousel.cancel(); },
  });

  // ── Panel list: at its top, pulling down anywhere lowers the panel (iOS sheet behaviour) ──
  const [panelBody, setPanelBody] = useState<HTMLDivElement | null>(null);
  usePullDown(panelBody, {
    enabled: !!st.panel,
    onMove: (dy) => { stopSpring(panel.current); followPanel(st.detent, dy); },
    onEnd: (dy, v) => settlePanel(st.detent, dy, shouldCommit(dy, stepSize(), v), v),
  });

  // ── Panel header: up/down change its height, left/right switches tab ──
  const panelSwipe = useSwipe({
    axes: ["y", "x"],
    enabled: !!st.panel,
    size: (axis) => (axis === "y" ? stepSize() : window.innerWidth),
    onStart: (axis) => { if (axis === "y") stopSpring(panel.current); },
    onMove: (axis, d) => { if (axis === "y") followPanel(st.detent, d); },
    onEnd: (axis, d, commit, _dir, v) => {
      if (axis === "y") { settlePanel(st.detent, d, commit, v); return; }
      if (commit) dispatch({ type: "swipePanel", dir: d < 0 ? 1 : -1 });
    },
    onCancel: () => drive(panel.current, null),
  });

  // Escape: panel → song view → page. Window-level, because focus may sit on an element that just
  // became inert. An action sheet or dialog open on top handles its own Escape first.
  const stRef = useRef(st);
  stRef.current = st;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][data-state="open"]:not([data-player-sheet])')) return;
      if (zoomRef.current) { setZoom(false); return; }
      dispatch(stRef.current.panel ? { type: "closePanel" } : { type: "close" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);
  // Focus follows the panel: into its selected tab on open, back to the player on close.
  const hadPanel = useRef(false);
  useEffect(() => {
    if (st.panel) focusFor(panel.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'), panel.current);
    else if (hadPanel.current) focusFor(minimizeBtn.current, sheet.current);
    hadPanel.current = !!st.panel;
  }, [st.panel]);

  if (!track) return null;

  return (
    <>
      {/* ── Mini-player: floats above the tab bar ── */}
      <div ref={mini} data-app-chrome role="region" aria-label="Mini player" {...miniSwipe}
        className="fixed inset-x-[var(--m-side)] bottom-[var(--m-mini-bottom)] z-40 h-[var(--m-mini-h)] touch-none select-none overflow-hidden rounded-[var(--m-radius-bar)] m-glass">
        <div className="flex h-full items-center gap-1 pl-1.5 pr-1">
          {/* Thumbnail + title: a 3-slot strip (previous · current · next) that follows a horizontal swipe. */}
          <button ref={expandBtn} type="button" onClick={() => dispatch({ type: "open" })} aria-label={`Open now playing: ${track.title}`} aria-expanded={sheetOpen}
            className="relative h-full min-w-0 flex-1 overflow-hidden text-left">
            <div ref={miniStrip} className="m-drag absolute inset-0">
              <MiniSlot t={track} sub={err ? <span className="text-warning">{err.message}</span> : undefined} />
              {prevTrack && <div aria-hidden className="absolute inset-0 -translate-x-full"><MiniSlot t={prevTrack} /></div>}
              {nextTrack && <div aria-hidden className="absolute inset-0 translate-x-full"><MiniSlot t={nextTrack} /></div>}
            </div>
          </button>
          <PlayPauseButton size="xl" className="h-10 w-10" />
          <IconButton label="Next" className="h-10 w-10" onClick={() => engine?.next()}><SkipNextIcon /></IconButton>
        </div>
        <div aria-hidden className="absolute inset-x-3 bottom-0 h-[2px] overflow-hidden rounded-full bg-foreground/10">
          <div className="h-full bg-[var(--song-accent)]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* ── Full player sheet (song-coloured background, always light-on-dark) ── */}
      <div ref={sheet} role="dialog" aria-modal="true" aria-label={`Now playing: ${track.title}`} data-player-sheet
        data-state={sheetOpen ? "open" : "closed"} inert={!sheetOpen} tabIndex={-1}
        className="m-sheet np-sheet fixed inset-0 z-50 flex flex-col overflow-clip outline-none">
        {/* Enlarged cover: BEHIND the player, edge to edge from the top, fading into the background.
            Shown when the cover is tapped and in the half-height queue view. */}
        <div ref={bleedLayer} aria-hidden data-on={bleed} data-mode={compact ? "half" : "cover"}
          className={cn("m-bleed pointer-events-none absolute inset-x-0 top-0 z-0 overflow-hidden", compact && "h-[46dvh]")}>
          <div ref={bleedStrip} className="m-drag absolute inset-0">
            <img src={sizedArtwork(track.artworkUrl, 1080)} alt="" className="absolute inset-0 h-full w-full object-cover" referrerPolicy="no-referrer" draggable={false} />
            {prevTrack?.artworkUrl && <img src={sizedArtwork(prevTrack.artworkUrl, 1080)} alt="" className="absolute inset-0 h-full w-full -translate-x-full object-cover" referrerPolicy="no-referrer" draggable={false} />}
            {nextTrack?.artworkUrl && <img src={sizedArtwork(nextTrack.artworkUrl, 1080)} alt="" className="absolute inset-0 h-full w-full translate-x-full object-cover" referrerPolicy="no-referrer" draggable={false} />}
          </div>
        </div>

        <div {...sheetSwipe}
          ref={column} className="relative z-10 flex min-h-0 flex-1 touch-none select-none flex-col px-6 pb-[max(calc(var(--safe-bottom)-0.75rem),0.5rem)] pt-[var(--safe-top)]">
          <header ref={header} className="flex h-14 shrink-0 items-center [&_svg]:drop-shadow-[0_1px_3px_rgb(0_0_0/0.5)]">
            <IconButton ref={minimizeBtn} label="Minimize player" className="-ml-2 h-11 w-11" onClick={() => dispatch({ type: "close" })}><ChevronDownIcon /></IconButton>
            <div className="flex-1" />
            <TrackMenu track={track} trigger={<IconButton label={`More actions for ${track.title}`} className="-mr-2 h-11 w-11"><MoreVerticalIcon /></IconButton>} />
          </header>

          {/* Cover. Tap: enlarge behind the player (tap again to shrink). Left/right: change song. */}
          {/* The cover sits right under the header: a square area (shrinks on short phones) with the title and
              controls directly below it; spare height goes above the bottom handle instead of around the cover.
              overflow-y: clip → the cover can never spill over the header or the title (x stays visible for the carousel). */}
          <div {...artSwipe} className="relative grid aspect-square w-full min-h-0 shrink place-items-center pb-4 pt-1 [container-type:size] [overflow-y:clip]">
            {bleed ? (
              <button type="button" className="absolute inset-0" aria-label={compact ? "Back to the player" : "Show artwork at normal size"} aria-pressed={zoom}
                onClick={() => (compact ? dispatch({ type: "closePanel" }) : setZoom(false))} />
            ) : (
              <div role="button" tabIndex={0} aria-label="Show artwork full screen" aria-pressed={false}
                onClick={() => setZoom(true)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setZoom(true); } }}
                className="relative aspect-square w-[min(100cqw,100cqh)] cursor-zoom-in rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]">
                {/* Previous · current · next covers, one screen width apart (never peeking); the strip follows the finger. */}
                <div ref={artStrip} className="m-drag absolute inset-0">
                  <Artwork src={track.artworkUrl} alt={`${track.title} artwork`} size={560} priority rounded="lg" className="w-full shadow-[0_24px_60px_-20px_oklch(0_0_0/0.7)]" />
                  {prevTrack && <div aria-hidden className="absolute inset-0 -translate-x-[100vw]"><Artwork src={prevTrack.artworkUrl} alt="" size={560} rounded="lg" className="w-full" /></div>}
                  {nextTrack && <div aria-hidden className="absolute inset-0 translate-x-[100vw]"><Artwork src={nextTrack.artworkUrl} alt="" size={560} rounded="lg" className="w-full" /></div>}
                </div>
              </div>
            )}
          </div>

          <div ref={meta} className="m-lift relative shrink-0">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1 [text-shadow:0_1px_8px_rgb(0_0_0/0.35)]">
                {/* Title → Related (songs and artists like this one), like YouTube Music. */}
                <h2 className="min-w-0 text-[22px] font-bold leading-tight">
                  <button type="button" onClick={() => dispatch({ type: "openPanel", tab: "related", detent: "half" })}
                    className="flex min-w-0 max-w-full items-center gap-1 text-left [&_svg]:h-5 [&_svg]:w-5 [&_svg]:shrink-0 [&_svg]:text-muted">
                    <span className="min-w-0 truncate">{track.title}</span><span className="sr-only">, show related music</span><ChevronRightIcon />
                  </button>
                </h2>
                {/* Each artist opens only that artist (roomy touch targets; the route change closes the player). */}
                <div className="line-clamp-1 text-[17px] text-muted"><ArtistLinks item={track} linkClassName="inline-block py-1 active:text-foreground" /></div>
              </div>
            </div>
            {err && <p role="status" className="mt-2 flex items-center gap-2 text-sm text-warning [&_svg]:h-4 [&_svg]:w-4"><WarningIcon />{err.message}</p>}
            {/* Glass action pills (hidden in the compact half view, like the reference). */}
            {!compact && (
              <div className="scroller -mx-6 mt-[clamp(0.875rem,2.6dvh,1.75rem)] flex gap-2 overflow-x-auto px-6" role="toolbar" aria-label="Song actions">
                <LikePill />
                <Pill icon={<QueueIcon />} label="Up next" onClick={() => dispatch({ type: "openPanel", tab: "next", detent: "half" })} />
                <Pill icon={<LyricsIcon />} label="Lyrics" onClick={() => dispatch({ type: "openPanel", tab: "lyrics", detent: "half" })} />
                <Pill icon={<RelatedIcon />} label="Related" onClick={() => dispatch({ type: "openPanel", tab: "related", detent: "half" })} />
                <Pill icon={<ShareIcon />} label="Share" onClick={() => void shareTrack(track)} />
              </div>
            )}
            {/* Spacing scales with screen height: tall phones get breathing room, small ones stay compact. */}
            <SeekBar layout="stacked" className="mt-[clamp(0.875rem,3.2dvh,2.25rem)]" />
            <div className="mt-[clamp(0.25rem,2dvh,1.25rem)] flex items-center justify-between [&_button]:h-11 [&_button]:w-11">
              <ShuffleButton /><div className="[&_button[aria-pressed]]:!h-16 [&_button[aria-pressed]]:!w-16 [&_button[aria-pressed]]:!bg-white [&_button[aria-pressed]]:!text-black [&_button[aria-pressed]_svg]:!h-8 [&_button[aria-pressed]_svg]:!w-8"><TransportControls big /></div><RepeatButton />
            </div>
            {/* Volume, like Apple Music (hidden in the half view). */}
            {!compact && <MobileVolume />}
          </div>
          <div className="min-h-2 flex-1" />
        </div>

        {/* ── Up next / Lyrics / Related panel (half: under the controls; full: whole screen) ── */}
        <div ref={panel} data-state={st.panel ? "open" : "closed"} data-detent={st.detent} inert={!st.panel} tabIndex={-1}
          className="m-sheet m-panel outline-none !absolute inset-x-0 bottom-0 top-[calc(var(--safe-top)+0.75rem)] z-20 flex flex-col overflow-clip rounded-t-[var(--m-radius-sheet)] bg-[var(--m-bg-sheet)] shadow-[0_-12px_40px_-12px_rgb(0_0_0/0.5)]">
          <div {...panelSwipe} className="shrink-0 touch-none select-none">
            <div aria-hidden className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-foreground/25" />
            {/* Full height: a compact now-playing row replaces the hidden player. */}
            {st.panel && st.detent === "full" && (
              <div className="flex items-center gap-3 px-4 pt-3">
                <Artwork src={track.artworkUrl} alt="" size={44} className="w-11 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-1 font-semibold">{track.title}</div>
                  <div className="line-clamp-1 text-sm text-muted">{track.artist}</div>
                </div>
                <PlayPauseButton size="xl" className="h-11 w-11" />
                <IconButton label="Back to player" className="h-11 w-11" onClick={() => dispatch({ type: "closePanel" })}><ChevronDownIcon /></IconButton>
              </div>
            )}
            <div role="tablist" aria-label="Player panels" className="mx-4 mt-3 grid grid-cols-3 rounded-full bg-press p-1">
              {PANEL_TABS.map((t) => (
                <button key={t} type="button" role="tab" id={`m-tab-${t}`} aria-selected={st.panel === t} aria-controls="m-panel-body"
                  onClick={() => dispatch({ type: "openPanel", tab: t, detent: st.detent })}
                  className={cn("h-9 rounded-full text-[13px] font-semibold transition-colors", st.panel === t ? "bg-white text-black shadow-sm" : "text-muted")}>
                  {PANEL_LABEL[t]}
                </button>
              ))}
            </div>
            <div className="mt-2 h-px bg-divider" />
          </div>
          <div ref={setPanelBody} id="m-panel-body" role="tabpanel" aria-labelledby={st.panel ? `m-tab-${st.panel}` : undefined} data-scroll
            className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-2 pb-[calc(var(--safe-bottom)+1rem)] pt-2">
            {st.panel === "next" && <QueueList />}
            {st.panel === "lyrics" && <LyricsView />}
            {st.panel === "related" && <Related />}
          </div>
        </div>
      </div>
    </>
  );
}
