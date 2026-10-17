"use client";
import { useEffect } from "react";
import { usePlayerEngine } from "@/lib/player";

/** Arrow-key seek step (seconds). The seek slider uses the same step when focused. */
export const ARROW_SEEK_SEC = 2;

/**
 * Global keys: Space/K play-pause · ←/→ seek ±2 s · J/L ±10 s · Shift+N/P next/prev · M mute ·
 * ↑/↓ volume · S shuffle · R repeat · F now playing.
 * Works everywhere — including inside Now Playing — except while typing, in menus/listboxes, on a drag handle (Space picks it up), on a
 * slider (it handles its own arrows), or inside a modal form dialog.
 */
export function KeyboardShortcuts({ onToggleNowPlaying }: { onToggleNowPlaying: () => void }) {
  const engine = usePlayerEngine();
  useEffect(() => {
    if (!engine) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target instanceof Element ? e.target : document.body;
      if (t.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"], [aria-modal="true"]:not([data-player-sheet]), [aria-roledescription="sortable"]')) return;
      const s = engine.getState();
      const now = engine.currentTime();
      switch (e.key) {
        // Space always means play/pause (like Apple Music / Spotify) — it must not re-press whatever
        // button was clicked last. Enter still activates the focused control for keyboard users.
        case " ": case "Spacebar": case "k": case "K": if (e.repeat) { e.preventDefault(); return; } e.preventDefault(); engine.togglePlay(); break;
        case "ArrowLeft": e.preventDefault(); engine.seek(now - ARROW_SEEK_SEC); break;
        case "ArrowRight": e.preventDefault(); engine.seek(now + ARROW_SEEK_SEC); break;
        case "j": case "J": engine.seek(now - 10); break;
        case "l": case "L": engine.seek(now + 10); break;
        case "N": if (e.shiftKey) engine.next(); break;
        case "P": if (e.shiftKey) engine.previous(); break;
        case "m": case "M": engine.toggleMute(); break;
        case "ArrowUp": e.preventDefault(); engine.setVolume(s.volume + 0.05); break;
        case "ArrowDown": e.preventDefault(); engine.setVolume(s.volume - 0.05); break;
        case "s": case "S": if (!e.shiftKey) engine.toggleShuffle(); break;
        case "r": case "R": engine.cycleRepeat(); break;
        case "f": case "F": onToggleNowPlaying(); break;
        default: return;
      }
    };
    // Buttons fire their click on Space *keyup*; swallow it so the last-clicked control isn't triggered.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      const t = e.target instanceof Element ? e.target : document.body;
      if (t.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"], [aria-modal="true"]:not([data-player-sheet]), [aria-roledescription="sortable"]')) return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("keyup", onKeyUp, true); };
  }, [engine, onToggleNowPlaying]);
  return null;
}
