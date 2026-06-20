// backoff.js
// Pure retry/backoff helpers shared (ported) into AggregatePenalties.gs and
// StatsBombRebuild.gs, which can't import ES modules. Keep in sync if this
// file changes.
// Laget av Mohibb Malik, 2025

// Exponential backoff delay in ms, doubling each attempt, capped at maxMs.
// attempt is 1-based (first retry = attempt 1).
export function backoffDelayMs(attempt, baseMs = 500, maxMs = 8000) {
  return Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
}

// Rate-limit / transient-error status codes worth retrying.
export function shouldRetry(statusCode) {
  return statusCode === 429 || statusCode === 403 || statusCode >= 500;
}
