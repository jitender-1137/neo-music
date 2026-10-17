"use client";
import { useSyncExternalStore } from "react";

/**
 * "Not interested" for guests: kept on this device (localStorage) so the feature works without an
 * account. Signed-in users also send it to the server for recommendations. Shelves hide these songs.
 */
const KEY = "zuno.notInterested.v1";
const listeners = new Set<() => void>();
let cache: Set<string> | null = null;

function read(): Set<string> {
  if (cache) return cache;
  try { cache = new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]); } catch { cache = new Set(); }
  return cache;
}
function write(next: Set<string>) {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify([...next].slice(-2000))); } catch { /* storage full or blocked: keep in memory */ }
  listeners.forEach((l) => l());
}

export function markNotInterested(id: string, on = true) {
  const next = new Set(read());
  if (on) next.add(id); else next.delete(id);
  write(next);
}

const EMPTY = new Set<string>();
export function useNotInterested(): Set<string> {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    read,
    () => EMPTY,
  );
}
