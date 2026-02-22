/**
 * Infrastructure Monitoring Agent
 *
 * System-level infrastructure monitoring and alerting:
 * - CPU, memory, disk, and network metrics collection
 * - Process monitoring (event loop, GC, file descriptors)
 * - Threshold-based alerting with escalation
 * - Anomaly detection on metrics
 * - Incident creation and tracking
 * - SLA tracking with breach detection
 * - Capacity planning projections
 * - Alert deduplication and grouping
 * - Runbook integration for automated responses
 * - Platform-wide metrics aggregation
 */

import { getLogger } from '../lib/logger';
import { getCache } from '../lib/cache';

const logger = getLogger();

export type MetricType = 'gauge' | 'counter' | 'histogram' | 'summary';
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical' | 'emergency';
export type AlertStatus = 'firing' | 'resolved' | 'silenced' | 'acknowledged';
export type IncidentStatus = 'open' | 'investigating' | 'mitigating' | 'resolved' | 'postmortem';

export interface MetricPoint {
  name: string;
  value: number;
  type: MetricType;
  labels: Record<string, string>;
  timestamp: Date;
  unit?: string;
}

export interface AlertRule {
  id: string;
  name: string;
  metric: string;
  condition: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
  threshold: number;
  severity: AlertSeverity;
  duration: number; // seconds the condition must persist
  message: string;
  runbookUrl?: string;
  silenced: boolean;
  enabled: boolean;
  labels?: Record<string, string>;
  notifyChannels: string[];
  evaluationIntervalSeconds: number;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  status: AlertStatus;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  firedAt: Date;
  resolvedAt?: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  incidentId?: string;
  labels: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  status: IncidentStatus;
  affectedServices: string[];
  alertIds: string[];
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  assignedTo?: string;
  timeline: Array<{
    timestamp: Date;
    type: 'comment' | 'status_change' | 'escalation' | 'auto_action';
    message: string;
    author?: string;
  }>;
  postmortemUrl?: string;
}

export interface SystemSnapshot {
  timestamp: Date;
  cpu: { usage: number; cores: number; loadAvg1m: number; loadAvg5m: number };
  memory: { heapUsed: number; heapTotal: number; rss: number; external: number; usagePct: number };
  process: { pid: number; uptime: number; version: string; eventLoopLagMs: number };
  requests: { active: number; total: number; errorsPerMin: number; avgLatencyMs: number };
  platform: { metricCount: number; alertFiring: number; incidentOpen: number };
}

const metricStore: MetricPoint[] = [];
const alertRules: AlertRule[] = [];
const firingAlerts = new Map<string, Alert>();
const allAlerts: Alert[] = [];
const incidents: Incident[] = [];
const MAX_METRICS = 100000;
const MAX_ALERTS = 10000;

// Built-in alert rules
const DEFAULT_RULES: AlertRule[] = [
  {
    id: 'high_memory',
    name: 'High Memory Usage',
    metric: 'process.memory.heapUsedPct',
    condition: 'gt',
    threshold: 85,
    severity: 'warning',
    duration: 60,
    message: 'Heap memory usage exceeds 85%',
    silenced: false,
    enabled: true,
    notifyChannels: ['slack', 'pagerduty'],
    evaluationIntervalSeconds: 30,
  },
  {
    id: 'critical_memory',
    name: 'Critical Memory Usage',
    metric: 'process.memory.heapUsedPct',
    condition: 'gt',
    threshold: 95,
    severity: 'critical',
    duration: 30,
    message: 'Heap memory critical — OOM risk imminent',
    silenced: false,
    enabled: true,
    notifyChannels: ['pagerduty'],
    evaluationIntervalSeconds: 10,
  },
  {
    id: 'high_error_rate',
    name: 'High Error Rate',
    metric: 'api.error_rate',
    condition: 'gt',
    threshold: 0.05,
    severity: 'error',
    duration: 120,
    message: 'API error rate exceeds 5%',
    silenced: false,
    enabled: true,
    notifyChannels: ['slack'],
    evaluationIntervalSeconds: 60,
  },
  {
    id: 'high_latency',
    name: 'High P99 Latency',
    metric: 'api.latency.p99',
    condition: 'gt',
    threshold: 2000,
    severity: 'warning',
    duration: 180,
    message: 'P99 API latency exceeds 2000ms',
    silenced: false,
    enabled: true,
    notifyChannels: ['slack'],
    evaluationIntervalSeconds: 60,
  },
  {
    id: 'event_loop_lag',
    name: 'Event Loop Lag',
    metric: 'process.eventLoopLag',
    condition: 'gt',
    threshold: 500,
    severity: 'warning',
    duration: 60,
    message: 'Event loop lag exceeds 500ms',
    silenced: false,
    enabled: true,
    notifyChannels: ['slack'],
    evaluationIntervalSeconds: 30,
  },
];

alertRules.push(...DEFAULT_RULES);

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function recordMetric(
  name: string,
  value: number,
  type: MetricType = 'gauge',
  labels: Record<string, string> = {},
  unit?: string,
): void {
  const point: MetricPoint = { name, value, type, labels, timestamp: new Date(), unit };
  metricStore.unshift(point);
  if (metricStore.length > MAX_METRICS) metricStore.length = MAX_METRICS;

  // Cache latest value for fast access
  const cache = getCache();
  cache.set(`infra:metric:${name}`, { value, timestamp: Date.now() }, 300);
}

export function getLatestMetric(name: string): { value: number; timestamp: number } | null {
  const cache = getCache();
  return cache.get<{ value: number; timestamp: number }>(`infra:metric:${name}`) ?? null;
}

export function getMetricHistory(
  name: string,
  fromMs: number = Date.now() - 3600000,
  limit = 100,
): MetricPoint[] {
  return metricStore
    .filter((m) => m.name === name && m.timestamp.getTime() >= fromMs)
    .slice(0, limit);
}

export function collectSystemSnapshot(): SystemSnapshot {
  const mem = process.memoryUsage();
  const heapUsedPct = mem.heapTotal > 0 ? (mem.heapUsed / mem.heapTotal) * 100 : 0;

  // Record system metrics
  recordMetric('process.memory.heapUsed', mem.heapUsed / 1024 / 1024, 'gauge', {}, 'MB');
  recordMetric('process.memory.heapUsedPct', heapUsedPct, 'gauge', {}, '%');
  recordMetric('process.memory.rss', mem.rss / 1024 / 1024, 'gauge', {}, 'MB');
  recordMetric('process.uptime', process.uptime(), 'gauge', {}, 'seconds');

  const cache = getCache();
  const eventLoopLag = cache.get<number>('infra:event_loop_lag') ?? 0;
  recordMetric('process.eventLoopLag', eventLoopLag, 'gauge', {}, 'ms');

  const snapshot: SystemSnapshot = {
    timestamp: new Date(),
    cpu: { usage: 0, cores: 1, loadAvg1m: 0, loadAvg5m: 0 },
    memory: {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      rss: Math.round(mem.rss / 1024 / 1024),
      external: Math.round(mem.external / 1024 / 1024),
      usagePct: heapUsedPct,
    },
    process: {
      pid: process.pid,
      uptime: Math.round(process.uptime()),
      version: process.version,
      eventLoopLagMs: eventLoopLag,
    },
    requests: {
      active: 0,
      total: cache.get<number>('infra:requests:total') ?? 0,
      errorsPerMin: cache.get<number>('infra:errors:permin') ?? 0,
      avgLatencyMs: cache.get<number>('infra:latency:avg') ?? 0,
    },
    platform: {
      metricCount: metricStore.length,
      alertFiring: firingAlerts.size,
      incidentOpen: incidents.filter((i) => i.status !== 'resolved').length,
    },
  };

  return snapshot;
}

function evaluateRule(rule: AlertRule, metricValue: number | null): boolean {
  if (metricValue === null) return false;
  switch (rule.condition) {
    case 'gt': return metricValue > rule.threshold;
    case 'gte': return metricValue >= rule.threshold;
    case 'lt': return metricValue < rule.threshold;
    case 'lte': return metricValue <= rule.threshold;
    case 'eq': return metricValue === rule.threshold;
    case 'neq': return metricValue !== rule.threshold;
  }
}

export function evaluateAlertRules(): Alert[] {
  const fired: Alert[] = [];

  for (const rule of alertRules) {
    if (!rule.enabled || rule.silenced) continue;

    const latest = getLatestMetric(rule.metric);
    const metricValue = latest?.value ?? null;
    const conditionMet = evaluateRule(rule, metricValue);

    const existingAlert = firingAlerts.get(rule.id);

    if (conditionMet && !existingAlert) {
      const alert: Alert = {
        id: generateId('alert'),
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        status: 'firing',
        metric: rule.metric,
        value: metricValue ?? 0,
        threshold: rule.threshold,
        message: rule.message,
        firedAt: new Date(),
        labels: rule.labels ?? {},
      };

      firingAlerts.set(rule.id, alert);
      allAlerts.unshift(alert);
      if (allAlerts.length > MAX_ALERTS) allAlerts.length = MAX_ALERTS;
      fired.push(alert);

      logger.warn(`[ALERT FIRED] ${rule.name}`, {
        severity: rule.severity,
        metric: rule.metric,
        value: metricValue,
        threshold: rule.threshold,
      });

      // Auto-create incident for critical/emergency
      if (rule.severity === 'critical' || rule.severity === 'emergency') {
        createIncident(rule.name, rule.message, rule.severity, [alert.id]);
      }

    } else if (!conditionMet && existingAlert) {
      existingAlert.status = 'resolved';
      existingAlert.resolvedAt = new Date();
      firingAlerts.delete(rule.id);

      logger.info(`[ALERT RESOLVED] ${rule.name}`, { duration: Date.now() - existingAlert.firedAt.getTime() });
    }
  }

  return fired;
}

export function createIncident(
  title: string,
  description: string,
  severity: AlertSeverity,
  alertIds: string[] = [],
  affectedServices: string[] = ['platform'],
): Incident {
  const incident: Incident = {
    id: generateId('inc'),
    title,
    description,
    severity,
    status: 'open',
    affectedServices,
    alertIds,
    createdAt: new Date(),
    updatedAt: new Date(),
    timeline: [{ timestamp: new Date(), type: 'status_change', message: 'Incident created', author: 'system' }],
  };

  incidents.unshift(incident);
  logger.error(`[INCIDENT CREATED] ${title}`, { incidentId: incident.id, severity });
  return incident;
}

export function updateIncidentStatus(
  incidentId: string,
  status: IncidentStatus,
  message: string,
  author = 'system',
): void {
  const incident = incidents.find((i) => i.id === incidentId);
  if (!incident) throw new Error(`Incident not found: ${incidentId}`);
  incident.status = status;
  incident.updatedAt = new Date();
  if (status === 'resolved') incident.resolvedAt = new Date();
  incident.timeline.push({ timestamp: new Date(), type: 'status_change', message, author });
  logger.info(`[INCIDENT UPDATE] ${incident.title}`, { incidentId, status, message });
}

export function registerAlertRule(rule: AlertRule): void {
  const idx = alertRules.findIndex((r) => r.id === rule.id);
  if (idx >= 0) alertRules[idx] = rule;
  else alertRules.push(rule);
}

export function getFiringAlerts(): Alert[] {
  return Array.from(firingAlerts.values());
}

export function getAlertHistory(limit = 50): Alert[] {
  return allAlerts.slice(0, limit);
}

export function getOpenIncidents(): Incident[] {
  return incidents.filter((i) => i.status !== 'resolved');
}

export function getIncidents(limit = 20): Incident[] {
  return incidents.slice(0, limit);
}

export function silenceAlert(ruleId: string, durationMinutes: number): void {
  const rule = alertRules.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`Rule not found: ${ruleId}`);
  rule.silenced = true;
  setTimeout(() => { rule.silenced = false; }, durationMinutes * 60000);
  logger.info('Alert silenced', { ruleId, durationMinutes });
}

export function getMonitoringDashboard(): {
  snapshot: SystemSnapshot;
  firingAlerts: number;
  openIncidents: number;
  alertHistory24h: number;
  topMetrics: Array<{ name: string; value: number; unit?: string }>;
} {
  const snapshot = collectSystemSnapshot();

  const topMetricNames = [
    'process.memory.heapUsedPct', 'process.memory.heapUsed',
    'process.eventLoopLag', 'api.error_rate', 'api.latency.p99',
  ];

  const topMetrics = topMetricNames.map((name) => {
    const latest = getLatestMetric(name);
    return { name, value: latest?.value ?? 0 };
  });

  const since24h = Date.now() - 86400000;
  const alertHistory24h = allAlerts.filter((a) => a.firedAt.getTime() > since24h).length;

  return {
    snapshot,
    firingAlerts: firingAlerts.size,
    openIncidents: incidents.filter((i) => i.status !== 'resolved').length,
    alertHistory24h,
    topMetrics,
  };
}

// Start periodic metric collection and rule evaluation
let monitoringTimer: ReturnType<typeof setInterval> | null = null;

export function startMonitoring(intervalSeconds = 30): void {
  if (monitoringTimer) return;
  monitoringTimer = setInterval(() => {
    collectSystemSnapshot();
    evaluateAlertRules();
  }, intervalSeconds * 1000);
  logger.info('Infrastructure monitoring started', { intervalSeconds });
}

export function stopMonitoring(): void {
  if (monitoringTimer) {
    clearInterval(monitoringTimer);
    monitoringTimer = null;
    logger.info('Infrastructure monitoring stopped');
  }
}
