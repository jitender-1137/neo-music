import { test, expect } from "./fixtures";

test.describe("import music", () => {
  test("Spotify (Exportify) CSV → review → new playlist", async ({ app }) => {
    await app.goto("/import");
    await app.getByRole("button", { name: /Spotify/ }).click();
    const csv = [
      '"Track URI","Track Name","Artist Name(s)","Album Name","Duration (ms)"',
      '"spotify:track:1","E4 Echo","Test Tone Ensemble","Tones Vol. 1","24000"',
      '"spotify:track:2","D4 Drive (Remastered 2015)","The Sine Waves","Tones Vol. 1","22000"',
      '"spotify:track:3","A Song That Does Not Exist","Nobody","","200000"',
    ].join("\n");
    await app.getByLabel("Choose playlist files").setInputFiles({ name: "Road_Trip.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(app.getByText("2 of 3 songs ready")).toBeVisible({ timeout: 20_000 });
    await expect(app.getByRole("textbox", { name: "Playlist name" })).toHaveValue("Road Trip");
    await app.getByRole("tab", { name: /Needs review \(1\)/ }).click();
    await expect(app.getByText("A Song That Does Not Exist")).toBeVisible();
    await app.getByRole("button", { name: "Import 2 songs" }).click();
    await expect(app.getByRole("heading", { name: "Import complete" })).toBeVisible();
    await app.getByRole("main").getByRole("link", { name: "Road Trip" }).click();
    await expect(app.getByText("E4 Echo")).toBeVisible();
    await expect(app.getByText("D4 Drive")).toBeVisible();
  });

  test("pasted list → Liked music", async ({ app }) => {
    await app.goto("/import");
    await app.getByRole("button", { name: /Paste a list/ }).click();
    await app.getByLabel("Paste songs").fill("Test Tone Ensemble - C4 Morning\nB4 Blue by Test Tone Ensemble\n");
    await app.getByRole("button", { name: "Find songs" }).click();
    await expect(app.getByText("2 of 2 songs ready")).toBeVisible({ timeout: 20_000 });
    await app.getByRole("combobox", { name: /Import Pasted list into/ }).selectOption("liked");
    await app.getByRole("button", { name: "Import 2 songs" }).click();
    await expect(app.getByRole("heading", { name: "Import complete" })).toBeVisible();
    await app.goto("/library/liked");
    await expect(app.getByText("C4 Morning")).toBeVisible();
    await expect(app.getByText("B4 Blue")).toBeVisible();
  });

  test("unsupported link shows a clear message", async ({ app }) => {
    await app.goto("/import");
    await app.getByRole("button", { name: /Deezer/ }).click();
    await app.getByRole("textbox").first().fill("https://example.com/not-a-playlist");
    await app.getByRole("button", { name: "Import", exact: true }).click();
    await expect(app.getByText(/doesn't look like a playlist or album link/)).toBeVisible();
  });
});
