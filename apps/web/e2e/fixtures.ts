import { test as base, expect, type Page } from "@playwright/test";

/** Each test starts as a fresh guest (new browser context → empty IndexedDB/localStorage/cookies). */
export const test = base.extend<{ app: Page }>({
  // Playwright clicks are trusted user gestures, so play() is allowed exactly as for a real user.
  app: async ({ page }, use) => { await use(page); },
});
export { expect };

export const audioState = (page: Page) => page.evaluate(() => {
  const a = document.querySelector("audio");
  return a ? { src: a.src, paused: a.paused, time: a.currentTime, count: document.querySelectorAll("audio").length } : null;
});

export async function playFirstQuickPick(page: Page) {
  await page.goto("/");
  const play = page.getByRole("button", { name: /^Play C4 Morning/ }).first();
  await play.click();
  await expect.poll(async () => (await audioState(page))?.paused, { timeout: 15_000 }).toBe(false);
}

export async function signUp(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("E2E Listener");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/Password/).fill("e2e-password-long-enough");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("/");
}
