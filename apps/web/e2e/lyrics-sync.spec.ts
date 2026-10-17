import { test, expect, playFirstQuickPick } from "./fixtures";

/**
 * Lyrics must track the audio clock, not the ~4 Hz timeupdate event. Dev-tone lyrics have a line
 * every 4 s; the highlight must switch within a small window of each line's start
 * (it is designed to lead by ~150 ms so text appears with the vocal).
 */
test("synced lyrics switch lines within ±200 ms of the audio", async ({ app }) => {
  await playFirstQuickPick(app);
  await app.getByRole("button", { name: /Open now playing/ }).first().click();
  await app.getByRole("tab", { name: "Lyrics" }).click();
  await expect(app.getByRole("button", { name: /line 1$/ })).toBeVisible();
  const drift = await app.evaluate(async () => {
    const a = document.querySelector("audio")!;
    const out: number[] = [];
    let last = -1;
    const t0 = performance.now();
    await new Promise<void>((res) => {
      const tick = () => {
        const el = document.querySelector("[data-line][aria-current=true]") as HTMLElement | null;
        const idx = el ? Number(el.dataset.line) : -1;
        if (idx > last && idx > 0) out.push(a.currentTime * 1000 - idx * 4000); // line idx starts at idx*4s
        if (idx > last) last = idx;
        if (performance.now() - t0 < 13_000) requestAnimationFrame(tick); else res();
      };
      tick();
    });
    return out;
  });
  expect(drift.length).toBeGreaterThanOrEqual(2);
  for (const d of drift) expect(Math.abs(d)).toBeLessThanOrEqual(200);
  console.log("lyrics highlight vs audio (ms, negative = early):", drift.map((d) => Math.round(d)).join(", "));
});
