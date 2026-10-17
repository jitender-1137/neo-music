/** Navigation from the sidebar / tab bar collapses Now Playing (even to the page already open). */
export const CLOSE_NOW_PLAYING = "neo:close-now-playing";
export function closeNowPlaying() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CLOSE_NOW_PLAYING));
}
