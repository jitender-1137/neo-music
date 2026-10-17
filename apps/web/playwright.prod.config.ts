import { defineConfig, devices } from "@playwright/test";

/**
 * Production-build browser tests (service worker, caching, offline). `next build` + `next start`
 * on :3200 against the deterministic dev-tone API on :4100. Run: npx playwright test -c playwright.prod.config.ts
 */
const API = "http://127.0.0.1:4100";
export default defineConfig({
  testDir: "./e2e-prod",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3200", trace: "retain-on-failure", serviceWorkers: "allow" },
  projects: [{ name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } }],
  webServer: [
    {
      command: "pnpm --filter @zuno/api exec tsx src/index.ts",
      url: `${API}/healthz`,
      cwd: "../..",
      reuseExistingServer: true,
      env: {
        PORT: "4100", HOST: "127.0.0.1", NODE_ENV: "development", MUSIC_PROVIDER: "dev",
        DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://zuno:zuno_dev_password@127.0.0.1:5433/zuno_test",
        REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/14",
        STREAM_SIGNING_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e!", WEB_ORIGINS: "http://localhost:3100,http://localhost:3200",
        AUTH_RATE_LIMIT_PER_MIN: "1000", PLAYBACK_TOKEN_RATE_LIMIT_PER_MIN: "1000", RATE_LIMIT_PER_MIN: "100000", STREAM_RATE_LIMIT_PER_MIN: "100000", LOG_LEVEL: "warn", WORKER_INLINE: "true",
      },
    },
    {
      command: "pnpm exec next build && pnpm exec next start --port 3200",
      url: "http://localhost:3200",
      reuseExistingServer: false,
      env: { API_ORIGIN: API, NEXT_DIST_DIR: ".next-prod", NEXT_PUBLIC_CACHE_BUDGET_MB: "50" },
      timeout: 300_000,
    },
  ],
});
