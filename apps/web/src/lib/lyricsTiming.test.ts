import { describe, expect, it } from "vitest";
import { describeOffset } from "./lyricsTiming";

describe("describeOffset", () => {
  it("reads naturally", () => {
    expect(describeOffset(0)).toBe("In sync");
    expect(describeOffset(-500)).toBe("0.5s earlier");
    expect(describeOffset(250)).toBe("0.25s later");
    expect(describeOffset(1250)).toBe("1.25s later");
    expect(describeOffset(-10_000)).toBe("10s earlier");
  });
});
