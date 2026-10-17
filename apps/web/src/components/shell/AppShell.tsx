"use client";
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CLOSE_NOW_PLAYING } from "@/lib/nowPlaying";
import { cn } from "@/lib/cn";
import { usePrefs } from "@/lib/prefs";
import { PHONE_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { selectCurrent, usePlayer } from "@/lib/player";
import { useArtworkPalette } from "@/hooks/useArtworkPalette";
import { playerColors, songAccent } from "@/lib/palette";
import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";
import { TopBar } from "./TopBar";
import { PlayerBar } from "../player/PlayerBar";
import dynamic from "next/dynamic";
// Loaded on first open: keeps dnd-kit, lyrics and the queue UI out of the initial bundle.
const NowPlaying = dynamic(() => import("../player/NowPlaying").then((m) => m.NowPlaying), { ssr: false });
import { KeyboardShortcuts } from "../player/Shortcuts";
import { MobilePlayer } from "../mobile/MobilePlayer";
import { ZoomLock } from "./ZoomLock";
import { TopLoader } from "./TopLoader";

export function AppShell({ children }: { children: ReactNode }) {
  const { sidebarCollapsed: collapsedPref } = usePrefs();
  const wide = useMediaQuery("(min-width: 1024px)", true);
  const sidebarCollapsed = collapsedPref || !wide;
  // Phones get their own player surface (mini-player + swipe sheet); tablet/desktop keep the bar + Now Playing view.
  const phone = useMediaQuery(PHONE_QUERY);
  const hasTrack = usePlayer((s) => s.queue.index >= 0);
  // Progress bars take their colour from the current cover (falls back to the brand violet).
  const current = usePlayer(selectCurrent);
  const palette = useArtworkPalette(current?.artworkUrl);
  useEffect(() => {
    const root = document.documentElement.style;
    const a = palette ? songAccent(palette) : null;
    if (a) { root.setProperty("--song-accent-dark", a.dark); root.setProperty("--song-accent-light", a.light); }
    else { root.removeProperty("--song-accent-dark"); root.removeProperty("--song-accent-light"); }
    // Phone player background + app glow follow the cover too (registered properties → cross-fade).
    const pc = palette ? playerColors(palette) : null;
    for (const [k, v] of [["--m-bg-top", pc?.top], ["--m-bg-base", pc?.base], ["--m-bg-sheet", pc?.sheet], ["--song-glow", pc?.glow]] as const) {
      if (v) root.setProperty(k, v); else root.removeProperty(k);
    }
  }, [palette]);
  const [nowPlaying, setNowPlaying] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  useEffect(() => { if (nowPlaying) setEverOpened(true); }, [nowPlaying]);
  // While Now Playing is open (any screen size) the page behind it can't scroll — no wheel, touch or
  // iOS rubber-band scrolling leaks through. overflow:hidden keeps the scroll position, so closing
  // returns exactly where you were (and the header's scroll state doesn't flicker).
  useEffect(() => {
    if (!nowPlaying) return;
    const html = document.documentElement;
    const prev = { overflow: html.style.overflow, overscroll: html.style.overscrollBehavior };
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    return () => { html.style.overflow = prev.overflow; html.style.overscrollBehavior = prev.overscroll; };
  }, [nowPlaying]);
  const toggle = useCallback(() => setNowPlaying((o) => !o), []);
  // Any navigation (sidebar, tab bar, links, back/forward) collapses Now Playing.
  const pathname = usePathname();
  useEffect(() => { setNowPlaying(false); }, [pathname]);
  useEffect(() => {
    const close = () => setNowPlaying(false);
    window.addEventListener(CLOSE_NOW_PLAYING, close);
    return () => window.removeEventListener(CLOSE_NOW_PLAYING, close);
  }, []);
  // Publish the live sidebar width so overlays (Now Playing) sit beside it instead of covering it.
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-w", sidebarCollapsed ? "var(--spacing-sidebar-mini)" : "var(--spacing-sidebar)");
  }, [sidebarCollapsed]);
  return (
    <>
      <a href="#main" className="sr-only z-[100] rounded bg-accent px-3 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:left-2 focus:top-2">Skip to content</a>
      <TopBar />
      <Sidebar />
      <div data-app-chrome className={cn("min-h-dvh pt-[calc(var(--m-top-h)+var(--safe-top))] md:pt-[calc(var(--spacing-topbar)+var(--safe-top))] transition-[padding] duration-[var(--duration-base)]", sidebarCollapsed ? "md:pl-[var(--spacing-sidebar-mini)]" : "md:pl-[var(--spacing-sidebar)]")}>
        <main id="main" tabIndex={-1} className={cn("mx-auto w-full max-w-[1600px] outline-none md:px-6",
          // Leave room for the fixed chrome so content never hides under it.
          hasTrack ? "pb-[calc(var(--m-mini-bottom)+var(--m-mini-h)+1.25rem)] md:pb-[calc(var(--spacing-player)+2rem)]" : "pb-[calc(var(--m-nav-bottom)+var(--m-nav-h)+1.25rem)] md:pb-8")}>
          {children}
        </main>
      </div>
      {phone ? <MobilePlayer open={nowPlaying} onOpenChange={setNowPlaying} /> : <PlayerBar expanded={nowPlaying} onToggle={toggle} />}
      <BottomNav />
      {!phone && (nowPlaying || everOpened) && <NowPlaying open={nowPlaying} onOpenChange={setNowPlaying} />}
      <KeyboardShortcuts onToggleNowPlaying={toggle} />
      <ZoomLock />
      {/* useSearchParams needs a Suspense boundary in the root layout. */}
      <Suspense fallback={null}><TopLoader /></Suspense>
    </>
  );
}
