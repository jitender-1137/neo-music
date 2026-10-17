import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

/** The top loading line runs while a page loads and completes once it has arrived. */
async function check(app: Page, click: () => Promise<void>) {
  const bar = app.locator("[data-top-loader]");
  await expect(bar).toHaveAttribute("data-top-loader", "off");
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await app.route("**/explore**", async (r) => { if (r.request().resourceType() === "fetch") await gate; await r.continue(); });
  await click();
  await expect(bar).toHaveAttribute("data-top-loader", "on");
  const top = (await bar.boundingBox())!;
  expect(top.y).toBeLessThanOrEqual(1); // the very top of the page
  expect(await bar.evaluate((e) => (e.firstElementChild as HTMLElement).style.transform)).toMatch(/scaleX\(0\.\d+\)/);
  release();
  await app.waitForURL("**/explore");
  await expect(bar).toHaveAttribute("data-top-loader", "off");
  await app.unroute("**/explore**");
}

test("desktop: top loading line during navigation", async ({ app }) => {
  await app.goto("/");
  await expect(app.getByRole("heading", { name: /Quick picks/ })).toBeVisible();
  await check(app, () => app.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Explore" }).click());
});

test("phone: top loading line during navigation @mobile", async ({ app }) => {
  await app.goto("/");
  await expect(app.getByRole("heading", { name: /Quick picks/ })).toBeVisible();
  await check(app, () => app.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Explore" }).click());
});
