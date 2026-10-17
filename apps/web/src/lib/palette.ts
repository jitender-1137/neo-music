/**
 * Dominant colours from an image (album art). Runs in the browser on a 32×32 sample — artwork CDNs
 * send `Access-Control-Allow-Origin: *`, so the canvas isn't tainted. Pure helpers are exported
 * for unit tests.
 */
export type RGB = [number, number, number];

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/**
 * Buckets pixels by hue (12 sectors) + a neutral bucket, scores buckets by population × vividness,
 * and returns up to `n` representative colours (bucket averages), most prominent first.
 */
export function dominantColors(pixels: Uint8ClampedArray, n = 3): RGB[] {
  type B = { r: number; g: number; b: number; count: number; score: number };
  const buckets = new Map<number, B>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue;
    const px: RGB = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
    const [h, s, l] = rgbToHsl(px);
    if (l < 0.06 || l > 0.96) continue; // near-black/white say little about the cover's mood
    const key = s < 0.15 ? -1 : Math.floor(h / 30);
    const b = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0, score: 0 };
    b.r += px[0]; b.g += px[1]; b.b += px[2]; b.count++;
    b.score += 0.35 + s * (1 - Math.abs(l - 0.5));
    buckets.set(key, b);
  }
  return [...buckets.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((b) => [Math.round(b.r / b.count), Math.round(b.g / b.count), Math.round(b.b / b.count)] as RGB);
}

const cache = new Map<string, Promise<RGB[]>>();

export function extractPalette(url: string): Promise<RGB[]> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = new Promise<RGB[]>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 32;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return reject(new Error("no 2d context"));
        ctx.drawImage(img, 0, 0, 32, 32);
        resolve(dominantColors(ctx.getImageData(0, 0, 32, 32).data, 3));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error("artwork failed to load"));
    img.src = url;
  });
  p.catch(() => cache.delete(url));
  cache.set(url, p);
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  return p;
}

/** The cover's most vivid colour, re-lit for each theme so it always reads on the progress track. */
export function songAccent(colors: RGB[]): { dark: string; light: string } | null {
  if (!colors.length) return null;
  const [h, sat] = colors.map(rgbToHsl).sort((a, b) => b[1] - a[1])[0]!;
  const s = Math.max(sat, 0.45) * 100;
  return { dark: `hsl(${Math.round(h)} ${Math.round(Math.min(s, 85))}% 66%)`, light: `hsl(${Math.round(h)} ${Math.round(Math.min(s, 80))}% 42%)` };
}

/**
 * Background colours for the phone player, taken from the cover's most prominent colour
 * (YouTube Music / Apple Music style): a lit top that fades into a deep base, a slightly lighter
 * sheet for the queue, and a soft glow for the app background. Grey covers stay near-neutral.
 */
export function playerColors(colors: RGB[]): { top: string; base: string; sheet: string; glow: string } | null {
  if (!colors.length) return null;
  const [h, s] = rgbToHsl(colors[0]!);
  const hue = Math.round(h);
  const sat = (k: number) => Math.round(Math.min(s, 0.75) * k * 100);
  return {
    top: `hsl(${hue} ${sat(0.9)}% 24%)`,
    base: `hsl(${hue} ${sat(0.8)}% 12%)`,
    sheet: `hsl(${hue} ${sat(0.75)}% 17%)`,
    glow: `hsl(${hue} ${Math.max(sat(1), s < 0.12 ? 0 : 40)}% 50% / 0.24)`,
  };
}
