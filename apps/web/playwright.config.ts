import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against a dedicated stack: API on :4100 with the deterministic dev-tone provider and
 * the zuno_test database, web on :3100. No YouTube dependency, so results are reproducible.
 */
const API = "http://127.0.0.1:4100";
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } }, grepInvert: /@mobile/ },
    { name: "mobile-safari-like", use: { ...devices["iPhone 13"], browserName: "chromium" }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: "pnpm --filter @zuno/api exec tsx src/index.ts",
      url: `${API}/healthz`,
      cwd: "../..",
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: "4100", HOST: "127.0.0.1", NODE_ENV: "development", MUSIC_PROVIDER: "dev",
        DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://zuno:zuno_dev_password@127.0.0.1:5433/zuno_test",
        REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/14",
        STREAM_SIGNING_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e!", WEB_ORIGINS: "http://localhost:3100,http://localhost:3200",
        AUTH_RATE_LIMIT_PER_MIN: "1000", PLAYBACK_TOKEN_RATE_LIMIT_PER_MIN: "1000", RATE_LIMIT_PER_MIN: "100000", STREAM_RATE_LIMIT_PER_MIN: "100000", LOG_LEVEL: "warn", WORKER_INLINE: "true",
      },
    },
    {
      command: "pnpm exec next dev --port 3100",
      url: "http://localhost:3100",
      reuseExistingServer: !process.env.CI,
      env: { API_ORIGIN: API, NEXT_DIST_DIR: ".next-e2e" },
      timeout: 120_000,
    },
  ],
});
