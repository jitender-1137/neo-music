import { describe, expect, it } from "vitest";
import { parseLrc } from "../src/lyrics/lrc";

describe("parseLrc", () => {
  it("parses stamps, sorts, and links end times", () => {
    const lines = parseLrc("[00:05.50] second\n[00:01.00]first\n[ar:someone]\n[00:10] third");
    expect(lines.map((l) => l.text)).toEqual(["first", "second", "third"]);
    expect(lines[0]).toMatchObject({ startMs: 1000, endMs: 5500 });
    expect(lines[2]).toMatchObject({ startMs: 10000, endMs: undefined });
  });
  it("expands multiple stamps on one line", () => {
    const lines = parseLrc("[00:01.00][00:03.00] chorus");
    expect(lines).toHaveLength(2);
    expect(lines[1]!.startMs).toBe(3000);
  });
  it("handles 2- and 3-digit fractions", () => {
    expect(parseLrc("[01:02.5] a")[0]!.startMs).toBe(62500);
    expect(parseLrc("[01:02.123] a")[0]!.startMs).toBe(62123);
  });
});
