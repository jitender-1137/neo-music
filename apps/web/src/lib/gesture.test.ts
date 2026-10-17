import { describe, expect, it } from "vitest";
import { COMMIT_FRACTION, SLOP_PX, directionOf, lockAxis, rubberBand, shouldCommit, velocityOf } from "./gesture";
import { initialSheet, isOpen, transition, type SheetEvent, type SheetState } from "./playerSheet";

describe("axis lock", () => {
  it("ignores jitter below the slop", () => {
    expect(lockAxis(SLOP_PX - 1, 3)).toBeNull();
    expect(lockAxis(-4, SLOP_PX - 1)).toBeNull();
  });
  it("locks to the dominant axis", () => {
    expect(lockAxis(30, 5)).toBe("x");
    expect(lockAxis(-4, -40)).toBe("y");
  });
  it("stays undecided on true diagonals", () => {
    expect(lockAxis(20, 19)).toBeNull();
  });
  it("names directions", () => {
    expect(directionOf("y", -10)).toBe("up");
    expect(directionOf("y", 10)).toBe("down");
    expect(directionOf("x", -10)).toBe("left");
    expect(directionOf("x", 10)).toBe("right");
  });
});

describe("commit rule", () => {
  const H = 800;
  it("commits past the distance threshold", () => {
    expect(shouldCommit(H * COMMIT_FRACTION, H, 0)).toBe(true);
    expect(shouldCommit(-H * 0.3, H, -0.1)).toBe(true);
  });
  it("does not commit a short slow drag", () => {
    expect(shouldCommit(60, H, 0.1)).toBe(false);
  });
  it("commits a short fast flick", () => {
    expect(shouldCommit(40, H, 0.9)).toBe(true);
    expect(shouldCommit(-40, H, -0.9)).toBe(true);
  });
  it("a tiny flick is still a tap", () => {
    expect(shouldCommit(10, H, 2)).toBe(false);
  });
  it("a flick back against the drag cancels it", () => {
    expect(shouldCommit(H * 0.4, H, -0.6)).toBe(false);
  });
  it("zero travel never commits", () => {
    expect(shouldCommit(0, H, 5)).toBe(false);
  });
});

describe("velocity", () => {
  it("uses only the recent window", () => {
    const s = [{ t: 0, v: 0 }, { t: 500, v: 10 }, { t: 550, v: 40 }, { t: 600, v: 70 }];
    expect(velocityOf(s)).toBeCloseTo(0.6, 5);
  });
  it("is zero without enough samples", () => {
    expect(velocityOf([{ t: 0, v: 5 }])).toBe(0);
  });
});

describe("rubber band", () => {
  it("is 0 within bounds and always less than the overshoot", () => {
    expect(rubberBand(0, 800)).toBe(0);
    expect(rubberBand(-5, 800)).toBe(0);
    const r = rubberBand(200, 800);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(200);
  });
});

describe("player sheet state machine", () => {
  const run = (...events: SheetEvent[]) => events.reduce<SheetState>(transition, initialSheet);

  it("swipe up opens, swipe down minimises", () => {
    expect(run({ type: "dragStart" }, { type: "dragEnd", commit: true }).mode).toBe("expanded");
    expect(run({ type: "open" }, { type: "dragStart" }, { type: "dragEnd", commit: true })).toEqual(initialSheet);
  });
  it("cancelled or short drags return to where they started", () => {
    expect(run({ type: "dragStart" }, { type: "dragEnd", commit: false })).toEqual(initialSheet);
    expect(run({ type: "dragStart" }, { type: "dragCancel" })).toEqual(initialSheet);
    expect(run({ type: "open" }, { type: "dragStart" }, { type: "dragCancel" }).mode).toBe("expanded");
    expect(run({ type: "open" }, { type: "dragStart" }, { type: "dragEnd", commit: false }).mode).toBe("expanded");
  });
  it("tap/open is idempotent (rapid taps never stack players)", () => {
    const once = run({ type: "open" });
    expect(run({ type: "open" }, { type: "open" }, { type: "open" })).toEqual(once);
  });
  it("toggle flips between the two resting states", () => {
    expect(run({ type: "toggle" }).mode).toBe("expanded");
    expect(run({ type: "toggle" }, { type: "toggle" })).toEqual(initialSheet);
  });
  it("close (route change, track gone) always lands collapsed with no panel", () => {
    expect(run({ type: "open" }, { type: "openPanel", tab: "lyrics" }, { type: "close" })).toEqual(initialSheet);
    expect(run({ type: "dragStart" }, { type: "close" })).toEqual(initialSheet);
    expect(run({ type: "close" })).toBe(initialSheet);
  });
  it("panels only open on the expanded player and swipe between neighbours", () => {
    expect(run({ type: "openPanel", tab: "next" }).panel).toBeNull();
    const s = run({ type: "open" }, { type: "openPanel", tab: "next" });
    expect(s.panel).toBe("next");
    expect(transition(s, { type: "swipePanel", dir: 1 }).panel).toBe("lyrics");
    expect(transition(s, { type: "swipePanel", dir: -1 }).panel).toBe("next"); // already first
    const last = run({ type: "open" }, { type: "openPanel", tab: "related" }, { type: "swipePanel", dir: 1 });
    expect(last.panel).toBe("related");
    expect(transition(s, { type: "closePanel" }).panel).toBeNull();
  });
  it("a drag on the player while a panel is open does not minimise it", () => {
    const s = run({ type: "open" }, { type: "openPanel", tab: "lyrics" }, { type: "dragStart" });
    expect(s).toEqual({ mode: "expanded", panel: "lyrics", detent: "full" });
  });
  it("panel heights: up → half → full, down → half → closed", () => {
    const open = run({ type: "open" });
    const half = transition(open, { type: "panelUp" });
    expect(half).toEqual({ mode: "expanded", panel: "next", detent: "half" });
    const full = transition(half, { type: "panelUp" });
    expect(full.detent).toBe("full");
    expect(transition(full, { type: "panelUp" })).toBe(full); // already at the top
    const back = transition(full, { type: "panelDown" });
    expect(back.detent).toBe("half");
    expect(transition(back, { type: "panelDown" }).panel).toBeNull();
    expect(transition(open, { type: "panelDown" })).toBe(open); // no panel: nothing to lower
    expect(run({ type: "panelUp" })).toEqual(initialSheet); // collapsed player has no panel
    // Buttons open straight to full; a tab switch keeps the height.
    const viaButton = transition(open, { type: "openPanel", tab: "lyrics" });
    expect(viaButton.detent).toBe("full");
    expect(transition(half, { type: "swipePanel", dir: 1 })).toEqual({ ...half, panel: "lyrics" });
  });
  it("isOpen covers the expanded and minimising states", () => {
    expect(isOpen(run({ type: "open" }))).toBe(true);
    expect(isOpen(run({ type: "open" }, { type: "dragStart" }))).toBe(true);
    expect(isOpen(run({ type: "dragStart" }))).toBe(false);
  });
});
