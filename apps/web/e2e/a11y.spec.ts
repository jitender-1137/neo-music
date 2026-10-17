import AxeBuilder from "@axe-core/playwright";
import { test, expect, playFirstQuickPick } from "./fixtures";

/** WCAG 2.1 A/AA automated checks (axe-core). Manual screen-reader checks are in docs/testing-strategy.md. */
const PAGES = ["/", "/explore", "/album/dev-album-1", "/artist/dev-artist-1", "/search?q=tone", "/library/playlists", "/login", "/signup", "/settings", "/import"];

for (const scheme of ["light", "dark"] as const) for (const path of PAGES) {
  test(`a11y (${scheme}): ${path}`, async ({ app }) => {
    await app.emulateMedia({ colorScheme: scheme });
    await app.goto(path);
    await app.waitForLoadState("networkidle");
    const r = await new AxeBuilder({ page: app }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
  });
}

test("a11y: now playing + player controls", async ({ app }) => {
  await playFirstQuickPick(app);
  await app.getByRole("button", { name: /Open now playing/ }).first().click();
  const r = await new AxeBuilder({ page: app }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
});

test("player is fully keyboard operable", async ({ app }) => {
  await playFirstQuickPick(app);
  await app.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await app.keyboard.press("k");
  await expect.poll(() => app.evaluate(() => document.querySelector("audio")!.paused)).toBe(true);
  await app.keyboard.press("k");
  await expect.poll(() => app.evaluate(() => document.querySelector("audio")!.paused)).toBe(false);
  await app.keyboard.press("Shift+N");
  await expect(app.getByRole("region", { name: "Player" }).getByText("C4 Morning")).toHaveCount(0);
});

test("Space toggles playback even right after clicking another button (it never re-presses it)", async ({ app }) => {
  await playFirstQuickPick(app);
  // Click "Next" with the mouse, so it keeps focus…
  const bar = app.getByRole("region", { name: "Player" });
  await bar.getByRole("button", { name: "Next", exact: true }).click();
  await expect(bar.getByText(/D4 Drive|E4 Echo|F4 Field|G4 Glow|A4 Air|B4 Blue|C5 Climb/)).toBeVisible();
  await expect.poll(() => app.evaluate(() => document.querySelector("audio")!.paused)).toBe(false);
  const titleBefore = await bar.locator(".line-clamp-1").first().textContent();
  // …then Space must pause, not skip again.
  await app.keyboard.press(" ");
  await expect.poll(() => app.evaluate(() => document.querySelector("audio")!.paused)).toBe(true);
  expect(await bar.locator(".line-clamp-1").first().textContent()).toBe(titleBefore);
  await app.keyboard.press(" ");
  await expect.poll(() => app.evaluate(() => document.querySelector("audio")!.paused)).toBe(false);
});
