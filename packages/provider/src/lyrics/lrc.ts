import type { LyricLine } from "@zuno/core";

/** Parses LRC (`[mm:ss.xx] text`, several stamps per line allowed). Port of Zuno parseSyncedLyrics. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: { text: string; startMs: number }[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const textPart = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const s of stamps) {
      const frac = s[3] ? Number(s[3].padEnd(3, "0").slice(0, 3)) : 0;
      out.push({ text: textPart, startMs: Number(s[1]) * 60_000 + Number(s[2]) * 1000 + frac });
    }
  }
  out.sort((a, b) => a.startMs - b.startMs);
  return out.map((l, i) => ({ ...l, endMs: out[i + 1]?.startMs }));
}
