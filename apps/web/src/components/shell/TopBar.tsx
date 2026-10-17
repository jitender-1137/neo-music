"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth";
import { setPrefs, usePrefs } from "@/lib/prefs";
import { PHONE_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { shuffleAvatar } from "@/lib/avatar";
import { Avatar } from "../ui/Avatar";
import { ActionSheet, SheetAction } from "../mobile/ActionSheet";
import { closeNowPlaying } from "@/lib/nowPlaying";
import { IconButton } from "../ui/Button";
import { MenuIcon, LoginIcon, LogoutIcon, RefreshIcon, SettingsIcon, UserCircleIcon, HistoryIcon, MonitorIcon, MoonIcon, SunIcon } from "../icons";
import { menuContentCls, menuItemCls } from "../music/TrackMenu";
import { Logo } from "./Logo";
import { SearchBox } from "./SearchBox";
import { InstallButton } from "./InstallButton";

/**
 * Phones: your avatar (a mascot picked at random and saved on this device) opens an action sheet
 * with your account options — guests included, so the header never needs a "Sign in" pill.
 */
function PhoneAccountMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const go = (href: string) => { setOpen(false); router.push(href); };
  return (
    <>
      <button type="button" aria-label="Account menu" onClick={() => setOpen(true)}
        className="m-press grid h-8 w-8 place-items-center rounded-full shadow-[0_0_0_1.5px_rgb(255_255_255/0.18)]">
        <Avatar className="h-8 w-8" />
      </button>
      <ActionSheet open={open} onOpenChange={setOpen} title="Account"
        header={<div className="flex items-center gap-3"><Avatar className="h-12 w-12" /><div className="min-w-0">
          <div className="line-clamp-1 font-semibold">{user ? user.displayName : "Guest listener"}</div>
          <div className="line-clamp-1 text-sm text-muted">{user ? user.email : "Your music is saved on this device"}</div></div></div>}>
        {user
          ? <SheetAction icon={<UserCircleIcon />} onSelect={() => go("/account")}>Your account</SheetAction>
          : <SheetAction icon={<LoginIcon />} onSelect={() => go("/login")}>Sign in or create an account</SheetAction>}
        <SheetAction icon={<HistoryIcon />} onSelect={() => go("/history")}>History</SheetAction>
        <SheetAction icon={<SettingsIcon />} onSelect={() => go("/settings")}>Settings</SheetAction>
        <SheetAction icon={<RefreshIcon />} onSelect={() => shuffleAvatar()}>Shuffle avatar</SheetAction>
        {user && <SheetAction icon={<LogoutIcon />} destructive onSelect={() => { setOpen(false); void logout(); }}>Sign out</SheetAction>}
      </ActionSheet>
    </>
  );
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const phone = useMediaQuery(PHONE_QUERY);
  if (phone) return <PhoneAccountMenu />;
  if (!user) {
    return <Link href="/login" className="flex h-9 items-center gap-1.5 rounded-full glass px-3 text-sm font-medium hover:glass-strong [&_svg]:h-4 [&_svg]:w-4"><LoginIcon />Sign in</Link>;
  }
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button aria-label="Account menu" className="grid h-9 w-9 place-items-center rounded-full bg-accent font-semibold text-accent-fg">{user.displayName.slice(0, 1).toUpperCase()}</button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className={menuContentCls} align="end" sideOffset={8}>
          <div className="px-3 py-2"><div className="font-medium">{user.displayName}</div><div className="text-sm text-muted">{user.email}</div></div>
          <Menu.Separator className="my-1 h-px bg-divider" />
          <Menu.Item className={menuItemCls} onSelect={() => router.push("/account")}><UserCircleIcon />Your account</Menu.Item>
          <Menu.Item className={menuItemCls} onSelect={() => router.push("/history")}><HistoryIcon />History</Menu.Item>
          <Menu.Item className={menuItemCls} onSelect={() => router.push("/settings")}><SettingsIcon />Settings</Menu.Item>
          <Menu.Separator className="my-1 h-px bg-divider" />
          <Menu.Item className={menuItemCls} onSelect={() => void logout()}><LogoutIcon />Sign out</Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** One tap cycles System → Light → Dark (also in Settings). */
function ThemeToggle() {
  const { theme } = usePrefs();
  const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const label = `Theme: ${theme[0]!.toUpperCase()}${theme.slice(1)} (switch to ${next})`;
  return (
    <IconButton label={label} onClick={() => setPrefs({ theme: next })}>
      {theme === "system" ? <MonitorIcon /> : theme === "light" ? <SunIcon /> : <MoonIcon />}
    </IconButton>
  );
}

/** ☰ + logo + "Neo Music": fixed at the left of the header; the sidebar collapsing never moves it. */
function Brand() {
  const { sidebarCollapsed } = usePrefs();
  const wide = useMediaQuery("(min-width: 1024px)", true);
  return (
    <div className="flex shrink-0 items-center gap-2 md:w-[calc(var(--spacing-sidebar)-1rem)]">
      <IconButton label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} className="hidden md:inline-grid" disabled={!wide}
        aria-expanded={wide ? !sidebarCollapsed : false} onClick={() => setPrefs({ sidebarCollapsed: !sidebarCollapsed })}>
        <MenuIcon />
      </IconButton>
      <Link href="/" aria-label="Neo Music home" onClick={closeNowPlaying}
        className="origin-left transition-transform duration-200 max-md:[[data-scrolled=true]_&]:scale-[0.88]"><Logo /></Link>
    </div>
  );
}

export function TopBar() {
  // Desktop: transparent at the top, frosted once content scrolls under it.
  const [scrolled, setScrolled] = useState(false);
  // Phones: the header slides away while you scroll down the page (content gets the whole display)
  // and comes back, as a slim light-glass bar, as soon as you scroll back up.
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY, travel = 0;
    const on = () => {
      const y = window.scrollY, dy = y - last;
      last = y;
      setScrolled(y > 4);
      if (y < 60) { travel = 0; setHidden(false); return; }
      // A little hysteresis so tiny finger jitter never flickers the bar.
      travel = Math.sign(dy) === Math.sign(travel) ? travel + dy : dy;
      if (travel > 24) setHidden(true);
      else if (travel < -12) setHidden(false);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <>
    {/* Desktop: unchanged. Phones: native-app style — no background at all; the header floats
        transparently over the page, slides away while you scroll down (content uses the whole
        display) and comes back on the way up. Icons get a soft shadow to stay readable over content. */}
    <header data-app-chrome data-scrolled={scrolled} data-hidden={hidden}
      className={cn("fixed inset-x-0 top-0 z-40 flex items-center gap-3 px-4 pt-[var(--safe-top)] transition-[background-color,backdrop-filter,height,box-shadow,translate] duration-300 ease-[var(--m-sheet-ease)]",
        "h-[calc(var(--m-top-h)+var(--safe-top))] md:h-[calc(var(--spacing-topbar)+var(--safe-top))]",
        "max-md:bg-transparent",
        scrolled ? "md:bg-background/92 md:backdrop-blur-xl max-md:[&_svg]:drop-shadow-[0_1px_3px_rgb(0_0_0/0.6)] max-md:[&_a]:drop-shadow-[0_1px_3px_rgb(0_0_0/0.45)]" : "md:bg-transparent",
        hidden && "max-md:-translate-y-full")}>
      <Brand />
      <div className="hidden max-w-[520px] flex-1 md:block"><Suspense fallback={<div className="h-11 rounded-lg glass" />}><SearchBox /></Suspense></div>
      <div className="ml-auto flex items-center gap-1">
        <InstallButton />
        <ThemeToggle />
        <Link href="/settings" aria-label="Settings" className="hidden h-9 w-9 place-items-center rounded-full hover:bg-hover md:grid [&_svg]:h-5 [&_svg]:w-5"><SettingsIcon /></Link>
        <AccountMenu />
      </div>
    </header>
    </>
  );
}
