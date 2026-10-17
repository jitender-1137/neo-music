/**
 * Import model shared by API (link import, matching) and web (file parsers, wizard).
 * An ImportItem is "a song as another service described it"; matching turns it into a Track.
 */
import { z } from "zod";
import { Track } from "./models";

export const ImportItem = z.object({
  title: z.string().trim().min(1).max(300),
  artist: z.string().trim().max(300).default(""),
  album: z.string().trim().max(300).optional(),
  durationSec: z.number().positive().max(24 * 3600).optional(),
  isrc: z.string().trim().max(20).optional(),
  /** Already a catalog id (YouTube links, Google Takeout, our own exports) — no matching needed. */
  catalogId: z.string().regex(/^[\w-]{1,64}$/).optional(),
});
export type ImportItem = z.infer<typeof ImportItem>;

export const ImportSource = z.enum([
  "youtube", "youtube_music", "spotify", "deezer", "apple_music", "csv", "m3u", "pls", "txt", "json", "takeout", "paste",
]);
export type ImportSource = z.infer<typeof ImportSource>;

export const ImportCollection = z.object({
  name: z.string().trim().min(1).max(150),
  /** What the collection was in the source: a playlist, an album, or the user's liked songs. */
  kind: z.enum(["playlist", "album", "liked"]).default("playlist"),
  source: ImportSource,
  items: z.array(ImportItem).max(5000),
});
export type ImportCollection = z.infer<typeof ImportCollection>;

export const MatchConfidence = z.enum(["exact", "high", "medium", "low", "none"]);
export type MatchConfidence = z.infer<typeof MatchConfidence>;

export const MatchResult = z.object({
  index: z.number().int(),
  confidence: MatchConfidence,
  score: z.number(),
  track: Track.nullable(),
  /** Other plausible catalog tracks, best first — offered when the user reviews a match. */
  alternatives: z.array(Track).max(5),
});
export type MatchResult = z.infer<typeof MatchResult>;
