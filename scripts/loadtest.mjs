#!/usr/bin/env node
/**
 * API load test (autocannon). Run against an API started with MUSIC_PROVIDER=dev and raised
 * RATE_LIMIT_PER_MIN/STREAM_RATE_LIMIT_PER_MIN (otherwise you're measuring the rate limiter).
 * Usage: node scripts/loadtest.mjs http://127.0.0.1:4012
 */
import { execFileSync } from "node:child_process";
const base = process.argv[2] ?? "http://127.0.0.1:4012";
const run = (name, url, { c = 50, d = 10, headers = [] } = {}) => {
  const args = ["-y", "autocannon@8", "-c", String(c), "-d", String(d), "--json", ...headers.flatMap((h) => ["-H", h]), url];
  const r = JSON.parse(execFileSync("npx", args, { stdio: ["ignore", "pipe", "ignore"] }).toString());
  const l = r.latency;
  console.log(`${name.padEnd(30)} req/s=${String(Math.round(r.requests.average)).padStart(7)}  p50=${l.p50}ms p97.5=${l.p97_5}ms p99=${l.p99}ms  non2xx=${r.non2xx} errors=${r.errors} timeouts=${r.timeouts}`);
};
const tok = await (await fetch(`${base}/api/v1/playback/token`, { method: "POST", headers: { origin: "http://localhost:3000" } })).json();
run("home (cached, c=50)", `${base}/api/v1/home`);
run("search (cached, c=50)", `${base}/api/v1/search?q=tone`);
run("album (cached, c=50)", `${base}/api/v1/albums/dev-album-1`);
run("suggestions (cached, c=50)", `${base}/api/v1/search/suggestions?q=to`);
run("stream 64KiB range (c=50)", `${base}/api/v1/stream/dev-01?q=auto&f=mp4&t=${encodeURIComponent(tok.token)}`, { headers: ["Range=bytes=0-65535"] });
run("search burst (c=300, 5s)", `${base}/api/v1/search?q=tone`, { c: 300, d: 5 });
