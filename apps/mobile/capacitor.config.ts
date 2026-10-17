import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The app loads the deployed web app (SSR Next.js — there is no static bundle to ship) and plays
 * audio natively (ZunoAudio plugin). Put its address in apps/mobile/.env (see .env.example):
 *   ZUNO_APP_URL=https://music.example.com
 * then `pnpm --filter @zuno/mobile sync`. Without it the app shows www/index.html, which says so.
 */
try { process.loadEnvFile(".env"); } catch { /* no .env: rely on the environment */ }
const url = process.env.ZUNO_APP_URL?.replace(/\/+$/, "");
if (url && !url.startsWith("https://")) throw new Error("ZUNO_APP_URL must be https:// (iOS and Android block cleartext; the service worker needs a secure origin)");

const config: CapacitorConfig = {
  appId: "com.zuno.music",
  appName: "Neo Music",
  webDir: "www",
  ...(url ? { server: { url, allowNavigation: [new URL(url).host] } } : {}),
  ios: {
    // The web layout already pads for safe areas (viewport-fit=cover + env()).
    contentInset: "never",
  },
};

export default config;
