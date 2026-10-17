import type { Track } from "@zuno/core";
import type { MediaSessionAdapter } from "./types";

/** Browser Media Session API adapter (lock screen, headset, keyboard media keys). No-op where unsupported. */
export function browserMediaSession(artworkSizes = [96, 192, 256, 512], fallbackArtwork?: { src: string; sizes: string; type: string }[]): MediaSessionAdapter {
  const ms = typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null;
  const sized = (url: string, s: number) => (/googleusercontent|ggpht/.test(url) ? url.replace(/=w\d+-h\d+[^/]*$/, `=w${s}-h${s}-l90-rj`) : url);
  return {
    setMetadata(track: Track | null) {
      if (!ms) return;
      if (!track || typeof MediaMetadata === "undefined") { ms.metadata = null; return; }
      ms.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album ?? "",
        // No cover → the app icon, so the lock screen / notification never shows an empty tile.
        artwork: track.artworkUrl ? artworkSizes.map((s) => ({ src: sized(track.artworkUrl!, s), sizes: `${s}x${s}`, type: "image/jpeg" })) : fallbackArtwork ?? [],
      });
    },
    setPlaybackState(state) { if (ms) ms.playbackState = state; },
    setPosition(position, duration, rate) {
      // Only valid states: finite positive duration, 0 ≤ position ≤ duration (browsers throw otherwise).
      if (!ms?.setPositionState || !Number.isFinite(duration) || !(duration > 0) || !Number.isFinite(position)) return;
      try { ms.setPositionState({ position: Math.max(0, Math.min(position, duration)), duration, playbackRate: rate }); } catch { /* unsupported / invalid during src swaps */ }
    },
    setHandlers(h) {
      if (!ms) return;
      for (const [action, fn] of Object.entries(h)) {
        try {
          ms.setActionHandler(action as MediaSessionAction, fn ? (d) => fn(d as { seekTime?: number; seekOffset?: number }) : null);
        } catch { /* action unsupported on this browser */ }
      }
    },
  };
}
