/**
 * Stream URLs are HMAC-signed so the audio proxy can't be used as an open relay by third
 * parties: only URLs this API minted (bound to track, quality, format and expiry) are served.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AudioQuality } from "@zuno/core";

export interface StreamClaims { trackId: string; quality: AudioQuality; mp4: boolean; exp: number }

const payload = (c: StreamClaims) => `${c.trackId}|${c.quality}|${c.mp4 ? 1 : 0}|${c.exp}`;

export function signStream(secret: string, c: StreamClaims): string {
  return createHmac("sha256", secret).update(payload(c)).digest("base64url");
}

export function verifyStream(secret: string, c: StreamClaims, sig: string): boolean {
  if (!sig || c.exp < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signStream(secret, c));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function streamPath(secret: string, c: StreamClaims): string {
  const qs = new URLSearchParams({ q: c.quality, f: c.mp4 ? "mp4" : "any", exp: String(c.exp), sig: signStream(secret, c) });
  return `/api/v1/stream/${encodeURIComponent(c.trackId)}?${qs}`;
}

/**
 * Device playback token: lets the browser build stream URLs synchronously inside a tap handler
 * (iOS Safari only allows play() within the user gesture, so no await may precede it).
 */
export function issuePlaybackToken(secret: string, ttlSec: number): { token: string; exp: number } {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const nonce = createHmac("sha256", secret).update(`${Math.random()}${Date.now()}`).digest("base64url").slice(0, 16);
  const body = `${nonce}.${exp}`;
  return { token: `${body}.${createHmac("sha256", secret).update(`tok|${body}`).digest("base64url")}`, exp };
}

export function verifyPlaybackToken(secret: string, token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [nonce, expStr, sig] = parts as [string, string, string];
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`tok|${nonce}.${expStr}`).digest("base64url"));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
