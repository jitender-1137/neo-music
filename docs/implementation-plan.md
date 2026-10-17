# Implementation plan (as executed)

| Phase | Scope | Status |
|---|---|---|
| 0 | Monorepo, TS strict, Docker dev infra, provider spike (Node → YouTube stream end-to-end) | done |
| 1 | `@zuno/core` models, `@zuno/provider` YouTube + dev adapters, lyrics, unit + live smoke | done |
| 2 | API: catalog, playback token/sessions, Range stream proxy, Redis SWR cache, health, OpenAPI | done |
| 3 | `@zuno/player` engine + queue; web shell, player bar, mini player, Now Playing, Media Session, shortcuts | done |
| 4 | Pages: Home, Explore/browse, Search (combobox), Album, Artist, Playlist, Song | done |
| 5 | Accounts, sessions, CSRF, library, history, playlists (transactional reorder), guest IndexedDB, idempotent migration | done |
| 6 | Events → outbox worker → affinity/co-listen; hybrid recs, radio, feedback, offline eval harness | done (eval awaits real data) |
| 7 | PWA (manifest, SW), safe areas, perf (SSR home, image sizing, lazy panels), security headers, rate limits, OTel, load test, backups | done |
| 8 | Playwright e2e (flows, a11y, visual goldens), CI, docs, final audit | done |

Next steps are tracked in [known-limitations.md](known-limitations.md).
