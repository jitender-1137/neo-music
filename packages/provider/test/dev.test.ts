import { describe, expect, it } from "vitest";
import { DevToneProvider, DEV_TRACKS } from "../src/dev";

describe("DevToneProvider", () => {
  const p = new DevToneProvider();
  it("is flagged development-only", () => expect(p.isDevelopmentOnly).toBe(true));
  it("serves a valid WAV", async () => {
    const s = await p.resolveStream(DEV_TRACKS[0]!.id, { quality: "auto", preferMp4: true });
    if (s.kind !== "buffer") throw new Error("expected buffer");
    expect(new TextDecoder().decode(s.data.slice(0, 4))).toBe("RIFF");
    expect(s.data.byteLength).toBeGreaterThan(44);
  });
  it("404s unknown ids", async () => {
    await expect(p.getTrack("nope")).rejects.toMatchObject({ code: "not_found" });
  });
  it("searches", async () => {
    expect((await p.search("echo", "all")).tracks[0]!.title).toBe("E4 Echo");
  });
});
