import { test, expect, audioState, playFirstQuickPick } from "./fixtures";

test.describe("guest listening", () => {
  test("home renders development catalog with a clear dev label", async ({ app }) => {
    await app.goto("/");
    await expect(app.getByRole("heading", { name: /Quick picks \(development tones\)/ })).toBeVisible();
  });

  test("play, pause, resume, seek, next, previous", async ({ app }) => {
    await playFirstQuickPick(app);
    const bar = app.getByRole("region", { name: "Player" });
    await expect(bar.getByText("C4 Morning")).toBeVisible();
    await bar.getByRole("button", { name: "Pause", exact: true }).click();
    await expect.poll(async () => (await audioState(app))?.paused).toBe(true);
    await bar.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => (await audioState(app))?.paused).toBe(false);
    // Seek with the accessible range input.
    await app.evaluate(() => { const a = document.querySelector("audio")!; a.currentTime = 10; });
    await expect.poll(async () => Math.round((await audioState(app))!.time)).toBeGreaterThanOrEqual(10);
    await bar.getByRole("button", { name: "Next", exact: true }).click();
    await expect(bar.getByText(/D4 Drive|E4 Echo|F4 Field|G4 Glow|A4 Air|B4 Blue|C5 Climb/)).toBeVisible();
    await bar.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(bar.getByText("C4 Morning")).toBeVisible();
    expect((await audioState(app))!.count).toBe(1);
  });

  test("playback continues across client-side navigation", async ({ app }) => {
    await playFirstQuickPick(app);
    const before = (await audioState(app))!.src;
    await app.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Explore" }).click();
    await app.waitForURL("**/explore");
    await app.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Library" }).click();
    await app.waitForURL("**/library/**");
    const after = await audioState(app);
    expect(after!.src).toBe(before);
    expect(after!.paused).toBe(false);
    expect(after!.count).toBe(1);
  });

  test("refresh restores the queue paused at the saved position", async ({ app }) => {
    await playFirstQuickPick(app);
    await app.waitForTimeout(1500); // let the debounced session save run
    await app.reload();
    const bar = app.getByRole("region", { name: "Player" });
    await expect(bar.getByText("C4 Morning")).toBeVisible();
    await expect(bar.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    expect((await audioState(app))!.paused).toBe(true);
  });

  test("search finds a track and plays it", async ({ app }) => {
    await app.goto("/search?q=echo");
    await app.getByRole("button", { name: /^Play E4 Echo/ }).click();
    await expect(app.getByRole("region", { name: "Player" }).getByText("E4 Echo")).toBeVisible();
  });

  test("album page plays in order and queue can be reordered", async ({ app }) => {
    await app.goto("/album/dev-album-1");
    await app.getByRole("button", { name: "Play", exact: true }).click();
    await app.getByRole("button", { name: "Open now playing" }).first().click();
    const upNext = app.getByRole("list", { name: "Up next" });
    await expect(upNext.getByText("D4 Drive")).toBeVisible();
    // Keyboard reorder: move "F4 Field" up one.
    const handle = app.getByRole("button", { name: /Reorder F4 Field/ });
    await handle.focus();
    // dnd-kit measures between steps; pace the keys like a person would.
    await app.keyboard.press("Space");
    await app.waitForTimeout(200);
    await app.keyboard.press("ArrowUp");
    await app.waitForTimeout(300);
    await app.keyboard.press("Space");
    // Album entries first; autoplay may append radio tracks after them.
    await expect.poll(async () => (await upNext.getByRole("listitem").allTextContents()).slice(0, 3).map((t) => t.match(/[A-G]\d (Morning|Drive|Echo|Field|Glow|Air|Blue|Climb)/)?.[0])).toEqual(["D4 Drive", "F4 Field", "E4 Echo"]);
  });

  test("guest like + local playlist persist after reload", async ({ app }) => {
    await app.goto("/album/dev-album-1");
    await app.getByRole("button", { name: "Like D4 Drive" }).click();
    await app.getByRole("button", { name: "Save all to playlist" }).click();
    await app.getByRole("button", { name: "New playlist" }).click();
    await app.getByLabel("Playlist title").fill("Guest list");
    await app.getByRole("button", { name: "Create" }).click();
    await app.reload();
    await app.goto("/library/liked");
    await expect(app.getByText("D4 Drive")).toBeVisible();
    await app.goto("/library/playlists");
    await expect(app.getByRole("link", { name: /Guest list/ }).first()).toBeVisible();
  });

  test("lyrics tab shows synced lines", async ({ app }) => {
    await playFirstQuickPick(app);
    await app.getByRole("button", { name: "Open now playing" }).first().click();
    await app.getByRole("tab", { name: "Lyrics" }).click();
    await expect(app.getByRole("button", { name: /C4 Morning — line 1/ })).toBeVisible();
  });

  test("unknown album shows not-found", async ({ app }) => {
    await app.goto("/album/does-not-exist");
    await expect(app.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("@mobile mini player and bottom nav", async ({ app }) => {
    test.skip(test.info().project.name !== "mobile-safari-like");
    await playFirstQuickPick(app);
    await expect(app.getByRole("region", { name: "Mini player" })).toBeVisible();
    await expect(app.getByRole("navigation", { name: "Main" }).last().getByRole("link", { name: "Home" })).toBeVisible();
    const overflow = await app.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});

test.describe("now playing behaviour", () => {
  test("arrow keys seek even while Now Playing is open", async ({ app }) => {
    await playFirstQuickPick(app);
    await app.getByRole("button", { name: /Open now playing/ }).first().click();
    await expect(app.getByRole("dialog")).toBeVisible();
    await app.waitForTimeout(800);
    const before = await app.evaluate(() => document.querySelector("audio")!.currentTime);
    await app.keyboard.press("ArrowRight");
    const after = await app.evaluate(() => document.querySelector("audio")!.currentTime);
    // 2 s step (+ a little playback time while the key is handled)
    expect(after - before).toBeGreaterThanOrEqual(1.9);
    expect(after - before).toBeLessThan(3);
  });

  test("sidebar navigation (even to the current page) closes Now Playing; header keeps the logo", async ({ app }) => {
    await playFirstQuickPick(app);
    const toggle = app.getByRole("region", { name: "Player" }).getByRole("button", { name: /now playing/ }).last();
    await toggle.click();
    await expect(app.getByRole("dialog")).toBeVisible();
    await toggle.click(); // the same corner button collapses it
    await expect(app.getByRole("dialog")).toHaveCount(0);
    await toggle.click();
    await app.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Home" }).click();
    await expect(app.getByRole("dialog")).toHaveCount(0);
    await app.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(app.getByRole("banner").getByRole("link", { name: "Neo Music home" })).toBeVisible();
    await app.getByRole("button", { name: "Expand sidebar" }).click();
  });
});
