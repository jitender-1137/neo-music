"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { usePrefs } from "@/lib/prefs";
import { closeNowPlaying } from "@/lib/nowPlaying";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useAuth } from "@/lib/auth";
import { useMyPlaylists } from "../music/AddToPlaylist";
import { userPlaylistHref } from "../music/links";
import { CompassActiveIcon, CompassIcon, HomeActiveIcon, HomeIcon, LibraryActiveIcon, LibraryIcon, AddIcon, HeartIcon, HistoryIcon, DownloadIcon } from "../icons";

export const NAV = [
  { href: "/", label: "Home", icon: HomeIcon, active: HomeActiveIcon },
  { href: "/explore", label: "Explore", icon: CompassIcon, active: CompassActiveIcon },
  { href: "/library", label: "Library", icon: LibraryIcon, active: LibraryActiveIcon },
] as const;

export function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function Sidebar() {
  const path = usePathname();
  const { sidebarCollapsed } = usePrefs();
  // Tablets (<1024px) always get the compact rail, like YouTube Music.
  const wide = useMediaQuery("(min-width: 1024px)", true);
  const mini = sidebarCollapsed || !wide;
  const { user } = useAuth();
  const playlists = useMyPlaylists();
  return (
    <nav aria-label="Main" onClickCapture={(e) => { if ((e.target as Element).closest("a")) closeNowPlaying(); }}
      className={cn("fixed bottom-[var(--spacing-player)] left-0 top-[calc(var(--spacing-topbar)+var(--safe-top))] z-30 hidden flex-col bg-transparent transition-[width] duration-[var(--duration-base)] md:flex", mini ? "w-[var(--spacing-sidebar-mini)]" : "w-[var(--spacing-sidebar)]")}>
      <ul className="flex flex-col gap-1 px-2 pt-1">
        {NAV.map(({ href, label, icon: Icon, active: ActiveIcon }) => {
          const on = isActive(path, href);
          return (
            <li key={href}>
              <Link href={href} aria-current={on ? "page" : undefined}
                className={cn("flex items-center rounded-lg transition-colors hover:bg-hover [&_svg]:h-5 [&_svg]:w-5", mini ? "h-16 flex-col justify-center gap-1 text-[10px]" : "h-11 gap-4 px-4 text-sm", on && "bg-surface font-medium")}>
                {on ? <ActiveIcon /> : <Icon />}<span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {!mini && (
        <div className="mt-4 flex min-h-0 flex-1 flex-col px-2 pt-2">
          <Link href="/library/playlists?new=1" className="mx-2 mb-3 flex h-9 items-center justify-center gap-2 rounded-full glass text-sm font-medium hover:glass-strong [&_svg]:h-5 [&_svg]:w-5"><AddIcon />New playlist</Link>
          <ul className="min-h-0 flex-1 overflow-y-auto pb-4 text-sm">
            <li><Link href="/library/liked" className="flex items-center gap-3 rounded-lg px-4 py-2.5 hover:bg-hover [&_svg]:h-5 [&_svg]:w-5"><HeartIcon />Liked music</Link></li>
            <li><Link href="/history" className="flex items-center gap-3 rounded-lg px-4 py-2.5 hover:bg-hover [&_svg]:h-5 [&_svg]:w-5"><HistoryIcon />History</Link></li>
            <li><Link href="/import" className={cn("flex items-center gap-3 rounded-lg px-4 py-2.5 hover:bg-hover [&_svg]:h-5 [&_svg]:w-5", path === "/import" && "bg-surface")}><DownloadIcon />Import music</Link></li>
            {playlists.data?.map((p) => (
              <li key={p.id}>
                <Link href={userPlaylistHref(p.id)} className={cn("block rounded-lg px-4 py-2.5 hover:bg-hover", path === userPlaylistHref(p.id) && "bg-surface")}>
                  <span className="line-clamp-1">{p.title}</span>
                  <span className="text-xs text-muted">{user ? user.displayName : "On this device"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
