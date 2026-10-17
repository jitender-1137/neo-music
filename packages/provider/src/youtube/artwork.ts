/** Ported from Zuno `src/datasource/youtube/artwork.ts` (Apache-2.0). */
interface Candidate { url?: string; width?: number; height?: number }

function normalize(url: string): string {
  const t = url.trim();
  return t.startsWith("//") ? `https:${t}` : t;
}

export function collectArtwork(...sources: unknown[]): Candidate[] {
  const out: Candidate[] = [];
  const seen = new WeakSet<object>();
  const visit = (v: unknown) => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (typeof (v as Candidate).url === "string") out.push(v as Candidate);
    for (const child of Object.values(v)) if (child && typeof child === "object") visit(child);
  };
  for (const s of sources) visit(s);
  return out;
}

export function bestArtwork(...sources: unknown[]): string | undefined {
  const c = collectArtwork(...sources).filter((x) => x.url?.trim() && /^(https?:)?\/\//.test(x.url));
  const best = c.reduce<Candidate | undefined>((b, x) => (!b || (x.width ?? 0) * (x.height ?? 0) > (b.width ?? 0) * (b.height ?? 0) ? x : b), undefined);
  return best?.url ? upscale(normalize(best.url)) : undefined;
}

/** Ask googleusercontent for a 544px square — the size YouTube Music itself uses for cards. */
function upscale(url: string): string {
  if (!/googleusercontent\.com|ggpht\.com/.test(url) || /[?&]/.test(url)) return url;
  return /=w\d+-h\d+/.test(url) ? url.replace(/=w\d+-h\d+[^/]*$/, "=w544-h544-l90-rj") : url;
}

export function videoArtworkFallback(videoId: string): string | undefined {
  return /^[\w-]{11}$/.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined;
}
