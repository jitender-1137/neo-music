/**
 * Matches a song described by another service ("title / artist / duration") to a catalog track.
 * Scores candidates on normalised-title similarity, artist overlap and duration, penalising
 * versions the source didn't ask for (live, remix, cover, karaoke…).
 */
import type { ImportItem, MatchConfidence, Track } from "@zuno/core";

const NOISE_IN_BRACKETS = /[([](?:[^)\]]*?\b(?:feat\.?|ft\.?|featuring|with|remaster(?:ed)?|official|video|audio|lyrics?|visuali[sz]er|explicit|clean|radio edit|single version|album version|original mix|mono|stereo|hd|hq|4k|from [^)\]]+)\b[^)\]]*?)[)\]]/gi;
const NOISE_AFTER_DASH = /\s[-–—]\s(?:(?:\d{4}\s)?remaster(?:ed)?(?:\s\d{4})?(?:\sversion)?|single version|radio edit|mono|stereo|bonus track)\b.*$/i;
const VERSION_WORDS = ["live", "remix", "cover", "karaoke", "instrumental", "acoustic", "slowed", "reverb", "sped up", "8d", "nightcore", "lofi", "lo-fi", "mashup", "reprise"];

export function normalizeTitle(t: string): string {
  return t
    .replace(NOISE_IN_BRACKETS, " ")
    .replace(NOISE_AFTER_DASH, "")
    .replace(/\s(?:feat\.?|ft\.?)\s.*$/i, "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Title for the *search query*: noise removed ("(Remastered 2015)", "- Radio Edit", "feat. …"), case kept. */
export function searchTitle(t: string): string {
  return t.replace(NOISE_IN_BRACKETS, " ").replace(NOISE_AFTER_DASH, "").replace(/\s(?:feat\.?|ft\.?)\s.*$/i, "").replace(/\s{2,}/g, " ").trim() || t;
}

export function splitArtists(a: string): string[] {
  return a
    .split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bx\b|\band\b|\/|;|\+)\s*/i)
    .map((s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim())
    .filter(Boolean);
}

function tokens(s: string): string[] { return s.split(" ").filter(Boolean); }

/** Sørensen–Dice over word tokens, with a bonus when one title fully contains the other. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a), nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(na), tb = tokens(nb);
  const setB = new Set(tb);
  const inter = ta.filter((t) => setB.has(t)).length;
  const dice = (2 * inter) / (ta.length + tb.length);
  const contains = (na.includes(nb) || nb.includes(na)) ? 0.85 : 0;
  return Math.max(dice, contains);
}

export function artistSimilarity(source: string, track: Track): number {
  const want = splitArtists(source);
  if (!want.length) return 0.5; // unknown → neutral
  const have = [...(track.artists?.map((x) => x.name) ?? []), track.artist].flatMap(splitArtists);
  if (!have.length) return 0.3;
  let best = 0;
  for (const w of want) for (const h of have) {
    if (w === h) best = Math.max(best, 1);
    else if (w.includes(h) || h.includes(w)) best = Math.max(best, 0.8);
  }
  // Primary artist match matters most.
  return best;
}

export function durationScore(a?: number, b?: number): number {
  if (!a || !b) return 0.5;
  const d = Math.abs(a - b);
  return d <= 3 ? 1 : d <= 8 ? 0.8 : d <= 20 ? 0.45 : d <= 45 ? 0.15 : 0;
}

export function scoreCandidate(item: ImportItem, t: Track): number {
  let s = 0.55 * titleSimilarity(item.title, t.title) + 0.3 * artistSimilarity(item.artist, t) + 0.15 * durationScore(item.durationSec, t.durationSec);
  const src = item.title.toLowerCase(), cand = t.title.toLowerCase();
  for (const w of VERSION_WORDS) if (cand.includes(w) && !src.includes(w)) { s -= 0.25; break; }
  if (t.isVideo) s -= 0.04; // prefer the audio release over a music video
  return Math.max(0, Math.min(1, s));
}

export function confidenceFor(score: number): MatchConfidence {
  return score >= 0.85 ? "high" : score >= 0.66 ? "medium" : score >= 0.45 ? "low" : "none";
}

export function rankCandidates(item: ImportItem, candidates: Track[]): { best: Track | null; score: number; alternatives: Track[] } {
  const seen = new Set<string>();
  const ranked = candidates
    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
    .map((t) => ({ t, s: scoreCandidate(item, t) }))
    .sort((a, b) => b.s - a.s);
  return { best: ranked[0]?.t ?? null, score: ranked[0]?.s ?? 0, alternatives: ranked.slice(1, 6).map((r) => r.t) };
}
