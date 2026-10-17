# Mobile feature audit (phones, < 768 px)

Date: 2026-10-17. Scope: the phone layout only. Tablet (768–1023 px) and desktop keep the sidebar and the full-width player bar, and are unchanged. The desktop and tablet golden screenshots were compared before and after (12/12 identical).

Before and after screenshots: `docs/screenshots/before/` and `docs/screenshots/after/`, at 390×844 (iPhone-like) and 320×640 (narrow). Regenerate them with `CAPTURE=<label> npx playwright test e2e/capture.spec.ts`.

## What existed before

| Area | Before | Gap |
|---|---|---|
| Breakpoints | Tailwind `md` = 768 px splits phone vs tablet/desktop; `lg` = 1024 px splits tablet vs desktop | — |
| Tab bar | `BottomNav`: 3 tabs (Home, Explore, Library), full-width strip at the bottom | No Search tab (search was hidden behind a header icon); no scroll memory; re-tapping a tab did nothing |
| Mini-player | Flat strip inside `PlayerBar` (`md:hidden`) with like, play/pause and next | Not attached to the full player; no gestures; like button crowded the strip |
| Full player | `NowPlaying`: a Radix dialog shared with desktop, with tabs Song / Up next / Lyrics; swipe-down via raw touch events (90 px) | No finger tracking, no state machine, no track swipes, no velocity, and could not tell scrolling from dismissing |
| Queue | dnd-kit list: long-press handle to reorder, × to remove | No swipe-to-remove |
| Lyrics | Synced with a rAF clock; a 4 s hold after manual scroll | Silent snap-back after the hold; no way to jump back |
| Action menus | Radix dropdown (desktop-style) on every screen size | Tiny targets on phones; no sheet |
| Playback | One `PlayerEngine` + one `<audio>`, Media Session, persisted queue | Kept as is (see below) |
| PWA | Manifest, service worker (shell only), safe-area variables, `dvh` | Kept; toast offset was a fixed 140 px (overlapped the mini-player on notched iPhones) |
| Explore | No page title on phones; three category buttons stacked as full-width rows | Fixed |
| CSP | `img-src` blocked `music.youtube.com/image/mixart` (blank quick-pick covers) | Fixed (affects all sizes, bug fix) |

## Playback ownership (unchanged, verified)

- **State owner:** `PlayerEngine` (packages/player) behind `usePlayerEngine()` and the `usePlayer` store.
- **Audio element:** a single `<audio>`, created once. Tests assert `document.querySelectorAll("audio").length === 1` after every tab change and gesture.
- **Queue:** an immutable `Queue` inside the engine. The UI only calls `jumpTo`, `moveInQueue`, `removeFromQueue`, `next` and `previous`.
- **Media Session:** registered by the engine and unaffected by any UI.
- **The mobile player owns no audio.** Opening, dragging or closing it only changes what is visible. The one engine change is `previous({ restart: false })`, so swipes always change track. Buttons and media keys keep the "restart if past 3 s" rule.
