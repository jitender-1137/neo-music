# Feature matrix

Status: `verified` = implemented + automated test passing · `implemented` = built, manually checked, no dedicated automated test · `partial` · `blocked` · `not_supported`.
iOS column: real-device verification has **not** been performed (no Apple hardware in this environment) — see [ios-pwa-limitations.md](ios-pwa-limitations.md).

| Feature | Guest | Signed in | Frontend | Backend | Provider dep. | Automated tests | Visual | iOS device | Status |
|---|---|---|---|---|---|---|---|---|---|
| Home (personalized + editorial) | ✅ on-device seeds | ✅ server signals | HomeView (SSR public feed) | `/recommendations/home`, `/home` | yes | api account.test, e2e guest | golden | not run | verified |
| Mood chips / home continuation | ✅ | ✅ | HomeView | `/home?chip`, `?continuation` | yes | live smoke | — | not run | implemented |
| Explore, charts, moods, new releases | ✅ | ✅ | ExploreView/BrowseView | `/explore`, `/browse/:id` | yes | e2e + live smoke | golden | not run | verified |
| Search (combobox, filters, paging, recent) | ✅ local | ✅ server | SearchBox, SearchView | `/search`, `/suggestions`, `/search/history` | yes | e2e, api | golden | not run | verified |
| Song page (lyrics, related) | ✅ | ✅ | SongView | `/tracks/:id`, `/related`, `/lyrics` | yes | api | — | not run | implemented |
| Album page | ✅ | ✅ | AlbumView | `/albums/:id` | yes | e2e, api | golden | not run | verified |
| Artist page | ✅ | ✅ | ArtistView | `/artists/:id` | yes | e2e a11y, api | — | not run | verified |
| Playlist page (+ generated mixes) | ✅ | ✅ | PlaylistView | `/playlists/:id` (RDAMVM mixes) | yes | live smoke | — | not run | implemented |
| Mini player / player bar | ✅ | ✅ | PlayerBar | — | — | e2e (desktop + mobile) | golden | not run | verified |
| Full Now Playing (queue/lyrics/related) | ✅ | ✅ | NowPlaying | — | — | e2e, a11y | golden | not run | verified |
| Queue (play next, add, remove, reorder, clear) | ✅ | ✅ | QueueList (dnd-kit: mouse/touch/keyboard) | — | — | player unit (31), e2e keyboard reorder | golden | not run | verified |
| Shuffle / repeat off·all·one | ✅ | ✅ | Controls | — | — | player unit | — | not run | verified |
| Radio / autoplay refill | ✅ | ✅ | engine.refill | `/recommendations/radio/:id` | yes | player unit, e2e | — | not run | verified |
| Background audio | ✅ | ✅ | native `<audio>` | — | — | — | — | **not run** | implemented (desktop verified manually) |
| Lock-screen / headset controls | ✅ | ✅ | Media Session adapter | — | — | player unit (handlers) | — | **not run** | implemented |
| Library: likes, albums, artists, saved playlists | ✅ IndexedDB | ✅ API | LibraryView | `/library/*` | snapshots | api, e2e | golden | not run | verified |
| History | ✅ local | ✅ API | HistoryView | `/history` | — | api, e2e | — | not run | verified |
| User playlists CRUD + reorder | ✅ local | ✅ API (versioned) | UserPlaylistView | `/me/playlists`, `/user-playlists/*` | — | api (incl. concurrency) | — | not run | verified |
| Accounts (register/login/logout/password/export/delete) | — | ✅ | AuthForm, AccountView | `/auth/*`, `/account/*` | — | api, e2e | golden | not run | verified |
| Guest → account migration | ✅ | ✅ | migrateGuestData | `/library/import` (idempotent) | — | api, e2e | — | not run | verified |
| Recommendations (hybrid) | ✅ seeds | ✅ | Home shelves | recommender + worker | partly | recs unit (12), api | — | — | verified (quality unmeasured — no data) |
| Not-interested feedback | — | ✅ | TrackMenu | `/recommendations/feedback` | — | — | — | — | implemented |
| Lyrics (synced + plain, frame-accurate, per-song ±0.5 s nudge) | ✅ | ✅ | LyricsView | LRCLIB, YouTube Music | external | provider unit, e2e lyrics-sync (lead 116–128 ms) | — | not run | verified |
| PWA install / offline shell | ✅ | ✅ | manifest, sw.js, InstallButton (Chromium prompt / iOS guide) | — | — | pwa-check.mjs: 0 installability errors, SW active, offline page | — | **not run** | verified (desktop Chrome) |
| Error recovery (retry, skip, offline) | ✅ | ✅ | engine error path | 403 re-resolve | — | player unit | — | not run | verified |
| Security (CSP, CSRF, rate limits, cookies) | ✅ | ✅ | headers | plugins | — | api tests | — | — | verified |
| Performance budgets | — | — | SSR, image sizing | caching | — | measured (see testing-strategy) | — | — | partial (mobile LCP ≈ budget) |
| Accessibility (WCAG A/AA automated) | ✅ | ✅ | all | — | — | axe e2e (11 pages) | — | — | verified (automated only) |
| Import (files, paste, YouTube/Deezer/Spotify links) | ✅ | ✅ | /import wizard, client-side parsers | /import/link, /import/match (matcher) | — | parser + matcher + route tests | import.spec (3) | — | verified (Spotify links need API keys) |
| Monitoring | — | — | — | pino JSON, request ids, OTel opt-in | — | — | — | — | implemented |
| Backup & restore | — | — | — | scripts | — | restore verified locally | — | — | verified |
| Offline downloads | — | — | — | — | needs licensed rights | — | — | — | not_supported (by design) |
| Premium subscription | — | — | — | — | — | — | — | — | not_supported (not built) |
