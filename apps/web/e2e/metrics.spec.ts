import { writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, audioState, signUp } from "./fixtures";

/**
 * Playback measurements @mobile (Chromium, iPhone-sized, dev-tone catalog with real <audio>).
 * Writes docs/mobile-playback-metrics.json. These numbers describe Chromium on this machine — not an
 * iPhone; lock-screen behaviour is not measurable here.
 */
const out: Record<string, unknown> = {};
test.afterAll(() => {
  if (!process.env.METRICS) return;
  writeFileSync("../../docs/mobile-playback-metrics.json", JSON.stringify({ measuredAt: new Date().toISOString(), environment: "Chromium (Playwright, iPhone 13 emulation, touch) · dev-tone provider · localhost", ...out }, null, 2));
});

const mini = (p: Page) => p.getByRole("region", { name: "Mini player" });
async function startAlbum(app: Page) {
  await app.goto("/album/dev-album-1");
  await app.getByRole("main").getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await audioState(app))?.paused, { timeout: 15_000 }).toBe(false);
}
/** Install listeners that timestamp media events (performance.now) on the single <audio>. */
async function instrument(app: Page) {
  await app.evaluate(() => {
    const w = window as unknown as { M: { e: string; t: number; src: string }[] };
    w.M = [];
    const a = document.querySelector("audio")!;
    for (const ev of ["play", "playing", "pause", "waiting", "stalled", "ended", "error", "loadstart"]) a.addEventListener(ev, () => w.M.push({ e: ev, t: performance.now(), src: a.src.split("/stream/")[1]?.split("?")[0] ?? "" }));
  });
}
const marks = (app: Page) => app.evaluate(() => (window as unknown as { M: { e: string; t: number; src: string }[] }).M);

test.describe("playback metrics @mobile", () => {
  test.skip(!process.env.METRICS, "measurement run only: METRICS=1 npx playwright test e2e/metrics.spec.ts --project=mobile-safari-like");
  test("play/pause command → state latency (in app)", async ({ app }) => {
    await startAlbum(app);
    const samples: number[] = [];
    await app.waitForTimeout(600); // settle into "playing"
    for (let i = 0; i < 6; i++) {
      const t = await app.evaluate(async () => {
        const btn = [...document.querySelectorAll('[aria-label="Mini player"] button')].find((b) => /^(Play|Pause)$/.test(b.getAttribute("aria-label") ?? "")) as HTMLButtonElement;
        const other = btn.getAttribute("aria-label") === "Play" ? "Pause" : "Play";
        const t0 = performance.now();
        btn.click();
        await new Promise<void>((r) => { const tick = () => (document.querySelector(`[aria-label="Mini player"] button[aria-label="${other}"]`) ? r() : requestAnimationFrame(tick)); tick(); });
        return performance.now() - t0;
      });
      samples.push(t);
      await app.waitForTimeout(250);
    }
    samples.sort((a, b) => a - b);
    out.playPauseLatencyMs = { samples: samples.map((x) => Math.round(x)), median: Math.round(samples[3]!), max: Math.round(samples.at(-1)!) };
    expect(samples[3]!).toBeLessThan(100);
  });

  test("startup: cold (first play after load) vs warm (same song again)", async ({ app }) => {
    await app.goto("/album/dev-album-1");
    await app.waitForTimeout(800);
    const cold = await app.evaluate(async () => {
      const t0 = performance.now();
      ([...document.querySelectorAll("main button")].find((b) => b.textContent?.trim() === "Play") as HTMLButtonElement).click();
      await new Promise<void>((r) => { const a = () => document.querySelector("audio"); const w = () => (a() && !a()!.paused && a()!.currentTime > 0 ? r() : setTimeout(w, 10)); w(); });
      return performance.now() - t0;
    });
    await app.waitForTimeout(500);
    const warm = await app.evaluate(async () => {
      const a = document.querySelector("audio")!;
      a.pause();
      const t0 = performance.now();
      a.currentTime = 0;
      ([...document.querySelectorAll('[aria-label="Mini player"] button')].find((b) => /^(Play|Pause)$/.test(b.getAttribute("aria-label") ?? "")) as HTMLButtonElement).click();
      await new Promise<void>((r) => { const w = () => (!a.paused && a.currentTime > 0.05 ? r() : setTimeout(w, 10)); w(); });
      return performance.now() - t0;
    });
    out.startupMs = { coldFirstPlay: Math.round(cold), warmResume: Math.round(warm) };
    expect(cold).toBeLessThan(5000);
  });

  test("prefetch starts before the 5 s boundary; ended → next playing; rebuffers", async ({ app }) => {
    await startAlbum(app);
    await instrument(app);
    // Jump close to the end of the first song so the transition happens quickly.
    await app.evaluate(() => { const a = document.querySelector("audio")!; a.currentTime = Math.max(0, a.duration - 8); });
    await expect.poll(async () => (await marks(app)).some((m) => m.e === "ended"), { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => (await marks(app)).filter((m) => m.e === "playing").length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    const m = await marks(app);
    const ended = m.find((x) => x.e === "ended")!;
    const nextPlaying = m.filter((x) => x.e === "playing" && x.t > ended.t)[0]!;
    const log = await app.evaluate(() => localStorage.getItem("zuno.playbackLog.v1") ?? "[]");
    const entries = JSON.parse(log) as { e: string; d?: string; t: number }[];
    const pf = entries.filter((x) => x.e.startsWith("prefetch:start"));
    const remaining = pf.map((x) => Number(/remaining=([\d.]+)/.exec(x.e)?.[1] ?? NaN));
    const done = entries.filter((x) => x.e === "prefetch:done").map((x) => x.d);
    out.transition = {
      endedToNextPlayingMs: Math.round(nextPlaying.t - ended.t),
      prefetchStartRemainingSec: remaining,
      prefetchDone: done,
      rebuffersDuringTransition: m.filter((x) => x.e === "waiting" && x.t < ended.t).length,
      stalls: m.filter((x) => x.e === "stalled").length,
    };
    expect(remaining.length).toBeGreaterThan(0);
    expect(Math.min(...remaining)).toBeGreaterThan(5);
    expect(nextPlaying.t - ended.t).toBeLessThan(2000);
  });

  test("next-track start: prepared (prefetched) vs not prepared (jump)", async ({ app }) => {
    await startAlbum(app);
    await app.waitForTimeout(1500); // first song well underway → next prepared (dev songs < lead time)
    const timeNext = (sel: string) => app.evaluate(async (s) => {
      const a = document.querySelector("audio")!;
      const before = a.src;
      const t0 = performance.now();
      (document.querySelector(s) as HTMLButtonElement).click();
      await new Promise<void>((r) => { const w = () => (a.src !== before && !a.paused && a.currentTime > 0.05 ? r() : setTimeout(w, 10)); w(); });
      return performance.now() - t0;
    }, sel);
    const prepared = await timeNext('[aria-label="Mini player"] button[aria-label="Next"]');
    await app.waitForTimeout(400);
    // Jump far ahead in the queue (not prepared) through the panel.
    await mini(app).getByRole("button", { name: /Open now playing/ }).click();
    await app.getByRole("toolbar", { name: "Song actions" }).getByRole("button", { name: "Up next" }).click();
    await app.waitForTimeout(600);
    const jump = await app.evaluate(async () => {
      const a = document.querySelector("audio")!;
      const before = a.src;
      const btns = [...document.querySelectorAll('[aria-label="Up next"] button[aria-label^="Play "]')] as HTMLButtonElement[];
      const t0 = performance.now();
      btns.at(-1)!.click();
      await new Promise<void>((r) => { const w = () => (a.src !== before && !a.paused && a.currentTime > 0.05 ? r() : setTimeout(w, 10)); w(); });
      return performance.now() - t0;
    });
    out.nextStartMs = { prepared: Math.round(prepared), notPrepared: Math.round(jump) };
  });

  test("network loss mid-track, then recovery", async ({ app, context }) => {
    await startAlbum(app);
    await instrument(app);
    await context.setOffline(true);
    // Force a fetch for unbuffered audio while offline.
    await app.evaluate(() => { const a = document.querySelector("audio")!; a.currentTime = Math.max(0, a.duration - 3); });
    await app.waitForTimeout(2500);
    const duringOffline = await audioState(app);
    await context.setOffline(false);
    const t0 = Date.now();
    await expect.poll(async () => { const s = await audioState(app); return !!s && !s.paused && s.time > 0; }, { timeout: 20_000 }).toBe(true);
    const err = await app.getByRole("status").allTextContents().catch(() => []);
    out.networkLoss = { pausedWhileOffline: duringOffline?.paused, recoveredWithinMs: Date.now() - t0, messages: err.slice(0, 3), events: (await marks(app)).map((m) => m.e).slice(0, 20) };
  });

  test("signed-in session plays exactly like a guest", async ({ app }) => {
    await signUp(app, `metrics-${Date.now()}@example.test`);
    await startAlbum(app);
    expect((await audioState(app))!.count).toBe(1);
    out.signedIn = { plays: true, audioElements: (await audioState(app))!.count };
  });

  test("main-thread long tasks while using the player surface", async ({ app }) => {
    await startAlbum(app);
    await app.evaluate(() => {
      const w = window as unknown as { LT: number[] };
      w.LT = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) w.LT.push(e.duration); }).observe({ type: "longtask", buffered: false });
    });
    await mini(app).getByRole("button", { name: /Open now playing/ }).click();
    await app.waitForTimeout(600);
    await app.getByRole("toolbar", { name: "Song actions" }).getByRole("button", { name: "Lyrics" }).click();
    await app.waitForTimeout(800);
    await app.keyboard.press("Escape");
    await app.keyboard.press("Escape");
    await app.waitForTimeout(600);
    const lt = await app.evaluate(() => (window as unknown as { LT: number[] }).LT);
    out.longTasks = { count: lt.length, totalMs: Math.round(lt.reduce((s, x) => s + x, 0)), maxMs: Math.round(Math.max(0, ...lt)), note: "dev build (unminified, React dev mode) — production is lighter" };
  });
});
