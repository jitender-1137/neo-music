/** Offline evaluation metrics (binary relevance unless stated). */
export function precisionAtK(ranked: string[], relevant: Set<string>, k: number): number {
  const top = ranked.slice(0, k);
  return top.length ? top.filter((x) => relevant.has(x)).length / k : 0;
}

export function recallAtK(ranked: string[], relevant: Set<string>, k: number): number {
  if (!relevant.size) return 0;
  return ranked.slice(0, k).filter((x) => relevant.has(x)).length / relevant.size;
}

export function ndcgAtK(ranked: string[], relevant: Set<string>, k: number): number {
  const dcg = ranked.slice(0, k).reduce((s, x, i) => s + (relevant.has(x) ? 1 / Math.log2(i + 2) : 0), 0);
  const ideal = Array.from({ length: Math.min(k, relevant.size) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0);
  return ideal ? dcg / ideal : 0;
}

/** Share of the catalog that appears in at least one user's list. */
export function coverage(lists: string[][], catalogSize: number): number {
  if (!catalogSize) return 0;
  return new Set(lists.flat()).size / catalogSize;
}

/** 1 − (fraction of pairs sharing the primary artist). */
export function intraListDiversity(artists: string[]): number {
  const n = artists.length;
  if (n < 2) return 1;
  let same = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (artists[i] === artists[j]) same++;
  return 1 - same / ((n * (n - 1)) / 2);
}

/** Mean self-information −log2(popularity share); higher = more novel. */
export function novelty(items: string[], popularity: Map<string, number>, totalInteractions: number): number {
  if (!items.length || !totalInteractions) return 0;
  return items.reduce((s, x) => s - Math.log2(Math.max(popularity.get(x) ?? 0, 1) / totalInteractions), 0) / items.length;
}

/** Herfindahl index of artist shares (1 = one artist only). */
export function artistConcentration(artists: string[]): number {
  if (!artists.length) return 0;
  const counts = new Map<string, number>();
  for (const a of artists) counts.set(a, (counts.get(a) ?? 0) + 1);
  return [...counts.values()].reduce((s, c) => s + (c / artists.length) ** 2, 0);
}

export interface Interaction { userId: string; itemId: string; at: number }

/** Chronological split: everything before `cutoff` trains, after tests — no leakage. */
export function chronologicalSplit(xs: Interaction[], testFraction = 0.2) {
  const sorted = [...xs].sort((a, b) => a.at - b.at);
  const cut = Math.floor(sorted.length * (1 - testFraction));
  const cutoff = sorted[cut]?.at ?? Infinity;
  return { train: sorted.filter((x) => x.at < cutoff), test: sorted.filter((x) => x.at >= cutoff), cutoff };
}
