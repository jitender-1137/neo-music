# Testing strategy & results

## Pyramid
| Layer | Tool | Where | Count | Notes |
|---|---|---|---|---|
| Unit | Vitest | `packages/*/test`, `apps/web/src/**/*.test.ts` | provider 25, recs 12, player 32, web 4 | Fake `<audio>` drives the engine deterministically |
| API integration | Vitest + `app.inject` | `apps/api/test` | 26 | **Real Postgres (zuno_test) + Redis db 15**, migrations applied, dev provider |
| E2E | Playwright | `apps/web/e2e` | 43 | Real browser, real API + DB, dev-tone audio; desktop + iPhone-sized project |
| Accessibility | axe-core | `e2e/a11y.spec.ts` | 10 pages + now playing + keyboard | Fails on serious/critical WCAG A/AA |
| Visual | Playwright screenshots | `e2e/visual.spec.ts` | 19 goldens | 375 / 768 / 1440 px, dark, reduced motion, fixed clock |
| Live smoke | tsx scripts | `packages/provider/scripts/smoke*.ts` | manual | Hits real YouTube; not in CI (network/terms) |
| Load | autocannon | `scripts/loadtest.mjs` | manual | Against `MUSIC_PROVIDER=dev` |

Run everything: `pnpm verify` (typecheck + unit/integration + e2e).

## Results (this environment: Apple M2, 8 cores, 16 GB, macOS, Node 25, Chromium 156)
- `pnpm -r typecheck` ✅ · `pnpm -r test` ✅ 99/99 · `pnpm e2e` ✅ 44/44 (incl. lyrics-sync).
- Production builds: API (tsup, 124 KB) ✅, web (`next build`) ✅, Docker images api + web ✅ and both containers smoke-tested.
- `pnpm audit --prod` → no known vulnerabilities. Secret scan of sources and client bundle → clean.

### Load test (single API process, dev provider, rate limits raised for measurement)
| Endpoint | req/s | p50 | p97.5 | p99 | errors |
|---|---|---|---|---|---|
| home (cached), c=50 | 17,227 | 2 ms | 4 ms | 5 ms | 0 |
| search (cached), c=50 | 19,281 | 2 ms | 3 ms | 4 ms | 0 |
| album (cached), c=50 | 22,191 | 2 ms | 3 ms | 3 ms | 0 |
| suggestions (cached), c=50 | 24,977 | 1 ms | 2 ms | 3 ms | 0 |
| stream 64 KiB range, c=50 | 2,564 (~160 MB/s) | 18 ms | 34 ms | 38 ms | 0 |
| search burst, c=300 | 18,341 | 15 ms | 20 ms | 22 ms | 0 |
With default limits the same flood is correctly answered with 429s. Uncached YouTube latencies are
~150–800 ms per catalog call (provider smoke test) and ~1.3 s for a cold stream resolve.

### Web vitals (production build, cold cache; mobile = Pixel 7, 1.6 Mbps / 150 ms RTT, 4× CPU)
| Page | Mobile LCP | Desktop LCP | CLS |
|---|---|---|---|
| Home | 2.64 s | 1.48 s | 0.000 |
| Explore | 0.23 s | 0.08 s | 0.000 |
| Album | 1.89 s | 0.42 s | 0.000 |
| Artist | 2.56 s | 1.72 s | 0.000 |
| Search | 1.22 s | 0.57 s | 0.000 |
Initial JS ≈ 271 KB transferred (Next + React + Radix + TanStack). INP was not measured.

## Manual-only checklist (needs real devices)
iPhone Safari + installed PWA; iPad; Android Chrome:
- [ ] lock screen shows title/artist/artwork; play/pause/next/prev/seek work
- [ ] audio continues with screen locked for 10+ min, through track changes (autoplay)
- [ ] switch apps and return; return to installed PWA after hours
- [ ] phone call / Siri interruption → resumes correctly or stays paused (no double audio)
- [ ] AirPods / headset buttons, CarPlay/Bluetooth metadata
- [ ] network drop mid-track → recovers (one silent retry) or shows offline message
- [ ] rotate device; safe areas (notch, home indicator) never overlap controls
- [ ] PWA install from Safari "Add to Home Screen"; standalone launch URL and splash
- [ ] VoiceOver/TalkBack walk through home → play → queue → lyrics

## Mobile
Phone layout tests, gesture coverage and what still needs a real iPhone: [mobile-test-matrix.md](mobile-test-matrix.md).
