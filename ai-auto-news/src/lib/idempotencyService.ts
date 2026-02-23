import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

type IdempotencyStatus = 'pending' | 'completed' | 'failed';

interface IdempotencyEntry<T = unknown> {
  key: string;
  status: IdempotencyStatus;
  result?: T;
  error?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  fingerprint?: string;
}

interface IdempotencyMetrics {
  duplicatesDetected: number;
  keysStored: number;
  keysExpired: number;
  keysEvicted: number;
  pendingKeys: number;
  completedKeys: number;
  failedKeys: number;
}

type KeyExtractor<TReq> = (request: TReq) => string;

interface IdempotencyConfig {
  defaultTtlMs: number;
  maxEntries: number;
  cleanupIntervalMs: number;
}

const DEFAULT_CONFIG: IdempotencyConfig = {
  defaultTtlMs: 86400000, // 24 hours
  maxEntries: 50000,
  cleanupIntervalMs: 60000,
};

// ─── Built-in Key Extractors ──────────────────────────────────────────────────

export const keyExtractors = {
  fromHeader: (headerName: string): KeyExtractor<{ headers?: Record<string, string | undefined> }> => {
    return (request) => {
      const value = request.headers?.[headerName] ?? request.headers?.[headerName.toLowerCase()];
      if (!value) throw new Error(`Idempotency key header "${headerName}" not found`);
      return value;
    };
  },

  fromBody: (...fields: string[]): KeyExtractor<{ body?: Record<string, unknown> }> => {
    return (request) => {
      const parts: string[] = [];
      for (const field of fields) {
        const value = request.body?.[field];
        if (value === undefined) throw new Error(`Idempotency key field "${field}" not found in body`);
        parts.push(String(value));
      }
      return parts.join(':');
    };
  },

  composite: <TReq>(...extractors: Array<KeyExtractor<TReq>>): KeyExtractor<TReq> => {
    return (request) => {
      return extractors.map((e) => e(request)).join(':');
    };
  },
};

// ─── IdempotencyService ───────────────────────────────────────────────────────

export class IdempotencyService {
  private entries: Map<string, IdempotencyEntry> = new Map();
  private config: IdempotencyConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private metrics: IdempotencyMetrics = {
    duplicatesDetected: 0,
    keysStored: 0,
    keysExpired: 0,
    keysEvicted: 0,
    pendingKeys: 0,
    completedKeys: 0,
    failedKeys: 0,
  };

  constructor(config?: Partial<IdempotencyConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }

    logger.info('IdempotencyService initialized', {
      defaultTtlMs: this.config.defaultTtlMs,
      maxEntries: this.config.maxEntries,
    });
  }

  /**
   * Check if a request with this key has already been processed.
   * Returns the existing entry if found (duplicate), or null if the key is new.
   */
  check<T = unknown>(key: string): IdempotencyEntry<T> | null {
    if (!key) throw new Error('IdempotencyService: key is required');

    const entry = this.entries.get(key);
    if (!entry) return null;

    // Check expiration
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      this.metrics.keysExpired++;
      this.updateStatusMetrics();
      return null;
    }

    this.metrics.duplicatesDetected++;
    logger.debug('IdempotencyService: duplicate detected', { key, status: entry.status });
    return { ...entry } as IdempotencyEntry<T>;
  }

  /**
   * Register a new idempotency key as pending.
   * Returns false if the key already exists (duplicate).
   */
  register(key: string, options?: { ttlMs?: number; fingerprint?: string }): boolean {
    if (!key) throw new Error('IdempotencyService: key is required');

    // Check for existing non-expired entry
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      this.metrics.duplicatesDetected++;
      logger.debug('IdempotencyService: key already registered', { key, status: existing.status });
      return false;
    }

    // Evict if at capacity
    this.evictIfNeeded();

    const now = Date.now();
    const ttl = options?.ttlMs ?? this.config.defaultTtlMs;

    const entry: IdempotencyEntry = {
      key,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ttl,
      fingerprint: options?.fingerprint,
    };

    this.entries.set(key, entry);
    this.metrics.keysStored++;
    this.updateStatusMetrics();
    logger.debug('IdempotencyService: key registered', { key, ttl });
    return true;
  }

  /**
   * Mark a pending key as completed with its result.
   */
  complete<T = unknown>(key: string, result: T): boolean {
    const entry = this.entries.get(key);
    if (!entry) {
      logger.warn('IdempotencyService: cannot complete unknown key', { key });
      return false;
    }

    if (entry.status === 'completed') {
      logger.warn('IdempotencyService: key already completed', { key });
      return false;
    }

    entry.status = 'completed';
    entry.result = result;
    entry.updatedAt = Date.now();
    this.updateStatusMetrics();
    logger.debug('IdempotencyService: key completed', { key });
    return true;
  }

  /**
   * Mark a pending key as failed with an error message.
   * Optionally removes the key so the operation can be retried.
   */
  fail(key: string, errorMessage: string, options?: { removeOnFail?: boolean }): boolean {
    const entry = this.entries.get(key);
    if (!entry) {
      logger.warn('IdempotencyService: cannot fail unknown key', { key });
      return false;
    }

    if (options?.removeOnFail) {
      this.entries.delete(key);
      this.updateStatusMetrics();
      logger.debug('IdempotencyService: key removed on failure', { key });
      return true;
    }

    entry.status = 'failed';
    entry.error = errorMessage;
    entry.updatedAt = Date.now();
    this.updateStatusMetrics();
    logger.debug('IdempotencyService: key marked as failed', { key, error: errorMessage });
    return true;
  }

  /**
   * Execute a function idempotently. If the key was already processed,
   * returns the cached result. Otherwise executes the function and caches the result.
   */
  async execute<T>(
    key: string,
    fn: () => Promise<T> | T,
    options?: { ttlMs?: number; fingerprint?: string },
  ): Promise<T> {
    if (!key) throw new Error('IdempotencyService: key is required');

    // Check for existing result
    const existing = this.check<T>(key);
    if (existing) {
      if (existing.status === 'completed' && existing.result !== undefined) {
        logger.debug('IdempotencyService: returning cached result', { key });
        return existing.result;
      }
      if (existing.status === 'pending') {
        throw new Error(`IdempotencyService: operation "${key}" is already in progress`);
      }
      if (existing.status === 'failed') {
        // Allow retry of failed operations — remove old entry
        this.entries.delete(key);
      }
    }

    // Validate fingerprint consistency
    if (options?.fingerprint && existing?.fingerprint && options.fingerprint !== existing.fingerprint) {
      throw new Error(
        `IdempotencyService: fingerprint mismatch for key "${key}". ` +
        'The request body differs from the original request.',
      );
    }

    // Register and execute
    this.register(key, options);

    try {
      const result = await Promise.resolve(fn());
      this.complete(key, result);
      return result;
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.fail(key, error.message, { removeOnFail: true });
      throw error;
    }
  }

  /**
   * Remove a specific key from the store.
   */
  remove(key: string): boolean {
    const existed = this.entries.delete(key);
    if (existed) {
      this.updateStatusMetrics();
      logger.debug('IdempotencyService: key removed', { key });
    }
    return existed;
  }

  /**
   * Get an entry by key without incrementing duplicate counter.
   */
  get<T = unknown>(key: string): IdempotencyEntry<T> | null {
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      this.metrics.keysExpired++;
      this.updateStatusMetrics();
      return null;
    }

    return { ...entry } as IdempotencyEntry<T>;
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      this.metrics.keysExpired++;
      this.updateStatusMetrics();
      return false;
    }
    return true;
  }

  getMetrics(): IdempotencyMetrics {
    this.updateStatusMetrics();
    return { ...this.metrics };
  }

  getSize(): number {
    return this.entries.size;
  }

  clear(): void {
    const count = this.entries.size;
    this.entries.clear();
    this.updateStatusMetrics();
    logger.info('IdempotencyService: cleared all entries', { count });
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.entries.clear();
    this.metrics = {
      duplicatesDetected: 0,
      keysStored: 0,
      keysExpired: 0,
      keysEvicted: 0,
      pendingKeys: 0,
      completedKeys: 0,
      failedKeys: 0,
    };
    logger.info('IdempotencyService destroyed');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private cleanup(): void {
    const now = Date.now();
    let expired = 0;

    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        expired++;
      }
    }

    if (expired > 0) {
      this.metrics.keysExpired += expired;
      this.updateStatusMetrics();
      logger.debug('IdempotencyService: cleanup completed', { expired, remaining: this.entries.size });
    }
  }

  private evictIfNeeded(): void {
    if (this.entries.size < this.config.maxEntries) return;

    // Evict 10% of the oldest entries
    const evictCount = Math.max(1, Math.floor(this.config.maxEntries * 0.1));
    const sorted = Array.from(this.entries.entries()).sort(
      ([, a], [, b]) => a.createdAt - b.createdAt,
    );

    let evicted = 0;
    for (const [key] of sorted) {
      if (evicted >= evictCount) break;
      this.entries.delete(key);
      evicted++;
    }

    this.metrics.keysEvicted += evicted;
    this.updateStatusMetrics();
    logger.warn('IdempotencyService: evicted oldest entries due to capacity', {
      evicted,
      maxEntries: this.config.maxEntries,
    });
  }

  private updateStatusMetrics(): void {
    let pending = 0;
    let completed = 0;
    let failed = 0;

    for (const entry of this.entries.values()) {
      switch (entry.status) {
        case 'pending':
          pending++;
          break;
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
      }
    }

    this.metrics.pendingKeys = pending;
    this.metrics.completedKeys = completed;
    this.metrics.failedKeys = failed;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export function getIdempotencyService(): IdempotencyService {
  const g = globalThis as unknown as Record<string, IdempotencyService>;
  if (!g.__idempotencyService__) {
    g.__idempotencyService__ = new IdempotencyService();
  }
  return g.__idempotencyService__;
}
