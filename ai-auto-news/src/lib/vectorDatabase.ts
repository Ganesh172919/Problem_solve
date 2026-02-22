/**
 * Vector Database Abstraction Layer
 *
 * Semantic embedding storage and search with:
 * - Embedding storage and retrieval
 * - Cosine similarity search
 * - Namespace/collection support
 * - Batch upsert and query operations
 * - Dimension reduction (PCA-lite projection)
 * - Index management and statistics
 * - TTL-based expiry for embeddings
 * - Metadata filtering on search
 */

import { getLogger } from './logger';
import { getCache } from './cache';
import crypto from 'crypto';

const logger = getLogger();
const cache = getCache();

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VectorEntry {
  id: string;
  namespace: string;
  vector: number[];
  metadata: Record<string, unknown>;
  text?: string;
  createdAt: Date;
  expiresAt?: Date;
  dimension: number;
}

export interface UpsertRequest {
  id?: string;
  namespace: string;
  vector: number[];
  metadata?: Record<string, unknown>;
  text?: string;
  ttlSeconds?: number;
}

export interface QueryRequest {
  namespace: string;
  vector: number[];
  topK?: number;
  minScore?: number;
  filter?: Record<string, unknown>;
  includeVector?: boolean;
  includeMetadata?: boolean;
}

export interface QueryResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
  text?: string;
  vector?: number[];
}

export interface BatchUpsertRequest {
  namespace: string;
  entries: Array<Omit<UpsertRequest, 'namespace'>>;
}

export interface IndexStats {
  namespace: string;
  vectorCount: number;
  dimension: number;
  avgVectorNorm: number;
  totalSizeBytes: number;
  oldestEntry: Date | null;
  newestEntry: Date | null;
}

export interface NamespaceConfig {
  name: string;
  dimension: number;
  distanceMetric: 'cosine' | 'euclidean' | 'dot-product';
  maxVectors?: number;
  ttlSeconds?: number;
}

export interface SimilaritySearchOptions {
  namespace: string;
  queryText?: string;
  queryVector?: number[];
  topK: number;
  minScore?: number;
  filter?: Record<string, unknown>;
}

export interface VectorDatabaseStats {
  totalVectors: number;
  totalNamespaces: number;
  totalSizeBytes: number;
  queriesServed: number;
  avgQueryLatencyMs: number;
  cacheHitRate: number;
  namespaceSummary: IndexStats[];
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function normalizeVector(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

function matchesFilter(metadata: Record<string, unknown>, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key] !== value) return false;
  }
  return true;
}

/**
 * Simple deterministic pseudo-random text embedding for testing/fallback.
 * Real usage should replace this with actual embedding model calls.
 */
function hashTextToVector(text: string, dimension: number): number[] {
  const hash = crypto.createHash('sha256').update(text).digest();
  const vector: number[] = [];
  for (let i = 0; i < dimension; i++) {
    const byte = hash[i % hash.length];
    // Map byte to [-1, 1]
    vector.push((byte - 128) / 128);
  }
  return normalizeVector(vector);
}

/**
 * Naive PCA-lite: project high-dim vector down to targetDim using fixed basis.
 */
function projectVector(v: number[], targetDim: number): number[] {
  if (v.length <= targetDim) return [...v, ...new Array(targetDim - v.length).fill(0)];
  const out: number[] = [];
  const step = v.length / targetDim;
  for (let i = 0; i < targetDim; i++) {
    const start = Math.floor(i * step);
    const end = Math.floor((i + 1) * step);
    let sum = 0;
    for (let j = start; j < end; j++) sum += v[j];
    out.push(sum / (end - start));
  }
  return normalizeVector(out);
}

// ── VectorDatabase class ──────────────────────────────────────────────────────

class VectorDatabase {
  // namespace -> id -> entry
  private store: Map<string, Map<string, VectorEntry>> = new Map();
  private namespaceConfigs: Map<string, NamespaceConfig> = new Map();
  private queriesServed = 0;
  private queryLatencies: number[] = [];
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor() {
    // TTL eviction loop
    setInterval(() => this.evictExpired(), 60_000);
  }

  // ── Namespace Management ───────────────────────────────────────────────────

  createNamespace(config: NamespaceConfig): void {
    if (this.namespaceConfigs.has(config.name)) {
      logger.warn('Namespace already exists', { namespace: config.name });
      return;
    }
    this.namespaceConfigs.set(config.name, config);
    this.store.set(config.name, new Map());
    logger.info('Vector namespace created', { namespace: config.name, dimension: config.dimension });
  }

  deleteNamespace(namespace: string): boolean {
    const existed = this.store.has(namespace);
    this.store.delete(namespace);
    this.namespaceConfigs.delete(namespace);
    if (existed) logger.info('Vector namespace deleted', { namespace });
    return existed;
  }

  getNamespaces(): string[] {
    return Array.from(this.namespaceConfigs.keys());
  }

  private ensureNamespace(namespace: string, dimension: number): void {
    if (!this.store.has(namespace)) {
      this.createNamespace({ name: namespace, dimension, distanceMetric: 'cosine' });
    }
  }

  // ── Upsert ─────────────────────────────────────────────────────────────────

  upsert(req: UpsertRequest): string {
    const dimension = req.vector.length;
    this.ensureNamespace(req.namespace, dimension);

    const ns = this.store.get(req.namespace)!;
    const config = this.namespaceConfigs.get(req.namespace);

    // Enforce max vectors
    if (config?.maxVectors && ns.size >= config.maxVectors) {
      // Evict oldest
      let oldest: VectorEntry | null = null;
      for (const entry of ns.values()) {
        if (!oldest || entry.createdAt < oldest.createdAt) oldest = entry;
      }
      if (oldest) ns.delete(oldest.id);
    }

    const id = req.id ?? crypto.randomUUID();
    const ttl = req.ttlSeconds ?? config?.ttlSeconds;
    const entry: VectorEntry = {
      id,
      namespace: req.namespace,
      vector: normalizeVector(req.vector),
      metadata: req.metadata ?? {},
      text: req.text,
      createdAt: new Date(),
      expiresAt: ttl ? new Date(Date.now() + ttl * 1000) : undefined,
      dimension,
    };

    ns.set(id, entry);
    // Invalidate cache for this namespace
    cache.set(`vdb:ns:${req.namespace}:dirty`, true, 1);

    return id;
  }

  batchUpsert(req: BatchUpsertRequest): string[] {
    const ids: string[] = [];
    for (const entry of req.entries) {
      ids.push(this.upsert({ ...entry, namespace: req.namespace }));
    }
    logger.info('Batch upsert complete', { namespace: req.namespace, count: ids.length });
    return ids;
  }

  // ── Query / Search ─────────────────────────────────────────────────────────

  query(req: QueryRequest): QueryResult[] {
    const start = Date.now();
    this.queriesServed++;

    const cacheKey = `vdb:query:${req.namespace}:${crypto.createHash('md5').update(JSON.stringify(req)).digest('hex')}`;

    // Only use cache if namespace not dirty
    const isDirty = cache.get<boolean>(`vdb:ns:${req.namespace}:dirty`);
    if (!isDirty) {
      const cached = cache.get<QueryResult[]>(cacheKey);
      if (cached) {
        this.cacheHits++;
        this.queryLatencies.push(Date.now() - start);
        return cached;
      }
    }
    this.cacheMisses++;

    const ns = this.store.get(req.namespace);
    if (!ns) return [];

    const config = this.namespaceConfigs.get(req.namespace);
    const metric = config?.distanceMetric ?? 'cosine';
    const queryVec = normalizeVector(req.vector);
    const topK = req.topK ?? 10;
    const minScore = req.minScore ?? 0;
    const now = new Date();

    const results: QueryResult[] = [];

    for (const entry of ns.values()) {
      // TTL check
      if (entry.expiresAt && entry.expiresAt < now) continue;
      // Filter check
      if (!matchesFilter(entry.metadata, req.filter)) continue;

      let score: number;
      if (metric === 'cosine') {
        score = cosineSimilarity(queryVec, entry.vector);
      } else if (metric === 'euclidean') {
        const dist = euclideanDistance(queryVec, entry.vector);
        score = 1 / (1 + dist);
      } else {
        score = dotProduct(queryVec, entry.vector);
      }

      if (score < minScore) continue;

      results.push({
        id: entry.id,
        score,
        metadata: req.includeMetadata !== false ? entry.metadata : {},
        text: entry.text,
        vector: req.includeVector ? entry.vector : undefined,
      });
    }

    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    // Cache for 30s
    cache.set(cacheKey, topResults, 30);

    const latency = Date.now() - start;
    this.queryLatencies.push(latency);
    if (this.queryLatencies.length > 500) this.queryLatencies.shift();

    return topResults;
  }

  searchByText(text: string, namespace: string, topK = 10, filter?: Record<string, unknown>): QueryResult[] {
    const config = this.namespaceConfigs.get(namespace);
    const dimension = config?.dimension ?? 1536;
    const vector = hashTextToVector(text, dimension);
    return this.query({ namespace, vector, topK, filter });
  }

  // ── Retrieval ──────────────────────────────────────────────────────────────

  get(namespace: string, id: string): VectorEntry | null {
    const ns = this.store.get(namespace);
    const entry = ns?.get(id) ?? null;
    if (entry?.expiresAt && entry.expiresAt < new Date()) {
      ns?.delete(id);
      return null;
    }
    return entry;
  }

  delete(namespace: string, id: string): boolean {
    const ns = this.store.get(namespace);
    if (!ns) return false;
    const existed = ns.has(id);
    ns.delete(id);
    return existed;
  }

  batchDelete(namespace: string, ids: string[]): number {
    const ns = this.store.get(namespace);
    if (!ns) return 0;
    let count = 0;
    for (const id of ids) {
      if (ns.delete(id)) count++;
    }
    return count;
  }

  // ── Dimension Reduction ────────────────────────────────────────────────────

  projectNamespace(namespace: string, targetDimension: number): string {
    const sourceNs = this.store.get(namespace);
    if (!sourceNs) throw new Error(`Namespace ${namespace} not found`);

    const projectedNs = `${namespace}_d${targetDimension}`;
    this.createNamespace({
      name: projectedNs,
      dimension: targetDimension,
      distanceMetric: this.namespaceConfigs.get(namespace)?.distanceMetric ?? 'cosine',
    });

    for (const entry of sourceNs.values()) {
      this.upsert({
        id: entry.id,
        namespace: projectedNs,
        vector: projectVector(entry.vector, targetDimension),
        metadata: entry.metadata,
        text: entry.text,
      });
    }

    logger.info('Namespace projected', { source: namespace, target: projectedNs, targetDimension });
    return projectedNs;
  }

  // ── TTL Eviction ───────────────────────────────────────────────────────────

  private evictExpired(): void {
    const now = new Date();
    let evicted = 0;
    for (const [, ns] of this.store) {
      for (const [id, entry] of ns) {
        if (entry.expiresAt && entry.expiresAt < now) {
          ns.delete(id);
          evicted++;
        }
      }
    }
    if (evicted > 0) logger.debug('Evicted expired vectors', { count: evicted });
  }

  // ── Index Stats ────────────────────────────────────────────────────────────

  getIndexStats(namespace: string): IndexStats | null {
    const ns = this.store.get(namespace);
    if (!ns) return null;

    const config = this.namespaceConfigs.get(namespace);
    let oldest: Date | null = null;
    let newest: Date | null = null;
    let totalNorm = 0;
    let sizeBytes = 0;

    for (const entry of ns.values()) {
      if (!oldest || entry.createdAt < oldest) oldest = entry.createdAt;
      if (!newest || entry.createdAt > newest) newest = entry.createdAt;
      totalNorm += Math.sqrt(entry.vector.reduce((s, x) => s + x * x, 0));
      sizeBytes += entry.vector.length * 8 + JSON.stringify(entry.metadata).length;
    }

    return {
      namespace,
      vectorCount: ns.size,
      dimension: config?.dimension ?? 0,
      avgVectorNorm: ns.size > 0 ? totalNorm / ns.size : 0,
      totalSizeBytes: sizeBytes,
      oldestEntry: oldest,
      newestEntry: newest,
    };
  }

  getDatabaseStats(): VectorDatabaseStats {
    const namespaceSummary: IndexStats[] = [];
    let totalVectors = 0;
    let totalSizeBytes = 0;

    for (const ns of this.getNamespaces()) {
      const stats = this.getIndexStats(ns);
      if (stats) {
        namespaceSummary.push(stats);
        totalVectors += stats.vectorCount;
        totalSizeBytes += stats.totalSizeBytes;
      }
    }

    const avgLatency = this.queryLatencies.length > 0
      ? this.queryLatencies.reduce((a, b) => a + b, 0) / this.queryLatencies.length
      : 0;

    const totalCacheOps = this.cacheHits + this.cacheMisses;

    return {
      totalVectors,
      totalNamespaces: this.namespaceConfigs.size,
      totalSizeBytes,
      queriesServed: this.queriesServed,
      avgQueryLatencyMs: Math.round(avgLatency),
      cacheHitRate: totalCacheOps > 0 ? this.cacheHits / totalCacheOps : 0,
      namespaceSummary,
    };
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__vectorDatabase__';

export function getVectorDatabase(): VectorDatabase {
  const g = globalThis as unknown as Record<string, VectorDatabase>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new VectorDatabase();
  }
  return g[GLOBAL_KEY];
}

export { VectorDatabase };
export default getVectorDatabase;
