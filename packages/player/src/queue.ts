/**
 * Playback queue — an immutable value; every operation returns a new Queue.
 *
 * Semantics follow Zuno's Queue (Apache-2.0) and YouTube Music:
 * - entries carry a `uid`, so the same track can appear twice and React keys stay stable;
 * - "Play next"/"Add to queue" entries form a *manual* block directly after the current entry;
 *   radio/autoplay entries form the *auto* tail after it;
 * - shuffle permutes the upcoming context tracks once and remembers the original order, so the
 *   sequence is deterministic for the session and turning shuffle off restores it.
 */
import type { Track } from "@zuno/core";

export type EntrySource = "context" | "manual" | "auto";
export interface QueueEntry { uid: string; track: Track; source: EntrySource }

let uidCounter = 0;
export const newUid = () => `q${Date.now().toString(36)}${(uidCounter++).toString(36)}`;
export const entry = (track: Track, source: EntrySource): QueueEntry => ({ uid: newUid(), track, source });

export type Rng = () => number;

function shuffled<T>(xs: readonly T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface QueueSnapshot {
  entries: QueueEntry[];
  index: number;
  /** Pre-shuffle order of the entries after `index` (by uid), when shuffled. */
  unshuffled: string[] | null;
}

export class Queue {
  private constructor(
    readonly entries: readonly QueueEntry[],
    readonly index: number,
    private readonly unshuffled: readonly string[] | null,
  ) {}

  static empty(): Queue { return new Queue([], -1, null); }

  static from(tracks: Track[], startIndex = 0, source: EntrySource = "context"): Queue {
    if (!tracks.length) return Queue.empty();
    return new Queue(tracks.map((t) => entry(t, source)), Math.min(Math.max(0, startIndex), tracks.length - 1), null);
  }

  static restore(s: QueueSnapshot): Queue {
    const idx = s.entries.length ? Math.min(Math.max(0, s.index), s.entries.length - 1) : -1;
    return new Queue(s.entries, idx, s.unshuffled);
  }

  snapshot(): QueueSnapshot {
    return { entries: [...this.entries], index: this.index, unshuffled: this.unshuffled ? [...this.unshuffled] : null };
  }

  get current(): QueueEntry | null { return this.entries[this.index] ?? null; }
  get isShuffled(): boolean { return this.unshuffled !== null; }
  get upcoming(): readonly QueueEntry[] { return this.entries.slice(this.index + 1); }
  get history(): readonly QueueEntry[] { return this.entries.slice(0, Math.max(0, this.index)); }
  get length(): number { return this.entries.length; }

  /** End of the manual block (exclusive index). */
  private manualEnd(): number {
    let i = this.index + 1;
    while (i < this.entries.length && this.entries[i]!.source === "manual") i++;
    return i;
  }

  get remainingAuto(): number { return this.upcoming.filter((e) => e.source === "auto").length; }

  private with(entries: QueueEntry[], index = this.index, unshuffled = this.unshuffled): Queue {
    return new Queue(entries, entries.length ? index : -1, unshuffled);
  }

  /** "Play next": right after the current entry, ahead of earlier manual additions. */
  playNext(tracks: Track[]): Queue {
    if (!tracks.length) return this;
    if (this.index < 0) return Queue.from(tracks, 0, "manual");
    const add = tracks.map((t) => entry(t, "manual"));
    const e = [...this.entries];
    e.splice(this.index + 1, 0, ...add);
    return this.with(e);
  }

  /** "Add to queue": after the manual block, before the context/auto tail. */
  addToQueue(tracks: Track[]): Queue {
    if (!tracks.length) return this;
    if (this.index < 0) return Queue.from(tracks, 0, "manual");
    const add = tracks.map((t) => entry(t, "manual"));
    const e = [...this.entries];
    e.splice(this.manualEnd(), 0, ...add);
    return this.with(e);
  }

  /** Appends autoplay/radio tracks, skipping ids already upcoming. */
  appendAuto(tracks: Track[], max = 500): Queue {
    const upcomingIds = new Set(this.upcoming.map((e) => e.track.id));
    const fresh = tracks.filter((t) => !upcomingIds.has(t.id) && t.id !== this.current?.track.id);
    if (!fresh.length) return this;
    let e = [...this.entries, ...fresh.map((t) => entry(t, "auto" as const))];
    let index = this.index;
    // Bound memory: drop the oldest history, never the current or upcoming entries.
    const overflow = e.length - max;
    if (overflow > 0) {
      const drop = Math.min(overflow, Math.max(0, index));
      e = e.slice(drop);
      index -= drop;
    }
    return this.with(e, index);
  }

  /** Replaces the auto tail (e.g. a new radio). Manual and context entries stay. */
  replaceAuto(tracks: Track[]): Queue {
    const keep = this.entries.filter((e, i) => i <= this.index || e.source !== "auto");
    return new Queue(keep, this.index, this.unshuffled).appendAuto(tracks);
  }

  next(wrap: boolean): Queue | null {
    if (this.index + 1 < this.entries.length) return this.with([...this.entries], this.index + 1);
    if (wrap && this.entries.length) return this.with([...this.entries], 0);
    return null;
  }

  prev(wrap: boolean): Queue | null {
    if (this.index > 0) return this.with([...this.entries], this.index - 1);
    if (wrap && this.entries.length) return this.with([...this.entries], this.entries.length - 1);
    return null;
  }

  jumpTo(uid: string): Queue | null {
    const i = this.entries.findIndex((e) => e.uid === uid);
    if (i < 0) return null;
    // Jumping past manual entries consumes them (YouTube Music behaviour): they become history.
    return this.with([...this.entries], i);
  }

  remove(uid: string): Queue {
    const i = this.entries.findIndex((e) => e.uid === uid);
    if (i < 0 || i === this.index) return this; // the current entry is never removed from under the player
    const e = this.entries.filter((x) => x.uid !== uid);
    return this.with(e, i < this.index ? this.index - 1 : this.index, this.unshuffled?.filter((u) => u !== uid) ?? null);
  }

  /** Moves an upcoming entry to `toIndex` (absolute; clamped to the upcoming range). */
  move(uid: string, toIndex: number): Queue {
    const from = this.entries.findIndex((e) => e.uid === uid);
    if (from <= this.index) return this;
    const e = [...this.entries];
    const [moved] = e.splice(from, 1);
    const to = Math.min(Math.max(toIndex, this.index + 1), e.length);
    e.splice(to, 0, moved!);
    return this.with(e);
  }

  clearUpcoming(): Queue {
    if (this.index < 0) return Queue.empty();
    return new Queue(this.entries.slice(0, this.index + 1), this.index, null);
  }

  /** Shuffle upcoming context+auto entries; manual entries keep their place right after current. */
  shuffle(rng: Rng = Math.random): Queue {
    if (this.isShuffled) return this;
    const manualEnd = this.manualEnd();
    const head = this.entries.slice(0, manualEnd);
    const tail = this.entries.slice(manualEnd);
    if (tail.length < 2) return new Queue([...this.entries], this.index, this.upcoming.map((e) => e.uid));
    return new Queue([...head, ...shuffled(tail, rng)], this.index, this.upcoming.map((e) => e.uid));
  }

  /** Restores the pre-shuffle order of whatever is still upcoming (new arrivals keep their place at the end). */
  unshuffle(): Queue {
    if (!this.unshuffled) return this;
    const upcoming = this.upcoming;
    const byUid = new Map(upcoming.map((e) => [e.uid, e]));
    const ordered = this.unshuffled.map((u) => byUid.get(u)).filter((e): e is QueueEntry => !!e);
    const extra = upcoming.filter((e) => !this.unshuffled!.includes(e.uid));
    const manual = ordered.filter((e) => e.source === "manual");
    const rest = [...ordered.filter((e) => e.source !== "manual"), ...extra];
    return new Queue([...this.entries.slice(0, this.index + 1), ...manual, ...rest], this.index, null);
  }

  /** Repeat-all lap while shuffled: reshuffle everything except the entry about to play. */
  reshuffleForLap(rng: Rng = Math.random): Queue {
    if (this.entries.length < 2) return this.with([...this.entries], 0);
    const all = shuffled(this.entries, rng);
    // Avoid replaying the last song immediately when there's a choice.
    if (all[0]!.uid === this.current?.uid) [all[0], all[1]] = [all[1]!, all[0]!];
    return new Queue(all, 0, all.slice(1).map((e) => e.uid));
  }
}
