/**
 * Smart Rate Limiter for Gemini API
 *
 * Features:
 * - Token bucket: enforces max N requests per rolling window
 * - Adaptive backoff: parses retryDelay from 429 responses and pauses globally
 * - Exponential backoff with jitter on consecutive failures
 * - Shared singleton so all agents respect the same budget
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimiterConfig {
  /** Maximum requests allowed per window (default: 15 — leaves headroom under the 20 RPD free-tier cap) */
  maxRequestsPerWindow: number;
  /** Rolling window size in milliseconds (default: 24 hours for daily quota) */
  windowMs: number;
  /** Minimum delay between any two requests in ms (default: 4000) */
  minIntervalMs: number;
  /** Maximum retry attempts for a single call (default: 3) */
  maxRetries: number;
  /** Base backoff delay in ms (default: 45000 — matches Gemini's typical retry suggestion) */
  baseBackoffMs: number;
  /** Maximum backoff delay in ms (default: 5 minutes) */
  maxBackoffMs: number;
}

interface RequestRecord {
  timestamp: number;
}

interface RateLimiterState {
  /** Rolling window of recent request timestamps */
  requests: RequestRecord[];
  /** If set, the limiter is paused until this epoch-ms */
  pausedUntil: number;
  /** Consecutive 429 failure count (resets on success) */
  consecutiveFailures: number;
  /** Total requests made today */
  totalRequestsToday: number;
  /** Day key to reset daily counter (YYYY-MM-DD) */
  dayKey: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxRequestsPerWindow: 15,   // conservative: free tier is 20/day
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  minIntervalMs: 4_000,       // at least 4 s between requests
  maxRetries: 3,
  baseBackoffMs: 45_000,      // Gemini's typical retryDelay
  maxBackoffMs: 5 * 60 * 1000, // 5 minutes max
};

// ---------------------------------------------------------------------------
// Singleton via globalThis (survives Next.js hot reloads)
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__geminiRateLimiterState__';

function getState(): RateLimiterState {
  const g = globalThis as unknown as Record<string, RateLimiterState>;
  const today = new Date().toISOString().slice(0, 10);

  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      requests: [],
      pausedUntil: 0,
      consecutiveFailures: 0,
      totalRequestsToday: 0,
      dayKey: today,
    };
  }

  // Reset daily counter on day rollover
  if (g[GLOBAL_KEY].dayKey !== today) {
    g[GLOBAL_KEY].dayKey = today;
    g[GLOBAL_KEY].totalRequestsToday = 0;
    g[GLOBAL_KEY].requests = [];
    g[GLOBAL_KEY].consecutiveFailures = 0;
    g[GLOBAL_KEY].pausedUntil = 0;
    console.log('[RateLimiter] Day rolled over — counters reset');
  }

  return g[GLOBAL_KEY];
}

// ---------------------------------------------------------------------------
// Config (also singleton)
// ---------------------------------------------------------------------------

const CONFIG_KEY = '__geminiRateLimiterConfig__';

function getConfig(): RateLimiterConfig {
  const g = globalThis as unknown as Record<string, RateLimiterConfig>;
  if (!g[CONFIG_KEY]) {
    g[CONFIG_KEY] = { ...DEFAULT_CONFIG };
  }
  return g[CONFIG_KEY];
}

export function configureRateLimiter(overrides: Partial<RateLimiterConfig>): void {
  const g = globalThis as unknown as Record<string, RateLimiterConfig>;
  g[CONFIG_KEY] = { ...getConfig(), ...overrides };
  console.log('[RateLimiter] Config updated:', g[CONFIG_KEY]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Prune timestamps older than the rolling window */
function pruneOldRequests(state: RateLimiterState, windowMs: number): void {
  const cutoff = Date.now() - windowMs;
  state.requests = state.requests.filter((r) => r.timestamp > cutoff);
}

/** Parse retryDelay seconds from a 429 error body */
export function parseRetryDelay(errorBody: string): number | null {
  // Try to parse "retryDelay": "42s" from the JSON body
  try {
    const parsed = JSON.parse(errorBody);
    const details = parsed?.error?.details;
    if (Array.isArray(details)) {
      for (const detail of details) {
        if (detail?.retryDelay) {
          const match = String(detail.retryDelay).match(/(\d+)/);
          if (match) return parseInt(match[1], 10) * 1000;
        }
      }
    }
  } catch {
    // Try regex fallback
  }

  // Regex fallback: "Please retry in 42.645837682s"
  const match = errorBody.match(/retry in (\d+(?:\.\d+)?)s/i);
  if (match) return Math.ceil(parseFloat(match[1])) * 1000;

  return null;
}

/** Calculate backoff with exponential increase + jitter */
function calculateBackoff(consecutiveFailures: number, config: RateLimiterConfig): number {
  const exponential = config.baseBackoffMs * Math.pow(2, consecutiveFailures - 1);
  const jitter = Math.random() * config.baseBackoffMs * 0.3; // up to 30% jitter
  return Math.min(exponential + jitter, config.maxBackoffMs);
}

// ---------------------------------------------------------------------------
// Core: Throttled Fetch
// ---------------------------------------------------------------------------

/**
 * Wraps a Gemini API fetch call with smart rate limiting.
 *
 * - Waits if we're in a pause window (from a previous 429)
 * - Waits if we've hit the rolling request cap
 * - Enforces minimum interval between requests
 * - On 429: parses retryDelay, pauses the limiter, and retries with backoff
 * - On success: resets consecutive failure counter
 */
export async function rateLimitedFetch(
  url: string,
  options: RequestInit,
  agentName: string = 'Agent',
): Promise<Response> {
  const config = getConfig();
  const state = getState();

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    // ---- 1. Respect global pause (from previous 429) ----
    const now = Date.now();
    if (state.pausedUntil > now) {
      const waitMs = state.pausedUntil - now;
      console.log(`[RateLimiter] [${agentName}] Paused — waiting ${Math.ceil(waitMs / 1000)}s before next request`);
      await sleep(waitMs);
    }

    // ---- 2. Check rolling window quota ----
    pruneOldRequests(state, config.windowMs);
    if (state.requests.length >= config.maxRequestsPerWindow) {
      const oldestInWindow = state.requests[0]?.timestamp ?? now;
      const waitUntil = oldestInWindow + config.windowMs - Date.now();
      if (waitUntil > 0) {
        console.warn(
          `[RateLimiter] [${agentName}] Daily quota reached (${state.requests.length}/${config.maxRequestsPerWindow}). ` +
          `Next slot in ${Math.ceil(waitUntil / 60000)} minutes. Skipping.`
        );
        throw new RateLimitExhaustedError(
          `Daily API quota exhausted (${state.requests.length}/${config.maxRequestsPerWindow}). ` +
          `Next slot available in ${Math.ceil(waitUntil / 60000)} minutes.`
        );
      }
    }

    // ---- 3. Enforce minimum interval ----
    const lastRequest = state.requests[state.requests.length - 1];
    if (lastRequest) {
      const elapsed = Date.now() - lastRequest.timestamp;
      if (elapsed < config.minIntervalMs) {
        const waitMs = config.minIntervalMs - elapsed;
        console.log(`[RateLimiter] [${agentName}] Spacing requests — waiting ${Math.ceil(waitMs / 1000)}s`);
        await sleep(waitMs);
      }
    }

    // ---- 4. Make the request ----
    console.log(
      `[RateLimiter] [${agentName}] Request ${attempt}/${config.maxRetries} ` +
      `(${state.requests.length + 1}/${config.maxRequestsPerWindow} in window, ` +
      `${state.totalRequestsToday + 1} today)`
    );

    state.requests.push({ timestamp: Date.now() });
    state.totalRequestsToday++;

    const response = await fetch(url, options);

    // ---- 5. Handle 429 ----
    if (response.status === 429) {
      state.consecutiveFailures++;
      const errorBody = await response.text().catch(() => '');

      // Parse suggested retry delay from the response body
      const suggestedDelay = parseRetryDelay(errorBody);
      const backoffMs = suggestedDelay ?? calculateBackoff(state.consecutiveFailures, config);

      // Pause the limiter globally
      state.pausedUntil = Date.now() + backoffMs;

      console.warn(
        `[RateLimiter] [${agentName}] 429 Rate Limited (attempt ${attempt}/${config.maxRetries}). ` +
        `Backing off ${Math.ceil(backoffMs / 1000)}s ` +
        `(consecutive failures: ${state.consecutiveFailures})`
      );

      if (attempt < config.maxRetries) {
        await sleep(backoffMs);
        continue; // retry
      }

      // Final attempt exhausted — throw with context
      throw new RateLimitError(
        `Gemini API rate limit exceeded after ${config.maxRetries} retries. ` +
        `Next retry suggested in ${Math.ceil(backoffMs / 1000)}s. ` +
        `Consider increasing scheduler interval or upgrading your API plan.`,
        backoffMs,
      );
    }

    // ---- 6. Success — reset failure counter ----
    if (response.ok) {
      if (state.consecutiveFailures > 0) {
        console.log(`[RateLimiter] [${agentName}] Request succeeded — resetting failure counter`);
      }
      state.consecutiveFailures = 0;
    }

    return response;
  }

  // Should not reach here, but just in case
  throw new Error(`[RateLimiter] [${agentName}] Exceeded max retries`);
}

// ---------------------------------------------------------------------------
// Custom Error Classes
// ---------------------------------------------------------------------------

export class RateLimitError extends Error {
  public retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class RateLimitExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitExhaustedError';
  }
}

// ---------------------------------------------------------------------------
// Status & Monitoring
// ---------------------------------------------------------------------------

export interface RateLimiterStatus {
  requestsInWindow: number;
  maxRequestsPerWindow: number;
  totalRequestsToday: number;
  consecutiveFailures: number;
  isPaused: boolean;
  pausedUntilISO: string | null;
  remainingQuota: number;
  nextSlotIn: string | null;
}

export function getRateLimiterStatus(): RateLimiterStatus {
  const config = getConfig();
  const state = getState();
  pruneOldRequests(state, config.windowMs);

  const now = Date.now();
  const isPaused = state.pausedUntil > now;
  const remaining = Math.max(0, config.maxRequestsPerWindow - state.requests.length);

  let nextSlotIn: string | null = null;
  if (remaining === 0 && state.requests.length > 0) {
    const oldestTimestamp = state.requests[0]?.timestamp ?? now;
    const nextSlotMs = oldestTimestamp + config.windowMs - now;
    if (nextSlotMs > 0) {
      nextSlotIn = `${Math.ceil(nextSlotMs / 60000)} minutes`;
    }
  }

  return {
    requestsInWindow: state.requests.length,
    maxRequestsPerWindow: config.maxRequestsPerWindow,
    totalRequestsToday: state.totalRequestsToday,
    consecutiveFailures: state.consecutiveFailures,
    isPaused,
    pausedUntilISO: isPaused ? new Date(state.pausedUntil).toISOString() : null,
    remainingQuota: remaining,
    nextSlotIn,
  };
}
