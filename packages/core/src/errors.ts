/** Stable, client-safe error codes shared by API and web. */
export const ErrorCode = {
  BadRequest: "bad_request",
  Unauthorized: "unauthorized",
  Forbidden: "forbidden",
  NotFound: "not_found",
  Conflict: "conflict",
  RateLimited: "rate_limited",
  ProviderUnavailable: "provider_unavailable",
  TrackUnavailable: "track_unavailable",
  /** The selected music source can't do this (e.g. albums with the official YouTube API). */
  NotSupported: "not_supported",
  Internal: "internal",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; requestId?: string };
}

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status = 500,
    readonly cause_?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}
