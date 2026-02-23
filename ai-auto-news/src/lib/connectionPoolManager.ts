import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PooledConnection<T> {
  id: string;
  resource: T;
  createdAt: number;
  lastUsedAt: number;
  lastHealthCheck: number;
  inUse: boolean;
}

interface ConnectionFactory<T> {
  create: () => Promise<T> | T;
  destroy: (resource: T) => Promise<void> | void;
  validate?: (resource: T) => Promise<boolean> | boolean;
}

interface PoolConfig {
  name: string;
  minSize: number;
  maxSize: number;
  idleTimeoutMs: number;
  maxLifetimeMs: number;
  healthCheckIntervalMs: number;
  acquireTimeoutMs: number;
  warmUpOnInit: boolean;
}

interface PoolMetrics {
  active: number;
  idle: number;
  waiting: number;
  totalCreated: number;
  totalDestroyed: number;
  totalAcquired: number;
  totalReleased: number;
  totalFailedHealthChecks: number;
}

interface PoolWaiter<T> {
  resolve: (conn: T) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  enqueuedAt: number;
}

const DEFAULT_POOL_CONFIG: PoolConfig = {
  name: 'default',
  minSize: 2,
  maxSize: 10,
  idleTimeoutMs: 60000,
  maxLifetimeMs: 300000,
  healthCheckIntervalMs: 30000,
  acquireTimeoutMs: 5000,
  warmUpOnInit: true,
};

let poolConnectionCounter = 0;
const poolInstanceId = Math.random().toString(36).slice(2, 8);

function generateConnectionId(poolName: string): string {
  return `${poolName}_conn_${poolInstanceId}_${++poolConnectionCounter}`;
}

// ─── ConnectionPool ───────────────────────────────────────────────────────────

export class ConnectionPool<T> {
  private pool: Map<string, PooledConnection<T>> = new Map();
  private waitQueue: Array<PoolWaiter<T>> = [];
  private config: PoolConfig;
  private factory: ConnectionFactory<T>;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private metrics: PoolMetrics = {
    active: 0,
    idle: 0,
    waiting: 0,
    totalCreated: 0,
    totalDestroyed: 0,
    totalAcquired: 0,
    totalReleased: 0,
    totalFailedHealthChecks: 0,
  };

  constructor(factory: ConnectionFactory<T>, config?: Partial<PoolConfig>) {
    this.factory = factory;
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };

    if (this.config.minSize < 0) throw new Error('ConnectionPool: minSize must be >= 0');
    if (this.config.maxSize < 1) throw new Error('ConnectionPool: maxSize must be >= 1');
    if (this.config.minSize > this.config.maxSize) {
      throw new Error('ConnectionPool: minSize cannot exceed maxSize');
    }

    this.startHealthChecks();
    this.startIdleChecks();

    logger.info('ConnectionPool created', {
      name: this.config.name,
      minSize: this.config.minSize,
      maxSize: this.config.maxSize,
    });
  }

  async warmUp(): Promise<void> {
    if (this.closed) return;

    const toCreate = Math.max(0, this.config.minSize - this.pool.size);
    logger.info('ConnectionPool: warming up', { name: this.config.name, count: toCreate });

    const promises: Array<Promise<void>> = [];
    for (let i = 0; i < toCreate; i++) {
      promises.push(this.createConnection().then(() => undefined));
    }

    const results = await Promise.allSettled(promises);
    const failures = results.filter((r) => r.status === 'rejected').length;
    if (failures > 0) {
      logger.warn('ConnectionPool: some warm-up connections failed', {
        name: this.config.name,
        failures,
      });
    }
  }

  async acquire(): Promise<T> {
    if (this.closed) {
      throw new Error(`ConnectionPool [${this.config.name}]: pool is closed`);
    }

    // Try to find an idle, valid connection
    for (const [id, conn] of this.pool) {
      if (!conn.inUse) {
        // Check max lifetime
        if (Date.now() - conn.createdAt > this.config.maxLifetimeMs) {
          await this.destroyConnection(id);
          continue;
        }

        // Validate connection if validator provided
        if (this.factory.validate) {
          try {
            const valid = await Promise.resolve(this.factory.validate(conn.resource));
            if (!valid) {
              await this.destroyConnection(id);
              continue;
            }
          } catch {
            await this.destroyConnection(id);
            continue;
          }
        }

        conn.inUse = true;
        conn.lastUsedAt = Date.now();
        this.updateCountMetrics();
        this.metrics.totalAcquired++;
        return conn.resource;
      }
    }

    // Create a new connection if under maxSize
    if (this.pool.size < this.config.maxSize) {
      try {
        const conn = await this.createConnection();
        conn.inUse = true;
        conn.lastUsedAt = Date.now();
        this.updateCountMetrics();
        this.metrics.totalAcquired++;
        return conn.resource;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error('ConnectionPool: failed to create connection', error, { name: this.config.name });
        throw error;
      }
    }

    // Pool is full — enqueue waiter
    return new Promise<T>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        const idx = this.waitQueue.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        this.metrics.waiting = this.waitQueue.length;
        reject(new Error(`ConnectionPool [${this.config.name}]: acquire timeout after ${this.config.acquireTimeoutMs}ms`));
      }, this.config.acquireTimeoutMs);

      if (typeof timeoutHandle === 'object' && 'unref' in timeoutHandle) {
        timeoutHandle.unref();
      }

      this.waitQueue.push({ resolve, reject, timeoutHandle, enqueuedAt: Date.now() });
      this.metrics.waiting = this.waitQueue.length;
      logger.debug('ConnectionPool: waiter enqueued', {
        name: this.config.name,
        waiting: this.waitQueue.length,
      });
    });
  }

  async release(resource: T): Promise<void> {
    if (this.closed) return;

    let foundId: string | null = null;
    for (const [id, conn] of this.pool) {
      if (conn.resource === resource) {
        foundId = id;
        break;
      }
    }

    if (!foundId) {
      logger.warn('ConnectionPool: released unknown resource', { name: this.config.name });
      return;
    }

    const conn = this.pool.get(foundId)!;
    this.metrics.totalReleased++;

    // Check max lifetime
    if (Date.now() - conn.createdAt > this.config.maxLifetimeMs) {
      await this.destroyConnection(foundId);
      this.fulfillWaiter();
      return;
    }

    // Serve waiting request if any
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!;
      clearTimeout(waiter.timeoutHandle);
      this.metrics.waiting = this.waitQueue.length;
      conn.lastUsedAt = Date.now();
      conn.inUse = true;
      this.metrics.totalAcquired++;
      waiter.resolve(conn.resource);
      return;
    }

    // Return to idle pool
    conn.inUse = false;
    conn.lastUsedAt = Date.now();
    this.updateCountMetrics();
  }

  async destroy(resource: T): Promise<void> {
    for (const [id, conn] of this.pool) {
      if (conn.resource === resource) {
        await this.destroyConnection(id);
        this.fulfillWaiter();
        return;
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    logger.info('ConnectionPool: closing', { name: this.config.name, size: this.pool.size });

    // Stop timers
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }

    // Reject all waiters
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timeoutHandle);
      waiter.reject(new Error(`ConnectionPool [${this.config.name}]: pool closed`));
    }
    this.waitQueue = [];
    this.metrics.waiting = 0;

    // Destroy all connections
    const ids = Array.from(this.pool.keys());
    for (const id of ids) {
      await this.destroyConnection(id);
    }

    logger.info('ConnectionPool: closed', { name: this.config.name });
  }

  getMetrics(): PoolMetrics {
    this.updateCountMetrics();
    return { ...this.metrics };
  }

  getConfig(): Readonly<PoolConfig> {
    return { ...this.config };
  }

  getSize(): number {
    return this.pool.size;
  }

  isClosed(): boolean {
    return this.closed;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async createConnection(): Promise<PooledConnection<T>> {
    const resource = await Promise.resolve(this.factory.create());
    const id = generateConnectionId(this.config.name);
    const now = Date.now();

    const conn: PooledConnection<T> = {
      id,
      resource,
      createdAt: now,
      lastUsedAt: now,
      lastHealthCheck: now,
      inUse: false,
    };

    this.pool.set(id, conn);
    this.metrics.totalCreated++;
    this.updateCountMetrics();
    logger.debug('ConnectionPool: connection created', { name: this.config.name, id });
    return conn;
  }

  private async destroyConnection(id: string): Promise<void> {
    const conn = this.pool.get(id);
    if (!conn) return;

    this.pool.delete(id);
    this.metrics.totalDestroyed++;
    this.updateCountMetrics();

    try {
      await Promise.resolve(this.factory.destroy(conn.resource));
      logger.debug('ConnectionPool: connection destroyed', { name: this.config.name, id });
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('ConnectionPool: failed to destroy connection', error, { name: this.config.name, id });
    }
  }

  private async fulfillWaiter(): Promise<void> {
    if (this.waitQueue.length === 0) return;
    if (this.pool.size >= this.config.maxSize) return;

    try {
      const conn = await this.createConnection();
      conn.inUse = true;
      conn.lastUsedAt = Date.now();

      const waiter = this.waitQueue.shift()!;
      clearTimeout(waiter.timeoutHandle);
      this.metrics.waiting = this.waitQueue.length;
      this.metrics.totalAcquired++;
      waiter.resolve(conn.resource);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('ConnectionPool: failed to fulfill waiter', error, { name: this.config.name });
    }
  }

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(() => {
      this.runHealthChecks().catch((err: unknown) => {
        logger.error(
          'ConnectionPool: health check cycle failed',
          err instanceof Error ? err : new Error(String(err)),
          { name: this.config.name },
        );
      });
    }, this.config.healthCheckIntervalMs);

    if (typeof this.healthCheckTimer === 'object' && 'unref' in this.healthCheckTimer) {
      this.healthCheckTimer.unref();
    }
  }

  private async runHealthChecks(): Promise<void> {
    if (!this.factory.validate || this.closed) return;

    for (const [id, conn] of this.pool) {
      if (conn.inUse) continue;

      try {
        const valid = await Promise.resolve(this.factory.validate(conn.resource));
        conn.lastHealthCheck = Date.now();
        if (!valid) {
          this.metrics.totalFailedHealthChecks++;
          await this.destroyConnection(id);
        }
      } catch {
        this.metrics.totalFailedHealthChecks++;
        await this.destroyConnection(id);
      }
    }

    // Replenish to minSize
    while (this.pool.size < this.config.minSize && !this.closed) {
      try {
        await this.createConnection();
      } catch {
        break;
      }
    }
  }

  private startIdleChecks(): void {
    this.idleCheckTimer = setInterval(() => {
      this.cleanupIdleConnections().catch((err: unknown) => {
        logger.error(
          'ConnectionPool: idle cleanup failed',
          err instanceof Error ? err : new Error(String(err)),
          { name: this.config.name },
        );
      });
    }, Math.max(this.config.idleTimeoutMs / 2, 5000));

    if (typeof this.idleCheckTimer === 'object' && 'unref' in this.idleCheckTimer) {
      this.idleCheckTimer.unref();
    }
  }

  private async cleanupIdleConnections(): Promise<void> {
    if (this.closed) return;

    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, conn] of this.pool) {
      if (conn.inUse) continue;

      // Don't go below minSize
      if (this.pool.size - toRemove.length <= this.config.minSize) break;

      const idleTime = now - conn.lastUsedAt;
      if (idleTime > this.config.idleTimeoutMs) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      await this.destroyConnection(id);
    }

    if (toRemove.length > 0) {
      logger.debug('ConnectionPool: cleaned up idle connections', {
        name: this.config.name,
        count: toRemove.length,
      });
    }
  }

  private updateCountMetrics(): void {
    let active = 0;
    let idle = 0;
    for (const conn of this.pool.values()) {
      if (conn.inUse) active++;
      else idle++;
    }
    this.metrics.active = active;
    this.metrics.idle = idle;
  }
}

// ─── Pool Registry (Singleton) ───────────────────────────────────────────────

type PoolRegistry = Map<string, ConnectionPool<unknown>>;

function getPoolRegistry(): PoolRegistry {
  const g = globalThis as unknown as Record<string, PoolRegistry>;
  if (!g.__connectionPools__) {
    g.__connectionPools__ = new Map();
  }
  return g.__connectionPools__;
}

export function registerPool<T>(
  name: string,
  factory: ConnectionFactory<T>,
  config?: Partial<PoolConfig>,
): ConnectionPool<T> {
  const registry = getPoolRegistry();

  if (registry.has(name)) {
    logger.warn('ConnectionPool: pool already registered, returning existing', { name });
    return registry.get(name) as ConnectionPool<T>;
  }

  const pool = new ConnectionPool<T>(factory, { ...config, name });
  registry.set(name, pool as ConnectionPool<unknown>);
  logger.info('ConnectionPool: pool registered', { name });
  return pool;
}

export function getPool<T>(name: string): ConnectionPool<T> | null {
  const registry = getPoolRegistry();
  return (registry.get(name) as ConnectionPool<T>) ?? null;
}

export async function closeAllPools(): Promise<void> {
  const registry = getPoolRegistry();
  for (const [name, pool] of registry) {
    logger.info('ConnectionPool: closing pool from registry', { name });
    await pool.close();
  }
  registry.clear();
}

export function getConnectionPoolManager(): PoolRegistry {
  return getPoolRegistry();
}
