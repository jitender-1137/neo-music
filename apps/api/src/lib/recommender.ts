/**
 * Hybrid recommender (online part). Candidate sources → features → @zuno/recs ranking.
 * Any failure falls back to the provider's own (non-personalised) home feed — recommendations
 * must never block the page or playback.
 */
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import {
  BASELINE_CONFIG, decay, mergeCandidates, rank, type CandidateSource, type CandidateTrack, type Features, type RankingConfig,
} from "@zuno/recs";
import type { BrowsePage, Shelf, Track } from "@zuno/core";
import type { AppContext } from "../context";
import {
  listeningHistory, recommendationConfigs, recommendationFeedback, recommendationImpressions, trackCooccurrences,
  userArtistAffinity, userLikes, userPreferences, userTrackStats,
} from "../db/schema";
import { ensureSnapshots } from "./snapshots";

const toCand = (t: Track): CandidateTrack => ({
  id: t.id, title: t.title, artistIds: t.artists?.map((a) => a.id).filter(Boolean) ?? [], artistNames: t.artists?.map((a) => a.name) ?? [t.artist],
  isExplicit: t.isExplicit, payload: t,
});

export interface Signals {
  seeds: { trackId: string; recent: boolean }[];
  topArtists: { id: string; name: string; score: number }[];
  knownArtists: Set<string>;
  recentPlays: string[];
  playedThisWeek: Set<string>;
  blockedTracks: Set<string>;
  blockedArtists: Set<string>;
  hideExplicit: boolean;
}

export async function loadSignals(ctx: AppContext, userId: string | null, guestSeeds: string[]): Promise<Signals> {
  const empty: Signals = { seeds: guestSeeds.slice(0, 5).map((trackId, i) => ({ trackId, recent: i < 2 })), topArtists: [], knownArtists: new Set(), recentPlays: guestSeeds, playedThisWeek: new Set(guestSeeds), blockedTracks: new Set(), blockedArtists: new Set(), hideExplicit: false };
  if (!userId) return empty;
  const { db, provider } = ctx;
  const p = provider.id;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [stats, likes, affinity, history, feedback, prefs] = await Promise.all([
    db.select().from(userTrackStats).where(and(eq(userTrackStats.userId, userId), eq(userTrackStats.provider, p), gt(userTrackStats.lastPlayedAt, new Date(Date.now() - 60 * 86_400_000))))
      .orderBy(desc(sql`${userTrackStats.qualified} + ${userTrackStats.completes} * 0.5 - ${userTrackStats.skips} * 0.5`)).limit(20),
    db.select().from(userLikes).where(and(eq(userLikes.userId, userId), eq(userLikes.provider, p))).orderBy(desc(userLikes.createdAt)).limit(20),
    db.select().from(userArtistAffinity).where(and(eq(userArtistAffinity.userId, userId), eq(userArtistAffinity.provider, p))).orderBy(desc(userArtistAffinity.score)).limit(30),
    db.select().from(listeningHistory).where(and(eq(listeningHistory.userId, userId), eq(listeningHistory.provider, p))).orderBy(desc(listeningHistory.playedAt)).limit(50),
    db.select().from(recommendationFeedback).where(and(eq(recommendationFeedback.userId, userId), eq(recommendationFeedback.provider, p))),
    db.query.userPreferences.findFirst({ where: eq(userPreferences.userId, userId) }),
  ]);
  const now = Date.now();
  const topArtists = affinity
    .map((a) => ({ id: a.artistId, name: a.artistName, score: decay(a.score, now - a.updatedAt.getTime(), 30) }))
    .filter((a) => a.score > 0.3)
    .sort((a, b) => b.score - a.score);
  // Onboarding picks bootstrap new accounts until real listening outweighs them.
  for (const s of prefs?.seedArtists ?? []) if (!topArtists.some((a) => a.id === s.id)) topArtists.push({ id: s.id, name: s.name, score: 0.5 });
  const recentDistinct = [...new Set(history.map((h) => h.trackId))];
  const seedIds = [...new Set([...recentDistinct.slice(0, 2), ...stats.map((s) => s.trackId), ...likes.map((l) => l.itemId), ...guestSeeds])];
  return {
    seeds: seedIds.slice(0, 6).map((trackId, i) => ({ trackId, recent: i < 2 && recentDistinct.includes(trackId) })),
    topArtists: topArtists.slice(0, 10),
    knownArtists: new Set(affinity.map((a) => a.artistId)),
    recentPlays: recentDistinct.slice(0, 20),
    playedThisWeek: new Set(history.filter((h) => h.playedAt > weekAgo).map((h) => h.trackId)),
    blockedTracks: new Set(feedback.filter((f) => f.kind === "not_interested_track").map((f) => f.targetId)),
    blockedArtists: new Set(feedback.filter((f) => f.kind === "not_interested_artist").map((f) => f.targetId)),
    hideExplicit: prefs?.hideExplicit ?? false,
  };
}

/** Active ranking config (versioned in DB) with a deterministic per-user experiment split. */
export async function rankingConfig(ctx: AppContext, userId: string | null): Promise<RankingConfig> {
  try {
    const rows = await ctx.cache.get("rec:configs", { ttlSec: 60 }, () => ctx.db.select().from(recommendationConfigs).where(eq(recommendationConfigs.active, true)));
    if (!rows.length) return BASELINE_CONFIG;
    // weights.traffic (0-100) on a variant decides its share; users are bucketed by a stable hash.
    const bucket = userId ? [...userId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 100 : 0;
    let acc = 0;
    for (const row of rows) {
      const { traffic = 100, maxPerArtist, artistSpacing, discoveryShare, ...weights } = row.weights;
      acc += traffic;
      if (bucket < acc) {
        return {
          version: row.version,
          weights: { ...BASELINE_CONFIG.weights, ...weights },
          maxPerArtist: maxPerArtist ?? BASELINE_CONFIG.maxPerArtist,
          artistSpacing: artistSpacing ?? BASELINE_CONFIG.artistSpacing,
          discoveryShare: discoveryShare ?? BASELINE_CONFIG.discoveryShare,
        };
      }
    }
  } catch {
    // fall through
  }
  return BASELINE_CONFIG;
}

const providerCache = { ttlSec: 3600, staleSec: 6 * 3600 };

export async function buildHome(ctx: AppContext, userId: string | null, guestSeeds: string[]): Promise<BrowsePage & { personalized: boolean; configVersion: string }> {
  const { provider, cache, config } = ctx;
  const region = `${provider.source ?? provider.id}:${config.YT_LOCATION}:${config.YT_LANGUAGE}`;
  const base = await cache.get(`home:${region}:`, { ttlSec: 600, staleSec: 1800 }, () => provider.getHome());
  const s = await loadSignals(ctx, userId, guestSeeds);
  if (!s.seeds.length && !s.topArtists.length) {
    return { ...base, personalized: false, configVersion: "provider-home" };
  }

  const cfg = await rankingConfig(ctx, userId);
  const lists: { source: CandidateSource; items: { track: CandidateTrack; features?: Partial<Features> }[] }[] = [];
  const familiar = (t: CandidateTrack) => t.artistIds.some((a) => s.knownArtists.has(a));
  const repetition = (id: string) => (s.recentPlays.slice(0, 10).includes(id) ? 1 : s.playedThisWeek.has(id) ? 0.5 : 0);
  const withCommon = (t: CandidateTrack, f: Partial<Features>): Partial<Features> => ({
    ...f, discovery: familiar(t) ? 0 : 1, repetitionPenalty: repetition(t.id),
    artistAffinity: Math.max(f.artistAffinity ?? 0, ...t.artistIds.map((a) => Math.min(1, (s.topArtists.find((x) => x.id === a)?.score ?? 0) / 5))),
  });

  // 1. Similar tracks: provider radio for seeds (YouTube's content similarity).
  const radios = await Promise.all(s.seeds.slice(0, 3).map((seed) =>
    cache.get(`radio:${provider.id}:${seed.trackId}`, providerCache, () => provider.getRadio({ trackId: seed.trackId })).then((r) => ({ seed, tracks: r.tracks })).catch(() => null)));
  for (const r of radios) {
    if (!r) continue;
    lists.push({ source: "similar", items: r.tracks.slice(1, 40).map((t, i) => { const c = toCand(t); return { track: c, features: withCommon(c, { tasteMatch: 1 - i / 40, recentContext: r.seed.recent ? 1 - i / 40 : 0 }) }; }) });
  }
  // 2. Co-listening neighbours from our own users.
  if (s.recentPlays.length) {
    const recent = s.recentPlays.slice(0, 10);
    const rows = await ctx.db.select().from(trackCooccurrences)
      .where(and(eq(trackCooccurrences.provider, provider.id), or(inArray(trackCooccurrences.trackA, recent), inArray(trackCooccurrences.trackB, recent)), gt(trackCooccurrences.weight, 1)))
      .orderBy(desc(trackCooccurrences.weight)).limit(40);
    const ids = rows.map((r) => (recent.includes(r.trackA) ? r.trackB : r.trackA)).filter((id) => !recent.includes(id));
    const maxW = Math.max(1, ...rows.map((r) => r.weight));
    const snaps = await ensureSnapshots(ctx, "track", ids);
    lists.push({ source: "colisten", items: rows.map((r) => {
      const id = recent.includes(r.trackA) ? r.trackB : r.trackA;
      const t = snaps.get(id);
      if (!t) return null;
      const c = toCand(t);
      return { track: c, features: withCommon(c, { collaborative: r.weight / maxW, tasteMatch: 0.5 * (r.weight / maxW) }) };
    }).filter((x): x is NonNullable<typeof x> => x !== null) });
  }
  // 3. Favourite artists' top tracks.
  const artistPages = await Promise.all(s.topArtists.slice(0, 3).map((a) =>
    cache.get(`artist:${region}:${a.id}`, providerCache, () => provider.getArtist(a.id)).catch(() => null)));
  for (const page of artistPages) {
    if (!page) continue;
    lists.push({ source: "favorite_artist", items: page.topTracks.map((t, i) => { const c = toCand(t); return { track: c, features: withCommon(c, { tasteMatch: 0.6 - i * 0.05 }) }; }) });
  }
  // 4. Popular / editorial baseline (also the exploration pool).
  const popular = base.shelves.flatMap((sh) => sh.items).flatMap((i) => (i.kind === "track" ? [i.track] : []));
  lists.push({ source: "popular", items: popular.map((t, i) => { const c = toCand(t); return { track: c, features: withCommon(c, { freshness: 1 - i / Math.max(1, popular.length) }) }; }) });

  const ranked = rank(mergeCandidates(lists), cfg, { blockedTracks: s.blockedTracks, blockedArtists: s.blockedArtists, hideExplicit: s.hideExplicit }, 20);
  const shelves: Shelf[] = [];
  shelves.push({ id: "quick-picks", title: "Quick picks", subtitle: "Based on your listening", layout: "list", items: ranked.map((c) => ({ kind: "track", track: c.track.payload as Track })) });

  if (s.recentPlays.length) {
    const snaps = await ensureSnapshots(ctx, "track", s.recentPlays.slice(0, 12));
    const items = s.recentPlays.slice(0, 12).map((id) => snaps.get(id)).filter((t): t is Track => !!t);
    if (items.length) shelves.push({ id: "listen-again", title: "Listen again", layout: "carousel", items: items.map((track) => ({ kind: "track", track })) });
  }
  const mixes = artistPages.filter((p): p is NonNullable<typeof p> => !!p && p.topTracks.length > 0).map((p) => ({
    kind: "playlist" as const,
    playlist: { id: `RDAMVM${p.topTracks[0]!.id}`, provider: provider.id as "youtube" | "dev", title: `${p.artist.name} Mix`, owner: `${p.artist.name}, ${p.topTracks.slice(1, 3).map((t) => t.artist).join(", ")} and more`, artworkUrl: p.artist.artworkUrl },
  }));
  if (mixes.length) shelves.push({ id: "your-mixes", title: "Your mixes", layout: "carousel", items: mixes });
  const firstRadio = radios.find((r) => r && r.tracks.length > 1);
  if (firstRadio) {
    const seedTrack = firstRadio.tracks[0]!;
    shelves.push({ id: "because", title: `Similar to ${seedTrack.title}`, layout: "carousel", items: firstRadio.tracks.slice(1, 16).filter((t) => !s.blockedTracks.has(t.id)).map((track) => ({ kind: "track", track })) });
  }
  const favArtists = artistPages.filter((p): p is NonNullable<typeof p> => !!p).map((p) => ({ kind: "artist" as const, artist: p.artist }));
  if (favArtists.length) shelves.push({ id: "fav-artists", title: "Your favorite artists", layout: "carousel", items: favArtists });
  // Editorial/discovery shelves from the provider, minus its own quick picks.
  shelves.push(...base.shelves.filter((sh) => !/quick picks/i.test(sh.title)));

  if (userId) {
    void ctx.db.insert(recommendationImpressions).values(ranked.map((c, i) => ({
      userId, configVersion: cfg.version, surface: "home.quick_picks", provider: provider.id, trackId: c.track.id, position: i,
      candidateSource: c.sources.join("+"), score: c.score,
    }))).catch(() => undefined);
  }
  return { title: "Home", chips: base.chips, shelves, continuation: base.continuation, personalized: true, configVersion: cfg.version };
}
