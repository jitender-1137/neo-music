# Neo Music

A YouTube Music–style streaming **website + installable PWA**: Home, Explore, Search, artist /
album / playlist / song pages, a persistent player with queue, shuffle/repeat, radio, synced
lyrics, lock-screen controls, a guest mode that works without an account, and accounts that sync
your library across devices.

> ⚠️ **Read [docs/music-licensing.md](docs/music-licensing.md) before deploying publicly.** The
> default provider uses YouTube Music's unofficial API (via youtubei.js, like the Zuno desktop
> app it was derived from). That is fine for personal/private use but is not a licensed catalog.

## Stack
| Layer | Tech |
|---|---|
| Web | Next.js 16 (App Router, React 19), Tailwind 4, TanStack Query, Radix UI, dnd-kit, Solar icons |
| Player | `@zuno/player` — framework-free engine over one `<audio>` + Media Session |
| API | Fastify 5 + zod (OpenAPI at `/api/docs`), Drizzle ORM / Postgres 17, Redis 7, pino, OpenTelemetry (opt-in) |
| Catalog | `@zuno/provider` — `MusicProvider` interface; YouTube adapter (youtubei.js + bgutils-js) and a dev tone catalog |
| Recs | `@zuno/recs` — hybrid candidate generation, scoring, re-ranking, offline metrics |

```
apps/web        Next.js site + PWA
apps/mobile     Capacitor app for iPhone, Android and Apple Silicon Macs (native playback)
apps/api        Fastify API, worker, migrations
packages/core   shared models (zod)
packages/provider  YouTube + dev providers, lyrics
packages/player    playback engine + queue
packages/recs      recommendation ranking + evaluation
infra/          docker-compose (dev + prod), Dockerfiles, nginx
docs/           architecture, plan, feature matrix, testing, iOS/PWA, licensing, runbook, limitations
```

## Quick start (local)
Requires Node ≥ 22, pnpm 10, Docker.
```bash
pnpm install
pnpm infra:up                       # Postgres :5433, Redis :6380
cp apps/api/.env.example apps/api/.env   # set STREAM_SIGNING_SECRET (openssl rand -base64 32)
cp apps/web/.env.example apps/web/.env.local
pnpm db:migrate
pnpm dev                            # API :4000, web http://localhost:3000
```
Set `MUSIC_PROVIDER=dev` in `apps/api/.env` to use the offline development tone catalog.

## Checks
```bash
pnpm typecheck      # all packages
pnpm test           # unit + API integration (real Postgres/Redis)
pnpm e2e            # Playwright: flows, a11y (axe), visual goldens — dev provider, no network
pnpm loadtest       # see scripts/loadtest.mjs
```

## Native apps

Install on iPhone, Android or an M-series Mac: [docs/native-apps.md](docs/native-apps.md).

## Deploy
See [docs/operations-runbook.md](docs/operations-runbook.md) — `infra/docker-compose.prod.yml`
(Postgres, Redis, migrate, api, worker, web, nginx/TLS), backups and restore verification.

**License:** not chosen yet — pick one before publishing. Portions are adapted from [Zuno](https://github.com/noFAYZ/zuno) (Apache-2.0), so keep [NOTICE](NOTICE) with any distribution.
