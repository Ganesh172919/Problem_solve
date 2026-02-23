import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LockEntry {
  key: string;
  owner: string;
  acquiredAt: number;
  expiresAt: number;
  reentrantCount: number;
}

interface LockWaiter {
  owner: string;
  resolve: (acquired: boolean) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  enqueuedAt: number;
}

interface LockMetrics {
  totalAcquisitions: number;
  totalReleases: number;
  totalContentions: number;
  totalTimeouts: number;
  totalDeadlocksDetected: number;
  currentlyHeld: number;
}

interface AcquireOptions {
  ttl?: number;
  timeout?: number;
  owner?: string;
}

// ─── LockManager ──────────────────────────────────────────────────────────────

export class LockManager {
  private locks: Map<string, LockEntry> = new Map();
  private waitQueues: Map<string, LockWaiter[]> = new Map();
  private ownerLocks: Map<string, Set<string>> = new Map();
  private expirationTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private metrics: LockMetrics = {
    totalAcquisitions: 0,
    totalReleases: 0,
    totalContentions: 0,
    totalTimeouts: 0,
    totalDeadlocksDetected: 0,
    currentlyHeld: 0,
  };
  private defaultTtl: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options?: { defaultTtl?: number; cleanupIntervalMs?: number }) {
    this.defaultTtl = options?.defaultTtl ?? 30000;
    const cleanupMs = options?.cleanupIntervalMs ?? 10000;

    this.cleanupInterval = setInterval(() => this.cleanupExpiredLocks(), cleanupMs);
    // Prevent the interval from keeping Node alive
    if (typeof this.cleanupInterval === 'object' && 'unref' in this.cleanupInterval) {
      this.cleanupInterval.unref();
    }

    logger.info('LockManager initialized', { defaultTtl: this.defaultTtl, cleanupMs });
  }

  async acquire(key: string, options?: AcquireOptions): Promise<boolean> {
    const ttl = options?.ttl ?? this.defaultTtl;
    const timeout = options?.timeout ?? 5000;
    const owner = options?.owner ?? this.generateOwnerId();

    if (ttl <= 0) throw new Error('LockManager: TTL must be positive');

    // Check for re-entrant acquisition
    const existing = this.locks.get(key);
    if (existing && existing.owner === owner) {
      existing.reentrantCount++;
      existing.expiresAt = Date.now() + ttl;
      this.refreshExpiration(key, ttl);
      logger.debug('LockManager: re-entrant lock acquired', { key, owner, reentrantCount: existing.reentrantCount });
      this.metrics.totalAcquisitions++;
      return true;
    }

    // Try immediate acquisition
    if (!existing || existing.expiresAt <= Date.now()) {
      this.forceClearLock(key);
      return this.grantLock(key, owner, ttl);
    }

    // Deadlock detection: check if the current owner of this key is waiting for a lock held by 'owner'
    if (this.detectDeadlock(key, owner)) {
      this.metrics.totalDeadlocksDetected++;
      logger.warn('LockManager: deadlock detected, rejecting acquisition', { key, owner });
      return false;
    }

    // Contention — enqueue waiter
    this.metrics.totalContentions++;
    logger.debug('LockManager: lock contention, enqueuing waiter', { key, owner });

    return new Promise<boolean>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.removeWaiter(key, owner);
        this.metrics.totalTimeouts++;
        logger.debug('LockManager: lock acquisition timed out', { key, owner });
        resolve(false);
      }, timeout);

      // Prevent timeout from keeping Node alive
      if (typeof timeoutHandle === 'object' && 'unref' in timeoutHandle) {
        timeoutHandle.unref();
      }

      const waiter: LockWaiter = { owner, resolve, timeoutHandle, enqueuedAt: Date.now() };
      const queue = this.waitQueues.get(key) ?? [];
      queue.push(waiter);
      this.waitQueues.set(key, queue);
    });
  }

  release(key: string, owner: string): boolean {
    const entry = this.locks.get(key);
    if (!entry) {
      logger.debug('LockManager: release called for non-existent lock', { key, owner });
      return false;
    }

    if (entry.owner !== owner) {
      logger.warn('LockManager: release denied, owner mismatch', { key, expectedOwner: entry.owner, actualOwner: owner });
      return false;
    }

    // Re-entrant: decrement count
    if (entry.reentrantCount > 1) {
      entry.reentrantCount--;
      logger.debug('LockManager: re-entrant lock decremented', { key, owner, reentrantCount: entry.reentrantCount });
      return true;
    }

    this.removeLock(key);
    this.metrics.totalReleases++;
    logger.debug('LockManager: lock released', { key, owner });

    // Grant lock to next waiter (FIFO fair queuing)
    this.processWaitQueue(key);
    return true;
  }

  extend(key: string, owner: string, additionalTtl?: number): boolean {
    const entry = this.locks.get(key);
    if (!entry) return false;
    if (entry.owner !== owner) {
      logger.warn('LockManager: extend denied, owner mismatch', { key });
      return false;
    }

    const extension = additionalTtl ?? this.defaultTtl;
    entry.expiresAt = Date.now() + extension;
    this.refreshExpiration(key, extension);
    logger.debug('LockManager: lock extended', { key, owner, newExpiresAt: entry.expiresAt });
    return true;
  }

  isLocked(key: string): boolean {
    const entry = this.locks.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.forceClearLock(key);
      return false;
    }
    return true;
  }

  getLockInfo(key: string): Readonly<LockEntry> | null {
    const entry = this.locks.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.forceClearLock(key);
      return null;
    }
    return { ...entry };
  }

  getLocksForOwner(owner: string): string[] {
    return Array.from(this.ownerLocks.get(owner) ?? []);
  }

  getQueueLength(key: string): number {
    return this.waitQueues.get(key)?.length ?? 0;
  }

  getMetrics(): LockMetrics {
    return { ...this.metrics };
  }

  destroy(): void {
    // Clear all timers
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    for (const timer of this.expirationTimers.values()) {
      clearTimeout(timer);
    }
    this.expirationTimers.clear();

    // Reject all waiters
    for (const [, queue] of this.waitQueues) {
      for (const waiter of queue) {
        clearTimeout(waiter.timeoutHandle);
        waiter.resolve(false);
      }
    }
    this.waitQueues.clear();

    this.locks.clear();
    this.ownerLocks.clear();
    this.metrics.currentlyHeld = 0;
    logger.info('LockManager destroyed');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private grantLock(key: string, owner: string, ttl: number): true {
    const entry: LockEntry = {
      key,
      owner,
      acquiredAt: Date.now(),
      expiresAt: Date.now() + ttl,
      reentrantCount: 1,
    };

    this.locks.set(key, entry);
    this.metrics.totalAcquisitions++;
    this.metrics.currentlyHeld = this.locks.size;

    // Track owner → keys mapping
    const ownerSet = this.ownerLocks.get(owner) ?? new Set();
    ownerSet.add(key);
    this.ownerLocks.set(owner, ownerSet);

    this.refreshExpiration(key, ttl);
    return true;
  }

  private removeLock(key: string): void {
    const entry = this.locks.get(key);
    if (!entry) return;

    // Clear owner mapping
    const ownerSet = this.ownerLocks.get(entry.owner);
    if (ownerSet) {
      ownerSet.delete(key);
      if (ownerSet.size === 0) this.ownerLocks.delete(entry.owner);
    }

    // Clear expiration timer
    const timer = this.expirationTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.expirationTimers.delete(key);
    }

    this.locks.delete(key);
    this.metrics.currentlyHeld = this.locks.size;
  }

  private forceClearLock(key: string): void {
    const entry = this.locks.get(key);
    if (entry) {
      logger.debug('LockManager: force-clearing expired lock', { key, owner: entry.owner });
    }
    this.removeLock(key);
  }

  private refreshExpiration(key: string, ttl: number): void {
    const existing = this.expirationTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      logger.debug('LockManager: lock expired', { key });
      this.forceClearLock(key);
      this.processWaitQueue(key);
    }, ttl);

    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }

    this.expirationTimers.set(key, timer);
  }

  private processWaitQueue(key: string): void {
    const queue = this.waitQueues.get(key);
    if (!queue || queue.length === 0) return;

    // FIFO: take the first waiter
    const waiter = queue.shift()!;
    if (queue.length === 0) this.waitQueues.delete(key);

    clearTimeout(waiter.timeoutHandle);
    this.grantLock(key, waiter.owner, this.defaultTtl);
    waiter.resolve(true);
  }

  private removeWaiter(key: string, owner: string): void {
    const queue = this.waitQueues.get(key);
    if (!queue) return;

    const idx = queue.findIndex((w) => w.owner === owner);
    if (idx !== -1) {
      clearTimeout(queue[idx].timeoutHandle);
      queue.splice(idx, 1);
    }
    if (queue.length === 0) this.waitQueues.delete(key);
  }

  private detectDeadlock(requestedKey: string, requestingOwner: string): boolean {
    // Walk the wait-for graph: requestingOwner → wants → requestedKey → held by → currentOwner
    // Check if currentOwner is directly or transitively waiting for a lock held by requestingOwner
    const visited = new Set<string>();
    const currentHolder = this.locks.get(requestedKey);
    if (!currentHolder) return false;

    return this.hasWaitCycle(currentHolder.owner, requestingOwner, visited);
  }

  private hasWaitCycle(fromOwner: string, targetOwner: string, visited: Set<string>): boolean {
    if (fromOwner === targetOwner) return true;
    if (visited.has(fromOwner)) return false;
    visited.add(fromOwner);

    // Find all keys fromOwner is waiting for
    for (const [key, queue] of this.waitQueues) {
      const isWaiting = queue.some((w) => w.owner === fromOwner);
      if (!isWaiting) continue;

      const holder = this.locks.get(key);
      if (holder && this.hasWaitCycle(holder.owner, targetOwner, visited)) {
        return true;
      }
    }

    return false;
  }

  private cleanupExpiredLocks(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [key, entry] of this.locks) {
      if (entry.expiresAt <= now) {
        expired.push(key);
      }
    }

    for (const key of expired) {
      this.forceClearLock(key);
      this.processWaitQueue(key);
    }

    if (expired.length > 0) {
      logger.debug('LockManager: cleaned up expired locks', { count: expired.length });
    }
  }

  private generateOwnerId(): string {
    return `owner_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export function getLockManager(): LockManager {
  const g = globalThis as unknown as Record<string, LockManager>;
  if (!g.__lockManager__) {
    g.__lockManager__ = new LockManager();
  }
  return g.__lockManager__;
}
