interface RateLimitWindow {
  timestamps: number[];
}

class RateLimiter {
  private store = new Map<string, RateLimitWindow>();

  check(
    key: string,
    limit: number,
    windowMs: number,
  ): { allowed: boolean; remaining: number; resetAt: number; limit: number } {
    const now = Date.now();
    const windowStart = now - windowMs;

    let window = this.store.get(key);
    if (!window) {
      window = { timestamps: [] };
      this.store.set(key, window);
    }

    // Evict timestamps outside the current window
    window.timestamps = window.timestamps.filter((ts) => ts > windowStart);

    const count = window.timestamps.length;
    const allowed = count < limit;

    if (allowed) {
      window.timestamps.push(now);
    }

    const oldest = window.timestamps[0];
    const resetAt = oldest ? oldest + windowMs : now + windowMs;
    const remaining = Math.max(0, allowed ? limit - count - 1 : 0);

    return { allowed, remaining, resetAt, limit };
  }

  reset(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

const GLOBAL_RATE_LIMITER_KEY = '__rateLimiter__';

function getGlobalRateLimiter(): RateLimiter {
  const g = globalThis as unknown as Record<string, RateLimiter>;
  if (!g[GLOBAL_RATE_LIMITER_KEY]) {
    g[GLOBAL_RATE_LIMITER_KEY] = new RateLimiter();
  }
  return g[GLOBAL_RATE_LIMITER_KEY];
}

export const rateLimiter = getGlobalRateLimiter();

export function buildRateLimitKey(prefix: string, identifier: string): string {
  return `${prefix}:${identifier}`;
}
