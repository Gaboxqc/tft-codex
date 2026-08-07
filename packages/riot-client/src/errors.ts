/**
 * Typed errors so callers can distinguish "Riot is down" (serve stale data,
 * R11.2) from "we asked for something that doesn't exist" (skip the record) from
 * "we are being rate limited" (back off, alert — R11.5).
 */

export class RiotApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    options: { status: number; endpoint: string; retryAfterMs?: number | null },
  ) {
    super(message);
    this.name = 'RiotApiError';
    this.status = options.status;
    this.endpoint = options.endpoint;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }

  /** 404 — the resource genuinely doesn't exist. Not worth retrying. */
  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** 429 — we exceeded a limit. Always accompanied by a Retry-After when Riot sends one. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** 401/403 — usually an expired development key. Retrying will not help. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500 || this.status === 408;
  }
}

/** Thrown when the rate limiter cannot admit a request within its wait budget. */
export class RateLimitTimeoutError extends Error {
  readonly lane: string;
  readonly waitedMs: number;

  constructor(lane: string, waitedMs: number) {
    super(
      `Rate limiter did not admit a request on lane "${lane}" within ${waitedMs}ms. ` +
        'Either the lane is starved or the configured limits are too tight for current load.',
    );
    this.name = 'RateLimitTimeoutError';
    this.lane = lane;
    this.waitedMs = waitedMs;
  }
}
