/**
 * The music source this device uses (Settings → Music source). Plain module (no React) so the API
 * client can read it. Stored in localStorage for the browser and mirrored to a cookie so
 * server-rendered pages fetch from the same source. Unset = the server's default.
 */
import type { MusicSource } from "@zuno/core";

export const SOURCE_COOKIE = "neo_source";
const KEY = "neo.musicSource.v1";
const VALID = new Set<MusicSource>(["youtubei", "ytmusicapi", "official"]);

export function getMusicSource(): MusicSource | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const v = localStorage.getItem(KEY) as MusicSource | null;
    return v && VALID.has(v) ? v : undefined;
  } catch { return undefined; }
}

export function setMusicSource(source: MusicSource) {
  try { localStorage.setItem(KEY, source); } catch { /* storage unavailable */ }
  document.cookie = `${SOURCE_COOKIE}=${source}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

/** Songs from this source play in YouTube's embedded player (in the browser), not as streamed audio. */
export const playsInEmbed = (source: MusicSource | undefined) => source === "official";

export function isMusicSource(v: unknown): v is MusicSource {
  return typeof v === "string" && VALID.has(v as MusicSource);
}
