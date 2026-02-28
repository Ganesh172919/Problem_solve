/**
 * @module structuredLoggingFramework
 *
 * Structured Logging Framework for enterprise observability.
 * Provides structured log entries with context, correlation IDs,
 * log level filtering, aggregation, pattern detection, retention
 * policies, performance enrichment, and metric extraction.
 */

import { getLogger } from './logger';

const logger = getLogger();

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface ErrorInfo {
  name: string;
  message: string;
  stack?: string;
  code?: string;
}

export interface StructuredLogEntry {
  id: string;
  level: LogLevel;
  message: string;
  service: string;
  traceId: string;
  spanId: string;
  correlationId: string;
  context: Record<string, unknown>;
  tags: string[];
  duration?: number;
  error?: ErrorInfo;
  timestamp: number;
}

export interface LogQuery {
  level?: LogLevel;
  service?: string;
  traceId?: string;
  correlationId?: string;
  tags?: string[];
  from?: number;
  to?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface LogQueryResult {
  entries: StructuredLogEntry[];
  total: number;
  hasMore: boolean;
}

export interface LogPattern {
  id: string;
  pattern: string;
  frequency: number;
  severity: LogLevel;
  firstSeen: number;
  lastSeen: number;
  sampleEntries: string[];
}

export interface LogMetric {
  name: string;
  value: number;
  type: 'counter' | 'gauge' | 'histogram';
  labels: Record<string, string>;
  timestamp: number;
}

export interface RetentionPolicy {
  maxEntries: number;
  maxAgeDays: number;
  compressAfterDays: number;
}

export interface LoggingStats {
  totalEntries: number;
  entriesByLevel: Record<string, number>;
  entriesByService: Record<string, number>;
  avgEntriesPerMinute: number;
  errorRate: number;
  topPatterns: LogPattern[];
  storageUsedBytes: number;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5,
};

function generateId(): string {
  const seg = () => Math.random().toString(16).slice(2, 10);
  return `${seg()}${seg()}-${seg()}-${seg()}-${seg()}-${seg()}${seg()}${seg()}`;
}

function normalizeMessage(msg: string): string {
  return msg
    .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\dZ]*/g, '<ts>')
    .replace(/\d+(\.\d+)?\s*(ms|s|bytes|MB|GB|KB)/g, '<metric>')
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '<ip>')
    .replace(/\b\d+\b/g, '<n>');
}

function estimateBytes(entry: StructuredLogEntry): number {
  return JSON.stringify(entry).length * 2;
}

export class StructuredLoggingFramework {
  private entries: StructuredLogEntry[] = [];
  private indexByLevel = new Map<LogLevel, Set<number>>();
  private indexByService = new Map<string, Set<number>>();
  private indexByTraceId = new Map<string, Set<number>>();
  private indexByCorrelationId = new Map<string, Set<number>>();
  private entryIdMap = new Map<string, number>();
  private firstEntryTime = 0;

  constructor() {
    for (const lvl of Object.keys(LOG_LEVEL_ORDER) as LogLevel[]) {
      this.indexByLevel.set(lvl, new Set());
    }
    logger.info('StructuredLoggingFramework initialized');
  }

  log(input: Omit<StructuredLogEntry, 'id' | 'timestamp'>): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      ...input,
      id: generateId(),
      timestamp: Date.now(),
    };
    const idx = this.entries.length;
    this.entries.push(entry);
    if (this.firstEntryTime === 0) this.firstEntryTime = entry.timestamp;

    this.entryIdMap.set(entry.id, idx);
    this.indexByLevel.get(entry.level)?.add(idx);

    if (!this.indexByService.has(entry.service)) {
      this.indexByService.set(entry.service, new Set());
    }
    this.indexByService.get(entry.service)!.add(idx);

    if (!this.indexByTraceId.has(entry.traceId)) {
      this.indexByTraceId.set(entry.traceId, new Set());
    }
    this.indexByTraceId.get(entry.traceId)!.add(idx);

    if (!this.indexByCorrelationId.has(entry.correlationId)) {
      this.indexByCorrelationId.set(entry.correlationId, new Set());
    }
    this.indexByCorrelationId.get(entry.correlationId)!.add(idx);

    return entry;
  }

  query(q: LogQuery): LogQueryResult {
    const limit = q.limit ?? 100;
    const offset = q.offset ?? 0;
    let candidates: Set<number> | null = null;

    if (q.traceId && this.indexByTraceId.has(q.traceId)) {
      candidates = new Set(this.indexByTraceId.get(q.traceId)!);
    }
    if (q.level && this.indexByLevel.has(q.level)) {
      const lvlSet = this.indexByLevel.get(q.level)!;
      candidates = candidates ? intersect(candidates, lvlSet) : new Set(lvlSet);
    }
    if (q.service && this.indexByService.has(q.service)) {
      const svcSet = this.indexByService.get(q.service)!;
      candidates = candidates ? intersect(candidates, svcSet) : new Set(svcSet);
    }
    if (q.correlationId && this.indexByCorrelationId.has(q.correlationId)) {
      const corSet = this.indexByCorrelationId.get(q.correlationId)!;
      candidates = candidates ? intersect(candidates, corSet) : new Set(corSet);
    }

    const indices = candidates
      ? Array.from(candidates).sort((a, b) => a - b)
      : Array.from({ length: this.entries.length }, (_, i) => i);

    const filtered = indices.filter((i) => {
      const e = this.entries[i];
      if (!e) return false;
      if (q.from && e.timestamp < q.from) return false;
      if (q.to && e.timestamp > q.to) return false;
      if (q.tags && q.tags.length > 0 && !q.tags.every((t) => e.tags.includes(t))) return false;
      if (q.search && !e.message.toLowerCase().includes(q.search.toLowerCase())) return false;
      return true;
    });

    const total = filtered.length;
    const page = filtered.slice(offset, offset + limit).map((i) => this.entries[i]);
    return { entries: page, total, hasMore: offset + limit < total };
  }

  getEntry(entryId: string): StructuredLogEntry | null {
    const idx = this.entryIdMap.get(entryId);
    return idx !== undefined ? this.entries[idx] ?? null : null;
  }

  getTraceEntries(traceId: string): StructuredLogEntry[] {
    const idxSet = this.indexByTraceId.get(traceId);
    if (!idxSet) return [];
    return Array.from(idxSet)
      .sort((a, b) => a - b)
      .map((i) => this.entries[i])
      .filter(Boolean);
  }

  detectPatterns(windowMs = 3_600_000): LogPattern[] {
    const cutoff = Date.now() - windowMs;
    const groups = new Map<string, { severity: LogLevel; ids: string[]; timestamps: number[] }>();

    for (const entry of this.entries) {
      if (entry.timestamp < cutoff) continue;
      const key = normalizeMessage(entry.message);
      if (!groups.has(key)) {
        groups.set(key, { severity: entry.level, ids: [], timestamps: [] });
      }
      const g = groups.get(key)!;
      g.ids.push(entry.id);
      g.timestamps.push(entry.timestamp);
      if (LOG_LEVEL_ORDER[entry.level] > LOG_LEVEL_ORDER[g.severity]) {
        g.severity = entry.level;
      }
    }

    const patterns: LogPattern[] = [];
    for (const [pattern, g] of groups) {
      if (g.ids.length < 2) continue;
      patterns.push({
        id: generateId(),
        pattern,
        frequency: g.ids.length,
        severity: g.severity,
        firstSeen: Math.min(...g.timestamps),
        lastSeen: Math.max(...g.timestamps),
        sampleEntries: g.ids.slice(0, 5),
      });
    }

    return patterns.sort((a, b) => b.frequency - a.frequency);
  }

  extractMetrics(windowMs = 60_000): LogMetric[] {
    const now = Date.now();
    const cutoff = now - windowMs;
    const metrics: LogMetric[] = [];

    const levelCounts: Record<string, number> = {};
    const serviceCounts: Record<string, number> = {};
    const latencies: number[] = [];

    for (const entry of this.entries) {
      if (entry.timestamp < cutoff) continue;
      levelCounts[entry.level] = (levelCounts[entry.level] ?? 0) + 1;
      serviceCounts[entry.service] = (serviceCounts[entry.service] ?? 0) + 1;
      if (entry.duration !== undefined) latencies.push(entry.duration);
    }

    for (const [level, count] of Object.entries(levelCounts)) {
      metrics.push({ name: 'log_entries_total', value: count, type: 'counter', labels: { level }, timestamp: now });
    }
    for (const [service, count] of Object.entries(serviceCounts)) {
      metrics.push({ name: 'log_entries_by_service', value: count, type: 'counter', labels: { service }, timestamp: now });
    }

    const errCount = (levelCounts['error'] ?? 0) + (levelCounts['fatal'] ?? 0);
    const total = Object.values(levelCounts).reduce((s, v) => s + v, 0);
    metrics.push({ name: 'error_rate', value: total > 0 ? errCount / total : 0, type: 'gauge', labels: {}, timestamp: now });

    if (latencies.length > 0) {
      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length * 0.5)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      const p99 = latencies[Math.floor(latencies.length * 0.99)];
      metrics.push({ name: 'latency_p50', value: p50, type: 'histogram', labels: {}, timestamp: now });
      metrics.push({ name: 'latency_p95', value: p95, type: 'histogram', labels: {}, timestamp: now });
      metrics.push({ name: 'latency_p99', value: p99, type: 'histogram', labels: {}, timestamp: now });
    }

    return metrics;
  }

  applyRetention(policy: RetentionPolicy): number {
    const now = Date.now();
    const maxAgeMs = policy.maxAgeDays * 86_400_000;
    let deleted = 0;

    const toRemove = new Set<number>();
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (!e) continue;
      if (now - e.timestamp > maxAgeMs) toRemove.add(i);
    }

    if (this.entries.length - toRemove.size > policy.maxEntries) {
      const remaining = this.entries
        .map((e, i) => (e && !toRemove.has(i) ? i : -1))
        .filter((i) => i >= 0);
      const excess = remaining.length - policy.maxEntries;
      for (let j = 0; j < excess; j++) toRemove.add(remaining[j]);
    }

    for (const i of toRemove) {
      const e = this.entries[i];
      if (!e) continue;
      this.entryIdMap.delete(e.id);
      this.indexByLevel.get(e.level)?.delete(i);
      this.indexByService.get(e.service)?.delete(i);
      this.indexByTraceId.get(e.traceId)?.delete(i);
      this.indexByCorrelationId.get(e.correlationId)?.delete(i);
      delete (this.entries as any)[i];
      deleted++;
    }

    logger.info(`Retention applied: removed ${deleted} entries`);
    return deleted;
  }

  getStats(): LoggingStats {
    const now = Date.now();
    const entriesByLevel: Record<string, number> = {};
    const entriesByService: Record<string, number> = {};
    let totalValid = 0;
    let storageUsedBytes = 0;
    let errorCount = 0;

    for (const entry of this.entries) {
      if (!entry) continue;
      totalValid++;
      entriesByLevel[entry.level] = (entriesByLevel[entry.level] ?? 0) + 1;
      entriesByService[entry.service] = (entriesByService[entry.service] ?? 0) + 1;
      storageUsedBytes += estimateBytes(entry);
      if (entry.level === 'error' || entry.level === 'fatal') errorCount++;
    }

    const elapsedMinutes = this.firstEntryTime > 0
      ? Math.max((now - this.firstEntryTime) / 60_000, 1)
      : 1;

    return {
      totalEntries: totalValid,
      entriesByLevel,
      entriesByService,
      avgEntriesPerMinute: totalValid / elapsedMinutes,
      errorRate: totalValid > 0 ? errorCount / totalValid : 0,
      topPatterns: this.detectPatterns().slice(0, 10),
      storageUsedBytes,
    };
  }

  createCorrelationId(): string {
    return generateId();
  }

  enrichWithPerformance(entryId: string, durationMs: number): void {
    const idx = this.entryIdMap.get(entryId);
    if (idx === undefined) {
      logger.warn(`Entry not found for enrichment: ${entryId}`);
      return;
    }
    const entry = this.entries[idx];
    if (!entry) return;
    entry.duration = durationMs;
    entry.context = { ...entry.context, performanceEnriched: true, enrichedAt: Date.now() };
  }

  getErrorRate(windowMs = 60_000): number {
    const cutoff = Date.now() - windowMs;
    let total = 0;
    let errors = 0;
    for (const entry of this.entries) {
      if (!entry || entry.timestamp < cutoff) continue;
      total++;
      if (entry.level === 'error' || entry.level === 'fatal') errors++;
    }
    return total > 0 ? errors / total : 0;
  }

  getServiceHealth(service: string): { errorRate: number; avgLatencyMs: number; logVolume: number } {
    const idxSet = this.indexByService.get(service);
    if (!idxSet || idxSet.size === 0) {
      return { errorRate: 0, avgLatencyMs: 0, logVolume: 0 };
    }

    let errors = 0;
    let latencySum = 0;
    let latencyCount = 0;
    let volume = 0;

    for (const i of idxSet) {
      const e = this.entries[i];
      if (!e) continue;
      volume++;
      if (e.level === 'error' || e.level === 'fatal') errors++;
      if (e.duration !== undefined) {
        latencySum += e.duration;
        latencyCount++;
      }
    }

    return {
      errorRate: volume > 0 ? errors / volume : 0,
      avgLatencyMs: latencyCount > 0 ? latencySum / latencyCount : 0,
      logVolume: volume,
    };
  }
}

function intersect(a: Set<number>, b: Set<number>): Set<number> {
  const result = new Set<number>();
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const v of smaller) {
    if (larger.has(v)) result.add(v);
  }
  return result;
}

declare global {
  var __structuredLoggingFramework__: StructuredLoggingFramework | undefined;
}

export function getStructuredLogging(): StructuredLoggingFramework {
  if (!globalThis.__structuredLoggingFramework__) {
    globalThis.__structuredLoggingFramework__ = new StructuredLoggingFramework();
  }
  return globalThis.__structuredLoggingFramework__;
}
