/**
 * Typed API client. In the browser, calls are same-origin (/api → rewrite/nginx), so the session
 * cookie flows automatically and CSRF origin checks pass. Never stores tokens in JS.
 */
import type { ApiErrorBody, ErrorCode } from "@zuno/core";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode | "network", message: string, readonly requestId?: string) {
    super(message);
    this.name = "ApiError";
  }
  get isAuth() { return this.status === 401; }
}

type Opts = { signal?: AbortSignal; body?: unknown; headers?: Record<string, string>; keepalive?: boolean };

async function request<T>(method: string, path: string, opts: Opts = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      signal: opts.signal,
      keepalive: opts.keepalive,
      headers: { ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...opts.headers },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "network", typeof navigator !== "undefined" && !navigator.onLine ? "You're offline" : "Couldn't reach the server");
  }
  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try { body = (await res.json()) as ApiErrorBody; } catch { /* non-JSON error */ }
    throw new ApiError(res.status, body?.error.code ?? "internal", body?.error.message ?? `Request failed (${res.status})`, body?.error.requestId);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, opts?: Opts) => request<T>("GET", path, opts),
  post: <T>(path: string, body?: unknown, opts?: Opts) => request<T>("POST", path, { ...opts, body: body ?? {} }),
  put: <T>(path: string, body?: unknown, opts?: Opts) => request<T>("PUT", path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: Opts) => request<T>("PATCH", path, { ...opts, body }),
  del: <T>(path: string, body?: unknown, opts?: Opts) => request<T>("DELETE", path, { ...opts, body }),
};

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
};
