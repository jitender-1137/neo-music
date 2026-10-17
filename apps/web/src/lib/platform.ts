/**
 * iPhone / iPad (any browser there is WebKit). Web pages there cannot change the media volume
 * level — it's read-only and owned by the side buttons — and newer iOS versions even accept the
 * value and silently ignore it, so feature-testing `audio.volume` isn't reliable.
 * iPadOS reports itself as a Mac, hence the touch check.
 */
export function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|od|ad)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** Running as the installed Home Screen app (not a browser tab). */
export function isStandaloneApp(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
