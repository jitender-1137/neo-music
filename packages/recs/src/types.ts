export type CandidateSource =
  | "similar" | "colisten" | "favorite_artist" | "similar_artist" | "liked_album" | "recent_context"
  | "popular" | "editorial" | "exploration" | "seed";

export interface CandidateTrack {
  id: string;
  title: string;
  artistIds: string[];
  artistNames: string[];
  isExplicit?: boolean;
  /** Arbitrary payload carried through ranking (e.g. the full Track). */
  payload?: unknown;
}

/** Normalised features in [0, 1] (penalties too — they're subtracted). */
export interface Features {
  tasteMatch: number;
  recentContext: number;
  artistAffinity: number;
  collaborative: number;
  freshness: number;
  discovery: number;
  repetitionPenalty: number;
  negativePenalty: number;
}

export interface Candidate {
  track: CandidateTrack;
  sources: CandidateSource[];
  features: Features;
}

export interface Scored extends Candidate {
  score: number;
}

export type Weights = Record<keyof Features, number>;

export interface RankingConfig {
  version: string;
  weights: Weights;
  /** Max tracks per artist in the final list. */
  maxPerArtist: number;
  /** No two tracks by the same primary artist within this many positions. */
  artistSpacing: number;
  /** Target share of "discovery" (non-familiar) tracks, 0–1. */
  discoveryShare: number;
}
