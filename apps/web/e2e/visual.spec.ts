import { test, expect } from "./fixtures";

/**
 * Golden screenshots of our own design (dev-tone catalog → deterministic). Update intentionally
 * with `pnpm e2e --update-snapshots`. Animations are disabled and the clock is fixed.
 */
const VIEWPORTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
const PAGES = [
  { name: "home", path: "/", ready: /Quick picks/ },
  { name: "explore", path: "/explore", ready: /Quick picks|Albums/ },
  { name: "album", path: "/album/dev-album-1", ready: /Tones Vol\. 1/ },
  { name: "search", path: "/search?q=tone", ready: /Songs/ },
  { name: "library", path: "/library/playlists", ready: /Library/ },
  { name: "login", path: "/login", ready: /Welcome back/ },
];

test.describe("visual regression", () => {
  for (const vp of VIEWPORTS) {
    for (const p of PAGES) {
      test(`${p.name} @ ${vp.name}`, async ({ app }) => {
        await app.setViewportSize({ width: vp.width, height: vp.height });
        await app.clock.setFixedTime(new Date("2026-06-01T15:00:00Z"));
        await app.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
        await app.goto(p.path);
        await expect(app.getByRole("heading", { name: p.ready }).first()).toBeVisible();
        await app.waitForLoadState("networkidle");
        await expect(app).toHaveScreenshot(`${p.name}-${vp.name}.png`, { fullPage: false, animations: "disabled", maxDiffPixelRatio: 0.01 });
      });
    }
  }
  test("now playing @ desktop and phone", async ({ app }) => {
    for (const vp of [VIEWPORTS[0]!, VIEWPORTS[2]!]) {
      await app.setViewportSize({ width: vp.width, height: vp.height });
      await app.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      await app.goto("/album/dev-album-1");
      await app.getByRole("main").getByRole("button", { name: /^(Play|Pause)$/ }).first().click();
      await app.getByRole("button", { name: /Open now playing/ }).first().click();
      await expect(app.getByRole("dialog")).toBeVisible();
      await app.evaluate(() => document.querySelector("audio")?.pause());
      await expect(app).toHaveScreenshot(`now-playing-${vp.name}.png`, { animations: "disabled", maxDiffPixelRatio: 0.02, mask: [app.locator('input[type="range"]'), app.locator(".tabular")] });
    }
  });
});
