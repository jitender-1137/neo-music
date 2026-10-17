"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { NAV, isActive } from "./Sidebar";
import { closeNowPlaying } from "@/lib/nowPlaying";
import { SearchActiveIcon, SearchIcon } from "../icons";

/** Phones get Search as its own tab (Apple Music / YouTube Music convention); the sidebar keeps it in the header. */
export const MOBILE_TABS = [...NAV, { href: "/search", label: "Search", icon: SearchIcon, active: SearchActiveIcon }] as const;

const tabOf = (path: string) => MOBILE_TABS.find((t) => isActive(path, t.href))?.href ?? null;

/**
 * Mobile tab bar: a floating "liquid glass" capsule above the home indicator (safe-area aware).
 * - The selection is ONE lens that glides between tabs, and it moves the moment you tap (before the
 *   next page has loaded), so switching never stutters or shifts. Labels keep the same weight.
 * - Each tab remembers its scroll position when you leave it from the tab's root page.
 * - Tapping the tab you are on goes to its root, or scrolls to the top if already there.
 * Navigation is client-side (no reloads), so playback never stops.
 */
export function BottomNav() {
  const path = usePathname();
  const router = useRouter();
  const scroll = useRef(new Map<string, number>());
  const pending = useRef<string | null>(null);
  // Optimistic selection: shown from the tap until the route actually changes.
  const [tapped, setTapped] = useState<string | null>(null);
  useEffect(() => { setTapped(null); }, [path]);

  // Restore a tab's remembered position once its page has rendered.
  useEffect(() => {
    if (pending.current !== path) return;
    pending.current = null;
    const y = scroll.current.get(path);
    if (y == null) { window.scrollTo(0, 0); return; }
    let n = 0;
    const tryRestore = () => {
      // Wait (briefly) for content tall enough to scroll to the old spot.
      if (document.documentElement.scrollHeight - innerHeight >= y || n++ > 30) window.scrollTo(0, y);
      else requestAnimationFrame(tryRestore);
    };
    requestAnimationFrame(tryRestore);
  }, [path]);

  const go = (e: React.MouseEvent, href: string) => {
    closeNowPlaying();
    const here = tabOf(path);
    if (here === href) {
      e.preventDefault();
      if (path === href) window.scrollTo({ top: 0, behavior: "smooth" });
      else { setTapped(href); router.push(href); }
      return;
    }
    if (here && path === here) scroll.current.set(here, window.scrollY);
    pending.current = href;
    setTapped(href);
  };

  const selected = tapped ?? tabOf(path);
  const index = MOBILE_TABS.findIndex((t) => t.href === selected);

  return (
    <nav aria-label="Main" data-app-chrome
      className="fixed inset-x-[var(--m-side)] bottom-[var(--m-nav-bottom)] z-40 rounded-full m-glass md:hidden">
      <div className="relative h-[var(--m-nav-h)] p-1">
        {/* The gliding lens (hidden on pages that belong to no tab, e.g. an album). */}
        <div aria-hidden className="m-tab-lens pointer-events-none absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/4)] rounded-full"
          style={{ transform: `translateX(${Math.max(0, index) * 100}%)`, opacity: index < 0 ? 0 : 1 }} />
        <ul className="relative grid h-full grid-cols-4">
          {MOBILE_TABS.map(({ href, label, icon: Icon, active: ActiveIcon }) => {
            const on = selected === href;
            return (
              <li key={href}>
                <Link href={href} scroll={false} onClick={(e) => go(e, href)} aria-current={isActive(path, href) ? "page" : undefined}
                  className={cn("flex h-full flex-col items-center justify-center gap-[2px] rounded-full text-[10px] font-medium leading-none transition-colors duration-200 [&_svg]:h-[21px] [&_svg]:w-[21px]",
                    on ? "text-foreground" : "text-muted active:text-foreground")}>
                  {/* Both glyphs share one fixed box, so swapping linear ↔ bold never moves anything. */}
                  <span className="grid h-[22px] w-[22px] place-items-center">{on ? <ActiveIcon /> : <Icon />}</span>
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
