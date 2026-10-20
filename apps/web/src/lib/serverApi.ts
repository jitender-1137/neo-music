import "server-only";
import { cookies } from "next/headers";
import { ApiError } from "./api";
import { SOURCE_COOKIE, isMusicSource } from "./musicSource";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:4000";

/** Server Components fetch the API directly (no rewrite hop), forwarding the session cookie. */
export async function serverGet<T>(path: string, opts: { revalidate?: number; withCookies?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const jar = await cookies();
  // Same music source as the browser (Settings → Music source), as part of the URL so the
  // server-side fetch cache keeps sources apart.
  const src = jar.get(SOURCE_COOKIE)?.value;
  if (isMusicSource(src)) path = `${path}${path.includes("?") ? "&" : "?"}src=${src}`;
  if (opts.withCookies) {
    const c = jar.toString();
    if (c) headers.cookie = c;
  }
  const res = await fetch(`${API_ORIGIN}${path}`, {
    headers,
    next: opts.withCookies ? undefined : { revalidate: opts.revalidate ?? 300 },
    cache: opts.withCookies ? "no-store" : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(res.status, (body?.error?.code ?? "internal") as never, body?.error?.message ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}
