/**
 * lrclib.net — community-maintained synced lyrics (as used by Zuno). Only title, artist, album
 * and duration are sent; nothing about the listener.
 */
import type { Lyrics, Track } from "@zuno/core";
import { parseLrc } from "./lrc";

const BASE = "https://lrclib.net/api";
const UA = "NeoMusic/1.0";
const DURATION_TOLERANCE_S = 2;

interface LrclibRecord { syncedLyrics?: string | null; plainLyrics?: string | null; duration?: number; instrumental?: boolean }

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: signal ?? AbortSignal.timeout(6000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lrclib HTTP ${res.status}`);
  return (await res.json()) as T;
}

function primaryArtist(t: Track) {
  return t.artists?.[0]?.name ?? t.artist.split(/,|&| x | feat\.? /i)[0]!.trim();
}

function cleanTitle(title: string) {
  return title.replace(/\s*[([](?:feat|ft|with|from|official|lyric|audio|video|remaster)[^)\]]*[)\]]/gi, "").trim();
}

export async function lrclibLyrics(track: Track, signal?: AbortSignal): Promise<Lyrics | null> {
  const artist = primaryArtist(track);
  const titles = [...new Set([track.title, cleanTitle(track.title)])];
  for (const title of titles) {
    const qs = new URLSearchParams({ track_name: title, artist_name: artist });
    if (track.durationSec) qs.set("duration", String(Math.round(track.durationSec)));
    const exact = await getJson<LrclibRecord>(`${BASE}/get?${qs}`, signal).catch(() => null);
    if (exact?.syncedLyrics) return synced(exact.syncedLyrics);
    const found = await getJson<LrclibRecord[]>(`${BASE}/search?${new URLSearchParams({ track_name: title, artist_name: artist })}`, signal).catch(() => null);
    const best = (found ?? [])
      .filter((r) => r.syncedLyrics && (!track.durationSec || !r.duration || Math.abs(r.duration - track.durationSec) <= DURATION_TOLERANCE_S))
      .sort((a, b) => Math.abs((a.duration ?? 0) - (track.durationSec ?? 0)) - Math.abs((b.duration ?? 0) - (track.durationSec ?? 0)))[0];
    if (best?.syncedLyrics) return synced(best.syncedLyrics);
  }
  return null;
}

function synced(lrc: string): Lyrics | null {
  const lines = parseLrc(lrc);
  return lines.length ? { lines, timing: "synced", source: "LRCLIB", attribution: "Lyrics from LRCLIB (lrclib.net)" } : null;
}
