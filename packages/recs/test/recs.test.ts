import { describe, expect, it } from "vitest";
import {
  accumulate, artistConcentration, BASELINE_CONFIG, chronologicalSplit, cosineNeighbours, coverage, decay,
  intraListDiversity, isQualified, mergeCandidates, ndcgAtK, precisionAtK, rank, recallAtK, rerank, score,
  sessionPairs, type Candidate, type Scored,
} from "../src";

const t = (id: string, artist: string) => ({ id, title: id, artistIds: [artist], artistNames: [artist] });
const f = (over = {}) => ({ tasteMatch: 0, recentContext: 0, artistAffinity: 0, collaborative: 0, freshness: 0, discovery: 0, repetitionPenalty: 0, negativePenalty: 0, ...over });

describe("signals", () => {
  it("qualifies at 30s or half the track", () => {
    expect(isQualified(29_000, 300_000)).toBe(false);
    expect(isQualified(30_000, 300_000)).toBe(true);
    expect(isQualified(20_000, 30_000)).toBe(true);
  });
  it("halves after one half-life", () => {
    expect(decay(8, 30 * 86_400_000, 30)).toBeCloseTo(4);
    expect(decay(8, 0, 30)).toBe(8);
  });
  it("accumulates onto a decayed score", () => {
    const then = new Date("2026-01-01"), now = new Date("2026-01-31");
    expect(accumulate(2, then, 1, now, 30)).toBeCloseTo(2);
  });
});

describe("ranking", () => {
  it("scores with weights and clamps", () => {
    expect(score(f({ tasteMatch: 2 }), BASELINE_CONFIG.weights)).toBeCloseTo(1);
    expect(score(f({ negativePenalty: 1 }), BASELINE_CONFIG.weights)).toBeLessThan(0);
  });
  it("merges sources and keeps max features", () => {
    const m = mergeCandidates([
      { source: "similar", items: [{ track: t("x", "A"), features: { tasteMatch: 0.2 } }] },
      { source: "colisten", items: [{ track: t("x", "A"), features: { tasteMatch: 0.5, collaborative: 0.4 } }] },
    ]);
    expect(m).toHaveLength(1);
    expect(m[0]!.sources).toEqual(["similar", "colisten"]);
    expect(m[0]!.features).toMatchObject({ tasteMatch: 0.5, collaborative: 0.4 });
  });
  it("caps and spaces artists without losing relevance order otherwise", () => {
    const scored: Scored[] = ["a1", "a2", "a3", "a4", "b1", "c1"].map((id, i) => ({
      track: t(id, id[0]!), sources: ["similar"], features: f(), score: 10 - i,
    }));
    const out = rerank(scored, { ...BASELINE_CONFIG, maxPerArtist: 2, artistSpacing: 1, discoveryShare: 0 }, 10);
    const artists = out.map((c) => c.track.artistIds[0]);
    expect(artists.filter((a) => a === "a")).toHaveLength(2);
    for (let i = 1; i < artists.length; i++) expect(artists[i]).not.toBe(artists[i - 1]);
    expect(out[0]!.track.id).toBe("a1");
  });
  it("enforces eligibility separately", () => {
    const cands: Candidate[] = [
      { track: { ...t("x", "A"), isExplicit: true }, sources: ["popular"], features: f({ tasteMatch: 1 }) },
      { track: t("y", "B"), sources: ["popular"], features: f() },
      { track: t("z", "C"), sources: ["popular"], features: f() },
    ];
    const out = rank(cands, BASELINE_CONFIG, { blockedTracks: new Set(["z"]), blockedArtists: new Set(), hideExplicit: true }, 10);
    expect(out.map((c) => c.track.id)).toEqual(["y"]);
  });
  it("is deterministic for ties", () => {
    const scored: Scored[] = ["b", "a"].map((id) => ({ track: t(id, id), sources: ["popular"], features: f(), score: 1 }));
    expect(rerank(scored, BASELINE_CONFIG, 2).map((c) => c.track.id)).toEqual(["a", "b"]);
  });
});

describe("metrics", () => {
  const rel = new Set(["a", "c"]);
  it("precision/recall/ndcg", () => {
    expect(precisionAtK(["a", "b", "c"], rel, 2)).toBe(0.5);
    expect(recallAtK(["a", "b", "c"], rel, 3)).toBe(1);
    expect(ndcgAtK(["a", "c"], rel, 2)).toBeCloseTo(1);
    expect(ndcgAtK(["b", "a"], rel, 2)).toBeLessThan(1);
  });
  it("diversity, concentration, coverage", () => {
    expect(intraListDiversity(["A", "B", "C"])).toBe(1);
    expect(intraListDiversity(["A", "A"])).toBe(0);
    expect(artistConcentration(["A", "A"])).toBe(1);
    expect(coverage([["a"], ["a", "b"]], 4)).toBe(0.5);
  });
  it("splits chronologically", () => {
    const xs = Array.from({ length: 10 }, (_, i) => ({ userId: "u", itemId: `i${i}`, at: i }));
    const { train, test } = chronologicalSplit(xs, 0.2);
    expect(Math.max(...train.map((x) => x.at))).toBeLessThan(Math.min(...test.map((x) => x.at)));
  });
});

describe("co-listening", () => {
  it("counts consecutive pairs once per user within the window", () => {
    const xs = [
      { userId: "u1", itemId: "a", at: 0 }, { userId: "u1", itemId: "b", at: 1000 }, { userId: "u1", itemId: "a", at: 2000 }, { userId: "u1", itemId: "b", at: 3000 },
      { userId: "u2", itemId: "a", at: 0 }, { userId: "u2", itemId: "b", at: 1000 },
      { userId: "u3", itemId: "a", at: 0 }, { userId: "u3", itemId: "c", at: 99 * 60_000 },
    ];
    const pairs = sessionPairs(xs);
    expect(pairs).toEqual([{ a: "a", b: "b", count: 2 }]);
    const nb = cosineNeighbours(pairs, new Map([["a", 4], ["b", 3]]), 2);
    expect(nb.get("a")![0]!.id).toBe("b");
  });
});
