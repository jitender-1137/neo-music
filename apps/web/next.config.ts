import path from "node:path";
import type { NextConfig } from "next";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:4000";

const csp = [
  "default-src 'self'",
  // Next injects inline bootstrap scripts. The only third-party script is YouTube's IFrame Player API,
  // used when the music source is "official" (songs play in YouTube's own embedded player).
  `script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.ggpht.com https://i.ytimg.com https://*.ytimg.com https://music.youtube.com",
  // data: = the tiny silent WAV that unlocks iOS audio inside the tap (see player engine).
  "media-src 'self' blob: data:",
  // The service worker fetches artwork with CORS to cache it; worker fetches are governed by
  // connect-src (not img-src), so the artwork CDNs must be listed here too (images only).
  "connect-src 'self' https://*.googleusercontent.com https://*.ggpht.com https://i.ytimg.com https://*.ytimg.com https://music.youtube.com",
  "font-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const config: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Separate build dirs let dev, e2e and production builds coexist.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  poweredByHeader: false,
  // The dev badge sits bottom-left — exactly where the transport controls live.
  devIndicators: false,
  // Dev only: let phones on the same Wi-Fi load the dev server by LAN address (real-device testing).
  // …and over a Cloudflare quick tunnel (HTTPS on a real iPhone): `cloudflared tunnel --url http://localhost:3000`.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*", "*.local", "*.trycloudflare.com"],
  transpilePackages: ["@zuno/core", "@zuno/player"],
  // Same-origin API in dev; nginx routes /api straight to the API in production.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
};

export default config;
