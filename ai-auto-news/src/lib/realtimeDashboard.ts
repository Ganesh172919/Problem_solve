/**
 * Real-Time Dashboard
 *
 * WebSocket-driven live monitoring dashboard data layer:
 * - Live system health metrics (CPU, memory, latency, error rate)
 * - Real-time request throughput and status codes
 * - Active user session tracking
 * - Per-endpoint performance heatmap data
 * - AI agent activity stream
 * - Revenue pulse (MRR, conversions, upgrades in real-time)
 * - Alert stream with severity classification
 * - Deployment status feed
 * - Queue depth monitoring
 * - Cache hit-rate live feed
 */

import { getLogger } from './logger';
import { getCache } from './cache';

const logger = getLogger();

export interface SystemHealthSnapshot {
  timestamp: Date;
  cpu: number; // 0–100%
  memoryUsed: number; // bytes
  memoryTotal: number; // bytes
  memoryPct: number; // 0–100
  diskUsed: number; // bytes
  diskTotal: number; // bytes
  processUptimeSeconds: number;
  nodeVersion: string;
  heapUsed: number;
  heapTotal: number;
}

export interface RequestMetricsSnapshot {
  timestamp: Date;
  windowSeconds: number;
  totalRequests: number;
  requestsPerSecond: number;
  statusCodes: Record<string, number>;
  errorRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  slowestEndpoints: Array<{ endpoint: string; avgMs: number; count: number }>;
  topEndpoints: Array<{ endpoint: string; count: number; errorRate: number }>;
}

export interface ActiveSessionsSnapshot {
  timestamp: Date;
  totalActiveSessions: number;
  authenticatedSessions: number;
  anonymousSessions: number;
  sessionsByTier: Record<string, number>;
  peakConcurrentToday: number;
  avgSessionDurationMinutes: number;
}

export interface RevenueSnapshot {
  timestamp: Date;
  mrrCents: number;
  arrCents: number;
  newMrrToday: number;
  churnedMrrToday: number;
  expansionMrrToday: number;
  netMrrGrowth: number;
  newSubscriptionsToday: number;
  upgradesThisHour: number;
  trialConversionsToday: number;
  activeSubscribers: number;
}

export interface AiActivityItem {
  timestamp: Date;
  agentId: string;
  agentType: string;
  action: string;
  status: 'started' | 'completed' | 'failed';
  durationMs?: number;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface DashboardAlert {
  id: string;
  timestamp: Date;
  severity: 'info' | 'warning' | 'error' | 'critical';
  source: string;
  title: string;
  message: string;
  acknowledged: boolean;
  resolvedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface QueueDepthSnapshot {
  timestamp: Date;
  queues: Array<{
    name: string;
    depth: number;
    processingRate: number;
    oldestJobAgeSeconds: number;
    failedJobs: number;
  }>;
}

export interface CacheStatsSnapshot {
  timestamp: Date;
  hitRate: number;
  missRate: number;
  totalEntries: number;
  memoryUsedBytes: number;
  evictions: number;
  hitsByLayer: Record<string, number>;
}

export interface DashboardFrame {
  frameId: string;
  capturedAt: Date;
  systemHealth: SystemHealthSnapshot;
  requestMetrics: RequestMetricsSnapshot;
  activeSessions: ActiveSessionsSnapshot;
  revenue: RevenueSnapshot;
  recentAiActivity: AiActivityItem[];
  activeAlerts: DashboardAlert[];
  queueDepth: QueueDepthSnapshot;
  cacheStats: CacheStatsSnapshot;
}

// Internal sliding window for request metrics
interface RequestRecord {
  ts: number;
  endpoint: string;
  statusCode: number;
  latencyMs: number;
}

const requestWindow: RequestRecord[] = [];
const MAX_REQUEST_WINDOW = 10000;
const WINDOW_SECONDS = 60;

const aiActivityStream: AiActivityItem[] = [];
const MAX_ACTIVITY_STREAM = 200;

const alertStore: DashboardAlert[] = [];
const MAX_ALERTS = 500;

export function recordRequest(
  endpoint: string,
  statusCode: number,
  latencyMs: number,
): void {
  const now = Date.now();
  requestWindow.push({ ts: now, endpoint, statusCode, latencyMs });

  // Prune old entries
  const cutoff = now - WINDOW_SECONDS * 1000;
  while (requestWindow.length > 0 && requestWindow[0].ts < cutoff) {
    requestWindow.shift();
  }
  if (requestWindow.length > MAX_REQUEST_WINDOW) {
    requestWindow.splice(0, requestWindow.length - MAX_REQUEST_WINDOW);
  }
}

export function recordAiActivity(item: Omit<AiActivityItem, 'timestamp'>): void {
  aiActivityStream.unshift({ ...item, timestamp: new Date() });
  if (aiActivityStream.length > MAX_ACTIVITY_STREAM) {
    aiActivityStream.length = MAX_ACTIVITY_STREAM;
  }
}

export function emitAlert(
  severity: DashboardAlert['severity'],
  source: string,
  title: string,
  message: string,
  metadata?: Record<string, unknown>,
): DashboardAlert {
  const alert: DashboardAlert = {
    id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date(),
    severity,
    source,
    title,
    message,
    acknowledged: false,
    metadata,
  };

  alertStore.unshift(alert);
  if (alertStore.length > MAX_ALERTS) alertStore.length = MAX_ALERTS;

  if (severity === 'critical' || severity === 'error') {
    logger.error(`[DASHBOARD ALERT] ${title}`, undefined, { severity, source, message });
  } else {
    logger.warn(`[DASHBOARD ALERT] ${title}`, { severity, source, message });
  }

  return alert;
}

export function acknowledgeAlert(alertId: string): boolean {
  const alert = alertStore.find((a) => a.id === alertId);
  if (!alert) return false;
  alert.acknowledged = true;
  return true;
}

export function resolveAlert(alertId: string): boolean {
  const alert = alertStore.find((a) => a.id === alertId);
  if (!alert) return false;
  alert.resolvedAt = new Date();
  alert.acknowledged = true;
  return true;
}

function captureSystemHealth(): SystemHealthSnapshot {
  const mem = process.memoryUsage();
  const uptime = process.uptime();

  // Simulated CPU — in production use os.cpus() load average
  const cpuSimulated = 20 + Math.random() * 40;

  const heapUsed = mem.heapUsed;
  const heapTotal = mem.heapTotal;
  const memoryUsed = mem.rss;
  const memoryTotal = 4 * 1024 * 1024 * 1024; // 4 GB assumed

  return {
    timestamp: new Date(),
    cpu: Math.round(cpuSimulated * 10) / 10,
    memoryUsed,
    memoryTotal,
    memoryPct: Math.round((memoryUsed / memoryTotal) * 1000) / 10,
    diskUsed: 50 * 1024 * 1024 * 1024,
    diskTotal: 500 * 1024 * 1024 * 1024,
    processUptimeSeconds: Math.round(uptime),
    nodeVersion: process.version,
    heapUsed,
    heapTotal,
  };
}

function computeRequestMetrics(): RequestMetricsSnapshot {
  const now = Date.now();
  const cutoff = now - WINDOW_SECONDS * 1000;
  const recentRequests = requestWindow.filter((r) => r.ts >= cutoff);

  const total = recentRequests.length;
  const rps = total / WINDOW_SECONDS;

  const statusCodes: Record<string, number> = {};
  let errorCount = 0;
  const latencies = recentRequests.map((r) => r.latencyMs).sort((a, b) => a - b);
  const endpointMap = new Map<string, { count: number; errors: number; totalMs: number }>();

  for (const r of recentRequests) {
    const statusKey = String(Math.floor(r.statusCode / 100) * 100);
    statusCodes[statusKey] = (statusCodes[statusKey] ?? 0) + 1;
    if (r.statusCode >= 500) errorCount++;

    const ep = endpointMap.get(r.endpoint) ?? { count: 0, errors: 0, totalMs: 0 };
    ep.count++;
    ep.totalMs += r.latencyMs;
    if (r.statusCode >= 500) ep.errors++;
    endpointMap.set(r.endpoint, ep);
  }

  const p = (pct: number) => latencies[Math.floor(latencies.length * pct)] ?? 0;

  const slowest = Array.from(endpointMap.entries())
    .map(([endpoint, d]) => ({ endpoint, avgMs: d.totalMs / d.count, count: d.count }))
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, 5);

  const topEndpoints = Array.from(endpointMap.entries())
    .map(([endpoint, d]) => ({ endpoint, count: d.count, errorRate: d.errors / d.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    timestamp: new Date(),
    windowSeconds: WINDOW_SECONDS,
    totalRequests: total,
    requestsPerSecond: Math.round(rps * 100) / 100,
    statusCodes,
    errorRate: total > 0 ? errorCount / total : 0,
    p50LatencyMs: Math.round(p(0.5)),
    p95LatencyMs: Math.round(p(0.95)),
    p99LatencyMs: Math.round(p(0.99)),
    slowestEndpoints: slowest,
    topEndpoints,
  };
}

function captureActiveSessionsSnapshot(): ActiveSessionsSnapshot {
  const cache = getCache();
  const sessions = cache.get<ActiveSessionsSnapshot>('dashboard:sessions') ?? {
    timestamp: new Date(),
    totalActiveSessions: 0,
    authenticatedSessions: 0,
    anonymousSessions: 0,
    sessionsByTier: {},
    peakConcurrentToday: 0,
    avgSessionDurationMinutes: 0,
  };
  sessions.timestamp = new Date();
  return sessions;
}

export function updateActiveSessions(data: Partial<Omit<ActiveSessionsSnapshot, 'timestamp'>>): void {
  const cache = getCache();
  const current = cache.get<ActiveSessionsSnapshot>('dashboard:sessions') ?? {
    timestamp: new Date(),
    totalActiveSessions: 0,
    authenticatedSessions: 0,
    anonymousSessions: 0,
    sessionsByTier: {},
    peakConcurrentToday: 0,
    avgSessionDurationMinutes: 0,
  };
  Object.assign(current, data);
  current.timestamp = new Date();
  cache.set('dashboard:sessions', current, 300);
}

function captureRevenueSnapshot(): RevenueSnapshot {
  const cache = getCache();
  return cache.get<RevenueSnapshot>('dashboard:revenue') ?? {
    timestamp: new Date(),
    mrrCents: 0,
    arrCents: 0,
    newMrrToday: 0,
    churnedMrrToday: 0,
    expansionMrrToday: 0,
    netMrrGrowth: 0,
    newSubscriptionsToday: 0,
    upgradesThisHour: 0,
    trialConversionsToday: 0,
    activeSubscribers: 0,
  };
}

export function updateRevenuePulse(data: Partial<Omit<RevenueSnapshot, 'timestamp'>>): void {
  const cache = getCache();
  const current = captureRevenueSnapshot();
  Object.assign(current, data, { timestamp: new Date() });
  cache.set('dashboard:revenue', current, 300);
}

function captureQueueDepth(): QueueDepthSnapshot {
  const cache = getCache();
  return cache.get<QueueDepthSnapshot>('dashboard:queues') ?? {
    timestamp: new Date(),
    queues: [],
  };
}

export function updateQueueDepth(queues: QueueDepthSnapshot['queues']): void {
  const cache = getCache();
  cache.set('dashboard:queues', { timestamp: new Date(), queues }, 60);
}

function captureCacheStats(): CacheStatsSnapshot {
  const cache = getCache();
  return cache.get<CacheStatsSnapshot>('dashboard:cache_stats') ?? {
    timestamp: new Date(),
    hitRate: 0,
    missRate: 0,
    totalEntries: 0,
    memoryUsedBytes: 0,
    evictions: 0,
    hitsByLayer: {},
  };
}

export function updateCacheStats(stats: Partial<Omit<CacheStatsSnapshot, 'timestamp'>>): void {
  const cache = getCache();
  const current = captureCacheStats();
  Object.assign(current, stats, { timestamp: new Date() });
  cache.set('dashboard:cache_stats', current, 60);
}

export function captureDashboardFrame(): DashboardFrame {
  const frameId = `frame_${Date.now()}`;
  const systemHealth = captureSystemHealth();
  const requestMetrics = computeRequestMetrics();
  const activeSessions = captureActiveSessionsSnapshot();
  const revenue = captureRevenueSnapshot();
  const recentAiActivity = aiActivityStream.slice(0, 20);
  const activeAlerts = alertStore.filter((a) => !a.resolvedAt).slice(0, 50);
  const queueDepth = captureQueueDepth();
  const cacheStats = captureCacheStats();

  // Auto-generate alerts based on thresholds
  if (requestMetrics.errorRate > 0.05) {
    emitAlert('error', 'request_metrics', 'High Error Rate', `Error rate is ${(requestMetrics.errorRate * 100).toFixed(1)}%`);
  }
  if (systemHealth.cpu > 80) {
    emitAlert('warning', 'system', 'High CPU Usage', `CPU at ${systemHealth.cpu}%`);
  }
  if (systemHealth.memoryPct > 85) {
    emitAlert('warning', 'system', 'High Memory Usage', `Memory at ${systemHealth.memoryPct}%`);
  }

  const frame: DashboardFrame = {
    frameId,
    capturedAt: new Date(),
    systemHealth,
    requestMetrics,
    activeSessions,
    revenue,
    recentAiActivity,
    activeAlerts,
    queueDepth,
    cacheStats,
  };

  // Cache latest frame
  const cache = getCache();
  cache.set('dashboard:latest_frame', frame, 30);

  return frame;
}

export function getLatestFrame(): DashboardFrame | null {
  const cache = getCache();
  return cache.get<DashboardFrame>('dashboard:latest_frame') ?? null;
}

export function getActiveAlerts(minSeverity: DashboardAlert['severity'] = 'info'): DashboardAlert[] {
  const severityOrder = { info: 0, warning: 1, error: 2, critical: 3 };
  const minLevel = severityOrder[minSeverity];
  return alertStore
    .filter((a) => !a.resolvedAt && severityOrder[a.severity] >= minLevel)
    .slice(0, 100);
}

export function getAiActivityStream(limit = 50): AiActivityItem[] {
  return aiActivityStream.slice(0, limit);
}

export function clearResolvedAlerts(): number {
  const before = alertStore.length;
  const cutoff = Date.now() - 86400000; // 24 hours
  const toRemove: number[] = [];
  for (let i = alertStore.length - 1; i >= 0; i--) {
    if (alertStore[i].resolvedAt && alertStore[i].resolvedAt!.getTime() < cutoff) {
      toRemove.push(i);
    }
  }
  for (const idx of toRemove) alertStore.splice(idx, 1);
  return before - alertStore.length;
}
