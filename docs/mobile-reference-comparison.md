# Mobile reference comparison: YouTube Music, Apple Music, YouTube

Research cutoff: **2026-10-17**. Every feature below comes from public documentation: official blogs, newsrooms, help centres and App Store listings, plus a few press reports that are labelled as press. **We did not use the apps on a device.** Where only press coverage or nothing at all backs a claim, it is marked *unverified* or *press*.

Neo Music context: a Next.js website + PWA. Audio comes from YouTube Music through youtubei.js on our server, and lyrics from lrclib or YouTube. We have no licensed catalog and no AI/LLM provider.

Official references fetched:

| Ref | URL | Loaded? |
|---|---|---|
| G1 | https://blog.google/intl/en-in/products/platforms/press-play-on-these-new-youtube-music-updates/ | Yes (23 Sep 2026) |
| Y1 | https://blog.youtube/news-and-events/made-on-youtube-music-new-discovery-features/ | Yes (23 Sep 2026) |
| Y2 | https://blog.youtube/news-and-events/youtube-music-ai-labels/ | Yes (14 Oct 2026) |
| A1 | https://www.apple.com/in/newsroom/2026/06/apple-unveils-innovative-features-and-intelligence-experiences-across-services/ | Yes (9 Jun 2026) |
| A2 | https://apps.apple.com/in/app/apple-music/id1108187390?platform=iphone | Partly. Description loaded; no "What's New" or version notes were visible |
| Y3 | https://blog.youtube/news-and-events/youtube-news-google-io-2026/ | Yes (19 May 2026). No music features in it |
| G2 | https://blog.google/products-and-platforms/products/youtube/made-on-youtube-updates-2026/ | Yes (23 Sep 2026). Brief; no status or region given |

Additional sources:
- **A3:** Apple iPhone User Guide, "Use the music player controls" (iOS 27 default): https://support.apple.com/en-us/guide/iphone/iph676daac9b/ios
- **A4:** Apple iPhone User Guide, "Queue up your music": https://support.apple.com/en-us/guide/iphone/ipha4521ef7d/ios
- **A5:** Apple Support, "See lyrics": https://support.apple.com/en-us/105076
- **A6:** Apple Music for Artists, iOS 26: https://artists.apple.com/support/5550-ios-26-whats-new
- **A7:** Apple Newsroom, June 2025: https://www.apple.com/newsroom/2025/06/apple-services-deliver-powerful-features-and-intelligent-updates-to-users-this-fall/
- **A8:** Apple Support, Replay: https://support.apple.com/en-us/109356
- **A9:** WWDC25, Build a SwiftUI app with the new design: https://developer.apple.com/videos/play/wwdc2025/323/
- **H1:** YouTube Music Help, background play: https://support.google.com/youtubemusic/answer/6313552
- **H2:** YouTube Music Help, Customize: https://support.google.com/youtubemusic/answer/6313542
- **H3:** YouTube Music Help, Samples: https://support.google.com/youtubemusic/answer/13468882
- **H4:** YouTube Music Help, song credits: https://support.google.com/youtubemusic/answer/13420518
- **P1–P6 (press):**
  - P1: https://www.xda-developers.com/youtube-music-swipe-album-art-change-songs/ (Jun 2020)
  - P2: https://9to5google.com/2023/05/10/youtube-music-miniplayer-redesign/
  - P3: https://9to5google.com/2023/06/29/new-youtube-music-miniplayer/
  - P4: https://9to5google.com/?p=624079 (Jun 2024)
  - P5: https://www.androidheadlines.com/2025/09/youtube-music-just-gave-its-now-playing-screen-a-big-redesign.html
  - P6: https://9to5google.com/2025/12/20/youtube-music-2025-now-playing-redesign/

How to read the tables:
- **Status** is the state of the reference product.
- **Applicable?** says whether Neo Music can do it: Y, N, or Partial.
- **Complexity** is S/M/L. **Priority** is P0 (must have) to P3.

## 1. YouTube Music (mobile)

| Feature | What it does | Status | Applicable? | Needs | Cx | Pri | Acceptance test |
|---|---|---|---|---|---|---|---|
| Home feed / mixes | Personalised shelves and auto-generated mixes. The exact shelf set is *unverified* in docs | released | Y | backend (youtubei home browse) | M | P0 | Home shows ≥3 shelves from the YTM home browse within 2 s on 4G |
| Explore | New releases, charts, moods/genres. Exact layout is *unverified* | released | Y | backend (explore browse) | M | P1 | Explore lists new releases + charts + moods, and each opens a detail page |
| Search suggestions | Type-ahead query suggestions. *Unverified* in help docs | released | Y | backend (search suggestions endpoint) | S | P0 | Typing "arij" shows suggestions within 300 ms of debounce |
| Song / album / artist / playlist pages | Entity pages with play, shuffle, and a track list | released | Y | backend | M | P0 | Each page type renders header + tracks, and Play starts track 1 |
| Song credits | Writers and producers, only when the label provides them (H4) | released (metadata-dependent) | Partial | catalog data, if exposed by youtubei | S | P3 | Credits show only when present; hidden otherwise |
| Now Playing | Artwork, title, controls, carousel of actions. Redesign: Like/dislike, save, share, lyrics and radio sit under the progress bar; Up Next sits behind a drag handle (P5, P6) | released; redesign A/B since Nov 2024 (P6) | Y | — | M | P0 | Full player shows artwork, scrubber, prev/play/next, like and menu |
| Mini-player | Persistent bar above the nav. Tap or swipe up opens the player; swipe L/R changes track (P2, P3) | released | Y | — | M | P0 | Mini-player persists across routes and tap opens the full player |
| Queue / Up Next | Upcoming list, named after the playing playlist/mix in the redesign (P6). Reorder and remove | released | Y | — | M | P0 | Drag reorders, remove works, and the queue survives reload |
| Dismiss queue | Overflow item that clears the queue and closes the player (replaced swipe-down; P3) | released (press) | Y | — | S | P2 | "Clear queue" stops playback and hides the mini-player |
| Lyrics | Lyrics tab, or a carousel button in the redesign. Translate button follows device language (H2; help page ~2023) | released | Y | lrclib / YouTube lyrics | M | P0 | Synced lyrics highlight the current line; tapping a line seeks (our extension) |
| Lyrics translation | Translate lyrics to the device language (H2) | released | N (no translation provider) | translation API | M | P3 | — |
| Radio / start mix | "Start radio" from any song (carousel and menu; H3, P5) | released | Y | backend (watch-next / radio playlist) | S | P0 | "Start radio" fills the queue with ≥20 related tracks |
| Related | Related tab; in the redesign, reached by tapping the song title (P5, P6) | released | Y | backend (watch-next related) | S | P1 | Related view lists ≥5 items for a popular song |
| Likes / Library | Liked Music pinned at the top of Library; library holds playlists, songs, albums, artists, podcasts (H2) | released | Y | our DB (local likes); YT account sync not planned | M | P0 | Like adds to the Liked list and persists per user |
| History | Listening history with a per-item remove option (H2) | released | Y | our DB | S | P1 | Played tracks appear newest-first and one can be removed |
| Context menus | Play next, add to queue, save to playlist, go to album/artist, start mix, share (H3) | released | Y | — | M | P0 | Long-press or ⋯ on any row opens the menu with these actions |
| Samples | Vertical feed of short clips. Swipe down = next, swipe up = previous (H3) | released | Partial (needs video clips) | video playback, data | L | P3 | — |
| Ask Music | Conversational search across 300M+ songs and podcasts; tweaks the queue (G1, Y1, G2) | announced / "coming soon", worldwide, Music & Premium | N | LLM provider | L | — | — |
| Podcast Lineup | Weekly AI-voiced podcast preview guide (G1, Y1) | announced / "coming soon", subscription | N | LLM + TTS, podcasts | L | — | — |
| AI-generated music labels | Label on the player page for mostly-AI tracks; tap for details. Based on detection + partners (Y2) | rolling out from 14 Oct 2026 | Partial (only if youtubei exposes the label) | provider metadata | S | P2 | If the source response carries the label, show a badge; never infer it ourselves |
| Background playback | Screen-off / other-app playback (H1) | subscription (Premium) | Partial | browser capability (Media Session; iOS PWA limits) | M | P0 | Audio continues with the screen locked on Android Chrome; lock-screen controls work |

## 2. Apple Music (iOS 26 / 27 era)

| Feature | What it does | Status | Applicable? | Needs | Cx | Pri | Acceptance test |
|---|---|---|---|---|---|---|---|
| Tab bar | Bottom tabs (Home etc.). iOS 26 Liquid Glass tab bar can shrink on scroll (A9). Exact Music tab names are *unverified* here | released | Y | — | S | P0 | Bottom nav with ≤5 tabs; active tab highlighted |
| Mini-player above tab bar | MiniPlayer docks above the tab bar. The iOS 26 bottom-accessory pattern goes inline when the bar minimises (A9; that Music uses exactly this API is *unverified*) | released | Y | — | M | P0 | Mini-player sits above the nav and never overlaps content (safe-area aware) |
| Artwork-led Now Playing | Large art, scrubber, volume, artist link → album/artist (A3) | released | Y | — | M | P0 | Tapping the artist name offers artist/album navigation |
| Context menus | Touch-and-hold: Play Next, Play After / Add to Queue (A4) | released | Y | — | S | P0 | Long-press shows Play Next and Add to Queue |
| Queue | Reorder by drag, swipe-left to remove, Clear, Add Songs, count at bottom, history by swiping down in the queue (A4) | released | Y | — | M | P0 | Swipe-left on a queue row reveals Remove; Clear empties the queue |
| AutoPlay | Appends similar songs to the end of the queue; toggle at the top of the queue (A4) | subscription | Y | backend (radio) | S | P1 | With AutoPlay on, the queue extends before it runs out |
| Lyrics | Time-synced lyrics with a full-text fallback; Lyrics button in the player (A5) | subscription | Y | lrclib | M | P0 | Plain lyrics fall back when synced lyrics are missing |
| Lyrics translation & pronunciation | Show translation / pronunciation / hide original (A5). +7 translation and +5 pronunciation pairs announced (A1) | released (iOS 26); new pairs announced Jun 2026 for fall | N (no provider); romanisation only if lrclib supplies it | translation data | M | P3 | — |
| AutoMix / Crossfade | DJ-style beat-matched transitions; toggle in the queue (A4, A6, A7) | released; extended to tvOS/HomePod per A1 | Partial (simple crossfade only) | Web Audio, two media elements | L | P3 | Optional 0–6 s crossfade with no gap on Android Chrome |
| Pinned library items | Pin songs/albums/playlists to the top of Library (A7) | released (iOS 26) | Y | our DB | S | P2 | A pinned item stays first in Library after reload |
| Replay | Top songs/artists/albums and a mix; card on Home (A8) | released; needs listening history on | Y (from our own history) | our DB | M | P2 | Replay page shows top 10 tracks for the period from local history |
| Animated artwork | Artist-designed motion art; setting under Animated Art (A3) | released | N | catalog assets | — | — | — |
| Lossless / Hi-Res / Spatial | Quality tiers; Hi-Res on tvOS announced (A1, A2) | subscription; hardware-limited | N | licensing + source | — | — | — |
| Sing | Vocal reduction; iPhone as Apple TV mic (A2, A6) | released | N | stem separation | — | — | — |

## 3. YouTube (mobile) discovery patterns relevant to music

| Feature | What it does | Status | Applicable? | Needs | Cx | Pri | Acceptance test |
|---|---|---|---|---|---|---|---|
| Ask YouTube (conversational search) | Multi-part questions with follow-ups; returns structured video/Shorts answers (Y3, G2) | US Premium 18+ via youtube.com/new; wider rollout "soon" (May 2026) | N | LLM provider | L | — | — |
| Search refinements | Filter chips (songs/videos/albums/artists/playlists). Exact chip set is *unverified* | released (*unverified* docs) | Y | backend search params | S | P0 | Chips filter results by type without a full page reload |
| Personalised / mood feeds | Mood-based custom home feed announced (G2) | announced, no date or region | Partial (mood chips from YTM home "moods") | backend | M | P2 | Selecting a mood chip reloads home shelves for that mood |
| Contextual menus | ⋯ menus on every row (same pattern as YTM) | released | Y | — | S | P0 | Same as the YTM context menu test |

## Gesture mapping of the reference player

**YouTube Music.** Official help pages do not document the player swipe gestures; every row below comes from press reports.

| Gesture | Behaviour | Source / confidence |
|---|---|---|
| Swipe L/R on mini-player | Left = next track, right = previous | P2, P3 (2023). Rolled out on Android first; reported widely |
| Swipe up on mini-player | Opens the full player | Androidcentral headline and search summary only. **Unverified.** Tap-to-open is certain |
| Swipe down on mini-player | **Removed** in 2023. It used to dismiss and clear the queue; replaced by "Dismiss queue" in the overflow menu | P2, P3 |
| Swipe down on full player | Minimises to the mini-player | **Unverified.** Common sheet behaviour, but no source found |
| Swipe L/R on Now Playing artwork | Next / previous track | P1 (Android, Jun 2020, staged); P4 (iOS v7.04, Jun 2024) |
| Bottom tabs Up next / Lyrics / Related | Classic layout: three tabs at the bottom of the player sheet; tap or drag up to expand. In 2020, swiping between these tabs was *not* supported (search summary of P1-era coverage; unverified) | Classic layout is long-standing; precise drag behaviour is *unverified* |
| Redesign (A/B since Nov 2024) | One bottom handle, named after the current playlist/mix; tap or slide up opens Up Next. Lyrics moved into the action carousel; Related opens by tapping the song title | P5 (Sep 2025), P6 (Dec 2025): "not yet widely rolled out". Current 2026 state is **unverified** |
| Samples feed | Swipe down = next sample, swipe up = previous | H3 (official) |

**Apple Music.** Official sources are A3 (iOS 27 guide) and A4.

| Gesture | Behaviour | Source / confidence |
|---|---|---|
| Swipe L/R across the **track title** (MiniPlayer or Now Playing) | Next / previous track | A3, official. Note: on the title, not the artwork |
| Tap MiniPlayer | Opens Now Playing | A3, A4 |
| Swipe down on Now Playing | Dismisses to the MiniPlayer | **Unverified.** Not in Apple's guide |
| Drag playhead / volume slider | Scrub / volume | A3 |
| Queue: drag handle | Reorder | A4 |
| Queue: swipe left on a row | Reveals the remove button | A4 |
| Queue: swipe down | Shows playing history above the queue | A4 |
| Lyrics: touch and hold a verse | Opens the share/report sheet | A5 |
| Lyrics: tap a line to seek | Not stated in A5. **Unverified** for iOS 26/27 docs |

**Suggested Neo Music mapping**, consistent with both references:
- Tap or swipe up on the mini-player expands it; swipe down on the full player collapses it.
- Swipe L/R on the mini-player and on the artwork changes track.
- A bottom sheet in the full player holds Up next / Lyrics / Related tabs.
- In the queue, drag reorders and swipe-left removes.
- Do not bind swipe-down on the mini-player (YouTube Music removed it).

Respect `prefers-reduced-motion` and keep button equivalents for every gesture.

## Not applicable / blocked

| Item | Reason |
|---|---|
| Lossless, Hi-Res, Spatial / Dolby Atmos | Needs licensed masters and DRM delivery. Our source is YouTube streams (lossy); claiming these would mislead |
| Animated artwork | Artist-supplied motion assets exist only in Apple's catalog |
| AI-generated music labels (own inference) | YouTube labels come from its detection plus partner data (Y2). We may only show a label youtubei actually exposes; never guess |
| Ask Music / Ask YouTube | Needs an LLM provider; Neo Music has no AI service by design |
| Podcast Lineup | Needs AI-generated voice summaries and a podcast catalog; also subscription-only and "coming soon" (G1, Y1) |
| Lyrics translation / pronunciation | Needs a translation provider or licensed lyric data. We can show romanised text only if lrclib provides it |
| AutoMix (beat-matched) | Needs audio analysis; at most a simple crossfade is feasible (and limited on iOS PWA) |
| Offline downloads | Caching YouTube streams for offline use would breach YouTube's ToS and has no licence; iOS PWA storage is also limited |
| Sing / vocal reduction | Needs stem separation (ML) |
| Background play parity on iOS PWA | Browser-limited; see `docs/ios-pwa-limitations.md`. Best effort via the Media Session API |
| Samples (video clip feed) | Possible in principle with video, but heavy bandwidth and scope; deferred (P3) |
| Account sync with real YouTube likes / history | Would require users' Google sign-in through youtubei; out of scope. We keep our own likes and history |
