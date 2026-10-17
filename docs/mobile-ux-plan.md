# Mobile UX (phones, < 768 px)

The phone layout follows Apple Music's structure (a floating tab bar, a mini-player above it, an artwork-led full player and sheets) with YouTube Music's player gestures. It uses Neo Music's own brand and components; no proprietary assets are used. The research behind this is in [mobile-reference-comparison.md](mobile-reference-comparison.md).

## Layout, bottom up

1. Safe area (home indicator). `--m-nav-bottom: max(safe-area-inset-bottom, 10px)`, so the bars float above it.
2. **Tab bar**: Home · Explore · Library · Search (`BottomNav`). It is a floating "liquid glass" capsule (`.m-glass`: see-through tint, 24 px blur, 190 % saturation, a bright top rim), 60 px tall. One lens (`.m-tab-lens`) glides between tabs with a slight spring, and it moves the moment you tap, before the next page has loaded. Icons sit in a fixed 24 px box and labels keep one weight, so nothing shifts. Under Reduce Transparency the bar becomes solid.
3. **Mini-player** (`MobilePlayer`): 56 px, 8 px above the tab bar. It appears only when a track is loaded; with no track there is no gap.
4. Page content. `main` pads its bottom by the measured chrome height (`--m-mini-bottom + --m-mini-h`, or just the tab bar).

Every offset comes from tokens in `app/globals.css` (`--m-*`) and the safe-area `env()` values; none are device-specific numbers.

## Tab bar behaviour

- **Navigation:** client-side links, so playback never stops. `aria-current="page"` marks the active tab, and the active icon switches to its bold variant.
- **Scroll memory:** leaving a tab from its root page remembers the scroll position, and coming back restores it.
- **Re-tapping the active tab:** on a sub-page it goes to the tab's root; at the root it scrolls to the top (iOS convention).
- **Search:** a tab on phones, with the search box at the top of the page. Tablet and desktop keep it in the header.

## The player: one surface, two states

`src/lib/playerSheet.ts` is a pure state machine: `collapsed → expanding → expanded → minimizing`, plus a panel (`next | lyrics | related`) over the expanded player. Every tap, gesture, route change and Escape key goes through it. A cancelled, interrupted or tiny gesture therefore always lands back in a resting state. It has unit tests in `gesture.test.ts`.

While a drag is in progress, the surface follows the finger through `transform` only (no layout work). On release, CSS snaps it to the resting state with an iOS-like curve, `cubic-bezier(.32,.72,0,1)` over 420 ms. Under reduced motion the change is instant.

### Gesture map (each one also has a visible button)

| Surface | Gesture | Result | Button equivalent |
|---|---|---|---|
| Mini-player | tap · swipe up (follows the finger) | Open full player | "Open now playing: …" |
| Mini-player | swipe left / right: the strip of previous · current · next (thumbnail + title) follows the finger, and the neighbouring song slides in (YouTube Music carousel); rubber-bands when there is nothing on that side | Next / previous track | Next button; Previous in full player |
| Full player (song view) | swipe down anywhere (follows, rubber-bands upward) | Minimise | Chevron "Minimize player", Escape |
| Full player artwork area | swipe left / right: the neighbouring cover slides in 24 px away; rubber-bands at the ends | Next / previous track | Next / Previous |
| Panel header (grabber, now-playing row, tabs) | swipe down | Back to the song view | Chevron "Back to player", Escape |
| Panel header | swipe left / right | Neighbouring tab (Up next → Lyrics → Related) | Tabs |
| Queue row | swipe left (red "Remove" shows beside the row) | Remove from queue | × button |
| Queue row handle | long-press and drag | Reorder | Keyboard: Space, arrows, Space |
| Action sheet grabber/header | swipe down | Dismiss | Cancel, tap outside, Escape |

Source for the mapping: YouTube Music changes tracks by swiping on the mini-player and the artwork. Apple Music swipes left to remove queue rows and taps to open the player. Swipe-up and swipe-down are widespread conventions but are not documented by either app (see the reference doc).

**No conflicts by design.** Each surface owns at most one meaning per axis. Horizontal swipes mean "track" on the mini-player and artwork, "tab" on the panel header, and "remove" on a queue row; these are three different surfaces. The recogniser locks onto an axis after 10 px, so a vertical dismiss can never become a track change.

### Recogniser rules (`src/lib/gesture.ts`, `src/hooks/useSwipe.ts`)

- **Taps:** movement under 10 px (`SLOP_PX`) is a tap.
- **Axis lock:** the dominant axis must lead by 1.2× to lock.
- **Commit:** the drag must cover ≥ 25 % of the surface, or be a flick of ≥ 0.45 px/ms over ≥ 24 px. A flick back against the drag cancels it.
- **Pointer events:** Safari 13+ is supported. `touch-action: none` is set only on surfaces that own every drag (the mini-player, the song view, sheet headers). Scrolling content uses `pan-y`, so vertical scrolling stays native and horizontal swipes still arrive. Page scrolling is never disabled globally.
- **No double actions:** after a recognised gesture, the click that follows is swallowed. A new touch clears that flag, so a quick next tap is never lost.
- **Excluded starts:** gestures never begin on inputs, sliders (the seek bar) or `[data-swipe-ignore]` (queue drag handles), nor within 18 px of the left or right screen edge (Safari's back/forward swipe).

## Full player content

From top to bottom: the grabber; the minimise chevron, "Playing from …" and the ⋯ action sheet. Then the artwork, as large as fits (`min(100cqw, 100cqh)`, so it fits on small iPhones and in short landscape). Then the title, artist links and Like, then any error line, the seek bar with times, and shuffle · previous · play/pause (64 px) · next · repeat. At the bottom are the Up next · Lyrics · Related buttons. All touch targets are at least 44 px.

Colour comes from the artwork (the existing `np-backdrop` palette extraction).

Controls are shown only when they work. There is no download control (not licensed), no lossless or spatial-audio badge (the source provides no such data), and no AI-music label (the source provides no metadata). See the reference doc for the reasons.

## Sheets

`ActionSheet` (Radix Dialog) provides a focus trap, Escape, focus restore and dialog semantics. The track header sits at the top, then 48 px rows, then a separate Cancel button, all inset from the safe area. The track ⋯ menu shows as a sheet on phones and as the existing dropdown on tablet and desktop, built from one shared action list. Selecting an action closes the sheet first, so it never lingers over a page you navigate to.

## Accessibility

- **Full player:** `role="dialog"` with `aria-modal`. While it is open, the page, header and tab bar are `inert`. Focus moves to Minimise when it opens and returns to the mini-player when it closes.
- **Panel:** proper `tablist`/`tabpanel` roles. Focus moves to the selected tab when the panel opens.
- **Escape order:** sheet over the player, then panel, then player.
- **Artwork placeholders:** exposed as `role="img"` with a label when the artwork has a name.
- **Zoom:** browser zoom is never disabled.

## Design tokens added (`:root`, consumed only by phone components)

`--m-gap`, `--m-side`, `--m-nav-h`, `--m-nav-bottom`, `--m-mini-h`, `--m-mini-bottom`, `--m-radius-bar`, `--m-radius-sheet`, `--m-hit`, `--m-sheet-dur`, `--m-sheet-ease`. Utility classes: `.m-sheet`, `.m-drag`, and `.m-press` (pressed scale, phones only).

## Loading states

Every data route has a `loading.tsx` that renders a page-shaped shimmer skeleton (`src/components/ui/PageSkeletons.tsx`), shown instantly on navigation and laid out like the real page, so nothing jumps when content arrives. In-page queries use the same blocks: album and playlist pages use `CollectionSkeleton`, and artist pages use `ArtistSkeleton`.

## Update (2026-10-17, later): YouTube Music-style player

- **Song-coloured player.** The background is the cover's most prominent colour: a lit top fading into a deep base (`playerColors()` in `lib/palette.ts`). The panel uses a slightly lighter shade. Colours cross-fade between songs (registered CSS properties). The player is always light-on-dark, like the reference apps. While it is open, the iPhone status bar / Safari toolbar take the song colour (`theme-color`). On phones the app background glow also takes the song colour; desktop keeps the brand glow.
- **Header:** just the minimise and ⋯ buttons ("Playing from" removed). The playlist name now labels the bottom handle instead.
- **Glass pills** under the title: Like · Lyrics · Related · Share. The title has a `›` link to the song page.
- **Swipe up / down:** song view ↑ opens Up next at **half** height (the panel top sits 58% down the screen, just under the controls; the cover goes full-width behind the player with the title over it). ↑ again goes to **full** height (compact now-playing row plus list). ↓ steps back full → half → closed → minimised. A long drag skips a step.
- **Tap the cover:** it grows edge to edge *behind* the player, fading into the background. It never covers the title, pills or controls (tested by hit-testing every control). Tap again or press Escape to return. Left/right swipes keep changing the song in every state.
- **Sizes:** tab bar 52 px, mini-player 48 px.
- **Zoom is disabled, at the owner's request:** viewport `maximum-scale=1, user-scalable=no`, `touch-action: manipulation`, iOS pinch gestures cancelled (`ZoomLock`), and 16 px inputs so iOS doesn't zoom on focus. This removes pinch-zoom for low-vision users; to undo it, delete those four pieces.
- **Library on phones:** shortcut tiles for Liked music · History · Import music · New playlist, all of which work without an account.
- **Guests:** "Not interested" works without an account. It is stored on the device and hides the song from shelves straight away, with Undo.

### Device controls (lock screen, Control Center, Android notification, headset)
Uses the Media Session API through the single audio element: title, artist, album and artwork (the app icon when a song has no cover), play/pause state, previous/next, and a draggable scrubber (`seekto`). The position is pushed on every play, pause, seek and load as well as each second. Seek-skip handlers are deliberately **not** registered: iOS would otherwise replace ⏮ ⏭ with ±10 s buttons, unlike the native music apps. Headset double/triple-click maps to next/previous.
