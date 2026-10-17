"use client";
import { useSyncExternalStore } from "react";
import { AVATAR_ART, type AvatarKind } from "@/components/ui/avatarArt.generated";

/**
 * Your avatar: one of the Neo Music mascots in a colour set, chosen at random the first time and
 * saved on this device (localStorage) — no account needed. "Shuffle avatar" picks a new one.
 */
export const AVATAR_PALETTES = [
  { hp: "#f29a62", hp2: "#e8c2bd", tile: "#fde8d8" },
  { hp: "#1fbf8f", hp2: "#bfe6ff", tile: "#dff5ee" },
  { hp: "#9a7cf0", hp2: "#f3c6dc", tile: "#ece6ff" },
  { hp: "#f27aa6", hp2: "#ffe0a8", tile: "#ffe3ee" },
  { hp: "#4aa8f0", hp2: "#ffd2b8", tile: "#e0f0ff" },
  { hp: "#e8b33a", hp2: "#ffd9c2", tile: "#fff1cf" },
] as const;

export interface AvatarChoice { kind: AvatarKind; palette: number }

const KEY = "zuno.avatar.v1";
const KINDS = Object.keys(AVATAR_ART) as AvatarKind[];
const listeners = new Set<() => void>();
let cache: AvatarChoice | null = null;

function valid(c: unknown): c is AvatarChoice {
  return !!c && typeof c === "object" && KINDS.includes((c as AvatarChoice).kind) && Number.isInteger((c as AvatarChoice).palette)
    && (c as AvatarChoice).palette >= 0 && (c as AvatarChoice).palette < AVATAR_PALETTES.length;
}

/** A random choice, different from `not` when given (so a shuffle always changes something). */
export function randomAvatar(rand: () => number = Math.random, not?: AvatarChoice): AvatarChoice {
  for (let i = 0; i < 8; i++) {
    const c = { kind: KINDS[Math.floor(rand() * KINDS.length)]!, palette: Math.floor(rand() * AVATAR_PALETTES.length) };
    if (!not || c.kind !== not.kind || c.palette !== not.palette) return c;
  }
  return { kind: KINDS[(KINDS.indexOf(not!.kind) + 1) % KINDS.length]!, palette: not!.palette };
}

function read(): AvatarChoice {
  if (cache) return cache;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
    if (valid(saved)) return (cache = saved);
  } catch { /* storage blocked: fall through to a fresh pick (kept in memory) */ }
  cache = randomAvatar();
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  return cache;
}

export function shuffleAvatar() {
  cache = randomAvatar(Math.random, read());
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

/** The saved avatar (null during server rendering — the choice lives on the device). */
export function useAvatar(): AvatarChoice | null {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, read, () => null);
}
