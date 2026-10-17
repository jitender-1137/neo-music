/**
 * Proof-of-Origin tokens for googlevideo, minted server-side.
 *
 * Ported from Zuno `src/datasource/youtube/poToken.ts` (Apache-2.0). Zuno runs BotGuard in its
 * WebView; a web server has no browser, so the VM runs inside jsdom — the approach documented by
 * bgutils-js. Without a token googlevideo serves ~1 MiB then answers 403.
 */
import { JSDOM } from "jsdom";
import { BotGuardClient, getChallenge } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import { buildURL, getHeaders } from "bgutils-js/utils";

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo"; // YouTube's public BotGuard request key
const FALLBACK_TTL_S = 12 * 60 * 60;
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

type Cached = { minter: WebPoMinter; expiresAt: number };
let cached: Promise<Cached> | null = null;
let domInstalled = false;

function installDom(userAgent: string) {
  if (domInstalled) return;
  const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
    url: "https://www.youtube.com/",
    referrer: "https://www.youtube.com/",
  });
  Object.defineProperty(dom.window.navigator, "userAgent", { value: userAgent, configurable: true });
  // BotGuard probes these globals; this process is a dedicated API server, nothing else reads them.
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, origin: dom.window.origin });
  if (!Reflect.has(globalThis, "navigator")) {
    Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
  }
  domInstalled = true;
}

async function attest(userAgent: string): Promise<Cached> {
  installDom(userAgent);
  const challenge = await getChallenge({ requestKey: REQUEST_KEY, fetchFunction: fetch });
  const js = challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (!js) throw new Error("BotGuard challenge carried no interpreter script");
  new Function(js)();
  const botguard = await BotGuardClient.create({ globalName: challenge.globalName, globalObject: globalThis, program: challenge.program });
  const signals: unknown[] = [];
  const snapshot = await botguard.snapshot({ webPoSignalOutput: signals as never });
  const res = await fetch(buildURL("GenerateIT"), { method: "POST", headers: getHeaders(), body: JSON.stringify([REQUEST_KEY, snapshot]) });
  if (!res.ok) throw new Error(`GenerateIT returned HTTP ${res.status}`);
  const [token, ttl] = (await res.json()) as [string?, number?];
  if (!token) throw new Error("Integrity response contained no token");
  const minter = await WebPoMinter.create({ integrityToken: token }, signals as never);
  const ttlMs = (ttl ?? FALLBACK_TTL_S) * 1000;
  return { minter, expiresAt: Date.now() + Math.max(ttlMs - REFRESH_MARGIN_MS, 60_000) };
}

function getMinter(userAgent: string): Promise<Cached> {
  if (!cached) {
    cached = attest(userAgent).catch((err) => {
      cached = null; // never cache a failure
      throw err;
    });
  }
  return cached;
}

/** Mints a token bound to `binding` (a video id). Throws if attestation fails. */
export async function mintPoToken(binding: string, userAgent: string): Promise<string> {
  let entry = await getMinter(userAgent);
  if (Date.now() >= entry.expiresAt) {
    cached = null;
    entry = await getMinter(userAgent);
  }
  return entry.minter.mintAsWebsafeString(binding);
}

export function warmPoToken(userAgent: string): Promise<void> {
  return getMinter(userAgent).then(() => undefined);
}
