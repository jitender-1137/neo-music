# Mobile / iOS / PWA playback audit

Date: 2026-10-17. Scope: the phone, iOS and PWA playback path. Desktop is out of scope except for shared playback code (all changes are backward-compatible).

**Environment limits, stated up front.** No physical iPhone and no iOS Simulator (Xcode isn't installed) are available here. Everything marked *iOS* below comes from user reports with screenshots, from WebKit behaviour documented in public bug trackers, and from code reading. **None of it has been reproduced on an iPhone by us.** Browser evidence comes from Chromium (desktop, and iPhone-sized emulation with touch) driven by Playwright, plus `curl` against the running API.

## Architecture found

| Concern | Owner | Notes |
|---|---|---|
| Playback state machine | `packages/player/src/engine.ts` (`PlayerEngine`) | Single authority. UI reads its snapshot through `usePlayer` (useSyncExternalStore). |
| Audio element | `apps/web/src/lib/player.tsx` `createEngine()` | **One** `<audio>` per browsing context, created once (StrictMode-guarded). Tests assert `document.querySelectorAll("audio").length === 1`. |
| Queue | `packages/player/src/queue.ts` | Immutable. Entries are tagged `manual` / `context` / `auto`; autoplay only appends `auto` entries. |
| Media Session | `packages/player/src/mediaSession.ts` + engine `bindMediaSession` / `refreshMediaSession` | Handlers call the same engine methods as the in-app buttons. |
| Service worker | `apps/web/public/sw.js` | Registered only when `NODE_ENV === "production"`. Caches the shell and hashed assets only. Never touches `/api/*`, audio or range requests. |
| Audio delivery | `apps/api/src/routes/playback.ts` | Signed, same-origin `/api/v1/stream/:id` proxy with HTTP Range support. This proxy is required: YouTube's googlevideo URLs are bound to the requesting IP, so there is no licensed CDN URL to hand the browser. |
| Session persistence | `saveSession` (IndexedDB) | Stores queue, index, position, repeat, shuffle and context. **Never** stores stream URLs. The playback token is stored with its expiry and only used while it has more than 1 h left. |
| Listening events | `src/lib/events.ts` | Queued and flushed asynchronously, off the playback path. |

## Live delivery evidence (`curl`, API on :4000, real track `zAiIgYOH4Ys`)

```
Range: bytes=0-1 (Safari probe, iPhone UA) → 206 Partial Content
  content-type: audio/mp4 · accept-ranges: bytes · content-length: 2
  content-range: bytes 0-1/4363282 · cache-control: private, max-age=3600, no-transform
No Range → 200 OK · content-length: 4363282 · accept-ranges: bytes
Bad token → 403
Format chosen for iPhone (preferMp4) at auto/low/normal/high → audio/mp4 ≈130 kbps (AAC-LC; HE-AAC is ≈48 kbps)
```

There is no `ETag` and no `Last-Modified` (finding A7). The API is same-origin through the web app's `/api` rewrite, so CORS headers aren't involved in playback.

## Findings

| # | Severity | Area | Reproduction | Root cause | Affected | Status |
|---|---|---|---|---|---|---|
| A1 | **Critical** | Lock screen ▶ after pause | iPhone: play → home → lock → Notification Centre ⏸ → wait → ▶. The clock runs on the lock screen and in the app, but there's **no sound** until the progress bar is dragged (user screenshots). It works when the app is in the foreground. | iOS freezes a paused web app and closes the idle media connection. WebKit then resumes the element without reopening it. Separately, the old player reloaded the source *in the background* on a paused-stream error, and iOS then refused to start it. | iOS Safari / Home-Screen PWA (user report) | **Device-tested, 2026-10-17: FAIL in the Home Screen app, PASS in a Safari tab — platform limitation.** Logs show the ▶ command arrives and the element reports playing, but the clock stays frozen until the app is foregrounded. This happens even from a fully in-memory copy, so the network is ruled out. The re-seek on resume does not help there. The stall watchdog restores sound as soon as the app is opened. See `mobile-playback-verification.md`. |
| A1b | High | First tap after an OS-initiated pause did nothing | Engine: the element is paused by the OS (no handler) → tap ▶. | `resumeAfterLoad` stayed true, so `togglePlay` read the tap as "pause". | All, mostly iOS | Fixed; unit-tested. |
| A2 | High | Duplicate `ended` | Code reading: the `ended` handler had no generation guard, so a duplicate `ended` (or `ended` racing a manual next) could advance twice. | No once-per-load guard. | All | Fixing (this pass). |
| A3 | High | Error classification | A `play()` rejection was handled as NotAllowed → paused, or else waited for the media `error` event. Network, decode and expired-authorization errors all showed "Couldn't play this track" until diagnosis finished. An expired token surfaced as a stream 403 → media error. | No error kind; no token-refresh retry. | All | Fixing (this pass). |
| A4 | Medium | Prefetch | The next song was warmed at the **start** of the current one: it competed with the current song's initial buffering, couldn't be cancelled, and wasn't stopped by rebuffering. | Prefetch triggered on `playing`. | All | Fixing: lead-time trigger (≈30 s before the end, must start before 5 s), abortable, aborted on rebuffer or track change. |
| A5 | Medium | Seek ±10 from system controls | Not registered anywhere. | Deliberate for iOS: when both are registered, iOS replaces ⏮ ⏭ with ±10 s. | Android / desktop | Fixing: register only where it doesn't displace previous/next (not iOS/iPadOS). |
| A6 | Low | Media Session artwork | The fallback icon used a relative URL. | — | Lock screen when a song has no cover | Fixing: absolute HTTPS URLs. |
| A7 | Low | Validators | No `ETag` / `Last-Modified` on stream responses. | — | Revalidation | Fixing: stable `ETag` per track, format and length. |
| A8 | Medium | Browser cache | Album art and public catalog metadata weren't cached by the service worker. | Conservative SW. | All | Fixing: stale-while-revalidate for artwork and public catalog GETs, an IndexedDB index, a quota-aware budget, LRU eviction and counters. Audio deliberately bypassed (A10). |
| A9 | Medium | Multiple tabs | Two tabs could play at once. | No playback owner coordination. | Desktop / Android browsers | Fixing: a BroadcastChannel makes the tab that starts playing the owner; others pause. |
| A10 | — (policy) | Audio caching | — | The provider is YouTube (via youtubei.js). Its terms don't permit storing or redistributing audio, so audio is **not** cached beyond the browser's normal private HTTP cache (`private, max-age=3600`). Recorded as a bypass in the cache counters. | — | By design |
| A11 | Info | Volume level on iOS | The slider moved with no effect (user report). | iOS makes media volume read-only for web pages and newer versions accept-and-ignore the value. Web Audio would stop lock-screen playback. | iOS / iPadOS | Platform limitation: the row is mute plus "use the side buttons". |
| A12 | Info | Duration ≈2× on iOS | The lock screen showed 9:49 for a ≈4:55 song. | Safari misreads HE-AAC. | iOS | Fixed: AAC-LC for Safari (verified above via bitrate); the catalogue duration wins on disagreement. |

## Cases to reproduce (status before this pass)

| Case | Evidence | Status |
|---|---|---|
| Play/pause in app | Playwright mobile suite | PASS (Chromium) |
| Lock Screen / Control Center play/pause | User screenshots: ⏸ works; ▶ after a pause is silent while backgrounded | FAIL (iOS, user-reported) → fix pending device check |
| Previous/next from system controls | User screenshot shows ⏮⏭ (handlers registered) | UNVERIFIED — requires physical iOS device |
| Seek from system controls | `seekto` registered | UNVERIFIED — requires physical iOS device |
| Screen locked while playing | — | UNVERIFIED — requires physical iOS device |
| Tab switch / backgrounding | Simulated with `visibilitychange` in Chromium | PASS (simulated only) |
| Network loss and recovery | Retry path in engine (one silent retry, then diagnosis) | To measure this pass |
| 5 s remaining / next-track start (cached, partial, absent) | — | To measure this pass |
| Guest vs signed in | Both use the same engine; the token is per device | To verify this pass |
| Cold vs warm browser cache | SW only in production builds | To measure this pass |
