/*
 * Cache eviction policy for the Neo Music service worker (plain JS: loaded with importScripts in the
 * worker, and required by unit tests — one implementation, tested as shipped).
 *
 * selectEvictions(entries, now, budgetBytes) → urls to delete, in order:
 *   1. expired, failed or incomplete entries (always);
 *   2. then least-recently-used entries until the total fits the budget — never ones marked
 *      `pinned`, `current` or `next` (those only go if they are expired or broken).
 */
(function (root) {
  function selectEvictions(entries, now, budgetBytes) {
    const out = [];
    let total = 0;
    const live = [];
    for (const e of entries) {
      const broken = !e || !(e.size >= 0) || e.status === "failed" || e.status === "incomplete" || e.status === "unauthorized";
      if (broken || e.expires < now) out.push(e.url);
      else { total += e.size; live.push(e); }
    }
    const evictable = live.filter((e) => !e.pinned && !e.current && !e.next).sort((a, b) => a.lastAccess - b.lastAccess);
    for (const e of evictable) {
      if (total <= budgetBytes) break;
      out.push(e.url);
      total -= e.size;
    }
    return out;
  }

  /** Budget: the smaller of `fraction` of the origin quota and `capBytes` (headroom is kept). */
  function budgetFor(quotaBytes, capBytes, fraction) {
    const q = Number.isFinite(quotaBytes) && quotaBytes > 0 ? quotaBytes : Infinity;
    return Math.max(0, Math.min(q * (fraction ?? 0.15), capBytes));
  }

  const api = { selectEvictions, budgetFor };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NeoCachePolicy = api;
})(typeof self !== "undefined" ? self : globalThis);
