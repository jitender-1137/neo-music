import { describe, expect, it } from "vitest";
import { sizedArtwork } from "./artwork";
import { qs } from "./api";
import { LIBRARY_TABS } from "./libraryTabs";

describe("sizedArtwork", () => {
  it("rewrites googleusercontent sizes to the next bucket", () => {
    expect(sizedArtwork("https://lh3.googleusercontent.com/abc=w60-h60-l90-rj", 200)).toBe("https://lh3.googleusercontent.com/abc=w226-h226-l90-rj");
    expect(sizedArtwork("https://lh3.googleusercontent.com/abc", 100)).toBe("https://lh3.googleusercontent.com/abc=w120-h120-l90-rj");
  });
  it("leaves other hosts and query URLs alone", () => {
    expect(sizedArtwork("https://i.ytimg.com/vi/x/hqdefault.jpg", 100)).toBe("https://i.ytimg.com/vi/x/hqdefault.jpg");
    expect(sizedArtwork("https://lh3.googleusercontent.com/abc?x=1", 100)).toBe("https://lh3.googleusercontent.com/abc?x=1");
    expect(sizedArtwork(undefined, 100)).toBeUndefined();
  });
});

describe("qs", () => {
  it("skips empty values and encodes", () => {
    expect(qs({ q: "a b", filter: undefined, n: 0, x: "" })).toBe("?q=a+b&n=0");
    expect(qs({})).toBe("");
  });
});

describe("library tabs", () => {
  it("is a plain array usable on the server", () => {
    expect(Array.isArray(LIBRARY_TABS)).toBe(true);
    expect(LIBRARY_TABS.map((t) => t.id)).toContain("liked");
  });
});
