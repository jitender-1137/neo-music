"use client";
import { useEffect, useState } from "react";
import { extractPalette, type RGB } from "@/lib/palette";
import { sizedArtwork } from "@/lib/artwork";

/** The cover's dominant colours (3), or null while unknown / unavailable (callers fall back to the brand gradient). */
export function useArtworkPalette(artworkUrl: string | undefined): RGB[] | null {
  const [colors, setColors] = useState<RGB[] | null>(null);
  useEffect(() => {
    if (!artworkUrl) { setColors(null); return; }
    let live = true;
    const small = sizedArtwork(artworkUrl, 60) ?? artworkUrl;
    extractPalette(small).then((c) => { if (live) setColors(c.length ? c : null); }, () => { if (live) setColors(null); });
    return () => { live = false; };
  }, [artworkUrl]);
  return colors;
}
