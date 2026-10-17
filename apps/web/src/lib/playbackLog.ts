"use client";

/**
 * Playback diagnostics: a small on-device log of what happened around playback — lock-screen /
 * notification commands received, audio element events, the app being hidden or shown, and the
 * player's self-healing steps. Lets a real-device problem (which no emulator reproduces) be read
 * back exactly. Stored only in this browser (last 200 entries), never sent anywhere.
 */
const KEY = "zuno.playbackLog.v1";
const MAX = 500;
type Entry = { t: number; e: string; d?: string };
let entries: Entry[] | null = null;
let saveTimer = 0;

function load(): Entry[] {
  if (entries) return entries;
  try { entries = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Entry[]; } catch { entries = []; }
  return entries;
}

export function logPlayback(e: string, d?: string) {
  const list = load();
  list.push({ t: Date.now(), e, ...(d ? { d } : {}) });
  if (list.length > MAX) list.splice(0, list.length - MAX);
  // Save soon, and right away when the page is being hidden (it may be frozen next).
  window.clearTimeout(saveTimer);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* full or blocked */ } };
  if (document.visibilityState === "hidden") save(); else saveTimer = window.setTimeout(save, 500);
}

export function readPlaybackLog(): string {
  return load().map((x) => `${new Date(x.t).toISOString().slice(11, 23)}  ${x.e}${x.d ? `  ${x.d}` : ""}`).join("\n");
}

export function clearPlaybackLog() {
  entries = [];
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Where the audio comes from, without the playback token: the track id, or blob / data. */
function srcLabel(u: string): string {
  if (!u) return "none";
  if (u.startsWith("blob:") || u.startsWith("data:")) return u.slice(0, 4);
  return decodeURIComponent(u.split("/stream/")[1]?.split("?")[0] ?? u.split("?")[0]!.slice(-24));
}

/**
 * Record the audio element's lifecycle, the page lifecycle and every play() result, with the state
 * needed to tell the failure cases apart: visibility, display mode, src / currentSrc, readyState,
 * networkState, paused, ended, time, duration, error and the Media Session playback state.
 */
export function attachAudioLog(a: HTMLAudioElement, msState: () => string = () => "n/a") {
  const mode = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true ? "standalone" : "browser";
  const fmt = () => {
    const cur = a.currentSrc && a.currentSrc !== a.src ? ` cur=${srcLabel(a.currentSrc)}` : "";
    const dur = Number.isFinite(a.duration) ? a.duration.toFixed(1) : String(a.duration);
    return `t=${a.currentTime.toFixed(1)}/${dur} rs=${a.readyState} ns=${a.networkState}${a.paused ? " paused" : ""}${a.ended ? " ended" : ""}${a.error ? ` err=${a.error.code}${a.error.message ? `:${a.error.message}` : ""}` : ""} src=${srcLabel(a.src)}${cur} vis=${document.visibilityState} ms=${msState()} ${mode}`;
  };
  logPlayback("app:start", `${mode} ${navigator.userAgent.match(/OS [\d_]+/)?.[0] ?? navigator.platform}`);
  for (const ev of ["loadstart", "loadedmetadata", "canplay", "play", "playing", "pause", "waiting", "stalled", "suspend", "seeking", "seeked", "ended", "error", "emptied", "abort"]) {
    a.addEventListener(ev, () => logPlayback(`audio:${ev}`, fmt()));
  }
  // timeupdate fires ~4×/s: sample it (every 2 s) so the log shows whether the clock really moves.
  let lastTu = 0;
  a.addEventListener("timeupdate", () => { const n = Date.now(); if (n - lastTu >= 2000) { lastTu = n; logPlayback("audio:timeupdate", fmt()); } });
  // Every play() call and how its promise settled (a resolved promise alone isn't proof of sound).
  const play = a.play.bind(a);
  a.play = () => {
    const p = play();
    p.then(() => logPlayback("play():resolved", fmt()), (e: unknown) => {
      const x = e as { name?: string; message?: string };
      logPlayback("play():rejected", `${x?.name ?? "Error"}: ${x?.message ?? ""} ${fmt()}`);
    });
    return p;
  };
  document.addEventListener("visibilitychange", () => logPlayback(`page:${document.visibilityState}`, fmt()));
  window.addEventListener("pageshow", (e) => logPlayback("page:show", `${(e as PageTransitionEvent).persisted ? "bfcache " : ""}${fmt()}`));
  window.addEventListener("pagehide", () => logPlayback("page:hide", fmt()));
  window.addEventListener("focus", () => logPlayback("page:focus", fmt()));
  window.addEventListener("blur", () => logPlayback("page:blur", fmt()));
  // Page Lifecycle events (where supported) that freeze / resume a page.
  document.addEventListener("freeze", () => logPlayback("page:freeze", fmt()));
  document.addEventListener("resume", () => logPlayback("page:resume", fmt()));
  // In the background, every 5 s while it says "playing": does time really move?
  window.setInterval(() => {
    if (document.visibilityState === "hidden" && !a.paused) logPlayback("audio:tick", fmt());
  }, 5000);
}
