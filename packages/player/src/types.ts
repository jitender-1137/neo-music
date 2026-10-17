import type { Track } from "@zuno/core";
import type { QueueSnapshot } from "./queue";

/**
 * Explicit playback states.
 *   idle → loading → (buffering ↔ playing ↔ paused | seeking) → ended
 *   any → error (recoverable: retry/skip; fatal: stop)
 */
export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "buffering" | "seeking" | "ended" | "error";
export type RepeatMode = "off" | "all" | "one";

export interface PlayContext { type: "album" | "playlist" | "artist" | "radio" | "search" | "track" | "queue" | "home"; id?: string; title?: string }

/** Why playback failed, so the UI and retries can treat each case on its own terms. */
export type PlayerErrorKind = "not_allowed" | "network" | "decode" | "auth" | "unavailable" | "offline" | "unknown"
  /** iOS Home Screen app: WebKit didn't restart audio from the background; opening the app does. */
  | "background_blocked";
export interface PlayerError { message: string; recoverable: boolean; trackId?: string; kind?: PlayerErrorKind }

export interface PlayerState {
  status: PlayerStatus;
  /** Monotonic: changes whenever the current entry changes. */
  generation: number;
  queue: QueueSnapshot;
  context: PlayContext | null;
  positionSec: number;
  durationSec: number;
  bufferedSec: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  autoplay: boolean;
  error: PlayerError | null;
  /** Radio/autoplay is fetching more tracks. */
  replenishing: boolean;
}

/** The subset of HTMLMediaElement the engine uses — lets tests drive a fake. */
export interface AudioLike {
  src: string;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  volume: number;
  muted: boolean;
  preload: string;
  readonly buffered: { length: number; end(i: number): number };
  readonly error: { code: number; message?: string } | null;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, fn: (e?: unknown) => void): void;
  removeEventListener(type: string, fn: (e?: unknown) => void): void;
}

export interface MediaSessionAdapter {
  setMetadata(track: Track | null): void;
  setPlaybackState(state: "playing" | "paused" | "none"): void;
  setPosition(position: number, duration: number, rate: number): void;
  setHandlers(h: Partial<Record<"play" | "pause" | "previoustrack" | "nexttrack" | "seekto" | "seekbackward" | "seekforward" | "stop", ((details?: { seekTime?: number; seekOffset?: number }) => void) | null>>): void;
}

export type AnalyticsType = "start" | "qualified" | "complete" | "skip" | "queue_add";
export interface AnalyticsEvent { type: AnalyticsType; track: Track; msPlayed: number; durationMs?: number; context: PlayContext | null }

export interface SavedSession {
  version: 1;
  queue: QueueSnapshot;
  context: PlayContext | null;
  positionSec: number;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  muted: boolean;
  autoplay: boolean;
  radioSeed: Track | null;
  radioContinuation?: string;
}

export interface EngineDeps {
  audio: AudioLike;
  /**
   * Return a string synchronously whenever possible (iOS requires play() inside the user
   * gesture). A Promise is accepted when the URL can't be built yet; the engine then unlocks the
   * element with silence during the gesture and swaps in the real source when it resolves.
   */
  streamUrl(track: Track): string | Promise<string>;
  /** Called after a media error to learn why (e.g. "unavailable in your region"). */
  diagnose?(track: Track): Promise<{ message: string; skippable: boolean; kind?: PlayerErrorKind; /** e.g. a refreshed authorization: reload once at the same spot */ retry?: boolean }>;
  /** Prepare the next track (server-side resolution and its first bytes). Must honour `signal`. */
  prefetch?(track: Track, signal: AbortSignal): void;
  /**
   * Register ±seek buttons with the system controls. Off on iOS/iPadOS: there they would replace
   * ⏮ ⏭ on the lock screen. On Android / desktop they appear alongside previous/next.
   */
  seekButtons?: boolean;
  /** Seconds before the end of the current track to start preparing the next (default 30; never < 5). */
  prefetchLeadSec?: number;
  /**
   * The real length of a song whose catalogue entry has none (e.g. YouTube Music search results).
   * Safari can report about twice the length for these streams, so the engine asks once per song
   * and prefers the answer over the browser's estimate.
   */
  lookupDuration?(track: Track): Promise<number | undefined>;
  /**
   * Count "playing" only once the clock really moves (iOS can fire "playing" with a frozen clock).
   * Until then the state is "buffering"; a frozen start is reloaded once at the same spot, then
   * reported as a paused error. Used on iPhone / iPad; desktop keeps the plain event-driven state.
   */
  confirmPlayback?: boolean;
  /** Whether the page is in the background (for the confirmPlayback failure message). */
  isHidden?(): boolean;
  fetchRadio?(seed: Track, continuation?: string): Promise<{ tracks: Track[]; continuation?: string }>;
  onAnalytics?(e: AnalyticsEvent): void;
  /** Diagnostic trace of self-healing steps (re-opened stream, stall recovery…). Optional. */
  onDiagnostic?(message: string): void;
  mediaSession?: MediaSessionAdapter;
  save?(s: SavedSession): void;
  now?(): number;
  rng?(): number;
}
