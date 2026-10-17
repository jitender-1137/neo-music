import type { Candidate, CandidateSource, CandidateTrack, Features, RankingConfig, Scored, Weights } from "./types";

/** Starting weights — tuned by offline eval + experiments, not universal constants. */
export const BASELINE_WEIGHTS: Weights = {
  tasteMatch: 1.0,
  recentContext: 0.8,
  artistAffinity: 0.9,
  collaborative: 0.7,
  freshness: 0.2,
  discovery: 0.35,
  repetitionPenalty: 1.2,
  negativePenalty: 3.0,
};

export const BASELINE_CONFIG: RankingConfig = {
  version: "hybrid-v1",
  weights: BASELINE_WEIGHTS,
  maxPerArtist: 3,
  artistSpacing: 2,
  discoveryShare: 0.3,
};

/** Popularity-only fallback, used when personalization fails or has no signal. */
export const POPULARITY_CONFIG: RankingConfig = {
  version: "popularity-v1",
  weights: { ...BASELINE_WEIGHTS, tasteMatch: 0, artistAffinity: 0, collaborative: 0, recentContext: 0, discovery: 0 },
  maxPerArtist: 2,
  artistSpacing: 2,
  discoveryShare: 0,
};

const ZERO: Features = { tasteMatch: 0, recentContext: 0, artistAffinity: 0, collaborative: 0, freshness: 0, discovery: 0, repetitionPenalty: 0, negativePenalty: 0 };
const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export function score(f: Features, w: Weights): number {
  return (
    w.tasteMatch * clamp01(f.tasteMatch) +
    w.recentContext * clamp01(f.recentContext) +
    w.artistAffinity * clamp01(f.artistAffinity) +
    w.collaborative * clamp01(f.collaborative) +
    w.freshness * clamp01(f.freshness) +
    w.discovery * clamp01(f.discovery) -
    w.repetitionPenalty * clamp01(f.repetitionPenalty) -
    w.negativePenalty * clamp01(f.negativePenalty)
  );
}

/** Merges candidates from several sources: union of sources, max of each feature. */
export function mergeCandidates(lists: { source: CandidateSource; items: { track: CandidateTrack; features?: Partial<Features> }[] }[]): Candidate[] {
  const byId = new Map<string, Candidate>();
  for (const { source, items } of lists) {
    for (const { track, features } of items) {
      const cur = byId.get(track.id);
      if (!cur) {
        byId.set(track.id, { track, sources: [source], features: { ...ZERO, ...features } });
        continue;
      }
      if (!cur.sources.includes(source)) cur.sources.push(source);
      for (const k of Object.keys(ZERO) as (keyof Features)[]) {
        cur.features[k] = Math.max(cur.features[k], features?.[k] ?? 0);
      }
    }
  }
  return [...byId.values()];
}

export interface Eligibility {
  /** Tracks the user explicitly excluded. */
  blockedTracks: Set<string>;
  blockedArtists: Set<string>;
  hideExplicit: boolean;
  /** Provider-side availability (rights/territory); undefined = unknown → allowed. */
  isAvailable?: (id: string) => boolean;
}

/** Eligibility is enforced separately from relevance, before ranking. */
export function filterEligible(cands: Candidate[], e: Eligibility): Candidate[] {
  return cands.filter((c) =>
    !e.blockedTracks.has(c.track.id) &&
    !c.track.artistIds.some((a) => e.blockedArtists.has(a)) &&
    !(e.hideExplicit && c.track.isExplicit) &&
    (e.isAvailable ? e.isAvailable(c.track.id) : true),
  );
}

/**
 * Greedy re-rank: walk candidates by score, enforcing an artist cap, artist spacing, and a target
 * familiar/discovery mix. Relevance still dominates — constraints only reorder near-ties and
 * drop over-represented artists.
 */
export function rerank(scored: Scored[], cfg: RankingConfig, limit: number): Scored[] {
  const pool = [...scored].sort((a, b) => b.score - a.score || a.track.id.localeCompare(b.track.id));
  const out: Scored[] = [];
  const perArtist = new Map<string, number>();
  const isDiscovery = (c: Scored) => c.features.discovery >= 0.5;
  let discovered = 0;

  while (out.length < limit && pool.length) {
    const recent = out.slice(-cfg.artistSpacing).map((c) => c.track.artistIds[0]);
    const wantDiscovery = cfg.discoveryShare > 0 && discovered / Math.max(1, out.length) < cfg.discoveryShare;
    let pickIdx = -1;
    for (let pass = 0; pass < 2 && pickIdx < 0; pass++) {
      for (let i = 0; i < pool.length; i++) {
        const c = pool[i]!;
        const a = c.track.artistIds[0] ?? `t:${c.track.id}`;
        if ((perArtist.get(a) ?? 0) >= cfg.maxPerArtist) continue;
        if (pass === 0 && recent.includes(a)) continue; // spacing is soft: relaxed on pass 2
        if (pass === 0 && wantDiscovery && !isDiscovery(c) && pool.slice(i, i + 5).some(isDiscovery)) continue;
        pickIdx = i;
        break;
      }
    }
    if (pickIdx < 0) break;
    const [c] = pool.splice(pickIdx, 1);
    out.push(c!);
    const a = c!.track.artistIds[0] ?? `t:${c!.track.id}`;
    perArtist.set(a, (perArtist.get(a) ?? 0) + 1);
    if (isDiscovery(c!)) discovered++;
  }
  return out;
}

export function rank(cands: Candidate[], cfg: RankingConfig, e: Eligibility, limit: number): Scored[] {
  const eligible = filterEligible(cands, e);
  return rerank(eligible.map((c) => ({ ...c, score: score(c.features, cfg.weights) })), cfg, limit);
}
