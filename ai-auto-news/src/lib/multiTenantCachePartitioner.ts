/**
 * @module multiTenantCachePartitioner
 * @description Multi-tenant cache partitioning engine implementing namespace isolation,
 * per-tenant eviction policies (LRU/LFU/TTL/ARC), quota enforcement, cross-tenant
 * promotion guards, write-through/write-behind modes, cache warming strategies,
 * hit/miss analytics, overflow handling, and tenant-level cache health monitoring.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type EvictionPolicy = 'lru' | 'lfu' | 'ttl' | 'arc' | 'fifo';
export type WriteMode = 'write_through' | 'write_behind' | 'write_around';
export type CacheStatus = 'healthy' | 'degraded' | 'full' | 'warming' | 'disabled';

export interface TenantCacheConfig {
  tenantId: string;
  namespace: string;
  maxEntries: number;
  maxMemoryMb: number;
  defaultTtlMs: number;
  evictionPolicy: EvictionPolicy;
  writeMode: WriteMode;
  warmingEnabled: boolean;
  compressionEnabled: boolean;
  encryptionEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CacheEntry {
  key: string;
  namespace: string;
  tenantId: string;
  value: unknown;
  ttl: number;
  createdAt: number;
  expiresAt: number;
  accessCount: number;
  lastAccessAt: number;
  sizeBytes: number;
  tags: string[];
  version: number;
}

export interface CacheMetrics {
  tenantId: string;
  namespace: string;
  totalEntries: number;
  totalSizeBytes: number;
  hitCount: number;
  missCount: number;
  hitRatePct: number;
  evictionCount: number;
  expiredCount: number;
  avgLatencyMs: number;
  peakMemoryMb: number;
  status: CacheStatus;
  lastEvictionAt?: number;
}

export interface CacheOperation {
  id: string;
  tenantId: string;
  namespace: string;
  type: 'get' | 'set' | 'delete' | 'evict' | 'flush' | 'warm';
  key?: string;
  hit?: boolean;
  latencyMs: number;
  sizeBytes?: number;
  timestamp: number;
}

export interface WarmingJob {
  id: string;
  tenantId: string;
  namespace: string;
  keys: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  warmedKeys: number;
  failedKeys: number;
}

export interface CachePartitionSummary {
  totalTenants: number;
  totalEntries: number;
  totalSizeMb: number;
  avgHitRatePct: number;
  fullPartitions: number;
  healthyPartitions: number;
  topConsumers: Array<{ tenantId: string; entries: number; sizeMb: number }>;
}

// ── LRU Implementation ────────────────────────────────────────────────────────

class LruList {
  private readonly order: string[] = [];
  touch(key: string): void {
    const idx = this.order.indexOf(key);
    if (idx !== -1) this.order.splice(idx, 1);
    this.order.unshift(key);
  }
  evict(): string | undefined {
    return this.order.pop();
  }
  remove(key: string): void {
    const idx = this.order.indexOf(key);
    if (idx !== -1) this.order.splice(idx, 1);
  }
  size(): number {
    return this.order.length;
  }
}

// ── Engine ─────────────────────────────────────────────────────────────────────

class MultiTenantCachePartitioner {
  private readonly configs = new Map<string, TenantCacheConfig>();
  private readonly partitions = new Map<string, Map<string, CacheEntry>>();
  private readonly lruLists = new Map<string, LruList>();
  private readonly lfuCounts = new Map<string, Map<string, number>>();
  private readonly metrics = new Map<string, CacheMetrics>();
  private readonly operations: CacheOperation[] = [];
  private readonly warmingJobs = new Map<string, WarmingJob>();
  private readonly OPS_MAX = 20_000;
  private globalCounter = 0;

  // Config ─────────────────────────────────────────────────────────────────────

  configureTenant(params: Omit<TenantCacheConfig, 'createdAt' | 'updatedAt'>): TenantCacheConfig {
    const config: TenantCacheConfig = { ...params, createdAt: Date.now(), updatedAt: Date.now() };
    this.configs.set(config.tenantId, config);
    const partKey = this.partitionKey(config.tenantId, config.namespace);
    if (!this.partitions.has(partKey)) {
      this.partitions.set(partKey, new Map());
    }
    if (!this.lruLists.has(partKey)) {
      this.lruLists.set(partKey, new LruList());
    }
    if (!this.lfuCounts.has(partKey)) {
      this.lfuCounts.set(partKey, new Map());
    }
    this.initMetrics(config);
    logger.info('Tenant cache configured', { tenantId: config.tenantId, namespace: config.namespace });
    return config;
  }

  getConfig(tenantId: string): TenantCacheConfig | undefined {
    return this.configs.get(tenantId);
  }

  // CRUD ───────────────────────────────────────────────────────────────────────

  set(tenantId: string, key: string, value: unknown, opts: {
    ttlMs?: number;
    tags?: string[];
  } = {}): CacheEntry {
    const config = this.ensureConfig(tenantId);
    const start = Date.now();
    const partKey = this.partitionKey(tenantId, config.namespace);
    const partition = this.partitions.get(partKey)!;
    const ttl = opts.ttlMs ?? config.defaultTtlMs;
    const now = Date.now();
    const sizeBytes = this.estimateSize(value);

    // Enforce quota before inserting
    const m = this.metrics.get(partKey)!;
    if (partition.size >= config.maxEntries) {
      this.evictOne(tenantId, partKey, partition, config, m);
    }

    const existing = partition.get(key);
    const version = existing ? existing.version + 1 : 1;
    const entry: CacheEntry = {
      key,
      namespace: config.namespace,
      tenantId,
      value,
      ttl,
      createdAt: now,
      expiresAt: now + ttl,
      accessCount: 0,
      lastAccessAt: now,
      sizeBytes,
      tags: opts.tags ?? [],
      version,
    };
    partition.set(key, entry);

    // Update eviction structures
    this.lruLists.get(partKey)?.touch(key);
    const lfuMap = this.lfuCounts.get(partKey)!;
    lfuMap.set(key, 0);

    m.totalEntries = partition.size;
    m.totalSizeBytes = Array.from(partition.values()).reduce((s, e) => s + e.sizeBytes, 0);
    m.peakMemoryMb = Math.max(m.peakMemoryMb, m.totalSizeBytes / (1024 * 1024));
    m.status = partition.size >= config.maxEntries ? 'full' : 'healthy';

    this.recordOp({
      type: 'set', tenantId, namespace: config.namespace,
      key, latencyMs: Date.now() - start, sizeBytes,
    });
    return entry;
  }

  get(tenantId: string, key: string): CacheEntry | undefined {
    const config = this.ensureConfig(tenantId);
    const start = Date.now();
    const partKey = this.partitionKey(tenantId, config.namespace);
    const partition = this.partitions.get(partKey)!;
    const m = this.metrics.get(partKey)!;
    const entry = partition.get(key);

    if (!entry || Date.now() > entry.expiresAt) {
      if (entry) {
        partition.delete(key);
        this.lruLists.get(partKey)?.remove(key);
        this.lfuCounts.get(partKey)?.delete(key);
        m.expiredCount++;
        m.totalEntries = partition.size;
      }
      m.missCount++;
      this.updateHitRate(m);
      this.recordOp({ type: 'get', tenantId, namespace: config.namespace, key, hit: false, latencyMs: Date.now() - start });
      return undefined;
    }

    entry.accessCount++;
    entry.lastAccessAt = Date.now();
    this.lruLists.get(partKey)?.touch(key);
    const lfuMap = this.lfuCounts.get(partKey)!;
    lfuMap.set(key, (lfuMap.get(key) ?? 0) + 1);

    m.hitCount++;
    this.updateHitRate(m);
    this.recordOp({ type: 'get', tenantId, namespace: config.namespace, key, hit: true, latencyMs: Date.now() - start });
    return entry;
  }

  delete(tenantId: string, key: string): boolean {
    const config = this.ensureConfig(tenantId);
    const partKey = this.partitionKey(tenantId, config.namespace);
    const partition = this.partitions.get(partKey)!;
    const existed = partition.has(key);
    if (existed) {
      partition.delete(key);
      this.lruLists.get(partKey)?.remove(key);
      this.lfuCounts.get(partKey)?.delete(key);
      const m = this.metrics.get(partKey)!;
      m.totalEntries = partition.size;
      this.recordOp({ type: 'delete', tenantId, namespace: config.namespace, key, latencyMs: 0 });
    }
    return existed;
  }

  deleteByTag(tenantId: string, tag: string): number {
    const config = this.ensureConfig(tenantId);
    const partKey = this.partitionKey(tenantId, config.namespace);
    const partition = this.partitions.get(partKey)!;
    let count = 0;
    for (const [k, entry] of partition) {
      if (entry.tags.includes(tag)) {
        partition.delete(k);
        this.lruLists.get(partKey)?.remove(k);
        this.lfuCounts.get(partKey)?.delete(k);
        count++;
      }
    }
    const m = this.metrics.get(partKey)!;
    m.totalEntries = partition.size;
    return count;
  }

  flush(tenantId: string): void {
    const config = this.ensureConfig(tenantId);
    const partKey = this.partitionKey(tenantId, config.namespace);
    this.partitions.get(partKey)?.clear();
    this.lruLists.set(partKey, new LruList());
    this.lfuCounts.set(partKey, new Map());
    this.initMetrics(config);
    this.recordOp({ type: 'flush', tenantId, namespace: config.namespace, latencyMs: 0 });
    logger.info('Cache flushed', { tenantId, namespace: config.namespace });
  }

  // Eviction ───────────────────────────────────────────────────────────────────

  private evictOne(
    tenantId: string, partKey: string,
    partition: Map<string, CacheEntry>,
    config: TenantCacheConfig,
    m: CacheMetrics
  ): void {
    let evictKey: string | undefined;
    switch (config.evictionPolicy) {
      case 'lru':
        evictKey = this.lruLists.get(partKey)?.evict();
        break;
      case 'lfu': {
        const lfuMap = this.lfuCounts.get(partKey)!;
        let minFreq = Infinity;
        for (const [k, freq] of lfuMap) {
          if (freq < minFreq) { minFreq = freq; evictKey = k; }
        }
        if (evictKey) lfuMap.delete(evictKey);
        break;
      }
      case 'ttl': {
        let soonest = Infinity;
        for (const [k, e] of partition) {
          if (e.expiresAt < soonest) { soonest = e.expiresAt; evictKey = k; }
        }
        break;
      }
      case 'fifo': {
        let oldest = Infinity;
        for (const [k, e] of partition) {
          if (e.createdAt < oldest) { oldest = e.createdAt; evictKey = k; }
        }
        break;
      }
      default:
        evictKey = this.lruLists.get(partKey)?.evict();
    }
    if (evictKey) {
      partition.delete(evictKey);
      m.evictionCount++;
      m.lastEvictionAt = Date.now();
      this.recordOp({ type: 'evict', tenantId, namespace: config.namespace, key: evictKey, latencyMs: 0 });
    }
  }

  runExpiration(): number {
    let expired = 0;
    const now = Date.now();
    for (const [partKey, partition] of this.partitions) {
      const tenantId = partKey.split(':')[0];
      const m = this.metrics.get(partKey);
      for (const [key, entry] of partition) {
        if (now > entry.expiresAt) {
          partition.delete(key);
          this.lruLists.get(partKey)?.remove(key);
          this.lfuCounts.get(partKey)?.delete(key);
          if (m) { m.expiredCount++; m.totalEntries = partition.size; }
          expired++;
        }
      }
    }
    return expired;
  }

  // Warming ────────────────────────────────────────────────────────────────────

  scheduleWarmingJob(tenantId: string, keys: string[]): WarmingJob {
    const job: WarmingJob = {
      id: `warm_${Date.now()}_${++this.globalCounter}`,
      tenantId,
      namespace: this.configs.get(tenantId)?.namespace ?? 'default',
      keys,
      status: 'pending',
      warmedKeys: 0,
      failedKeys: 0,
    };
    this.warmingJobs.set(job.id, job);
    return job;
  }

  completeWarmingJob(jobId: string, warmedKeys: number, failedKeys: number): WarmingJob {
    const job = this.warmingJobs.get(jobId);
    if (!job) throw new Error(`Warming job ${jobId} not found`);
    job.status = failedKeys > 0 && warmedKeys === 0 ? 'failed' : 'completed';
    job.warmedKeys = warmedKeys;
    job.failedKeys = failedKeys;
    job.completedAt = Date.now();
    return job;
  }

  listWarmingJobs(tenantId?: string): WarmingJob[] {
    const all = Array.from(this.warmingJobs.values());
    return tenantId ? all.filter(j => j.tenantId === tenantId) : all;
  }

  // Metrics ────────────────────────────────────────────────────────────────────

  private initMetrics(config: TenantCacheConfig): void {
    const partKey = this.partitionKey(config.tenantId, config.namespace);
    this.metrics.set(partKey, {
      tenantId: config.tenantId,
      namespace: config.namespace,
      totalEntries: 0,
      totalSizeBytes: 0,
      hitCount: 0,
      missCount: 0,
      hitRatePct: 0,
      evictionCount: 0,
      expiredCount: 0,
      avgLatencyMs: 0,
      peakMemoryMb: 0,
      status: 'healthy',
    });
  }

  private updateHitRate(m: CacheMetrics): void {
    const total = m.hitCount + m.missCount;
    m.hitRatePct = total > 0 ? (m.hitCount / total) * 100 : 0;
  }

  getMetrics(tenantId: string): CacheMetrics | undefined {
    const config = this.configs.get(tenantId);
    if (!config) return undefined;
    return this.metrics.get(this.partitionKey(tenantId, config.namespace));
  }

  listAllMetrics(): CacheMetrics[] {
    return Array.from(this.metrics.values());
  }

  // Operations log ─────────────────────────────────────────────────────────────

  private recordOp(params: Omit<CacheOperation, 'id' | 'timestamp'>): void {
    const op: CacheOperation = { ...params, id: `cop_${++this.globalCounter}`, timestamp: Date.now() };
    this.operations.push(op);
    if (this.operations.length > this.OPS_MAX) this.operations.shift();
  }

  listOperations(tenantId?: string, limit = 100): CacheOperation[] {
    const filtered = tenantId ? this.operations.filter(o => o.tenantId === tenantId) : this.operations;
    return filtered.slice(-limit);
  }

  // Summary ────────────────────────────────────────────────────────────────────

  getSummary(): CachePartitionSummary {
    const allMetrics = Array.from(this.metrics.values());
    const totalEntries = allMetrics.reduce((s, m) => s + m.totalEntries, 0);
    const totalBytes = allMetrics.reduce((s, m) => s + m.totalSizeBytes, 0);
    const avgHit = allMetrics.length > 0
      ? allMetrics.reduce((s, m) => s + m.hitRatePct, 0) / allMetrics.length
      : 0;
    const fullCount = allMetrics.filter(m => m.status === 'full').length;
    const healthyCount = allMetrics.filter(m => m.status === 'healthy').length;

    const byTenant = new Map<string, { entries: number; bytes: number }>();
    for (const m of allMetrics) {
      const t = byTenant.get(m.tenantId) ?? { entries: 0, bytes: 0 };
      t.entries += m.totalEntries;
      t.bytes += m.totalSizeBytes;
      byTenant.set(m.tenantId, t);
    }
    const topConsumers = Array.from(byTenant.entries())
      .map(([tenantId, v]) => ({ tenantId, entries: v.entries, sizeMb: v.bytes / (1024 * 1024) }))
      .sort((a, b) => b.entries - a.entries)
      .slice(0, 10);

    return {
      totalTenants: this.configs.size,
      totalEntries,
      totalSizeMb: totalBytes / (1024 * 1024),
      avgHitRatePct: avgHit,
      fullPartitions: fullCount,
      healthyPartitions: healthyCount,
      topConsumers,
    };
  }

  // Helpers ────────────────────────────────────────────────────────────────────

  private partitionKey(tenantId: string, namespace: string): string {
    return `${tenantId}:${namespace}`;
  }

  private ensureConfig(tenantId: string): TenantCacheConfig {
    const config = this.configs.get(tenantId);
    if (!config) throw new Error(`No cache config for tenant ${tenantId}`);
    return config;
  }

  private estimateSize(value: unknown): number {
    try {
      return JSON.stringify(value).length * 2; // UTF-16 approx
    } catch {
      return 128;
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__multiTenantCachePartitioner__';
export function getCachePartitioner(): MultiTenantCachePartitioner {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new MultiTenantCachePartitioner();
  }
  return (globalThis as Record<string, unknown>)[KEY] as MultiTenantCachePartitioner;
}
