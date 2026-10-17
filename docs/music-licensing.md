# Music licensing & provider status

## Current state
| Provider | What it is | Licensed for public streaming? |
|---|---|---|
| `youtube` (default) | YouTube Music's **unofficial InnerTube API** via youtubei.js, Proof-of-Origin tokens via bgutils-js — the same technique the Zuno desktop app uses | **No.** This is not an authorized API and very likely conflicts with YouTube's Terms of Service. Google can change or block it at any time. |
| `dev` | Locally generated sine tones, labelled "development tones" in the UI | Yes (self-generated) — tests/offline development only |

The product owner chose this explicitly (YouTube now, licensed provider later, behind an adapter).
**Do not run the YouTube provider as a public or commercial service.** Suitable uses: personal /
private deployments for yourself, with the understanding that it may break.

## Path to a licensed catalog
Implement `MusicProvider` (`packages/provider/src/types.ts`) for a provider that grants streaming
rights, then set `MUSIC_PROVIDER=<id>`. Required capabilities map 1:1 to the interface:
catalog/search/metadata, `resolveStream` (return a short-lived CDN URL — then the API proxy can be
skipped), territory availability, rate limits and errors. Candidates: commercial B2B catalogs
(e.g. 7digital/Songtradr-type APIs) or royalty-free/CC catalogs (e.g. Jamendo for CC-licensed
music). Each requires its own agreement and credentials — none are configured.

## Lyrics
- **LRCLIB** (community, synced LRC): only title/artist/album/duration are sent. Attribution shown.
- **YouTube Music** plain lyrics (credited to LyricFind in the footer we display).
Publicly redistributing lyrics normally needs a licence (e.g. LyricFind/Musixmatch). Treat lyrics
the same as the audio source: personal use only until licensed.

## Artwork & branding
Neo Music has its own name, logo ("Orbit" mark: a ringed music note on an Aurora green→blue tile), icons and colours. Album/artist artwork is hot-linked from the
provider's CDN (not stored).

## Importing from other services
Import only reads data the user owns or that is public, through official channels:
- **Files** (Exportify/TuneMyMusic/Soundiiz CSV, Apple Music XML/TXT, M3U/PLS, Google Takeout, JSON, pasted text) are parsed
  in the browser and never uploaded; only title/artist/duration are sent to `/import/match`.
- **Links**: YouTube/YouTube Music via the provider, Deezer via its public API, Spotify via the Web API with
  client-credentials **only when `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` are set** (otherwise users are pointed to Exportify).
  Apple Music, TIDAL, Amazon Music and SoundCloud have no keyless public API, so they go through a file export.
- No scraping, no use of the user's passwords for other services.
