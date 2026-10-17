# Architecture

## Overview
```
Browser (Next.js app + PWA)                       Server
┌───────────────────────────────┐   /api/*   ┌──────────────── nginx (TLS) ────────────────┐
│ App shell: sidebar / tab bar  │──────────▶ │ /api/v1/stream/* (no buffering, Range) ┐     │
│ Pages (RSC for public data)   │            │ /api/*                                 ├─▶ Fastify API ──▶ MusicProvider
│ PlayerEngine ── 1 × <audio>   │◀── audio ──│ everything else ─▶ Next.js server      ┘     │   ├ YouTube (youtubei.js)
│ Media Session (lock screen)   │            └──────────────────────────────────────────────┘   └ Dev tones
│ IndexedDB: guest library,     │                         │  Postgres (accounts, library, events, recs)
│   queue, event queue          │                         │  Redis (catalog cache, rate limits)
└───────────────────────────────┘                         └─ Worker (outbox → stats, affinity, co-listen)
```

## Key decisions
| Decision | Why |
|---|---|
| **TypeScript end to end** (not Go) | The best YouTube Music library is youtubei.js (TS); Zuno's data layer could be adapted directly. One language for API, web, player and recs. |
| **Provider adapter** (`MusicProvider`) | YouTube today; a licensed catalog can be added without touching UI/API contracts. A dev tone provider makes tests deterministic and offline. |
| **Audio proxied through the API** | Deliberate deviation from "no audio through the API": googlevideo URLs are signed for the *requesting IP* and require a server-minted Proof-of-Origin token, and browsers can't call YouTube (CORS). The proxy streams with HTTP Range, bounded concurrency (`STREAM_MAX_CONCURRENCY`), 4 MiB upstream chunks, auto re-resolve on 403, and `private` cache headers. nginx passes it through unbuffered. A licensed CDN provider would return direct URLs instead. |
| **AAC on Safari/iOS, Opus elsewhere** | The client asks for MP4 unless `canPlayType('audio/webm; codecs="opus"') === "probably"`. |
| **Device playback token** | iOS only allows `play()` inside the user's tap, so the stream URL must be built synchronously. A 24 h HMAC token (`POST /playback/token`) authorizes `/stream/*`. If the token isn't ready, the engine plays 50 ms of silence inside the gesture and swaps the source when it arrives. |
| **Stateless pagination** | Continuations are YouTube's own tokens (base64url) — any API instance can serve the next page; nothing is held in memory. |
| **Cookie sessions** | Random 256-bit token in an HttpOnly, SameSite=Lax, Secure cookie; DB stores SHA-256 only. CSRF: every state-changing request must carry an allowed `Origin`. No tokens in localStorage. |
| **Outbox for listening events** | Ingestion inserts events + an outbox row in one transaction; a worker (`SKIP LOCKED`, backoff+jitter, dead-letter after 8) updates history, stats, decayed artist affinity and co-listening. Playback never waits on analytics. |
| **Metadata snapshots** | Library rows reference provider ids; `catalog_items` keeps a server-fetched snapshot (never client-supplied, since snapshots are shared). |

## Packages
- `packages/core` — zod models (`Track`, `Album`, `Shelf`, `PlaybackSession`…), error codes, text utils.
- `packages/provider` — `MusicProvider`, `YouTubeMusicProvider` (clients, PoToken via jsdom BotGuard, mappers, lyrics), `DevToneProvider`.
- `packages/player` — immutable `Queue` (manual/context/auto segments, deterministic shuffle), `PlayerEngine` (state machine: idle → loading → playing/paused/buffering/seeking → ended/error), Media Session adapter.
- `packages/recs` — signal weights, time decay, candidate merge, scoring, eligibility filter, diversity re-rank, offline metrics, co-listen.
- `apps/api` — Fastify routes (`catalog`, `playback`, `auth`, `library`, `playlists`, `events`, `recommendations`, `health`), Drizzle schema + migrations, outbox worker, OTel bootstrap.
- `apps/web` — App Router pages, shell, player UI, library (guest ⇄ account), service worker.

## Data model (Postgres)
Identity: `users`, `user_preferences`, `user_sessions` · Catalog snapshots: `catalog_items` ·
Library: `user_likes`, `user_saved_albums`, `user_followed_artists`, `user_saved_playlists`,
`playlists`, `playlist_tracks` (deferrable unique position), `search_history` · Signals:
`listening_events`, `listening_history`, `user_track_stats`, `user_artist_affinity`,
`track_cooccurrences` · Recs: `recommendation_configs`, `recommendation_impressions`,
`recommendation_feedback` · Ops: `outbox_events`, `idempotency_keys`, `audit_events`.
Schema: `apps/api/src/db/schema.ts`; migrations: `apps/api/drizzle/`.

## API
Versioned under `/api/v1`, OpenAPI/Swagger UI at `/api/docs` (47+ paths). Errors are always
`{ error: { code, message, requestId } }` with stable codes; no stack traces or provider details.

## Recommendation system
1. **Signals** (`@zuno/recs/signals`): qualified listen (≥30 s or ½ track) ≫ start; skip is a small,
   track-scoped negative; likes/playlist adds/follows are strong positives; "Not interested" removes.
2. **Profiles**: per-user artist affinity stored with timestamp and decayed on read (30-day
   half-life); track stats; recent history = short-term context.
3. **Candidates**: provider radio for top seeds (content similarity), co-listening neighbours from
   our users, favourite artists' top tracks, popular/editorial (provider home), guest seeds from
   on-device history.
4. **Score**: `Σ wᵢ·featureᵢ − penalties` (`BASELINE_WEIGHTS`, versioned in `recommendation_configs`
   with deterministic per-user traffic split).
5. **Eligibility** (separate from relevance): blocked tracks/artists, explicit preference.
6. **Re-rank**: max 3 per artist, spacing 2, ~30 % discovery share.
7. **Fallback**: any failure → provider's own home feed; cold start → provider home + guest seeds.
8. **Evaluation**: `apps/api/src/scripts/evalRecs.ts` (chronological split, P/R/NDCG@10,
   coverage, artist concentration) — refuses to report until real data is sufficient.
