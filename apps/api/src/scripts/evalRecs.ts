/**
 * Offline recommendation evaluation on real listening data (no synthetic data).
 * Chronological split → train co-listening + popularity on the past, score next-item recall on
 * the future. Compares item-item co-listen (+ popularity backfill) against the popularity baseline.
 *
 *   pnpm --filter @zuno/api exec tsx src/scripts/evalRecs.ts
 */
import { and, eq, isNotNull } from "drizzle-orm";
import {
  artistConcentration, chronologicalSplit, cosineNeighbours, coverage, ndcgAtK, precisionAtK, recallAtK, sessionPairs,
  type Interaction,
} from "@zuno/recs";
import { createDb } from "../db/client";
import { listeningEvents } from "../db/schema";

const MIN_INTERACTIONS = 500;
const MIN_USERS = 20;
const K = 10;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");
const { db, pool } = createDb(url, 2);
const rows = await db.select({ userId: listeningEvents.userId, ctx: listeningEvents.context, trackId: listeningEvents.trackId, at: listeningEvents.occurredAt, artists: listeningEvents.artistIds })
  .from(listeningEvents).where(and(eq(listeningEvents.type, "qualified"), isNotNull(listeningEvents.trackId)));
await pool.end();

const xs: Interaction[] = rows.map((r) => ({ userId: r.userId ?? `anon:${r.ctx.anon ?? "?"}`, itemId: r.trackId!, at: r.at.getTime() }));
const artistOf = new Map(rows.map((r) => [r.trackId!, r.artists[0] ?? r.trackId!]));
const users = new Set(xs.map((x) => x.userId)).size;
console.log(`qualified listens: ${xs.length}, actors: ${users}, distinct tracks: ${new Set(xs.map((x) => x.itemId)).size}`);
if (xs.length < MIN_INTERACTIONS || users < MIN_USERS) {
  console.log(`INSUFFICIENT DATA: need ≥${MIN_INTERACTIONS} qualified listens from ≥${MIN_USERS} actors for a meaningful offline evaluation. No metrics reported.`);
  process.exit(0);
}

const { train, test } = chronologicalSplit(xs, 0.2);
const pop = new Map<string, number>();
for (const x of train) pop.set(x.itemId, (pop.get(x.itemId) ?? 0) + 1);
const popular = [...pop.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
const neigh = cosineNeighbours(sessionPairs(train), pop, 2);

type Result = { p: number; r: number; ndcg: number; lists: string[][] };
const evalModel = (rec: (history: string[]) => string[]): Result => {
  const byUser = new Map<string, Interaction[]>();
  for (const x of test) byUser.set(x.userId, [...(byUser.get(x.userId) ?? []), x]);
  let p = 0, r = 0, n = 0, nd = 0;
  const lists: string[][] = [];
  for (const [user, future] of byUser) {
    const history = train.filter((x) => x.userId === user).sort((a, b) => b.at - a.at).map((x) => x.itemId);
    if (!history.length) continue; // cold users evaluated separately in production via online metrics
    const relevant = new Set(future.map((x) => x.itemId).filter((id) => !history.includes(id)));
    if (!relevant.size) continue;
    const list = rec(history).filter((id) => !history.includes(id)).slice(0, K);
    lists.push(list);
    p += precisionAtK(list, relevant, K); r += recallAtK(list, relevant, K); nd += ndcgAtK(list, relevant, K); n++;
  }
  return { p: p / n, r: r / n, ndcg: nd / n, lists };
};
const baseline = evalModel(() => popular);
const hybrid = evalModel((history) => {
  const scores = new Map<string, number>();
  history.slice(0, 20).forEach((h, i) => (neigh.get(h) ?? []).forEach(({ id, sim }) => scores.set(id, (scores.get(id) ?? 0) + sim * Math.pow(0.9, i))));
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  return [...ranked, ...popular.filter((id) => !scores.has(id))];
});
const catalog = new Set(xs.map((x) => x.itemId)).size;
for (const [name, m] of [["popularity baseline", baseline], ["co-listen hybrid", hybrid]] as const) {
  const conc = m.lists.length ? m.lists.reduce((s, l) => s + artistConcentration(l.map((id) => artistOf.get(id) ?? id)), 0) / m.lists.length : 0;
  console.log(`${name.padEnd(20)} P@${K}=${m.p.toFixed(4)} R@${K}=${m.r.toFixed(4)} NDCG@${K}=${m.ndcg.toFixed(4)} coverage=${coverage(m.lists, catalog).toFixed(3)} artistHHI=${conc.toFixed(3)}`);
}
