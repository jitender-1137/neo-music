import Link from "next/link";
import type { Track, Album } from "@zuno/core";
import { artistHref } from "./links";

/** "A, B & C" with each linked artist navigable; unlinked names render as text. */
export function ArtistLinks({ item, className, linkClassName }: { item: Pick<Track | Album, "artist" | "artists">; className?: string; linkClassName?: string }) {
  const refs = item.artists?.filter((a) => a.name) ?? [];
  if (!refs.length) return <span className={className}>{item.artist}</span>;
  return (
    <span className={className}>
      {refs.map((a, i) => (
        <span key={`${a.id}-${i}`}>
          {i > 0 && (i === refs.length - 1 ? " & " : ", ")}
          {a.id.startsWith("UC") || a.id.startsWith("dev-") ? (
            <Link href={artistHref(a)} className={linkClassName ?? "hover:underline"} onClick={(e) => e.stopPropagation()}>{a.name}</Link>
          ) : a.name}
        </span>
      ))}
    </span>
  );
}
