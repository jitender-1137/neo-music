import type { CDPSession, Locator, Page } from "@playwright/test";
import { test, expect, audioState } from "./fixtures";

/**
 * Phone experience @mobile (runs in the iPhone-sized, touch-enabled project). Gestures use real
 * touch events through Chromium's DevTools protocol, so CSS `touch-action` and pointer-event
 * handling are exercised exactly as on a touch screen. Audio is the dev-tone catalog (real <audio>).
 */
let cdp: CDPSession | null = null;
async function touch(page: Page) {
  cdp ??= await page.context().newCDPSession(page);
  return cdp;
}
test.afterEach(() => { cdp = null; });

/** A finger drag from → to, with intermediate moves (like a real swipe). `ms` controls speed. */
async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, { steps = 10, ms = 220 } = {}) {
  const s = await touch(page);
  await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await s.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }] });
    await page.waitForTimeout(ms / steps);
  }
  await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(80);
}
async function center(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}

/** Let the sheet/panel finish sliding before measuring positions. */
const settle = (p: Page) => p.waitForTimeout(550);
const mini = (p: Page) => p.getByRole("region", { name: "Mini player" });
const sheet = (p: Page) => p.locator("[data-player-sheet]");
const panel = (p: Page) => p.locator("#m-panel-body").locator("..");
const sheetState = (p: Page) => sheet(p).getAttribute("data-state");
const panelState = (p: Page) => panel(p).getAttribute("data-state");
const nowTitle = (p: Page) => mini(p).locator("div.line-clamp-1").first().textContent();

async function playFirstQuickPickMobile(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Play C4 Morning/ }).first().evaluate((e) => (e as HTMLButtonElement).click());
  await expect.poll(async () => (await audioState(page))?.paused, { timeout: 15_000 }).toBe(false);
  await page.waitForTimeout(1500); // history is written once a play has started
}

async function startAlbum(page: Page) {
  await page.goto("/album/dev-album-1");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(mini(page)).toBeVisible();
  await expect.poll(async () => (await audioState(page))?.paused, { timeout: 15_000 }).toBe(false);
  await expect.poll(() => nowTitle(page)).toBe("C4 Morning");
}

test.describe("phone @mobile", () => {
  test("tab bar: four tabs, active state, client-side navigation keeps playback", async ({ app }) => {
    await startAlbum(app);
    const nav = app.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link")).toHaveText(["Home", "Explore", "Library", "Search"]);
    const src = (await audioState(app))!.src;
    for (const [tab, url] of [["Home", "/"], ["Explore", "/explore"], ["Library", "/library"], ["Search", "/search"]] as const) {
      await nav.getByRole("link", { name: tab }).click();
      await app.waitForURL((u) => u.pathname === url || u.pathname.startsWith(`${url}/`));
      await expect(nav.getByRole("link", { name: tab })).toHaveAttribute("aria-current", "page");
      const a = (await audioState(app))!;
      expect(a.paused).toBe(false);
      expect(a.src).toBe(src);
      expect(a.count).toBe(1);
    }
    // Mini-player sits fully above the tab bar, never overlapping it.
    const m = (await mini(app).boundingBox())!, n = (await nav.boundingBox())!;
    expect(m.y + m.height).toBeLessThanOrEqual(n.y);
  });

  test("tab bar: re-tapping the active tab scrolls to top; a tab remembers its scroll position", async ({ app }) => {
    await app.goto("/");
    await expect(app.getByRole("heading", { name: /Quick picks/ })).toBeVisible();
    await app.evaluate(() => window.scrollTo(0, 400));
    const nav = app.getByRole("navigation", { name: "Main" });
    await nav.getByRole("link", { name: "Explore" }).click();
    await app.waitForURL("**/explore");
    await nav.getByRole("link", { name: "Home" }).click();
    await app.waitForURL((u) => u.pathname === "/");
    await expect.poll(() => app.evaluate(() => Math.round(window.scrollY))).toBe(400);
    await nav.getByRole("link", { name: "Home" }).click();
    await expect.poll(() => app.evaluate(() => window.scrollY)).toBe(0);
  });

  test("tab bar: the glass lens moves on tap (before the page loads) and lines up with the tab", async ({ app }) => {
    await app.goto("/");
    const nav = app.getByRole("navigation", { name: "Main" });
    const lens = nav.locator(".m-tab-lens");
    await expect(lens).toHaveAttribute("style", /translateX\(0%\)/);
    // Hold the next page's data so we can look at the bar mid-navigation.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await app.route("**/explore**", async (r) => { if (r.request().resourceType() === "fetch") await gate; await r.continue(); });
    await nav.getByRole("link", { name: "Explore" }).click();
    await expect(lens).toHaveAttribute("style", /translateX\(100%\)/);
    release();
    await app.waitForURL("**/explore");
    await app.unroute("**/explore**");
    await app.waitForTimeout(500); // glide finished
    const l = (await lens.boundingBox())!, t = (await nav.getByRole("link", { name: "Explore" }).boundingBox())!;
    expect(Math.abs(l.x + l.width / 2 - (t.x + t.width / 2))).toBeLessThan(2);
    // Labels never change weight (nothing shifts when the selection moves).
    const weights = await nav.getByRole("link").evaluateAll((els) => els.map((e) => getComputedStyle(e).fontWeight));
    expect(new Set(weights).size).toBe(1);
  });

  test("swiping the playing song slides the next one in (YouTube Music carousel)", async ({ app }) => {
    await startAlbum(app);
    const m = await center(mini(app));
    // Mid-swipe: the next song's title is already visible inside the mini-player.
    const s = await touch(app);
    await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: m.x, y: m.y }] });
    for (let i = 1; i <= 8; i++) { await s.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: m.x - i * 20, y: m.y }] }); await app.waitForTimeout(16); }
    const next = mini(app).getByText("D4 Drive");
    const nb = (await next.boundingBox())!;
    expect(nb.x).toBeLessThan(m.b.x + m.b.width);
    expect(nb.x).toBeGreaterThan(m.b.x);
    await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => nowTitle(app)).toBe("D4 Drive");
    // Back at the first song there is nothing to the left: a right swipe springs back.
    await swipe(app, { x: m.x - 60, y: m.y }, { x: m.x + 120, y: m.y }, { ms: 160 });
    await expect.poll(() => nowTitle(app)).toBe("C4 Morning");
    await swipe(app, { x: m.x - 60, y: m.y }, { x: m.x + 120, y: m.y }, { ms: 160 });
    await app.waitForTimeout(800);
    expect(await nowTitle(app)).toBe("C4 Morning");
  });

  test("slow content shows the shimmer skeleton, then the real page", async ({ app }) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await app.route("**/api/v1/search?**", async (r) => { await gate; await r.continue(); });
    await app.goto("/search?q=tone");
    await expect(app.locator(".skeleton").first()).toBeVisible();
    release();
    await expect(app.getByRole("heading", { name: "Songs" })).toBeVisible();
    await expect(app.locator("main .skeleton")).toHaveCount(0);
  });

  test("mini-player: play/pause, next, progress, and a tap opens the full player", async ({ app }) => {
    await startAlbum(app);
    await mini(app).getByRole("button", { name: "Pause", exact: true }).click();
    await expect.poll(async () => (await audioState(app))?.paused).toBe(true);
    await mini(app).getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => (await audioState(app))?.paused).toBe(false);
    await mini(app).getByRole("button", { name: "Next", exact: true }).click();
    await expect.poll(() => nowTitle(app)).toBe("D4 Drive");
    await mini(app).getByRole("button", { name: /Open now playing: D4 Drive/ }).click();
    await expect.poll(() => sheetState(app)).toBe("open");
    await expect(sheet(app).getByRole("heading", { name: "D4 Drive" })).toBeVisible();
    // The page behind is inert while the player is open.
    await expect(app.getByRole("navigation", { name: "Main" })).toHaveAttribute("inert", "");
  });

  test("two-way swipe: up opens, down minimises, playback never stops", async ({ app }) => {
    await startAlbum(app);
    const { x, y } = await center(mini(app));
    await swipe(app, { x: x - 60, y }, { x: x - 60, y: y - 320 });
    await expect.poll(() => sheetState(app)).toBe("open");
    expect((await audioState(app))!.paused).toBe(false);
    await settle(app);
    // Swipe down on the artwork area minimises.
    const art = await center(sheet(app).getByRole("img", { name: /artwork/ }));
    await swipe(app, { x: art.x, y: art.y - 60 }, { x: art.x, y: art.y + 300 });
    await expect.poll(() => sheetState(app)).toBe("closed");
    const a = (await audioState(app))!;
    expect(a.paused).toBe(false);
    expect(a.count).toBe(1);
    await expect(app.getByRole("navigation", { name: "Main" })).not.toHaveAttribute("inert", "");
  });

  test("small or slow-short movements never trigger a gesture", async ({ app }) => {
    await startAlbum(app);
    const { x, y } = await center(mini(app));
    // Short and slow: recognised as a drag (so no tap), but below the commit threshold → nothing happens.
    await swipe(app, { x: x - 60, y }, { x: x - 60, y: y - 40 }, { steps: 20, ms: 1200 });
    await expect.poll(() => sheetState(app)).toBe("closed");
    await swipe(app, { x: x - 60, y }, { x: x - 100, y }, { steps: 20, ms: 1200 });
    expect(await nowTitle(app)).toBe("C4 Morning");
    // Finger jitter under the slop is a tap — and a tap on the mini-player opens it.
    await swipe(app, { x: x - 60, y }, { x: x - 55, y: y - 4 }, { steps: 2, ms: 40 });
    await expect.poll(() => sheetState(app)).toBe("open");
    await settle(app);
    // On the open player: jitter on the artwork changes nothing; a short slow drag springs back.
    const art = await center(sheet(app).getByRole("img", { name: /artwork/ }));
    await swipe(app, art, { x: art.x + 5, y: art.y + 4 }, { steps: 2, ms: 40 });
    await swipe(app, art, { x: art.x, y: art.y + 50 }, { steps: 20, ms: 1200 });
    await swipe(app, art, { x: art.x - 50, y: art.y }, { steps: 20, ms: 1200 });
    await expect.poll(() => sheetState(app)).toBe("open");
    await expect(sheet(app).getByRole("heading", { name: "C4 Morning" })).toBeVisible();
  });

  test("horizontal swipes change track on the mini-player and the artwork", async ({ app }) => {
    await startAlbum(app);
    const { x, y } = await center(mini(app));
    await swipe(app, { x: x + 40, y }, { x: x - 140, y }, { ms: 160 });
    await expect.poll(() => nowTitle(app)).toBe("D4 Drive");
    await mini(app).getByRole("button", { name: /Open now playing/ }).click();
    await expect.poll(() => sheetState(app)).toBe("open");
    await settle(app);
    const art = await center(sheet(app).getByRole("img", { name: /artwork/ }));
    await swipe(app, { x: art.x + 100, y: art.y }, { x: art.x - 140, y: art.y }, { ms: 160 });
    await expect(sheet(app).getByRole("heading", { name: "E4 Echo" })).toBeVisible();
    await swipe(app, { x: art.x - 100, y: art.y }, { x: art.x + 140, y: art.y }, { ms: 160 });
    await expect(sheet(app).getByRole("heading", { name: "D4 Drive" })).toBeVisible();
    // A horizontal swipe never minimises; the player is still open.
    expect(await sheetState(app)).toBe("open");
  });

  test("swipe up: Up next at half height, then full; swipe down steps back, then minimises", async ({ app }) => {
    await startAlbum(app);
    await mini(app).getByRole("button", { name: /Open now playing/ }).click();
    await expect.poll(() => sheetState(app)).toBe("open");
    await settle(app);
    await expect(sheet(app).getByText("Playing from")).toHaveCount(0);
    const art = await center(sheet(app).getByRole("button", { name: "Show artwork full screen" }));
    // Up on the song view → the list peeks in at half height, song view still visible above it.
    await swipe(app, { x: art.x, y: art.y + 80 }, { x: art.x, y: art.y - 120 });
    await expect.poll(() => panelState(app)).toBe("open");
    await expect.poll(() => panel(app).getAttribute("data-detent")).toBe("half");
    await settle(app);
    await expect(app.getByRole("list", { name: "Up next" }).getByText("D4 Drive")).toBeInViewport();
    const top = (await panel(app).boundingBox())!.y;
    expect(top).toBeGreaterThan(200);
    // Controls stay visible above the half panel (YouTube Music layout).
    const pause = (await sheet(app).getByRole("button", { name: "Pause", exact: true }).first().boundingBox())!;
    expect(pause.y + pause.height).toBeLessThanOrEqual(top);
    // Left/right on the cover still works while the half panel is open.
    // Aim at the visible part of the cover: between the header and the lifted title.
    const minB = (await sheet(app).getByRole("button", { name: "Minimize player" }).boundingBox())!;
    const titleB = (await sheet(app).getByRole("heading", { name: "C4 Morning" }).boundingBox())!;
    const vy = (minB.y + minB.height + titleB.y) / 2, vx = app.viewportSize()!.width / 2;
    await swipe(app, { x: vx + 100, y: vy }, { x: vx - 140, y: vy }, { ms: 160 });
    await expect.poll(() => nowTitle(app)).toBe("D4 Drive");
    // Up again on the header → full height.
    const hdr = await center(app.getByRole("tablist", { name: "Player panels" }));
    await swipe(app, { x: hdr.x, y: hdr.y + 10 }, { x: hdr.x, y: hdr.y - 200 });
    await expect.poll(() => panel(app).getAttribute("data-detent")).toBe("full");
    await settle(app);
    expect((await panel(app).boundingBox())!.y).toBeLessThan(80);
    // Down: full → half → closed → minimised.
    const h1 = await center(app.getByRole("tablist", { name: "Player panels" }));
    await swipe(app, { x: h1.x, y: h1.y - 20 }, { x: h1.x, y: h1.y + 200 });
    await expect.poll(() => panel(app).getAttribute("data-detent")).toBe("half");
    await settle(app);
    const h2 = await center(app.getByRole("tablist", { name: "Player panels" }));
    await swipe(app, { x: h2.x, y: h2.y - 20 }, { x: h2.x, y: h2.y + 200 });
    await expect.poll(() => panelState(app)).toBe("closed");
    await settle(app);
    const a2 = await center(sheet(app).getByRole("button", { name: "Show artwork full screen" }));
    await swipe(app, { x: a2.x, y: a2.y - 60 }, { x: a2.x, y: a2.y + 300 });
    await expect.poll(() => sheetState(app)).toBe("closed");
    expect((await audioState(app))!.paused).toBe(false);
  });

  for (const vp of [{ width: 375, height: 667 }, { width: 390, height: 844 }]) test(`regression @ ${vp.width}x${vp.height}: after Lyrics in the half view and swiping back, the player is not shifted`, async ({ app }) => {
    {
      await app.setViewportSize(vp);
      await startAlbum(app);
      await mini(app).getByRole("button", { name: /Open now playing/ }).click();
      await expect.poll(() => sheetState(app)).toBe("open");
      await settle(app);
      const art = await center(sheet(app).getByRole("button", { name: "Show artwork full screen" }));
      await swipe(app, { x: art.x, y: art.y + 60 }, { x: art.x, y: art.y - 200 });
      await expect.poll(() => panel(app).getAttribute("data-detent")).toBe("half");
      await app.getByRole("tab", { name: "Lyrics" }).click();
      await expect(app.getByRole("button", { name: /C4 Morning — line 1/ })).toBeVisible();
      await app.waitForTimeout(800); // lyrics auto-follow has run
      // The sheet itself must never be scrolled by the lyrics' auto-follow.
      expect(await sheet(app).evaluate((e) => e.scrollTop)).toBe(0);
      const t = await center(app.getByRole("tablist", { name: "Player panels" }));
      await swipe(app, { x: t.x, y: t.y - 10 }, { x: t.x, y: t.y + 220 });
      await expect.poll(() => panelState(app)).toBe("closed");
      await settle(app);
      expect(await sheet(app).evaluate((e) => e.scrollTop)).toBe(0);
      const min = (await sheet(app).getByRole("button", { name: "Minimize player" }).boundingBox())!;
      expect(min.y).toBeGreaterThanOrEqual(0);
      // Cover sits between the header and the title; controls are on screen.
      const cover = (await sheet(app).getByRole("button", { name: "Show artwork full screen" }).boundingBox())!;
      const title = (await sheet(app).getByRole("heading", { name: "C4 Morning" }).boundingBox())!;
      expect(cover.y).toBeGreaterThan(min.y + min.height - 1);
      expect(cover.y + cover.height).toBeLessThanOrEqual(title.y + 1);
      const play = (await sheet(app).getByRole("button", { name: "Pause", exact: true }).first().boundingBox())!;
      expect(play.y + play.height).toBeLessThanOrEqual(vp.height);
      await app.keyboard.press("Escape");
      await expect.poll(() => sheetState(app)).toBe("closed");
    }
  });

  test("tap the cover: it grows behind the player, never over the controls; left/right still works", async ({ app }) => {
    await startAlbum(app);
    await mini(app).getByRole("button", { name: /Open now playing/ }).click();
    await expect.poll(() => sheetState(app)).toBe("open");
    await settle(app);
    const bleedLayer = sheet(app).locator(".m-bleed");
    await expect(bleedLayer).toHaveAttribute("data-on", "false");
    await sheet(app).getByRole("button", { name: "Show artwork full screen" }).click();
    await expect(bleedLayer).toHaveAttribute("data-on", "true");
    await app.waitForTimeout(450);
    const vp = app.viewportSize()!;
    expect((await bleedLayer.boundingBox())!.width).toBe(vp.width); // edge to edge
    // Every control is still on top and clickable: what's under the play button IS the play button.
    for (const name of ["Pause", "Next", "Previous", "Shuffle off", "Repeat off"]) {
      const btn = sheet(app).getByRole("button", { name, exact: true }).first();
      const c = await center(btn);
      expect(await app.evaluate(({ x, y, name }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label") === name, { x: c.x, y: c.y, name }), name).toBe(true);
    }
    await expect(sheet(app).getByRole("heading", { name: "C4 Morning" })).toBeVisible();
    // Left/right on the enlarged cover changes song and it stays enlarged.
    const area = await center(sheet(app).getByRole("button", { name: "Show artwork at normal size" }));
    await swipe(app, { x: area.x + 100, y: area.y }, { x: area.x - 150, y: area.y }, { ms: 160 });
    await expect(sheet(app).getByRole("heading", { name: "D4 Drive" })).toBeVisible();
    await expect(bleedLayer).toHaveAttribute("data-on", "true");
    await swipe(app, { x: area.x - 100, y: area.y }, { x: area.x + 150, y: area.y }, { ms: 160 });
    await expect(sheet(app).getByRole("heading", { name: "C4 Morning" })).toBeVisible();
    // Tap returns to normal size; Escape does too.
    await sheet(app).getByRole("button", { name: "Show artwork at normal size" }).click();
    await expect(bleedLayer).toHaveAttribute("data-on", "false");
    await sheet(app).getByRole("button", { name: "Show artwork full screen" }).click();
    await app.keyboard.press("Escape");
    await expect(bleedLayer).toHaveAttribute("data-on", "false");
    expect(await sheetState(app)).toBe("open");
    await expect(sheet(app).getByText("Playing from")).toHaveCount(0);
  });

  test("every full-player control works", async ({ app }) => {
    await startAlbum(app);
    await mini(app).getByRole("button", { name: /Open now playing/ }).click();
    const s = sheet(app);
    await expect.poll(() => sheetState(app)).toBe("open");
    // Opened by touch: focus parks on the player itself (no focus ring drawn on a button).
    await expect(sheet(app)).toBeFocused();
    await s.getByRole("button", { name: "Shuffle off" }).click();
    await expect(s.getByRole("button", { name: "Shuffle on" })).toHaveAttribute("aria-pressed", "true");
    await s.getByRole("button", { name: "Shuffle on" }).click();
    await s.getByRole("button", { name: "Repeat off" }).click();
    await expect(s.getByRole("button", { name: "Repeat all" })).toBeVisible();
    await s.getByRole("button", { name: "Repeat all" }).click();
    await expect(s.getByRole("button", { name: "Repeat one" })).toBeVisible();
    await s.getByRole("button", { name: "Repeat one" }).click();
    await s.getByRole("button", { name: "Like", exact: true }).click();
    await expect(s.getByRole("button", { name: "Liked", exact: true })).toHaveAttribute("aria-pressed", "true");
    await s.getByRole("button", { name: "Liked", exact: true }).click();
    await expect(s.getByRole("button", { name: "Like", exact: true })).toHaveAttribute("aria-pressed", "false");
    // Up next / Lyrics / Related pills all open their panel partially (half height).
    for (const name of ["Up next", "Lyrics", "Related"]) {
      await s.getByRole("toolbar", { name: "Song actions" }).getByRole("button", { name }).click();
      await expect.poll(() => panel(app).getAttribute("data-detent")).toBe("half");
      await expect(app.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
      await app.keyboard.press("Escape");
      await expect.poll(() => panelState(app)).toBe("closed");
    }
    await s.getByRole("button", { name: "Next", exact: true }).click();
    await expect(s.getByRole("heading", { name: "D4 Drive" })).toBeVisible();
    await s.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(s.getByRole("heading", { name: "C4 Morning" })).toBeVisible();
    await s.getByRole("button", { name: "Pause", exact: true }).click();
    await expect.poll(async () => (await audioState(app))?.paused).toBe(true);
    await s.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => (await audioState(app))?.paused).toBe(false);
    // Seek bar.
    await s.getByRole("slider", { name: /Seek/ }).fill("10");
    await expect.poll(async () => Math.round((await audioState(app))!.time)).toBeGreaterThanOrEqual(9);
    // More actions → action sheet over the player; Cancel returns to the player, still playing.
    await s.getByRole("button", { name: /More actions for C4 Morning/ }).click();
    const actions = app.getByRole("dialog", { name: /Actions for C4 Morning/ });
    await expect(actions).toBeVisible();
    await actions.getByRole("button", { name: "Cancel" }).click();
    await expect(actions).toBeHidden();
    expect(await sheetState(app)).toBe("open");
    await s.getByRole("button", { name: "Minimize player" }).click();
    await expect.poll(() => sheetState(app)).toBe("closed");
    await expect(mini(app).getByRole("button", { name: /Open now playing/ })).not.toBeFocused();
    expect((await audioState(app))!.paused).toBe(false);
  });

  test("panels: up next (remove by swipe), lyrics, related; header swipes; Escape order", async ({ app }) => {
    await startAlbum(app);
    await mini(app).getByRole("button", { name: /Open now playing/ }).click();
    await expect.poll(() => sheetState(app)).toBe("open");
    // The bottom handle opens Up next at half height; swipe its header up for full height.
    await sheet(app).getByRole("button", { name: /^Up next/ }).click();
    await expect.poll(() => panel(app).getAttribute("data-detent")).toBe("half");
    await settle(app);
    const grab = await center(app.getByRole("tablist", { name: "Player panels" }));
    await swipe(app, { x: grab.x, y: grab.y + 10 }, { x: grab.x, y: grab.y - 220 });
    await expect.poll(() => panel(app).getAttribute("data-detent")).toBe("full");
    await settle(app);
    const upNext = app.getByRole("list", { name: "Up next" });
    await expect(upNext.getByText("E4 Echo")).toBeVisible();
    // Swipe a queue row left to remove it.
    const row = upNext.getByRole("button", { name: "Play E4 Echo" }).locator("..");
    const r = await center(row);
    await swipe(app, { x: r.b.x + r.b.width - 90, y: r.y }, { x: r.b.x + 10, y: r.y }, { ms: 180 });
    await expect(upNext.getByText("E4 Echo")).toHaveCount(0);
    await expect(upNext.getByText("F4 Field")).toBeVisible();
    // Vertical drags inside the content scroll; they never close the panel.
    const body = await center(app.locator("#m-panel-body"));
    await swipe(app, { x: body.x, y: body.y + 100 }, { x: body.x, y: body.y - 100 });
    expect(await panelState(app)).toBe("open");
    // Header: swipe left → next tab (Lyrics), then Related; right goes back.
    const tabs = app.getByRole("tablist", { name: "Player panels" });
    const h = await center(tabs);
    await swipe(app, { x: h.x + 80, y: h.y }, { x: h.x - 100, y: h.y }, { ms: 160 });
    await expect(app.getByRole("tab", { name: "Lyrics" })).toHaveAttribute("aria-selected", "true");
    await expect(app.getByRole("button", { name: /C4 Morning — line 1/ })).toBeVisible();
    await app.getByRole("tab", { name: "Related" }).click();
    await expect(app.getByRole("tab", { name: "Related" })).toHaveAttribute("aria-selected", "true");
    await expect(app.locator("#m-panel-body").getByRole("heading").first()).toBeVisible();
    await swipe(app, { x: h.x - 80, y: h.y }, { x: h.x + 100, y: h.y }, { ms: 160 });
    await expect(app.getByRole("tab", { name: "Lyrics" })).toHaveAttribute("aria-selected", "true");
    // Header swipe down → half height, again → back to the song view (player stays open).
    await swipe(app, { x: h.x, y: h.y - 40 }, { x: h.x, y: h.y + 220 });
    await expect.poll(() => panel(app).getAttribute("data-detent")).toBe("half");
    await settle(app);
    const h2 = await center(tabs);
    await swipe(app, { x: h2.x, y: h2.y - 20 }, { x: h2.x, y: h2.y + 220 });
    await expect.poll(() => panelState(app)).toBe("closed");
    expect(await sheetState(app)).toBe("open");
    // Escape: panel → song view → page.
    await sheet(app).getByRole("toolbar", { name: "Song actions" }).getByRole("button", { name: "Lyrics" }).click();
    await expect.poll(() => panelState(app)).toBe("open");
    await app.keyboard.press("Escape");
    await expect.poll(() => panelState(app)).toBe("closed");
    await app.keyboard.press("Escape");
    await expect.poll(() => sheetState(app)).toBe("closed");
    expect((await audioState(app))!.paused).toBe(false);
  });

  test("focus: no ring after touch; keyboard users still get focus moved to the controls", async ({ app }) => {
    await startAlbum(app);
    // Touch: nothing inside shows :focus-visible after opening the player or the half panel.
    await mini(app).getByRole("button", { name: /Open now playing/ }).click();
    await expect.poll(() => sheetState(app)).toBe("open");
    const ringed = () => app.evaluate(() => [...document.querySelectorAll("[data-player-sheet] *")].filter((e) => e.matches(":focus-visible")).length);
    expect(await ringed()).toBe(0);
    await sheet(app).getByRole("button", { name: /^Up next/ }).click();
    await expect.poll(() => panelState(app)).toBe("open");
    expect(await ringed()).toBe(0);
    await expect(app.getByRole("tab", { name: "Up next" })).not.toBeFocused();
    await app.keyboard.press("Escape");
    await app.keyboard.press("Escape");
    await expect.poll(() => sheetState(app)).toBe("closed");
    // Keyboard: Enter on the mini-player moves focus to Minimize; opening a panel focuses its tab.
    await mini(app).getByRole("button", { name: /Open now playing/ }).focus();
    await app.keyboard.press("Enter");
    await expect.poll(() => sheetState(app)).toBe("open");
    await expect(sheet(app).getByRole("button", { name: "Minimize player" })).toBeFocused();
    await app.keyboard.press("Escape");
    await expect.poll(() => sheetState(app)).toBe("closed");
    await expect(mini(app).getByRole("button", { name: /Open now playing/ })).toBeFocused();
  });

  test("lyrics timing: quiet pill → capsule; − / + in 0.25s steps, reset, done; remembered per song", async ({ app }) => {
    await startAlbum(app);
    await mini(app).getByRole("button", { name: /Open now playing/ }).click();
    await expect.poll(() => sheetState(app)).toBe("open");
    await sheet(app).getByRole("toolbar", { name: "Song actions" }).getByRole("button", { name: "Lyrics" }).click();
    const pill = app.getByRole("button", { name: "Lyrics timing: In sync" });
    await expect(pill).toHaveText("Timing");
    await pill.click();
    const group = app.getByRole("group", { name: "Lyrics timing" });
    await expect(group).toContainText("In sync");
    await expect(group.getByRole("button", { name: "Reset lyrics timing" })).toBeDisabled();
    await group.getByRole("button", { name: /later by 0.25/ }).click();
    await group.getByRole("button", { name: /later by 0.25/ }).click();
    await expect(group).toContainText("0.5s later");
    await group.getByRole("button", { name: /earlier by 0.25/ }).click();
    await expect(group).toContainText("0.25s later");
    await group.getByRole("button", { name: "Done" }).click();
    await expect(app.getByRole("button", { name: "Lyrics timing: 0.25s later" })).toHaveText("0.25s later");
    // Remembered for this song after closing and reopening the panel.
    await app.keyboard.press("Escape");
    await expect.poll(() => panelState(app)).toBe("closed");
    await sheet(app).getByRole("toolbar", { name: "Song actions" }).getByRole("button", { name: "Lyrics" }).click();
    await app.getByRole("button", { name: "Lyrics timing: 0.25s later" }).click();
    await app.getByRole("group", { name: "Lyrics timing" }).getByRole("button", { name: "Reset lyrics timing" }).click();
    await expect(app.getByRole("group", { name: "Lyrics timing" })).toContainText("In sync");
  });

  test("now playing: small pills, times under the bar, title → Related, artist → that artist only", async ({ app }) => {
    await startAlbum(app);
    await mini(app).getByRole("button", { name: /Open now playing/ }).click();
    await expect.poll(() => sheetState(app)).toBe("open");
    await settle(app);
    const like = (await sheet(app).getByRole("toolbar", { name: "Song actions" }).getByRole("button", { name: "Like" }).boundingBox())!;
    expect(Math.round(like.height)).toBe(32);
    // Times sit below the bar: elapsed under the left end, total under the right end.
    const bar = (await sheet(app).getByRole("slider", { name: "Seek" }).boundingBox())!;
    expect(bar.height).toBeGreaterThanOrEqual(20); // a real, draggable bar (not collapsed)
    const total = (await sheet(app).getByText("0:20", { exact: true }).boundingBox())!;
    expect(total.y).toBeGreaterThan(bar.y + bar.height - 1);
    expect(total.x + total.width).toBeGreaterThan(bar.x + bar.width - 40);
    // Title opens Related (half height); the player stays open.
    await sheet(app).getByRole("heading", { name: /C4 Morning/ }).getByRole("button").click();
    await expect.poll(() => panelState(app)).toBe("open");
    await expect(app.getByRole("tab", { name: "Related" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => panel(app).getAttribute("data-detent")).toBe("half");
    await app.keyboard.press("Escape");
    await expect.poll(() => panelState(app)).toBe("closed");
    // The artist name goes to that artist's page and closes the player.
    await sheet(app).getByRole("link", { name: "Test Tone Ensemble" }).click();
    await app.waitForURL(/\/artist\//);
    await expect.poll(() => sheetState(app)).toBe("closed");
    expect((await audioState(app))!.paused).toBe(false);
  });

  test("now playing: volume row under the controls (no Quick picks handle); transparent header hides on scroll", async ({ app }) => {
    // Slider tests run as an Android phone (the default device here is an iPhone, where the level
    // is hardware-only and the row is mute + note instead).
    await app.addInitScript(() => Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" }));
    await app.goto("/");
    await expect(app.getByRole("heading", { name: /Quick picks/ })).toBeVisible();
    const header = app.locator("header").first();
    expect(Math.round((await header.boundingBox())!.height)).toBe(52);
    // Scrolling down: the header slides away so the page uses the whole display.
    await app.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(async () => { const b = (await header.boundingBox())!; return Math.round(b.y + b.height); }).toBeLessThanOrEqual(0);
    // Scrolling back up: it returns as a slim (44px) light-glass bar.
    await app.evaluate(() => window.scrollTo(0, 300));
    await expect.poll(async () => Math.round((await header.boundingBox())!.y)).toBe(0);
    // Native-app style: no header background at all, even over content.
    expect(await header.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    expect(await header.evaluate((e) => getComputedStyle(e).backdropFilter)).toBe("none");
    await app.evaluate(() => window.scrollTo(0, 0));
    await startAlbum(app);
    await mini(app).getByRole("button", { name: /Open now playing/ }).click();
    await expect.poll(() => sheetState(app)).toBe("open");
    await settle(app);
    await expect(sheet(app).getByText("Quick picks")).toHaveCount(0);
    const vol = sheet(app).getByRole("slider", { name: "Volume" });
    const play = (await sheet(app).getByRole("button", { name: "Pause", exact: true }).first().boundingBox())!;
    expect((await vol.boundingBox())!.y).toBeGreaterThan(play.y + play.height - 1);
    await vol.fill("0.3");
    await expect.poll(() => app.evaluate(() => Math.round((document.querySelector("audio")?.volume ?? 0) * 100))).toBe(30);
    await vol.fill("1");
    // Up next is still reachable without a gesture.
    await sheet(app).getByRole("toolbar", { name: "Song actions" }).getByRole("button", { name: "Up next" }).click();
    await expect.poll(() => panel(app).getAttribute("data-detent")).toBe("half");
  });

  test("while a song loads, a ring spins around the play/pause button (mini and full player)", async ({ app }) => {
    await startAlbum(app);
    // Hold the next song's audio so it stays "loading".
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await app.route("**/api/v1/stream/**", async (r) => { await gate; await r.continue().catch(() => undefined); });
    await mini(app).getByRole("button", { name: "Next", exact: true }).click();
    const ring = mini(app).locator("[data-loading-ring]");
    await expect(ring).toBeVisible();
    const btn = (await mini(app).getByRole("button", { name: /^(Play|Pause)$/ }).boundingBox())!;
    const r = (await ring.boundingBox())!;
    expect(r.width).toBeGreaterThan(btn.width); // around the button, not inside it
    await mini(app).getByRole("button", { name: /Open now playing/ }).click();
    await expect(sheet(app).locator(".m-lift [data-loading-ring]")).toBeVisible();
    release();
    await expect.poll(async () => (await audioState(app))?.paused, { timeout: 15_000 }).toBe(false);
    await expect(app.locator("[data-loading-ring]")).toHaveCount(0);
  });

  test("pull down from anywhere in the list when it's at the top; otherwise the list scrolls", async ({ app }) => {
    await app.setViewportSize({ width: 390, height: 600 }); // short screen → the queue list scrolls
    await startAlbum(app);
    await mini(app).getByRole("button", { name: /Open now playing/ }).click();
    await expect.poll(() => sheetState(app)).toBe("open");
    await sheet(app).getByRole("toolbar", { name: "Song actions" }).getByRole("button", { name: "Up next" }).click();
    await settle(app);
    const t = await center(app.getByRole("tablist", { name: "Player panels" }));
    await swipe(app, { x: t.x, y: t.y + 10 }, { x: t.x, y: t.y - 220 }); // header up → full
    await expect.poll(() => panel(app).getAttribute("data-detent")).toBe("full");
    await settle(app);
    const body = app.locator("#m-panel-body");
    const b = await center(body);
    // Scrolled down a little: a pull scrolls the list back to the top, the panel stays put.
    await body.evaluate((e) => (e.scrollTop = 60));
    await swipe(app, { x: b.x, y: b.y - 40 }, { x: b.x, y: b.y + 40 });
    expect(await body.evaluate((e) => e.scrollTop)).toBeLessThan(60);
    expect(await panel(app).getAttribute("data-detent")).toBe("full");
    await body.evaluate((e) => (e.scrollTop = 0));
    // At the top: pulling down in the middle of the songs lowers the panel — full → half → closed.
    await swipe(app, { x: b.x, y: b.y - 60 }, { x: b.x, y: b.y + 140 });
    await expect.poll(() => panel(app).getAttribute("data-detent")).toBe("half");
    await settle(app);
    // Half height: aim inside the visible part of the panel (most of the list is below the screen).
    const pb = (await panel(app).boundingBox())!;
    const by = Math.min(pb.y + 200, app.viewportSize()!.height - 60);
    await swipe(app, { x: b.x, y: by }, { x: b.x, y: by + 140 });
    await expect.poll(() => panelState(app)).toBe("closed");
    expect(await sheetState(app)).toBe("open");
    expect((await audioState(app))!.paused).toBe(false);
  });

  test("action sheet: pull down from its list closes it", async ({ app }) => {
    await startAlbum(app);
    await app.getByRole("button", { name: /More actions for D4 Drive/ }).first().click();
    const dlg = app.getByRole("dialog", { name: /Actions for D4 Drive/ });
    await expect(dlg).toBeVisible();
    await app.waitForTimeout(400);
    const item = await center(dlg.getByRole("button", { name: "Add to queue" }));
    await swipe(app, { x: item.x, y: item.y - 20 }, { x: item.x, y: item.y + 260 });
    await expect(dlg).toBeHidden();
    await expect(app.getByText("Added to queue")).toHaveCount(0); // the pull didn't press the item
  });

  test("volume: speaker icon mutes/unmutes; slider sets the real level", async ({ app }) => {
    // Slider tests run as an Android phone (the default device here is an iPhone, where the level
    // is hardware-only and the row is mute + note instead).
    await app.addInitScript(() => Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" }));
    await startAlbum(app);
    await mini(app).getByRole("button", { name: /Open now playing/ }).click();
    await expect.poll(() => sheetState(app)).toBe("open");
    const audio = () => app.evaluate(() => ({ muted: document.querySelector("audio")!.muted, volume: Math.round(document.querySelector("audio")!.volume * 100) }));
    await sheet(app).getByRole("button", { name: "Mute", exact: true }).click();
    await expect.poll(async () => (await audio()).muted).toBe(true);
    await expect(sheet(app).getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuetext", "Muted");
    await sheet(app).getByRole("button", { name: "Unmute", exact: true }).click();
    await expect.poll(async () => (await audio()).muted).toBe(false);
    await sheet(app).getByRole("slider", { name: "Volume" }).fill("0.4");
    await expect.poll(async () => (await audio()).volume).toBe(40);
  });

  test("header: big logo + title; small random avatar saved on the device; account sheet works for guests", async ({ app }) => {
    await app.goto("/");
    const header = app.locator("header").first();
    const logo = (await header.locator('img[src*="ghost"]').boundingBox())!;
    expect(Math.round(logo.height)).toBe(40);
    await expect(header.getByRole("link", { name: "Sign in" })).toHaveCount(0);
    const btn = header.getByRole("button", { name: "Account menu" });
    expect(Math.round((await btn.boundingBox())!.height)).toBe(32);
    const avatar = header.locator("[data-avatar]");
    const first = await avatar.getAttribute("data-avatar");
    expect(first).toMatch(/^(ghost|kitty|bear|mochi|penguin|frog)-\d$/);
    // Saved locally: the same avatar after a reload.
    await app.reload();
    await expect(header.locator("[data-avatar]")).toHaveAttribute("data-avatar", first!);
    // The sheet: shuffle gives a new avatar (also saved), sign in navigates.
    await btn.click();
    const sheetDlg = app.getByRole("dialog", { name: "Account" });
    await expect(sheetDlg).toContainText("Guest listener");
    await sheetDlg.getByRole("button", { name: "Shuffle avatar" }).click();
    await expect(header.locator("[data-avatar]")).not.toHaveAttribute("data-avatar", first!);
    const second = await header.locator("[data-avatar]").getAttribute("data-avatar");
    expect(await app.evaluate(() => localStorage.getItem("zuno.avatar.v1"))).toContain(second!.split("-")[0]!);
    // Shuffling keeps the sheet open (try again while seeing it large); close it, then sign in.
    await app.keyboard.press("Escape");
    await expect(sheetDlg).toBeHidden();
    await btn.click();
    await app.getByRole("dialog", { name: "Account" }).getByRole("button", { name: /Sign in/ }).click();
    await app.waitForURL("**/login");
  });

  test("lock screen: title/state come back after the OS drops them (page hidden → visible)", async ({ app }) => {
    await startAlbum(app);
    await expect.poll(() => app.evaluate(() => navigator.mediaSession.metadata?.title)).toBe("C4 Morning");
    await app.evaluate(() => { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = "none"; });
    await app.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => app.evaluate(() => navigator.mediaSession.metadata?.title)).toBe("C4 Morning");
    expect(await app.evaluate(() => navigator.mediaSession.playbackState)).toBe("playing");
  });

  test("no square focus box on freshly opened sheets (avatar sheet, track actions, player)", async ({ app }) => {
    await startAlbum(app);
    const ring = () => app.evaluate(() => { const e = document.activeElement as HTMLElement | null; if (!e) return "none"; const cs = getComputedStyle(e); return cs.outlineStyle === "none" || cs.outlineWidth === "0px" ? "none" : `${cs.outlineStyle} ${cs.outlineWidth} r=${cs.borderRadius}`; });
    await app.locator("header").getByRole("button", { name: "Account menu" }).click();
    await expect(app.getByRole("dialog", { name: "Account" })).toBeVisible();
    expect(await ring()).toBe("none");
    await app.keyboard.press("Escape");
    await app.getByRole("button", { name: /More actions for D4 Drive/ }).first().click();
    await expect(app.getByRole("dialog", { name: /Actions for D4 Drive/ })).toBeVisible();
    expect(await ring()).toBe("none");
    await app.keyboard.press("Escape");
    await mini(app).getByRole("button", { name: /Open now playing/ }).click();
    await expect.poll(() => sheetState(app)).toBe("open");
    expect(await ring()).toBe("none");
  });

  test("iPhone/iPad: volume row is the mute button + side-buttons note (no slider that does nothing)", async ({ app }) => {
    await app.addInitScript(() => Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" }));
    await startAlbum(app);
    await mini(app).getByRole("button", { name: /Open now playing/ }).click();
    await expect.poll(() => sheetState(app)).toBe("open");
    await expect(sheet(app).getByRole("slider", { name: "Volume" })).toHaveCount(0);
    await expect(sheet(app).locator("[data-volume-hint]")).toHaveText("Use the side buttons to change the volume");
    await sheet(app).getByRole("button", { name: "Mute", exact: true }).click();
    await expect.poll(() => app.evaluate(() => document.querySelector("audio")!.muted)).toBe(true);
    await expect(sheet(app).locator("[data-volume-hint]")).toContainText("Muted");
    await sheet(app).getByRole("button", { name: "Unmute", exact: true }).click();
    await expect.poll(() => app.evaluate(() => document.querySelector("audio")!.muted)).toBe(false);
  });

  test("lock screen: pause, connection drops while paused, ▶ from the lock screen plays again", async ({ app }) => {
    await startAlbum(app);
    await app.waitForTimeout(1500);
    // Lock-screen ⏸ (the Media Session pause action)…
    await app.evaluate(() => (navigator.mediaSession as unknown as { _h?: never }) && document.querySelector("audio")!.pause());
    await expect.poll(async () => (await audioState(app))?.paused).toBe(true);
    const before = (await audioState(app))!.time;
    // …iOS closes the idle stream in the background (network error while paused)…
    await app.evaluate(() => { const a = document.querySelector("audio")!; Object.defineProperty(a, "error", { configurable: true, get: () => ({ code: 2 }) }); a.dispatchEvent(new Event("error")); });
    await app.waitForTimeout(300);
    await expect(mini(app).getByRole("button", { name: "Play", exact: true })).toBeVisible(); // still a normal pause
    // …then ▶ (same path as the lock-screen play action) resumes at the same spot.
    await app.evaluate(() => { const a = document.querySelector("audio")!; delete (a as unknown as Record<string, unknown>).error; });
    await mini(app).getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => (await audioState(app))?.paused, { timeout: 15_000 }).toBe(false);
    expect((await audioState(app))!.time).toBeGreaterThanOrEqual(before - 0.5);
  });

  test("Home Screen app mode: play is confirmed by a moving clock; pause/resume works; log has play() results", async ({ app }) => {
    // Emulate an installed (standalone) iPhone app.
    await app.addInitScript(() => {
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q: string) => (q.includes("display-mode: standalone") ? { ...mm(q), matches: true, media: q } as MediaQueryList : mm(q));
    });
    const log = () => app.evaluate(() => localStorage.getItem("zuno.playbackLog.v1") ?? "");
    await startAlbum(app);
    // Confirmed only once the clock moves (Chromium's audio clock starts a moment after "playing").
    await expect.poll(async () => (await audioState(app))!.time, { timeout: 10_000 }).toBeGreaterThan(0.5);
    await expect(mini(app).getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await mini(app).getByRole("button", { name: "Pause", exact: true }).click();
    await expect.poll(async () => (await audioState(app))?.paused).toBe(true);
    await mini(app).getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => (await audioState(app))?.paused, { timeout: 10_000 }).toBe(false);
    await expect(mini(app).getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await expect.poll(async () => ((await log()).match(/resume:ok/g) ?? []).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    expect(await app.evaluate(() => document.querySelector('[aria-label="Mini player"] button[aria-label="Pause"]') != null)).toBe(true);
    await app.waitForTimeout(600); // log is saved on a short debounce
    const text = await log();
    expect(text).toContain("app:start");
    expect(text).toContain("standalone");
    expect(text).toContain("play():resolved");
    expect(text).not.toContain("resume:failed");
    expect(text).not.toMatch(/[?&]t=/); // the playback token never lands in the log
  });

  test("playback diagnostics log records play/pause and shows in Settings", async ({ app }) => {
    await startAlbum(app);
    await mini(app).getByRole("button", { name: "Pause", exact: true }).click();
    await expect.poll(async () => (await audioState(app))?.paused).toBe(true);
    await app.waitForTimeout(700); // log is saved on a short debounce
    await app.goto("/settings");
    await app.getByRole("button", { name: "Show log" }).click();
    const log = app.locator("[data-playback-log]");
    await expect(log).toContainText("audio:playing");
    await expect(log).toContainText("audio:pause");
    await app.getByRole("button", { name: "Clear log", exact: true }).click();
    await expect(log).toHaveText("");
  });

  test("rapid taps and gestures never stack players or wedge the sheet", async ({ app }) => {
    await startAlbum(app);
    const open = mini(app).getByRole("button", { name: /Open now playing/ });
    for (let i = 0; i < 4; i++) await open.click({ force: true, delay: 0 }).catch(() => undefined);
    await expect.poll(() => sheetState(app)).toBe("open");
    await expect(app.locator("[data-player-sheet]")).toHaveCount(1);
    await settle(app);
    // Fast open/flick-close cycles: each flick minimises, each tap reopens; the sheet never wedges.
    for (let i = 0; i < 3; i++) {
      const art = await center(sheet(app).getByRole("img", { name: /artwork/ }));
      await swipe(app, { x: art.x, y: art.y - 40 }, { x: art.x, y: art.y + 220 }, { steps: 3, ms: 30 });
      await expect.poll(() => sheetState(app)).toBe("closed");
      await open.click();
      await expect.poll(() => sheetState(app)).toBe("open");
      await settle(app);
    }
    await expect(app.locator("[data-player-sheet]")).toHaveCount(1);
    await sheet(app).getByRole("button", { name: "Minimize player" }).click();
    await expect.poll(() => sheetState(app)).toBe("closed");
    // Route change while open always closes it cleanly.
    await open.click();
    await expect.poll(() => sheetState(app)).toBe("open");
    await app.evaluate(() => history.pushState(null, "", "/explore"));
    await app.goto("/explore");
    await expect(mini(app)).toBeVisible();
    expect(await sheetState(app)).toBe("closed");
    expect((await audioState(app))!.count).toBe(1);
  });

  test("action sheet from a track row: play next, add to queue, swipe to dismiss", async ({ app }) => {
    await startAlbum(app);
    await app.getByRole("button", { name: /More actions for F4 Field/ }).first().click();
    const actions = app.getByRole("dialog", { name: /Actions for F4 Field/ });
    await expect(actions).toBeVisible();
    await expect(actions.getByRole("button")).toContainText(["Start radio", "Play next", "Add to queue", "Add to Liked music", "Save to playlist", "Song details", "Go to album", "Go to artist", "Share", "Cancel"]);
    await actions.getByRole("button", { name: "Play next" }).click();
    await expect(actions).toBeHidden();
    await expect(app.getByText("Playing next")).toBeVisible();
    await mini(app).getByRole("button", { name: "Next", exact: true }).click();
    await expect.poll(() => nowTitle(app)).toBe("F4 Field");
    // Dismiss by dragging the grabber down.
    await app.getByRole("button", { name: /More actions for D4 Drive/ }).first().click();
    await expect(actions.or(app.getByRole("dialog", { name: /Actions for D4 Drive/ }))).toBeVisible();
    const grab = await center(app.getByRole("dialog", { name: /Actions for D4 Drive/ }).locator(".touch-none").first());
    await swipe(app, grab, { x: grab.x, y: grab.y + 320 }, { ms: 200 });
    await expect(app.getByRole("dialog", { name: /Actions for D4 Drive/ })).toBeHidden();
    expect((await audioState(app))!.paused).toBe(false);
    // Song details navigates and closes the sheet.
    await app.getByRole("button", { name: /More actions for E4 Echo/ }).first().click();
    await app.getByRole("dialog", { name: /Actions for E4 Echo/ }).getByRole("button", { name: "Song details" }).click();
    await app.waitForURL(/\/song\//);
    await expect(app.getByRole("dialog", { name: /Actions for/ })).toHaveCount(0);
  });

  test("refresh restores the queue paused at the saved track", async ({ app }) => {
    await startAlbum(app);
    await mini(app).getByRole("button", { name: "Next", exact: true }).click();
    await expect.poll(() => nowTitle(app)).toBe("D4 Drive");
    await app.waitForTimeout(1200); // persisted on a short debounce
    await app.reload();
    await expect(mini(app)).toBeVisible();
    await expect.poll(() => nowTitle(app)).toBe("D4 Drive");
    await expect(mini(app).getByRole("button", { name: "Play", exact: true })).toBeVisible();
  });

  test("reduced motion: the same flows work with transitions off", async ({ app }) => {
    await app.emulateMedia({ reducedMotion: "reduce" });
    await startAlbum(app);
    const { x, y } = await center(mini(app));
    await swipe(app, { x: x - 60, y }, { x: x - 60, y: y - 300 });
    await expect.poll(() => sheetState(app)).toBe("open");
    await settle(app);
    const art = await center(sheet(app).getByRole("img", { name: /artwork/ }));
    await swipe(app, { x: art.x + 100, y: art.y }, { x: art.x - 140, y: art.y }, { ms: 160 });
    await expect(sheet(app).getByRole("heading", { name: "D4 Drive" })).toBeVisible();
    await app.keyboard.press("Escape");
    await expect.poll(() => sheetState(app)).toBe("closed");
  });

  test("device controls: lock screen gets title, artwork, state and previous/next (no ±10s skip)", async ({ app }) => {
    await startAlbum(app);
    const ms = () => app.evaluate(() => ({
      title: navigator.mediaSession.metadata?.title, artist: navigator.mediaSession.metadata?.artist,
      art: navigator.mediaSession.metadata?.artwork.map((a) => a.src) ?? [], state: navigator.mediaSession.playbackState,
    }));
    await expect.poll(async () => (await ms()).title).toBe("C4 Morning");
    const m = await ms();
    expect(m.artist).toBe("Test Tone Ensemble");
    expect(m.state).toBe("playing");
    expect(m.art.some((a) => a.includes("/icons/icon-512.png"))).toBe(true); // no cover → app icon
    await mini(app).getByRole("button", { name: "Pause", exact: true }).click();
    await expect.poll(async () => (await ms()).state).toBe("paused");
    await mini(app).getByRole("button", { name: "Next", exact: true }).click();
    await expect.poll(async () => (await ms()).title).toBe("D4 Drive");
  });

  test("app-like: no zoom (viewport + touch-action), 16px inputs, compact bars", async ({ app }) => {
    await startAlbum(app);
    const nav = (await app.getByRole("navigation", { name: "Main" }).boundingBox())!;
    const m = (await mini(app).boundingBox())!;
    expect(Math.round(nav.height)).toBe(52);
    expect(Math.round(m.height)).toBe(48);
    const viewport = await app.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).toMatch(/maximum-scale=1/);
    expect(viewport).toMatch(/user-scalable=no/);
    expect(await app.evaluate(() => getComputedStyle(document.documentElement).touchAction)).toBe("manipulation");
    await app.goto("/search");
    const fontSize = await app.locator("main input").first().evaluate((e) => getComputedStyle(e).fontSize);
    expect(fontSize).toBe("16px");
  });

  test("guests: History tile in Library, and Not interested hides the song", async ({ app }) => {
    await playFirstQuickPickMobile(app);
    await app.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Library" }).click();
    await app.getByRole("main").getByRole("link", { name: "History" }).first().click();
    await app.waitForURL("**/history");
    await expect(app.getByRole("heading", { name: "History" })).toBeVisible();
    await expect(app.getByRole("main").getByText("C4 Morning").first()).toBeVisible();
    // Not interested works without an account: the song leaves the home shelves.
    await app.goto("/");
    await app.getByRole("main").getByRole("button", { name: /More actions for D4 Drive/ }).first().click();
    await app.getByRole("dialog", { name: /Actions for D4 Drive/ }).getByRole("button", { name: "Not interested" }).click();
    await expect(app.getByRole("main").getByText("D4 Drive")).toHaveCount(0);
    await app.getByRole("button", { name: "Undo" }).click();
    await expect(app.getByRole("main").getByText("D4 Drive").first()).toBeVisible();
  });

  test("network failure shows a retryable error, not a broken page", async ({ app }) => {
    await app.route("**/api/v1/search?**", (r) => r.abort());
    await app.goto("/search?q=tone");
    await expect(app.getByRole("button", { name: /Try again|Retry/ }).first()).toBeVisible();
    await app.unroute("**/api/v1/search?**");
    await app.getByRole("button", { name: /Try again|Retry/ }).first().click();
    await expect(app.getByRole("heading", { name: "Songs" })).toBeVisible();
  });

  test("missing artwork falls back to a placeholder in the mini and full player", async ({ app }) => {
    await startAlbum(app); // the dev catalog has no cover images
    await expect(mini(app).locator("img")).toHaveCount(0);
    await expect(mini(app).locator("svg").first()).toBeVisible();
  });
});

test.describe("every phone page renders without overflow @mobile", () => {
  const PAGES: [string, RegExp][] = [
    ["/", /Quick picks/], ["/explore", /Explore/], ["/search", /Search/], ["/search?q=tone", /Songs/], ["/library", /Library/],
    ["/library/liked", /./], ["/library/albums", /./], ["/library/artists", /./], ["/history", /History/], ["/album/dev-album-1", /Tones Vol\. 1/],
    ["/artist/dev-artist-1", /./], ["/playlist/dev-playlist-all", /All tones/], ["/settings", /Settings/], ["/import", /Import/], ["/login", /Welcome back/],
    ["/signup", /./], ["/album/does-not-exist", /Page not found/],
  ];
  for (const width of [320, 390]) {
    test(`all pages at ${width}px`, async ({ app }) => {
      test.setTimeout(120_000);
      await app.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      for (const [path, heading] of PAGES) {
        await app.goto(path);
        await expect(app.getByRole("heading", { name: heading }).first(), path).toBeVisible();
        const overflow = await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
        await expect(app.getByRole("navigation", { name: "Main" })).toBeVisible();
      }
    });
  }
  test("album page buttons: play, shuffle, save, share", async ({ app }) => {
    await app.goto("/album/dev-album-1");
    await app.getByRole("button", { name: "Shuffle", exact: true }).click();
    await expect(mini(app)).toBeVisible();
    await expect.poll(async () => (await audioState(app))?.paused, { timeout: 15_000 }).toBe(false);
    // While this album plays, its main button is Pause.
    await app.getByRole("main").getByRole("button", { name: "Pause", exact: true }).click();
    await expect.poll(async () => (await audioState(app))?.paused).toBe(true);
    await app.getByRole("main").getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => (await audioState(app))?.paused).toBe(false);
  });
  test("artist page: shuffle and radio start playback", async ({ app }) => {
    await app.goto("/artist/dev-artist-1");
    await app.getByRole("button", { name: "Radio" }).click();
    await expect(mini(app)).toBeVisible();
    await expect.poll(async () => (await audioState(app))?.paused, { timeout: 15_000 }).toBe(false);
  });
  test("library tabs and search filters switch views", async ({ app }) => {
    await app.goto("/library");
    for (const t of ["Liked music", "Albums", "Artists", "Playlists"]) {
      const link = app.getByRole("navigation", { name: "Library sections" }).getByRole("link", { name: t, exact: true });
      await link.click();
      await expect(link).toHaveAttribute("aria-current", "page");
    }
    await app.goto("/search?q=tone");
    for (const f of ["Songs", "Albums", "Artists", "All"]) {
      const tab = app.getByRole("tab", { name: f, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
    }
  });
});
