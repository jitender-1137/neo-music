import { describe, expect, it } from "vitest";
import { AVATAR_PALETTES, randomAvatar } from "./avatar";
import { AVATAR_ART } from "../components/ui/avatarArt.generated";

describe("randomAvatar", () => {
  it("always picks a real mascot and colour set", () => {
    for (let i = 0; i < 200; i++) {
      const c = randomAvatar();
      expect(Object.keys(AVATAR_ART)).toContain(c.kind);
      expect(c.palette).toBeGreaterThanOrEqual(0);
      expect(c.palette).toBeLessThan(AVATAR_PALETTES.length);
    }
  });
  it("a shuffle never returns the same avatar, even with an unlucky random source", () => {
    const current = { kind: "ghost" as const, palette: 0 };
    const stuck = () => 0; // would pick ghost/0 forever
    const next = randomAvatar(stuck, current);
    expect(next).not.toEqual(current);
  });
});
