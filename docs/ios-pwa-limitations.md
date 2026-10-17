# iOS Safari & PWA: behaviour and limitations

For reliable background playback and lock-screen controls, use the native app instead
([native-apps.md](native-apps.md)); this page covers the browser / Home Screen version.

**None of this has been verified on a real iPhone/iPad yet** (no Apple hardware in the build
environment). Desktop Chromium and iPhone-sized emulation were tested; the checklist in
[testing-strategy.md](testing-strategy.md#manual-only-checklist-needs-real-devices) must be run on devices.

## What we do
- **Native media path only.** One persistent `<audio playsinline>`; no Web Audio graph, no timers
  to keep JS alive. When iOS suspends the page, the media element keeps playing on its own.
- **Gesture-safe start.** Stream URLs are built synchronously (device token) so `play()` runs
  inside the tap. If the token isn't ready, 50 ms of silence plays inside the gesture and the real
  source is swapped in on the same, now-unlocked element.
- **Audio Session API**: `navigator.audioSession.type = "playback"` (Safari 17+) — declares the
  page as a music player so audio continues with the screen locked and ignores the silent switch.
- **Resync on return**: on `visibilitychange`/`pageshow` the engine reconciles its state with the
  media element (the OS may have paused audio for a call while JS was suspended).
- **Install**: Chromium shows an "Install" button (held `beforeinstallprompt`); iOS Safari shows a
  Share → Add to Home Screen guide. Verified on a production build: Chrome reports **no
  installability errors**, the service worker activates, offline navigation shows `/offline`
  (`apps/web/e2e/pwa-check.mjs`). Installing requires **HTTPS** (or localhost) — a phone on
  `http://<LAN-IP>` cannot install the PWA or register the service worker.
- **AAC (itag 140) for Safari** — Safari's `<audio>` can't be relied on for Opus/WebM.
- **Media Session**: title, artist, album, artwork (96–512 px), play/pause/stop/prev/next/seekto/
  ±10 s; position state is pushed at most once per second.
- **Autoplay across tracks** happens on the `ended` event of the already-playing element — the
  same element, so iOS allows it while backgrounded (it continues an active media session).
- **Restore**: queue + position are restored *paused* after reload/relaunch (iOS forbids
  autoplay without a gesture; we never fake one).
- **Layout**: `viewport-fit=cover`, safe-area CSS variables for the top bar, mini player, tab bar
  and Now Playing; `dvh` units; 16 px inputs (no focus zoom); pinch-zoom is not disabled.
- **Service worker** caches only the offline page, icons and hashed build assets — never `/api`,
  audio or HTML.

## Known platform limits
| Behaviour | Safari (tab) | Installed PWA (iOS) | Android Chrome | Desktop |
|---|---|---|---|---|
| Background playback with screen locked | usually continues; may stop after long idle | usually continues | continues (media notification) | continues |
| Lock-screen metadata & buttons | yes (Media Session) | yes | yes | OS media keys / overlays |
| Continue to next track while locked | expected via `ended` on same element | expected | yes | yes |
| Resume after phone call | iOS may leave audio paused; user taps play | same | usually auto | n/a |
| JS timers while backgrounded | suspended | suspended | throttled | throttled |
| Listening-event upload while backgrounded | deferred until the page wakes (events persist in IndexedDB) | same | mostly live | live |
| Autoplay on launch | never (requires tap) | never | never | never |
| Storage eviction | IndexedDB may be evicted after ~7 days without use (guest library!) | PWA storage is more durable | durable | durable |

Practical consequence: guests on iOS Safari should sign in if they care about keeping their
library — the app says so on the Library page.

## Phone player and gestures (added 2026-10-17)

- Gestures use Pointer Events (Safari 13+), with `touch-action` set per surface rather than global `preventDefault`. Page scroll, pinch-zoom and Safari's edge back-swipe are left alone: gestures never start within 18 px of a side edge.
- Heights come from `fixed; inset: 0` plus `env(safe-area-inset-*)` and container-query units. Nothing hardcodes a screen height, so the layout keeps working as Safari's toolbar shows and hides.
- The player is a view over the single `<audio>` element and engine. Opening or closing it never creates or reloads audio, so Media Session and lock-screen controls are unaffected.
- We do **not** claim JavaScript keeps running in the background on iOS. Audio continues through the browser's media path while the OS allows it, and nothing uses timers, hidden frames or service-worker tricks to stay alive.

### Still to check on a real iPhone (manual)
- [ ] Swipe up/down on the mini-player and player feels attached to the finger, with no rubber-banding of the page behind.
- [ ] Horizontal artwork swipes don't trigger Safari's back gesture (start away from the edges).
- [ ] The tab bar and mini-player sit above the home indicator in Safari and in the installed PWA.
- [ ] Lock-screen and Control Center play/pause/next/previous work while the full player is open and closed.
- [ ] Rotate to landscape with the player open: the artwork shrinks and the controls stay reachable.
- [ ] Lock screen and Control Center show the song title, artist and cover with ⏮ ⏯ ⏭ (not ±10 s) and a scrubber that follows seeks; AirPods double/triple-press skips tracks.
- [ ] The status bar takes the song's colour while the player is open (Safari; in the installed PWA it follows `apple-mobile-web-app-status-bar-style`).
- [ ] Pinch and double-tap don't zoom, and focusing the search field doesn't zoom.

## Lock screen, volume and duration fixes (2026-10-17, later)

- **Play after pause from the lock screen.** iOS closes a paused stream's idle connection in the background. The player used to reload the source right away, in the background, and iOS then refused to start that reloaded source when ▶ was pressed. Now a dropped connection while paused only marks the source as stale, and the next play (lock screen, Control Center, headphones or a tap) reloads and plays in the same call, which iOS allows. If the OS pauses the audio itself, the next play tap is no longer read as a second pause.
- **Volume on iPhone/iPad.** Web pages can't change the level: Apple makes it hardware-only, and newer iOS accepts the value and ignores it. The row shows a working mute button plus "Use the side buttons" instead of a slider that moves with no effect. Web Audio can't be used to fake a level, because it stops playback on the lock screen. Android and desktop keep a real (app-level) slider; no website can change the phone's system volume.
- **Wrong duration (≈2×) on iPhone.** Safari misreads HE-AAC streams. The server now gives Safari AAC-LC, and the player uses the catalogue length whenever the browser's figure disagrees by more than a few seconds (in the app and on the lock screen), and listens for `durationchange`.
- **Faster starts.** Stream lookups are cached in Redis (`stream:v2:*`) as well as in memory. The next song is pre-resolved and its first 256 KB fetched while the current one plays. No audio is stored for offline use (YouTube's terms).
- **Silent resume after a long pause (lock screen / notification ▶).** iOS freezes a paused web app and closes its idle stream. On ▶, WebKit resumes the element without reopening the connection: the clock runs, but there's no sound until a seek. The player now (1) re-seeks to the current position on resume after more than 10 s, in the play command itself and also when iOS resumes the element natively (`play` event); (2) runs a stall watchdog (no progress after 4 s → re-seek; still stuck → reload at the same position); (3) heals on returning to the app.
- **Playback diagnostics** (Settings): an on-device log of commands, audio events, page hide/show/freeze and healing steps, for diagnosing real-device issues. Never uploaded.

## Home Screen app: ▶ from the lock screen after a pause (device-tested 2026-10-17)

- **Result:** works in a Safari tab, fails in the Home Screen app on the same iPhone.
  - In the Home Screen app, the ▶ command arrives (`command:play hidden`) and the element fires `play`/`playing` with all data loaded. But its clock doesn't move and nothing is heard until the app is opened.
  - The stall watchdog then restores sound within about 1.5 s of the app becoming visible.
- **Not the cause** (each ruled out by device logs):
  - command delivery;
  - the network connection (it fails from a whole song held in memory);
  - pause length (3 s is enough).
- **Correction to the section above:** "Silent resume after a long pause" described the re-seek on resume as the fix. Device logs show the re-seek doesn't help in the Home Screen app.
- **What the logs show:** iOS lets a Home Screen web app *continue* audio in the background, but not *restart* it after a real pause. Safari, a native app, can.
- **Tried and reverted** (at the user's request):
  - keeping a whole-song copy in memory, which didn't help;
  - keeping the element running muted while "paused", which avoided the block but meant the song never really stopped.
- **Options:**
  - open the Home Screen icon in Safari instead of standalone;
  - wrap the app natively (`AVAudioSession` + `MPRemoteCommandCenter`);
  - accept that ▶ after a background pause needs the app to be opened.
- **Related public WebKit reports** (status not re-checked on the latest iOS):
  - [198277](https://bugs.webkit.org/show_bug.cgi?id=198277): standalone web-app audio stops on leaving the app or pulling down Notification Centre, and doesn't resume.
  - [261858](https://bugs.webkit.org/show_bug.cgi?id=261858): standalone web-app media controls stop working in the background.
  - No report exactly matching "resume after a Notification Centre pause" was confirmed by search.

## What the app does about it now (2026-10-18)

- **Home Screen app only:** "playing" counts only once the clock moves. If a resume freezes, the player reloads the song once at the same spot. If it's still frozen, it stops honestly: paused, with "Paused in the background. Tap play to continue." in the app, and "Open the app to resume" on the lock screen's artist line until the next play.
- **Saving:** the session is saved immediately when the app is hidden or closed.
- **Diagnostics log:** records every `play()` result, page lifecycle events (focus/blur/freeze/resume), src / currentSrc (without the token), readyState, networkState, duration, ended, the Media Session state and the display mode. Settings → Playback diagnostics → Copy.
