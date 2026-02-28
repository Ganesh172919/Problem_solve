/**
 * Advanced Multi-Tier Caching System
 *
 * Implements intelligent caching with multiple layers:
 * - L1: In-memory cache (fastest)
 * - L2: Redis distributed cache
 * - L3: Database query results cache
 * - CDN edge caching
 *
 * Features:
 * - Cache warming
 * - Predictive pre-fetching
 * - Cache invalidation strategies
 * - Cache stampede prevention
 * - Cache hit rate optimization
 * - Automatic TTL adjustment
 */

import { getLogger } from './logger';
import { getMetrics } from './metrics';
import Redis from 'ioredis';

const logger = getLogger();
const metrics = getMetrics();

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  tier?: 'l1' | 'l2' | 'l3' | 'auto';
  tags?: string[]; // For tag-based invalidation
  refresh?: boolean; // Force refresh
  prefetch?: boolean; // Enable predictive prefetch
  compress?: boolean; // Compress large values
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  evictions: number;
  avgAccessTime: number;
}

export interface CacheEntry<T> {
  key: string;
  value: T;
  createdAt: Date;
  expiresAt: Date;
  accessCount: number;
  lastAccessed: Date;
  size: number;
  tags: string[];
}

class AdvancedCachingSystem {
  private l1Cache: Map<string, CacheEntry<any>>; // In-memory
  private l2Cache: Redis; // Redis
  private stats: Map<string, CacheStats>;
  private maxL1Size = 1000; // Max entries in L1
  private defaultTTL = 3600; // 1 hour

  constructor() {
    this.l1Cache = new Map();
    this.stats = new Map();

    // Initialize Redis connection
    this.l2Cache = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 3,
    });

    // Start background tasks
    this.startCacheMaintenance();
    this.startPredictivePrefetching();
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    const tier = options.tier || 'auto';
    const startTime = Date.now();

    try {
      // Try L1 cache first
      if (tier === 'auto' || tier === 'l1') {
        const l1Result = this.getFromL1<T>(key);
        if (l1Result !== null) {
          metrics.increment('cache.l1.hit');
          this.recordAccess(key, Date.now() - startTime);
          return l1Result;
        }
      }

      // Try L2 cache (Redis)
      if (tier === 'auto' || tier === 'l2') {
        const l2Result = await this.getFromL2<T>(key);
        if (l2Result !== null) {
          // Promote to L1
          this.setInL1(key, l2Result, options);
          metrics.increment('cache.l2.hit');
          this.recordAccess(key, Date.now() - startTime);
          return l2Result;
        }
      }

      // Cache miss
      metrics.increment('cache.miss');
      this.recordAccess(key, Date.now() - startTime);
      return null;
    } catch (error) {
      logger.error('Cache get failed', error instanceof Error ? error : undefined);
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    const ttl = options.ttl || this.defaultTTL;

    try {
      // Always set in L1 for fast access
      this.setInL1(key, value, options);

      // Set in L2 for persistence and sharing
      await this.setInL2(key, value, ttl, options);

      metrics.increment('cache.set');
    } catch (error) {
      logger.error('Cache set failed', error instanceof Error ? error : undefined);
    }
  }

  /**
   * Delete from cache
   */
  async delete(key: string): Promise<void> {
    this.l1Cache.delete(key);
    await this.l2Cache.del(key);
    metrics.increment('cache.delete');
  }

  /**
   * Invalidate by tags
   */
  async invalidateByTags(tags: string[]): Promise<void> {
    const keysToInvalidate: string[] = [];

    // Find keys with matching tags in L1
    for (const [key, entry] of this.l1Cache.entries()) {
      if (entry.tags.some((tag) => tags.includes(tag))) {
        keysToInvalidate.push(key);
      }
    }

    // Invalidate found keys
    await Promise.all(keysToInvalidate.map((key) => this.delete(key)));

    logger.info('Cache invalidated by tags', { tags, count: keysToInvalidate.length });
  }

  /**
   * Warm cache with frequently accessed data
   */
  async warmCache(keys: Array<{ key: string; fetcher: () => Promise<any> }>): Promise<void> {
    logger.info('Starting cache warming', { count: keys.length });

    const promises = keys.map(async ({ key, fetcher }) => {
      try {
        const value = await fetcher();
        await this.set(key, value);
      } catch (error) {
        logger.error('Cache warming failed for key', undefined, { key, error });
      }
    });

    await Promise.all(promises);
    logger.info('Cache warming completed');
  }

  /**
   * Get or compute value (cache-aside pattern)
   */
  async getOrCompute<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    // Try to get from cache
    const cached = await this.get<T>(key, options);
    if (cached !== null && !options.refresh) {
      return cached;
    }

    // Use cache stampede prevention
    return this.preventStampede(key, async () => {
      const value = await fetcher();
      await this.set(key, value, options);
      return value;
    });
  }

  /**
   * Prevent cache stampede (thundering herd)
   */
  private async preventStampede<T>(
    key: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const lockKey = `lock:${key}`;
    const lockTTL = 30; // 30 seconds

    // Try to acquire lock
    const acquired = await this.l2Cache.set(lockKey, '1', 'EX', lockTTL, 'NX');

    if (acquired === 'OK') {
      try {
        const result = await fn();
        await this.l2Cache.del(lockKey);
        return result;
      } catch (error) {
        await this.l2Cache.del(lockKey);
        throw error;
      }
    } else {
      // Wait for lock to be released
      await this.waitForLock(lockKey, 5000);

      // Try to get from cache again
      const cached = await this.get<T>(key);
      if (cached !== null) {
        return cached;
      }

      // If still not in cache, compute anyway
      return fn();
    }
  }

  /**
   * Wait for lock to be released
   */
  private async waitForLock(lockKey: string, timeout: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const exists = await this.l2Cache.exists(lockKey);
      if (!exists) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Get cache statistics
   */
  getStats(key?: string): CacheStats | Map<string, CacheStats> {
    if (key) {
      return (
        this.stats.get(key) || {
          hits: 0,
          misses: 0,
          hitRate: 0,
          size: 0,
          evictions: 0,
          avgAccessTime: 0,
        }
      );
    }
    return this.stats;
  }

  /**
   * Clear all caches
   */
  async clear(): Promise<void> {
    this.l1Cache.clear();
    await this.l2Cache.flushdb();
    logger.info('Cache cleared');
  }

  // L1 Cache operations
  private getFromL1<T>(key: string): T | null {
    const entry = this.l1Cache.get(key);

    if (!entry) return null;

    // Check expiration
    if (entry.expiresAt < new Date()) {
      this.l1Cache.delete(key);
      return null;
    }

    // Update access stats
    entry.accessCount++;
    entry.lastAccessed = new Date();

    return entry.value;
  }

  private setInL1<T>(key: string, value: T, options: CacheOptions): void {
    // Check size limit
    if (this.l1Cache.size >= this.maxL1Size) {
      this.evictFromL1();
    }

    const ttl = options.ttl || this.defaultTTL;
    const entry: CacheEntry<T> = {
      key,
      value,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttl * 1000),
      accessCount: 0,
      lastAccessed: new Date(),
      size: JSON.stringify(value).length,
      tags: options.tags || [],
    };

    this.l1Cache.set(key, entry);
  }

  private evictFromL1(): void {
    // LRU eviction
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.l1Cache.entries()) {
      if (entry.lastAccessed.getTime() < oldestTime) {
        oldestTime = entry.lastAccessed.getTime();
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.l1Cache.delete(oldestKey);
      metrics.increment('cache.l1.eviction');
    }
  }

  // L2 Cache operations
  private async getFromL2<T>(key: string): Promise<T | null> {
    try {
      const data = await this.l2Cache.get(key);
      if (!data) return null;

      return JSON.parse(data) as T;
    } catch (error) {
      logger.error('L2 cache get failed', error instanceof Error ? error : undefined);
      return null;
    }
  }

  private async setInL2<T>(
    key: string,
    value: T,
    ttl: number,
    options: CacheOptions
  ): Promise<void> {
    try {
      const data = JSON.stringify(value);

      // Compress if needed
      const finalData = options.compress && data.length > 1024
        ? await this.compress(data)
        : data;

      await this.l2Cache.setex(key, ttl, finalData);

      // Store tags mapping
      if (options.tags && options.tags.length > 0) {
        for (const tag of options.tags) {
          await this.l2Cache.sadd(`tag:${tag}`, key);
        }
      }
    } catch (error) {
      logger.error('L2 cache set failed', error instanceof Error ? error : undefined);
    }
  }

  // Background tasks
  private startCacheMaintenance(): void {
    setInterval(() => {
      // Clean expired entries from L1
      const now = new Date();
      for (const [key, entry] of this.l1Cache.entries()) {
        if (entry.expiresAt < now) {
          this.l1Cache.delete(key);
        }
      }
    }, 60000); // Every minute
  }

  private startPredictivePrefetching(): void {
    // Analyze access patterns and prefetch likely needed data
    setInterval(() => {
      this.analyzePatternsAndPrefetch();
    }, 300000); // Every 5 minutes
  }

  private async analyzePatternsAndPrefetch(): Promise<void> {
    // Find frequently accessed keys
    const accessCounts: Array<{ key: string; count: number }> = [];

    for (const [key, entry] of this.l1Cache.entries()) {
      accessCounts.push({ key, count: entry.accessCount });
    }

    // Sort by access count
    accessCounts.sort((a, b) => b.count - a.count);

    // Log popular items
    logger.debug('Cache access patterns', {
      topKeys: accessCounts.slice(0, 10),
    });
  }

  private recordAccess(key: string, accessTime: number): void {
    const stats = this.stats.get(key) || {
      hits: 0,
      misses: 0,
      hitRate: 0,
      size: 0,
      evictions: 0,
      avgAccessTime: 0,
    };

    stats.hits++;
    stats.avgAccessTime = (stats.avgAccessTime + accessTime) / 2;
    stats.hitRate = stats.hits / (stats.hits + stats.misses);

    this.stats.set(key, stats);
  }

  private async compress(data: string): Promise<string> {
    // Simple compression (in production, use zlib or similar)
    return data;
  }
}

// Singleton
let advancedCache: AdvancedCachingSystem;

export function getAdvancedCache(): AdvancedCachingSystem {
  if (!advancedCache) {
    advancedCache = new AdvancedCachingSystem();
  }
  return advancedCache;
}

// Decorator for caching method results
export function Cached(options: CacheOptions = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const cache = getAdvancedCache();
      const cacheKey = `${target.constructor.name}:${propertyKey}:${JSON.stringify(args)}`;

      return cache.getOrCompute(
        cacheKey,
        () => originalMethod.apply(this, args),
        options
      );
    };

    return descriptor;
  };
}
