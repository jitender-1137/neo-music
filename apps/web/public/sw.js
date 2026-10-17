/*
 * Neo Music service worker.
 *
 * Caches (versioned; old versions are deleted on activate):
 *   shell   the offline page, icons and manifest (precached).
 *   assets  Next's content-hashed build files (/_next/static/*): cache-first.
 *   art     album / artist artwork: stale-while-revalidate, fetched with CORS (the artwork CDNs send
 *           Access-Control-Allow-Origin: *), so only verified, non-opaque images are stored.
 *   meta    public catalog API GETs: stale-while-revalidate — only when the server marked the 200
 *           response `Cache-Control: public` and set no cookie, and the path isn't user-scoped.
 * Never:    audio (/api/v1/stream — the provider's terms don't permit storing it; the browser's
 *           private HTTP cache still applies), Range requests (passed through untouched, so the
 *           network returns a real 206), anything private or authenticated, HTML documents.
 *
 * Index & budget: an IndexedDB index (url → cache, size, last access, expiry) drives LRU eviction
 * within a budget = min(15% of the origin quota, BUDGET_MB from the registration URL, default 250)
 * with headroom; expired and failed entries are removed. Only this worker writes the index, and
 * IndexedDB transactions are atomic, so several tabs can't corrupt it.
 * Counters (hit / miss / bypass / eviction / quota error) are answered over postMessage.
 *
 * It does NOT keep JavaScript alive in the background or control audio: playback relies on the
 * browser's media pipeline + Media Session.
 */
importScripts("/sw-cache-policy.js"); // selectEvictions / budgetFor (unit-tested as shipped)
const VERSION = "neo-sw-v3";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const ART = `${VERSION}-art`;
const META = `${VERSION}-meta`;
const PRECACHE = ["/sw-cache-policy.js", "/offline", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/favicon-32.png", "/manifest.webmanifest"];
const MAX_ASSETS = 200;
const BUDGET_MB = Number(new URL(self.location.href).searchParams.get("budget")) || 250;
const ART_TTL = 7 * 24 * 3600_000;
const META_TTL = 24 * 3600_000;
const NET_TIMEOUT_MS = 8_000;
const ART_HOSTS = /(^|\.)(googleusercontent\.com|ggpht\.com|ytimg\.com)$|^music\.youtube\.com$/;
// User-scoped or sensitive API areas: never cached even if a response looked public.
const PRIVATE_API = /^\/api\/v1\/(me|account|auth|library|history|playlists\/me|me\/|user-playlists|playback|stream|events|recommendations|import|guest)/;

const stats = { hit: 0, miss: 0, bypass: 0, eviction: 0, quotaError: 0, bypassReasons: {} };
const bypass = (reason) => { stats.bypass++; stats.bypassReasons[reason] = (stats.bypassReasons[reason] || 0) + 1; };

// ---------- IndexedDB index ----------
let dbp = null;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("neo-sw-cache", 1);
    r.onupgradeneeded = () => { const s = r.result.createObjectStore("entries", { keyPath: "url" }); s.createIndex("lastAccess", "lastAccess"); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction("entries", mode);
    const out = fn(t.objectStore("entries"));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  }));
}
const indexPut = (e) => tx("readwrite", (s) => s.put(e)).catch(() => undefined);
const indexDel = (url) => tx("readwrite", (s) => s.delete(url)).catch(() => undefined);
const indexAll = () => tx("readonly", (s) => s.getAll()).catch(() => []);
const touch = (url) => tx("readwrite", (s) => { const g = s.get(url); g.onsuccess = () => { if (g.result) s.put({ ...g.result, lastAccess: Date.now() }); }; }).catch(() => undefined);

async function budgetBytes() {
  let quota = Infinity;
  try { const e = await navigator.storage.estimate(); if (e.quota) quota = e.quota; } catch { /* unknown */ }
  return self.NeoCachePolicy.budgetFor(quota, BUDGET_MB * 1048576, 0.15);
}

/** Remove expired / broken entries, then least-recently-used ones until under budget. */
let evicting = null;
function evict() {
  evicting ??= (async () => {
    const all = await indexAll();
    const byUrl = new Map(all.map((e) => [e.url, e]));
    const urls = self.NeoCachePolicy.selectEvictions(all, Date.now(), await budgetBytes());
    for (const u of urls) {
      const e = byUrl.get(u);
      if (e) await (await caches.open(e.cache)).delete(u);
      await indexDel(u);
      stats.eviction++;
    }
  })().finally(() => { evicting = null; });
  return evicting;
}

async function store(cacheName, req, res, ttl) {
  try {
    const body = await res.clone().blob();
    await (await caches.open(cacheName)).put(req, res.clone());
    await indexPut({ url: req.url, cache: cacheName, size: body.size, etag: res.headers.get("etag"), lastAccess: Date.now(), expires: Date.now() + ttl });
    void evict();
  } catch (e) {
    if (e && e.name === "QuotaExceededError") { stats.quotaError++; void evict(); }
  }
}

function fetchWithTimeout(input, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), NET_TIMEOUT_MS);
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

/** Stale-while-revalidate: answer from cache at once (if fresh enough), refresh in the background. */
async function swr(event, cacheName, ttl, fetchReq, acceptable) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request);
  const refresh = fetchWithTimeout(fetchReq).then(async (res) => {
    if (acceptable(res)) await store(cacheName, event.request, res, ttl);
    else if (hit && res.status !== 304) { await cache.delete(event.request); await indexDel(event.request.url); }
    return res;
  });
  if (hit) {
    stats.hit++;
    void touch(event.request.url);
    event.waitUntil(refresh.catch(() => undefined));
    return hit;
  }
  stats.miss++;
  return refresh;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => tx("readwrite", (s) => s.clear()).catch(() => undefined)) // index matches only this version
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache-stats") return;
  event.waitUntil((async () => {
    const all = await indexAll();
    event.source?.postMessage({ type: "cache-stats", version: VERSION, stats, entries: all.length, bytes: all.reduce((s, e) => s + e.size, 0), budget: await budgetBytes() });
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Range requests (audio seeking/streaming) go straight to the network → a genuine 206.
  if (req.headers.has("range")) { if (url.pathname.startsWith("/api/v1/stream")) bypass("audio-range"); return; }

  // Album / artist artwork from the provider CDNs: verified CORS responses only.
  if (url.origin !== self.location.origin) {
    if (req.destination === "image" && ART_HOSTS.test(url.hostname)) {
      event.respondWith(
        swr(event, ART, ART_TTL, new Request(req.url, { mode: "cors", credentials: "omit" }), (res) => res.ok && res.type === "cors")
          .catch(() => { bypass("art-cors-failed"); return fetch(req); }),
      );
    }
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (url.pathname.startsWith("/api/v1/stream")) { bypass("audio-provider-terms"); return; }
    if (PRIVATE_API.test(url.pathname) || req.headers.has("authorization")) return;
    event.respondWith(
      swr(event, META, META_TTL, req, (res) => res.status === 200 && /\bpublic\b/.test(res.headers.get("cache-control") || "") && !res.headers.has("set-cookie"))
        .catch(() => caches.match(req).then((r) => r || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(ASSETS).then((c) => c.put(req, copy)).then(() => trim(ASSETS, MAX_ASSETS));
        }
        return res;
      })),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline").then((r) => r || new Response("Offline", { status: 503 }))));
  }
});
