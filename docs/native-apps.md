# Native apps: iPhone, Android, Mac (Apple Silicon)

`apps/mobile` is a Capacitor 8 shell around the deployed web app. The UI, engine, queue, API and
storage are the web app's; only **playback** is native, because a web view can't keep audio and
lock-screen controls working reliably in the background (see [ios-pwa-limitations.md](ios-pwa-limitations.md)).

| Platform | Player | System controls | Background |
|---|---|---|---|
| iPhone / iPad | AVQueuePlayer, `AVAudioSession(.playback)` | `MPRemoteCommandCenter`, `MPNowPlayingInfoCenter` | `UIBackgroundModes = audio` |
| Android 7+ | Media3 ExoPlayer in a `MediaSessionService` | media notification, lock screen, Bluetooth / headset | foreground service (`mediaPlayback`) |
| Mac with Apple Silicon (M1/M2/…) | the iPhone/iPad app, run as "Designed for iPad" | Now Playing in Control Center, media keys | as iPad |

Status (2026-10-18): **Android builds** — `assembleDebug` succeeds and `lintDebug` reports no
errors (JDK 21, SDK platform 36, Media3 1.10.1). **iOS / Mac not compiled yet** — the Swift was
only syntax-checked (no Xcode on the build machine). Neither has been run on a device.

## How it fits together

```
WebView (the deployed site)                     Native (apps/mobile)
  PlayerEngine ── deps.audio ────────► NativeAudioElement ─┐
               └─ deps.mediaSession ─► NativeMediaSession ─┤  Capacitor bridge "ZunoAudio"
  queueNextNatively → setNext ─────────────────────────────┘  ├─ iOS: ZunoAudioPlugin.swift
                                                              └─ Android: ZunoAudioPlugin.java + PlaybackService.java
```

- JS side: [packages/player/src/native.ts](../packages/player/src/native.ts) (contract in its
  header, tests in `packages/player/test/native.test.ts`) and [apps/web/src/lib/native.ts](../apps/web/src/lib/native.ts).
  [player.tsx](../apps/web/src/lib/player.tsx) picks native when `Capacitor.isNativePlatform()`;
  browsers are unchanged.
- Native carries out play, pause, seek, ⏭ (when the next track is queued) and ⏮-restart itself,
  then tells the page, so they work while the page's JavaScript is suspended. The page queues the
  next track as soon as it's known (`setNext`), so a song ending moves on natively too.
- Settings → Playback diagnostics shows "Playback engine: native app (…)" and logs every system
  command, marked `native` or `page` by who carried it out.

## One-time setup

1. **An HTTPS address for the web app.** The apps load it at start. Deploy as usual
   ([operations-runbook.md](operations-runbook.md)), or for testing tunnel your dev server:
   `pnpm infra:up`, `pnpm dev`, then `cloudflared tunnel --url http://localhost:3000`
   (`*.trycloudflare.com` is already allowed in `next.config.ts`). A tunnel address changes each
   run; re-sync when it does.
2. Copy `apps/mobile/.env.example` to `apps/mobile/.env` and set `ZUNO_APP_URL`.
3. `pnpm install`, then `pnpm --filter @zuno/mobile sync` (copies the config into both projects;
   run it again whenever `.env` or `capacitor.config.ts` changes).

## iPhone / iPad

Needs a Mac with **Xcode** (App Store) and an Apple ID.

1. `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`, open Xcode once so it
   installs the iOS platform.
2. `pnpm --filter @zuno/mobile open:ios`
3. App target → **Signing & Capabilities** → Team: your Apple ID (Xcode → Settings → Accounts to
   add it). If `com.zuno.music` is taken, change the Bundle Identifier (e.g. `com.<you>.neomusic`).
4. Connect the iPhone with a cable, trust the Mac, turn on **Settings → Privacy & Security →
   Developer Mode** (the phone restarts), pick it as the run destination, press ▶.
5. First launch: **Settings → General → VPN & Device Management** → trust your developer
   certificate.

With a free Apple ID the install expires after **7 days** (run ▶ again). A paid Apple Developer
account ($99/year) gives 1-year installs and TestFlight.

## Mac with Apple Silicon (M2)

Same Xcode project, no extra code: choose **My Mac (Designed for iPad)** as the run destination
and press ▶. The app appears in Applications/Launchpad. Signing is the same as for the iPhone.

(Alternative without Xcode: the website itself works well in a desktop browser, and Safari →
File → Add to Dock / Chrome → Install installs it as an app. Desktop browsers keep background
audio running, so the native player isn't needed there.)

## Android

Needs **Android Studio** (it bundles the right JDK and SDK), or for the command line a **JDK 21**
and the Android SDK. Gradle 8.14, which Capacitor 8 uses, doesn't run on JDK 25; JDK 25 can stay
your default:

```bash
brew install openjdk@21 && brew install --cask android-commandlinetools
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
sdkmanager --licenses && sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools"
echo "sdk.dir=$ANDROID_HOME" > apps/mobile/android/local.properties   # git-ignored
```

1. `pnpm --filter @zuno/mobile open:android` and let Gradle sync finish.
2. On the phone: Settings → About phone → tap **Build number** 7× → Developer options → **USB
   debugging** on. Connect it, accept the prompt, pick it in Android Studio, press ▶.
3. Or build an installable file: Build → Build App Bundle(s) / APK(s) → Build APK(s), or
   `cd apps/mobile/android && JAVA_HOME=$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home ./gradlew assembleDebug`
   → `app/build/outputs/apk/debug/app-debug.apk`. With a phone connected over USB:
   `$ANDROID_HOME/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk`.
   Copy it to the phone and open it (allow "Install unknown apps" for the file manager).

## Check on each device

- [ ] Play an album, lock the screen: audio continues; lock screen shows title, artist, artwork.
- [ ] Lock-screen ⏸ / ▶, also after a 10-minute pause.
- [ ] Songs advance on their own with the screen locked for 30+ minutes.
- [ ] Lock-screen ⏭ / ⏮, scrubbing the progress bar.
- [ ] Phone call / Siri / Assistant interrupts and playback resumes; headphones out pauses.
- [ ] Kill and reopen the app: queue restored, paused at the same spot.
- [ ] Settings → Playback diagnostics: "Playback engine: native app (…)".

## Limits

- **Store release is not possible as-is.** The default music provider is YouTube's unofficial
  API — personal use only ([music-licensing.md](music-licensing.md)); App Store and Google Play
  would reject it. Install on your own devices as above.
- The UI needs the network (it is loaded from `ZUNO_APP_URL`). The service worker's offline page
  isn't wired up in the iOS app yet (needs `WKAppBoundDomains` for the app's domain).
- If the page stays suspended through more than one whole song, native plays only the one track
  it was given next, then stops until the app runs again.
