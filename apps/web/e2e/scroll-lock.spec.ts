import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

/** While Now Playing is open, the page underneath must not scroll (wheel or touch); closing restores it. */
async function check(app: Page, close: () => Promise<void>) {
  await app.goto("/album/dev-album-1");
  await app.getByRole("main").getByRole("button", { name: "Play", exact: true }).click();
  await app.setViewportSize({ width: app.viewportSize()!.width, height: 420 }); // make the page scrollable
  await app.evaluate(() => window.scrollTo(0, 120));
  const y0 = await app.evaluate(() => window.scrollY);
  expect(y0).toBeGreaterThan(0);
  await app.getByRole("button", { name: /Open now playing/ }).first().click();
  await expect.poll(() => app.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  await app.mouse.move(app.viewportSize()!.width / 2, 200);
  await app.mouse.wheel(0, 800);
  await app.waitForTimeout(400);
  expect(await app.evaluate(() => window.scrollY)).toBe(y0);
  await close();
  await expect.poll(() => app.evaluate(() => document.documentElement.style.overflow)).toBe("");
  expect(await app.evaluate(() => window.scrollY)).toBe(y0);
  await app.mouse.wheel(0, 200);
  await expect.poll(() => app.evaluate(() => window.scrollY)).toBeGreaterThan(y0);
}

test("desktop: page behind Now Playing doesn't scroll", async ({ app }) => {
  await check(app, () => app.getByRole("button", { name: "Close now playing" }).first().click());
});

test("phone: page behind Now Playing doesn't scroll @mobile", async ({ app }) => {
  await check(app, () => app.getByRole("button", { name: "Minimize player" }).click());
});
