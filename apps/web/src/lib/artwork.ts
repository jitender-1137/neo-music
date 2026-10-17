/** Ask googleusercontent for the right size; ytimg/others pass through. */
export function sizedArtwork(url: string | undefined, px: number): string | undefined {
  if (!url) return undefined;
  const size = [60, 120, 226, 302, 400, 544, 720].find((s) => s >= px) ?? 720;
  if (/googleusercontent\.com|ggpht\.com/.test(url) && !/[?&]/.test(url)) {
    return /=w\d+-h\d+/.test(url) ? url.replace(/=w\d+-h\d+[^/]*$/, `=w${size}-h${size}-l90-rj`) : `${url}=w${size}-h${size}-l90-rj`;
  }
  return url;
}

