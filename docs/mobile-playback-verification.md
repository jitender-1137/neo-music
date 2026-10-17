# Mobile playback verification

Build: working tree (uncommitted), 2026-10-17. Statuses: **PASS**, **FAIL**, **BLOCKED**, **UNVERIFIED**.

- **Automated environment:** Chromium via Playwright, desktop plus iPhone 13 emulation with touch. Production tests use `next build` + `next start` with the service worker active. Audio is real `<audio>` playback of the dev-tone catalog on localhost.
- **Physical device:** the user's iPhone, tested by the user, with evidence from on-device diagnostics logs. No device is attached to this machine. **Playwright does not prove iOS Lock Screen behaviour.**

## Lock screen / system controls (iPhone) — real-device evidence

Device: the user's iPhone. Evidence: on-device diagnostics logs (Settings → Playback diagnostics) and the capability report from 2026-10-17. The report showed: secure context true, installed app (standalone) true, Media Session yes, MediaMetadata yes, setPositionState yes, controls registered play/pause/stop/previous/next/seekto, audio session `playback`, volume not settable.

| Device / mode | Case | Expected | Observed (log evidence) | Status |
|---|---|---|---|---|
| iPhone, Safari tab | ⏸ from the lock screen, app hidden | Pauses | `command:pause hidden` → `audio:pause` at 128.6 s | **PASS** |
| iPhone, Safari tab | ▶ after a 2–5 s pause, app hidden | Sound resumes | `command:play hidden` → `audio:playing`; time 128.6 → 130.5 s in 2.2 s, and 140.6 → 142.9 s in 2.6 s | **PASS** |
| iPhone, Home Screen app | ⏸ from the lock screen, app hidden | Pauses | `command:pause hidden` → `audio:pause` | **PASS** |
| iPhone, Home Screen app | ▶ after a 3 s pause, app hidden | Sound resumes | `command:play hidden` → `audio:play` + `audio:playing` (readyState 4), but **time frozen**: at 149.8 s for 4 s, and at 185.8 s for 6 s (background heartbeat). Recovers only when the app is opened (stall repair reloads). | **FAIL — platform limitation (see below)** |
| iPhone, Home Screen app | Same with the whole song in memory (no network) | Sound resumes | Same frozen clock | FAIL — rules out network as the cause |
| iPhone, Home Screen app | Audio never stopped (experimental muted "hold") | Keeps running in the background | Time advanced 185.8 → 193.2 s while hidden | Observed; experiment **reverted** at the user's request |
| iPhone | Lock screen shows ⏮ ⏯ ⏭ (not ±10 s) | ⏮ ⏯ ⏭ | ⏮ ⏯ ⏭ shown | PASS (user screenshot) |
| iPhone | Correct song length on the lock screen | e.g. 3:38 | 1:39 / −1:59 = 3:38 | PASS (user screenshot) |
| iPhone, Home Screen app | ⏮ / ⏭ from the lock screen | Change track | No `command:previoustrack/nexttrack` entries in any log yet | UNVERIFIED — requires physical iOS device |
| iPhone | Seek from the lock-screen scrubber | Seeks | — | UNVERIFIED — requires physical iOS device |
| iPhone | Screen locked while playing; auto-advance | Next song plays | — | UNVERIFIED — requires physical iOS device |
| iPhone | Wi-Fi → cellular during playback / prefetch | Continues | — | UNVERIFIED — requires physical iOS device |
| iPhone | Low storage / quota pressure | Evicts, keeps playing | — | UNVERIFIED — requires physical iOS device |

**Platform limitation (recorded after device testing).**
- **What the logs show:** an iOS Home Screen web app can *continue* audio in the background. Once its audio has really stopped, iOS doesn't let it *start* sound again until the app is in the foreground.
  - The lock-screen command still arrives and the media element reports "playing", but the clock doesn't move and nothing is heard.
  - In the same situation, a Safari tab works.
- **Ruled out:**
  - command delivery (commands arrive while hidden);
  - network or connection loss (it fails from a fully in-memory copy);
  - pause length (3 s is enough to fail).
- **Explanation (inferred, not proven):** Safari, being Apple's own app, is allowed to restart its audio from the background; a Home Screen web app isn't.
- **What would fix it:** a native app (`AVAudioSession` / `MPRemoteCommandCenter`), or opening the Home Screen icon in Safari instead of as a standalone app.

## Home Screen PWA lock-screen resume — device matrix (2026-10-18 build)

**Success criteria for each case:**
- the Media Session handler is invoked (`command:*` in the log);
- `play()` resolves, or the recovery succeeds (`play():resolved`, `resume:ok`);
- `playing` fires;
- the clock advances for at least 2 s (`audio:timeupdate` / `audio:tick`);
- the lock screen and the app show the real state.

Results from earlier builds are labelled. **No case has been run on this build yet.** For each case, record the iOS version, the mode, the provider (`youtube`) and the copied log.

| Case | Safari tab | Home Screen app |
|---|---|---|
| play → Notification Centre ⏸ → ▶ immediately | **PASS** (earlier build: clock 128.6 → 130.5 s) | **FAIL** (earlier builds: frozen at 149.8 s and 185.8 s). This build: UNVERIFIED — requires physical iOS device. Expected now: `resume:frozen` → reload → either `resume:ok`, or `resume:failed` with paused state and the lock-screen hint, never a false "playing". |
| same after 5 s / 15 s / 60 s | UNVERIFIED — requires physical iOS device | UNVERIFIED — requires physical iOS device |
| app reopened after backgrounding | UNVERIFIED | UNVERIFIED (earlier builds: sound returns within about 1.5 s of opening) |
| force-quit and relaunch (session restored paused, one player) | UNVERIFIED | UNVERIFIED |
| Wi-Fi → cellular | UNVERIFIED | UNVERIFIED |
| expired, then refreshed playback authorization | covered by unit test (auth retry); device UNVERIFIED | same |
| cold and warm browser cache | UNVERIFIED | UNVERIFIED (the service worker only runs in production builds; the phone currently uses the dev server) |
| pause/play ten times | UNVERIFIED | UNVERIFIED |
| ⏮ / ⏭ from the lock screen | UNVERIFIED | UNVERIFIED (no `command:previoustrack/nexttrack` in any log yet) |

## Automated results (Chromium)

| Area | Test | Result |
|---|---|---|
| Player engine (unit) | 52 tests: idempotent play/pause, stale-load guard, duplicate `ended`, manual vs autoplay queue, Media Session delegation and re-registration, invalid position state, long-pause re-open, stall watchdog, heal on return, OS-initiated pause, error kinds, auth retry, prefetch lead/clamp/abort, catalogue duration vs Safari's 2× estimate | **52/52 PASS** |
| Provider (unit) | 26 tests incl. "Safari never gets HE-AAC" | **26/26 PASS** |
| API (integration) | 37 tests incl. ranges (206/416), ETag stability, Redis stream cache | **37/37 PASS** |
| Web (unit) | 51 tests incl. SW cache policy (expiry, failed / incomplete / unauthorized removal, LRU, pinned / current / next protection, budget, key separation) | **51/51 PASS** |
| Browser, dev build | 108 tests: phone and desktop flows, gestures, sheets, tab bar, volume, diagnostics log, desktop / tablet visual baselines (unchanged) | **108 PASS**, 9 skipped (on-demand capture / metrics) |
| Browser, production build (SW) | 6 tests: registration and versioned caches with the configured budget, catalog miss → hit, artwork CORS cached / opaque bypassed, audio Range → genuine 206 never cached, private API never stored, offline catalog + offline page | **6/6 PASS** |

## Measurements (`docs/mobile-playback-metrics.json`, Chromium, localhost, dev tones)

| Metric | Value | Caveat |
|---|---|---|
| Play/pause command → UI state | median 19 ms, max 23 ms (6 samples) | Chromium |
| Startup, cold first play | 70 ms | Local tiny files: not network-realistic |
| Startup, warm resume | 115 ms | — |
| `ended` → next `playing` | 5 ms | Local files. With real YouTube on the dev server, next-song starts were measured at 451–722 ms earlier today. |
| Prefetch start before the end | 20 s, 8 s, 22 s remaining (all > 5 s) | Dev songs are shorter than the 30 s lead, so they prepare at start |
| Prefetch completion | 12–28 ms (first 256 KB) | Localhost |
| Next start, prepared vs not prepared | 147 vs 148 ms | Not distinguishable on localhost |
| Rebuffers in the transition test | 1 `waiting`, 0 `stalled` | — |
| Network loss mid-track | No pause (song already buffered); recovered in 19 ms | Dev files are tiny, so this is not a real stall test |
| Long tasks on the player surface | 0 | Fast desktop CPU, dev build |
| Signed-in vs guest | Same engine, 1 `<audio>` | PASS |
| Gapless | **Not claimed** | Not measured on a target browser |
| API p95: playback authorization (`POST /playback/token`) | p50 2 ms, p95 55 ms (n=10) | Local API, 2026-10-18 |
| API p95: stream resolution (`POST /playback/sessions`, Redis-warm) | p50 2 ms, p95 9 ms (n=30); a cold lookup took 437 ms | Real YouTube provider |
| API p95: queue refill (`GET /recommendations/radio/:id`) | p50 520 ms, p95 633 ms (n=5) | Real YouTube provider |
| Dropped frames on the player surface | Not measured | Needs a device profiler |

## Cache strategy (observed)

- **Shell and hashed assets:** precache plus cache-first (versioned `neo-sw-v3-*`; old versions deleted on activate).
- **Artwork:** stale-while-revalidate, CORS-verified only. Covers whose CDN refuses CORS are bypassed and counted (`art-cors-failed`). This needed `connect-src` to allow the artwork CDNs; without that, the worker would have broken every cover in production (found by the test).
- **Public catalog API** (only `200` + `Cache-Control: public` + no cookie, not user-scoped): stale-while-revalidate. Observed miss → hit.
- **Audio:** bypassed (provider terms); Range requests untouched, so the network returns a genuine `206`. Normal private HTTP cache applies (`private, max-age=3600`, ETag). Prefetch warms the next song's first 256 KB.
- **Index and budget:** IndexedDB index; budget = min(15 % of quota, `NEXT_PUBLIC_CACHE_BUDGET_MB`, default 250 MB); expired / broken entries go first, then LRU; counters in Settings → Playback diagnostics → Capabilities.

## Rollback notes

- **Service worker:** revert `public/sw.js` to the previous version (bump `VERSION`) to return to shell-only caching; delete `public/sw-cache-policy.js`.
- **CSP:** remove the CDN hosts from `connect-src`, but only together with reverting the worker, or covers will break.
- **Engine:** these are independent, revertible changes in `packages/player/src/engine.ts`: long-pause re-open, watchdog, `play` event healing, error kinds, prefetch timing.
- **API:** remove the `ETag` header and the Redis `stream:v2:*` cache wrapper in `routes/playback.ts`.
