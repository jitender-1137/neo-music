import { describe, expect, it } from "vitest";
import { dominantColors, rgbToHsl, songAccent, playerColors } from "./palette";

const fill = (colors: [number, number, number][], counts: number[]) => {
  const total = counts.reduce((a, b) => a + b, 0);
  const px = new Uint8ClampedArray(total * 4);
  let o = 0;
  colors.forEach((c, i) => { for (let k = 0; k < counts[i]!; k++) { px.set([...c, 255], o); o += 4; } });
  return px;
};

describe("palette", () => {
  it("converts rgb to hsl", () => {
    const [h, s, l] = rgbToHsl([255, 0, 0]);
    expect(h).toBe(0); expect(s).toBe(1); expect(l).toBe(0.5);
  });
  it("ranks the most prominent vivid colour first and ignores black/white", () => {
    const px = fill([[20, 40, 200], [220, 30, 30], [0, 0, 0], [255, 255, 255]], [500, 200, 900, 900]);
    const out = dominantColors(px, 3);
    expect(out[0]![2]).toBeGreaterThan(150); // blue dominates
    expect(out).toHaveLength(2);
  });
});

describe("songAccent", () => {
  it("picks the most saturated colour and lights it per theme", () => {
    const a = songAccent([[90, 90, 95], [20, 120, 220]])!;
    expect(a.dark).toMatch(/^hsl\(21\d /);
    expect(a.dark.endsWith("66%)")).toBe(true);
    expect(a.light.endsWith("42%)")).toBe(true);
    expect(songAccent([])).toBeNull();
  });
});

describe("playerColors", () => {
  it("is empty without colours", () => {
    expect(playerColors([])).toBeNull();
  });
  it("keeps the cover's hue and gets darker from top to base", () => {
    const c = playerColors([[150, 20, 30]])!; // maroon cover
    const hue = (x: string) => Number(/hsl\((\d+)/.exec(x)![1]);
    const light = (x: string) => Number(/ (\d+)%\)/.exec(x)?.[1] ?? /(\d+)% \//.exec(x)![1]);
    expect(Math.abs(hue(c.top) - 355)).toBeLessThanOrEqual(5);
    expect(light(c.top)).toBeGreaterThan(light(c.base));
    expect(light(c.sheet)).toBeGreaterThan(light(c.base));
  });
  it("grey covers stay near-neutral (no invented colour)", () => {
    const c = playerColors([[120, 120, 122]])!;
    expect(/hsl\(\d+ (\d+)%/.exec(c.base)![1]).toBe("1");
    expect(c.glow).toMatch(/hsl\(\d+ \d% /);
  });
});
