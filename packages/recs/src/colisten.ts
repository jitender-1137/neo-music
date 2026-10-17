/**
 * Item-item co-listening from consecutive qualified plays within a session window.
 * Normalised by sqrt(pop(a)·pop(b)) (cosine) to dampen popularity bias, with minimum support.
 */
import type { Interaction } from "./metrics";

export interface CoPair { a: string; b: string; count: number }

export function sessionPairs(xs: Interaction[], windowMs = 30 * 60_000): CoPair[] {
  const byUser = new Map<string, Interaction[]>();
  for (const x of xs) byUser.set(x.userId, [...(byUser.get(x.userId) ?? []), x]);
  const counts = new Map<string, number>();
  for (const list of byUser.values()) {
    list.sort((p, q) => p.at - q.at);
    const seenPairs = new Set<string>(); // count each pair once per user (independent preference)
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!, cur = list[i]!;
      if (cur.at - prev.at > windowMs || prev.itemId === cur.itemId) continue;
      const [a, b] = prev.itemId < cur.itemId ? [prev.itemId, cur.itemId] : [cur.itemId, prev.itemId];
      const k = `${a}\u0000${b}`;
      if (seenPairs.has(k)) continue;
      seenPairs.add(k);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([k, count]) => {
    const [a, b] = k.split("\u0000") as [string, string];
    return { a, b, count };
  });
}

export function cosineNeighbours(pairs: CoPair[], popularity: Map<string, number>, minSupport = 2): Map<string, { id: string; sim: number }[]> {
  const out = new Map<string, { id: string; sim: number }[]>();
  for (const { a, b, count } of pairs) {
    if (count < minSupport) continue;
    const sim = count / Math.sqrt((popularity.get(a) ?? count) * (popularity.get(b) ?? count));
    out.set(a, [...(out.get(a) ?? []), { id: b, sim }]);
    out.set(b, [...(out.get(b) ?? []), { id: a, sim }]);
  }
  for (const list of out.values()) list.sort((x, y) => y.sim - x.sim);
  return out;
}
