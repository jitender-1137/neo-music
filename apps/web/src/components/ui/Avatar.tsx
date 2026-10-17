"use client";
import { cn } from "@/lib/cn";
import { AVATAR_PALETTES, useAvatar, type AvatarChoice } from "@/lib/avatar";
import { AVATAR_ART } from "./avatarArt.generated";

/** A mascot avatar in a round tile. Uses the device's saved avatar unless one is passed. */
export function Avatar({ choice, className }: { choice?: AvatarChoice; className?: string }) {
  const saved = useAvatar();
  const c = choice ?? saved;
  if (!c) return <span aria-hidden className={cn("block rounded-full bg-surface-2", className)} />;
  const p = AVATAR_PALETTES[c.palette]!;
  return (
    <span aria-hidden data-avatar={`${c.kind}-${c.palette}`} className={cn("block overflow-hidden rounded-full", className)}
      style={{ background: p.tile, ["--k" as string]: "#1f1b1a", ["--c" as string]: "#fffaf0", ["--b" as string]: "#fba98a", ["--hp" as string]: p.hp, ["--hp2" as string]: p.hp2 }}>
      {/* Our own static artwork (generated from the brand file), not user content. */}
      <svg viewBox="0 0 512 512" className="h-full w-full" dangerouslySetInnerHTML={{ __html: `<g transform="translate(38 44) scale(.85)">${AVATAR_ART[c.kind]}</g>` }} />
    </span>
  );
}
