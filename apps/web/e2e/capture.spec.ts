import { test, expect } from "./fixtures";

/**
 * Screenshot capture for design reviews (not a regression gate): `CAPTURE=before npx playwright test e2e/capture.spec.ts`.
 * Writes PNGs to docs/screenshots/<CAPTURE>/ at an iPhone-like and a narrow phone viewport.
 */
const LABEL = process.env.CAPTURE;
const OUT = `../../docs/screenshots/${LABEL}`;
const PHONES = [{ name: "iphone", width: 390, height: 844 }, { name: "narrow", width: 320, height: 640 }];

test.describe("capture", () => {
  test.skip(!LABEL, "set CAPTURE=<label> to run");
  for (const vp of PHONES) {
    test(`mobile screens @ ${vp.name}`, async ({ app }) => {
      test.setTimeout(180_000);
      await app.setViewportSize({ width: vp.width, height: vp.height });
      await app.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      const shot = (n: string) => app.screenshot({ path: `${OUT}/${vp.name}-${n}.png`, animations: "disabled" });
      const pages: [string, string, RegExp][] = [
        ["home", "/", /Quick picks/], ["explore", "/explore", /Albums|Quick picks/], ["search-empty", "/search", /Search|Recent/],
        ["search-results", "/search?q=tone", /Songs/], ["library", "/library", /Library/], ["liked-empty", "/library/liked", /./],
        ["album", "/album/dev-album-1", /Tones Vol\. 1/], ["artist", "/artist/dev-artist-1", /./], ["playlist", "/playlist/dev-playlist-all", /./],
        ["not-found", "/album/does-not-exist", /Page not found/],
      ];
      for (const [n, path, ready] of pages) {
        await app.goto(path);
        await expect(app.getByRole("heading", { name: ready }).first()).toBeVisible();
        await app.waitForLoadState("networkidle");
        await shot(n);
      }
      await app.goto("/album/dev-album-1");
      await app.getByRole("button", { name: "Play", exact: true }).click();
      await app.waitForTimeout(800);
      await shot("mini-player");
      await app.getByRole("button", { name: /Open now playing/ }).first().click();
      await app.waitForTimeout(600);
      await shot("full-player");
      const handle = app.getByRole("toolbar", { name: "Song actions" }).getByRole("button", { name: "Up next" });
      if (await handle.isVisible().catch(() => false)) {
        // Phone player: cover enlarged behind the player, then the panel (half height, then tabs).
        await app.getByRole("button", { name: "Show artwork full screen" }).click();
        await app.waitForTimeout(600);
        await shot("cover-enlarged");
        await app.getByRole("button", { name: "Show artwork at normal size" }).click();
        await handle.click();
        await app.waitForTimeout(700);
        await shot("queue-half");
        for (const [btn, name] of [["Lyrics", "lyrics"], ["Related", "related"], ["Up next", "queue"]] as const) {
          await app.getByRole("tab", { name: btn }).click();
          await app.waitForTimeout(700);
          await shot(name);
        }
        await app.keyboard.press("Escape"); // panel → song view
        await app.waitForTimeout(500);
      } else {
        for (const tab of ["Lyrics", "Up next"]) {
          const t = app.getByRole("tab", { name: tab }).first();
          if (await t.isVisible().catch(() => false)) { await t.click(); await app.waitForTimeout(500); await shot(tab === "Lyrics" ? "lyrics" : "queue"); }
        }
      }
      await app.keyboard.press("Escape"); // player → page
      await app.waitForTimeout(600);
      await app.getByRole("button", { name: /More actions for D4 Drive/ }).first().click();
      await app.waitForTimeout(400);
      await shot("action-menu");
    });
  }
});
