import { getLogger } from '../lib/logger';

const logger = getLogger();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResourceFactory<T> {
  create(): Promise<T>;
  destroy(resource: T): Promise<void>;
  validate(resource: T): Promise<boolean>;
  reset?(resource: T): Promise<void>;
}

export interface PoolOptions {
  minSize: number;
  maxSize: number;
  acquireTimeoutMs: number;
  idleTtlMs: number;
  maxUsageCount: number;
  healthCheckIntervalMs: number;
  warmupOnStart: boolean;
  autoScale: boolean;
  scaleUpThreshold: number;
  scaleDownThreshold: number;
}

export type PoolEventType =
  | 'acquired' | 'released' | 'created'
  | 'destroyed' | 'timeout' | 'healthcheck' | 'scaled';

export interface PoolEvent<T> {
  type: PoolEventType;
  pool: string;
  resource?: T;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type PoolEventListener<T> = (event: PoolEvent<T>) => void;

export interface PoolStats {
  active: number;
  idle: number;
  waiting: number;
  totalCreated: number;
  totalDestroyed: number;
  totalAcquired: number;
  totalReleased: number;
  totalTimeouts: number;
  size: number;
  maxSize: number;
  minSize: number;
}

export interface PoolPartitionConfig {
  name: string;
  options?: Partial<PoolOptions>;
  factory?: ResourceFactory<unknown>;
}

interface WrappedResource<T> {
  resource: T;
  createdAt: number;
  lastUsedAt: number;
  usageCount: number;
  id: string;
}

interface Waiter<T> {
  resolve: (wrapped: WrappedResource<T>) => void;
  reject: (error: Error) => void;
  priority: number;
  enqueuedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

// ─── Defaults & Helpers ───────────────────────────────────────────────────────

const DEFAULT_OPTIONS: PoolOptions = {
  minSize: 2, maxSize: 10, acquireTimeoutMs: 30_000, idleTtlMs: 60_000,
  maxUsageCount: 1000, healthCheckIntervalMs: 30_000, warmupOnStart: true,
  autoScale: true, scaleUpThreshold: 0.8, scaleDownThreshold: 0.2,
};

let resourceIdCounter = 0;
function nextResourceId(pool: string): string {
  return `${pool}_res_${++resourceIdCounter}`;
}

/** Binary-search insert to maintain descending-priority order (FIFO within same priority). */
function insertByPriority<T>(queue: Waiter<T>[], waiter: Waiter<T>): void {
  let lo = 0, hi = queue.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (queue[mid].priority > waiter.priority) lo = mid + 1;
    else hi = mid;
  }
  queue.splice(lo, 0, waiter);
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

// ─── ResourcePool ─────────────────────────────────────────────────────────────

export class ResourcePool<T> {
  private readonly name: string;
  private readonly factory: ResourceFactory<T>;
  private readonly opts: PoolOptions;
  private idle: WrappedResource<T>[] = [];
  private active = new Map<T, WrappedResource<T>>();
  private waiters: Waiter<T>[] = [];
  private listeners = new Map<PoolEventType, Set<PoolEventListener<T>>>();
  private totalCreated = 0;
  private totalDestroyed = 0;
  private totalAcquired = 0;
  private totalReleased = 0;
  private totalTimeouts = 0;
  private totalSize = 0;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private evictionTimer: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private closed = false;

  constructor(name: string, factory: ResourceFactory<T>, options?: Partial<PoolOptions>) {
    this.name = name;
    this.factory = factory;
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    if (this.opts.minSize < 0 || this.opts.maxSize < 1 || this.opts.minSize > this.opts.maxSize) {
      throw new Error(`Invalid pool size config: min=${this.opts.minSize}, max=${this.opts.maxSize}`);
    }
    logger.info('ResourcePool created', { pool: this.name, ...this.opts });
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.closed) throw new Error(`Pool "${this.name}" is closed`);
    this.startEvictionLoop();
    this.startHealthCheckLoop();
    if (this.opts.warmupOnStart) await this.warmup();
    logger.info('ResourcePool initialized', { pool: this.name, idleCount: this.idle.length });
  }

  private async warmup(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < this.opts.minSize; i++) {
      tasks.push(this.createResource().then((w) => { this.idle.push(w); }));
    }
    const results = await Promise.allSettled(tasks);
    const failures = results.filter((r) => r.status === 'rejected').length;
    if (failures > 0) {
      logger.warn('ResourcePool warmup had failures', { pool: this.name, failures, total: this.opts.minSize });
    }
  }

  // ─── Acquire / Release ────────────────────────────────────────────────

  async acquire(priority = 0): Promise<T> {
    if (this.closed) throw new Error(`Pool "${this.name}" is closed`);
    if (this.draining) throw new Error(`Pool "${this.name}" is draining`);

    // Try to get a validated idle resource (test-on-borrow)
    while (this.idle.length > 0) {
      const wrapped = this.idle.shift()!;
      if (await this.safeValidate(wrapped)) return this.checkout(wrapped);
      await this.destroyResource(wrapped);
    }

    // Create new resource if capacity available
    if (this.totalSize < this.opts.maxSize) {
      return this.checkout(await this.createResource());
    }

    // Auto-scale check
    if (this.opts.autoScale && this.totalSize < this.opts.maxSize) {
      const utilization = this.active.size / this.opts.maxSize;
      if (utilization >= this.opts.scaleUpThreshold) {
        return this.checkout(await this.createResource());
      }
    }

    // Queue waiter with priority-based FIFO ordering
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeWaiter(waiter);
        this.totalTimeouts++;
        this.emit('timeout', undefined, { waitMs: this.opts.acquireTimeoutMs, priority });
        reject(new Error(`Acquire timeout after ${this.opts.acquireTimeoutMs}ms in pool "${this.name}"`));
      }, this.opts.acquireTimeoutMs);

      const waiter: Waiter<T> = {
        resolve: (wrapped) => { clearTimeout(timer); resolve(this.checkout(wrapped)); },
        reject,
        priority,
        enqueuedAt: Date.now(),
        timer,
      };
      insertByPriority(this.waiters, waiter);
      logger.debug('ResourcePool waiter enqueued', { pool: this.name, priority, waitingCount: this.waiters.length });
    });
  }

  async release(resource: T): Promise<void> {
    const wrapped = this.active.get(resource);
    if (!wrapped) {
      logger.warn('ResourcePool: released unknown resource', { pool: this.name });
      return;
    }
    this.active.delete(resource);
    wrapped.lastUsedAt = Date.now();
    wrapped.usageCount++;
    this.totalReleased++;
    this.emit('released', resource);

    // Recycle if exceeded max usage count
    if (wrapped.usageCount >= this.opts.maxUsageCount) {
      logger.debug('ResourcePool: recycling resource (max usage)', { pool: this.name, id: wrapped.id, usageCount: wrapped.usageCount });
      await this.destroyResource(wrapped);
      await this.ensureMinSize();
      this.dispatchToWaiters();
      return;
    }

    // Reset the resource state if factory supports it
    if (this.factory.reset) {
      try {
        await this.factory.reset(resource);
      } catch {
        logger.warn('ResourcePool: reset failed, destroying resource', { pool: this.name, id: wrapped.id });
        await this.destroyResource(wrapped);
        await this.ensureMinSize();
        this.dispatchToWaiters();
        return;
      }
    }

    if (this.draining) {
      await this.destroyResource(wrapped);
      return;
    }

    // Hand directly to waiting acquirer or return to idle list
    if (this.waiters.length > 0) {
      this.waiters.shift()!.resolve(wrapped);
    } else {
      this.idle.push(wrapped);
    }
    this.dispatchToWaiters();
  }

  private checkout(wrapped: WrappedResource<T>): T {
    this.active.set(wrapped.resource, wrapped);
    this.totalAcquired++;
    this.emit('acquired', wrapped.resource);
    logger.debug('ResourcePool: resource acquired', { pool: this.name, id: wrapped.id });
    return wrapped.resource;
  }

  // ─── Resource Creation / Destruction ──────────────────────────────────

  private async createResource(): Promise<WrappedResource<T>> {
    const resource = await this.factory.create();
    const id = nextResourceId(this.name);
    const now = Date.now();
    const wrapped: WrappedResource<T> = { resource, createdAt: now, lastUsedAt: now, usageCount: 0, id };
    this.totalCreated++;
    this.totalSize++;
    this.emit('created', resource, { id });
    logger.debug('ResourcePool: resource created', { pool: this.name, id, totalSize: this.totalSize });
    return wrapped;
  }

  private async destroyResource(wrapped: WrappedResource<T>): Promise<void> {
    try {
      await this.factory.destroy(wrapped.resource);
    } catch (err) {
      logger.error('ResourcePool: destroy failed', toError(err), { pool: this.name, id: wrapped.id });
    }
    this.totalDestroyed++;
    this.totalSize = Math.max(0, this.totalSize - 1);
    this.emit('destroyed', wrapped.resource, { id: wrapped.id });
    logger.debug('ResourcePool: resource destroyed', { pool: this.name, id: wrapped.id, totalSize: this.totalSize });
  }

  private async safeValidate(wrapped: WrappedResource<T>): Promise<boolean> {
    try { return await this.factory.validate(wrapped.resource); } catch { return false; }
  }

  // ─── Eviction ─────────────────────────────────────────────────────────

  private startEvictionLoop(): void {
    if (this.evictionTimer) return;
    const interval = Math.max(1000, Math.floor(this.opts.idleTtlMs / 3));
    this.evictionTimer = setInterval(() => { void this.evictIdle(); }, interval);
    if (this.evictionTimer.unref) this.evictionTimer.unref();
  }

  private async evictIdle(): Promise<void> {
    const now = Date.now();
    const toEvict: WrappedResource<T>[] = [];
    const kept: WrappedResource<T>[] = [];
    for (const wrapped of this.idle) {
      if (now - wrapped.lastUsedAt > this.opts.idleTtlMs && this.totalSize > this.opts.minSize) {
        toEvict.push(wrapped);
      } else {
        kept.push(wrapped);
      }
    }
    if (toEvict.length === 0) return;
    this.idle = kept;
    logger.debug('ResourcePool: evicting idle resources', { pool: this.name, count: toEvict.length });
    for (const wrapped of toEvict) await this.destroyResource(wrapped);

    // Auto-scale down when utilization drops below threshold
    if (this.opts.autoScale) {
      const utilization = this.totalSize > 0 ? this.active.size / this.totalSize : 0;
      if (utilization < this.opts.scaleDownThreshold && this.idle.length > this.opts.minSize) {
        const extra = this.idle.splice(this.opts.minSize);
        for (const w of extra) await this.destroyResource(w);
        if (extra.length > 0) this.emit('scaled', undefined, { direction: 'down', removed: extra.length });
      }
    }
  }

  // ─── Health Checks ────────────────────────────────────────────────────

  private startHealthCheckLoop(): void {
    if (this.healthCheckTimer) return;
    this.healthCheckTimer = setInterval(() => { void this.runHealthChecks(); }, this.opts.healthCheckIntervalMs);
    if (this.healthCheckTimer.unref) this.healthCheckTimer.unref();
  }

  private async runHealthChecks(): Promise<void> {
    const checked: WrappedResource<T>[] = [];
    const failed: WrappedResource<T>[] = [];
    for (const wrapped of this.idle) {
      if (await this.safeValidate(wrapped)) checked.push(wrapped);
      else failed.push(wrapped);
    }
    this.idle = checked;
    for (const wrapped of failed) {
      logger.debug('ResourcePool: health check failed, destroying', { pool: this.name, id: wrapped.id });
      await this.destroyResource(wrapped);
    }
    this.emit('healthcheck', undefined, { checked: checked.length, failed: failed.length });
    await this.ensureMinSize();
  }

  private async ensureMinSize(): Promise<void> {
    while (this.totalSize < this.opts.minSize && !this.closed) {
      try {
        this.idle.push(await this.createResource());
      } catch (err) {
        logger.error('ResourcePool: failed to ensure min size', toError(err), { pool: this.name });
        break;
      }
    }
  }

  // ─── Waiter Dispatch ──────────────────────────────────────────────────

  private async dispatchToWaiters(): Promise<void> {
    while (this.waiters.length > 0 && this.idle.length > 0) {
      const wrapped = this.idle.shift()!;
      if (!(await this.safeValidate(wrapped))) { await this.destroyResource(wrapped); continue; }
      this.waiters.shift()!.resolve(wrapped);
    }
    // Create new resources for remaining waiters when capacity allows
    while (this.waiters.length > 0 && this.totalSize < this.opts.maxSize) {
      try {
        this.waiters.shift()!.resolve(await this.createResource());
      } catch (err) {
        logger.error('ResourcePool: failed to create for waiter', toError(err), { pool: this.name });
        break;
      }
    }
  }

  private removeWaiter(waiter: Waiter<T>): void {
    const idx = this.waiters.indexOf(waiter);
    if (idx >= 0) this.waiters.splice(idx, 1);
  }

  // ─── Events ───────────────────────────────────────────────────────────

  on(event: PoolEventType, listener: PoolEventListener<T>): () => void {
    let set = this.listeners.get(event);
    if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(listener);
    return () => set!.delete(listener);
  }

  private emit(type: PoolEventType, resource?: T, metadata?: Record<string, unknown>): void {
    const evt: PoolEvent<T> = { type, pool: this.name, resource, timestamp: Date.now(), metadata };
    const set = this.listeners.get(type);
    if (!set) return;
    Array.from(set).forEach((listener) => {
      try { listener(evt); } catch (err) {
        logger.error('ResourcePool: event listener error', toError(err), { pool: this.name, event: type });
      }
    });
  }

  // ─── Stats ────────────────────────────────────────────────────────────

  getStats(): PoolStats {
    return {
      active: this.active.size, idle: this.idle.length, waiting: this.waiters.length,
      totalCreated: this.totalCreated, totalDestroyed: this.totalDestroyed,
      totalAcquired: this.totalAcquired, totalReleased: this.totalReleased,
      totalTimeouts: this.totalTimeouts, size: this.totalSize,
      maxSize: this.opts.maxSize, minSize: this.opts.minSize,
    };
  }

  getName(): string { return this.name; }

  // ─── Drain & Shutdown ─────────────────────────────────────────────────

  async drain(timeoutMs = 30_000): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    logger.info('ResourcePool: draining', { pool: this.name, active: this.active.size });

    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`Pool "${this.name}" is draining`));
    }
    this.waiters = [];

    // Wait for active resources to be returned, with timeout
    if (this.active.size > 0) {
      await new Promise<void>((resolve) => {
        const check = setInterval(() => { if (this.active.size === 0) { clearInterval(check); resolve(); } }, 100);
        setTimeout(() => { clearInterval(check); resolve(); }, timeoutMs);
      });
    }

    for (const wrapped of this.idle) await this.destroyResource(wrapped);
    this.idle = [];
    Array.from(this.active.values()).forEach(async (wrapped) => { await this.destroyResource(wrapped); });
    this.active.clear();
    logger.info('ResourcePool: drained', { pool: this.name });
  }

  async shutdown(): Promise<void> {
    logger.info('ResourcePool: shutting down', { pool: this.name });
    if (this.healthCheckTimer) { clearInterval(this.healthCheckTimer); this.healthCheckTimer = null; }
    if (this.evictionTimer) { clearInterval(this.evictionTimer); this.evictionTimer = null; }
    await this.drain();
    this.closed = true;
    this.listeners.clear();
    logger.info('ResourcePool: shut down complete', { pool: this.name, stats: this.getStats() });
  }
}

// ─── PoolPartitionManager ─────────────────────────────────────────────────────

export class PoolPartitionManager {
  private pools = new Map<string, ResourcePool<unknown>>();
  private defaultOptions: Partial<PoolOptions>;

  constructor(options?: { defaultOptions?: Partial<PoolOptions> }) {
    this.defaultOptions = options?.defaultOptions ?? {};
    logger.info('PoolPartitionManager created');
  }

  async createPartition<T>(
    name: string, factory: ResourceFactory<T>, options?: Partial<PoolOptions>,
  ): Promise<ResourcePool<T>> {
    if (this.pools.has(name)) throw new Error(`Partition "${name}" already exists`);
    const merged = { ...this.defaultOptions, ...options };
    const pool = new ResourcePool<T>(name, factory, merged);
    this.pools.set(name, pool as unknown as ResourcePool<unknown>);
    await pool.initialize();
    logger.info('PoolPartitionManager: partition created', { name });
    return pool;
  }

  getPartition<T>(name: string): ResourcePool<T> {
    const pool = this.pools.get(name);
    if (!pool) throw new Error(`Partition "${name}" not found`);
    return pool as unknown as ResourcePool<T>;
  }

  hasPartition(name: string): boolean { return this.pools.has(name); }
  listPartitions(): string[] { return Array.from(this.pools.keys()); }

  getPartitionStats(): Record<string, PoolStats> {
    const result: Record<string, PoolStats> = {};
    Array.from(this.pools.entries()).forEach(([name, pool]) => { result[name] = pool.getStats(); });
    return result;
  }

  getAggregateStats(): PoolStats {
    const agg: PoolStats = {
      active: 0, idle: 0, waiting: 0, totalCreated: 0, totalDestroyed: 0,
      totalAcquired: 0, totalReleased: 0, totalTimeouts: 0, size: 0, maxSize: 0, minSize: 0,
    };
    Array.from(this.pools.values()).forEach((pool) => {
      const s = pool.getStats();
      agg.active += s.active; agg.idle += s.idle; agg.waiting += s.waiting;
      agg.totalCreated += s.totalCreated; agg.totalDestroyed += s.totalDestroyed;
      agg.totalAcquired += s.totalAcquired; agg.totalReleased += s.totalReleased;
      agg.totalTimeouts += s.totalTimeouts; agg.size += s.size;
      agg.maxSize += s.maxSize; agg.minSize += s.minSize;
    });
    return agg;
  }

  async removePartition(name: string): Promise<void> {
    const pool = this.pools.get(name);
    if (!pool) return;
    await pool.shutdown();
    this.pools.delete(name);
    logger.info('PoolPartitionManager: partition removed', { name });
  }

  async shutdownAll(): Promise<void> {
    logger.info('PoolPartitionManager: shutting down all partitions', { partitions: this.listPartitions() });
    const tasks = Array.from(this.pools.entries()).map(async ([name, pool]) => {
      try { await pool.shutdown(); } catch (err) {
        logger.error('PoolPartitionManager: shutdown error', toError(err), { partition: name });
      }
    });
    await Promise.allSettled(tasks);
    this.pools.clear();
    logger.info('PoolPartitionManager: all partitions shut down');
  }
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

export async function createPool<T>(
  name: string, factory: ResourceFactory<T>, options?: Partial<PoolOptions>,
): Promise<ResourcePool<T>> {
  const pool = new ResourcePool<T>(name, factory, options);
  await pool.initialize();
  return pool;
}

export async function withResource<T, R>(
  pool: ResourcePool<T>, fn: (resource: T) => Promise<R>, priority = 0,
): Promise<R> {
  const resource = await pool.acquire(priority);
  try { return await fn(resource); } finally { await pool.release(resource); }
}
