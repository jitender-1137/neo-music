/**
 * Listening signals → preference weights.
 *
 * Not all events are equal: a qualified listen outweighs an impression, and a skip is contextual —
 * it lowers the track a little and the artist barely, never "dislike forever".
 */
export type EventType =
  | "impression" | "start" | "qualified" | "complete" | "skip" | "like" | "unlike" | "playlist_add"
  | "playlist_remove" | "queue_add" | "search" | "follow" | "unfollow" | "album_save" | "not_interested" | "rec_select";

/** A listen counts as "qualified" after 30 s or half the track, whichever comes first. */
export function isQualified(msPlayed: number, durationMs?: number | null): boolean {
  if (msPlayed >= 30_000) return true;
  return !!durationMs && durationMs > 0 && msPlayed >= durationMs * 0.5;
}

export interface SignalWeight { track: number; artist: number }

export const SIGNAL_WEIGHTS: Record<EventType, SignalWeight> = {
  impression: { track: 0, artist: 0 },
  start: { track: 0.1, artist: 0.05 },
  qualified: { track: 1, artist: 0.5 },
  complete: { track: 0.5, artist: 0.25 }, // on top of qualified
  skip: { track: -0.5, artist: -0.05 },
  like: { track: 3, artist: 1.5 },
  unlike: { track: -2, artist: -0.5 },
  playlist_add: { track: 2, artist: 1 },
  playlist_remove: { track: -1, artist: -0.2 },
  queue_add: { track: 0.5, artist: 0.25 },
  search: { track: 0, artist: 0 },
  follow: { track: 0, artist: 3 },
  unfollow: { track: 0, artist: -2 },
  album_save: { track: 0, artist: 1.5 },
  not_interested: { track: -5, artist: -0.5 },
  rec_select: { track: 0.3, artist: 0.1 },
};

/**
 * Exponential time decay with half-life `halfLifeDays`.
 * Long-term taste uses ~30 days; short-term session context ~2 days.
 */
export function decay(score: number, ageMs: number, halfLifeDays: number): number {
  if (ageMs <= 0) return score;
  return score * Math.pow(0.5, ageMs / (halfLifeDays * 86_400_000));
}

/** Folds a new weight into a stored, previously-decayed score. */
export function accumulate(stored: number, storedAt: Date, add: number, now: Date, halfLifeDays = 30): number {
  return decay(stored, now.getTime() - storedAt.getTime(), halfLifeDays) + add;
}
