"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { ShelfItem } from "@zuno/core";
import { cn } from "@/lib/cn";
import { useDebounced } from "@/hooks/useDebounced";
import { useSuggestions } from "@/lib/queries";
import { useRecentSearches } from "@/hooks/useRecentSearches";
import { Artwork } from "../ui/Artwork";
import { BackIcon, CloseIcon, HistoryIcon, SearchIcon } from "../icons";
import { albumHref, artistHref, playlistHref, trackHref } from "../music/links";

type Option = { key: string; label: string; sub?: string; art?: string; round?: boolean; kind: "recent" | "query" | "entity"; href: string };

function entityOption(i: ShelfItem): Option | null {
  switch (i.kind) {
    case "track": return { key: `t${i.track.id}`, label: i.track.title, sub: `Song • ${i.track.artist}`, art: i.track.artworkUrl, kind: "entity", href: trackHref(i.track) };
    case "album": return { key: `a${i.album.id}`, label: i.album.title, sub: `Album • ${i.album.artist}`, art: i.album.artworkUrl, kind: "entity", href: albumHref(i.album) };
    case "artist": return { key: `r${i.artist.id}`, label: i.artist.name, sub: "Artist", art: i.artist.artworkUrl, round: true, kind: "entity", href: artistHref(i.artist) };
    case "playlist": return { key: `p${i.playlist.id}`, label: i.playlist.title, sub: `Playlist • ${i.playlist.owner}`, art: i.playlist.artworkUrl, kind: "entity", href: playlistHref(i.playlist) };
    default: return null;
  }
}

/**
 * Accessible combobox (ARIA 1.2 pattern). Debounced; stale requests are cancelled by the query
 * layer (AbortSignal); focus alone never fires a request.
 */
export function SearchBox({ autoFocus, onDismiss, className }: { autoFocus?: boolean; onDismiss?: () => void; className?: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(path === "/search" ? params.get("q") ?? "" : "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebounced(value.trim(), 150);
  const sugg = useSuggestions(open ? debounced : "");
  const { recent, record, remove } = useRecentSearches();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (path === "/search") setValue(params.get("q") ?? ""); }, [path, params]);

  const options: Option[] = debounced
    ? [
        ...(sugg.data?.queries ?? []).map((q): Option => ({ key: `q${q}`, label: q, kind: "query", href: `/search?q=${encodeURIComponent(q)}` })),
        ...((sugg.data?.items ?? []).map(entityOption).filter(Boolean) as Option[]),
      ]
    : recent.slice(0, 8).map((q): Option => ({ key: `h${q}`, label: q, kind: "recent", href: `/search?q=${encodeURIComponent(q)}` }));

  function go(o: Option | null) {
    const q = o?.kind === "entity" ? value.trim() : (o?.label ?? value).trim();
    if (!q && !o) return;
    if (o?.kind !== "entity" || value.trim()) void record(o?.kind === "entity" ? value : q);
    setOpen(false);
    inputRef.current?.blur();
    router.push(o?.href ?? `/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <div className={cn("relative w-full", className)}>
      <form role="search" onSubmit={(e) => { e.preventDefault(); go(active >= 0 ? options[active] ?? null : null); }}
        className="flex h-11 items-center gap-2 rounded-full glass px-4 focus-within:glass-strong">
        {onDismiss ? <button type="button" aria-label="Close search" onClick={onDismiss} className="[&_svg]:h-5 [&_svg]:w-5"><BackIcon /></button> : <SearchIcon className="h-5 w-5 text-muted" aria-hidden />}
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-label="Search songs, albums, artists, playlists"
          placeholder="Search songs, albums, artists"
          value={value}
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          onChange={(e) => { setValue(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
            else if (e.key === "Escape") { setOpen(false); setActive(-1); if (!value) onDismiss?.(); }
          }}
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle"
        />
        {value && <button type="button" aria-label="Clear search" onClick={() => { setValue(""); inputRef.current?.focus(); }} className="text-muted [&_svg]:h-5 [&_svg]:w-5"><CloseIcon /></button>}
      </form>
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-50 max-h-[70dvh] overflow-y-auto rounded-b-lg bg-background py-2 shadow-[var(--shadow-pop)]">
          {options.map((o, i) => (
            <li key={o.key} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()} onClick={() => go(o)}
              className={cn("flex cursor-pointer items-center gap-3 px-4 py-2", i === active ? "bg-hover" : "hover:bg-hover")}>
              {o.kind === "entity" ? <Artwork src={o.art} alt="" size={40} rounded={o.round ? "full" : "md"} className="w-10" />
                : o.kind === "recent" ? <HistoryIcon className="h-5 w-5 text-muted" /> : <SearchIcon className="h-5 w-5 text-muted" />}
              <div className="min-w-0 flex-1">
                <div className="line-clamp-1">{o.label}</div>
                {o.sub && <div className="line-clamp-1 text-sm text-muted">{o.sub}</div>}
              </div>
              {o.kind === "recent" && (
                <button aria-label={`Remove ${o.label} from history`} onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); void remove(o.label); }} className="text-muted hover:text-foreground [&_svg]:h-4 [&_svg]:w-4"><CloseIcon /></button>
              )}
            </li>
          ))}
          {!debounced && recent.length > 0 && (
            <li className="px-4 pt-2"><button className="text-sm text-muted hover:text-foreground" onMouseDown={(e) => e.preventDefault()} onClick={() => void remove()}>Clear search history</button></li>
          )}
        </ul>
      )}
    </div>
  );
}
