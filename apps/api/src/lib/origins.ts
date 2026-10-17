/**
 * Allowed browser origins (WEB_ORIGINS). Entries are exact origins, or a subdomain wildcard such as
 * `https://*.trycloudflare.com` — handy for phone testing over a quick tunnel, whose name changes
 * every run. A wildcard matches exactly one or more labels under that domain, same scheme, no port
 * tricks: `https://evil.com/x.trycloudflare.com` or `https://trycloudflare.com.evil.com` never match.
 */
export function originMatcher(list: string[]): (origin: string | undefined) => boolean {
  const exact = new Set(list.filter((o) => !o.includes("*")));
  const wild = list.filter((o) => o.includes("*")).flatMap((o) => {
    const m = /^(https?):\/\/\*\.([a-z0-9.-]+)$/i.exec(o);
    return m ? [{ scheme: m[1]!.toLowerCase(), suffix: `.${m[2]!.toLowerCase()}` }] : [];
  });
  return (origin) => {
    if (!origin) return false;
    if (exact.has(origin)) return true;
    let u: URL;
    try { u = new URL(origin); } catch { return false; }
    if (u.origin !== origin || u.port) return false;
    const host = u.hostname.toLowerCase();
    return wild.some((w) => u.protocol === `${w.scheme}:` && host.endsWith(w.suffix) && host.length > w.suffix.length && /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host.slice(0, -w.suffix.length)));
  };
}
