import { test, expect, type Page } from "@playwright/test";

/** Service-worker cache behaviour on a production build (the worker is not registered in dev). */
async function swReady(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true), null, { timeout: 30_000 });
  await page.reload(); // the worker controls pages loaded after activation
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true);
}
const stats = (page: Page) => page.evaluate(() => new Promise<any>((resolve) => {
  const on = (e: MessageEvent) => { if (e.data?.type === "cache-stats") { navigator.serviceWorker.removeEventListener("message", on); resolve(e.data); } };
  navigator.serviceWorker.addEventListener("message", on);
  navigator.serviceWorker.controller!.postMessage({ type: "cache-stats" });
}));

test("service worker registers, controls the page, and uses a versioned cache with the configured budget", async ({ page }) => {
  await swReady(page);
  const s = await stats(page);
  expect(s.version).toMatch(/^neo-sw-v\d+$/);
  expect(s.budget).toBeLessThanOrEqual(50 * 1048576); // NEXT_PUBLIC_CACHE_BUDGET_MB=50 for this build
  const keys = await page.evaluate(() => caches.keys());
  expect(keys.every((k) => k.startsWith("neo-sw-v"))).toBe(true);
});

test("public catalog data: miss on first load, hit afterwards (stale-while-revalidate)", async ({ page }) => {
  await swReady(page);
  const before = await stats(page);
  await page.evaluate(() => fetch("/api/v1/albums/dev-album-1").then((r) => r.json()));
  const afterMiss = await stats(page);
  expect(afterMiss.stats.miss).toBeGreaterThan(before.stats.miss);
  await page.waitForTimeout(500); // stored in the background
  await page.evaluate(() => fetch("/api/v1/albums/dev-album-1").then((r) => r.json()));
  const afterHit = await stats(page);
  expect(afterHit.stats.hit).toBeGreaterThan(afterMiss.stats.hit);
  expect(afterHit.entries).toBeGreaterThan(0);
});

test("audio is never cached: Range requests pass through as a real 206 and count as bypass", async ({ page }) => {
  await swReady(page);
  const r = await page.evaluate(async () => {
    const tok = (await (await fetch("/api/v1/playback/token", { method: "POST" })).json()).token as string;
    const res = await fetch(`/api/v1/stream/dev-01?q=auto&f=mp4&t=${encodeURIComponent(tok)}`, { headers: { Range: "bytes=0-99" } });
    return { status: res.status, range: res.headers.get("content-range"), len: res.headers.get("content-length"), accept: res.headers.get("accept-ranges") };
  });
  expect(r.status).toBe(206);
  expect(r.range).toMatch(/^bytes 0-99\/\d+$/);
  expect(r.len).toBe("100");
  expect(r.accept).toBe("bytes");
  const s = await stats(page);
  expect(s.stats.bypassReasons["audio-range"]).toBeGreaterThan(0);
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((r) => r.url)))).flat());
  expect(cached.some((u) => u.includes("/api/v1/stream"))).toBe(false);
});

test("private / user-scoped API responses are never stored", async ({ page }) => {
  await swReady(page);
  await page.evaluate(() => Promise.all(["/api/v1/library/likes", "/api/v1/history", "/api/v1/playback/token"].map((u) => fetch(u, { method: u.includes("token") ? "POST" : "GET" }).catch(() => null))));
  await page.waitForTimeout(400);
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((r) => r.url)))).flat());
  expect(cached.some((u) => /\/api\/v1\/(library|history|playback)/.test(u))).toBe(false);
});

test("offline: cached catalog data still loads; navigations fall back to the offline page", async ({ page, context }) => {
  await swReady(page);
  await page.evaluate(() => fetch("/api/v1/albums/dev-album-1").then((r) => r.json()));
  await page.waitForTimeout(600);
  await context.setOffline(true);
  const offlineAlbum = await page.evaluate(() => fetch("/api/v1/albums/dev-album-1").then((r) => r.json()).then((j) => j.title ?? j.album?.title ?? "ok").catch(() => null));
  expect(offlineAlbum).not.toBeNull();
  await page.goto("/explore").catch(() => undefined);
  await expect(page.getByText(/offline/i).first()).toBeVisible();
  await context.setOffline(false);
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("artwork: verified CORS covers are cached and served from cache; opaque ones are bypassed", async ({ page, context }) => {
  let corsHits = 0;
  await context.route("https://lh3.googleusercontent.com/**", (r) => { corsHits++; return r.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG }); });
  // A CDN that refuses CORS for us (allows another origin only) → the worker can't verify it.
  await context.route("https://i.ytimg.com/**", (r) => r.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "https://someone-else.example" }, body: PNG }));
  await swReady(page);
  const load = (src: string) => page.evaluate((s) => new Promise<boolean>((res) => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = s; document.body.appendChild(i); }), src);
  const before = await stats(page);
  expect(await load("https://lh3.googleusercontent.com/cover-1=w120-h120")).toBe(true);
  await page.waitForTimeout(600);
  // A later visit (new document → no in-memory image cache): the worker answers from its cache.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const mid = await stats(page);
  expect(await load("https://lh3.googleusercontent.com/cover-1=w120-h120")).toBe(true);
  const s = await stats(page);
  expect(s.stats.hit).toBeGreaterThan(mid.stats.hit);
  expect(before.stats.miss).toBeLessThan(s.stats.miss);
  const cached = await page.evaluate(async () => (await (await caches.open((await caches.keys()).find((k) => k.endsWith("-art"))!)).keys()).map((r) => r.url));
  expect(cached).toContain("https://lh3.googleusercontent.com/cover-1=w120-h120");
  // Opaque (no CORS) cover: shown, but never stored.
  await load("https://i.ytimg.com/vi/x/hq.jpg");
  await page.waitForTimeout(400);
  const after = await page.evaluate(async () => (await (await caches.open((await caches.keys()).find((k) => k.endsWith("-art"))!)).keys()).map((r) => r.url));
  expect(after.some((u) => u.includes("ytimg"))).toBe(false);
  expect((await stats(page)).stats.bypassReasons["art-cors-failed"]).toBeGreaterThan(0);
});
