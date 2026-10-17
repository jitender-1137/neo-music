# Mobile test matrix

Results from 2026-10-17. **Environment:** Chromium with iPhone 13 emulation (390×664, touch, mobile UA). Gestures are real touch events sent through the DevTools protocol, so `touch-action` and pointer handling are exercised. Audio is the dev-tone catalog playing through a real `<audio>` element. **Not covered:** a real iPhone, the iOS Simulator (Xcode isn't installed here) and the WebKit engine (see "Not verified").

Run: `npx playwright test e2e/mobile.spec.ts --project=mobile-safari-like`. Phone tests are tagged `@mobile` and excluded from the desktop project.

| # | Acceptance item | Test | Result |
|---|---|---|---|
| 1 | Mobile home opens | every-page test (`/`) | ✅ |
| 2 | Start playback | `startAlbum` (audio not paused) | ✅ |
| 3 | Mini-player appears, sits above the tab bar without overlap | tab bar test (bounding boxes) | ✅ |
| 4–5 | Change tabs; playback continues, same `src`, one `<audio>` | tab bar test | ✅ |
| — | Re-tap scrolls to top; tab remembers scroll | tab scroll test | ✅ |
| 6 | Swipe up opens (finger-driven) | two-way swipe test | ✅ |
| 7 | Swipe down minimises; still playing; chrome no longer inert | two-way swipe test | ✅ |
| — | Small or slow-short moves don't navigate; jitter is a tap | small-movement test | ✅ |
| — | Horizontal swipe changes track (mini and artwork, both directions) | horizontal test | ✅ |
| 8–9 | Open lyrics, return to player | panels test | ✅ |
| 10 | Open queue | panels test | ✅ |
| 11 | Reorder a track | `guest.spec` keyboard reorder (dnd-kit); swipe-to-remove in the panels test | ✅ |
| — | Vertical scroll inside the panel never closes it | panels test | ✅ |
| — | Header swipes switch tab and close the panel; Escape order | panels test | ✅ |
| 12–13 | Change track; artwork and metadata update | controls test, horizontal test | ✅ |
| 14–15 | Action sheet opens and closes without interrupting playback | controls test, action-sheet test | ✅ |
| — | Play next, swipe-to-dismiss, Song details navigates and closes the sheet | action-sheet test | ✅ |
| — | Every full-player control: shuffle, repeat ×3, like/unlike, prev/next, play/pause, seek, ⋯, minimise, focus | controls test | ✅ |
| — | Rapid taps and flicks: one sheet, never wedged; route change closes it | rapid test | ✅ |
| 16 | Refresh restores the queue, paused, on the saved track | refresh test | ✅ |
| 17 | Narrow viewport: 17 routes at 320 and 390 px, no sideways scroll | every-page tests | ✅ |
| 18 | Reduced motion | reduced-motion test | ✅ |
| 19 | Unavailable artwork shows a placeholder | missing-artwork test | ✅ |
| 20 | Network failure shows a retryable error; retry recovers | network test | ✅ |
| 21 | Desktop baseline unchanged | `visual.spec` desktop + tablet goldens (12/12 before updating any phone golden) | ✅ |
| — | Album, artist, library tabs and search filters on phone | page-button tests | ✅ |

Unit tests (`src/lib/gesture.test.ts`, 21): axis lock, slop, commit/flick/cancel rules, velocity window, rubber band, and every state-machine transition (idempotent open, cancel paths, panel rules, close from any state). The player package adds a test for `previous({ restart: false })`.

## Not verified (environment limits)

- **Real iPhone or iOS Simulator:** Safari, the installed PWA, the lock screen and headset controls, background audio, suspend/resume, and real safe-area insets. Xcode isn't installed (only the Command Line Tools), and there's no HTTPS tunnel to a device. The manual checklist is in [ios-pwa-limitations.md](ios-pwa-limitations.md).
- **WebKit engine:** Playwright's WebKit build isn't installed. Everything above ran in Chromium with emulation.
- **Landscape on a real device:** the layout uses container-query sizing so the artwork shrinks in short viewports. That is checked visually in emulation only.
