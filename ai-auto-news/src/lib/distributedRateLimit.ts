import { getRedisClient } from './redis';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  limit: number;
}

class DistributedRateLimiter {
  private redis = getRedisClient();

  /**
   * Check rate limit using Redis sliding window algorithm
   * @param key - Unique identifier for the rate limit (e.g., userId, IP address)
   * @param limit - Maximum number of requests allowed in the window
   * @param windowMs - Time window in milliseconds
   */
  async check(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const redisKey = `ratelimit:${key}`;

    try {
      // Use Lua script for atomic operation
      const script = `
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local window_start = tonumber(ARGV[2])
        local limit = tonumber(ARGV[3])
        local window_ms = tonumber(ARGV[4])

        -- Remove old entries outside the window
        redis.call('ZREMRANGEBYSCORE', key, 0, window_start)

        -- Count current requests in window
        local current = redis.call('ZCARD', key)

        if current < limit then
          -- Add current request
          redis.call('ZADD', key, now, now)
          redis.call('PEXPIRE', key, window_ms)
          return {1, limit - current - 1, now + window_ms}
        else
          -- Get the oldest request in window
          local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
          local reset_at = tonumber(oldest[2]) + window_ms
          return {0, 0, reset_at}
        end
      `;

      const result = await this.redis.eval(
        script,
        1,
        redisKey,
        now,
        windowStart,
        limit,
        windowMs
      ) as number[];

      return {
        allowed: result[0] === 1,
        remaining: result[1],
        resetAt: new Date(result[2]),
        limit,
      };
    } catch (error) {
      console.error('Rate limit check failed:', error);
      // Fail open - allow request if Redis is down
      return {
        allowed: true,
        remaining: limit - 1,
        resetAt: new Date(now + windowMs),
        limit,
      };
    }
  }

  /**
   * Reset rate limit for a specific key
   */
  async reset(key: string): Promise<void> {
    const redisKey = `ratelimit:${key}`;
    await this.redis.del(redisKey);
  }

  /**
   * Get current usage for a key
   */
  async getUsage(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const redisKey = `ratelimit:${key}`;

    try {
      // Remove old entries
      await this.redis.getClient().zremrangebyscore(redisKey, 0, windowStart);
      // Count current entries
      return await this.redis.zcard(redisKey);
    } catch (error) {
      console.error('Get usage failed:', error);
      return 0;
    }
  }

  /**
   * Check multiple rate limits simultaneously
   */
  async checkMultiple(
    checks: Array<{ key: string; limit: number; windowMs: number }>
  ): Promise<RateLimitResult[]> {
    return await Promise.all(
      checks.map(check => this.check(check.key, check.limit, check.windowMs))
    );
  }

  /**
   * Increment counter (for simple counting without sliding window)
   */
  async increment(key: string, ttlSeconds: number): Promise<number> {
    const redisKey = `counter:${key}`;
    const count = await this.redis.incr(redisKey);
    if (count === 1) {
      await this.redis.expire(redisKey, ttlSeconds);
    }
    return count;
  }

  /**
   * Get counter value
   */
  async getCount(key: string): Promise<number> {
    const redisKey = `counter:${key}`;
    const value = await this.redis.get<string>(redisKey);
    return value ? parseInt(value) : 0;
  }

  /**
   * Decrement counter
   */
  async decrement(key: string): Promise<number> {
    const redisKey = `counter:${key}`;
    return await this.redis.decr(redisKey);
  }
}

// Singleton instance
let rateLimiterInstance: DistributedRateLimiter | null = null;

export function getDistributedRateLimiter(): DistributedRateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new DistributedRateLimiter();
  }
  return rateLimiterInstance;
}

export { DistributedRateLimiter };
export type { RateLimitResult };
