import { test, expect, playFirstQuickPick, signUp } from "./fixtures";

const email = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;

test.describe("accounts", () => {
  test("guest data migrates into a new account exactly once", async ({ app }) => {
    await app.goto("/album/dev-album-2");
    await app.getByRole("button", { name: "Like G4 Glow" }).click();
    await app.getByRole("button", { name: "Save to library" }).click();
    await signUp(app, email());
    await expect(app.getByText(/Moved \d+ saved items? from this device/)).toBeVisible();
    await app.goto("/library/liked");
    await expect(app.getByText("G4 Glow")).toBeVisible();
    await app.goto("/library/albums");
    await expect(app.getByText("Tones Vol. 2")).toBeVisible();
    // Reload: nothing is imported twice.
    await app.reload();
    await app.goto("/library/liked");
    await expect(app.getByText("G4 Glow")).toHaveCount(1);
  });

  test("sign out hides private data", async ({ app }) => {
    await signUp(app, email());
    await app.goto("/album/dev-album-1");
    await app.getByRole("button", { name: "Like C4 Morning" }).click();
    await app.getByRole("button", { name: "Account menu" }).click();
    await app.getByRole("menuitem", { name: "Sign out" }).click();
    await app.goto("/library/liked");
    await expect(app.getByText("Songs you like will appear here")).toBeVisible();
    const res = await app.request.get("/api/v1/library/likes");
    expect(res.status()).toBe(401);
  });

  test("history records plays for signed-in users", async ({ app }) => {
    await signUp(app, email());
    await playFirstQuickPick(app);
    await expect.poll(async () => {
      await app.evaluate(() => window.dispatchEvent(new Event("online")));
      const r = await app.request.get("/api/v1/history");
      return (await r.json()).items?.length ?? 0;
    }, { timeout: 30_000 }).toBeGreaterThan(0);
  });
});
