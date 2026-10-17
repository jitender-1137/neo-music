/** Case-, accent- and punctuation-insensitive key, for matching names across sources. */
export function normalizeKey(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** "3:45" / "1:02:03" → seconds. */
export function parseDuration(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  const parts = text.trim().split(":").map(Number);
  if (parts.length < 2 || parts.some((p) => !Number.isFinite(p))) return undefined;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function formatDuration(totalSec: number | undefined): string {
  if (totalSec == null || !Number.isFinite(totalSec)) return "";
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
